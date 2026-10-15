import {wbRead} from './wb-api.mjs';
export function wbNmId(value){const s=String(value);if(!/^[1-9]\d*$/.test(s)||!Number.isSafeInteger(Number(s)))throw Error('WB nmID 无效');return s;}
export function wbPricePath(nmID){return '/api/v2/list/goods/filter?limit=1&offset=0&filterNmID='+wbNmId(nmID);}
export function normalizeWbPrice(response,product){
 const goods=response?.data?.listGoods;
 if(response?.error!==false||!Array.isArray(goods)||goods.length>1)throw Error('WB 价格响应格式无效');
 if(!goods.length)throw Error('WB 未返回此商品价格；请核对目录与 API 权限');
 const p=goods[0];if(!Number.isSafeInteger(p.nmID)||String(p.nmID)!==product.sku||p.vendorCode!==product.offerId)throw Error('WB 价格商品标识不匹配，请重新同步目录');
 if(typeof p.currencyIsoCode4217!=='string'||!/^[A-Z]{3}$/.test(p.currencyIsoCode4217))throw Error('WB 价格币种缺失或无效');
 for(const k of ['discount','clubDiscount'])if(!Number.isInteger(p[k])||p[k]<0||p[k]>100)throw Error('WB 折扣格式无效');
 if(typeof p.editableSizePrice!=='boolean'||!Array.isArray(p.sizes)||!p.sizes.length)throw Error('WB 尺码价格缺失');
 const seen=new Set(),sizes=p.sizes.map(s=>{
  if(!Number.isSafeInteger(s.sizeID)||s.sizeID<=0||seen.has(s.sizeID)||typeof s.techSizeName!=='string')throw Error('WB 尺码标识无效');seen.add(s.sizeID);
  for(const k of ['price','discountedPrice','clubDiscountedPrice'])if(typeof s[k]!=='number'||!Number.isFinite(s[k])||s[k]<0)throw Error('WB 尺码价格无效');
  if(!Number.isSafeInteger(s.price)||s.discountedPrice>s.price||s.clubDiscountedPrice>s.discountedPrice)throw Error('WB 尺码价格与折扣不一致');
  return {chrtId:String(s.sizeID),techSize:s.techSizeName,price:s.price,discountedPrice:s.discountedPrice,clubDiscountedPrice:s.clubDiscountedPrice};
 });
 const expected=product.sizes?.map(s=>s.chrtId)||[];
 if(!expected.length||expected.length!==sizes.length||sizes.some(s=>!expected.includes(s.chrtId)))throw Error('WB 尺码与目录不一致，请重新同步目录后读取价格');
 return {nmID:product.sku,vendorCode:p.vendorCode,currency:p.currencyIsoCode4217,discount:p.discount,clubDiscount:p.clubDiscount,editableSizePrice:p.editableSizePrice,sizes};
}
export async function readWbPrice(store,product,{read=wbRead,accountRef}={}){const path=wbPricePath(product.sku),response=await read(store,path,undefined,{accountRef});return {path,response,price:normalizeWbPrice(response,product)};}
