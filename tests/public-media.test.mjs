import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publishPublicImages} from '../adapters/public-media.mjs';
const bytes=Buffer.from('approved test photo'),id=createHash('sha256').update(bytes).digest('hex'),images=[{assetId:id,rightsConfirmed:true}];
test('public hosting uploads only approved bytes into a content-addressed media branch',async()=>{
 const calls=[];const r=await publishPublicImages(images,{repo:'owner/repo',load:async()=>bytes,api:async(path,body)=>{calls.push({path,body});if(path==='repos/owner/repo')return {private:false,default_branch:'main'};if(path.endsWith('/git/ref/heads/product-media'))throw Error('not found');if(path.endsWith('/git/ref/heads/main'))return {object:{sha:'base'}};if(path.includes('/contents/')&&!body)throw Error('not found');return {};}});
 assert.equal(r.urls.length,1);assert.ok(r.urls[0].endsWith(id+'.png'));const upload=calls.find(c=>c.body?.content);assert.equal(upload.body.content,bytes.toString('base64'));assert.equal(upload.body.branch,'product-media');assert.ok(!JSON.stringify(calls).includes('Api-Key'));
});
test('private repositories and unconfirmed photos are not published',async()=>{
 await assert.rejects(publishPublicImages(images,{repo:'owner/repo',api:async()=>({private:true})}),/公开/);
 await assert.rejects(publishPublicImages([{...images[0],rightsConfirmed:false}],{repo:'owner/repo',api:async()=>{throw Error('should not call');}}),/使用权/);
});
test('existing media with changed bytes is never overwritten',async()=>{
 let wrote=false;await assert.rejects(publishPublicImages(images,{repo:'owner/repo',load:async()=>bytes,api:async(path,body)=>{if(body)wrote=true;if(path==='repos/owner/repo')return {private:false};return {content:Buffer.from('different').toString('base64')};}}),/不覆盖/);assert.equal(wrote,false);
});
