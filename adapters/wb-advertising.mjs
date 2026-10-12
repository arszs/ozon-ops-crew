import {storeCredentials} from './marketplaces.mjs';
import {wbAccount,wbRegion} from './wb-api.mjs';
import {ApiCooldown} from '../core/api-cooldown.mjs';
import {wbInteger,wbDecimal,decimalText,addDecimal} from './wb-finance.mjs';
const count=v=>{if(!Number.isSafeInteger(v)||v<0)throw Error('WB 广告数量无效');return v;};
const money=v=>{const s=typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12?String(v):v,n=wbDecimal(s);if(n<0n)throw Error('WB 广告金额为负');return decimalText(n);};
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function wbAdRange(input={},now=Date.now()){
 const today=new Date(now+10800000).toISOString().slice(0,10),to=input.to||new Date(Date.parse(today)-86400000).toISOString().slice(0,10);if(!iso(to))throw Error('广告结束日期无效');
 const from=input.from||new Date(Date.parse(to)-6*86400000).toISOString().slice(0,10),days=(Date.parse(to)-Date.parse(from))/86400000+1;
 if(!iso(from)||from<'2000-01-01'||to>=today||days<1||days>31)throw Error('请选择 1–31 个完整自然日读取广告');return {from,to,days};
}
export function wbAdInterval(store,phase){const type=store.wbPromotionTokenType||'base';if(!['personal','service','base-with-secret','base'].includes(type))throw Error('WB Promotion token 类型无效');if(!['list','info','stats'].includes(phase))throw Error('WB 广告读取阶段无效');return type==='base'?(phase==='list'?900050:3600050):phase==='stats'?20100:210;}
export function wbAdRequest(phase,ids=[],range){
 if(phase==='list')return {path:'/adv/v1/promotion/count'};
 if(!['info','stats'].includes(phase)||!Array.isArray(ids)||!ids.length||ids.length>50)throw Error('WB 广告只允许读取最多 50 个活动');
 const checked=ids.map(v=>wbInteger(v));if(new Set(checked).size!==checked.length)throw Error('WB 广告活动重复');
 const query=new URLSearchParams({ids:checked.join(',')});if(phase==='stats'){if(!iso(range?.from)||!iso(range?.to)||range.to<range.from||(Date.parse(range.to)-Date.parse(range.from))/86400000>=31)throw Error('WB 广告日期无效');query.set('beginDate',range.from);query.set('endDate',range.to);}
 return {path:(phase==='info'?'/api/advert/v2/adverts':'/adv/v3/fullstats')+'?'+query};
}
export function normalizeWbAdList(raw){
 count(raw?.all);const groups=raw.adverts===null&&raw.all===0?[]:raw.adverts;if(!Array.isArray(groups))throw Error('WB 广告列表缺失');const items=[],seen=new Set();
 for(const group of groups){if(!Number.isSafeInteger(group.type)||!Number.isSafeInteger(group.status)||!Array.isArray(group.advert_list)||count(group.count)!==group.advert_list.length)throw Error('WB 广告分组数量不匹配');
  for(const ad of group.advert_list){const id=wbInteger(ad.advertId);if(seen.has(id)||typeof ad.changeTime!=='string'||!Number.isFinite(Date.parse(ad.changeTime)))throw Error('WB 广告标识重复或时间无效');seen.add(id);items.push({id,type:group.type,status:group.status,changedAt:ad.changeTime,eligible:[7,9,11].includes(group.status)});}}
 if(items.length!==raw.all)throw Error('WB 广告列表不完整');return items;
}
export function normalizeWbAdInfo(raw,ids){
 if(!Array.isArray(raw?.adverts))throw Error('WB 广告详情缺失');const seen=new Set();return raw.adverts.map(ad=>{
  const id=wbInteger(ad.id);if(!ids.includes(id)||seen.has(id))throw Error('WB 广告详情标识不匹配');seen.add(id);
  if(!['manual','unified'].includes(ad.bid_type)||!['cpm','cpc'].includes(ad.settings?.payment_type)||typeof ad.settings.name!=='string'||!Number.isSafeInteger(ad.status)||!Array.isArray(ad.nm_settings)||! /^[A-Z]{3}$/.test(ad.currency)||typeof ad.currency!=='string')throw Error('WB 广告配置无效');
  for(const k of ['search','recommendations'])if(typeof ad.settings.placements?.[k]!=='boolean')throw Error('WB 广告展示位置无效');
  const nms=ad.nm_settings.map(n=>wbInteger(n.nm_id));if(new Set(nms).size!==nms.length)throw Error('WB 广告商品重复');
  return {id,name:ad.settings.name.slice(0,300),currency:ad.currency,status:ad.status,bidType:ad.bid_type,paymentType:ad.settings.payment_type,placements:{search:ad.settings.placements.search,recommendations:ad.settings.placements.recommendations},nms};
 });
}
const metrics=r=>({spend:money(r.sum),orderAmount:money(r.sum_price),views:count(r.views),clicks:count(r.clicks),orders:count(r.orders)});
const diff=(a,b)=>decimalText(wbDecimal(a)-wbDecimal(b));
export function normalizeWbAdStats(raw,ids,range,metadata=new Map()){
 if(!Array.isArray(raw))throw Error('WB 广告统计缺失');const seen=new Set();return raw.map(ad=>{
  const id=wbInteger(ad.advertId);if(!ids.includes(id)||seen.has(id))throw Error('WB 广告统计标识不匹配');seen.add(id);
  if(typeof ad.currency!=='string'||! /^[A-Z]{3}$/.test(ad.currency)||!Array.isArray(ad.days))throw Error('WB 广告币种或日期缺失');
  if(metadata.get(id)&&metadata.get(id).currency!==ad.currency)throw Error('WB 广告详情与统计币种不同');
  const summary=metrics(ad),days=[],products=new Map(),dates=new Set();let dayTotal='0',allocation='0',nestedMismatch=false;
  for(const d of ad.days){const day=typeof d.date==='string'?d.date.slice(0,10):'';
   if(!iso(day)||!Number.isFinite(Date.parse(d.date))||day<range.from||day>range.to||dates.has(day)||!Array.isArray(d.apps))throw Error('WB 广告统计日期不匹配或重复');dates.add(day);
   const dm=metrics(d),apps=new Set();let appTotal='0';
   for(const app of d.apps){const type=count(app.appType);if(apps.has(type)||!Array.isArray(app.nms))throw Error('WB 广告终端分组重复或缺失');apps.add(type);const am=metrics(app);let nmTotal='0';const nms=new Set();
    for(const nm of app.nms){const sku=wbInteger(nm.nmId);if(nms.has(sku))throw Error('WB 广告商品重复计数');nms.add(sku);const m=metrics(nm);nmTotal=addDecimal(nmTotal,m.spend);allocation=addDecimal(allocation,m.spend);
     let p=products.get(sku);if(!p){p={sku,name:typeof nm.name==='string'?nm.name.slice(0,1000):'',spend:'0',orderAmount:'0',views:0,clicks:0,orders:0,days:[]};products.set(sku,p);}p.spend=addDecimal(p.spend,m.spend);p.orderAmount=addDecimal(p.orderAmount,m.orderAmount);for(const k of ['views','clicks','orders'])p[k]=count(p[k]+m[k]);if(!p.days.includes(day))p.days.push(day);
    }
    nestedMismatch ||= diff(am.spend,nmTotal)!=='0';appTotal=addDecimal(appTotal,am.spend);
   }
   nestedMismatch ||=diff(dm.spend,appTotal)!=='0';dayTotal=addDecimal(dayTotal,dm.spend);days.push({date:day,...dm});
  }
  const missingDays=[];for(let d=Date.parse(range.from);d<=Date.parse(range.to);d+=86400000){const day=new Date(d).toISOString().slice(0,10);if(!dates.has(day))missingDays.push(day);}
  return {id,currency:ad.currency,...summary,days,products:[...products.values()],missingDays,unallocated:diff(summary.spend,allocation),dailyDifference:diff(summary.spend,dayTotal),allocationMatched:!nestedMismatch&&diff(summary.spend,allocation)==='0'&&diff(summary.spend,dayTotal)==='0'};
 });
}
export function parseWbAdJSON(text){return JSON.parse(text,(key,value,context)=>{if(typeof value==='number'&&['advertId','id','nmId','nm_id','sum','sum_price'].includes(key)){if(!context?.source)throw Error('WB 广告数值来源不可用');return context.source;}return value;});}
export function createWbAdRead({fetcher=fetch,getCredentials=storeCredentials,clock=()=>Date.now()}={}){
 const pending=new Set(),last=new Map(),cooldown=new ApiCooldown({now:clock});
 return async(store,phase,ids,range,{accountRef,signal}={})=>{
  const request=wbAdRequest(phase,ids,range),owner=await wbAccount(store,{getCredentials}),key=owner+':'+phase,interval=wbAdInterval(store,phase);if(accountRef&&owner!==accountRef)throw Error('WB 广告账户已变化');if(pending.has(key))throw Error('WB 广告正在读取');cooldown.check(key,'WB 广告读取限流');const retryAt=(last.get(key)??-Infinity)+interval;if(retryAt>clock()){const e=Error('WB 广告读取间隔未到');e.retryAt=retryAt;throw e;}
  pending.add(key);try{const credentials=await getCredentials(store);if(await wbAccount(store,{getCredentials:async()=>credentials})!==owner)throw Error('WB 广告账户已变化');last.set(key,clock());let response;
   try{response=await fetcher('https://advert-api.wildberries.'+wbRegion(store)+request.path,{method:'GET',headers:{Authorization:credentials.WB_API_TOKEN},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}catch{throw Error('WB 广告网络读取失败');}
   if(response.status===429)cooldown.reject(key,{headers:{get:()=>response.headers?.get('Retry-After')||response.headers?.get('X-Ratelimit-Retry')}},'WB 广告读取限流');
   if(response.status!==200)throw Error([401,403].includes(response.status)?'WB Promotion 权限不足（HTTP '+response.status+'）':'WB Advertising HTTP '+response.status);
   let data;try{data=parseWbAdJSON(await response.text());}catch{throw Error('WB 广告响应格式无效');}if(await wbAccount(store,{getCredentials})!==owner)throw Error('WB 广告账户已变化');return {...request,data};
  }finally{pending.delete(key);}
 };
}
export const readWbAds=createWbAdRead();
