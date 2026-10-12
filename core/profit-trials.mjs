// Manual observations are evidence for a repeat test, never proof of causality.
export function evaluateTrial(input){
 const text=(v,max=160)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('请填写 SKU、测试参数和数据来源');return v.trim();};
 const sku=text(input.sku),lever=input.lever;
 if(!['price','ads'].includes(lever))throw Error('请选择价格或广告测试');
 const baseline=text(input.baseline),variant=text(input.variant),evidence=text(input.evidence,1000);
 if(baseline===variant)throw Error('两个方案必须不同');
 const period=p=>{
  if(!p)throw Error('请填写两个期间');
  const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error('日期无效');const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)throw Error('日期无效');return +d;};
  const start=date(p.start),end=date(p.end),days=(end-start)/86400000+1;
  if(days<7||days>90)throw Error('每个期间需要 7–90 个完整自然日');
  const values={};for(const k of ['orders','revenue','cost','ads']){if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<0||p[k]>1e12)throw Error('金额或订单数无效');values[k]=p[k];}
  if(!Number.isInteger(values.orders))throw Error('订单数必须为整数');
  return {start:p.start,end:p.end,days,...values,settled:p.settled===true,profit:values.revenue-values.cost-values.ads};
 };
 const a=period(input.a),b=period(input.b);
 if(a.end>=b.start)throw Error('先填写基准期，再填写不重叠的测试期');
 const blockers=[];
 if(!a.settled||!b.settled)blockers.push('结算或成本未完整，暂不能判断');
 if(a.orders<30||b.orders<30)blockers.push('任一期间不足 30 单；此门槛不是统计显著性检验');
 if(input.comparable!==true)blockers.push('库存、促销、其他参数或季节因素尚未核对');
 const before=a.profit/a.days,after=b.profit/b.days,delta=after-before;
 return {sku,lever,baseline,variant,evidence,source:'manual_observation',comparable:input.comparable===true,a,b,result:{before,after,delta,blockers,verdict:blockers.length?'insufficient':delta>0?'repeat_candidate':'no_improvement',causal:false}};
}
