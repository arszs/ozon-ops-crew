import {storeCredentials} from './marketplaces.mjs';
import {wbAccount,wbRegion} from './wb-api.mjs';
import {ApiCooldown} from '../core/api-cooldown.mjs';
export const WB_FINANCE_INTERVAL=60100;
export const WB_REPORT_FIELDS=['retailAmountSum','forPaySum','deliveryServiceSum','paidStorageSum','paidAcceptanceSum','deductionSum','penaltySum','additionalPaymentSum','cashbackAmountSum','cashbackDiscountSum','cashbackCommissionChangeSum','paymentSchedule','bankPaymentSum'];
export const WB_DETAIL_MONEY=['forPay','retailAmount','deliveryService','paidStorage','paidAcceptance','deduction','penalty','additionalPayment','rebillLogisticCost','cashbackAmount','cashbackDiscount','cashbackCommissionChange','paymentSchedule'];
export const WB_DETAIL_FIELDS=['reportId','rrdId','nmId','dateFrom','dateTo','currency','title','vendorCode','docTypeName','sellerOperName','quantity',...WB_DETAIL_MONEY];
export function wbInteger(v,{zero=false}={}){if(typeof v==='number'&&!Number.isSafeInteger(v))throw Error('WB 标识精度丢失');const s=String(v);if(!/^(0|[1-9]\d{0,19})$/.test(s)||!zero&&s==='0')throw Error('WB 报表标识无效');return s;}
export function wbDecimal(v){if(typeof v!=='string'||!/^[-+]?\d{1,24}(\.\d{1,6})?$/.test(v))throw Error('WB 报表金额缺失或精度无效');const [i,f='']=v.replace(/^[-+]/,'').split('.');return (v.startsWith('-')?-1n:1n)*(BigInt(i)*1000000n+BigInt(f.padEnd(6,'0')));}
export function decimalText(v){const sign=v<0n?'-':'';v=v<0n?-v:v;const f=String(v%1000000n).padStart(6,'0').replace(/0+$/,'');return sign+String(v/1000000n)+(f?'.'+f:'');}
export const addDecimal=(a,b)=>decimalText(wbDecimal(a||'0')+wbDecimal(b));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function wbFinanceRange(input={},now=Date.now()){
 const today=new Date(now+10800000).toISOString().slice(0,10),to=input.to||new Date(Date.parse(today)-86400000).toISOString().slice(0,10);if(!date(to))throw Error('WB 报表结束日期无效');const from=input.from||new Date(Date.parse(to)-6*86400000).toISOString().slice(0,10);
 const days=(Date.parse(to)-Date.parse(from))/86400000+1;if(!date(from)||!date(to)||from<'2024-01-29'||to>=today||days<1||days>31)throw Error('请选择 2024-01-29 起的 1–31 个完整莫斯科自然日');return {from,to,days,period:'daily'};
}
const currency=v=>{if(typeof v!=='string'||!/^[A-Z]{3}$/.test(v))throw Error('WB 财务币种无效');return v;};
export function normalizeWbReport(r,range){
 const reportId=wbInteger(r.reportId);if(!date(r.dateFrom)||!date(r.dateTo)||r.dateFrom!==r.dateTo||r.dateFrom<range.from||r.dateTo>range.to||![1,2].includes(r.reportType))throw Error('WB 日报日期或类型不匹配');
 const amounts={};for(const k of WB_REPORT_FIELDS)amounts[k]=decimalText(wbDecimal(r[k]));return {reportId,from:r.dateFrom,to:r.dateTo,currency:currency(r.currency),reportType:r.reportType,amounts};
}
export function normalizeWbFinanceRow(r,reports){
 const reportId=wbInteger(r.reportId),rrdId=wbInteger(r.rrdId),report=reports.get(reportId);if(!report||r.currency!==report.currency||r.dateFrom!==report.from||r.dateTo!==report.to)throw Error('WB 明细与报表列表不匹配');
 if(!Number.isSafeInteger(r.quantity)||r.quantity<0||typeof r.docTypeName!=='string'||typeof r.sellerOperName!=='string'||typeof r.title!=='string'||typeof r.vendorCode!=='string')throw Error('WB 财务商品或业务类型无效');
 const amounts={};for(const k of WB_DETAIL_MONEY)amounts[k]=decimalText(wbDecimal(r[k]));
 return {reportId,rrdId,sku:wbInteger(r.nmId,{zero:true}),currency:r.currency,title:r.title.slice(0,1000),vendorCode:r.vendorCode.slice(0,300),document:r.docTypeName.slice(0,100),operation:r.sellerOperName.slice(0,200),quantity:r.quantity,amounts};
}
// Reviver source retains int64 IDs before JavaScript's Number rounding. Other extra fields are discarded by normalizers.
export function parseWbFinanceJSON(text){return JSON.parse(text,(k,v,context)=>{if(['reportId','rrdId','nmId'].includes(k)&&typeof v==='number'){if(!context?.source||!/^\d+$/.test(context.source))throw Error('WB 标识 JSON 格式无效');return context.source;}return v;});}
export function financeRequest(range,phase,cursor){
 if(!date(range?.from)||!date(range?.to)||range.from>range.to)throw Error('WB 报表日期无效');const dates={dateFrom:range.from,dateTo:range.to,period:'daily'};
 if(phase==='list'){const offset=Number(cursor);if(!Number.isSafeInteger(offset)||offset<0)throw Error('WB offset 无效');return {path:'/api/finance/v1/sales-reports/list',body:{...dates,limit:1000,offset}};}
 if(phase!=='details')throw Error('WB 财务读取阶段无效');return {path:'/api/finance/v1/sales-reports/detailed',body:{...dates,limit:100000,rrdId:wbInteger(cursor,{zero:true}),fields:WB_DETAIL_FIELDS}};
}
export function createWbFinanceRead({fetcher=fetch,getCredentials=storeCredentials,clock=()=>Date.now()}={}){
 const pending=new Set(),last=new Map(),cooldown=new ApiCooldown({now:clock});
 return async(store,range,phase,cursor,{accountRef}={})=>{
  const request=financeRequest(range,phase,cursor),owner=await wbAccount(store,{getCredentials});if(accountRef&&owner!==accountRef)throw Error('WB 账户已变化，请重新读取');if(pending.has(owner))throw Error('WB 财务账户正在读取');
  cooldown.check(owner,'WB 财务请求限流');const retryAt=(last.get(owner)??-Infinity)+WB_FINANCE_INTERVAL;if(retryAt>clock()){const e=Error('WB 财务请求间隔未到');e.retryAt=retryAt;throw e;}
  pending.add(owner);try{
   const c=await getCredentials(store);if(await wbAccount(store,{getCredentials:async()=>c})!==owner)throw Error('WB 账户已变化，请重新读取');last.set(owner,clock());
   let body=JSON.stringify(request.body);if(phase==='details')body=body.replace('"rrdId":"'+request.body.rrdId+'"','"rrdId":'+request.body.rrdId);
   let response;try{response=await fetcher('https://finance-api.wildberries.'+wbRegion(store)+request.path,{method:'POST',headers:{Authorization:c.WB_API_TOKEN,'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('WB 财务网络读取失败');}
   if(response.status===429)cooldown.reject(owner,{headers:{get:()=>response.headers?.get('Retry-After')||response.headers?.get('X-Ratelimit-Retry')}},'WB 财务请求限流');
   if(!response.ok)throw Error([401,403].includes(response.status)?'WB 财务权限不足，请检查 Finance 权限及 Personal / Service token（HTTP '+response.status+'）':'WB Finance HTTP '+response.status);
   let rows=[];if(response.status!==204){try{rows=parseWbFinanceJSON(await response.text());}catch{throw Error('WB 财务响应格式无效');}if(!Array.isArray(rows))throw Error('WB 财务响应不是列表');}
   if(await wbAccount(store,{getCredentials})!==owner)throw Error('WB 账户已变化，请重新读取');return {...request,status:response.status,rows};
  }finally{pending.delete(owner);}
 };
}
export const readWbFinance=createWbFinanceRead();
