import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {catalogueProduct,readOzonCatalogue} from '../adapters/ozon-catalogue.mjs';
import {storeCredentials} from '../adapters/marketplaces.mjs';
import {ozonCall} from '../adapters/ozon-products.mjs';
import {Workspace} from '../core/workspace.mjs';
import {storeProductView,skuEconomy} from '../web/sku-economy.mjs';
const store={id:'other',name:'Other',marketplace:'ozon',mode:'live'};
const product=id=>({id,sku:id+1000,offer_id:'merchant-'+id,name:'Item '+id,price:'1200.50',currency_code:'CNY'});
test('catalogue pagination hydrates every product and keeps product, merchant and SKU identities separate',async()=>{
 const requests=[];const result=await readOzonCatalogue(store,{call:async(s,path,body)=>{assert.equal(s.id,'other');requests.push({path,body});if(path==='/v3/product/list')return {result:{total:101,last_id:body.last_id?'':'next',items:Array.from({length:body.last_id?1:100},(_,i)=>({product_id:body.last_id?101:i+1}))}};return {items:body.product_id.map(n=>product(Number(n)))};}});
 assert.equal(result.products.length,101);assert.equal(result.catalogueComplete,true);assert.equal(result.products[0].sku,'1001');assert.equal(result.products[0].productId,'1');assert.equal(result.products[0].offerId,'merchant-1');assert.equal(result.products[0].currency,'CNY');assert.equal(result.products[0].stock,null);assert.equal(result.orderedAmount,null);assert.equal(requests.filter(r=>r.path.endsWith('info/list')).length,2);
 const data={stores:[{...store,snapshot:result}]};assert.equal(storeProductView(data,'other').rows[0].sku,'1001');assert.ok(skuEconomy(null,data,'other').includes('data-observe-sku="1001"'));
});
test('catalogue normalization preserves unknowns and independently associates stock with each SKU',()=>{
 const rows=catalogueProduct({...product(1),sku:0,sources:[{sku:11},{sku:12},{sku:11}],stocks:{stocks:[{sku:11,present:0},{sku:11,present:3},{sku:12,present:null}]}});
 assert.deepEqual(rows.map(p=>[p.sku,p.stock]),[['11',3],['12',null]]);const missing=catalogueProduct({id:3,price:null});assert.equal(missing[0].sku,null);assert.equal(missing[0].price,null);assert.equal(missing[0].currency,null);for(const price of [false,'bad',-1,Infinity])assert.throws(()=>catalogueProduct({...product(1),price}));
});
test('missing, foreign, duplicate details and conflicting SKU identities reject the snapshot',async()=>{
 for(const items of [[],[product(99)],[product(1),product(1)],[product(1),{...product(2),sku:1001}]])await assert.rejects(()=>readOzonCatalogue(store,{call:async(_s,path)=>path==='/v3/product/list'?{result:{total:2,items:[{product_id:1},{product_id:2}]}}:{items}}));
});
test('secondary Ozon calls use only their own complete env file, never inherited primary credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-scoped-'));const oldClient=process.env.OZON_CLIENT_ID,oldKey=process.env.OZON_API_KEY;process.env.OZON_CLIENT_ID='primary';process.env.OZON_API_KEY='primary-key';let calls=0;
 try{assert.deepEqual(await storeCredentials(store),{});const file=join(dir,'store.env');await writeFile(file,'OZON_CLIENT_ID=secondary\n');await assert.rejects(()=>ozonCall({...store,envFile:file},'/v3/product/list',{}, {fetcher:async()=>{calls++;}}),/credentials missing/);assert.equal(calls,0);await writeFile(file,'OZON_CLIENT_ID=secondary\nOZON_API_KEY=secondary-key\n');await ozonCall({...store,envFile:file},'/v3/product/list',{}, {fetcher:async(url,options)=>{assert.equal(options.headers['Client-Id'],'secondary');assert.equal(options.headers['Api-Key'],'secondary-key');return {ok:true,json:async()=>({result:{items:[],total:0}})};}});
 }finally{if(oldClient===undefined)delete process.env.OZON_CLIENT_ID;else process.env.OZON_CLIENT_ID=oldClient;if(oldKey===undefined)delete process.env.OZON_API_KEY;else process.env.OZON_API_KEY=oldKey;await rm(dir,{recursive:true,force:true});}
});
test('failed store synchronization preserves prior snapshot and does not claim a successful audit event',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ops-sync-'));try{let fail=false;const ws=new Workspace(join(dir,'db.json'),{stores:[store],storeReader:async()=>{if(fail)throw Error('ozon_product_details_incomplete');return {mode:'live',products:[{...product(1),sku:'1001'}],source:'test'};}});await ws.init();const previous=await ws.synchronize(store.id);fail=true;await assert.rejects(()=>ws.synchronize(store.id));const db=await ws.repo.read();assert.deepEqual(db.stores.find(s=>s.id===store.id).snapshot,previous);assert.equal(db.audit.filter(e=>e.kind==='store.sync').length,1);}finally{await rm(dir,{recursive:true,force:true});}
});
test('available stock subtracts known reservations and never treats missing or fractional reserves as zero',()=>{const row=stock=>catalogueProduct({...product(1),stocks:{stocks:[{sku:1001,...stock}]}})[0];assert.equal(row({present:10,reserved:3}).availableStock,7);assert.equal(row({present:10}).availableStock,null);assert.equal(row({present:10,reserved:.5}).availableStock,null);assert.equal(row({present:0,reserved:0}).availableStock,0);});
