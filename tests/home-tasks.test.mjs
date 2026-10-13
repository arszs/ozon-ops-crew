import test from 'node:test';
import assert from 'node:assert/strict';
import {homeTasks,homeTasksPanel} from '../web/home-tasks.mjs';
import {storeHome} from '../web/store-home.mjs';
import {stockFixture} from './helpers/wb-stock-fixture.mjs';
import {wbStockGate} from '../web/wb-stock-controls.mjs';
const stores=[{id:'wb',name:'WB store',mode:'live',marketplace:'wb'},{id:'ozon-live',name:'Ozon store',mode:'live',marketplace:'ozon'},{id:'demo',mode:'mock',marketplace:'wb'}];
const op=(id,state='pending',extra={})=>({id,storeId:'wb',kind:'wb_price',state,mode:'live',payload:{context:{accountRef:'owner',product:{sku:'123',offerId:'SELLER-123'},price:{nmID:'123'},title:'收纳盒'}},...extra});
const job=(id,state='review_gate',extra={})=>({id,sku:'SKU-'+id,title:'商品 '+id,storeId:'wb',marketplace:'wb',mode:'manual',synthetic:false,revision:2,state,...extra});
const data=(extra={})=>({stores,jobs:[],operations:[],trials:[],trialPlans:[],...extra});
test('home tasks isolate selected live store, synthetic imports and mock operations',()=>{
 const d=data({jobs:[job('real'),job('sample','review_gate',{synthetic:true}),job('mock','review_gate',{mode:'mock'}),job('foreign','review_gate',{storeId:'ozon-live'})],operations:[op('real-op'),op('foreign','unknown',{storeId:'ozon-live'}),op('mock-op','unknown',{mode:'mock'}),op('sample-pub','pending',{kind:'publish',payload:{jobId:'sample'}})]});
 assert.deepEqual(homeTasks(d,'wb').map(t=>t.id),['operation-real-op','job-real']);assert.deepEqual(homeTasks(d,'demo'),[]);assert.deepEqual(homeTasks(d,'missing'),[]);
});
test('unresolved submissions stay visible over newer plans; resolved history and replaced blocks disappear',()=>{
 const d=data({operations:[op('blocked','blocked'),op('unresolved','unknown'),op('new','pending')]});
 assert.deepEqual(homeTasks(d,'wb').map(t=>t.id),['operation-unresolved','operation-new']);
 d.operations[1].state='verified';d.operations[2].state='verified';assert.equal(homeTasks(d,'wb').length,0);
});
test('stock task identities retain warehouses and account ownership independently',()=>{
 const stock=(id,warehouse,account='owner',state='blocked')=>op(id,state,{kind:'wb_stock',payload:{context:{accountRef:account,product:{sku:'123'},warehouse:{id:warehouse,name:'仓库 '+warehouse}}}});
 const d=data({operations:[stock('a',1),stock('b',2),stock('c',1,'different'),stock('resolved',1,'owner','verified')]});
 assert.deepEqual(homeTasks(d,'wb').map(t=>t.operationId),['b','c']);assert.equal(homeTasks(d,'wb')[0].warehouse,'仓库 2');
});
test('current publication gate replaces job task; edited draft returns to its own stage without hiding unknown writes',()=>{
 const d=data({jobs:[job('j')],operations:[op('pub','pending',{kind:'publish',payload:{jobId:'j',revision:2}})]});
 assert.equal(homeTasks(d,'wb').length,1);assert.equal(homeTasks(d,'wb')[0].page,'gates');
 d.jobs[0].revision=3;d.jobs[0].state='needs_input';assert.deepEqual(homeTasks(d,'wb').map(t=>t.id),['job-j']);
 d.operations[0].state='unknown';assert.deepEqual(homeTasks(d,'wb').map(t=>t.id),['operation-pub']);
});
test('partial media requires checking before continuation, imported WB never claims on-sale success',()=>{
 const d=data({jobs:[job('j','imported')],operations:[op('media','partial',{kind:'wb_media',payload:{jobId:'j',revision:2}})]});
 assert.equal(homeTasks(d,'wb')[0].kind,'check');d.operations[0].state='partial_verified';
 assert.deepEqual(homeTasks(d,'wb').map(t=>t.id),['job-j']);assert.match(homeTasks(d,'wb')[0].detail,/开售状态仍需/);
 d.jobs[0].state='review_gate';d.jobs[0].gates={category:{revision:2}};assert.equal(homeTasks(d,'wb')[0].status,'准备发布确认');
});
test('both homes include store-scoped actionable tasks; overflow stays accessible and external text is escaped',()=>{
 const d=data({jobs:Array.from({length:7},(_,i)=>job(String(i),'needs_input',{title:i===0?'<img onerror=alert(1)>':'商品 '+i}))});
 const html=homeTasksPanel(d,'wb');assert.match(html,/其余 3 项待办/);assert.equal((html.match(/data-task-job=/g)||[]).length,7);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.ok(!/data-execute|data-approve/.test(html));
 assert.match(storeHome(d,null,'wb'),/店铺待办/);assert.match(storeHome(d,null,'ozon-live'),/已保存的流程中暂无待办/);assert.ok(!storeHome(d,null,'ozon-live').includes('data-task-job='));
});
test('persisted stock workflow links to its exact gate and leaves the home queue after independently verified result',async()=>{
 const f=await stockFixture();try{
  const op=await f.ws.prepareWbStock(f.store.id,f.input);let view=await f.ws.view();let t=homeTasks(view,f.store.id)[0];assert.equal(t.target,'operation-'+op.id);assert.ok(wbStockGate(op,f.store.name).includes('id="'+t.target+'"'));
  await f.ws.approveOperation(op.id,op.payloadHash);await f.ws.executeOperation(op.id);assert.equal(f.writes.length,1);assert.equal(homeTasks(await f.ws.view(),f.store.id)[0].kind,'check');
  f.apply();await f.ws.reconcileWbStock(op.id);assert.equal(homeTasks(await f.ws.view(),f.store.id).length,0);assert.equal(f.writes.length,1);
 }finally{await f.cleanup();}
});
