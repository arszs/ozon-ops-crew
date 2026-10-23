import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCpcReport,normalizeCpoReport,synchronizeLive} from '../live-data.mjs';
import {adCoverage,skuAdBreakdown} from '../web/ad-coverage.mjs';
import {performanceReadAllowed} from '../performance.mjs';

const cpc={10:{report:{totals:{moneySpent:'20'},rows:[{sku:'1',moneySpent:'15',orders:'1',ordersMoney:'100'}]}}};
const cpo={rows:[{SKU:'1',MoneySpent:'7',MoneySpentFromCPC:'15',Orders:'2',OrdersMoney:'200'}]};
async function snapshot({campaignFailure=false,cpcResponse=cpc,cpoResponse=cpo}={}){
 return synchronizeLive(()=>{},{catalogue:async()=>({total:2,items:[{productId:11},{productId:22}]}),seller:async path=>{
  if(path==='/v3/product/info/list')return {items:[{id:11,sku:1},{id:22,sku:2}]};throw Error('fixture_unavailable');
 },performance:async path=>{
  if(path==='/api/client/campaign'){if(campaignFailure)throw Error('performance_http_403');return {list:[{id:10,advObjectType:'SKU'}]};}
  if(path.includes('search_promo'))return {products:[],total:0};return {rows:[]};
 },report:async path=>{
  if(path.includes('all_sku_promo'))throw Error('performance_http_404');
  const response=path.includes('/statistic/products')?cpoResponse:cpcResponse;
  if(response instanceof Error)throw response;return response;
 }});
}
test('CPC totals retain unattributed cost; missing or unexpected campaigns fail coverage',()=>{
 const r=normalizeCpcReport(cpc,['10']);assert.equal(r.spend,20);assert.equal(r.unallocated,5);
 for(const ids of [['10','11'],['11'],[]])assert.throws(()=>normalizeCpcReport(cpc,ids),/incomplete/);
 assert.throws(()=>normalizeCpcReport({},['10']),/incomplete/);
 assert.throws(()=>normalizeCpcReport({10:{report:{rows:[]}}},['10']),/invalid_api_number/);
});
test('CPO rows without SKU retain expense instead of disappearing',()=>{
 const r=normalizeCpoReport({rows:[...cpo.rows,{MoneySpent:'3'}]});assert.equal(r.spend,10);assert.equal(r.unallocated,3);assert.equal(r.bySku['1'].spend,7);assert.deepEqual(Object.keys(r.bySku),['1']);
});
test('CPC survives a failed CPO report and missing cost stays unknown per instrument',async()=>{
 const d=await snapshot({cpoResponse:new Error('performance_http_403')});
 assert.equal(d.sources.cpo.ok,false);assert.equal(d.ads.cpcSpend,20);assert.equal(d.ads.cpoSpend,null);assert.equal(d.ads.selectedProductsSpend,20);assert.equal(d.ads.selectedReportsComplete,false);
 const p=d.rows.find(r=>r.sku==='1'),missing=d.rows.find(r=>r.sku==='2');assert.equal(p.adSpend,15);assert.equal(p.adBreakdown.cpoSpend,null);assert.equal(missing.adSpend,null);assert.equal(d.ads.unallocated.cpc,5);
 assert.equal(d.sources.allCpo.error,'performance_http_404');assert.equal(d.ads.allAssortmentVerified,false);
});
test('independent CPO report remains usable when campaign discovery fails or CPC response is incomplete',async()=>{
 for(const options of [{campaignFailure:true},{cpcResponse:{}}]){
  const d=await snapshot(options);assert.equal(d.sources.cpc.ok,false);assert.equal(d.sources.cpo.ok,true);assert.equal(d.ads.cpcSpend,null);assert.equal(d.ads.selectedProductsSpend,7);
  assert.equal(d.rows.find(r=>r.sku==='1').adBreakdown.cpoSpend,7);assert.equal(d.rows.find(r=>r.sku==='2').adBreakdown.cpoSpend,0);
 }
});
test('malformed reports never become successful zero-cost reports',async()=>{
 const d=await snapshot({cpcResponse:{10:{report:{rows:[]}}},cpoResponse:{}});assert.equal(d.ads,null);assert.equal(d.sources.cpc.ok,false);assert.equal(d.sources.cpo.ok,false);assert.ok(d.rows.every(r=>r.adSpend===null));
});
test('coverage view distinguishes unknown from reported zero and does not claim complete all-assortment costs',()=>{
 const html=adCoverage({sources:{cpc:{ok:true},cpo:{ok:false,error:'performance_http_403'},allCpo:{ok:false,error:'performance_http_404'}},ads:{cpcSpend:0,cpoSpend:null,unallocated:{cpc:5,cpo:null}}});
 assert.match(html,/无读取权限/);assert.match(html,/404/);assert.match(html,/未归属 SKU/);assert.match(html,/0.00/);assert.match(html,/<td>—<\/td>/);
 assert.match(skuAdBreakdown({}),/CPC —/);assert.match(adCoverage({sources:{allCpo:{ok:true}}}),/金额尚未校验/);
});
test('all-assortment GET mutation endpoints remain excluded from reporting adapter',()=>{
 for(const action of ['activate','deactivate','set_bid'])assert.equal(performanceReadAllowed('/api/client/campaign/all_sku_promo/'+action,'GET'),false);
});
