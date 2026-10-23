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
// Reporting stays read-only. Separate activation transports are restricted to one approved SKU.
export async function campaigns(){
 const d=await performanceRead('/api/client/campaign');return {readOnly:true,fetchedAt:new Date().toISOString(),items:(d.list||[]).map(c=>({id:String(c.id),title:c.title||'',state:c.state||'',type:c.advObjectType||''}))};
}

// Only reporting POSTs and explicitly listed read endpoints are permitted.
export function performanceReadAllowed(path,method){
 const p=path.split('?')[0];
 if(method==='POST')return ['/api/client/statistics/json','/api/client/statistic/products/generate/json','/api/client/campaign/search_promo/v2/products','/api/client/search_promo/get_cpo_min_bids'].includes(p);
 return method==='GET'&&(['/api/client/limits/list','/api/client/campaign','/api/client/statistics/expense/json','/api/client/statistics/campaign/product','/api/client/statistics/report','/api/client/statistics/all_sku_promo/products/generate/json'].includes(p)||/^\/api\/client\/statistics\/[a-f0-9-]{36}$/i.test(p)||/^\/api\/client\/campaign\/\d+\/v2\/products$/.test(p));
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

// No generic write API: each transport accepts only one approved SKU; no bid or all-assortment mutation.
export async function performanceDisable(sku,accountRef,{canExecute=async()=>true}={}){
 let access,quotaRef;try{
  if(typeof sku!=='string'||! /^[1-9]\d*$/.test(sku)||!accountRef)throw Error('Invalid CPO disable target');
  const c=await config();if(identity(c)!==accountRef)throw Error('performance_account_changed');quotaRef=quota(c);access=await token(c);cooldown.check(quotaRef,'performance_http_429');if(identity(await config())!==accountRef)throw Error('performance_account_changed');
 }catch(e){e.noWrite=true;throw e;}
 if(!await canExecute())throw Object.assign(Error('strategy_action_cancelled'),{noWrite:true});
 const res=await fetch('https://api-performance.ozon.ru/api/client/search_promo/product/disable',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({skus:[sku]})});
 if(res.status===429)cooldown.reject(quotaRef,res,'performance_disable_http_429');if(!res.ok)throw Error('performance_disable_http_'+res.status);
 // The documented success response is an empty object. A timeout/foreign response stays unknown.
 const d=await res.json();if(!d||Array.isArray(d)||typeof d!=='object'||Object.keys(d).length)throw Error('performance_disable_receipt_unknown');
 return d;
}

export async function performanceEnable(sku,accountRef){
 let access,quotaRef;try{
  if(typeof sku!=='string'||! /^[1-9]\d*$/.test(sku)||!accountRef)throw Error('Invalid CPO enable target');
  const c=await config();if(identity(c)!==accountRef)throw Error('performance_account_changed');quotaRef=quota(c);access=await token(c);cooldown.check(quotaRef,'performance_http_429');if(identity(await config())!==accountRef)throw Error('performance_account_changed');
 }catch(e){e.noWrite=true;throw e;}
 const res=await fetch('https://api-performance.ozon.ru/api/client/search_promo/product/enable',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({skus:[sku]})});
 if(res.status===429)cooldown.reject(quotaRef,res,'performance_enable_http_429');if(!res.ok)throw Error('performance_enable_http_'+res.status);
 const d=await res.json(),r=d?.response?.[0];
 if(!Array.isArray(d?.response)||d.response.length!==1||r?.sku!==sku||typeof r.update!=='boolean'||typeof r.bid!=='number'||!Number.isFinite(r.bid)||r.bid<0||(r.error!==undefined&&typeof r.error!=='string')||(r.update===true&&Boolean(r.error)))throw Error('performance_enable_receipt_unknown');
 return d;
}

// One explicitly scoped campaign may only be stopped by this transport.
// It cannot start campaigns, alter bids or increase any budget.
export async function performancePauseCampaign(campaignId,accountRef,{canExecute=async()=>true}={}){
 const {access,quotaRef}=await campaignWriteAuth(campaignId,accountRef,{canExecute});
 const res=await fetch('https://api-performance.ozon.ru/api/client/campaign/'+campaignId+'/deactivate',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({campaignId})});
 if(res.status===429)cooldown.reject(quotaRef,res,'performance_campaign_pause_http_429');
 if(!res.ok)throw Object.assign(Error('performance_campaign_pause_http_'+res.status),{...([400,403,404].includes(res.status)?{noWrite:true,platformRejected:true}:{})});
 const d=await res.json();if(!d||Array.isArray(d)||typeof d!=='object'||String(d.id)!==campaignId||typeof d.state!=='string')throw Error('campaign_pause_receipt_unknown');return d;
}

export async function performanceCampaignCSV({from,to},{accountRef}={}){
 for(const date of [from,to])if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('invalid_campaign_report_dates');
 const c=await config(),owner=identity(c);if(accountRef&&owner!==accountRef)throw Error('performance_account_changed');cooldown.check(quota(c),'performance_http_429');const access=await token(c);
 const path='/api/client/statistics/campaign/product?'+new URLSearchParams({dateFrom:from,dateTo:to});
 const response=await fetch('https://api-performance.ozon.ru'+path,{signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+access,Accept:'text/csv'}});
 if(response.status===429)cooldown.reject(quota(c),response,'performance_http_429');if(!response.ok)throw Error('performance_http_'+response.status);
 const chunks=[];let size=0;for await(const part of response.body){size+=part.length;if(size>2_000_000)throw Error('campaign_report_too_large');chunks.push(Buffer.from(part));}
 if(identity(await config())!==owner)throw Error('performance_account_changed');return {text:Buffer.concat(chunks).toString('utf8'),contentType:response.headers.get('content-type')||'',accountRef:owner,from,to,checkedAt:new Date().toISOString()};
}

async function campaignWriteAuth(campaignId,accountRef,{canExecute=async()=>true}={}){try{if(typeof campaignId!=='string'||! /^[1-9]\d*$/.test(campaignId)||!accountRef)throw Error('invalid_campaign_target');const c=await config();if(identity(c)!==accountRef)throw Error('performance_account_changed');const access=await token(c);cooldown.check(quota(c),'performance_http_429');if(!await canExecute())throw Error('strategy_action_cancelled');if(identity(await config())!==accountRef)throw Error('performance_account_changed');return {access,quotaRef:quota(c)};}catch(e){e.noWrite=true;throw e;}}
export async function performanceSetWeeklyBudget(campaignId,weeklyBudget,accountRef,{canExecute=async()=>true}={}){
 if(typeof weeklyBudget!=='string'||! /^[1-9]\d{0,19}$/.test(weeklyBudget))throw Object.assign(Error('campaign_budget_invalid'),{noWrite:true});const {access,quotaRef}=await campaignWriteAuth(campaignId,accountRef,{canExecute});
 const res=await fetch('https://api-performance.ozon.ru/api/client/campaign/'+campaignId,{method:'PATCH',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({weeklyBudget})});
 if(res.status===429)cooldown.reject(quotaRef,res,'performance_campaign_budget_http_429');if(!res.ok)throw Object.assign(Error('performance_campaign_budget_http_'+res.status),{...([400,403,404].includes(res.status)?{noWrite:true,platformRejected:true}:{})});const d=await res.json();if(!d||Array.isArray(d)||typeof d!=='object'||String(d.id??d.campaignId)!==campaignId)throw Error('campaign_budget_receipt_unknown');return d;
}
export async function performanceResumeCampaign(campaignId,accountRef,{canExecute=async()=>true}={}){
 const {access,quotaRef}=await campaignWriteAuth(campaignId,accountRef,{canExecute});const res=await fetch('https://api-performance.ozon.ru/api/client/campaign/'+campaignId+'/activate',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({campaignId})});
 if(res.status===429)cooldown.reject(quotaRef,res,'performance_campaign_resume_http_429');if(!res.ok)throw Object.assign(Error('performance_campaign_resume_http_'+res.status),{...([400,403,404].includes(res.status)?{noWrite:true,platformRejected:true}:{})});const d=await res.json();if(!d||Array.isArray(d)||typeof d!=='object'||String(d.id)!==campaignId||typeof d.state!=='string')throw Error('campaign_resume_receipt_unknown');return d;
}
