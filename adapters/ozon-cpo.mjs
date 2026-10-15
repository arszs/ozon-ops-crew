import {performanceAccount,performanceRead,performanceDisable,performanceEnable} from '../performance.mjs';
import {ozonCall} from './ozon-products.mjs';
import {catalogueProduct} from './ozon-catalogue.mjs';
import {priceAccount} from './ozon-prices.mjs';
import {hash} from '../core/repository.mjs';
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
function supported(store,sku){if(store.id!=='ozon-live'||store.mode!=='live'||store.marketplace!=='ozon'||typeof sku!=='string'||! /^[1-9]\d*$/.test(sku))throw Error('CPO 操作仅支持已连接的主 Ozon 店铺与平台 SKU');}
export async function readCpo(store,sku,{seller=ozonCall,read=performanceRead,account=performanceAccount,sellerAccount=priceAccount}={}){
 supported(store,sku);const accountRef=await account(),sellerRef=await sellerAccount(store);
 const details=await seller(store,'/v3/product/info/list',{sku:[sku]});
 if(!Array.isArray(details.items)||details.items.length!==1)throw Error('请核对 Seller API 商品身份');
 const product=catalogueProduct(details.items[0]).find(p=>p.sku===sku);if(!product)throw Error('Seller SKU identity mismatch');
 let total=null,seen=new Set(),match=null,pages=0;
 for(let page=1;page<=1000;page++){
  const d=await read('/api/client/campaign/search_promo/v2/products',{page,pageSize:1000},{accountRef});pages++;
  if(!Array.isArray(d.products)||!/^\d+$/.test(String(d.total))||!Number.isSafeInteger(Number(d.total)))throw Error('CPO 商品清单不完整');
  if(total!==null&&total!==Number(d.total))throw Error('CPO 清单在读取时改变，请重试');total=Number(d.total);
  for(const p of d.products){if(typeof p.sku!=='string'||! /^[1-9]\d*$/.test(p.sku)||seen.has(p.sku))throw Error('CPO 商品清单重复或身份无效');seen.add(p.sku);if(p.sku===sku)match=p;}
  if(seen.size===total)break;
  if(!d.products.length||seen.size>total||page===1000)throw Error('CPO 商品清单不完整');
 }
 if(!match)throw Error('CPO 清单未找到此 SKU；不能将缺失视为已关闭');
 if(match.sourceSku!==product.offerId||typeof match.searchPromoStatus!=='boolean'||typeof match.isSearchPromoAvailable!=='boolean')throw Error('Seller 与广告账户商品身份或状态不一致');
 // Fixed bid discovery is optional; failure must not prevent a seller from stopping CPO.
 let fixedBid=null,fixedBidStatus='unavailable';
 try{const d=await read('/api/client/search_promo/get_cpo_min_bids',{skus:[sku]},{accountRef});if(Array.isArray(d.bids)&&d.bids.length===1&&d.bids[0].sku===sku&&numeric(d.bids[0].bid)!==null){fixedBid=d.bids[0].bid;fixedBidStatus='available';}}catch{}
 if(await account()!==accountRef||await sellerAccount(store)!==sellerRef)throw Error('读取期间账户已变化');
 const state={sku,productId:product.productId,offerId:product.offerId,name:product.name,accountRef,sellerRef,enabled:match.searchPromoStatus,available:match.isSearchPromoAvailable,bidPct:numeric(match.bid),bidRub:typeof match.bidPrice==='string'?match.bidPrice:null,carrotsStatus:match.carrotsStatus||null,carrotsAdditive:numeric(match.carrotsAdditive)};
 return {...state,fingerprint:hash(state),fixedBid,fixedBidStatus,pages,checkedAt:new Date().toISOString(),scope:'specific_sku_cpo',allAssortmentVerified:false};
}
export async function submitCpoDisable(store,op,{read=readCpo,disable=performanceDisable}={}){
 let current;try{
  supported(store,op.payload.sku);current=await read(store,op.payload.sku);
  if(op.kind!=='cpo_disable'||op.payload.target!==false||!current.enabled||current.fingerprint!==op.payload.context.fingerprint||hash(op.payload.apiBody)!==hash({skus:[current.sku]}))throw Error('CPO 状态或账户已变化，请重新拟定并确认');
 }catch(e){e.noWrite=true;throw e;}
 await disable(current.sku,current.accountRef);
 return {mode:'live',externalWrite:true,status:'accepted',sku:current.sku,payloadHash:op.payloadHash,stateObserved:false,scope:'specific_sku_cpo'};
}

export function enableQuote(c){
 if(c.available!==true||c.fixedBidStatus!=='available'||!Number.isFinite(c.fixedBid)||c.fixedBid<=0||!Number.isFinite(c.bidPct)||c.bidPct<=0||c.bidPct>100||typeof c.bidRub!=='string'||!/^\d+(\.\d+)?$/.test(c.bidRub)||!Number.isFinite(Number(c.bidRub))||Number(c.bidRub)<=0)throw Error('开启前必须取得可用商品、固定报价及有效的当前百分比 / RUB 费用');
 return {fixedBid:c.fixedBid,bidPct:c.bidPct,bidRub:c.bidRub};
}
export async function submitCpoEnable(store,op,{read=readCpo,enable=performanceEnable}={}){
 let current;try{
  supported(store,op.payload.sku);current=await read(store,op.payload.sku);enableQuote(current);
  if(op.kind!=='cpo_enable'||op.payload.target!==true||current.enabled!==false||current.fingerprint!==op.payload.context.fingerprint||current.fixedBid!==op.payload.context.fixedBid||hash(op.payload.apiBody)!==hash({skus:[current.sku]}))throw Error('CPO 状态、报价或账户已变化，请重新拟定并确认');
 }catch(e){e.noWrite=true;throw e;}
 const response=await enable(current.sku,current.accountRef),r=response?.response?.[0];
 if(!Array.isArray(response?.response)||response.response.length!==1||r?.sku!==current.sku||typeof r.update!=='boolean'||!Number.isFinite(r.bid)||r.bid<0||(r.error!==undefined&&typeof r.error!=='string')||(r.update===true&&Boolean(r.error)))throw Error('performance_enable_receipt_unknown');
 return {mode:'live',externalWrite:true,status:r.update===true&&!r.error?'accepted':'not_updated',sku:current.sku,payloadHash:op.payloadHash,stateObserved:false,reportedBid:r.bid,quoteChanged:r.update===true&&!r.error&&r.bid!==current.fixedBid,responseHash:hash(response),scope:'specific_sku_cpo'};
}
