import {randomUUID} from 'node:crypto';
import {hash,audit} from './repository.mjs';
import {mediaSource} from '../adapters/wb-media.mjs';
const now=()=>new Date().toISOString();
const sent=i=>['accepted','unknown','observed'].includes(i.state);
function eligible(db,id){
 const job=db.jobs.find(j=>j.id===id),publication=db.operations.findLast(o=>o.kind==='publish'&&o.payload.marketplace==='wb'&&o.payload.jobId===id&&o.state==='verified');
 if(!job||job.marketplace!=='wb'||job.mode!=='manual'||job.synthetic||job.state!=='imported'||!job.importResult?.imported||!publication)throw Error('先核对已创建的真实 WB 卡片');
 return {job,publication};
}
function verify(db,op){
 if(!op||op.kind!=='wb_media'||hash(op.payload)!==op.payloadHash)throw Error('图片计划无效');
 const {job,publication}=eligible(db,op.payload.jobId);
 if(job.revision!==op.payload.revision||mediaSource(job)!==op.payload.sourceHash||publication.id!==op.payload.publicationId||publication.payloadHash!==op.payload.publicationHash)throw Error('图片或商品版本已变化，请重新拟定');
 return {job,publication};
}
function prefixMatches(photos,prefix){return photos.length>=prefix.length&&hash(photos.slice(0,prefix.length))===hash(prefix);}
function checkTarget(target,op,max){
 const p=op.payload;
 if(target.accountRef!==p.accountRef||target.nmID!==p.nmID||target.video!==p.video||!prefixMatches(target.photos,p.beforePhotos)||!prefixMatches(target.photos,op.observedPhotos||p.beforePhotos)||target.photos.length>max)throw Error('WB 图片或目标已变化；停止上传，保留现有图片并核对');
}
export async function prepareWbMedia(ws,id){
 const db=await ws.repo.read(),{job,publication}=eligible(db,id),source=mediaSource(job),store=ws.resolveStore(db,job.storeId);
 const images=job.artifacts.image_edit?.output.images;if(!Array.isArray(images)||!images.length||images.length>30||new Set(images.map(i=>i.assetId)).size!==images.length)throw Error('请提供 1–30 张不同的已处理俄语图片');
 const files=[];for(const image of images)files.push(await ws.wbImageInspect(image));
 const target=await ws.wbMediaTarget(store,publication),progress=job.wbMediaProgress;
 if(target.nmID!==job.importResult.productId)throw Error('WB 商品编号已变化，请先重新核对创建结果');
 let completed=0;
 if(progress){
  completed=progress.assetIds.length;
  if(progress.sourceHash!==source||progress.accountRef!==target.accountRef||progress.nmID!==target.nmID||progress.mediaHash!==target.mediaHash||hash(progress.assetIds)!==hash(files.slice(0,completed).map(i=>i.assetId)))throw Error('已核对图片或来源变化，请先重新核对原图片操作');
 }else if(target.photos.length||target.video)throw Error('卡片已有媒体，不能覆盖；此流程仅为新建卡片添加俄语图片');
 if(target.photos.length!==completed||completed>=files.length)throw Error('图片数量不匹配或已全部完成');
 const payload={marketplace:'wb',jobId:id,revision:job.revision,sourceHash:source,publicationId:publication.id,publicationHash:publication.payloadHash,accountRef:target.accountRef,nmID:target.nmID,vendorCode:target.vendorCode,checkedAt:target.checkedAt,beforePhotos:target.photos,video:target.video,totalImages:files.length,images:files.slice(completed).map((f,i)=>({...f,photoNumber:completed+i+1}))};
 return ws.repo.mutate(db=>{
  const current=eligible(db,id);if(hash(current.job)!==hash(job)||hash(current.publication)!==hash(publication))throw Error('商品或审批已变化，请重新拟定');
  if(db.operations.some(o=>o.kind==='wb_media'&&o.payload.accountRef===target.accountRef&&o.payload.nmID===target.nmID&&['executing','submitted','unknown','partial'].includes(o.state)))throw Error('已有图片提交需核对，请先读取并确认平台图片');
  for(const o of db.operations.filter(o=>o.kind==='wb_media'&&o.payload.jobId===id&&['pending','approved','blocked'].includes(o.state)))o.state='superseded';
  const op={id:randomUUID(),kind:'wb_media',mode:'live',storeId:job.storeId,state:'pending',payload,payloadHash:hash(payload),items:[],createdAt:now()};db.operations.push(op);audit(db,{kind:'gate.media.requested',jobId:id,operationId:op.id,payloadHash:op.payloadHash});return op;
 });
}
export async function approveWbMedia(ws,id,payloadHash){return ws.repo.mutate(db=>{
 const op=db.operations.find(o=>o.id===id);verify(db,op);if(op.state!=='pending'||op.payloadHash!==payloadHash||Date.now()-Date.parse(op.payload.checkedAt)>900000)throw Error('图片确认已失效，请重新拟定');
 op.state='approved';op.approvedHash=payloadHash;op.approvedAt=now();audit(db,{kind:'gate.media.approved',operationId:id,payloadHash});return op;
});}
export async function executeWbMedia(ws,id){
 const start=await ws.repo.mutate(db=>{
  const op=db.operations.find(o=>o.id===id);if(op&&['submitted','verified','partial_verified'].includes(op.state))return {done:op};const context=verify(db,op);
  if(op.state!=='approved'||op.approvedHash!==op.payloadHash)throw Error('请先确认图片版本；不确定的提交禁止重发');
  if(db.operations.some(o=>o.id!==id&&o.kind==='wb_media'&&o.payload.accountRef===op.payload.accountRef&&(o.state==='executing'||o.retryAt>Date.now())))throw Error('WB 图片正在发送或限流等待中，请稍后执行');
  op.state='executing';op.executedAt=now();audit(db,{kind:'media.executing',operationId:id,payloadHash:op.payloadHash});return {op:structuredClone(op),publication:context.publication,store:ws.resolveStore(db,op.storeId)};
 });if(start.done)return start.done;
 let op=start.op;
 try{
  for(const image of op.payload.images){
   // The account reservation lasts for the entire batch; each file gets a durable attempt.
   try{
    const db=await ws.repo.read();verify(db,op);
    const last=Math.max(0,...db.operations.filter(o=>o.kind==='wb_media'&&o.payload.accountRef===op.payload.accountRef).flatMap(o=>(o.items||[]).map(i=>Date.parse(i.completedAt||i.startedAt||'')||0)));
    const delay=650-(Date.now()-last);if(delay>0)await ws.wbMediaWait(delay);
    const target=await ws.wbMediaTarget(start.store,start.publication);checkTarget(target,op,image.photoNumber-1);
    await ws.repo.mutate(db=>{const current=db.operations.find(o=>o.id===id);verify(db,current);current.observedPhotos=target.photos;current.items.push({assetId:image.assetId,photoNumber:image.photoNumber,state:'executing',startedAt:now()});audit(db,{kind:'tool.start',tool:'wb.media.file',operationId:id,photoNumber:image.photoNumber,inputHash:hash(image),targetHash:target.mediaHash});op=structuredClone(current);});
   }catch(e){e.noWrite=true;throw e;}
   const receipt=await ws.wbMediaUpload(start.store,op,image);
   await ws.repo.mutate(db=>{const current=db.operations.find(o=>o.id===id),item=current.items.at(-1);item.state='accepted';item.receipt=receipt;item.completedAt=now();audit(db,{kind:'tool.result',tool:'wb.media.file',operationId:id,photoNumber:image.photoNumber,outputHash:hash(receipt),externalWrite:true});op=structuredClone(current);});
  }
  return ws.repo.mutate(db=>{const current=db.operations.find(o=>o.id===id);current.state='submitted';current.completedAt=now();db.jobs.find(j=>j.id===op.payload.jobId).wbPublicationStage='images_submitted';audit(db,{kind:'media.submitted',operationId:id,files:current.items.length});return current;});
 }catch(e){
  await ws.repo.mutate(db=>{const current=db.operations.find(o=>o.id===id),item=current.items.at(-1);if(item?.state==='executing'){item.state=e.noWrite?'not_sent':'unknown';item.completedAt=now();}current.state=e.noWrite?(current.items.some(sent)?'partial':'blocked'):'unknown';current.completedAt=now();if(Number.isFinite(e.retryAt))current.retryAt=e.retryAt;current.error=e.noWrite?String(e.message).slice(0,350):'图片发送结果不确定；禁止重发，请读取平台图片核对';audit(db,{kind:'media.'+current.state,operationId:id,error:current.error,itemsHash:hash(current.items)});});throw e;
 }
}
function observation(target,op){
 const expectedCount=op.payload.beforePhotos.length+op.items.filter(sent).length;
 let reason='请对照原图检查 WB 返回的每张图片及顺序';let ready=expectedCount>op.payload.beforePhotos.length&&target.photos.length===expectedCount;
 try{checkTarget(target,op,expectedCount);}catch{ready=false;reason='平台图片与预期不同，请核对；不能自动覆盖或重发';}
 if(!ready&&reason.startsWith('请对照'))reason='平台图片数量尚未匹配已发送文件，稍后再读取；禁止重发';
 return {...target,expectedCount,readyForReview:ready,reason,identityVerified:false};
}
export async function readWbMediaResult(ws,id){
 const db=await ws.repo.read(),op=db.operations.find(o=>o.id===id),{publication}=verify(db,op);
 if(db.operations.findLast(o=>o.kind==='wb_media'&&o.payload.jobId===op.payload.jobId&&o.state!=='superseded')?.id!==id)throw Error('此商品已有较新图片操作，请核对最新操作');
 if(!['submitted','unknown','partial','verified','partial_verified'].includes(op.state))throw Error('没有可核对的图片提交');
 const target=await ws.wbMediaTarget(ws.resolveStore(db,op.storeId),publication),result=observation(target,op);
 return ws.repo.mutate(db=>{const current=db.operations.find(o=>o.id===id);verify(db,current);if(hash(current)!==hash(op))throw Error('图片操作已变化，请重新读取');current.observation=result;current.observationHash=hash(result);
  if(['verified','partial_verified'].includes(current.state)&&(!result.readyForReview||current.visualConfirmation?.mediaHash!==result.mediaHash)){current.state='submitted';const job=db.jobs.find(j=>j.id===op.payload.jobId);if(job.wbMediaProgress?.operationId===id){delete job.wbMediaProgress;job.wbMediaResult={status:'changed',complete:false,checkedAt:now()};job.wbPublicationStage='images_need_review';}}
  audit(db,{kind:'media.observed',operationId:id,outputHash:current.observationHash,externalWrite:false});return current;
 });
}
export async function confirmWbMediaResult(ws,id,input){
 const db=await ws.repo.read(),op=db.operations.find(o=>o.id===id),{publication}=verify(db,op);
 if(db.operations.findLast(o=>o.kind==='wb_media'&&o.payload.jobId===op.payload.jobId&&o.state!=='superseded')?.id!==id)throw Error('此商品已有较新图片操作，请核对最新操作');
 if(input.confirmed!==true||!op.observation?.readyForReview||input.observationHash!==op.observationHash||Date.now()-Date.parse(op.observation.checkedAt)>900000||!['submitted','unknown','partial'].includes(op.state))throw Error('请先读取并逐张核对平台图片');
 const fresh=await ws.wbMediaTarget(ws.resolveStore(db,op.storeId),publication);
 if(!observation(fresh,op).readyForReview||fresh.mediaHash!==op.observation.mediaHash)throw Error('WB 图片已变化，请重新读取并核对');
 return ws.repo.mutate(db=>{
  const current=db.operations.find(o=>o.id===id),{job}=verify(db,current);if(hash(current)!==hash(op))throw Error('图片核对版本已变化');
  const done=current.items.filter(sent);for(const item of done)item.state='observed';
  current.state=done.length===current.payload.images.length?'verified':'partial_verified';current.visualConfirmation={at:now(),mediaHash:fresh.mediaHash,observationHash:input.observationHash,humanConfirmed:true};
  const all=job.artifacts.image_edit.output.images;job.wbMediaProgress={sourceHash:current.payload.sourceHash,accountRef:fresh.accountRef,nmID:fresh.nmID,operationId:id,assetIds:all.slice(0,fresh.photos.length).map(i=>i.assetId),mediaHash:fresh.mediaHash,checkedAt:now()};
  const complete=fresh.photos.length===all.length;job.wbMediaResult={status:'human_verified',complete,uploadedCount:fresh.photos.length,totalImages:all.length,checkedAt:now()};job.wbPublicationStage=complete?'price_stock_pending':'images_pending';
  audit(db,{kind:'gate.media.visual_confirmed',operationId:id,observationHash:input.observationHash,mediaHash:fresh.mediaHash,complete,externalWrite:false});return current;
 });
}
