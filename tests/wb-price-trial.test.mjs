import test from 'node:test';import assert from 'node:assert/strict';
import {priceFixture} from './helpers/wb-price-fixture.mjs';
import {hash} from '../core/repository.mjs';
import {prepareWbTrialPrice,inspectWbTrialPrice,wbPriceTrialBlockers} from '../core/wb-price-trial.mjs';
import {buildWbPricePlan} from '../core/wb-price-plan.mjs';
import {createWbPriceSubmit} from '../adapters/wb-price-write.mjs';
import {wbPriceTrialFields,wbPriceTrialPanel,wbPriceTrialInput} from '../web/wb-price-trials.mjs';
import {experimentProgress} from '../web/experiment-progress.mjs';
import {wbPriceGate} from '../web/wb-price-controls.mjs';import {repeatDraft} from '../web/repeat-trials.mjs';
const base={sku:'123',lever:'price',baseline:'120',variant:'150',hypothesis:'Higher contribution',controls:'Same discounts, inventory, content and advertising',aStart:'2026-10-02',aEnd:'2026-10-08',bStart:'2026-10-10',bEnd:'2026-10-16',adBudget:100,maxLoss:200,currency:'CNY',acknowledged:true};
async function fixture(t,options){t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-01T10:00:00Z')});const f=await priceFixture(options);t.after(f.cleanup);return f;}
async function input(f,patch={}){return {...base,storeId:f.store.id,wbContextHash:hash(await f.context(f.store,f.product)),wbCostEvidence:'Synthetic per-size native-currency cost sources',wbCosts:f.input,...patch};}
const saved=async(f,p)=>(await f.ws.view()).trialPlans.find(x=>x.id===p.id);
async function execute(f,p,phase){const op=await prepareWbTrialPrice(f.ws,p.id,{phase});await f.ws.approveOperation(op.id,op.payloadHash);await f.ws.executeOperation(op.id);f.apply();return f.ws.reconcileWbPrice(op.id);}

test('CNY price plans freeze reviewed API identity, discounts, all-size costs and both protected prices without writing',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f));assert.equal(p.currency,'CNY');assert.equal(p.economics,null);assert.equal(p.wbPriceEconomics.discount,20);assert.equal(p.wbPriceEconomics.clubDiscount,5);assert.equal(p.wbPriceEconomics.baseline.rows[1].contribution,'27.08');assert.equal(p.wbPriceEconomics.variant.rows[1].contribution,'47.60');assert.equal(f.writes.length,0);assert.equal((await f.ws.view()).operations.length,0);assert.equal((await f.ws.view()).auditValid,true);
});
test('stale context, wrong currency, insufficient gap and below-floor or unreviewed costs cannot create a plan',async t=>{
 const f=await fixture(t),initial=await input(f);for(const patch of [{wbContextHash:'wrong'},{currency:'RUB'},{bStart:'2026-10-09'},{baseline:'80'},{variant:'80'},{baseline:'120.5'},{baseline:'00150'},{wbCostEvidence:''},{wbCosts:{...f.input,costsConfirmed:false}},{wbCosts:{...f.input,promotionReviewed:false}},{wbCosts:{...f.input,sizes:f.input.sizes.slice(1)}}])await assert.rejects(()=>f.ws.planTrial({...initial,...patch}));f.price.clubDiscount=10;await assert.rejects(()=>f.ws.planTrial(initial),/已变化/);assert.equal((await f.ws.view()).trialPlans.length,0);assert.equal(f.writes.length,0);
});
test('baseline and test each need approval, matching task readback and their permitted transition dates',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f));await assert.rejects(()=>prepareWbTrialPrice(f.ws,p.id,{phase:'variant'}),/基准/);const a=await execute(f,p,'baseline');assert.equal(a.payload.planId,p.id);assert.equal(a.payload.plan.rows[0].price,120);assert.equal((await saved(f,p)).wbPriceTrialState.baseline.matches,true);
 const early=await prepareWbTrialPrice(f.ws,p.id,{phase:'variant'});await f.ws.approveOperation(early.id,early.payloadHash);await assert.rejects(()=>f.ws.executeOperation(early.id),/对应期间/);assert.equal(f.writes.length,1);
 t.mock.timers.setTime(Date.parse('2026-10-09T10:00:00Z'));const b=await execute(f,p,'variant');assert.equal(b.payload.plan.rows[0].price,150);assert.equal(f.writes.length,2);assert.deepEqual(wbPriceTrialBlockers(await saved(f,p)),[]);assert.equal((await saved(f,p)).execution,'price_observed');
 t.mock.timers.setTime(Date.parse('2026-10-11T10:00:00Z'));await f.ws.reconcileWbPrice(b.id);assert.deepEqual(wbPriceTrialBlockers(await saved(f,p)),[]);assert.equal((await saved(f,p)).wbPriceTrialState.variant.observedAt,'2026-10-09T10:00:00.000Z');
});
test('matching baseline at plan creation is an observation without a redundant write',async t=>{
 const f=await fixture(t);f.price.sizes[0]={...f.price.sizes[0],price:120,discountedPrice:96,clubDiscountedPrice:91.2};const p=await f.ws.planTrial(await input(f));assert.equal(p.wbPriceTrialState.baseline.matches,true);assert.equal(p.wbPriceTrialState.baseline.originProven,false);await assert.rejects(()=>prepareWbTrialPrice(f.ws,p.id,{phase:'baseline'}),/相同/);assert.equal(f.writes.length,0);assert.throws(()=>buildWbPricePlan(p.wbPriceEconomics.context,{...f.input,price:'120'}),/相同/);
});
test('frozen discounts, account, sizes and cost hashes are rechecked at preparation and approval',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f));f.price.clubDiscount=6;await assert.rejects(()=>prepareWbTrialPrice(f.ws,p.id,{phase:'baseline'}),/已变化/);f.price.clubDiscount=5;const op=await prepareWbTrialPrice(f.ws,p.id,{phase:'baseline'});await f.ws.repo.mutate(db=>{db.trialPlans[0].wbPriceEconomics.evidence='Changed source';});await assert.rejects(()=>f.ws.approveOperation(op.id,op.payloadHash),/已变化/);assert.equal(f.writes.length,0);
});
test('cancelled plans revoke pending price approvals and unknown submissions cannot be cancelled or replayed',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f)),op=await prepareWbTrialPrice(f.ws,p.id,{phase:'baseline'});await f.ws.approveOperation(op.id,op.payloadHash);await f.ws.cancelTrialPlan(p.id);await assert.rejects(()=>f.ws.executeOperation(op.id));assert.equal(f.writes.length,0);
 const g=await priceFixture({onWrite:()=>{throw Error('Synthetic lost response');}});t.after(g.cleanup);const q=await g.ws.planTrial(await input(g)),lost=await prepareWbTrialPrice(g.ws,q.id,{phase:'baseline'});await g.ws.approveOperation(lost.id,lost.payloadHash);await assert.rejects(()=>g.ws.executeOperation(lost.id));await assert.rejects(()=>g.ws.cancelTrialPlan(q.id),/核对/);await assert.rejects(()=>g.ws.executeOperation(lost.id));assert.equal(g.writes.length,1);assert.equal((await saved(g,q)).wbPriceTrialState.baseline.state,'unknown');
});
test('queued submission checks the Moscow experiment window again immediately before dispatch',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f));await execute(f,p,'baseline');t.mock.timers.setTime(Date.parse('2026-10-16T20:59:00Z'));const op=await prepareWbTrialPrice(f.ws,p.id,{phase:'variant'});await f.ws.approveOperation(op.id,op.payloadHash);
 f.ws.wbPriceSubmit=createWbPriceSubmit({context:f.context,write:async(s,path,body,{beforeSend})=>{t.mock.timers.setTime(Date.parse('2026-10-16T21:01:00Z'));await beforeSend();assert.fail('must not dispatch after experiment end');}});
 await assert.rejects(()=>f.ws.executeOperation(op.id),e=>e.noWrite&&/对应期间/.test(e.message));assert.equal(f.writes.length,1);assert.equal((await saved(f,p)).wbPriceTrialState.variant.state,'blocked');
});
test('late price application and independently changed prices block a positive experiment verdict',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f));await execute(f,p,'baseline');t.mock.timers.setTime(Date.parse('2026-10-10T10:00:00Z'));await execute(f,p,'variant');assert.ok(wbPriceTrialBlockers(await saved(f,p)).some(x=>/完整价格样本/.test(x)));
 const standalone=await f.ws.prepareWbPrice(f.store.id,{...f.input,price:'170'});await f.ws.approveOperation(standalone.id,standalone.payloadHash);await f.ws.executeOperation(standalone.id);f.apply();await f.ws.reconcileWbPrice(standalone.id);assert.ok(wbPriceTrialBlockers(await saved(f,p)).some(x=>/未关联/.test(x)));await inspectWbTrialPrice(f.ws,p.id);assert.equal((await saved(f,p)).execution,'price_state_changed');
});
test('price test UI separates cost assumptions, native currency, phase gates and a new repeat transition day',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f)),op=await prepareWbTrialPrice(f.ws,p.id,{phase:'baseline'});const html=wbPriceTrialPanel(p);assert.match(html,/CNY/);assert.match(html,/data-phase="baseline"/);assert.match(html,/data-phase="variant"/);assert.doesNotMatch(wbPriceTrialFields(),/ checked/);assert.match(wbPriceGate(op,'test'),/基准价格/);const next=experimentProgress({...await f.ws.view(),operations:[]},p,'2026-10-01');assert.equal(next.kind,'wb_price_baseline');assert.equal(next.focus,'execution-'+p.id);
 const trial={id:'result',storeId:f.store.id,sku:p.sku,planId:p.id,source:'wb_reports_seller_costs',sourceStatus:'current',currency:'CNY',lever:'price',baseline:p.baseline,variant:p.variant,a:{days:7},b:{days:7,end:p.bEnd},result:{verdict:'repeat_candidate',after:1}},data={trialPlans:[{...p,status:'completed',trialId:trial.id}],trials:[trial]},draft=repeatDraft(data,trial,'2026-10-17');assert.equal((Date.parse(draft.bStart)-Date.parse(draft.aEnd))/86400000,2);assert.equal(draft.currency,'CNY');
});
test('observed baseline drift inside the period remains a blocker even after the price returns',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f));await execute(f,p,'baseline');t.mock.timers.setTime(Date.parse('2026-10-04T10:00:00Z'));f.price.sizes[0].price=130;await inspectWbTrialPrice(f.ws,p.id);assert.equal((await saved(f,p)).wbPriceTrialState.conditionBreak.phase,'baseline');f.price.sizes[0].price=120;await inspectWbTrialPrice(f.ws,p.id);t.mock.timers.setTime(Date.parse('2026-10-09T10:00:00Z'));await execute(f,p,'variant');assert.ok(wbPriceTrialBlockers(await saved(f,p)).some(x=>/恢复价格/.test(x)));
});
test('form serialization uses native per-size costs and explicit checks without currency conversion',()=>{
 const original=globalThis.FormData;globalThis.FormData=class extends Map{constructor(f){super(Object.entries(f.values));}};
 try{const f={dataset:{wbPriceTrial:'true'},values:{wbContextHash:'reviewed',wbCostEvidence:'Synthetic costs',wbFeePct:'10',wbMinMarginPct:'15',wbCostsConfirmed:'on',wbPromotionReviewed:'on'},querySelectorAll:()=>[{dataset:{wbTrialSize:'10'},value:'50'},{dataset:{wbTrialSize:'11'},value:'55'}]};const input=wbPriceTrialInput(f);assert.equal(input.wbContextHash,'reviewed');assert.deepEqual(input.wbCosts.sizes,[{chrtId:'10',fixedCost:'50'},{chrtId:'11',fixedCost:'55'}]);assert.equal(input.wbCosts.costsConfirmed,true);delete f.values.wbCostsConfirmed;assert.equal(wbPriceTrialInput(f).wbCosts.costsConfirmed,false);delete f.values.wbContextHash;assert.throws(()=>wbPriceTrialInput(f),/读取/);}finally{globalThis.FormData=original;}
});
test('changing original dates or price terms after approval invalidates the linked operation',async t=>{
 const f=await fixture(t),p=await f.ws.planTrial(await input(f)),op=await prepareWbTrialPrice(f.ws,p.id,{phase:'baseline'});await f.ws.approveOperation(op.id,op.payloadHash);await f.ws.repo.mutate(db=>{db.trialPlans[0].aEnd='2026-10-07';});await assert.rejects(()=>f.ws.executeOperation(op.id),/已变化/);assert.equal(f.writes.length,0);
});
