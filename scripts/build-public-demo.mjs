import {mkdir,copyFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),dest=join(root,'public-demo');
await rm(dest,{recursive:true,force:true});
await mkdir(dest,{recursive:true});
// Explicit public assets only: never publish local workspace state, credentials or private API UI.
for(const file of ['demo-zh.html','demo-zh.mjs','demo-profit.mjs','demo-zh.css','mark.svg','aigc-before.png','aigc-after.png','xds-brief.zh.txt'])await copyFile(join(root,'web',file),join(dest,file));
await copyFile(join(root,'web/demo-zh.html'),join(dest,'index.html'));
console.log('Chinese AIGC demo packaged in public-demo');
