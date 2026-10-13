import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {validateWbMapping,buildWbImportPayload,preflightWbImport,createWbImportSubmit,wbImportStatus,findWbCard} from '../adapters/wb-products.mjs';
import {wbAccount,createWbRead} from '../adapters/wb-api.mjs';
import {Workspace} from '../core/workspace.mjs';import {hash} from '../core/repository.mjs';import {DEMO_PRODUCT} from '../core/canonical.mjs';
import {wbSetupPanel,wbPublicationPreview} from '../web/wb-migration-setup.mjs';
import {guardWbPublication} from '../core/wb-publication.mjs';
import {localize} from '../adapters/codex.mjs';
const store={id:'wb-live-test',marketplace:'wb',mode:'live',wbRegion:'cn',wbContentTokenType:'personal'},credentials=async()=>({WB_API_TOKEN:'synthetic-token'}),account=()=>wbAccount(store,{getCredentials:credentials});
const defs=[{charcID:1,subjectID:100,subjectName:'Короба',name:'Материал',required:true,charcType:1,maxCount:1,existNamedField:false},{charcID:2,subjectID:100,name:'Объём',required:false,charcType:4,maxCount:0,existNamedField:false},{charcID:3,subjectID:100,name:'Цвет',required:false,charcType:1,maxCount:0,existNamedField:false}];
const mapping={subjectId:100,attributes:[{id:1,value:['Полипропилен']},{id:2,value:30},{id:3,value:['серый']}]};
const empty={cards:[],cursor:{total:0}};
async function read(s,path,body){if(path.includes('/charcs/'))return {data:defs};if(path.includes('/directory/colors'))return {data:[{name:'серый'}]};if(path.endsWith('/cards/limits'))return {data:{freeLimits:1,paidLimits:900}};if(path.includes('/get/cards/'))return empty;throw Error('unexpected '+path);}
async function job(){return {marketplace:'wb',mode:'manual',synthetic:false,canonical:{sku:'CN-STORAGE-01'},mapping,artifacts:{translate:{output:{title:'Складной короб',description:'Короб из полипропилена, 30 л.'}},map_attributes:{output:await validateWbMapping(store,mapping,{read})},image_edit:{output:{images:[]}},validate:{output:{passed:true}}},publishConfig:{brand:'',length:30,width:20,height:10,weightBrutto:'0.500',sizes:[{techSize:'0',skus:['1234567890123']}],documents:{excludeDocuments:true},kizMarked:false,rightsConfirmed:true,complianceConfirmed:true,contentReviewed:true}};}
async function operation(j){const payload={marketplace:'wb',apiBody:buildWbImportPayload(j),wbContext:await preflightWbImport(store,j,{read,accountRef:account})};return {kind:'publish',payload,payloadHash:hash(payload),approvedHash:hash(payload),approvedAt:new Date().toISOString()};}
const cardFor=op=>({nmID:12345,subjectID:100,...structuredClone(op.payload.apiBody[0].variants[0]),photos:[],sizes:op.payload.apiBody[0].variants[0].sizes.map(s=>({...s,chrtID:123}))});

test('WB mapping checks types, required fields, named fields, cardinality and dictionary values',async()=>{
 const good=await validateWbMapping(store,mapping,{read});assert.equal(good.category.id,100);assert.equal(good.schema.locale,'ru');assert.equal(good.attributes[1].value,30);
 for(const attrs of [[],[{id:1,value:'fabric'}],[{id:1,value:['a','b']}],[{id:1,value:['a']},{id:1,value:['a']}],[{id:1,value:['a']},{id:2,value:['30']}],[{id:1,value:['a']},{id:3,value:['hallucinated']}],[{id:999,value:['a']}]])await assert.rejects(()=>validateWbMapping(store,{...mapping,attributes:attrs},{read}));
 await assert.rejects(()=>validateWbMapping(store,mapping,{read:async(s,p,b)=>p.includes('/charcs/')?{data:defs.map(d=>({...d,existNamedField:true}))}:read(s,p,b)}),/非 characteristics/);
});
test('WB payload uses cm/kg, actual size barcodes, explicit documents and no inferred price or currency',async()=>{
 const j=await job(),body=buildWbImportPayload(j),v=body[0].variants[0];assert.deepEqual(v.dimensions,{length:30,width:20,height:10,weightBrutto:0.5});assert.equal(v.sizes[0].price,undefined);assert.equal(v.currency,undefined);assert.equal(v.documents.excludeDocuments,true);assert.equal(v.kizMarked,false);assert.equal(body[0].subjectID,100);
 for(const change of [x=>x.artifacts.translate.output.title='x'.repeat(61),x=>x.artifacts.translate.output.description='x'.repeat(1001),x=>x.canonical.sku='x'.repeat(73),x=>x.publishConfig.weightBrutto='0.0001',x=>x.publishConfig.width=0,x=>x.publishConfig.contentReviewed=false,x=>x.publishConfig.kizMarked=null,x=>x.publishConfig.sizes.push(structuredClone(x.publishConfig.sizes[0])),x=>x.publishConfig.documents={excludeDocuments:false},x=>x.publishConfig.documents={excludeDocuments:true,items:[{type:1}]},x=>x.artifacts.map_attributes.output.schema.items[0].required=false]){const x=structuredClone(j);change(x);assert.throws(()=>buildWbImportPayload(x));}
});
test('certificates require an allowed category type, real number and valid date range',async()=>{
 const j=await job();j.mapping={...mapping};j.artifacts.map_attributes.output=await validateWbMapping(store,mapping,{read:async(s,p,b)=>p.includes('/charcs/')?{data:[...defs,{charcID:15001135,subjectID:100,name:'Декларация',required:false,charcType:0,existNamedField:true}]}:read(s,p,b)});
 j.publishConfig.documents={excludeDocuments:false,items:[{type:2,number:'SYNTHETIC-DOC',startDate:'2026-01-01T00:00:00+03:00',endDate:'2030-01-01T00:00:00+03:00',isEndless:false}]};assert.equal(buildWbImportPayload(j)[0].variants[0].documents.items[0].type,2);
 j.publishConfig.documents.items[0].type=1;assert.throws(()=>buildWbImportPayload(j),/证件类型/);j.publishConfig.documents.items[0].type=2;j.publishConfig.documents.items[0].endDate='2025-01-01T00:00:00Z';assert.throws(()=>buildWbImportPayload(j),/截止日期/);
});
test('preflight rejects active and trashed vendor codes, partial search, paid-only limits and changed schema',async()=>{
 const j=await job();for(const kind of ['active','trash','partial','paid','schema']){await assert.rejects(()=>preflightWbImport(store,j,{accountRef:account,read:async(s,p,b)=>{
  if(kind==='active'&&p.endsWith('/cards/list')||kind==='trash'&&p.endsWith('/cards/trash'))return {cards:[{vendorCode:j.canonical.sku}],cursor:{total:1}};
  if(kind==='partial'&&p.endsWith('/cards/list'))return {cards:Array.from({length:100},()=>({vendorCode:'other'})),cursor:{total:100}};
  if(kind==='paid'&&p.endsWith('/limits'))return {data:{freeLimits:0,paidLimits:900}};
  if(kind==='schema'&&p.includes('/charcs/'))return {data:defs.map(d=>({...d,maxCount:10}))};return read(s,p,b);
 }}));}
 await assert.rejects(()=>preflightWbImport({...store,wbContentTokenType:undefined},j,{read,accountRef:account}),/wbContentTokenType/);
});
test('submission is one regional POST with frozen body, exact approval and no media or price writes',async()=>{
 const j=await job(),op=await operation(j),calls=[],send=createWbImportSubmit({read,accountRef:account,getCredentials:credentials,fetcher:async(u,o)=>{calls.push({u,o});return {ok:true,json:async()=>({error:false,errorText:'',additionalErrors:null})};}});
 const receipt=await send(store,op,j);assert.equal(receipt.imagesSubmitted,false);assert.equal(receipt.moderationVerified,false);assert.equal(calls.length,1);assert.equal(calls[0].u,'https://content-api.wildberries.cn/content/v2/cards/upload');assert.equal(calls[0].o.redirect,'error');assert.deepEqual(JSON.parse(calls[0].o.body),op.payload.apiBody);
 await assert.rejects(()=>send(store,{...op,approvedHash:'other'},j),e=>e.noWrite===true);assert.equal(calls.length,1);
});
test('expired approval, credential rotation and drift fail before write; transport and response ambiguity never retry',async()=>{
 const j=await job(),op=await operation(j);let writes=0;
 for(const extra of [{getCredentials:async()=>({WB_API_TOKEN:'rotated'})},{clock:()=>Date.now()+901000},{read:async(s,p,b)=>p.endsWith('/cards/list')?{cards:[{vendorCode:j.canonical.sku}],cursor:{total:1}}:read(s,p,b)}]){const send=createWbImportSubmit({read,accountRef:account,getCredentials:credentials,fetcher:async()=>{writes++;},...extra});await assert.rejects(()=>send(store,op,j),e=>e.noWrite===true);}
 assert.equal(writes,0);
 for(const response of [()=>{throw Error('SECRET');},()=>({ok:false,status:429,headers:new Headers({'Retry-After':'120'})}),()=>({ok:true,json:async()=>({error:true,errorText:'SECRET'})}),()=>({ok:true,json:async()=>({})})]){
  let n=0;const send=createWbImportSubmit({read,accountRef:account,getCredentials:credentials,fetcher:async()=>{n++;return response();}});await assert.rejects(()=>send(store,op,j),e=>!e.noWrite&&!e.message.includes('SECRET'));assert.equal(n,1);
 }
});
test('read-back requires matching content, dimensions, characteristics and sizes, not HTTP success or vendor alone',async()=>{
 const j=await job(),op=await operation(j),card=cardFor(op);const opts=c=>({accountRef:account,read:async()=>({cards:c?[c]:[],cursor:{total:c?1:0}})});
 assert.equal((await wbImportStatus(store,op,opts(null))).imported,false);const good=await wbImportStatus(store,op,opts(card));assert.equal(good.imported,true);assert.equal(good.moderationVerified,false);assert.equal(good.photosCount,0);
 for(const edit of [c=>c.title='Other',c=>c.dimensions.width=999,c=>c.characteristics[0].value=['Other'],c=>c.sizes[0].skus=['999999999'],c=>c.subjectID=200]){const c=structuredClone(card);edit(c);assert.equal((await wbImportStatus(store,op,opts(c))).status,'mismatch');}
 await assert.rejects(()=>wbImportStatus(store,op,{...opts(card),accountRef:async()=> 'other'}),/账户/);
 await assert.rejects(()=>findWbCard(store,j.canonical.sku,{read:async()=>({cards:[card,card],cursor:{total:2}})}),/多个/);
});
async function workspace(t,options={}){const dir=await mkdtemp(join(tmpdir(),'wb-publish-'));const w=new Workspace(join(dir,'w.json'),{stores:[store],wbPreflight:(s,j)=>preflightWbImport(s,j,{read,accountRef:account}),...options});await w.init();const j=await w.importProduct({storeId:store.id,product:{...DEMO_PRODUCT,itemId:'123456789',sourceUrl:'https://item.taobao.com/item.htm?id=123456789',sku:'CN-STORAGE-01'}}),prepared=await job();await w.repo.mutate(db=>Object.assign(db.jobs.find(x=>x.id===j.id),{...prepared,id:j.id,storeId:store.id,revision:1,state:'review_gate',gates:{category:{revision:1}},evidence:[]}));t.after(()=>rm(dir,{recursive:true,force:true}));return {w,id:j.id};}
test('workspace WB gate is bound to revision and executes once, with read-back separate from creation',async t=>{
 let sends=0;const {w,id}=await workspace(t,{wbSubmit:async(_s,op)=>{sends++;await new Promise(r=>setTimeout(r,10));return {externalWrite:true,marketplace:'wb',status:'submitted',imagesSubmitted:false};},wbStatus:async()=>({imported:true,productId:123,status:'card_observed',moderationVerified:false,imagesSubmitted:false})});
 const op=await w.preparePublish(id);assert.equal(op.payload.marketplace,'wb');assert.deepEqual(op.payload.images,[]);await assert.rejects(()=>w.executeOperation(op.id));await w.approveOperation(op.id,op.payloadHash);await Promise.allSettled([w.executeOperation(op.id),w.executeOperation(op.id)]);assert.equal(sends,1);assert.equal((await w.getJob(id)).state,'submitted');await w.executeOperation(op.id);assert.equal(sends,1);
 const j=await w.syncPublished(id);assert.equal(j.state,'imported');assert.equal(j.wbPublicationStage,'images_pending');assert.equal((await w.view()).operations[0].state,'verified');assert.equal((await w.view()).auditValid,true);
});
test('pre-send block restores review, unknown send stays locked across restart and cannot be replayed',async t=>{
 const {w,id}=await workspace(t,{wbSubmit:async()=>{const e=Error('preflight changed');e.noWrite=true;throw e;}});let op=await w.preparePublish(id);await w.approveOperation(op.id,op.payloadHash);await assert.rejects(()=>w.executeOperation(op.id));assert.equal((await w.getJob(id)).state,'review_gate');assert.equal((await w.view()).operations[0].state,'blocked');
 await w.repo.mutate(db=>{delete db.operations[0].executedAt;delete db.operations[0].completedAt;});w.wbSubmit=async()=>{throw Error('ambiguous');};op=await w.preparePublish(id);await w.approveOperation(op.id,op.payloadHash);await assert.rejects(()=>w.executeOperation(op.id));assert.equal((await w.getJob(id)).state,'publishing');await assert.rejects(()=>w.executeOperation(op.id));await assert.rejects(()=>w.setup(id,{publishConfig:{}}));
 await w.repo.mutate(db=>db.operations.find(o=>o.id===op.id).state='executing');await w.init();assert.equal((await w.view()).operations.find(o=>o.id===op.id).state,'unknown');assert.equal((await w.view()).auditValid,true);
});
test('WB draft edits revoke gate and synthetic sources cannot reach real publication',async t=>{
 const {w,id}=await workspace(t);const op=await w.preparePublish(id);await w.setup(id,{mapping});await assert.rejects(()=>w.approveOperation(op.id,op.payloadHash));await w.repo.mutate(db=>{const j=db.jobs.find(x=>x.id===id);j.state='review_gate';j.artifacts.validate={output:{passed:true}};j.gates.category={revision:j.revision};j.synthetic=true;});await assert.rejects(()=>w.preparePublish(id));
});
test('WB read-only transport admits publication checks but rejects creation and media writes',async()=>{
 const readOnly=createWbRead({getCredentials:credentials,clock:()=>0,sleep:async()=>{},fetcher:async()=>({ok:true,json:async()=>({error:false,data:{}})})});for(const [path,body] of [['/content/v2/cards/limits',undefined],['/content/v2/get/cards/trash',{}],['/content/v2/cards/error/list',{}],['/content/v2/directory/colors?locale=ru',undefined]])await readOnly(store,path,body);
 await assert.rejects(()=>readOnly(store,'/content/v2/cards/upload',[]));await assert.rejects(()=>readOnly(store,'/content/v3/media/save',{}));
});
test('WB Chinese setup separates draft creation from photos, price and stock and escapes source content',async()=>{
 const j={...await job(),id:'ui-wb',state:'review_gate'};assert.match(wbSetupPanel(j),/包装长度 cm/);assert.match(wbSetupPanel(j),/WB 特征映射/);assert.doesNotMatch(wbSetupPanel(j),/Ozon 发布/);j.publishConfig.brand='<script>';assert.doesNotMatch(wbSetupPanel(j),/<script>/);j.state='imported';assert.match(wbSetupPanel(j),/不能视为已开售/);
});
test('account aliases share write reservation and persisted cooldown; identical vendor cannot be submitted twice',async()=>{
 const op={...await operation(await job()),id:'second'},other={...structuredClone(op),id:'first',storeId:'alias',state:'executing',executedAt:new Date(Date.now()-20000).toISOString()};
 assert.throws(()=>guardWbPublication({operations:[other]},op),/正在提交/);other.state='submitted';assert.throws(()=>guardWbPublication({operations:[other]},op),/该货号/);
 other.payload.apiBody[0].variants[0].vendorCode='OTHER';other.state='unknown';other.retryAt=Date.now()+120000;assert.throws(()=>guardWbPublication({operations:[other]},op),/间隔/);delete other.retryAt;
 assert.doesNotThrow(()=>guardWbPublication({operations:[other]},op));other.completedAt=new Date().toISOString();assert.throws(()=>guardWbPublication({operations:[other]},op),/间隔/);delete other.completedAt;other.executedAt=new Date().toISOString();assert.throws(()=>guardWbPublication({operations:[other]},op),/间隔/);
});
test('subscription localization uses WB title and description budgets before manual review',async()=>{
 let prompt;const output={title:'Короб',description:'Полипропиленовый короб.',attributes:[],imageTexts:[],seo:[],warnings:[]};
 await localize(DEMO_PRODUCT,{marketplace:'wb',run:async r=>{prompt=r.prompt;return {output};}});assert.match(prompt,/Wildberries/);assert.match(prompt,/title <= 60/);assert.match(prompt,/description <= 1000/);
 await assert.rejects(()=>localize(DEMO_PRODUCT,{marketplace:'wb',run:async()=>({output:{...output,title:'Я'.repeat(61)}})}));
});

test('a later WB mismatch revokes the current successful observation without allowing a second creation',async t=>{
 let matches=true;const {w,id}=await workspace(t,{wbSubmit:async()=>({externalWrite:true,status:'submitted'}),wbStatus:async()=>({imported:matches,status:matches?'card_observed':'mismatch'})});
 const op=await w.preparePublish(id);await w.approveOperation(op.id,op.payloadHash);await w.executeOperation(op.id);await w.syncPublished(id);matches=false;
 const j=await w.syncPublished(id);assert.equal(j.state,'submitted');assert.equal(j.wbPublicationStage,'content_mismatch');assert.equal((await w.view()).operations[0].state,'submitted');assert.doesNotMatch(wbSetupPanel(j),/已读取到匹配卡片/);await assert.rejects(()=>w.preparePublish(id));assert.equal((await w.view()).auditValid,true);
});
test('WB review shows seller-readable packaging, sizes, attributes and documents, with escaped values',async()=>{
 const p={apiBody:buildWbImportPayload(await job()),attributeNames:{1:'Материал',2:'Объём',3:'Цвет'}};let html=wbPublicationPreview(p);
 assert.match(html,/30 × 20 × 10 cm/);assert.match(html,/1234567890123/);assert.match(html,/Материал：Полипропилен/);assert.match(html,/无需许可/);
 p.apiBody[0].variants[0].documents={items:[{type:2,number:'<script>',startDate:'2026-01-01',isEndless:true}]};html=wbPublicationPreview(p);assert.match(html,/符合性声明/);assert.match(html,/长期有效/);assert.doesNotMatch(html,/<script>/);
});

test('isolated WB demo still completes without a live account or real write guards',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wb-demo-'));t.after(()=>rm(dir,{recursive:true,force:true}));const w=new Workspace(join(dir,'w.json'));await w.init();const j=await w.importProduct({storeId:'wb-demo',demo:true});
 for(let n=0;n<6;n++)await w.step(j.id);const ready=await w.getJob(j.id);assert.equal(ready.state,'review_gate');await w.approveCategory(j.id,ready.revision);const op=await w.preparePublish(j.id);await w.approveOperation(op.id,op.payloadHash);const done=await w.executeOperation(op.id);assert.equal(done.state,'done');assert.equal(done.receipt.externalWrite,false);assert.equal((await w.syncPublished(j.id)).state,'synced');
});

test('fresh WB marking requirements and expiry during preflight block before any write',async()=>{
 const j=await job();j.mapping={...mapping,attributes:[...mapping.attributes,{id:4,value:['1234']}]};
 let requires=false;const liveRead=async(s,p,b)=>p.includes('/charcs/')?{data:[...defs,{charcID:4,subjectID:100,name:'ТНВЭД',required:true,charcType:1,maxCount:1}]}:p.includes('/tnved')?{data:[{tnved:'1234',isKiz:requires}]}:read(s,p,b);
 j.artifacts.map_attributes.output=await validateWbMapping(store,j.mapping,{read:liveRead});requires=true;await assert.rejects(()=>preflightWbImport(store,j,{read:liveRead,accountRef:account}),/标识码/);
 const ready=await job(),op=await operation(ready);let time=Date.now(),writes=0;const submit=createWbImportSubmit({read:async(s,p,b)=>{time+=300000;return read(s,p,b);},accountRef:account,getCredentials:credentials,clock:()=>time,fetcher:async()=>{writes++;}});
 await assert.rejects(()=>submit(store,op,ready),e=>e.noWrite===true&&/过期/.test(e.message));assert.equal(writes,0);
});
