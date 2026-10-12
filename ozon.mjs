import {readFile} from 'node:fs/promises';
export async function credentials(){
 const cfg={...process.env};
 if(process.env.OZON_ENV_FILE){const text=await readFile(process.env.OZON_ENV_FILE,'utf8');for(const line of text.split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))cfg[line.slice(0,i)]=line.slice(i+1).trim();}}
 return {client:cfg.OZON_CLIENT_ID,key:cfg.OZON_API_KEY};
}
const READ_PATHS=new Set(['/v3/product/list','/v3/product/info/list','/v1/finance/accrual/by-day','/v1/finance/accrual/types','/v1/analytics/data']);
export async function sellerRead(path,body){
 if(!READ_PATHS.has(path))throw Error('seller_method_not_allowed');
 const c=await credentials();if(!c.client||!c.key)throw Error('seller_not_configured');
 const res=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',signal:AbortSignal.timeout(30000),headers:{'Client-Id':c.client,'Api-Key':c.key,'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!res.ok)throw Error('seller_http_'+res.status);
 try{return await res.json();}catch{throw Error('seller_invalid_response');}
}
export async function catalog(cursor='',{read=sellerRead,limit=20}={}){
 const d=await read('/v3/product/list',{filter:{visibility:'ALL'},limit,last_id:cursor});const r=d.result;if(!r||!Array.isArray(r.items)||!Number.isInteger(r.total)||r.total<0)throw Error('catalog_schema');
 return {total:r.total,items:(r.items||[]).map(p=>({productId:p.product_id,offerId:p.offer_id,archived:p.archived,hasFbo:p.has_fbo_stocks,hasFbs:p.has_fbs_stocks})),cursor:r.last_id||'',fetchedAt:new Date().toISOString(),readOnly:true};
}

export async function fullCatalog({read=sellerRead}={}){
 const items=new Map(),seen=new Set();let cursor='',total=null;
 for(let page=0;page<100;page++){
  const next=await catalog(cursor,{read,limit:100});
  if(total!==null&&total!==next.total)throw Error('catalog_changed_during_sync');total=next.total;
  for(const p of next.items){if(!p.productId)throw Error('catalog_product_id_missing');items.set(String(p.productId),p);}
  if(items.size===total)return {total,items:[...items.values()],complete:true,fetchedAt:next.fetchedAt};
  if(items.size>total||!next.items.length||!next.cursor||seen.has(next.cursor))throw Error('catalog_incomplete_pagination');
  seen.add(next.cursor);cursor=next.cursor;
 }
 throw Error('catalog_page_limit');
}
