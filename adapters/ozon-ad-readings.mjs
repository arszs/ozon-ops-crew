import {performanceRead,performanceReport,performanceAccount} from '../performance.mjs';
import {credentials} from '../ozon.mjs';
import {ozonCall} from './ozon-products.mjs';
import {catalogueProduct} from './ozon-catalogue.mjs';
import {normalizeCpcReport,normalizeCpoReport} from '../live-data.mjs';
import {hash} from '../core/repository.mjs';
export async function advertisingAccount(store){
 if(store.id!=='ozon-live'||store.mode!=='live'||store.marketplace!=='ozon')throw Error('仅支持主 Ozon 店铺的广告读取');
 const c=await credentials();if(!c.client||!c.key)throw Error('seller_not_configured');return hash({seller:c,performance:await performanceAccount()});
}
const safeError=e=>/^[a-z0-9_]{1,100}$/.test(e.message)?e.message:'advertising_read_failed';
const amount=(report,sku)=>{if(!Number.isFinite(report.unallocated)||report.unallocated<0)throw Error('advertising_allocation_mismatch');for(const v of [report.spend,...Object.values(report.bySku).map(r=>r.spend)])if(!Number.isFinite(v)||!Number.isSafeInteger(Math.round(v*100))||v<0)throw Error('advertising_negative_or_invalid_spend');return report.bySku[sku]?.spend??(report.unallocated===0?0:null);};
// Independent CPC/CPO reads. Full-assortment and other instruments remain unknown.
export async function readAdvertisingSlice(store,{sku,from,to},{read=performanceRead,report=performanceReport,seller=ozonCall,checkAccount=async()=>{},onTool=async()=>{}}={}){
 const evidence=[];
 async function tool(path,body,fn){await checkAccount();const inputHash=hash({path,body:body??null});await onTool({state:'started',path,inputHash});try{const raw=await fn();await checkAccount();const item={path,inputHash,outputHash:hash(raw),at:new Date().toISOString()};evidence.push(item);await onTool({state:'complete',...item});return raw;}catch(e){await onTool({state:'failed',path,inputHash,error:safeError(e)});throw e;}}
 const reportOptions={read:(path,body)=>tool(path,body,()=>read(path,body))};
 const productData=await tool('/v3/product/info/list',{sku:[sku]},()=>seller(store,'/v3/product/info/list',{sku:[sku]}));
 if(!Array.isArray(productData.items)||productData.items.length!==1||!catalogueProduct(productData.items[0]).some(p=>p.sku===sku))throw Error('advertising_seller_sku_mismatch');
 async function attempt(fn){try{return {ok:true,...await fn()};}catch(e){return {ok:false,spend:null,error:safeError(e),...(Number.isFinite(e.retryAt)?{retryAt:new Date(e.retryAt).toISOString()}:{})};}}
 const cpc=await attempt(async()=>{
  const list=await tool('/api/client/campaign',undefined,()=>read('/api/client/campaign'));
  if(!Array.isArray(list.list)||Number(list.total??list.list.length)!==list.list.length)throw Error('campaigns_incomplete');
  const ids=list.list.filter(c=>c.advObjectType==='SKU').map(c=>String(c.id));
  if(ids.some(id=>! /^[1-9]\d*$/.test(id))||new Set(ids).size!==ids.length)throw Error('campaigns_invalid_ids');
  let spend=0,unknown=false,unallocated=0;
  // Small batches also keep the report generation workload bounded.
  for(let i=0;i<ids.length;i+=10){const batch=ids.slice(i,i+10),body={campaigns:batch,from:from+'T00:00:00+03:00',to:to+'T23:59:59+03:00',groupBy:'NO_GROUP_BY'};
   const raw=await tool('/api/client/statistics/json',body,()=>report('/api/client/statistics/json',body,()=>{},reportOptions));
   const parsed=normalizeCpcReport(raw,batch),value=amount(parsed,sku);if(value===null)unknown=true;else spend+=value;unallocated+=parsed.unallocated;
  }
  return {spend:unknown?null:Math.round(spend*100)/100,unallocated:Math.round(unallocated*100)/100,campaignCount:ids.length};
 });
 const cpo=await attempt(async()=>{const body={from:from+'T00:00:00+03:00',to:to+'T23:59:59+03:00'},raw=await tool('/api/client/statistic/products/generate/json',body,()=>report('/api/client/statistic/products/generate/json',body,()=>{},reportOptions)),parsed=normalizeCpoReport(raw);return {spend:amount(parsed,sku),unallocated:parsed.unallocated};});
 await checkAccount();return {sku,from,to,cpc,cpo,evidence,checkedAt:new Date().toISOString()};
}
