import {randomUUID} from 'node:crypto';
import {audit,hash} from './repository.mjs';
const find=(items,id)=>{const x=items?.find(x=>x.id===id);if(!x)throw Error('Not found');return x;};
const now=()=>new Date().toISOString();
function eligible(ws,db,id){const p=find(db.trialPlans,id),s=ws.resolveStore(db,p.storeId);if(p.status!=='planned'||p.lever!=='ads'||p.adsControl!=='cpo_disable'||s.id!=='ozon-live'||s.mode!=='live'||s.marketplace!=='ozon')throw Error('需要主 Ozon 店铺的 CPO 开启 → 关闭计划');return {p,s};}
export async function inspectCpo(ws,id){const db=await ws.repo.read(),{p,s}=eligible(ws,db,id),context=await ws.cpoReader(s,p.sku);return ws.repo.mutate(db=>{const {p}=eligible(ws,db,id);p.cpoObservation=context;audit(db,{kind:'cpo.plan.inspected',planId:id,outputHash:hash(context)});return context;});}
export async function prepareCpo(ws,id){
 const db=await ws.repo.read(),{p:plan,s}=eligible(ws,db,id),context=await ws.cpoReader(s,plan.sku);
 if(context.enabled!==true)throw Error('此 SKU 的指定商品 CPO 已关闭，无需提交');
 return ws.repo.mutate(db=>{
  const {p}=eligible(ws,db,id);if(p.sku!==plan.sku||p.storeId!==plan.storeId)throw Error('计划已改变');
  const active=db.operations.filter(o=>o.kind==='cpo_disable'&&o.storeId===p.storeId&&o.payload.sku===p.sku);
  if(active.some(o=>['executing','submitted','unknown'].includes(o.state)))throw Error('请先核对未明确的 CPO 操作结果');
  const prior=active.find(o=>['pending','approved'].includes(o.state)&&o.payload.planId===id&&o.payload.context.fingerprint===context.fingerprint&&Date.now()-Date.parse(o.payload.context.checkedAt)<900000);if(prior)return prior;
  for(const o of active.filter(o=>['pending','approved'].includes(o.state))){o.state='superseded';audit(db,{kind:'cpo.approval.superseded',operationId:o.id});}
  p.cpoObservation=context;
  const payload={planId:id,sku:p.sku,before:true,target:false,context,apiBody:{skus:[p.sku]},scope:'specific_sku_cpo'};
  const op={id:randomUUID(),kind:'cpo_disable',storeId:p.storeId,mode:'live',payload,payloadHash:hash(payload),state:'pending',createdAt:now()};db.operations.push(op);audit(db,{kind:'cpo.plan.prepared',planId:id,operationId:op.id,payloadHash:op.payloadHash});return op;
 });
}
export function verifyCpo(ws,db,op,executing=false){
 const {p}=eligible(ws,db,op.payload.planId),age=Date.now()-Date.parse(op.payload.context.checkedAt);
 if(p.storeId!==op.storeId||p.sku!==op.payload.sku||op.payload.target!==false||!Number.isFinite(age)||age<0||age>900000)throw Error('CPO 计划或15分钟确认已失效，请重新拟定');
 if(executing){const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);if(today<p.bStart||today>p.bEnd)throw Error('请在计划测试期内执行 CPO 关闭（莫斯科日期）');}
}
export async function reconcileCpo(ws,id){
 const db=await ws.repo.read(),op=find(db.operations,id);
 if(op.kind!=='cpo_disable'||!['submitted','unknown','verified'].includes(op.state))throw Error('没有可核对的 CPO 操作');
 const current=await ws.cpoReader(ws.resolveStore(db,op.storeId),op.payload.sku),before=op.payload.context;
 if(current.accountRef!==before.accountRef||current.sellerRef!==before.sellerRef||current.productId!==before.productId||current.offerId!==before.offerId)throw Error('店铺、广告账户或商品身份已变化');
 return ws.repo.mutate(db=>{
  const o=find(db.operations,id);if(o.payloadHash!==op.payloadHash)throw Error('操作已变化');
  if(o.cpoObservation?.at>current.checkedAt)return o;
  o.cpoObservation={enabled:current.enabled,at:current.checkedAt,matches:current.enabled===false,receiptAccepted:o.receipt?.status==='accepted'};
  const p=find(db.trialPlans,o.payload.planId);p.cpoObservation=current;
  if(o.cpoObservation.matches){o.state='verified';p.execution='cpo_off_observed';}
  else {o.state=o.receipt?.status==='accepted'?'submitted':'unknown';p.execution='cpo_state_changed';}
  audit(db,{kind:'cpo.observed',operationId:id,outputHash:hash(o.cpoObservation)});return o;
 });
}
