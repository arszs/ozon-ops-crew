import {readWbProductIdentity} from './wb-product-identity.mjs';
import {hash} from '../core/repository.mjs';
import {wbRead,wbWritePrice,wbAccount} from './wb-api.mjs';
import {readWbPrice} from './wb-prices.mjs';
import {checkWbWriteProfile} from './wb-products.mjs';
export function priceProfile(store){if(store.marketplace!=='wb'||store.mode!=='live')throw Error('此功能仅用于已连接的 WB 店铺');checkWbWriteProfile(store);if(!['personal','service','base-with-secret'].includes(store.wbPriceTokenType))throw Error('请在私有配置核实 wbPriceTokenType：personal / service / base-with-secret');}
export async function readWbPriceContext(store,product,{read=wbRead,accountRef=wbAccount}={}){
 priceProfile(store);const identity=await readWbProductIdentity(store,product,{read,accountRef});
 const {price}=await readWbPrice(store,identity.product,{read,accountRef:identity.accountRef});price.sizes.sort((a,b)=>a.chrtId.localeCompare(b.chrtId));
 if(await accountRef(store)!==identity.accountRef)throw Error('WB 账户已变化');
 return {accountRef:identity.accountRef,product:identity.product,title:identity.title,price,identityHash:identity.identityHash};
}
export function createWbPriceSubmit({context=readWbPriceContext,write=wbWritePrice,clock=()=>Date.now()}={}){
 return async(store,op,{beforeSend=async()=>{}}={})=>{
  const p=op.payload;
  const checkExpiry=()=>{for(const at of [op.approvedAt,p.checkedAt])if(!Number.isFinite(Date.parse(at))||clock()-Date.parse(at)>900000||Date.parse(at)>clock()+5000)throw Error('价格确认已过期，请重新拟定');};
  try{
   priceProfile(store);if(op.kind!=='wb_price'||op.approvedHash!==op.payloadHash||hash(p)!==op.payloadHash)throw Error('WB 价格审批无效');
   const fresh=await context(store,p.context.product);if(hash(fresh)!==hash(p.context))throw Error('当前价格、折扣、尺码或账户已变化，请重新拟定');
   checkExpiry();await beforeSend();checkExpiry();
  }catch(e){e.noWrite=true;throw e;}
  const result=await write(store,p.plan.endpoint,p.plan.apiBody,{accountRef:p.context.accountRef,beforeSend:async()=>{try{checkExpiry();await beforeSend();checkExpiry();}catch(e){e.noWrite=true;throw e;}}});
  if(result?.error!==false||!Number.isSafeInteger(result.data?.id)||result.data.id<=0||typeof result.data.alreadyExists!=='boolean')throw Error('WB 价格任务响应不明，请读取核对，禁止重发');
  return {externalWrite:true,status:'submitted',taskId:result.data.id,alreadyExists:result.data.alreadyExists,responseHash:hash(result)};
 };
}
export const submitWbPrice=createWbPriceSubmit();
export async function readWbPriceResult(store,op,{context=readWbPriceContext,read=wbRead}={}){
 const p=op.payload,current=await context(store,p.context.product);if(current.accountRef!==p.context.accountRef||current.identityHash!==p.context.identityHash)throw Error('WB 调价账户或尺码已变化');
 const matches=current.price.currency===p.plan.currency&&current.price.discount===p.plan.discount&&current.price.clubDiscount===p.plan.clubDiscount&&p.plan.rows.every(r=>current.price.sizes.some(s=>s.chrtId===r.chrtId&&s.price===r.price));
 let task=null,goods=null,originProven=false,terminalFailure=false;
 if(op.receipt?.taskId){
  const id=op.receipt.taskId,r=await read(store,'/api/v2/history/tasks?uploadID='+id,undefined,{accountRef:p.context.accountRef});
  if(r.error!==false||r.data&&r.data.uploadID!==id)throw Error('WB 价格任务身份无效');task=r.data;
  if(task&&![3,4,5,6].includes(task.status))throw Error('WB 价格任务状态未知');
  if(task&&[3,5,6].includes(task.status)){
   const response=await read(store,'/api/v2/history/goods/task?uploadID='+id+'&limit=1000&offset=0',undefined,{accountRef:p.context.accountRef});goods=response.data?.historyGoods;
   if(response.error!==false||response.data?.uploadID!==id||!Array.isArray(goods)||goods.length!==p.plan.apiBody.data.length)throw Error('WB 价格任务明细不完整');
   const entries=p.plan.apiBody.data;originProven=task.status===3&&goods.every(g=>g.status===2&&!g.errorText&&g.currencyIsoCode4217===p.plan.currency&&g.vendorCode===p.context.price.vendorCode)&&entries.every(e=>goods.filter(g=>g.nmID===e.nmID&&(p.plan.mode!=='size'||g.sizeID===e.sizeID)&&g.price===e.price&&g.discount===p.plan.discount).length===1);
   terminalFailure=task.status===6||task.status===5;
  }else if(task?.status===4)terminalFailure=true;
 }
 return {checkedAt:new Date().toISOString(),matches,originProven,terminalFailure,taskStatus:task?.status||null,taskHash:task?hash(task):null,goodsHash:goods?hash(goods):null,failedItems:goods?.filter(g=>g.status!==2).map(g=>({nmID:g.nmID,sizeID:g.sizeID,status:g.status,error:'平台拒绝或价格隔离，请在 WB 核对原因'}))||[],price:current.price,verified:matches&&(!op.receipt?.taskId||originProven),message:terminalFailure?'WB 未完整执行价格任务，请核对平台错误或价格隔离':matches?(op.receipt?.taskId&&!originProven?'当前价格匹配，但任务尚未核对成功；请稍后读取，不要重发':'当前价格已匹配目标；不是成交收入或利润保证'):'当前价格尚未匹配目标；请稍后读取，不要重复发送'};
}
