import test from 'node:test';import assert from 'node:assert/strict';
import {settlementFixture} from './helpers/wb-settlement-fixture.mjs';
import {parseCostCSV,costCSV,WB_COST_COLUMNS,WB_COST_CHECKS} from '../core/wb-bulk-costs.mjs';
import {wbBulkCostPanel,bulkCostReviewCSV,bindWbBulkCosts} from '../web/wb-bulk-costs.mjs';
const source=v=>({runId:v.snapshot.runId,reportHash:v.snapshot.evidenceHash,currency:'CNY'});
const checked=Object.fromEntries(WB_COST_CHECKS.map(k=>[k,true]));
async function fixture(t){const f=await settlementFixture();t.after(f.cleanup);await f.read();return f;}
async function allocate(f){const input={...source(await f.service.get(f.store)),method:'positive_goods'},p=await f.service.skuCosts.preview(f.store,input);return f.service.skuCosts.allocate(f.store,{...input,revision:p.revision,previewHash:p.previewHash,confirmed:true,evidence:'Synthetic allocation evidence'});}
async function input(f){const s=source(await f.service.get(f.store)),template=await f.service.bulkCosts.template(f.store,s),rows=parseCostCSV(template.csv);return {...s,csv:costCSV(rows.map(r=>WB_COST_COLUMNS.map(k=>({cogs:r.nmID==='123'?'300':'50',tax:r.nmID==='123'?'10':'0',external:r.nmID==='123'?'20':'0'}[k]??r[k])))),evidence:'Synthetic batch net costs and returns'};}
const change=(input,fn)=>{const rows=parseCostCSV(input.csv);fn(rows);return {...input,csv:costCSV(rows.map(r=>WB_COST_COLUMNS.map(k=>r[k])))};};
async function confirm(f,i){const p=await f.service.bulkCosts.preview(f.store,i);return f.service.bulkCosts.confirm(f.store,{...i,...checked,previewHash:p.previewHash});}

test('CSV supports BOM, quoted CRLF, TSV and semicolon; malformed syntax and excessive rows fail',()=>{
 const row=['123','CNY','2026-10-01','2026-10-02','a','b',0,'-1.123456','0','2'];
 for(const text of [costCSV([row]),[WB_COST_COLUMNS,row].map(r=>r.join('\t')).join('\r\n'),[WB_COST_COLUMNS,row].map(r=>r.join(';')).join('\n')])assert.equal(parseCostCSV(text)[0].cogs,'-1.123456');
 for(const text of ['nmID,x\n1,2',costCSV([row])+'"',costCSV([row]).replace('"123"','"123'),costCSV([row]).replace('"123"','1"23'),costCSV([row]).replace(',"2"',''),costCSV(Array(5001).fill(row)),'x'.repeat(1500001)])assert.throws(()=>parseCostCSV(text));
});
test('batch previews are local; exact signed contributions persist atomically with hash-linked receipt and survive restart',async t=>{
 const f=await fixture(t);await allocate(f);const reads=f.calls.length,i=await input(f),p=await f.service.bulkCosts.preview(f.store,i);
 assert.equal(p.errorCount,0);assert.equal(p.total,'362.4');assert.equal(p.selected,2);assert.equal(p.untouched,0);assert.equal(f.service.db.prepare("SELECT COUNT(*) n FROM wb_sku_economics WHERE kind='cost'").get().n,0);
 const receipt=await confirm(f,i);assert.equal(receipt.count,2);const costs=f.service.skuCosts.records(f.store,'synthetic-settlement-owner',f.range).filter(r=>r.kind==='cost');assert.ok(costs.every(r=>r.batchId===receipt.id&&r.batchPreviewHash===p.previewHash&&r.reviewed));assert.equal(costs[0].fileLine,2);
 f.reopen();const retry=await f.service.bulkCosts.confirm(f.store,{...i,...checked,previewHash:p.previewHash});assert.equal(retry.id,receipt.id);assert.equal(retry.replayed,true);assert.equal(f.calls.length,reads);assert.equal((await f.service.get(f.store,{sku:'123'})).skuReconciliations.length,1);
});
test('one invalid row prevents all writes; row errors cover blanks, formulas, IDs, duplicates and mixed source',async t=>{
 const f=await fixture(t);await allocate(f);const i=await input(f);
 for(const patch of [{cogs:''},{tax:'=1+2'},{external:'1e2'},{nmID:'1.23E2'},{nmID:'999'},{currency:'RUB'},{from:'2026-09-01'},{report_hash:'old'},{allocation_hash:'old'},{revision:'01'},{cogs:'1000000000000.000001'}]){const bad=change(i,r=>Object.assign(r[1],patch)),p=await f.service.bulkCosts.preview(f.store,bad);assert.equal(p.errorCount,1,JSON.stringify(patch));assert.equal(p.errors[0].line,3);await assert.rejects(()=>f.service.bulkCosts.confirm(f.store,{...bad,...checked,previewHash:p.previewHash}));}
 const dup=await f.service.bulkCosts.preview(f.store,change(i,r=>r.push(r[0])));assert.equal(dup.errorCount,1);assert.equal(dup.errors[0].line,4);assert.equal(f.service.db.prepare("SELECT COUNT(*) n FROM wb_sku_economics WHERE kind='cost'").get().n,0);
});
test('batch requires exact human approval; changed file, evidence and preview cannot be substituted',async t=>{
 const f=await fixture(t);await allocate(f);const i=await input(f),p=await f.service.bulkCosts.preview(f.store,i);
 for(const patch of [{previewHash:'wrong'},{costsReviewed:false},{periodReviewed:'true'},{noDoubleCount:false},{sharedReviewed:false},{evidence:'Different source evidence'},{csv:change(i,r=>r[0].cogs='1').csv}])await assert.rejects(()=>f.service.bulkCosts.confirm(f.store,{...i,...checked,previewHash:p.previewHash,...patch}));
 assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM wb_cost_batches').get().n,0);
});
test('subsets leave other products untouched; revised templates use current revisions and blank costs',async t=>{
 const f=await fixture(t);await allocate(f);const i=await input(f),subset=change(i,r=>r.splice(1));let p=await f.service.bulkCosts.preview(f.store,subset);assert.equal(p.untouched,1);await confirm(f,subset);
 const template=await f.service.bulkCosts.template(f.store,source(await f.service.get(f.store))),rows=parseCostCSV(template.csv);assert.equal(rows[0].revision,'1');assert.equal(rows[1].revision,'0');assert.ok(rows.every(r=>r.cogs===''&&r.tax===''&&r.external===''));
 p=await f.service.bulkCosts.preview(f.store,i);assert.equal(p.errorCount,1);const revised=change(await input(f),r=>{r.splice(1);r[0].external='-5.125';});await confirm(f,revised);const view=await f.service.get(f.store,{sku:'123'});assert.equal(view.skuReconciliations.at(-1).contribution,'343.747222');assert.equal(view.skuReconciliations[0].status,'revised');
});
test('report, allocation and account changes reject stale batches; receipt replay cannot cross accounts',async t=>{
 const f=await fixture(t);await allocate(f);const i=await input(f),p=await f.service.bulkCosts.preview(f.store,i);
 await allocate(f);assert.equal((await f.service.bulkCosts.preview(f.store,i)).errorCount,2);await assert.rejects(()=>f.service.bulkCosts.confirm(f.store,{...i,...checked,previewHash:p.previewHash}));
 const j=await input(f),q=await f.service.bulkCosts.preview(f.store,j);await confirm(f,j);f.service.accountRef=async()=> 'other';await assert.rejects(()=>f.service.bulkCosts.confirm(f.store,{...j,...checked,previewHash:q.previewHash}));f.service.accountRef=async()=> 'synthetic-settlement-owner';await f.read();await assert.rejects(()=>f.service.bulkCosts.preview(f.store,j));
});
test('transaction rollback removes every inserted cost if batch receipt fails',async t=>{
 const f=await fixture(t);await allocate(f);const i=await input(f);f.service.db.exec("CREATE TRIGGER reject_batch BEFORE INSERT ON wb_cost_batches BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END;");await assert.rejects(()=>confirm(f,i),/synthetic receipt failure/);assert.equal(f.service.db.prepare("SELECT COUNT(*) n FROM wb_sku_economics WHERE kind='cost'").get().n,0);f.service.db.exec('DROP TRIGGER reject_batch');assert.equal((await confirm(f,i)).count,2);
});
test('final transaction rejects concurrent SKU revision; account is checked after preparing all rows',async t=>{
 const f=await fixture(t);await allocate(f);const i=await input(f),p=await f.service.bulkCosts.preview(f.store,i),bulk=f.service.bulkCosts,original=bulk.build.bind(bulk);
 bulk.build=async(...args)=>{const result=await original(...args);const e=result.entries[1];f.service.skuCosts.insert(f.store,result.context.owner,e.draft,e.revision);return result;};await assert.rejects(()=>bulk.confirm(f.store,{...i,...checked,previewHash:p.previewHash}),/版本/);assert.equal(f.service.db.prepare("SELECT COUNT(*) n FROM wb_sku_economics WHERE kind='cost'").get().n,1);
 bulk.build=original;const j=await input(f),q=await bulk.preview(f.store,j);bulk.build=async(...args)=>{const result=await original(...args);f.service.accountRef=async()=> 'rotated';return result;};await assert.rejects(()=>bulk.confirm(f.store,{...j,...checked,previewHash:q.previewHash}),/账户/);assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM wb_cost_batches').get().n,0);
});
test('5000 report products are exported and saved, independent of the home shortlist',async t=>{
 const f=await fixture(t),read=f.service.read;f.service.read=async(...args)=>{const out=structuredClone(await read(...args));if(args[2]==='details'&&out.rows.length){const second=out.rows.find(r=>r.nmId==='456');second.forPay='99.995002';const extra=structuredClone(second);for(const k of Object.keys(extra))if(typeof extra[k]==='string'&&/^(\d+)(\.\d+)?$/.test(extra[k])&&!['reportId','rrdId','nmId'].includes(k))extra[k]='0';extra.forPay='0.000001';extra.quantity=0;out.rows.push(...Array.from({length:4998},(_,n)=>({...extra,nmId:String(n+1000),rrdId:String(n+100)})));}return out;};await f.read();await allocate(f);
 const i=await input(f),p=await f.service.bulkCosts.preview(f.store,i);assert.equal(p.eligible,5000);assert.equal(p.rows.length,5000);assert.ok((await f.service.get(f.store)).snapshot.products.length<=5);assert.equal((await confirm(f,i)).count,5000);assert.equal(f.service.db.prepare("SELECT COUNT(*) n FROM wb_sku_economics WHERE kind='cost'").get().n,5000);
 const html=wbBulkCostPanel(await f.service.get(f.store),f.store.id,{input:i,preview:p});assert.match(html,/20 \/ 5000/);assert.equal(bulkCostReviewCSV(p).split('\r\n').length,5001);
});
test('Chinese UI gates are unchecked, errors block confirmation and source changes disable old previews',async t=>{
 const f=await fixture(t);await allocate(f);const i=await input(f),p=await f.service.bulkCosts.preview(f.store,i),v=await f.service.get(f.store);let html=wbBulkCostPanel(v,f.store.id,{input:i,preview:p});assert.doesNotMatch(html,/ checked/);assert.match(html,/确认保存 2 个商品成本/);assert.match(html,/本批依据/);assert.match(html,/模板成本初始为空/);
 html=wbBulkCostPanel({...v,snapshot:{...v.snapshot,stale:true}},f.store.id,{input:i,preview:p});assert.match(html,/disabled>确认保存/);
 const bad=await f.service.bulkCosts.preview(f.store,change(i,r=>r[0].cogs=''));html=wbBulkCostPanel(v,f.store.id,{input:i,preview:bad});assert.doesNotMatch(html,/data-wb-bulk-confirm/);assert.match(html,/整批不会保存/);
});
test('form handlers submit selected local file, exact preview and explicit checks to the persisted service',async t=>{
 const f=await fixture(t);await allocate(f);const i=await input(f),reads=f.calls.length,oldDoc=globalThis.document,oldData=globalThis.FormData,forms={};let draft,work,refreshed=0;const routes=[];
 const upload={dataset:{store:f.store.id,currency:'CNY',run:i.runId,source:i.reportHash},elements:{file:{files:[{size:i.csv.length,text:async()=>i.csv}]},evidence:{value:i.evidence}},querySelector:()=>({})};forms['[data-wb-bulk-input]']=[upload];globalThis.document={querySelectorAll:s=>forms[s]||[]};globalThis.FormData=class extends Map{constructor(f){super(Object.entries(f.values));}};
 const opts={api:async(path,body)=>{routes.push(path.split('/').at(-1));return f.service.bulkCosts[path.endsWith('preview')?'preview':'confirm'](f.store,body);},action:fn=>{work=fn();},refresh:async()=>{refreshed++;},getDraft:()=>draft,setDraft:(_id,d)=>{draft=d;}};
 try{bindWbBulkCosts(opts);upload.onsubmit({preventDefault(){}});await work;assert.equal(draft.preview.rows.length,2);const form={dataset:{store:f.store.id},values:checked};forms['[data-wb-bulk-confirm]']=[form];bindWbBulkCosts(opts);form.onsubmit({preventDefault(){}});await work;assert.equal(draft,null);assert.equal(refreshed,1);assert.deepEqual(routes,['wb-cost-preview','wb-cost-confirm']);assert.equal(f.calls.length,reads);draft={preview:{previewHash:'old'}};upload.elements.file.files=[];upload.onsubmit({preventDefault(){}});await assert.rejects(()=>work,/请选择/);assert.equal(draft,null);}finally{globalThis.document=oldDoc;globalThis.FormData=oldData;}
});
test('batch audit masks seller evidence and detects altered receipt or missing linked cost records',async t=>{
 const f=await fixture(t);await allocate(f);const i={...await input(f),evidence:'Synthetic cost source person@example.com +79991234567'},p=await f.service.bulkCosts.preview(f.store,i);assert.match(p.evidence,/\[EMAIL\]/);await confirm(f,i);
 const row=f.service.db.prepare('SELECT id,data FROM wb_cost_batches').get(),original=JSON.parse(row.data);f.service.db.prepare("DELETE FROM wb_sku_economics WHERE kind='cost' AND subject='456'").run();await assert.rejects(()=>f.service.bulkCosts.confirm(f.store,{...i,...checked,previewHash:p.previewHash}),/批次商品证据/);
 f.service.db.prepare('UPDATE wb_cost_batches SET data=? WHERE id=?').run(JSON.stringify({...original,evidence:'Changed evidence'}),row.id);await assert.rejects(()=>f.service.bulkCosts.confirm(f.store,{...i,...checked,previewHash:p.previewHash}),/批次证据/);
});
test('error list is bounded while reporting every invalid row; blocked source never yields a usable template',async t=>{
 const f=await fixture(t);await assert.rejects(async()=>f.service.bulkCosts.template(f.store,source(await f.service.get(f.store))),/分摊/);await allocate(f);const i=await input(f),rows=parseCostCSV(i.csv),bad={...i,csv:costCSV(Array.from({length:40},()=>WB_COST_COLUMNS.map(k=>({...rows[0],cogs:''})[k])))};const p=await f.service.bulkCosts.preview(f.store,bad);assert.equal(p.errorCount,40);assert.equal(p.errors.length,30);assert.equal(p.rows.length,0);
 f.service.clock=()=>Date.parse('2026-10-15T01:00:00Z');await assert.rejects(()=>f.service.bulkCosts.template(f.store,i),/每日金额/);
});
