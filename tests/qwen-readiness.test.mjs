import test from 'node:test';
import assert from 'node:assert/strict';
import {qwenJSON} from '../adapters/qwen.mjs';
import {improveProduct} from '../core/product-content.mjs';

const model='qwen2.5:14b',schema={type:'object',properties:{x:{type:'number'}}};
const json=data=>({ok:true,json:async()=>data});
const generated=output=>json({done:true,response:JSON.stringify(output),eval_count:5});
const product={titleZh:'替换刷头 MES609 2支',descriptionZh:'已选规格：2支【配MES609】',attributes:{数量:'2'},brand:'SU-SIMAN',images:[]};
const copy={title:'Насадки для MES609, 2 шт.',description:'Описание без неподтверждённых характеристик. '.repeat(28),subtitle:'Сменные насадки',benefits:['Сменная конструкция','Комплект для MES609','Две насадки'],compatibility:['MES609'],packageContents:'2 насадки',careTips:[],faq:[],warnings:[]};

test('existing Qwen callers still generate directly unless requireLoaded is requested',async()=>{
 const requests=[];
 const result=await qwenJSON({prompt:'product data',schema,model,fetcher:async(url,options)=>{requests.push({url,options});return generated({x:1});}});
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'http://127.0.0.1:11434/api/generate');
 assert.equal(requests[0].options.method,'POST');
 assert.deepEqual(result.output,{x:1});
 assert.equal(result.model,model);
 assert.equal(result.usage.output_tokens,5);
});

test('resident-model checks fail closed without any generation, warmup or download request',async()=>{
 for(const resident of [{models:[]},{models:[{name:'qwen2.5:7b'}]},{models:[{name:'qwen2.5:14b-extra'},{model:'library/qwen2.5:14b'}]},{models:[null]},{}]){
  const requests=[];
  await assert.rejects(qwenJSON({prompt:'data',schema,model,requireLoaded:true,fetcher:async(url,options)=>{
   requests.push({url,options});return json(resident);
  }}),e=>e.message==='qwen_not_loaded'&&e.code==='qwen_not_loaded');
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'http://127.0.0.1:11434/api/ps');
  assert.equal(requests[0].options.method,'GET');
  assert.equal(requests[0].options.redirect,'error');
  assert.equal(requests[0].options.body,undefined);
 }
});

test('each supported resident-model field allows one bounded schema-constrained generation',async t=>{
 const timeouts=[],nativeTimeout=AbortSignal.timeout;
 t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return nativeTimeout(ms);});
 for(const resident of [{name:model},{model}]){
  const requests=[];
  const result=await qwenJSON({prompt:'selected facts',schema,model,requireLoaded:true,timeoutMs:12345,fetcher:async(url,options)=>{
   requests.push({url,options});return url.endsWith('/api/ps')?json({models:[resident]}):generated({x:2});
  }});
  assert.deepEqual(requests.map(r=>[r.url,r.options.method]),[['http://127.0.0.1:11434/api/ps','GET'],['http://127.0.0.1:11434/api/generate','POST']]);
  const body=JSON.parse(requests[1].options.body);
  assert.deepEqual(body.format,schema);
  assert.equal(body.model,model);
  assert.equal(body.prompt,'selected facts');
  assert.equal(body.stream,false);
  assert.equal(requests[1].options.redirect,'error');
  assert.equal(body.options.temperature,0);
  assert.deepEqual(result.output,{x:2});
 }
 assert.deepEqual(timeouts,[2000,12345,2000,12345]);
});

test('unreachable or unsuccessful readiness never reaches generation and fails immediately',async()=>{
 for(const failure of [Error('offline'),{ok:false,status:503}]){
  let requests=0;const started=performance.now();
  await assert.rejects(qwenJSON({prompt:'data',schema,model,requireLoaded:true,fetcher:async(url,options)=>{
   requests++;assert.equal(url,'http://127.0.0.1:11434/api/ps');assert.equal(options.method,'GET');
   if(failure instanceof Error)throw failure;
   return failure;
  }}),failure instanceof Error?failure:/qwen_readiness_http_503/);
  assert.equal(requests,1);
  assert.ok(performance.now()-started<500,'readiness errors must not wait for the generation timeout');
 }
});

test('stalled readiness aborts at its own short deadline without issuing POST',async t=>{
 const timeouts=[],nativeTimeout=AbortSignal.timeout;
 // Accelerate the actual abort while checking the production deadline supplied by the adapter.
 t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return nativeTimeout(10);});
 let requests=0;
 await assert.rejects(qwenJSON({prompt:'data',schema,model,requireLoaded:true,timeoutMs:60000,fetcher:async(url,{method,signal})=>{
  requests++;assert.equal(method,'GET');assert.equal(url,'http://127.0.0.1:11434/api/ps');
  return new Promise((resolve,reject)=>{
   const watchdog=setTimeout(()=>reject(Error('readiness did not abort')),500);
   signal.addEventListener('abort',()=>{clearTimeout(watchdog);reject(signal.reason);},{once:true});
  });
 }}),{name:'TimeoutError'});
 assert.equal(requests,1);
 assert.deepEqual(timeouts,[2000]);
});

test('default product copy skips an unloaded model and starts the strong fallback immediately',async t=>{
 const requests=[];let strong=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,options});return json({models:[]});});
 const started=performance.now(),result=await improveProduct(product,{sources:[]},{strong:async()=>{strong++;return {provider:'codex-test',output:copy};}});
 assert.equal(strong,1);
 assert.equal(result.provider,'codex-test');
 assert.equal(requests.length,1);
 assert.equal(requests[0].options.method,'GET');
 assert.deepEqual(result.attempts[0].issues,['unavailable_or_invalid']);
 assert.ok(performance.now()-started<500,'cold-model fallback must not wait sixty seconds');
});

test('default product copy keeps the twelve-second generation cap and validates loaded-model output',async t=>{
 const timeouts=[],nativeTimeout=AbortSignal.timeout;let strong=0,posts=0;
 t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return nativeTimeout(ms);});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.endsWith('/api/ps')){const bodyModel=process.env.OPS_QWEN_MODEL||model;return json({models:[{name:bodyModel}]});}
  assert.equal(url,'http://127.0.0.1:11434/api/generate');assert.equal(options.method,'POST');posts++;
  return generated({...copy,description:'Коротко'});
 });
 const result=await improveProduct(product,{sources:[]},{strong:async()=>{strong++;return {provider:'codex-test',output:copy};}});
 assert.deepEqual(timeouts,[2000,12000]);
 assert.equal(posts,1);assert.equal(strong,1);
 assert.ok(result.attempts[0].issues.includes('description_depth'));
 assert.equal(result.provider,'codex-test');
});

test('injected product-copy providers retain their existing timeout and do not check Ollama',async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('injected local provider must not call Ollama'));
 let local=0;
 const result=await improveProduct(product,{sources:[]},{local:async options=>{local++;assert.equal(options.timeoutMs,60000);assert.equal(options.requireLoaded,undefined);return {provider:'injected',output:copy};},strong:async()=>assert.fail('valid injected copy should pass')});
 assert.equal(local,1);
 assert.equal(result.provider,'injected');
});
