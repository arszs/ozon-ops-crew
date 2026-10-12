import {wbRead} from './wb-api.mjs';
import {wbNmId} from './wb-prices.mjs';
export function inventorySizes(product){
 const sizes=product.sizes;if(!Array.isArray(sizes)||!sizes.length||sizes.length>1000)throw Error('请同步商品尺码；一次最多读取 1000 个尺码');
 const ids=sizes.map(s=>wbNmId(s.chrtId));if(new Set(ids).size!==ids.length)throw Error('WB 目录尺码重复');return ids.map(Number);
}
export function normalizeWbWarehouses(response){
 if(!Array.isArray(response))throw Error('WB 仓库列表格式无效');const seen=new Set();
 return response.map(w=>{if(!Number.isSafeInteger(w.id)||w.id<=0||seen.has(w.id)||typeof w.name!=='string'||typeof w.isDeleting!=='boolean'||typeof w.isProcessing!=='boolean')throw Error('WB 仓库标识或状态无效');seen.add(w.id);return {id:String(w.id),name:w.name,isDeleting:w.isDeleting,isProcessing:w.isProcessing,deliveryType:Number.isSafeInteger(w.deliveryType)?w.deliveryType:null};});
}
export function normalizeWbStocks(response,product){
 const ids=inventorySizes(product),rows=response?.stocks;if(!Array.isArray(rows))throw Error('WB 库存响应格式无效');const found=new Map();
 for(const r of rows){if(!Number.isSafeInteger(r.chrtId)||!ids.includes(r.chrtId)||found.has(r.chrtId)||!Number.isSafeInteger(r.amount)||r.amount<0)throw Error('WB 库存尺码或数量无效');found.set(r.chrtId,r.amount);}
 return product.sizes.map(s=>({chrtId:s.chrtId,techSize:s.techSize||null,amount:found.get(Number(s.chrtId))??null}));
}
export async function readWbWarehouses(store,{read=wbRead,accountRef}={}){const path='/api/v3/warehouses',response=await read(store,path,undefined,{accountRef});return {path,response,warehouses:normalizeWbWarehouses(response)};}
export async function readWbStocks(store,warehouseId,product,{read=wbRead,accountRef}={}){const path='/api/v3/stocks/'+wbNmId(warehouseId),body={chrtIds:inventorySizes(product)},response=await read(store,path,body,{accountRef});return {path,body,response,stocks:normalizeWbStocks(response,product)};}
