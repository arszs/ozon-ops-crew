import test from 'node:test';import assert from 'node:assert/strict';
import {ozonBuyerIdentity,inspectOzonListing} from '../adapters/ozon-listing-check.mjs';
test('buyer links use marketplace SKU and never fall back to Seller API product_id',()=>{assert.equal(ozonBuyerIdentity({id:6722100484,sku:6125599480}).buyerUrl,'https://www.ozon.ru/product/6125599480/');assert.equal(ozonBuyerIdentity({id:6722100484}).buyerUrl,null);assert.equal(ozonBuyerIdentity({sources:[{sku:12},{sku:13}]}).buyerUrl,null);});
test('no available stock is reported separately from missing delivery methods and unknown totals',async()=>{const r=await inspectOzonListing({}, {canonical:{sku:'offer'},importResult:{productId:10}}, {call:async(store,path,body)=>{
 if(path==='/v3/product/info/list')return {items:[{id:10,offer_id:'offer',sku:99,stocks:{has_stock:false,stocks:[]},images:[]}]};
 if(path==='/v2/warehouse/list')return {warehouses:[{warehouse_id:123,name:'Own',status:'created',warehouse_type:'rfbs'}]};
 if(path==='/v2/delivery-method/list')return {delivery_methods:[{id:5,name:'OGL',warehouse_id:123,status:'ACTIVE'}]};
 if(path==='/v1/product/info/description')return {result:{description:'Text'}};return {items:[]};}});assert.equal(r.present,null);assert.equal(r.hasStock,false);assert.deepEqual(r.blockers,['no_stock']);assert.equal(r.deliveryMethods.length,1);assert.ok(!JSON.stringify(r.warehouses).includes('phone'));});
