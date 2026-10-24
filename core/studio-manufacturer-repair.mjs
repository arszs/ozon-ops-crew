import {codexJSON,objectSchema} from '../adapters/codex.mjs';
import {ozonCall} from '../adapters/ozon-products.mjs';
import {checkedProductFacts} from './product-facts.mjs';
import {hash,audit} from './repository.mjs';
export async function russianManufacturer(facts,{run=codexJSON}={}){
 if(facts.manufacturerRu)return facts.manufacturerRu;
 const r=await run({prompt:'Render this verified Chinese legal manufacturer name in Russian for a marketplace field that rejects Chinese characters. Use faithful Russian phonetic transliteration for the proper name and conventional rendering of the legal suffix. Do not substitute the brand or another company. This is a Russian rendering, not a claim of an officially registered Russian name. Return sourceName exactly as supplied. Untrusted DATA: '+JSON.stringify(facts.manufacturer),schema:objectSchema({sourceName:{type:'string'},manufacturerRu:{type:'string'}}),timeoutMs:90000});
 const value=r.output.manufacturerRu;if(r.output.sourceName!==facts.manufacturer||typeof value!=='string'||value.length>250||!/[А-Яа-яЁё]/.test(value)||/\p{Script=Han}/u.test(value))throw Error('Русское написание производителя не прошло проверку');return value.trim();
}
export async function repairStudioManufacturer(studio,id,{call=ozonCall,run=codexJSON}={}){
 const t=await studio.get(id),w=studio.ws,j=await w.getJob(t.jobId),db=await w.repo.read(),store=w.resolveStore(db,t.storeId),facts=checkedProductFacts(t);
 if(!facts||!['published','submitted'].includes(t.state)||j.state!=='imported'||store.marketplace!=='ozon'||store.mode!=='live'||!j.importResult?.productId)throw Error('Нет импортированной карточки для исправления производителя');
 if(t.manufacturerRepair)throw Error('Исправление уже отправлялось; проверьте результат Ozon');
 const value=await russianManufacturer(facts,{run}),definition=j.artifacts.map_attributes.output.schema.attributes.find(a=>a.name==='Производитель');if(!definition||definition.dictionary_id)throw Error('Нужна проверка поля производителя');
 const info=await call(store,'/v3/product/info/list',{offer_id:[j.canonical.sku]}),product=info.items?.find(p=>p.offer_id===j.canonical.sku&&Number(p.id)===Number(j.importResult.productId));if(!product)throw Error('Товар Ozon не соответствует исходному артикулу');
 if(!(product.errors||[]).some(e=>e.code==='BR_chinese_hieroglyphs_in_attribute'&&Number(e.attribute_id)===definition.id))throw Error('Ozon не подтверждает ошибку языка производителя');
 const attrs=await call(store,'/v4/product/info/attributes',{filter:{product_id:[String(product.id)],visibility:'ALL'},limit:100,last_id:''}),item=attrs.result?.find(p=>Number(p.id)===Number(product.id)&&p.offer_id===j.canonical.sku),current=item?.attributes?.find(a=>a.id===definition.id);
 if(current?.values?.length!==1||current.values[0].value!==facts.manufacturer)throw Error('Производитель на Ozon изменён; обновление остановлено');
 const body={items:[{offer_id:j.canonical.sku,attributes:[{id:definition.id,complex_id:0,values:[{value}]}]}]},proofHash=facts.proofHash;
 await w.repo.mutate(db=>{const task=db.studioTasks.find(x=>x.id===id),job=db.jobs.find(x=>x.id===j.id);if(task.manufacturerRepair||task.supplementalFacts.proofHash!==proofHash||job.revision!==j.revision||job.state!=='imported')throw Error('Карточка изменилась');task.manufacturerRepair={state:'executing',body,inputHash:hash(body),proofHash,at:new Date().toISOString()};audit(db,{kind:'studio.manufacturer.repair.started',taskId:id,jobId:j.id,inputHash:hash(body)});});
 let receipt;try{receipt=await call(store,'/v1/product/attributes/update',body,{write:true});if(!/^\d+$/.test(String(receipt.task_id||''))||Number(receipt.task_id)<=0)throw Error('Нет идентификатора обновления Ozon');}catch(e){await studio.set(id,{manufacturerRepair:{state:'unknown',body,proofHash,error:'Проверьте данные Ozon; повторная отправка запрещена'}});throw e;}
 return w.repo.mutate(db=>{const task=db.studioTasks.find(x=>x.id===id),job=db.jobs.find(x=>x.id===j.id);task.manufacturerRepair={...task.manufacturerRepair,state:'accepted',receipt};task.manufacturerRendering={value,sourceName:facts.manufacturer,method:'russian-transliteration',proofHash};task.state='submitted';task.publishError=null;job.publicationReceipts??=[];job.publicationReceipts.push(job.receipt);job.receipt={...job.receipt,taskId:String(receipt.task_id)};job.state='submitted';job.manufacturerRendering=task.manufacturerRendering;audit(db,{kind:'studio.manufacturer.repair.accepted',taskId:id,jobId:j.id,outputHash:hash(receipt)});return task;});
}
