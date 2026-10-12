import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './repository.mjs';
import {credentials} from '../ozon.mjs';
import {storeCredentials} from '../adapters/marketplaces.mjs';
import {ozonCall} from '../adapters/ozon-products.mjs';
import {catalogueProduct} from '../adapters/ozon-catalogue.mjs';
const now=()=>new Date().toISOString();
async function account(store){const c=store.id==='ozon-live'?await credentials():await storeCredentials(store).then(v=>({client:v.OZON_CLIENT_ID,key:v.OZON_API_KEY}));if(!c.client||!c.key)throw Error('Ozon credentials missing');return hash({client:c.client});}
// One local server owns this worker. Each page and its checkpoint commit together.
export class CatalogueService{
 constructor(file,{call=ozonCall,accountRef=account}={}){
  mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);chmodSync(file,0o600);this.call=call;this.accountRef=accountRef;this.pending=new Map();
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS catalogue_runs(id TEXT PRIMARY KEY,store TEXT NOT NULL,owner TEXT NOT NULL,state TEXT NOT NULL,cursor TEXT NOT NULL DEFAULT '',total INTEGER,loaded INTEGER NOT NULL DEFAULT 0,pages INTEGER NOT NULL DEFAULT 0,error TEXT,started TEXT NOT NULL,updated TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS catalogue_store ON catalogue_runs(store,owner,started);
   CREATE TABLE IF NOT EXISTS catalogue_ids(run TEXT NOT NULL,product TEXT NOT NULL,PRIMARY KEY(run,product));
   CREATE TABLE IF NOT EXISTS catalogue_rows(run TEXT NOT NULL,product TEXT NOT NULL,sku TEXT NOT NULL,search TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(run,product,sku));
   CREATE UNIQUE INDEX IF NOT EXISTS catalogue_sku ON catalogue_rows(run,sku) WHERE sku!='';
   CREATE TABLE IF NOT EXISTS catalogue_pages(run TEXT NOT NULL,cursor TEXT NOT NULL,input_hash TEXT NOT NULL,output_hash TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(run,cursor));
   UPDATE catalogue_runs SET state='interrupted' WHERE state='running';`);
 }
 latest(store,owner){return this.db.prepare('SELECT * FROM catalogue_runs WHERE store=? AND owner=? ORDER BY rowid DESC LIMIT 1').get(store.id,owner);}
 public(run){return run?{id:run.id,state:run.state,total:run.total,loaded:run.loaded,pages:run.pages,error:run.error,startedAt:run.started,updatedAt:run.updated,complete:run.state==='complete'}:{state:'idle',total:null,loaded:0,pages:0,complete:false};}
 validate(store){if(store.mode!=='live'||store.marketplace!=='ozon')throw Error('ozon_live_store_required');}
 async start(store,{restart=false}={}){
  this.validate(store);const owner=await this.accountRef(store);let run=this.latest(store,owner);
  if(this.pending.has(store.id))return this.public(run);
  if(!run||restart||run.state==='complete'){
   const at=now();this.db.prepare('INSERT INTO catalogue_runs(id,store,owner,state,started,updated) VALUES(?,?,?,?,?,?)').run(randomUUID(),store.id,owner,'running',at,at);run=this.latest(store,owner);
  }else{this.db.prepare("UPDATE catalogue_runs SET state='running',error=NULL,updated=? WHERE id=?").run(now(),run.id);run={...run,state:'running',error:null};}
  const task=this.pump(store,run,owner).catch(e=>{this.db.prepare("UPDATE catalogue_runs SET state='error',error=?,updated=? WHERE id=?").run(String(e.message).slice(0,350),now(),run.id);}).finally(()=>this.pending.delete(store.id));
  this.pending.set(store.id,task);return this.public(run);
 }
 async pump(store,run,owner){
  while(run.state!=='complete'){
   if(await this.accountRef(store)!==owner)throw Error('catalogue_account_changed');
   if(run.pages>=10000)throw Error('catalogue_page_limit');
   const body={filter:{visibility:'ALL'},limit:1000,last_id:run.cursor};
   const response=await this.call(store,'/v3/product/list',body),r=response.result;
   if(!r||!Array.isArray(r.items)||!Number.isSafeInteger(r.total)||r.total<0)throw Error('catalogue_schema');
   if(run.total!==null&&r.total!==run.total)throw Error('catalogue_changed_restart_required');
   const ids=[...new Set(r.items.map(p=>String(p.product_id)))];if(ids.some(id=>! /^[1-9]\d*$/.test(id))||ids.length!==r.items.length)throw Error('catalogue_product_identity');
   const rows=[];if(ids.length){const details=await this.call(store,'/v3/product/info/list',{product_id:ids});if(!Array.isArray(details.items))throw Error('catalogue_details_schema');const seen=new Set();for(const p of details.items){const id=String(p.id);if(!ids.includes(id)||seen.has(id))throw Error('catalogue_details_identity');seen.add(id);rows.push(...catalogueProduct(p));}if(seen.size!==ids.length)throw Error('catalogue_details_incomplete');}
   if(await this.accountRef(store)!==owner)throw Error('catalogue_account_changed');
   this.db.exec('BEGIN IMMEDIATE');
   try{
    const addId=this.db.prepare('INSERT OR IGNORE INTO catalogue_ids(run,product) VALUES(?,?)');for(const id of ids)addId.run(run.id,id);
    const loaded=this.db.prepare('SELECT count(*) n FROM catalogue_ids WHERE run=?').get(run.id).n;
    const complete=loaded===r.total;if(loaded>r.total||(!complete&&(!ids.length||loaded===run.loaded||!r.last_id||r.last_id===run.cursor||this.db.prepare('SELECT 1 FROM catalogue_pages WHERE run=? AND cursor=?').get(run.id,r.last_id))))throw Error('catalogue_incomplete_pagination');
    const put=this.db.prepare('INSERT OR REPLACE INTO catalogue_rows(run,product,sku,search,json) VALUES(?,?,?,?,?)');
    for(const row of rows){if(row.sku){const other=this.db.prepare('SELECT product FROM catalogue_rows WHERE run=? AND sku=?').get(run.id,row.sku);if(other&&other.product!==row.productId)throw Error('catalogue_sku_conflict');}put.run(run.id,row.productId,row.sku||'',[row.name,row.sku,row.productId,row.offerId].join(' ').toLowerCase(),JSON.stringify(row));}
    this.db.prepare('INSERT INTO catalogue_pages VALUES(?,?,?,?,?)').run(run.id,run.cursor,hash(body),hash({response,rows}),now());
    this.db.prepare('UPDATE catalogue_runs SET state=?,cursor=?,total=?,loaded=?,pages=pages+1,updated=? WHERE id=?').run(complete?'complete':'running',String(r.last_id||''),r.total,loaded,now(),run.id);
    this.db.exec('COMMIT');run=this.db.prepare('SELECT * FROM catalogue_runs WHERE id=?').get(run.id);
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
 }
 async query(store,{q='',offset=0,limit=50}={}){
  this.validate(store);if(typeof q!=='string'||q.length>160||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('catalogue_query_invalid');
  const run=this.latest(store,await this.accountRef(store));if(!run)return {status:this.public(null),rows:[],matched:0,offset,limit};
  const term=q.trim().toLowerCase();const matched=this.db.prepare('SELECT count(*) n FROM catalogue_rows WHERE run=? AND instr(search,?)>0').get(run.id,term).n;
  const rows=this.db.prepare('SELECT json FROM catalogue_rows WHERE run=? AND instr(search,?)>0 ORDER BY product,sku LIMIT ? OFFSET ?').all(run.id,term,limit,offset).map(r=>JSON.parse(r.json));
  return {status:this.public(run),rows,matched,offset,limit};
 }
 async wait(storeId){await this.pending.get(storeId);}
 close(){if(this.pending.size)throw Error('catalogue_worker_running');this.db.close();}
}
