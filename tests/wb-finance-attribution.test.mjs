import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {attributeWbFinance,wbAttributionSummary,WB_RECONCILE_FIELDS} from '../core/wb-finance-attribution.mjs';
import {WbFinanceService} from '../core/wb-finance-service.mjs';
import {WB_DETAIL_MONEY,WB_REPORT_FIELDS,normalizeWbReport,normalizeWbFinanceRow} from '../adapters/wb-finance.mjs';
import {wbAttributionPanel,wbGoodsAmount} from '../web/wb-finance-attribution.mjs';

const range={from:'2026-10-01',to:'2026-10-02'},store={id:'wb-attribution',marketplace:'wb',mode:'live',wbRegion:'cn'};
const zeros=keys=>Object.fromEntries(keys.map(k=>[k,'0']));
function report(id='1',currency='CNY',patch={}){return {reportId:id,from:'2026-10-01',to:'2026-10-01',currency,reportType:1,amounts:{...zeros(WB_REPORT_FIELDS),...patch}};}
function row(sku='123',patch={},extra={}){return {reportId:'1',rrdId:'1',sku,currency:'CNY',document:'Продажа',operation:'Продажа',quantity:1,title:'合成测试商品',amounts:{...zeros(WB_DETAIL_MONEY),...patch},...extra};}

test('SKU goods subtract return documents, preserve signed corrections and never add nested fees or ads',()=>{
 const r=report('1','CNY',{forPaySum:'75.125',retailAmountSum:'100',deliveryServiceSum:'9',deductionSum:'8',bankPaymentSum:'999'});
 const rows=[row('123',{forPay:'100.125',retailAmount:'125',deliveryService:'6'}),row('123',{forPay:'25',retailAmount:'25',deliveryService:'3'},{document:'Возврат',operation:'Возврат'}),row('0',{deduction:'10'}),row('0',{deduction:'-2'},{document:''})];
 const a=attributeWbFinance([r],rows),c=a.currencies.CNY,p=a.products.get('123').CNY;
 assert.equal(p.fields.forPay.amount,'75.125');assert.equal(c.shared.fields.deduction.amount,'8');assert.equal(c.assigned.fields.deliveryService.amount,'9');assert.equal(c.matched,true);
 assert.equal(c.total.fields.forPay.amount,'75.125');assert.equal(c.total.fields.bankPaymentSum,undefined);assert.equal(p.fields.adSpend,undefined);
 const correction=attributeWbFinance([report('1','CNY',{forPaySum:'5'})],[row('123',{forPay:'-5'},{document:'Возврат'})]);assert.equal(correction.products.get('123').CNY.fields.forPay.amount,'5');
});
test('equal and opposite report mismatches cannot cancel across days',()=>{
 const r1=report('1','CNY',{forPaySum:'100'}),r2={...report('2','CNY',{forPaySum:'100'}),from:'2026-10-02',to:'2026-10-02'};
 const a=attributeWbFinance([r1,r2],[row('123',{forPay:'90'}),row('123',{forPay:'110'},{reportId:'2'})]);
 assert.equal(a.currencies.CNY.total.fields.forPay.amount,'200');assert.equal(a.currencies.CNY.goodsMatched,false);
 assert.deepEqual(a.currencies.CNY.issues.map(i=>i.difference),['10','-10']);
});
test('unknown document signs remain unknown even when unsigned values cancel',()=>{
 const a=attributeWbFinance([report()],[row('123',{forPay:'10'},{document:'新业务'}),row('123',{forPay:'-10'},{document:'新业务'})]);
 assert.equal(a.products.get('123').CNY.fields.forPay.amount,null);assert.equal(a.products.get('123').CNY.fields.forPay.unknownRows,2);assert.equal(a.currencies.CNY.goodsMatched,false);assert.equal(a.currencies.CNY.issues.find(i=>i.field==='forPay').difference,null);
 const zero=attributeWbFinance([report()],[row('123',{}, {document:''})]);assert.equal(zero.currencies.CNY.goodsMatched,true);
});
test('legacy missing paymentSchedule and a report without details never imply known zero',()=>{
 const old=row();delete old.amounts.paymentSchedule;
 const a=attributeWbFinance([report()],[old]);assert.equal(a.currencies.CNY.matched,false);assert.equal(a.currencies.CNY.issues[0].field,'paymentSchedule');assert.equal(a.products.get('123').CNY.fields.paymentSchedule.amount,null);
 const empty=attributeWbFinance([report()],[]);assert.equal(empty.currencies.CNY.total.fields.forPay.amount,null);assert.equal(empty.currencies.CNY.goodsMatched,false);assert.equal(empty.products.size,0);
 assert.deepEqual(attributeWbFinance([],[]).currencies,{});
});
test('precision, currencies, unassigned rows and unknown SKU stay separate',()=>{
 const large='9007199254740993.000001';
 const a=attributeWbFinance([report('1','CNY',{forPaySum:large}),report('2','RUB',{forPaySum:'2'})],[row('123',{forPay:large}),row('0',{forPay:'2'},{currency:'RUB',reportId:'2'})]);
 assert.equal(a.products.get('123').CNY.fields.forPay.amount,large);assert.equal(a.products.get('123').RUB,undefined);assert.equal(a.products.has('0'),false);assert.equal(a.products.has('999'),false);
 assert.equal(a.currencies.RUB.shared.fields.forPay.amount,'2');assert.equal(a.currencies.RUB.assigned.fields.forPay.amount,null);
 assert.throws(()=>attributeWbFinance([report()],[row('123',{}, {currency:'RUB'})]),/不匹配/);
});
test('report-field differences include every field independently and public evidence is bounded',()=>{
 const reports=Array.from({length:40},(_,i)=>report(String(i+1),'CNY',{forPaySum:'1'})),rows=reports.map(r=>row('123',{}, {reportId:r.reportId}));
 const s=wbAttributionSummary(attributeWbFinance(reports,rows));assert.equal(s.currencies.CNY.issueCount,40);assert.equal(s.currencies.CNY.issues.length,30);assert.equal(s.currencies.CNY.reports,40);
 for(const [field,header] of Object.entries(WB_RECONCILE_FIELDS)){
  const a=attributeWbFinance([report('1','CNY',{[header]:'1'})],[row('123',{[field]:'0.999999'})]);assert.equal(a.currencies.CNY.matched,false);assert.equal(a.currencies.CNY.issues[0].difference,'0.000001');
 }
});
test('Chinese UI distinguishes goods, shared charges, stale coverage and raw fields without script injection',()=>{
 const a=attributeWbFinance([report('1','CNY',{forPaySum:'100'})],[row('123',{forPay:'100'}),row('0',{deduction:'3'})]);
 const s={attribution:wbAttributionSummary(a),product:{lines:1,attribution:a.products.get('123')},stale:true,complete:false,coverage:{byCurrency:{CNY:{missingDays:['2026-10-02']}}}};
 const html=wbAttributionPanel(s,{product:true});assert.match(html,/CNY 100/);assert.match(html,/不是利润或到账金额/);assert.match(html,/全店未分配到商品/);assert.match(html,/旧快照/);assert.match(html,/读取未完成/);assert.match(html,/部分日期缺报表/);assert.match(html,/不按销量自动摊/);
 s.attribution.currencies.CNY.issues[0].reportId='<script>alert(1)</script>';assert.doesNotMatch(wbAttributionPanel(s),/<script>/);
 assert.equal(wbGoodsAmount({attribution:{}}),'—');
});
test('service reads current field selection, invalidates attribution on new pages, retains old source and isolates accounts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wb-attribution-'));let now=Date.parse('2026-10-13T00:00:00Z'),owner='a',n=0,release;
 const gate=new Promise(r=>release=r),rawReport={...zeros(WB_REPORT_FIELDS),reportId:'1',dateFrom:range.from,dateTo:range.from,currency:'CNY',reportType:1,forPaySum:'80'},rawRow={...zeros(WB_DETAIL_MONEY),reportId:'1',rrdId:'1',nmId:'123',dateFrom:range.from,dateTo:range.from,currency:'CNY',title:'合成测试商品',vendorCode:'SYNTHETIC',docTypeName:'Продажа',sellerOperName:'Продажа',quantity:1,forPay:'100'};
 const s=new WbFinanceService(join(dir,'f.sqlite'),{clock:()=>now,accountRef:async()=>owner,sleep:async ms=>{now+=ms;},read:async()=>{
  n++;if(n===1)return {status:200,rows:[rawReport]};if(n===2)return {status:204,rows:[]};if(n===3)return {status:200,rows:[rawRow]};if(n===4){await gate;return {status:200,rows:[{...rawRow,rrdId:'2',docTypeName:'Возврат',sellerOperName:'Возврат',forPay:'20'}]};}return {status:204,rows:[]};
 }});
 t.after(async()=>{release();await s.wait(store.id);s.close();await rm(dir,{recursive:true,force:true});});
 await s.start(store,range);while(n<4)await new Promise(r=>setImmediate(r));
 const partial=await s.get(store,{sku:'123'});assert.equal(partial.snapshot.product.attribution.CNY.fields.forPay.amount,'100');assert.equal(partial.snapshot.attribution.currencies.CNY.goodsMatched,false);
 release();await s.wait(store.id);const full=await s.get(store,{sku:'123'});assert.equal(full.snapshot.product.attribution.CNY.fields.forPay.amount,'80');assert.equal(full.snapshot.attribution.currencies.CNY.goodsMatched,true);assert.equal(full.snapshot.products[0].attribution.CNY.fields.forPay.amount,'80');
 assert.equal((await s.get(store,{sku:'999'})).snapshot.product.attribution.CNY,undefined);
 s.read=async()=>{throw Error('offline');};await s.start(store,{...range,restart:true});await s.wait(store.id);const stale=await s.get(store,{sku:'123'});assert.equal(stale.snapshot.stale,true);assert.equal(stale.snapshot.product.attribution.CNY.fields.forPay.amount,'80');assert.equal(stale.snapshot.runId,full.snapshot.runId);
 owner='b';assert.equal((await s.get(store,{sku:'123'})).snapshot,null);
 const normalized=normalizeWbFinanceRow({...rawRow,paymentSchedule:'-0.125'},new Map([['1',normalizeWbReport(rawReport,range)]]));assert.equal(normalized.amounts.paymentSchedule,'-0.125');
});
