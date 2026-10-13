import {Repository,hash} from '../core/repository.mjs';
import {join} from 'node:path';
import {ApiCooldown} from '../core/api-cooldown.mjs';
import {storeCredentials} from './marketplaces.mjs';
export function wbRegion(store){const region=store.wbRegion||'ru';if(!['ru','cn'].includes(region))throw Error('WB 连接地区必须为 ru 或 cn');return region;}
const owner=(store,c)=>{if(store.mode!=='live'||store.marketplace!=='wb'||typeof c.WB_API_TOKEN!=='string'||!c.WB_API_TOKEN.trim())throw Error('未配置此店铺的 WB API token');return hash({region:wbRegion(store),token:c.WB_API_TOKEN});};
export async function wbAccount(store,{getCredentials=storeCredentials}={}){return owner(store,await getCredentials(store));}
export function wbPriceInterval(store){const type=store.wbPriceTokenType||'base';if(!['personal','service','base-with-secret','base'].includes(type))throw Error('WB 价格 token 类型无效');return type==='base'?900050:650;}
// Reads and narrow price/stock writes share account/category limits, including aliases.
export function createWbRead({fetcher=fetch,getCredentials=storeCredentials,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),priceRateFile,inventoryRateFile,contentRateFile}={}){
 const queues=new Map(),last=new Map(),cooldown=new ApiCooldown({now:clock}),rates=priceRateFile?new Repository(priceRateFile):null,inventoryRates=inventoryRateFile?new Repository(inventoryRateFile):null,contentRates=contentRateFile?new Repository(contentRateFile):null;
 async function request(store,path,body,{accountRef,beforeSend}={},write=false,stockWrite=false){
  const mutating=write||stockWrite;let started=false;try{
  const method=stockWrite?'PUT':body===undefined?'GET':'POST',base=path.split('?')[0],prices=write||method==='GET'&&(/^\/api\/v2\/list\/goods\/filter\?limit=1&offset=0&filterNmID=[1-9]\d*$/.test(path)||/^\/api\/v2\/history\/tasks\?uploadID=[1-9]\d*$/.test(path)||/^\/api\/v2\/history\/goods\/task\?uploadID=[1-9]\d*&limit=1000&offset=0$/.test(path)),warehouses=method==='GET'&&path==='/api/v3/warehouses',stocks=(stockWrite||method==='POST')&&/^\/api\/v3\/stocks\/[1-9]\d*$/.test(path);
  if(write&&(!['/api/v2/upload/task','/api/v2/upload/task/size'].includes(path)||!body||Object.keys(body).join()!=='data'||!Array.isArray(body.data)||!body.data.length||body.data.length>1000||body.data.some(x=>!Number.isSafeInteger(x.nmID)||x.nmID<=0||!Number.isSafeInteger(x.price)||x.price<=0||Object.keys(x).some(k=>!['nmID','price',...(path.endsWith('/size')?['sizeID']:['discount'])].includes(k))|| (path.endsWith('/size')? !Number.isSafeInteger(x.sizeID)||x.sizeID<=0: !Number.isInteger(x.discount)||x.discount<0||x.discount>99))))throw Error('WB 价格写入格式无效');
  if(stockWrite&&(!stocks||!body||Object.keys(body).join()!=='stocks'||!Array.isArray(body.stocks)||!body.stocks.length||body.stocks.length>1000||body.stocks.some(x=>!x||Object.keys(x).sort().join()!=='amount,chrtId'||!Number.isSafeInteger(x.chrtId)||x.chrtId<=0||!Number.isInteger(x.amount)||x.amount<0||x.amount>100000)||new Set(body.stocks.map(x=>x.chrtId)).size!==body.stocks.length))throw Error('WB 库存写入格式无效');
  if(stocks&&!stockWrite&&(!body||Object.keys(body).join()!=='chrtIds'||!Array.isArray(body.chrtIds)||!body.chrtIds.length||body.chrtIds.length>1000||body.chrtIds.some(n=>!Number.isSafeInteger(n)||n<=0)||new Set(body.chrtIds).size!==body.chrtIds.length))throw Error('WB 库存只读请求无效');
  if(!(prices||warehouses||stocks||method==='POST'&&['/content/v2/get/cards/list','/content/v2/get/cards/trash','/content/v2/cards/error/list'].includes(base)||method==='GET'&&(base==='/content/v2/cards/limits'||/^\/content\/v2\/directory\/(colors|kinds|countries|seasons|vat|tnved)$/.test(base)||base==='/content/v2/object/all'||/^\/content\/v2\/object\/charcs\/[1-9]\d*$/.test(base))))throw Error('WB 仅允许已实现的只读方法');
  const c=await getCredentials(store),ref=owner(store,c);if(accountRef&&ref!==accountRef)throw Error('WB 账户已变化，请重新同步');
  const diagnostics=['/content/v2/cards/error/list','/content/v2/cards/limits'].includes(base);
  const inventory=warehouses||stocks,category=prices?'Prices':inventory?'Marketplace':'Content',key=ref+(prices?':prices':warehouses?':warehouses':stocks?':stocks':diagnostics?':diagnostics':':content'),interval=prices?wbPriceInterval(store):inventory?210:diagnostics?(['personal','service','base-with-secret'].includes(store.wbContentTokenType)?6100:1800050):650;
  const rateRepo=prices?rates:inventory?inventoryRates:diagnostics?contentRates:null,rateField=prices?'priceDeadlines':diagnostics?'contentDeadlines':'inventoryDeadlines',rateKey=prices?ref:key;
  const task=(queues.get(key)||Promise.resolve()).then(async()=>{
   try{
   cooldown.check(key,'WB 请求限流，请稍后继续');const persisted=rateRepo?(await rateRepo.read())[rateField]?.[rateKey]||0:0;const wait=Math.max(persisted-clock(),interval-(clock()-(last.get(key)??-Infinity)));if(wait>1000){const e=Error('WB 读取间隔未到，请稍后刷新');e.retryAt=clock()+wait;throw e;}if(wait>0)await sleep(wait);
   if(owner(store,await getCredentials(store))!==ref)throw Error('WB 账户已变化，请重新同步');cooldown.check(key,'WB 请求限流，请稍后继续');last.set(key,clock());
   if(mutating&&beforeSend)await beforeSend();
   if(rateRepo)await rateRepo.mutate(db=>{db[rateField]??={};db[rateField][rateKey]=clock()+interval;});
   let response;started=true;try{response=await fetcher('https://'+(prices?'discounts-prices-api':inventory?'marketplace-api':'content-api')+'.wildberries.'+wbRegion(store)+path,{method,headers:{Authorization:c.WB_API_TOKEN,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw Error(mutating?'WB 操作响应丢失；请读取核对，禁止重发':'WB 网络读取失败；已保存进度可继续');}
   if(inventory&&response.status>=400&&response.status<500){last.set(key,clock()+9*interval);if(rateRepo)await rateRepo.mutate(db=>{db[rateField]??={};db[rateField][rateKey]=clock()+10*interval;});}
   if(response.status===429){const retry=response.headers?.get('X-Ratelimit-Retry');cooldown.reject(key,{headers:{get:()=>response.headers?.get('Retry-After')||retry}},'WB 请求限流，请稍后继续');}
   if(prices&&[401,403].includes(response.status))throw Error('WB 价格权限不足，请检查此店铺的「价格与折扣」API 权限（HTTP '+response.status+'）');
   if(!response.ok){const e=Error(inventory&&[401,403].includes(response.status)?'WB 未授权读取库存，请检查此店铺的 Marketplace API 权限（HTTP '+response.status+'）':'WB '+category+' HTTP '+response.status);e.status=response.status;if(inventory&&response.status>=400&&response.status<500)e.retryAt=clock()+10*interval;throw e;}
   if(stockWrite){if(response.status!==204)throw Error('WB 库存响应状态不明；请读取核对，禁止重发');if(owner(store,await getCredentials(store))!==ref)throw Error('WB 账户已变化，请重新同步');return {status:204};}
   let data;try{data=await response.json();}catch{throw Error('WB 返回格式无效');}
   if(data?.error)throw Error('WB '+category+' 返回错误');if(owner(store,await getCredentials(store))!==ref)throw Error('WB 账户已变化，请重新同步');return data;
   }catch(e){if(rateRepo&&Number.isFinite(e.retryAt))await rateRepo.mutate(db=>{db[rateField]??={};db[rateField][rateKey]=Math.max(db[rateField][rateKey]||0,e.retryAt);});if(mutating&&!started)e.noWrite=true;throw e;}
  });const settled=task.catch(()=>{});queues.set(key,settled);settled.finally(()=>{if(queues.get(key)===settled)queues.delete(key);});return await task;
  }catch(e){if(mutating&&!started)e.noWrite=true;throw e;}
 }
 const read=(store,path,body,options)=>request(store,path,body,options,false);
 read.writePrice=(store,path,body,options)=>request(store,path,body,options,true);
 read.writeStock=(store,path,body,options)=>request(store,path,body,options,false,true);
 return read;
}
export const wbRead=createWbRead({priceRateFile:join(process.cwd(),'runtime','wb-price-api-limits.json'),inventoryRateFile:join(process.cwd(),'runtime','wb-inventory-api-limits.json'),contentRateFile:join(process.cwd(),'runtime','wb-content-api-limits.json')});
export const wbWritePrice=wbRead.writePrice;

export const wbWriteStock=wbRead.writeStock;
