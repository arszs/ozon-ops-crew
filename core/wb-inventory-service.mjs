import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './repository.mjs';
import {wbAccount} from '../adapters/wb-api.mjs';
import {wbNmId} from '../adapters/wb-prices.mjs';
import {inventorySizes,readWbWarehouses,readWbStocks,normalizeWbWarehouses,normalizeWbStocks} from '../adapters/wb-inventory.mjs';
const productKey=p=>hash({sku:p.sku,offerId:p.offerId,sizes:inventorySizes(p).sort((a,b)=>a-b)});
// One local worker; one checkpoint per warehouse. No stock mutations.
export class WbInventoryService{
 constructor(file,{catalogue,warehouses=readWbWarehouses,stocks=readWbStocks,accountRef=wbAccount,clock=()=>Date.now()}={}){
  mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);chmodSync(file,0o600);Object.assign(this,{catalogue,warehouses,stocks,accountRef,clock});this.pending=new Map();
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS wb_inventory_runs(id TEXT PRIMARY KEY,store TEXT NOT NULL,owner TEXT NOT NULL,nmid TEXT NOT NULL,product_hash TEXT NOT NULL,at TEXT NOT NULL,state TEXT NOT NULL,error TEXT,warehouses TEXT,input_hash TEXT,output_hash TEXT);
   CREATE INDEX IF NOT EXISTS wb_inventory_lookup ON wb_inventory_runs(store,owner,nmid);
   CREATE TABLE IF NOT EXISTS wb_inventory_pages(id INTEGER PRIMARY KEY,run TEXT NOT NULL,warehouse TEXT NOT NULL,at TEXT NOT NULL,state TEXT NOT NULL,error TEXT,response TEXT,input_hash TEXT,output_hash TEXT);
   CREATE INDEX IF NOT EXISTS wb_inventory_page_lookup ON wb_inventory_pages(run,warehouse);
   CREATE TABLE IF NOT EXISTS wb_inventory_limits(owner TEXT PRIMARY KEY,retry_at INTEGER NOT NULL);
   UPDATE wb_inventory_runs SET state='interrupted',error='上次读取中断，可继续已保存进度' WHERE state='reading';`);
 }
 async identity(store,nmID){if(store.mode!=='live'||store.marketplace!=='wb')throw Error('只支持真实 WB 店铺');const owner=await this.accountRef(store),product=await this.catalogue.product(store,wbNmId(nmID),owner);return {owner,product,key:productKey(product)};}
 latest(store,owner,nmID){return this.db.prepare('SELECT * FROM wb_inventory_runs WHERE store=? AND owner=? AND nmid=? ORDER BY rowid DESC LIMIT 1').get(store.id,owner,nmID);}
 async get(store,nmID){
  const {owner,product,key}=await this.identity(store,nmID),run=this.latest(store,owner,product.sku);
  const base={state:run?.state||'idle',error:run?.error||null,rows:[],total:null,loaded:0,retryAt:this.db.prepare('SELECT retry_at FROM wb_inventory_limits WHERE owner=?').get(owner)?.retry_at||null};
  if(!run)return base;
  if(run.product_hash!==key)return {...base,state:'invalidated',error:'商品尺码或编码已变化，请重新读取库存'};
  const listRun=run.warehouses?run:this.db.prepare('SELECT * FROM wb_inventory_runs WHERE store=? AND owner=? AND nmid=? AND product_hash=? AND warehouses IS NOT NULL ORDER BY rowid DESC LIMIT 1').get(store.id,owner,product.sku,key);
  if(listRun){
   base.warehousesAt=listRun.at;base.listStale=listRun.id!==run.id||this.clock()-Date.parse(listRun.at)>900000;base.total=normalizeWbWarehouses(JSON.parse(listRun.warehouses)).length;
   for(const w of normalizeWbWarehouses(JSON.parse(listRun.warehouses))){
    const current=this.db.prepare('SELECT * FROM wb_inventory_pages WHERE run=? AND warehouse=? ORDER BY rowid DESC LIMIT 1').get(run.id,w.id);
    const good=w.isDeleting?null:this.db.prepare("SELECT p.* FROM wb_inventory_pages p JOIN wb_inventory_runs r ON r.id=p.run WHERE r.store=? AND r.owner=? AND r.nmid=? AND r.product_hash=? AND p.warehouse=? AND p.state='ok' ORDER BY p.rowid DESC LIMIT 1").get(store.id,owner,product.sku,key,w.id);
    let stocks=null;if(good)stocks=normalizeWbStocks(JSON.parse(good.response),product);
    base.rows.push({...w,state:w.isDeleting?'deleting':current?.state||'pending',error:current?.error||null,stocks,at:good?.at||null,stale:!!good&&(good.run!==run.id||current?.state!=='ok'||this.clock()-Date.parse(good.at)>900000),evidenceHash:good?.output_hash||null});
    if(w.isDeleting||current?.state==='ok')base.loaded++;
   }
  }
  if(await this.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新同步');return base;
 }
 async start(store,nmID,{restart=false}={}){
  const {owner,product,key}=await this.identity(store,nmID),active=this.pending.get(owner);
  if(active){if(active.store===store.id&&active.nmID===product.sku)return this.get(store,nmID);throw Error('此 WB 账户正在读取另一商品库存，请稍后继续');}
  const retryAt=this.db.prepare('SELECT retry_at FROM wb_inventory_limits WHERE owner=?').get(owner)?.retry_at||0;
  if(retryAt>this.clock()){const e=Error('WB 库存请求间隔未到，请在显示时间后继续');e.retryAt=retryAt;throw e;}
  let run=this.latest(store,owner,product.sku);
  if(!run||restart||run.product_hash!==key||run.state==='complete'){
   const id=randomUUID(),at=new Date(this.clock()).toISOString();this.db.prepare('INSERT INTO wb_inventory_runs(id,store,owner,nmid,product_hash,at,state) VALUES(?,?,?,?,?,?,?)').run(id,store.id,owner,product.sku,key,at,'reading');run=this.latest(store,owner,product.sku);
  }else this.db.prepare("UPDATE wb_inventory_runs SET state='reading',error=NULL WHERE id=?").run(run.id);
  const task=Promise.resolve().then(()=>this.pump(store,run,owner,product,key)).catch(e=>{
   this.db.prepare("UPDATE wb_inventory_runs SET state='error',error=? WHERE id=?").run(String(e.message).slice(0,350),run.id);
   if(Number.isFinite(e.retryAt))this.db.prepare('INSERT INTO wb_inventory_limits VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)').run(owner,e.retryAt);
  }).finally(()=>this.pending.delete(owner));this.pending.set(owner,{task,store:store.id,nmID:product.sku});return this.get(store,nmID);
 }
 async check(store,owner,product,key){if(await this.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新同步');if(productKey(await this.catalogue.product(store,product.sku,owner))!==key)throw Error('商品尺码或编码已变化，请重新读取库存');}
 async pump(store,run,owner,product,key){
  await this.check(store,owner,product,key);
  if(!run.warehouses){
   let result;const at=new Date(this.clock()).toISOString(),inputHash=hash({path:'/api/v3/warehouses',product:key});try{result=await this.warehouses(store,{accountRef:owner});normalizeWbWarehouses(result.response);await this.check(store,owner,product,key);this.db.prepare("INSERT INTO wb_inventory_pages(run,warehouse,at,state,response,input_hash,output_hash) VALUES(?,'',?,'ok',?,?,?)").run(run.id,at,JSON.stringify(result.response),inputHash,hash(result.response));}catch(e){this.db.prepare("INSERT INTO wb_inventory_pages(run,warehouse,at,state,error,input_hash) VALUES(?,'',?,'error',?,?)").run(run.id,at,String(e.message).slice(0,350),inputHash);throw e;}
   this.db.prepare('UPDATE wb_inventory_runs SET warehouses=?,input_hash=?,output_hash=?,at=? WHERE id=?').run(JSON.stringify(result.response),hash({path:result.path,product:key}),hash(result.response),new Date(this.clock()).toISOString(),run.id);run=this.latest(store,owner,product.sku);
  }
  for(const warehouse of normalizeWbWarehouses(JSON.parse(run.warehouses))){
   if(warehouse.isDeleting||this.db.prepare("SELECT 1 FROM wb_inventory_pages WHERE run=? AND warehouse=? AND state='ok'").get(run.id,warehouse.id))continue;
   await this.check(store,owner,product,key);const at=new Date(this.clock()).toISOString(),inputHash=hash({warehouse:warehouse.id,chrtIds:inventorySizes(product)});
   try{
    const result=await this.stocks(store,warehouse.id,product,{accountRef:owner});normalizeWbStocks(result.response,product);await this.check(store,owner,product,key);
    this.db.prepare("INSERT INTO wb_inventory_pages(run,warehouse,at,state,error,response,input_hash,output_hash) VALUES(?,?,?,'ok',NULL,?,?,?)").run(run.id,warehouse.id,at,JSON.stringify(result.response),inputHash,hash(result.response));
   }catch(e){
    this.db.prepare("INSERT INTO wb_inventory_pages(run,warehouse,at,state,error,response,input_hash,output_hash) VALUES(?,?,?,'error',?,NULL,?,NULL)").run(run.id,warehouse.id,at,String(e.message).slice(0,350),inputHash);
    // Stop at a failed warehouse: preserve earlier checkpoints and respect API cooldowns.
    throw e;
   }
  }
  this.db.prepare("UPDATE wb_inventory_runs SET state='complete',error=NULL WHERE id=?").run(run.id);
 }
 async wait(storeId){const tasks=[...this.pending.values()].filter(p=>p.store===storeId).map(p=>p.task);await Promise.all(tasks);}
 close(){if(this.pending.size)throw Error('WB inventory read still running');this.db.close();}
}
