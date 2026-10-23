import test from 'node:test';
import assert from 'node:assert/strict';
import {oglPrice,cnyRate} from '../core/ogl-pricing.mjs';
const job=(price=80,weight=400,side=200)=>({canonical:{currency:'CNY',price},mapping:{typeId:971168876},publishConfig:{weight,width:side,height:side,depth:side,vat:'0'},pageImport:{evidence:{text:'快递: 8.00'}}});
test('OGL 400g lamp nets source price after freight, domestic fee, commission and reserves',()=>{
 const q=oglPrice(job(),{rubPerCny:12.146});assert.equal(q.group,'Extra Small');assert.equal(q.internationalFreight,12.78);assert.equal(q.price,'122.36');assert.ok(q.netAfterConfiguredCosts>=80);assert.equal(q.commissionPct,12);assert.equal(q.domesticShipping,8);assert.ok(q.assumptions.length);
});
test('OGL solves price tiers instead of pricing low tier then crossing its boundary',()=>{
 const q=oglPrice(job(120),{rubPerCny:12.146});assert.equal(q.group,'Small');assert.ok(Number(q.price)>135);assert.ok(q.netAfterConfiguredCosts>=120);
});
test('only Big groups apply volumetric weight and service fee is capped in RUB',()=>{
 const q=oglPrice(job(2000,6000,1000),{rubPerCny:12.146});assert.equal(q.group,'Premium Big');assert.equal(q.billableWeightG,100*100*100/12);assert.equal(q.oglService,200/12.146);
});
test('missing shipping and unsupported category do not become zero or an invented commission',()=>{
 const j=job();j.pageImport.evidence.text='';assert.throws(()=>oglPrice(j,{rubPerCny:12.146}),/中国境内运费/);j.mapping.typeId=1;assert.throws(()=>oglPrice(j,{rubPerCny:12.146}),/佣金/);
});
test('CBR parses nominal and effective date without redirects',async()=>{
 const r=await cnyRate({date:new Date('2026-10-23T00:00:00Z'),fetcher:async(url,options)=>{assert.equal(options.redirect,'error');return {ok:true,text:async()=>'<ValCurs Date="23.10.2026"><Valute ID="x"><CharCode>CNY</CharCode><Nominal>10</Nominal><Value>121,46</Value></Valute></ValCurs>'};}});assert.ok(Math.abs(r.rubPerCny-12.146)<1e-10);assert.equal(r.date,'23.10.2026');
});
