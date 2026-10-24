import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspace} from '../core/workspace.mjs';
import {ProductStudio} from '../core/product-studio.mjs';
import {parseSavedPage} from '../core/page-import.mjs';
import {canonical} from '../core/canonical.mjs';
import {hash,verifyAudit} from '../core/repository.mjs';
import {readSourceBrandPhoto} from '../core/source-brand-proof.mjs';

async function fixture(t,{files=true,selected=true,brand='厦泰'}={}){
 const root=await mkdtemp(join(tmpdir(),'studio-auto-brand-')),assetDir=join(root,'assets'),previousAssets=process.env.OPS_ASSET_DIR;
 process.env.OPS_ASSET_DIR=assetDir;t.after(async()=>{if(previousAssets===undefined)delete process.env.OPS_ASSET_DIR;else process.env.OPS_ASSET_DIR=previousAssets;await rm(root,{recursive:true,force:true});});
 await mkdir(assetDir);const bytes=Buffer.from('offline original spark plug photo'),assetId=createHash('sha256').update(bytes).digest('hex');await writeFile(join(assetDir,assetId+'.png'),bytes);
 const sourceUrl='https://item.taobao.com/item.htm?id=123&skuId=456',variant='【原装火花塞1个】',html='<title>摩托车火花塞-淘宝网</title><div>参数信息 品牌 厦泰 商品参数内容足够完整 快递: 免运费</div><span class="highlightPrice--x">79.9</span><div class="valueItem--x isSelected--x">'+variant+'</div><img class="'+(selected?'mainPic--x':'thumbnailPic--x')+'" src="https://img.alicdn.com/photo.jpg">',evidence=parseSavedPage(html,{sourceUrl}),manifest=files?[{name:'photo.jpg',assetId}]:[];
 const product={sourceUrl,sku:'TB-123-456',titleZh:'摩托车火花塞',descriptionZh:'已选规格：'+variant,categoryZh:'摩托配件',brand,price:79.9,currency:'CNY',attributes:{规格:'1个'},images:[],localized:{title:'Исходная свеча',description:'Исходные данные',attributes:{},warnings:[]}};
 const output={confirmed:true,readable:true,printedBrand:'CFMOTO',scope:'factory-packaging',brandSource:'physical-marking',identityConfirmed:true,selectedVariant:variant,identityReason:'На фото одна свеча зажигания и её заводская упаковка.',reason:'Бренд читается на физической заводской упаковке.'},calls=[];
 const ws=new Workspace(join(root,'workspace.json'));await ws.init();
 const studio=new ProductStudio(ws,{root:join(root,'studio'),sourceReader:async()=>({html,files:manifest,capture:{method:'test-source',state:'verified'}}),importer:async()=>({state:'ready',product:structuredClone(product),evidence:structuredClone(evidence),attempts:[],imageIssues:[]}),verifyBrandPhoto:async request=>{calls.push('brand');assert.equal(request.prompt.includes('CFMOTO'),false);assert.deepEqual(request.images,[join(assetDir,assetId+'.png')]);return {provider:'offline-codex',output};},research:async p=>{calls.push('research:'+p.brand);return {sources:[],warnings:[]};},improve:async p=>{calls.push('copy:'+p.brand);return {provider:'test',output:{title:p.brand+' свеча зажигания',description:'Выбранная свеча зажигания',warnings:[]}};},visuals:async p=>{calls.push('visuals:'+p.brand);return {images:[{assetId:'generated-picture'}]};},rate:async()=>({rubPerCny:12,date:'2026-10-24',source:'test'})});
 const start=async(options={})=>{const task=await studio.start({sourceUrl,storeId:'ozon-live',domesticShipping:0,...options}),pending=studio.tasks.get(task.id);if(pending)await pending;return studio.get(task.id);};
 return {root,assetDir,assetId,ws,studio,sourceUrl,html,evidence,manifest,product,output,calls,start};
}

test('physical brand is read without a requested brand and resolved before one copy/media pass',async t=>{
 const f=await fixture(t),task=await f.start(),db=await f.ws.repo.read(),job=db.jobs[0];
 assert.equal(task.state,'ready',task.error);assert.equal(task.product.brand,'CFMOTO');assert.equal(job.canonical.brand,'CFMOTO');assert.equal(job.revision,3);
 assert.deepEqual(f.calls,['brand','research:CFMOTO','copy:CFMOTO','visuals:CFMOTO']);
 assert.equal(task.brandResolution.state,'applied');assert.equal(task.brandResolution.basis,'source-photo');assert.equal(task.brandResolution.sourceBrand,'厦泰');assert.equal(task.brandResolution.brand,'CFMOTO');assert.equal(task.brandResolution.proof.assetId,f.assetId);assert.equal(task.brandResolution.proof.provider,'offline-codex');
 assert.deepEqual(task.evidence,f.evidence);assert.deepEqual(job.pageImport.evidence,f.evidence);assert.match(job.pageImport.evidence.text,/厦泰/);assert.equal(f.product.brand,'厦泰');assert.equal(job.importKey,hash({store:'ozon-live',mode:'manual',product:canonical(f.product)}));
 assert.equal(db.operations.length,0);assert.ok(db.audit.filter(e=>e.kind.startsWith('studio.brand-resolution')).every(e=>e.basis==='source-photo'&&e.externalWrite===false));assert.ok(verifyAudit(db.audit));
 const proof=await readSourceBrandPhoto({...task,product:f.product},{sourceAssetId:f.assetId},{run:async()=>({provider:'offline',output:f.output})});assert.equal(proof.printedBrand,'CFMOTO');
});

test('matching case-normalized physical brand is confirmed without a canonical revision change',async t=>{
 const f=await fixture(t,{brand:'cfmoto'}),task=await f.start(),job=(await f.ws.repo.read()).jobs[0];
 assert.equal(task.state,'ready',task.error);assert.equal(task.brandResolution.state,'confirmed');assert.equal(task.product.brand,'cfmoto');assert.equal(job.canonical.brand,'cfmoto');assert.equal(job.revision,2);assert.equal(f.calls.filter(c=>c==='brand').length,1);
});

test('unclear physical branding keeps source metadata and produces a repairable draft',async t=>{
 const f=await fixture(t);f.output.scope='seller-overlay';const task=await f.start(),db=await f.ws.repo.read();
 assert.equal(task.state,'ready',task.error);assert.equal(task.brandResolution.state,'unconfirmed');assert.equal(task.product.brand,'厦泰');assert.equal(db.jobs[0].canonical.brand,'厦泰');assert.equal(task.brandCorrection,undefined);assert.deepEqual(f.calls,['brand','research:厦泰','copy:厦泰','visuals:厦泰']);assert.equal(db.operations.length,0);
});

test('provider failure keeps source facts and records why automatic brand resolution was unavailable',async t=>{
 const f=await fixture(t);f.studio.verifyBrandPhoto=async()=>{f.calls.push('brand');throw Error('offline provider');};const task=await f.start();
 assert.equal(task.state,'ready',task.error);assert.equal(task.brandResolution.state,'unavailable');assert.equal(task.product.brand,'厦泰');assert.match(task.brandResolution.reason,/исходный бренд сохранён/);assert.deepEqual(task.evidence,f.evidence);assert.equal((await f.ws.repo.read()).operations.length,0);
});

test('missing selected gallery binding skips the optional step without a model call',async t=>{
 for(const options of [{files:false},{selected:false}]){const f=await fixture(t,options);f.studio.verifyBrandPhoto=async()=>assert.fail('no bound selected source photo');const task=await f.start();assert.equal(task.state,'ready',task.error);assert.equal(task.brandResolution.state,'skipped');assert.equal(task.product.brand,'厦泰');assert.equal(f.calls.some(c=>c==='brand'),false);}
});

test('image byte mismatch cannot call the verifier or overwrite metadata with a guessed brand',async t=>{
 const f=await fixture(t);await writeFile(join(f.assetDir,f.assetId+'.png'),'different source bytes');f.studio.verifyBrandPhoto=async()=>assert.fail('image hash must pass before AI');const task=await f.start();assert.equal(task.state,'ready',task.error);assert.equal(task.brandResolution.state,'unavailable');assert.equal(task.product.brand,'厦泰');
});

test('source changes or marketplace operations during proof abort the stale run before copy generation',async t=>{
 for(const change of [db=>{db.studioTasks[0].sourceMediaFiles[0].assetId='a'.repeat(64);},db=>{db.operations.push({id:'unrelated-write-intent',state:'pending',payload:{jobId:db.jobs[0].id}});}]){
  const f=await fixture(t);let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.studio.verifyBrandPhoto=async()=>{entered();await gate;return {provider:'offline-codex',output:f.output};};
  const task=await f.studio.start({sourceUrl:f.sourceUrl,storeId:'ozon-live',domesticShipping:0});await started;await f.ws.repo.mutate(change);release();await f.studio.tasks.get(task.id);const out=await f.studio.get(task.id),db=await f.ws.repo.read();assert.equal(out.state,'failed');assert.match(out.error,/изменён/);assert.equal(out.product.brand,'厦泰');assert.equal(db.jobs[0].canonical.brand,'厦泰');assert.equal(Object.keys(db.jobs[0].artifacts).length,0);assert.equal(f.calls.length,0);
 }
});

test('retry after failed visuals reuses the exact corrected revision, proof and approved copy',async t=>{
 const f=await fixture(t);let renders=0;f.studio.visuals=async p=>{renders++;assert.equal(p.brand,'CFMOTO');if(renders===1)throw Error('temporary render failure');return {images:[{assetId:'generated'}]};};const failed=await f.start();assert.equal(failed.state,'failed');assert.equal(failed.brandResolution.state,'applied');assert.equal((await f.ws.repo.read()).jobs[0].revision,2);const beforeCalls=[...f.calls];
 await f.studio.retry(failed.id);await f.studio.tasks.get(failed.id);const task=await f.studio.get(failed.id),db=await f.ws.repo.read();assert.equal(task.state,'ready',task.error);assert.equal(task.product.brand,'CFMOTO');assert.equal(renders,2);assert.deepEqual(f.calls,beforeCalls);assert.equal(db.jobs.length,1);assert.equal(db.jobs[0].revision,3);assert.equal(db.operations.length,0);
});

test('copy failure after early correction resumes the owned revision without reimporting or rereading the brand',async t=>{
 const f=await fixture(t),improve=f.studio.improve;let attempts=0;f.studio.improve=async(...args)=>{attempts++;if(attempts===1)throw Error('temporary copy failure');return improve(...args);};
 const failed=await f.start();assert.equal(failed.state,'failed');assert.equal(failed.content,undefined);assert.equal(failed.brandResolution.state,'applied');assert.equal((await f.ws.repo.read()).jobs[0].revision,2);
 f.studio.importer=async()=>assert.fail('must preserve the original import');f.studio.verifyBrandPhoto=async()=>assert.fail('must reuse the existing physical proof');await f.studio.retry(failed.id);await f.studio.tasks.get(failed.id);const task=await f.studio.get(failed.id),db=await f.ws.repo.read();assert.equal(task.state,'ready',task.error);assert.equal(task.product.brand,'CFMOTO');assert.equal(attempts,2);assert.equal(f.calls.filter(c=>c.startsWith('research:')).length,1);assert.equal(db.jobs.length,1);assert.equal(db.operations.length,0);
});

test('interrupted photo verification is repeated before retry can generate copy from unresolved metadata',async t=>{
 const f=await fixture(t),verify=f.studio.verifyBrandPhoto;let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.studio.verifyBrandPhoto=async request=>{entered();await gate;return verify(request);};
 const task=await f.studio.start({sourceUrl:f.sourceUrl,storeId:'ozon-live',domesticShipping:0});await started;await f.studio.init();release();await f.studio.tasks.get(task.id);const failed=await f.studio.get(task.id);assert.equal(failed.state,'failed');assert.equal(failed.brandResolution,undefined);assert.equal(failed.product.brand,'厦泰');assert.equal((await f.ws.repo.read()).jobs[0].revision,1);
 f.studio.verifyBrandPhoto=verify;f.studio.importer=async()=>assert.fail('must reuse the untouched owned import');await f.studio.retry(task.id);await f.studio.tasks.get(task.id);const ready=await f.studio.get(task.id);assert.equal(ready.state,'ready',ready.error);assert.equal(ready.brandResolution.state,'applied');assert.equal(ready.product.brand,'CFMOTO');assert.deepEqual(f.calls,['brand','brand','research:CFMOTO','copy:CFMOTO','visuals:CFMOTO']);assert.equal((await f.ws.repo.read()).operations.length,0);
});

test('Studio duplicate import returns the existing draft reference without changing its job or page evidence',async t=>{
 const f=await fixture(t),first=await f.start(),before=await f.ws.repo.read(),jobBefore=structuredClone(before.jobs[0]),callsBefore=[...f.calls],second=await f.start({commissionPct:16}),after=await f.ws.repo.read();
 assert.equal(second.state,'needs_source');assert.equal(second.existingTaskId,first.id);assert.equal(second.brandResolution.state,'skipped');assert.match(second.error,/сохранённую карточку/);assert.deepEqual(after.jobs[0],jobBefore);assert.equal(after.jobs.length,1);assert.deepEqual(f.calls,callsBefore);assert.equal(after.operations.length,0);
});

test('creation metadata is atomic and optional; reused Studio imports never rewrite raw page evidence',async t=>{
 const f=await fixture(t),importer=async()=>({state:'ready',product:structuredClone(f.product),evidence:structuredClone(f.evidence),attempts:[],imageIssues:[]}),input={html:f.html,sourceUrl:f.sourceUrl,storeId:'ozon-live',newJobOnly:true,studioTaskId:'studio-owner'};
 const [a,b]=await Promise.all([f.ws.importPage(input,{importer}),f.ws.importPage({...input,studioTaskId:'other-owner'},{importer})]);assert.deepEqual([a.jobCreated,b.jobCreated].sort(),[false,true]);assert.equal(a.job.id,b.job.id);assert.equal((await f.ws.repo.read()).jobs.length,1);
 const snapshot=await f.ws.getJob(a.job.id),different=async()=>({...await importer(),evidence:{...f.evidence,text:'different page evidence'}}),reused=await f.ws.importPage(input,{importer:different});assert.equal(reused.jobCreated,false);assert.deepEqual(await f.ws.getJob(a.job.id),snapshot);
 const plain=await f.ws.importProduct({storeId:'ozon-live',product:f.product});assert.equal(plain.id,a.job.id);assert.equal(plain.job,undefined);assert.equal(plain.created,undefined);const normalPage=await f.ws.importPage({html:f.html,sourceUrl:f.sourceUrl,storeId:'ozon-live'},{importer});assert.equal(normalPage.jobCreated,undefined);assert.equal(normalPage.job.id,a.job.id);
});
