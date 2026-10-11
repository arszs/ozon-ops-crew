import test from 'node:test';import assert from 'node:assert/strict';
import {stressPortfolio} from '../web/stress.mjs';
import {validateProducts,portfolio} from '../web/planning.mjs';
import {defaults} from '../web/engine.mjs';

test('stress portfolio passes the same validation as user imports',()=>{
 const items=stressPortfolio(500);
 assert.equal(items.length,500);
 assert.doesNotThrow(()=>validateProducts(items));
});

test('stress portfolio generation is deterministic',()=>{
 assert.deepEqual(stressPortfolio(50),stressPortfolio(50));
 assert.notDeepEqual(stressPortfolio(50),stressPortfolio(50,123));
});

test('decisions over the 500-SKU stress portfolio complete quickly',()=>{
 const items=validateProducts(stressPortfolio(500));
 const t0=performance.now();
 const rows=portfolio(items,defaults,{},20000,false);
 assert.equal(rows.length,500);
 assert.ok(performance.now()-t0<300);
 assert.ok(rows.some(r=>r.strategy==='stop')&&rows.some(r=>r.strategy==='clear'));
});
