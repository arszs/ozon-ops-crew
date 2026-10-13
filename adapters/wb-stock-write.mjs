import {hash} from '../core/repository.mjs';
import {wbRead,wbWriteStock,wbAccount} from './wb-api.mjs';
import {readWbProductIdentity} from './wb-product-identity.mjs';
import {checkWbWriteProfile} from './wb-products.mjs';
import {readWbWarehouses,readWbStocks} from './wb-inventory.mjs';
import {wbNmId} from './wb-prices.mjs';
function profile(store){if(store.marketplace!=='wb'||store.mode!=='live')throw Error('此功能仅用于已连接的 WB 店铺');checkWbWriteProfile(store);}
export async function readWbStockContext(store,product,warehouseId,{read=wbRead,accountRef=wbAccount}={}){
 profile(store);const identity=await readWbProductIdentity(store,product,{read,accountRef}),options={read,accountRef:identity.accountRef};
 const {warehouses}=await readWbWarehouses(store,options),warehouse=warehouses.find(w=>w.id===wbNmId(warehouseId));
 if(!warehouse||warehouse.isDeleting||warehouse.isProcessing)throw Error('仓库不存在、删除中或更新中，请先核对 WB');
 const {stocks}=await readWbStocks(store,warehouse.id,identity.product,options);
 if(await accountRef(store)!==identity.accountRef)throw Error('WB 账户已变化');
 return {...identity,warehouse,stocks};
}
export function stockVersion(context,rows){return hash({accountRef:context.accountRef,identityHash:context.identityHash,warehouse:context.warehouse,stocks:rows.map(r=>{const s=context.stocks.find(s=>s.chrtId===r.chrtId);if(!s)throw Error('WB 尺码已变化');return {chrtId:s.chrtId,amount:s.amount};})});}
export function buildWbStockPlan(context,input){
 if(input.availableConfirmed!==true)throw Error('请确认填写的是扣除预留后的可售数量，不是增加数量');
 if(!Array.isArray(input.sizes)||!input.sizes.length||input.sizes.length>1000||new Set(input.sizes.map(s=>String(s.chrtId))).size!==input.sizes.length)throw Error('请选择 1–1000 个不重复尺码');
 const rows=input.sizes.map(s=>{
  const before=context.stocks.find(x=>x.chrtId===String(s.chrtId));if(!before)throw Error('尺码不属于当前商品');
  if(!/^\d+$/.test(String(s.amount))||!Number.isSafeInteger(Number(s.amount))||Number(s.amount)>100000)throw Error('可售数量需要 0–100000 的整数');
  if(before.amount===null&&input.unknownConfirmed!==true)throw Error('API 未返回部分旧库存，请确认已独立核实这些尺码的可售量');
  return {chrtId:before.chrtId,techSize:before.techSize,before:before.amount,amount:Number(s.amount)};
 }).sort((a,b)=>a.chrtId.localeCompare(b.chrtId));
 if(rows.every(r=>r.before===r.amount))throw Error('目标与当前库存相同，无需发送');
 return {rows,version:stockVersion(context,rows),endpoint:'/api/v3/stocks/'+context.warehouse.id,apiBody:{stocks:rows.map(r=>({chrtId:Number(r.chrtId),amount:r.amount}))},availableConfirmed:true,unknownConfirmed:input.unknownConfirmed===true};
}
export function createWbStockSubmit({context=readWbStockContext,write=wbWriteStock,clock=()=>Date.now()}={}){
 return async(store,op)=>{
  const p=op.payload,checkExpiry=()=>{for(const at of [op.approvedAt,p.checkedAt])if(!Number.isFinite(Date.parse(at))||clock()-Date.parse(at)>900000||Date.parse(at)>clock()+5000)throw Error('库存确认已过期，请重新拟定');};
  try{
   profile(store);if(op.kind!=='wb_stock'||op.approvedHash!==op.payloadHash||hash(p)!==op.payloadHash)throw Error('WB 库存审批无效');
   const fresh=await context(store,p.context.product,p.context.warehouse.id);if(stockVersion(fresh,p.plan.rows)!==p.plan.version)throw Error('账户、仓库、尺码或所选库存已变化，请重新拟定');checkExpiry();
  }catch(e){e.noWrite=true;throw e;}
  const receipt=await write(store,p.plan.endpoint,p.plan.apiBody,{accountRef:p.context.accountRef,beforeSend:checkExpiry});
  if(receipt?.status!==204)throw Error('WB 库存响应不明，请读取核对，禁止重发');
  return {status:'submitted',httpStatus:204,externalWrite:true,responseHash:hash(receipt)};
 };
}
export const submitWbStock=createWbStockSubmit();
export async function readWbStockResult(store,op,{context=readWbStockContext}={}){
 const p=op.payload,current=await context(store,p.context.product,p.context.warehouse.id);
 if(current.accountRef!==p.context.accountRef||current.identityHash!==p.context.identityHash)throw Error('WB 库存账户或商品尺码已变化');
 const rows=p.plan.rows.map(r=>({...r,current:current.stocks.find(s=>s.chrtId===r.chrtId)?.amount??null})),known=rows.every(r=>r.current!==null),matches=known&&rows.every(r=>r.current===r.amount);
 return {checkedAt:new Date().toISOString(),version:stockVersion(current,p.plan.rows),rows,known,matches,originProven:false,message:matches?'已读取到目标库存；不证明本操作导致变化，也不代表商品已开售':known?'当前库存与目标不同，可能受订单或其他修改影响；请核对，不要重发':'部分尺码库存仍未知；请稍后读取，不要重发'};
}

export async function listWbStockWarehouses(store,{read=wbRead,accountRef=wbAccount}={}){
 profile(store);const owner=await accountRef(store),result=await readWbWarehouses(store,{read,accountRef:owner});if(await accountRef(store)!==owner)throw Error('WB 账户已变化');return {warehouses:result.warehouses,checkedAt:new Date().toISOString()};
}
