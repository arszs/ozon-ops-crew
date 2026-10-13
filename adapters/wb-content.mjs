import {wbRead,createWbRead} from './wb-api.mjs';
export async function wbCharacteristics(store,subjectId,{read=wbRead,fetcher,getCredentials,locale='zh'}={}){
 if(store.marketplace!=='wb'||store.mode!=='live')throw Error('需要真实 WB 店铺连接');
 if(!/^[1-9]\d*$/.test(String(subjectId))||!Number.isSafeInteger(Number(subjectId)))throw Error('WB 类目 ID 无效');
 if(fetcher||getCredentials)read=createWbRead({fetcher,getCredentials});
 if(!['zh','ru'].includes(locale))throw Error('WB 字典语言无效');
 const d=await read(store,`/content/v2/object/charcs/${subjectId}?locale=${locale}`);if(!Array.isArray(d.data))throw Error('WB characteristics schema');
  const ids=new Set();const items=d.data.map(a=>{if(!Number.isSafeInteger(a.charcID)||a.charcID<=0||ids.has(a.charcID)||Number(a.subjectID)!==Number(subjectId)||typeof a.name!=='string'||typeof a.required!=='boolean')throw Error('WB characteristics schema');ids.add(a.charcID);return {id:a.charcID,name:a.name,required:a.required,hasFilter:a.hasFilter===true,unit:a.unitName||'',maxCount:a.maxCount??null,type:a.charcType??null};});
  for(let i=0;i<items.length;i++)items[i].namedField=d.data[i].existNamedField===true;
  return {storeId:store.id,marketplace:'wb',mode:'live',subjectId:Number(subjectId),subjectName:d.data[0]?.subjectName||'',locale,items,requiredCount:items.filter(a=>a.required).length,fetchedAt:new Date().toISOString(),source:'WB Content API /content/v2/object/charcs',publicationEnabled:false};
}
