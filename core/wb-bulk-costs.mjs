import {randomUUID} from 'node:crypto';
import {hash,maskPII} from './repository.mjs';
import {wbDecimal,decimalText} from '../adapters/wb-finance.mjs';
export const WB_COST_COLUMNS=['nmID','currency','from','to','report_hash','allocation_hash','revision','cogs','tax','external'];
export const WB_COST_CHECKS=['costsReviewed','periodReviewed','noDoubleCount','sharedReviewed'];
export function costCSV(rows){return '\uFEFF'+[WB_COST_COLUMNS,...rows].map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');}
export function parseCostCSV(csv){
 if(typeof csv!=='string'||Buffer.byteLength(csv)>1500000)throw Error('成本表不能超过 1.5 MB');
 const text=csv.replace(/^\uFEFF/,''),first=text.split(/\r?\n/,1)[0],delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 const finish=()=>{row.push(cell);cell='';closed=false;};
 for(let i=0;i<text.length;i++){
  const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else {quoted=false;closed=true;}}else cell+=c;continue;}
  if(c===delimiter){finish();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;finish();rows.push(row);row=[];if(rows.length>5001)throw Error('每批最多 5000 个商品');continue;}
  if(closed)throw Error('CSV 引号后只能是分隔符或换行');
  if(c==='"'){if(cell)throw Error('CSV 引号格式错误');quoted=true;}else cell+=c;
 }
 if(quoted)throw Error('CSV 引号未闭合');if(cell||closed||row.length){finish();rows.push(row);}
 if(rows.length<2||rows.length>5001)throw Error('请填写 1–5000 行商品成本');
 if(JSON.stringify(rows.shift())!==JSON.stringify(WB_COST_COLUMNS))throw Error('表头不匹配，请下载当前成本模板');
 return rows.map((r,i)=>{if(r.length!==WB_COST_COLUMNS.length)throw Error(`第 ${i+2} 行列数不正确`);return Object.fromEntries(WB_COST_COLUMNS.map((k,j)=>[k,r[j]]));});
}
export class WbBulkCosts{
 constructor(costs){this.costs=costs;this.service=costs.service;this.db=costs.db;this.db.exec('CREATE TABLE IF NOT EXISTS wb_cost_batches(id TEXT PRIMARY KEY,store TEXT,owner TEXT,request_hash TEXT,data TEXT,UNIQUE(store,owner,request_hash))');}
 async scope(store,input){
  const ctx=await this.costs.context(store,input),records=this.costs.records(store,ctx.owner,ctx.s.period),latest=new Map();for(const r of records)if(r.kind==='cost'&&r.currency===input.currency)latest.set(r.sku,r);
  const shared=ctx.s.attribution.currencies[input.currency].shared.lines>0,allocation=shared?records.findLast(r=>r.kind==='allocation'&&r.currency===input.currency):null;
  if(shared&&ctx.view.allocations.find(a=>a.currency===input.currency)?.status!=='current')throw Error('请先确认当前公共费用分摊');
  return {...ctx,latest,allocation,parts:new Map((allocation?.rows||[]).map(r=>[r.sku,r])),eligible:[...ctx.products.keys()].filter(sku=>ctx.products.get(sku)[input.currency]).sort()};
 }
 async template(store,input){
  const c=await this.scope(store,input);if(c.eligible.length>5000)throw Error('当前期间超过 5000 个商品，请缩小报表期间后下载');
  if(!c.eligible.length)throw Error('此币种没有商品明细');
  return {count:c.eligible.length,currency:input.currency,period:c.s.period,csv:costCSV(c.eligible.map(sku=>[sku,input.currency,c.s.period.from,c.s.period.to,c.s.evidenceHash,c.allocation?.hash||'',c.latest.get(sku)?.revision||0,'','','']))};
 }
 evidence(input){if(typeof input.evidence!=='string'||input.evidence.trim().length<5||input.evidence.length>1000)throw Error('请填写 5–1000 字的成本依据');return maskPII(input.evidence.trim());}
 request(input){return hash({runId:input.runId,reportHash:input.reportHash,currency:input.currency,csvHash:hash(input.csv),evidence:this.evidence(input)});}
 async build(store,input){
  const parsed=parseCostCSV(input.csv),evidence=this.evidence(input),c=await this.scope(store,input),entries=[],rows=[],errors=[],seen=new Set();let errorCount=0;
  for(const [i,r] of parsed.entries())try{
   if(!/^[1-9]\d*$/.test(r.nmID)||!c.products.get(r.nmID)?.[input.currency])throw Error('nmID 无效或不属于此报表币种');
   if(seen.has(r.nmID))throw Error('nmID 重复');seen.add(r.nmID);
   if(r.currency!==input.currency||r.from!==c.s.period.from||r.to!==c.s.period.to||r.report_hash!==c.s.evidenceHash||r.allocation_hash!==(c.allocation?.hash||''))throw Error('币种、期间、报表或分摊已变化，请下载新模板');
   if(!/^(0|[1-9]\d*)$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision))||Number(r.revision)!==(c.latest.get(r.nmID)?.revision||0))throw Error('此商品保存版本已变化，请下载新模板');
   const draft=this.costs.costDraft(c.view,r.nmID,{...input,...r,evidence,allocationHash:c.allocation?.hash||null,...Object.fromEntries(WB_COST_CHECKS.map(k=>[k,true]))},c.products.get(r.nmID),c.allocation,c.parts.get(r.nmID));
   entries.push({draft,revision:Number(r.revision),line:i+2});rows.push({line:i+2,sku:r.nmID,revision:Number(r.revision),before:c.latest.get(r.nmID)?.costs||null,costs:draft.costs,platformNet:draft.platformNet,allocated:draft.allocated,contribution:draft.contribution});
  }catch(e){errorCount++;if(errors.length<30)errors.push({line:i+2,message:e.message});}
  const body={version:'wb-bulk-costs-v1',runId:c.s.runId,reportHash:c.s.evidenceHash,currency:input.currency,period:c.s.period,allocationHash:c.allocation?.hash||null,fileHash:hash(input.csv),evidence,eligible:c.eligible.length,selected:parsed.length,untouched:c.eligible.length-rows.length,rows,errors,errorCount,total:decimalText(rows.reduce((n,r)=>n+wbDecimal(r.contribution),0n))};
  return {context:c,entries,preview:{...body,previewHash:hash({store:store.id,owner:c.owner,...body})}};
 }
 async preview(store,input){return (await this.build(store,input)).preview;}
 receipt(store,owner,key){const row=this.db.prepare('SELECT data FROM wb_cost_batches WHERE store=? AND owner=? AND request_hash=?').get(store.id,owner,key);if(!row)return null;const r=JSON.parse(row.data),{hash:checksum,...body}=r;if(r.storeId!==store.id||r.accountRef!==owner||r.requestHash!==key||hash(body)!==checksum)throw Error('批次证据校验失败');const records=new Map(this.costs.records(store,owner,r.period).map(record=>[record.id,record]));if(r.records.some(link=>records.get(link.id)?.hash!==link.hash||records.get(link.id)?.batchId!==r.id))throw Error('批次商品证据校验失败');return r;}
 async confirm(store,input){
  parseCostCSV(input.csv);if(WB_COST_CHECKS.some(k=>input[k]!==true))throw Error('请完成全部成本确认');
  const owner=await this.service.identity(store),key=this.request(input),existing=this.receipt(store,owner,key);
  if(existing){if(existing.previewHash!==input.previewHash)throw Error('确认的预览版本不匹配');if(await this.service.accountRef(store)!==owner)throw Error('WB 账户已变化');return {id:existing.id,hash:existing.hash,count:existing.records.length,replayed:true};}
  const {context:c,entries,preview:p}=await this.build(store,input);
  if(c.owner!==owner||p.errorCount||p.previewHash!==input.previewHash)throw Error('表格有错误或预览已变化，请重新预览');
  if(await this.service.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新读取');
  const prior=this.receipt(store,owner,key);if(prior){if(prior.previewHash!==p.previewHash)throw Error('预览已变化');return {id:prior.id,hash:prior.hash,count:prior.records.length,replayed:true};}
  const id=randomUUID();let receipt;
  this.costs.insertMany(store,owner,entries.map(e=>({revision:e.revision,draft:{...e.draft,batchId:id,batchPreviewHash:p.previewHash,fileHash:p.fileHash,fileLine:e.line}})),{afterInsert:records=>{
   receipt={id,storeId:store.id,accountRef:owner,requestHash:key,previewHash:p.previewHash,fileHash:p.fileHash,runId:p.runId,reportHash:p.reportHash,period:p.period,currency:p.currency,allocationHash:p.allocationHash,evidence:p.evidence,checks:Object.fromEntries(WB_COST_CHECKS.map(k=>[k,true])),at:this.service.stamp(),records:records.map(r=>({id:r.id,hash:r.hash}))};receipt.hash=hash(receipt);this.db.prepare('INSERT INTO wb_cost_batches VALUES(?,?,?,?,?)').run(id,store.id,owner,key,JSON.stringify(receipt));
  }});
  return {id,hash:receipt.hash,count:entries.length,replayed:false};
 }
}
