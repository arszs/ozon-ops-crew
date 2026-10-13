import {DatabaseSync} from 'node:sqlite';import {mkdirSync,chmodSync} from 'node:fs';import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {hash} from './repository.mjs';import {wbAccount} from '../adapters/wb-api.mjs';import {addDecimal,wbInteger} from '../adapters/wb-finance.mjs';
import {wbAdRange,wbAdInterval,wbAdRequest,normalizeWbAdList,normalizeWbAdInfo,normalizeWbAdStats,readWbAds} from '../adapters/wb-advertising.mjs';
const decode=v=>v?JSON.parse(v):null;
const publicInfo=info=>{if(!info)return null;const {nms,...rest}=info;return rest;};
export class WbAdvertisingService{
 constructor(file,{accountRef=wbAccount,read=readWbAds,clock=()=>Date.now(),sleep=(ms,signal)=>delay(ms,null,{signal})}={}){
  mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);chmodSync(file,0o600);Object.assign(this,{accountRef,read,clock,sleep});this.pending=new Map();
  this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS wb_ad_runs(id TEXT PRIMARY KEY,store TEXT,owner TEXT,date_from TEXT,date_to TEXT,state TEXT,phase TEXT,cursor INTEGER,updated TEXT,error TEXT);
   CREATE TABLE IF NOT EXISTS wb_ad_campaigns(run TEXT,id TEXT,listed TEXT,info TEXT,stats TEXT,PRIMARY KEY(run,id));
   CREATE TABLE IF NOT EXISTS wb_ad_pages(id INTEGER PRIMARY KEY,run TEXT,phase TEXT,cursor INTEGER,at TEXT,state TEXT,input_hash TEXT,output_hash TEXT,error TEXT);
   CREATE TABLE IF NOT EXISTS wb_ad_limits(owner TEXT,phase TEXT,retry_at INTEGER,PRIMARY KEY(owner,phase));
   UPDATE wb_ad_runs SET state='interrupted',error='上次广告读取中断，可以继续' WHERE state IN ('reading','waiting');
   UPDATE wb_ad_pages SET state='interrupted',error='服务重启，上次响应未保存' WHERE state='reading';`);
 }
 stamp(){return new Date(this.clock()).toISOString();}
 async identity(store){if(store.mode!=='live'||store.marketplace!=='wb')throw Error('只支持真实 WB 广告账户');return this.accountRef(store);}
 latest(store,owner,range=null){return range?this.db.prepare('SELECT * FROM wb_ad_runs WHERE store=? AND owner=? AND date_from=? AND date_to=? ORDER BY rowid DESC LIMIT 1').get(store.id,owner,range.from,range.to):this.db.prepare('SELECT * FROM wb_ad_runs WHERE store=? AND owner=? ORDER BY rowid DESC LIMIT 1').get(store.id,owner);}
 deadline(owner,phase){return this.db.prepare('SELECT retry_at FROM wb_ad_limits WHERE owner=? AND phase=?').get(owner,phase)?.retry_at||0;}
 records(id){return this.db.prepare('SELECT * FROM wb_ad_campaigns WHERE run=? ORDER BY id').all(id).map(r=>({listed:decode(r.listed),info:decode(r.info),stats:decode(r.stats)}));}
 async get(store,{sku,from,to}={}){
  const owner=await this.identity(store),range=from!=null||to!=null?wbAdRange({from,to},this.clock()):null,run=this.latest(store,owner,range);if(sku!=null)sku=wbInteger(sku);if(!run)return {state:'idle',snapshot:null};
  const good=this.db.prepare("SELECT * FROM wb_ad_runs WHERE store=? AND owner=? AND date_from=? AND date_to=? AND state='complete' ORDER BY rowid DESC LIMIT 1").get(store.id,owner,run.date_from,run.date_to);
  const chosen=['complete','partial'].includes(run.state)?run:good||run,records=this.records(chosen.id),current=this.records(run.id),totals={},products=new Map(),campaigns=[],productCampaigns=[];
  for(const {listed:l,info,stats:s} of records){
   campaigns.push({...l,info:publicInfo(info),stats:s?{currency:s.currency,spend:s.spend,views:s.views,clicks:s.clicks,orders:s.orders,orderAmount:s.orderAmount,unallocated:s.unallocated,allocationMatched:s.allocationMatched,missingDays:s.missingDays,at:s.at}:null});
   const p=sku?s?.products.find(p=>p.sku===sku):null;if(sku&&(p||info?.nms.includes(sku)))productCampaigns.push({id:l.id,info:publicInfo(info),status:info?.status??l.status,stats:p?{...p,currency:s.currency,at:s.at,allocationMatched:s.allocationMatched}:null});
   if(!s)continue;const total=totals[s.currency]??={spend:'0',unallocated:'0',campaigns:0};total.spend=addDecimal(total.spend,s.spend);total.unallocated=addDecimal(total.unallocated,s.unallocated);total.campaigns++;
   for(const p of s.products){let product=products.get(p.sku);if(!product){product={sku:p.sku,name:p.name,byCurrency:{},campaignCount:0,allocationMatched:true};products.set(p.sku,product);}const t=product.byCurrency[s.currency]??={spend:'0',orderAmount:'0',views:0,clicks:0,orders:0};for(const k of ['spend','orderAmount'])t[k]=addDecimal(t[k],p[k]);for(const k of ['views','clicks','orders']){t[k]+=p[k];if(!Number.isSafeInteger(t[k]))throw Error('WB 广告汇总数量超过精确范围');}product.campaignCount++;product.allocationMatched&&=s.allocationMatched;}
  }
  const oldest=records.reduce((n,r)=>Math.min(n,Date.parse(r.info?.at||chosen.updated),Date.parse(r.stats?.at||chosen.updated)),Date.parse(chosen.updated));
  const eligible=records.filter(r=>r.listed.eligible),returned=eligible.filter(r=>r.stats),missing=eligible.filter(r=>!r.stats).map(r=>r.listed.id),mismatch=returned.filter(r=>!r.stats.allocationMatched).map(r=>r.listed.id);
  if(await this.accountRef(store)!==owner)throw Error('WB 广告账户已变化');
  return {state:run.state,phase:run.phase,error:run.error,period:{from:run.date_from,to:run.date_to},retryAt:this.deadline(owner,run.phase)||null,progress:{listed:current.length,eligible:current.filter(r=>r.listed.eligible).length,stats:current.filter(r=>r.stats).length},snapshot:records.length||['complete','partial'].includes(chosen.state)?{runId:chosen.id,at:chosen.updated,period:{from:chosen.date_from,to:chosen.date_to},complete:['complete','partial'].includes(chosen.state),stale:chosen.id!==run.id||this.clock()-oldest>900000,evidenceHash:hash(this.db.prepare("SELECT input_hash,output_hash FROM wb_ad_pages WHERE run=? AND state='ok' ORDER BY id").all(chosen.id)),totals,coverage:{listed:records.length,eligible:eligible.length,returned:returned.length,excluded:records.length-eligible.length,missing,mismatch,missingDays:returned.filter(r=>r.stats.missingDays.length).map(r=>r.listed.id),allSpendKnown:false},campaigns:campaigns.slice(0,100),products:[...products.values()].sort((a,b)=>b.campaignCount-a.campaignCount||a.sku.localeCompare(b.sku)).slice(0,5),product:sku?{sku,totals:products.get(sku)?.byCurrency||{},campaigns:productCampaigns}:null}:null};
 }
 async start(store,input={}){
  const owner=await this.identity(store);if(this.pending.has(owner)){if(this.pending.get(owner).store===store.id&&!input.from&&!input.to&&input.restart!==true)return this.get(store);throw Error('此 WB 账户正在读取广告，请完成或暂停后再选择期间');}
  const requested=input.from||input.to?wbAdRange(input,this.clock()):null;let run=this.latest(store,owner,requested);const resume=run&&!['complete','partial'].includes(run.state)&&input.restart!==true,range=wbAdRange(resume?{from:run.date_from,to:run.date_to}:input,this.clock());
  wbAdInterval(store,'list');if(!resume){const id=randomUUID();this.db.prepare('INSERT INTO wb_ad_runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,store.id,owner,range.from,range.to,'waiting','list',0,this.stamp(),null);run=this.latest(store,owner);}else this.db.prepare("UPDATE wb_ad_runs SET state='waiting',error=NULL WHERE id=?").run(run.id);
  const controller=new AbortController(),task=Promise.resolve().then(()=>this.pump(store,owner,run.id,range,controller.signal)).finally(()=>this.pending.delete(owner));this.pending.set(owner,{store:store.id,controller,task});return this.get(store);
 }
 async pause(store){const owner=await this.identity(store),job=this.pending.get(owner);if(job&&job.store!==store.id)throw Error('请在正在读取的店铺中暂停');if(job){job.controller.abort();await job.task;}return this.get(store);}
 async pump(store,owner,id,range,signal){let attempt=null;
  const check=async()=>{signal.throwIfAborted();if(await this.accountRef(store)!==owner)throw Error('WB 广告账户已变化');};
  try{for(;;){await check();let run=this.db.prepare('SELECT * FROM wb_ad_runs WHERE id=?').get(id);const rows=this.records(id),eligible=rows.filter(r=>r.listed.eligible),batch=eligible.slice(run.cursor,run.cursor+50).map(r=>r.listed.id);
   if(run.phase!=='list'&&!batch.length){if(run.phase==='info'){this.db.prepare("UPDATE wb_ad_runs SET phase='stats',cursor=0 WHERE id=?").run(id);continue;}this.db.prepare('UPDATE wb_ad_runs SET state=?,updated=? WHERE id=?').run(eligible.some(r=>!r.stats)?'partial':'complete',this.stamp(),id);return;}
   this.db.prepare("UPDATE wb_ad_runs SET state='waiting' WHERE id=?").run(id);while(this.deadline(owner,run.phase)>this.clock()){await this.sleep(Math.min(60000,this.deadline(owner,run.phase)-this.clock()),signal);await check();}
   await check();const request=wbAdRequest(run.phase,batch,range);this.db.prepare('INSERT INTO wb_ad_limits VALUES(?,?,?) ON CONFLICT(owner,phase) DO UPDATE SET retry_at=excluded.retry_at').run(owner,run.phase,this.clock()+wbAdInterval(store,run.phase));
   attempt=this.db.prepare("INSERT INTO wb_ad_pages(run,phase,cursor,at,state,input_hash) VALUES(?,?,?,?,?,?)").run(id,run.phase,run.cursor,this.stamp(),'reading',hash(request)).lastInsertRowid;this.db.prepare("UPDATE wb_ad_runs SET state='reading' WHERE id=?").run(id);
   const result=await this.read(store,run.phase,batch,range,{accountRef:owner,signal});await check();const normalized=run.phase==='list'?normalizeWbAdList(result.data):run.phase==='info'?normalizeWbAdInfo(result.data,batch):normalizeWbAdStats(result.data,batch,range,new Map(rows.filter(r=>r.info).map(r=>[r.listed.id,r.info])));
   this.db.exec('BEGIN IMMEDIATE');try{
    for(const r of normalized){if(run.phase==='list')this.db.prepare('INSERT INTO wb_ad_campaigns(run,id,listed) VALUES(?,?,?)').run(id,r.id,JSON.stringify(r));else this.db.prepare(`UPDATE wb_ad_campaigns SET ${run.phase}=? WHERE run=? AND id=?`).run(JSON.stringify({...r,at:this.stamp()}),id,r.id);}
    this.db.prepare("UPDATE wb_ad_pages SET state='ok',output_hash=? WHERE id=?").run(hash(normalized),attempt);this.db.prepare("UPDATE wb_ad_runs SET state='waiting',phase=?,cursor=?,updated=?,error=NULL WHERE id=?").run(run.phase==='list'?'info':run.phase,run.phase==='list'?0:run.cursor+batch.length,this.stamp(),id);this.db.exec('COMMIT');attempt=null;
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  }}catch(e){const paused=signal.aborted,error=paused?'广告读取已暂停，可以继续':String(e.message).slice(0,350);if(attempt!=null)this.db.prepare('UPDATE wb_ad_pages SET state=?,error=? WHERE id=?').run(paused?'interrupted':'error',error,attempt);this.db.prepare('UPDATE wb_ad_runs SET state=?,error=? WHERE id=?').run(paused?'paused':'error',error,id);if(Number.isFinite(e.retryAt)){const phase=this.db.prepare('SELECT phase FROM wb_ad_runs WHERE id=?').get(id).phase;this.db.prepare('UPDATE wb_ad_limits SET retry_at=MAX(retry_at,?) WHERE owner=? AND phase=?').run(e.retryAt,owner,phase);}}
 }
 async wait(storeId){await Promise.all([...this.pending.values()].filter(p=>p.store===storeId).map(p=>p.task));}
 close(){if(this.pending.size)throw Error('WB advertising read still running');this.db.close();}
}
