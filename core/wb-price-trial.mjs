import {hash,audit,maskPII} from './repository.mjs';
import {buildWbPricePlan} from './wb-price-plan.mjs';
export const WB_PRICE_TRIAL_VERSION='wb-uniform-price-v1';
const day=at=>new Date(Date.parse(at)+3*3600000).toISOString().slice(0,10);
const before=d=>new Date(Date.parse(d)-86400000).toISOString().slice(0,10);
const stamp=()=>new Date().toISOString();
const eligible=(ws,db,id)=>{const p=db.trialPlans?.find(p=>p.id===id);if(!p||p.status!=='planned'||p.lever!=='price'||!p.wbPriceEconomics)throw Error('需要未完成的 WB 价格实验计划');const s=ws.resolveStore(db,p.storeId);if(s.mode!=='live'||s.marketplace!=='wb')throw Error('需要真实 WB 店铺');return {p,s};};
const facts=c=>({accountRef:c.accountRef,identityHash:c.identityHash,product:c.product,nmID:c.price.nmID,currency:c.price.currency,discount:c.price.discount,clubDiscount:c.price.clubDiscount,sizes:c.price.sizes.map(s=>s.chrtId).sort()});
const inputFor=(e,phase)=>({currency:e.currency,mode:'uniform',price:e[phase].rows[0].price,discount:e.discount,feePct:e.feePct,minMarginPct:e.minMarginPct,sizes:e.baseline.rows.map(r=>({chrtId:r.chrtId,fixedCost:r.fixedCost})),costsConfirmed:true,promotionReviewed:true});
const terms=p=>Object.fromEntries(['id','storeId','sku','lever','baseline','variant','aStart','aEnd','bStart','bEnd','currency','adBudget','maxLoss'].map(k=>[k,p[k]]));
const matches=(context,e,phase)=>hash(facts(context))===e.identityHash&&context.price.sizes.every(s=>s.price===e[phase].rows[0].price);
export async function wbPriceTrialEconomics(ws,store,plan,input){
 if(before(plan.bStart)<=plan.aEnd)throw Error('WB 价格测试需在两期之间预留至少一天，用于调价和核对');
 const c=await ws.inspectWbPrice(store.id,plan.sku);if(input.wbContextHash!==hash(c))throw Error('WB 价格、折扣或商品身份已变化，请重新读取后确认');
 if(c.price.nmID!==plan.sku)throw Error('WB 商品编号与实验 SKU 不匹配');
 if(plan.currency!==c.price.currency)throw Error('计划限额币种必须与 WB 商品币种一致');
 if(typeof input.wbCostEvidence!=='string'||input.wbCostEvidence.trim().length<5||input.wbCostEvidence.length>1000)throw Error('请填写逐尺码成本和费用来源');
 const draft={...input.wbCosts,currency:plan.currency,mode:'uniform',discount:c.price.discount},baseline=buildWbPricePlan(c,{...draft,price:plan.baseline},{allowUnchanged:true}),variant=buildWbPricePlan(c,{...draft,price:plan.variant},{allowUnchanged:true});
 if(baseline.rows[0].price===variant.rows[0].price)throw Error('基准与测试原价必须不同');
 return {version:WB_PRICE_TRIAL_VERSION,currency:plan.currency,accountRef:c.accountRef,identityHash:hash(facts(c)),context:c,contextHash:hash(c),discount:c.price.discount,clubDiscount:c.price.clubDiscount,feePct:baseline.feePct,minMarginPct:baseline.minMarginPct,evidence:maskPII(input.wbCostEvidence.trim()),baseline,variant,at:stamp()};
}
export function verifyWbPriceTrial(ws,db,op,executing=false){
 if(!op.payload.planId)return;
 const {p}=eligible(ws,db,op.payload.planId),e=p.wbPriceEconomics,phase=op.payload.phase;
 if(!['baseline','variant'].includes(phase)||op.storeId!==p.storeId||op.payload.sku!==p.sku||op.payload.trialEconomicsHash!==hash(e)||op.payload.trialPlanHash!==hash(terms(p))||p.currency!==e.currency||Number(p.baseline)!==e.baseline.rows[0].price||Number(p.variant)!==e.variant.rows[0].price||e.version!==WB_PRICE_TRIAL_VERSION||hash(facts(op.payload.context))!==e.identityHash)throw Error('价格实验、成本版本、折扣或商品身份已变化');
 const expected=buildWbPricePlan(op.payload.context,inputFor(e,phase));if(hash(expected)!==hash(op.payload.plan))throw Error('发送价格或成本不对应原实验方案');
 if(phase==='variant'&&!matches(op.payload.context,e,'baseline'))throw Error('当前商品价格不是原基准方案，请先核对基准');
 if(executing){const today=day(stamp()),start=before(phase==='baseline'?p.aStart:p.bStart),end=phase==='baseline'?p.aEnd:p.bEnd;if(today<start||today>end||phase==='variant'&&today<=p.aEnd)throw Error('仅可在对应期间前一天至结束日执行；测试价不能改变基准期间');}
}
export async function prepareWbTrialPrice(ws,id,{phase}={}){const {p}=eligible(ws,await ws.repo.read(),id);if(!['baseline','variant'].includes(phase))throw Error('请选择基准或测试价格');return ws.prepareWbPrice(p.storeId,{...inputFor(p.wbPriceEconomics,phase),nmID:p.sku},{planId:id,phase,sku:p.sku,trialEconomicsHash:hash(p.wbPriceEconomics),trialPlanHash:hash(terms(p)),trialPeriod:{from:phase==='baseline'?p.aStart:p.bStart,to:phase==='baseline'?p.aEnd:p.bEnd}});}
export async function inspectWbTrialPrice(ws,id){
 const db=await ws.repo.read(),{p,s}=eligible(ws,db,id),frozen=hash(p.wbPriceEconomics),context=await ws.inspectWbPrice(s.id,p.sku);
 return ws.repo.mutate(db=>{const {p}=eligible(ws,db,id);if(hash(p.wbPriceEconomics)!==frozen)throw Error('实验成本版本已变化');const e=p.wbPriceEconomics,observation={at:stamp(),identityMatches:hash(facts(context))===e.identityHash,baselineMatches:matches(context,e,'baseline'),variantMatches:matches(context,e,'variant'),contextHash:hash(context)};p.wbPriceTrialState??={};p.wbPriceTrialState.observation=observation;
  if(day(observation.at)<p.aStart&&!['executing','submitted','unknown'].includes(p.wbPriceTrialState.baseline?.state))p.wbPriceTrialState.baseline={...p.wbPriceTrialState.baseline,state:observation.baselineMatches?'observed':'changed',matches:observation.baselineMatches,originProven:false,observedAt:observation.at};
  const d=day(observation.at),phase=d>=p.aStart&&d<=p.aEnd?'baseline':d>=p.bStart&&d<=p.bEnd?'variant':null;if(phase&&(!observation.identityMatches||!observation[phase+'Matches']))p.wbPriceTrialState.conditionBreak={at:observation.at,phase,contextHash:observation.contextHash};
  if(!observation.identityMatches||day(observation.at)>=p.bStart&&!observation.variantMatches)p.execution='price_state_changed';
  audit(db,{kind:'wb_price.trial.inspected',planId:id,outputHash:hash(observation)});return observation;});
}
export function markWbPriceTrial(db,op){
 if(['submitted','unknown','verified'].includes(op.state))for(const other of db.trialPlans||[]){const at=day(op.executedAt||op.createdAt);if(other.id!==op.payload.planId&&other.wbPriceEconomics?.accountRef===op.payload.context.accountRef&&other.sku===op.payload.context.price.nmID&&(at>=other.aStart&&at<=other.aEnd||at>=other.bStart&&at<=other.bEnd)){other.wbPriceTrialState??={};other.wbPriceTrialState.interference={operationId:op.id,at:op.executedAt,state:op.state};}}
 if(!op.payload.planId)return;const p=db.trialPlans?.find(p=>p.id===op.payload.planId);if(!p)return;p.wbPriceTrialState??={};const phase=op.payload.phase,old=p.wbPriceTrialState[phase],matched=op.observation?.verified===true;p.wbPriceTrialState[phase]={operationId:op.id,state:op.state,executedAt:op.executedAt||null,observedAt:matched&&old?.operationId===op.id&&old.matches?old.observedAt:op.observation?.checkedAt||null,lastCheckedAt:op.observation?.checkedAt||null,matches:matched,originProven:op.observation?.originProven===true};
 if(phase==='variant')p.execution=op.state==='verified'?'price_observed':['executing','submitted','unknown'].includes(op.state)?'price_submitted':'price_state_changed';
}
export function wbPriceTrialBlockers(plan){
 if(!plan.wbPriceEconomics)return [];
 const out=[],s=plan.wbPriceTrialState||{};if(s.interference)out.push('实验期间存在未关联本计划的调价操作，原比较条件已改变');
 for(const [phase,start] of [['baseline',plan.aStart],['variant',plan.bStart]]){const p=s[phase];if(!p?.matches||!p.observedAt)out.push((phase==='baseline'?'基准':'测试')+'价格尚未通过 API 核对');else if(day(p.observedAt)>=start||p.executedAt&&day(p.executedAt)>=start)out.push((phase==='baseline'?'基准':'测试')+'价格在期间开始后才生效或核对，原期间不是完整价格样本');}
 if(s.conditionBreak)out.push('实验期间曾观察到价格、折扣或商品身份不符合方案；恢复价格不能补全原样本');
 return out;
}
