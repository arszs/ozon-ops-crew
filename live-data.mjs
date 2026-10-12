import {sellerRead,catalog} from './ozon.mjs';
import {performanceRead,performanceReport} from './performance.mjs';
export function apiNumber(value){
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value!=='string'||!value.trim()||value.trim()==='-')throw Error('invalid_api_number');
 const n=Number(value.replace(/[\s\u00a0]/g,'').replace(',','.'));if(!Number.isFinite(n))throw Error('invalid_api_number');return n;
}
export function lastCompleteWeek(now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);const start=new Date(end);start.setUTCDate(start.getUTCDate()-6);
 return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10),timezone:'Europe/Moscow'};
}
const round=n=>Math.round(n*100)/100;
export function summarizeAccruals(accruals){
 const totals={},bySku={},daily={},unallocated={},seen=new Set();
 const add=(target,currency,amount)=>target[currency]=round((target[currency]||0)+amount);
 const money=m=>{if(!m||!m.currency)throw Error('finance_missing_currency');return {currency:m.currency,amount:apiNumber(m.amount)};};
 for(const a of accruals){
  if(seen.has(String(a.accrual_id)))continue;seen.add(String(a.accrual_id));
  const total=money(a.total_amount);add(totals,total.currency,total.amount);daily[a.date]??={};add(daily[a.date],total.currency,total.amount);
  const allocated={};
  const part=(sku,m)=>{const v=money(m);bySku[String(sku)]??={};add(bySku[String(sku)],v.currency,v.amount);add(allocated,v.currency,v.amount);};
  for(const p of a.posting?.products||[]){
   if(p.commission){part(p.sku,p.commission.sale_amount);part(p.sku,p.commission.commission);}
   if(p.delivery)part(p.sku,p.delivery.total_accrued);
  }
  for(const p of a.item_fees?.fees||[])for(const f of p.fees||[])part(p.sku,f.accrued);
  // Never spread unattributed store charges across SKUs or add them twice.
  for(const currency of new Set([total.currency,...Object.keys(allocated)]))add(unallocated,currency,(currency===total.currency?total.amount:0)-(allocated[currency]||0));
 }
 return {totals,bySku,daily,unallocated,count:seen.size};
}
export function normalizeAdReports(cpc,cpo){
 const bySku={};let cpcSpend=0,cpoSpend=0;
 const row=(sku)=>bySku[String(sku)]??={cpcSpend:0,cpoSpend:0,cpcOrders:0,cpoOrders:0,cpcRevenue:0,cpoRevenue:0,campaignIds:[]};
 for(const [id,c] of Object.entries(cpc)){
  if(!c.report||!Array.isArray(c.report.rows))throw Error('cpc_report_schema');
  cpcSpend+=apiNumber(c.report.totals.moneySpent);
  for(const r of c.report.rows){const sku=r.sku;if(!sku)continue;const s=row(sku);s.cpcSpend+=apiNumber(r.moneySpent);s.cpcOrders+=apiNumber(r.orders??'0');s.cpcRevenue+=apiNumber(r.ordersMoney??'0');if(!s.campaignIds.includes(id))s.campaignIds.push(id);}
 }
 if(!Array.isArray(cpo.rows))throw Error('cpo_report_schema');
 for(const r of cpo.rows){if(!r.SKU)continue;const s=row(r.SKU);const cost=apiNumber(r.MoneySpent);s.cpoSpend+=cost;cpoSpend+=cost;s.cpoOrders+=apiNumber(r.Orders);s.cpoRevenue+=apiNumber(r.OrdersMoney);s.name=r.Title;s.offerId=r.OfferID;
  // MoneySpentFromCPC is already in the CPC report; do not add it again.
 }
 return {bySku,cpcSpend:round(cpcSpend),cpoSpend:round(cpoSpend),totalSpend:round(cpcSpend+cpoSpend)};
}
export async function synchronizeLive(progress=()=>{}){
 const period=lastCompleteWeek(),warnings=[],sources={};const result={mode:'live',period,startedAt:new Date().toISOString(),sources,warnings};
 const attempt=async(name,fn)=>{try{const value=await fn();sources[name]={ok:true};return value;}catch(e){sources[name]={ok:false,error:e.message};warnings.push({source:name,code:e.message});return null;}};
 progress('Читаю заказы, начисления и кампании Ozon…');
 // Independent source reads; accrual pages themselves remain sequential.
 const [catalogData,analytics,finance,campaignList]=await Promise.all([
  attempt('catalog',()=>catalog()),
  attempt('analytics',async()=>{const d=await sellerRead('/v1/analytics/data',{date_from:period.from,date_to:period.to,metrics:['revenue','ordered_units'],dimension:['sku'],sort:[{key:'revenue',order:'DESC'}],limit:1000,offset:0});if(!Array.isArray(d.result?.data)||!Array.isArray(d.result?.totals))throw Error('analytics_schema');return d.result;}),
  attempt('finance',async()=>{const rows=[];for(let date=period.from;date<=period.to;){let cursor='';const seen=new Set();for(let page=0;page<100;page++){progress('Начисления Ozon: '+date);const d=await sellerRead('/v1/finance/accrual/by-day',{date,last_id:cursor});if(!Array.isArray(d.accruals))throw Error('finance_schema');rows.push(...d.accruals);if(!d.last_id)break;if(page===99||seen.has(d.last_id))throw Error('finance_incomplete_pagination');seen.add(d.last_id);cursor=d.last_id;}const next=new Date(date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);date=next.toISOString().slice(0,10);}return summarizeAccruals(rows);}),
  attempt('campaigns',async()=>{const d=await performanceRead('/api/client/campaign');if(!Array.isArray(d.list))throw Error('campaign_schema');if(Number(d.total??d.list.length)>d.list.length)throw Error('campaigns_incomplete');return d.list;})
 ]);
 const campaigns=(campaignList||[]).map(c=>({id:String(c.id),title:c.title,state:c.state,type:c.advObjectType,payment:c.PaymentType,strategy:c.productAutopilotStrategy,mode:c.productCampaignMode}));
 result.catalogTotal=catalogData?.total??null;result.finance=finance;result.campaigns=campaigns;
 const rows=new Map();const get=sku=>{sku=String(sku);if(!rows.has(sku))rows.set(sku,{sku,name:'SKU '+sku,orderRevenue:null,orderedUnits:null,netAccrued:null,adSpend:null,adOrders:null,adRevenue:null,strategies:[]});return rows.get(sku);};
 let analyticsComplete=false;
 if(analytics){
  let revenue=0,units=0;for(const r of analytics.data){const sku=r.dimensions?.[0]?.id;if(!sku)continue;const rev=apiNumber(r.metrics[0]),u=apiNumber(r.metrics[1]);revenue+=rev;units+=u;if(rev||u)Object.assign(get(sku),{name:r.dimensions[0].name,orderRevenue:rev,orderedUnits:u});}
  result.orders={amount:apiNumber(analytics.totals[0]),units:apiNumber(analytics.totals[1]),currency:'RUB'};
  analyticsComplete=Math.abs(revenue-result.orders.amount)<.01&&units===result.orders.units;
  if(!analyticsComplete)warnings.push({source:'analytics',code:'top_1000_only'});
 }
 for(const [sku,net] of Object.entries(finance?.bySku||{}))get(sku).netAccrued=net;
 progress('Получаю рекламные отчёты и состав кампаний…');
 let adReport=null;
 if(campaignList){
  const cpcIds=campaigns.filter(c=>c.type==='SKU').map(c=>c.id);
  const cpc=await attempt('cpc',async()=>cpcIds.length?performanceReport('/api/client/statistics/json',{campaigns:cpcIds,dateFrom:period.from,dateTo:period.to,groupBy:'NO_GROUP_BY'},progress):{});
  const cpo=await attempt('cpo',()=>performanceReport('/api/client/statistic/products/generate/json',{from:period.from+'T00:00:00+03:00',to:period.to+'T23:59:59+03:00'},progress));
  const expenses=await attempt('adExpenses',()=>performanceRead('/api/client/statistics/expense/json?'+new URLSearchParams({dateFrom:period.from,dateTo:period.to})));
  // This supplementary endpoint covers the separate all-assortment CPO instrument.
  const allCpo=await attempt('allCpo',()=>performanceReport('/api/client/statistics/all_sku_promo/products/generate/json?'+new URLSearchParams({'timeBounds.from':period.from+'T00:00:00+03:00','timeBounds.to':period.to+'T23:59:59+03:00'}),undefined,progress));
  result.allCpoReport=allCpo;
  if(cpc&&cpo){adReport=await attempt('adMetrics',async()=>normalizeAdReports(cpc,cpo));}if(adReport){for(const [sku,ad] of Object.entries(adReport.bySku)){Object.assign(get(sku),{adSpend:round(ad.cpcSpend+ad.cpoSpend),adOrders:ad.cpcOrders+ad.cpoOrders,adRevenue:round(ad.cpcRevenue+ad.cpoRevenue),adBreakdown:ad});if(ad.name)get(sku).name=ad.name;}}
  result.ads=adReport?{cpcSpend:adReport.cpcSpend,cpoSpend:adReport.cpoSpend,selectedProductsSpend:adReport.totalSpend,allAssortmentVerified:false}:null;
  result.expenseReport=expenses;
  const membership=await attempt('membership',async()=>{
   const members=[];for(let page=1;page<=100;page++){const d=await performanceRead('/api/client/campaign/search_promo/v2/products',{page,pageSize:1000});if(!Array.isArray(d.products))throw Error('membership_schema');members.push(...d.products);if(members.length>=Number(d.total))return members;if(!d.products.length)throw Error('membership_incomplete');}throw Error('membership_too_large');
  });
  for(const p of membership||[]){const r=get(p.sku);r.name=p.title||r.name;r.offerId=p.sourceSku;r.strategies.push({instrument:'CPO',campaignId:p.hint?.campaignId,active:p.searchPromoStatus===true,available:p.isSearchPromoAvailable===true,bidPercent:apiNumber(p.bid),status:p.searchPromoStatus?'Включено':'Выключено'});}
  for(const c of campaigns.filter(c=>c.type==='SKU'&&c.state==='CAMPAIGN_STATE_RUNNING')){
   await attempt('membership:'+c.id,async()=>{let count=0;for(let page=1;page<=100;page++){const d=await performanceRead(`/api/client/campaign/${c.id}/v2/products?page=${page}&pageSize=1000`);const items=d.products;if(!Array.isArray(items))throw Error('cpc_membership_schema');for(const p of items)get(p.sku).strategies.push({instrument:'CPC',campaignId:c.id,active:true,strategy:c.strategy});count+=items.length;if(count>=Number(d.total)||items.length<1000)return true;}throw Error('membership_too_large');});
  }
 }
 const skus=[...rows.keys()];progress('Читаю реальные цены и остатки товаров…');
 if(!skus.length)sources.products={ok:false,skipped:true,reason:'no_skus_to_enrich'};
 else await attempt('products',async()=>{for(let i=0;i<skus.length;i+=100){const d=await sellerRead('/v3/product/info/list',{sku:skus.slice(i,i+100)});if(!Array.isArray(d.items))throw Error('products_schema');for(const p of d.items){const aliases=new Set([String(p.sku),...(p.sources||[]).map(s=>String(s.sku))]);for(const sku of aliases){if(!rows.has(sku))continue;const r=get(sku);Object.assign(r,{name:p.name,offerId:p.offer_id,productId:String(p.id),price:apiNumber(p.price),currency:p.currency_code,stock:(p.stocks?.stocks||[]).filter(x=>String(x.sku)===sku).reduce((n,x)=>n+Number(x.present||0),0)});}}}return true;});
 for(const r of rows.values()){
  if(analyticsComplete&&r.orderRevenue===null){r.orderRevenue=0;r.orderedUnits=0;}
  if(finance&&r.netAccrued===null)r.netAccrued={};
  if(adReport&&r.adSpend===null){r.adSpend=0;r.adOrders=0;r.adRevenue=0;}
 }
 result.rows=[...rows.values()].sort((a,b)=>(b.orderRevenue||0)-(a.orderRevenue||0));result.analyticsComplete=analyticsComplete;result.fetchedAt=new Date().toISOString();
 return result;
}
