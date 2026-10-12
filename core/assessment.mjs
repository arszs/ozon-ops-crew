import {sourceURL} from './canonical.mjs';
export function unitEconomics(a){
 const keys=['priceRub','unitCost','commissionPct','logisticsRub','adsRub','taxPct','returnsRub'];
 if(!a||keys.some(k=>a[k]===null||a[k]===''||a[k]===undefined))return {complete:false,missing:keys.filter(k=>a?.[k]===null||a?.[k]===''||a?.[k]===undefined)};
 for(const k of keys)if(!Number.isFinite(Number(a[k]))||Number(a[k])<0)throw Error('Invalid economic inputs');
 if(Number(a.priceRub)<=0||Number(a.commissionPct)+Number(a.taxPct)>=100)throw Error('Invalid price or rates');
 if(!['RUB','CNY'].includes(a.costCurrency))throw Error('Select cost currency');
 if(a.costCurrency==='CNY'&&(!Number.isFinite(Number(a.fx))||Number(a.fx)<=0))return {complete:false,missing:['fx']};
 const cost=Number(a.unitCost)*(a.costCurrency==='CNY'?Number(a.fx):1),fixed=cost+Number(a.logisticsRub)+Number(a.adsRub)+Number(a.returnsRub),share=1-(Number(a.commissionPct)+Number(a.taxPct))/100;
 const profit=Number(a.priceRub)*share-fixed;return {complete:true,unitProfit:Math.round(profit*100)/100,marginPct:Math.round(profit/Number(a.priceRub)*10000)/100,breakEvenPrice:Math.round(fixed/share*100)/100,assumptionsOnly:true};
}
export function assessStore(input){
 const source=sourceURL(input.url),sample=Array.isArray(input.products)?input.products:[];if(sample.length>5000)throw Error('Sample limit 5000');
 const targets={};for(const p of ['ozon','wb']){const economy=unitEconomics(input[p]);targets[p]={economy,verdict:!economy.complete?'needs_data':economy.marginPct>=15?'conditional_pilot':'revise_economics',missing:['竞争与需求数据','品类与认证要求核验',...(!sample.length?['商品结构化导出']:[])]};}
 return {source,sourceFetched:false,sampleSize:sample.length,categoryCount:new Set(sample.map(p=>p.categoryZh).filter(Boolean)).size,targets,conclusion:!sample.length?'仅凭链接无法判断市场需求与盈利。请补充商品导出和成本。':'这是样本与输入假设的可行性评估，不是市场需求预测。',rubric:'试销建议要求假设毛利率 ≥15%；阈值是本工具的试销规则，不是平台标准。',evidence:[{kind:'user_url',value:source.url},{kind:'user_assumptions',value:{ozon:input.ozon||null,wb:input.wb||null}},{kind:'sample',value:sample.map(p=>({sku:p.sku,category:p.categoryZh}))}]};
}
