import {readFile} from 'node:fs/promises';
let cached=null;
async function config(){
 let cfg={...process.env};if(process.env.OZON_PERFORMANCE_ENV_FILE){const text=await readFile(process.env.OZON_PERFORMANCE_ENV_FILE,'utf8');for(const line of text.split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))cfg[line.slice(0,i)]=line.slice(i+1).trim();}}
 return {client:cfg.OZON_PERFORMANCE_CLIENT_ID,secret:cfg.OZON_PERFORMANCE_CLIENT_SECRET};
}
export async function performanceConfigured(){const c=await config();return Boolean(c.client&&c.secret);}
async function token(){
 if(cached&&cached.until>Date.now())return cached.value;
 const c=await config();if(!c.client||!c.secret)throw Error('performance_not_configured');
 const res=await fetch('https://api-performance.ozon.ru/api/client/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:c.client,client_secret:c.secret,grant_type:'client_credentials'})});
 if(!res.ok)throw Error('performance_auth_http_'+res.status);const d=await res.json();if(!d.access_token)throw Error('performance_invalid_token');cached={value:d.access_token,until:Date.now()+Math.max(0,Number(d.expires_in||0)-60)*1000};return cached.value;
}
// Deliberately read-only. No activation, budget or bid mutations exist here.
export async function campaigns(){
 const res=await fetch('https://api-performance.ozon.ru/api/client/campaign',{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+await token()}});
 if(!res.ok){if(res.status===401)cached=null;throw Error('performance_http_'+res.status);}
 const d=await res.json();return {readOnly:true,fetchedAt:new Date().toISOString(),items:(d.list||[]).map(c=>({id:String(c.id),title:c.title||'',state:c.state||'',type:c.advObjectType||''}))};
}

// Only reporting POSTs and explicitly listed read endpoints are permitted.
export function performanceReadAllowed(path,method){
 const p=path.split('?')[0];
 if(method==='POST')return ['/api/client/statistics/json','/api/client/statistic/products/generate/json','/api/client/campaign/search_promo/v2/products'].includes(p);
 return method==='GET'&&(['/api/client/campaign','/api/client/statistics/expense/json','/api/client/statistics/report','/api/client/statistics/all_sku_promo/products/generate/json'].includes(p)||/^\/api\/client\/statistics\/[a-f0-9-]{36}$/i.test(p)||/^\/api\/client\/campaign\/\d+\/v2\/products$/.test(p));
}
export async function performanceRead(path,body){
 const method=body===undefined?'GET':'POST';if(!performanceReadAllowed(path,method))throw Error('performance_method_not_allowed');
 const res=await fetch('https://api-performance.ozon.ru'+path,{method,signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(!res.ok){if(res.status===401)cached=null;throw Error('performance_http_'+res.status);}
 try{return await res.json();}catch{throw Error('performance_invalid_response');}
}
export async function performanceReport(path,body,onProgress=()=>{}){
 const job=await performanceRead(path,body);if(!/^[a-f0-9-]{36}$/i.test(job.UUID||''))throw Error('performance_invalid_report_id');
 for(let i=0;i<30;i++){
  const status=await performanceRead('/api/client/statistics/'+job.UUID);
  if(status.state==='OK')return performanceRead('/api/client/statistics/report?UUID='+encodeURIComponent(job.UUID));
  if(['ERROR','FAILED'].includes(status.state))throw Error('performance_report_failed');
  onProgress('Ozon формирует рекламный отчёт…');await new Promise(r=>setTimeout(r,2000));
 }
 throw Error('performance_report_timeout');
}
