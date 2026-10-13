import test from 'node:test';import assert from 'node:assert/strict';
import {settlementFixture} from './helpers/wb-settlement-fixture.mjs';
import {allocateWbAmount,buildWbAllocation} from '../core/wb-sku-contribution.mjs';
import {wbDecimal} from '../adapters/wb-finance.mjs';
import {wbAllocationPanel,wbSkuContributionPanel,wbSkuContributionValue,allocationCSV,bindWbSkuContribution} from '../web/wb-sku-contribution.mjs';
async function fixture(t){const f=await settlementFixture();t.after(f.cleanup);const view=await f.read();return {...f,get service(){return f.service;},f,view};}
const source=v=>({runId:v.snapshot.runId,reportHash:v.snapshot.evidenceHash,currency:'CNY'});
async function allocation(f,patch={}){const input={...source(await f.service.get(f.store)),method:'positive_goods',...patch},p=await f.service.skuCosts.preview(f.store,input);await f.service.skuCosts.allocate(f.store,{...input,revision:p.revision,previewHash:p.previewHash,confirmed:true,evidence:'Synthetic allocation: reviewed all products and fees.'});return p;}
async function costInput(f,patch={}){const v=await f.service.get(f.store,{sku:patch.sku||'123'});return {...source(v),sku:'123',allocationHash:v.allocations.find(a=>a.currency==='CNY')?.hash||null,revision:0,cogs:'300',tax:'10',external:'20',costsReviewed:true,periodReviewed:true,noDoubleCount:true,sharedReviewed:true,evidence:'Synthetic period costs: sales net of returns.',...patch};}

test('signed largest-remainder allocation conserves every micro-unit and excludes zero weights',()=>{
 const weights=[{sku:'1',weight:'1'},{sku:'2',weight:'1'},{sku:'3',weight:'0'}];
 assert.deepEqual([...allocateWbAmount('0.000003',weights)],[['1','0.000002'],['2','0.000001'],['3','0']]);
 assert.deepEqual([...allocateWbAmount('-0.000003',weights)],[['1','-0.000002'],['2','-0.000001'],['3','0']]);
 for(const w of [[],[{sku:'1',weight:'0'}],[{sku:'1',weight:'-1'}],weights.concat(weights[0])])assert.throws(()=>allocateWbAmount('1',w));
 const many=Array.from({length:5000},(_,i)=>({sku:String(i+1),weight:String(i%9)})),out=allocateWbAmount('-123456.123456',many);assert.equal([...out.values()].reduce((v,n)=>v+wbDecimal(n),0n),wbDecimal('-123456.123456'));assert.equal(out.get('1'),'0');
});
test('preview is local and cannot save an allocation without exact version and human confirmation',async t=>{
 const f=await fixture(t),reads=f.calls.length,input={...source(f.view),method:'positive_goods'},p=await f.service.skuCosts.preview(f.store,input);
 assert.equal(f.calls.length,reads);assert.equal((await f.service.get(f.store)).allocations.length,0);assert.equal(p.rows.length,2);assert.equal(p.pool.amount,'-56');assert.equal(p.rows.find(r=>r.sku==='123').amount,'-49.777778');
 for(const patch of [{confirmed:false},{previewHash:'wrong'},{method:'manual',manualWeights:'123,1\n456,0'}])await assert.rejects(()=>f.service.skuCosts.allocate(f.store,{...input,previewHash:p.previewHash,revision:0,confirmed:true,evidence:'Test allocation evidence',...patch}));
 await allocation(f);assert.equal((await f.service.get(f.store)).allocations[0].status,'current');assert.equal(f.calls.length,reads);
});
test('manual weights cover all report SKUs exactly; unknown, duplicate, negative and zero-only input fail',async t=>{
 const f=await fixture(t),base={...source(f.view),method:'manual'};
 for(const manualWeights of ['123,1','123,1\n123,2','123,1\n999,2','123,-1\n456,2','123,0\n456,0','123,1e2\n456,2','123,1,extra\n456,2'])await assert.rejects(()=>f.service.skuCosts.preview(f.store,{...base,manualWeights}));
 const p=await f.service.skuCosts.preview(f.store,{...base,manualWeights:'456,0\n123,8'});assert.equal(p.rows.find(r=>r.sku==='123').amount,'-56');assert.equal(p.rows.find(r=>r.sku==='456').amount,'0');assert.equal(p.zeroWeightCount,1);
});
test('per-SKU contribution uses exact report amount, confirmed shared allocation and signed seller costs',async t=>{
 const f=await fixture(t);await assert.rejects(async()=>f.service.skuCosts.reconcile(f.store,await costInput(f)),/分摊/);await allocation(f);
 await f.service.skuCosts.reconcile(f.store,await costInput(f));await f.service.skuCosts.reconcile(f.store,await costInput(f,{sku:'456',cogs:'50',tax:'0',external:'0'}));
 const v=await f.service.get(f.store),records=v.snapshot.products.flatMap(p=>p.contributions);assert.deepEqual(records.map(r=>r.status),['current','current']);
 assert.equal(records.find(r=>r.sku==='123').contribution,'318.622222');assert.equal(records.reduce((n,r)=>n+wbDecimal(r.contribution),0n),wbDecimal('362.4'));assert.equal(v.reconciliations.length,0);
 const reads=f.calls.length;f.f.reopen();const restored=await f.service.get(f.store,{sku:'123'});assert.equal(restored.skuReconciliations[0].status,'current');assert.equal(f.calls.length,reads);
});
test('unknown amounts and missing checks do not become a reviewed contribution',async t=>{
 const f=await fixture(t);await allocation(f);const input=await costInput(f);
 for(const patch of [{cogs:''},{cogs:0},{cogs:'1e2'},{tax:undefined},{external:'1000000000000.000001'},{currency:'RUB'},{sku:'999'},{evidence:'x'},{allocationHash:'other'}])await assert.rejects(()=>f.service.skuCosts.reconcile(f.store,{...input,...patch}));
 await f.service.skuCosts.reconcile(f.store,{...input,external:'-5.125',costsReviewed:false});const v=await f.service.get(f.store,{sku:'123'}),r=v.skuReconciliations[0];assert.equal(r.status,'needs_review');assert.equal(r.contribution,'343.747222');assert.doesNotMatch(wbSkuContributionValue({...v.snapshot.product,contributions:[r]}),/343\.747222/);
});
test('allocation revision invalidates all prior SKU results and stale confirmation cannot overwrite it',async t=>{
 const f=await fixture(t),p=await allocation(f);const input=await costInput(f);await f.service.skuCosts.reconcile(f.store,input);await allocation(f,{method:'manual',manualWeights:'123,1\n456,0'});
 const v=await f.service.get(f.store,{sku:'123'});assert.equal(v.skuReconciliations[0].status,'superseded');assert.doesNotMatch(wbSkuContributionValue({...v.snapshot.product,contributions:v.skuReconciliations}),/318\.622222/);
 await assert.rejects(()=>f.service.skuCosts.reconcile(f.store,{...input,revision:1}),/分摊/);await assert.rejects(()=>f.service.skuCosts.allocate(f.store,{...source(f.view),method:'positive_goods',previewHash:p.previewHash,revision:0,confirmed:true,evidence:'Test old confirmation'}),/版本/);
 await f.service.skuCosts.reconcile(f.store,await costInput(f,{revision:1}));assert.equal((await f.service.get(f.store,{sku:'123'})).skuReconciliations[1].contribution,'312.4');
});
test('simultaneous cost edits preserve one winner and immutable hash-linked history',async t=>{
 const f=await fixture(t);await allocation(f);const input=await costInput(f);await f.service.skuCosts.reconcile(f.store,input);
 const rs=await Promise.allSettled(['310','320'].map(cogs=>f.service.skuCosts.reconcile(f.store,{...input,revision:1,cogs})));assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);
 const h=(await f.service.get(f.store,{sku:'123'})).skuReconciliations;assert.equal(h.length,2);assert.equal(h[1].previous,h[0].hash);assert.equal(h[0].status,'revised');
});
test('report refresh, daily discrepancies and stale snapshots block allocations and hide prior SKU contribution',async t=>{
 const f=await fixture(t);await allocation(f);await f.service.skuCosts.reconcile(f.store,await costInput(f));
 const fresh=await f.f.read();assert.equal(fresh.allocations[0].status,'superseded');assert.equal(fresh.skuReconciliations[0].status,'superseded');await assert.rejects(()=>f.service.skuCosts.preview(f.store,{...source(f.view),method:'positive_goods'}),/变化/);
 f.f.difference=true;const bad=await f.f.read();await assert.rejects(()=>f.service.skuCosts.preview(f.store,{...source(bad),method:'positive_goods'}),/每日金额/);
 f.f.difference=false;const good=await f.f.read();f.service.clock=()=>Date.parse(good.snapshot.at)+86400001;await assert.rejects(()=>f.service.skuCosts.preview(f.store,{...source(good),method:'positive_goods'}),/每日金额/);
});
test('store/account scope and tampered ledger evidence cannot be reused',async t=>{
 const f=await fixture(t);await allocation(f);await f.service.skuCosts.reconcile(f.store,await costInput(f,{evidence:'Cost proof person@example.com +79991234567'}));
 const v=await f.service.get(f.store,{sku:'123'});assert.match(v.skuReconciliations[0].evidence,/\[EMAIL\]/);assert.equal((await f.service.get({...f.store,id:'alias'})).snapshot,null);
 const original=f.service.accountRef;f.service.accountRef=async()=> 'rotated';assert.equal((await f.service.get(f.store)).snapshot,null);f.service.accountRef=original;
 const r=f.service.db.prepare("SELECT id,data FROM wb_sku_economics WHERE kind='cost'").get(),body=JSON.parse(r.data);body.costs.cogs='1';f.service.db.prepare('UPDATE wb_sku_economics SET data=? WHERE id=?').run(JSON.stringify(body),r.id);await assert.rejects(()=>f.service.get(f.store),/证据校验失败/);
});
test('UI shows explicit local approval, unfilled cost inputs and evidence-version blocks without prechecked gates',async t=>{
 const f=await fixture(t),input={...source(f.view),method:'positive_goods'},p=await f.service.skuCosts.preview(f.store,input);
 let h=wbAllocationPanel(f.view,f.store.id,p);assert.match(h,/下载完整分摊明细 CSV/);assert.doesNotMatch(h,/ checked/);assert.match(h,/确认并保存此分摊/);assert.equal(allocationCSV(p).split('\r\n').length,3);
 await allocation(f);const v=await f.service.get(f.store,{sku:'123'});h=wbSkuContributionPanel(v,f.store.id);assert.match(h,/name="cogs"[^>]+value=""/);assert.doesNotMatch(h,/ checked/);assert.match(h,/name="sharedReviewed"/);
 const stale={...v,snapshot:{...v.snapshot,stale:true}};assert.match(wbAllocationPanel(stale,f.store.id,p),/确认并保存此分摊/);assert.match(wbSkuContributionPanel(stale,f.store.id),/先完成报表核对/);
 assert.match(wbSkuContributionValue({attribution:{CNY:{},RUB:{}},contributions:[{currency:'CNY',status:'current',contribution:'1'}]}),/RUB 待核算/);
 const csv=allocationCSV(p,true);const roundTrip=await f.service.skuCosts.preview(f.store,{...input,method:'manual',manualWeights:csv});assert.deepEqual(roundTrip.weights,p.weights);
});
test('a zero shared net still requires approval of the offsetting fields; 5000 products use the full financial scope',async t=>{
 const f=await fixture(t),v=structuredClone(f.view),b=v.snapshot.attribution.currencies.CNY.shared;for(const k of Object.keys(b.fields))b.fields[k].amount='0';b.fields.forPay.amount='1';b.fields.deduction.amount='1';b.platformNet='0';
 const products=new Map(Array.from({length:5000},(_,i)=>[String(i+1),{CNY:{fields:{forPay:{amount:'1'}}}}]));const p=buildWbAllocation(v,products,{...source(v),method:'positive_goods'});assert.equal(p.rows.length,5000);assert.equal(p.rows[0].fields.forPay,'0.0002');assert.equal(p.rows[0].fields.deduction,'0.0002');assert.equal(p.rows[0].amount,'0');assert.equal(p.pool.lines,1);
 const noPositive=new Map([['1',{CNY:{fields:{forPay:{amount:'-1'}}}}]]);assert.throws(()=>buildWbAllocation(v,noPositive,{...source(v),method:'positive_goods'}),/大于 0/);assert.equal(buildWbAllocation(v,noPositive,{...source(v),method:'manual',manualWeights:'1,1'}).rows[0].weight,'1');
});
test('no shared rows needs no allocation, even when an older period-version allocation exists',async t=>{
 const f=await fixture(t);await allocation(f);const read=f.service.read;f.service.read=async(...args)=>{const out=structuredClone(await read(...args));if(args[2]==='list')for(const r of out.rows)if(r.reportId==='1'){r.paidStorageSum='0';r.deductionSum='0';r.paymentSchedule='0';r.bankPaymentSum='698.4';}if(args[2]==='details')out.rows=out.rows.filter(r=>r.nmId!=='0');return out;};
 await f.f.read();const input=await costInput(f,{allocationHash:null});await f.service.skuCosts.reconcile(f.store,input);const v=await f.service.get(f.store,{sku:'123'});assert.equal(v.skuReconciliations[0].contribution,'368.4');assert.equal(v.skuReconciliations[0].status,'current');assert.equal(v.skuReconciliations[0].allocationMethod,'none');assert.equal(v.allocations[0].status,'superseded');
});
test('final commit rejects a source refresh or token rotation occurring after preview validation',async t=>{
 const f=await fixture(t),input={...source(f.view),method:'positive_goods'},p=await f.service.skuCosts.preview(f.store,input),original=f.service.accountRef;
 let calls=0;f.service.accountRef=async(...args)=>{calls++;if(calls===5)f.service.db.prepare("UPDATE wb_finance_runs SET state='waiting' WHERE id=?").run(p.runId);return original(...args);};
 await assert.rejects(()=>f.service.skuCosts.allocate(f.store,{...input,previewHash:p.previewHash,revision:0,confirmed:true,evidence:'Race test evidence'}),/正在更新/);assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM wb_sku_economics').get().n,0);
 f.service.db.prepare("UPDATE wb_finance_runs SET state='complete' WHERE id=?").run(p.runId);calls=0;f.service.accountRef=async(...args)=>++calls===5?'new-owner':original(...args);
 await assert.rejects(()=>f.service.skuCosts.allocate(f.store,{...input,previewHash:p.previewHash,revision:0,confirmed:true,evidence:'Race test evidence'}),/账户已变化/);assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM wb_sku_economics').get().n,0);
});
test('form handlers connect preview, exact confirmation and SKU cost save to the persisted service without marketplace calls',async t=>{
 const f=await fixture(t),reads=f.calls.length,oldDocument=globalThis.document,oldFormData=globalThis.FormData;
 const forms={},controls={hidden:true};let draft=null,work,refreshed=0;const routes=[];
 const form=(dataset,values)=>({dataset,values,elements:{method:{value:'positive_goods'},manualWeights:{disabled:true}},querySelector:()=>controls,addEventListener:()=>{}});
 const preview=form({store:f.store.id,currency:'CNY',run:f.view.snapshot.runId,source:f.view.snapshot.evidenceHash},{method:'positive_goods'});forms['[data-wb-allocation-preview]']=[preview];
 globalThis.document={querySelectorAll:s=>forms[s]||[]};globalThis.FormData=class extends Map{constructor(form){super(Object.entries(form.values));}};
 const options={api:async(path,body)=>{routes.push(path);if(path.endsWith('/wb-allocation-preview'))return f.service.skuCosts.preview(f.store,body);if(path.endsWith('/wb-allocation-confirm'))return f.service.skuCosts.allocate(f.store,body);if(path.endsWith('/wb-sku-reconcile'))return f.service.skuCosts.reconcile(f.store,body);throw Error('Unexpected route');},action:fn=>{work=fn();},refresh:async()=>{refreshed++;},getPreview:()=>draft,setPreview:(_id,p)=>{draft=p;},showHome:()=>{}};
 try{
  bindWbSkuContribution(options);preview.onsubmit({preventDefault(){}});await work;assert.ok(draft.previewHash);assert.equal((await f.service.get(f.store)).allocations.length,0);
  const confirm=form({store:f.store.id},{evidence:'Reviewed synthetic allocation',confirmed:'on'});forms['[data-wb-allocation-confirm]']=[confirm];bindWbSkuContribution(options);confirm.onsubmit({preventDefault(){}});await work;assert.equal(draft,null);
  const input=await costInput(f),save=form({store:f.store.id,sku:'123',currency:'CNY',run:input.runId,source:input.reportHash,allocation:input.allocationHash},{revision:'0',cogs:'300',tax:'10',external:'20',evidence:'Reviewed synthetic cost sources',costsReviewed:'on',periodReviewed:'on',noDoubleCount:'on',sharedReviewed:'on'});forms['[data-wb-sku-cost]']=[save];bindWbSkuContribution(options);save.onsubmit({preventDefault(){}});await work;
  assert.equal(refreshed,1);assert.equal((await f.service.get(f.store,{sku:'123'})).skuReconciliations[0].status,'current');assert.equal(f.calls.length,reads);assert.deepEqual(routes.map(p=>p.split('/').at(-1)),['wb-allocation-preview','wb-allocation-confirm','wb-sku-reconcile']);
 }finally{globalThis.document=oldDocument;globalThis.FormData=oldFormData;}
});
