import {hash} from './repository.mjs';
const finite=(v,name,{positive=false}={})=>{
 if(v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<0||positive&&Number(v)===0)throw Error('请填写已核实参数 / Missing pricing input: '+name);
 return Number(v);
};
const currency=v=>{if(!/^[A-Z]{3}$/.test(v||''))throw Error('Invalid pricing currency');return v;};
function shipping(config){
 if(!config||!['quote','volumetric'].includes(config.mode))throw Error('Choose shipping quote or volumetric tariff');
 currency(config.currency);
 if(config.mode==='quote')return {amount:finite(config.amount,'shipping.amount'),currency:config.currency};
 const weight=finite(config.weightKg,'shipping.weightKg',{positive:true}),l=finite(config.lengthCm,'shipping.lengthCm',{positive:true}),w=finite(config.widthCm,'shipping.widthCm',{positive:true}),h=finite(config.heightCm,'shipping.heightCm',{positive:true});
 const divisor=finite(config.divisor,'shipping.divisor',{positive:true}),step=finite(config.weightStepKg,'shipping.weightStepKg',{positive:true});
 const billableWeightKg=Math.ceil(Math.max(weight,l*w*h/divisor)/step)*step;
 const amount=Math.max(finite(config.minimum,'shipping.minimum'),finite(config.base,'shipping.base')+billableWeightKg*finite(config.perKg,'shipping.perKg'));
 return {amount,currency:config.currency,billableWeightKg};
}
// Configured economics, not a tax classifier. Rates are explicit effective shares
// of the gross sale; profit taxes/deductible VAT must be converted by the owner.
export function landedPrice(config){
 if(config?.costsConfirmed!==true)throw Error('请核对物流、关税、税费、佣金和退货成本；未知成本不能记零 / Confirm all pricing costs');
 const c=currency(config.currency),target=config.targetNet;
 const convert=(amount,from)=>{
  amount=finite(amount,'amount');currency(from);if(from===c)return amount;
  const rate=finite(config.fx?.[from],`fx.${from} to ${c}`,{positive:true});return amount*rate;
 };
 const targetAmount=convert(finite(target?.amount,'targetNet.amount',{positive:true}),target?.currency);
 const freight=shipping(config.shipping);
 if(!Array.isArray(config.fixedCosts)||!Array.isArray(config.percentageCosts))throw Error('Provide fixedCosts and percentageCosts');
 const costs=[{name:'shipping',amount:convert(freight.amount,freight.currency)},...config.fixedCosts.map(x=>{
  if(typeof x.name!=='string'||!x.name.trim())throw Error('Fixed cost name required');return {name:x.name,amount:convert(x.amount,x.currency)};
 })];
 const rates=config.percentageCosts.map(x=>{
  if(typeof x.name!=='string'||!x.name.trim()||x.basis!=='gross')throw Error('Percentage costs require a name and gross basis');return {name:x.name,rate:finite(x.pct,'percentageCosts.'+x.name)/100};
 });
 const vat=finite(config.salesVatPct,'salesVatPct')/100;rates.push({name:'sales_vat',rate:vat/(1+vat)});
 const rateSum=rates.reduce((s,x)=>s+x.rate,0);if(rateSum>=1)throw Error('Deductions are 100% or more');
 const fixed=costs.reduce((s,x)=>s+x.amount,0),raw=(targetAmount+fixed)/(1-rateSum),step=finite(config.roundUpStep,'roundUpStep',{positive:true});
 if(!Number.isFinite(raw))throw Error('Pricing overflow');
 // Integer minor units avoid downward rounding. CNY/RUB/USD/EUR use cents.
 const cents=Math.round(step*100);if(cents<1||Math.abs(step*100-cents)>1e-8)throw Error('Rounding step must be whole minor currency units');
 let price=Math.ceil((raw*100)/cents)*cents/100;
 if(price*(1-rateSum)-fixed+1e-9<targetAmount)price+=cents/100;
 if(!Number.isFinite(price)||price>1e12)throw Error('Price outside supported range');
 const net=price*(1-rateSum)-fixed;
 return {currency:c,price:price.toFixed(2),targetNet:targetAmount,netAfterConfiguredCosts:net,
  shipping:freight,fixedCosts:costs,deductions:rates.map(x=>({name:x.name,amount:price*x.rate})),
  inputHash:hash(config),input:structuredClone(config),
  scope:'Only supplied confirmed costs. No automatic tax regime, customs classification, commission or freight quote.',
  formula:'price = (target_net + fixed_costs) / (1 - gross_deduction_rates - vat/(1+vat))'};
}
