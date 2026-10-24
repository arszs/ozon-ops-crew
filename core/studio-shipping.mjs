export function studioShipping(evidence,options={},reserve=Number(process.env.OPS_DOMESTIC_SHIPPING_RESERVE_CNY??20)){
 if(options.domesticShipping!==null&&options.domesticShipping!==undefined&&options.domesticShipping!=='')return {amount:Number(options.domesticShipping),source:'configured',estimated:false};
 const text=evidence?.text||'';if(/快递\s*[:：]\s*免运费/.test(text))return {amount:0,source:'source-page',estimated:false};
 const match=text.match(/快递\s*[:：]\s*(\d+(?:\.\d+)?)/);if(match)return {amount:Number(match[1]),source:'source-page',estimated:false};
 if(!Number.isFinite(reserve)||reserve<0||reserve>1000)throw Error('Некорректный резерв доставки по Китаю');
 return {amount:reserve,source:'estimated-reserve',estimated:true};
}
export function annotateStudioShipping(pricing,shipping){
 const assumptions=shipping.estimated?[...(pricing.assumptions||[]).filter(a=>!a.includes('中国境内运费来自保存页')),`境内运费未确认，暂按 ${shipping.amount} CNY 预留；这是可修改的估计，不是已确认运费。`]:pricing.assumptions;
 return {...pricing,domesticShippingSource:shipping.source,domesticShippingEstimated:shipping.estimated,assumptions,...(pricing.baseCalculation?{baseCalculation:{...pricing.baseCalculation,domesticShippingSource:shipping.source,domesticShippingEstimated:shipping.estimated,assumptions}}:{})};
}
