import {randomUUID} from 'node:crypto';
import {hash,audit} from './repository.mjs';
import {buildWbStockPlan} from '../adapters/wb-stock-write.mjs';
const now=()=>new Date().toISOString();
const same=(a,b)=>a.payload.context.accountRef===b.payload.context.accountRef&&a.payload.context.product.sku===b.payload.context.product.sku&&a.payload.context.warehouse.id===b.payload.context.warehouse.id;
function verify(db,id){const op=db.operations.find(o=>o.id===id);if(!op||op.kind!=='wb_stock'||op.payloadHash!==hash(op.payload))throw Error('WB 库存计划无效');return op;}
function latest(db,op){const i=db.operations.findIndex(o=>o.id===op.id);if(db.operations.slice(i+1).some(o=>o.kind==='wb_stock'&&same(o,op)))throw Error('已有较新的库存计划，请核对最新操作');}
export async function inspectWbStock(ws,storeId,nmID,warehouseId){const db=await ws.repo.read(),store=ws.resolveStore(db,storeId),product=await ws.wbStockProduct(store,nmID);return ws.wbStockContext(store,product,warehouseId);}
export async function prepareWbStock(ws,storeId,input){
 const context=await inspectWbStock(ws,storeId,input.nmID,input.warehouseId),plan=buildWbStockPlan(context,input),payload={marketplace:'wb',context,plan,checkedAt:now()};
 return ws.repo.mutate(db=>{
  const op={id:randomUUID(),kind:'wb_stock',mode:'live',storeId,state:'pending',payload,payloadHash:hash(payload),createdAt:now()};
  const previous=db.operations.filter(o=>o.kind==='wb_stock'&&same(o,op));if(previous.some(o=>['executing','submitted','unknown'].includes(o.state)))throw Error('此商品在该仓库已有库存操作，请先读取并核对');
  for(const p of previous.filter(o=>['pending','approved'].includes(o.state)))p.state='superseded';
  db.operations.push(op);audit(db,{kind:'gate.wb_stock.requested',operationId:op.id,payloadHash:op.payloadHash});return op;
 });
}
export async function approveWbStock(ws,id,payloadHash){return ws.repo.mutate(db=>{const op=verify(db,id),at=Date.parse(op.payload.checkedAt);if(op.state!=='pending'||op.payloadHash!==payloadHash||!Number.isFinite(at)||Date.now()-at>900000||at>Date.now()+5000)throw Error('库存确认已失效，请重新拟定');op.state='approved';op.approvedHash=payloadHash;op.approvedAt=now();audit(db,{kind:'gate.wb_stock.approved',operationId:id,payloadHash});return op;});}
export async function executeWbStock(ws,id){
 const start=await ws.repo.mutate(db=>{
  const op=verify(db,id);if(['submitted','verified','reviewed'].includes(op.state))return {done:op};if(op.state!=='approved'||op.approvedHash!==op.payloadHash)throw Error('请确认当前库存版本；不确定的任务不能重发');
  if(db.operations.some(o=>o.id!==id&&o.kind==='wb_stock'&&o.payload.context.accountRef===op.payload.context.accountRef&&(o.state==='executing'||o.retryAt>Date.now())))throw Error('该 WB 账户正在修改库存或限流等待中');
  op.state='executing';op.executedAt=now();audit(db,{kind:'wb_stock.executing',operationId:id,inputHash:hash(op.payload.plan.apiBody)});return {op:structuredClone(op),store:ws.resolveStore(db,op.storeId)};
 });if(start.done)return start.done;
 try{const receipt=await ws.wbStockSubmit(start.store,start.op);return ws.repo.mutate(db=>{const op=verify(db,id);op.state='submitted';op.receipt=receipt;op.completedAt=now();audit(db,{kind:'wb_stock.submitted',operationId:id,outputHash:hash(receipt),externalWrite:true});return op;});}
 catch(e){await ws.repo.mutate(db=>{const op=verify(db,id);op.state=e.noWrite?'blocked':'unknown';op.error=e.noWrite?String(e.message).slice(0,350):'WB 库存结果不确定；请读取核对，禁止重发';if(Number.isFinite(e.retryAt))op.retryAt=e.retryAt;op.completedAt=now();audit(db,{kind:'wb_stock.'+op.state,operationId:id,error:op.error});});throw e;}
}
export async function reconcileWbStock(ws,id){
 const db=await ws.repo.read(),op=verify(db,id);if(!['submitted','unknown','verified'].includes(op.state))throw Error('没有可核对的 WB 库存操作');latest(db,op);
 const result=await ws.wbStockResult(ws.resolveStore(db,op.storeId),op);
 return ws.repo.mutate(db=>{const current=verify(db,id);latest(db,current);if(hash(current)!==hash(op))throw Error('库存操作已变化，请重新读取');current.observation=result;if(result.matches){current.state='verified';delete current.error;}else if(current.state==='verified')current.state='submitted';audit(db,{kind:'wb_stock.observed',operationId:id,outputHash:hash(result),externalWrite:false});return current;});
}
export async function confirmWbStock(ws,id,{observationVersion,confirmed}={}){
 const db=await ws.repo.read(),op=verify(db,id);latest(db,op);if(!['submitted','unknown'].includes(op.state)||confirmed!==true||!op.observation?.known||op.observation.matches||op.observation.version!==observationVersion)throw Error('请先读取当前库存，核对差异后确认');
 const fresh=await ws.wbStockResult(ws.resolveStore(db,op.storeId),op);if(!fresh.known||fresh.version!==observationVersion)throw Error('当前库存又发生变化，请重新读取核对');
 return ws.repo.mutate(db=>{const current=verify(db,id);latest(db,current);if(hash(current)!==hash(op))throw Error('库存操作已变化');current.state='reviewed';current.observation=fresh;current.reviewedAt=now();delete current.error;audit(db,{kind:'gate.wb_stock.difference_reviewed',operationId:id,observationVersion,externalWrite:false});return current;});
}
