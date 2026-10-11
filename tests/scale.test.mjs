import test from 'node:test';import assert from 'node:assert/strict';
import {evaluate,defaults} from '../web/engine.mjs';
import {portfolio} from '../web/planning.mjs';
import {runCycle} from '../web/autopilot.mjs';

// Scale proof: the decision layer must not be the bottleneck when one
// operator console serves a seller with thousands of SKUs.
function mulberry32(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function makeSku(i,rnd){
 const price=Math.round(200+rnd()*3000),dailyDemand=Math.round(rnd()*50)/10;
 return {id:`SKU-${i}`,name:`Bench ${i}`,scheme:i%2?'FBO':'FBS',price,purchaseCny:price/25,fx:12.5,
  inbound:80,fulfilment:120,packaging:20,returnReserve:30,commission:0.1,
  stock:Math.floor(rnd()*300),dailyDemand,incomingDays:10,incomingQty:100,
  storageDay:1.5,seasonFactor:1+rnd()*0.4,historyDays:Math.floor(rnd()*400),
  sales:[{revenue:price*dailyDemand,cost:price*dailyDemand*0.6,adCost:price*dailyDemand*0.15,settled:true}],
  unallocatedAds:0};
}
const N=2000; // matches validateProducts hard cap — the largest supported import
const rnd=mulberry32(42);
const products=Array.from({length:N},(_,i)=>makeSku(i,rnd));

test('2000-SKU portfolio decision cycle completes within budget',()=>{
 const t0=performance.now();
 const rows=portfolio(products,defaults);
 const ms=performance.now()-t0;
 assert.equal(rows.length,N);
 const valid=new Set(['test','stop','observe','protect','hold','clear']);
 for(const r of rows)assert.ok(valid.has(r.strategy),'unknown strategy '+r.strategy);
 assert.ok(ms<500,`portfolio took ${ms}ms`);
});

test('2000-SKU autopilot cycle with receipts completes within budget',()=>{
 const t0=performance.now();
 const cycle=runCycle({products,policy:defaults,storeBudget:200000,snapshotAt:Date.now()});
 const ms=performance.now()-t0;
 assert.equal(Object.keys(cycle.campaigns).length,N);
 assert.equal(cycle.receipts.length,N);
 assert.ok(ms<1000,`runCycle took ${ms}ms`);
});

test('engine decisions are deterministic for identical inputs',()=>{
 const p=makeSku(7,mulberry32(7));
 assert.deepEqual(evaluate(p,defaults),evaluate(structuredClone(p),defaults));
});
