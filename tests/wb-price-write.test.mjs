import test from 'node:test';import assert from 'node:assert/strict';
import {join} from 'node:path';
import {priceFixture} from './helpers/wb-price-fixture.mjs';
import {buildWbPricePlan} from '../core/wb-price-plan.mjs';
import {createWbPriceSubmit,readWbPriceResult} from '../adapters/wb-price-write.mjs';
import {createWbRead} from '../adapters/wb-api.mjs';
import {Workspace} from '../core/workspace.mjs';
import {hash} from '../core/repository.mjs';
import {wbPriceForm,wbPriceGate} from '../web/wb-price-controls.mjs';
async function fixture(t,options){const f=await priceFixture(options);t.after(f.cleanup);return f;}
async function plan(f,input=f.input){return f.ws.prepareWbPrice(f.store.id,input);}
async function approved(f,input=f.input){const o=await plan(f,input);return f.ws.approveOperation(o.id,o.payloadHash);}
async function saved(f,id){return (await f.ws.view()).operations.find(o=>o.id===id);}

test('WB native-currency guard includes seller and Club discounts, all sizes and explicit costs',async t=>{
 const f=await fixture(t),context=await f.context(f.store,f.product),p=buildWbPricePlan(context,f.input);
 assert.equal(p.currency,'CNY');assert.deepEqual(p.apiBody,{data:[{nmID:123,price:150,discount:20}]});
 assert.deepEqual(p.rows.map(r=>[r.sellerPrice,r.clubScenarioPrice,r.contribution,r.marginPct,r.minimumPrice]),[['120.00','114.00','52.60',46.14,88],['120.00','114.00','47.60',41.75,97]]);
 for(const input of [{currency:'RUB'},{costsConfirmed:false},{promotionReviewed:false},{feePct:''},{feePct:'85'},{price:'80'},{price:'100.5'},{discount:100},{sizes:f.input.sizes.slice(1)},{sizes:f.input.sizes.map(s=>({...s,fixedCost:''}))},{sizes:[f.input.sizes[0],f.input.sizes[0]]}])assert.throws(()=>buildWbPricePlan(context,{...f.input,...input}));
 const size=buildWbPricePlan(context,{...f.input,mode:'size',discount:'99'});assert.equal(size.discount,20);assert.deepEqual(size.apiBody.data,[{nmID:123,sizeID:10,price:150},{nmID:123,sizeID:11,price:160}]);
 context.price.editableSizePrice=false;assert.throws(()=>buildWbPricePlan(context,{...f.input,mode:'size'}));
});

test('WB guard rounds conservatively and computed floor is minimal for every target size',async t=>{
 const f=await fixture(t),c=await f.context(f.store,f.product);c.price.discount=0;c.price.clubDiscount=17;
 for(const cost of ['0','0.01','17.93','61.07']){
  const input={...f.input,price:'999',discount:'13',feePct:'12.75',minMarginPct:'18.25',sizes:f.input.sizes.map(s=>({...s,fixedCost:cost}))};
  const p=buildWbPricePlan(c,input),minimum=p.rows[0].minimumPrice;
  assert.doesNotThrow(()=>buildWbPricePlan(c,{...input,price:String(minimum)}));
  if(minimum>1)assert.throws(()=>buildWbPricePlan(c,{...input,price:String(minimum-1)}));
 }
});

test('fresh card and price identity must agree, including sizes and native currency',async t=>{
 const f=await fixture(t);f.card.sizes.pop();await assert.rejects(()=>plan(f),/尺码/);f.card.sizes.push({chrtID:11,techSize:'L',skus:['1234567890124']});
 f.price.currencyIsoCode4217='RUB';await assert.rejects(()=>plan(f),/币种/);f.price.currencyIsoCode4217='CNY';f.card.nmID=999;await assert.rejects(()=>plan(f),/不匹配/);assert.equal(f.writes.length,0);
});

test('WB exact approval sends once; current target plus successful task detail proves completion',async t=>{
 const f=await fixture(t),op=await plan(f);await assert.rejects(()=>f.ws.executeOperation(op.id));await assert.rejects(()=>f.ws.approveOperation(op.id,'wrong'));
 await f.ws.approveOperation(op.id,op.payloadHash);const submitted=await f.ws.executeOperation(op.id);assert.equal(submitted.state,'submitted');assert.equal(submitted.receipt.taskId,42);
 await f.ws.executeOperation(op.id);assert.equal(f.writes.length,1);assert.equal((await f.ws.reconcileWbPrice(op.id)).state,'submitted');
 await assert.rejects(()=>plan(f,{...f.input,price:'170'}));f.apply();const result=await f.ws.reconcileWbPrice(op.id);assert.equal(result.state,'verified');assert.equal(result.observation.originProven,true);assert.equal((await f.ws.view()).auditValid,true);
});

test('size task preserves discounts and needs every matching successful task row',async t=>{
 const f=await fixture(t),op=await approved(f,{...f.input,mode:'size'});await f.ws.executeOperation(op.id);f.apply();const goods=structuredClone(f.goods);
 f.goods.pop();await assert.rejects(()=>f.ws.reconcileWbPrice(op.id),/不完整/);
 f.goods=goods;f.goods[0].currencyIsoCode4217='RUB';assert.equal((await f.ws.reconcileWbPrice(op.id)).state,'submitted');
 f.goods[0].currencyIsoCode4217='CNY';assert.equal((await f.ws.reconcileWbPrice(op.id)).state,'verified');
 f.price.sizes[1].price=170;assert.equal((await f.ws.reconcileWbPrice(op.id)).state,'submitted');
});

test('matching current price without completed task is pending; quarantine and partial failure stop task',async t=>{
 const f=await fixture(t),op=await approved(f);await f.ws.executeOperation(op.id);f.apply();f.task=null;let r=await f.ws.reconcileWbPrice(op.id);assert.equal(r.state,'submitted');assert.equal(r.observation.matches,true);assert.match(r.observation.message,/尚未核对成功/);
 for(const status of [4,5,6]){f.task={uploadID:42,status};if(status!==4)f.goods[0].status=3;const result=await readWbPriceResult(f.store,await saved(f,op.id),{context:f.context,read:f.read});assert.equal(result.verified,false);assert.equal(result.terminalFailure,true);}
 r=await f.ws.reconcileWbPrice(op.id);assert.equal(r.state,'blocked');
});

test('changed, expired and tampered approvals fail before sending; queued expiry is checked again',async t=>{
 const f=await fixture(t),op=await approved(f);f.price.clubDiscount=10;await assert.rejects(()=>f.ws.executeOperation(op.id),e=>e.noWrite);assert.equal((await saved(f,op.id)).state,'blocked');assert.equal(f.writes.length,0);f.price.clubDiscount=5;
 const send=createWbPriceSubmit({context:f.context,write:async()=>assert.fail('must not write')});
 for(const bad of [{...op,approvedAt:'invalid'},{...op,approvedAt:new Date(Date.now()-901000).toISOString()},{...op,approvedHash:'wrong'}])await assert.rejects(()=>send(f.store,bad),e=>e.noWrite);
 let now=Date.now();const read=createWbRead({clock:()=>now,getCredentials:async()=>({WB_API_TOKEN:'fake'}),fetcher:async()=>assert.fail('expired in queue')});
 const queued=createWbPriceSubmit({context:f.context,clock:()=>now,write:async(s,p,b,o)=>{now+=901000;return read.writePrice(s,p,b,{beforeSend:o.beforeSend});}});
 await assert.rejects(()=>queued(f.store,op),e=>e.noWrite&&/过期/.test(e.message));assert.equal(f.writes.length,0);
});

test('new pending version supersedes approval; concurrent execute reserves a single write',async t=>{
 const f=await fixture(t),first=await approved(f),op=await approved(f,{...f.input,price:'160'});assert.equal((await saved(f,first.id)).state,'superseded');await assert.rejects(()=>f.ws.executeOperation(first.id));
 const results=await Promise.allSettled([f.ws.executeOperation(op.id),f.ws.executeOperation(op.id)]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(f.writes.length,1);
});

test('lost response survives restart, forbids resend and distinguishes observed price from attribution',async t=>{
 const f=await fixture(t,{onWrite:()=>{throw Error('lost');}}),op=await approved(f);await assert.rejects(()=>f.ws.executeOperation(op.id));assert.equal((await saved(f,op.id)).state,'unknown');
 const reopened=new Workspace(f.ws.repo.file,f.options);await reopened.init();await assert.rejects(()=>reopened.executeOperation(op.id));await assert.rejects(()=>reopened.prepareWbPrice(f.store.id,{...f.input,price:'170'}));
 f.apply();const r=await reopened.reconcileWbPrice(op.id);assert.equal(r.state,'verified');assert.equal(r.observation.originProven,false);assert.equal(f.writes.length,1);
 await reopened.repo.mutate(db=>{db.operations.find(o=>o.id===op.id).state='executing';});await reopened.init();assert.equal((await reopened.view()).operations.find(o=>o.id===op.id).state,'unknown');
});

test('older completed task cannot become pending after a newer price plan',async t=>{
 const f=await fixture(t),op=await approved(f);await f.ws.executeOperation(op.id);f.apply();await f.ws.reconcileWbPrice(op.id);await plan(f,{...f.input,price:'170'});await assert.rejects(()=>f.ws.reconcileWbPrice(op.id),/较新/);
});

test('read and write share account quotas; rate deadline survives restart and aliases',async t=>{
 const f=await fixture(t);let now=10000,calls=0;const config={priceRateFile:join(f.dir,'limits.json'),clock:()=>now,sleep:async ms=>now+=ms,getCredentials:async()=>({WB_API_TOKEN:'fake-price-token'}),fetcher:async(u,o)=>{calls++;if(calls===1){assert.equal(o.method,'GET');return new Response('{}');}assert.equal(o.method,'POST');assert.match(u,/discounts-prices-api.wildberries.cn/);assert.equal(now,10650);return new Response('{}',{status:429,headers:{'Retry-After':'120'}});}};
 const read=createWbRead(config);await read(f.store,'/api/v2/list/goods/filter?limit=1&offset=0&filterNmID=123');const body={data:[{nmID:123,price:150,discount:20}]};
 await assert.rejects(()=>read.writePrice({...f.store,id:'alias'},'/api/v2/upload/task',body),e=>e.retryAt>=130650&&!e.noWrite);
 const restarted=createWbRead(config);await assert.rejects(()=>restarted.writePrice(f.store,'/api/v2/upload/task',body),e=>e.noWrite&&e.retryAt>=130650);assert.equal(calls,2);
 await assert.rejects(()=>restarted(f.store,'/api/v2/upload/task',body));await assert.rejects(()=>restarted.writePrice(f.store,'/api/v2/upload/task',{data:[{nmID:123,price:150,discount:20,extra:'unsafe'}]}),e=>e.noWrite);assert.equal(calls,2);
});

test('Chinese price gate shows cost assumptions and native currency without promising profit',async t=>{
 const f=await fixture(t),op=await plan(f);op.payload.context.title='<script>';const html=wbPriceGate(op,'测试');assert.match(html,/&lt;script&gt;/);assert.match(html,/CNY/);assert.match(html,/不是买家最终付款/);assert.match(html,/50.00/);assert.doesNotMatch(html,/data-execute/);const form=wbPriceForm(op.payload.context.price,f.store.id);assert.match(form,/wb-target-price" disabled/);assert.match(form,/name="feePct"[^>]*required/);assert.doesNotMatch(form,/value="RUB"/);
});
