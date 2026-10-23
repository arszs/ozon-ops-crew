import test from 'node:test';
import assert from 'node:assert/strict';
import {attributeWbFinance,wbAttributionSummary} from '../core/wb-finance-attribution.mjs';
import {WB_REPORT_FIELDS,WB_DETAIL_MONEY} from '../adapters/wb-finance.mjs';
import {wbSettlementPanel,wbProductNet} from '../web/wb-finance-attribution.mjs';
import {settlementFixture} from './helpers/wb-settlement-fixture.mjs';
const zero=ks=>Object.fromEntries(ks.map(k=>[k,'0']));
const report=(amounts={},patch={})=>({reportId:'1',from:'2026-10-01',to:'2026-10-01',currency:'CNY',reportType:1,amounts:{...zero(WB_REPORT_FIELDS),...amounts},...patch});
const row=(amounts={},patch={})=>({reportId:'1',rrdId:'1',sku:'123',currency:'CNY',document:'Продажа',operation:'Продажа',quantity:1,title:'合成测试商品',amounts:{...zero(WB_DETAIL_MONEY),...amounts},...patch});
function scenario(){return {
 reports:[report({forPaySum:'800',deliveryServiceSum:'100',paidStorageSum:'25',deductionSum:'30',penaltySum:'5',additionalPaymentSum:'-10',cashbackAmountSum:'8',cashbackDiscountSum:'3',cashbackCommissionChangeSum:'1.6',paymentSchedule:'1',bankPaymentSum:'642.4'})],
 rows:[row({forPay:'1000',deliveryService:'80',penalty:'5',additionalPayment:'-10',cashbackAmount:'10',cashbackDiscount:'3',cashbackCommissionChange:'2',rebillLogisticCost:'70'}),row({forPay:'200',deliveryService:'20',cashbackAmount:'2',cashbackCommissionChange:'0.4'},{rrdId:'2',document:'Возврат',operation:'Возврат'}),row({paidStorage:'25',deduction:'30',paymentSchedule:'1'},{rrdId:'3',sku:'0',document:'',operation:'Удержание'})]
 };}
function snapshot(a,extra={}){return {runId:'test',complete:true,stale:false,coverage:{byCurrency:{CNY:{missingDays:[]}}},attribution:wbAttributionSummary(a),product:{sku:'123',title:'合成测试商品',attribution:a.products.get('123')},...extra};}
test('settlement bridge reconciles signed loyalty returns and fee credits without double-counting embedded costs',()=>{
 const f=scenario(),a=attributeWbFinance(f.reports,f.rows),c=a.currencies.CNY;
 assert.equal(c.matched,true);assert.equal(c.settlement.matched,true);assert.equal(c.settlement.calculated,'642.4');assert.equal(c.settlement.difference,'0');
 assert.equal(a.products.get('123').CNY.platformNet,'698.4');assert.equal(c.shared.platformNet,'-56');
 assert.equal(c.total.fields.cashbackAmount.amount,'8');assert.equal(c.total.fields.cashbackCommissionChange.amount,'1.6');
 // rebillLogisticCost is a sub-component, not an extra subtraction from the bridge.
 assert.equal(c.total.fields.rebillLogisticCost,undefined);
});
test('matching detail columns cannot conceal a bank-total mismatch or cancel opposite daily differences',()=>{
 const r1=report({forPaySum:'100',bankPaymentSum:'90'}),r2=report({forPaySum:'100',bankPaymentSum:'110'},{reportId:'2',from:'2026-10-02',to:'2026-10-02'});
 const a=attributeWbFinance([r1,r2],[row({forPay:'100'}),row({forPay:'100'},{reportId:'2'})]),c=a.currencies.CNY;
 assert.equal(c.matched,true);assert.equal(c.settlement.difference,'0');assert.equal(c.settlement.matched,false);assert.deepEqual(c.settlement.issues.map(i=>i.difference),['-10','10']);
 const s=snapshot(a);assert.equal(wbProductNet(s.product,s),'CNY 待核对');assert.match(wbSettlementPanel(s,{product:true}),/哪些日报没有对上（2）/);
});
test('matching final total is insufficient when one detailed field is mismatched',()=>{
 const f=scenario();f.reports[0].amounts.paidStorageSum='26';const a=attributeWbFinance(f.reports,f.rows);
 assert.equal(a.currencies.CNY.settlement.difference,'0');assert.equal(a.currencies.CNY.settlement.matched,false);
 assert.equal(wbProductNet(snapshot(a).product,snapshot(a)),'CNY 待核对');assert.match(wbSettlementPanel(snapshot(a)),/即使总差额为 0/);
});
test('missing fields, missing report totals and unknown nonzero loyalty document directions stay unknown',()=>{
 for(const kind of ['field','header','direction']){
  const f=scenario();if(kind==='field')delete f.rows[0].amounts.paymentSchedule;if(kind==='header')delete f.reports[0].amounts.bankPaymentSum;if(kind==='direction')f.rows[1].document='未知单据';
  const a=attributeWbFinance(f.reports,f.rows),n=a.currencies.CNY.settlement;assert.equal(n.matched,false);assert.equal(n.difference,null);assert.equal(wbProductNet(snapshot(a).product,snapshot(a)),'CNY 待核对');
 }
 const f=scenario();f.rows[1].amounts.forPay='0';f.rows[1].document='未知单据';const a=attributeWbFinance(f.reports,f.rows);assert.equal(a.products.get('123').CNY.fields.cashbackAmount.amount,null);
});
test('six-decimal precision and currencies remain independent, including negative source corrections',()=>{
 const big='9007199254740993.000001',a=attributeWbFinance([report({forPaySum:big,bankPaymentSum:big}),report({forPaySum:'0.000001',bankPaymentSum:'0.000001'},{reportId:'2',currency:'RUB'})],[row({forPay:big}),row({forPay:'-0.000001'},{reportId:'2',currency:'RUB',document:'Возврат'})]);
 assert.equal(a.currencies.CNY.settlement.calculated,big);assert.equal(a.products.get('123').RUB.platformNet,'0.000001');assert.equal(a.currencies.RUB.settlement.matched,true);
});
test('stale or partial snapshots hide reconciled SKU numbers and shared charges never become product profit',()=>{
 const f=scenario(),a=attributeWbFinance(f.reports,f.rows),s=snapshot(a);assert.equal(wbProductNet(s.product,s),'CNY 698.4');assert.match(wbSettlementPanel(s,{product:true}),/未扣商品成本/);assert.match(wbSettlementPanel(s,{product:true}),/全店还有 1 行/);
 for(const patch of [{stale:true},{complete:false},{coverage:{byCurrency:{CNY:{missingDays:['2026-10-02']}}}}]){const v={...s,...patch};assert.equal(wbProductNet(v.product,v),'CNY 待核对');assert.doesNotMatch(wbSettlementPanel(v,{product:true}),/>698\.4</);}
});
test('all daily discrepancies are counted while public evidence is bounded and escaped',()=>{
 const reports=Array.from({length:45},(_,i)=>report({forPaySum:'10',bankPaymentSum:'9'},{reportId:String(i+1)})),rows=reports.map(r=>row({forPay:'10'},{reportId:r.reportId})),a=attributeWbFinance(reports,rows),s=snapshot(a);
 assert.equal(s.attribution.currencies.CNY.settlement.issueCount,45);assert.equal(s.attribution.currencies.CNY.settlement.issues.length,30);
 s.attribution.currencies.CNY.settlement.issues[0].reportId='<img onerror=x>';const h=wbSettlementPanel(s);assert.match(h,/30 \/ 45/);assert.match(h,/&lt;img/);assert.doesNotMatch(h,/<img/);
});
test('persisted API pages recompute per-SKU settlement after a new report version and process restart',async()=>{
 const f=await settlementFixture();try{
  const v=await f.read(),reads=f.calls.length;assert.equal(wbProductNet(v.snapshot.product,v.snapshot),'CNY 698.4');assert.equal(v.snapshot.totals.CNY.bankPaymentSum,'742.4');
  f.reopen();const saved=await f.service.get(f.store,{sku:'123'});assert.equal(saved.snapshot.evidenceHash,v.snapshot.evidenceHash);assert.equal(f.calls.length,reads);assert.equal(saved.snapshot.attribution.currencies.CNY.settlement.matched,true);
  f.difference=true;const updated=await f.read();assert.equal(updated.snapshot.totals.CNY.bankPaymentSum,'742.4');assert.notEqual(updated.snapshot.evidenceHash,v.snapshot.evidenceHash);assert.equal(updated.snapshot.attribution.currencies.CNY.settlement.issueCount,2);assert.equal(wbProductNet(updated.snapshot.product,updated.snapshot),'CNY 待核对');
  assert.equal((await f.service.get({...f.store,id:'another-store'})).snapshot,null);
 }finally{await f.cleanup();}
});
