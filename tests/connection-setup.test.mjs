import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connectOzon} from '../core/connection-setup.mjs';
import {envCredentials} from '../web/connection-setup.mjs';
test('real connection checks only catalog and preserves existing configuration',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ops-connect-'));try{
 await writeFile(join(directory,'connection.json'),JSON.stringify({other:'keep',stores:[{id:'existing'}]}));let calls=0;
 const input={name:'Test store',clientId:'12345',apiKey:'fake-test-key'};
 const result=await connectOzon(input,{directory,fetcher:async(url,request)=>{calls++;assert.equal(url,'https://api-seller.ozon.ru/v3/product/list');assert.equal(request.redirect,'error');assert.equal(request.headers['Api-Key'],input.apiKey);assert.equal(JSON.parse(request.body).limit,1);return {ok:true,json:async()=>({result:{items:[],total:0}})};}});
 assert.equal(calls,1);const config=JSON.parse(await readFile(join(directory,'connection.json')));assert.equal(config.other,'keep');assert.equal(config.stores[0].id,'existing');assert.equal(config.stores.length,2);assert.ok(!JSON.stringify(config).includes(input.apiKey));assert.equal((await stat(result.store.envFile)).mode&0o777,0o600);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('failed key verification stores nothing and does not disclose response',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ops-connect-'));try{
 await assert.rejects(connectOzon({name:'A',clientId:'1',apiKey:'fake-test-key'},{directory,fetcher:async()=>({ok:false,status:403,text:async()=> 'secret'})}),e=>!e.message.includes('secret')&&e.message.includes('403'));
 await assert.rejects(readFile(join(directory,'connection.json')),{code:'ENOENT'});
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('env file parsing is literal and supports quoted existing credentials',()=>{
 assert.deepEqual(envCredentials('# comment\nOZON_CLIENT_ID="123"\nOZON_API_KEY=\'fake$(literal)\'\n'),{clientId:'123',apiKey:'fake$(literal)'});
});
