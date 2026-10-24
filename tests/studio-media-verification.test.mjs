import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileStudioOzon} from '../core/studio-ozon.mjs';
async function verify({skipped=false,videoReady=false,changedRich=false}={}){
 const rich={version:0.3,content:[{widgetName:'raShowcase',blocks:[{img:{src:'https://example.com/main.png'}}]}]},task={jobId:'j',storeId:'s',state:'submitted',richContent:rich,mediaEnhancement:{state:'submitted',galleryCount:1,startedAt:'2026-10-24T10:00:00Z',...(skipped?{video:{state:'skipped',reason:'Недостаточно разных фотографий для фотообзора'}}:{})}},result={imported:true,buyerUrl:'https://www.ozon.ru/product/1/',productId:2,imageCount:1,moderationVerified:true,platformErrors:[],platformStatus:{is_created:true,status_updated_at:'2026-10-24T10:01:00Z'}};
 let reads=0;
 const studio={get:async()=>structuredClone(task),set:async(id,patch)=>(Object.assign(task,patch),structuredClone(task)),contentRating:async()=>({groups:[{key:'media',conditions:[{key:'media_video_or_video_cover',fulfilled:videoReady}]}]}),ws:{getJob:async()=>({id:'j',state:'imported',canonical:{sku:'one'}}),syncPublished:async()=>({state:'imported',canonical:{sku:'one'},importResult:result}),repo:{read:async()=>({})},resolveStore:()=>({})}};
 await reconcileStudioOzon(studio,'t',{call:async(store,path,body,options)=>{reads++;assert.notEqual(options?.write,true);assert.equal(path,'/v4/product/info/attributes');return {result:[{id:2,offer_id:'one',attributes:[{id:11254,values:[{value:JSON.stringify(changedRich?{...rich,version:999}:rich)}]}]}]};}});
 assert.equal(reads,1);return task;
}
test('confirmed images and rich content complete when optional video was explicitly skipped',async()=>{const t=await verify({skipped:true});assert.equal(t.state,'published');assert.equal(t.mediaEnhancement.state,'verified');assert.equal(t.mediaEnhancement.richVerified,true);assert.equal(t.mediaEnhancement.videoVerified,false);});
test('an expected video still waits for actual Ozon confirmation',async()=>{assert.equal((await verify()).mediaEnhancement.state,'submitted');assert.equal((await verify({videoReady:true})).mediaEnhancement.state,'verified');});
test('skipping optional video never bypasses rich content verification',async()=>{const t=await verify({skipped:true,changedRich:true});assert.equal(t.mediaEnhancement.state,'submitted');assert.notEqual(t.mediaEnhancement.richVerified,true);});
