import {portfolio} from './planning.mjs';
// Deterministic agent workflow. Execution is explicitly local simulation.
export function runCycle({products,policy,overrides={},storeBudget,paused=false,previous={},now=Date.now(),snapshotAt=now,maxAgeMs=3600000}){
 const stale=!Number.isFinite(snapshotAt)||now-snapshotAt>maxAgeMs||snapshotAt>now;
 const decisions=portfolio(products,policy,overrides,storeBudget,paused||stale);
 const campaigns={},receipts=[];
 for(const d of decisions){
  const p=products.find(p=>p.id===d.id);
  const uncertain=p.sales.some(s=>!s.settled);
  const state=paused||stale||uncertain||d.adBudget===0?'paused':'active';
  const budget=state==='active'?d.adBudget:0;
  const prior=previous[p.id];const changed=!prior||prior.state!==state||prior.dailyBudget!==budget;
  campaigns[p.id]={sku:p.id,state,dailyBudget:budget,mode:'simulation',updatedAt:changed?now:prior.updatedAt};
  receipts.push({sku:p.id,action:state==='active'?'activate_or_adjust':'pause',status:changed?'simulated_applied':'no_change',budget,reason:stale?'stale_data':paused?'store_freeze':uncertain?'unsettled':d.reason,externalWrite:false});
 }
 // Removed SKUs are explicitly paused in the local campaign registry.
 for(const [id,prior] of Object.entries(previous))if(!campaigns[id]){campaigns[id]={...prior,state:'paused',dailyBudget:0,updatedAt:now};receipts.push({sku:id,action:'pause',status:prior.state==='paused'?'no_change':'simulated_applied',budget:0,reason:'removed_sku',externalWrite:false});}
 return {at:now,mode:'simulation',stale,campaigns,receipts,stages:['data_validation','unit_economics','inventory_constraints','budget_allocation','risk_check','simulated_execution','audit'],totalDailyBudget:Object.values(campaigns).reduce((s,c)=>s+c.dailyBudget,0)};
}
