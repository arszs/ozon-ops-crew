import test from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';
import {stockFixture} from './helpers/wb-stock-fixture.mjs';
import {buildWbStockPlan,createWbStockSubmit} from '../adapters/wb-stock-write.mjs';
import {createWbRead} from '../adapters/wb-api.mjs';import {Workspace} from '../core/workspace.mjs';
import {wbStockForm,wbStockGate,wbJobStockPanel} from '../web/wb-stock-controls.mjs';
import {wbInventoryPanel} from '../web/wb-inventory.mjs';import {skuFocus} from '../web/sku-focus.mjs';
async function fixture(t,o){const f=await stockFixture(o);t.after(f.cleanup);return f;}
async function plan(f,input=f.input){return f.ws.prepareWbStock(f.store.id,input);}
async function approved(f,input=f.input){const p=await plan(f,input);return f.ws.approveOperation(p.id,p.payloadHash);}
async function saved(f,id){return (await f.ws.view()).operations.find(o=>o.id===id);}

test('stock plan is an absolute quantity for selected sizes only; unknown is not zero',async t=>{
 const f=await fixture(t),c=await f.context(f.store,f.product,'50'),p=buildWbStockPlan(c,{...f.input,sizes:[{chrtId:'10',amount:'0'}]});
 assert.deepEqual(p.apiBody,{stocks:[{chrtId:10,amount:0}]});assert.equal(p.rows[0].before,8);
 for(const input of [{availableConfirmed:false},{sizes:[]},{sizes:[{chrtId:'99',amount:'1'}]},{sizes:[{chrtId:'10',amount:''}]},{sizes:[{chrtId:'10',amount:'1.5'}]},{sizes:[{chrtId:'10',amount:'100001'}]},{sizes:[{chrtId:'10',amount:'8'}]},{sizes:[{chrtId:'10',amount:'1'},{chrtId:'10',amount:'2'}]}])assert.throws(()=>buildWbStockPlan(c,{...f.input,...input}));
 const other=await f.context(f.store,f.product,'60'),unknown={...f.input,sizes:[{chrtId:'11',amount:'0'}]};assert.throws(()=>buildWbStockPlan(other,unknown));assert.equal(buildWbStockPlan(other,{...unknown,unknownConfirmed:true}).rows[0].before,null);
});

test('fresh warehouse, card identity and size checks precede any stock write',async t=>{
 const f=await fixture(t);for(const flag of ['isDeleting','isProcessing']){f.warehouses[0][flag]=true;await assert.rejects(()=>plan(f),/仓库/);f.warehouses[0][flag]=false;}
 await assert.rejects(()=>plan(f,{...f.input,warehouseId:'999'}));f.card.nmID=999;await assert.rejects(()=>plan(f));assert.equal(f.writes.length,0);
});

test('approval, one write, readback and audit keep all unselected sizes and warehouses intact',async t=>{
 const f=await fixture(t),op=await plan(f);await assert.rejects(()=>f.ws.executeOperation(op.id));await assert.rejects(()=>f.ws.approveOperation(op.id,'wrong'));await f.ws.approveOperation(op.id,op.payloadHash);
 await f.ws.executeOperation(op.id);assert.equal((await saved(f,op.id)).state,'submitted');await f.ws.executeOperation(op.id);assert.equal(f.writes.length,1);
 f.apply();const r=await f.ws.reconcileWbStock(op.id);assert.equal(r.state,'verified');assert.equal(r.observation.originProven,false);assert.equal(f.stock.get(50)[1].amount,4);assert.equal(f.stock.get(60)[0].amount,3);assert.equal((await f.ws.view()).auditValid,true);
});

test('selected stock drift prevents stale absolute overwrite; unselected stock drift is allowed',async t=>{
 const f=await fixture(t),op=await approved(f);f.stock.get(50)[0].amount=7;await assert.rejects(()=>f.ws.executeOperation(op.id),e=>e.noWrite);assert.equal(f.writes.length,0);assert.equal((await saved(f,op.id)).state,'blocked');
 const next=await approved(f);f.stock.get(50)[1].amount=3;await f.ws.executeOperation(next.id);assert.equal(f.writes.length,1);f.apply();assert.equal(f.stock.get(50)[1].amount,3);
});

test('new plans supersede pending versions and duplicate clicks reserve one write',async t=>{
 const f=await fixture(t),old=await approved(f),op=await approved(f,{...f.input,sizes:[{chrtId:'10',amount:'15'}]});assert.equal((await saved(f,old.id)).state,'superseded');await assert.rejects(()=>f.ws.executeOperation(old.id));
 await Promise.allSettled([f.ws.executeOperation(op.id),f.ws.executeOperation(op.id)]);assert.equal(f.writes.length,1);await assert.rejects(()=>plan(f));
});

test('lost stock response is not replayed after restart, and matching observation is not causal proof',async t=>{
 const f=await fixture(t,{onWrite:()=>{throw Error('response lost');}}),op=await approved(f);await assert.rejects(()=>f.ws.executeOperation(op.id));const reopened=new Workspace(f.ws.repo.file,f.options);await reopened.init();assert.equal((await saved(f,op.id)).state,'unknown');await assert.rejects(()=>reopened.executeOperation(op.id));
 f.apply();const r=await reopened.reconcileWbStock(op.id);assert.equal(r.state,'verified');assert.equal(r.observation.originProven,false);assert.equal(f.writes.length,1);
 await f.ws.repo.mutate(db=>db.operations.find(o=>o.id===op.id).state='executing');await reopened.init();assert.equal((await saved(f,op.id)).state,'unknown');
});

test('sales after submission require fresh human difference review, never target replay',async t=>{
 const f=await fixture(t),op=await approved(f);await f.ws.executeOperation(op.id);f.apply();f.stock.get(50)[0].amount=11;let r=await f.ws.reconcileWbStock(op.id);assert.equal(r.state,'submitted');assert.equal(r.observation.known,true);assert.equal(r.observation.matches,false);
 await assert.rejects(()=>plan(f));await assert.rejects(()=>f.ws.confirmWbStock(op.id,{observationVersion:r.observation.version,confirmed:false}));
 f.stock.get(50)[0].amount=10;await assert.rejects(()=>f.ws.confirmWbStock(op.id,{observationVersion:r.observation.version,confirmed:true}),/变化/);
 r=await f.ws.reconcileWbStock(op.id);await f.ws.confirmWbStock(op.id,{observationVersion:r.observation.version,confirmed:true});assert.equal((await saved(f,op.id)).state,'reviewed');await f.ws.executeOperation(op.id);assert.equal(f.writes.length,1);await plan(f);await assert.rejects(()=>f.ws.reconcileWbStock(op.id));
});

test('missing sizes cannot verify target or close an unresolved operation as reviewed',async t=>{
 const f=await fixture(t),op=await approved(f);await f.ws.executeOperation(op.id);f.stock.get(50).shift();const r=await f.ws.reconcileWbStock(op.id);assert.equal(r.state,'submitted');assert.equal(r.observation.rows[0].current,null);assert.equal(r.observation.known,false);await assert.rejects(()=>f.ws.confirmWbStock(op.id,{observationVersion:r.observation.version,confirmed:true}));
});

test('expired, tampered and rotated stock approvals fail before submission, including queue expiry',async t=>{
 const f=await fixture(t),op=await approved(f);const send=createWbStockSubmit({context:f.context,write:async()=>assert.fail('must not send')});
 for(const bad of [{...op,approvedHash:'wrong'},{...op,approvedAt:'invalid'},{...op,approvedAt:new Date(Date.now()-901000).toISOString()}])await assert.rejects(()=>send(f.store,bad),e=>e.noWrite);
 f.owner='rotated';await assert.rejects(()=>send(f.store,op),e=>e.noWrite);f.owner='synthetic-stock-owner';let now=Date.now();const read=createWbRead({clock:()=>now,getCredentials:async()=>({WB_API_TOKEN:'fixture'}),fetcher:async()=>assert.fail('must not fetch')});
 const queued=createWbStockSubmit({context:f.context,clock:()=>now,write:async(s,p,b,o)=>{now+=901000;return read.writeStock(s,p,b,{beforeSend:o.beforeSend});}});await assert.rejects(()=>queued(f.store,op),e=>e.noWrite);assert.equal(f.writes.length,0);
});

test('stock transport uses regional PUT, exact chrtId body, shared read quota and 204 without JSON',async t=>{
 const f=await fixture(t);let now=0;const calls=[];const read=createWbRead({clock:()=>now,sleep:async ms=>now+=ms,getCredentials:async()=>({WB_API_TOKEN:'fixture'}),fetcher:async(u,o)=>{calls.push({u,method:o.method,body:JSON.parse(o.body),at:now});return o.method==='PUT'?new Response(null,{status:204}):new Response('{"stocks":[]}');}});
 await read(f.store,'/api/v3/stocks/50',{chrtIds:[10]});const body={stocks:[{chrtId:10,amount:0}]};assert.deepEqual(await read.writeStock({...f.store,id:'alias'},'/api/v3/stocks/50',body),{status:204});assert.deepEqual(calls[1],{u:'https://marketplace-api.wildberries.cn/api/v3/stocks/50',method:'PUT',body,at:210});
 for(const [path,data] of [['/api/v3/stocks/50?extra=1',body],['/api/v3/stocks/50',{stocks:[{sku:'barcode',amount:1}]}],['/api/v3/stocks/50',{stocks:[{chrtId:10,amount:100001}]}],['/api/v3/stocks/50',{stocks:[{chrtId:10,amount:1},{chrtId:10,amount:2}]}]])await assert.rejects(()=>read.writeStock(f.store,path,data),e=>e.noWrite);
 await assert.rejects(()=>read(f.store,'/api/v3/stocks/50',body));assert.equal(calls.length,2);
});

test('stock rate limits and 4xx weight persist across restart and token aliases',async t=>{
 const f=await fixture(t);let now=10000,calls=0;const options={inventoryRateFile:join(f.dir,'limits.json'),clock:()=>now,sleep:async ms=>now+=ms,getCredentials:async()=>({WB_API_TOKEN:'fixture'}),fetcher:async()=>{calls++;return new Response('{}',{status:406});}},body={stocks:[{chrtId:10,amount:1}]};
 await assert.rejects(()=>createWbRead(options).writeStock(f.store,'/api/v3/stocks/50',body),e=>e.retryAt===12100&&!e.noWrite);
 await assert.rejects(()=>createWbRead(options).writeStock({...f.store,id:'alias'},'/api/v3/stocks/60',body),e=>e.retryAt===12100&&e.noWrite);assert.equal(calls,1);
 now=13000;options.fetcher=async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':'120'}});};await assert.rejects(()=>createWbRead(options).writeStock(f.store,'/api/v3/stocks/50',body),e=>e.retryAt===133000);
 await assert.rejects(()=>createWbRead(options)(f.store,'/api/v3/stocks/60',{chrtIds:[10]}),e=>e.retryAt===133000);assert.equal(calls,2);
});

test('stock UI uses selected-size opt-in, preserves fields and exposes writes only for fresh warehouses',async t=>{
 const f=await fixture(t),c=await f.context(f.store,f.product,'50'),w={...c.warehouse,stocks:c.stocks,state:'ok',stale:false};w.name='<script>';const html=wbStockForm(w,f.store.id,'123');assert.match(html,/&lt;script&gt;/);assert.match(html,/不是增加数量/);assert.match(html,/name="amount-10"/);assert.doesNotMatch(html,/checked/);assert.match(html,/max="100000"/);
 w.at=new Date(Date.now()-10000).toISOString();const view={state:'complete',rows:[w],total:1,loaded:1};assert.match(wbInventoryPanel(view,f.store.id,'123'),/data-wb-stock-plan/);assert.doesNotMatch(wbInventoryPanel({...view,listStale:true},f.store.id,'123'),/data-wb-stock-plan/);
 const focus=skuFocus({stores:[f.store]},null,{storeId:f.store.id,sku:'123',product:f.product,wbInventory:view});assert.match(focus,/data-wb-stock-plan/);
 const op=await plan(f,{...f.input,sizes:[{chrtId:'10',amount:'0'}]});const changed={...op,state:'submitted',executedAt:new Date().toISOString()};const stale=wbInventoryPanel(view,f.store.id,'123',[changed]);assert.match(stale,/读取后有库存操作/);assert.doesNotMatch(stale,/data-wb-stock-plan/);assert.match(wbStockGate(op,'合成测试'),/设为零/);assert.doesNotMatch(wbStockGate(op,'合成测试'),/data-execute/);assert.equal(wbJobStockPanel({marketplace:'wb',mode:'manual',synthetic:true,state:'imported'}),'');
});
