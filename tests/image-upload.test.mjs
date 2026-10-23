import test from 'node:test';import assert from 'node:assert/strict';
import {Readable} from 'node:stream';import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import sharp from 'sharp';
import {workspaceBody,IMAGE_UPLOAD_BYTES} from '../core/request-body.mjs';
import {saveImage,assetPath} from '../adapters/media.mjs';
import {upload} from '../web/review-creatives.mjs';
const asset={resource:'assets'},req=(chunks,type='image/png',headers={})=>Object.assign(Readable.from(chunks),{method:'POST',headers:{'content-type':type,...headers}});
const digest=b=>createHash('sha256').update(b).digest('hex');
test('actual generated before/after images pass binary upload and preserve dimensions and pixels',async t=>{
 const previous=process.env.OPS_ASSET_DIR;process.env.OPS_ASSET_DIR=await mkdtemp(join(tmpdir(),'aigc-upload-'));t.after(async()=>{await rm(process.env.OPS_ASSET_DIR,{recursive:true,force:true});if(previous===undefined)delete process.env.OPS_ASSET_DIR;else process.env.OPS_ASSET_DIR=previous;});
 for(const name of ['aigc-before.png','aigc-after.png']){
  const original=await readFile(new URL('../web/'+name,import.meta.url));assert.ok(original.length>1_300_000);assert.ok(original.length<=IMAGE_UPLOAD_BYTES);
  let calls=0;const saved=await upload(new Blob([original],{type:'image/png'}),async(path,file)=>{calls++;assert.equal(path,'/assets');const decoded=await workspaceBody(req([Buffer.from(await file.arrayBuffer())]),asset);return saveImage(decoded.imageBytes);});
  assert.equal(calls,1);assert.equal(saved.width,1024);assert.equal(saved.height,1536);
  const normalized=await readFile(assetPath(saved.assetId));assert.equal(digest(normalized),saved.assetId);assert.equal(digest(await sharp(normalized).raw().toBuffer()),digest(await sharp(original).raw().toBuffer()));
 }
});
test('binary limit handles streamed and declared bytes without raising other endpoint limits',async()=>{
 assert.equal((await workspaceBody(req([Buffer.alloc(IMAGE_UPLOAD_BYTES)]),asset)).imageBytes.length,IMAGE_UPLOAD_BYTES);
 await assert.rejects(workspaceBody(req([Buffer.alloc(IMAGE_UPLOAD_BYTES),Buffer.alloc(1)]),asset),e=>e.status===413);
 await assert.rejects(workspaceBody(req([],'image/png',{'content-length':String(IMAGE_UPLOAD_BYTES+1)}),asset),e=>e.status===413);
 for(const scope of [{resource:'trial-plans'},{resource:'assets',id:'existing'},{resource:'assets',action:'approve'}])await assert.rejects(workspaceBody(req([Buffer.alloc(2_000_001)]),scope),e=>e.status===413);
 await assert.rejects(workspaceBody(req([Buffer.alloc(2_000_001)],'application/json'),asset),e=>e.status===413);
 await assert.rejects(workspaceBody(req([]),asset),/非空/);
});
test('JSON compatibility retains Chinese text split across network chunks',async()=>{
 const source=Buffer.from(JSON.stringify({facts:'中文尺寸',base64:'YQ=='})),chunks=[...source].map(n=>Buffer.from([n]));
 assert.deepEqual(await workspaceBody(req(chunks,'application/json'),asset),{facts:'中文尺寸',base64:'YQ=='});
 assert.deepEqual(await workspaceBody(Object.assign(req([]),{method:'GET'}),asset),{});
});
test('invalid format, truncated data, animation and excessive pixels fail before writing an asset',async t=>{
 const previous=process.env.OPS_ASSET_DIR;process.env.OPS_ASSET_DIR=await mkdtemp(join(tmpdir(),'aigc-invalid-'));t.after(async()=>{await rm(process.env.OPS_ASSET_DIR,{recursive:true,force:true});if(previous===undefined)delete process.env.OPS_ASSET_DIR;else process.env.OPS_ASSET_DIR=previous;});
 const png=await sharp({create:{width:20,height:20,channels:3,background:'white'}}).png().toBuffer(),large=await sharp({create:{width:6000,height:5001,channels:3,background:'white'}}).png().toBuffer();
 const animation=await sharp(Buffer.concat([Buffer.alloc(12,0),Buffer.alloc(12,255)]),{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0}).toBuffer();
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),png.subarray(0,40),large,animation])await assert.rejects(saveImage(bytes),/完整的静态/);
 assert.deepEqual(await readdir(process.env.OPS_ASSET_DIR),[]);
 let sends=0;for(const file of [new Blob([]),new Blob([Buffer.alloc(IMAGE_UPLOAD_BYTES+1)],{type:'image/png'}),new Blob(['svg'],{type:'image/svg+xml'})])await assert.rejects(upload(file,()=>sends++));assert.equal(sends,0);
});
