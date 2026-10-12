// Pure deterministic decision layer. All money is normalized to RUB.
export function economics(p, price=p.price) {
 const cost=p.unitCost+p.fulfilment+p.packaging+p.returnReserve;
 return {cost, contribution:price*(1-p.commission)-cost, breakEven:cost/(1-p.commission)};
}
export function evaluate(p, policy) {
 const e=economics(p); const sample=p.sales.slice(-policy.window);
 // Each sales record carries an allocated advertising cost for its observation window.
 const net=sample.reduce((s,x)=>s+x.revenue-x.cost-x.adCost,0)-(p.unallocatedAds||0);
 const reliable=sample.length>=policy.minSales && sample.every(x=>x.settled);
 const stockDays=p.dailyDemand>0?p.stock/p.dailyDemand:Infinity;
 const holdCost=p.storageDay*policy.horizon+p.price*policy.capitalRate*policy.horizon/365;
 const future=economics(p,p.price*p.seasonFactor).contribution-holdCost;
 const evidence=p.historyDays>=90?'medium':'low';
 let strategy='test', reason='cold', delta=0, ad=0;
 if((p.unallocatedAds||0)>policy.lossLimit){strategy='stop';reason='ads';}
 else if(reliable && net < -policy.lossLimit){strategy='stop';reason='loss';}
 else if(!sample.every(x=>x.settled)){strategy='observe';reason='unsettled';}
 else if(p.stock<=0){strategy='stop';reason='empty';}
 else if(e.contribution<=0){strategy='stop';reason='unit';}
 else if(stockDays<(p.incomingQty>0?p.incomingDays+policy.bufferDays:policy.horizon)){strategy='protect';reason='shortage';delta=policy.maxPriceChange;}
 else if(future>e.contribution && p.historyDays>=90){strategy='hold';reason='season';delta=policy.maxPriceChange/2;}
 else if(stockDays>policy.horizon*2 && future<=e.contribution){strategy='clear';reason='storage';delta=-policy.maxPriceChange;ad=policy.dailyBudget;}
 else {ad=policy.dailyBudget*(evidence==='low'?0.2:0.6);}
 if(evidence==='low')ad=Math.min(ad,policy.dailyBudget*0.2);
 const floor=(e.cost+policy.minUnitProfit)/(1-p.commission);
 const price=Math.max(floor,p.price*(1+delta/100));
 // Never silently exceed the configured price step to reach the profit floor.
 const rounded=Math.ceil(price*100-1e-7)/100;
 const feasible=Math.abs(rounded/p.price-1)*100<=policy.maxPriceChange+1e-7;
 return {strategy,reason,net,sample:sample.length,reliable,evidence,stockDays,holdCost,future,...e,
 proposedPrice:strategy==='stop'||strategy==='observe'||!feasible?p.price:rounded,
 adBudget:strategy==='stop'||strategy==='observe'||!feasible?0:Math.round(ad),
 blocked:!feasible, delta, floor};
}
export const defaults={window:5,minSales:3,lossLimit:500,dailyBudget:1000,maxPriceChange:5,minUnitProfit:100,horizon:30,bufferDays:7,capitalRate:0.18};
export function validatePolicy(p){
 for(const [k,v] of Object.entries(defaults)) if(!Number.isFinite(p[k])||p[k]<0)throw Error('Invalid '+k);
 if(!Number.isInteger(p.window)||p.window<1||p.window>100||!Number.isInteger(p.minSales)||p.minSales<1||p.minSales>p.window)throw Error('Invalid sales window');
 if(p.maxPriceChange>30||p.horizon<1||p.horizon>365||!Number.isInteger(p.horizon)||p.capitalRate>1)throw Error('Invalid limits');
 return p;
}
