import {randomUUID} from 'node:crypto';
import {hash,audit} from './repository.mjs';
import {buildWbImportPayload} from '../adapters/wb-products.mjs';
const now=()=>new Date().toISOString();
function eligible(job){if(!job||job.marketplace!=='wb'||job.mode!=='manual'||job.synthetic||job.state!=='review_gate'||!job.artifacts.validate?.output.passed||job.gates.category?.revision!==job.revision)throw Error('请完成真实 WB 商品校验并确认翻译与类目');}
export async function prepareWbPublication(ws,id){
 const db=await ws.repo.read(),job=db.jobs.find(j=>j.id===id);eligible(job);const store=ws.resolveStore(db,job.storeId),jobHash=hash(job);if(store.mode!=='live')throw Error('需要真实 WB 连接');
 const context=await ws.wbPreflight(store,job),apiBody=buildWbImportPayload(job);
 return ws.repo.mutate(db=>{
  const j=db.jobs.find(x=>x.id===id);eligible(j);if(hash(j)!==jobHash)throw Error('商品草稿已变化，请重新拟定');
  const unresolved=db.operations.find(o=>o.kind==='publish'&&o.payload.marketplace==='wb'&&o.payload.wbContext?.accountRef===context.accountRef&&o.payload.apiBody?.[0]?.variants?.[0]?.vendorCode===j.canonical.sku&&['executing','unknown','submitted'].includes(o.state));
  if(unresolved)throw Error('此货号已有待核对的 WB 提交，请先查询原操作');
  const payload={marketplace:'wb',jobId:id,revision:j.revision,apiBody,wbContext:context,title:j.artifacts.translate.output.title,description:j.artifacts.translate.output.description,category:j.artifacts.map_attributes.output.category,attributes:j.artifacts.map_attributes.output.attributes,attributeNames:Object.fromEntries(j.artifacts.map_attributes.output.schema.items.map(a=>[a.id,a.name])),images:[],remaining:['images','prices','stocks','moderation'],sourceHash:hash(j.canonical)};
  for(const op of db.operations.filter(o=>o.kind==='publish'&&o.payload.jobId===id&&['pending','approved'].includes(o.state)))op.state='superseded';
  const op={id:randomUUID(),kind:'publish',storeId:j.storeId,mode:'live',payload,payloadHash:hash(payload),state:'pending',createdAt:now()};db.operations.push(op);audit(db,{kind:'gate.publish.requested',jobId:id,operationId:op.id,payloadHash:op.payloadHash,marketplace:'wb'});return op;
 });
}
export function guardWbPublication(db,op){
 const owner=op.payload.wbContext?.accountRef;
 if(!owner)throw Error('WB 发布缺少账户核对');
 const vendor=op.payload.apiBody?.[0]?.variants?.[0]?.vendorCode;
 if(db.operations.some(o=>o.id!==op.id&&o.payload.wbContext?.accountRef===owner&&(o.state==='executing'||o.payload.apiBody?.[0]?.variants?.[0]?.vendorCode===vendor&&['submitted','unknown','verified'].includes(o.state))))throw Error('此 WB 账户正在提交，或该货号已有提交需要核对');
 const at=Date.now();if(db.operations.some(o=>o.id!==op.id&&o.payload.wbContext?.accountRef===owner&&(o.retryAt>at||at-Math.max(Date.parse(o.executedAt||'')||0,Date.parse(o.completedAt||'')||0)<6100)))throw Error('WB 创建请求间隔未到，请稍后执行');
}
export async function syncWbPublication(ws,id){
 const db=await ws.repo.read(),job=db.jobs.find(j=>j.id===id),op=db.operations.findLast(o=>o.kind==='publish'&&o.payload.jobId===id&&o.payload.marketplace==='wb'&&['submitted','unknown','verified'].includes(o.state));
 if(!job||!op)throw Error('没有可核对的 WB 创建请求');
 const result=await ws.wbStatus(ws.resolveStore(db,job.storeId),op);
 return ws.repo.mutate(db=>{
  const current=db.jobs.find(j=>j.id===id),operation=db.operations.find(o=>o.id===op.id);if(current.revision!==job.revision||operation.payloadHash!==op.payloadHash)throw Error('WB 核对版本已变化');
  current.importResult={...result,checkedAt:now()};current.syncedAt=now();if(result.imported){current.state='imported';current.wbPublicationStage='images_pending';operation.state='verified';delete operation.error;}else{current.wbPublicationStage=result.status==='mismatch'?'content_mismatch':'creation_unconfirmed';if(current.state==='imported')current.state='submitted';if(operation.state==='verified')operation.state='submitted';}
  audit(db,{kind:'import.status',jobId:id,operationId:op.id,marketplace:'wb',outputHash:hash(result),externalWrite:false});return current;
 });
}
