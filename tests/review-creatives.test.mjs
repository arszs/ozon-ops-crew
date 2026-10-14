import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Workspace} from '../core/workspace.mjs';
import {generateCreative,attachCreativeImage,approveCreative} from '../core/review-creatives.mjs';
import {draftReviewCreative} from '../adapters/review-creative.mjs';
const output={issueZh:'尺寸不清楚',changeZh:'补充尺寸',headlineRu:'Размеры',captionRu:'40 × 30 × 25 см',promptZh:'保持商品外观，标出已确认尺寸',risk:'content_clarity',warningsZh:[]};
const runner=async()=>({output,provider:'test',prompt:'bounded prompt'});
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'review-creative-'));const old=process.env.OPS_ASSET_DIR;process.env.OPS_ASSET_DIR=join(dir,'assets');await mkdir(process.env.OPS_ASSET_DIR);for(const letter of ['a','b','c'])await writeFile(join(process.env.OPS_ASSET_DIR,letter.repeat(64)+'.png'),'fixture');t.after(async()=>{if(old===undefined)delete process.env.OPS_ASSET_DIR;else process.env.OPS_ASSET_DIR=old;await rm(dir,{recursive:true,force:true});});const ws=new Workspace(join(dir,'workspace.json'));await ws.init();const r=await ws.demoReview('ozon-demo');const input={storeId:'ozon-demo',reviewId:r.id,sku:'test',factsZh:'尺寸已核实',currentCopyRu:'30 л',sourceAssetId:'a'.repeat(64),rightsConfirmed:true,productConfirmed:true};return {ws,input};}
const checks={factsChecked:true,visualChecked:true,russianChecked:true,rightsChecked:true,issueAcknowledged:true};
test('creative review is version-bound, replacement invalidates approval and never creates a store operation',async t=>{
 const {ws,input}=await setup(t);const c=await generateCreative(ws,input,{run:runner});assert.equal(c.state,'awaiting_image');
 assert.equal((await generateCreative(ws,input,{run:()=>{throw Error('must reuse');}})).id,c.id);
 await assert.rejects(approveCreative(ws,c.id,{expectedHash:c.payloadHash,...checks}),/先添加/);
 const image=await attachCreativeImage(ws,c.id,{assetId:'b'.repeat(64),provider:'xds_manual',rightsConfirmed:true,expectedHash:c.payloadHash});
 await assert.rejects(approveCreative(ws,c.id,{expectedHash:c.payloadHash,...checks}),/版本/);
 await assert.rejects(approveCreative(ws,c.id,{expectedHash:image.payloadHash}),/逐项/);
 const approved=await approveCreative(ws,c.id,{expectedHash:image.payloadHash,...checks});assert.equal(approved.state,'approved');
 const replacement=await attachCreativeImage(ws,c.id,{assetId:'c'.repeat(64),provider:'openai_manual',rightsConfirmed:true,expectedHash:approved.payloadHash});assert.equal(replacement.state,'review_gate');assert.equal(replacement.approval,undefined);
 await assert.rejects(approveCreative(ws,c.id,{expectedHash:approved.payloadHash,...checks}),/版本/);
 assert.equal((await ws.view()).operations.length,0);assert.equal((await ws.view()).auditValid,true);
});
test('source changes, cross-store reviews and unsafe asset paths cannot be approved',async t=>{
 const {ws,input}=await setup(t);
 await assert.rejects(generateCreative(ws,{...input,storeId:'wb-demo'},{run:runner}),/店铺不匹配/);
 await assert.rejects(generateCreative(ws,{...input,sourceAssetId:'../secrets'},{run:runner}),/Invalid asset/);
 const c=await generateCreative(ws,input,{run:runner});await ws.repo.mutate(db=>db.reviews[0].textRu='changed');
 await assert.rejects(attachCreativeImage(ws,c.id,{assetId:'b'.repeat(64),provider:'xds_manual',rightsConfirmed:true,expectedHash:c.payloadHash}),/来源已改变/);
});
test('concurrent generation reuses persisted work; restarts interrupt instead of replaying',async t=>{
 const {ws,input}=await setup(t);let calls=0,release,started;const latch=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 const running=generateCreative(ws,input,{run:async()=>{calls++;started();await latch;return runner();}});await ready;
 assert.equal((await generateCreative(ws,input,{run:runner})).state,'generating');assert.equal(calls,1);
 await ws.init();release();await assert.rejects(running,/状态已改变/);assert.equal((await ws.view()).creatives[0].state,'interrupted');
});
test('insufficient facts block approval, defects require explicit acknowledgement',async t=>{
 const {ws,input}=await setup(t);
 for(const risk of ['insufficient_facts','quality_or_service']){const c=await generateCreative(ws,{...input,sku:risk},{run:async()=>({...await runner(),output:{...output,risk}})});const image=await attachCreativeImage(ws,c.id,{assetId:'b'.repeat(64),provider:'other_manual',rightsConfirmed:true,expectedHash:c.payloadHash});await assert.rejects(approveCreative(ws,c.id,{...checks,issueAcknowledged:false,expectedHash:image.payloadHash}),risk==='insufficient_facts'?/事实不足/:/另行处理/);}
});
test('AI contract treats review as data, masks contacts and rejects malformed generated content',async()=>{
 let prompt='';const good=await draftReviewCreative({reviewRu:'untrusted'},{run:async request=>{prompt=request.prompt;return {output:{...output,issueZh:'email user@example.com'},provider:'test'};}});assert.match(prompt,/untrusted data/);assert.equal(good.output.issueZh,'email [EMAIL]');await assert.rejects(draftReviewCreative({}, {run:async()=>({output:{...output,risk:'invented'}})}),/风险说明/);
});

const schedule={aStart:'2026-09-01',aEnd:'2026-09-07',bStart:'2026-09-08',bEnd:'2026-09-14',adBudget:1000,maxLoss:1000,acknowledged:true};
async function reviewed(t){const {ws,input}=await setup(t);const c=await generateCreative(ws,input,{run:runner}),im=await attachCreativeImage(ws,c.id,{assetId:'b'.repeat(64),provider:'xds_manual',rightsConfirmed:true,expectedHash:c.payloadHash});const approved=await approveCreative(ws,c.id,{expectedHash:im.payloadHash,...checks});return {ws,input,c:approved};}
const contentInput=c=>({storeId:c.storeId,sku:c.source.sku,lever:'content',creativeId:c.id,creativeHash:c.payloadHash,baseline:'原图 · '+c.source.sourceAssetId.slice(0,12),variant:'AIGC 图文 · v'+c.revision+' · '+c.payloadHash.slice(0,12),hypothesis:'明确尺寸降低预期落差',controls:'保持价格、广告、库存及促销不变',...schedule});
const observed=p=>({storeId:p.storeId,planId:p.id,sku:p.sku,lever:p.lever,baseline:p.baseline,variant:p.variant,evidence:'Synthetic reports; image switch and display dates reviewed',comparable:true,executionConfirmed:true,a:{start:p.aStart,end:p.aEnd,orders:50,revenue:1000,cost:500,ads:100,settled:true},b:{start:p.bStart,end:p.bEnd,orders:60,revenue:1500,cost:600,ads:100,settled:true}});
test('content trial freezes approved visuals, persists through restart and compares profit without publishing',async t=>{
 const {ws,c}=await reviewed(t),p=await ws.planTrial(contentInput(c));assert.equal(p.creative.payloadHash,c.payloadHash);assert.equal(p.lever,'content');assert.equal(p.creative.publication,'not_verified');
 await attachCreativeImage(ws,c.id,{assetId:'c'.repeat(64),provider:'openai_manual',rightsConfirmed:true,expectedHash:c.payloadHash});await ws.init();
 const saved=(await ws.view()).trialPlans[0];assert.equal(saved.creative.image.assetId,'b'.repeat(64));assert.equal(saved.creative.approval.payloadHash,c.payloadHash);
 const result=await ws.recordTrial(observed(p));assert.equal(result.result.verdict,'repeat_candidate');assert.equal(result.result.causal,false);assert.equal(result.creative.payloadHash,c.payloadHash);assert.equal(result.creative.image.assetId,'b'.repeat(64));assert.equal((await ws.view()).operations.length,0);assert.equal((await ws.view()).auditValid,true);
});
test('content plan rejects unapproved, wrong store/SKU/hash, changed source and invented variant',async t=>{
 const {ws,c}=await reviewed(t),input=contentInput(c);
 for(const patch of [{storeId:'wb-demo'},{sku:'other'},{creativeHash:'stale'},{baseline:'invented'},{variant:'invented'},{creativeId:'missing'},{adsControl:'cpo_enable'}])await assert.rejects(ws.planTrial({...input,...patch}));
 await ws.repo.mutate(db=>db.reviews[0].textRu='changed');await assert.rejects(ws.planTrial(input),/来源已改变/);
 await ws.repo.mutate(db=>{db.reviews[0].textRu=c.source.reviewRu;db.creatives[0].state='review_gate';});await assert.rejects(ws.planTrial(input),/已确认/);
 assert.equal((await ws.view()).trialPlans.length,0);
});
test('unverified display and unlinked content observations cannot become positive evidence',async t=>{
 const {ws,c}=await reviewed(t),p=await ws.planTrial(contentInput(c));
 await assert.rejects(ws.recordTrial({...observed(p),planId:''}),/原计划/);
 const trial=await ws.recordTrial({...observed(p),executionConfirmed:false});assert.equal(trial.result.verdict,'insufficient');assert.match(trial.result.blockers.join(' '),/实际展示/);assert.equal(trial.executionConfirmed,false);
});
