import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assetPath} from './media.mjs';
import {wbRead,wbAccount,wbRegion} from './wb-api.mjs';
import {storeCredentials} from './marketplaces.mjs';
import {findWbCard,wbCardMatches,checkWbWriteProfile} from './wb-products.mjs';
import {hash} from '../core/repository.mjs';

export function wbPhotoUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['wbbasket.ru','wbbasket.cn','wbstatic.net','wildberries.ru','wildberries.cn'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;}
}
export async function inspectWbImage(image,{readAsset=id=>readFile(assetPath(id))}={}){
 if(!image||image.rightsConfirmed!==true||!/^[a-f0-9]{64}$/.test(image.assetId))throw Error('请使用已确认使用权的本地俄语 PNG 图片');
 const bytes=await readAsset(image.assetId);if(bytes.length>32_000_000||createHash('sha256').update(bytes).digest('hex')!==image.assetId)throw Error('图片大小或内容指纹不匹配');
 const m=await sharp(bytes,{limitInputPixels:30_000_000}).metadata();
 if(m.format!=='png'||(m.pages||1)!==1||m.width<700||m.height<900)throw Error('WB 图片须为静态 PNG，至少 700 × 900 像素');
 return {assetId:image.assetId,sha256:image.assetId,width:m.width,height:m.height,bytes:bytes.length,rightsConfirmed:true};
}
export function mediaSource(job){return hash({revision:job.revision,images:job.artifacts.image_edit?.output.images});}
export async function readWbMediaTarget(store,publication,{read=wbRead,accountRef=wbAccount}={}){
 checkWbWriteProfile(store);if(store.marketplace!=='wb'||store.mode!=='live')throw Error('需要真实 WB 连接');
 const owner=await accountRef(store);if(owner!==publication.payload.wbContext.accountRef)throw Error('WB 账户已变化');
 const expected=publication.payload.apiBody[0],card=await findWbCard(store,expected.variants[0].vendorCode,{read,accountRef:owner});
 if(!card||!wbCardMatches(card,expected)||!Number.isSafeInteger(card.nmID)||card.nmID<=0)throw Error('WB 卡片内容尚未匹配已确认版本，请先核对卡片');
 if(!Array.isArray(card.photos)||card.photos.length>30)throw Error('WB 图片列表不完整');
 const photos=card.photos.map(p=>{
  const urls=Object.fromEntries(['big','c246x328','c516x688','square','tm'].filter(k=>p[k]).map(k=>{const u=wbPhotoUrl(p[k]);if(!u)throw Error('WB 返回无法展示的图片地址');return [k,u];}));
  if(!Object.keys(urls).length)throw Error('WB 图片缺少预览地址');return urls;
 });
 if(await accountRef(store)!==owner)throw Error('WB 账户已变化');
 return {accountRef:owner,nmID:card.nmID,vendorCode:card.vendorCode,photos,video:card.video||null,mediaHash:hash({photos,video:card.video||null}),checkedAt:new Date().toISOString()};
}

export function createWbMediaUpload({fetcher=fetch,getCredentials=storeCredentials,readAsset=id=>readFile(assetPath(id)),clock=()=>Date.now()}={}){
 return async(store,op,image)=>{
  let bytes,credentials;
  try{
   checkWbWriteProfile(store);
   if(store.mode!=='live'||store.marketplace!=='wb'||op.kind!=='wb_media'||op.approvedHash!==hash(op.payload)||op.payloadHash!==op.approvedHash||!op.payload.images.some(i=>hash(i)===hash(image)))throw Error('WB 图片审批无效');
   if(!Number.isSafeInteger(op.payload.nmID)||op.payload.nmID<=0||!Number.isInteger(image.photoNumber)||image.photoNumber<1||image.photoNumber>30)throw Error('WB 图片位置无效');
   if(!Number.isFinite(Date.parse(op.approvedAt))||clock()-Date.parse(op.approvedAt)>900000||clock()-Date.parse(op.payload.checkedAt)>900000||!Number.isFinite(Date.parse(op.payload.checkedAt)))throw Error('图片确认已过期，请重新拟定');
   bytes=await readAsset(image.assetId);const metadata=await inspectWbImage(image,{readAsset:async()=>bytes});if(metadata.bytes!==image.bytes||metadata.width!==image.width||metadata.height!==image.height)throw Error('图片内容已变化');
   credentials=await getCredentials(store);if(await wbAccount(store,{getCredentials:async()=>credentials})!==op.payload.accountRef)throw Error('WB 账户已变化');
   if(clock()-Date.parse(op.approvedAt)>900000||clock()-Date.parse(op.payload.checkedAt)>900000)throw Error('图片确认已过期，请重新拟定');
  }catch(e){e.noWrite=true;throw e;}
  const data=new FormData();data.append('uploadfile',new Blob([bytes],{type:'image/png'}),image.assetId+'.png');
  let response;try{response=await fetcher('https://content-api.wildberries.'+wbRegion(store)+'/content/v3/media/file',{method:'POST',headers:{Authorization:credentials.WB_API_TOKEN,'X-Nm-Id':String(op.payload.nmID),'X-Photo-Number':String(image.photoNumber)},body:data,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('WB 图片发送结果不确定，请读取图片核对；禁止重复发送');}
  if(!response.ok){const e=Error('WB 图片 HTTP '+response.status+'；需读取核对');if(response.status===429){const n=Number(response.headers?.get('Retry-After')||response.headers?.get('X-Ratelimit-Retry')||60);e.retryAt=clock()+Math.max(60,Number.isFinite(n)?n:60)*1000;}throw e;}
  let result;try{result=await response.json();}catch{throw Error('WB 图片响应格式不明，请读取核对');}
  if(result?.error!==false||result.errorText||result.additionalErrors&&Object.keys(result.additionalErrors).length)throw Error('WB 未明确接受图片，请读取核对');
  return {status:'accepted',externalWrite:true,assetId:image.assetId,photoNumber:image.photoNumber,responseHash:hash(result)};
 };
}
export const uploadWbMedia=createWbMediaUpload();
