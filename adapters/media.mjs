import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import https from 'node:https';
import {lookup} from 'node:dns';
import {hash as evidenceHash} from '../core/repository.mjs';
import {recognizeImage} from './codex.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
export const assetRoot=()=>process.env.OPS_ASSET_DIR||join(process.cwd(),'runtime','assets');
export function assetPath(id){if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid asset');return join(assetRoot(),id+'.png');}
export async function saveImage(bytes){
 const image=sharp(bytes,{limitInputPixels:30_000_000});const meta=await image.metadata();
 if(!['png','jpeg','webp'].includes(meta.format))throw Error('Only PNG/JPEG/WebP supported');
 const png=await image.rotate().png().toBuffer();const m=await sharp(png).metadata();const id=hash(png);await mkdir(assetRoot(),{recursive:true,mode:0o700});await writeFile(assetPath(id),png,{mode:0o600});return {assetId:id,width:m.width,height:m.height,sha256:id,url:'/api/workspace/assets/'+id};
}
export function publicIPv4(address){const p=address.split('.').map(Number);return p.length===4&&p.every(v=>Number.isInteger(v)&&v>=0&&v<=255)&&![0,10,127].includes(p[0])&&!(p[0]===169&&p[1]===254)&&!(p[0]===172&&p[1]>=16&&p[1]<=31)&&!(p[0]===192&&[0,168].includes(p[1]))&&!(p[0]===100&&p[1]>=64&&p[1]<=127)&&p[0]<224&&p[0]!==198;}
export async function downloadImage(value){
 const u=new URL(value);const hosts=['alicdn.com',...(process.env.OPS_IMAGE_HOSTS||'').split(',').filter(Boolean)];
 if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('图片域名未授权；请上传 PNG/JPEG，或在本机配置 OPS_IMAGE_HOSTS');
 return new Promise((resolve,reject)=>{
  const req=https.get(u,{timeout:20000,lookup:(host,options,cb)=>lookup(host,{family:4},(err,address,family)=>{if(err||!publicIPv4(address))cb(Error('Non-public image address'));else if(options.all)cb(null,[{address,family}]);else cb(null,address,family);})},res=>{
   if(res.statusCode!==200){res.resume();reject(Error('Image HTTP '+res.statusCode+'; redirects disabled'));return;}
   const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>12_000_000){res.destroy();reject(Error('Image exceeds 12MB'));}else chunks.push(b);});res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',()=>reject(Error('Image download failed')));
  });req.on('timeout',()=>req.destroy(Error('Image timeout')));req.on('error',()=>reject(Error('Image download failed')));
 });
}
export async function processImages(product,{ocr=recognizeImage}={}){
 if(!product.images.length)throw Error('请提供商品图片');const images=[],calls=[];
 for(const source of product.images.slice(0,2)){
  if(!source.rightsConfirmed)throw Error('请先确认图片使用权');
  const input=source.assetId?{assetId:source.assetId,...await sharp(assetPath(source.assetId)).metadata()}:await saveImage(await downloadImage(source.url));
  if((source.textRegions||[]).length>1)throw Error('MVP 每张图片只支持一个已确认的文字区');
  const key=evidenceHash({source:input.assetId,regions:source.textRegions||[],pipeline:'flat-ocr-v1'});const cache=join(assetRoot(),key+'.json');
  try{const saved=JSON.parse(await readFile(cache,'utf8'));await readFile(assetPath(saved.image.assetId));images.push(saved.image);calls.push({...saved.call,cacheHit:true});continue;}catch{}
  const analysis=await ocr(assetPath(input.assetId));if(typeof analysis.output?.textZh!=='string'||typeof analysis.output?.textRu!=='string'||!Array.isArray(analysis.output.warnings))throw Error('OCR 输出结构无效');calls.push({provider:analysis.provider,usage:analysis.usage,prompt:analysis.prompt,output:analysis.output,inputHash:input.assetId});
  const regions=source.textRegions||[];if(!regions.length&&analysis.output.textZh.trim())throw Error('检测到中文文字；请提供平面文字区域 textRegions，或上传人工处理后的俄语图片');
  // Explicit flat-background text regions only. We never infer/crop the product area.
  const overlays=[];for(const region of regions){
   const {x,y,width,height}=region;if(![x,y,width,height].every(Number.isInteger)||x<0||y<0||width<30||height<30||x+width>input.width||y+height>input.height||!/^#[0-9a-f]{6}$/i.test(region.background))throw Error('Invalid flat text region');
   const text=analysis.output.textRu;const chars=Math.max(10,Math.floor(width/25)),lines=[];let line='';for(const word of text.split(/\s+/)){if((line+' '+word).length>chars&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);
   const font=Math.min(40,Math.floor((height-20)/Math.max(1,lines.length)/1.3));if(font<14)throw Error('俄文过长，请扩大文字区域或缩短文案');
   const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${region.background}"/>${lines.map((l,i)=>`<text x="10" y="${15+font+i*font*1.3}" font-family="Arial, sans-serif" font-size="${font}" fill="#16392b">${esc(l)}</text>`).join('')}</svg>`;
   overlays.push({input:Buffer.from(svg),left:x,top:y});
  }
  if(regions.length>1)throw Error('MVP 每张图片只支持一个已确认的文字区');
  const bytes=await sharp(assetPath(input.assetId)).composite(overlays).png().toBuffer();const result=await saveImage(bytes);
  const image={...result,sourceAssetId:input.assetId,sourceText:analysis.output.textZh,translatedText:analysis.output.textRu,warnings:analysis.output.warnings,rightsConfirmed:true,requiresHumanReview:true};images.push(image);await writeFile(cache,JSON.stringify({image,call:calls.at(-1)}),{mode:0o600});
 }
 return {images,calls,mode:'subscription',processedCount:images.length,totalSourceImages:product.images.length,notice:'Codex 视觉识别 + 已指定平面区域重绘；请人工检查俄文、遮盖范围和商品外观。仅处理前两张图片。'};
}
export async function sampleImages(){
 const images=[];for(const text of ['30升 大容量','可折叠 易收纳']){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#f0f2e8"/><text x="60" y="180" font-family="PingFang SC, sans-serif" font-size="64" fill="#16392b">${text}</text><path d="M170 490 L640 440 L755 585 L280 650Z" fill="#7c9291"/><path d="M280 650 L755 585 L710 970 L295 1030Z" fill="#aebcbb"/><path d="M170 490 L280 650 L295 1030 L185 850Z" fill="#607977"/><path d="M190 485 L640 438 L700 502 L245 570Z" fill="#d3dcda"/></svg>`;
  const asset=await saveImage(await sharp(Buffer.from(svg)).png().toBuffer());images.push({...asset,url:'https://example.com/synthetic-storage.png',textZh:text,rightsConfirmed:true,textRegions:[{x:40,y:70,width:800,height:260,background:'#f0f2e8'}]});
 }return images;
}
