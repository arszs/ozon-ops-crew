// Synthetic, browser-only arithmetic. No account data, inference or marketplace action.
export function calculateDemoProfit(input){
 const value=(key,{integer=false,max=1_000_000_000}={})=>{const raw=String(input[key]??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(raw))throw Error('请填写完整的非负数字；金额最多两位小数，未知不能填成零。');const n=Number(raw);if(n>max||integer&&!Number.isInteger(n))throw Error('请核对天数、整数订单数和金额范围。');return n;};
 const period=key=>{const days=value(key+'_days',{integer:true,max:90}),orders=value(key+'_orders',{integer:true,max:1_000_000});if(days<7)throw Error('每个期间需要 7–90 个完整自然日。');const revenue=Math.round(value(key+'_revenue')*100),cost=Math.round(value(key+'_cost')*100),ads=Math.round(value(key+'_ads')*100);return {days,orders,revenue:revenue/100,cost:cost/100,ads:ads/100,profitCents:revenue-cost-ads};};
 const a=period('a'),b=period('b'),blockers=[];
 if(input.costsComplete!==true)blockers.push('结算与全部成本尚未核对，暂不能判断。');
 if(input.comparable!==true)blockers.push('图片实际展示、库存、价格、广告和促销等可比条件尚未核对。');
 if(a.orders<30||b.orders<30)blockers.push('任一期间不足 30 单；此门槛不是统计显著性检验。');
 const delta=(b.profitCents*a.days-a.profitCents*b.days)/(a.days*b.days*100);
 return {a,b,before:a.profitCents/a.days/100,after:b.profitCents/b.days/100,delta,blockers,verdict:blockers.length?'insufficient':delta>0?'repeat_candidate':'no_improvement',causal:false,synthetic:true};
}
