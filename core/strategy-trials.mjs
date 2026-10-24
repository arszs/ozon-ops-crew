import {verifyAudit,hash} from './repository.mjs';
import {ledgerTrialStatus} from './finance-reconciliation.mjs';
export function completedStrategyPriceTrials(db,policy,{finance=[],advertising=[],status=ledgerTrialStatus}={}){
 if(!verifyAudit(db.audit||[]))return [];const rows=[];
 for(const trial of db.trials||[]){
  if(trial.source!=='api_accruals_seller_costs'||trial.mode!=='live'||trial.storeId!==policy.storeId||trial.sku!==policy.sku||trial.currency!==policy.currency||trial.lever!=='price'||trial.comparable!==true||trial.executionConfirmed!==true||!Array.isArray(trial.result?.blockers)||trial.result.blockers.length)continue;
  if(!db.audit.some(a=>a.kind==='profit.ledger.compared'&&a.trialId===trial.id&&a.evidenceHash===hash(trial)))continue;
  const plan=db.trialPlans?.find(p=>p.id===trial.planId);if(!plan||plan.status!=='completed'||plan.trialId!==trial.id||plan.sku!==trial.sku||plan.storeId!==trial.storeId||status(trial,finance,advertising,plan)!=='current')continue;
  const baseline=Number(trial.baseline),variant=Number(trial.variant);if(!Number.isFinite(baseline)||!Number.isFinite(variant)||baseline<=0||variant<=0||baseline===variant)continue;
  const operation=db.operations?.find(o=>o.kind==='price'&&o.storeId===policy.storeId&&o.payload?.planId===plan.id&&o.payload.sku===policy.sku&&o.payload.currency===policy.currency&&o.payload.context?.accountRef===policy.accountRef&&(!policy.productId||o.payload.context.productId===policy.productId)&&o.payload.before===baseline&&o.payload.target===variant&&o.state==='verified'&&o.receipt?.status==='accepted'&&o.priceObservation?.matches===true&&o.priceObservation?.originProven===true);if(!operation)continue;
  const periods=[['a',baseline],['b',variant]];if(periods.some(([key])=>{const p=trial[key];return !p||p.currency!==policy.currency||p.settled!==true||!Number.isInteger(p.orders)||p.orders<30||!Number.isFinite(p.profit)||!Number.isInteger(p.days)||p.days<7||!/^\d{4}-\d{2}-\d{2}$/.test(p.end)||!p.reportId||!p.reconciliationId;}))continue;
  for(const [key,price] of periods){const p=trial[key];rows.push({storeId:policy.storeId,sku:policy.sku,currency:policy.currency,verified:true,price,settledOrders:p.orders,profitPerDay:p.profit/p.days,completedAt:p.end+'T21:00:00Z',trialId:trial.id,reportId:p.reportId,reconciliationId:p.reconciliationId,source:'api_accruals_seller_costs',causal:false});}
 }
 return rows;
}
