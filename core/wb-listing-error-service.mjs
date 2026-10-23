import {randomUUID} from 'node:crypto';
import {Repository,hash,maskPII} from './repository.mjs';
import {wbAccount} from '../adapters/wb-api.mjs';
import {readWbListingErrorPage} from '../adapters/wb-listing-errors.mjs';
// Single local worker per account. Only reduced, PII-masked errors are retained.
export class WbListingErrorService{
 constructor(file,{read=readWbListingErrorPage,accountRef=wbAccount,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  Object.assign(this,{repo:new Repository(file),read,accountRef,clock,sleep,pending:new Map()});
  this.ready=this.repo.mutate(db=>{db.runs??=[];for(const r of db.runs.filter(r=>r.state==='reading')){r.state='interrupted';r.error='上次读取中断，可继续已保存进度';}});
 }
 async identity(store){if(store.marketplace!=='wb'||store.mode!=='live')throw Error('需要真实 WB 店铺连接');return this.accountRef(store);}
 latest(db,store,owner){return db.runs.findLast(r=>r.storeId===store.id&&r.owner===owner);}
 async get(store,{vendorCode}={}){
  await this.ready;const owner=await this.identity(store),db=await this.repo.read(),r=this.latest(db,store,owner);
  if(!r)return {state:'idle',pages:0,batches:0,matches:[],complete:false};
  const prior=r.pages.length?r:db.runs.findLast(p=>p.storeId===store.id&&p.owner===owner&&p.pages.length),matches=vendorCode?(prior?.items||[]).filter(i=>i.vendorCodes.includes(vendorCode)).map(i=>({batchUUID:i.batchUUID,updatedAt:i.updatedAt,reasons:i.errors[vendorCode]||[],historical:false})):[];
  if(await this.identity(store)!==owner)throw Error('WB 账户已变化');
  return {id:r.id,state:r.state,error:r.error||null,pages:r.pages.length,batches:r.items.length,complete:r.state==='complete',startedAt:r.startedAt,checkedAt:r.updatedAt||null,retryAt:db.limits?.[owner]||null,stale:!!prior&&(prior.id!==r.id||this.clock()-Date.parse(prior.updatedAt)>900000),matches,evidenceHash:r.pages.at(-1)?.responseHash||null};
 }
 async start(store,{restart=false}={}){
  await this.ready;const owner=await this.identity(store);if(this.pending.has(owner)){if(this.pending.get(owner).storeId!==store.id)throw Error('同一 WB 账户正在另一连接中读取草稿错误');return this.get(store);}
  const run=await this.repo.mutate(db=>{
   db.limits??={};if(db.limits[owner]>this.clock()){const e=Error('WB 草稿错误读取间隔未到，请稍后继续');e.retryAt=db.limits[owner];throw e;}
   if(db.runs.some(r=>r.owner===owner&&r.state==='reading'))throw Error('此账户正在读取草稿错误');
   let r=this.latest(db,store,owner);if(r?.state==='reading')throw Error('此账户正在读取草稿错误');
   if(!r||restart||r.state==='complete'){r={id:randomUUID(),storeId:store.id,owner,state:'reading',startedAt:new Date(this.clock()).toISOString(),cursor:null,items:[],pages:[]};db.runs.push(r);}else{r.state='reading';delete r.error;}return structuredClone(r);
  });
  const worker={runId:run.id,storeId:store.id,stop:false};this.pending.set(owner,worker);
  worker.task=this.pump(store,owner,worker).catch(async e=>{await this.repo.mutate(db=>{const r=db.runs.find(r=>r.id===worker.runId);r.state='error';if(r.attempts?.at(-1)?.state==='started')r.attempts.at(-1).state='failed';r.error=maskPII(e.message).slice(0,400);if(Number.isFinite(e.retryAt))db.limits[owner]=Math.max(db.limits[owner]||0,e.retryAt);});}).finally(()=>this.pending.delete(owner));
  return this.get(store);
 }
 async pause(store){const owner=await this.identity(store),worker=this.pending.get(owner);if(worker){worker.stop=true;await worker.task;}return this.get(store);}
 async pump(store,owner,worker){
  const interval=['personal','service','base-with-secret'].includes(store.wbContentTokenType)?6100:1800050;
  while(true){
   if(worker.stop){await this.repo.mutate(db=>db.runs.find(r=>r.id===worker.runId).state='paused');return;}
   const db=await this.repo.read(),r=db.runs.find(r=>r.id===worker.runId),wait=(db.limits?.[owner]||0)-this.clock();
   if(wait>0){if(wait>10000){await this.repo.mutate(db=>db.runs.find(r=>r.id===worker.runId).state='waiting');return;}await this.sleep(Math.min(wait,500));continue;}
   if(await this.identity(store)!==owner)throw Error('WB 账户已变化，请重新读取');
   await this.repo.mutate(db=>{db.limits[owner]=this.clock()+interval;const r=db.runs.find(r=>r.id===worker.runId);r.attempts??=[];r.attempts.push({at:new Date(this.clock()).toISOString(),inputHash:hash(r.cursor),state:'started'});});
   const result=await this.read(store,r.cursor,{accountRef:owner});if(await this.identity(store)!==owner)throw Error('WB 账户已变化，请重新读取');
   await this.repo.mutate(db=>{
    const current=db.runs.find(r=>r.id===worker.runId);if(hash(current.cursor)!==hash(r.cursor))throw Error('WB 草稿错误游标已变化');
    if(result.more&&(hash(result.cursor)===hash(current.cursor)||current.pages.some(p=>p.cursorHash===hash(result.cursor))))throw Error('WB 草稿错误分页循环，未推进进度');
    const old=new Set(current.items.map(i=>i.batchUUID));if(result.items.some(i=>old.has(i.batchUUID)))throw Error('WB 草稿错误批次重复，请重新读取');
    current.items.push(...result.items);current.cursor=result.cursor;current.updatedAt=new Date(this.clock()).toISOString();current.pages.push({inputHash:result.inputHash,responseHash:result.responseHash,cursorHash:hash(result.cursor),at:current.updatedAt});current.attempts.at(-1).state='complete';if(!result.more)current.state='complete';
   });
   if(!result.more)return;
  }
 }
 async wait(storeId){await Promise.all([...this.pending.values()].filter(w=>w.storeId===storeId).map(w=>w.task));}
}
