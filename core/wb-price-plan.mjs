import {hash} from './repository.mjs';
const cents=(v,label)=>{const s=String(v??'');if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error(label+'需要非负金额，最多两位小数');const [a,b='']=s.split('.'),n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));if(n>100_000_000_000n)throw Error(label+'过大');return n;};
const text=n=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
const ceil=(n,d)=>(n+d-1n)/d;
function integer(v,label,max){if(!/^\d+$/.test(String(v))||!Number.isSafeInteger(Number(v))||Number(v)>max)throw Error(label+'需要有效整数');return Number(v);}
export function buildWbPricePlan(context,input){
 const before=context.price;if(!before.sizes?.length||before.sizes.length>1000)throw Error('一次调价支持 1–1000 个尺码');if(input.currency!==before.currency)throw Error('请使用 API 返回的商品币种，不进行汇率换算');
 if(input.costsConfirmed!==true||input.promotionReviewed!==true)throw Error('请核对全部成本及平台促销；成本保护不是利润保证');
 if(!['uniform','size'].includes(input.mode)||input.mode==='size'&&!before.editableSizePrice)throw Error('此商品不支持所选调价方式');
 const fee=cents(input.feePct,'比例费用 %'),margin=cents(input.minMarginPct,'最低情景利润率 %');if(fee+margin>=10000n)throw Error('比例费用与最低利润率之和须小于 100%');
 const discount=input.mode==='size'?before.discount:integer(input.discount,'卖家折扣',99);if(discount>=100||before.clubDiscount>=100)throw Error('100% 折扣不能满足价格保护');
 if(!Array.isArray(input.sizes)||input.sizes.length!==before.sizes.length||new Set(input.sizes.map(s=>String(s.chrtId))).size!==input.sizes.length)throw Error('请为所有尺码填写成本与目标');
 const uniform=input.mode==='uniform'?integer(input.price,'统一原价',1_000_000_000):null,rows=[];
 for(const size of before.sizes){
  const value=input.sizes.find(s=>String(s.chrtId)===size.chrtId);if(!value)throw Error('尺码已经变化，请重新读取');
  const price=input.mode==='uniform'?uniform:integer(value.price,'尺码原价',1_000_000_000);if(price<1)throw Error('原价必须大于零');
  const cost=cents(value.fixedCost,'单件固定成本'),factor=BigInt(100-discount)*BigInt(100-before.clubDiscount),effective=BigInt(price)*100n*factor/10000n;
  const profit=effective*(10000n-fee)-cost*10000n,required=ceil(cost*10000n,10000n-fee-margin),minimum=Number(ceil(required*10000n,100n*factor));
  if(!effective||profit<effective*margin)throw Error('尺码 '+size.techSize+' 的会员折后情景低于成本保护；原价至少 '+Math.max(1,minimum)+' '+before.currency);
  rows.push({chrtId:size.chrtId,techSize:size.techSize,before:size,price,fixedCost:text(cost),sellerPrice:text(BigInt(price)*BigInt(100-discount)),clubScenarioPrice:text(effective),contribution:text(profit/10000n),marginPct:Number(profit*10000n/(effective*10000n))/100,minimumPrice:Math.max(1,minimum)});
 }
 if(discount===before.discount&&rows.every(r=>r.price===r.before.price))throw Error('目标与当前价格相同，无需发送');
 return {mode:input.mode,currency:before.currency,discount,clubDiscount:before.clubDiscount,feePct:text(fee),minMarginPct:text(margin),rows,contextHash:hash(context),endpoint:input.mode==='size'?'/api/v2/upload/task/size':'/api/v2/upload/task',apiBody:{data:input.mode==='size'?rows.map(r=>({nmID:Number(before.nmID),sizeID:Number(r.chrtId),price:r.price})):[{nmID:Number(before.nmID),price:uniform,discount}]},costsConfirmed:true,promotionReviewed:true};
}
