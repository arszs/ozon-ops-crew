import test from 'node:test';import assert from 'node:assert/strict';
import {creativePlanDraft,creativePlanFields,creativeTrialEvidence,bindCreativePlans} from '../web/review-creatives.mjs';
const c={id:'c',storeId:'s',source:{sku:'123',sourceAssetId:'a'.repeat(64)},payloadHash:'b'.repeat(64),revision:2,state:'approved',sourceStatus:'current',output:{changeZh:'补充尺寸'}};
test('Chinese content plan selects approved versions and fills exact frozen comparison labels',()=>{
 const data={stores:[{id:'s',name:'店铺'}],creatives:[c,{...c,id:'stale',sourceStatus:'stale'},{...c,id:'draft',state:'review_gate'}]},html=creativePlanFields(data);
 assert.match(html,/value="c"/);assert.doesNotMatch(html,/value="stale"|value="draft"/);
 const draft=creativePlanDraft(c);assert.equal(draft.lever,'content');assert.equal(draft.creativeHash,c.payloadHash);assert.equal(draft.variant,'AIGC 图文 · v2 · bbbbbbbbbbbb');
 const fields=Object.fromEntries([...Object.keys(draft),'creativeId'].map(k=>[k,Object.assign(new EventTarget(),{value:k==='creativeId'?'c':''})])),section={hidden:true,disabled:true},form=Object.assign(new EventTarget(),{elements:fields,querySelector:()=>section}),prior=globalThis.document;
 globalThis.document={querySelector:()=>form};try{bindCreativePlans(data);fields.creativeId.dispatchEvent(new Event('change'));assert.equal(fields.sku.value,'123');assert.equal(fields.storeId.value,'s');assert.equal(fields.creativeHash.value,c.payloadHash);assert.equal(section.hidden,false);assert.equal(section.disabled,false);fields.lever.value='price';fields.lever.dispatchEvent(new Event('change'));assert.equal(section.disabled,true);}finally{globalThis.document=prior;}
});
test('frozen visual evidence escapes source text and shows seller-reported provenance',()=>{
 const html=creativeTrialEvidence({revision:2,sourceAssetId:'a'.repeat(64),sourceCopyRu:'<script>bad</script>',image:{assetId:'b'.repeat(64)},output:{headlineRu:'Размеры',captionRu:'40 см'},approval:{at:'2026-10-14'},payloadHash:'hash'});
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/不证明平台实际展示/);assert.match(html,/生成来源由卖家声明/);
});
