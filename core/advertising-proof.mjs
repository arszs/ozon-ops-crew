import {hash} from './repository.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function advertisingSnapshot(r){if(!r)return null;const {id,storeId,sku,from,to,days,state,evidenceHash,updatedAt,summary}=r;return structuredClone({id,storeId,sku,from,to,days,state,evidenceHash,updatedAt,summary});}
export function compareAdvertising(plan,readings,periods,currency){
 if(plan.storeId!=='ozon-live')return {proof:null,blockers:[]};
 const proof={version:1,a:null,b:null},blockers=[];
 for(const key of ['a','b']){
  const r=readings?.[key],label=key==='a'?'基准期':'测试期';proof[key]=advertisingSnapshot(r);
  if(!r){blockers.push(label+'尚未读取对应日期的广告 API 报表');continue;}
  if(r.storeId!==plan.storeId||r.sku!==plan.sku||r.from!==plan[key+'Start']||r.to!==plan[key+'End'])throw Error('广告证据必须对应原计划店铺、SKU 与完整日期');
  const s=r.summary,days=periods[key].days;
  const validTotal=finite(s?.observedSpend)&&['cpc','cpo'].every(k=>finite(s[k]?.spend))&&Math.abs(s.observedSpend-s.cpc.spend-s.cpo.spend)<0.005;
  const complete=r.state==='complete'&&r.evidenceHash&&r.days===days&&validTotal&&s?.currency==='RUB'&&['cpc','cpo'].every(k=>finite(s[k]?.spend)&&s[k]?.coveredDays===days);
  if(!complete)blockers.push(label+'广告 API 报表或日期覆盖不完整');
  const observed=s?.observedSpend;
  if(s?.currency==='RUB'&&finite(observed)&&currency==='RUB'&&observed>periods[key].ads+0.005)blockers.push(label+'卖家填报广告总额低于 API 已读取金额，请核对日期口径与费用范围');
  if(key==='b'&&s?.currency==='RUB'&&finite(observed)&&observed>plan.adBudget+0.005)blockers.push('API 已读取的测试期广告支出超过计划上限');
 }
 return {proof,blockers};
}
export function advertisingProofStatus(trial,readings=[]){
 if(trial.storeId!=='ozon-live')return 'current';
 if(trial.advertisingProof?.version!==1)return 'unverified_advertising';
 for(const key of ['a','b']){
  const p=trial[key],latest=readings.findLast(r=>r.storeId===trial.storeId&&r.sku===trial.sku&&r.from===p.start&&r.to===p.end);
  if(hash(advertisingSnapshot(latest))!==hash(trial.advertisingProof[key]??null))return latest?'superseded':'unavailable';
 }
 return 'current';
}
