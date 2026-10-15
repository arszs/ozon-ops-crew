import test from 'node:test';import assert from 'node:assert/strict';
import {reviewChoices,reviewPickerFields,bindReviewPicker,prepareCreativeReview} from '../web/creative-review-picker.mjs';
const data={stores:[{id:'a',name:'甲店'},{id:'b',name:'乙店'}],reviews:Array.from({length:5000},(_,i)=>({id:'r'+i,storeId:i%2?'b':'a',mode:'live',externalId:'review-'+i,textZh:'待翻译，请生成 AI 草稿或人工核对',textRu:'Размер товара '+i,kind:'review',rating:3}))};
test('picker searches all loaded reviews instead of silently losing older than the last hundred',()=>{
 const all=reviewChoices(data);assert.equal(all.total,5000);assert.equal(all.rows.length,100);assert.equal(all.rows[0].id,'r4999');
 const old=reviewChoices(data,{query:'review-0'});assert.equal(old.total,1);assert.equal(old.rows[0].id,'r0');assert.match(old.html,/Размер товара 0/);assert.doesNotMatch(old.html,/待翻译/);
 assert.equal(reviewChoices(data,{query:'Размер',storeId:'a'}).total,2500);assert.equal(reviewChoices(data,{query:'乙店 review-4999'}).rows[0].id,'r4999');
 const pinned=reviewChoices(data,{query:'no-match',selectedId:'r0'});assert.equal(pinned.total,0);assert.equal(pinned.rows[0].id,'r0');assert.equal(pinned.selectedOutsideFilter,true);
});
test('translations are searchable and review/store text is escaped in options',()=>{
 const d={stores:[{id:'a',name:'<script>bad</script>'}],reviews:[{id:'r0',storeId:'a',textRu:'unsafe <img onerror=bad>',textZh:'尺寸不清楚',mode:'mock'}]};
 assert.equal(reviewChoices(d,{query:'尺寸'}).total,1);assert.equal(reviewChoices(d,{query:'unsafe'}).total,1);
 const html=reviewPickerFields(d);assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/演示/);
});
function form(){const elements=Object.fromEntries(['reviewStore','reviewSearch','reviewId','sku','factsZh','productConfirmed','sourceImage'].map(k=>[k,{value:'',checked:false}])),nodes={'[data-review-count]':{},'[data-review-preview]':{}};return Object.assign(new EventTarget(),{elements,querySelector:s=>nodes[s],nodes});}
test('direct review handoff selects an older record and exposes full source without guessing SKU or starting AI',()=>{
 const f=form();f.elements.sku.value='seller-entered';f.elements.factsZh.value='keep facts';const file={name:'selected.png'};f.elements.sourceImage.files=[file];f.elements.productConfirmed.checked=true;
 bindReviewPicker(data,f);assert.equal(prepareCreativeReview(data,f,'r0'),true);assert.equal(f.elements.reviewId.value,'r0');assert.equal(f.elements.reviewStore.value,'a');assert.equal(f.elements.sku.value,'seller-entered');assert.equal(f.elements.productConfirmed.checked,false);assert.match(f.nodes['[data-review-preview]'].innerHTML,/Размер товара 0/);assert.match(f.nodes['[data-review-preview]'].innerHTML,/尚未翻译/);
 f.elements.reviewSearch.value='does-not-match';f.elements.reviewSearch.oninput();assert.equal(f.elements.reviewId.value,'r0');assert.match(f.nodes['[data-review-count]'].textContent,/不符合当前搜索/);assert.equal(f.elements.sourceImage.files[0],file);assert.equal(f.elements.factsZh.value,'keep facts');
 f.elements.productConfirmed.checked=true;f.elements.reviewStore.value='b';f.elements.reviewStore.onchange();assert.equal(f.elements.reviewId.value,'');assert.equal(f.elements.productConfirmed.checked,false);
 assert.equal(prepareCreativeReview(data,f,'missing'),false);
});
test('restored drafts refresh the preview and repeated progress binding does not add duplicate listeners',()=>{
 const f=form();let registrations=0;const listen=f.addEventListener.bind(f);f.addEventListener=(...args)=>{registrations++;listen(...args);};bindReviewPicker(data,f);bindReviewPicker(data,f);
 f.elements.reviewId.value='r1';f.dispatchEvent(new Event('draft-restored'));assert.match(f.nodes['[data-review-preview]'].innerHTML,/Размер товара 1/);assert.equal(registrations,1);
});
