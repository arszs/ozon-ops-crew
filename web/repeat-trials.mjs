const next=(date,n)=>new Date(Date.parse(date)+n*86400000).toISOString().slice(0,10);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function repeatCandidate(data,t){
 const parent=data.trialPlans?.find(p=>p.id===t.planId),latest=data.trials?.findLast(r=>r.storeId===t.storeId&&r.sku===t.sku);
 return Boolean(parent?.status==='completed'&&parent.trialId===t.id&&latest?.id===t.id&&t.result.verdict==='repeat_candidate'&&t.result.after>0&&(!['api_accruals_seller_costs','wb_reports_seller_costs'].includes(t.source)||t.sourceStatus==='current')&&!data.trialPlans.some(p=>p.storeId===t.storeId&&p.sku===t.sku&&p.status==='planned'));
}
export function repeatDraft(data,t,day=today()){
 if(!repeatCandidate(data,t))throw Error('请先核对最新结果或完成此商品现有计划');
 const p=data.trialPlans.find(p=>p.id===t.planId),aStart=next([day,t.b.end].sort().at(-1),1),aEnd=next(aStart,t.a.days-1),bStart=next(aEnd,1),bEnd=next(bStart,t.b.days-1);
 return {repeatSourceId:t.id,storeId:t.storeId,sku:t.sku,lever:t.lever,adsControl:p.adsControl||'',baseline:t.baseline,variant:t.variant,hypothesis:p.hypothesis,controls:p.controls,aStart,aEnd,bStart,bEnd,adBudget:p.adBudget,maxLoss:p.maxLoss,currency:p.currency||'RUB',costProfileId:'',minMarginPct:p.economics?.minMarginPct??15,acknowledged:false};
}
export function bindRepeatTrials({data,reveal}){
 const f=document.querySelector('#trial-plan-form');if(!f)return;
 const notice=document.querySelector('#repeat-plan-notice');
 const sync=()=>{const id=f.elements.repeatSourceId.value;notice.hidden=!id;if(!id)return;const t=data.trials.find(t=>t.id===id);notice.querySelector('p').textContent=t?'重复测试：'+t.sku+' · '+t.baseline+' → '+t.variant+'。新日期只是建议，请核对库存与促销。基准期前需核对并恢复基准方案；CPO 可准备单独确认的基准操作，价格仍需人工恢复。'+(t.lever==='price'?'请重新选择最新成本版本，基准价格必须与原方案一致。':''):'来源结果不在当前列表，请重新核对后再保存。';};
 f.addEventListener('draft-restored',sync);sync();
 document.querySelectorAll('[data-repeat-trial]').forEach(b=>b.onclick=()=>{
  const t=data.trials.find(t=>t.id===b.dataset.repeatTrial),draft=repeatDraft(data,t);f.reset();
  for(const [key,value] of Object.entries(draft)){const el=f.elements[key];if(el.type==='checkbox')el.checked=value;else el.value=value;}
  f.elements.adsControl.dispatchEvent(new Event('change'));
  sync();
  reveal('trial-plan-form');
 });
 document.querySelector('#clear-repeat-plan').onclick=()=>{f.reset();f.elements.repeatSourceId.value='';f.elements.adsControl.dispatchEvent(new Event('change'));notice.hidden=true;};
}
