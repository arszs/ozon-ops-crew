import {unitEconomics} from './assessment.mjs';
export const costFields=['priceRub','unitCost','commissionPct','logisticsRub','adsRub','taxPct','returnsRub'];
export function costProfile(input){
 if(typeof input.sku!=='string'||!input.sku.trim()||input.sku.length>160||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.length>1000)throw Error('请填写 SKU 与成本来源');
 const economics={costCurrency:'RUB'};for(const k of costFields){const v=input.economics?.[k];if(v===null||v===undefined||!['number','string'].includes(typeof v)||(typeof v==='string'&&!v.trim()))throw Error('请填写所有成本；未知不能填成零');economics[k]=Number(v);}
 const result=unitEconomics(economics);if(!result.complete)throw Error('成本不完整');
 return {sku:input.sku.trim(),economics,result,evidence:input.evidence.trim(),source:'seller_assumptions',currency:'RUB'};
}
export function latestCosts(db){const map=new Map();for(const p of db.costVersions||[])map.set(JSON.stringify([p.storeId,p.sku]),p);return [...map.values()];}

export function priceTrialEconomics(plan,profile,minMarginPct=15){
 if(!profile||profile.storeId!==plan.storeId||profile.sku!==plan.sku)throw Error('请先保存此店铺 SKU 的成本版本');
 if(typeof minMarginPct!=='number'||!Number.isFinite(minMarginPct)||minMarginPct<0||minMarginPct>90)throw Error('最低贡献利润率需为 0–90%');
 const numeric=v=>typeof v==='string'&&/^\d+(\.\d{1,2})?$/.test(v)&&Number(v)>0;
 if(!numeric(plan.baseline)||!numeric(plan.variant)||Number(plan.baseline)!==profile.economics.priceRub)throw Error('价格方案请填写 RUB 数字；基准必须与所选成本情景一致');
 const e=profile.economics,share=1-(e.commissionPct+e.taxPct+minMarginPct)/100;
 if(share<=0)throw Error('当前费率无法达到最低利润率');
 const minimumPrice=Math.ceil((e.unitCost+e.logisticsRub+e.adsRub+e.returnsRub)/share*100)/100;
 if(Number(plan.variant)<minimumPrice)throw Error('测试价格低于利润保护底线 '+minimumPrice+' RUB');
 const result=unitEconomics({...e,priceRub:Number(plan.variant)});
 return {profileId:profile.id,revision:profile.revision,evidence:profile.evidence,at:profile.at,economics:{...e},minMarginPct,minimumPrice,baseline:{...profile.result},variant:result,source:'seller_assumptions',platformPriceVerified:false};
}
