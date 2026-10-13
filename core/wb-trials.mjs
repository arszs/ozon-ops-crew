import {randomUUID} from 'node:crypto';
import {hash,audit,maskPII} from './repository.mjs';
import {wbDecimal,decimalText} from '../adapters/wb-finance.mjs';
import {WB_ATTRIBUTION_VERSION} from './wb-finance-attribution.mjs';
import {WB_ALLOCATION_VERSION} from './wb-sku-contribution.mjs';
const source='wb_reports_seller_costs';
export const WB_TRIAL_VERSION='wb-period-contribution-v1';
const today=clock=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(clock()));
const days=p=>(Date.parse(p.to)-Date.parse(p.from))/86400000+1;
const ranges=p=>Object.fromEntries(['a','b'].map(k=>[k,{from:p[k+'Start'],to:p[k+'End']} ]));
const identity=p=>Object.fromEntries(['id','storeId','sku','lever','baseline','variant','aStart','aEnd','bStart','bEnd','adBudget','maxLoss','currency','at'].map(k=>[k,p[k]??null]));
const amount=v=>{if(typeof v!=='string'||!/^\d{1,13}(\.\d{1,6})?$/.test(v)||wbDecimal(v)>1000000000000000000n)throw Error('请填写非负金额，最多六位小数');return decimalText(wbDecimal(v));};
const count=v=>{if(typeof v!=='string'||!/^\d{1,9}$/.test(v))throw Error('请填写已核对订单数，不能用财务明细条数代替');return Number(v);};
const note=v=>{if(typeof v!=='string'||v.trim().length<5||v.length>1000)throw Error('请填写 5–1000 字的执行、费用及可比性依据');return maskPII(v.trim());};
function summary(v){return Object.fromEntries(['a','b'].map(k=>{const {finance:f,ads:a}=v[k],s=f.snapshot,ad=a.snapshot;return [k,{finance:{state:f.state,runId:s?.runId||null,hash:s?.evidenceHash||null,complete:s?.complete===true,stale:s?.stale!==false,period:s?.period||null,currencies:Object.keys(s?.product?.attribution||{}),costs:(f.skuReconciliations||[]).filter(r=>r.status!=='revised')},ads:{state:a.state,runId:ad?.runId||null,hash:ad?.evidenceHash||null,complete:ad?.complete===true,stale:a.comparisonStale!==false,period:ad?.period||null,coverage:ad?.coverage||null,product:ad?.product||null}}];}));}
export function evaluateWbTrial(plan,proof,input){
 const currency=input.currency;if(!/^[A-Z]{3}$/.test(currency||''))throw Error('请选择两个期间共同核对的币种');
 const blockers=[],periods={},evidence=note(input.evidence),checks=Object.fromEntries(['executionConfirmed','comparable','adCoverageReviewed'].map(k=>[k,input[k]===true]));
 for(const k of ['a','b']){
  const p=proof[k],r=p.finance,c=r.costs.find(c=>c.currency===currency),range=ranges(plan)[k];
  if(!c||c.status!=='current'||!r.complete||r.stale||r.state!=='complete'||r.period?.from!==range.from||r.period.to!==range.to||c.sku!==plan.sku||c.storeId!==plan.storeId||c.runId!==r.runId||c.reportHash!==r.hash||c.period.from!==range.from||c.period.to!==range.to)throw Error('请先完成两个原计划期间、此 SKU 同一币种的最新成本核对');
  const orders=count(input[k+'Orders']),adSpend=amount(input[k+'AdSpend']),ad=p.ads,observed=ad.product?.totals?.[currency]?.spend??null;
  if(orders<30)blockers.push((k==='a'?'基准期':'测试期')+'不足 30 个核对订单；此门槛不是统计显著性检验');
  if(r.currencies.some(x=>x!==currency))blockers.push((k==='a'?'基准期':'测试期')+'还有其他币种记账，此比较未覆盖全部结果');
  if(!ad.complete||ad.stale||ad.state!=='complete'||ad.period?.from!==range.from||ad.period.to!==range.to||ad.coverage?.missing?.length||ad.coverage?.mismatch?.length||ad.coverage?.missingDays?.length)blockers.push((k==='a'?'基准期':'测试期')+'广告读取不完整、过期或分配金额不一致');
  if((ad.product?.campaigns||[]).some(c=>!c.stats))blockers.push((k==='a'?'基准期':'测试期')+'关联广告缺少商品统计');
  if(Object.keys(ad.product?.totals||{}).some(x=>x!==currency))blockers.push((k==='a'?'基准期':'测试期')+'广告存在其他币种，不能核对同币种总费用');
  if(observed!==null&&wbDecimal(adSpend)<wbDecimal(observed))blockers.push((k==='a'?'基准期':'测试期')+'核对广告总额低于 API 已读取金额');
  periods[k]={start:range.from,end:range.to,days:days(range),currency,profit:c.contribution,orders,ads:adSpend,observedAds:observed,reportId:r.runId,reportHash:r.hash,costHash:c.hash,costRevision:c.revision,allocationHash:c.allocationHash,cost:structuredClone(c),advertising:structuredClone(ad)};
 }
 if(!checks.executionConfirmed)blockers.push('尚未确认两个方案确实按计划执行');
 if(!checks.comparable)blockers.push('库存、促销、季节与其他条件尚未核对');
 if(!checks.adCoverageReviewed)blockers.push('WB 当前广告列表不保证完整历史费用；请核对缺失或删除的广告及外部费用');
 if(currency!==(plan.currency||'RUB'))blockers.push('核对币种与原计划限额币种不同，不能自动换汇');
 else {if(periods.b.observedAds!==null&&wbDecimal(periods.b.observedAds)>wbDecimal(String(plan.adBudget)))blockers.push('测试期 API 已读取广告费用超过计划上限');if(wbDecimal(periods.b.ads)>wbDecimal(String(plan.adBudget)))blockers.push('测试期核对广告总额超过计划上限');if(wbDecimal(periods.b.profit)<-wbDecimal(String(plan.maxLoss)))blockers.push('测试期贡献亏损超过计划上限');}
 const planDay=new Date(Date.parse(plan.at)+3*3600000).toISOString().slice(0,10);if(planDay>=plan.bStart)blockers.push('计划未在测试开始前保存；此结果是回顾观察');
 const a=wbDecimal(periods.a.profit),b=wbDecimal(periods.b.profit),da=BigInt(periods.a.days),db=BigInt(periods.b.days),deltaNumerator=b*da-a*db;
 return {source,calculationVersion:WB_TRIAL_VERSION,basis:'wb_daily_report_period',sku:plan.sku,lever:plan.lever,baseline:plan.baseline,variant:plan.variant,currency,evidence,...checks,...periods,result:{before:decimalText(a/da),after:decimalText(b/db),delta:decimalText(deltaNumerator/(da*db)),blockers,verdict:blockers.length?'insufficient':deltaNumerator>0n?'repeat_candidate':'no_improvement',causal:false},limitations:['日均金额截断至六位小数；方向按未舍入金额判断','广告历史覆盖由卖家补充核对，API 当前列表不能证明完整性；广告不再重复扣减']};
}
export class WbTrialService{
 constructor(workspace,finance,advertising){Object.assign(this,{workspace,finance,advertising});}
 resolve(db,id){const plan=db.trialPlans?.find(p=>p.id===id);if(!plan)throw Error('实验计划不存在');const store=this.workspace.resolveStore(db,plan.storeId);if(store.mode!=='live'||store.marketplace!=='wb')throw Error('需要真实 WB 实验计划');return {plan,store};}
 stamp(store,plan,owner){return {owner,plan:identity(plan),rules:[WB_ATTRIBUTION_VERSION,WB_ALLOCATION_VERSION,WB_TRIAL_VERSION],periods:Object.fromEntries(Object.entries(ranges(plan)).map(([k,range])=>{
  const f=this.finance.latest(store,owner,range),a=this.advertising.latest(store,owner,range),costs=this.finance.skuCosts.records(store,owner,range),latest=new Map();for(const c of costs)if(c.kind==='allocation'||c.sku===plan.sku)latest.set(JSON.stringify([c.kind,c.currency]),c.hash);
  // Historical-period statistics use the completed report age, not the live bid/configuration freshness window.
  return [k,{finance:f?{id:f.id,state:f.state,updated:f.updated,stale:this.finance.clock()-Date.parse(f.updated)>86400000}:null,costs:[...latest],ads:a?{id:a.id,state:a.state,updated:a.updated,stale:this.advertising.clock()-Date.parse(a.updated)>86400000}:null}];}))};}
 async proof(store,plan){
  const owner=await this.finance.identity(store);if(await this.advertising.identity(store)!==owner)throw Error('WB 财务与广告账户不同');const stamp=hash(this.stamp(store,plan,owner)),periods={};
  for(const [k,r] of Object.entries(ranges(plan))){periods[k]=r.to>=today(this.finance.clock)?{finance:{state:'future',snapshot:null},ads:{state:'future',snapshot:null}}:{finance:await this.finance.get(store,{sku:plan.sku,...r}),ads:await this.advertising.get(store,{sku:plan.sku,...r})};const ad=periods[k].ads;ad.comparisonStale=!ad.snapshot||ad.state!=='complete'||this.advertising.clock()-Date.parse(ad.snapshot.at)>86400000;}
  if(await this.finance.accountRef(store)!==owner||await this.advertising.accountRef(store)!==owner||hash(this.stamp(store,plan,owner))!==stamp)throw Error('WB 证据读取期间发生变化，请重新打开');
  const compact=summary(periods);return {owner,periods,compact,stateHash:stamp,evidenceHash:hash({plan:identity(plan),proof:compact})};
 }
 async get(id){const db=await this.workspace.repo.read(),{store,plan}=this.resolve(db,id),p=await this.proof(store,plan),previous=db.trials?.find(t=>t.id===plan.trialId);return {periods:p.periods,evidenceHash:p.evidenceHash,revision:previous?.revision||0};}
 async read(id,input){const {store,plan}=this.resolve(await this.workspace.repo.read(),id);if(!['a','b'].includes(input.period)||!['finance','ads'].includes(input.kind))throw Error('请选择原计划期间和读取来源');const range=ranges(plan)[input.period],service=input.kind==='finance'?this.finance:this.advertising;await service.start(store,{...range,restart:input.restart===true});return {started:true};}
 async save(id,input){return this.workspace.repo.mutate(async db=>{
  const {store,plan}=this.resolve(db,id),previous=db.trials?.find(t=>t.id===plan.trialId);
  if(plan.status==='cancelled'||previous&&previous.source!==source)throw Error('计划已取消或已有人工作为结果');
  if(db.operations.some(o=>o.payload?.planId===id&&['executing','submitted','unknown'].includes(o.state)))throw Error('请先核对未完成的平台操作');
  if(!Number.isSafeInteger(input.revision)||input.revision!==(previous?.revision||0))throw Error('比较版本已变化，请重新打开');
  const p=await this.proof(store,plan);if(p.evidenceHash!==input.evidenceHash)throw Error('比较依据已变化，请重新打开核对');
  const evaluated=evaluateWbTrial(plan,p.compact,input),inputHash=hash({evaluated,stateHash:p.stateHash});
  if(await this.finance.accountRef(store)!==p.owner||await this.advertising.accountRef(store)!==p.owner||hash(this.stamp(store,plan,p.owner))!==p.stateHash)throw Error('保存前来源已变化，请重新核对');
  if(previous?.inputHash===inputHash)return previous;
  const trial={id:randomUUID(),at:new Date().toISOString(),storeId:store.id,mode:'live',planId:id,revision:(previous?.revision||0)+1,previousTrialId:previous?.id||null,inputHash,proofStateHash:p.stateHash,...evaluated};
  db.trials??=[];db.trials.push(trial);plan.status='completed';plan.trialId=trial.id;plan.completedAt=trial.at;
  for(const op of db.operations.filter(o=>o.payload?.planId===id&&['pending','approved'].includes(o.state))){op.state='superseded';audit(db,{kind:'operation.approval.superseded',operationId:op.id});}
  audit(db,{kind:'profit.wb.compared',trialId:trial.id,planId:id,evidenceHash:hash(trial),source});return trial;
 });}
 async status(store,plan,trial){try{const owner=await this.finance.identity(store);if(await this.advertising.identity(store)!==owner)return 'unavailable';return hash(this.stamp(store,plan,owner))===trial.proofStateHash?'current':'superseded';}catch{return 'unavailable';}}
}
