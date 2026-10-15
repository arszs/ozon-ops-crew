import test from 'node:test';
import assert from 'node:assert/strict';
import {apiNumber,lastCompleteWeek,summarizeAccruals,normalizeAdReports} from '../live-data.mjs';
import {performanceReadAllowed} from '../performance.mjs';
import {sellerRead} from '../ozon.mjs';
const m=(amount,currency='RUB')=>({amount:String(amount),currency});
test('finance reconciles direct SKU amounts, store charges and currencies without duplication',()=>{
 const a={accrual_id:1,date:'2026-10-11',total_amount:m(650),posting:{products:[{sku:1,commission:{sale_amount:m(1000),commission:m(-300)},delivery:{total_accrued:m(-50)}}]}};
 const b={accrual_id:2,date:'2026-10-11',total_amount:m(-75),item_fees:{fees:[{sku:2,fees:[{accrued:m(-75)}]}]}};
 const c={accrual_id:3,date:'2026-10-11',total_amount:m(-100),non_item_fee:{accrued:m(-100)}};
 const d={accrual_id:4,date:'2026-10-11',total_amount:m(-2,'CNY')};
 const s=summarizeAccruals([a,b,c,d,a]);assert.deepEqual(s.totals,{RUB:475,CNY:-2});assert.deepEqual(s.bySku,{'1':{RUB:650},'2':{RUB:-75}});assert.deepEqual(s.unallocated,{RUB:-100,CNY:-2});assert.equal(s.count,4);
});
test('unknown allocation remains explicitly unallocated, not spread across products',()=>{
 const s=summarizeAccruals([{accrual_id:1,date:'2026-10-11',total_amount:m(100),posting:{products:[{sku:1,commission:{sale_amount:m(150),commission:m(-20)}}]}}]);assert.equal(s.unallocated.RUB,-30);assert.equal(s.bySku['1'].RUB,130);
});
test('advertising reports do not double-count CPC columns repeated in CPO',()=>{
 const cpc={'10':{report:{totals:{moneySpent:'12,50'},rows:[{sku:'20',moneySpent:'12,50',orders:'1',ordersMoney:'100'}]}}};
 const cpo={rows:[{SKU:'20',MoneySpent:'7,50',MoneySpentFromCPC:'12,50',Orders:'2',OrdersMoney:'200'}]};
 const r=normalizeAdReports(cpc,cpo);assert.equal(r.totalSpend,20);assert.equal(r.bySku['20'].cpcSpend+r.bySku['20'].cpoSpend,20);assert.equal(r.bySku['20'].cpoOrders,2);
});
test('API number parser rejects missing and malformed amounts instead of fabricating zero',()=>{assert.equal(apiNumber('1 234,56'),1234.56);for(const x of [null,undefined,'','-','nan',Infinity])assert.throws(()=>apiNumber(x));});
test('report period uses complete Moscow days at month boundary',()=>{assert.deepEqual(lastCompleteWeek(new Date('2026-09-30T22:00:00Z')),{from:'2026-09-24',to:'2026-09-30',timezone:'Europe/Moscow'});});
test('live adapters reject price, bid, activation and arbitrary endpoint writes',async()=>{
 for(const p of ['/api/client/campaign/1/activate','/api/client/campaign/1/products','https://example.com'])for(const method of ['GET','POST','PUT'])assert.equal(performanceReadAllowed(p,method),false);
 assert.equal(performanceReadAllowed('/api/client/statistics/json','POST'),true);
 await assert.rejects(sellerRead('/v1/product/import/prices',{}),/not_allowed/);
});
