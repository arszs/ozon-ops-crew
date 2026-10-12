import {wbRead} from './wb-api.mjs';
const id=n=>Number.isSafeInteger(n)&&n>0;
export function wbCard(p){
 if(!p||!id(p.nmID)||typeof p.vendorCode!=='string'||typeof p.title!=='string')throw Error('WB 商品身份格式无效');
 if(p.sizes!==undefined&&!Array.isArray(p.sizes))throw Error('WB 尺码格式无效');
 const seen=new Set(),sizes=(p.sizes||[]).map(s=>{if(!id(s.chrtID)||seen.has(s.chrtID)||!Array.isArray(s.skus)||s.skus.some(v=>typeof v!=='string'))throw Error('WB 尺码身份格式无效');seen.add(s.chrtID);return {chrtId:String(s.chrtID),techSize:typeof s.techSize==='string'?s.techSize:null,barcodes:[...new Set(s.skus)]};});
 return {productId:String(p.nmID),sku:String(p.nmID),identityKind:'wb_nmid',offerId:p.vendorCode,name:p.title,subjectId:id(p.subjectID)?p.subjectID:null,subjectName:typeof p.subjectName==='string'?p.subjectName:null,brand:typeof p.brand==='string'?p.brand:null,sizes,price:null,currency:null,stock:null,updatedAt:typeof p.updatedAt==='string'?p.updatedAt:null};
}
export async function wbCataloguePage(store,cursor='',{read=wbRead,accountRef}={}){
 let previous={};if(cursor){try{previous=JSON.parse(cursor);}catch{throw Error('WB 保存的分页位置无效');}if(!id(previous.nmID)||typeof previous.updatedAt!=='string'||!Number.isFinite(Date.parse(previous.updatedAt)))throw Error('WB 保存的分页位置无效');previous={updatedAt:previous.updatedAt,nmID:previous.nmID};}
 const body={settings:{sort:{ascending:true},cursor:{limit:100,...previous},filter:{withPhoto:-1}}};const response=await read(store,'/content/v2/get/cards/list?locale=zh',body,{accountRef});
 const c=response?.cursor;if(response?.error||!Array.isArray(response?.cards)||!c||!Number.isSafeInteger(c.total)||c.total<0||c.total>100||c.total!==response.cards.length)throw Error('WB 目录分页不完整');
 const rows=response.cards.map(wbCard),ids=rows.map(r=>r.productId);if(new Set(ids).size!==ids.length)throw Error('WB 单页商品重复');
 const complete=c.total<100;let next='';if(!complete){if(!id(c.nmID)||typeof c.updatedAt!=='string'||!Number.isFinite(Date.parse(c.updatedAt)))throw Error('WB 缺少下一页位置');next=JSON.stringify({updatedAt:c.updatedAt,nmID:c.nmID});if(next===cursor)throw Error('WB 分页位置重复，请重新读取');}
 return {body,response,rows,ids,next,complete};
}
