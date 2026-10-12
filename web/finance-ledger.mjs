import {financeCostsForm,ledgerComparisonForm} from './finance-costs.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,c)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:c}).format(n);
const amounts=v=>Object.entries(v||{}).map(([c,n])=>esc(money(n,c))).join(' / ')||'无已读取金额';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const active=r=>['queued','running'].includes(r?.state);
const names={sales:'销售净记账（含冲减）',commission:'最终销售佣金',delivery:'配送净记账'};
const typeNames={Acquiring:'收单 / 支付处理费',StarsMembership:'“星级商品”服务'};
function componentName(k,r){const t=r.feeTypes?.items?.[k.replace('fee:','')];return names[k]||typeNames[t?.code]||t?.description||'商品费用 · 类型 '+k.replace('fee:','');}
export function financeReading(data,storeId,sku,from,to){return (data.financeReadings||[]).findLast(r=>r.storeId===storeId&&r.sku===sku&&r.from===from&&r.to===to);}
function readButton(data,storeId,sku,from,to,label){
 const r=financeReading(data,storeId,sku,from,to),future=!to||to>=today();
 return `<button type="button" class="quiet" data-finance-store="${esc(storeId)}" data-finance-sku="${esc(sku)}" data-finance-from="${esc(from)}" data-finance-to="${esc(to)}" data-finance-refresh="${r?.state==='complete'}" ${future||active(r)?'disabled':''}>${future?'期间结束后可读取':active(r)?'财务读取中…':r?.state==='complete'?'重新读取 '+esc(label):r?'继续读取 '+esc(label):'读取 '+esc(label)}</button>`;
}
export function financeResult(r,context='sku'){
 if(!r)return '<p class="muted">尚未读取此期间的实际记账。</p>';
 return `<div class="finance-result"><p>${esc(r.from)} — ${esc(r.to)} · ${r.loadedDays} / ${r.totalDays} 天 · ${esc(({queued:'排队中',running:'读取中',complete:'完整期间已读取',error:'读取失败',interrupted:'等待继续'})[r.state]||r.state)}</p>${r.error?`<p class="warning">${esc(r.error)}</p><button type="button" class="quiet" data-finance-store="${esc(r.storeId)}" data-finance-sku="${esc(r.sku)}" data-finance-from="${esc(r.from)}" data-finance-to="${esc(r.to)}" data-finance-refresh="true">从头读取新版本</button>`:''}${r.summary?`<p><b>SKU 平台净记账 ${amounts(r.summary.totals)}</b>${r.state==='complete'?` · 日均 ${amounts(r.summary.dailyAverage)}`:' · 部分日期，不能比较结果'}</p><div class="table-wrap"><table><thead><tr><th>构成</th><th>金额（保留 API 正负号）</th></tr></thead><tbody>${Object.entries(r.summary.components).map(([k,v])=>`<tr><td>${esc(componentName(k,r))}</td><td>${amounts(v)}</td></tr>`).join('')||'<tr><td colspan="2">此 SKU 没有已读取的直接记账；不代表没有订单。</td></tr>'}</tbody></table></div><p class="muted">同期全店未归属 SKU 的净记账：${amounts(r.summary.storeUnallocated)}。这是全店差额，不是此商品成本，不自动分摊。</p>`:''}<details><summary>API 读取证据</summary>${r.typeError?'<p class="warning">费用名称字典未读取；金额仍按原始类型 ID 展示。</p>':''}${r.feeTypes?`<p>费用字典读取于 ${esc(r.feeTypes.at)} · <code>${esc(r.feeTypes.hash.slice(0,16))}…</code></p>`:''}<p>按记账日期读取；不按下单日期归属。后续退货、更正与补记可能改变结果。未扣商品成本、税费及外部费用；不再次扣除 Performance 广告报表。</p><p>读取于 ${esc(r.updatedAt)} · ${r.summary?.matchedAccruals??0} 条商品相关记账</p>${r.evidenceHash?`<code class="hash">${esc(r.evidenceHash)}</code>`:''}${(r.dayEvidence||[]).map(d=>`<p>${esc(d.date)} · ${d.pages} 页 · <code>${esc(d.evidenceHash.slice(0,16))}…</code></p>`).join('')}</details>${financeCostsForm(r,null,context)}</div>`;
}
export function financePanel(data,store,sku,period){
 if(store.mode!=='live'||store.marketplace!=='ozon')return '';
 const latest=(data.financeReadings||[]).findLast(r=>r.storeId===store.id&&r.sku===sku);
 const from=latest?.from||period?.from||'',to=latest?.to||period?.to||'';
 return `<section class="card"><h3>这个商品，平台实际记了哪些账？</h3><p>读取指定期间的销售、佣金、配送与其他商品费用。净记账不是最终利润。</p><form id="sku-finance-form" data-store="${esc(store.id)}" data-sku="${esc(sku)}" data-last-from="${esc(latest?.from)}" data-last-to="${esc(latest?.to)}" data-complete="${latest?.state==='complete'}"><div class="form-grid"><label>开始日期<input type="date" name="from" value="${esc(from)}" required></label><label>结束日期<input type="date" name="to" value="${esc(to)}" required></label></div><button class="quiet" ${active(latest)?'disabled':''}>${active(latest)?'后台读取中…':latest?.state==='complete'?'重新读取 Ozon 财务明细':latest?'继续读取 Ozon 财务明细':'读取 Ozon 财务明细'}</button></form>${financeResult(latest)}</section>`;
}
export function planFinance(data,p){
 const store=data.stores.find(s=>s.id===p.storeId);if(store?.mode!=='live'||store.marketplace!=='ozon')return '';
 const a=financeReading(data,p.storeId,p.sku,p.aStart,p.aEnd),b=financeReading(data,p.storeId,p.sku,p.bStart,p.bEnd);
 return `<details class="plan-finance" id="finance-${esc(p.id)}"><summary>按实验日期读取实际记账</summary><p class="warning">补齐成本并核对执行后，可以保存两个期间的贡献比较。记账差额不证明策略的因果效果。</p><div class="diff-grid">${['a','b'].map((k,i)=>`<div id="finance-${esc(p.id)}-${k}"><h4>${i?'测试期':'基准期'}</h4>${readButton(data,p.storeId,p.sku,p[k+'Start'],p[k+'End'],i?'测试期':'基准期')}${financeResult(financeReading(data,p.storeId,p.sku,p[k+'Start'],p[k+'End']),p.id+'-'+k)}</div>`).join('')}</div><div id="comparison-${esc(p.id)}">${ledgerComparisonForm(p,a,b)}</div></details>`;
}
export function bindFinance({api,action}){
 document.querySelectorAll('[data-finance-store]').forEach(b=>b.onclick=()=>action(()=>api('/stores/'+encodeURIComponent(b.dataset.financeStore)+'/finance',{sku:b.dataset.financeSku,from:b.dataset.financeFrom,to:b.dataset.financeTo,refresh:b.dataset.financeRefresh==='true'}),'财务读取已排队；不会改变平台数据'));
 const f=document.querySelector('#sku-finance-form');if(f)f.onsubmit=e=>{e.preventDefault();action(()=>api('/stores/'+encodeURIComponent(f.dataset.store)+'/finance',{sku:f.dataset.sku,from:f.elements.from.value,to:f.elements.to.value,refresh:f.dataset.complete==='true'&&f.elements.from.value===f.dataset.lastFrom&&f.elements.to.value===f.dataset.lastTo}),'财务读取已排队；已完成日期会保存');};
}
