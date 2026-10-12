import {randomUUID} from 'node:crypto';
import {Repository,hash,audit} from './repository.mjs';
import {financeAccount,financeRange,readFinanceDay,readFinanceTypes,summarizeFinanceDays} from '../adapters/ozon-finance.mjs';
const now=()=>new Date().toISOString();
const nextDay=date=>new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
// A local serialized worker; each complete day is an atomic resumable checkpoint.
export class FinanceService{
 constructor(file,{account=financeAccount,readDay=readFinanceDay,readTypes=readFinanceTypes,clock=()=>new Date()}={}){
  this.repo=new Repository(file);this.account=account;this.readDay=readDay;this.readTypes=readTypes;this.clock=clock;this.pending=new Map();this.queue=Promise.resolve();
  this.ready=this.repo.mutate(db=>{db.financeRuns??=[];for(const r of db.financeRuns)if(['queued','running'].includes(r.state)){r.state='interrupted';r.error='服务重启，已保存完整日期；请继续读取';}});
 }
 public(r){
  const {owner,days,...v}=r,summary=days.length?summarizeFinanceDays(days):null;
  const used=new Set(Object.keys(summary?.components||{}).filter(k=>k.startsWith('fee:')).map(k=>k.slice(4)));
  const feeTypes=r.feeTypes?{...r.feeTypes,items:Object.fromEntries(Object.entries(r.feeTypes.items).filter(([id])=>used.has(id)))}:null;
  return {...v,feeTypes,loadedDays:days.length,summary,dayEvidence:days.map(d=>({date:d.date,evidenceHash:d.evidenceHash,pages:d.pages.length,at:d.pages.at(-1)?.at}))};
 }
 async list(stores){
  await this.ready;const db=await this.repo.read(),out=[];
  for(const s of stores.filter(s=>s.mode==='live'&&s.marketplace==='ozon')){
   let owner;try{owner=await this.account(s);}catch{continue;}
   out.push(...db.financeRuns.filter(r=>r.storeId===s.id&&r.owner===owner).slice(-100).map(r=>this.public(r)));
  }
  return out;
 }
 async start(store,input){
  await this.ready;const period=financeRange(input,this.clock()),owner=await this.account(store);
  const key=hash({storeId:store.id,owner,period});
  const {run,launch}=await this.repo.mutate(db=>{
   let r=db.financeRuns.findLast(r=>r.key===key);
   if(r&&(['queued','running'].includes(r.state)||r.state==='complete'&&input.refresh!==true))return {run:r,launch:false};
   if(!r||r.state==='complete'||input.refresh===true){r={id:randomUUID(),key,storeId:store.id,owner,...period,totalDays:period.days,state:'queued',days:[],startedAt:now(),updatedAt:now(),error:null};db.financeRuns.push(r);}
   else {r.state='queued';r.error=null;r.updatedAt=now();}
   audit(db,{kind:'finance.read.requested',runId:r.id,storeId:store.id,inputHash:hash(period)});
   return {run:r,launch:true};
  });
  if(launch){
   const task=this.queue.then(()=>this.pump(store,run)).catch(async e=>{
    await this.repo.mutate(db=>{const r=db.financeRuns.find(r=>r.id===run.id);r.state='error';r.error=String(e.message).slice(0,300);r.updatedAt=now();audit(db,{kind:'finance.read.failed',runId:r.id,error:r.error});});
   }).finally(()=>this.pending.delete(run.id));
   this.pending.set(run.id,task);this.queue=task.catch(()=>{});
  }
  return this.public(run);
 }
 async pump(store,run){
  const checkAccount=async()=>{if(await this.account(store)!==run.owner)throw Error('店铺 API 账户已改变，请重新读取');};
  await this.repo.mutate(db=>{db.financeRuns.find(r=>r.id===run.id).state='running';});
  if(!run.feeTypes){
   await checkAccount();let types,error;
   try{types=await this.readTypes(store);}catch(e){error=String(e.message).slice(0,300);}
   await checkAccount();await this.repo.mutate(db=>{const r=db.financeRuns.find(r=>r.id===run.id);r.feeTypes=types||null;r.typeError=error||null;audit(db,{kind:'finance.types.read',runId:r.id,outputHash:types?.hash||null,error:r.typeError});});
  }
  for(let date=run.days.length?nextDay(run.days.at(-1).date):run.from;date<=run.to;date=nextDay(date)){
   await checkAccount();const day=await this.readDay(store,{sku:run.sku,date},{checkAccount});await checkAccount();
   if(day.date!==date)throw Error('finance_day_mismatch');
   await this.repo.mutate(db=>{
    const r=db.financeRuns.find(r=>r.id===run.id);r.days.push(day);r.updatedAt=now();
    audit(db,{kind:'finance.day.read',runId:r.id,date,outputHash:hash(day)});
    if(date===run.to){r.state='complete';r.completedAt=now();r.evidenceHash=hash(r.days.map(d=>({date:d.date,hash:d.evidenceHash})));audit(db,{kind:'finance.read.complete',runId:r.id,outputHash:r.evidenceHash});}
   });
  }
 }
 async wait(id){await this.pending.get(id);}
}
