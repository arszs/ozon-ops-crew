import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash,verifyAudit} from '../core/repository.mjs';
import {FinanceService} from '../core/finance-service.mjs';
import {Workspace} from '../core/workspace.mjs';
import {reconcileFinance,evaluateLedgerTrial,ledgerTrialStatus} from '../core/finance-reconciliation.mjs';
import {financeDay} from '../adapters/ozon-finance.mjs';
import {financeCostsForm,ledgerComparisonForm} from '../web/finance-costs.mjs';
import {sellerDecisions} from '../web/decisions.mjs';

const store={id:'ozon-live',mode:'live',marketplace:'ozon'},m=(amount,currency='RUB')=>({amount:String(amount),currency});
const plan={id:'plan',storeId:store.id,sku:'1',lever:'ads',baseline:'A',variant:'B',aStart:'2026-08-01',aEnd:'2026-08-07',bStart:'2026-08-08',bEnd:'2026-08-14',at:'2026-07-20T10:00:00Z',adBudget:200,maxLoss:100};
const run=(extra={})=>({id:'run',storeId:store.id,sku:'1',state:'complete',from:plan.aStart,to:plan.aEnd,totalDays:7,loadedDays:7,evidenceHash:'report',summary:{totals:{RUB:560},storeUnallocated:{RUB:-210}},...extra});
const costs=(extra={})=>({currency:'RUB',reportHash:'report',revision:0,cogs:'140',tax:'14',external:'21',sharedNet:'-35',adSpend:'100',orderCount:'40',evidence:'Supplier costs, tax ledger and allocated store fees',costsComplete:true,allocationReviewed:true,periodReviewed:true,...extra});
const proof=()=>{const a=run(),b=run({id:'b',from:plan.bStart,to:plan.bEnd,summary:{totals:{RUB:700},storeUnallocated:{RUB:-210}}});return {a:{report:a,cost:{...reconcileFinance(a,costs()),id:'ca',revision:1}},b:{report:b,cost:{...reconcileFinance(b,costs()),id:'cb',revision:1}}};};
const confirmations={comparable:true,executionConfirmed:true,evidence:'Matched inventory and promotions; actual execution verified'};
test('actual contribution uses API balance and signed shared allocation without deducting advertising twice',()=>{
 const c=reconcileFinance(run(),costs({netAccrued:999999,result:{contribution:999999}}));assert.equal(c.netAccrued,560);assert.equal(c.result.contribution,350);assert.equal(c.result.dailyContribution,50);assert.equal(c.result.reviewed,true);assert.equal(c.costs.adSpend,100);assert.equal(c.result.platformCostsDeductedAgain,false);
 assert.equal(reconcileFinance(run(),costs({sharedNet:10})).result.contribution,395);assert.equal(reconcileFinance(run(),costs({cogs:-140})).result.contribution,630);assert.throws(()=>reconcileFinance(run(),costs({adSpend:-1})));
});
test('unknown, coercible, overprecise costs and wrong currency/hash cannot become confirmed zero',()=>{
 for(const v of ['',null,false,[],{},'1.001',Infinity])assert.throws(()=>reconcileFinance(run(),costs({cogs:v})));
 for(const change of [{reportHash:'old'},{currency:'CNY'},{orderCount:1.5},{evidence:''}])assert.throws(()=>reconcileFinance(run(),costs(change)));
 assert.throws(()=>reconcileFinance(run({state:'error'}),costs()));assert.throws(()=>reconcileFinance(run({loadedDays:6}),costs()));
 const draft=reconcileFinance(run(),costs({costsComplete:false}));assert.equal(draft.result.reviewed,false);
});
test('CNY amounts retain their denomination without procurement or implicit conversion',()=>{
 const r=run({summary:{totals:{CNY:560},storeUnallocated:{CNY:-210}}}),c=reconcileFinance(r,costs({currency:'CNY'}));assert.equal(c.currency,'CNY');assert.equal(c.result.contribution,350);assert.equal(c.fx,undefined);
});
test('comparison derives result from frozen records and remains a non-causal repeat candidate',()=>{
 const p=proof(),r=evaluateLedgerTrial(plan,p,confirmations);assert.equal(r.result.before,50);assert.equal(r.result.after,70);assert.equal(r.result.delta,20);assert.equal(r.result.verdict,'repeat_candidate');assert.equal(r.result.causal,false);assert.equal(r.basis,'accrual_date');assert.equal(r.a.reportHash,'report');p.a.cost.costs.cogs=999;assert.equal(r.provenance.a.cost.costs.cogs,140);
});
test('incomplete reconciliation, execution, comparability, late plan, sample and budgets block conclusions',()=>{
 for(const mutate of [p=>p.a.cost.result.reviewed=false,p=>p.a.cost.orderCount=1,p=>p.b.cost.costs.adSpend=201,p=>p.b.cost.result.contribution=-101,p=>p.a.report.summary.totals.CNY=5]){const p=proof();mutate(p);assert.equal(evaluateLedgerTrial(plan,p,confirmations).result.verdict,'insufficient');}
 for(const c of [{comparable:false},{executionConfirmed:false}])assert.equal(evaluateLedgerTrial(plan,proof(),{...confirmations,...c}).result.verdict,'insufficient');
 assert.equal(evaluateLedgerTrial({...plan,at:'2026-08-08'},proof(),confirmations).result.verdict,'insufficient');
 const p=proof();for(const v of [p.a,p.b])v.cost.currency='CNY';assert.ok(evaluateLedgerTrial(plan,p,confirmations).result.blockers.some(x=>x.includes('RUB')));
});
test('cross-store, SKU, dates, currency and stale report references cannot be compared',()=>{
 for(const mutate of [p=>p.b.report.storeId='other',p=>p.b.report.sku='2',p=>p.b.report.from=plan.aStart,p=>p.b.cost.currency='CNY',p=>p.b.cost.reportHash='old']){const p=proof();mutate(p);assert.throws(()=>evaluateLedgerTrial(plan,p,confirmations));}
});
async function setup(t){
 const dir=await mkdtemp(join(tmpdir(),'finance-costs-'));t.after(()=>rm(dir,{recursive:true,force:true}));let owner='owner';
 const finance=new FinanceService(join(dir,'finance.json'),{account:async()=>owner,clock:()=>new Date('2026-10-01'),readTypes:async()=>({items:{},hash:'types'}),readDay:async(_s,{sku,date})=>{
  const amount=date<plan.bStart?80:100,accrual_id=Number(date.replaceAll('-',''));
  const d=financeDay([{date,accrual_id,total_amount:m(amount),posting:{products:[{sku:Number(sku),commission:{sale_amount:m(amount+20),commission:m(-20)}}]}}],{sku,date});return {...d,pages:[{inputHash:'i',outputHash:'o'}],evidenceHash:hash(d)};
 }});await finance.ready;const runs={};
 for(const k of ['a','b']){const r=await finance.start(store,{sku:'1',from:plan[k+'Start'],to:plan[k+'End']});await finance.wait(r.id);runs[k]=(await finance.list([store])).find(x=>x.id===r.id);}
 return {finance,runs,dir,owner:v=>owner=v};
}
test('cost versions are immutable, revisions serialize updates, and account changes conceal evidence',async t=>{
 const {finance,runs,owner}=await setup(t),r=runs.a;
 const c=await finance.reconcile(store,r.id,costs({reportHash:r.evidenceHash}));assert.equal(c.revision,1);
 const next={...costs({reportHash:r.evidenceHash,revision:1,cogs:150})};const attempts=await Promise.allSettled([finance.reconcile(store,r.id,next),finance.reconcile(store,r.id,next)]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 const v=(await finance.list([store])).find(x=>x.id===r.id);assert.equal(v.reconciliations.length,2);assert.equal(v.reconciliations[0].costs.cogs,140);assert.equal(v.reconciliations[1].previousHash,hash(c));assert.equal(verifyAudit((await finance.repo.read()).audit),true);
 owner('other');await assert.rejects(()=>finance.reconcile(store,r.id,costs({reportHash:r.evidenceHash,revision:2})));assert.deepEqual(await finance.list([store]),[]);
});
test('new report and cost versions invalidate prior comparison evidence and dashboard decisions',async t=>{
 const {finance,runs}=await setup(t);const ca=await finance.reconcile(store,runs.a.id,costs({reportHash:runs.a.evidenceHash})),cb=await finance.reconcile(store,runs.b.id,costs({reportHash:runs.b.evidenceHash}));
 const refs={aReportId:runs.a.id,aCostId:ca.id,bReportId:runs.b.id,bCostId:cb.id},e=await finance.comparisonEvidence(store,refs),trial={...evaluateLedgerTrial(plan,e,confirmations),storeId:store.id,id:'t',planId:plan.id,mode:'live',at:plan.at};assert.equal(ledgerTrialStatus(trial,await finance.list([store])),'current');
 await finance.reconcile(store,runs.b.id,costs({reportHash:runs.b.evidenceHash,revision:1,cogs:200}));assert.equal(ledgerTrialStatus(trial,await finance.list([store])),'superseded');await assert.rejects(()=>finance.comparisonEvidence(store,refs));
 const decision=sellerDecisions({trials:[{...trial,sourceStatus:'superseded'}]})[0];assert.equal(decision.kind,'evidence');assert.equal(decision.target,'plan-'+plan.id);
 const refreshed=await finance.start(store,{sku:'1',from:plan.aStart,to:plan.aEnd,refresh:true});await finance.wait(refreshed.id);await assert.rejects(()=>finance.reconcile(store,runs.a.id,costs({reportHash:runs.a.evidenceHash,revision:1})));assert.equal(ledgerTrialStatus(trial,[]),'unavailable');
});
test('workspace records and revisions retain exact API proof, close plans and supersede unused price approvals',async t=>{
 const {finance,runs,dir}=await setup(t),ws=new Workspace(join(dir,'ws.json'));await ws.init();const p=await ws.planTrial({...plan,hypothesis:'candidate',controls:'same',acknowledged:true});await ws.repo.mutate(db=>{db.trialPlans[0].at=plan.at;db.operations.push({id:'unused',state:'approved',payload:{planId:p.id}});});
 const ca=await finance.reconcile(store,runs.a.id,costs({reportHash:runs.a.evidenceHash})),cb=await finance.reconcile(store,runs.b.id,costs({reportHash:runs.b.evidenceHash}));
 const input={aReportId:runs.a.id,aCostId:ca.id,bReportId:runs.b.id,bCostId:cb.id,...confirmations};const t1=await ws.recordLedgerTrial(p.id,input,finance);assert.equal(t1.result.before,50);assert.equal(t1.result.after,70);assert.equal((await ws.view()).trialPlans[0].status,'completed');assert.equal((await ws.view()).operations[0].state,'superseded');assert.equal((await ws.recordLedgerTrial(p.id,input,finance)).id,t1.id);
 const revised=await finance.reconcile(store,runs.b.id,costs({reportHash:runs.b.evidenceHash,revision:1,cogs:350}));const t2=await ws.recordLedgerTrial(p.id,{...input,bCostId:revised.id},finance);assert.equal(t2.revision,2);assert.equal(t2.previousTrialId,t1.id);assert.equal(t2.result.verdict,'no_improvement');assert.equal((await ws.view()).trials.length,2);assert.equal((await ws.view()).auditValid,true);
 const db=await ws.repo.read();assert.equal(db.trials[0].provenance.b.cost.costs.cogs,140);
});
test('unresolved writes and cancelled plans cannot be completed using ledger results',async t=>{
 const {finance,dir}=await setup(t),ws=new Workspace(join(dir,'ws.json'));await ws.init();const p=await ws.planTrial({...plan,hypothesis:'candidate',controls:'same',acknowledged:true});await ws.repo.mutate(db=>db.operations.push({id:'uncertain',state:'unknown',payload:{planId:p.id}}));await assert.rejects(()=>ws.recordLedgerTrial(p.id,{},finance),/平台操作/);await ws.repo.mutate(db=>{db.operations=[];db.trialPlans[0].status='cancelled';});await assert.rejects(()=>ws.recordLedgerTrial(p.id,{},finance),/未取消/);
});
test('cost UI leaves unknowns blank, contextualizes totals and isolates duplicate period form IDs',()=>{
 const r=run();const html=financeCostsForm(r);assert.match(html,/value=""/);assert.match(html,/不是单件假设/);assert.match(html,/仅检查限额，不再扣减/);assert.notEqual(financeCostsForm(r,'RUB','p1'),financeCostsForm(r,'RUB','p2'));
 const p=proof();p.a.report.reconciliations=[p.a.cost];p.b.report.reconciliations=[p.b.cost];const form=ledgerComparisonForm(plan,p.a.report,p.b.report);assert.match(form,/aReportId/);assert.match(form,/aCostId/);assert.match(form,/不能证明/);
});
