import {credentials} from '../ozon.mjs';
import {hash} from '../core/repository.mjs';
const READ=new Set(['/v1/finance/accrual/types','/v1/finance/accrual/by-day','/v5/product/info/prices','/v3/product/list','/v1/description-category/tree','/v1/description-category/attribute','/v1/description-category/attribute/values/search','/v1/description-category/attribute/values','/v1/product/import/info','/v3/product/info/list']);
let lastCall=0,queue=Promise.resolve();
export async function ozonCall(store,path,body,{write=false,fetcher=fetch}={}){
 if(!READ.has(path)&&!(write&&['/v3/product/import','/v1/product/import/prices','/v1/product/pictures/import'].includes(path)))throw Error('Ozon method not allowed');
 const run=queue.then(async()=>{
  const wait=350-(Date.now()-lastCall);if(wait>0)await new Promise(r=>setTimeout(r,wait));lastCall=Date.now();
  const c=store.id==='ozon-live'?await credentials():await (await import('./marketplaces.mjs')).envFile(store.envFile).then(v=>({client:v.OZON_CLIENT_ID,key:v.OZON_API_KEY}));
  if(!c.client||!c.key)throw Error('Ozon credentials missing');
  const r=await fetcher('https://api-seller.ozon.ru'+path,{method:'POST',headers:{'Client-Id':c.client,'Api-Key':c.key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Ozon HTTP '+r.status+(r.status===429?'：达到速率限制，请稍后重试读取；不要重复提交发布':''));
  const d=await r.json();if(d.error||d.code)throw Error('Ozon rejected request');return d;
 });queue=run.catch(()=>{});return run;
}
export async function categoryAttributes(store,categoryId,typeId,call=ozonCall){
 for(const n of [categoryId,typeId])if(!Number.isSafeInteger(Number(n))||Number(n)<=0)throw Error('请选择实际 Ozon 类目和类型');
 const d=await call(store,'/v1/description-category/attribute',{description_category_id:Number(categoryId),type_id:Number(typeId),language:'RU'});
 if(!Array.isArray(d.result))throw Error('Ozon attribute schema mismatch');
 return {categoryId:Number(categoryId),typeId:Number(typeId),attributes:d.result,source:'Ozon /v1/description-category/attribute',fetchedAt:new Date().toISOString(),hash:hash(d.result)};
}
export async function attributeValues(store,{categoryId,typeId,attributeId,query='',lastValueId=0},call=ozonCall){
 const body={description_category_id:Number(categoryId),type_id:Number(typeId),attribute_id:Number(attributeId),limit:100};
 for(const n of [body.description_category_id,body.type_id,body.attribute_id])if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid dictionary identifier');
 const d=query?await call(store,'/v1/description-category/attribute/values/search',{...body,value:String(query).slice(0,100)}):await call(store,'/v1/description-category/attribute/values',{...body,last_value_id:Number(lastValueId),language:'RU'});
 return {items:d.result||[],hasNext:d.has_next??null,source:'Ozon attribute values'};
}
export async function validateMapping(store,mapping,call=ozonCall){
 const schema=await categoryAttributes(store,mapping?.categoryId,mapping?.typeId,call),values=mapping?.attributes;
 if(!Array.isArray(values))throw Error('请提供类目属性');
 const ids=new Set();const verified=[];
 for(const a of values){
  const definition=schema.attributes.find(d=>d.id===Number(a.id));
  if(!definition||ids.has(Number(a.id)))throw Error('未知或重复属性 ID');ids.add(Number(a.id));
  if(definition.attribute_complex_id)throw Error('此类目含复合属性，需要专用映射，暂不发布');
  if(!Array.isArray(a.values)||!a.values.length||a.values.length>(definition.is_collection?(definition.max_value_count||100):1))throw Error('属性值数量无效：'+definition.name);
  const parsed=[];for(const v of a.values){
   if(typeof v.value!=='string'||!v.value.trim()||v.value.length>10000)throw Error('属性值为空或过长：'+definition.name);
   if(definition.dictionary_id){const found=await attributeValues(store,{categoryId:schema.categoryId,typeId:schema.typeId,attributeId:definition.id,query:v.value},call);const match=found.items.find(i=>String(i.id)===String(v.dictionary_value_id)&&i.value===v.value);if(!match)throw Error('字典值无法通过 API 验证：'+definition.name);parsed.push({dictionary_value_id:Number(match.id),value:match.value});}
   else{const type=String(definition.type).toLowerCase();if(type==='boolean'&&!['true','false'].includes(v.value))throw Error('布尔属性需要 true / false：'+definition.name);if(['integer','decimal','number'].includes(type)&&(!Number.isFinite(Number(v.value))||(type==='integer'&&!Number.isInteger(Number(v.value)))))throw Error('数字属性无效：'+definition.name);parsed.push({value:v.value});}
  }verified.push({id:definition.id,complex_id:0,values:parsed});
 }
 const missing=schema.attributes.filter(a=>a.is_required&&!ids.has(a.id));if(missing.length)throw Error('缺少必填属性：'+missing.map(a=>a.name+' ['+a.id+']').join(', '));
 return {category:{id:schema.typeId,categoryId:schema.categoryId,name:String(mapping.name||schema.typeId),required:schema.attributes.filter(a=>a.is_required).map(a=>a.name)},attributes:verified,schema,confidence:1,confidenceKind:'human_selected_api_verified',dictionarySource:schema.source};
}
export function buildImportPayload(job){
 const t=job.artifacts.translate.output,m=job.artifacts.map_attributes.output,config=job.publishConfig;
 if(typeof t.title!=='string'||!t.title.trim()||t.title.length>150||typeof t.description!=='string'||!t.description.trim()||t.description.length>4000)throw Error('文案超过本工具草稿限制：标题150，描述4000');
 if(!config||!config.rightsConfirmed||!config.complianceConfirmed||!config.imagesReviewed)throw Error('请确认商品权利、合规与图片');
 if(!['RUB','CNY','USD','EUR'].includes(config.currency)||!/^\d+(\.\d{1,2})?$/.test(String(config.price))||Number(config.price)<=0)throw Error('请填写销售价格和店铺币种');
 if(!['0','0.05','0.07','0.1','0.2','0.22'].includes(String(config.vat)))throw Error('请明确税率；系统不会推断税率');
 for(const k of ['width','height','depth','weight'])if(!Number.isSafeInteger(Number(config[k]))||Number(config[k])<=0)throw Error('请填写正整数包装尺寸 mm 与重量 g');
 if(!Array.isArray(config.images)||!config.images.length||config.images.length>30)throw Error('需要可公开访问的俄语图片 URL');
 const urls=config.images.map(v=>{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname==='localhost'||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)||u.hostname.includes(':'))throw Error('图片需要公开 HTTPS 地址');return u.href;});
 if(!Array.isArray(m.attributes)||!m.schema)throw Error('真实 Ozon 属性尚未验证');
 const item={offer_id:job.canonical.sku,name:t.title,description_category_id:m.category.categoryId,type_id:Number(m.category.id),attributes:m.attributes,price:String(config.price),currency_code:config.currency,vat:String(config.vat),width:Number(config.width),height:Number(config.height),depth:Number(config.depth),dimension_unit:'mm',weight:Number(config.weight),weight_unit:'g',images:urls,primary_image:urls[0]};
 // Product description is a category attribute: it must be visible and identical in the approval.
 const desc=m.schema.attributes.find(a=>a.id===4191||a.name==='Аннотация');
 if(!desc||!item.attributes.some(a=>a.id===desc.id&&a.values.some(v=>v.value===t.description)))throw Error('请把已确认的俄语描述映射到 Ozon Аннотация 属性');
 return {items:[item]};
}
export async function submitImport(store,operation,call=ozonCall){
 if(store.marketplace!=='ozon'||operation.kind!=='publish'||!operation.payload.apiBody)throw Error('Unsupported live write');
 const item=operation.payload.apiBody.items[0];
 const existing=await call(store,'/v3/product/info/list',{offer_id:[item.offer_id]});
 if(!Array.isArray(existing.items))throw Error('无法核验 SKU 是否已存在，停止发布');
 if(existing.items.length)throw Error('该 SKU 已存在；此流程只创建新商品，不覆盖现有商品');
 const data=await call(store,'/v3/product/import',operation.payload.apiBody,{write:true});
 if(!data.result?.task_id)throw Error('Missing import task ID; reconcile manually before retry');
 return {mode:'live',externalWrite:true,status:'submitted',taskId:String(data.result.task_id),payloadHash:operation.payloadHash};
}
export async function importStatus(store,taskId,offerId,call=ozonCall){
 const d=await call(store,'/v1/product/import/info',{task_id:String(taskId)});const item=d.result?.items?.find(i=>i.offer_id===offerId);
 if(!item)return {status:'pending',taskId:String(taskId),errors:[]};
 return {status:item.status,productId:item.product_id||null,errors:item.errors||[],taskId:String(taskId),imported:item.status==='imported',moderationVerified:false};
}
