import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FinanceService} from '../core/finance-service.mjs';import {financeDay} from '../adapters/ozon-finance.mjs';import {strategyFinance} from '../core/strategy-finance.mjs';
test('actual financial service summaries support a balanced store contribution without losing whole-store totals',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'strategy-finance-integration-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store={id:'store',mode:'live',marketplace:'ozon'},amount=n=>({currency:'RUB',amount:String(n)}),account=async()=> 'owner';
 const readDay=async(s,{sku,date})=>({...financeDay([{accrual_id:1,date,total_amount:amount(90),posting:{products:[{sku:123,commission:{sale_amount:amount(100),commission:amount(-10)}}]}}],{sku,date}),pages:[{inputHash:'request',outputHash:'response',at:'2026-10-23T20:00:00Z'}],evidenceHash:'day-hash'});
 const service=new FinanceService(join(dir,'finance.json'),{account,readDay,readTypes:async()=>({items:{}}),clock:()=>new Date('2026-10-24T00:00:00Z')});await service.ready;
 await service.start(store,{sku:'123',from:'2026-10-22',to:'2026-10-22'});await service.queue;let [run]=await service.list([store]);assert.equal(run.state,'complete');assert.deepEqual(run.summary.storeTotals,{RUB:90});
 await service.reconcile(store,run.id,{reportHash:run.evidenceHash,revision:0,currency:'RUB',cogs:30,tax:0,external:5,sharedNet:0,adSpend:0,orderCount:1,evidence:'Reviewed invoice and complete period costs; no unallocated amounts',costsComplete:true,allocationReviewed:true,periodReviewed:true});
 const r=strategyFinance([{sku:'123'}],await service.list([store]));assert.equal(r.complete,true);assert.deepEqual(r.storeProfit.totals,{RUB:55});assert.equal(r.perSku['123'].RUB.profit,55);
});
