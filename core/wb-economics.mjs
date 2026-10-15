import {hash} from './repository.mjs';
import {wbDecimal,decimalText} from '../adapters/wb-finance.mjs';
export function wbEconomicsRows(view,products,records,statusFor){
 const allocations=new Map(),costs=new Map(),result=[];
 for(const r of records)if(r.kind==='allocation')allocations.set(r.currency,r);else costs.set(JSON.stringify([r.sku,r.currency]),r);
 for(const [sku,cs] of products)for(const currency of Object.keys(cs)){
  const cost=costs.get(JSON.stringify([sku,currency])),allocation=view.snapshot.attribution.currencies[currency]?.shared.lines?allocations.get(currency):null,status=cost?statusFor(cost,view,allocation):'missing',reviewed=status==='current';
  result.push({sku,currency,status,contribution:reviewed?cost.contribution:null,costRevision:cost?.revision||0,costHash:cost?.hash||null,category:reviewed?(wbDecimal(cost.contribution)<0n?'loss':wbDecimal(cost.contribution)>0n?'positive':'zero'):'pending'});
 }
 return result;
}
const bySku=(a,b)=>a.sku.localeCompare(b.sku,'en',{numeric:true});
export function sortWbEconomics(rows){return rows.sort((a,b)=>{
 const rank={loss:0,pending:1,zero:2,positive:3},d=rank[a.category]-rank[b.category];if(d)return d;
 if(a.contribution!==null&&b.contribution!==null){const x=wbDecimal(a.contribution),y=wbDecimal(b.contribution);if(x!==y)return x<y?-1:1;}return bySku(a,b);
});}
export function wbEconomicsSummary(rows){
 const currencies={};for(const currency of [...new Set(rows.map(r=>r.currency))].sort()){
  const all=sortWbEconomics(rows.filter(r=>r.currency===currency)),known=all.filter(r=>r.category!=='pending'),loss=all.filter(r=>r.category==='loss');
  currencies[currency]={total:all.length,reviewed:known.length,pending:all.length-known.length,loss:loss.length,positive:all.filter(r=>r.category==='positive').length,zero:all.filter(r=>r.category==='zero').length,reviewedContribution:known.length?decimalText(known.reduce((n,r)=>n+wbDecimal(r.contribution),0n)):null,lossContribution:loss.length?decimalText(loss.reduce((n,r)=>n+wbDecimal(r.contribution),0n)):null,rows:all.slice(0,10)};
 }return {currencies,evidenceHash:hash(rows.map(r=>[r.sku,r.currency,r.status,r.costHash,r.contribution]))};
}
export function queryWbEconomics(rows,metadata,{currency,q='',filter='all',offset=0}={}){
 if(typeof currency!=='string'||!rows.some(r=>r.currency===currency))throw Error('请选择此报表中的币种');
 if(typeof q!=='string'||q.length>160||!['all','loss','pending','positive','zero'].includes(filter))throw Error('商品筛选条件无效');
 if(!['number','string'].includes(typeof offset)||typeof offset==='string'&&!/^(0|[1-9]\d*)$/.test(offset)||!Number.isSafeInteger(Number(offset))||Number(offset)<0)throw Error('页码无效');
 const needle=q.trim().toLocaleLowerCase(),selected=sortWbEconomics(rows.filter(r=>r.currency===currency&&(filter==='all'||r.category===filter)).map(r=>({...r,...metadata.get(r.sku)})).filter(r=>!needle||[r.sku,r.name,r.offerId].some(v=>String(v||'').toLocaleLowerCase().includes(needle))));
 const start=Math.min(Math.floor(Number(offset)/10)*10,Math.max(0,Math.floor((selected.length-1)/10)*10));
 return {currency,q:q.trim(),filter,offset:start,limit:10,total:selected.length,rows:selected.slice(start,start+10)};
}
