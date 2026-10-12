import {hash} from '../core/repository.mjs';
import {ApiCooldown} from '../core/api-cooldown.mjs';
import {storeCredentials} from './marketplaces.mjs';
export function wbRegion(store){const region=store.wbRegion||'ru';if(!['ru','cn'].includes(region))throw Error('WB 连接地区必须为 ru 或 cn');return region;}
const owner=(store,c)=>{if(store.mode!=='live'||store.marketplace!=='wb'||typeof c.WB_API_TOKEN!=='string'||!c.WB_API_TOKEN.trim())throw Error('未配置此店铺的 WB Content API token');return hash({region:wbRegion(store),token:c.WB_API_TOKEN});};
export async function wbAccount(store,{getCredentials=storeCredentials}={}){return owner(store,await getCredentials(store));}
export function wbPriceInterval(store){const type=store.wbPriceTokenType||'base';if(!['personal','service','base-with-secret','base'].includes(type))throw Error('WB 价格 token 类型无效');return type==='base'?900050:650;}
// Read-only methods share a queue per token + region + API category, including store aliases.
export function createWbRead({fetcher=fetch,getCredentials=storeCredentials,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const queues=new Map(),last=new Map(),cooldown=new ApiCooldown({now:clock});
 return async function read(store,path,body,{accountRef}={}){
  const method=body===undefined?'GET':'POST',base=path.split('?')[0],prices=method==='GET'&&/^\/api\/v2\/list\/goods\/filter\?limit=1&offset=0&filterNmID=[1-9]\d*$/.test(path);
  if(!(prices||method==='POST'&&base==='/content/v2/get/cards/list'||method==='GET'&&(base==='/content/v2/object/all'||/^\/content\/v2\/object\/charcs\/[1-9]\d*$/.test(base))))throw Error('WB 仅允许已实现的只读方法');
  const c=await getCredentials(store),ref=owner(store,c);if(accountRef&&ref!==accountRef)throw Error('WB 账户已变化，请重新同步');
  const key=ref+(prices?':prices':':content'),interval=prices?wbPriceInterval(store):650;
  const task=(queues.get(key)||Promise.resolve()).then(async()=>{
   cooldown.check(key,'WB 请求限流，请稍后继续');const wait=interval-(clock()-(last.get(key)??-Infinity));if(wait>1000){const e=Error('WB 价格读取间隔未到，请稍后刷新');e.retryAt=clock()+wait;throw e;}if(wait>0)await sleep(wait);
   if(owner(store,await getCredentials(store))!==ref)throw Error('WB 账户已变化，请重新同步');cooldown.check(key,'WB 请求限流，请稍后继续');last.set(key,clock());
   let response;try{response=await fetcher('https://'+(prices?'discounts-prices-api':'content-api')+'.wildberries.'+wbRegion(store)+path,{method,headers:{Authorization:c.WB_API_TOKEN,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw Error('WB 网络读取失败；已保存进度可继续');}
   if(response.status===429){const retry=response.headers?.get('X-Ratelimit-Retry');cooldown.reject(key,{headers:{get:()=>response.headers?.get('Retry-After')||retry}},'WB 请求限流，请稍后继续');}
   if(prices&&[401,403].includes(response.status))throw Error('WB 未授权读取价格，请检查此店铺的「价格与折扣」API 权限（HTTP '+response.status+'）');
   if(!response.ok)throw Error('WB '+(prices?'Prices':'Content')+' HTTP '+response.status);
   let data;try{data=await response.json();}catch{throw Error('WB 返回格式无效');}
   if(data?.error)throw Error('WB '+(prices?'Prices':'Content')+' 返回错误');if(owner(store,await getCredentials(store))!==ref)throw Error('WB 账户已变化，请重新同步');return data;
  });const settled=task.catch(()=>{});queues.set(key,settled);settled.finally(()=>{if(queues.get(key)===settled)queues.delete(key);});return task;
 };
}
export const wbRead=createWbRead();
