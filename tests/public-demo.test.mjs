import {calculateDemoProfit} from '../web/demo-profit.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import vm from 'node:vm';
test('Chinese public demo gates approval and never calls a marketplace or private workspace',async()=>{
 const html=await readFile(new URL('../web/demo-zh.html',import.meta.url),'utf8'),code=await readFile(new URL('../web/demo-zh.mjs',import.meta.url),'utf8');
 assert.match(html,/<html lang="zh-CN">/);assert.doesNotMatch(code,/fetch\(|XMLHttpRequest|localStorage/);
 const nodes=Object.fromEntries(['analyze','brief','compare','comparison','approval','approved','profit','profit-form','profit-result','profit-reset'].map(id=>[id,{hidden:true,scrollIntoView(){}}]));let valid=false;nodes.approval.checkValidity=()=>valid;
 vm.runInNewContext(code.replace(/^import[^\n]+\n/,''),{calculateDemoProfit,document:{getElementById:id=>nodes[id]}});nodes.analyze.onclick();assert.equal(nodes.brief.hidden,false);nodes.compare.onclick();assert.equal(nodes.comparison.hidden,false);
 const event={preventDefault(){},currentTarget:nodes.approval};nodes.approval.onsubmit(event);assert.equal(nodes.approved.hidden,false);assert.match(nodes.approved.textContent,/请先逐项/);valid=true;nodes.approval.onsubmit(event);assert.equal(nodes.approved.hidden,false);assert.match(nodes.approved.textContent,/没有发布商品或启动广告/);assert.equal(nodes.profit.hidden,false);nodes.approval.oninput();assert.equal(nodes.profit.hidden,true);assert.equal(nodes['profit-result'].hidden,true);
});
test('published example images match saved real-generation evidence',async()=>{
 const evidence=JSON.parse(await readFile(new URL('../docs/AIGC-DEMO-EVIDENCE.json',import.meta.url),'utf8'));
 for(const [name,expected] of Object.entries(evidence.images)){const bytes=await readFile(new URL('../web/'+name,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),expected);assert.ok(bytes.length>10000);}
 assert.equal(evidence.synthetic,true);assert.equal(evidence.realMarketplaceWrites,false);
});

const input={a_days:'7',a_orders:'40',a_revenue:'51600',a_cost:'40000',a_ads:'3000',b_days:'7',b_orders:'44',b_revenue:'56760',b_cost:'44000',b_ads:'3000',costsComplete:true,comparable:true};
test('synthetic contribution compares complete daily profit and does not confuse more orders with profit',()=>{
 const baseline=calculateDemoProfit(input);assert.equal(baseline.verdict,'repeat_candidate');assert.equal(baseline.a.profitCents,860000);assert.equal(baseline.b.profitCents,976000);assert.ok(Math.abs(baseline.delta-1160/7)<1e-9);assert.equal(baseline.synthetic,true);assert.equal(baseline.causal,false);
 const worse=calculateDemoProfit({...input,b_cost:'48000'});assert.equal(worse.verdict,'no_improvement');assert.ok(worse.delta<0);assert.ok(worse.b.orders>worse.a.orders);
 assert.equal(calculateDemoProfit({...input,b_days:'14'}).verdict,'no_improvement');
});
test('missing values and unchecked assumptions never become a positive demo result',()=>{
 for(const change of [{costsComplete:false},{comparable:false},{a_orders:'29'}])assert.equal(calculateDemoProfit({...input,...change}).verdict,'insufficient');
 for(const v of ['',null,'NaN','Infinity','-1','0.001','1000000001'])assert.throws(()=>calculateDemoProfit({...input,b_cost:v}));
 for(const change of [{a_days:'6'},{b_days:'91'},{a_orders:'2.5'}])assert.throws(()=>calculateDemoProfit({...input,...change}));
 assert.equal(calculateDemoProfit({...input,b_ads:'0'}).b.ads,0);
});
test('demo profit UI invalidates old output on edits and remains behind image approval',async()=>{
 const code=await readFile(new URL('../web/demo-zh.mjs',import.meta.url),'utf8'),nodes=Object.fromEntries(['analyze','brief','compare','comparison','approval','approved','profit','profit-form','profit-result','profit-reset'].map(id=>[id,{hidden:true,scrollIntoView(){}}]));
 const values={...input};nodes['profit-form'].elements={costsComplete:{checked:true}};let resets=0;nodes['profit-form'].reset=()=>resets++;nodes.approval.checkValidity=()=>true;
 class Data{constructor(){this.values=Object.fromEntries(Object.entries(values).filter(([,v])=>v!==false));}has(key){return key in this.values;}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}}
 vm.runInNewContext(code.replace(/^import[^\n]+\n/,''),{calculateDemoProfit,FormData:Data,document:{getElementById:id=>nodes[id]}});
 const event={preventDefault(){},currentTarget:nodes.approval};nodes['profit-form'].onsubmit(event);assert.equal(nodes['profit-result'].hidden,true);
 nodes.approval.onsubmit(event);nodes['profit-form'].onsubmit(event);assert.match(nodes['profit-result'].innerHTML,/真实重复验证/);
 values.b_cost='48000';nodes['profit-form'].oninput({target:{type:'number'}});assert.equal(nodes['profit-result'].hidden,true);assert.equal(nodes['profit-form'].elements.costsComplete.checked,false);
 values.costsComplete=false;nodes['profit-form'].onsubmit(event);assert.match(nodes['profit-result'].innerHTML,/暂不能判断/);
 values.b_cost='';nodes['profit-form'].onsubmit(event);assert.match(nodes['profit-result'].textContent,/未知不能填成零/);
 nodes['profit-reset'].onclick();assert.equal(resets,1);assert.equal(nodes['profit-result'].hidden,true);
});
