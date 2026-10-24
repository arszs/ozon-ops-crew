import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import FileList from 'jsdom/lib/generated/idl/FileList.js';
import idlUtils from 'jsdom/lib/generated/idl/utils.js';

test('late home refresh keeps selected files and drafts and cannot replace an opened task',async t=>{
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(await readFile(new URL('../web/studio.html',import.meta.url),'utf8'),{url:'http://localhost/studio.html',virtualConsole:vc}),w=dom.window;
 const keys=['window','document','history','location','FormData','Blob','Event'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{value:w[k],configurable:true,writable:true});
 const nativeFetch=globalThis.fetch,nativeTimeout=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms)=>ms>=2000?0:nativeTimeout(fn,ms);
 t.after(()=>{w.close();globalThis.fetch=nativeFetch;globalThis.setTimeout=nativeTimeout;for(const[k,v]of old)if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];assert.deepEqual(errors,[]);});
 const tasks={a:{id:'a',state:'needs_source',sourceUrl:'https://item.taobao.com/item.htm?id=123',events:[]},b:{id:'b',state:'research',sourceUrl:'https://item.taobao.com/item.htm?id=456',events:[],product:{images:[]},extraction:{attempts:[]}}};
 const listing={stores:[{id:'ozon-live',name:'Store'}],tasks:Object.values(tasks)},uploaded=[];let pendingHome=null,importedInput;
 const pauseHome=()=>{const pending={};pending.promise=new Promise((resolve,reject)=>{pending.resolve=resolve;pending.reject=reject;});pendingHome=pending;return pending;};
 globalThis.fetch=async(path,options={})=>{
  if(path==='/api/workspace/studio'){const pending=pendingHome;pendingHome=null;if(pending)await pending.promise;return {ok:true,json:async()=>structuredClone(listing)};}
  if(path==='/api/workspace/assets'){uploaded.push(options.body);return {ok:true,json:async()=>({assetId:'a'.repeat(64)})};}
  if(path==='/api/workspace/studio-imports'){importedInput=options.body;return {ok:true,json:async()=>structuredClone(tasks.b)};}
  return {ok:true,json:async()=>structuredClone(tasks[path.split('/').at(-1)])};
 };
 const q=s=>w.document.querySelector(s),settle=()=>new Promise(r=>nativeTimeout(r,5));
 const fileText=file=>new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsText(file);});
 // jsdom has no DataTransfer constructor; create real FileLists for its native input setter.
 const selectFiles=(input,files)=>{const list=FileList.create(w);idlUtils.implForWrapper(list).push(...files.map(file=>idlUtils.implForWrapper(file)));input.files=list;input.dispatchEvent(new w.Event('change'));return list;};
 await import('../web/studio.mjs');q('[data-task="a"]').click();await settle();

 const refresh=pauseHome();q('#back').click();
 const form=q('#create'),htmlInput=q('#html-file'),folder=q('#initial-source-files'),url=q('[name="sourceUrl"]');
 const html=new w.File(['<html>saved product</html>'],'selected.html',{type:'text/html'}),photo=new w.File(['photo'],'original.jpg',{type:'image/jpeg'});
 const htmlFiles=selectFiles(htmlInput,[html]),photoFiles=selectFiles(folder,[photo]);
 url.value='https://item.taobao.com/item.htm?id=999';q('[name="weight"]').value='900';url.focus();
 listing.tasks=[tasks.b];refresh.resolve();await settle();
 assert.equal(q('#create'),form);assert.equal(q('#html-file'),htmlInput);assert.equal(q('#initial-source-files'),folder);
 assert.equal(htmlInput.files,htmlFiles);assert.equal(folder.files,photoFiles);assert.ok(htmlInput.files instanceof w.FileList);assert.equal(htmlInput.files[0],html);
 assert.equal(url.value,'https://item.taobao.com/item.htm?id=999');assert.equal(q('[name="weight"]').value,'900');assert.equal(q('#file-name').textContent,'selected.html');assert.equal(q('#initial-source-count').textContent,'1 фото');assert.equal(w.document.activeElement,url);
 assert.equal(q('[data-task="a"]'),null);assert.ok(q('[data-task="b"]'));
 form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();
 assert.equal(importedInput.get('html').name,html.name);assert.equal(await fileText(importedInput.get('html')),'<html>saved product</html>');assert.equal(importedInput.get('sourceUrl'),'https://item.taobao.com/item.htm?id=999');assert.equal(importedInput.get('weight'),'900');assert.equal(uploaded[0],photo);assert.deepEqual(JSON.parse(importedInput.get('sourceMediaFiles')),[{name:'original.jpg',assetId:'a'.repeat(64)}]);

 const failedRefresh=pauseHome();q('#back').click();const droppedForm=q('#create'),dropped=new w.File(['<html>dropped product</html>'],'dropped.html',{type:'text/html'});
 const drop=new w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{files:[dropped]}});droppedForm.dispatchEvent(drop);
 q('[name="sourceUrl"]').value='https://item.taobao.com/item.htm?id=888';failedRefresh.reject(Error('offline'));await settle();
 assert.equal(q('#create'),droppedForm);assert.equal(q('#file-name').textContent,'dropped.html');assert.equal(q('[name="sourceUrl"]').value,'https://item.taobao.com/item.htm?id=888');assert.ok(q('.studio-connection-error'));
 droppedForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(importedInput.get('html').name,dropped.name);assert.equal(await fileText(importedInput.get('html')),'<html>dropped product</html>');assert.equal(w.location.hash,'#task/b');

 const staleRefresh=pauseHome();q('#back').click();q('[data-task="b"]').click();await settle();staleRefresh.resolve();await settle();
 assert.equal(w.location.hash,'#task/b');assert.ok(q('.task-top'));assert.equal(q('#create'),null);assert.equal(q('.task-top .pill').textContent,'Ищем информацию');
});
