import test from 'node:test';
import assert from 'node:assert/strict';
import {makeExperiment,comparePeriods} from '../web/experiments.mjs';
import {demoProducts} from '../web/demo.mjs';
const p=demoProducts[0],input={lever:'price',baseline:p.price,target:2600,days:14,budget:3000};
test('one planned experiment per SKU and price must cover costs',()=>{const e=makeExperiment(p,input);assert.throws(()=>makeExperiment(p,input,[e]));assert.throws(()=>makeExperiment(p,{...input,target:1}));assert.throws(()=>makeExperiment(p,{...input,baseline:2000}));});
test('profit comparison includes organic revenue, all costs and advertising, normalized by days',()=>{const r=comparePeriods({days:7,orders:35,revenue:10000,cost:6000,ads:500},{days:14,orders:70,revenue:25000,cost:18000,ads:2800});assert.equal(r.before,500);assert.equal(r.after,300);assert.equal(r.delta,-200);assert.equal(r.verdict,'Не улучшает прибыль');});
test('small samples cannot be declared winners and invalid periods fail',()=>{const a={days:7,orders:2,revenue:1000,cost:500,ads:100};assert.equal(comparePeriods(a,{...a,revenue:2000}).verdict,'Мало данных');assert.throws(()=>comparePeriods(a,{...a,days:0}));assert.throws(()=>comparePeriods(a,{...a,ads:NaN}));});

test('dashboard totals include ad-only spend and mark unsettled revenue',async()=>{
 const {dashboardSummary}=await import('../web/experiments.mjs');
 const s=dashboardSummary([{...p,sales:[{revenue:1000,cost:500,adCost:100,settled:true},{revenue:800,cost:400,adCost:50,settled:false}],unallocatedAds:25}],[]);
 assert.equal(s.revenue,1000);assert.equal(s.cost,500);assert.equal(s.ads,175);assert.equal(s.profit,325);assert.equal(s.pending,true);
});
