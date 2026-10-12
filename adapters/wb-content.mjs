import {storeCredentials} from './marketplaces.mjs';
const queues=new Map(),last=new Map();
export async function wbCharacteristics(store,subjectId,{fetcher=fetch,getCredentials=storeCredentials}={}){
 if(store.marketplace!=='wb'||store.mode!=='live')throw Error('需要真实 WB 店铺连接');
 if(!/^[1-9]\d*$/.test(String(subjectId))||!Number.isSafeInteger(Number(subjectId)))throw Error('WB 类目 ID 无效');
 const run=(queues.get(store.id)||Promise.resolve()).then(async()=>{
  const c=await getCredentials(store);if(!c.WB_API_TOKEN)throw Error('未配置 WB Content API token');
  const wait=650-(Date.now()-(last.get(store.id)||0));if(wait>0)await new Promise(r=>setTimeout(r,wait));last.set(store.id,Date.now());
  const response=await fetcher(`https://content-api.wildberries.ru/content/v2/object/charcs/${subjectId}?locale=zh`,{method:'GET',headers:{Authorization:c.WB_API_TOKEN},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('WB Content HTTP '+response.status);const d=await response.json();if(d.error||!Array.isArray(d.data))throw Error('WB characteristics schema');
  const ids=new Set();const items=d.data.map(a=>{if(!Number.isSafeInteger(a.charcID)||a.charcID<=0||ids.has(a.charcID)||Number(a.subjectID)!==Number(subjectId)||typeof a.name!=='string'||typeof a.required!=='boolean')throw Error('WB characteristics schema');ids.add(a.charcID);return {id:a.charcID,name:a.name,required:a.required,hasFilter:a.hasFilter===true,unit:a.unitName||'',maxCount:a.maxCount??null,type:a.charcType??null};});
  return {storeId:store.id,marketplace:'wb',mode:'live',subjectId:Number(subjectId),subjectName:d.data[0]?.subjectName||'',locale:'zh',items,requiredCount:items.filter(a=>a.required).length,fetchedAt:new Date().toISOString(),source:'WB Content API /content/v2/object/charcs',publicationEnabled:false};
 });queues.set(store.id,run.catch(()=>{}));return run;
}
