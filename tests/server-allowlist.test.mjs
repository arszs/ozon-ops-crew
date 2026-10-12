import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Regression guard: app.mjs imports must all be in the local server allowlist,
// otherwise the module graph fails on `npm start` while GitHub Pages keeps working.
test('every browser module imported by app.mjs is served by server.mjs',async()=>{
 const app=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const imports=[...app.matchAll(/from '\.\/([a-z-]+\.mjs)'/g)].map(m=>m[1]);
 assert.ok(imports.length>=5,'expected several module imports');
 for(const f of imports)assert.ok(server.includes(`'/${f}'`),`server allowlist missing /${f}`);
});

test('Chinese portal and all transitive browser imports are served',async()=>{
 const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
 const pending=['portal.mjs'],seen=new Set();
 while(pending.length){const f=pending.pop();if(seen.has(f))continue;seen.add(f);assert.ok(server.includes(`'/${f}'`),`missing browser dependency ${f}`);const source=await readFile(new URL('../web/'+f,import.meta.url),'utf8');for(const m of source.matchAll(/from\s+['"]\.\/([a-z-]+\.mjs)['"]/g))pending.push(m[1]);}
 assert.ok(seen.has('decisions.mjs'));assert.ok(seen.has('profit-trials.mjs'));
});
