import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {localizeSourceImage} from '../adapters/codex-images.mjs';

const secret='DO_NOT_EXPOSE_provider_secret_or_prompt',input={paths:['/private/source-image.png'],prompt:secret};
async function fixture(t,body){
 const root=await mkdtemp(join(tmpdir(),'codex-image-test-')),binary=join(root,'fake-codex'),prior=process.env.CODEX_HOME;
 await mkdir(join(root,'generated_images'));process.env.CODEX_HOME=root;
 t.after(async()=>{if(prior===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=prior;await rm(root,{recursive:true,force:true});});
 await writeFile(binary,`#!/usr/bin/env node
import {writeFile,mkdir,utimes,symlink} from 'node:fs/promises';
import {join} from 'node:path';
const out=process.argv[process.argv.indexOf('--output-last-message')+1],root=process.env.CODEX_HOME;
const emit=e=>process.stdout.write(JSON.stringify(e)+'\\n');
process.stdin.resume();
await writeFile(join(root,'cwd.txt'),process.cwd());
${body}
`,{mode:0o700});
 return {root,binary,options:{binary,timeoutMs:10000,save:async()=>({assetId:'saved-image'})}};
}
async function failed(promise,sourceCode,{retryable=false,exitCode,signal}={}){
 let failure;await assert.rejects(promise,error=>{failure=error;assert.equal(error.sourceCode,sourceCode);assert.equal(error.retryable,retryable);assert.equal(Number.isInteger(error.durationMs),true);assert.ok(error.durationMs>=0);assert.deepEqual(Object.keys(error).sort(),['durationMs','exitCode','retryable','signal','sourceCode']);if(exitCode!==undefined)assert.equal(error.exitCode,exitCode);if(signal!==undefined)assert.equal(error.signal,signal);const exposed=JSON.stringify({...error,message:error.message});assert.ok(!exposed.includes(secret));assert.ok(!exposed.includes('/private/'));assert.ok(!exposed.includes('codex-image-test-'));assert.ok(!exposed.includes('unknown_provider_code'));return true;});return failure;
}

test('localization preserves restricted CLI flags and accepts only a fresh generated PNG',async t=>{
 const f=await fixture(t,`
const args=process.argv.slice(2);
for(const feature of ['shell_tool','unified_exec','apps','browser_use','computer_use','hooks','multi_agent'])if(!args.some((a,i)=>a==='--disable'&&args[i+1]===feature))throw Error('missing restriction');
if(!args.includes('--ignore-user-config')||!args.includes('--ephemeral')||args[args.indexOf('--sandbox')+1]!=='read-only'||args[args.indexOf('--enable')+1]!=='image_generation'||!args.includes('web_search="disabled"'))throw Error('missing restriction');
const path=join(root,'generated_images','image.png');await writeFile(path,'generated-image');await writeFile(out,JSON.stringify({imagePath:path}));
emit({type:'item.completed',item:{type:'image_generation'}});emit({type:'turn.completed',usage:{input_tokens:12}});
`);let saved;
 const result=await localizeSourceImage(input,{...f.options,save:async bytes=>{saved=bytes.toString();return {assetId:'verified-image'};}});
 assert.equal(saved,'generated-image');assert.equal(result.assetId,'verified-image');assert.equal(result.outputVerified,true);assert.equal(result.toolEventSeen,true);assert.equal(result.provider,'codex-builtin-imagegen');assert.deepEqual(result.usage,{input_tokens:12});
 const cwd=await readFile(join(f.root,'cwd.txt'),'utf8');await assert.rejects(stat(cwd),{code:'ENOENT'});
});

test('timeout waits for child termination and is not retryable',async t=>{
 const f=await fixture(t,'setInterval(()=>{},1000);');
 await failed(localizeSourceImage(input,{...f.options,timeoutMs:100}),'timeout',{exitCode:null,signal:'SIGKILL'});
});

test('all forbidden tool events remain fatal, including image generation through MCP',async t=>{
 for(const type of ['command_execution','mcp_tool_call','web_search','web_search_call','file_change'])await t.test(type,async sub=>{
  const f=await fixture(sub,`emit({type:'item.started',item:{type:${JSON.stringify(type)},tool:'image_generation',message:${JSON.stringify(secret)}}});setInterval(()=>{},1000);`);
  await failed(localizeSourceImage(input,f.options),'forbidden_tool',{exitCode:null,signal:'SIGKILL'});
 });
});

test('the stdout size limit produces a safe non-retryable failure',async t=>{
 const f=await fixture(t,"process.stdout.write('x'.repeat(4_000_001));setInterval(()=>{},1000);");
 await failed(localizeSourceImage(input,f.options),'output_limit',{exitCode:null,signal:'SIGKILL'});
});

test('provider errors expose only allowlisted categories and fixed messages',async t=>{
 for(const [code,sourceCode,retryable] of [['invalid_api_key','auth',false],['usage_limit_reached','quota',false],['rate_limit_exceeded','rate_limit',true],['unknown_provider_code','provider',true]])await t.test(code,async sub=>{
  const f=await fixture(sub,`emit({type:'turn.failed',error:{code:${JSON.stringify(code)},message:${JSON.stringify(secret+' /private/secret-file')}}});process.exitCode=7;`);
  await failed(localizeSourceImage(input,f.options),sourceCode,{retryable,exitCode:7,signal:null});
 });
});

test('structured error types and known stderr strings are classified without exposing logs',async t=>{
 await t.test('structured type',async sub=>{
  const f=await fixture(sub,`emit({type:'turn.failed',error:{type:'authentication_error',message:${JSON.stringify(secret)}}});`);
  await failed(localizeSourceImage(input,f.options),'auth',{exitCode:0,signal:null});
 });
 await t.test('known stderr text',async sub=>{
  const f=await fixture(sub,`process.stderr.write(${JSON.stringify('You have hit your usage limit. '+secret+' /private/secret-file')});process.exitCode=1;`);
  await failed(localizeSourceImage(input,f.options),'quota',{exitCode:1,signal:null});
 });
 await t.test('unavailable image tool',async sub=>{
  const f=await fixture(sub,`emit({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify('The image generation tool is unavailable. '+secret)}}});`);
  await failed(localizeSourceImage(input,f.options),'unavailable_tool',{exitCode:0,signal:null});
 });
});

test('missing or malformed output never exposes raw provider output',async t=>{
 for(const body of ['',`await writeFile(out,${JSON.stringify(secret)});`,`await writeFile(out,JSON.stringify({imagePath:17,secret:${JSON.stringify(secret)}}));`])await t.test('invalid output',async sub=>{
  const f=await fixture(sub,body);await failed(localizeSourceImage(input,f.options),'invalid_output',{exitCode:0,signal:null});
 });
});

test('outside, missing, stale and symlinked outputs fail path verification without leaking paths',async t=>{
 const cases={outside:"const path=join(root,'outside.png');await writeFile(path,'image');",missing:"const path=join(root,'generated_images','missing.png');",stale:"const path=join(root,'generated_images','stale.png');await writeFile(path,'image');await utimes(path,new Date(0),new Date(0));",symlink:"const original=join(root,'outside.png'),path=join(root,'generated_images','linked.png');await writeFile(original,'image');await symlink(original,path);"};
 for(const [name,body] of Object.entries(cases))await t.test(name,async sub=>{
  const f=await fixture(sub,body+'await writeFile(out,JSON.stringify({imagePath:path}));');await failed(localizeSourceImage(input,f.options),'invalid_output_path',{exitCode:0,signal:null});
 });
});

test('spawn failures do not expose binary paths and do not retry',async()=>{
 await failed(localizeSourceImage(input,{binary:'/private/'+secret,timeoutMs:100}),'unavailable_tool',{exitCode:null,signal:null});
});

test('errors crossing the adapter boundary always receive a fixed safe message',async t=>{
 const f=await fixture(t,"const path=join(root,'generated_images','image.png');await writeFile(path,'image');await writeFile(out,JSON.stringify({imagePath:path}));");
 await failed(localizeSourceImage(input,{...f.options,save:async()=>{throw Object.assign(Error(secret+' /private/secret-file'),{sourceCode:'invalid_output',retryable:true});}}),'invalid_output',{exitCode:0,signal:null});
});
