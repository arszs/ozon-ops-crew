import test from 'node:test';import assert from 'node:assert/strict';
import {taobaoVariants}from'../core/taobao-variants.mjs';import{parseSavedPage}from'../core/page-import.mjs';
const data={skuBase:{props:[{pid:'1',name:'颜色',values:[{vid:'11',name:'白色'}]},{pid:'2',name:'存储',values:[{vid:'22',name:'无'},{vid:'23',name:'32GB'}]}],skus:[{skuId:'456',propPath:'1:11;2:22'},{skuId:'457',propPath:'1:11;2:23'}]},skuCore:{sku2info:{456:{quantity:4},457:{quantity:0}}}};
const page=selected=>'<!-- saved from url=(0067)https://detail.tmall.com/item.htm?id=123&skuId=456 --><title>双属性商品-天猫</title><div>参数信息 颜色 白色 存储 无 32GB 商品参数足够完整</div>'+selected+'<script>window.product='+JSON.stringify(data)+'</script>';
const value=(vid,label)=>'<div class="valueItem--x isSelected--y" data-vid="'+vid+'"><span class="valueItemText--x">'+label+'</span></div>';
test('two selected property groups are one SKU only when every visible selection matches the exact SKU table',()=>{
 const e=parseSavedPage(page(value('11','白色')+value('22','无')));assert.equal(e.selectedVariants.length,1);assert.equal(e.skuId,'456');assert.match(e.selectedVariants[0],/颜色: 白色.*存储: 无/);assert.ok(e.text.includes(e.selectedVariants[0]));assert.equal(e.variantOptions.length,2);
 const wrong=parseSavedPage(page(value('11','白色')+value('23','32GB')));assert.equal(wrong.selectedVariants.length,2); // Explicit SKU 456 cannot become SKU 457.
 const incomplete=parseSavedPage(page(value('11','白色')));assert.equal(incomplete.selectedOptions.length,1);
});
test('SKU data is parsed as bounded JSON data, with explicit stock and no execution or invented SKU identity',()=>{
 const rows=taobaoVariants(page(''));assert.equal(rows[0].available,true);assert.equal(rows[1].available,false);assert.deepEqual(taobaoVariants('<script>"skuBase":{skus:process.exit()}</script>'),[]);
 const bad=structuredClone(data);bad.skuBase.skus.push({skuId:'458',propPath:'1:11;2:999'});assert.equal(taobaoVariants(JSON.stringify(bad)).length,2);
});
