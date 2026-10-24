import test from 'node:test';import assert from 'node:assert/strict';
import {captureTaobaoSource} from '../adapters/taobao-browser.mjs';
const url='https://www.yiwugo.com/product/detail/123.html';
const html='<script>window.__INITIAL_STATE__='+JSON.stringify({c:{detail:{productDetailVO:{id:123,title:'厨房木勺商品',sellPrice:1000,maxPrice:1000,priceType:'5',picture:'https://ywgimg.yiwugo.com/product/common.jpg',detaill:'<img src="https://cbu01.alicdn.com/img/details.jpg">'},productPropertySkuBoList:[{id:456,productId:123,stock:1,price:1000,propertyValues:'木勺 1个',picture:'https://ywgimg.yiwugo.com/product/selected.jpg'}],productExtendList:[]}}})+'</script>';
test('a public supplier page captures every bound photo with selected-SKU provenance and no browser dependency',async()=>{
 const downloaded=[],events=[];let saved=0;const r=await captureTaobaoSource(url,{platform:'linux',fetchPage:async()=>html,download:async u=>{downloaded.push(u);return Buffer.from(u);},save:async()=>({assetId:String(++saved).repeat(64)}),onProgress:async p=>events.push(p),script:async()=>assert.fail('public page must not access Chrome')});
 assert.equal(r.capture.method,'https');assert.equal(r.capture.selectionPolicy,'first-available');assert.equal(r.evidence.skuId,'456');assert.deepEqual(r.evidence.displayedPrices,[10]);assert.equal(r.files.length,3);assert.deepEqual(downloaded,r.evidence.mediaInventory.map(i=>i.url));assert.equal(events.at(-1).downloadedFiles,3);
});
test('a failed photo capture never returns a seemingly complete partial supplier gallery',async()=>{
 await assert.rejects(captureTaobaoSource(url,{platform:'linux',fetchPage:async()=>html,download:async()=>{throw Error('unavailable photo');},script:async()=>assert.fail('unsupported platform')}),/браузерную загрузку/);
});
