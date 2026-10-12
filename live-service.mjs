import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {credentials} from './ozon.mjs';
import {synchronizeLive,lastCompleteWeek} from './live-data.mjs';
export async function createLiveService(root){
 const {client,key}=await credentials();const accountRef=createHash('sha256').update((client||'')+'\0'+(key||'')+'\0'+(process.env.OZON_PERFORMANCE_ENV_FILE||'')+'\0'+(process.env.OZON_PERFORMANCE_CLIENT_ID||'')).digest('hex');
 const file=root+'/runtime/live-cache.json';let data=null,state='idle',progress='',error=null,pending=null;
 try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.version===1&&saved.accountRef===accountRef&&saved.data?.mode==='live')data=saved.data;}catch{}
 function refresh(){
  if(pending)return;
  state='syncing';error=null;progress='Подключаюсь к Ozon…';
  pending=synchronizeLive(message=>progress=message).then(async next=>{
   if(!Object.values(next.sources).some(s=>s.ok))throw Error('all_sources_unavailable');
   data=next;state='ready';progress='Данные обновлены';
   try{await writeFile(file+'.tmp',JSON.stringify({version:1,accountRef,data}),{mode:0o600});await rename(file+'.tmp',file);}catch{error='cache_write_failed';}
  }).catch(e=>{state='error';error=e.message;progress='Не удалось обновить данные';}).finally(()=>pending=null);
 }
 return {get(force=false){
  const outdated=!data||data.period.to!==lastCompleteWeek().to||Date.now()-Date.parse(data.fetchedAt)>15*60*1000;
  if(force||(outdated&&state==='idle'))refresh();
  return {state:state==='idle'&&data?'ready':state,progress,error,stale:outdated,data};
 }};
}
