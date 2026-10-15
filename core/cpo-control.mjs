import {randomUUID} from 'node:crypto';
import {audit,hash} from './repository.mjs';
import {enableQuote} from '../adapters/ozon-cpo.mjs';
const find=(items,id)=>{const x=items?.find(x=>x.id===id);if(!x)throw Error('Not found');return x;};
const now=()=>new Date().toISOString();
const cpo=o=>['cpo_disable','cpo_enable'].includes(o.kind);
function eligible(ws,db,id){const p=find(db.trialPlans,id),s=ws.resolveStore(db,p.storeId);if(p.status!=='planned'||p.lever!=='ads'||!['cpo_disable','cpo_enable'].includes(p.adsControl)||s.id!=='ozon-live'||s.mode!=='live'||s.marketplace!=='ozon')throw Error('需要主 Ozon 店铺的明确 CPO 开启 / 关闭计划');return {p,s};}
function targetFor(p,phase){if(!['baseline','test'].includes(phase))throw Error('请选择基准或测试方案');const target=p.adsControl==='cpo_enable';return phase==='test'?target:!target;}
export async function inspectCpo(ws,id){const db=await ws.repo.read(),{p,s}=eligible(ws,db,id),context=await ws.cpoReader(s,p.sku);return ws.repo.mutate(db=>{const {p}=eligible(ws,db,id);p.cpoObservation=context;audit(db,{kind:'cpo.plan.inspected',planId:id,outputHash:hash(context)});return context;});}
export async function prepareCpo(ws,id,{phase='test'}={}){
 const db=await ws.repo.read(),{p:plan,s}=eligible(ws,db,id),target=targetFor(plan,phase),context=await ws.cpoReader(s,plan.sku);
 if(context.enabled===target)throw Error('此 SKU 已处于目标 CPO 状态，无需提交');
 if(target)enableQuote(context);
 return ws.repo.mutate(db=>{
  const {p}=eligible(ws,db,id);if(p.sku!==plan.sku||p.storeId!==plan.storeId||targetFor(p,phase)!==target)throw Error('计划已改变');
  const active=db.operations.filter(o=>cpo(o)&&o.storeId===p.storeId&&o.payload.sku===p.sku);
  if(active.some(o=>['executing','submitted','unknown'].includes(o.state)))throw Error('请先核对未明确的 CPO 操作结果');
  const prior=active.find(o=>['pending','approved'].includes(o.state)&&o.payload.planId===id&&(o.payload.phase||'test')===phase&&o.payload.target===target&&o.payload.context.fingerprint===context.fingerprint&&(!target||o.payload.context.fixedBid===context.fixedBid)&&Date.now()-Date.parse(o.payload.context.checkedAt)<900000);if(prior)return prior;
  for(const o of active.filter(o=>['pending','approved'].includes(o.state))){o.state='superseded';audit(db,{kind:'cpo.approval.superseded',operationId:o.id});}
  p.cpoObservation=context;
  const payload={planId:id,phase,sku:p.sku,before:!target,target,context,apiBody:{skus:[p.sku]},scope:'specific_sku_cpo'};
  const op={id:randomUUID(),kind:target?'cpo_enable':'cpo_disable',storeId:p.storeId,mode:'live',payload,payloadHash:hash(payload),state:'pending',createdAt:now()};db.operations.push(op);audit(db,{kind:'cpo.plan.prepared',planId:id,operationId:op.id,payloadHash:op.payloadHash});return op;
 });
}
export function verifyCpo(ws,db,op,executing=false){
 const {p}=eligible(ws,db,op.payload.planId),phase=op.payload.phase||'test',target=targetFor(p,phase),age=Date.now()-Date.parse(op.payload.context.checkedAt);
 if(p.storeId!==op.storeId||p.sku!==op.payload.sku||op.payload.target!==target||op.kind!==(target?'cpo_enable':'cpo_disable')||!Number.isFinite(age)||age<0||age>900000)throw Error('CPO 计划或15分钟确认已失效，请重新拟定');
 if(target)enableQuote(op.payload.context);
 if(executing){const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10),start=phase==='baseline'?new Date(Date.parse(p.aStart)-86400000).toISOString().slice(0,10):p.bStart,end=phase==='baseline'?p.aEnd:p.bEnd;if(today<start||today>end)throw Error(phase==='baseline'?'基准操作仅可在基准开始前一天至基准结束执行（莫斯科日期）':'请在计划测试期内执行 CPO 操作（莫斯科日期）');}
}
export async function reconcileCpo(ws,id){
 const db=await ws.repo.read(),op=find(db.operations,id);
 if(!cpo(op)||!(['submitted','unknown','verified'].includes(op.state)||op.state==='blocked'&&op.receipt?.status==='not_updated'))throw Error('没有可核对的 CPO 操作');
 const current=await ws.cpoReader(ws.resolveStore(db,op.storeId),op.payload.sku),before=op.payload.context;
 if(current.accountRef!==before.accountRef||current.sellerRef!==before.sellerRef||current.productId!==before.productId||current.offerId!==before.offerId)throw Error('店铺、广告账户或商品身份已变化');
 return ws.repo.mutate(db=>{
  const o=find(db.operations,id);if(o.payloadHash!==op.payloadHash)throw Error('操作已变化');
  if(o.cpoObservation?.at>current.checkedAt)return o;
  o.cpoObservation={enabled:current.enabled,bidPct:current.bidPct,bidRub:current.bidRub,fixedBid:current.fixedBid,quoteChanged:o.payload.target===true&&(current.fixedBid!==before.fixedBid||o.receipt?.quoteChanged===true),at:current.checkedAt,matches:current.enabled===o.payload.target,receiptAccepted:o.receipt?.status==='accepted'};
  const p=find(db.trialPlans,o.payload.planId),latest=db.operations.findLast(x=>cpo(x)&&x.storeId===o.storeId&&x.payload.sku===o.payload.sku&&['executing','submitted','unknown','verified'].includes(x.state));
  if(latest&&latest.id!==o.id&&db.operations.indexOf(latest)>db.operations.indexOf(o)){o.state='superseded';audit(db,{kind:'cpo.historical.observed',operationId:id,outputHash:hash(o.cpoObservation)});return o;}
  p.cpoObservation=current;const field=o.payload.phase==='baseline'?'baselineExecution':'execution',prefix=o.payload.target?'cpo_on':'cpo_off';
  if(o.cpoObservation.matches){o.state='verified';p[field]=prefix+'_observed';}
  else {o.state=o.receipt?.status==='accepted'?'submitted':o.receipt?.status==='not_updated'?'blocked':'unknown';p[field]='cpo_state_changed';}
  if(o.cpoObservation.quoteChanged)p.cpoQuoteChanged=true;
  audit(db,{kind:'cpo.observed',operationId:id,outputHash:hash(o.cpoObservation)});return o;
 });
}
