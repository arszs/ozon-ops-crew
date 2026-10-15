// Deterministic stress portfolio generator for scale demonstrations.
// Produces a validated 500-SKU synthetic store so judges can feel the
// console at scale; the same generator shape backs scripts/value-model.mjs.
function mulberry32(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
export function stressPortfolio(n=500,seed=20261011){
 const rnd=mulberry32(seed);const pick=(a,b)=>a+rnd()*(b-a);const pickInt=(a,b)=>Math.floor(pick(a,b+1));
 const out=[];
 for(let i=0;i<n;i++){
  const unitCost=Math.round(pick(100,1500)*100)/100,price=Math.round(unitCost*pick(1.6,2.8));
  const dailyDemand=Math.round(pick(0.2,8)*10)/10,settled=rnd()>0.08,lossy=rnd()<0.12;
  const sales=Array.from({length:5},()=>{
   const revenue=Math.round(price*dailyDemand*pick(0.6,1.4));
   return {revenue,cost:Math.round(revenue*pick(0.45,0.75)),adCost:lossy?Math.round(revenue*pick(0.8,1.3)):Math.round(revenue*pick(0.05,0.3)),settled};
  });
  out.push({id:`STRESS-${String(i+1).padStart(4,'0')}`,name:`Stress SKU ${i+1}`,scheme:rnd()>0.4?'FBO':'FBS',
   price,unitCost,fulfilment:pickInt(60,220),packaging:pickInt(10,40),returnReserve:pickInt(15,60),
   commission:Math.round(pick(0.05,0.15)*1000)/1000,stock:pickInt(0,Math.max(10,Math.round(dailyDemand*pickInt(20,120)))),
   dailyDemand,incomingDays:rnd()>0.5?pickInt(5,25):0,incomingQty:rnd()>0.5?pickInt(20,200):0,
   storageDay:Math.round(pick(0.4,4)*100)/100,seasonFactor:Math.round(pick(0.8,1.6)*100)/100,historyDays:pickInt(10,400),
   sales,unallocatedAds:rnd()<0.06?pickInt(600,3000):0});
 }
 return out;
}
