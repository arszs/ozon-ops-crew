// Dated Ozon public tariff snapshot. The chosen service must still be enabled
// in the seller account; calculating a price does not book a shipment.
export const OGL_SOURCE='https://cdn.ozone.ru/s3/ozon-disk-api/Partner_Delivery/China_scoring_OGL_ENG_CN_24_08_2026_1786692022.xlsx';
export const COMMISSION_SOURCE='https://cdn.ozone.ru/s3/ozon-disk-api/global-education/ru/commissions/ozon-fees/comissions/Tarifs_CN_01_12_2025_1761720496.xlsx';
const groups=[
 ['Extra Small',0.01,135,1,500,2.9,.0247,false],['Budget',0.01,135,501,35000,22.25,.0164,false],
 ['Small',135.01,635,1,2000,15.48,.0242,false],['Big',135.01,635,2001,35000,34.82,.0164,true],
 ['Premium Small',635.01,22525,1,5000,21.28,.0242,false],['Premium Big',635.01,22525,5001,35000,59.97,.0222,true],
];
const positive=(v,name)=>{if(v===null||v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<=0)throw Error('请先填写包装资料：'+name);return Number(v);};
const nonnegative=(v,name)=>{if(v===null||v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<0)throw Error('请填写费用：'+name);return Number(v);};
export async function cnyRate({fetcher=fetch,date=new Date()}={}){
 const day=String(date.getUTCDate()).padStart(2,'0'),month=String(date.getUTCMonth()+1).padStart(2,'0'),year=date.getUTCFullYear();
 const url=`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${day}/${month}/${year}`;
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('无法读取央行汇率，请稍后重试');
 const xml=await response.text();if(xml.length>100000)throw Error('Invalid CBR response');
 const valute=(xml.match(/<Valute\b[\s\S]*?<\/Valute>/g)||[]).find(s=>s.includes('<CharCode>CNY</CharCode>'));
 const value=Number(valute?.match(/<Value>([^<]+)<\/Value>/)?.[1]?.replace(',','.')),nominal=Number(valute?.match(/<Nominal>([^<]+)<\/Nominal>/)?.[1]);
 if(!Number.isFinite(value)||value<=0||!Number.isFinite(nominal)||nominal<=0)throw Error('央行人民币汇率缺失');
 return {rubPerCny:value/nominal,date:xml.match(/Date="([^"]+)"/)?.[1]||null,source:url};
}
export function oglPrice(job,{rubPerCny,rateDate,rateSource,packaging=2,reservePct=2,domesticShipping,taxPct=0}={}){
 if(job.canonical.currency!=='CNY')throw Error('OGL 自动估价当前支持人民币源商品');
 const type=Number(job.mapping?.typeId||job.artifacts.map_attributes?.output.category.id);
 // Exact type row 2639, Full ChinaHK: Motorcycle Tail Light, All brands.
 if(type!==971168876)throw Error('此商品类型尚无自动佣金快照，请在高级费用中填写实际佣金');
 const p=job.publishConfig||{},weight=positive(p.weight,'重量 g'),dimensions=['width','height','depth'].map(k=>positive(p[k],k)/10);
 if(!Number.isInteger(weight)||weight>35000||Math.max(...dimensions)>200)throw Error('包装超出 OGL 费率表限制');
 const net=positive(job.canonical.price,'源价'),fx=positive(rubPerCny,'人民币汇率');
 const evidence=job.pageImport?.evidence.text||'',match=evidence.match(/快递\s*[:：]\s*(\d+(?:\.\d+)?)/);
 const domestic=nonnegative(domesticShipping??(match?Number(match[1]):undefined),'中国境内运费');
 const pack=nonnegative(packaging,'包装'),reserve=nonnegative(reservePct,'费用预留')/100,tax=nonnegative(taxPct,'税费')/100;
 if(String(p.vat)!=='0')throw Error('请先保存明确的税率；OGL 简易估价当前按已指定的零增值税方案计算');
 const bands=[[.01,1500,.12],[1500.01,5000,.17],[5000.01,22525,.17]],candidates=[];
 for(const [group,min,max,minWeight,maxWeight,base,variable,volume] of groups){
  if(weight<minWeight||weight>maxWeight)continue;
  const billable=volume?Math.max(weight,dimensions.reduce((a,b)=>a*b,1)/12):weight,freight=base+variable*billable;
  for(const [bandMin,bandMax,commission] of bands){
   const lo=Math.max(min,bandMin),hi=Math.min(max,bandMax);if(lo>hi||commission+reserve+tax>=1)continue;
   const service=price=>Math.min(200,Math.max(15,price*fx*.02))/fx;
   const after=price=>price*(1-commission-reserve-tax)-service(price)-freight-domestic-pack;
   if(after(hi)<net)continue;
   let a=lo,b=hi;for(let i=0;i<60;i++){const mid=(a+b)/2;if(after(mid)>=net)b=mid;else a=mid;}
   let price=Math.ceil(b*100-1e-8)/100;if(after(price)+1e-9<net)price+=.01;if(price>hi+1e-8)continue;
   candidates.push({price,group,billableWeightG:billable,internationalFreight:freight,domesticShipping:domestic,packaging:pack,commissionPct:commission*100,commission:price*commission,oglService:service(price),reservePct:reserve*100,reserve:price*reserve,taxPct:tax*100,tax:price*tax,netAfterConfiguredCosts:after(price)});
  }
 }
 if(!candidates.length)throw Error('目标净回款无法在 OGL 费率范围内实现');
 const chosen=candidates.sort((a,b)=>a.price-b.price)[0];
 return {...chosen,price:chosen.price.toFixed(2),currency:'CNY',targetNet:net,shipping:{amount:chosen.internationalFreight,currency:'CNY'},
  sources:{logistics:OGL_SOURCE,commission:COMMISSION_SOURCE,service:'https://global-help.ozon.com/zh/commissions/ozon-fees/ogl-rates?region=CHN',fx:rateSource||null},
  tariffDate:'2026-08-24',commissionDate:'2025-12-01',rubPerCny:fx,rateDate:rateDate||null,
  assumptions:[`包装费用 ${pack} CNY、其他费用预留 ${reserve*100}% 为可修改估计值，不是官方收费。`,'销售佣金按该商品类型 realFBS 档估算；OGL 实际结算以店铺账单为准。','中国境内运费来自保存页的展示路线，实际入仓路线可能不同。','不含广告及额外退货损失；未设置库存或预约发货。'],
  scope:'OGL tariff-based estimate with explicit reserves, not guaranteed settlement.',
  input:{rubPerCny,rateDate,rateSource,packaging:pack,reservePct:reserve*100,domesticShipping:domestic,taxPct:tax*100}};
}
