import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {mediaFixture} from './helpers/wb-media-fixture.mjs';
import {inspectWbImage,readWbMediaTarget,createWbMediaUpload,wbPhotoUrl} from '../adapters/wb-media.mjs';
import {assetPath,saveImage} from '../adapters/media.mjs';
import {hash} from '../core/repository.mjs';
import {wbMediaGate,wbMediaPanel} from '../web/wb-media.mjs';
async function fixture(t,options){const f=await mediaFixture(options);t.after(f.cleanup);return f;}
async function approved(f){const o=await f.ws.prepareWbMedia(f.id);await f.ws.approveOperation(o.id,o.payloadHash);return (await f.ws.view()).operations.find(x=>x.id===o.id);}
async function confirm(f,id){const o=await f.ws.readWbMediaResult(id);return f.ws.confirmWbMediaResult(id,{observationHash:o.observationHash,confirmed:true});}

test('WB local image inspection checks rights, immutable bytes, dimensions and static format',async t=>{
 const f=await fixture(t),image=f.images[0],m=await inspectWbImage(image);assert.equal(m.width,900);assert.equal(m.sha256,image.assetId);
 await assert.rejects(()=>inspectWbImage({...image,rightsConfirmed:false}));await assert.rejects(()=>inspectWbImage({...image,assetId:'../private'}));
 const small=await saveImage(await sharp({create:{width:699,height:900,channels:3,background:'white'}}).png().toBuffer());await assert.rejects(()=>inspectWbImage({...small,rightsConfirmed:true}),/700/);
 await assert.rejects(()=>inspectWbImage(image,{readAsset:async()=>Buffer.alloc(32_000_001)}));await writeFile(assetPath(image.assetId),'changed');await assert.rejects(()=>inspectWbImage(image),/指纹/);
});
test('multipart uses regional API, nmID and ordered positions, sends exact approved bytes once',async t=>{
 const f=await fixture(t),op=await approved(f);await f.ws.executeOperation(op.id);assert.equal(f.submissions.length,2);
 for(const [i,s] of f.submissions.entries()){assert.equal(s.url,'https://content-api.wildberries.cn/content/v3/media/file');assert.equal(s.headers['X-Nm-Id'],'12345');assert.equal(s.headers['X-Photo-Number'],String(i+1));assert.equal(s.headers['Content-Type'],undefined);assert.deepEqual(s.bytes,await readFile(assetPath(f.images[i].assetId)));}
 await f.ws.executeOperation(op.id);assert.equal(f.submissions.length,2);assert.equal((await f.ws.view()).auditValid,true);
 const result=await f.ws.readWbMediaResult(op.id);assert.equal(result.state,'submitted');assert.equal(result.observation.readyForReview,true);assert.equal(result.observation.identityVerified,false);assert.equal((await f.ws.getJob(f.id)).wbMediaResult,undefined);
 await assert.rejects(()=>f.ws.confirmWbMediaResult(op.id,{observationHash:result.observationHash,confirmed:false}));await confirm(f,op.id);assert.equal((await f.ws.getJob(f.id)).wbMediaResult.complete,true);assert.equal((await f.ws.getJob(f.id)).wbPublicationStage,'price_stock_pending');
});
test('existing media, missing card, changed source and foreign account cannot reach upload',async t=>{
 const f=await fixture(t);f.card.photos=[{big:'https://basket-01.wbbasket.ru/1.webp'}];await assert.rejects(()=>f.ws.prepareWbMedia(f.id),/已有媒体/);f.card.photos=[];
 const op=await f.ws.prepareWbMedia(f.id);await f.ws.repo.mutate(db=>db.jobs.find(j=>j.id===f.id).revision++);await assert.rejects(()=>f.ws.approveOperation(op.id,op.payloadHash),/版本/);assert.equal(f.submissions.length,0);
 await assert.rejects(()=>readWbMediaTarget(f.store,f.publication,{read:f.read,accountRef:async()=> 'another'}),/账户/);
 f.card.title='changed';await assert.rejects(()=>readWbMediaTarget(f.store,f.publication,{read:f.read,accountRef:f.account}),/卡片/);
});
test('fresh card reads reject malformed and untrusted media URLs without fetching them',async t=>{
 const f=await fixture(t);for(const url of ['http://basket-01.wbbasket.ru/1.webp','https://wbbasket.ru.evil.test/1.webp','https://name:secret@wbbasket.ru/a','https://127.0.0.1/a','data:image/png;base64,x']){assert.equal(wbPhotoUrl(url),null);f.card.photos=[{big:url}];await assert.rejects(()=>readWbMediaTarget(f.store,f.publication,{read:f.read,accountRef:f.account}));}
 f.card.photos=null;await assert.rejects(()=>readWbMediaTarget(f.store,f.publication,{read:f.read,accountRef:f.account}),/不完整/);
});
test('partial pre-send failure keeps receipt and resumes only remaining files after visual review and a new gate',async t=>{
 const f=await fixture(t),reader=f.ws.wbMediaTarget;let calls=0;const op=await approved(f);f.ws.wbMediaTarget=async(...args)=>{if(++calls===2)throw Error('read interrupted');return reader(...args);};
 await assert.rejects(()=>f.ws.executeOperation(op.id));let saved=(await f.ws.view()).operations.find(o=>o.id===op.id);assert.equal(saved.state,'partial');assert.equal(saved.items[0].state,'accepted');assert.equal(f.submissions.length,1);await assert.rejects(()=>f.ws.executeOperation(op.id));
 f.ws.wbMediaTarget=reader;await assert.rejects(()=>f.ws.prepareWbMedia(f.id));await confirm(f,op.id);saved=(await f.ws.view()).operations.find(o=>o.id===op.id);assert.equal(saved.state,'partial_verified');assert.equal((await f.ws.getJob(f.id)).wbMediaResult.complete,false);
 const remaining=await approved(f);assert.equal(remaining.payload.images.length,1);assert.equal(remaining.payload.images[0].photoNumber,2);await f.ws.executeOperation(remaining.id);await confirm(f,remaining.id);assert.equal(f.submissions.length,2);assert.equal((await f.ws.getJob(f.id)).wbMediaResult.complete,true);await assert.rejects(()=>f.ws.readWbMediaResult(op.id),/较新/);
});
test('ambiguous accepted file survives restart and is never replayed; human image review unlocks only unsent remainder',async t=>{
 const f=await fixture(t,{onUpload:({n,accept})=>{accept();if(n===1)throw Error('NETWORK_SECRET');return {ok:true,json:async()=>({error:false})};}}),op=await approved(f);await assert.rejects(()=>f.ws.executeOperation(op.id),e=>!e.message.includes('NETWORK_SECRET'));
 let saved=(await f.ws.view()).operations.find(o=>o.id===op.id);assert.equal(saved.state,'unknown');assert.equal(saved.items[0].state,'unknown');await assert.rejects(()=>f.ws.executeOperation(op.id));
 await f.ws.repo.mutate(db=>{const o=db.operations.find(o=>o.id===op.id);o.state='executing';o.items[0].state='executing';});await f.ws.init();saved=(await f.ws.view()).operations.find(o=>o.id===op.id);assert.equal(saved.state,'unknown');assert.equal(saved.items[0].state,'unknown');
 await confirm(f,op.id);const next=await approved(f);assert.equal(next.payload.images[0].photoNumber,2);await f.ws.executeOperation(next.id);await confirm(f,next.id);assert.deepEqual(f.submissions.map(s=>s.headers['X-Photo-Number']),['1','2']);assert.equal((await f.ws.view()).auditValid,true);
});
test('absent ambiguous file stays unresolved; count alone never completes publication',async t=>{
 const f=await fixture(t,{onUpload:()=>{throw Error('lost');}}),op=await approved(f);await assert.rejects(()=>f.ws.executeOperation(op.id));const result=await f.ws.readWbMediaResult(op.id);assert.equal(result.observation.readyForReview,false);await assert.rejects(()=>confirm(f,op.id));await assert.rejects(()=>f.ws.prepareWbMedia(f.id));assert.equal(f.submissions.length,1);
});
test('expired, tampered or rotated approval fails before multipart transmission',async t=>{
 const f=await fixture(t),op=await approved(f);let writes=0;const send=createWbMediaUpload({getCredentials:f.credentials,fetcher:async()=>{writes++;}});
 for(const bad of [{...op,approvedAt:'invalid'},{...op,approvedAt:new Date(Date.now()-901000).toISOString()},{...op,approvedHash:'changed'}])await assert.rejects(()=>send(f.store,bad,op.payload.images[0]),e=>e.noWrite===true);
 const rotated=createWbMediaUpload({getCredentials:async()=>({WB_API_TOKEN:'rotated'}),fetcher:async()=>{writes++;}});await assert.rejects(()=>rotated(f.store,op,op.payload.images[0]),e=>e.noWrite===true);assert.equal(writes,0);
});
test('concurrent execution is reserved across a batch and duplicate clicks cannot send again',async t=>{
 const f=await fixture(t),op=await approved(f);const settled=await Promise.allSettled([f.ws.executeOperation(op.id),f.ws.executeOperation(op.id)]);assert.equal(settled.filter(s=>s.status==='fulfilled').length,1);assert.equal(f.submissions.length,2);
});
test('429 deadline persists across restart and blocks another media operation for the account',async t=>{
 const f=await fixture(t,{onUpload:()=>({ok:false,status:429,headers:new Headers({'Retry-After':'120'})})}),op=await approved(f);await assert.rejects(()=>f.ws.executeOperation(op.id));let saved=(await f.ws.view()).operations.find(o=>o.id===op.id);assert.ok(saved.retryAt>Date.now()+110000);await f.ws.init();
 await f.ws.repo.mutate(db=>{const second=structuredClone(db.operations.find(o=>o.id===op.id));second.id='alias-operation';second.state='approved';second.items=[];db.operations.push(second);});await assert.rejects(()=>f.ws.executeOperation('alias-operation'),/限流/);assert.equal(f.submissions.length,1);
});
test('visual confirmation rechecks the observed version, and a later changed count removes completed state',async t=>{
 const f=await fixture(t),op=await approved(f);await f.ws.executeOperation(op.id);let result=await f.ws.readWbMediaResult(op.id);f.card.photos.pop();await assert.rejects(()=>f.ws.confirmWbMediaResult(op.id,{observationHash:result.observationHash,confirmed:true}),/变化/);
 f.card.photos.push({big:'https://basket-01.wbbasket.ru/vol123/part12345/12345/images/big/2.webp'});await confirm(f,op.id);f.card.photos.pop();await f.ws.readWbMediaResult(op.id);assert.equal((await f.ws.getJob(f.id)).wbMediaResult.complete,false);assert.equal((await f.ws.getJob(f.id)).wbMediaProgress,undefined);
});
test('Chinese media gate separates platform observation from human image confirmation and escapes source strings',async t=>{
 const f=await fixture(t),op=await approved(f);op.payload.vendorCode='<script>';let html=wbMediaGate(op,'合成测试');assert.doesNotMatch(html,/<script>/);assert.match(html,/确认的俄语图片 1/);assert.match(html,/向 WB 发送/);assert.doesNotMatch(html,/保存图片核对结果/);
 op.observation={photos:[],expectedCount:2,readyForReview:true,reason:'inspect'};op.state='submitted';html=wbMediaGate(op,'合成测试');assert.match(html,/我已逐张核对/);assert.match(html,/不证明图像一致/);assert.match(wbMediaPanel(await f.ws.getJob(f.id),[]),/无需公开图片存储/);
});
