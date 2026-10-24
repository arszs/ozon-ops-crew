import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierSource,supplierProductURL} from '../core/supplier-source.mjs';
import {embeddedJSONObject,parseYiwugoPage} from '../core/supplier-pages.mjs';
import {parseSavedPage,importSavedPage,assessPageExtraction} from '../core/page-import.mjs';
import {sourceMediaInventory} from '../core/source-media.mjs';
import {canonical} from '../core/canonical.mjs';
const url='https://www.yiwugo.com/product/detail/979863471.html';
function fixture({sku=true,tiers=false}={}){return '<script>window.__INITIAL_STATE__ = '+JSON.stringify({csrf:'must-not-enter-product-evidence',c:{shop:{phone:'private-shop-contact'},detail:{productDetailVO:{id:979863471,title:'木质厨房锅铲',picture:'http://ywgimg.yiwugo.com/product/common.jpg',sellPrice:165,maxPrice:tiers?185:1000,priceType:tiers?'1':'5',freight:0,freedelivery:0,startNumber:tiers?480:1,metric:'个',detaill:'<p>木质锅铲，手柄长度33.5厘米。</p><img src="https://cbu01.alicdn.com/img/detail.jpg">'},productExtendList:[{name:'材质',value:'木质'},{name:'品牌',value:'奥栖'}],productPropertySkuBoList:sku?[{id:10,productId:979863471,price:1000,stock:10,propertyValues:'木铲33.5cm约80g',picture:'http://ywgimg.yiwugo.com/product/selected.jpg'},{id:11,productId:979863471,price:600,stock:0,propertyValues:'木勺26cm',picture:'http://ywgimg.yiwugo.com/product/spoon.jpg'}]:[],sdiProductsPicList:[],sdiProductsPriceList:tiers?[{productId:979863471,startNumber:48000,sellPrice:165},{productId:979863471,startNumber:480,sellPrice:185},{productId:979863471,startNumber:4800,sellPrice:175}]:[]}}})+'; globalThis.untrustedExecution=true;</script>';}
test('supplier product URLs normalize mobile shares and tracking without allowing login or unrelated hosts',()=>{
 assert.equal(supplierProductURL(url+'?loc=2&skuId=10'),url+'?skuId=10');assert.equal(supplierProductURL('https://m.yiwugo.com/product/detail/979863471.html?loc=7'),url);
 assert.equal(supplierProductURL('https://m.1688.com/offer/12345.html?spm=tracking&skuId=678'),'https://detail.1688.com/offer/12345.html?skuId=678');
 assert.equal(supplierSource(url).platform,'yiwugo');assert.equal(supplierSource('https://detail.1688.com/offer/12345.html').itemId,'12345');
 for(const u of ['https://yiwugo.com.evil.test/product/detail/1.html','http://www.yiwugo.com/product/detail/1.html','https://user:password@www.yiwugo.com/product/detail/1.html','https://login.taobao.com/?id=1','https://127.0.0.1/product/detail/1.html','https://www.yiwugo.com/product/detail/1.html?skuId=invalid'])assert.throws(()=>supplierProductURL(u));
});
test('Yiwugo selects one available SKU, converts fen, and keeps only source product data',()=>{
 const e=parseSavedPage(fixture(),{sourceUrl:url});assert.equal(e.sourcePlatform,'yiwugo');assert.equal(e.skuId,'10');assert.deepEqual(e.displayedPrices,[10]);assert.deepEqual(e.selectedVariants,['木铲33.5cm约80g']);assert.equal(e.selectionPolicy,'first-available');assert.equal(e.sourceUrl,url+'?skuId=10');
 assert.equal(e.mediaInventory.filter(i=>i.selected).length,1);assert.equal(e.mediaInventory[0].url,'https://ywgimg.yiwugo.com/product/selected.jpg');assert.equal(e.mediaInventory.at(-1).role,'detail');assert.ok(!JSON.stringify(e).includes('private-shop-contact'));assert.ok(!JSON.stringify(e).includes('must-not-enter-product-evidence'));assert.ok(!e.text.includes('快递: 免运费'));assert.equal(globalThis.untrustedExecution,undefined);
 assert.deepEqual(sourceMediaInventory(fixture()),e.mediaInventory);
});
test('Yiwugo identity and unavailable variants are held, never silently replaced',()=>{
 assert.throws(()=>parseYiwugoPage(fixture(),{sourceUrl:url.replace('979863471','999')}),/не соответствует/);
 assert.throws(()=>parseYiwugoPage(fixture(),{sourceUrl:url+'?skuId=999'}),/не найден/);
 const e=parseYiwugoPage(fixture(),{sourceUrl:url+'?skuId=11'});assert.equal(e.skuId,'11');assert.equal(e.variantOptions[1].available,false);
});
test('wholesale tier prices use the smallest purchase threshold, not the cheapest bulk quote',()=>{
 const e=parseYiwugoPage(fixture({sku:false,tiers:true}),{sourceUrl:url});assert.deepEqual(e.displayedPrices,[1.85]);assert.equal(e.minimumOrderQuantity,480);assert.ok(e.text.includes('商品单价：1.85 CNY'));
});
test('embedded supplier state uses JSON parsing and rejects executable object literals',()=>{
 assert.equal(embeddedJSONObject('window.__INITIAL_STATE__={get x(){throw 1}};','window.__INITIAL_STATE__'),null);
 assert.deepEqual(embeddedJSONObject('window.__INITIAL_STATE__={"x":"} text {"};','window.__INITIAL_STATE__'),{x:'} text {'});
});
test('Yiwugo extraction enters the shared pipeline with a distinct seller SKU namespace and platform',async()=>{
 const r=await importSavedPage(fixture(),{sourceUrl:url,local:async()=>({provider:'test',output:{titleZh:'木质厨房锅铲',categoryZh:'锅铲',brand:'奥栖',brandEvidence:'品牌：奥栖',selectedVariant:'木铲33.5cm约80g',price:{amount:10,currency:'CNY',evidence:'商品单价：10.00 CNY'},attributes:[{nameZh:'材质',valueZh:'木质',evidence:'材质：木质'}],localized:{title:'Деревянная кухонная лопатка',description:'Кухонная лопатка из дерева.',attributes:[{name:'Материал',value:'Дерево'}],seo:[],warnings:[]}}}),loadImage:async()=>({width:800,height:800})});
 assert.equal(r.state,'ready');assert.equal(r.product.sku,'YWG-979863471-10');assert.equal(canonical(r.product).source.platform,'yiwugo');assert.equal(r.product.price,10);
});
test('a large variant catalogue stays archived without overflowing or contaminating the extraction prompt',async()=>{
 const state=embeddedJSONObject(fixture(),'window.__INITIAL_STATE__');for(let i=0;i<300;i++)state.c.detail.productPropertySkuBoList.push({id:100+i,productId:979863471,price:100,stock:0,propertyValues:'DO_NOT_SEND_UNSELECTED_'+i+'x'.repeat(400)});
 let calls=0;const r=await importSavedPage('<script>window.__INITIAL_STATE__='+JSON.stringify(state)+'</script>',{sourceUrl:url,fallback:'none',local:async({prompt})=>{calls++;assert.ok(prompt.length<10000);assert.ok(!prompt.includes('DO_NOT_SEND_UNSELECTED_'));throw Error('test stops before generation');}});assert.equal(calls,1);assert.equal(r.state,'needs_review');assert.equal(r.evidence.variantOptions.length,302);
});
test('a wholesale procurement minimum cannot become the number of items in a customer package',()=>{
 const e=parseYiwugoPage(fixture({sku:false,tiers:true}),{sourceUrl:url});
 const issues=assessPageExtraction({titleZh:e.title,categoryZh:'文具',brand:'',selectedVariant:e.selectedVariants[0],price:{amount:1.85,currency:'CNY',evidence:'商品单价：1.85 CNY'},attributes:[{nameZh:'包装数量',valueZh:'480',evidence:'起订量：480个'}],localized:{title:'Канцелярский товар',description:'Описание',attributes:[],seo:[],warnings:[]}},e);assert.ok(issues.includes('minimum_order_is_not_package_contents'));
});
