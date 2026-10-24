import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspace} from '../core/workspace.mjs';
import {ProductStudio} from '../core/product-studio.mjs';
import {verifyAudit} from '../core/repository.mjs';
async function setup(t,tasks){const root=await mkdtemp(join(tmpdir(),'studio-remove-'));t.after(()=>rm(root,{recursive:true,force:true}));const ws=new Workspace(join(root,'db.json'));await ws.init();await ws.repo.mutate(db=>{db.studioTasks=tasks;});return {ws,studio:new ProductStudio(ws)};}
const task=(id,item,state='queued',extra={})=>({id,sourceUrl:'https://item.taobao.com/item.htm?id='+item,storeId:'ozon-live',state,...extra});
test('a failed visual import with an untouched local job can be removed without publishing or deleting its evidence',async t=>{const {ws,studio}=await setup(t,[task('failed','1','failed',{jobId:'j',error:'Описание изображения не переведено'})]);await ws.repo.mutate(db=>{db.jobs.push({id:'j',state:'extract',revision:1,artifacts:{},canonical:{sku:'saved'},gates:{}});});await studio.remove('failed');const db=await ws.repo.read();assert.equal(db.studioTasks.length,0);assert.equal(db.removedStudioTasks[0].error,'Описание изображения не переведено');assert.equal(db.jobs[0].state,'cancelled');assert.equal(db.jobs[0].canonical.sku,'saved');await assert.rejects(ws.step('j'));assert.equal(db.operations.length,0);});
test('a receipt or prepared external operation prevents removal even when the task failed before finishing',async t=>{for(const boundary of ['receipt','operation']){const {ws,studio}=await setup(t,[task('failed','1','failed',{jobId:'j'})]);await ws.repo.mutate(db=>{db.jobs.push({id:'j',state:'extract',revision:1,artifacts:{},...(boundary==='receipt'?{receipt:{taskId:'123'}}:{})});if(boundary==='operation')db.operations.push({id:'op',payload:{jobId:'j'},state:'pending'});});await assert.rejects(studio.remove('failed'),/отправленного/);assert.equal((await studio.get('failed')).state,'failed');}});
test('removal hides all requested product attempts, preserves other products and audit, and queued generation never runs',async t=>{
 const {ws,studio}=await setup(t,[task('keep','1'),task('remove','2'),task('old','2','failed'),task('other-store','2','failed',{storeId:'other'})]);let release,runs=0;studio.tail=new Promise(r=>release=r);studio.run=async()=>{runs++;};
 await studio.queueRetry('remove',{html:'saved source'});const work=studio.tasks.get('remove');const result=await studio.remove('remove',{includeAttempts:true});assert.deepEqual(result.removedIds,['remove','old']);release();await work;
 assert.equal(runs,0);assert.deepEqual((await studio.list()).tasks.map(t=>t.id).sort(),['keep','other-store']);await assert.rejects(studio.get('remove'));const db=await ws.repo.read();assert.equal(db.removedStudioTasks.length,2);assert.ok(verifyAudit(db.audit));assert.equal(db.operations.length,0);
});
test('removed queued source never opens a browser, and active or created drafts cannot be removed',async t=>{
 const {ws,studio}=await setup(t,[task('queued','1'),task('active','2','visuals'),task('draft','3','failed',{jobId:'j'}),task('old','3','failed')]);let release,captures=0;studio.sourceTail=new Promise(r=>release=r);studio.sourceReader=async()=>{captures++;throw Error('must not open');};
 await studio.queueRetry('queued',{sourceUrl:'https://item.taobao.com/item.htm?id=1'});const work=studio.tasks.get('queued');await studio.remove('queued');release();await work;assert.equal(captures,0);
 await assert.rejects(studio.remove('active'),/ожидающие/);await assert.rejects(studio.remove('old',{includeAttempts:true}),/ожидающие/);assert.deepEqual((await ws.repo.read()).studioTasks.map(t=>t.id),['active','draft','old']);
});
