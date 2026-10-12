import {Repository,hash,audit} from './repository.mjs';
import {planAdRange} from './ad-reading-service.mjs';
const day=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const plus=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
const context=p=>hash({storeId:p.storeId,sku:p.sku,from:p.bStart,to:p.bEnd,budget:p.adBudget});
export function monitorDue(p,now,after=false){
 const date=[day(now),plus(p.bStart,1)].sort().at(-1);let at=new Date(date+'T06:00:00Z');
 if(at<=now)at=after?new Date(plus(date,1)+'T06:00:00Z'):new Date(now);
 return at.toISOString();
}
function eligible(p,s,now){return p?.status==='planned'&&p.mode==='live'&&s?.id==='ozon-live'&&s.mode==='live'&&s.marketplace==='ozon'&&day(now)<=plus(p.bEnd,7);}
// One local process, explicitly enabled per plan. It only starts read-only reports.
export class AdMonitor{
 constructor(file,{workspace,advertising,clock=()=>new Date(),maxPerTick=5}){
  this.repo=new Repository(file);this.workspace=workspace;this.advertising=advertising;this.clock=clock;this.maxPerTick=maxPerTick;this.pending=null;this.timer=null;this.status={lastTickAt:null,error:null};
  this.ready=this.repo.mutate(db=>{db.adMonitors??=[];for(const m of db.adMonitors)if(m.lastState==='running'){m.lastState='interrupted';m.error='server_restarted';}});
 }
 async list(){await this.ready;return (await this.repo.read()).adMonitors.map(({owner,contextHash,...m})=>m);}
 async configure(planId,enabled){
  if(typeof enabled!=='boolean')throw Error('请选择开启或关闭每日检查');await this.ready;
  const db=await this.workspace.repo.read(),p=db.trialPlans?.find(p=>p.id===planId);if(!p)throw Error('Plan not found');const s=this.workspace.resolveStore(db,p.storeId);
  if(enabled&&!eligible(p,s,this.clock()))throw Error('仅支持测试结束后7天以内、未完成的主 Ozon 计划');
  const owner=enabled?await this.advertising.account(s):null;
  return this.repo.mutate(db=>{let m=db.adMonitors.find(m=>m.planId===planId);if(m&&m.enabled===enabled&&(!enabled||m.owner===owner&&m.contextHash===context(p)))return {enabled:m.enabled};
   if(!m){m={planId,storeId:p.storeId,sku:p.sku,revision:0};db.adMonitors.push(m);}
   Object.assign(m,{enabled,revision:m.revision+1,updatedAt:this.clock().toISOString(),error:null,lastState:enabled?'scheduled':'disabled',stopAfter:plus(p.bEnd,7),nextCheckAt:enabled?monitorDue(p,this.clock()):null,...(enabled?{owner,contextHash:context(p)}:{})});
   audit(db,{kind:'advertising.monitor.configured',planId,enabled,revision:m.revision});return {enabled:m.enabled};
  });
 }
 start(){if(this.timer)return;const run=()=>this.tick().catch(()=>{this.status.error='monitor_unavailable';});this.timer=setInterval(run,60000);this.timer.unref();run();}
 stop(){clearInterval(this.timer);this.timer=null;}
 tick(){if(this.pending)return this.pending;this.pending=this.pump().finally(()=>this.pending=null);return this.pending;}
 async pump(){
  await this.ready;this.status={lastTickAt:this.clock().toISOString(),error:null};const monitors=(await this.repo.read()).adMonitors.filter(m=>m.enabled).sort((a,b)=>a.nextCheckAt.localeCompare(b.nextCheckAt));let started=0;
  for(const old of monitors){
   const db=await this.workspace.repo.read(),p=db.trialPlans?.find(p=>p.id===old.planId);let s;try{s=p&&this.workspace.resolveStore(db,p.storeId);}catch{}
   const update=fn=>this.repo.mutate(db=>{const m=db.adMonitors.find(m=>m.planId===old.planId);if(m?.enabled&&m.revision===old.revision){fn(m);audit(db,{kind:'advertising.monitor.state',planId:m.planId,state:m.lastState,nextCheckAt:m.nextCheckAt});m.updatedAt=this.clock().toISOString();}});
   if(!eligible(p,s,this.clock())||context(p)!==old.contextHash){await update(m=>{m.enabled=false;m.nextCheckAt=null;m.lastState='ended';m.error=p?.status==='planned'?'plan_window_or_context_changed':'plan_finished';});continue;}
   if(Date.parse(old.nextCheckAt)>+this.clock()||started>=this.maxPerTick)continue;
   // Reserve tomorrow before network calls; restart never floods missed intervals.
   let reserved=false;await update(m=>{m.nextCheckAt=monitorDue(p,this.clock(),true);m.lastState='running';m.lastAttemptAt=this.clock().toISOString();reserved=true;});if(!reserved)continue;started++;
   try{
    if(await this.advertising.account(s)!==old.owner){await update(m=>{m.enabled=false;m.nextCheckAt=null;m.lastState='connection_changed';m.error='connection_changed';});continue;}
    const current=(await this.repo.read()).adMonitors.find(m=>m.planId===old.planId);if(!current?.enabled||current.revision!==old.revision)continue;
    const run=await this.advertising.start(s,{...planAdRange(p,'b',this.clock()),refresh:true,expectedOwner:old.owner});await update(m=>m.lastRunId=run.id);await this.advertising.wait(run.id);
    const result=(await this.advertising.list([s])).find(r=>r.id===run.id);
    await update(m=>{m.lastState=result?.state||'unavailable';m.error=result?.error||null;m.lastReadAt=result?.updatedAt||null;});
   }catch(e){await update(m=>{m.lastState=e.message==='advertising_account_changed'?'connection_changed':'error';m.error=m.lastState==='connection_changed'?'connection_changed':'daily_read_failed';if(m.lastState==='connection_changed'){m.enabled=false;m.nextCheckAt=null;}});}
  }
 }
}
