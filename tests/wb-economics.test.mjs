import {wbStoredReportQuery} from '../core/http.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {settlementFixture} from './helpers/wb-settlement-fixture.mjs';
import {wbEconomicsRows,wbEconomicsSummary,queryWbEconomics} from '../core/wb-economics.mjs';
import {wbEconomicsPage,wbEconomicsPanel,bindWbEconomics,prepareWbEconomicsPlan} from '../web/wb-economics.mjs';
import {storeHome} from '../web/store-home.mjs';
const source=v=>({runId:v.snapshot.runId,reportHash:v.snapshot.evidenceHash,currency:'CNY'});
async function fixture(t,extra=0){const f=await settlementFixture();t.after(f.cleanup);if(extra){const read=f.service.read;f.service.read=async(...args)=>{const out=structuredClone(await read(...args));if(args[2]==='details'&&out.rows.length){const base=out.rows.find(r=>r.nmId==='456');out.rows.push(...Array.from({length:extra},(_,i)=>({...base,nmId:String(1000+i),rrdId:String(100+i),vendorCode:'LOOKUP-'+i,title:i===extra-1?'<img src=x onerror=bad> 折叠盒':'Extra '+i,quantity:0,forPay:'0',retailAmount:'0'})));}return out;};}await f.read();return f;}
async function allocate(f,currency='CNY'){const i={...source(await f.service.get(f.store)),currency,method:'positive_goods'},p=await f.service.skuCosts.preview(f.store,i);await f.service.skuCosts.allocate(f.store,{...i,previewHash:p.previewHash,revision:p.revision,confirmed:true,evidence:'Synthetic allocation costs'});}
async function cost(f,{sku='123',cogs='700',revision=0,currency='CNY',reviewed=true}={}){const v=await f.service.get(f.store,{sku});return f.service.skuCosts.reconcile(f.store,{...source(v),currency,sku,revision,allocationHash:v.allocations.find(a=>a.currency===currency)?.hash||null,cogs,tax:'0',external:'0',costsReviewed:reviewed,periodReviewed:true,noDoubleCount:true,sharedReviewed:true,evidence:'Synthetic seller costs for this period'});}

test('home summary uses all report products, exact signed current contribution and separate unknown costs',async t=>{
 const f=await fixture(t,23);await allocate(f);await cost(f);await cost(f,{sku:'456',cogs:'50'});const v=await f.service.get(f.store),c=v.skuEconomics.currencies.CNY;
 assert.equal(v.snapshot.products.length,5);assert.equal(c.total,25);assert.equal(c.reviewed,2);assert.equal(c.pending,23);assert.equal(c.loss,1);assert.equal(c.positive,1);assert.equal(c.lossContribution,'-51.377778');assert.equal(c.reviewedContribution,'-7.6');assert.equal(c.rows[0].sku,'123');assert.equal(c.rows[0].name,'折叠收纳盒 · 合成数据');assert.equal(c.rows[1].contribution,null);
});
test('all pages, loss/pending filters and Unicode/name/vendor searches read only local data',async t=>{
 const f=await fixture(t,23);await allocate(f);await cost(f);const reads=f.calls.length,s=source(await f.service.get(f.store)),query=i=>f.service.skuCosts.query(f.store,{...s,...i});
 const pages=await Promise.all([0,10,20].map(offset=>query({offset})));assert.deepEqual(pages.map(p=>p.rows.length),[10,10,5]);assert.equal(new Set(pages.flatMap(p=>p.rows.map(r=>r.sku))).size,25);
 assert.equal((await query({filter:'loss'})).rows[0].sku,'123');assert.equal((await query({filter:'pending'})).total,24);assert.equal((await query({q:'lookup-22'})).rows[0].sku,'1022');assert.equal((await query({q:'折叠盒'})).rows[0].sku,'1022');assert.equal((await query({q:'1022'})).total,1);assert.equal((await query({q:'absent'})).total,0);assert.equal((await query({offset:99999})).offset,20);assert.equal(f.calls.length,reads);
 for(const patch of [{offset:-1},{offset:'1e2'},{offset:'2.5'},{currency:'RUB'},{filter:'bogus'},{q:'x'.repeat(161)}])await assert.rejects(()=>query(patch));
});
test('cost revisions, incomplete checks and allocation changes invalidate cached rankings',async t=>{
 const f=await fixture(t);await allocate(f);await cost(f);const v=await f.service.get(f.store),cached=await f.service.skuCosts.query(f.store,source(v));await cost(f,{revision:1,cogs:'300',reviewed:false});let next=await f.service.get(f.store);assert.equal(next.skuEconomics.currencies.CNY.loss,0);assert.equal(next.skuEconomics.currencies.CNY.reviewedContribution,null);assert.notEqual(next.skuEconomics.evidenceHash,cached.summary.evidenceHash);assert.equal(wbEconomicsPage(next,cached).rows.find(r=>r.sku==='123').status,'needs_review');
 await cost(f,{revision:2,cogs:'300'});await allocate(f);next=await f.service.get(f.store);assert.equal(next.skuEconomics.currencies.CNY.pending,2);assert.equal(next.skuEconomics.currencies.CNY.rows.find(r=>r.sku==='123').status,'superseded');
});
test('aged or partially refreshed reports remove all current loss conclusions and protect exact source',async t=>{
 const f=await fixture(t);await allocate(f);await cost(f);const v=await f.service.get(f.store),s=source(v),oldClock=f.service.clock;
 f.service.clock=()=>oldClock()+86400001;const stale=await f.service.skuCosts.query(f.store,s);assert.equal(stale.stale,true);assert.equal(stale.summary.currencies.CNY.reviewed,0);assert.equal(stale.rows.find(r=>r.sku==='123').contribution,null);f.service.clock=oldClock;
 const read=f.service.read;f.service.read=async()=>{throw Error('Synthetic denied refresh');};await f.service.start(f.store,{...f.range,restart:true});await f.service.wait(f.store.id);const partial=await f.service.skuCosts.query(f.store,s);assert.equal(partial.stale,true);assert.equal(partial.summary.currencies.CNY.loss,0);f.service.read=read;await f.read();await assert.rejects(()=>f.service.skuCosts.query(f.store,s),/来源已变化/);
});
test('query remains account/store bound and rejects source or identity changes during final check',async t=>{
 const f=await fixture(t),s=source(await f.service.get(f.store));await assert.rejects(()=>f.service.skuCosts.query({...f.store,id:'other'},s));await assert.rejects(()=>f.service.skuCosts.query(f.store,{...s,reportHash:'changed'}));
 const original=f.service.accountRef;let calls=0;f.service.accountRef=async()=>++calls===4?'new-owner':original(f.store);await assert.rejects(()=>f.service.skuCosts.query(f.store,s),/账户/);calls=0;f.service.accountRef=async()=>{if(++calls===4)f.service.db.prepare("UPDATE wb_finance_runs SET state='waiting' WHERE id=?").run(s.runId);return original(f.store);};await assert.rejects(()=>f.service.skuCosts.query(f.store,s),/来源已变化/);
});
test('native currencies and micro-unit losses remain separate; zero is only a reviewed zero',()=>{
 const records=[{kind:'cost',sku:'1',currency:'CNY',contribution:'-0.000001',revision:1,hash:'a'},{kind:'cost',sku:'1',currency:'RUB',contribution:'100',revision:1,hash:'b'},{kind:'cost',sku:'2',currency:'CNY',contribution:'0',revision:1,hash:'c'}],products=new Map([['1',{CNY:{},RUB:{}}],['2',{CNY:{}}],['3',{CNY:{}}]]),view={snapshot:{attribution:{currencies:{CNY:{shared:{lines:0}},RUB:{shared:{lines:0}}}}}},rows=wbEconomicsRows(view,products,records,()=> 'current'),summary=wbEconomicsSummary(rows);
 assert.equal(summary.currencies.CNY.reviewedContribution,'-0.000001');assert.equal(summary.currencies.CNY.loss,1);assert.equal(summary.currencies.CNY.zero,1);assert.equal(summary.currencies.CNY.pending,1);assert.equal(summary.currencies.RUB.reviewedContribution,'100');assert.equal(queryWbEconomics(rows,new Map(),{currency:'CNY',filter:'zero'}).rows[0].sku,'2');
});
test('Chinese dashboard prioritizes economics, escapes labels and retains period when opening SKU costs',async t=>{
 const f=await fixture(t,23);await allocate(f);await cost(f);const v=await f.service.get(f.store),query=await f.service.skuCosts.query(f.store,{...source(v),q:'lookup-22'});let html=wbEconomicsPanel(v,f.store.id,query);
 assert.match(html,/&lt;img src=x onerror=bad&gt;/);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/data-finance-from="2026-10-01"/);assert.match(html,/data-finance-to="2026-10-02"/);assert.match(html,/核对此期间成本/);assert.doesNotMatch(html,/data-wb-economics-plan/);
 html=wbEconomicsPanel(v,f.store.id,null,{trialPlans:[{id:'plan-existing',storeId:f.store.id,sku:'123',status:'planned'}]});assert.match(html,/data-record="plan-plan-existing"/);
 html=storeHome({stores:[f.store],wbFinance:{[f.store.id]:v},trialPlans:[],trials:[],operations:[]},null,f.store.id);assert.ok(html.indexOf('哪些商品需要先处理')<html.indexOf('报表与成本设置'));assert.match(html,/<details class="card wb-finance-tools"[^>]+>\s*<summary>/);assert.doesNotMatch(html,/显示明细行数最多的 5/);assert.match(html,/非全店净利润/);
});
test('search, page and new-test handlers preserve exact inputs; prepared plan starts with blank approvals and no execution',()=>{
 const oldDoc=globalThis.document,oldData=globalThis.FormData,loads=[],plans=[],form={dataset:{store:'s',run:'r',source:'h'},values:{currency:'CNY',filter:'loss',q:'盒'}};
 const next={dataset:{store:'s',wbEconomicsPage:'10'}},newPlan={dataset:{store:'s',sku:'123',currency:'CNY'}};
 globalThis.document={querySelectorAll:s=>({'[data-wb-economics-search]':[form],'[data-wb-economics-page]':[next],'[data-wb-economics-plan]':[newPlan]}[s]||[])};globalThis.FormData=class extends Map{constructor(f){super(Object.entries(f.values));}};
 try{bindWbEconomics({load:(...v)=>loads.push(v),preparePlan:p=>plans.push(p)});form.onsubmit({preventDefault(){}});next.onclick();newPlan.onclick();assert.deepEqual(loads,[['s',{currency:'CNY',filter:'loss',q:'盒',runId:'r',reportHash:'h',offset:0}],['s',{offset:10}]]);assert.deepEqual(plans,[{storeId:'s',sku:'123',currency:'CNY'}]);const events=[],target={elements:Object.fromEntries(['storeId','sku','currency'].map(k=>[k,{value:'',dispatchEvent:e=>events.push(k+':'+e.type)}])),reset(){events.push('reset');},dispatchEvent:e=>events.push(e.type)};prepareWbEconomicsPlan(target,plans[0]);assert.deepEqual(events,['reset','storeId:change','sku:change','draft-restored']);assert.equal(target.elements.currency.value,'CNY');}finally{globalThis.document=oldDoc;globalThis.FormData=oldData;}
});
test('no-cost cached page becomes visibly stale even when no cost hashes exist, and persisted query rejects tampering',async t=>{
 const f=await fixture(t);const v=await f.service.get(f.store),cached=await f.service.skuCosts.query(f.store,source(v));assert.equal(wbEconomicsPage({...v,snapshot:{...v.snapshot,stale:true}},cached).stale,true);await allocate(f);await cost(f);const row=f.service.db.prepare("SELECT id,data FROM wb_sku_economics WHERE kind='cost'").get(),record=JSON.parse(row.data);record.contribution='1000';f.service.db.prepare('UPDATE wb_sku_economics SET data=? WHERE id=?').run(JSON.stringify(record),row.id);await assert.rejects(()=>f.service.skuCosts.query(f.store,source(v)),/证据校验失败/);
});

test('HTTP report parameters keep selected periods and missing periods do not fall back to the latest report',async t=>{
 const f=await fixture(t),old=await f.service.get(f.store),original=f.service.read,range={from:'2026-10-03',to:'2026-10-04'};
 f.service.read=async(...args)=>{const result=structuredClone(await original(...args));for(const row of result.rows){const day=row.dateFrom==='2026-10-01'?range.from:range.to;row.dateFrom=day;row.dateTo=day;}return result;};await f.service.start(f.store,{...range,restart:true});await f.service.wait(f.store.id);
 const query=wbStoredReportQuery(new URL('http://local/stores/wb/wb-finance?sku=123&from=2026-10-01&to=2026-10-02&ignored=1'));assert.deepEqual(query,{sku:'123',from:f.range.from,to:f.range.to});const selected=await f.service.get(f.store,query);assert.equal(selected.snapshot.runId,old.snapshot.runId);assert.notEqual((await f.service.get(f.store)).snapshot.runId,old.snapshot.runId);
 const missing=await f.service.get(f.store,wbStoredReportQuery(new URL('http://local/wb-finance?sku=123&from=2026-09-01&to=2026-09-02')));assert.equal(missing.snapshot,null);assert.deepEqual(missing.period,{from:'2026-09-01',to:'2026-09-02'});
});
