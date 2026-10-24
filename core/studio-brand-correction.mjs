import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonical} from './canonical.mjs';
import {audit,hash} from './repository.mjs';
import {studioReviewHash} from './product-facts.mjs';
const now=()=>new Date().toISOString();
export async function correctStudioBrand(studio,id,input={}){
 const brand=String(input.brand||'').trim(),reason=String(input.reason||'').trim();
 if(!brand||brand.length>100||!reason||reason.length>1000||input.basis!=='owner-confirmed')throw Error('Укажите фактический бренд и основание исправления владельцем');
 const token=randomUUID(),snapshot=await studio.ws.repo.mutate(db=>{
  const task=db.studioTasks.find(t=>t.id===id),job=db.jobs.find(j=>j.id===task?.jobId);
  if(!task||!job||!['ready','needs_price'].includes(task.state)||job.state!=='map_attributes'||task.brandCorrection?.state==='preparing')throw Error('Исправлять бренд можно только у готового неотправленного черновика');
  if(input.expectedHash!==studioReviewHash(task)||hash(job.canonical)!==hash(canonical(task.product))||job.artifacts.translate?.output.title!==task.content?.output.title||job.artifacts.translate?.output.description!==task.content?.output.description||hash(job.artifacts.image_edit?.output.images)!==hash(task.visuals?.images))throw Error('Черновик изменён; обновите страницу');
  if(brand===task.product.brand)throw Error('Этот бренд уже указан');
  const correction={token,state:'preparing',basis:input.basis,brand,sourceBrand:task.product.brand,reason,previousState:task.state,startedAt:now()};
  const saved={task:structuredClone(task),revision:job.revision};task.brandCorrection=correction;task.state='copy';task.publishError=null;task.updatedAt=now();
  audit(db,{kind:'studio.brand-correction.started',taskId:id,jobId:job.id,brand,sourceBrand:correction.sourceBrand,basis:input.basis,reason,externalWrite:false});return {...saved,correction};
 });
 const key='brand-correction:'+id,work=studio.tail.then(async()=>{
  const old=snapshot.task,product={...old.product,brand,localized:{...old.product.localized,warnings:[]}},content=await studio.improve(product,old.research||{sources:[]});
  const current=await studio.get(id);if(current.brandCorrection?.token!==token||current.brandCorrection.state!=='preparing')throw Error('Исправление бренда прервано');
  await studio.stage(id,'visuals','Обновляем фотографии выбранного варианта');
  const html=await readFile(join(studio.root,old.sourceHash+'.html'),'utf8'),visuals=await studio.visuals(product,content.output,{html,files:old.sourceMediaFiles||[],onProgress:progress=>studio.set(id,{visualProgress:progress})});
  if(!visuals.images?.length)throw Error('Нет подтверждённых фотографий выбранного товара');
  return studio.ws.repo.mutate(db=>{
   const task=db.studioTasks.find(t=>t.id===id),job=db.jobs.find(j=>j.id===old.jobId);
   if(task?.brandCorrection?.token!==token||task.brandCorrection.state!=='preparing'||job.revision!==snapshot.revision||job.state!=='map_attributes'||task.sourceHash!==old.sourceHash)throw Error('Черновик изменён во время исправления бренда');
   (task.brandVersions||=[]).push({at:now(),product:old.product,content:old.content,visuals:old.visuals,preparedMediaPack:old.preparedMediaPack,reviewHash:old.reviewHash});
   Object.assign(task,{product,content,visuals,state:snapshot.correction.previousState,sourceMediaInventory:visuals.inventory||old.sourceMediaInventory,preparedMediaPack:visuals,brandCorrection:{...snapshot.correction,state:'applied',completedAt:now()},publishError:null,error:null,updatedAt:now()});
   task.reviewHash=studioReviewHash(task);task.mediaEnhancement=visuals.richImages?.length?{token:randomUUID(),state:'ready',startedAt:now(),expectedHash:task.reviewHash,galleryCount:visuals.images.length,richCount:visuals.richImages.length,sourceCount:visuals.inventory?.length,translatedSourceCount:visuals.translatedSourceCount,excluded:visuals.excluded}:null;
   job.canonical=canonical(product);job.artifacts.translate={...job.artifacts.translate,output:{...product.localized,...content.output,version:(job.translationVersion||0)+1},at:now()};job.artifacts.translate.outputHash=hash(job.artifacts.translate.output);job.translationVersion=(job.translationVersion||0)+1;
   job.artifacts.image_edit={...job.artifacts.image_edit,output:visuals,outputHash:hash(visuals),at:now()};delete job.artifacts.validate;delete job.artifacts.map_attributes;delete job.mapping;job.revision++;job.gates={};
   audit(db,{kind:'studio.brand-correction.applied',taskId:id,jobId:job.id,brand,basis:input.basis,reviewHash:task.reviewHash,externalWrite:false});return task;
  });
 }).catch(async e=>studio.ws.repo.mutate(db=>{const task=db.studioTasks.find(t=>t.id===id);if(task?.brandCorrection?.token===token&&task.brandCorrection.state==='preparing'){task.state=snapshot.correction.previousState;task.brandCorrection={...task.brandCorrection,state:'failed',error:String(e.message).slice(0,700)};task.publishError=task.brandCorrection.error;}return task;})).finally(()=>studio.tasks.delete(key));
 studio.tasks.set(key,work);studio.tail=work;return studio.get(id);
}
