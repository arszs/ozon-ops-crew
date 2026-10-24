import {ozonCall} from './ozon-products.mjs';
import {priceAccount} from './ozon-prices.mjs';
import {hash} from '../core/repository.mjs';
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const id=v=>['string','number'].includes(typeof v)&&/^[1-9]\d*$/.test(String(v))?String(v):null;
const text=v=>typeof v==='string'?v.slice(0,300):'';
const pending=new Set(['awaiting_packaging','awaiting_deliver']);
export function publicPosting(raw,{from,to,now=new Date()}={}){
 if(!raw||typeof raw.posting_number!=='string'||!/^\d[\d-]{1,79}$/.test(raw.posting_number)||typeof raw.status!=='string'||!Array.isArray(raw.products))throw Error('orders_schema_invalid');
 const createdAt=instant(raw.in_process_at)||instant(raw.created_at);
 if(!createdAt||Date.parse(createdAt)<Date.parse(from)||Date.parse(createdAt)>Date.parse(to))throw Error('orders_period_unverified');
 const products=raw.products.map(p=>{const sku=id(p.sku);if(!sku||!Number.isSafeInteger(p.quantity)||p.quantity<=0)throw Error('orders_schema_invalid');const currency=['RUB','CNY'].includes(p.currency_code)?p.currency_code:null,value=typeof p.price==='number'?p.price:typeof p.price==='string'&&/^\d+(\.\d{1,2})?$/.test(p.price)?Number(p.price):null;return {sku,offerId:text(p.offer_id),name:text(p.name),quantity:p.quantity,currency,unitPrice:currency&&Number.isFinite(value)&&value>=0?value:null};});
 const shipmentAt=instant(raw.shipment_date_without_delay)||instant(raw.shipment_date),needsShipping=pending.has(raw.status),overdue=needsShipping&&shipmentAt!==null&&Date.parse(shipmentAt)<+now;
 // Buyer names, contact details, addresses and raw analytics never enter storage.
 return {number:raw.posting_number,status:raw.status,createdAt,shipmentAt,needsShipping,overdue,products};
}
export async function readFbsOrders(store,{call=ozonCall,account=priceAccount,now=new Date(),days=7,maxPages=10}={}){
 if(store.marketplace!=='ozon'||store.mode!=='live'||!Number.isInteger(days)||days<1||days>31)throw Error('orders_store_invalid');
 const owner=await account(store),to=now.toISOString(),from=new Date(+now-days*86400000).toISOString(),items=[],seen=new Set(),cursors=new Set();let cursor='';
 for(let page=0;page<maxPages;page++){
  const result=await call(store,'/v4/posting/fbs/list',{sort_dir:'DESC',filter:{since:from,to},limit:100,cursor,with:{analytics_data:false,financial_data:false}});
  if(!Array.isArray(result.postings)||typeof result.has_next!=='boolean'||typeof result.cursor!=='string')throw Error('orders_schema_invalid');
  for(const raw of result.postings){const row=publicPosting(raw,{from,to,now});if(seen.has(row.number))throw Error('orders_changed_during_read');seen.add(row.number);items.push(row);}
  if(await account(store)!==owner)throw Error('strategy_account_changed');
  if(!result.has_next)return {state:'ready',scope:'FBS',complete:true,period:{from,to},checkedAt:now.toISOString(),items,summary:{postings:items.length,needsShipping:items.filter(p=>p.needsShipping).length,overdue:items.filter(p=>p.overdue).length},evidenceHash:hash({owner,from,to,items})};
  if(!result.postings.length||!result.cursor||result.cursor===cursor||cursors.has(result.cursor))throw Error('orders_pagination_incomplete');cursors.add(result.cursor);cursor=result.cursor;
 }
 throw Error('orders_capacity_exceeded');
}
