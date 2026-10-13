import {randomUUID} from 'node:crypto';
import {hash,maskPII} from './repository.mjs';
import {wbDecimal,decimalText,wbInteger} from '../adapters/wb-finance.mjs';
import {WB_ATTRIBUTION_VERSION,WB_SETTLEMENT_WEIGHTS} from './wb-finance-attribution.mjs';
export const WB_ALLOCATION_VERSION='seller-weighted-fields-v1';
const fields=Object.keys(WB_SETTLEMENT_WEIGHTS),costFields=['cogs','tax','external'];
const abs=n=>n<0n?-n:n;
const text=value=>{if(typeof value!=='string'||value.trim().length<5||value.length>1000)throw Error('请填写 5–1000 字的依据说明');return maskPII(value.trim());};
function money(v){if(typeof v!=='string'||!/^[-+]?\d{1,13}(\.\d{1,6})?$/.test(v))throw Error('所有成本必填，最多六位小数；未知不能填零');const n=wbDecimal(v);if(abs(n)>1000000000000000000n)throw Error('金额超出范围');return decimalText(n);}
function current(view,input){
 const s=view.snapshot,c=input.currency;
 if(view.state!=='complete'||!s?.complete||s.stale||s.coverage?.byCurrency?.[c]?.missingDays?.length!==0||!s.attribution?.currencies?.[c]?.settlement?.matched)throw Error('请先完成此币种全部日期的财务读取及每日金额核对');
 if(input.runId!==s.runId||input.reportHash!==s.evidenceHash||s.attribution.version!==WB_ATTRIBUTION_VERSION)throw Error('财务或计算规则已变化，请重新打开核对');
 return s;
}
// Exact signed largest-remainder allocation. Zero weights never receive a share.
export function allocateWbAmount(amount,weights){
 if(!weights.length||new Set(weights.map(w=>w.sku)).size!==weights.length||weights.some(w=>wbDecimal(w.weight)<0n))throw Error('分摊权重无效');
 const n=wbDecimal(amount),total=weights.reduce((v,w)=>v+wbDecimal(w.weight),0n);if(total<=0n)throw Error('分摊权重总和必须大于 0');
 const rows=weights.map(w=>{const v=abs(n)*wbDecimal(w.weight);return {sku:w.sku,n:v/total,remainder:v%total};});
 let left=abs(n)-rows.reduce((v,r)=>v+r.n,0n);
 for(const r of [...rows].sort((a,b)=>a.remainder===b.remainder?(a.sku<b.sku?-1:1):a.remainder>b.remainder?-1:1)){if(left===0n)break;r.n++;left--;}
 return new Map(rows.map(r=>[r.sku,decimalText(n<0n?-r.n:r.n)]));
}
export function buildWbAllocation(view,products,input){
 const s=current(view,input),c=input.currency,b=s.attribution.currencies[c].shared;
 if(!b.lines)throw Error('此币种没有需要分摊的公共明细');
 const candidates=[...products].filter(([,cs])=>cs[c]).map(([sku,cs])=>({sku,goods:cs[c].fields.forPay.amount})).sort((a,b)=>a.sku<b.sku?-1:1);
 if(!candidates.length||candidates.length>10000)throw Error('分摊需要 1–10000 个有财务明细的商品');
 let weights;
 if(input.method==='positive_goods')weights=candidates.map(p=>({sku:p.sku,weight:decimalText(wbDecimal(p.goods)>0n?wbDecimal(p.goods):0n)}));
 else if(input.method==='manual'){
  if(typeof input.manualWeights!=='string'||input.manualWeights.length>500000)throw Error('请逐行填写 nmID,权重');
  const lines=input.manualWeights.trim().split(/\r?\n/),cells=line=>line.trim().split(/[,，\s]+/).map(v=>v.replace(/^"([^"]*)"$/,'$1'));
  if(cells(lines[0]).join(',').toLowerCase()==='nmid,weight')lines.shift();
  weights=lines.map(line=>{const parts=cells(line);if(parts.length!==2)throw Error('每行只能填写 nmID,权重');const sku=wbInteger(parts[0]),weight=money(parts[1]);if(wbDecimal(weight)<0n)throw Error('权重不能为负');return {sku,weight};});
  if(weights.length!==candidates.length||new Set(weights.map(w=>w.sku)).size!==weights.length||weights.some(w=>!products.get(w.sku)?.[c]))throw Error('自定义权重需包含此币种全部商品，每个 nmID 一行；无分摊填写 0');
  weights.sort((a,b)=>a.sku<b.sku?-1:1);
 }else throw Error('请选择分摊方法');
 const allocations=Object.fromEntries(fields.map(k=>[k,allocateWbAmount(b.fields[k].amount,weights)]));
 const rows=weights.map(w=>{const amounts=Object.fromEntries(fields.map(k=>[k,allocations[k].get(w.sku)]));return {...w,fields:amounts,amount:decimalText(fields.reduce((v,k)=>v+wbDecimal(amounts[k])*BigInt(WB_SETTLEMENT_WEIGHTS[k]),0n))};});
 if(rows.reduce((v,r)=>v+wbDecimal(r.amount),0n)!==wbDecimal(b.platformNet))throw Error('分摊合计未对上，禁止保存');
 const body={source:'seller_confirmed_allocation',rule:WB_ALLOCATION_VERSION,calculationVersion:WB_ATTRIBUTION_VERSION,runId:s.runId,reportHash:s.evidenceHash,period:{...s.period},currency:c,method:input.method,weights,rows,pool:{lines:b.lines,fields:Object.fromEntries(fields.map(k=>[k,b.fields[k].amount])),amount:b.platformNet},zeroWeightCount:weights.filter(w=>wbDecimal(w.weight)===0n).length};
 return {...body,previewHash:hash(body)};
}
function allocationStatus(record,view){const s=view.snapshot;if(!s||record.runId!==s.runId||record.reportHash!==s.evidenceHash||record.calculationVersion!==WB_ATTRIBUTION_VERSION||record.rule!==WB_ALLOCATION_VERSION)return 'superseded';try{current(view,{currency:record.currency,runId:record.runId,reportHash:record.reportHash});return 'current';}catch{return 'stale';}}
function costStatus(record,view,allocation){
 if(allocationStatus({...record,rule:WB_ALLOCATION_VERSION},view)!=='current')return allocationStatus({...record,rule:WB_ALLOCATION_VERSION},view);
 if(record.allocationHash!==(allocation?.hash||null))return 'superseded';
 if(allocation&&allocationStatus(allocation,view)!=='current')return 'stale';
 return record.reviewed?'current':'needs_review';
}
export class WbSkuContribution{
 constructor(service){this.service=service;this.db=service.db;this.db.exec(`
  CREATE TABLE IF NOT EXISTS wb_sku_economics(id TEXT PRIMARY KEY,store TEXT,owner TEXT,date_from TEXT,date_to TEXT,kind TEXT,subject TEXT,currency TEXT,revision INTEGER,data TEXT,UNIQUE(store,owner,date_from,date_to,kind,subject,currency,revision));
  CREATE INDEX IF NOT EXISTS wb_sku_economics_scope ON wb_sku_economics(store,owner,date_from,date_to);`);}
 records(store,owner,period){
  const records=this.db.prepare('SELECT data FROM wb_sku_economics WHERE store=? AND owner=? AND date_from=? AND date_to=? ORDER BY rowid').all(store.id,owner,period.from,period.to).map(r=>JSON.parse(r.data)),latest=new Map();
  for(const r of records){const {hash:checksum,...body}=r,key=JSON.stringify([r.kind,r.sku||'',r.currency]),old=latest.get(key);if(r.storeId!==store.id||r.accountRef!==owner||r.period.from!==period.from||r.period.to!==period.to||r.revision!==(old?.revision||0)+1||r.previous!==(old?.hash||'genesis')||hash(body)!==checksum)throw Error('WB 商品经济证据校验失败');latest.set(key,r);}
  return records;
 }
 async context(store,input){
  const owner=await this.service.identity(store),source=this.db.prepare('SELECT * FROM wb_finance_runs WHERE id=? AND store=? AND owner=?').get(input.runId||'',store.id,owner);if(!source)throw Error('财务来源不属于当前店铺账户');
  const range={from:source.date_from,to:source.date_to},view=await this.service.get(store,{sku:input.sku,...range}),s=current(view,input),run=this.service.latest(store,owner,range);
  if(await this.service.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新读取');
  if(this.service.pending.has(owner)||this.service.latest(store,owner,range)?.id!==s.runId||run?.state!=='complete')throw Error('财务正在更新，请完成后再保存');
  return {owner,view,s,products:this.service.attribution(run,this.service.reports(run.id),this.service.counts(run.id)).products};
 }
 insert(store,owner,draft,revision){return this.insertMany(store,owner,[{draft,revision}])[0];}
 insertMany(store,owner,entries,{afterInsert}={}){
  if(!entries.length||entries.length>5000)throw Error('一次保存需要 1–5000 个商品成本版本');
  this.db.exec('BEGIN IMMEDIATE');try{
   const first=entries[0].draft,run=this.service.latest(store,owner,first.period);if(this.service.pending.has(owner)||run?.id!==first.runId||run.state!=='complete'||this.service.clock()-Date.parse(run.updated)>86400000)throw Error('财务正在更新或已过期，请重新核对');
   const key=r=>JSON.stringify([r.kind,r.sku||'',r.currency]),latest=new Map(this.records(store,owner,first.period).map(r=>[key(r),r])),seen=new Set(),out=[],statement=this.db.prepare('INSERT INTO wb_sku_economics VALUES(?,?,?,?,?,?,?,?,?,?)');
   for(const {draft,revision} of entries){
    if(draft.runId!==first.runId||draft.reportHash!==first.reportHash||draft.period.from!==first.period.from||draft.period.to!==first.period.to||seen.has(key(draft)))throw Error('批次的期间、来源或商品重复，请重新预览');seen.add(key(draft));
    const old=latest.get(key(draft)),allocation=latest.get(JSON.stringify(['allocation','',draft.currency]));
    if(draft.kind==='cost'&&draft.allocationHash&&allocation?.hash!==draft.allocationHash)throw Error('分摊版本已变化，请重新核对商品成本');
    if(!Number.isSafeInteger(revision)||revision!==(old?.revision||0))throw Error('保存版本已变化，请重新打开核对');
    const record={id:randomUUID(),storeId:store.id,accountRef:owner,at:this.service.stamp(),...draft,revision:(old?.revision||0)+1,previous:old?.hash||'genesis'};record.hash=hash(record);
    statement.run(record.id,store.id,owner,draft.period.from,draft.period.to,draft.kind,draft.sku||'',draft.currency,record.revision,JSON.stringify(record));out.push(record);
   }
   afterInsert?.(out);this.db.exec('COMMIT');return out;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async preview(store,input){const {view,products}=await this.context(store,input),draft=buildWbAllocation(view,products,input);const old=view.allocations.find(a=>a.currency===input.currency);return {...draft,revision:old?.revision||0};}
 async allocate(store,input){
  const {owner,view,products}=await this.context(store,input),draft=buildWbAllocation(view,products,input);
  if(input.previewHash!==draft.previewHash||input.confirmed!==true)throw Error('请先预览并确认当前分摊版本');
  const evidence=text(input.evidence);if(await this.service.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新读取');
  const record=this.insert(store,owner,{kind:'allocation',...draft,evidence},input.revision);return {id:record.id,hash:record.hash,revision:record.revision};
 }
 costDraft(view,sku,input,product,allocation,part){
  const s=current(view,input),p=product?.[input.currency];if(!p||p.platformNet===null)throw Error('此商品没有可核对的财务明细');
  const shared=s.attribution.currencies[input.currency].shared.lines>0;
  if(shared&&(!allocation||allocationStatus(allocation,view)!=='current'||input.allocationHash!==allocation.hash))throw Error('请先确认当前公共费用分摊，再核对商品成本');
  if(!shared&&input.allocationHash!=null)throw Error('此期间不需要公共费用分摊');
  if(shared&&!part)throw Error('分摊中没有此商品');
  const costs=Object.fromEntries(costFields.map(k=>[k,money(input[k])])),checks=Object.fromEntries(['costsReviewed','periodReviewed','noDoubleCount','sharedReviewed'].map(k=>[k,input[k]===true])),allocated=shared?part.amount:'0';
  return {kind:'cost',source:'wb_sku_reports_seller_costs',sku,currency:input.currency,runId:s.runId,reportHash:s.evidenceHash,calculationVersion:WB_ATTRIBUTION_VERSION,period:{...s.period},allocationHash:shared?allocation.hash:null,allocationMethod:shared?allocation.method:'none',platformNet:p.platformNet,allocated,allocatedFields:shared?part.fields:null,costs,checks,reviewed:Object.values(checks).every(Boolean),evidence:text(input.evidence),contribution:decimalText(costFields.reduce((n,k)=>n-wbDecimal(costs[k]),wbDecimal(p.platformNet)+wbDecimal(allocated)))};
 }
 async reconcile(store,input){
  const sku=wbInteger(input.sku),{owner,view,s,products}=await this.context(store,{...input,sku}),records=this.records(store,owner,s.period),allocation=records.findLast(r=>r.kind==='allocation'&&r.currency===input.currency),part=allocation?.rows.find(r=>r.sku===sku),draft=this.costDraft(view,sku,input,products.get(sku),allocation,part);
  if(await this.service.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新读取');
  const r=this.insert(store,owner,draft,input.revision);return {id:r.id,hash:r.hash,revision:r.revision};
 }
 decorate(view,store,owner){
  if(!view.snapshot)return;
  const records=this.records(store,owner,view.snapshot.period),allocations=new Map(),costs=new Map();
  for(const r of records)if(r.kind==='allocation')allocations.set(r.currency,r);else costs.set(JSON.stringify([r.sku,r.currency]),r);
  view.allocations=[...allocations.values()].map(a=>({id:a.id,currency:a.currency,revision:a.revision,hash:a.hash,runId:a.runId,reportHash:a.reportHash,method:a.method,pool:a.pool,products:a.rows.length,zeroWeightCount:a.zeroWeightCount,evidence:a.evidence,at:a.at,status:allocationStatus(a,view),product:view.snapshot.product?a.rows.find(r=>r.sku===view.snapshot.product.sku)||null:null}));
  const publicCost=r=>{const {accountRef,...body}=r,allocation=view.snapshot.attribution.currencies[r.currency]?.shared.lines?allocations.get(r.currency):null;return {...body,status:costs.get(JSON.stringify([r.sku,r.currency]))?.id===r.id?costStatus(r,view,allocation):'revised'};};
  view.skuReconciliations=view.snapshot.product?records.filter(r=>r.kind==='cost'&&r.sku===view.snapshot.product.sku).map(publicCost):[];
  for(const p of view.snapshot.products)p.contributions=[...costs.values()].filter(r=>r.sku===p.sku).map(publicCost);
 }
}
