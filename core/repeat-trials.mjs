import {hash} from './repository.mjs';
import {ledgerTrialStatus} from './finance-reconciliation.mjs';
const moscowDay=clock=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(clock);
const days=(start,end)=>(Date.parse(end)-Date.parse(start))/86400000+1;
// Repeating a comparison creates only a plan, never a copied approval or platform operation.
export async function repeatContext(db,store,plan,input,{finance,advertising,wbTrials,clock=()=>new Date()}={}){
 if(!input.repeatSourceId)return null;
 const source=(db.trials||[]).find(t=>t.id===input.repeatSourceId),parent=(db.trialPlans||[]).find(p=>p.id===source?.planId);
 if(!source||!parent||parent.status!=='completed'||parent.trialId!==source.id||source.storeId!==store.id||source.sku!==plan.sku)throw Error('请选择此店铺商品最新的已完成计划结果');
 const latest=db.trials.findLast(t=>t.storeId===store.id&&t.sku===plan.sku);
 if(latest?.id!==source.id||source.result.verdict!=='repeat_candidate'||!(source.result.after>0))throw Error('仅最新、贡献为正且证据完整的结果可准备重复测试');
 for(const k of ['lever','baseline','variant'])if(plan[k]!==source[k])throw Error('重复测试需保留原商品与两个方案；改变假设请另建独立计划');
 if(plan.adsControl!==(parent.adsControl||null))throw Error('重复测试需保留原广告执行方式');
 if(plan.aStart<=moscowDay(clock())||plan.aStart<=source.b.end)throw Error('重复测试的基准期必须从未来完整日期开始，且不能重用原测试日期');
 for(const k of ['a','b'])if(days(plan[k+'Start'],plan[k+'End'])!==source[k].days)throw Error('重复测试需保留原来两个期间各自的天数');
 if(source.source==='wb_reports_seller_costs'){if(!wbTrials||await wbTrials.status(store,parent,source)!=='current')throw Error('WB 来源已变化，请先重新保存比较');if((plan.currency||'RUB')!==(parent.currency||'RUB'))throw Error('重复测试需保留原限额币种');}
 if(source.source==='api_accruals_seller_costs'){
  if(!finance)throw Error('请先重新核对来源财务与广告证据');
  const proof=await finance.comparisonEvidence(store,{aReportId:source.a.reportId,aCostId:source.a.reconciliationId,bReportId:source.b.reportId,bCostId:source.b.reconciliationId});
  const ads=store.id==='ozon-live'&&advertising?await advertising.comparisonEvidence(store,parent):{};
  const reports=['a','b'].map(k=>({...proof[k].report,reconciliations:[proof[k].cost]}));
  if(ledgerTrialStatus(source,reports,Object.values(ads).filter(Boolean),parent)!=='current')throw Error('来源证据已更新或缺失，请先重新保存原计划比较');
 }
 return {trialId:source.id,planId:parent.id,sourceHash:hash(source),source:source.source,delta:source.result.delta,currency:source.currency||'RUB'};
}
