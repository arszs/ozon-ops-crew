const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('zh-CN',{style:'currency',currency:'RUB'}).format(v):'未知';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function planAdvertising(data,p,key){return (data.adReadings||[]).findLast(r=>r.storeId===p.storeId&&r.sku===p.sku&&r.from===p[key+'Start']&&r.to<=p[key+'End']);}
export function adBudgetSignal(data,p){
 const latest=planAdvertising(data,p,'b'),readings=(data.adReadings||[]).filter(r=>r.storeId===p.storeId&&r.sku===p.sku&&r.from===p.bStart&&r.to<=p.bEnd&&['complete','partial'].includes(r.state)&&Number.isFinite(r.summary?.observedSpend));
 let r=readings.at(-1);if(!r)return null;
 // A missing instrument in a newer read cannot clear an earlier observed overrun.
 if(r.summary.observedSpend<=p.adBudget){const over=readings.findLast(x=>x.summary.observedSpend>p.adBudget);if(over&&(r.state!=='complete'||r.to<over.to))r=over;}
 return {over:r.summary.observedSpend>p.adBudget,spend:r.summary.observedSpend,to:r.to,at:r.updatedAt,runId:r.id,stale:r.id!==latest?.id};
}
export function monitorControl(data,p){
 const m=data.adMonitors?.find(m=>m.planId===p.id),states={scheduled:'等待每日检查',running:'正在检查',complete:'最近检查已读取 CPC / 指定 CPO',partial:'最近检查存在缺失报告',error:'最近检查失败，下个检查日重试',interrupted:'上次检查中断，可手动继续读取',disabled:'每日检查已关闭',ended:'计划检查已结束',connection_changed:'连接已变化，请核对后重新开启',unavailable:'最近检查结果暂不可用'};
 const within=p.status==='planned'&&today()<=new Date(Date.parse(p.bEnd)+7*86400000).toISOString().slice(0,10);
 const date=s=>new Date(s).toLocaleString('zh-CN',{timeZone:'Europe/Moscow',hour12:false});
 return `<div class="daily-monitor"><h4>每日广告预算检查</h4><p>每天 09:00（莫斯科）读取测试期已完成日期，最晚检查到测试结束后第7天。只读取并更新提醒，不自动停止广告。需要本地服务运行；中断后可手动续读。</p><p><b>${esc(states[m?.lastState]||'尚未开启每日检查')}</b>${m?.enabled&&m.nextCheckAt?' · 下次 '+esc(date(m.nextCheckAt)):''}</p>${m?.lastAttemptAt?`<small>最近尝试 ${esc(date(m.lastAttemptAt))}（莫斯科）</small>`:''}${data.adMonitorWorker?.error?'<p class="warning">检查服务暂不可用，请手动读取。</p>':''}<div class="actions"><button type="button" class="quiet" data-monitor-plan="${esc(p.id)}" data-monitor-enabled="${!m?.enabled}" ${!m?.enabled&&!within?'disabled':''}>${m?.enabled?'关闭每日检查':within?'开启每日检查（只读）':'检查窗口已结束'}</button></div></div>`;
}

export function planAds(data,p){
 if(p.storeId!=='ozon-live'||p.mode!=='live')return '';
 const signal=adBudgetSignal(data,p),day=today();
 return `<details class="plan-ads" id="ads-${esc(p.id)}"><summary>按实验日期核对广告支出${signal?.over?' · 已读取支出超过上限':''}</summary>${monitorControl(data,p)}<p>按完整莫斯科自然日读取 CPC 与指定商品 CPO。进行中的测试只读到昨天；今天支出、延迟归因、全商品推广及其他广告仍需核对。不会自动停止广告或从利润再次扣费。</p>${signal?.over?`<p class="warning">${signal.stale?'上次读取超限；最新读取尚不完整。':''}截至 ${esc(signal.to)} 已读取 ${money(signal.spend)}，超过测试期上限 ${money(p.adBudget)}。请核对投放与支出；后续更正可能改变金额。</p>`:''}<div class="diff-grid">${['a','b'].map((key,i)=>{
  const r=planAdvertising(data,p,key),active=['queued','running'].includes(r?.state),waiting=Date.parse(r?.retryAt)>Date.now();
  const label=i?'测试期':'基准期';
  return `<div><h4>${label}</h4><button type="button" class="quiet" data-ad-plan="${esc(p.id)}" data-ad-period="${key}" data-ad-refresh="${['complete','partial'].includes(r?.state)}" ${active||waiting||p[key+'Start']>=day?'disabled':''}>${active?'后台读取中…':waiting?'等待 API 限流解除':p[key+'Start']>=day?'完整日期结束后可读取':r?'更新 / 继续读取'+label+'广告':'读取'+label+'广告'}</button>${r?`<p>${esc(r.from)} — ${esc(r.to)} · ${esc(({queued:'排队中',running:'读取中',complete:'CPC / 指定 CPO 分段已读取',partial:'存在缺失报告',error:'读取失败',interrupted:'读取中断'})[r.state]||r.state)}</p><p>CPC ${money(r.summary?.cpc?.spend)}（${r.summary?.cpc?.coveredDays??0}/${r.days} 天）<br>指定商品 CPO ${money(r.summary?.cpo?.spend)}（${r.summary?.cpo?.coveredDays??0}/${r.days} 天）</p><p><b>已读取合计 ${money(r.summary?.observedSpend)}</b> · 全部广告总额仍未知</p>${r.error?'<p class="warning">本次未完整读取；保留的数据不能当作完整支出。</p>':''}${waiting?`<p>可重试时间：${esc(r.retryAt)}</p>`:''}<small>读取于 ${esc(r.updatedAt)}；低于上限不代表预算安全。</small><details><summary>来源与覆盖证据</summary>${(r.slices||[]).map(s=>`<p>${esc(s.from)} — ${esc(s.to)}：CPC ${s.cpc.ok?'已读取':'不可用'} · CPO ${s.cpo.ok?'已读取':'不可用'}${[s.cpc,s.cpo].some(v=>v.ok&&v.spend===null)?' · SKU 费用存在未归属金额':''}</p>`).join('')}<code>${esc(r.evidenceHash||'尚无完整分段')}</code><p>广告账户当前返回的商品活动，包含非运行状态；已删除或未返回的历史活动不能保证覆盖。CPO 报告中的 CPC 列不重复计入。</p></details>`:'<p class="muted">尚无此计划期间的广告读取。</p>'}</div>`;
 }).join('')}</div></details>`;
}
export function bindExperimentAds({api,action}){document.querySelectorAll('[data-monitor-plan]').forEach(b=>b.onclick=()=>action(()=>api('/trial-plans/'+encodeURIComponent(b.dataset.monitorPlan)+'/ad-monitor',{enabled:b.dataset.monitorEnabled==='true'}),b.dataset.monitorEnabled==='true'?'每日只读检查已开启；不会改变广告':'每日检查已关闭；已有报表保留')); document.querySelectorAll('[data-ad-plan]').forEach(b=>b.onclick=()=>action(()=>api('/trial-plans/'+encodeURIComponent(b.dataset.adPlan)+'/ad-read',{period:b.dataset.adPeriod,refresh:b.dataset.adRefresh==='true'}),'广告报表已排队；只读取，不改变投放'));}
