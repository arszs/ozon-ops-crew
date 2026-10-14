import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assetPath} from '../adapters/media.mjs';
import {draftReviewCreative} from '../adapters/review-creative.mjs';
import {audit,hash,maskPII} from './repository.mjs';
const find=(db,id)=>{const c=db.creatives?.find(c=>c.id===id);if(!c)throw Error('未找到视觉改进方案');return c;};
const reviewHash=r=>hash({storeId:r.storeId,textRu:maskPII(r.textRu),rating:r.rating??null});
const approvalHash=c=>hash({sourceHash:c.sourceHash,output:c.output,image:c.image||null,revision:c.revision});
const sourceCurrent=(db,c)=>{const r=db.reviews.find(r=>r.id===c.reviewId);if(!r||reviewHash(r)!==c.reviewHash)throw Error('评价来源已改变，请重新生成方案');};
async function prepareCreative(ws,input,state){
 if(input.rightsConfirmed!==true||input.productConfirmed!==true)throw Error('请确认图片使用权及评价与商品的对应关系');
 for(const [key,max] of Object.entries({sku:160,factsZh:6000,currentCopyRu:1500}))if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>max)throw Error('请填写商品 SKU、已核实事实与原图文案');
 await readFile(assetPath(input.sourceAssetId));
 const start=await ws.repo.mutate(db=>{
  const review=db.reviews.find(r=>r.id===input.reviewId);if(!review||review.storeId!==input.storeId)throw Error('评价与店铺不匹配');
  const store=ws.resolveStore(db,input.storeId),source={sku:input.sku.trim(),factsZh:maskPII(input.factsZh),currentCopyRu:maskPII(input.currentCopyRu),reviewRu:maskPII(review.textRu),sourceAssetId:input.sourceAssetId};
  const sourceHash=hash({storeId:store.id,reviewId:review.id,reviewHash:reviewHash(review),source}),prior=(db.creatives||[]).find(c=>c.sourceHash===sourceHash&&!['failed','interrupted','cancelled'].includes(c.state));if(prior)return {done:prior};
  const c={id:randomUUID(),storeId:store.id,reviewId:review.id,mode:store.mode,synthetic:review.demo===true,reviewHash:reviewHash(review),source,sourceHash,revision:1,state,createdAt:new Date().toISOString(),rightsConfirmed:true,productConfirmed:true};
  (db.creatives??=[]).push(c);audit(db,{kind:'creative.started',creativeId:c.id,sourceHash,reviewHash:c.reviewHash});return {c};
 });return start;
}
async function completeCreative(ws,start,run){
 try{const result=await run(start.c.source);return await ws.repo.mutate(db=>{const c=find(db,start.c.id);if(c.state!=='generating')throw Error('生成状态已改变');sourceCurrent(db,c);c.output=result.output;c.provider=result.provider;c.usage=result.usage||null;c.prompt=result.prompt;c.promptHash=hash(result.prompt);c.state='awaiting_image';c.completedAt=new Date().toISOString();c.payloadHash=approvalHash(c);audit(db,{kind:'creative.generated',creativeId:c.id,outputHash:hash(c.output),promptHash:c.promptHash,provider:c.provider});return c;});}
 catch(e){await failCreative(ws,start.c.id);throw e;}
}
async function failCreative(ws,id){return ws.repo.mutate(db=>{const c=find(db,id);if(['queued','generating'].includes(c.state)){c.state='failed';c.completedAt=new Date().toISOString();c.error='生成未完成，请检查来源或订阅状态后重试';audit(db,{kind:'creative.failed',creativeId:c.id});}return c;});}
// Direct completion remains available to scripts/tests. HTTP uses the durable queue.
export async function generateCreative(ws,input,{run=draftReviewCreative}={}){
 const start=await prepareCreative(ws,input,'generating');return start.done||completeCreative(ws,start,run);
}
const workers=new WeakMap();
export async function startCreative(ws,input,{run=draftReviewCreative}={}){
 const start=await prepareCreative(ws,input,'queued');if(start.done)return start.done;
 let worker=workers.get(ws);if(!worker){worker={tail:Promise.resolve(),tasks:new Map()};workers.set(ws,worker);}
 const task=worker.tail.then(async()=>{
  const c=await ws.repo.mutate(db=>{const c=find(db,start.c.id);if(c.state!=='queued')return null;sourceCurrent(db,c);c.state='generating';c.startedAt=new Date().toISOString();audit(db,{kind:'creative.generation_started',creativeId:c.id});return c;});
  if(c)await completeCreative(ws,{c},run);
 }).catch(async()=>{try{await failCreative(ws,start.c.id);}catch{/* Storage may be unavailable; restart marks unfinished tasks interrupted. */}}).finally(()=>worker.tasks.delete(start.c.id));
 worker.tasks.set(start.c.id,task);worker.tail=task;return start.c;
}
export async function waitCreative(ws,id){await workers.get(ws)?.tasks.get(id);return find(await ws.repo.read(),id);}
export async function cancelCreative(ws,id){return ws.repo.mutate(db=>{const c=find(db,id);if(c.state==='cancelled')return c;if(c.state!=='queued')throw Error('生成已经开始，不能取消排队；请等待结果');c.state='cancelled';c.completedAt=new Date().toISOString();audit(db,{kind:'creative.cancelled',creativeId:id,externalWrite:false});return c;});}
export async function retryCreative(ws,id,input,options){const db=await ws.repo.read(),c=find(db,id);sourceCurrent(db,c);if(!['failed','interrupted','cancelled'].includes(c.state)||input.expectedSourceHash!==c.sourceHash)throw Error('任务状态已改变，请刷新后重试');return startCreative(ws,{...c.source,storeId:c.storeId,reviewId:c.reviewId,rightsConfirmed:c.rightsConfirmed,productConfirmed:c.productConfirmed},options);}
export async function attachCreativeImage(ws,id,input){
 if(!['xds_manual','openai_manual','other_manual'].includes(input.provider)||input.rightsConfirmed!==true)throw Error('请说明生成来源并确认图片使用权');
 await readFile(assetPath(input.assetId));
 return ws.repo.mutate(db=>{const c=find(db,id);sourceCurrent(db,c);if(!['awaiting_image','review_gate','approved'].includes(c.state)||input.expectedHash!==c.payloadHash)throw Error('方案版本已改变，请刷新');if(input.assetId===c.source.sourceAssetId)throw Error('新图不能与原图相同');
  (c.history??=[]).push({revision:c.revision,image:c.image||null,approval:c.approval||null,payloadHash:c.payloadHash});c.image={assetId:input.assetId,provider:input.provider,provenance:'seller_reported_external_generation',url:'/api/workspace/assets/'+input.assetId};c.revision++;delete c.approval;c.state='review_gate';c.payloadHash=approvalHash(c);audit(db,{kind:'creative.image_attached',creativeId:id,assetHash:input.assetId,payloadHash:c.payloadHash,provider:input.provider});return c;});
}
export async function approveCreative(ws,id,input){return ws.repo.mutate(db=>{const c=find(db,id);sourceCurrent(db,c);if(input.expectedHash!==c.payloadHash||approvalHash(c)!==c.payloadHash)throw Error('图文版本已改变，请重新检查');if(c.state==='approved')return c;if(c.state!=='review_gate'||!c.image)throw Error('请先添加生成图片');if(!['factsChecked','visualChecked','russianChecked','rightsChecked'].every(k=>input[k]===true))throw Error('请逐项确认事实、外观、俄文及权利');if(c.output.risk==='quality_or_service'&&input.issueAcknowledged!==true)throw Error('请确认质量或服务问题需要另行处理');if(c.output.risk==='insufficient_facts')throw Error('商品事实不足，请补充事实后重新生成');c.state='approved';c.approval={payloadHash:c.payloadHash,at:new Date().toISOString(),checks:{factsChecked:true,visualChecked:true,russianChecked:true,rightsChecked:true,issueAcknowledged:input.issueAcknowledged===true}};audit(db,{kind:'creative.approved',creativeId:id,payloadHash:c.payloadHash,externalWrite:false});return c;});}

export function creativeViews(db){return (db.creatives||[]).filter((c,i,all)=>['queued','generating'].includes(c.state)||i>=all.length-30).map(c=>({...c,sourceStatus:db.reviews.some(r=>r.id===c.reviewId&&reviewHash(r)===c.reviewHash)?'current':'stale'}));}

// A plan freezes the reviewed version. Later edits never rewrite historical experiments.
export function creativeTrialSnapshot(db,input,plan){
 if(plan.lever!=='content')return null;
 const c=find(db,input.creativeId);sourceCurrent(db,c);
 if(c.storeId!==input.storeId||c.source.sku!==plan.sku)throw Error('图文版本必须属于此店铺和 SKU');
 if(c.state!=='approved'||!c.image||input.creativeHash!==c.payloadHash||approvalHash(c)!==c.payloadHash||c.approval?.payloadHash!==c.payloadHash)throw Error('请重新选择已确认的最新图文版本');
 if(plan.baseline!=='原图 · '+c.source.sourceAssetId.slice(0,12)||plan.variant!=='AIGC 图文 · v'+c.revision+' · '+c.payloadHash.slice(0,12))throw Error('图文方案必须与已确认的原图和新版本一致');
 return structuredClone({creativeId:c.id,payloadHash:c.payloadHash,revision:c.revision,sourceHash:c.sourceHash,sourceAssetId:c.source.sourceAssetId,sourceCopyRu:c.source.currentCopyRu,image:c.image,output:c.output,approval:c.approval,synthetic:c.synthetic,publication:'not_verified'});
}
