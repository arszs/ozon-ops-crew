import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceBrandPhotoBinding,verifySourceBrandPhoto} from '../core/source-brand-proof.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'source-brand-proof-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes=Buffer.from('offline selected source image'),assetId=createHash('sha256').update(bytes).digest('hex'),path=join(root,'photo.png');await writeFile(path,bytes);
 const selectedVariant='【原装火花塞1个】',task={sourceHash:'saved-page-hash',product:{titleZh:'摩托车火花塞',attributes:{规格:'1个'}},evidence:{sourceHash:'saved-page-hash',selectedVariants:[selectedVariant],mediaInventory:[{key:'selected',role:'gallery',selected:true,name:'photo.jpg',filename:'photo.jpg_720x720.jpg',url:'https://img.alicdn.com/photo.jpg'}]},sourceMediaFiles:[{name:'photo.jpg_720x720.jpg',assetId}]},input={brand:'CFMOTO',sourceAssetId:assetId},output={confirmed:true,readable:true,printedBrand:'CFMOTO',scope:'factory-packaging',brandSource:'physical-marking',identityConfirmed:true,selectedVariant,identityReason:'На фото одна свеча зажигания и её заводская упаковка.',reason:'Бренд читается на физической упаковке.'};
 return {task,input,output,path,options:{resolveSource:id=>{assert.equal(id,assetId);return path;},run:async()=>({provider:'offline-strong-model',output})}};
}
test('independent source photo proof reads only the bound original and stores physical evidence',async t=>{
 const f=await fixture(t);let calls=0;f.options.run=async request=>{calls++;assert.deepEqual(request.images,[f.path]);assert.equal(request.prompt.includes('CFMOTO'),false);assert.match(request.prompt,/seller overlay/);assert.match(request.prompt,/exact selected VARIANT/);assert.equal(request.schema.additionalProperties,false);return {provider:'offline-strong-model',output:{...f.output,printedBrand:'ｃｆｍｏｔｏ'}};};
 const proof=await verifySourceBrandPhoto(f.task,f.input,f.options);assert.equal(calls,1);assert.equal(proof.provider,'offline-strong-model');assert.equal(proof.assetId,f.input.sourceAssetId);assert.equal(proof.sourceHash,f.task.sourceHash);assert.equal(proof.printedBrand,'ｃｆｍｏｔｏ');assert.equal(proof.scope,'factory-packaging');assert.equal(proof.reason,f.output.reason);
});
test('selected gallery binding rejects arbitrary, detail, unselected, ambiguous and unrelated manifest assets',async t=>{
 const f=await fixture(t),cases=[
  task=>task.evidence.mediaInventory[0].selected=false,
  task=>task.evidence.mediaInventory[0].role='detail',
  task=>task.sourceMediaFiles[0].name='unrelated.jpg',
  task=>task.sourceMediaFiles[0].assetId='a'.repeat(64),
  task=>task.sourceMediaFiles.push({name:'photo.jpg',assetId:'b'.repeat(64)}),
  task=>task.evidence.mediaInventory.push({...task.evidence.mediaInventory[0],key:'other'}),
  task=>task.evidence.selectedVariants.push('other variant'),
  task=>task.evidence.sourceHash='other-source',
  task=>task.evidence.mediaInventory[0].filename='unrelated.jpg',
  task=>task.sourceMediaFiles=[],
 ];
 for(const change of cases){const task=structuredClone(f.task);change(task);assert.throws(()=>sourceBrandPhotoBinding(task,f.input.sourceAssetId));}
 assert.throws(()=>sourceBrandPhotoBinding(f.task,'https://example.com/photo.jpg'));
 assert.throws(()=>sourceBrandPhotoBinding(f.task,'../../image.png'));
});
test('proof rejects illegible print, seller overlays, aliases, compatibility, title and another selected type or variant',async t=>{
 const f=await fixture(t),cases=[{confirmed:false},{readable:false},{scope:'seller-overlay'},{scope:'unknown'},{brandSource:'inferred-alias'},{brandSource:'compatibility'},{brandSource:'source-title'},{printedBrand:'CF MOTO'},{printedBrand:'CFMOTO GENUINE PARTS'},{printedBrand:'春风'},{printedBrand:'CFMOTOX'},{identityConfirmed:false},{selectedVariant:'【原装点火线圈1个】'},{identityReason:''},{reason:''}];
 for(const change of cases)await assert.rejects(verifySourceBrandPhoto(f.task,f.input,{...f.options,run:async()=>({provider:'offline-strong-model',output:{...f.output,...change}})}),/не подтверждает/);
 await assert.rejects(verifySourceBrandPhoto(f.task,f.input,{...f.options,run:async()=>({provider:'offline-strong-model',output:{...f.output,confirmed:'true'}})}),/не подтверждает/);
});
test('photo bytes must match the content-addressed source asset before calling the model',async t=>{
 const f=await fixture(t);await writeFile(f.path,'different image');f.options.run=async()=>assert.fail('must not inspect an unbound image');await assert.rejects(verifySourceBrandPhoto(f.task,f.input,f.options),/Содержимое.*изменено/);
});
