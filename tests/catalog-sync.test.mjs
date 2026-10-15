import test from 'node:test';import assert from 'node:assert/strict';
import {fullCatalog} from '../ozon.mjs';
import {synchronizeLive} from '../live-data.mjs';
test('catalog cursor pagination deduplicates overlapping products and rejects loops or changing totals',async()=>{
 let count=0;const c=await fullCatalog({read:async(path,b)=>{assert.equal(path,'/v3/product/list');assert.equal(b.limit,100);count++;return {result:count===1?{total:3,items:[{product_id:1},{product_id:2}],last_id:'next'}:{total:3,items:[{product_id:2},{product_id:3}],last_id:'end'}};}});assert.equal(c.items.length,3);assert.equal(count,2);
 await assert.rejects(()=>fullCatalog({read:async()=>({result:{total:2,items:[{product_id:1}],last_id:'same'}})}),/incomplete_pagination/);
 let calls=0;await assert.rejects(()=>fullCatalog({read:async()=>({result:{total:++calls===1?2:3,items:[{product_id:1}],last_id:'next'}})}),/changed_during_sync/);
 await assert.rejects(()=>fullCatalog({read:async()=>({})}),/catalog_schema/);
});
test('catalog-only SKU remains visible without analytics, finance or ads; missing stock is unknown',async()=>{
 const s=await synchronizeLive(()=>{},{catalogue:async()=>({total:1,items:[{productId:42}]}),seller:async(path,body)=>{if(path!=='/v3/product/info/list')throw Error('unavailable');assert.deepEqual(body,{product_id:['42']});return {items:[{id:42,sku:123,offer_id:'new',name:'New product',price:'1500',currency_code:'RUB'}]};},performance:async()=>{throw Error('unavailable');}});
 assert.equal(s.rows.length,1);assert.equal(s.rows[0].sku,'123');assert.equal(s.rows[0].price,1500);for(const k of ['stock','orderRevenue','orderedUnits','adSpend','netAccrued'])assert.equal(s.rows[0][k],null);assert.equal(s.sources.catalogProducts.ok,true);
});
test('products missing SKU are counted, not fabricated as undefined or zero identifiers',async()=>{
 const s=await synchronizeLive(()=>{},{catalogue:async()=>({total:1,items:[{productId:42}]}),seller:async path=>{if(path!=='/v3/product/info/list')throw Error('unavailable');return {items:[{id:42,sku:0,sources:[{}],price:'1500'}]};},performance:async()=>{throw Error('unavailable');}});assert.equal(s.rows.length,0);assert.equal(s.catalogProductsWithoutSku,1);
});

test('oversized live catalogue stops after the first page with explicit capacity status',async()=>{let calls=0;await assert.rejects(()=>fullCatalog({read:async()=>{calls++;return {result:{total:10001,items:[{product_id:1}],last_id:'next'}};}}),/catalog_capacity_exceeded/);assert.equal(calls,1);});
test('dashboard counts a large catalogue once and hydrates only activity SKUs',async()=>{const requests=[];const s=await synchronizeLive(()=>{},{seller:async(path,body)=>{requests.push({path,body});if(path==='/v3/product/list')return {result:{total:200000,items:[{product_id:99}],last_id:'next'}};if(path==='/v1/analytics/data')return {result:{data:[{dimensions:[{id:'101',name:'Product'}],metrics:[100,1]}],totals:[100,1]}};if(path==='/v3/product/info/list')return {items:[{id:1,sku:101,price:'100',currency_code:'RUB'}]};throw Error('fixture_unavailable');},performance:async()=>{throw Error('fixture_unavailable');},report:async()=>{throw Error('fixture_unavailable');}});assert.equal(s.catalogTotal,200000);assert.equal(s.catalogCoverage,'count_only');assert.equal(s.sources.catalog.ok,true);assert.equal(s.rows.length,1);assert.equal(requests.filter(r=>r.path==='/v3/product/list').length,1);assert.equal(requests.find(r=>r.path==='/v3/product/list').body.limit,1);assert.deepEqual(requests.find(r=>r.path==='/v3/product/info/list').body,{sku:['101']});assert.equal(s.orders.amount,100);});
