// Scenario response curve; not a learned or causal estimate.
// Marginal return declines with spend. Budget is a ceiling, never a target.
export function optimizeAds(items,budget,{steps=1000,minReturn=1.2}={}){
 if(!Number.isFinite(budget)||budget<0||!Number.isFinite(minReturn)||minReturn<1)throw Error('Invalid budget or return');
 const valid=items.map(p=>({...p,spend:0}));
 const response=(p,b)=>p.contribution*p.incrementality*p.maxOrders*(-Math.expm1(-b/(p.cpa*p.maxOrders)));
 const eligible=p=>[p.contribution,p.cpa,p.maxOrders,p.cap,p.incrementality].every(Number.isFinite)&&p.contribution>0&&p.cpa>0&&p.maxOrders>0&&p.cap>0&&p.incrementality>0&&p.incrementality<=1;
 const quantum=Math.max(.01,budget/Math.max(1,Math.min(2000,steps)));let left=budget;
 for(let i=0;i<Math.min(2000,steps)+items.length&&left>=.01;i++){
  let best=null;
  for(const p of valid){if(!eligible(p))continue;const amount=Math.floor(Math.min(quantum,left,p.cap-p.spend)*100)/100;if(amount<.01)continue;
   const gain=response(p,p.spend+amount)-response(p,p.spend),ratio=gain/amount;
   if(ratio>=minReturn&&(!best||ratio>best.ratio))best={p,amount,ratio};
  }
  if(!best)break;best.p.spend+=best.amount;left-=best.amount;
 }
 const rows=valid.map(p=>{const contribution=eligible(p)?response(p,p.spend):0;return {id:p.id,spend:Math.round(p.spend*100)/100,incrementalContribution:contribution,incrementalProfit:contribution-p.spend,profitPerRub:p.spend?(contribution-p.spend)/p.spend:null,eligible:eligible(p)};});
 return {rows,spent:rows.reduce((s,p)=>s+p.spend,0),unused:Math.max(0,budget-rows.reduce((s,p)=>s+p.spend,0)),profit:rows.reduce((s,p)=>s+p.incrementalProfit,0)};
}
// Naive baseline for equal-conditions comparison: split the budget evenly
// across eligible SKUs (water-filling around caps), ignoring marginal return.
export function uniformAds(items,budget){
 const valid=items.map(p=>({...p,spend:0}));
 const eligible=p=>[p.contribution,p.cpa,p.maxOrders,p.cap,p.incrementality].every(Number.isFinite)&&p.contribution>0&&p.cpa>0&&p.maxOrders>0&&p.cap>0&&p.incrementality>0&&p.incrementality<=1;
 const response=(p,b)=>p.contribution*p.incrementality*p.maxOrders*(-Math.expm1(-b/(p.cpa*p.maxOrders)));
 let left=Math.max(0,budget);
 for(let round=0;round<10000&&left>=0.01;round++){
  const open=valid.filter(p=>eligible(p)&&p.spend<p.cap-1e-9);
  if(!open.length)break;
  const share=left/open.length;let used=0;
  for(const p of open){const add=Math.min(share,p.cap-p.spend);p.spend+=add;used+=add;}
  left-=used;if(used<1e-9)break;
 }
 const rows=valid.map(p=>{const contribution=eligible(p)?response(p,p.spend):0;return {id:p.id,spend:Math.round(p.spend*100)/100,incrementalContribution:contribution,incrementalProfit:contribution-p.spend,profitPerRub:p.spend?(contribution-p.spend)/p.spend:null,eligible:eligible(p)};});
 return {rows,spent:rows.reduce((s,p)=>s+p.spend,0),unused:Math.max(0,budget-rows.reduce((s,p)=>s+p.spend,0)),profit:rows.reduce((s,p)=>s+p.incrementalProfit,0)};
}
