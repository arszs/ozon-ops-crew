import {randomUUID} from 'node:crypto';
import {Repository,hash,audit} from './repository.mjs';
import {financeRange} from '../adapters/ozon-finance.mjs';
import {advertisingAccount,readAdvertisingSlice} from '../adapters/ozon-ad-readings.mjs';
const now=()=>new Date().toISOString(),next=(s,n)=>new Date(Date.parse(s)+n*86400000).toISOString().slice(0,10);
export function planAdRange(p,period,clock=new Date()){
 if(!['a','b'].includes(period))throw Error('请选择基准期或测试期');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock);
 return financeRange({sku:p.sku,from:p[period+'Start'],to:[p[period+'End'],next(today,-1)].sort()[0]},clock);
}
export function advertisingSummary(slices){
 const values={};for(const key of ['cpc','cpo']){const known=slices.filter(s=>s[key]?.ok&&Number.isFinite(s[key].spend));values[key]={spend:known.length?Math.round(known.reduce((n,s)=>n+s[key].spend,0)*100)/100:null,coveredDays:known.reduce((n,s)=>n+(Date.parse(s.to)-Date.parse(s.from))/86400000+1,0),complete:known.length===slices.length&&slices.length>0};}
 const known=[values.cpc.spend,values.cpo.spend].filter(v=>v!==null);return {...values,observedSpend:known.length?Math.round(known.reduce((n,v)=>n+v,0)*100)/100:null,currency:'RUB',allInstrumentsComplete:false};
}
export class AdReadingService{
 constructor(file,{account=advertisingAccount,readSlice=readAdvertisingSlice,clock=()=>new Date()}={}){
  this.repo=new Repository(file);this.account=account;this.readSlice=readSlice;this.clock=clock;this.pending=new Map();this.queue=Promise.resolve();
  this.ready=this.repo.mutate(db=>{db.adRuns??=[];for(const r of db.adRuns)if(['queued','running'].includes(r.state)){r.state='interrupted';r.error='读取中断；已完成的日期分段保留';}});
 }
 public(r){const {owner,key,...out}=r;return {...out,summary:advertisingSummary(r.slices)};}
 async list(stores){await this.ready;const db=await this.repo.read(),out=[];for(const s of stores.filter(s=>s.id==='ozon-live'&&s.mode==='live'&&s.marketplace==='ozon')){let owner;try{owner=await this.account(s);}catch{continue;}out.push(...db.adRuns.filter(r=>r.storeId===s.id&&r.owner===owner).slice(-100).map(r=>this.public(r)));}return out;}
 async start(store,input){
  await this.ready;const period=financeRange(input,this.clock()),owner=await this.account(store),key=hash({owner,storeId:store.id,period});if(input.expectedOwner&&input.expectedOwner!==owner)throw Error('advertising_account_changed');
  const {run,launch}=await this.repo.mutate(db=>{let r=db.adRuns.findLast(r=>r.key===key);if(r&&(['running','queued'].includes(r.state)||['complete','partial'].includes(r.state)&&input.refresh!==true))return {run:r,launch:false};
   if(r?.retryAt&&Date.parse(r.retryAt)>Date.now())throw Error('Ozon 限制读取频率，请在提示时间后重试');
   if(!r||['complete','partial'].includes(r.state)||input.refresh===true){r={id:randomUUID(),key,owner,storeId:store.id,...period,state:'queued',slices:[],startedAt:now(),updatedAt:now()};db.adRuns.push(r);}else{r.state='queued';r.error=null;}
   audit(db,{kind:'advertising.read.requested',runId:r.id,inputHash:hash(period)});return {run:r,launch:true};});
  if(launch){const task=this.queue.then(()=>this.pump(store,run)).catch(async e=>{await this.repo.mutate(db=>{const r=db.adRuns.find(r=>r.id===run.id);r.state='error';r.error=/^[a-z0-9_]{1,100}$/.test(e.message)?e.message:'advertising_read_failed';r.updatedAt=now();audit(db,{kind:'advertising.read.failed',runId:r.id,error:r.error});});}).finally(()=>this.pending.delete(run.id));this.pending.set(run.id,task);this.queue=task.catch(()=>{});}
  return this.public(run);
 }
 async comparisonEvidence(store,plan){
  await this.ready;let owner;try{owner=await this.account(store);}catch(e){if(['seller_not_configured','performance_not_configured'].includes(e.message))return {a:null,b:null};throw e;}const db=await this.repo.read(),out={};
  for(const key of ['a','b']){const r=db.adRuns.findLast(r=>r.storeId===store.id&&r.owner===owner&&r.sku===plan.sku&&r.from===plan[key+'Start']&&r.to===plan[key+'End']);out[key]=r?this.public(r):null;}
  if(await this.account(store)!==owner)throw Error('advertising_account_changed');return out;
 }
 async pump(store,run){
  const checkAccount=async()=>{if(await this.account(store)!==run.owner)throw Error('advertising_account_changed');};
  const onTool=event=>this.repo.mutate(db=>audit(db,{kind:'advertising.tool',runId:run.id,...event}));
  await this.repo.mutate(db=>{db.adRuns.find(r=>r.id===run.id).state='running';});
  for(let from=run.slices.length?next(run.slices.at(-1).to,1):run.from;from<=run.to;){const to=[next(from,30),run.to].sort()[0];await checkAccount();const slice=await this.readSlice(store,{sku:run.sku,from,to},{checkAccount,onTool});await checkAccount();
   if(slice.sku!==run.sku||slice.from!==from||slice.to!==to)throw Error('advertising_period_mismatch');
   const retryAt=[slice.cpc?.retryAt,slice.cpo?.retryAt].filter(v=>Number.isFinite(Date.parse(v))).sort().at(-1);
   await this.repo.mutate(db=>{const r=db.adRuns.find(r=>r.id===run.id);r.slices.push(slice);r.updatedAt=now();r.retryAt=retryAt||null;r.evidenceHash=hash(r.slices);audit(db,{kind:'advertising.slice.saved',runId:r.id,outputHash:hash(slice)});
    if(to===run.to){const s=advertisingSummary(r.slices);r.state=s.cpc.complete&&s.cpo.complete?'complete':'partial';r.completedAt=now();}
   });
   if(retryAt&&Date.parse(retryAt)>Date.now()&&to!==run.to)throw Error('advertising_rate_limited');from=next(to,1);
  }
 }
 async wait(id){await this.pending.get(id);}
}
