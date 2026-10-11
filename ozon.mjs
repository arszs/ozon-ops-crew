import {readFile} from 'node:fs/promises';
export async function credentials(){
 let cfg={...process.env};
 if(process.env.OZON_ENV_FILE){const text=await readFile(process.env.OZON_ENV_FILE,'utf8');for(const line of text.split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))cfg[line.slice(0,i)]=line.slice(i+1).trim();}}
 return {client:cfg.OZON_CLIENT_ID,key:cfg.OZON_API_KEY};
}
// Read-only allowlist. A POST here retrieves data; it cannot mutate prices or campaigns.
export async function catalog(cursor=''){
 const c=await credentials();if(!c.client||!c.key)throw Error('not_configured');
 const res=await fetch('https://api-seller.ozon.ru/v3/product/list',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Client-Id':c.client,'Api-Key':c.key,'Content-Type':'application/json'},body:JSON.stringify({filter:{visibility:'ALL'},limit:20,last_id:cursor})});
 if(!res.ok)throw Error('seller_http_'+res.status);
 const data=await res.json();const r=data.result||{};
 return {total:r.total,items:(r.items||[]).map(p=>({productId:p.product_id,offerId:p.offer_id,archived:p.archived,hasFbo:p.has_fbo_stocks,hasFbs:p.has_fbs_stocks})),cursor:r.last_id||'',fetchedAt:new Date().toISOString(),readOnly:true};
}
