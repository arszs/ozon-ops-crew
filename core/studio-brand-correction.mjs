import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonical} from './canonical.mjs';
import {audit,hash} from './repository.mjs';
import {studioReviewHash} from './product-facts.mjs';
import {sourceBrandPhotoBinding,selectedSourceBrandPhoto,readSourceBrandPhoto,verifySourceBrandPhoto,samePrintedBrand} from './source-brand-proof.mjs';
const now=()=>new Date().toISOString();
export async function correctStudioBrand(studio,id,input={},options={}){
 let brand=String(input.brand||'').trim();const reason=String(input.reason||'').trim(),basis=input.basis,sourcePhoto=basis==='source-photo',autoBrand=sourcePhoto&&!brand,reuse=options.reuseUnreviewedDraft===true;
 if(!brand&&!sourcePhoto||brand.length>100||!reason||reason.length>1000||!['owner-confirmed','source-photo'].includes(basis))throw Error('Укажите фактический бренд и основание исправления: владелец или выбранная фотография источника');
 const token=randomUUID(),snapshot=await studio.ws.repo.mutate(db=>{
  const task=db.studioTasks.find(t=>t.id===id),job=db.jobs.find(j=>j.id===task?.jobId);
  if(!task||!job||!['ready','needs_price'].includes(task.state)||job.state!=='map_attributes'||job.receipt||db.operations.some(o=>o.jobId===job.id||o.payload?.jobId===job.id)||task.brandCorrection?.state==='preparing')throw Error('Исправлять бренд можно только у готового неотправленного черновика');
  if(reuse&&(task.brandResolution||task.brandCorrection||task.ownerEdited||task.content?.ownerEdited||task.ownerCopy||task.categorySelection||task.brandSelection||task.audienceSelection||task.supplementalFacts||options.sourceCheckToken&&(task.sourceCheck?.token!==options.sourceCheckToken||task.sourceCheck.state!=='verified'||task.sourceCheck.changed!==false)))throw Error('Сохранённый черновик уже проверен или изменён владельцем');
  if(task.mediaEnhancement?.preparing||['queued','analyzing','translating','applying','submitted','unknown'].includes(task.mediaEnhancement?.state))throw Error('Дождитесь завершения обработки фотографий перед исправлением бренда');
  if(input.expectedHash!==studioReviewHash(task)||hash(job.canonical)!==hash(canonical(task.product))||job.artifacts.translate?.output.title!==task.content?.output.title||job.artifacts.translate?.output.description!==task.content?.output.description||hash(job.artifacts.image_edit?.output.images)!==hash(task.visuals?.images))throw Error('Черновик изменён; обновите страницу');
  if(!autoBrand&&brand===task.product.brand)throw Error('Этот бренд уже указан');
  const photo=sourcePhoto?(autoBrand&&!input.sourceAssetId?selectedSourceBrandPhoto(task):sourceBrandPhotoBinding(task,input.sourceAssetId)):null;if(sourcePhoto&&!photo)throw Error('Нужна выбранная фотография исходной страницы');
  const correction={token,state:'preparing',basis,brand,sourceBrand:task.product.brand,reason,...(sourcePhoto?{sourceAssetId:photo.assetId}:{}),...(autoBrand?{automaticBrand:true}:{}),previousState:task.state,startedAt:now()};
  const saved={task:structuredClone(task),revision:job.revision};task.brandCorrection=correction;task.state='copy';task.publishError=null;task.updatedAt=now();
  if(reuse&&task.publicationAgent)task.publicationAgent={...task.publicationAgent,enabled:false,state:'paused'};
  audit(db,{kind:'studio.brand-correction.started',taskId:id,jobId:job.id,brand,sourceBrand:correction.sourceBrand,basis,reason,externalWrite:false});return {...saved,correction};
 });
 const key='brand-correction:'+id,work=studio.tail.then(async()=>{
  await studio.activityPhase?.(id,'copy');
  const old=snapshot.task;
  if(sourcePhoto){
   snapshot.correction.proof=await (autoBrand?readSourceBrandPhoto:verifySourceBrandPhoto)(old,{brand,sourceAssetId:snapshot.correction.sourceAssetId},{...options,run:options.run||studio.verifyBrandPhoto});
   if(autoBrand){brand=snapshot.correction.proof.printedBrand;snapshot.correction.brand=brand;}
   const confirmed=await studio.ws.repo.mutate(db=>{const task=db.studioTasks.find(t=>t.id===id),job=db.jobs.find(j=>j.id===old.jobId);if(task?.brandCorrection?.token!==token||task.brandCorrection.state!=='preparing'||job?.revision!==snapshot.revision||job.state!=='map_attributes'||job.receipt||db.operations.some(o=>o.jobId===job.id||o.payload?.jobId===job.id)||hash(job.canonical)!==hash(canonical(old.product))||studioReviewHash(task)!==studioReviewHash(old)||hash(task.evidence)!==hash(old.evidence)||hash(task.sourceMediaFiles)!==hash(old.sourceMediaFiles)||task.sourceHash!==old.sourceHash||hash(task.product)!==hash(old.product)||hash(task.content)!==hash(old.content)||hash(task.visuals)!==hash(old.visuals)||reuse&&hash(task.sourceCheck||null)!==hash(old.sourceCheck||null))throw Error('Источник изменён во время проверки бренда');task.brandCorrection={...task.brandCorrection,brand,proof:snapshot.correction.proof};audit(db,{kind:'studio.brand-correction.photo-verified',taskId:id,jobId:job.id,brand,basis,proof:snapshot.correction.proof,externalWrite:false});if(!autoBrand||!samePrintedBrand(old.product.brand,brand))return null;task.state=snapshot.correction.previousState;task.brandCorrection={...snapshot.correction,state:'confirmed',completedAt:now()};task.publishError=old.publishError;task.error=old.error;task.updatedAt=now();audit(db,{kind:'studio.brand-correction.confirmed',taskId:id,jobId:job.id,brand,basis,externalWrite:false});return task;});
   if(confirmed)return confirmed;
  }
  const product={...old.product,brand,localized:{...old.product.localized,warnings:[]}},content=await studio.improve(product,old.research||{sources:[]});
  const current=await studio.get(id);if(current.brandCorrection?.token!==token||current.brandCorrection.state!=='preparing')throw Error('Исправление бренда прервано');
  await studio.stage(id,'visuals','Обновляем фотографии выбранного варианта');
  const html=await readFile(join(studio.root,old.sourceHash+'.html'),'utf8'),visuals=await studio.visuals(product,content.output,{html,files:old.sourceMediaFiles||[],onProgress:progress=>studio.set(id,{visualProgress:progress})});
  if(!visuals.images?.length)throw Error('Нет подтверждённых фотографий выбранного товара');
  return studio.ws.repo.mutate(db=>{
   const task=db.studioTasks.find(t=>t.id===id),job=db.jobs.find(j=>j.id===old.jobId);
   if(task?.brandCorrection?.token!==token||task.brandCorrection.state!=='preparing'||job.revision!==snapshot.revision||job.state!=='map_attributes'||job.receipt||db.operations.some(o=>o.jobId===job.id||o.payload?.jobId===job.id)||task.sourceHash!==old.sourceHash||sourcePhoto&&(hash(job.canonical)!==hash(canonical(old.product))||studioReviewHash(task)!==studioReviewHash(old)||hash(task.evidence)!==hash(old.evidence)||hash(task.sourceMediaFiles)!==hash(old.sourceMediaFiles)||hash(task.product)!==hash(old.product)||hash(task.content)!==hash(old.content)||hash(task.visuals)!==hash(old.visuals)||reuse&&hash(task.sourceCheck||null)!==hash(old.sourceCheck||null)))throw Error('Черновик изменён во время исправления бренда');
   (task.brandVersions||=[]).push({at:now(),product:old.product,content:old.content,visuals:old.visuals,preparedMediaPack:old.preparedMediaPack,reviewHash:old.reviewHash});
   Object.assign(task,{product,content,visuals,state:snapshot.correction.previousState,sourceMediaInventory:visuals.inventory||old.sourceMediaInventory,preparedMediaPack:visuals,brandCorrection:{...snapshot.correction,state:'applied',completedAt:now()},publishError:null,error:null,updatedAt:now()});
   task.reviewHash=studioReviewHash(task);task.mediaEnhancement=visuals.richImages?.length?{token:randomUUID(),state:'ready',startedAt:now(),expectedHash:task.reviewHash,galleryCount:visuals.images.length,richCount:visuals.richImages.length,sourceCount:visuals.inventory?.length,translatedSourceCount:visuals.translatedSourceCount,excluded:visuals.excluded}:null;
   job.canonical=canonical(product);job.artifacts.translate={...job.artifacts.translate,output:{...product.localized,...content.output,version:(job.translationVersion||0)+1},at:now()};job.artifacts.translate.outputHash=hash(job.artifacts.translate.output);job.translationVersion=(job.translationVersion||0)+1;
   job.artifacts.image_edit={...job.artifacts.image_edit,output:visuals,outputHash:hash(visuals),at:now()};delete job.artifacts.validate;delete job.artifacts.map_attributes;delete job.mapping;job.revision++;job.gates={};
   audit(db,{kind:'studio.brand-correction.applied',taskId:id,jobId:job.id,brand,basis,reviewHash:task.reviewHash,externalWrite:false});return task;
  });
 }).catch(async e=>studio.ws.repo.mutate(db=>{const task=db.studioTasks.find(t=>t.id===id);if(task?.brandCorrection?.token===token&&task.brandCorrection.state==='preparing'){task.state=snapshot.correction.previousState;task.brandCorrection={...task.brandCorrection,state:'failed',error:String(e.message).slice(0,700)};task.publishError=task.brandCorrection.error;}return task;})).finally(async()=>{studio.tasks.delete(key);await studio.finishActivity?.(id);});
 studio.tasks.set(key,work);studio.tail=work;return studio.get(id);
}
