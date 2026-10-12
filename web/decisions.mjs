import {experimentProgress} from './experiment-progress.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sellerDecisions(data,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 const plans=data.trialPlans||[],trials=data.trials||[],items=[];
 // One latest recorded observation per store/SKU; never add overlapping periods together.
 const latest=new Map();for(const t of trials){const key=JSON.stringify([t.storeId,t.sku]);const old=latest.get(key);if(!old||t.at>=old.at)latest.set(key,t);}
 for(const p of plans.filter(p=>p.status==='planned')){const step=experimentProgress(data,p,today);items.push({...step,storeId:p.storeId,sku:p.sku,mode:p.mode});}
 for(const t of latest.values()){
  const outdated=t.source==='api_accruals_seller_costs'&&t.sourceStatus!=='current',incomplete=outdated||t.result.verdict==='insufficient',loss=t.result.after<0;
  const kind=incomplete?'evidence':loss?'loss':t.result.verdict==='repeat_candidate'?'repeat':'review';
  if(kind==='repeat'&&plans.some(p=>p.storeId===t.storeId&&p.sku===t.sku&&p.status==='planned'))continue;
  items.push({target:outdated&&t.planId?"plan-"+t.planId:"trial-"+t.id,focus:outdated&&t.planId?"finance-"+t.planId:null,storeId:t.storeId,sku:t.sku,mode:t.mode,source:t.source,kind,priority:incomplete||loss?0:kind==='repeat'?3:2,title:({evidence:'补齐证据，再作决定',loss:'观察期仍亏损，先检查成本',repeat:'正向观察，值得重复验证',review:'未观察到改善，请调整假设'})[kind],detail:outdated?'财务、成本或广告证据未核对 / 已更新 / 暂不可用，请重新核对原计划结果。':incomplete?t.result.blockers.join('；'):loss?'利润即使有所改善，也不等于已盈利；不建议据此扩大投入。':t.source==='api_accruals_seller_costs'?'API 记账 + 卖家核对成本；按记账日期比较，不证明因果关系。':'人工观察；不证明因果关系，也不代表系统已改变投放。'});
 }
 return items.sort((a,b)=>a.priority-b.priority);
}
export function decisionPanel(data,{limit=8}={}){const all=sellerDecisions(data),real=all.filter(x=>x.mode!=='mock'),demo=all.filter(x=>x.mode==='mock');const rows=items=>items.slice(0,limit).map(x=>`<article class="decision-row"><div><span class="badge ${x.mode==='mock'?'mock':''}">${x.mode==='mock'?'DEMO':x.source==='api_accruals_seller_costs'?'API 记账 + 卖家成本':'人工计划 / 观察'}</span><h3>${esc(x.title)}</h3><p>${esc(data.stores.find(s=>s.id===x.storeId)?.name||x.storeId)} · ${esc(x.sku)}</p><small>${esc(x.detail)}</small></div><button class="quiet" data-nav="${x.page||'trials'}" data-record="${esc(x.target)}" data-record-focus="${esc(x.focus||'')}">${x.page==='gates'?'核对操作':'查看实验'} →</button></article>`).join('');return `<section class="card"><div class="section-head"><h2>今天需要决定什么？</h2><button class="quiet" data-nav="trials">全部实验 →</button></div><p class="muted">仅汇总已加载的计划和每个商品最新记录。未执行计划不算运行中的广告；不累加重复观察的利润。</p>${real.length?rows(real):'<p>真实店铺暂无实验决策。先从一个商品建立价格或广告计划。</p>'}${real.length>limit?`<p class="muted">显示前 ${limit} 项；其余请查看全部实验。</p>`:''}${demo.length?`<details><summary>演示决策（${demo.length}）· 不计入真实店铺</summary>${rows(demo)}</details>`:''}</section>`;}
