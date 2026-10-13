import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import vm from 'node:vm';
test('Chinese public demo gates approval and never calls a marketplace or private workspace',async()=>{
 const html=await readFile(new URL('../web/demo-zh.html',import.meta.url),'utf8'),code=await readFile(new URL('../web/demo-zh.mjs',import.meta.url),'utf8');
 assert.match(html,/<html lang="zh-CN">/);assert.doesNotMatch(code,/fetch\(|XMLHttpRequest|localStorage/);
 const nodes=Object.fromEntries(['analyze','brief','compare','comparison','approval','approved'].map(id=>[id,{hidden:true,scrollIntoView(){}}]));let valid=false;nodes.approval.checkValidity=()=>valid;
 vm.runInNewContext(code,{document:{getElementById:id=>nodes[id]}});nodes.analyze.onclick();assert.equal(nodes.brief.hidden,false);nodes.compare.onclick();assert.equal(nodes.comparison.hidden,false);
 const event={preventDefault(){},currentTarget:nodes.approval};nodes.approval.onsubmit(event);assert.equal(nodes.approved.hidden,false);assert.match(nodes.approved.textContent,/请先逐项/);valid=true;nodes.approval.onsubmit(event);assert.equal(nodes.approved.hidden,false);assert.match(nodes.approved.textContent,/没有发布商品或启动广告/);
});
test('published example images match saved real-generation evidence',async()=>{
 const evidence=JSON.parse(await readFile(new URL('../docs/AIGC-DEMO-EVIDENCE.json',import.meta.url),'utf8'));
 for(const [name,expected] of Object.entries(evidence.images)){const bytes=await readFile(new URL('../web/'+name,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),expected);assert.ok(bytes.length>10000);}
 assert.equal(evidence.synthetic,true);assert.equal(evidence.realMarketplaceWrites,false);
});
