import {hash} from './repository.mjs';
const money=v=>typeof v==='number'&&Number.isFinite(v)&&Number.isSafeInteger(Math.round(v*100));
const cents=v=>Math.round(v*100);
// Preserve per-SKU reconciliations. A store total additionally needs complete
// catalogue coverage and a balanced allocation of shared platform amounts.
export function strategyFinance(products,readings,{period=null}={}){
 const rows=new Map(),required=new Set(products.map(p=>p.sku).filter(Boolean));
 for(const sku of required){
  const matching=readings.filter(r=>r.sku===sku&&r.state==='complete'&&r.loadedDays===r.totalDays&&r.evidenceHash&&(!period||r.from===period.from&&r.to===period.to));
  const run=matching.sort((a,b)=>String(b.to).localeCompare(String(a.to))||String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];if(!run)continue;
  const selected=new Map();for(const c of run.reconciliations||[])selected.set(c.currency,c);
  const values={};for(const [currency,c] of selected){if(!/^[A-Z]{3}$/.test(currency)||c.reportId!==run.id||c.reportHash!==run.evidenceHash||c.result?.reviewed!==true||!Object.values(c.checks||{}).every(v=>v===true)||!['costsComplete','allocationReviewed','periodReviewed'].every(k=>c.checks?.[k]===true)||!money(c.result.contribution)||!money(c.netAccrued)||!money(c.costs?.sharedNet)||!['cogs','tax','external'].every(k=>money(c.costs?.[k])))continue;
   const expected=c.netAccrued+c.costs.sharedNet-c.costs.cogs-c.costs.tax-c.costs.external;if(!money(expected)||Math.abs(cents(expected)-cents(c.result.contribution))>0)continue;
   values[currency]={profit:c.result.contribution,netAccrued:c.netAccrued,sharedNet:c.costs.sharedNet,period:{from:run.from,to:run.to},basis:'accrual_date',source:'api_accruals_seller_costs',reconciliationId:c.id,reportId:run.id,reportHash:run.evidenceHash,costSource:c.evidence,orders:c.orderCount};
  }
  rows.set(sku,{run,values});
 }
 const perSku=Object.fromEntries([...rows].map(([sku,r])=>[sku,r.values]));
 if(!required.size||rows.size!==required.size)return {perSku,storeProfit:null,complete:false,reason:'financial_sku_coverage_incomplete'};
 const periods=new Set([...rows.values()].map(r=>r.run.from+'/'+r.run.to));if(periods.size!==1)return {perSku,storeProfit:null,complete:false,reason:'financial_period_mismatch'};
 const allCurrencies=new Set([...rows.values()].flatMap(r=>[...Object.keys(r.run.summary?.storeTotals||{}),...Object.keys(r.run.summary?.storeUnallocated||{}),...Object.keys(r.values)]));
 if(!allCurrencies.size)return {perSku,storeProfit:null,complete:false,reason:'financial_currency_unknown'};
 const totals={};
 for(const currency of allCurrencies){
  let storeTotal=null,unallocated=null,net=0,shared=0,profit=0;
  for(const {run,values} of rows.values()){
   const value=values[currency],st=run.summary?.storeTotals?.[currency],ua=run.summary?.storeUnallocated?.[currency];
   if(!value||!money(st)||!money(ua))return {perSku,storeProfit:null,complete:false,reason:'financial_currency_coverage_incomplete'};
   if(storeTotal!==null&&storeTotal!==cents(st)||unallocated!==null&&unallocated!==cents(ua))return {perSku,storeProfit:null,complete:false,reason:'financial_store_reports_differ'};
   storeTotal=cents(st);unallocated=cents(ua);net+=cents(value.netAccrued);shared+=cents(value.sharedNet);profit+=cents(value.profit);
  }
  if(![net,shared,profit].every(Number.isSafeInteger)||shared!==unallocated||net+shared!==storeTotal)return {perSku,storeProfit:null,complete:false,reason:'financial_allocation_unbalanced'};
  totals[currency]=profit/100;
 }
 const first=rows.values().next().value.run;return {perSku,storeProfit:{totals,period:{from:first.from,to:first.to},basis:'accrual_date',source:'api_accruals_seller_costs',evidenceHash:hash([...rows].map(([sku,r])=>({sku,reportHash:r.run.evidenceHash,values:r.values})))},complete:true,reason:null};
}
