import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSourceMedia} from '../core/product-media-pack.mjs';

test('two source pairs run together while revision continuation rules remain in original order',async()=>{
 const rows=Array.from({length:6},(_,i)=>({key:'k'+i,assetId:String(i).repeat(64),role:'detail'})),releases=new Map(),progress=[];let active=0,maxActive=0,started=0,entered;
 const bothStarted=new Promise(resolve=>{entered=resolve;});
 const run=async({schema})=>{const keys=schema.properties.items.items.properties.key.enum;active++;maxActive=Math.max(maxActive,active);started++;try{if(keys[0]!=='k4')await new Promise(resolve=>{releases.set(keys[0],resolve);if(releases.size===2)entered();});return {output:{items:keys.map(key=>({key,kind:key==='k1'?'revision_specific':'product',textZh:key==='k2'?'产品尺寸 20':'商品',textRu:'Сведения о товаре',captionRu:'Товар',modelCodes:key==='k1'?['OTHER1']:[],otherColor:false,excludeReason:key==='k1'?'Неподтверждённая ревизия':'',facts:[]}))}};}finally{active--;}};
 const resultPromise=analyzeSourceMedia(rows,{titleZh:'Товар',attributes:{}},{run,onProgress:async items=>progress.push(items.map(r=>r.key))});
 await bothStarted;assert.equal(started,2);assert.equal(maxActive,2);releases.get('k2')();releases.get('k0')();
 const result=await resultPromise;assert.equal(started,3);assert.equal(maxActive,2);assert.deepEqual(result.map(r=>r.key),rows.map(r=>r.key));assert.equal(result[2].state,'excluded');assert.equal(result[2].analysis.kind,'revision_specific');assert.deepEqual(progress.map(p=>p.length),[2,4,6]);
});
