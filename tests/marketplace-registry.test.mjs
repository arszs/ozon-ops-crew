import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {marketplaceRegistry} from '../adapters/registry.mjs';
import {readStore,dictionaries,readMessages,executeMarketplace} from '../adapters/marketplaces.mjs';
import {Workspace} from '../core/workspace.mjs';
import {marketplaceRoadmap} from '../web/marketplace-roadmap.mjs';

test('planned and unknown platforms cannot read credentials, call another API or simulate success',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('unexpected network');});
 for(const marketplace of ['amazon','shopify','tiktok_shop','unknown',undefined])for(const mode of ['live','mock']){
  const store={id:'ozon-live',marketplace,mode,envFile:'/nonexistent/must-not-read.env'};
  for(const fn of [readStore,dictionaries,readMessages,executeMarketplace])await assert.rejects(fn(store,{}),/marketplace_(planned|unknown)/);
 }
 assert.equal(requests,0);
});

test('invalid modes cannot fall through to a live marketplace request',async t=>{
 let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('unexpected network');});
 for(const marketplace of ['ozon','wb'])for(const mode of [undefined,'demo','LIVE',''])for(const fn of [readStore,dictionaries,readMessages,executeMarketplace])await assert.rejects(fn({marketplace,mode},{}),/marketplace_mode_invalid/);
 assert.equal(requests,0);
});

test('existing Ozon and WB demos retain their operations and truthful receipts',async()=>{
 for(const marketplace of ['ozon','wb']){
  const store={id:marketplace+'-test',marketplace,mode:'mock'};
  assert.equal((await readStore(store)).mode,'mock');
  assert.equal((await dictionaries(store)).verified,false);
  assert.equal((await readMessages(store)).mode,'mock');
  const receipt=await executeMarketplace(store,{id:'op-1',payloadHash:'hash'});
  assert.equal(receipt.platform,marketplace);assert.equal(receipt.externalWrite,false);
 }
});

test('workspace exposes implementation status, and refuses unsupported stores before tools or SKU creation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'marketplace-registry-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let reads=0;
 const ws=new Workspace(join(dir,'workspace.json'),{storeReader:async()=>{reads++;return {};}});await ws.init();
 const view=await ws.view();assert.equal(view.marketplaces.length,5);assert.equal(view.stores.length,3);
 assert.equal(view.marketplaces.find(p=>p.id==='wb').stage,'preview');
 await assert.rejects(ws.addStore({marketplace:'amazon',name:'Amazon'}),/Invalid store/);
 await ws.repo.mutate(db=>db.stores.push({id:'bad-store',marketplace:'shopify',mode:'live'}));
 await assert.rejects(ws.synchronize('bad-store'),/marketplace_planned/);
 await assert.rejects(ws.importProduct({storeId:'bad-store',demo:true}),/marketplace_planned/);
 assert.equal(reads,0);assert.equal((await ws.repo.read()).jobs.length,0);
 const invalid=new Workspace(join(dir,'invalid.json'),{stores:[{id:'a',marketplace:'amazon',mode:'mock'}]});
 await assert.rejects(invalid.init(),/marketplace_planned/);
});

test('roadmap distinguishes implementation from configured accounts and offers no fake connection action',()=>{
 const platforms=marketplaceRegistry();platforms[0].implemented=false;
 assert.equal(marketplaceRegistry()[0].implemented,true);
 const html=marketplaceRoadmap(marketplaceRegistry(),[{marketplace:'ozon',mode:'live'},{marketplace:'ozon',mode:'mock'}]);
 assert.match(html,/已配置 API 店铺：1/);assert.match(html,/配置数量不代表连接成功/);
 for(const name of ['Amazon','Shopify','Wildberries','TikTok Shop'])assert.ok(html.includes(name));
 assert.doesNotMatch(html,/<button|<form|<input/);
 assert.match(html,/合成响应/);
});
