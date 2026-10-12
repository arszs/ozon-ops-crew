import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveService,usableSnapshot} from '../live-service.mjs';
import {lastCompleteWeek} from '../live-data.mjs';
const good=()=>({mode:'live',sources:{analytics:{ok:true}},period:lastCompleteWeek(),rows:[{sku:'test'}],fetchedAt:new Date().toISOString()});
const failed=()=>({...good(),rows:[],sources:{analytics:{ok:false},finance:{ok:false},catalog:{ok:false},campaigns:{ok:false},products:{ok:true}}});
async function settled(service){for(let i=0;i<100;i++){const v=service.get();if(v.state!=='syncing')return v;await new Promise(r=>setTimeout(r,5));}throw Error('refresh timeout');}
test('enrichment-only success cannot validate a failed snapshot; valid empty store can',()=>{assert.equal(usableSnapshot(failed()),false);assert.equal(usableSnapshot({...good(),rows:[]}),true);});
test('failed refresh retains usable in-memory and on-disk data, including after reopening',async()=>{const root=await mkdtemp(join(tmpdir(),'ops-cache-'));try{await mkdir(join(root,'runtime'));let fail=false;const options={getCredentials:async()=>({client:'test',key:'test'}),sync:async()=>fail?failed():good()};const s=await createLiveService(root,options);s.get(true);assert.equal((await settled(s)).state,'ready');const before=await readFile(join(root,'runtime/live-cache.json'),'utf8');fail=true;s.get(true);const result=await settled(s);assert.equal(result.state,'error');assert.equal(result.error,'all_sources_unavailable');assert.equal(result.data.rows[0].sku,'test');assert.equal(await readFile(join(root,'runtime/live-cache.json'),'utf8'),before);const reopened=await createLiveService(root,options);assert.equal(reopened.get().data.rows[0].sku,'test');}finally{await rm(root,{recursive:true,force:true});}});
test('failed initial synchronization stays unavailable rather than showing a successful empty store',async()=>{const root=await mkdtemp(join(tmpdir(),'ops-cache-'));try{const s=await createLiveService(root,{getCredentials:async()=>({}),sync:async()=>failed()});s.get();const v=await settled(s);assert.equal(v.state,'error');assert.equal(v.data,null);}finally{await rm(root,{recursive:true,force:true});}});
