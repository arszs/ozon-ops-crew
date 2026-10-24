import {ozonCall} from '../adapters/ozon-products.mjs';
import {startStudioMediaEnhancement,equivalentOzonTitle} from './studio-media-enhancement.mjs';
import {matchesPublishedRichContent} from './ozon-rich-content.mjs';
import {promotionalMediaDecline} from './ozon-media-policy.mjs';
import {studioReviewHash} from './product-facts.mjs';
import {hash,audit} from './repository.mjs';

export async function repairStudioMediaModeration(studio,id,input,{call=ozonCall,enhance=startStudioMediaEnhancement}={}){
 const task=await studio.get(id),db=await studio.ws.repo.read(),job=db.jobs.find(j=>j.id===task.jobId),store=studio.ws.resolveStore(db,task.storeId),m=task.mediaEnhancement;
 if(input.expectedHash!==studioReviewHash(task)||!['ready','submitted'].includes(m?.state)||m.preparing||job?.state!=='imported'||!job.receipt?.taskId||(task.mediaModerationRepairs||[]).length>=2)throw Error('Нет завершённого отказа модерации для исправления');
 const info=await call(store,'/v3/product/info/list',{offer_id:[job.canonical.sku]}),before=info.items?.find(p=>p.offer_id===job.canonical.sku&&Number(p.id)===Number(job.importResult?.productId));
 if(!before||before.statuses?.moderate_status!=='declined'||!Number.isFinite(Date.parse(before.statuses.status_updated_at))||Date.parse(before.statuses.status_updated_at)<Date.parse(m.submittedAt||m.startedAt||'1970-01-01')||!promotionalMediaDecline(before.errors)||!equivalentOzonTitle(before.name,task.content.output.title)||Number(before.price)!==Number(task.pricing.price)||before.currency_code!==task.pricing.currency)throw Error('Ozon не подтверждает отказ рекламных изображений либо карточка изменена');
 const attrs=await call(store,'/v4/product/info/attributes',{filter:{product_id:[String(before.id)],visibility:'ALL'},limit:100,last_id:''}),current=attrs.result?.find(p=>Number(p.id)===Number(before.id)&&p.offer_id===job.canonical.sku),annotation=current?.attributes?.find(a=>a.id===4191)?.values?.[0]?.value,rich=current?.attributes?.find(a=>a.id===11254)?.values?.[0]?.value;
 if(annotation!==task.content.output.description)throw Error('Описание Ozon изменено владельцем');if(rich?.trim()){let matches=false;try{matches=matchesPublishedRichContent(JSON.parse(rich),task.richContent);}catch{}if(!matches)throw Error('Rich-контент Ozon изменён владельцем');}
 const fingerprint=hash({receipt:job.receipt.taskId,status:before.statuses.status_updated_at,errors:before.errors});
 await studio.ws.repo.mutate(db=>{const t=db.studioTasks.find(t=>t.id===id),j=db.jobs.find(j=>j.id===task.jobId);if(studioReviewHash(t)!==input.expectedHash||j.revision!==job.revision||!['ready','submitted'].includes(t.mediaEnhancement.state)||(t.mediaModerationRepairs||[]).some(r=>r.fingerprint===fingerprint))throw Error('Отказ уже обработан либо карточка изменена');(t.mediaModerationRepairs??=[]).push({fingerprint,receipt:j.receipt,errors:before.errors,previousMedia:t.mediaEnhancement,at:new Date().toISOString()});t.state=t.buyerUrl?'published':'submitted';t.publishError=null;t.mediaEnhancement={...t.mediaEnhancement,state:'failed',autoApplyBlocked:true,error:'Исправляем отклонённые Ozon рекламные изображения; исходники сохранены.'};audit(db,{kind:'studio.media-moderation.repair',taskId:id,jobId:j.id,fingerprint,externalWrite:false});});
 return enhance(studio,id,{expectedHash:input.expectedHash,apply:true});
}
