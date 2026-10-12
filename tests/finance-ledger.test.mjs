import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {financeDay,financeRange,readFinanceDay,readFinanceTypes,summarizeFinanceDays} from '../adapters/ozon-finance.mjs';
import {FinanceService} from '../core/finance-service.mjs';
import {verifyAudit} from '../core/repository.mjs';
import {financeReading,financeResult,financePanel,planFinance} from '../web/finance-ledger.mjs';
const m=(amount,currency='RUB')=>({amount:String(amount),currency});
const date='2026-08-01',sku='1',store={id:'test',marketplace:'ozon',mode:'live'};
const a=()=>({accrual_id:1,date,unit_number:'PRIVATE-POSTING',total_amount:m(620),posting:{products:[{sku:1,commission:{sale_amount:m(1000),commission:m(-300),bonus:m(100),sale_commission:m(-400)},delivery:{total_accrued:m(-50),services:[{type_id:1,accrued:m(-50)}]}},{sku:2,delivery:{total_accrued:m(-30)}}]}});
const day=(d=date)=>({...financeDay([{...a(),date:d}],{sku,date:d}),pages:[{inputHash:'a',outputHash:'b',at:'2026-09-01'}],evidenceHash:'hash'});
test('ledger reconciles SKU components against store totals without duplicating subcomponents',()=>{
 const other={accrual_id:2,date,total_amount:m(-100),non_item_fee:{accrued:m(-100)}};
 const fee={accrual_id:3,date,total_amount:m(-20),item_fees:{fees:[{sku:1,fees:[{type_id:42,accrued:m(-20)}]}]}};
 const d=financeDay([a(),other,fee,a()],{sku,date});assert.deepEqual(d.totals,{RUB:630});assert.deepEqual(d.storeTotals,{RUB:500});assert.deepEqual(d.storeUnallocated,{RUB:-100});assert.equal(d.matchedAccruals,2);assert.equal(d.storeAccruals,3);
 assert.deepEqual(d.components,{sales:{RUB:1000},commission:{RUB:-300},delivery:{RUB:-50},'fee:42':{RUB:-20}});
 assert.ok(!JSON.stringify(d).includes('PRIVATE-POSTING'));
});
test('currency amounts remain separate; corrections preserve sign; invalid SKU stays unattributed',()=>{
 const entries=[{accrual_id:1,date,total_amount:m(-3,'CNY'),posting:{products:[{sku:1,commission:{sale_amount:m(-5,'CNY'),commission:m(2,'CNY')}}]}},{accrual_id:2,date,total_amount:m(-7),item_fees:{fees:[{sku:0,fees:[{type_id:4,accrued:m(-7)}]}]}}];
 const d=financeDay(entries,{sku,date});assert.deepEqual(d.totals,{CNY:-3});assert.deepEqual(d.storeUnallocated,{CNY:0,RUB:-7});
 const sum=summarizeFinanceDays([d,financeDay([],{sku,date:'2026-08-02'})]);assert.deepEqual(sum.dailyAverage,{CNY:-1.5});assert.equal(sum.profit,null);assert.equal(sum.settlementFinal,false);
});
test('changed duplicates, wrong date, unsafe identity and malformed money reject accounting',()=>{
 for(const entries of [[a(),{...a(),total_amount:m(10)}],[{...a(),date:'2026-08-02'}],[{...a(),accrual_id:Number.MAX_SAFE_INTEGER+1}],[{...a(),total_amount:m('')}],[{...a(),total_amount:m('1.001')}],[{...a(),posting:{}}]])assert.throws(()=>financeDay(entries,{sku,date}));
});
test('range uses complete Moscow days and rejects invalid, future or excessive requests',()=>{
 const now=new Date('2026-09-30T22:00:00Z');assert.equal(financeRange({sku,from:'2026-09-30',to:'2026-09-30'},now).days,1);
 for(const change of [{to:'2026-10-01'},{from:'2026-02-30'},{from:'2021-12-31'},{from:'2026-06-01'},{sku:'undefined'}])assert.throws(()=>financeRange({sku,from:date,to:'2026-09-30',...change},now));
});
test('daily pagination uses unchanged date, hashes each page, deduplicates and rejects loops',async()=>{
 let count=0;const d=await readFinanceDay(store,{sku,date},{call:async(_s,p,b)=>{assert.equal(p,'/v1/finance/accrual/by-day');assert.equal(b.date,date);assert.equal(b.last_id,count?'next':'');return {accruals:[a()],last_id:count++?'':'next'};}});
 assert.equal(d.pages.length,2);assert.equal(d.storeAccruals,1);assert.equal(d.totals.RUB,650);assert.equal(d.evidenceHash.length,64);
 await assert.rejects(()=>readFinanceDay(store,{sku,date},{call:async()=>({accruals:[a()],last_id:'same'})}),/cursor_loop/);
 await assert.rejects(()=>readFinanceDay(store,{sku,date},{call:async()=>({accruals:[]})}),/page_schema/);
});
async function setup(t,options={}){const dir=await mkdtemp(join(tmpdir(),'finance-ledger-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'finance.json');const service=new FinanceService(file,{account:async()=> 'owner',readTypes:async()=>({items:{},hash:'types',at:'2026-08-01'}),clock:()=>new Date('2026-10-01'),...options});await service.ready;return {service,file};}
test('failure preserves complete days; retry resumes and successful repeats do not refetch',async t=>{
 let fail=true;const dates=[];const {service,file}=await setup(t,{readDay:async(_s,q)=>{dates.push(q.date);if(q.date==='2026-08-02'&&fail)throw Error('timeout');return day(q.date);}});
 const input={sku,from:date,to:'2026-08-03'},r=await service.start(store,input);await service.wait(r.id);let view=(await service.list([store]))[0];assert.equal(view.state,'error');assert.equal(view.loadedDays,1);assert.equal(view.totalDays,3);
 fail=false;const resumed=await service.start(store,input);assert.equal(resumed.id,r.id);await service.wait(r.id);view=(await service.list([store]))[0];assert.equal(view.state,'complete');assert.equal(view.loadedDays,3);assert.equal(view.summary.totals.RUB,1950);assert.equal(view.owner,undefined);assert.equal(view.days,undefined);
 assert.deepEqual(dates,[date,'2026-08-02','2026-08-02','2026-08-03']);assert.equal((await service.start(store,input)).id,r.id);assert.equal(dates.length,4);
 const db=JSON.parse(await readFile(file,'utf8'));assert.equal(verifyAudit(db.audit),true);assert.ok(!JSON.stringify(db).includes('PRIVATE-POSTING'));
 const reloaded=new FinanceService(file,{account:async()=> 'owner'});await reloaded.ready;assert.equal((await reloaded.list([store]))[0].state,'complete');
});
test('concurrent duplicate requests share one worker and queued different reads run serially',async t=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let reads=0;const {service}=await setup(t,{readDay:async(_s,q)=>{reads++;entered();if(reads===1)await gate;return day(q.date);}});
 const input={sku,from:date,to:date};const [a,b]=await Promise.all([service.start(store,input),service.start(store,input)]);assert.equal(a.id,b.id);const c=await service.start(store,{...input,sku:'2'});assert.equal((await service.list([store])).find(r=>r.id===c.id).state,'queued');await started;assert.equal(reads,1);release();await service.wait(c.id);assert.equal(reads,2);
});
test('account changes prevent committing fetched data and conceal records under another owner',async t=>{
 let owner='a';const {service}=await setup(t,{account:async()=>owner,readDay:async()=>{owner='b';return day();}});
 const r=await service.start(store,{sku,from:date,to:date});await service.wait(r.id);assert.deepEqual(await service.list([store]),[]);owner='a';const saved=(await service.list([store]))[0];assert.equal(saved.state,'error');assert.equal(saved.loadedDays,0);
 assert.deepEqual(await service.list([{...store,id:'other'}]),[]);
});
test('restart marks unfinished reads interrupted, retains days and resumes only on request',async t=>{
 const {service,file}=await setup(t);await service.repo.mutate(db=>db.financeRuns.push({id:'old',key:'x',storeId:store.id,owner:'owner',sku,from:date,to:'2026-08-02',totalDays:2,state:'running',days:[day()]}));
 let reads=0;const second=new FinanceService(file,{account:async()=> 'owner',readDay:async()=>{reads++;return day();}});await second.ready;const r=(await second.list([store]))[0];assert.equal(r.state,'interrupted');assert.equal(r.loadedDays,1);assert.equal(reads,0);
});
test('UI separates partial accounting from profit and scopes readings by store, SKU and period',()=>{
 const d={financeReadings:[{id:'a',storeId:'a',sku,from:date,to:date,state:'complete'},{id:'b',storeId:'b',sku,from:date,to:date,state:'complete'}]};assert.equal(financeReading(d,'a',sku,date,date).id,'a');assert.equal(financeReading(d,'a','2',date,date),undefined);
 const html=financeResult({state:'error',from:date,to:'2026-08-02',loadedDays:1,totalDays:2,error:'<error>',summary:summarizeFinanceDays([day()])});assert.match(html,/部分日期，不能比较结果/);assert.match(html,/&lt;error&gt;/);assert.match(html,/不是此商品成本/);assert.doesNotMatch(html,/日均/);
 assert.equal(financePanel({}, {...store,mode:'mock'},sku,{}),'');assert.equal(planFinance({stores:[{...store,marketplace:'wb'}]},{storeId:store.id}),'');
});

test('expense dictionary preserves official names and a dictionary failure does not discard amounts',async t=>{
 const types=await readFinanceTypes(store,{call:async()=>({accrual_types:[{id:1,name:'Acquiring',description:'Эквайринг'}]})});assert.equal(types.items[1].description,'Эквайринг');assert.equal(types.hash.length,64);
 await assert.rejects(()=>readFinanceTypes(store,{call:async()=>({accrual_types:[{id:1,name:'Acquiring'}]})}),/type_schema/);
 const {service}=await setup(t,{readDay:async()=>day(),readTypes:async()=>{throw Error('dictionary_unavailable');}});const r=await service.start(store,{sku,from:date,to:date});await service.wait(r.id);const saved=(await service.list([store]))[0];assert.equal(saved.state,'complete');assert.equal(saved.typeError,'dictionary_unavailable');assert.equal(saved.summary.totals.RUB,650);
});
