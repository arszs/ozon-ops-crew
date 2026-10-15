import test from 'node:test';import assert from 'node:assert/strict';
import {forecast,portfolio,validateProducts,importSalesCSV} from '../web/planning.mjs';
import {evaluate,defaults,validatePolicy} from '../web/engine.mjs';import {demoProducts} from '../web/demo.mjs';
test('ads without sales stop even below minimum sample size',()=>{const p={...demoProducts[0],sales:[],unallocatedAds:501};const r=evaluate(p,defaults);assert.equal(r.reason,'ads');assert.equal(r.net,-501);assert.equal(r.adBudget,0);});
test('portfolio budgets never exceed store cap or individual request',()=>{const rows=portfolio(demoProducts,defaults,{},51.01);assert.ok(rows.reduce((s,r)=>s+r.adBudget,0)<=51.01);assert.ok(rows.every(r=>r.adBudget<=r.requestedBudget));});
test('store pause freezes prices and all budgets',()=>{const rows=portfolio(demoProducts,defaults,{},2000,true);rows.forEach((r,i)=>{assert.equal(r.adBudget,0);assert.equal(r.proposedPrice,demoProducts[i].price);});});
test('delivery prevents stockout only from arrival date',()=>{const p={...demoProducts[0],stock:2,dailyDemand:2,incomingDays:3,incomingQty:10,storageDay:1};const f=forecast(p,4);assert.equal(f.firstStockout,2);assert.equal(f.missed,2);assert.equal(f.endingStock,6);assert.equal(f.storage,14);});
test('delivery outside horizon cannot reduce purchase need',()=>{assert.equal(forecast({...demoProducts[0],stock:0,dailyDemand:1,incomingQty:100,incomingDays:40},30).reorderQty,30);});
test('CSV is idempotent and includes ad-only expense',()=>{const text='sku,revenue_rub,total_cost_rub,allocated_ads_rub,settled,unallocated_ads_rub\nCN-001,100,80,10,1,0\nCN-001,0,0,0,1,30';const a=importSalesCSV(text,demoProducts);assert.equal(a[0].sales.length,1);assert.equal(evaluate(a[0],defaults).net,-20);assert.deepEqual(importSalesCSV(text,a),a);});
test('invalid CSV import leaves source intact',()=>{const before=JSON.stringify(demoProducts);assert.throws(()=>importSalesCSV('sku,revenue_rub,total_cost_rub,allocated_ads_rub,settled,unallocated_ads_rub\nCN-001,1,2,3,1,0\nCN-999,1,2,3,1,0',demoProducts));assert.equal(JSON.stringify(demoProducts),before);});
test('malicious identifiers, duplicate SKUs and bad commissions rejected',()=>{assert.throws(()=>validateProducts([{...demoProducts[0],id:'<img src=x>'}]));assert.throws(()=>validateProducts([demoProducts[0],demoProducts[0]]));assert.throws(()=>validateProducts([{...demoProducts[0],commission:1}]));});
test('horizon bounded to protect forecast and requires whole days',()=>{assert.throws(()=>validatePolicy({...defaults,horizon:366}));assert.throws(()=>validatePolicy({...defaults,horizon:2.5}));});
test('rounded price never violates configured step',()=>{const p={...demoProducts[2],price:4290.01};const r=evaluate(p,defaults);assert.ok(Math.abs(r.proposedPrice/p.price-1)*100<=defaults.maxPriceChange+1e-7);});

test('ad assumptions survive workspace validation round-trip',()=>{
 const round=validateProducts(structuredClone(demoProducts));
 const cn4=round.find(p=>p.id==='CN-004');
 assert.equal(cn4.cpa,200);assert.equal(cn4.maxOrders,6);assert.equal(cn4.incrementality,0.7);
 const stripped=validateProducts([{...structuredClone(demoProducts[0]),cpa:undefined}]);
 assert.equal(stripped[0].cpa,undefined);
 assert.throws(()=>validateProducts([{...structuredClone(demoProducts[0]),incrementality:1.5}]));
});

test('legacy product costs migrate once and direct costs take precedence',()=>{
 const legacy={...demoProducts[0],purchaseCny:62,fx:12.5,inbound:160};delete legacy.unitCost;
 const [migrated]=validateProducts([legacy]);assert.equal(migrated.unitCost,775);assert.equal(migrated.inbound,undefined);assert.equal(migrated.fx,undefined);assert.deepEqual(validateProducts([migrated])[0],migrated);
 assert.equal(validateProducts([{...legacy,unitCost:900}])[0].unitCost,900);
});
