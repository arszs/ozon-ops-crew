import {hash} from '../core/repository.mjs';
import {credentials} from '../ozon.mjs';
import {storeCredentials} from './marketplaces.mjs';
import {ozonCall} from './ozon-products.mjs';

const validId=v=>(typeof v==='string'||Number.isSafeInteger(v))&&/^[1-9]\d*$/.test(String(v));
export async function financeAccount(store){
 if(store.mode!=='live'||store.marketplace!=='ozon')throw Error('仅支持真实 Ozon 店铺的财务读取');
 const c=store.id==='ozon-live'?await credentials():await storeCredentials(store).then(c=>({client:c.OZON_CLIENT_ID,key:c.OZON_API_KEY}));
 if(!c.client||!c.key)throw Error('Ozon credentials missing');
 return hash({client:c.client});
}
export function financeRange({sku,from,to},now=new Date()){
 if(typeof sku!=='string'||!validId(sku))throw Error('需要有效的 Ozon SKU');
 for(const v of [from,to])if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw Error('财务日期无效');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const days=(Date.parse(to)-Date.parse(from))/86400000+1;
 if(from<'2022-01-01'||to>=today||days<1||days>90)throw Error('请选择 2022 年起的 1–90 个完整莫斯科自然日');
 return {sku,from,to,days,timezone:'Europe/Moscow'};
}
function money(value){
 if(!value||typeof value.currency!=='string'||!/^[A-Z]{3}$/.test(value.currency)||!['number','string'].includes(typeof value.amount)||!String(value.amount).trim())throw Error('finance_money_schema');
 const n=Number(value.amount),cents=Math.round(n*100);
 if(!Number.isFinite(n)||!Number.isSafeInteger(cents)||Math.abs(n*100-cents)>0.0001)throw Error('finance_money_precision');
 return {currency:value.currency,cents};
}
const add=(target,currency,n)=>{const v=(target[currency]||0)+n;if(!Number.isSafeInteger(v))throw Error('finance_amount_overflow');target[currency]=v;};
const decimal=values=>Object.fromEntries(Object.entries(values).map(([c,n])=>[c,n/100]));
// No unit_number, buyer data or credentials are persisted. Exact page hashes retain provenance.
export function financeDay(accruals,{sku,date}){
 const seen=new Map(),totals={},components={},storeTotals={},unallocated={};let matched=0;
 for(const a of accruals){
  if(!validId(a.accrual_id)||a.date!==date)throw Error('finance_accrual_identity');
  const id=String(a.accrual_id),fingerprint=hash(a);if(seen.has(id)){if(seen.get(id)!==fingerprint)throw Error('finance_accrual_changed');continue;}seen.set(id,fingerprint);
  const total=money(a.total_amount),allocated={};add(storeTotals,total.currency,total.cents);let belongs=false;
  const part=(product,value,kind)=>{
   const m=money(value);if(!validId(product))return;add(allocated,m.currency,m.cents);
   if(String(product)!==sku)return;belongs=true;add(totals,m.currency,m.cents);components[kind]??={};add(components[kind],m.currency,m.cents);
  };
  if(a.posting!=null&&!Array.isArray(a.posting.products))throw Error('finance_posting_schema');
  for(const p of a.posting?.products||[]){
   if(p.commission){part(p.sku,p.commission.sale_amount,'sales');part(p.sku,p.commission.commission,'commission');}
   if(p.delivery)part(p.sku,p.delivery.total_accrued,'delivery');
   // bonus, coinvestment, list-price commission and delivery.services are explanatory,
   // not extra summands on top of final commission / total delivery.
  }
  if(a.item_fees!=null&&!Array.isArray(a.item_fees.fees))throw Error('finance_item_fees_schema');
  for(const p of a.item_fees?.fees||[]){
   if(!Array.isArray(p.fees))throw Error('finance_fee_schema');
   for(const fee of p.fees){if(!Number.isSafeInteger(fee.type_id)||fee.type_id<0)throw Error('finance_fee_type');part(p.sku,fee.accrued,'fee:'+fee.type_id);}
  }
  for(const c of new Set([total.currency,...Object.keys(allocated)]))add(unallocated,c,(c===total.currency?total.cents:0)-(allocated[c]||0));
  if(belongs)matched++;
 }
 return {date,accrualKeys:[...seen.keys()].map(id=>hash(id)),totals:decimal(totals),components:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,decimal(v)])),storeTotals:decimal(storeTotals),storeUnallocated:decimal(unallocated),storeAccruals:seen.size,matchedAccruals:matched};
}
export async function readFinanceDay(store,{sku,date},{call=ozonCall,checkAccount=async()=>{}}={}){
 const all=[],pages=[],cursors=new Set();let cursor='';
 for(let page=0;page<1000;page++){
  await checkAccount();const body={date,last_id:cursor};
  const d=await call(store,'/v1/finance/accrual/by-day',body);
  if(!Array.isArray(d.accruals)||typeof d.last_id!=='string')throw Error('finance_page_schema');
  all.push(...d.accruals);pages.push({inputHash:hash(body),outputHash:hash(d),at:new Date().toISOString()});
  if(!d.last_id){await checkAccount();return {...financeDay(all,{sku,date}),pages,evidenceHash:hash(pages)};}
  if(!d.accruals.length||cursors.has(d.last_id)||d.last_id===cursor)throw Error('finance_cursor_loop');
  cursors.add(d.last_id);cursor=d.last_id;
 }
 throw Error('finance_page_limit');
}
export async function readFinanceTypes(store,{call=ozonCall}={}){
 const d=await call(store,'/v1/finance/accrual/types',{});
 if(!Array.isArray(d.accrual_types))throw Error('finance_types_schema');
 const items={};for(const t of d.accrual_types){
  if(!Number.isSafeInteger(t.id)||t.id<0||Object.hasOwn(items,t.id)||typeof t.name!=='string'||typeof t.description!=='string')throw Error('finance_type_schema');
  items[t.id]={code:t.name.slice(0,200),description:t.description.slice(0,1000)};
 }
 return {items,hash:hash(d),at:new Date().toISOString(),source:'Ozon /v1/finance/accrual/types'};
}
export function summarizeFinanceDays(days){
 const totals={},components={},storeUnallocated={};let matchedAccruals=0;
 const merge=(to,from)=>{for(const [currency,amount] of Object.entries(from)){const m=money({currency,amount});add(to,currency,m.cents);}};
 for(const d of days){merge(totals,d.totals);merge(storeUnallocated,d.storeUnallocated);matchedAccruals+=d.matchedAccruals;for(const [k,v] of Object.entries(d.components)){components[k]??={};merge(components[k],v);}}
 return {totals:decimal(totals),dailyAverage:Object.fromEntries(Object.entries(totals).map(([c,n])=>[c,Math.round(n/days.length)/100])),components:Object.fromEntries(Object.entries(components).map(([k,v])=>[k,decimal(v)])),storeUnallocated:decimal(storeUnallocated),matchedAccruals,days:days.length,profit:null,source:'Ozon /v1/finance/accrual/by-day',basis:'accrual_date',settlementFinal:false};
}
