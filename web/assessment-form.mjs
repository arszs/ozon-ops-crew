import {assortmentTable,sampleAssortment} from './assortment.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=v=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'RUB'}).format(v);
export const economyFieldsList=[['priceRub','预计售价 ₽'],['unitCost','每件商品成本 ₽'],['commissionPct','平台佣金 %'],['logisticsRub','每件履约费用 ₽'],['adsRub','每单广告费用 ₽'],['taxPct','税费 %'],['returnsRub','每件退货准备 ₽']];
export function economyFields(prefix,price=true){return `<div class="form-grid economics">${economyFieldsList.filter(([k])=>price||k!=='priceRub').map(([k,l])=>`<label>${l}<input name="${esc(prefix)}_${k}" type="number" min="0" step="0.01" placeholder="未知请留空"></label>`).join('')}</div>`;}
export function economyData(form,prefix){return {...Object.fromEntries(economyFieldsList.map(([k])=>[k,form.get(prefix+'_'+k)])),costCurrency:'RUB'};}
export function assessmentInput(form){
 const mode=form.get('inputMode');let products;
 if(mode==='batch'){
  try{products=JSON.parse(form.get('products')||'[]');}catch{throw Error('商品 JSON 格式有误，请检查后重试；输入会保留。');}
  if(!Array.isArray(products))throw Error('商品 JSON 必须为数组');
 }else if(mode==='single'){
  const sku=String(form.get('sku')||'').trim(),categoryZh=String(form.get('categoryZh')||'').trim();
  const targets=Object.fromEntries(['ozon','wb'].map(p=>[p,economyData(form,p)]));
  const filled=categoryZh||Object.values(targets).some(e=>economyFieldsList.some(([k])=>String(e[k]??'').trim()));
  if(!sku&&filled)throw Error('填写成本或类目前，请先填写商品 SKU');
  products=sku?[{sku,categoryZh,targets}]:[];
 }else throw Error('请选择单件商品或批量导入');
 return {url:form.get('url'),products};
}
export function assessmentPage(a){return `<div class="intro"><h2>先选一件商品，判断是否值得试销</h2><p>填写店铺链接与单品成本，先看能否覆盖费用。需求、竞争和商品准入仍需验证。</p></div><section class="card"><form id="assessment-form"><label>淘宝 / 天猫店铺链接<input name="url" type="url" required placeholder="https://shop123456.taobao.com"></label><label>商品资料<select name="inputMode"><option value="single">填写一件商品（推荐）</option><option value="batch">批量导入商品 JSON</option></select></label><p class="muted">本评估统一使用 RUB。请填写已核实的 RUB 成本；不处理采购、进口或汇率换算。未知留空，已核实没有费用才填 0。</p><fieldset data-assessment-single><legend>商品与 Ozon 费用假设</legend><div class="form-grid"><label>商品 SKU<input name="sku" maxlength="160" placeholder="你的商品编号"></label><label>商品类目<input name="categoryZh" maxlength="160" placeholder="例如：家居收纳"></label></div>${economyFields('ozon')}<details><summary>同时比较 Wildberries（独立填写费用假设）</summary><p class="muted">仅做费用情景比较，不代表 WB 已接入或商品已获准销售。</p>${economyFields('wb')}</details></fieldset><fieldset data-assessment-batch hidden disabled><legend>批量商品资料</legend><label>商品 JSON · 每个 SKU 单独填写成本与费用<textarea name="products" rows="6" placeholder='[{"sku":"A01","categoryZh":"家居收纳","targets":{"ozon":{"priceRub":1500,"unitCost":500,"costCurrency":"RUB"}}}]'></textarea></label><button type="button" class="quiet" id="assortment-example">填入格式示例（合成假设）</button><p class="muted">最多 5000 SKU。每个平台的费用使用 targets.ozon / targets.wb；costCurrency 必须为 RUB。缺失字段不会用其他商品或平台的数据补齐。</p></fieldset><button class="primary">评估试销条件 →</button><p class="muted">链接不会自动抓取店铺；费率与成本由你提供，不是平台报价或销量预测。</p></form></section>${a?assessmentResult(a):''}`;}
function assessmentResult(a){return `<section class="card"><span class="eyebrow">评估结论 · ${esc(a.at)}</span><h2>${esc(a.conclusion)}</h2><p>样本 ${a.sampleSize} SKU · ${a.categoryCount} 个类目 · 源网站未抓取</p><div class="diff-grid">${Object.entries(a.targets).map(([p,t])=>`<div class="target"><h3>${p==='ozon'?'Ozon':'Wildberries · 情景比较'}</h3><span class="badge ${t.verdict==='conditional_pilot'?'live':'mock'}">${({needs_data:'资料不足，不能判断',conditional_pilot:'经济条件支持试销候选',revise_economics:'先调整价格或成本'})[t.verdict]}</span>${a.products?.length?`<p>候选 ${t.sampleSummary.candidates} · 需调整 ${t.sampleSummary.revise} · 缺资料 ${t.sampleSummary.missing}</p>`:t.economy.complete?`<p>单件贡献利润（假设）：<b>${rub(t.economy.unitProfit)}</b> · ${t.economy.marginPct}%</p><p>盈亏平衡价 ${rub(t.economy.breakEvenPrice)}</p>`:'<p>先填写商品与费用，才能计算。</p>'}<p>仍需核验：${t.missing.map(esc).join('、')}</p></div>`).join('')}</div><p class="muted">${esc(a.rubric)}</p></section>${assortmentTable(a)}`;}
export function bindAssessment({api,action,say,onResult}){
 const f=document.querySelector('#assessment-form');if(!f)return;
 const mode=()=>{for(const kind of ['single','batch']){const section=f.querySelector('[data-assessment-'+kind+']');section.hidden=f.elements.inputMode.value!==kind;section.disabled=section.hidden;}};
 f.elements.inputMode.onchange=mode;f.addEventListener('draft-restored',mode);mode();
 f.querySelector('#assortment-example').onclick=()=>{if(f.elements.products.value.trim())return say('请先清空现有商品数据，再填入示例',true);f.elements.products.value=JSON.stringify(sampleAssortment,null,2);say('合成示例仅展示格式；请替换为你的商品成本');};
 f.onsubmit=e=>{e.preventDefault();const form=new FormData(f);action(async()=>onResult(await api('/assessments',assessmentInput(form))),'评估完成：候选还需验证需求与准入');};
}
