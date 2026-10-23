import {fullCatalog} from '../ozon.mjs';
import {ozonCall} from './ozon-products.mjs';
const id=v=>(typeof v==='string'||Number.isSafeInteger(v))&&/^[1-9]\d*$/.test(String(v))?String(v):null;
const amount=v=>{if(v==null||v==='')return null;if(!['string','number'].includes(typeof v)||!/^\d+(\.\d+)?$/.test(String(v))||!Number.isFinite(Number(v)))throw Error('ozon_product_amount_invalid');return Number(v);};
// product_id, offer_id and marketplace SKU are distinct identities.
export function catalogueProduct(p){
 const productId=id(p.id);if(!productId)throw Error('ozon_product_id_invalid');
 if(p.sources!=null&&!Array.isArray(p.sources))throw Error('ozon_product_sources_invalid');
 const skus=[...new Set([p.sku,...(p.sources||[]).map(s=>s.sku)].map(id).filter(Boolean))];
 const common={productId,offerId:p.offer_id??null,name:p.name??null,price:amount(p.price),currency:typeof p.currency_code==='string'&&/^[A-Z]{3}$/.test(p.currency_code)?p.currency_code:null,identityKind:'ozon_sku'};
 return (skus.length?skus:[null]).map(sku=>{
  const stocks=Array.isArray(p.stocks?.stocks)?p.stocks.stocks.filter(s=>id(s.sku)===sku&&sku!==null):[];
  const quantities=stocks.map(s=>amount(s.present)),available=stocks.map(s=>{const present=amount(s.present),reserved=amount(s.reserved);return Number.isSafeInteger(present)&&Number.isSafeInteger(reserved)?Math.max(0,present-reserved):null;});
  return {...common,sku,availableStock:available.length&&available.every(n=>n!==null)&&Number.isSafeInteger(available.reduce((a,b)=>a+b,0))?available.reduce((a,b)=>a+b,0):null,stock:quantities.length&&quantities.every(n=>n!==null)?quantities.reduce((a,b)=>a+b,0):null};
 });
}
export async function readOzonCatalogue(store,{call=ozonCall}={}){
 if(store.mode!=='live'||store.marketplace!=='ozon')throw Error('ozon_live_store_required');
 const read=(path,body)=>call(store,path,body);
 const catalogue=await fullCatalog({read}),products=[],skuOwners=new Map();
 for(let i=0;i<catalogue.items.length;i+=100){
  const ids=catalogue.items.slice(i,i+100).map(p=>String(p.productId));
  const response=await read('/v3/product/info/list',{product_id:ids});
  if(!Array.isArray(response.items))throw Error('ozon_product_details_schema');
  const seen=new Set();
  for(const p of response.items){
   const productId=id(p.id);if(!ids.includes(productId)||seen.has(productId))throw Error('ozon_product_details_identity');seen.add(productId);
   for(const row of catalogueProduct(p)){
    if(row.sku&&skuOwners.has(row.sku)&&skuOwners.get(row.sku)!==productId)throw Error('ozon_sku_identity_conflict');
    if(row.sku)skuOwners.set(row.sku,productId);products.push(row);
   }
  }
  if(seen.size!==ids.length)throw Error('ozon_product_details_incomplete');
 }
 return {mode:'live',schemaVersion:2,catalogTotal:catalogue.total,catalogueComplete:true,productsWithoutSku:products.filter(p=>p.sku===null).length,products,orders:null,orderedAmount:null,profit:null,source:'Ozon Seller API · 完整目录及商品信息；未连接销售与广告',fetchedAt:new Date().toISOString()};
}
