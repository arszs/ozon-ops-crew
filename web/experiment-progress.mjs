const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const experimentToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const latestReport=(data,p,k)=>(data.financeReadings||[]).findLast(r=>r.storeId===p.storeId&&r.sku===p.sku&&r.from===p[k+'Start']&&r.to===p[k+'End']);
const reviewedCurrencies=r=>r?.state!=='complete'||!r.evidenceHash?[]:[...new Set((r?.reconciliations||[]).map(c=>c.currency))].filter(currency=>{const c=r.reconciliations.findLast(x=>x.currency===currency);return c.reportId===r.id&&c.reportHash===r.evidenceHash&&c.result?.reviewed===true;});
// A navigation guide over saved evidence; never executes or certifies a strategy.
export function experimentProgress(data,p,today=experimentToday()){
 const operation=(data.operations||[]).findLast(o=>['price','cpo_disable'].includes(o.kind)&&o.storeId===p.storeId&&o.payload?.planId===p.id);
 const a=latestReport(data,p,'a'),b=latestReport(data,p,'b'),store=(data.stores||[]).find(s=>s.id===p.storeId);
 const api=store?.marketplace==='ozon'&&store.mode==='live';
 const observed=operation?operation.state==='verified'&&(operation.kind==='price'?operation.priceObservation?.matches:operation.cpoObservation?.matches):['price_observed','cpo_off_observed'].includes(p.execution);
 const status=r=>r?.state==='complete'?reviewedCurrencies(r).length?'成本已核对':'待核对成本':['queued','running'].includes(r?.state)?'读取中':r?'读取未完成':'尚未读取';
 const platform=operation&&['pending','approved'].includes(operation.state)?'待确认 / 执行':operation&&['executing','submitted','unknown'].includes(operation.state)?'待核对平台':observed?'曾观察到目标状态':'执行未核实';
 const stages=[{name:'基准期',status:api?status(a):'人工核对'},{name:'平台执行',status:platform},{name:'测试期',status:p.bEnd>=today?'尚未结束':api?status(b):'人工核对'}];
 const base={stages,operation,target:'plan-'+p.id,page:'trials',focus:'execution-'+p.id,priority:4};
 const step=(kind,title,detail,extra={})=>({...base,kind,title,detail,...extra});
 if(p.status==='cancelled')return step('cancelled','计划已取消','取消计划不会恢复平台价格或广告。');
 if(p.status==='completed')return step('completed','查看已保存的比较结果','来源更新后需重新核对；正向差额仍需重复验证。',{focus:'finance-'+p.id});
 if(operation&&['executing','submitted','unknown'].includes(operation.state))return step(operation.kind==='price'?'price_check':'cpo_check','先核对平台操作结果','提交或未知状态不代表生效；不要重复提交。',{target:'operation-'+operation.id,page:'gates',focus:null,priority:0});
 if(operation&&['pending','approved'].includes(operation.state)){
  const expired=Date.parse(operation.payload?.context?.checkedAt)+900000<Date.now();
  if(expired||today>p.bEnd)return step('prepare_again','原确认已过期，请重新核对计划','过期确认不能执行；测试期结束后请核实是否实际执行。',{priority:1});
  return step(operation.kind==='price'?'price_check':'cpo_check',operation.state==='pending'?'核对并确认此版本':'确认完成，等待手动执行',today<p.bStart?'测试期尚未开始；只能在计划测试期内执行。':'到确认队列核对具体变更；系统不会自动执行。',{target:'operation-'+operation.id,page:'gates',focus:null,priority:1});
 }
 if(api){
  // Baseline and test evidence are independent: never sum unrelated periods or use old cost revisions.
  for(const [key,r] of [['a',a],['b',b]]){
   if(key==='b'&&p.bEnd>=today)break;
   if(p[key+'End']>=today)continue;
   const label=key==='a'?'基准期':'测试期',focus='finance-'+p.id+'-'+key;
   if(['queued','running'].includes(r?.state))return step('finance_wait',label+'财务读取中','已完成日期会保存；读取结束后再核对成本。',{focus,priority:3});
   if(r?.state!=='complete')return step('finance_read',(r?'继续读取':'读取')+label+'实际记账','按原计划店铺、SKU 和日期读取，缺失金额不等于零。',{focus,priority:p.bEnd<today?1:3});
   if(!reviewedCurrencies(r).length)return step('cost_review','核对'+label+'商品成本与费用','补齐商品成本、外部费用、公共分摊和跨期退货；API 记账本身不是利润。',{focus:(r.summary&&Object.keys(r.summary.totals||{}).length)?'costs-'+r.id+'-'+p.id+'-'+key:focus,priority:1});
  }
 }
 if(today<p.bStart)return step('scheduled','等待测试期开始','先保持基准方案；计划中的广告与价格不会自动生效。');
 if(p.bEnd>=today)return step(observed?'observe':'planned',observed?'观察测试期，人工检查限额':'核实并执行测试方案',observed?'平台仅曾观察到目标状态；检查库存、其他广告、延迟费用、预算和亏损，期末核对贡献。':'保存计划不代表执行。请记录实际开始时间及库存、促销变化。',{priority:observed?3:2});
 if(api){
  const common=reviewedCurrencies(a).filter(c=>reviewedCurrencies(b).includes(c));
  if(!common.length)return step('currency_review','统一两个期间的核对币种','请核对同一币种的最新成本版本；不自动换汇。',{focus:'finance-'+p.id,priority:1});
  return step('compare','核对执行条件，保存贡献比较','两期报表与成本已准备好；仍需确认实际执行及库存、促销等可比条件。',{focus:'comparison-'+p.id,priority:1});
 }
 return step('due','计划日期已结束，请核对结果','日期已过不代表测试实际执行。若未执行，请取消原计划。',{priority:1});
}
export function progressCard(data,p){const s=experimentProgress(data,p);return `<div class="experiment-progress"><ol>${s.stages.map(x=>`<li><small>${esc(x.name)}</small><b>${esc(x.status)}</b></li>`).join('')}</ol><div class="experiment-next"><div><strong>下一步：${esc(s.title)}</strong><p>${esc(s.detail)}</p></div>${s.page==='gates'?`<button class="primary" data-nav="gates" data-record="${esc(s.target)}">核对具体操作 →</button>`:`<button class="quiet" data-step-target="${esc(s.focus)}">打开这一步 →</button>`}</div></div>`;}
// Works for cards, nested financial forms and exact operation gates without submitting anything.
export function revealExperimentTarget(id,root=document){const node=root.getElementById(id);if(!node)return false;for(let p=node;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;if(node.tagName==='DETAILS')node.open=true;node.scrollIntoView({behavior:'smooth',block:'start'});return true;}
