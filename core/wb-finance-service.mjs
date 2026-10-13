import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './repository.mjs';
import {reconcileWbContribution,wbContributionStatus} from './wb-contribution.mjs';
import {WbBulkCosts} from './wb-bulk-costs.mjs';
import {WbSkuContribution} from './wb-sku-contribution.mjs';
import {attributeWbFinance,wbAttributionSummary} from './wb-finance-attribution.mjs';
import {wbAccount} from '../adapters/wb-api.mjs';
import {readWbFinance,wbFinanceRange,financeRequest,normalizeWbReport,normalizeWbFinanceRow,addDecimal,WB_FINANCE_INTERVAL,wbInteger} from '../adapters/wb-finance.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const decode=r=>JSON.parse(r.data);
// Single-process, account-bound reader. GET only reads the local cache; no automatic retries after errors.
export class WbFinanceService{
 constructor(file,{read=readWbFinance,accountRef=wbAccount,clock=()=>Date.now(),sleep=pause}={}){
  mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);chmodSync(file,0o600);
  Object.assign(this,{read,accountRef,clock,sleep});this.pending=new Map();this.attributionCache=new Map();
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS wb_finance_runs(id TEXT PRIMARY KEY,store TEXT,owner TEXT,date_from TEXT,date_to TEXT,state TEXT,phase TEXT,cursor TEXT,at TEXT,updated TEXT,error TEXT);
   CREATE TABLE IF NOT EXISTS wb_finance_reports(run TEXT,id TEXT,data TEXT,PRIMARY KEY(run,id));
   CREATE TABLE IF NOT EXISTS wb_finance_rows(run TEXT,id TEXT,report TEXT,sku TEXT,data TEXT,PRIMARY KEY(run,id));
   CREATE INDEX IF NOT EXISTS wb_finance_sku ON wb_finance_rows(run,sku);
   CREATE TABLE IF NOT EXISTS wb_finance_attempts(id INTEGER PRIMARY KEY,run TEXT,at TEXT,phase TEXT,cursor TEXT,state TEXT,input_hash TEXT,output_hash TEXT,error TEXT);
   CREATE TABLE IF NOT EXISTS wb_finance_limits(owner TEXT PRIMARY KEY,retry_at INTEGER);
   CREATE TABLE IF NOT EXISTS wb_finance_costs(id TEXT PRIMARY KEY,store TEXT,owner TEXT,date_from TEXT,date_to TEXT,currency TEXT,revision INTEGER,data TEXT,UNIQUE(store,owner,date_from,date_to,currency,revision));
   UPDATE wb_finance_attempts SET state='interrupted',error='服务重启：上次请求未保存结果' WHERE state='reading';
   UPDATE wb_finance_runs SET state='interrupted',error='上次读取被中断，可以继续' WHERE state IN ('reading','waiting');`);
  this.skuCosts=new WbSkuContribution(this);this.bulkCosts=new WbBulkCosts(this.skuCosts);
 }
 stamp(){return new Date(this.clock()).toISOString();}
 async identity(store){if(store.mode!=='live'||store.marketplace!=='wb')throw Error('只支持真实 WB 店铺');return this.accountRef(store);}
 latest(store,owner,range=null){return range?this.db.prepare('SELECT * FROM wb_finance_runs WHERE store=? AND owner=? AND date_from=? AND date_to=? ORDER BY rowid DESC LIMIT 1').get(store.id,owner,range.from,range.to):this.db.prepare('SELECT * FROM wb_finance_runs WHERE store=? AND owner=? ORDER BY rowid DESC LIMIT 1').get(store.id,owner);}
 deadline(owner){return this.db.prepare('SELECT retry_at FROM wb_finance_limits WHERE owner=?').get(owner)?.retry_at||0;}
 reports(id){return this.db.prepare('SELECT data FROM wb_finance_reports WHERE run=? ORDER BY id').all(id).map(decode);}
 counts(id){return {reports:this.db.prepare('SELECT COUNT(*) n FROM wb_finance_reports WHERE run=?').get(id).n,rows:this.db.prepare('SELECT COUNT(*) n FROM wb_finance_rows WHERE run=?').get(id).n};}
 attribution(run,reports,counts){
  const key=JSON.stringify([run.id,counts.reports,counts.rows,run.updated]);
  if(this.attributionCache.has(key))return this.attributionCache.get(key);
  const iterator=this.db.prepare('SELECT data FROM wb_finance_rows WHERE run=? ORDER BY rowid').iterate(run.id);
  function* rows(){for(const r of iterator)yield decode(r);}
  const result=attributeWbFinance(reports,rows());
  if(this.attributionCache.size>=2)this.attributionCache.delete(this.attributionCache.keys().next().value);
  this.attributionCache.set(key,result);return result;
 }
 async get(store,{sku,from,to}={}){
  const owner=await this.identity(store),range=from!=null||to!=null?wbFinanceRange({from,to},this.clock()):null,run=this.latest(store,owner,range);if(sku!=null)sku=wbInteger(sku);
  if(!run)return {state:'idle',snapshot:null,retryAt:this.deadline(owner)||null};
  // Preserve a completed snapshot while a same-period refresh is incomplete. Different periods never mix.
  const good=this.db.prepare("SELECT * FROM wb_finance_runs WHERE store=? AND owner=? AND date_from=? AND date_to=? AND state='complete' ORDER BY rowid DESC LIMIT 1").get(store.id,owner,run.date_from,run.date_to);
  const chosen=run.state==='complete'?run:good||run,reports=this.reports(chosen.id),totals={};
  for(const r of reports){const t=totals[r.currency]??={};for(const [k,v] of Object.entries(r.amounts))t[k]=addDecimal(t[k],v);}
  const days=[];for(let d=Date.parse(chosen.date_from);d<=Date.parse(chosen.date_to);d+=86400000)days.push(new Date(d).toISOString().slice(0,10));
  const present=new Set(reports.map(r=>r.from)),missingDays=days.filter(d=>!present.has(d)),byCurrency=Object.fromEntries(Object.keys(totals).map(c=>{const found=new Set(reports.filter(r=>r.currency===c).map(r=>r.from));return [c,{reportedDays:found.size,missingDays:days.filter(d=>!found.has(d))}];}));
  const coverage=this.counts(chosen.id),attribution=this.attribution(chosen,reports,coverage),unallocated=this.db.prepare("SELECT COUNT(*) n FROM wb_finance_rows WHERE run=? AND sku='0'").get(chosen.id).n;
  const products=this.db.prepare(`SELECT sku,MAX(json_extract(data,'$.title')) name,COUNT(*) lines,
   SUM(CASE WHEN json_extract(data,'$.document')='Продажа' AND json_extract(data,'$.operation')='Продажа' THEN json_extract(data,'$.quantity') ELSE 0 END) sales,
   SUM(CASE WHEN json_extract(data,'$.document')='Возврат' AND json_extract(data,'$.operation')='Возврат' THEN json_extract(data,'$.quantity') ELSE 0 END) returns
   FROM wb_finance_rows WHERE run=? AND sku<>'0' GROUP BY sku ORDER BY lines DESC,sku LIMIT 5`).all(chosen.id).map(p=>({...p,attribution:attribution.products.get(p.sku)||{}}));
  let product=null;
  if(sku){const groups=new Map();let lines=0,title='';for(const {data} of this.db.prepare('SELECT data FROM wb_finance_rows WHERE run=? AND sku=?').iterate(chosen.id,sku)){
   const r=JSON.parse(data),key=JSON.stringify([r.currency,r.document,r.operation]);let g=groups.get(key);if(!g){g={currency:r.currency,document:r.document,operation:r.operation,lines:0,quantity:0,amounts:{}};groups.set(key,g);}g.lines++;g.quantity+=r.quantity;if(!Number.isSafeInteger(g.quantity))throw Error('WB 汇总数量超过精确范围');for(const [k,v] of Object.entries(r.amounts))g.amounts[k]=addDecimal(g.amounts[k],v);lines++;title=r.title||title;
  }product={sku,title,lines,groups:[...groups.values()],attribution:attribution.products.get(sku)||{}};}
  if(await this.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新读取');
  const view={state:run.state,phase:run.phase,error:run.error,period:{from:run.date_from,to:run.date_to},retryAt:this.deadline(owner)||null,progress:this.counts(run.id),snapshot:reports.length||coverage.rows?{runId:chosen.id,evidenceHash:hash({runId:chosen.id,from:chosen.date_from,to:chosen.date_to,reports,pages:this.db.prepare("SELECT input_hash,output_hash FROM wb_finance_attempts WHERE run=? AND state='ok' ORDER BY id").all(chosen.id)}),period:{from:chosen.date_from,to:chosen.date_to},at:chosen.updated,complete:chosen.state==='complete',stale:chosen.id!==run.id||this.clock()-Date.parse(chosen.updated)>86400000,totals,coverage:{...coverage,days:days.length,reportedDays:present.size,missingDays,byCurrency,unallocated},products,product}:null};
  if(view.snapshot)view.snapshot.attribution=wbAttributionSummary(attribution);
  const costs=this.costs(store,owner,run.date_from,run.date_to);view.reconciliations=costs.map(c=>({...c,status:costs.findLast(r=>r.currency===c.currency).id===c.id?wbContributionStatus(c,view):'revised'}));this.skuCosts.decorate(view,store,owner);return view;
 }
 costs(store,owner,from,to){
  const records=this.db.prepare('SELECT data FROM wb_finance_costs WHERE store=? AND owner=? AND date_from=? AND date_to=? ORDER BY rowid').all(store.id,owner,from,to).map(decode),last=new Map();
  for(const c of records){const {hash:checksum,...body}=c,previous=last.get(c.currency);if(c.storeId!==store.id||c.period.from!==from||c.period.to!==to||c.revision!==(previous?.revision||0)+1||c.previous!==(previous?.hash||'genesis')||hash(body)!==checksum)throw Error('WB 成本历史证据校验失败');last.set(c.currency,c);}
  return records;
 }
 async reconcile(store,input){
  const owner=await this.identity(store),view=await this.get(store),draft=reconcileWbContribution(view,input),run=this.latest(store,owner);
  if(await this.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新读取');
  // No await after the final identity/current-run check: optimistic revision and evidence commit are atomic.
  const latest=this.latest(store,owner);if(this.pending.has(owner)||!latest||latest.id!==run?.id||latest.id!==draft.reportId||latest.state!=='complete')throw Error('财务正在更新，请完成后再核对');
  this.db.exec('BEGIN IMMEDIATE');try{
   const old=this.costs(store,owner,draft.period.from,draft.period.to).findLast(c=>c.currency===draft.currency);
   if(!Number.isSafeInteger(input.revision)||input.revision!==(old?.revision||0))throw Error('成本版本已变化，请重新打开后保存');
   const record={id:randomUUID(),storeId:store.id,at:this.stamp(),...draft,revision:(old?.revision||0)+1,previous:old?.hash||'genesis'};record.hash=hash(record);
   this.db.prepare('INSERT INTO wb_finance_costs VALUES(?,?,?,?,?,?,?,?)').run(record.id,store.id,owner,draft.period.from,draft.period.to,draft.currency,record.revision,JSON.stringify(record));this.db.exec('COMMIT');return record;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async start(store,input={}){
  const owner=await this.identity(store);if(this.pending.has(owner)){if(this.pending.get(owner).store===store.id&&!input.from&&!input.to&&input.restart!==true)return this.get(store);throw Error('此 WB 账户的另一店铺连接正在读取财务');}
  const requested=input.from||input.to?wbFinanceRange(input,this.clock()):null;let run=this.latest(store,owner,requested);const resume=run&&input.restart!==true&&run.state!=='complete';
  const range=wbFinanceRange(resume?{from:run.date_from,to:run.date_to}:input,this.clock());
  if(!resume||run.date_from!==range.from||run.date_to!==range.to){
   const id=randomUUID();this.db.prepare('INSERT INTO wb_finance_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,store.id,owner,range.from,range.to,'waiting','list','0',this.stamp(),this.stamp(),null);run=this.latest(store,owner);
  }else this.db.prepare("UPDATE wb_finance_runs SET state='waiting',error=NULL WHERE id=?").run(run.id);
  const task=Promise.resolve().then(()=>this.pump(store,owner,run.id,range)).finally(()=>this.pending.delete(owner));this.pending.set(owner,{store:store.id,task});return this.get(store);
 }
 async pump(store,owner,id,range){
  let attempt=null;
  try{for(;;){
   let run=this.db.prepare('SELECT * FROM wb_finance_runs WHERE id=?').get(id);if(run.state==='complete')return;
   this.db.prepare("UPDATE wb_finance_runs SET state='waiting' WHERE id=?").run(id);
   while(this.deadline(owner)>this.clock())await this.sleep(Math.min(60000,this.deadline(owner)-this.clock()));
   if(await this.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新读取');
   const request=financeRequest(range,run.phase,run.cursor);
   this.db.prepare('INSERT INTO wb_finance_limits VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET retry_at=excluded.retry_at').run(owner,this.clock()+WB_FINANCE_INTERVAL);
   attempt=this.db.prepare("INSERT INTO wb_finance_attempts(run,at,phase,cursor,state,input_hash) VALUES(?,?,?,?,?,?)").run(id,this.stamp(),run.phase,run.cursor,'reading',hash(request)).lastInsertRowid;
   this.db.prepare("UPDATE wb_finance_runs SET state='reading' WHERE id=?").run(id);
   const result=await this.read(store,range,run.phase,run.cursor,{accountRef:owner});
   if(await this.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新读取');
   if(![200,204].includes(result.status)||!Array.isArray(result.rows)||result.status===204&&result.rows.length)throw Error('WB 财务响应状态无效');
   if(result.rows.length>(run.phase==='list'?1000:100000))throw Error('WB 财务响应超过页大小');
   const terminal=result.status===204||run.phase==='list'&&!result.rows.length;
   if(!terminal&&!result.rows.length)throw Error('WB 明细为空，但未返回结束标志 204');
   const reportMap=new Map(this.reports(id).map(r=>[r.reportId,r]));
   const normalized=result.rows.map(r=>run.phase==='list'?normalizeWbReport(r,range):normalizeWbFinanceRow(r,reportMap));
   let next=run.cursor,phase=run.phase,state='waiting';
   if(terminal){if(run.phase==='list'){phase='details';next='0';}else{
    const unseen=this.db.prepare('SELECT COUNT(*) n FROM wb_finance_reports p WHERE p.run=? AND NOT EXISTS(SELECT 1 FROM wb_finance_rows r WHERE r.run=p.run AND r.report=p.id)').get(id).n;
    if(unseen)throw Error('部分报表缺少明细，请重新读取整个期间');state='complete';
   }}else if(run.phase==='list')next=String(Number(run.cursor)+normalized.length);
   else{next=normalized.at(-1).rrdId;if(BigInt(next)<=BigInt(run.cursor))throw Error('WB 明细游标没有前进');let previous=BigInt(run.cursor);for(const r of normalized){if(BigInt(r.rrdId)<previous)throw Error('WB 明细游标顺序无效');previous=BigInt(r.rrdId);}}
   this.db.exec('BEGIN IMMEDIATE');try{
    let inserted=0;for(const r of normalized){
     const table=run.phase==='list'?'wb_finance_reports':'wb_finance_rows',key=run.phase==='list'?r.reportId:r.rrdId,raw=JSON.stringify(r),old=this.db.prepare(`SELECT data FROM ${table} WHERE run=? AND id=?`).get(id,key);
     if(old){if(old.data!==raw)throw Error('WB 重复标识的数据已变化，请重新读取');continue;}
     if(run.phase==='list'){
      // A second report for the same day/type/currency may be a revision; never silently double-count it.
      if([...reportMap.values()].some(p=>p.from===r.from&&p.reportType===r.reportType&&p.currency===r.currency))throw Error('WB 同一天存在多个同类报表，需要核对版本');
      this.db.prepare('INSERT INTO wb_finance_reports VALUES(?,?,?)').run(id,key,raw);reportMap.set(key,r);
     }else this.db.prepare('INSERT INTO wb_finance_rows VALUES(?,?,?,?,?)').run(id,key,r.reportId,r.sku,raw);inserted++;
    }
    if(normalized.length&&!inserted)throw Error('WB 财务分页没有新数据');
    this.db.prepare("UPDATE wb_finance_attempts SET state='ok',output_hash=? WHERE id=?").run(hash({status:result.status,rows:normalized}),attempt);
    this.db.prepare('UPDATE wb_finance_runs SET state=?,phase=?,cursor=?,updated=?,error=NULL WHERE id=?').run(state,phase,next,this.stamp(),id);this.db.exec('COMMIT');attempt=null;
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  }}catch(e){
   const message=String(e.message).slice(0,350);if(attempt!=null)this.db.prepare("UPDATE wb_finance_attempts SET state='error',error=? WHERE id=?").run(message,attempt);
   this.db.prepare("UPDATE wb_finance_runs SET state='error',error=? WHERE id=?").run(message,id);
   if(Number.isFinite(e.retryAt))this.db.prepare('UPDATE wb_finance_limits SET retry_at=MAX(retry_at,?) WHERE owner=?').run(e.retryAt,owner);
  }
 }
 async wait(storeId){await Promise.all([...this.pending.values()].filter(p=>p.store===storeId).map(p=>p.task));}
 close(){if(this.pending.size)throw Error('WB finance read still running');this.db.close();}
}
