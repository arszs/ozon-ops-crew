import {wbDecimal,decimalText} from '../adapters/wb-finance.mjs';

// Compare like-for-like fields, report by report. This is not a payout formula:
// several header/detail fields overlap, and store deductions may include ads.
export const WB_ATTRIBUTION_VERSION='wb-report-fields-v1';
export const WB_RECONCILE_FIELDS={
 forPay:'forPaySum',retailAmount:'retailAmountSum',deliveryService:'deliveryServiceSum',
 paidStorage:'paidStorageSum',paidAcceptance:'paidAcceptanceSum',deduction:'deductionSum',
 penalty:'penaltySum',additionalPayment:'additionalPaymentSum',cashbackAmount:'cashbackAmountSum',
 cashbackDiscount:'cashbackDiscountSum',cashbackCommissionChange:'cashbackCommissionChangeSum',paymentSchedule:'paymentSchedule'
};
const fields=Object.keys(WB_RECONCILE_FIELDS),signed=new Set(['forPay','retailAmount']);
const bucket=()=>({lines:0,fields:Object.fromEntries(fields.map(k=>[k,{amount:0n,unknown:0}]))});
function add(b,values){b.lines++;for(const k of fields){if(values[k]===null)b.fields[k].unknown++;else b.fields[k].amount+=values[k];}}
function publicBucket(b){return {lines:b.lines,fields:Object.fromEntries(fields.map(k=>[k,{amount:!b.lines||b.fields[k].unknown?null:decimalText(b.fields[k].amount),knownSubtotal:decimalText(b.fields[k].amount),unknownRows:b.fields[k].unknown}]))};}

export function attributeWbFinance(reports,rows){
 const byReport=new Map(reports.map(r=>[r.reportId,{report:r,total:bucket(),assigned:bucket(),shared:bucket()}])),byCurrency=new Map(),products=new Map();
 for(const r of rows){
  const report=byReport.get(r.reportId);if(!report||r.currency!==report.report.currency)throw Error('WB 明细与分摊报表不匹配');
  const values={};for(const k of fields){
   // Older snapshots did not request paymentSchedule; absence is never zero.
   if(r.amounts[k]===undefined){values[k]=null;continue;}
   const n=wbDecimal(r.amounts[k]);
   values[k]=signed.has(k)?r.document==='Продажа'?n:r.document==='Возврат'?-n:n===0n?0n:null:n;
  }
  add(report.total,values);add(r.sku==='0'?report.shared:report.assigned,values);
  let currency=byCurrency.get(r.currency);if(!currency){currency={total:bucket(),assigned:bucket(),shared:bucket()};byCurrency.set(r.currency,currency);}
  add(currency.total,values);add(r.sku==='0'?currency.shared:currency.assigned,values);
  if(r.sku!=='0'){
   let product=products.get(r.sku);if(!product){product=new Map();products.set(r.sku,product);}
   let b=product.get(r.currency);if(!b){b=bucket();product.set(r.currency,b);}add(b,values);
  }
 }
 const checks=[];
 for(const {report,total} of byReport.values())for(const k of fields){
  const t=total.fields[k],header=report.amounts[WB_RECONCILE_FIELDS[k]],known=total.lines>0&&t.unknown===0&&header!==undefined;
  const difference=known?decimalText(wbDecimal(header)-t.amount):null;
  checks.push({reportId:report.reportId,date:report.from,currency:report.currency,field:k,header:header??null,detail:known?decimalText(t.amount):null,knownSubtotal:decimalText(t.amount),unknownRows:t.unknown,difference,matched:known&&difference==='0'});
 }
 const currencies=Object.fromEntries([...new Set(reports.map(r=>r.currency))].map(c=>{
  const b=byCurrency.get(c)||{total:bucket(),assigned:bucket(),shared:bucket()},cc=checks.filter(x=>x.currency===c);
  return [c,{total:publicBucket(b.total),assigned:publicBucket(b.assigned),shared:publicBucket(b.shared),reports:reports.filter(r=>r.currency===c).length,matched:cc.length>0&&cc.every(x=>x.matched),goodsMatched:cc.some(x=>x.field==='forPay')&&cc.filter(x=>x.field==='forPay').every(x=>x.matched),issues:cc.filter(x=>!x.matched)}];
 }));
 return {version:WB_ATTRIBUTION_VERSION,currencies,products:new Map([...products].map(([sku,cs])=>[sku,Object.fromEntries([...cs].map(([c,b])=>[c,publicBucket(b)]))]))};
}

// Bounded public summary; totals still include every report and every row.
export function wbAttributionSummary(result){return {version:result.version,currencies:Object.fromEntries(Object.entries(result.currencies).map(([c,v])=>[c,{...v,issueCount:v.issues.length,issues:v.issues.slice(0,30)}]))};}
