import {ozonCall,attributeValues} from '../adapters/ozon-products.mjs';
import {sameStudioBrand} from './studio-ozon.mjs';
import {studioReviewHash,productFactBinding} from './product-facts.mjs';
import {hash,audit} from './repository.mjs';

export async function editStudioDraft(studio,id,input,{call=ozonCall}={}){
 const before=await studio.get(id),db=await studio.ws.repo.read(),store=studio.ws.resolveStore(db,before.storeId);
 if(input.expectedHash!==studioReviewHash(before))throw Error('Черновик изменился; обновите страницу');
 let category,brand,audience;
 if(input.category){
  const {categoryId,typeId}=input.category;
  if(![categoryId,typeId].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('Некорректная категория');
  const tree=await call(store,'/v1/description-category/tree',{language:'RU'});
  function walk(nodes,parent){for(const n of nodes||[]){if(n.disabled)continue;if(n.type_id===typeId&&parent===categoryId)category={categoryId,typeId,name:n.type_name,source:'owner-selected',binding:productFactBinding(before.product)};walk(n.children,n.description_category_id||parent);}}walk(tree.result);
  if(!category)throw Error('Выбранная категория недоступна в Ozon');
 }
 if(input.brand){const c=category||before.categorySelection,b=input.brand;if(!c||!Number.isSafeInteger(b.dictionaryValueId)||typeof b.value!=='string'||!sameStudioBrand(before.product.brand,b.value)||typeof b.reason!=='string'||b.reason.trim().length<20)throw Error('Нужно подтверждение записи исходного бренда');const values=await attributeValues(store,{categoryId:c.categoryId,typeId:c.typeId,attributeId:85,query:b.value},call),found=values.items.find(v=>v.id===b.dictionaryValueId&&v.value===b.value);if(!found)throw Error('Запись бренда не найдена в Ozon');brand={categoryId:c.categoryId,typeId:c.typeId,dictionaryValueId:found.id,value:found.value,picture:found.picture||'',reason:b.reason.trim().slice(0,2000),source:'dictionary-context-reviewed',binding:productFactBinding(before.product),checkedAt:new Date().toISOString()};}
 if(input.audience){const c=category||before.categorySelection,a=input.audience;if(!c||!Array.isArray(a.values)||a.values.length!==2||new Set(a.values).size!==2||a.values.some(v=>!['Мужской','Женский'].includes(v))||typeof a.reason!=='string'||a.reason.trim().length<20)throw Error('Нужна классификация взрослой аудитории');const values=[];for(const value of a.values){const live=await attributeValues(store,{categoryId:c.categoryId,typeId:c.typeId,attributeId:9163,query:value},call),matches=live.items.filter(v=>v.value===value);if(matches.length!==1)throw Error('Аудитория не найдена в Ozon');values.push({dictionary_value_id:matches[0].id,value});}audience={categoryId:c.categoryId,typeId:c.typeId,values,reason:a.reason.trim().slice(0,2000),source:'catalogue-audience-classification',binding:productFactBinding(before.product)};}
 if(input.description!==undefined&&(typeof input.description!=='string'||!input.description.trim()||input.description.length>4000||/\p{Script=Han}/u.test(input.description)))throw Error('Нужно русское описание до 4000 символов');
 if(!category&&!brand&&!audience&&input.description===undefined)throw Error('Нет изменений');
 return studio.ws.repo.mutate(db=>{
  const task=db.studioTasks.find(t=>t.id===id),job=db.jobs.find(j=>j.id===task?.jobId);
  if(!task||!job||task.state!=='ready'||job.state!=='map_attributes'||job.receipt||db.operations.some(o=>o.jobId===job.id||o.payload?.jobId===job.id)||input.expectedHash!==studioReviewHash(task)||task.mediaEnhancement?.preparing||task.mediaEnhancement&&task.mediaEnhancement.state!=='ready')throw Error('Можно изменить только готовый неотправленный черновик');
  task.draftVersions??=[];task.draftVersions.push({at:new Date().toISOString(),content:task.content,categorySelection:task.categorySelection,brandSelection:task.brandSelection,audienceSelection:task.audienceSelection,reviewHash:task.reviewHash});
  if(category)task.categorySelection=category;
  if(brand)task.brandSelection=brand;else if(category&&(task.brandSelection?.categoryId!==category.categoryId||task.brandSelection?.typeId!==category.typeId))delete task.brandSelection;
  if(audience)task.audienceSelection=audience;else if(category&&(task.audienceSelection?.categoryId!==category.categoryId||task.audienceSelection?.typeId!==category.typeId))delete task.audienceSelection;
  if(input.description!==undefined){task.content={...task.content,ownerEdited:true,output:{...task.content.output,description:input.description.trim()}};job.artifacts.translate.output={...job.artifacts.translate.output,description:task.content.output.description};job.artifacts.translate.outputHash=hash(job.artifacts.translate.output);}
  task.reviewHash=studioReviewHash(task);task.publishError=null;task.updatedAt=new Date().toISOString();job.revision++;job.gates={};delete job.artifacts.map_attributes;
  if(task.preparedMediaPack){const sourceText=(task.sourceMediaInventory||[]).filter(r=>r.state!=='excluded'&&r.analysis?.kind==='product').map(r=>r.analysis.textZh).join('\n').slice(0,16000);task.preparedMediaPack={...task.preparedMediaPack,preparedContent:structuredClone(task.content),copySourceHash:hash(sourceText)};}
  if(task.mediaEnhancement)task.mediaEnhancement={...task.mediaEnhancement,expectedHash:task.reviewHash};
  audit(db,{kind:'studio.draft.edited',taskId:id,jobId:job.id,categorySelection:category,brandSelection:brand,audienceSelection:audience,descriptionChanged:input.description!==undefined,externalWrite:false});return task;
 });
}
