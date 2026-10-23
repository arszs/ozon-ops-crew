import {ozonCall} from '../adapters/ozon-products.mjs';
import {publishPublicImages} from '../adapters/public-media.mjs';
import {hash,audit} from './repository.mjs';
import {randomUUID} from 'node:crypto';
const find=(db,id)=>{const j=db.jobs.find(j=>j.id===id);if(!j||j.marketplace!=='ozon'||j.mode!=='manual'||j.synthetic||j.state!=='imported'||!j.importResult?.productId)throw Error('需要已创建的真实 Ozon 商品');return j;};
async function context(w,id){const db=await w.repo.read(),j=find(db,id);return {j,store:w.resolveStore(db,j.storeId),productId:Number(j.importResult.productId)};}
async function product(c,call){const d=await call(c.store,'/v3/product/info/list',{offer_id:[c.j.canonical.sku]});const p=d.items?.find(p=>p.offer_id===c.j.canonical.sku&&Number(p.id)===c.productId);if(!p)throw Error('商品身份核对失败');return p;}
async function write(w,id,kind,body,send){const token=randomUUID();await w.repo.mutate(db=>{const j=find(db,id);if((j.listingEdits||[]).some(e=>e.kind===kind&&['executing','unknown'].includes(e.state)))throw Error('先核对上次提交结果，禁止重复发送');(j.listingEdits||=[]).push({token,kind,body,inputHash:hash(body),state:'executing',at:new Date().toISOString()});audit(db,{kind:'listing.edit.confirmed',jobId:id,operation:kind,inputHash:hash(body)});});
 try{const receipt=await send();return w.repo.mutate(db=>{const j=find(db,id),e=j.listingEdits.find(e=>e.token===token);e.state='accepted';e.receipt=receipt;audit(db,{kind:'listing.edit.accepted',jobId:id,operation:kind,outputHash:hash(receipt)});return j;});}
 catch(error){await w.repo.mutate(db=>{const e=find(db,id).listingEdits.find(e=>e.token===token);e.state='unknown';e.error='请读取平台结果，禁止自动重试';});throw error;}
}
export async function editOzonText(w,id,input,{call=ozonCall}={}){const c=await context(w,id);await product(c,call);
 if(typeof input.description!=='string'||!input.description.trim()||input.description.length>4000||!/^SELLER-[A-Z0-9-]{1,45}$/.test(input.sellerArticle||''))throw Error('请填写俄语描述和明确的 SELLER- 卖家货号');
 const desc=await call(c.store,'/v1/product/info/description',{offer_id:c.j.canonical.sku,product_id:c.productId});const current=desc.result?.description??desc.description;
 if(current!==c.j.listingCheck?.description&&current!==c.j.liveContent?.description)throw Error('平台描述已变化，请重新读取后再编辑');
 const body={items:[{offer_id:c.j.canonical.sku,attributes:[{id:4191,complex_id:0,values:[{value:input.description}]},{id:7236,complex_id:0,values:[{value:input.sellerArticle}]}]}]};
 await write(w,id,'text',body,async()=>{const r=await call(c.store,'/v1/product/attributes/update',body,{write:true});if(JSON.stringify(r).includes('"errors":[{'))throw Error('Ozon 未完整接受属性，请核对回执');return r;});
 return w.repo.mutate(db=>{const j=find(db,id);j.liveContent={description:input.description,sellerArticle:input.sellerArticle};return j;});
}
export async function editOzonMainImage(w,id,input,{call=ozonCall,publish=publishPublicImages}={}){const c=await context(w,id),before=await product(c,call);if(!/^[a-f0-9]{64}$/.test(input.assetId||'')||!c.j.publishConfig.rightsConfirmed||!c.j.publishConfig.imagesReviewed)throw Error('请先检查新图片和使用权');
 const existing=[...new Set([...(Array.isArray(before.primary_image)?before.primary_image:[]),...(before.images||[])])];if(!existing.length||existing.length>=15)throw Error('需要核对当前图片列表');
 const media=await publish([{assetId:input.assetId,rightsConfirmed:true}]),after=await product(c,call);if(hash(after.images||[])!==hash(before.images||[])||hash(after.primary_image||[])!==hash(before.primary_image||[]))throw Error('平台图片已变化，停止覆盖');
 const body={product_id:c.productId,images:[media.urls[0],...existing],...(Array.isArray(before.images360)?{images360:before.images360}:{}),...(typeof before.color_image==='string'&&before.color_image?{color_image:before.color_image}:{})};await write(w,id,'main_image',body,()=>call(c.store,'/v1/product/pictures/import',body,{write:true}));
 return w.repo.mutate(db=>{const j=find(db,id);j.newMainImage={assetId:input.assetId,url:media.urls[0],expectedCount:body.images.length};return j;});
}
async function price(c,call){const d=await call(c.store,'/v5/product/info/prices',{filter:{product_id:[String(c.productId)],visibility:'ALL'},limit:1,cursor:''});const item=d.items?.find(p=>Number(p.product_id)===c.productId&&p.offer_id===c.j.canonical.sku);if(!item?.price)throw Error('无法核对平台价格');return item.price;}
export async function editOzonPrice(w,id,input,{call=ozonCall}={}){const c=await context(w,id);await product(c,call);const p=await price(c,call),target=Number(input.price);if(p.currency_code!=='CNY'||!Number.isFinite(target)||target<=0||Math.abs(target*100-Math.round(target*100))>1e-7||Number(p.old_price)>0&&target>=Number(p.old_price))throw Error('请核对 CNY 目标价和现有划线价');
 if(Number(p.price)!==target){const body={prices:[{product_id:c.productId,price:target.toFixed(2),currency_code:p.currency_code,vat:String(p.vat),old_price:String(p.old_price),auto_add_to_ozon_actions_list_enabled:'UNKNOWN',price_strategy_enabled:'UNKNOWN'}]};await write(w,id,'price',body,async()=>{const r=await call(c.store,'/v1/product/import/prices',body,{write:true});if(!r.result?.some(x=>Number(x.product_id)===c.productId&&x.updated===true&&!(x.errors||[]).length))throw Error('Цена не подтверждена, проверьте результат');return r;});}
 const observed=await price(c,call);if(Number(observed.price)!==target)throw Error('Новая цена ещё не подтверждена Ozon; остаток пока не менялся');return w.repo.mutate(db=>{const j=find(db,id);j.livePrice={price:target.toFixed(2),currency:'CNY',observed:true,marketingPrice:observed.marketing_seller_price};return j;});
}
export async function editOzonStock(w,id,input,{call=ozonCall}={}){const c=await context(w,id);await product(c,call);const quantity=Number(input.stock),warehouseId=Number(input.warehouseId),p=await price(c,call);
 if(!Number.isInteger(quantity)||quantity<0||quantity>100000||!Number.isSafeInteger(warehouseId))throw Error('请填写真实库存与仓库');
 const configured=c.j.listingCheck?.warehouses.find(x=>Number(x.id)===warehouseId&&x.type==='rfbs'&&x.status!=='disabled');if(!configured)throw Error('请先核对自有有效仓库');
 if(!c.j.livePrice?.observed||Number(p.price)!==Number(c.j.livePrice.price)||Number(p.marketing_seller_price)>0&&Number(p.marketing_seller_price)<Number(c.j.livePrice.price))throw Error('Сначала подтвердите повышенную цену и проверьте акционную цену');
 const body={stocks:[{product_id:c.productId,warehouse_id:warehouseId,stock:quantity}]};await write(w,id,'stock',body,async()=>{const r=await call(c.store,'/v2/products/stocks',body,{write:true});if(!r.result?.some(x=>Number(x.product_id)===c.productId&&x.updated===true&&!(x.errors||[]).length))throw Error('Изменение остатка не подтверждено');return r;});return w.repo.mutate(db=>{const j=find(db,id);j.liveStock={quantity,warehouseId,accepted:true,at:new Date().toISOString()};return j;});
}
