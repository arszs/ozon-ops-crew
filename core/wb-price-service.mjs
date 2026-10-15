import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './repository.mjs';
import {wbAccount,wbPriceInterval} from '../adapters/wb-api.mjs';
import {readWbPrice,wbNmId,normalizeWbPrice} from '../adapters/wb-prices.mjs';
// One server owns the database. Attempts and account-wide rate deadlines survive restart.
export class WbPriceService{
 constructor(file,{catalogue,read=readWbPrice,accountRef=wbAccount,clock=()=>Date.now()}={}){
  mkdirSync(dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);chmodSync(file,0o600);this.catalogue=catalogue;this.read=read;this.accountRef=accountRef;this.clock=clock;this.pending=new Map();
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS wb_price_attempts(id TEXT PRIMARY KEY,store TEXT NOT NULL,owner TEXT NOT NULL,nmid TEXT NOT NULL,at TEXT NOT NULL,state TEXT NOT NULL,error TEXT,input_hash TEXT,output_hash TEXT,response TEXT);
   CREATE INDEX IF NOT EXISTS wb_price_lookup ON wb_price_attempts(store,owner,nmid);
   CREATE TABLE IF NOT EXISTS wb_price_limits(owner TEXT PRIMARY KEY,retry_at INTEGER NOT NULL);
   UPDATE wb_price_attempts SET state='error',error='上次读取被中断，请刷新价格' WHERE state='reading';`);
 }
 async identity(store,nmID){if(store.mode!=='live'||store.marketplace!=='wb')throw Error('只支持真实 WB 店铺');return {owner:await this.accountRef(store),nmID:wbNmId(nmID)};}
 async get(store,nmID){
  const {owner}=await this.identity(store,nmID);nmID=wbNmId(nmID);
  const args=[store.id,owner,nmID],last=this.db.prepare('SELECT * FROM wb_price_attempts WHERE store=? AND owner=? AND nmid=? ORDER BY rowid DESC LIMIT 1').get(...args),good=this.db.prepare("SELECT * FROM wb_price_attempts WHERE store=? AND owner=? AND nmid=? AND state='ok' ORDER BY rowid DESC LIMIT 1").get(...args);
  let snapshot=null,error=last?.error||null,stale=last?.state==='error';
  if(good){try{const product=await this.catalogue.product(store,nmID,owner);snapshot={...normalizeWbPrice(JSON.parse(good.response),product),at:good.at,evidenceHash:good.output_hash};stale ||= this.clock()-Date.parse(good.at)>900000;}catch{error='目录或账户已变化，请重新读取价格';stale=true;}}
  if(await this.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新同步');
  return {state:last?.state||'idle',snapshot,stale,error,retryAt:this.db.prepare('SELECT retry_at FROM wb_price_limits WHERE owner=?').get(owner)?.retry_at||null};
 }
 async refresh(store,nmID){
  const {owner,nmID:id}=await this.identity(store,nmID),product=await this.catalogue.product(store,id,owner);
  const deadline=this.db.prepare('SELECT retry_at FROM wb_price_limits WHERE owner=?').get(owner)?.retry_at||0;
  if(this.pending.has(owner)||deadline>this.clock()){const e=Error('此 WB 账户正在读取或尚未到下一次读取时间');e.retryAt=deadline;throw e;}
  const attempt=randomUUID(),at=new Date(this.clock()).toISOString(),interval=wbPriceInterval(store);
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('INSERT INTO wb_price_limits VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET retry_at=excluded.retry_at').run(owner,this.clock()+interval);
   this.db.prepare('INSERT INTO wb_price_attempts(id,store,owner,nmid,at,state,input_hash) VALUES(?,?,?,?,?,?,?)').run(attempt,store.id,owner,id,at,'reading',hash({nmID:id,product}));this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  const task=Promise.resolve().then(async()=>{try{
   const result=await this.read(store,product,{accountRef:owner});
   if(await this.accountRef(store)!==owner)throw Error('WB 账户已变化，请重新同步');
   normalizeWbPrice(result.response,await this.catalogue.product(store,id,owner));
   this.db.prepare("UPDATE wb_price_attempts SET state='ok',response=?,output_hash=? WHERE id=?").run(JSON.stringify(result.response),hash(result.response),attempt);
  }catch(e){
   this.db.prepare("UPDATE wb_price_attempts SET state='error',error=? WHERE id=?").run(String(e.message).slice(0,350),attempt);
   if(Number.isFinite(e.retryAt))this.db.prepare('UPDATE wb_price_limits SET retry_at=MAX(retry_at,?) WHERE owner=?').run(e.retryAt,owner);
  }finally{this.pending.delete(owner);}});this.pending.set(owner,task);await task;return this.get(store,id);
 }
 close(){if(this.pending.size)throw Error('WB price read still running');this.db.close();}
}
