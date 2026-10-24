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
import {studioReviewHash} from '../core/product-facts.mjs';
import {correctStudioBrand} from '../core/studio-brand-correction.mjs';

async function fixture(t,{brand='厦泰',fromHtml=false,state='ready'}={}){
 const root=await mkdtemp(join(tmpdir(),'studio-reused-brand-')),assetDir=join(root,'assets'),previousAssets=process.env.OPS_ASSET_DIR;
 process.env.OPS_ASSET_DIR=assetDir;t.after(async()=>{if(previousAssets===undefined)delete process.env.OPS_ASSET_DIR;else process.env.OPS_ASSET_DIR=previousAssets;await rm(root,{recursive:true,force:true});});await mkdir(assetDir);
 const bytes=Buffer.from('legacy selected physical brand photo'),assetId=createHash('sha256').update(bytes).digest('hex');await writeFile(join(assetDir,assetId+'.png'),bytes);
 const sourceUrl='https://item.taobao.com/item.htm?id=123&skuId=456',selectedVariant='【原装火花塞1个】',html='<title>摩托车火花塞-淘宝网</title><div>参数信息 品牌 厦泰 商品参数内容足够完整 快递: 免运费</div><span class="highlightPrice--x">79.9</span><div class="valueItem--x isSelected--x">'+selectedVariant+'</div><img class="mainPic--x" src="https://img.alicdn.com/photo.jpg">',evidence=parseSavedPage(html,{sourceUrl}),manifest=[{name:'photo.jpg',assetId}],options={commissionPct:15,domesticShipping:null,taxPct:0,multiplier:3,width:200,height:200,depth:200,weight:400};
 const product={sourceUrl,sku:'TB-123-456',titleZh:'摩托车火花塞',descriptionZh:'已选规格：'+selectedVariant,categoryZh:'摩托配件',brand,price:79.9,currency:'CNY',attributes:{规格:'1个'},images:[],localized:{title:'Старая свеча',description:'Старое описание',warnings:[]}},content={provider:'original',output:{title:'Старая свеча',description:'Старое описание'}},visuals={images:[{assetId:'old-picture'}]},task={id:'legacy',jobId:'job',storeId:'ozon-live',key:hash({source:fromHtml?evidence.sourceHash:sourceUrl,store:'ozon-live',options}),state,sourceUrl,sourceHash:evidence.sourceHash,evidence,sourceMediaFiles:manifest,product,content,visuals,pricing:{price:'582.09'},preparedMediaPack:{images:visuals.images},options,events:[],publicationAgent:{enabled:false,state:'paused'}};task.reviewHash=studioReviewHash(task);
 const ws=new Workspace(join(root,'workspace.json'));await ws.init();await writeFile(join(root,evidence.sourceHash+'.html'),html);await ws.repo.mutate(db=>{db.studioTasks=[task];db.jobs.push({id:'job',state:'map_attributes',revision:4,canonical:canonical(product),artifacts:{translate:{output:content.output},image_edit:{output:visuals},validate:{output:{passed:true}}},gates:{old:true},pageImport:{evidence:structuredClone(evidence)}});});
 const output={confirmed:true,readable:true,printedBrand:'CFMOTO',scope:'factory-packaging',brandSource:'physical-marking',identityConfirmed:true,selectedVariant,identityReason:'Выбрана одна свеча зажигания в заводской упаковке.',reason:'Читаемый бренд на физической упаковке.'},calls=[];
 const studio=new ProductStudio(ws,{root,importer:async()=>assert.fail('must not create another imported job'),sourceReader:async()=>{calls.push('source');return {html,files:manifest,capture:{method:'test',state:'verified'}};},verifyBrandPhoto:async request=>{calls.push('brand');assert.deepEqual(request.images,[join(assetDir,assetId+'.png')]);assert.equal(request.prompt.includes('CFMOTO'),false);return {provider:'offline-codex',output};},improve:async p=>{calls.push('copy');return {output:{title:p.brand+' свеча зажигания',description:'Новое описание'}};},visuals:async()=>{calls.push('visuals');return {images:[{assetId:'new-picture'}]};}});
 const start=async(input={})=>{const result=await studio.start({sourceUrl,storeId:'ozon-live',...input});await studio.sourceTail;await studio.tail;return {started:result,task:await studio.get('legacy')};};
 return {ws,studio,task,sourceUrl,html,evidence,manifest,output,calls,start};
}

test('automatic source-photo correction confirms a matching brand without changing the job, copy or media',async t=>{
 const f=await fixture(t,{brand:'cfmoto'}),before=await f.ws.repo.read();await f.studio.correctBrand('legacy',{basis:'source-photo',reason:'Независимая проверка выбранного фото',expectedHash:f.task.reviewHash});await f.studio.tail;const task=await f.studio.get('legacy'),after=await f.ws.repo.read();
 assert.equal(task.state,'ready');assert.equal(task.brandCorrection.state,'confirmed');assert.equal(task.brandCorrection.basis,'source-photo');assert.equal(task.brandCorrection.proof.printedBrand,'CFMOTO');assert.equal(task.product.brand,'cfmoto');assert.deepEqual(f.calls,['brand']);assert.deepEqual(after.jobs,before.jobs);assert.equal(task.brandVersions,undefined);for(const field of ['product','content','visuals','pricing','preparedMediaPack','reviewHash','evidence','sourceMediaFiles'])assert.deepEqual(task[field],before.studioTasks[0][field]);assert.equal(after.operations.length,0);
});

test('an empty source-photo brand is independently read once before the existing atomic regeneration',async t=>{
 const f=await fixture(t);await f.studio.correctBrand('legacy',{basis:'source-photo',brand:'',reason:'Независимая проверка выбранного фото',expectedHash:f.task.reviewHash});await f.studio.tail;const task=await f.studio.get('legacy'),db=await f.ws.repo.read();assert.equal(task.brandCorrection.state,'applied',task.brandCorrection.error);assert.equal(task.product.brand,'CFMOTO');assert.deepEqual(f.calls,['brand','copy','visuals']);assert.equal(db.jobs.length,1);assert.equal(db.jobs[0].revision,5);assert.equal(db.operations.length,0);assert.deepEqual(task.evidence,f.evidence);assert.ok(verifyAudit(db.audit));
});

test('reusing the same URL verifies the unchanged source before correcting the same paused draft',async t=>{
 const f=await fixture(t);await f.ws.repo.mutate(db=>{db.studioTasks[0].publicationAgent={enabled:true,state:'waiting'};});const {started,task}=await f.start(),db=await f.ws.repo.read();assert.equal(started.id,'legacy');assert.equal(task.sourceCheck.state,'verified');assert.equal(task.sourceCheck.changed,false);assert.equal(task.brandCorrection.state,'applied',task.brandCorrection.error);assert.deepEqual(f.calls,['source','brand','copy','visuals']);assert.equal(task.publicationAgent.enabled,false);assert.equal(task.publicationAgent.state,'paused');assert.equal(db.studioTasks.length,1);assert.equal(db.jobs.length,1);assert.equal(db.operations.length,0);assert.deepEqual(db.jobs[0].pageImport.evidence,f.evidence);
});

test('changed or unavailable source checks preserve the old draft without starting brand proof',async t=>{
 for(const changed of [true,false])await t.test(changed?'source changed':'source unavailable',async t=>{const f=await fixture(t),before=(await f.ws.repo.read()).jobs;f.studio.sourceReader=async()=>{if(!changed)throw Error('source unavailable');return {html:f.html.replace('摩托车火花塞-淘宝网','Другой товар-淘宝网'),files:f.manifest,capture:{state:'verified'}};};const {task}=await f.start();assert.equal(task.sourceCheck.state,changed?'verified':'failed');if(changed)assert.equal(task.sourceCheck.changed,true);assert.equal(task.brandCorrection,undefined);assert.equal(task.product.brand,'厦泰');assert.deepEqual(f.calls,[]);assert.deepEqual((await f.ws.repo.read()).jobs,before);});
});

test('owner edits, selected identity fields and previous correction attempts are protected on reuse',async t=>{
 const markers=[task=>task.content.ownerEdited=true,task=>task.ownerEdited=true,task=>task.brandCorrection={basis:'owner-confirmed',state:'applied'},task=>task.brandCorrection={basis:'source-photo',state:'failed'},task=>task.brandResolution={state:'unconfirmed'},task=>task.brandSelection={source:'dictionary-context-reviewed'},task=>task.categorySelection={source:'owner-selected'},task=>task.supplementalFacts={proofHash:'preserve-verified-document'}];
 for(const [index,change]of markers.entries())await t.test('protected marker '+index,async t=>{const f=await fixture(t);await f.ws.repo.mutate(db=>change(db.studioTasks[0]));const before=(await f.ws.repo.read()).jobs,{task}=await f.start();assert.equal(task.product.brand,'厦泰');assert.deepEqual(f.calls,['source']);assert.deepEqual((await f.ws.repo.read()).jobs,before);});
});

test('HTML photo reupload migrates the existing ready draft without a second job or media enhancement',async t=>{
 const f=await fixture(t,{fromHtml:true});f.studio.sourceReader=async()=>assert.fail('HTML does not need another URL capture');f.studio.enhanceMedia=async()=>assert.fail('brand regeneration already prepares media');const {started,task}=await f.start({html:f.html,sourceMediaFiles:f.manifest}),db=await f.ws.repo.read();assert.equal(started.id,'legacy');assert.equal(task.brandCorrection.state,'applied',task.brandCorrection.error);assert.deepEqual(f.calls,['brand','copy','visuals']);assert.equal(db.studioTasks.length,1);assert.equal(db.jobs.length,1);assert.equal(db.operations.length,0);
});

test('HTML photo reupload migrates the same needs-price draft without creating a duplicate',async t=>{
 const f=await fixture(t,{fromHtml:true,state:'needs_price'});f.studio.enhanceMedia=async()=>assert.fail('correction already regenerates media');const {started,task}=await f.start({html:f.html,sourceMediaFiles:f.manifest}),db=await f.ws.repo.read();assert.equal(started.id,'legacy');assert.equal(task.state,'needs_price');assert.equal(task.brandCorrection.state,'applied',task.brandCorrection.error);assert.equal(task.product.brand,'CFMOTO');assert.equal(db.studioTasks.length,1);assert.equal(db.jobs.length,1);assert.equal(db.operations.length,0);
});

test('failed automatic proof is not automatically repeated on the next identical link',async t=>{
 const f=await fixture(t);f.output.scope='seller-overlay';const first=await f.start();assert.equal(first.task.brandCorrection.state,'failed');const before=(await f.ws.repo.read()).jobs,second=await f.start();assert.equal(second.task.brandCorrection.state,'failed');assert.deepEqual(f.calls,['source','brand','source']);assert.deepEqual((await f.ws.repo.read()).jobs,before);assert.equal(second.task.product.brand,'厦泰');
});

test('atomic migration guard preserves an owner marker even if the review hash did not change',async t=>{
 const f=await fixture(t),expectedHash=f.task.reviewHash;await f.ws.repo.mutate(db=>{db.studioTasks[0].content.ownerEdited=true;});assert.equal(studioReviewHash(await f.studio.get('legacy')),expectedHash);await assert.rejects(correctStudioBrand(f.studio,'legacy',{basis:'source-photo',reason:'Проверка сохранённого черновика',expectedHash},{reuseUnreviewedDraft:true}),/владельцем/);assert.equal((await f.studio.get('legacy')).brandCorrection,undefined);assert.deepEqual(f.calls,[]);
});

test('a repeated link while proof runs returns the same task and cannot create a second job or proof',async t=>{
 const f=await fixture(t,{fromHtml:true}),verify=f.studio.verifyBrandPhoto;let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.studio.verifyBrandPhoto=async request=>{entered();await gate;return verify(request);};
 await f.studio.start({sourceUrl:f.sourceUrl,storeId:'ozon-live'});await started;const reused=await f.studio.start({sourceUrl:f.sourceUrl,storeId:'ozon-live'});assert.equal(reused.id,'legacy');assert.equal(reused.state,'copy');assert.equal((await f.ws.repo.read()).jobs.length,1);release();await f.studio.sourceTail;await f.studio.tail;assert.deepEqual(f.calls,['source','brand','copy','visuals']);assert.equal((await f.ws.repo.read()).studioTasks.length,1);
});
