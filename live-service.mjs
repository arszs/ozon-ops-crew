import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {credentials} from './ozon.mjs';
import {performanceAccount} from './performance.mjs';
import {synchronizeLive,lastCompleteWeek} from './live-data.mjs';
export function usableSnapshot(data){return data?.mode==='live'&&['analytics','finance','cpc','cpo'].some(k=>data.sources?.[k]?.ok===true);}
const code=e=>{const s=String(e||'source_failed');return /^[a-z0-9_]{1,100}$/.test(s)?s:s.includes('catalog_capacity_exceeded')?'catalog_capacity_exceeded':'source_failed';};
function sourceStatus(sources={}){return Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,{ok:s.ok===true,...(s.skipped?{skipped:true}:{}),...(s.error?{error:code(s.error)}:{}),...(Number.isFinite(Date.parse(s.retryAt))?{retryAt:s.retryAt}:{})}]));}
export async function createLiveService(root,{sync=synchronizeLive,getCredentials=credentials,getPerformanceAccount=performanceAccount,now=()=>Date.now(),ttlMs=60*60000,retryBaseMs=30000}={}){
 async function account(){const c=await getCredentials();let p;try{p=await getPerformanceAccount();}catch(e){if(e.message!=='performance_not_configured')throw e;p='unconfigured';}return createHash('sha256').update(JSON.stringify({client:c.client,key:c.key,performance:p})).digest('hex');}
 let accountRef=await account();const file=root+'/runtime/live-cache.json';
 let data=null,state='idle',progress='',error=null,pending=null,lastAttempt=null,nextRefreshAt=0,failures=0,checkingAccount=false;
 try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.version===2&&saved.accountRef===accountRef&&usableSnapshot(saved.data)){data=saved.data;lastAttempt={state:'cached',fromCache:true,finishedAt:data.fetchedAt,sources:sourceStatus(data.sources)};}}catch{}
 function refresh(){
  if(pending||now()<nextRefreshAt)return;
  state='syncing';error=null;progress='Проверяю подключение к Ozon…';checkingAccount=true;
  lastAttempt={startedAt:new Date(now()).toISOString(),state:'running',sources:{}};
  pending=(async()=>{
   const before=await account();if(before!==accountRef){data=null;accountRef=before;}
   checkingAccount=false;
   let next=await sync(message=>progress=message);
   const after=await account();if(after!==before){data=null;accountRef=after;throw Error('account_changed_during_sync');}
   lastAttempt.sources=sourceStatus(next?.sources);
   nextRefreshAt=Math.max(0,...Object.values(lastAttempt.sources).filter(s=>!['seller_analytics_daily_limit','seller_analytics_minute_limit'].includes(s.error)).map(s=>Date.parse(s.retryAt)||0));
   if(!usableSnapshot(next))throw Error('all_sources_unavailable');
   next=retainVerifiedAnalytics(next,data);data=next;failures=0;
   try{await writeFile(file+'.tmp',JSON.stringify({version:2,accountRef,data}),{mode:0o600});await rename(file+'.tmp',file);}catch{error='cache_write_failed';}
   state='ready';lastAttempt.state='ready';progress='Данные обновлены';
  })().catch(e=>{state='error';error=code(e.message);lastAttempt.state='failed';lastAttempt.error=error;failures++;nextRefreshAt=Math.max(nextRefreshAt,now()+Math.min(ttlMs,retryBaseMs*2**Math.min(failures-1,6)));progress='Не удалось обновить данные';}).finally(()=>{lastAttempt.finishedAt=new Date(now()).toISOString();checkingAccount=false;pending=null;});
 }
 return {async verified(force=false){const current=await account();if(current!==accountRef){data=null;accountRef=current;nextRefreshAt=0;state=pending?'syncing':'idle';if(!pending)lastAttempt=null;}return this.get(force);},get(force=false){
  const stamp=Date.parse(data?.fetchedAt),refreshStamp=Date.parse(data?.additionalSourcesAt||data?.fetchedAt),periodChanged=data?.period.to!==lastCompleteWeek(new Date(now())).to,outdated=!data||!Number.isFinite(stamp)||periodChanged||now()-stamp>=ttlMs,refreshDue=!data||!Number.isFinite(refreshStamp)||periodChanged||now()-refreshStamp>=ttlMs;
  if((force||refreshDue||state==='error')&&now()>=nextRefreshAt)refresh();
  const due=Math.max(nextRefreshAt,state==='error'||!Number.isFinite(refreshStamp)?now():refreshStamp+ttlMs);
  return {autoRefreshAt:new Date(due).toISOString(),state:state==='idle'&&data?'ready':state,progress,error,stale:outdated,data:checkingAccount?null:data,lastAttempt,refreshAfter:nextRefreshAt>now()?new Date(nextRefreshAt).toISOString():null};
 }};
}

// Reuse only previously complete analytics for the identical account-bound
// period. Fresh price, stock, accrual and ad fields are never replaced.
export function retainVerifiedAnalytics(next,previous){
 const successAt=previous?.sources?.analytics?.lastSuccessAt||previous?.fetchedAt;
 if(!previous||next?.sources?.analytics?.ok===true||previous.sources?.analytics?.ok!==true||previous.analyticsComplete!==true||next.period?.from!==previous.period?.from||next.period?.to!==previous.period?.to||!Number.isFinite(Date.parse(successAt)))return next;
 const rows=new Map((next.rows||[]).map(r=>[r.sku,{...r}]));
 for(const row of previous.rows||[]){if(typeof row.orderedUnits!=='number'||!Number.isFinite(row.orderedUnits)||typeof row.orderRevenue!=='number'||!Number.isFinite(row.orderRevenue))continue;const current=rows.get(row.sku)||{sku:row.sku,name:row.name,netAccrued:null,adSpend:null,strategies:[]};rows.set(row.sku,{...current,orderedUnits:row.orderedUnits,orderRevenue:row.orderRevenue});}
 return {...next,additionalSourcesAt:next.fetchedAt,fetchedAt:successAt,analyticsComplete:true,orders:previous.orders?{...previous.orders}:undefined,rows:[...rows.values()],sources:{...next.sources,analytics:{...sourceStatus(next.sources).analytics,ok:true,cached:true,stale:true,lastSuccessAt:successAt}}};
}
