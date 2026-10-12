import {compareAdvertising,advertisingProofStatus} from './advertising-proof.mjs';
import {hash,maskPII} from './repository.mjs';
const round=n=>Math.round(n*100)/100;
const text=v=>{if(typeof v!=='string'||!v.trim()||v.length>1000)throw Error('请填写报表来源与成本核对说明');return maskPII(v.trim());};
function amount(v,signed=false){
 if(!['number','string'].includes(typeof v)||!String(v).trim()||!new RegExp(signed?'^-?\\d+(\\.\\d{1,2})?$':'^\\d+(\\.\\d{1,2})?$').test(String(v)))throw Error('所有金额必填，最多两位小数；未知不能填成零');
 const n=Number(v);if(!Number.isFinite(n)||Math.abs(n)>1e12)throw Error('金额超出范围');return n;
}
export function reconciliationCurrencies(run){return [...new Set([...Object.keys(run.summary?.totals||{}),...Object.keys(run.summary?.storeUnallocated||{})])];}
export function reconcileFinance(run,input){
 if(run.state!=='complete'||!run.evidenceHash||run.loadedDays!==run.totalDays)throw Error('请先完整读取此期间的财务数据');
 if(input.reportHash!==run.evidenceHash)throw Error('财务版本已变化，请重新打开');
 if(!reconciliationCurrencies(run).includes(input.currency))throw Error('请选择报表中的实际币种；不会自动换汇');
 const costs={};for(const k of ['cogs','tax','external','sharedNet','adSpend'])costs[k]=amount(input[k],k!=='adSpend');
 const orderCount=amount(input.orderCount);if(!Number.isSafeInteger(orderCount))throw Error('已核对订单数必须是整数');
 const netAccrued=run.summary.totals[input.currency]??0;
 const contribution=round(netAccrued+costs.sharedNet-costs.cogs-costs.tax-costs.external);
 const checks={costsComplete:input.costsComplete===true,allocationReviewed:input.allocationReviewed===true,periodReviewed:input.periodReviewed===true};
 return {currency:input.currency,reportId:run.id,reportHash:run.evidenceHash,storeId:run.storeId,sku:run.sku,from:run.from,to:run.to,days:run.totalDays,netAccrued,costs,orderCount,checks,evidence:text(input.evidence),source:'api_accruals_seller_costs',basis:'accrual_date',result:{contribution,dailyContribution:round(contribution/run.totalDays),reviewed:Object.values(checks).every(Boolean),platformCostsDeductedAgain:false}};
}
export function evaluateLedgerTrial(plan,proof,input){
 const a=proof.a,b=proof.b;
 if(!a||!b||a.report.id===b.report.id||a.cost.currency!==b.cost.currency)throw Error('需要两个不同期间、同一币种的已保存核对版本');
 const periods={};for(const [key,p] of Object.entries({a,b})){
  if(p.report.state!=='complete'||p.report.storeId!==plan.storeId||p.report.sku!==plan.sku||p.report.from!==plan[key+'Start']||p.report.to!==plan[key+'End']||p.cost.reportId!==p.report.id||p.cost.reportHash!==p.report.evidenceHash)throw Error('财务证据必须对应原计划的店铺、SKU 与日期');
  periods[key]={start:p.report.from,end:p.report.to,days:p.report.totalDays,currency:p.cost.currency,netAccrued:p.cost.netAccrued,costs:structuredClone(p.cost.costs),orders:p.cost.orderCount,ads:p.cost.costs.adSpend,profit:p.cost.result.contribution,settled:p.cost.result.reviewed,reportId:p.report.id,reportHash:p.report.evidenceHash,reconciliationId:p.cost.id,reconciliationHash:hash(p.cost),reconciliationRevision:p.cost.revision,evidence:p.cost.evidence};
 }
 const currency=a.cost.currency,blockers=[];
 if(!a.cost.result.reviewed||!b.cost.result.reviewed)blockers.push('成本、公共费用分摊或跨期退货尚未核对');
 if(periods.a.orders<30||periods.b.orders<30)blockers.push('任一期间不足 30 个卖家核对订单；不是统计显著性检验');
 if(input.comparable!==true)blockers.push('库存、促销、季节与其他参数尚未核对');
 if(input.executionConfirmed!==true)blockers.push('尚未确认两个方案确实按计划执行');
 if([a,b].some(p=>Object.entries(p.report.summary.totals).some(([c,n])=>c!==currency&&n!==0)))blockers.push('SKU 还有其他币种记账，当前比较不覆盖全部结果');
 if(currency!=='RUB')blockers.push('原计划限额为 RUB，无法核对当前币种的广告与亏损上限');
 else {if(periods.b.ads>plan.adBudget)blockers.push('卖家核对的测试期广告总支出超过计划上限');if(periods.b.profit < -plan.maxLoss)blockers.push('测试期贡献亏损超过计划上限');}
 const advertising=compareAdvertising(plan,proof.advertising,periods,currency);blockers.push(...advertising.blockers);
 if(plan.cpoQuoteChanged)blockers.push('CPO 实际报价与确认版本不同，请核对实际投放条件');
 if(plan.baselineExecutedAt&&new Date(Date.parse(plan.baselineExecutedAt)+3*3600000).toISOString().slice(0,10)>=plan.aStart)blockers.push('基准期开始后才恢复方案，原基准日期不完整，请重新安排测试');
 const planDate=new Date(Date.parse(plan.at)+3*3600000).toISOString().slice(0,10);
 if(planDate>=plan.bStart)blockers.push('计划未在测试开始前保存；此结果是回顾观察');
 const before=round(periods.a.profit/periods.a.days),after=round(periods.b.profit/periods.b.days),delta=round(periods.b.profit/periods.b.days-periods.a.profit/periods.a.days);
 return {sku:plan.sku,lever:plan.lever,baseline:plan.baseline,variant:plan.variant,currency,evidence:text(input.evidence),comparable:input.comparable===true,executionConfirmed:input.executionConfirmed===true,source:'api_accruals_seller_costs',basis:'accrual_date',advertisingProof:advertising.proof,executionEvidence:executionEvidence(plan),...periods,result:{before,after,delta,blockers,verdict:blockers.length?'insufficient':delta>0?'repeat_candidate':'no_improvement',causal:false},provenance:{a:structuredClone(a),b:structuredClone(b)}};
}
export const executionEvidence=p=>({baselineExecutedAt:p?.baselineExecutedAt||null,cpoQuoteChanged:p?.cpoQuoteChanged===true});
export function ledgerTrialStatus(trial,readings,adReadings=[],plan=null){
 if(trial.source!=='api_accruals_seller_costs')return null;
 if(plan&&hash(executionEvidence(trial.executionEvidence))!==hash(executionEvidence(plan)))return 'superseded';
 for(const key of ['a','b']){
  const p=trial[key],latest=readings.findLast(r=>r.storeId===trial.storeId&&r.sku===trial.sku&&r.from===p.start&&r.to===p.end);
  if(!latest)return 'unavailable';
  const cost=latest.reconciliations?.findLast(c=>c.currency===trial.currency);
  if(latest.id!==p.reportId||latest.state!=='complete'||latest.evidenceHash!==p.reportHash||cost?.id!==p.reconciliationId||hash(cost)!==p.reconciliationHash)return 'superseded';
 }
 return advertisingProofStatus(trial,adReadings);
}
