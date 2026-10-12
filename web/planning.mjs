import {evaluate,defaults,economics} from './engine.mjs';
import {optimizeAds} from './ad-optimizer.mjs';
const DEFAULT_AD_ASSUMPTIONS={cpa:500,maxOrders:5,incrementality:.5};
// Single source of truth for ad budget allocation: the marginal-return optimizer.
// Both the autopilot and the efficiency screen consume this plan, so what the
// jury sees on the efficiency screen is exactly what the autopilot executes.
export function evaluateRows(products,policy,overrides={}){
 return products.map(p=>({id:p.id,...evaluate(p,{...defaults,...policy,...overrides[p.id]})}));
}
export function adItems(rows,products,policy,assumptions={}){
 const horizon=Number.isFinite(policy.horizon)?policy.horizon:defaults.horizon;
 return rows.map(r=>{const p=products.find(x=>x.id===r.id);const a=assumptions[r.id]||{};
  return {id:r.id,contribution:Math.max(0,economics(p).contribution-p.storageDay*horizon),cap:Math.max(0,r.adBudget),
   cpa:a.cpa??p.cpa??DEFAULT_AD_ASSUMPTIONS.cpa,maxOrders:a.maxOrders??p.maxOrders??DEFAULT_AD_ASSUMPTIONS.maxOrders,incrementality:a.incrementality??p.incrementality??DEFAULT_AD_ASSUMPTIONS.incrementality};});
}
export function adPlan(rows,products,policy,assumptions={},storeBudget=2000){
 return optimizeAds(adItems(rows,products,policy,assumptions),Math.max(0,storeBudget));
}
export function portfolio(products,policy,overrides={},storeBudget=2000,paused=false,assumptions={}){
 const rows=evaluateRows(products,policy,overrides);
 if(paused)return rows.map(r=>({...r,requestedBudget:r.adBudget,adBudget:0,proposedPrice:products.find(p=>p.id===r.id).price,globalPaused:true}));
 const plan=adPlan(rows,products,{...defaults,...policy},assumptions,storeBudget);
 const byId=Object.fromEntries(plan.rows.map(x=>[x.id,x.spend]));
 return rows.map(r=>({...r,requestedBudget:r.adBudget,adBudget:byId[r.id]??0,globalPaused:false}));
}
export function forecast(p,horizon=30){
 let stock=p.stock,sold=0,missed=0,storage=0,firstStockout=null;const days=[];
 for(let day=1;day<=horizon;day++){
  if(p.incomingQty>0&&day===Math.max(1,Math.ceil(p.incomingDays)))stock+=p.incomingQty;
  const units=Math.min(stock,p.dailyDemand);stock-=units;sold+=units;missed+=p.dailyDemand-units;storage+=stock*p.storageDay;
  if(units<p.dailyDemand&&firstStockout===null)firstStockout=day;
  days.push({day,stock,units});
 }
 return {days,sold,missed,storage,endingStock:stock,firstStockout,reorderQty:Math.max(0,Math.ceil(p.dailyDemand*horizon-p.stock-(p.incomingDays<=horizon?p.incomingQty:0)))};
}
const positive=['price','fx'];
const numeric=['price','purchaseCny','fx','inbound','fulfilment','packaging','returnReserve','commission','stock','dailyDemand','incomingDays','incomingQty','storageDay','seasonFactor','historyDays'];
export function validateProducts(input){
 if(!Array.isArray(input)||!input.length||input.length>2000)throw Error('1–2000 products required');const seen=new Set();
 return input.map(p=>{
  if(!p||typeof p.id!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(p.id)||seen.has(p.id))throw Error('Invalid or duplicate SKU');seen.add(p.id);
  if(typeof p.name!=='string'||!p.name.trim()||p.name.length>200||!['FBO','FBS'].includes(p.scheme))throw Error('Invalid product');
  const out={id:p.id,name:p.name,scheme:p.scheme};
  for(const k of numeric){if(!Number.isFinite(p[k])||p[k]<0||p[k]>1e9||(positive.includes(k)&&p[k]===0))throw Error('Invalid '+k);out[k]=p[k];}
  if(p.commission>=1||!Number.isInteger(p.stock)||!Number.isInteger(p.incomingQty))throw Error('Invalid units or commission');
  if(!Array.isArray(p.sales)||p.sales.length>10000)throw Error('Invalid sales');
  out.sales=p.sales.map(s=>{if(!s||['revenue','cost','adCost'].some(k=>!Number.isFinite(s[k])||s[k]<0)||typeof s.settled!=='boolean')throw Error('Invalid sale');return {revenue:s.revenue,cost:s.cost,adCost:s.adCost,settled:s.settled};});
  out.unallocatedAds=p.unallocatedAds??0;if(!Number.isFinite(out.unallocatedAds)||out.unallocatedAds<0)throw Error('Invalid ads');
  // Optional advertising-response assumptions survive import/export round-trips.
  for(const k of ['cpa','maxOrders','incrementality'])if(p[k]!==undefined){if(!Number.isFinite(p[k])||p[k]<0||p[k]>1e9)throw Error('Invalid '+k);out[k]=p[k];}
  if(out.incrementality!==undefined&&out.incrementality>1)throw Error('Invalid incrementality');
  return out;
 });
}
// File replaces the selected observation window, never appends/duplicates it.
export function importSalesCSV(text,products){
 const lines=text.trim().replace(/^\uFEFF/,'').split(/\r?\n/);if(lines.shift()!=='sku,revenue_rub,total_cost_rub,allocated_ads_rub,settled,unallocated_ads_rub')throw Error('Invalid header');
 if(!lines.length||lines.length>10000)throw Error('Invalid row count');const next=structuredClone(products),seen=new Set();
 for(const line of lines){const a=line.split(',');if(a.length!==6||a.slice(1).some(x=>x.trim()===''))throw Error('Invalid row');const p=next.find(p=>p.id===a[0]);if(!p)throw Error('Unknown SKU');
  const [revenue,cost,adCost,settled,extra]=a.slice(1).map(Number);if([revenue,cost,adCost,extra].some(x=>!Number.isFinite(x)||x<0)||![0,1].includes(settled))throw Error('Invalid value');
  if(!seen.has(p.id)){p.sales=[];p.unallocatedAds=0;seen.add(p.id);}
  // A zero-valued row can represent advertising without orders.
  if(revenue||cost||adCost)p.sales.push({revenue,cost,adCost,settled:Boolean(settled)});
  p.unallocatedAds+=extra;
 }
 return validateProducts(next);
}
