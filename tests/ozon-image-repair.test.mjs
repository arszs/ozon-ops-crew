import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspace} from '../core/workspace.mjs';
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'ozon-photo-'));const w=new Workspace(join(dir,'db.json'));await w.init();await w.repo.mutate(db=>db.jobs.push({id:'job',marketplace:'ozon',storeId:'ozon-live',mode:'manual',synthetic:false,state:'imported',canonical:{sku:'offer'},publishConfig:{rightsConfirmed:true,imagesReviewed:true},importResult:{productId:123,errors:[{code:'IMAGE_LOAD_FAILED'}]},artifacts:{image_edit:{output:{images:[{assetId:'a'.repeat(64),rightsConfirmed:true}]}}}}));return {w,clean:()=>rm(dir,{recursive:true,force:true})};}
const media=async()=>({urls:['https://raw.githubusercontent.com/owner/repo/product-media/photo.png']});
test('repair writes pictures once for the exact created product, without touching price or stock',async()=>{const {w,clean}=await fixture();try{
 const writes=[];const call=async(store,path,body,options)=>{if(options?.write){writes.push({path,body});return {result:{pictures:[]}};}return {items:[{id:123,offer_id:'offer',images:[],primary_image:[],color_image:[]}]};};
 const j=await w.repairOzonImages('job',{publish:media,call});assert.equal(j.imageRepair.state,'accepted');assert.equal(writes.length,1);assert.equal(writes[0].path,'/v1/product/pictures/import');assert.deepEqual(Object.keys(writes[0].body).sort(),['images','product_id']);assert.equal(writes[0].body.product_id,123);
 await assert.rejects(w.repairOzonImages('job',{publish:media,call}),/已有记录/);assert.equal(writes.length,1);
 }finally{await clean();}});
test('changed platform images stop repair before the write',async()=>{const {w,clean}=await fixture();try{let reads=0,writes=0;
 await assert.rejects(w.repairOzonImages('job',{publish:media,call:async(store,path,body,options)=>{if(options?.write)writes++;return {items:[{id:123,offer_id:'offer',images:++reads===1?[]:['https://example.org/other.png']}]};}}),/已变化/);assert.equal(writes,0);assert.equal((await w.getJob('job')).imageRepair.state,'blocked');
 }finally{await clean();}});
test('ambiguous image submission is never automatically retried',async()=>{const {w,clean}=await fixture();try{
 const call=async(store,path,body,options)=>{if(options?.write)throw Error('network timeout');return {items:[{id:123,offer_id:'offer',images:[]}]};};
 await assert.rejects(w.repairOzonImages('job',{publish:media,call}));assert.equal((await w.getJob('job')).imageRepair.state,'unknown');await assert.rejects(w.repairOzonImages('job',{publish:media,call}),/已有记录/);
 }finally{await clean();}});
test('hosting refuses to replace a draft changed while public images were uploading',async()=>{const {w,clean}=await fixture();try{
 await w.repo.mutate(db=>{const j=db.jobs[0];j.state='review_gate';j.revision=1;j.publishConfig.complianceConfirmed=true;});
 await assert.rejects(w.hostOzonImages('job',{publish:async()=>{await w.repo.mutate(db=>{db.jobs[0].revision=2;db.jobs[0].publishConfig.price='99';});return media();}}),/已改变/);
 const j=await w.getJob('job');assert.equal(j.publishConfig.price,'99');assert.equal(j.publishConfig.images,undefined);
 }finally{await clean();}});
