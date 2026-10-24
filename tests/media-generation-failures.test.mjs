import test from 'node:test';
import assert from 'node:assert/strict';
import {composeMediaPack} from '../core/product-media-pack.mjs';

const rows=Array.from({length:8},(_,i)=>({key:'photo-'+i,assetId:String(i).repeat(64),role:'gallery',state:'analyzed',analysis:{kind:'product',textZh:'商品',textRu:'Товар',captionRu:'Товар',otherColor:false}}));

test('systemic generation timeouts stop new gallery requests and surface the first failure immediately',async()=>{
 let edits=0;const events=[];
 await assert.rejects(composeMediaPack(rows,{onProgress:async(outputs,detail)=>events.push({completed:outputs.length,...detail}),edit:async()=>{edits++;throw Object.assign(Error('Image localization timeout'),{sourceCode:'timeout',retryable:false,durationMs:480000});},run:async()=>{throw Error('review must not start');}}),e=>e.mediaFailures?.length===2&&e.message.includes('остальные 6 не запущены'));
 assert.equal(edits,2);assert.deepEqual(events[0],{completed:0,totalBlocks:8,failedBlocks:0});
 assert.equal(events[1].failedBlocks,1);assert.equal(events[1].lastFailure.sourceCode,'timeout');assert.equal(events[1].lastFailure.durationMs,480000);
});

test('a broken individual image does not discard successful blocks or stop the remaining gallery',async()=>{
 let edits=0;const events=[],input=structuredClone(rows);input[0].analysis.textRu='broken-source';
 await assert.rejects(composeMediaPack(input,{onProgress:async(outputs,detail)=>events.push({keys:outputs.flatMap(o=>o.sourceKeys),...detail}),edit:async({prompt})=>{edits++;if(prompt.includes('broken-source'))throw Error('Invalid source image');return {assetId:'a'.repeat(64),width:100,height:100};},run:async()=>({output:{productPreserved:true,russianReadable:true,unsupportedClaims:false,chineseMarketingRemaining:false,externalPromotionRemaining:false,reasonRu:''}}),sourceContext:{}}),e=>e.mediaFailures?.length===1&&e.message.includes('Invalid source image'));
 // Successful batches are also reported before the whole request completes.
 assert.equal(edits,8);assert.equal(events.at(-1).keys.length,7);assert.ok(!events.at(-1).keys.includes('photo-0'));
});
