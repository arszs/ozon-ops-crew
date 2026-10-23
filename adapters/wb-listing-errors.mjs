import {wbRead} from './wb-api.mjs';import {hash,maskPII} from '../core/repository.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function normalizeWbListingErrors(response){
 const d=response?.data;if(response?.error!==false||!Array.isArray(d?.items)||d.items.length>100||typeof d.cursor?.next!=='boolean')throw Error('WB 草稿错误响应格式无效');
 if(d.cursor.next&&(!d.items.length||!uuid(d.cursor.batchUUID)||!date(d.cursor.updatedAt)))throw Error('WB 草稿错误分页游标无效');
 const seen=new Set(),items=d.items.map(item=>{
  if(!uuid(item.batchUUID)||seen.has(item.batchUUID)||!date(item.updatedAt)||!Array.isArray(item.vendorCodes)||!item.vendorCodes.length||item.vendorCodes.some(v=>typeof v!=='string'||!v||v.length>200)||!item.errors||Array.isArray(item.errors)||typeof item.errors!=='object')throw Error('WB 草稿错误批次无效');seen.add(item.batchUUID);
  if(new Set(item.vendorCodes).size!==item.vendorCodes.length||Object.keys(item.errors).some(v=>!item.vendorCodes.includes(v)))throw Error('WB 草稿错误货号不一致');
  const errors=Object.fromEntries(item.vendorCodes.map(v=>{const messages=Object.hasOwn(item.errors,v)?item.errors[v]:[];if(!Array.isArray(messages)||messages.some(m=>typeof m!=='string'||!m.trim()))throw Error('WB 草稿错误原因格式无效');return [v,messages.map(m=>maskPII(m).slice(0,4000))];}));
  return {batchUUID:item.batchUUID,updatedAt:item.updatedAt,vendorCodes:item.vendorCodes,errors};
 });
 return {items,cursor:d.cursor.next?{updatedAt:d.cursor.updatedAt,batchUUID:d.cursor.batchUUID}:null,more:d.cursor.next};
}
export async function readWbListingErrorPage(store,cursor,{read=wbRead,accountRef}={}){
 const path='/content/v2/cards/error/list?locale=zh',body={cursor:{limit:100,...(cursor||{})},order:{ascending:true}},response=await read(store,path,body,{accountRef});
 return {...normalizeWbListingErrors(response),inputHash:hash({path,body}),responseHash:hash(response)};
}
