import test from 'node:test';import assert from 'node:assert/strict';import {runCycle} from '../web/autopilot.mjs';import {demoProducts} from '../web/demo.mjs';import {defaults} from '../web/engine.mjs';
const base={products:demoProducts,policy:defaults,storeBudget:100,now:100000,snapshotAt:100000};
test('automatic cycle stops losing SKU and allocates capped campaigns',()=>{const r=runCycle(base);assert.equal(r.campaigns['CN-001'].state,'paused');assert.equal(r.campaigns['CN-004'].state,'active');assert.ok(r.totalDailyBudget<=100);assert.ok(r.receipts.every(x=>x.externalWrite===false));});
test('repeated cycles are idempotent',()=>{const first=runCycle(base);const second=runCycle({...base,previous:first.campaigns});assert.ok(second.receipts.every(x=>x.status==='no_change'));});
test('stale input pauses all campaigns',()=>{const r=runCycle({...base,now:4000000});assert.equal(r.stale,true);assert.equal(r.totalDailyBudget,0);});
test('removed products are paused rather than orphaned',()=>{const first=runCycle(base);const r=runCycle({...base,products:demoProducts.slice(0,1),previous:first.campaigns});assert.equal(r.campaigns['CN-004'].state,'paused');assert.equal(r.receipts.find(x=>x.sku==='CN-004').reason,'removed_sku');});

test('autopilot allocation equals the marginal-return optimizer plan',async()=>{
 const {adPlan,evaluateRows}=await import('../web/planning.mjs');
 const rows=evaluateRows(demoProducts,defaults);
 const plan=adPlan(rows,demoProducts,defaults,{},100);
 const r=runCycle(base);
 for(const c of Object.values(r.campaigns)){
  const expected=plan.rows.find(x=>x.id===c.sku)?.spend??0;
  assert.equal(c.dailyBudget,c.state==='active'?expected:0);
 }
});

test('autopilot leaves unprofitable surplus unused instead of spending it',()=>{
 const r=runCycle({...base,storeBudget:100000});
 assert.ok(r.totalDailyBudget<100000);
 assert.ok(r.campaigns['CN-001'].dailyBudget===0);
});

test('cycle journal keeps summaries and diffs, not campaign snapshots',async()=>{
 const {summarizeCycle}=await import('../web/autopilot.mjs');
 const cycle=runCycle(base);
 const s=summarizeCycle(cycle);
 assert.ok(!('campaigns' in s)&&!('receipts' in s));
 assert.ok(Array.isArray(s.changes)&&Number.isInteger(s.active)&&Number.isInteger(s.paused));
 assert.ok(s.changes.every(c=>c.status!=='no_change'));
 assert.ok(JSON.stringify(s).length<JSON.stringify(cycle).length);
});
