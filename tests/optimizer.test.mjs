import test from 'node:test';import assert from 'node:assert/strict';import {optimizeAds} from '../web/ad-optimizer.mjs';
const item={id:'a',contribution:1000,cpa:100,maxOrders:10,cap:10000,incrementality:1};
test('unprofitable advertising does not consume budget',()=>{const r=optimizeAds([{...item,cpa:2000}],500);assert.equal(r.spent,0);assert.equal(r.unused,500);});
test('more productive item receives first scarce rubles',()=>{const r=optimizeAds([item,{...item,id:'b',cpa:500}],100);assert.equal(r.rows[1].spend,0);assert.ok(r.rows[0].spend>99);});
test('saturation causes diversification and respects caps',()=>{const r=optimizeAds([{...item,cap:100},{...item,id:'b'}],500);assert.ok(r.rows[0].spend<=100);assert.ok(r.rows[1].spend>0);assert.ok(r.spent<=500);});
test('zero incrementality and invalid inputs are excluded',()=>{assert.equal(optimizeAds([{...item,incrementality:0},{...item,id:'b',cpa:NaN}],500).spent,0);});
test('minimum return leaves inefficient surplus unused',()=>{const r=optimizeAds([item],10000);assert.ok(r.unused>0);assert.ok(r.profit>0);});
