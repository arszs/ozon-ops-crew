import {sourceURL} from './canonical.mjs';
export function unitEconomics(a){
 const keys=['priceRub','unitCost','commissionPct','logisticsRub','adsRub','taxPct','returnsRub'];
 const blank=v=>v==null||(typeof v==='string'&&!v.trim());
 if(!a||keys.some(k=>blank(a[k])))return {complete:false,missing:keys.filter(k=>blank(a?.[k]))};
 for(const k of keys)if(!['number','string'].includes(typeof a[k])||!Number.isFinite(Number(a[k]))||Number(a[k])<0||Number(a[k])>1e12)throw Error('Invalid economic inputs');
 if(Number(a.priceRub)<=0||Number(a.commissionPct)+Number(a.taxPct)>=100)throw Error('Invalid price or rates');
 if(!['RUB','CNY'].includes(a.costCurrency))throw Error('Select cost currency');
 if(a.costCurrency==='CNY'&&(!Number.isFinite(Number(a.fx))||Number(a.fx)<=0))return {complete:false,missing:['fx']};
 const cost=Number(a.unitCost)*(a.costCurrency==='CNY'?Number(a.fx):1),fixed=cost+Number(a.logisticsRub)+Number(a.adsRub)+Number(a.returnsRub),share=1-(Number(a.commissionPct)+Number(a.taxPct))/100;
 const profit=Number(a.priceRub)*share-fixed,adHeadroom=profit+Number(a.adsRub);if(![cost,fixed,profit,fixed/share,adHeadroom].every(Number.isFinite))throw Error('Economic calculation overflow');return {complete:true,unitProfit:Math.round(profit*100)/100,marginPct:Math.round(profit/Number(a.priceRub)*10000)/100,breakEvenPrice:Math.round(fixed/share*100)/100,assumptionsOnly:true,maxAdPerOrderAt15Pct:Math.round((adHeadroom-Number(a.priceRub)*.15)*100)/100};
}
export function assessStore(input){
 const source=sourceURL(input.url),sample=input.products??[];if(!Array.isArray(sample)||sample.length>5000)throw Error('Sample must be an array, max 5000');
 const seen=new Set();const products=sample.map(p=>{
  if(!p||typeof p.sku!=='string'||!p.sku.trim()||p.sku.length>160||seen.has(p.sku.trim()))throw Error('商品 SKU 必填且不能重复');
  const sku=p.sku.trim();seen.add(sku);const targets={};for(const platform of ['ozon','wb']){const economy=unitEconomics(p.targets?.[platform]);targets[platform]={economy,verdict:!economy.complete?'needs_data':economy.marginPct>=15?'conditional_pilot':'revise_economics'};}
  return {sku,categoryZh:typeof p.categoryZh==='string'?p.categoryZh.slice(0,160):'',targets};
 });
 const targets={};for(const p of ['ozon','wb']){const economy=unitEconomics(input[p]);const summary={candidates:0,revise:0,missing:0};for(const product of products){const verdict=product.targets[p].verdict;summary[verdict==='conditional_pilot'?'candidates':verdict==='revise_economics'?'revise':'missing']++;}
  targets[p]={economy,sampleSummary:summary,verdict:products.length?(summary.candidates?'conditional_pilot':summary.missing?'needs_data':'revise_economics'):!economy.complete?'needs_data':economy.marginPct>=15?'conditional_pilot':'revise_economics',missing:['竞争与需求数据','品类与认证要求核验',...(!sample.length?['商品结构化导出']:[])]};
 }
 return {source,sourceFetched:false,sampleSize:products.length,categoryCount:new Set(products.map(p=>p.categoryZh).filter(Boolean)).size,products,targets,conclusion:!sample.length?'仅凭链接无法判断市场需求与盈利。请补充商品导出和成本。':'逐 SKU 核对输入假设；候选只满足经济条件，尚未验证需求或准入。',rubric:'试销候选要求假设贡献利润率 ≥15%；阈值是本工具规则，不是平台标准。广告上限按每单计算，不是点击出价。',evidence:[{kind:'user_url',value:source.url},{kind:'user_assumptions',value:{ozon:input.ozon||null,wb:input.wb||null}},{kind:'sample',value:sample.map(p=>({sku:p.sku.trim(),category:p.categoryZh,targets:p.targets||null}))}]};
}
