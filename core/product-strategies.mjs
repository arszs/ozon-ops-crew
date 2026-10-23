// Strategy decisions use observed data and bounded seller policies, never invented demand.
export const STRATEGIES=[
 {id:'profit',icon:'↗',name:{ru:'Максимум прибыли',en:'Maximize profit',zh:'利润优先'},description:{ru:'Выбирать подтверждённо более прибыльные варианты цены и рекламы.',en:'Prefer price and ad options with verified higher contribution profit.',zh:'优先选择已验证贡献利润更高的价格和广告方案。'},metric:'contribution_profit'},
 {id:'sales',icon:'◷',name:{ru:'Рост продаж',en:'Grow sales',zh:'销量增长'},description:{ru:'Увеличивать продажи в пределах минимальной маржи и бюджета.',en:'Grow sales within the minimum margin and budget.',zh:'在最低利润率和预算内增加销量。'},metric:'settled_units'},
 {id:'balanced',icon:'◎',name:{ru:'Сбалансированный рост',en:'Balanced growth',zh:'稳健增长'},description:{ru:'Развивать продажи, сохраняя прибыль и контролируя расходы.',en:'Grow sales while protecting profit and controlling spend.',zh:'兼顾销量、利润与费用控制。'},metric:'contribution_profit'},
 {id:'launch',icon:'✦',name:{ru:'Запуск товара',en:'Launch a product',zh:'新品启动'},description:{ru:'Провести ограниченный тест спроса и собрать первые данные.',en:'Run a bounded demand test and collect initial evidence.',zh:'以有限预算测试需求并收集首批数据。'},metric:'evidence'},
 {id:'clearance',icon:'↓',name:{ru:'Освободить склад',en:'Clear inventory',zh:'库存周转'},description:{ru:'Ускорить оборот без снижения цены ниже заданной границы.',en:'Improve turnover without crossing the configured price floor.',zh:'在价格底线内加快库存周转。'},metric:'stock_turnover'},
 {id:'protect',icon:'◇',name:{ru:'Сохранить запас',en:'Protect stock',zh:'保护库存'},description:{ru:'Сократить продвижение при малом остатке и защитить маржу.',en:'Reduce promotion when stock is low and protect margin.',zh:'库存不足时减少推广并保护利润。'},metric:'stock_cover'}
];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const roundMoney=v=>Math.round((v+Number.EPSILON)*100)/100;
export function strategyPolicy(input){
 if(!input||typeof input.storeId!=='string'||!input.storeId.trim()||typeof input.sku!=='string'||!input.sku.trim()||input.sku.length>160)throw Error('strategy_identity_required');
 if(!STRATEGIES.some(s=>s.id===input.strategy))throw Error('strategy_unknown');
 if(!['monitor','auto','paused'].includes(input.mode))throw Error('strategy_mode_invalid');
 if(!['RUB','CNY'].includes(input.currency))throw Error('strategy_currency_invalid');
 const p={storeId:input.storeId,sku:input.sku,strategy:input.strategy,mode:input.mode,currency:input.currency,adCurrency:input.adCurrency||input.currency};if(!['RUB','CNY'].includes(p.adCurrency))throw Error('strategy_currency_invalid');
 const limits={minMarginPct:[0,90,15],minPrice:[0,1e8,0],maxPrice:[0,1e8,0],maxPriceChangePct:[0,20,5],maxDiscountPct:[0,80,0],adDailyBudget:[0,1e7,0],maxDailyLoss:[0,1e7,0],stockReserve:[0,1e7,1],cooldownHours:[1,168,24]};
 for(const [k,[min,max,fallback]] of Object.entries(limits)){const v=input[k]??fallback;if(!finite(v)||v<min||v>max)throw Error('strategy_limit_invalid:'+k);p[k]=v;}
 if(!Number.isInteger(p.stockReserve)||p.maxPrice>0&&p.maxPrice<p.minPrice)throw Error('strategy_price_range_invalid');
 p.allowPrice=input.allowPrice===true;p.allowAds=input.allowAds===true;p.allowPromotions=input.allowPromotions===true;p.allowReviews=input.allowReviews===true;
 p.costs=null;
 if(input.costs!==null&&input.costs!==undefined){
  const c=input.costs;if(typeof c.source!=='string'||!c.source.trim()||c.source.length>1000)throw Error('strategy_cost_source_required');
  p.costs={source:c.source.trim(),currency:input.currency};
  for(const k of ['unitCost','shipping','fees','returns','adReserve','commissionPct','taxPct']){const v=c[k];if(!finite(v)||v<0||v>(k.endsWith('Pct')?99:1e8))throw Error('strategy_cost_invalid:'+k);p.costs[k]=v;}
  if(p.costs.commissionPct+p.costs.taxPct+p.minMarginPct>=100)throw Error('strategy_margin_unreachable');
 }
 return p;
}
export function contributionAt(price,policy){
 if(!finite(price)||price<=0||!policy.costs)return null;const c=policy.costs;
 if(c.currency!==policy.currency)return null;
 const contribution=roundMoney(price*(1-(c.commissionPct+c.taxPct)/100)-c.unitCost-c.shipping-c.fees-c.returns-c.adReserve);
 const share=1-(c.commissionPct+c.taxPct+policy.minMarginPct)/100;
 const floor=share>0?Math.ceil((c.unitCost+c.shipping+c.fees+c.returns+c.adReserve)/share*100)/100:null;
 return {contribution,marginPct:roundMoney(contribution/price*100),minimumPrice:floor,kind:'seller_cost_scenario',currency:policy.currency};
}
export function decideStrategy(policy,observation,{now=new Date(),lastPriceAt=null,trials=[]}={}){
 const p=strategyPolicy(policy),o=observation||{},blockers=[],actions=[],insights=[];
 const hold=code=>{if(!blockers.includes(code))blockers.push(code);};
 if(o.sku!==p.sku||o.storeId!==p.storeId)hold('identity_mismatch');
 if(o.currency!==p.currency)hold('currency_mismatch');
 if(!finite(o.price)||o.price<=0)hold('price_unavailable');
 const age=+now-Date.parse(o.checkedAt);if(!Number.isFinite(age)||age< -60000||age>15*60000)hold('snapshot_stale');
 if(!o.accountRef)hold('account_unverified');
 const economics=contributionAt(o.price,p),limits=Object.fromEntries(['minMarginPct','minPrice','maxPrice','adDailyBudget','maxDailyLoss'].map(k=>[k,p[k]]));
 const add=(kind,target,reason,extra={})=>actions.push({kind,target,reason,...extra});
 if(!blockers.length){
  if(!p.costs)insights.push('costs_missing');
  if(o.stock===null||!finite(o.stock))insights.push('stock_unknown');
  if(economics&&economics.marginPct<p.minMarginPct)insights.push('margin_below_floor');
  const cooldown=lastPriceAt&&+now-Date.parse(lastPriceAt)<p.cooldownHours*3600000;
  if(p.allowPrice&&economics&&!cooldown){
   let target=o.price,reason='hold_price';const floor=Math.max(p.minPrice,economics.minimumPrice||Infinity);
   // Evidence-based exploitation only: no claim that a price increase by itself raises profit.
   const comparable=trials.filter(t=>t.storeId===p.storeId&&t.sku===p.sku&&t.currency===p.currency&&t.verified===true&&t.settledOrders>=20&&finite(t.profitPerDay)&&finite(t.price)&&t.price>0&&t.completedAt&&+now-Date.parse(t.completedAt)>=0&&+now-Date.parse(t.completedAt)<30*86400000);
   const baseline=comparable.find(t=>t.price===o.price),best=[...comparable].sort((a,b)=>b.profitPerDay-a.profitPerDay)[0];
   if(['profit','balanced'].includes(p.strategy)&&baseline&&best&&best.profitPerDay>baseline.profitPerDay&&best.price!==o.price){target=best.price;reason='verified_profit_trial';}
   else if(o.price<floor){target=floor;reason='protect_margin';}
   else if(['sales','clearance','launch'].includes(p.strategy)&&o.canTestDemand===true&&finite(o.stock)&&o.stock>p.stockReserve&&p.maxDiscountPct>0){target=Math.ceil(o.price*(1-Math.min(p.maxPriceChangePct,p.maxDiscountPct)/100)*100)/100;reason='bounded_price_test';}
   if(target!==o.price){
    if(!p.maxPrice)insights.push('price_ceiling_required');
    else if(target<floor||target>p.maxPrice||Math.abs(target/o.price-1)*100>p.maxPriceChangePct+1e-8)insights.push('price_outside_policy');
    else if(o.autoPromotions!==false||finite(o.marketingPrice)&&o.marketingPrice>0&&o.marketingPrice!==o.price)insights.push('promotion_price_conflict');
    else add('price',target,reason,{before:o.price,expected:contributionAt(target,p)});
   }
  }
  if(p.allowAds){
   if(o.ads?.enabled===true&&finite(o.stock)&&o.stock<=p.stockReserve)add('ads_pause',false,'low_stock');
   else if(o.ads?.currency!==p.adCurrency||o.ads?.complete!==true||!finite(o.ads?.spentToday)||o.ads.spentToday<0)insights.push('ads_spend_unknown');
   else if(o.ads.enabled===true){
    if(o.ads.spentToday>=p.adDailyBudget)add('ads_pause',false,'daily_budget_reached');
    else if(p.maxDailyLoss>0&&finite(o.ads.confirmedLossToday)&&o.ads.confirmedLossToday>=p.maxDailyLoss)add('ads_pause',false,'loss_limit_reached');
   }
   // Starting paid traffic requires an actual platform cap, not a polling-only promise.
   if(o.ads?.enabled===false&&o.ads.currency===p.adCurrency&&o.ads.complete===true&&finite(o.ads.spentToday)&&o.ads.spentToday>=0&&o.ads.spentToday<p.adDailyBudget&&p.adDailyBudget>0&&economics?.marginPct>=p.minMarginPct&&finite(o.stock)&&o.stock>p.stockReserve&&o.ads.platformCapVerified===true&&o.ads.platformDailyCap<=p.adDailyBudget&&['sales','balanced','launch'].includes(p.strategy))add('ads_resume',true,'bounded_growth_test');
  }
  if(p.allowPromotions&&economics&&!actions.some(a=>a.kind==='price')){
   if(!Array.isArray(o.promotions))insights.push('promotions_unavailable');
   else if(!finite(o.stock)||o.stock<=p.stockReserve)insights.push('promotion_stock_insufficient');
   else for(const offer of o.promotions){const e=contributionAt(offer.price,p),discount=(1-offer.price/o.price)*100;
    if(offer.eligible!==true||offer.joined===true||offer.currency!==p.currency||!finite(offer.price)||offer.price<=0||offer.price>=o.price||discount>p.maxDiscountPct+1e-8||offer.price<p.minPrice||!e||e.marginPct+1e-8<p.minMarginPct)continue;
    add('promotion_join',{id:offer.id,price:offer.price,stock:Math.max(0,Math.floor(o.stock-p.stockReserve))},'promotion_within_margin',{expected:e});break;
   }
  }
 }
 return {strategy:p.strategy,mode:p.mode,checkedAt:now.toISOString(),currency:p.currency,economics,limits,blockers,insights,actions:actions.map(a=>({...a,execution:p.mode==='auto'?'eligible':'recommendation'})),actualProfit:finite(o.metrics?.confirmedProfit)&&o.metrics?.profitComplete===true?o.metrics.confirmedProfit:null,profitKind:'confirmed_or_unknown',metrics:o.metrics||null};
}
