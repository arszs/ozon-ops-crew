import {readFile} from 'node:fs/promises';
import {sellerRead} from '../ozon.mjs';
const timeout=()=>AbortSignal.timeout(20000);
export async function envFile(file){if(!file)return {};const out={};for(const line of (await readFile(file,'utf8')).split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))out[line.slice(0,i).trim()]=line.slice(i+1).trim();}return out;}
async function json(url,options){const r=await fetch(url,{...options,signal:timeout()});if(!r.ok)throw Error('marketplace_http_'+r.status);return r.json();}
export async function storeCredentials(store){return {...process.env,...await envFile(store.envFile)};}
export async function readStore(store){
 if(store.mode==='mock')return store.snapshot?structuredClone(store.snapshot):{mode:'mock',products:[{sku:'DEMO-STORAGE-01',name:'Складной короб, 30 л',price:1290,stock:48}],orders:12,orderedAmount:15480,profit:null,currency:'RUB',source:'固定演示数据，不是真实销售'};
 if(store.marketplace==='ozon'){
  if(store.id==='ozon-live'){const d=await sellerRead('/v3/product/list',{filter:{visibility:'ALL'},limit:20,last_id:''});return {mode:'live',catalogTotal:d.result.total,products:d.result.items.map(p=>({sku:String(p.product_id),offerId:p.offer_id})),source:'Ozon Seller API · 前20个商品'};}
  const c=await storeCredentials(store);if(!c.OZON_CLIENT_ID||!c.OZON_API_KEY)throw Error('未配置 Ozon API');const d=await json('https://api-seller.ozon.ru/v3/product/list',{method:'POST',headers:{'Client-Id':c.OZON_CLIENT_ID,'Api-Key':c.OZON_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({filter:{visibility:'ALL'},limit:20,last_id:''})});return {mode:'live',catalogTotal:d.result.total,products:d.result.items.map(p=>({sku:String(p.product_id),offerId:p.offer_id})),source:'Ozon Seller API · 前20个商品'};
 }
 const c=await storeCredentials(store);if(!c.WB_API_TOKEN)throw Error('未配置 WB_API_TOKEN');const d=await json('https://content-api.wildberries.ru/content/v2/get/cards/list',{method:'POST',headers:{Authorization:c.WB_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({settings:{cursor:{limit:100},filter:{withPhoto:-1}}})});if(d.error)throw Error('wb_content_error');return {mode:'live',products:(d.cards||[]).map(p=>({sku:String(p.nmID),offerId:p.vendorCode,name:p.title})),cursor:d.cursor,source:'WB Content API · 前100个商品，非完整库存'};
}
export async function dictionaries(store,search=''){
 if(store.mode==='mock')return {mode:'mock',verified:false,source:'演示规则快照，不是当前平台规则',items:[{id:'mock-storage',name:'Короба для хранения',required:['Материал','Цвет','Объём'],titleLimit:store.marketplace==='wb'?60:200}]};
 if(store.marketplace==='ozon'){
  const c=await storeCredentials(store);const headers={'Client-Id':c.OZON_CLIENT_ID,'Api-Key':c.OZON_API_KEY,'Content-Type':'application/json'};
  if(store.id==='ozon-live'){const {credentials}=await import('../ozon.mjs');const v=await credentials();headers['Client-Id']=v.client;headers['Api-Key']=v.key;}
  const data=await json('https://api-seller.ozon.ru/v1/description-category/tree',{method:'POST',headers,body:JSON.stringify({language:'DEFAULT'})});const items=[];function walk(nodes,parent=null){for(const n of nodes||[]){if(n.type_id&&(!search||n.type_name?.toLowerCase().includes(search.toLowerCase())))items.push({id:String(n.type_id),categoryId:parent,name:n.type_name});walk(n.children,n.description_category_id||parent);}}walk(data.result);return {mode:'live',verified:true,source:'Ozon description-category/tree',items:items.slice(0,100),truncated:items.length>100};
 }
 const c=await storeCredentials(store);if(!c.WB_API_TOKEN)throw Error('未配置 WB_API_TOKEN');const d=await json('https://content-api.wildberries.ru/content/v2/object/all?'+new URLSearchParams({limit:100,offset:0,name:search}),{headers:{Authorization:c.WB_API_TOKEN}});if(d.error)throw Error('wb_dictionary_error');return {mode:'live',verified:true,source:'WB object/all',items:d.data||[]};
}
export async function executeMarketplace(store,operation){
 if(store.mode==='mock')return {mode:'mock',externalWrite:false,receipt:'SIM-'+operation.id,platform:store.marketplace,status:'simulated',payloadHash:operation.payloadHash};
 // MVP deliberately fails closed: ownership, stock warehouses, permissions, current rules,
 // upload/moderation polling and ambiguous-write reconciliation must be verified per account.
 throw Error('真实店铺写入未启用；审批不会绕过此限制 / Live writes disabled');
}
export async function readMessages(store){
 if(store.mode==='mock')return {items:[],mode:'mock',partial:false};
 const c=await storeCredentials(store);let headers,requests;
 if(store.marketplace==='wb'){
  if(!c.WB_API_TOKEN)throw Error('未配置 WB_API_TOKEN');headers={Authorization:c.WB_API_TOKEN};requests=[['review','https://feedbacks-api.wildberries.ru/api/v1/feedbacks?isAnswered=false&take=100&skip=0'],['question','https://feedbacks-api.wildberries.ru/api/v1/questions?isAnswered=false&take=100&skip=0']].map(([kind,url])=>({kind,url,options:{headers}}));
 }else{
  if(store.id==='ozon-live'){const {credentials}=await import('../ozon.mjs');const v=await credentials();c.OZON_CLIENT_ID=v.client;c.OZON_API_KEY=v.key;}
  headers={'Client-Id':c.OZON_CLIENT_ID,'Api-Key':c.OZON_API_KEY,'Content-Type':'application/json'};
  requests=[{kind:'review',url:'https://api-seller.ozon.ru/v1/review/list',options:{method:'POST',headers,body:JSON.stringify({limit:100,status:'UNPROCESSED',sort_dir:'DESC'})}},{kind:'question',url:'https://api-seller.ozon.ru/v1/question/list',options:{method:'POST',headers,body:JSON.stringify({limit:100,last_id:'',sort_dir:'DESC',filter:{}})}}];
 }
 const items=[],errors=[];for(const q of requests){try{const d=await json(q.url,q.options);if(d.error)throw Error('marketplace_response_error');const list=d.reviews||d.questions||d.data?.feedbacks||d.data?.questions;if(!Array.isArray(list))throw Error('message_schema');for(const r of list)items.push({externalId:String(r.id),kind:q.kind,textRu:String(r.text||r.texts?.text||''),rating:r.rating??r.productValuation??null});}catch(e){errors.push({kind:q.kind,error:e.message});}}
 return {mode:'live',items,errors,partial:true,notice:'最多100条/类型；更多数据需要分页。权限与订阅可能限制访问。'};
}
