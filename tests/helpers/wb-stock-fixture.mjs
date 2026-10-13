import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Workspace} from '../../core/workspace.mjs';
import {readWbStockContext,createWbStockSubmit,readWbStockResult,listWbStockWarehouses} from '../../adapters/wb-stock-write.mjs';
export async function stockFixture({onWrite}={}){
 const dir=await mkdtemp(join(tmpdir(),'wb-stock-write-')),store={id:'wb-stock-test',name:'合成库存测试 · 无真实 API 请求',marketplace:'wb',mode:'live',wbRegion:'cn',wbContentTokenType:'personal'};
 const product={sku:'123',offerId:'TEST-STOCK'},card={nmID:123,vendorCode:'TEST-STOCK',title:'合成测试 · 可售库存',sizes:[{chrtID:10,techSize:'M',skus:['1234567890123']},{chrtID:11,techSize:'L',skus:['1234567890124']}]};
 const f={dir,store,product,card,owner:'synthetic-stock-owner',warehouses:[{id:50,name:'测试卖家仓库 A',isDeleting:false,isProcessing:false,deliveryType:1},{id:60,name:'测试卖家仓库 B',isDeleting:false,isProcessing:false,deliveryType:1}],stock:new Map([[50,[{chrtId:10,amount:8},{chrtId:11,amount:4}]],[60,[{chrtId:10,amount:3}]]]),writes:[]};
 const read=async(s,path)=>{
  if(path==='/content/v2/get/cards/list')return {cards:[structuredClone(card)],cursor:{total:1}};
  if(path==='/api/v3/warehouses')return structuredClone(f.warehouses);
  if(path.startsWith('/api/v3/stocks/'))return {stocks:structuredClone(f.stock.get(Number(path.split('/').at(-1)))||[])};
  throw Error('Unexpected fixture read '+path);
 };
 const context=(s,p,w)=>readWbStockContext(s,p,w,{read,accountRef:async()=>f.owner});
 const write=async(s,path,body,options)=>{await options.beforeSend();f.writes.push({path,body:structuredClone(body)});if(onWrite)return onWrite(f);return {status:204};};
 const options={stores:[store],wbStockProduct:async(s,id)=>{if(String(id)!=='123')throw Error('Unknown fixture SKU');return product;},wbStockContext:context,wbStockSubmit:createWbStockSubmit({context,write}),wbStockResult:(s,o)=>readWbStockResult(s,o,{context}),wbStockWarehouses:s=>listWbStockWarehouses(s,{read,accountRef:async()=>f.owner})};
 const ws=new Workspace(join(dir,'workspace.json'),options);await ws.init();
 return Object.assign(f,{ws,options,read,context,input:{nmID:'123',warehouseId:'50',availableConfirmed:true,unknownConfirmed:false,sizes:[{chrtId:'10',amount:'12'}]},apply(){const w=f.writes.at(-1),rows=f.stock.get(Number(w.path.split('/').at(-1)));for(const x of w.body.stocks){const row=rows.find(r=>r.chrtId===x.chrtId);if(row)row.amount=x.amount;else rows.push({...x});}},cleanup:()=>rm(dir,{recursive:true,force:true})});
}
