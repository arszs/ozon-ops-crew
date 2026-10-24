import {withProductMutation} from '../core/product-mutation-lock.mjs';
import {ozonCall} from './ozon-products.mjs';
import {catalogueProduct} from './ozon-catalogue.mjs';
import {credentials} from '../ozon.mjs';
import {storeCredentials} from './marketplaces.mjs';
import {hash} from '../core/repository.mjs';
const amount=v=>{if(!['number','string'].includes(typeof v)||!/^\d+(\.\d+)?$/.test(String(v))||!Number.isFinite(Number(v)))throw Error('Ozon price field missing');return Number(v);};
export async function priceAccount(store){const c=store.id==='ozon-live'?await credentials():await storeCredentials(store).then(c=>({client:c.OZON_CLIENT_ID,key:c.OZON_API_KEY}));if(!c.client||!c.key)throw Error('Ozon credentials missing');return hash({client:c.client});}
export async function readPrice(store,sku,{call=ozonCall,account=priceAccount}={}){
 if(store.marketplace!=='ozon'||store.mode!=='live'||typeof sku!=='string'||! /^[1-9]\d*$/.test(sku))throw Error('需要真实 Ozon 店铺与平台 SKU');
 const accountRef=await account(store),details=await call(store,'/v3/product/info/list',{sku:[sku]});
 if(!Array.isArray(details.items)||details.items.length!==1)throw Error('SKU must resolve to exactly one product');
 const product=catalogueProduct(details.items[0]).find(p=>p.sku===sku);if(!product)throw Error('Ozon SKU identity mismatch');
 const d=await call(store,'/v5/product/info/prices',{filter:{product_id:[product.productId],visibility:'ALL'},limit:1,cursor:''});
 if(!Array.isArray(d.items)||d.items.length!==1||String(d.items[0].product_id)!==product.productId||d.items[0].offer_id!==product.offerId)throw Error('Ozon price identity mismatch');
 const item=d.items[0],p=item.price;
 if(!p||typeof p.currency_code!=='string')throw Error('Ozon price currency missing');
 const context={sku,productId:product.productId,offerId:product.offerId,name:product.name,accountRef,currency:p.currency_code,price:amount(p.price),oldPrice:amount(p.old_price),minPrice:amount(p.min_price),vat:String(amount(p.vat)),marketingPrice:p.marketing_seller_price==null?null:amount(p.marketing_seller_price),autoApply:p.auto_action_enabled??null,autoAdd:p.auto_add_to_ozon_actions_list_enabled??null,actions:item.marketing_actions??null};
 return {...context,checkedAt:new Date().toISOString(),fingerprint:hash(context)};
}
export function priceContextBlockers(context){
 const blockers=[];
 if(context.currency!=='RUB')blockers.push({code:'currency_not_rub',message:'当前价格模型仅支持 RUB，请核对账户币种。'});
 if(context.autoApply!==false||context.autoAdd!==false)blockers.push({code:'automatic_promotions_not_disabled',message:'自动促销已开启或状态未核实。先在 Ozon 核对促销设置，再决定是否进行单变量价格测试。'});
 if(context.marketingPrice!==null&&context.marketingPrice>0&&context.marketingPrice!==context.price)blockers.push({code:'different_marketing_price',message:'存在不同的促销价，当前不能把销量变化只归因于本次调价。'});
 return blockers;
}
export function priceBody(context,target){
 const blockers=priceContextBlockers(context);if(blockers.length)throw Error(blockers[0].message);
 if(!Number.isFinite(target)||target<=0||Math.abs(target*100-Math.round(target*100))>1e-7||target===context.price)throw Error('目标价格无效或未改变');
 if(context.oldPrice>0&&target>=context.oldPrice)throw Error('目标价必须低于现有划线价；此操作不修改划线价');
 if(target<context.minPrice)throw Error('目标价低于 Ozon 当前最低价格');
 if(!['0','0.05','0.07','0.1','0.2','0.22'].includes(context.vat))throw Error('需要核实平台税率');
 const productId=Number(context.productId);if(!Number.isSafeInteger(productId)||productId<=0)throw Error('Invalid product ID');
 return {prices:[{product_id:productId,price:target.toFixed(2),currency_code:'RUB',old_price:String(context.oldPrice),vat:context.vat,auto_add_to_ozon_actions_list_enabled:'UNKNOWN',price_strategy_enabled:'UNKNOWN'}]};
}
export function submitPrice(store,op,options={}){const c=op.payload?.context;return withProductMutation(c?.accountRef,c?.productId,()=>submitPriceLocked(store,op,options));}
async function submitPriceLocked(store,op,{read=readPrice,call=ozonCall}={}){
 let current;try{current=await read(store,op.payload.sku);if(current.fingerprint!==op.payload.context.fingerprint||hash(priceBody(current,op.payload.target))!==hash(op.payload.apiBody))throw Error('平台价格或条件已变化，请重新拟定并确认');}catch(e){e.noWrite=true;throw e;}
 const d=await call(store,'/v1/product/import/prices',op.payload.apiBody,{write:true,expectedAccountRef:current.accountRef});
 if(!Array.isArray(d.result)||d.result.length!==1||String(d.result[0].product_id)!==current.productId||d.result[0].offer_id!==current.offerId)throw Error('Price receipt identity unknown');
 const r=d.result[0];if(r.updated===false){const e=Error('Ozon 拒绝调价：'+JSON.stringify(r.errors||[]).slice(0,250));e.noWrite=true;throw e;}
 if(r.updated!==true||!Array.isArray(r.errors)||r.errors.length)throw Error('Price update result ambiguous');
 return {mode:'live',externalWrite:true,status:'accepted',productId:current.productId,payloadHash:op.payloadHash,priceObserved:false};
}
