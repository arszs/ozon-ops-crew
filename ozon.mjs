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
export async function catalog(cursor=''){
 const d=await sellerRead('/v3/product/list',{filter:{visibility:'ALL'},limit:20,last_id:cursor});const r=d.result||{};
 return {total:r.total,items:(r.items||[]).map(p=>({productId:p.product_id,offerId:p.offer_id,archived:p.archived,hasFbo:p.has_fbo_stocks,hasFbs:p.has_fbs_stocks})),cursor:r.last_id||'',fetchedAt:new Date().toISOString(),readOnly:true};
}
