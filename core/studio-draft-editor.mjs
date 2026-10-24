import {ozonCall} from '../adapters/ozon-products.mjs';
import {studioReviewHash,productFactBinding} from './product-facts.mjs';
import {hash,audit} from './repository.mjs';

export async function editStudioDraft(studio,id,input,{call=ozonCall}={}){
 const before=await studio.get(id),db=await studio.ws.repo.read(),store=studio.ws.resolveStore(db,before.storeId);
 if(input.expectedHash!==studioReviewHash(before))throw Error('Черновик изменился; обновите страницу');
 let category;
 if(input.category){
  const {categoryId,typeId}=input.category;
  if(![categoryId,typeId].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('Некорректная категория');
  const tree=await call(store,'/v1/description-category/tree',{language:'RU'});
  function walk(nodes,parent){for(const n of nodes||[]){if(n.disabled)continue;if(n.type_id===typeId&&parent===categoryId)category={categoryId,typeId,name:n.type_name,source:'owner-selected',binding:productFactBinding(before.product)};walk(n.children,n.description_category_id||parent);}}walk(tree.result);
  if(!category)throw Error('Выбранная категория недоступна в Ozon');
 }
 if(input.description!==undefined&&(typeof input.description!=='string'||!input.description.trim()||input.description.length>4000||/\p{Script=Han}/u.test(input.description)))throw Error('Нужно русское описание до 4000 символов');
 if(!category&&input.description===undefined)throw Error('Нет изменений');
 return studio.ws.repo.mutate(db=>{
  const task=db.studioTasks.find(t=>t.id===id),job=db.jobs.find(j=>j.id===task?.jobId);
  if(!task||!job||task.state!=='ready'||job.state!=='map_attributes'||job.receipt||db.operations.some(o=>o.jobId===job.id||o.payload?.jobId===job.id)||input.expectedHash!==studioReviewHash(task)||task.mediaEnhancement?.preparing||task.mediaEnhancement&&task.mediaEnhancement.state!=='ready')throw Error('Можно изменить только готовый неотправленный черновик');
  task.draftVersions??=[];task.draftVersions.push({at:new Date().toISOString(),content:task.content,categorySelection:task.categorySelection,reviewHash:task.reviewHash});
  if(category)task.categorySelection=category;
  if(input.description!==undefined){task.content={...task.content,ownerEdited:true,output:{...task.content.output,description:input.description.trim()}};job.artifacts.translate.output={...job.artifacts.translate.output,description:task.content.output.description};job.artifacts.translate.outputHash=hash(job.artifacts.translate.output);}
  task.reviewHash=studioReviewHash(task);task.publishError=null;task.updatedAt=new Date().toISOString();job.revision++;job.gates={};delete job.artifacts.map_attributes;
  if(task.preparedMediaPack){const sourceText=(task.sourceMediaInventory||[]).filter(r=>r.state!=='excluded'&&r.analysis?.kind==='product').map(r=>r.analysis.textZh).join('\n').slice(0,16000);task.preparedMediaPack={...task.preparedMediaPack,preparedContent:structuredClone(task.content),copySourceHash:hash(sourceText)};}
  if(task.mediaEnhancement)task.mediaEnhancement={...task.mediaEnhancement,expectedHash:task.reviewHash};
  audit(db,{kind:'studio.draft.edited',taskId:id,jobId:job.id,categorySelection:category,descriptionChanged:input.description!==undefined,externalWrite:false});return task;
 });
}
