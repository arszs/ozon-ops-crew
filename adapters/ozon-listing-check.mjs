import {ozonCall} from './ozon-products.mjs';
const rows=d=>Array.isArray(d?.result)?d.result:Array.isArray(d?.result?.items)?d.result.items:Array.isArray(d?.items)?d.items:Array.isArray(d?.warehouses)?d.warehouses:Array.isArray(d?.delivery_methods)?d.delivery_methods:Array.isArray(d?.result?.delivery_methods)?d.result.delivery_methods:[];
export function ozonBuyerIdentity(product){const skus=[...new Set([product?.sku,...(product?.sources||[]).map(s=>s.sku)].filter(v=>(typeof v==='string'||Number.isSafeInteger(v))&&/^[1-9]\d*$/.test(String(v))).map(String))];return {buyerSkus:skus,buyerUrl:skus.length===1?'https://www.ozon.ru/product/'+skus[0]+'/':null};}
export async function inspectOzonListing(store,job,{call=ozonCall}={}){
 const offer=job.canonical.sku,id=String(job.importResult?.productId||'');if(!/^\d+$/.test(id))throw Error('请先创建商品卡片');
 const requests=[['pictures','/v2/product/pictures/info',{product_id:[id]}],['product','/v3/product/info/list',{offer_id:[offer]}],['description','/v1/product/info/description',{offer_id:offer,product_id:Number(id)}],['stock','/v4/product/info/stocks',{filter:{offer_id:[offer],visibility:'ALL'},limit:100,cursor:''}],['warehouses','/v2/warehouse/list',{limit:100,offset:0}],['delivery','/v2/delivery-method/list',{filter:{},limit:100,offset:0}]];
 const data={},errors=[];for(const [key,path,body] of requests){try{data[key]=await call(store,path,body);}catch(e){errors.push({part:key,message:e.message});}}
 const warehouses=rows(data.warehouses),methods=[];
 for(const w of warehouses){const wid=w.warehouse_id??w.id;try{const d=await call(store,'/v2/delivery-method/list',{filter:{warehouse_id:wid},limit:100,offset:0});methods.push(...rows(d));}catch(e){errors.push({part:'delivery:'+wid,message:e.message});}}
 if(methods.length)data.delivery={delivery_methods:[...new Map(methods.map(m=>[String(m.id),m])).values()]};
 const product=rows(data.product).find(p=>p.offer_id===offer&&String(p.id)===id);if(!product)throw Error('无法核对当前商品 ID 与货号');
 const stockItem=rows(data.stock).find(p=>p.offer_id===offer||String(p.product_id)===id),stocks=stockItem?.stocks||product.stocks?.stocks||null;
 const images=[...new Set([...(Array.isArray(product.primary_image)?product.primary_image:[]),...(product.images||[])].filter(u=>typeof u==='string'))];
 const present=Array.isArray(stocks)&&stocks.length&&stocks.every(s=>Number.isFinite(s.present))?stocks.reduce((n,s)=>n+s.present,0):null;
 const description=data.description?.result?.description??data.description?.description??null;
 const identity=ozonBuyerIdentity(product);
 return {...identity,checkedAt:new Date().toISOString(),productId:id,offerId:offer,title:product.name,description,images,primaryImage:product.primary_image??null,pictureStatus:rows(data.pictures).find(p=>String(p.product_id)===id)??null,price:product.price,currency:product.currency_code,statuses:product.statuses,productErrors:product.errors||[],stocks,present,hasStock:product.stocks?.has_stock??null,
  warehouses:rows(data.warehouses).map(w=>({id:w.warehouse_id??w.id,name:w.name,status:w.status,type:w.warehouse_type,isRfbs:w.is_rfbs})),deliveryMethods:rows(data.delivery).map(m=>({id:m.id,name:m.name,status:m.status,warehouseId:m.warehouse_id,providerId:m.provider_id})),responseShapes:{warehouses:Object.keys(data.warehouses||{}),delivery:Object.keys(data.delivery||{})},errors,
  blockers:[...(present===0||product.stocks?.has_stock===false?['no_stock']:[]),...(!errors.some(e=>e.part==='warehouses')&&!rows(data.warehouses).length?['no_warehouse']:[]),...(!errors.some(e=>e.part.startsWith('delivery'))&&!rows(data.delivery).length?['no_delivery_method']:[])],
  scope:'Seller API check, not a buyer-address delivery quote. OGL pricing does not activate a delivery method.'};
}
