import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {normalizeWbListingErrors,readWbListingErrorPage} from '../adapters/wb-listing-errors.mjs';
import {WbListingErrorService} from '../core/wb-listing-error-service.mjs';import {createWbRead} from '../adapters/wb-api.mjs';
import {wbLaunchPanel,wbLaunchModel} from '../web/wb-launch.mjs';
const store={id:'wb-errors',name:'合成草稿错误测试',marketplace:'wb',mode:'live',wbRegion:'cn',wbContentTokenType:'personal'};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const batch=(n,v='SKU-1')=>({batchUUID:id(n),updatedAt:'2026-10-13T00:00:00Z',vendorCodes:[v],subjects:{},brands:{},errors:{[v]:['Поле Наименование содержит запрещенные символы']}});
const page=(items,more=false,n=1)=>({error:false,data:{items,cursor:{next:more,batchUUID:more?id(n):'',updatedAt:more?'2026-10-13T00:00:00Z':''}}});
async function fixture(t,options={}){const dir=await mkdtemp(join(tmpdir(),'wb-errors-'));let time=Date.parse('2026-10-13T01:00:00Z'),owner='a';const file=join(dir,'errors.json'),params={clock:()=>time,sleep:async ms=>time+=ms,accountRef:async()=>owner,...options};let s=new WbListingErrorService(file,params);await s.ready;t.after(async()=>{await s.wait(store.id);await rm(dir,{recursive:true,force:true});});return {get s(){return s;},params,dir,file,advance:ms=>time+=ms,rotate:()=>owner='b',async reopen(){await s.wait(store.id);s=new WbListingErrorService(file,params);await s.ready;},get time(){return time;}};}

test('error parser follows batches/cursor schema, masks contacts and keeps missing per-SKU reasons explicit',()=>{
 const b=batch(1);b.vendorCodes.push('NO-REASON');b.errors['SKU-1']=['Описание contact@test.example +7 999 123 45 67'];const n=normalizeWbListingErrors(page([b],true));assert.deepEqual(n.items[0].errors['NO-REASON'],[]);assert.match(n.items[0].errors['SKU-1'][0],/\[EMAIL\]/);assert.doesNotMatch(JSON.stringify(n),/contact@test/);assert.equal(n.more,true);
 for(const mutate of [r=>r.error=true,r=>r.data.cursor.next='false',r=>r.data.items[0].batchUUID='bad',r=>r.data.items[0].errors.other=['wrong'],r=>r.data.items[0].errors['SKU-1']='string',r=>r.data.items.push(r.data.items[0])]){const r=page([batch(1)]);mutate(r);assert.throws(()=>normalizeWbListingErrors(r));}
 assert.throws(()=>normalizeWbListingErrors(page([],true)));assert.equal(normalizeWbListingErrors(page([])).more,false);
});

test('adapter requests Chinese locale and the exact continuation cursor',async()=>{let call;const cursor={updatedAt:'2026-10-13T00:00:00Z',batchUUID:id(1)};const r=await readWbListingErrorPage(store,cursor,{accountRef:'a',read:async(s,p,b,o)=>{call={p,b,o};return page([batch(2)]);}});assert.equal(call.p,'/content/v2/cards/error/list?locale=zh');assert.deepEqual(call.b,{cursor:{limit:100,...cursor},order:{ascending:true}});assert.equal(call.o.accountRef,'a');assert.ok(r.responseHash);});

test('background errors resume only an uncommitted page, preserve old results and hide another account',async t=>{
 let fail=true,calls=[];const f=await fixture(t,{read:async(s,c)=>{calls.push(c);if(!c)return {...normalizeWbListingErrors(page([batch(1,'OTHER')],true)),inputHash:'in1',responseHash:'out1'};if(fail)throw Error('interrupted');return {...normalizeWbListingErrors(page([batch(2)])),inputHash:'in2',responseHash:'out2'};}});
 await f.s.start(store);await f.s.wait(store.id);let r=await f.s.get(store,{vendorCode:'SKU-1'});assert.equal(r.state,'error');assert.equal(r.pages,1);assert.equal(r.complete,false);assert.equal(r.matches.length,0);
 await f.reopen();fail=false;f.advance(6101);await f.s.start(store);await f.s.wait(store.id);r=await f.s.get(store,{vendorCode:'SKU-1'});assert.equal(r.state,'complete');assert.equal(r.pages,2);assert.equal(r.matches[0].batchUUID,id(2));assert.deepEqual(calls.map(c=>c?.batchUUID||null),[null,id(1),id(1)]);
 f.rotate();assert.equal((await f.s.get(store,{vendorCode:'SKU-1'})).state,'idle');
});

test('duplicate batches and looping cursors fail without advancing saved progress',async t=>{
 const f=await fixture(t,{read:async(s,c)=>({...normalizeWbListingErrors(page([batch(c?2:1)],true,1)),inputHash:'in',responseHash:'out'})});await f.s.start(store);await f.s.wait(store.id);const r=await f.s.get(store);assert.equal(r.state,'error');assert.equal(r.pages,1);assert.match(r.error,/循环/);
});

test('new empty read is not completion after failure; earlier matching errors remain stale evidence',async t=>{
 let fail=false;const f=await fixture(t,{read:async()=>{if(fail)throw Error('unavailable');return {...normalizeWbListingErrors(page([batch(1)])),inputHash:'in',responseHash:'out'};}});await f.s.start(store);await f.s.wait(store.id);fail=true;f.advance(6101);await f.s.start(store);await f.s.wait(store.id);const r=await f.s.get(store,{vendorCode:'SKU-1'});assert.equal(r.stale,true);assert.equal(r.complete,false);assert.equal(r.matches.length,1);
});

test('pause saves completed page and resume keeps cursor; account rotation rejects in-flight response',async t=>{
 let entered,release;const signal=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const f=await fixture(t,{read:async()=>{entered();await gate;return {...normalizeWbListingErrors(page([batch(1)],true)),inputHash:'in',responseHash:'out'};}});await f.s.start(store);await signal;const paused=f.s.pause(store);release();await paused;const r=await f.s.get(store);assert.equal(r.state,'paused');assert.equal(r.pages,1);
 f.advance(6101);f.s.read=async()=>{f.rotate();return {...normalizeWbListingErrors(page([batch(2)])),inputHash:'in',responseHash:'out'};};await f.s.start(store);await f.s.wait(store.id);const db=await f.s.repo.read();assert.equal(db.runs[0].pages.length,1);assert.equal(db.runs[0].state,'error');
});

test('account-wide read reservation prevents alias races and 429 deadline survives restart',async t=>{
 let resolve,calls=0;const gate=new Promise(r=>resolve=r);const f=await fixture(t,{read:async()=>{calls++;await gate;const e=Error('rate limited');e.retryAt=f.time+120000;throw e;}});
 const starts=await Promise.allSettled([f.s.start(store),f.s.start({...store,id:'alias'})]);assert.ok(starts.some(s=>s.status==='fulfilled'));resolve();await f.s.wait(store.id);await f.s.wait('alias');assert.equal(calls,1);await f.reopen();await assert.rejects(()=>f.s.start({...store,id:'alias'}),e=>e.retryAt>f.time);assert.equal(calls,1);
});

test('error/limit reads share a persistent conservative quota; Content cards use a separate queue',async t=>{
 const f=await fixture(t);let now=10000,calls=0;const options={contentRateFile:join(f.dir,'limits.json'),clock:()=>now,sleep:async ms=>now+=ms,getCredentials:async()=>({WB_API_TOKEN:'fixture'}),fetcher:async()=>{calls++;return new Response('{"error":false,"data":{}}');}};
 const read=createWbRead(options);await read(store,'/content/v2/cards/limits');await read(store,'/content/v2/get/cards/list',{});await assert.rejects(()=>read({...store,id:'alias'},'/content/v2/cards/error/list?locale=zh',{}),e=>e.retryAt===16100);assert.equal(calls,2);
 await assert.rejects(()=>createWbRead(options)(store,'/content/v2/cards/error/list',{}),e=>e.retryAt===16100);assert.equal(calls,2);
});

test('launch panel separates observed setup, historical errors and unverified moderation',()=>{
 const job={id:'j',storeId:store.id,marketplace:'wb',mode:'manual',canonical:{sku:'SKU-1'},state:'imported',importResult:{imported:true,productId:123},wbMediaResult:{complete:true},wbListingErrors:{state:'complete',complete:true,pages:2,batches:101,matches:[{batchUUID:id(2),updatedAt:'2026-10-12T00:00:00Z',reasons:['Наименование <script>']}]}};
 const operations=[{kind:'publish',state:'verified',executedAt:'2026-10-13T00:00:00Z',payload:{marketplace:'wb',jobId:'j',wbContext:{accountRef:'a'}}},{kind:'wb_price',state:'verified',storeId:store.id,payload:{context:{accountRef:'a',product:{sku:'123'}},plan:{currency:'CNY'}}}];
 assert.equal(wbLaunchModel(job,operations).price.state,'verified');const html=wbLaunchPanel(job,operations);assert.match(html,/未验证/);assert.match(html,/早于本次提交/);assert.match(html,/&lt;script&gt;/);assert.match(html,/关键词提示/);assert.doesNotMatch(html,/<script>/);
 operations[1].payload.context.accountRef='other';assert.equal(wbLaunchModel(job,operations).price,undefined);assert.equal(wbLaunchPanel({...job,synthetic:true},operations),'');
});

test('restarted interrupted scan keeps its committed cursor and never rereads the first page',async t=>{
 let observed;const f=await fixture(t,{read:async(s,c)=>{observed=c;return {...normalizeWbListingErrors(page([batch(2)])),inputHash:'next',responseHash:'result'};}});
 const cursor={updatedAt:'2026-10-13T00:00:00Z',batchUUID:id(1)};
 await f.s.repo.mutate(db=>{db.limits={};db.runs.push({id:'interrupted-run',storeId:store.id,owner:'a',state:'reading',startedAt:new Date(f.time).toISOString(),updatedAt:new Date(f.time).toISOString(),cursor,items:[normalizeWbListingErrors(page([batch(1,'OTHER')])).items[0]],pages:[{cursorHash:'prior',responseHash:'first'}]});});
 await f.reopen();assert.equal((await f.s.get(store)).state,'interrupted');await f.s.start(store);await f.s.wait(store.id);assert.deepEqual(observed,cursor);assert.equal((await f.s.get(store)).pages,2);assert.equal((await f.s.get(store)).complete,true);
});
