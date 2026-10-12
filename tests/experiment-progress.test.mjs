import test from 'node:test';import assert from 'node:assert/strict';
import {experimentProgress,progressCard} from '../web/experiment-progress.mjs';
import {sellerDecisions} from '../web/decisions.mjs';
import {trialsPage} from '../web/profit-trials.mjs';
const p={id:'p',storeId:'ozon-live',mode:'live',sku:'101',status:'planned',lever:'ads',baseline:'on',variant:'off',aStart:'2026-09-01',aEnd:'2026-09-07',bStart:'2026-09-08',bEnd:'2026-09-14'};
const store={id:p.storeId,mode:'live',marketplace:'ozon'};
const db=(patch={})=>({stores:[store],trialPlans:[p],operations:[],trials:[],financeReadings:[],...patch});
const report=(k,patch={})=>({id:k,storeId:p.storeId,sku:p.sku,from:p[k+'Start'],to:p[k+'End'],state:'complete',evidenceHash:k,summary:{totals:{RUB:1000}},reconciliations:[{id:'cost-'+k,reportId:k,currency:'RUB',reportHash:k,result:{reviewed:true}}],...patch});
const step=(d,plan=p,today='2026-09-15')=>experimentProgress(d,plan,today);
test('guide follows exact reports, latest cost versions and shared currencies before comparison',()=>{
 assert.equal(step(db()).focus,'finance-p-a');
 const a=report('a'),b=report('b');assert.equal(step(db({financeReadings:[a]})).focus,'finance-p-b');
 assert.equal(step(db({financeReadings:[a,b]})).kind,'compare');
 const changed={...b,reconciliations:[...b.reconciliations,{reportId:'b',currency:'RUB',reportHash:'b',result:{reviewed:false}}]};assert.equal(step(db({financeReadings:[a,changed]})).kind,'cost_review');assert.equal(step(db({financeReadings:[a,changed]})).focus,'costs-b-p-b');
 assert.equal(step(db({financeReadings:[a,{...b,reconciliations:[{...b.reconciliations[0],currency:'CNY'}]}]})).kind,'currency_review');
});
test('different store, SKU, period and superseded report never satisfy the guide',()=>{
 for(const patch of [{storeId:'other'},{sku:'999'},{to:'2026-09-06'}])assert.equal(step(db({financeReadings:[report('a',patch)]})).kind,'finance_read');
 const a=report('a');assert.equal(step(db({financeReadings:[a,report('a',{id:'new',state:'error'})]})).kind,'finance_read');
 assert.equal(step(db({financeReadings:[report('a',{evidenceHash:'new'})]})).kind,'cost_review');
});
test('unresolved operations take precedence over finance and stale observed plan labels',()=>{
 for(const kind of ['price','cpo_disable'])for(const state of ['executing','submitted','unknown']){
 const d=db({operations:[{id:'op',kind,state,storeId:p.storeId,payload:{planId:p.id}}]});const s=step(d,{...p,execution:'price_observed'});assert.equal(s.page,'gates');assert.equal(s.target,'operation-op');assert.equal(s.stages[1].status,'待核对平台');
 }
 const d=db({operations:[{id:'foreign',kind:'price',state:'unknown',storeId:'other',payload:{planId:p.id}}]});assert.equal(step(d).kind,'finance_read');
});
test('test date boundaries do not imply execution or completion',()=>{
 const d=db({financeReadings:[report('a')]});assert.equal(step(d,p,'2026-09-07').kind,'scheduled');assert.equal(step(d,p,'2026-09-08').kind,'planned');assert.equal(step(d,{...p,execution:'price_observed'},'2026-09-14').kind,'observe');assert.equal(step(d,p,'2026-09-15').kind,'finance_read');
 const manual=db({stores:[{...store,marketplace:'wb'}]});assert.equal(step(manual).kind,'due');
});
test('expired approval routes to re-preparation; active approval links the exact operation',()=>{
 const op={id:'op',kind:'price',state:'approved',storeId:p.storeId,payload:{planId:p.id,context:{checkedAt:new Date().toISOString()}}};const d=db({operations:[op]});assert.equal(step(d,p,'2026-09-10').target,'operation-op');op.payload.context.checkedAt='2020-01-01T00:00:00Z';assert.equal(step(d,p,'2026-09-10').kind,'prepare_again');
});
test('home and plan share next action; collapsed plan retains finance and execution destinations',()=>{
 const d=db({financeReadings:[report('a')]});const next=step(d);assert.equal(sellerDecisions(d,'2026-09-15')[0].focus,next.focus);
 // Full page fixture without reports avoids irrelevant financial rendering assumptions.
 const h=trialsPage(db());for(const id of ['execution-p','finance-p','finance-p-a','finance-p-b','comparison-p'])assert.ok(h.includes('id="'+id+'"'),id);
 assert.match(h,/<details class="plan-details" id="plan-details-p">/);assert.match(progressCard(db(),{...p,id:'<bad>'}),/plan-&lt;bad&gt;|execution-&lt;bad&gt;|finance-&lt;bad&gt;/);assert.ok(!progressCard(db(),{...p,id:'<bad>'}).includes('id="<bad>'));
});
