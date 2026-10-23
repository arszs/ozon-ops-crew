import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function maskPII(text){return String(text).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL]').replace(/(?:\+?\d[\d ()-]{8,}\d)/g,'[PHONE]');}
export function audit(db,event){const previous=db.audit.at(-1)?.hash||'genesis';const record={id:randomUUID(),time:new Date().toISOString(),...event,previous};record.hash=hash(record);db.audit.push(record);return record;}
export function verifyAudit(records){let previous='genesis';for(const r of records){const {hash:checksum,...body}=r;if(body.previous!==previous||hash(body)!==checksum)return false;previous=checksum;}return true;}
export class Repository{
 constructor(file){this.file=file;this.queue=Promise.resolve();}
 async read(){try{return JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {version:1,stores:[],jobs:[],operations:[],reviews:[],assessments:[],categoryApprovals:{},audit:[]};}}
 mutate(fn){const run=this.queue.then(async()=>{const db=await this.read();const result=await fn(db);await mkdir(dirname(this.file),{recursive:true,mode:0o700});await writeFile(this.file+'.tmp',JSON.stringify(db),{mode:0o600});await rename(this.file+'.tmp',this.file);return result;});this.queue=run.catch(()=>{});return run;}
}
