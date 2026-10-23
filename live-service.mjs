import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {credentials} from './ozon.mjs';
import {performanceAccount} from './performance.mjs';
import {synchronizeLive,lastCompleteWeek} from './live-data.mjs';
export function usableSnapshot(data){return data?.mode==='live'&&['analytics','finance','cpc','cpo'].some(k=>data.sources?.[k]?.ok===true);}
const code=e=>{const s=String(e||'source_failed');return /^[a-z0-9_]{1,100}$/.test(s)?s:s.includes('catalog_capacity_exceeded')?'catalog_capacity_exceeded':'source_failed';};
function sourceStatus(sources={}){return Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,{ok:s.ok===true,...(s.skipped?{skipped:true}:{}),...(s.error?{error:code(s.error)}:{}),...(Number.isFinite(Date.parse(s.retryAt))?{retryAt:s.retryAt}:{})}]));}
export async function createLiveService(root,{sync=synchronizeLive,getCredentials=credentials,getPerformanceAccount=performanceAccount,now=()=>Date.now(),ttlMs=15*60000,retryBaseMs=30000}={}){
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
   const next=await sync(message=>progress=message);
   const after=await account();if(after!==before){data=null;accountRef=after;throw Error('account_changed_during_sync');}
   lastAttempt.sources=sourceStatus(next?.sources);
   nextRefreshAt=Math.max(0,...Object.values(lastAttempt.sources).map(s=>Date.parse(s.retryAt)||0));
   if(!usableSnapshot(next))throw Error('all_sources_unavailable');
   data=next;failures=0;
   try{await writeFile(file+'.tmp',JSON.stringify({version:2,accountRef,data}),{mode:0o600});await rename(file+'.tmp',file);}catch{error='cache_write_failed';}
   state='ready';lastAttempt.state='ready';progress='Данные обновлены';
  })().catch(e=>{state='error';error=code(e.message);lastAttempt.state='failed';lastAttempt.error=error;failures++;nextRefreshAt=Math.max(nextRefreshAt,now()+Math.min(ttlMs,retryBaseMs*2**Math.min(failures-1,6)));progress='Не удалось обновить данные';}).finally(()=>{lastAttempt.finishedAt=new Date(now()).toISOString();checkingAccount=false;pending=null;});
 }
 return {get(force=false){
  const stamp=Date.parse(data?.fetchedAt),outdated=!data||!Number.isFinite(stamp)||data.period.to!==lastCompleteWeek(new Date(now())).to||now()-stamp>=ttlMs;
  if((force||outdated||state==='error')&&now()>=nextRefreshAt)refresh();
  const due=Math.max(nextRefreshAt,state==='error'||!Number.isFinite(stamp)?now():stamp+ttlMs);
  return {autoRefreshAt:new Date(due).toISOString(),state:state==='idle'&&data?'ready':state,progress,error,stale:outdated,data:checkingAccount?null:data,lastAttempt,refreshAfter:nextRefreshAt>now()?new Date(nextRefreshAt).toISOString():null};
 }};
}
