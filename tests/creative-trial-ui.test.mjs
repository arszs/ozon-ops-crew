import {captureForms,restoreForms} from '../web/form-state.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {creativePlanDraft,creativePlanFields,creativeTrialEvidence,bindCreativePlans,refreshCreativeCards} from '../web/review-creatives.mjs';
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

test('progress refresh changes only running cards and preserves upload/review form nodes',()=>{
 let updates=0;const active={dataset:{creativeCard:'running',creativeState:'generating'},set outerHTML(html){updates++;assert.match(html,/等待生成图片/);}},review={dataset:{creativeCard:'review',creativeState:'review_gate'},set outerHTML(html){throw Error('Must retain selected file and review checks');}},inserted=[];
 const list={querySelectorAll:()=>[active,review],insertAdjacentHTML:(position,html)=>inserted.push(html)},root={querySelector:()=>list};
 const output={issueZh:'尺寸',changeZh:'尺寸',headlineRu:'Размеры',captionRu:'40 см',promptZh:'保持外观',risk:'content_clarity',warningsZh:[]};
 const row={source:{sku:'123',sourceAssetId:'a'.repeat(64),reviewRu:'review',factsZh:'facts',currentCopyRu:'old'},output};
 refreshCreativeCards({creatives:[{...row,id:'running',state:'awaiting_image'},{...row,id:'review',state:'review_gate'},{...row,id:'new',state:'queued'}]},root);assert.equal(updates,1);assert.equal(inserted.length,1);
});

test('background financial refresh preserves the selected creative hash with the plan draft',()=>{
 const field=value=>({name:'creativeHash',type:'hidden',value}),form=element=>({id:'trial-plan-form',elements:[element],closest:()=>null,parentElement:null,querySelectorAll:()=>[]}),root=f=>({querySelectorAll:()=>[f],ownerDocument:{activeElement:null}});
 const before=form(field('reviewed-v2')),snapshot=captureForms(root(before)),after=form(field(''));
 restoreForms(root(after),snapshot);assert.equal(after.elements[0].value,'reviewed-v2');
});
