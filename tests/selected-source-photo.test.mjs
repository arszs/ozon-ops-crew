import test from 'node:test';import assert from 'node:assert/strict';
import {selectedPhotoWithoutSpecs} from '../core/selected-source-photo.mjs';
import {studioPackaging,packagingNotice} from '../core/studio-packaging.mjs';
const row={selected:true,assetId:'a'.repeat(64)},product={descriptionZh:'已选规格：相思木大锅铲33.5*8.5cm约80g',images:[{assetId:row.assetId}]},analysis={kind:'revision_specific',textZh:'相思木·大锅铲\n长度：34.5cm\n重量：84g',textRu:'Акация · большая лопатка\nДлина: 34,5 см\nМасса: 84 г',modelCodes:[],otherColor:false,facts:[{nameRu:'Материал',valueRu:'Акация',evidenceZh:'相思木'},{nameRu:'Масса',valueRu:'84 г',evidenceZh:'重量：84g'}]};
const run=async()=>({output:{sameSelectedProduct:true,onlyNumericConflict:true,identityEvidenceZh:'相思木·大锅铲',reasonRu:'Выбранный предмет; различаются только размеры.'},provider:'test'});
test('a selected SKU photo retains the product after independently confirmed numeric-only conflict; disputed measurements are omitted',async()=>{
 const out=await selectedPhotoWithoutSpecs(analysis,row,product,{run});assert.equal(out.kind,'product');assert.equal(out.textZh,'相思木·大锅铲');assert.equal(out.textRu,'Акация · большая лопатка');assert.ok(!/\d/.test(out.captionRu));assert.equal(out.facts.length,1);assert.ok(out.omittedTextZh.includes('84g'));assert.equal(out.selectedPhotoProof.sourceAssetId,row.assetId);
});
test('a different revision, unselected photo, unbound image or unresolved identity stays excluded',async()=>{
 const forbidden=async()=>{throw Error('must not inspect');};
 for(const [a,r,p] of [[{...analysis,modelCodes:['1S']},row,product],[analysis,{...row,selected:false},product],[analysis,{...row,assetId:'b'.repeat(64)},product]])assert.equal(await selectedPhotoWithoutSpecs(a,r,p,{run:forbidden}),null);
 assert.equal(await selectedPhotoWithoutSpecs(analysis,row,product,{run:async()=>({output:{sameSelectedProduct:false,onlyNumericConflict:true,identityEvidenceZh:'相思木·大锅铲'}})}),null);
 assert.equal(await selectedPhotoWithoutSpecs(analysis,row,product,{run:async()=>({output:{sameSelectedProduct:true,onlyNumericConflict:false,identityEvidenceZh:'相思木·大锅铲'}})}),null);
});
test('estimated packaging fits source item dimensions without treating net weight as package weight',()=>{
 const original={width:200,height:200,depth:200,weight:400},p={attributes:{'尺寸':'33.5*8.5cm','重量':'约80g'}},r=studioPackaging(p,original);assert.deepEqual(r.options,{...original,width:360});assert.equal(r.estimated,true);assert.equal(r.adjustments[0].sourceDimensionMm,335);assert.equal(original.width,200);assert.ok(packagingNotice(r.options).includes('36×20×20'));
 assert.deepEqual(studioPackaging(p,{...original,width:400}).options,{...original,width:400});
 for(const value of ['尺寸约33cm','盒装100个','33.5*8.5','1S','3300*200cm'])assert.equal(studioPackaging({attributes:{'尺寸':value}},original).options.width,200);
});
