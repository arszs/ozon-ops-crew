import {creativeViews,creativeTrialSnapshot} from './review-creatives.mjs';
import {marketplaceRegistry,requireStoreAdapter} from '../adapters/registry.mjs';
import {wbPriceTrialEconomics} from './wb-price-trial.mjs';
import {readWbStockContext,submitWbStock,readWbStockResult,listWbStockWarehouses} from '../adapters/wb-stock-write.mjs';
import {inspectWbStock,prepareWbStock,approveWbStock,executeWbStock,reconcileWbStock,confirmWbStock} from './wb-stock-control.mjs';
import {inspectWbPrice,prepareWbPrice,approveWbPrice,executeWbPrice,reconcileWbPrice} from './wb-price-control.mjs';
import {readWbPriceContext,submitWbPrice,readWbPriceResult} from '../adapters/wb-price-write.mjs';
import {prepareWbMedia,approveWbMedia,executeWbMedia,readWbMediaResult,confirmWbMediaResult} from './wb-media.mjs';
import {inspectWbImage,readWbMediaTarget,uploadWbMedia} from '../adapters/wb-media.mjs';
import {prepareWbPublication,guardWbPublication,syncWbPublication} from './wb-publication.mjs';
import {buildWbImportPayload,preflightWbImport,submitWbImport,wbImportStatus} from '../adapters/wb-products.mjs';
import {repeatContext} from './repeat-trials.mjs';
import {readCpo,submitCpoDisable,submitCpoEnable} from '../adapters/ozon-cpo.mjs';
import {inspectCpo,prepareCpo,verifyCpo,reconcileCpo} from './cpo-control.mjs';
import {readPrice,priceBody,priceContextBlockers,submitPrice} from '../adapters/ozon-prices.mjs';
import {evaluateLedgerTrial} from './finance-reconciliation.mjs';
import {costProfile,latestCosts,priceTrialEconomics} from './sku-costs.mjs';
import {wbCharacteristics} from '../adapters/wb-content.mjs';
import {draftBuyerMessage,translateReplyForApproval} from '../adapters/review-draft.mjs';
import {migrationBenchmark} from './benchmark.mjs';
import {evaluateTrial,planTrial,checkPlanResult} from './profit-trials.mjs';
import {sampleImages} from '../adapters/media.mjs';
import {categoryAttributes,attributeValues,buildImportPayload,submitImport,importStatus,ozonCall} from '../adapters/ozon-products.mjs';
import {randomUUID} from 'node:crypto';
import {Repository,audit,hash,maskPII,verifyAudit} from './repository.mjs';
import {canonical,DEMO_PRODUCT} from './canonical.mjs';
import {STAGES,runAgent} from '../adapters/agents.mjs';
import {importSavedPage} from './page-import.mjs';
import {landedPrice} from './landed-pricing.mjs';
import {oglPrice,cnyRate} from './ogl-pricing.mjs';
import {connectOzon} from './connection-setup.mjs';
import {readStore,dictionaries,executeMarketplace,readMessages} from '../adapters/marketplaces.mjs';
import {assessStore,unitEconomics} from './assessment.mjs';
const find=(items,id)=>{const x=items.find(v=>v.id===id);if(!x)throw Error('Not found');return x;};
const publicStore=s=>({id:s.id,name:s.name,marketplace:s.marketplace,mode:s.mode,...(s.marketplace==='wb'?{wbRegion:s.wbRegion||'ru'}:{}),writesEnabled:s.marketplace==='ozon'&&s.mode==='live',...(s.snapshot?{snapshot:s.snapshot}:{})});
const now=()=>new Date().toISOString();
const replySource=r=>hash({storeId:r.storeId,externalId:r.externalId||null,kind:r.kind||'review',textRu:r.textRu});
function verifyReply(db,op){if(typeof op.payload.replyZh!=='string'||!op.payload.replyZh.trim())throw Error('请重新生成带中文翻译的回复确认');const r=find(db.reviews,op.payload.reviewId);if(r.storeId!==op.storeId||r.status==='answered'||replySource(r)!==op.payload.sourceHash||(r.reply||null)!==op.payload.before)throw Error('买家消息或回复已改变，请重新拟定并确认');return r;}

export class Workspace{
 constructor(file,{stores=[],execute=executeMarketplace,agent=runAgent,submit=submitImport,wbPreflight=preflightWbImport,wbSubmit=submitWbImport,wbStatus=wbImportStatus,wbStockProduct=async()=>{throw Error('请先同步 WB 目录');},wbStockContext=readWbStockContext,wbStockSubmit=submitWbStock,wbStockResult=readWbStockResult,wbStockWarehouses=listWbStockWarehouses,wbPriceProduct=async()=>{throw Error('请先同步 WB 目录');},wbPriceContext=readWbPriceContext,wbPriceSubmit=submitWbPrice,wbPriceResult=readWbPriceResult,wbImageInspect=inspectWbImage,wbMediaTarget=readWbMediaTarget,wbMediaUpload=uploadWbMedia,wbMediaWait=ms=>new Promise(r=>setTimeout(r,ms)),draftReview=draftBuyerMessage,translateReply=translateReplyForApproval,messageReader=readMessages,storeReader=readStore,priceReader=readPrice,priceSubmit=submitPrice,cpoReader=readCpo,cpoSubmit=submitCpoDisable,cpoEnableSubmit=submitCpoEnable,liveSnapshot=()=>null}={}){this.repo=new Repository(file);this.wbStockProduct=wbStockProduct;this.wbStockContext=wbStockContext;this.wbStockSubmit=wbStockSubmit;this.wbStockResult=wbStockResult;this.wbStockWarehouses=wbStockWarehouses;this.wbPriceProduct=wbPriceProduct;this.wbPriceContext=wbPriceContext;this.wbPriceSubmit=wbPriceSubmit;this.wbPriceResult=wbPriceResult;this.wbImageInspect=wbImageInspect;this.wbMediaTarget=wbMediaTarget;this.wbMediaUpload=wbMediaUpload;this.wbMediaWait=wbMediaWait;this.wbPreflight=wbPreflight;this.wbSubmit=wbSubmit;this.wbStatus=wbStatus;this.draftReview=draftReview;this.translateReply=translateReply;this.messageReader=messageReader;this.storeReader=storeReader;this.priceReader=priceReader;this.priceSubmit=priceSubmit;this.cpoReader=cpoReader;this.cpoSubmit=cpoSubmit;this.cpoEnableSubmit=cpoEnableSubmit;this.reviewTasks=new Map();this.configStores=stores;this.execute=execute;this.agent=agent;this.submit=submit;this.liveSnapshot=liveSnapshot;}
 async init(){for(const store of this.configStores)requireStoreAdapter(store);return this.repo.mutate(db=>{for(const c of db.priceChecks||[])if(c.state==='reading'){c.state='interrupted';audit(db,{kind:'price.conditions.interrupted',checkId:c.id});}for(const c of db.creatives||[])if(['queued','generating'].includes(c.state)){c.state='interrupted';audit(db,{kind:'creative.interrupted',creativeId:c.id});}for(const op of db.operations.filter(o=>(['cpo_disable','cpo_enable'].includes(o.kind)||o.kind==='publish'&&o.payload.marketplace==='wb'||['wb_media','wb_price','wb_stock'].includes(o.kind))&&o.state==='executing')){op.state='unknown';if(op.kind==='wb_media')for(const item of op.items||[])if(item.state==='executing')item.state='unknown';op.error='服务重启：提交结果不确定，请读取核对，禁止自动重试';audit(db,{kind:'operation.interrupted',operationId:op.id});}for(const s of [{id:'ozon-live',name:'Ozon · API 店铺',marketplace:'ozon',mode:'live',writesEnabled:false},{id:'ozon-demo',name:'Ozon · 演示店铺',marketplace:'ozon',mode:'mock',writesEnabled:false},{id:'wb-demo',name:'Wildberries · 演示店铺',marketplace:'wb',mode:'mock',writesEnabled:false},...this.configStores])if(!db.stores.some(x=>x.id===s.id))db.stores.push(publicStore(s));});}
 resolveStore(db,id){const s=find(db.stores,id);const store={...s,...this.configStores.find(x=>x.id===id)};requireStoreAdapter(store);return store;}
 async view(){const db=await this.repo.read();return {priceChecks:(db.priceChecks||[]).slice(-100),creatives:creativeViews(db),marketplaces:marketplaceRegistry(),costProfiles:latestCosts(db),trialPlans:(db.trialPlans||[]).slice(-100),trials:(db.trials||[]).slice(-100),stores:db.stores.map(s=>publicStore(this.resolveStore(db,s.id))),jobs:db.jobs.map(({artifacts,evidence,canonical,...j})=>({...j,sku:canonical.sku,title:canonical.titleZh,source:canonical.source})),operations:db.operations,reviews:db.reviews,assessments:db.assessments.slice(-20),audit:db.audit.slice(-100),auditValid:verifyAudit(db.audit),metrics:{jobs:db.jobs.length,completed:db.jobs.filter(j=>j.state==='synced').length,mode:'mock_and_manual',realSkuBenchmark:0,targetMinutes:10,measuredOnly:'内部运行耗时不包含真实平台审核'}};}
 async benchmark(){return migrationBenchmark(await this.repo.read());}
 async getJob(id){const db=await this.repo.read();return find(db.jobs,id);}
 async addStore(input){return this.repo.mutate(db=>{if(!['ozon','wb'].includes(input.marketplace)||typeof input.name!=='string'||!input.name.trim()||input.name.length>80)throw Error('Invalid store');const s={id:randomUUID(),name:input.name.trim(),marketplace:input.marketplace,mode:'mock',writesEnabled:false};db.stores.push(s);audit(db,{kind:'store.created',storeId:s.id,mode:s.mode});return s;});}
 async connectOzon(input,options){const connected=await connectOzon(input,options);this.configStores=[...this.configStores.filter(s=>s.id!==connected.store.id),connected.store];return this.repo.mutate(db=>{const store=publicStore(connected.store),at=db.stores.findIndex(s=>s.id===store.id);if(at<0)db.stores.push(store);else db.stores[at]=store;audit(db,{kind:'store.connected',storeId:store.id,externalWrite:false});return {store,catalogTotal:connected.catalogTotal};});}
 async synchronize(storeId){const db=await this.repo.read(),store=this.resolveStore(db,storeId);const live=storeId==='ozon-live'?this.liveSnapshot():null;const result=live?{mode:'live',products:live.rows.map(p=>({sku:p.sku,name:p.name,price:p.price,stock:p.stock})),orders:live.orders?.units??null,orderedAmount:live.orders?.amount??null,period:live.period,catalogTotal:live.catalogTotal,profit:null,source:'Ozon Seller API + Performance API'}:await this.storeReader(store);return this.repo.mutate(db=>{const s=find(db.stores,storeId);s.snapshot={...result,fetchedAt:now()};audit(db,{kind:'store.sync',storeId,outputHash:hash(result),mode:store.mode});return s.snapshot;});}
 async wbCharacteristics(storeId,subjectId,locale='zh'){const db=await this.repo.read();return wbCharacteristics(this.resolveStore(db,storeId),subjectId,{locale});}
 async attributes(storeId,categoryId,typeId){const db=await this.repo.read();return categoryAttributes(this.resolveStore(db,storeId),categoryId,typeId);}
 async values(storeId,input){const db=await this.repo.read();return attributeValues(this.resolveStore(db,storeId),input);}
 async setup(id,input){return this.repo.mutate(db=>{const j=find(db.jobs,id);if(['running','publishing','submitted','imported','published','synced'].includes(j.state))throw Error('Cannot change submitted or running job');if(input.mapping)j.mapping=structuredClone(input.mapping);if(input.publishConfig)j.publishConfig=structuredClone(input.publishConfig);j.revision++;j.gates={};for(const s of ['map_attributes','validate'])delete j.artifacts[s];if(j.artifacts.image_edit)j.state='map_attributes';delete j.error;delete j.failedStage;audit(db,{kind:'job.setup',jobId:id,revision:j.revision,inputHash:hash(input)});return j;});}
 async dictionary(storeId,query){const db=await this.repo.read();return dictionaries(this.resolveStore(db,storeId),query);}
 async importPage(input,{importer=importSavedPage}={}){
  const db=await this.repo.read();const pageStore=this.resolveStore(db,input.storeId);if(pageStore.marketplace!=='ozon')throw Error('保存页面导入目前仅支持 Ozon 店铺');
  const result=await importer(input.html,{sourceUrl:input.sourceUrl,fallback:process.env.OPS_PAGE_FALLBACK==='review'?'review':'codex'});
  if(result.state!=='ready')return this.repo.mutate(db=>{const record={id:randomUUID(),createdAt:now(),storeId:input.storeId,...result};(db.pageImports||=[]).push(record);audit(db,{kind:'page.needs_review',pageImportId:record.id,sourceHash:result.evidence?.sourceHash});return record;});
  if(input.sourceImageRightsConfirmed===true)for(const image of result.product.images)image.rightsConfirmed=true;
  const job=await this.importProduct({storeId:input.storeId,product:result.product});
  return this.repo.mutate(db=>{const j=find(db.jobs,job.id);j.pageImport={evidence:result.evidence,attempts:result.attempts,imageIssues:result.imageIssues,publicationBlockers:result.publicationBlockers};
   if(!j.evidence.some(e=>e.kind==='saved_page'&&e.hash===result.evidence.sourceHash))j.evidence.push({kind:'saved_page',hash:result.evidence.sourceHash,time:now()});
   audit(db,{kind:'page.imported',jobId:j.id,sourceHash:result.evidence.sourceHash,sourceImageRightsConfirmed:input.sourceImageRightsConfirmed===true});return {...result,job:j};});
 }
 async keepSourceImages(id){return this.repo.mutate(db=>{
  const j=find(db.jobs,id);if(j.marketplace!=='ozon'||!j.artifacts.translate||['running','publishing','submitted','imported','published','synced'].includes(j.state))throw Error('请先完成文字处理');
  if(!j.canonical.images.length||j.canonical.images.some(i=>!i.rightsConfirmed||!i.assetId))throw Error('请先导入原图并确认使用权');
  const output={mode:'source_original',ocrVerified:false,images:j.canonical.images.map(i=>({...i,sourceAssetId:i.assetId,sourceText:i.textZh||'',translatedText:'',warnings:['原图保持不变，可能含中文或水印；提交前请核对'],requiresHumanReview:true})),notice:'使用原始照片；没有执行文字翻译或图片重绘。'};
  j.revision++;j.gates={};for(const stage of ['map_attributes','validate'])delete j.artifacts[stage];
  j.artifacts.image_edit={agent:'Photo selection',tool:'human.keep_originals',output,outputHash:hash(output),at:now(),durationMs:0};j.state='map_attributes';delete j.error;delete j.failedStage;
  audit(db,{kind:'images.originals_selected',jobId:id,revision:j.revision,outputHash:hash(output)});return j;
 });}
 async priceOgl(id,input={}){
  const job=await this.getJob(id),rate=await cnyRate();const quote=oglPrice(job,{...input,...rate,rateDate:rate.date,rateSource:rate.source});
  await this.setup(id,{publishConfig:{...(job.publishConfig||{}),price:quote.price,currency:quote.currency}});
  return this.repo.mutate(db=>{const j=find(db.jobs,id);j.landedPricing=quote;audit(db,{kind:'job.ogl_price',jobId:id,inputHash:hash(quote.input)});return j;});
 }
 async priceLanded(id,input){
  const j=await this.getJob(id);
  const quote=landedPrice({...input,targetNet:{amount:j.canonical.price,currency:j.canonical.currency}});
  await this.setup(id,{publishConfig:{...(j.publishConfig||{}),price:quote.price,currency:quote.currency}});
  return this.repo.mutate(db=>{const job=find(db.jobs,id);job.landedPricing=quote;audit(db,{kind:'job.landed_price',jobId:id,inputHash:quote.inputHash});return job;});
 }
 async importProduct(input){const sample=input.subscriptionSample?{...DEMO_PRODUCT,sku:'SAMPLE-AI-STORAGE-01',images:await sampleImages()}:null;return this.repo.mutate(db=>{
  const store=this.resolveStore(db,input.storeId);const mode=input.subscriptionSample?'sample':input.demo===true?'mock':'manual';if(['mock','sample'].includes(mode)&&store.mode!=='mock')throw Error('演示商品只能进入演示店铺');
  const p=canonical(sample||(mode==='mock'?DEMO_PRODUCT:input.product));const key=hash({store:store.id,mode,product:p});const prior=db.jobs.find(j=>j.importKey===key);if(prior)return prior;
  const job={id:randomUUID(),storeId:store.id,marketplace:store.marketplace,mode,canonical:p,importKey:key,state:'extract',createdAt:now(),updatedAt:now(),revision:1,artifacts:{},evidence:[{kind:'source',hash:hash(p),source:mode==='sample'?'synthetic_subscription_sample':mode==='mock'?'fixture_not_fetched':'structured_export',time:now()}],gates:{},bannedWords:Array.isArray(input.bannedWords)?input.bannedWords.map(String).slice(0,50):[],translationVersion:0,synthetic:['mock','sample'].includes(mode)||p.source.itemId===DEMO_PRODUCT.itemId||/^(DEMO|SAMPLE)-/.test(p.sku),mapping:p.mapping,publishConfig:null};db.jobs.push(job);audit(db,{kind:'sku.import',jobId:job.id,storeId:store.id,inputHash:key,mode});return job;
 });}
 async step(id){
  const start=await this.repo.mutate(db=>{
   const job=find(db.jobs,id),store=this.resolveStore(db,job.storeId);if(['review_gate','submitted','imported','published','synced'].includes(job.state))return {done:job};
   const stage=job.state==='needs_input'?job.failedStage:job.state;if(!STAGES.includes(stage))throw Error('阶段正在执行或不可运行');
   const inputHash=hash({revision:job.revision,canonical:job.canonical,prior:STAGES.slice(0,STAGES.indexOf(stage)).map(s=>job.artifacts[s]?.outputHash)});
   if(job.artifacts[stage]?.inputHash===inputHash){job.state=STAGES[STAGES.indexOf(stage)+1]||'review_gate';return {done:job};}
   job.state='running';job.pendingStage=stage;const token=randomUUID();job.runToken=token;
   audit(db,{kind:'tool.start',jobId:id,stage,inputHash,runToken:token,mode:job.mode});
   return {job:structuredClone(job),store,stage,inputHash,token};
  });
  if(start.done)return start.done;
  const begun=Date.now();let result,error;try{result=await this.agent(start.stage,start.job,start.store);}catch(e){error=String(e.message).slice(0,400);}
  return this.repo.mutate(db=>{
   const job=find(db.jobs,id);if(job.runToken!==start.token){audit(db,{kind:'tool.discarded',jobId:id,runToken:start.token,reason:'revision changed'});return job;}
   const stage=start.stage;if(error){job.state='needs_input';job.failedStage=stage;job.error=error;audit(db,{kind:'tool.blocked',jobId:id,stage,error,mode:job.mode});}
   else{const outputHash=hash(result.output);job.artifacts[stage]={...result,inputHash:start.inputHash,outputHash,durationMs:Date.now()-begun,at:now()};job.evidence.push({kind:stage,inputHash:start.inputHash,outputHash,promptHash:result.prompt?hash(result.prompt):null,time:now()});if(stage==='translate'){job.translationVersion=result.output.version;job.translationHistory??=[];job.translationHistory.push({version:job.translationVersion,revision:job.revision,output:structuredClone(result.output),outputHash,prompt:result.prompt||null,at:now()});}
    job.state=stage==='validate'?(result.output.passed?'review_gate':'needs_input'):STAGES[STAGES.indexOf(stage)+1];if(job.state==='needs_input'){job.failedStage='validate';job.error='请修正校验错误';}else{delete job.failedStage;delete job.error;}
    audit(db,{kind:'tool.complete',jobId:id,stage,agent:result.agent,tool:result.tool,inputHash:start.inputHash,outputHash,durationMs:Date.now()-begun,mode:job.mode});
   }
   delete job.pendingStage;delete job.runToken;job.updatedAt=now();return job;
  });
 }
 async retry(id,stage){return this.repo.mutate(db=>{const j=find(db.jobs,id);if(!STAGES.includes(stage)||['publishing','submitted','imported','published','synced'].includes(j.state))throw Error('Invalid restart');if(STAGES.slice(0,STAGES.indexOf(stage)).some(s=>!j.artifacts[s]))throw Error('前置阶段未完成');for(const s of STAGES.slice(STAGES.indexOf(stage)))delete j.artifacts[s];j.gates={};j.revision++;delete j.runToken;delete j.pendingStage;j.state=stage;delete j.error;delete j.failedStage;audit(db,{kind:'stage.restart',jobId:id,stage,revision:j.revision});return j;});}
 async edit(id,input){return this.repo.mutate(db=>{const j=find(db.jobs,id);if(!j.artifacts.translate||['running','publishing','submitted','imported','published','synced'].includes(j.state))throw Error('Cannot edit');for(const k of ['title','description'])if(typeof input[k]!=='string'||!input[k].trim()||input[k].length>10000)throw Error('Invalid draft');j.translationHistory??=[];if(!j.translationHistory.some(v=>v.version===j.translationVersion))j.translationHistory.push({version:j.translationVersion,revision:j.revision,output:structuredClone(j.artifacts.translate.output),outputHash:j.artifacts.translate.outputHash,at:now()});j.revision++;j.translationVersion++;Object.assign(j.artifacts.translate.output,{title:input.title,description:input.description,version:j.translationVersion,editedBy:'human'});j.artifacts.translate.outputHash=hash(j.artifacts.translate.output);j.translationHistory.push({version:j.translationVersion,revision:j.revision,output:structuredClone(j.artifacts.translate.output),outputHash:j.artifacts.translate.outputHash,at:now()});j.evidence.push({kind:'human_edit',version:j.translationVersion,outputHash:j.artifacts.translate.outputHash,time:now()});for(const s of ['image_edit','map_attributes','validate'])delete j.artifacts[s];j.state='image_edit';j.gates={};audit(db,{kind:'draft.edited',jobId:id,revision:j.revision,outputHash:j.artifacts.translate.outputHash});return j;});}
 async approveCategory(id,revision){return this.repo.mutate(db=>{const j=find(db.jobs,id);if(j.state!=='review_gate'||j.revision!==revision||!j.artifacts.validate?.output.passed)throw Error('Draft changed or not validated');j.gates.category={revision,at:now(),hash:hash(j.artifacts.map_attributes.output)};db.categoryApprovals[j.storeId+':'+j.artifacts.map_attributes.output.category.id]={jobId:id,...j.gates.category};j.evidence.push({kind:'category_approval',...j.gates.category});audit(db,{kind:'gate.category.approved',jobId:id,revision});return j;});}
 async preparePublish(id){const initial=await this.getJob(id);if(initial.marketplace==='wb'&&initial.mode==='manual'&&(await this.repo.read()).stores.find(s=>s.id===initial.storeId)?.mode==='live')return prepareWbPublication(this,id);return this.repo.mutate(db=>{const j=find(db.jobs,id);if(j.state!=='review_gate'||j.gates.category?.revision!==j.revision||!j.artifacts.validate.output.passed)throw Error('先确认翻译与类目');const store=this.resolveStore(db,j.storeId);if(store.mode==='live'&&(j.synthetic||j.mode!=='manual'))throw Error('测试商品不能发布到真实店铺');const apiBody=store.mode==='live'?buildImportPayload(j):null;const payload={...(apiBody?{apiBody}:{}),jobId:id,revision:j.revision,title:j.artifacts.translate.output.title,description:j.artifacts.translate.output.description,attributes:j.artifacts.map_attributes.output.attributes,category:j.artifacts.map_attributes.output.category,images:j.artifacts.image_edit.output.images,sourceHash:hash(j.canonical)};const payloadHash=hash(payload);const prior=db.operations.find(o=>o.kind==='publish'&&o.payloadHash===payloadHash&&o.storeId===j.storeId);if(prior)return prior;const op={id:randomUUID(),kind:'publish',storeId:j.storeId,mode:this.resolveStore(db,j.storeId).mode,payload,payloadHash,state:'pending',createdAt:now()};db.operations.push(op);audit(db,{kind:'gate.publish.requested',jobId:id,operationId:op.id,payloadHash});return op;});}
 async planOperation(input){
  let replyEvidence=null,expectedSource=null;
  if(input.kind==='reply'){
   if(typeof input.reply!=='string'||!input.reply.trim()||input.reply.length>5000)throw Error('Invalid reply');const db=await this.repo.read(),r=find(db.reviews,input.reviewId);if(r.storeId!==input.storeId||r.status==='answered')throw Error('消息已回复或店铺不匹配');expectedSource=replySource(r);const text=maskPII(input.reply);
   if(r.replyTranslation?.textHash===hash(text)&&r.replyTranslation.sourceHash===expectedSource)replyEvidence=r.replyTranslation;
   else {const translated=await this.translateReply(text);replyEvidence={textHash:hash(text),sourceHash:expectedSource,replyZh:translated.output.replyZh,provider:translated.provider,usage:translated.usage,durationMs:translated.durationMs,prompt:translated.prompt,promptHash:hash(translated.prompt),at:now()};}
  }
  return this.repo.mutate(async db=>{
  const store=this.resolveStore(db,input.storeId);if(input.kind==='price'&&store.mode==='live')throw Error('真实调价请从已保存的价格实验计划准备');if(!['price','stock','reply'].includes(input.kind))throw Error('Invalid operation');let payload;if(store.mode==='mock'&&!store.snapshot){store.snapshot=await readStore(store);find(db.stores,store.id).snapshot=store.snapshot;}
  if(input.kind==='reply'){
   const review=find(db.reviews,input.reviewId);if(review.storeId!==store.id)throw Error('Review/store mismatch');if(replySource(review)!==expectedSource)throw Error('消息已变化，请重新翻译确认');if(review.status==='answered')throw Error('此消息已回复');if(db.operations.some(o=>o.kind==='reply'&&o.payload.reviewId===review.id&&['executing','unknown','submitted'].includes(o.state)))throw Error('先核对正在执行或结果不确定的回复');if(typeof input.reply!=='string'||!input.reply.trim()||input.reply.length>5000)throw Error('Invalid reply');payload={reviewId:review.id,reply:maskPII(input.reply),before:review.reply||null,sourceHash:replySource(review),sourceRu:review.textRu,sourceZh:review.textZh||null,replyZh:replyEvidence.replyZh};
   review.replyTranslation=replyEvidence;review.replyTranslationHistory??=[];if(!review.replyTranslationHistory.some(t=>t.textHash===replyEvidence.textHash&&t.sourceHash===replyEvidence.sourceHash))review.replyTranslationHistory.push(replyEvidence);review.draftRu=payload.reply;
   const active=db.operations.filter(o=>o.kind==='reply'&&o.payload.reviewId===review.id&&['pending','approved'].includes(o.state));const identical=active.find(o=>o.payloadHash===hash(payload));if(identical)return identical;
   for(const old of active){old.state='superseded';audit(db,{kind:'reply.approval.superseded',operationId:old.id,reviewId:review.id});}
  }else{
   if(typeof input.sku!=='string'||!input.sku.trim()||input.sku.length>100)throw Error('Invalid SKU');const target=Number(input.target);if(!Number.isFinite(target)||target<0||(input.kind==='stock'&&!Number.isInteger(target)))throw Error('Invalid target');
   if(store.mode==='mock'&&!store.snapshot.products.some(p=>p.sku===input.sku))throw Error('模拟店铺中没有此 SKU');
   let economics=null;if(input.kind==='price'){economics=unitEconomics({...input.economics,priceRub:target});const min=Number(input.minMarginPct);if(!Number.isFinite(min)||min<0||min>90||!economics.complete||economics.marginPct<min)throw Error('价格低于最低毛利率，或成本数据不完整');}
   payload={sku:input.sku,target,before:store.snapshot?.products?.find(p=>p.sku===input.sku)?.[input.kind]??null,economics,minMarginPct:input.kind==='price'?Number(input.minMarginPct):null,currency:input.kind==='price'?'RUB':null};
  }
  const op={id:randomUUID(),kind:input.kind,storeId:store.id,mode:store.mode,payload,payloadHash:hash(payload),state:'pending',createdAt:now()};db.operations.push(op);audit(db,{kind:'operation.proposed',operationId:op.id,storeId:store.id,operation:op.kind,payloadHash:op.payloadHash,mode:store.mode});return op;
 });}
 async inspectTrialCpo(id){return inspectCpo(this,id);}
 async prepareTrialCpo(id,input={}){return prepareCpo(this,id,input);}
 async reconcileCpo(id){return reconcileCpo(this,id);}
 async inspectPriceConditions(storeId,sku){
  const store=this.resolveStore(await this.repo.read(),storeId);
  if(store.mode!=='live'||store.marketplace!=='ozon'||typeof sku!=='string'||!/^[1-9]\d*$/.test(sku))throw Error('请选择真实 Ozon 店铺与平台 SKU');
  const id=randomUUID(),startedAt=now();
  await this.repo.mutate(db=>{db.priceChecks??=[];db.priceChecks.push({id,storeId,sku,state:'reading',startedAt,readOnly:true});audit(db,{kind:'price.conditions.started',checkId:id,storeId,sku,tools:['/v3/product/info/list','/v5/product/info/prices']});});
  try{
   const context=await this.priceReader(store,sku);
   if(context.sku!==sku)throw Error('价格读取返回了其他商品');
   const blockers=priceContextBlockers(context);
   return await this.repo.mutate(db=>{const c=find(db.priceChecks,id);Object.assign(c,{state:'checked',context,blockers,finishedAt:now(),executionAuthorized:false});audit(db,{kind:'price.conditions.checked',checkId:id,outputHash:hash({context,blockers})});return c;});
  }catch(e){
   await this.repo.mutate(db=>{const c=find(db.priceChecks,id);Object.assign(c,{state:'failed',finishedAt:now(),error:'价格条件读取失败，请检查连接后重新读取。'});audit(db,{kind:'price.conditions.failed',checkId:id});});throw Error('价格条件读取失败，请检查连接后重新读取。');
  }
 }
 async prepareTrialPrice(id){
  const db=await this.repo.read(),plan=find(db.trialPlans||[],id),store=this.resolveStore(db,plan.storeId);
  if(plan.status!=='planned'||plan.lever!=='price'||store.mode!=='live'||store.marketplace!=='ozon'||!plan.economics)throw Error('需要含成本版本的真实 Ozon 价格计划');
  const context=await this.priceReader(store,plan.sku);if(context.price!==Number(plan.baseline))throw Error('平台当前价格与基准计划不同，请先更新成本及计划');
  const apiBody=priceBody(context,Number(plan.variant));
  return this.repo.mutate(db=>{
   const p=find(db.trialPlans,id),cost=latestCosts(db).find(c=>c.storeId===p.storeId&&c.sku===p.sku);
   if(p.status!=='planned'||hash(p)!==hash(plan)||cost?.id!==p.economics.profileId)throw Error('计划或成本已改变，请重新拟定');
   const economics=priceTrialEconomics(p,cost,p.economics.minMarginPct);
   const active=db.operations.filter(o=>o.kind==='price'&&o.storeId===p.storeId&&o.payload.context?.productId===context.productId);
   if(active.some(o=>['executing','unknown','submitted'].includes(o.state)))throw Error('先核对同一商品尚未明确的调价结果');
   const prior=active.find(o=>['pending','approved'].includes(o.state)&&o.payload.planId===id&&o.payload.context.fingerprint===context.fingerprint&&Date.now()-Date.parse(o.payload.context.checkedAt)<15*60*1000);if(prior)return prior;
   for(const o of active.filter(o=>['pending','approved'].includes(o.state))){o.state='superseded';audit(db,{kind:'price.approval.superseded',operationId:o.id});}
   const payload={planId:id,sku:p.sku,target:Number(p.variant),before:context.price,currency:'RUB',context,apiBody,economics:economics.variant,costProfileId:cost.id,minMarginPct:economics.minMarginPct,minimumPrice:economics.minimumPrice};
   const op={id:randomUUID(),kind:'price',storeId:p.storeId,mode:'live',payload,payloadHash:hash(payload),state:'pending',createdAt:now()};db.operations.push(op);audit(db,{kind:'price.plan.prepared',operationId:op.id,planId:id,payloadHash:op.payloadHash});return op;
  });
 }
 verifyPricePlan(db,op,executing=false){
  const p=find(db.trialPlans||[],op.payload.planId),cost=latestCosts(db).find(c=>c.storeId===op.storeId&&c.sku===op.payload.sku);
  if(p.status!=='planned'||p.storeId!==op.storeId||p.sku!==op.payload.sku||Number(p.variant)!==op.payload.target||cost?.id!==op.payload.costProfileId||Date.now()-Date.parse(op.payload.context.checkedAt)>15*60*1000)throw Error('计划、成本或15分钟价格确认已失效，请重新拟定');
  if(executing){const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);if(today<p.bStart||today>p.bEnd)throw Error('请在计划测试期内执行调价（莫斯科日期）');}
 }
 async reconcilePrice(id){
  const db=await this.repo.read(),op=find(db.operations,id);if(op.kind!=='price'||!op.payload.context||!['submitted','unknown','verified'].includes(op.state))throw Error('没有可核对的真实调价');
  const current=await this.priceReader(this.resolveStore(db,op.storeId),op.payload.sku);
  if(current.accountRef!==op.payload.context.accountRef||current.productId!==op.payload.context.productId||current.currency!==op.payload.currency)throw Error('店铺或商品已变化');
  return this.repo.mutate(db=>{const o=find(db.operations,id);o.priceObservation={price:current.price,at:current.checkedAt,matches:current.price===o.payload.target,originProven:o.receipt?.status==='accepted'};if(o.priceObservation.matches){o.state='verified';const p=find(db.trialPlans,o.payload.planId);p.execution='price_observed';}else {if(o.state==='verified')o.state=o.receipt?.status==='accepted'?'submitted':'unknown';find(db.trialPlans,o.payload.planId).execution='price_state_changed';}audit(db,{kind:'price.observed',operationId:id,outputHash:hash(o.priceObservation)});return o;});
 }
 async inspectWbStock(storeId,nmID,warehouseId){return inspectWbStock(this,storeId,nmID,warehouseId);}
 async inspectWbStockWarehouses(storeId){return this.wbStockWarehouses(this.resolveStore(await this.repo.read(),storeId));}
 async prepareWbStock(storeId,input){return prepareWbStock(this,storeId,input);}
 async reconcileWbStock(id){return reconcileWbStock(this,id);}
 async confirmWbStock(id,input){return confirmWbStock(this,id,input);}
 async inspectWbPrice(storeId,nmID){return inspectWbPrice(this,storeId,nmID);}
 async prepareWbPrice(storeId,input,trial=null){return prepareWbPrice(this,storeId,input,trial);}
 async reconcileWbPrice(id){return reconcileWbPrice(this,id);}
 async prepareWbMedia(id){return prepareWbMedia(this,id);}
 async readWbMediaResult(id){return readWbMediaResult(this,id);}
 async confirmWbMediaResult(id,input){return confirmWbMediaResult(this,id,input);}
 async approveOperation(id,payloadHash){if((await this.repo.read()).operations.find(o=>o.id===id)?.kind==='wb_stock')return approveWbStock(this,id,payloadHash);if((await this.repo.read()).operations.find(o=>o.id===id)?.kind==='wb_price')return approveWbPrice(this,id,payloadHash);if((await this.repo.read()).operations.find(o=>o.id===id)?.kind==='wb_media')return approveWbMedia(this,id,payloadHash);return this.repo.mutate(db=>{const op=find(db.operations,id);if(op.state!=='pending'||op.payloadHash!==payloadHash||hash(op.payload)!==payloadHash)throw Error('Approval payload mismatch');if(op.kind==='reply')verifyReply(db,op);if(['cpo_disable','cpo_enable'].includes(op.kind))verifyCpo(this,db,op);if(op.kind==='price'&&op.mode==='live')this.verifyPricePlan(db,op);if(op.kind==='publish'){const j=find(db.jobs,op.payload.jobId);if(j.revision!==op.payload.revision||j.state!=='review_gate'||j.gates.category?.revision!==j.revision)throw Error('Draft changed; prepare again');j.gates.publication={revision:j.revision,hash:payloadHash,at:now()};}op.state='approved';op.approvedAt=now();op.approvedHash=payloadHash;audit(db,{kind:'gate.operation.approved',operationId:id,operation:op.kind,payloadHash});return op;});}
 async executeOperation(id){
  if((await this.repo.read()).operations.find(o=>o.id===id)?.kind==='wb_stock')return executeWbStock(this,id);
  if((await this.repo.read()).operations.find(o=>o.id===id)?.kind==='wb_price')return executeWbPrice(this,id);
  if((await this.repo.read()).operations.find(o=>o.id===id)?.kind==='wb_media')return executeWbMedia(this,id);
  const start=await this.repo.mutate(db=>{const op=find(db.operations,id);if(['done','submitted','verified'].includes(op.state))return {done:op};if(op.state!=='approved'||op.approvedHash!==hash(op.payload))throw Error('Human approval required');if(op.kind==='reply')verifyReply(db,op);const store=this.resolveStore(db,op.storeId);if(['cpo_disable','cpo_enable'].includes(op.kind))verifyCpo(this,db,op,true);if(op.kind==='price'&&store.mode==='live')this.verifyPricePlan(db,op,true);if(store.mode!=='mock'&&!(store.marketplace==='wb'&&op.kind==='publish')&&(store.marketplace!=='ozon'||!['publish','price','cpo_disable','cpo_enable'].includes(op.kind)||op.kind==='price'&&!op.payload.planId))throw Error('真实价格、库存、回复写入未启用');if(op.kind==='publish'){const j=find(db.jobs,op.payload.jobId);if(j.revision!==op.payload.revision||j.state!=='review_gate')throw Error('Stale publication');if(store.mode==='live'&&(j.synthetic||j.mode!=='manual'||hash(store.marketplace==='wb'?buildWbImportPayload(j):buildImportPayload(j))!==hash(op.payload.apiBody)))throw Error('Live publication payload mismatch');if(store.mode==='live'&&store.marketplace==='wb')guardWbPublication(db,op);j.state='publishing';}
   if(op.kind==='price'&&store.mode==='live'&&db.operations.filter(o=>o.kind==='price'&&o.storeId===op.storeId&&o.payload.context?.productId===op.payload.context.productId&&Date.now()-Date.parse(o.executedAt||'')<3600000).length>=10)throw Error('此商品一小时内已有10次提交，请稍后再试');op.state='executing';op.executedAt=now();audit(db,{kind:'operation.executing',operationId:id,payloadHash:op.payloadHash,mode:store.mode});return {op:structuredClone(op),store};});
  if(start.done)return start.done;
  try{const receipt=start.store.mode==='live'?(start.op.kind==='price'?await this.priceSubmit(start.store,start.op):start.op.kind==='cpo_disable'?await this.cpoSubmit(start.store,start.op):start.op.kind==='cpo_enable'?await this.cpoEnableSubmit(start.store,start.op):start.store.marketplace==='wb'?await this.wbSubmit(start.store,start.op,await this.getJob(start.op.payload.jobId)):await this.submit(start.store,start.op)):await this.execute(start.store,start.op);return this.repo.mutate(db=>{const op=find(db.operations,id);op.state=receipt.status==='not_updated'?'blocked':receipt.externalWrite?'submitted':'done';op.receipt=receipt;if(receipt.status==='not_updated')op.error='Ozon 未确认此商品更新，请重新读取状态与报价';op.completedAt=now();if(op.kind==='publish'){const j=find(db.jobs,op.payload.jobId);j.state=receipt.externalWrite?'submitted':'published';j.receipt=receipt;j.evidence.push({kind:'publication_receipt',hash:hash(receipt),time:now()});}if(op.kind==='reply'){const r=find(db.reviews,op.payload.reviewId);r.reply=op.payload.reply;r.status='answered';}
   if(['cpo_disable','cpo_enable'].includes(op.kind)){const p=find(db.trialPlans,op.payload.planId),field=op.payload.phase==='baseline'?'baselineExecution':'execution';p[field]=receipt.status==='not_updated'?'cpo_not_updated':(op.payload.target?'cpo_on':'cpo_off')+'_submitted';if(op.payload.phase==='baseline'&&receipt.status==='accepted')p.baselineExecutedAt=op.executedAt;if(receipt.quoteChanged)p.cpoQuoteChanged=true;}if(op.kind==='price'&&op.mode==='live')find(db.trialPlans,op.payload.planId).execution='price_submitted';if(op.mode==='mock'&&['price','stock'].includes(op.kind)){const store=find(db.stores,op.storeId),p=store.snapshot?.products?.find(p=>p.sku===op.payload.sku);if(p)p[op.kind]=op.payload.target;}
   audit(db,{kind:'operation.completed',operationId:id,receiptHash:hash(receipt),externalWrite:receipt.externalWrite,mode:op.mode});return op;});}
  catch(e){await this.repo.mutate(db=>{const op=find(db.operations,id);op.state=(['price','cpo_disable','cpo_enable'].includes(op.kind)||op.kind==='publish'&&op.payload.marketplace==='wb')&&e.noWrite?'blocked':'unknown';if(op.kind==='publish'&&op.payload.marketplace==='wb'){op.completedAt=now();if(Number.isFinite(e.retryAt))op.retryAt=e.retryAt;if(e.noWrite){const j=find(db.jobs,op.payload.jobId);j.state='review_gate';delete j.gates.publication;}}if(op.kind.startsWith('cpo_')&&op.payload.phase==='baseline'&&!e.noWrite)find(db.trialPlans,op.payload.planId).baselineExecutedAt=op.executedAt;op.error=op.state==='blocked'?String(e.message).slice(0,350):'执行结果不确定：禁止自动重试';audit(db,{kind:'operation.'+op.state,operationId:id,error:op.error});});throw e;}
 }
 async syncPublished(id){
  const db=await this.repo.read(),job=find(db.jobs,id),store=this.resolveStore(db,job.storeId);
  if(store.mode==='mock')return this.repo.mutate(db=>{const j=find(db.jobs,id);if(j.state==='synced')return j;if(j.state!=='published')throw Error('Not published');j.state='synced';j.syncedAt=now();audit(db,{kind:'sku.sync',jobId:id,mode:j.mode,externalWrite:false});return j;});
  if(store.marketplace==='wb')return syncWbPublication(this,id);
  if(!['submitted','imported'].includes(job.state)||!job.receipt?.taskId)throw Error('No import task to poll');
  const result=await importStatus(store,job.receipt.taskId,job.canonical.sku);
  if(result.imported){const info=await ozonCall(store,'/v3/product/info/list',{offer_id:[job.canonical.sku]});result.platformStatus=info.items?.[0]?.statuses||null;}
  return this.repo.mutate(db=>{const j=find(db.jobs,id);j.importResult=result;j.state=result.imported?'imported':'submitted';j.syncedAt=now();audit(db,{kind:'import.status',jobId:id,outputHash:hash(result),externalWrite:false});return j;});
 }
 async syncMessages(storeId){const db=await this.repo.read(),store=this.resolveStore(db,storeId),result=await this.messageReader(store);return this.repo.mutate(db=>{for(const item of result.items){const textRu=maskPII(item.textRu),existing=db.reviews.find(r=>r.storeId===storeId&&r.externalId===item.externalId&&r.kind===item.kind);if(!existing){db.reviews.push({...item,id:randomUUID(),storeId,mode:'live',textRu,textZh:'待翻译，请生成 AI 草稿或人工核对',draftRu:'',status:'unanswered',createdAt:now()});continue;}
 if(existing.textRu!==textRu||existing.rating!==item.rating){existing.textRu=textRu;existing.rating=item.rating;existing.textZh='源消息已更新，请重新翻译';existing.draftRu='';existing.aiDraft={state:'stale'};for(const op of db.operations.filter(o=>o.kind==='reply'&&o.payload.reviewId===existing.id&&['pending','approved'].includes(o.state)))op.state='superseded';audit(db,{kind:'review.source.changed',reviewId:existing.id,inputHash:replySource(existing)});}
 }find(db.stores,storeId).messagesSynced={at:now(),complete:!result.partial&&!(result.errors||[]).length};audit(db,{kind:'messages.sync',storeId,count:result.items.length,errors:result.errors||[],mode:store.mode});return {count:result.items.length,errors:result.errors||[],partial:result.partial};});}
 draftMessage(id){if(this.reviewTasks.has(id))return this.reviewTasks.get(id);const task=this.generateMessage(id).finally(()=>this.reviewTasks.delete(id));this.reviewTasks.set(id,task);return task;}
 async generateMessage(id){
  const start=await this.repo.mutate(db=>{const r=find(db.reviews,id);if(r.status==='answered')throw Error('此消息已回复');const token=randomUUID(),inputHash=hash({textRu:r.textRu,kind:r.kind||'review',rating:r.rating??null});r.aiDraft={state:'running',token,inputHash};audit(db,{kind:'review.ai.started',reviewId:id,inputHash,token});return {review:structuredClone(r),token,inputHash};});
  try{const result=await this.draftReview(start.review);return await this.repo.mutate(db=>{const r=find(db.reviews,id);if(r.aiDraft?.token!==start.token||r.status==='answered'||hash({textRu:r.textRu,kind:r.kind||'review',rating:r.rating??null})!==start.inputHash){if(r.aiDraft?.token===start.token)r.aiDraft.state='discarded';audit(db,{kind:'review.ai.discarded',reviewId:id,token:start.token});return r;}
   r.textZh=result.output.textZh;r.draftRu=result.output.draftRu;r.draftHistory??=[];const evidence={version:r.draftHistory.length+1,at:now(),provider:result.provider,usage:result.usage,durationMs:result.durationMs,inputHash:start.inputHash,prompt:result.prompt,promptHash:hash(result.prompt),outputHash:hash(result.output),output:result.output};r.draftHistory.push(evidence);r.aiDraft={state:'ready',version:evidence.version,warnings:result.output.warnings};audit(db,{kind:'review.ai.completed',reviewId:id,inputHash:start.inputHash,outputHash:evidence.outputHash,durationMs:result.durationMs});return r;});}
  catch(e){await this.repo.mutate(db=>{const r=find(db.reviews,id);if(r.aiDraft?.token===start.token)r.aiDraft={state:'error',error:'AI 草稿生成失败，请重试'};audit(db,{kind:'review.ai.failed',reviewId:id});});throw e;}
 }
 async demoReview(storeId){return this.repo.mutate(db=>{const s=this.resolveStore(db,storeId);if(s.mode!=='mock')throw Error('演示评价只能进入演示店铺');const prior=db.reviews.find(r=>r.storeId===storeId&&r.demo);if(prior)return prior;const r={id:randomUUID(),storeId,demo:true,mode:'mock',rating:2,textRu:'Короб удобный, но крышка пришла с трещиной. Как заменить?',textZh:'收纳盒很好用，但盖子到货时有裂纹。如何更换？',draftRu:'Здравствуйте! Спасибо, что сообщили о повреждении. Пожалуйста, оформите обращение через раздел заказа в личном кабинете, чтобы служба поддержки помогла с возвратом или заменой.',status:'unanswered',createdAt:now()};db.reviews.push(r);audit(db,{kind:'review.demo.created',reviewId:r.id,storeId,outputHash:hash(r)});return r;});}
 async saveCosts(input){const profile=costProfile(input);return this.repo.mutate(db=>{const store=this.resolveStore(db,input.storeId);if(db.operations.some(o=>o.kind==='price'&&o.storeId===store.id&&o.payload.sku===profile.sku&&o.state==='executing'))throw Error('调价正在提交，请完成后再修改成本');const prior=latestCosts(db).find(p=>p.storeId===store.id&&p.sku===profile.sku);if(input.revision!==(prior?.revision||0))throw Error('成本版本已变化，请重新打开最新版本');const record={...profile,id:randomUUID(),storeId:store.id,mode:store.mode,revision:(prior?.revision||0)+1,at:now(),previousHash:prior?hash(prior):null};db.costVersions??=[];db.costVersions.push(record);audit(db,{kind:'sku.costs.saved',profileId:record.id,storeId:store.id,revision:record.revision,evidenceHash:hash(record)});return record;});}
 async planTrial(input,services={}){const plan=planTrial(input);return this.repo.mutate(async db=>{const store=this.resolveStore(db,input.storeId);if(store.marketplace==='wb'&&store.mode==='live'){plan.currency=input.currency||'RUB';if(!['RUB','CNY'].includes(plan.currency))throw Error('请选择 WB 限额币种 RUB 或 CNY');if(['a','b'].some(k=>(Date.parse(plan[k+'End'])-Date.parse(plan[k+'Start']))/86400000+1>31))throw Error('WB API 实验每期支持 7–31 天');for(const k of ['adBudget','maxLoss'])if(!/^\d+(\.\d{1,2})?$/.test(String(plan[k])))throw Error('WB 限额最多两位小数');}if(['cpo_disable','cpo_enable'].includes(plan.adsControl)&&(store.id!=='ozon-live'||store.mode!=='live'||store.marketplace!=='ozon'))throw Error('CPO 操作仅支持主 Ozon 店铺');db.trialPlans??=[];if(db.trialPlans.some(p=>p.storeId===store.id&&p.sku===plan.sku&&p.status==='planned'))throw Error('此商品已有计划，请先完成或取消');const creative=creativeTrialSnapshot(db,input,plan);const repeatOf=await repeatContext(db,store,plan,input,services);if(repeatOf&&creative&&db.trialPlans.find(p=>p.id===repeatOf.planId)?.creative?.payloadHash!==creative.payloadHash)throw Error('重复图文测试需保留原版本；新版本请另建计划');let economics=null,wbPriceEconomics=null;if(plan.lever==='price'&&store.mode==='live'&&store.marketplace==='wb'){wbPriceEconomics=await wbPriceTrialEconomics(this,store,plan,input);if(repeatOf){const original=db.trialPlans.find(p=>p.id===repeatOf.planId)?.wbPriceEconomics;if(original&&original.identityHash!==wbPriceEconomics.identityHash)throw Error('重复价格测试必须保留原商品身份、币种、尺码与折扣；改变条件请另建计划');}}else if(plan.lever==='price'){const costs=latestCosts(db).find(p=>p.storeId===store.id&&p.sku===plan.sku);if(!costs||costs.id!==input.costProfileId)throw Error('请选择此 SKU 最新成本版本后再保存价格计划');economics=priceTrialEconomics({...plan,storeId:store.id},costs,input.minMarginPct??15);}const record={id:randomUUID(),at:now(),storeId:store.id,mode:store.mode,...plan,economics,repeatOf,...(creative?{creative}:{}),...(wbPriceEconomics?{wbPriceEconomics,wbPriceTrialState:{baseline:wbPriceEconomics.context.price.sizes.every(s=>s.price===Number(plan.baseline))?{state:'observed',matches:true,originProven:false,observedAt:wbPriceEconomics.at}:null}}:{})};db.trialPlans.push(record);audit(db,{kind:'profit.plan.created',planId:record.id,evidenceHash:hash(record)});return record;});}
 async cancelTrialPlan(id){return this.repo.mutate(db=>{const p=find(db.trialPlans||[],id);if(p.status==='cancelled')return p;if(p.status!=='planned')throw Error('已完成计划不能取消');const linked=db.operations.filter(o=>o.payload.planId===id);if(linked.some(o=>['executing','submitted','unknown'].includes(o.state)))throw Error('请先核对平台操作结果；取消不会恢复平台价格或广告');for(const o of linked.filter(o=>['pending','approved'].includes(o.state))){o.state='superseded';audit(db,{kind:'price.approval.superseded',operationId:o.id});}p.status='cancelled';p.cancelledAt=now();audit(db,{kind:'profit.plan.cancelled',planId:id});return p;});}
 async recordTrial(input){const evaluated=evaluateTrial(input);return this.repo.mutate(db=>{const store=this.resolveStore(db,input.storeId);const plan=input.planId?find(db.trialPlans||[],input.planId):null;
 if(plan){if(plan.currency&&plan.currency!=='RUB')throw Error('此人工表单金额为 RUB；请使用 WB 原币种报表比较');if(db.operations.some(o=>o.payload.planId===plan.id&&['executing','submitted','unknown'].includes(o.state)))throw Error('先核对平台操作结果，再记录计划结果');if(plan.storeId!==store.id)throw Error('计划属于其他店铺');if(plan.status!=='planned')throw Error('计划已完成或取消');checkPlanResult(plan,evaluated);}
 if(evaluated.lever==='content'&&!plan?.creative)throw Error('图文观察必须关联已确认版本的原计划');
 const trial={id:randomUUID(),at:now(),storeId:store.id,mode:store.mode,planId:plan?.id||null,...evaluated,...(plan?.creative?{creative:structuredClone(plan.creative)}:{})};db.trials??=[];db.trials.push(trial);if(plan){plan.status='completed';plan.trialId=trial.id;plan.completedAt=trial.at;for(const o of db.operations.filter(o=>o.payload.planId===plan.id&&['pending','approved'].includes(o.state))){o.state='superseded';audit(db,{kind:'operation.approval.superseded',operationId:o.id});}}
 audit(db,{kind:'profit.trial.recorded',trialId:trial.id,planId:trial.planId,storeId:store.id,evidenceHash:hash(trial),source:trial.source});return trial;});}
 async recordLedgerTrial(planId,input,finance,advertising){return this.repo.mutate(async db=>{
  const plan=find(db.trialPlans||[],planId),store=this.resolveStore(db,plan.storeId);
  if(store.mode!=='live'||store.marketplace!=='ozon'||plan.status==='cancelled')throw Error('需要未取消的真实 Ozon 实验计划');
  const previous=(db.trials||[]).find(t=>t.id===plan.trialId);
  if(plan.status==='completed'&&previous?.source!=='api_accruals_seller_costs')throw Error('此计划已有人工观察结果');
  if(db.operations.some(o=>o.payload.planId===plan.id&&['executing','submitted','unknown'].includes(o.state)))throw Error('先核对平台操作结果，再保存结果');
  const proof=await finance.comparisonEvidence(store,input);if(store.id==='ozon-live')proof.advertising=advertising?await advertising.comparisonEvidence(store,plan):{a:null,b:null};const evaluated=evaluateLedgerTrial(plan,proof,input);
  const fingerprint=hash({a:evaluated.a,b:evaluated.b,advertisingProof:evaluated.advertisingProof,executionEvidence:evaluated.executionEvidence,comparable:evaluated.comparable,executionConfirmed:evaluated.executionConfirmed,evidence:evaluated.evidence});
  if(previous?.inputHash===fingerprint)return previous;
  const trial={id:randomUUID(),at:now(),storeId:store.id,mode:'live',planId:plan.id,inputHash:fingerprint,revision:(previous?.revision||0)+1,previousTrialId:previous?.id||null,...evaluated};
  db.trials??=[];db.trials.push(trial);plan.status='completed';plan.trialId=trial.id;plan.completedAt=trial.at;
  for(const o of db.operations.filter(o=>o.payload.planId===plan.id&&['pending','approved'].includes(o.state))){o.state='superseded';audit(db,{kind:'price.approval.superseded',operationId:o.id});}
  audit(db,{kind:'profit.ledger.compared',trialId:trial.id,planId:plan.id,evidenceHash:hash(trial),source:trial.source});return trial;
 });}
 async assessment(input){const result=assessStore(input);return this.repo.mutate(db=>{const a={id:randomUUID(),at:now(),...result};db.assessments.push(a);audit(db,{kind:'market.assessed',assessmentId:a.id,evidenceHash:hash(a.evidence)});return a;});}
 async digest(){const db=await this.repo.read();return {at:now(),language:'zh',stores:db.stores.map(s=>({storeId:s.id,name:s.name,mode:s.mode,source:s.snapshot?.source||'尚未同步',orders:s.snapshot?.orders??null,orderedAmount:s.snapshot?.orderedAmount??null,lowStock:s.snapshot?.products?s.snapshot.products.filter(p=>Number.isFinite(p.stock)&&p.stock<5).map(p=>p.sku):null,negativeReviews:s.mode==='mock'||s.messagesSynced?.complete?db.reviews.filter(r=>r.storeId===s.id&&r.rating!==null&&r.rating<=2&&r.status!=='answered').length:null,pending:db.operations.filter(o=>o.storeId===s.id&&['pending','approved'].includes(o.state)).length})),alerts:[...db.jobs.filter(j=>j.state==='needs_input').map(j=>({kind:'pipeline_blocked',jobId:j.id,message:j.error})),...db.operations.filter(o=>o.state==='unknown').map(o=>({kind:'execution_unknown',operationId:o.id,message:o.error}))],disclaimer:'按需摘要；未连接的退货、评分历史与投诉不视为零，定时推送未启用。'};}
}
