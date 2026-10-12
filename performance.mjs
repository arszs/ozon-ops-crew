import {ApiCooldown} from './core/api-cooldown.mjs';
const cooldown=new ApiCooldown();
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const quota=c=>createHash('sha256').update(String(c.client||'')).digest('hex');
const identity=c=>createHash('sha256').update(JSON.stringify(c)).digest('hex');
let cached=null;
async function config(){
 let cfg={...process.env};if(process.env.OZON_PERFORMANCE_ENV_FILE){const text=await readFile(process.env.OZON_PERFORMANCE_ENV_FILE,'utf8');for(const line of text.split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))cfg[line.slice(0,i)]=line.slice(i+1).trim();}}
 return {client:cfg.OZON_PERFORMANCE_CLIENT_ID,secret:cfg.OZON_PERFORMANCE_CLIENT_SECRET};
}
export async function performanceConfigured(){const c=await config();return Boolean(c.client&&c.secret);}
export async function performanceAccount(){const c=await config();if(!c.client||!c.secret)throw Error('performance_not_configured');return identity(c);}
async function token(c){
 c??=await config();const ref=identity(c);cooldown.check(quota(c),'performance_http_429');if(cached?.ref===ref&&cached.until>Date.now())return cached.value;
 if(!c.client||!c.secret)throw Error('performance_not_configured');
 const res=await fetch('https://api-performance.ozon.ru/api/client/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:c.client,client_secret:c.secret,grant_type:'client_credentials'})});
 if(res.status===429)cooldown.reject(quota(c),res,'performance_auth_http_429');if(!res.ok)throw Error('performance_auth_http_'+res.status);const d=await res.json();if(!d.access_token)throw Error('performance_invalid_token');cached={ref,value:d.access_token,until:Date.now()+Math.max(0,Number(d.expires_in||0)-60)*1000};return cached.value;
}
// Reporting stays read-only. The separate disable transport is restricted to one approved SKU.
export async function campaigns(){
 const d=await performanceRead('/api/client/campaign');return {readOnly:true,fetchedAt:new Date().toISOString(),items:(d.list||[]).map(c=>({id:String(c.id),title:c.title||'',state:c.state||'',type:c.advObjectType||''}))};
}

// Only reporting POSTs and explicitly listed read endpoints are permitted.
export function performanceReadAllowed(path,method){
 const p=path.split('?')[0];
 if(method==='POST')return ['/api/client/statistics/json','/api/client/statistic/products/generate/json','/api/client/campaign/search_promo/v2/products','/api/client/search_promo/get_cpo_min_bids'].includes(p);
 return method==='GET'&&(['/api/client/campaign','/api/client/statistics/expense/json','/api/client/statistics/report','/api/client/statistics/all_sku_promo/products/generate/json'].includes(p)||/^\/api\/client\/statistics\/[a-f0-9-]{36}$/i.test(p)||/^\/api\/client\/campaign\/\d+\/v2\/products$/.test(p));
}
export async function performanceRead(path,body,{accountRef}={}){
 const method=body===undefined?'GET':'POST';if(!performanceReadAllowed(path,method))throw Error('performance_method_not_allowed');
 const c=await config();cooldown.check(quota(c),'performance_http_429');if(accountRef&&identity(c)!==accountRef)throw Error('performance_account_changed');
 const access=await token(c);cooldown.check(quota(c),'performance_http_429');
 const res=await fetch('https://api-performance.ozon.ru'+path,{method,signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(res.status===429)cooldown.reject(quota(c),res,'performance_http_429');if(!res.ok){if(res.status===401)cached=null;throw Error('performance_http_'+res.status);}
 try{return await res.json();}catch{throw Error('performance_invalid_response');}
}
export async function performanceReport(path,body,onProgress=()=>{},{read=performanceRead,accountRef}={}){
 const job=await read(path,body,{accountRef});if(!/^[a-f0-9-]{36}$/i.test(job.UUID||''))throw Error('performance_invalid_report_id');
 for(let i=0;i<30;i++){
  const status=await read('/api/client/statistics/'+job.UUID,undefined,{accountRef});
  if(status.state==='OK')return read('/api/client/statistics/report?UUID='+encodeURIComponent(job.UUID),undefined,{accountRef});
  if(['ERROR','FAILED','TIMEOUT','CANCEL'].includes(status.state))throw Error('performance_report_failed');
  onProgress('Ozon формирует рекламный отчёт…');await new Promise(r=>setTimeout(r,2000));
 }
 throw Error('performance_report_timeout');
}

// No generic write API: enable, bid changes and all-assortment changes are unavailable.
export async function performanceDisable(sku,accountRef){
 let access,quotaRef;try{
  if(typeof sku!=='string'||! /^[1-9]\d*$/.test(sku)||!accountRef)throw Error('Invalid CPO disable target');
  const c=await config();if(identity(c)!==accountRef)throw Error('performance_account_changed');quotaRef=quota(c);access=await token(c);cooldown.check(quotaRef,'performance_http_429');
 }catch(e){e.noWrite=true;throw e;}
 const res=await fetch('https://api-performance.ozon.ru/api/client/search_promo/product/disable',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({skus:[sku]})});
 if(res.status===429)cooldown.reject(quotaRef,res,'performance_disable_http_429');if(!res.ok)throw Error('performance_disable_http_'+res.status);
 // The documented success response is an empty object. A timeout/foreign response stays unknown.
 const d=await res.json();if(!d||Array.isArray(d)||typeof d!=='object'||Object.keys(d).length)throw Error('performance_disable_receipt_unknown');
 return d;
}
