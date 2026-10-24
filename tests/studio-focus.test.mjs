import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
test('Studio refreshes an externally updated task on focus, keeps share text and polls image downloads',async t=>{
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(await readFile(new URL('../web/studio.html',import.meta.url),'utf8'),{url:'http://127.0.0.1:4174/studio.html#task/a',virtualConsole:vc}),w=dom.window,keys=['window','document','history','location','FormData','Blob','Event'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));for(const k of keys)Object.defineProperty(globalThis,k,{value:w[k],configurable:true,writable:true});
 const fetch=globalThis.fetch,timeout=globalThis.setTimeout;let scheduled,reads=0,hold=null;globalThis.setTimeout=(fn,ms)=>{if(ms>=2000)scheduled=fn;return 0;};
 t.after(()=>{w.close();globalThis.fetch=fetch;globalThis.setTimeout=timeout;for(const[k,v]of old)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];assert.deepEqual(errors,[]);});
 const task={id:'a',state:'needs_source',sourceUrl:'https://www.yiwugo.com/product/detail/123.html',events:[],options:{},sourceCheck:{state:'failed',error:'Не удалось загрузить страницу'}};
 globalThis.fetch=async path=>{if(path==='/api/workspace/studio')return {ok:true,json:async()=>({stores:[{id:'s',name:'Store'}],tasks:[task]})};reads++;if(hold)await hold;return {ok:true,json:async()=>structuredClone(task)};};
 await import('../web/studio.mjs?focus-regression');const q=s=>w.document.querySelector(s),settle=()=>new Promise(r=>timeout(r,5)),input=q('[name="sourceUrl"]');assert.equal(input.type,'text');input.value='【义乌购】https://www.yiwugo.com/product/detail/456.html，点击查看';const before=reads;
 task.sourceCheck={state:'downloading',imageCount:12,downloadedFiles:4};w.dispatchEvent(new w.Event('focus'));await settle();assert.equal(reads,before+1);assert.equal(q('[name="sourceUrl"]').value,input.value);assert.equal(q('#refresh-source').disabled,true);assert.equal(typeof scheduled,'function');
 task.sourceCheck={state:'verified',imageCount:12,selectedVariant:'白色'};await scheduled();assert.equal(q('#refresh-source').disabled,false);assert.match(q('.url-source-panel').textContent,/Исходная страница проверена/);assert.equal(q('[name="sourceUrl"]').value,input.value);
 let release;hold=new Promise(r=>release=r);const pendingReads=reads;w.dispatchEvent(new w.Event('focus'));w.dispatchEvent(new w.Event('focus'));await settle();assert.equal(reads,pendingReads+1);release();await settle();hold=null;
});
