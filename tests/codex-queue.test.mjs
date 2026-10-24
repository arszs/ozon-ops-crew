import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {codexJSON,createCodexJSONQueue,objectSchema} from '../adapters/codex.mjs';

const schema=objectSchema({id:{type:'string'}});
async function until(check){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){const value=await check();if(value)return value;await delay(5);}
 assert.fail('Timed out waiting for the fake CLI');
}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'codex-queue-test-')),binary=join(root,'fake-codex'),jobs=[],ids=new Set();
 await writeFile(binary,`#!/usr/bin/env node
import {appendFile,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const root=${JSON.stringify(root)},args=process.argv.slice(2),out=args[args.indexOf('--output-last-message')+1],schemaFile=args[args.indexOf('--output-schema')+1];
let input='';for await(const chunk of process.stdin)input+=chunk;
const request=JSON.parse(input.slice(input.indexOf('\\n')+1));
const log=type=>appendFile(join(root,'events.jsonl'),JSON.stringify({type,id:request.id})+'\\n');
await log('start');
await writeFile(join(root,request.id+'.started.json'),JSON.stringify({args,cwd:process.cwd(),schema:JSON.parse(await readFile(schemaFile,'utf8')),mode:(await stat(schemaFile)).mode&0o777,input,envKeys:Object.keys(process.env)}));
if(request.tool)process.stdout.write(JSON.stringify({type:'item.completed',item:{type:request.tool}})+'\\n');
let command=request.auto?'resolve':null;
while(!command){try{command=await readFile(join(root,request.id+'.gate'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(!command)await delay(5);}
await log('end');
if(command==='reject')process.exitCode=7;
else{await writeFile(out,JSON.stringify({id:request.id}));process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:12}})+'\\n');}
`,{mode:0o700});
 const release=(id,command='resolve')=>writeFile(join(root,id+'.gate'),command);
 const submit=(queue,id,{data={},...options}={})=>{
  ids.add(id);const job=queue({prompt:JSON.stringify({id,...data}),schema,binary,timeoutMs:5000,...options});
  jobs.push(job);job.catch(()=>{});return job;
 };
 const started=id=>until(async()=>{try{return JSON.parse(await readFile(join(root,id+'.started.json'),'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}});
 const events=async()=>{try{return (await readFile(join(root,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 t.after(async()=>{await Promise.all([...ids].map(id=>release(id)));await Promise.allSettled(jobs);await rm(root,{recursive:true,force:true});});
 return {root,binary,submit,release,started,events};
}

test('the default FIFO queue runs two fake CLI processes and releases each slot independently',async t=>{
 const f=await fixture(t),starts=[],runCLI=createCodexJSONQueue({concurrency:2}),prior=process.env.OPS_CODEX_JSON_CONCURRENCY;
 delete process.env.OPS_CODEX_JSON_CONCURRENCY;
 const queue=createCodexJSONQueue({runRequest:request=>{starts.push(JSON.parse(request.prompt).id);return runCLI(request);}});
 if(prior!==undefined)process.env.OPS_CODEX_JSON_CONCURRENCY=prior;
 const a=f.submit(queue,'A'),b=f.submit(queue,'B'),c=f.submit(queue,'C'),d=f.submit(queue,'D');
 await Promise.all([f.started('A'),f.started('B')]);
 assert.deepEqual(starts,['A','B']);
 await f.release('B');assert.deepEqual((await b).output,{id:'B'});
 await f.started('C');assert.deepEqual(starts,['A','B','C']);
 let aFinished=false;a.finally(()=>{aFinished=true;});assert.equal(aFinished,false);
 await f.release('C','reject');await assert.rejects(c,/Codex 未完成结构化输出/);
 await f.started('D');assert.deepEqual(starts,['A','B','C','D']);
 await f.release('D');assert.deepEqual((await d).output,{id:'D'});assert.equal(aFinished,false);
 await f.release('A');await a;
 let active=0,maxActive=0;const completed=[];
 for(const event of await f.events()){active+=event.type==='start'?1:-1;maxActive=Math.max(maxActive,active);assert.ok(active>=0&&active<=2);if(event.type==='end')completed.push(event.id);}
 assert.equal(maxActive,2);assert.equal(active,0);assert.deepEqual(completed,['B','C','D','A']);
});

test('environment concurrency one remains serial, and invalid values cannot exceed two',async t=>{
 for(const [value,expected] of [['1',1],['2',2],['3',2],['0',2],['invalid',2]])await t.test(value,async()=>{
  const prior=process.env.OPS_CODEX_JSON_CONCURRENCY;process.env.OPS_CODEX_JSON_CONCURRENCY=value;
  const starts=[],releases=[];let active=0,maxActive=0;
  const queue=createCodexJSONQueue({runRequest:id=>{starts.push(id);active++;maxActive=Math.max(maxActive,active);return new Promise(resolve=>releases.push(()=>{active--;resolve(id);}));}});
  if(prior===undefined)delete process.env.OPS_CODEX_JSON_CONCURRENCY;else process.env.OPS_CODEX_JSON_CONCURRENCY=prior;
  const jobs=[queue('A'),queue('B'),queue('C')];await until(()=>starts.length===expected);
  assert.deepEqual(starts,['A','B','C'].slice(0,expected));
  while(starts.length<3){releases.shift()();await until(()=>starts.length===3||releases.length===expected);}
  while(releases.length)releases.shift()();assert.deepEqual(await Promise.all(jobs),['A','B','C']);assert.equal(maxActive,expected);
 });
});

test('synchronous rejection and CLI spawn failure do not stall a serial queue',async t=>{
 const f=await fixture(t),runCLI=createCodexJSONQueue({concurrency:1});let attempts=0;
 const queue=createCodexJSONQueue({concurrency:1,runRequest:request=>{if(++attempts===1)throw Error('sync failure');return runCLI(request);}});
 const bad=f.submit(queue,'bad'),missing=f.submit(queue,'missing',{binary:join(f.root,'not-installed')}),good=f.submit(queue,'good',{data:{auto:true}});
 await assert.rejects(bad,/sync failure/);await assert.rejects(missing,/未找到 Codex CLI/);assert.deepEqual((await good).output,{id:'good'});assert.equal(attempts,3);
});

test('schema, image forwarding, sandbox flags and the child environment stay restricted',async t=>{
 const f=await fixture(t),prior=process.env.OPS_QUEUE_SELLER_SECRET;process.env.OPS_QUEUE_SELLER_SECRET='must-not-reach-cli';
 t.after(()=>{if(prior===undefined)delete process.env.OPS_QUEUE_SELLER_SECRET;else process.env.OPS_QUEUE_SELLER_SECRET=prior;});
 const result=await f.submit(codexJSON,'restricted',{images:['/private/first.png','/private/second.png'],data:{auto:true}}),seen=await f.started('restricted');
 const schemaFile=join(tmpdir(),basename(seen.cwd),'schema.json'),outputFile=join(tmpdir(),basename(seen.cwd),'result.json');
 assert.deepEqual(seen.args,['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--color','never','--json',...['shell_tool','unified_exec','apps','browser_use','computer_use','hooks','image_generation','multi_agent'].flatMap(feature=>['--disable',feature]),'-c','web_search="disabled"','--output-schema',schemaFile,'--output-last-message',outputFile,'--image','/private/first.png','--image','/private/second.png','-']);
 assert.deepEqual(seen.schema,schema);assert.equal(seen.mode,0o600);assert.equal(seen.envKeys.includes('OPS_QUEUE_SELLER_SECRET'),false);assert.match(seen.input,/Never invoke tools/);
 assert.equal(result.provider,'codex-subscription');assert.deepEqual(result.usage,{input_tokens:12});assert.equal(result.searchCalls,0);
 await assert.rejects(readFile(schemaFile),{code:'ENOENT'});
});

test('input and forbidden-tool guards remain in force while research keeps only web search',async t=>{
 const f=await fixture(t),queue=createCodexJSONQueue({concurrency:2});
 for(const request of [{prompt:7},{prompt:'x'.repeat(60001)},{prompt:'{}',images:['a','b','c']}])await assert.rejects(queue({...request,schema,binary:f.binary}),/AI 输入超过单商品限制/);
 assert.deepEqual(await f.events(),[]);
 for(const tool of ['command_execution','mcp_tool_call','web_search','web_search_call','file_change'])await assert.rejects(f.submit(queue,'blocked-'+tool,{data:{tool}}),/Codex 未完成结构化输出/);
 await assert.rejects(f.submit(queue,'research-blocked',{research:true,data:{tool:'command_execution'}}),/Codex 未完成结构化输出/);
 const research=await f.submit(queue,'research',{research:true,data:{tool:'web_search_call',auto:true}}),seen=await f.started('research');
 assert.equal(research.searchCalls,1);assert.ok(seen.args.includes('web_search="live"'));assert.match(seen.input,/Only use web search tools/);
});
