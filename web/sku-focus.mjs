import {wbAdPanel} from './wb-advertising.mjs';
import {wbFinancePanel} from './wb-finance.mjs';
import {wbInventoryPanel} from './wb-inventory.mjs';
import {wbPricesPanel} from './wb-prices.mjs';
import {financePanel} from './finance-ledger.mjs';
import {skuAdBreakdown} from './ad-coverage.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,c='RUB')=>(typeof n==='number'&&Number.isFinite(n)||typeof n==='string'&&/^-?\d+(\.\d+)?$/.test(n))?new Intl.NumberFormat('zh-CN',{style:'currency',currency:c}).format(n):'—';
export function skuFocusModel(data,live,selection){
 if(!selection)return null;const store=data.stores.find(s=>s.id===selection.storeId);if(!store)return null;
 const row=store.id==='ozon-live'?live?.data?.rows?.find(r=>r.sku===selection.sku):null;
 const product={...selection.product,...row,sku:selection.sku};
 const cost=(data.costProfiles||[]).find(c=>c.storeId===store.id&&c.sku===selection.sku);
 const plan=(data.trialPlans||[]).find(p=>p.storeId===store.id&&p.sku===selection.sku&&p.status==='planned');
 const observation=(data.trials||[]).filter(p=>p.storeId===store.id&&p.sku===selection.sku).sort((a,b)=>b.at.localeCompare(a.at))[0];
 return {store,product,row,cost,plan,observation,period:row?live.data.period:null,stale:row&&(live.stale||live.state==='error'),priceDiffers:!!cost&&product.currency==='RUB'&&Number.isFinite(product.price)&&cost.economics.priceRub!==product.price};
}
export function skuFocus(data,live,selection){
 const m=skuFocusModel(data,live,selection);if(!m)return '';const {store,product:p,row:r,cost:c,plan}=m;
 return `<section class="card" id="sku-focus"><div class="section-head"><div><span class="badge ${store.mode==='mock'?'mock':'live'}">${store.mode==='mock'?'DEMO':'真实店铺'}</span><h2>${esc(p.name||p.offerId||p.sku)}</h2><p>${esc(store.name)} · ${store.marketplace==='wb'?'nmID':'SKU'} ${esc(p.sku)} · ${esc(p.offerId)}</p></div><button class="quiet" id="sku-focus-close">关闭商品详情</button></div>${store.marketplace==='wb'&&store.mode==='live'?wbPricesPanel(selection.wbPrices,store.id)+wbInventoryPanel(selection.wbInventory,store.id,p.sku,data.operations||[])+wbFinancePanel(selection.wbFinance,store.id,{product:true})+wbAdPanel(selection.wbAds,store.id,{product:true}):''}<div class="diff-grid"><div><h3>平台已读取的数据</h3><p>${store.marketplace==='wb'&&store.mode==='live'?'库存按上方仓库与尺码明细显示。':`售价上限 ${p.currency?esc(money(p.price,p.currency)):'—'}${p.currency?'':'（币种待核实）'} · 报告库存 ${p.stock??'—'} 件`}</p>${r?`<p>${esc(m.period.from)} — ${esc(m.period.to)} · 莫斯科时间</p><p>订购金额 ${money(r.orderRevenue)} · ${r.orderedUnits??'—'} 件（非订单数）</p><p>已读取广告支出 ${money(r.adSpend)}<br>${skuAdBreakdown(r)}</p><p>净计账 ${r.netAccrued?Object.entries(r.netAccrued).map(([currency,n])=>esc(money(n,currency))).join(' / ')||'—':'—'} · 尚未扣商品成本</p><p>${r.strategies?.length?r.strategies.map(s=>`${esc(s.instrument)} · ${s.active?'开启':'关闭'}`).join(' / '):'广告方案未读取'}</p><small>广告支出覆盖未完全核实；净计账与订购金额不能直接当作利润。</small>`:`<p class="muted">${store.marketplace==='wb'?'财务和广告明细见上方，按各自期间与读取时间核对。':'此商品尚无已读取的销售 / 广告记录。缺失数据不代表零销售。'}</p>`}${m.stale?'<p class="warning">经营报表为旧快照，请刷新后判断。</p>':''}</div>${store.marketplace==='wb'&&store.mode==='live'?wbNextTest(m,selection):`<div><h3>你的成本情景</h3>${c?`<p>情景售价 ${money(c.economics.priceRub)} · 假设单件贡献 ${money(c.result.unitProfit)}（${c.result.marginPct}%）</p><p>盈亏平衡价 ${money(c.result.breakEvenPrice)}</p><p class="muted">成本 v${c.revision} · ${esc(c.at)}<br>${esc(c.evidence)}</p>${m.priceDiffers?'<p class="warning">成本情景售价与已读取平台价不同；请核对后再建立价格测试。</p>':''}`:'<p>先填写商品成本、平台费用、履约、广告、税费与退货准备。</p>'}<small>这是卖家假设，不是实际结算利润。平台价格仍可能受促销影响。</small><div class="actions"><button class="quiet" data-cost-store="${esc(store.id)}" data-cost-sku="${esc(p.sku)}" data-cost-price="${p.currency==='RUB'&&Number.isFinite(p.price)?p.price:''}">${c?'查看 / 更新成本':'填写成本'}</button>${plan?`<button class="primary" data-nav="trials" data-record="plan-${esc(plan.id)}">查看当前实验</button>`:`<button class="primary" data-focus-plan="${esc(c?.id||'')}" ${c?'':'disabled'}>建立此商品实验</button>`}</div></div>`}</div>${plan?`<p>当前计划：${esc(plan.baseline)} → ${esc(plan.variant)} · ${esc(plan.bStart)} — ${esc(plan.bEnd)} · ${esc(plan.hypothesis)}</p>`:''}${priceConditions(data,m)}${focusObservation(m)}</section>${financePanel(data,store,p.sku,m.period)}`;
}

function wbNextTest(m,selection){
 const current=[...new Set((selection.wbFinance?.skuReconciliations||[]).filter(r=>r.status==='current'&&['CNY','RUB'].includes(r.currency)).map(r=>r.currency))];
 return `<div><h3>成本与实验</h3><p>在上方核对此期间的商品成本、税费和公共费用。价格测试会单独读取最新 API 币种与尺码，填写每件成本并确认后才可执行。</p>${m.plan?`<button class="primary" data-nav="trials" data-record="plan-${esc(m.plan.id)}">查看当前实验</button>`:current.length?current.map(currency=>`<button class="quiet" data-wb-economics-plan data-store="${esc(m.store.id)}" data-sku="${esc(m.product.sku)}" data-currency="${esc(currency)}">建立 ${esc(currency)} 商品测试 →</button>`).join(''):'<p class="muted">完成此期间成本核对后，可从这里建立商品测试。</p>'}</div>`;
}
function focusObservation(m){
 const t=m.observation;if(!t)return '';const api=['api_accruals_seller_costs','wb_reports_seller_costs'].includes(t.source),valid=t.result.verdict!=='insufficient'&&(!api||t.sourceStatus==='current');
 return `<p>最近${api?'API 记账 + 卖家成本':'人工观察'}：${valid?`日均贡献 ${money(t.result.before,t.currency)} → ${money(t.result.after,t.currency)} · 需重复验证，非因果证明`:'证据不完整或已变化，请核对结果'}</p>`;
}

function priceConditions(data,m){
 if(m.store.mode!=='live'||m.store.marketplace!=='ozon')return '';
 const check=(data.priceChecks||[]).findLast(c=>c.storeId===m.store.id&&c.sku===m.product.sku),c=check?.context;
 const old=!check?.finishedAt||Date.now()-Date.parse(check.finishedAt)>15*60000;
 const actionsList=c?.actions?.actions?.length?`<p><small>平台已生效促销活动：${c.actions.actions.map(a=>esc(a.title)+(a.value?' ('+a.value+' ₽)':'')).join('；')}</small></p>`:'';
 const autoAddWarn=c?.autoAdd===true?`<p><small class="warning">平台设置「自动加入促销」(autoAdd) 已开启：单变量价格测试可能被平台活动规则覆盖。建议在 Ozon 卖家后台核实促销设置。</small></p>`:'';
 const details=check?.state==='checked'?`<p>${old?'历史读取 · 请重新检查':'本次读取'}：${esc(check.finishedAt)}</p><p>平台价 ${esc(money(c.price,c.currency))} · 促销价 ${c.marketingPrice===null?'未知':esc(money(c.marketingPrice,c.currency))}</p>${actionsList}${autoAddWarn}${check.blockers.length?`<ul>${check.blockers.map(b=>`<li>${esc(b.message)}</li>`).join('')}</ul>`:'<p>此次读取未发现上述促销冲突。仍需核对库存、成本、目标价格及实验期间；这不是执行许可。</p>'}`:check?`<p>${check.state==='reading'?'上次读取尚未完成；可重新检查。':check.state==='interrupted'?'上次读取被中断；请重新检查。':'读取失败；旧结果不能作为当前条件。'}</p>`:'<p>填写价格方案前，先读取当前价格、自动促销与促销价，检查能否比较单一价格变化。</p>';
 return `<div class="price-conditions" id="price-conditions"><h3>先检查价格测试条件</h3>${details}${m.product.stock===0?'<p class="warning">报告库存为 0；先核实可售库存，不启动销售实验。</p>':''}<button class="quiet" data-price-conditions="${esc(m.store.id)}" data-price-sku="${esc(m.product.sku)}">读取价格与促销条件</button><small>仅查询，不修改价格或促销。检查记录可追溯；提交时仍会重新读取并要求确认。</small></div>`;
}
