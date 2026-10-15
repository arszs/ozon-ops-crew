import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Workspace} from '../../core/workspace.mjs';
import {readWbPriceContext,createWbPriceSubmit,readWbPriceResult} from '../../adapters/wb-price-write.mjs';
export async function priceFixture({onWrite}={}){
 const dir=await mkdtemp(join(tmpdir(),'wb-price-write-'));
 const store={id:'wb-price-test',name:'合成价格测试 · 无真实 API 请求',marketplace:'wb',mode:'live',wbRegion:'cn',wbContentTokenType:'personal',wbPriceTokenType:'personal'};
 const product={sku:'123',offerId:'TEST-SHIRT'},card={nmID:123,vendorCode:'TEST-SHIRT',title:'合成测试 · 纯棉衬衫',sizes:[{chrtID:10,techSize:'M',skus:['1234567890123']},{chrtID:11,techSize:'L',skus:['1234567890124']}]};
 const price={nmID:123,vendorCode:product.offerId,currencyIsoCode4217:'CNY',discount:20,clubDiscount:5,editableSizePrice:true,sizes:[{sizeID:10,techSizeName:'M',price:100,discountedPrice:80,clubDiscountedPrice:76},{sizeID:11,techSizeName:'L',price:120,discountedPrice:96,clubDiscountedPrice:91.2}]};
 const f={store,product,card,price,owner:'synthetic-price-owner',task:null,goods:[],writes:[],dir};
 const accountRef=async()=>f.owner;
 const read=async(s,path)=>{
  if(path==='/content/v2/get/cards/list')return {cards:[structuredClone(card)],cursor:{total:1}};
  if(path.startsWith('/api/v2/list/goods/filter?'))return {error:false,data:{listGoods:[structuredClone(price)]}};
  if(path.startsWith('/api/v2/history/tasks?'))return {error:false,data:structuredClone(f.task)};
  if(path.startsWith('/api/v2/history/goods/task?'))return {error:false,data:{uploadID:42,historyGoods:structuredClone(f.goods)}};
  throw Error('Unexpected fixture read '+path);
 };
 const context=(s,p)=>readWbPriceContext(s,p,{read,accountRef});
 const write=async(s,path,body,options)=>{await options.beforeSend();f.writes.push({path,body:structuredClone(body)});if(onWrite)return onWrite(f);return {error:false,data:{id:42,alreadyExists:false}};};
 const options={stores:[store],wbPriceProduct:async(s,nmID)=>{if(nmID!=='123')throw Error('Unknown fixture SKU');return product;},wbPriceContext:context,wbPriceSubmit:createWbPriceSubmit({context,write}),wbPriceResult:(s,o)=>readWbPriceResult(s,o,{context,read})};
 const ws=new Workspace(join(dir,'workspace.json'),options);await ws.init();
 const input={nmID:'123',currency:'CNY',mode:'uniform',price:'150',discount:'20',feePct:'10',minMarginPct:'15',costsConfirmed:true,promotionReviewed:true,sizes:[{chrtId:'10',price:'150',fixedCost:'50'},{chrtId:'11',price:'160',fixedCost:'55'}]};
 return Object.assign(f,{ws,options,input,read,context,apply(){const {body,path}=f.writes.at(-1);for(const row of price.sizes){const entry=body.data.find(x=>x.sizeID===row.sizeID)||body.data[0];row.price=entry.price;price.discount=entry.discount??price.discount;row.discountedPrice=row.price*(100-price.discount)/100;row.clubDiscountedPrice=Math.floor(row.discountedPrice*(100-price.clubDiscount))/100;}f.task={uploadID:42,status:3,overAllGoodsNumber:body.data.length,successGoodsNumber:body.data.length};f.goods=body.data.map(e=>({nmID:123,vendorCode:product.offerId,sizeID:path.endsWith('/size')?e.sizeID:null,price:e.price,discount:price.discount,clubDiscount:5,currencyIsoCode4217:'CNY',status:2,errorText:null}));},cleanup:()=>rm(dir,{recursive:true,force:true})});
}
