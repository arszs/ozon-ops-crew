import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {composeMediaPack} from '../core/product-media-pack.mjs';
import {composeInitialSourceGallery} from '../core/initial-source-gallery.mjs';
import {sourceMediaInventory} from '../core/source-media.mjs';
import {withGalleryRichFallback} from '../core/ozon-rich-content.mjs';
import {saveImage,assetPath} from '../adapters/media.mjs';
const approved={productPreserved:true,russianReadable:true,unsupportedClaims:false,chineseMarketingRemaining:false,externalPromotionRemaining:false,reasonRu:'На фото только товар и заводская маркировка.'};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'preserve-source-')),old=process.env.OPS_ASSET_DIR;process.env.OPS_ASSET_DIR=join(root,'assets');t.after(async()=>{if(old===undefined)delete process.env.OPS_ASSET_DIR;else process.env.OPS_ASSET_DIR=old;await rm(root,{recursive:true,force:true});});const a=await saveImage(await sharp({create:{width:50,height:60,channels:3,background:'white'}}).png().toBuffer());return {root,a,row:{key:'selected',assetId:a.assetId,role:'gallery',state:'analyzed',selected:true,analysis:{kind:'product',textZh:'CFMOTO',textRu:'Заводская маркировка CFMOTO',captionRu:'Выбранный товар',otherColor:false}}};}

test('a visually verified plain source photo keeps its exact pixels, skips generation and remains usable in rich content',async t=>{
 const {root,a,row}=await fixture(t),bytes=await readFile(assetPath(a.assetId));let edits=0,reviews=0;
 const options={cacheDir:join(root,'cache'),edit:async()=>{edits++;throw Error('plain photo must not be redrawn');},run:async request=>{reviews++;assert.equal(request.images.length,1);assert.ok(request.prompt.includes('an empty OCR transcript is not proof'));return {output:{...approved,keepOriginal:true}};}};
 const result=await composeMediaPack([row],options);assert.equal(result.images[0].assetId,a.assetId);assert.deepEqual(await readFile(assetPath(a.assetId)),bytes);assert.equal(result.images[0].provenance,'preserved-original-taobao-media');assert.equal(result.translatedSourceCount,0);assert.equal(result.preservedSourceCount,1);assert.equal(withGalleryRichFallback(result).richImages.length,1);
 await composeMediaPack([row],options);assert.equal(edits,0);assert.equal(reviews,1);
});

test('missed marketing in OCR cannot pass through when the visual inspection finds external promotion',async t=>{
 const {a,row}=await fixture(t);let edits=0,reviews=0;
 const result=await composeMediaPack([row],{edit:async()=>{edits++;return a;},run:async request=>{reviews++;return {output:request.images.length===1?{...approved,keepOriginal:true,externalPromotionRemaining:true}:approved};}});
 assert.equal(edits,1);assert.equal(reviews,2);assert.equal(result.images[0].provenance,'localized-original-taobao-media');assert.equal(result.translatedSourceCount,1);
});

test('Chinese marketing and photos of another color still take the localization path',async t=>{
 const {a,row}=await fixture(t);let edits=0,reviews=0;
 for(const analysis of [{...row.analysis,textZh:'中文营销'},{...row.analysis,otherColor:true}])await composeMediaPack([{...row,analysis}],{edit:async()=>{edits++;return a;},run:async request=>{reviews++;assert.equal(request.images.length,2);return {output:approved};}});
 assert.equal(edits,2);assert.equal(reviews,2);
});

test('thin Taobao layout slices stay archived and never generate a rich image',async t=>{
 const {row}=await fixture(t),strip=await saveImage(await sharp({create:{width:1500,height:19,channels:3,background:'white'}}).png().toBuffer());let edits=0;
 const result=await composeMediaPack([row,{...row,key:'strip',role:'detail',selected:false,assetId:strip.assetId}],{edit:async()=>{edits++;throw Error('layout strip must not generate');},run:async()=>({output:{...approved,keepOriginal:true}})});
 assert.equal(edits,0);assert.equal(result.images.length,1);assert.equal(result.richImages.length,0);assert.equal(result.sourceCount,2);assert.equal(result.excluded[0].key,'strip');assert.match(result.excluded[0].reason,/фрагмент/);
});

test('initial Studio progress uses the actual block count after layout fragments are archived',async t=>{
 const {root,a}=await fixture(t),strip=await saveImage(await sharp({create:{width:1500,height:19,channels:3,background:'white'}}).png().toBuffer()),images=[{...a,url:'https://img.alicdn.com/product.jpg'},{...strip,url:'https://img.alicdn.com/strip.jpg'}],html=images.map((im,i)=>'<img class="'+(i?'descV6-mobile-image':'mainPic--a')+'" src="'+im.url+'">').join(''),rows=sourceMediaInventory(html),progress=[];
 const pack=await composeInitialSourceGallery({images,titleZh:'商品',descriptionZh:'标准',attributes:{},sku:'one',sourceUrl:'https://item.taobao.com/item.htm?id=1'},{},{html,cacheDir:join(root,'initial-cache'),onProgress:p=>progress.push(p),analysis:{run:async request=>({output:{items:request.images.map(path=>{const image=images.find(im=>path.includes(im.assetId)),row=rows.find(r=>r.url===image.url);return {key:row.key,kind:'product',textZh:'',textRu:'',captionRu:'Товар',modelCodes:[],facts:[],otherColor:false,excludeReason:''};})}})},compose:{edit:async()=>{throw Error('must not generate');},run:async()=>({output:{...approved,keepOriginal:true}})}});
 assert.equal(pack.images.length,1);assert.equal(progress.at(-1).localized,1);assert.equal(progress.at(-1).totalBlocks,1);assert.equal(progress.at(-1).failedBlocks,0);
});
