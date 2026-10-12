import {unitEconomics} from './assessment.mjs';
export const costFields=['priceRub','unitCost','commissionPct','logisticsRub','adsRub','taxPct','returnsRub'];
export function costProfile(input){
 if(typeof input.sku!=='string'||!input.sku.trim()||input.sku.length>160||typeof input.evidence!=='string'||!input.evidence.trim()||input.evidence.length>1000)throw Error('请填写 SKU 与成本来源');
 const economics={costCurrency:'RUB'};for(const k of costFields){const v=input.economics?.[k];if(v===null||v===undefined||!['number','string'].includes(typeof v)||(typeof v==='string'&&!v.trim()))throw Error('请填写所有成本；未知不能填成零');economics[k]=Number(v);}
 const result=unitEconomics(economics);if(!result.complete)throw Error('成本不完整');
 return {sku:input.sku.trim(),economics,result,evidence:input.evidence.trim(),source:'seller_assumptions',currency:'RUB'};
}
export function latestCosts(db){const map=new Map();for(const p of db.costVersions||[])map.set(JSON.stringify([p.storeId,p.sku]),p);return [...map.values()];}
