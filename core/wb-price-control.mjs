import {verifyWbPriceTrial,markWbPriceTrial} from './wb-price-trial.mjs';
import {randomUUID} from 'node:crypto';
import {hash,audit} from './repository.mjs';
import {buildWbPricePlan} from './wb-price-plan.mjs';
const now=()=>new Date().toISOString();
function verify(db,id){const op=db.operations.find(o=>o.id===id);if(!op||op.kind!=='wb_price'||op.payloadHash!==hash(op.payload))throw Error('WB 价格计划无效');return op;}
export async function inspectWbPrice(ws,storeId,nmID){const db=await ws.repo.read(),store=ws.resolveStore(db,storeId),product=await ws.wbPriceProduct(store,nmID);return ws.wbPriceContext(store,product);}
export async function prepareWbPrice(ws,storeId,input,trial=null){
 const context=await inspectWbPrice(ws,storeId,input.nmID),plan=buildWbPricePlan(context,input),payload={...(trial||{}),marketplace:'wb',context,plan,checkedAt:now()};
 return ws.repo.mutate(db=>{
  const same=o=>o.kind==='wb_price'&&o.payload.context.accountRef===context.accountRef&&o.payload.context.price.nmID===context.price.nmID;
  if(db.operations.some(o=>same(o)&&['executing','submitted','unknown'].includes(o.state)))throw Error('此商品已有价格任务需核对，请先读取原操作结果');
  for(const o of db.operations.filter(o=>same(o)&&['pending','approved'].includes(o.state)))o.state='superseded';
  const op={id:randomUUID(),kind:'wb_price',mode:'live',storeId,state:'pending',payload,payloadHash:hash(payload),createdAt:now()};verifyWbPriceTrial(ws,db,op);db.operations.push(op);audit(db,{kind:'gate.wb_price.requested',operationId:op.id,payloadHash:op.payloadHash});return op;
 });
}
export async function approveWbPrice(ws,id,payloadHash){return ws.repo.mutate(db=>{const op=verify(db,id);if(op.state!=='pending'||op.payloadHash!==payloadHash||!Number.isFinite(Date.parse(op.payload.checkedAt))||Date.now()-Date.parse(op.payload.checkedAt)>900000||Date.parse(op.payload.checkedAt)>Date.now()+5000)throw Error('价格确认已失效，请重新拟定');verifyWbPriceTrial(ws,db,op);op.state='approved';op.approvedHash=payloadHash;op.approvedAt=now();audit(db,{kind:'gate.wb_price.approved',operationId:id,payloadHash});return op;});}
export async function executeWbPrice(ws,id){
 const start=await ws.repo.mutate(db=>{
  const op=verify(db,id);if(['submitted','verified'].includes(op.state))return {done:op};if(op.state!=='approved'||op.approvedHash!==op.payloadHash)throw Error('请确认当前价格版本；不确定的任务不能重发');
  if(db.operations.some(o=>o.id!==id&&o.kind==='wb_price'&&o.payload.context.accountRef===op.payload.context.accountRef&&(o.state==='executing'||o.retryAt>Date.now())))throw Error('该 WB 账户正在调价或限流等待中');
  verifyWbPriceTrial(ws,db,op,true);op.state='executing';op.executedAt=now();markWbPriceTrial(db,op);audit(db,{kind:'wb_price.executing',operationId:id,inputHash:hash(op.payload.plan.apiBody)});return {op:structuredClone(op),store:ws.resolveStore(db,op.storeId)};
 });if(start.done)return start.done;
 try{const receipt=await ws.wbPriceSubmit(start.store,start.op,{beforeSend:async()=>{const db=await ws.repo.read(),op=verify(db,id);if(op.state!=='executing'||op.payloadHash!==start.op.payloadHash)throw Error('调价状态已变化');verifyWbPriceTrial(ws,db,op,true);}});return ws.repo.mutate(db=>{const op=verify(db,id);op.state='submitted';op.receipt=receipt;op.completedAt=now();markWbPriceTrial(db,op);audit(db,{kind:'wb_price.submitted',operationId:id,outputHash:hash(receipt),externalWrite:true});return op;});}
 catch(e){await ws.repo.mutate(db=>{const op=verify(db,id);op.state=e.noWrite?'blocked':'unknown';op.error=e.noWrite?String(e.message).slice(0,350):'WB 调价结果不确定；请读取核对，禁止重发';if(Number.isFinite(e.retryAt))op.retryAt=e.retryAt;op.completedAt=now();markWbPriceTrial(db,op);audit(db,{kind:'wb_price.'+op.state,operationId:id,error:op.error});});throw e;}
}
export async function reconcileWbPrice(ws,id){
 const db=await ws.repo.read(),op=verify(db,id);if(!['submitted','unknown','verified'].includes(op.state))throw Error('没有可核对的 WB 调价任务');
 const latest=db=>{const index=db.operations.findIndex(o=>o.id===id);if(db.operations.slice(index+1).some(o=>o.kind==='wb_price'&&o.payload.context.accountRef===op.payload.context.accountRef&&o.payload.context.price.nmID===op.payload.context.price.nmID))throw Error('已有较新的调价计划，请核对最新操作');};latest(db);
 const result=await ws.wbPriceResult(ws.resolveStore(db,op.storeId),op);
 return ws.repo.mutate(db=>{latest(db);const current=verify(db,id);if(hash(current)!==hash(op))throw Error('调价操作已变化，请重新读取');current.observation=result;if(result.verified){current.state='verified';delete current.error;}else if(result.terminalFailure){current.state='blocked';current.error=result.message;}else if(current.state==='verified')current.state='submitted';markWbPriceTrial(db,current);audit(db,{kind:'wb_price.observed',operationId:id,outputHash:hash(result),externalWrite:false});return current;});
}
