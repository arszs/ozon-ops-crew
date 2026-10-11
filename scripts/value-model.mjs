#!/usr/bin/env node
// Reproducible business-value model for the competition jury.
// Runs the REAL decision engine (web/engine.mjs) over a seeded synthetic
// portfolio and aggregates the value the engine's decisions address.
// Every number below is MODELED from documented assumptions, not measured
// from live merchants. See docs/VALUE-MODEL.md for interpretation.
import {evaluate,defaults} from '../web/engine.mjs';
import {forecast} from '../web/planning.mjs';

// Deterministic PRNG so `node scripts/value-model.mjs` always prints the same numbers.
function mulberry32(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rnd=mulberry32(20261011);
const pick=(a,b)=>a+rnd()*(b-a);
const pickInt=(a,b)=>Math.floor(pick(a,b+1));

const SELLERS=200, SKUS_PER_SELLER=50; // 10,000 SKU portfolio — the scale target.
const POLICY=defaults;

function makeSku(sellerIdx,skuIdx){
 const fx=12.5; // RUB per CNY, fixed for reproducibility
 const purchaseCny=pick(8,120);
 const price=Math.round(purchaseCny*fx*pick(1.6,2.8));
 const dailyDemand=Math.round(pick(0.2,8)*10)/10;
 const stock=pickInt(0,Math.max(10,dailyDemand*pickInt(20,120)));
 const settled=rnd()>0.08; // ~8% of observation rows unsettled
 const lossScenario=rnd()<0.12; // ~12% of SKUs quietly burn money
 const sales=Array.from({length:POLICY.window},()=>{
  const revenue=Math.round(price*dailyDemand*pick(0.6,1.4));
  const cost=Math.round(revenue*pick(0.45,0.75));
  const adCost=lossScenario?Math.round(revenue*pick(0.8,1.3)):Math.round(revenue*pick(0.05,0.3));
  return {revenue,cost,adCost,settled};
 });
 return {
  id:`S${sellerIdx}-SKU${skuIdx}`,name:`Synth ${sellerIdx}/${skuIdx}`,scheme:rnd()>0.4?'FBO':'FBS',
  price,purchaseCny:Math.round(purchaseCny*100)/100,fx,
  inbound:pickInt(40,180),fulfilment:pickInt(60,220),packaging:pickInt(10,40),returnReserve:pickInt(15,60),
  commission:pick(0.05,0.15),stock,dailyDemand,
  incomingDays:rnd()>0.5?pickInt(5,25):0,incomingQty:rnd()>0.5?pickInt(20,200):0,
  storageDay:Math.round(pick(0.4,4)*100)/100,seasonFactor:pick(0.8,1.6),historyDays:pickInt(10,400),
  sales,unallocatedAds:rnd()<0.06?pickInt(600,3000):0,
 };
}

const t0=performance.now();
const sellers=[];
for(let s=0;s<SELLERS;s++){
 const products=Array.from({length:SKUS_PER_SELLER},(_,i)=>makeSku(s,i));
 sellers.push(products.map(p=>({p,r:evaluate(p,POLICY),f:forecast(p,POLICY.horizon)})));
}
const elapsedMs=performance.now()-t0;

const agg={sellers:SELLERS,skus:SELLERS*SKUS_PER_SELLER,elapsedMs:Math.round(elapsedMs*10)/10,
 strategies:{},protectedLossRub:0,adsBurnStoppedRub:0,storageExposureRub:0,stockoutRevenueProtectedRub:0};
for(const seller of sellers)for(const {p,r,f} of seller){
 agg.strategies[r.strategy]=(agg.strategies[r.strategy]||0)+1;
 if(r.strategy==='stop'&&r.reason==='loss')agg.protectedLossRub+=Math.max(0,-r.net)*(30/POLICY.window); // monthly extrapolation of the observed window
 if(r.strategy==='stop'&&r.reason==='ads')agg.adsBurnStoppedRub+=(p.unallocatedAds||0);
 if(r.strategy==='clear')agg.storageExposureRub+=f.storage; // 30-day storage cost the clearance decision addresses
 if(r.strategy==='protect')agg.stockoutRevenueProtectedRub+=f.missed*p.price; // revenue at risk from stockout the price-hold protects
}
// Operator time: manual per-SKU weekly review (12 min) vs console-assisted (1.5 min).
const MANUAL_MIN=12,ASSISTED_MIN=1.5;
agg.operatorHoursSavedPerMonth=Math.round(agg.skus*4.3*(MANUAL_MIN-ASSISTED_MIN)/60);
for(const k of ['protectedLossRub','adsBurnStoppedRub','storageExposureRub','stockoutRevenueProtectedRub'])agg[k]=Math.round(agg[k]);
// Normalized figures for credible communication.
agg.decisionsPerSecond=Math.round(agg.skus/(agg.elapsedMs/1000));
agg.perSellerMonth={
 protectedLossRub:Math.round(agg.protectedLossRub/SELLERS),
 adsBurnStoppedRub:Math.round(agg.adsBurnStoppedRub/SELLERS),
 storageExposureRub:Math.round(agg.storageExposureRub/SELLERS),
 stockoutRevenueProtectedRub:Math.round(agg.stockoutRevenueProtectedRub/SELLERS),
 operatorHoursSaved:Math.round(agg.operatorHoursSavedPerMonth/SELLERS*10)/10,
};
console.log(JSON.stringify(agg,null,2));
