import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importSavedPage} from '../core/page-import.mjs';

const args=process.argv.slice(2),file=args.find(v=>!v.startsWith('--'));
const option=name=>{const at=args.indexOf(name);return at>=0?args[at+1]:undefined;};
if(!file){console.error('Usage: node scripts/import-page.mjs saved.html --source-url https://item.taobao.com/item.htm?id=… [--fallback review] [--out /private/output]');process.exitCode=1;}
else{
 const root=dirname(dirname(fileURLToPath(import.meta.url)));
 const out=resolve(option('--out')||join(root,'runtime','page-import'));
 try{
  const html=await readFile(resolve(file),'utf8');let result;
  if(option('--store')){
   const port=Number(option('--port')||4173);if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('Invalid local server port');
   const url=new URL(`http://127.0.0.1:${port}/api/workspace/page-imports`);url.searchParams.set('storeId',option('--store'));if(option('--source-url'))url.searchParams.set('sourceUrl',option('--source-url'));
   if(args.includes('--source-image-rights-confirmed'))url.searchParams.set('sourceImageRightsConfirmed','true');
   const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'text/html'},body:html,signal:AbortSignal.timeout(600000)});
   if(!response.ok)throw Error('Workspace page import failed');result=await response.json();
  }else result=await importSavedPage(html,{sourceUrl:option('--source-url'),fallback:option('--fallback')||'codex'});
  await mkdir(out,{recursive:true,mode:0o700});
  const report=join(out,'report.json');await writeFile(report,JSON.stringify(result,null,2),{mode:0o600});
  if(result.product)await writeFile(join(out,'product.json'),JSON.stringify(result.product,null,2),{mode:0o600});
  await writeFile(join(out,'review-packet.json'),JSON.stringify(result.reviewPacket,null,2),{mode:0o600});
  const jobId=result.job?.id||null;
  console.log(JSON.stringify({state:result.state,provider:result.attempts.at(-1)?.provider,issues:result.issues||[],images:result.product?.images.length||0,jobId,report},null,2));
  if(result.state!=='ready')process.exitCode=2;
 }catch{console.error('Page import failed. Check the source URL, HTML file, local Ollama or Codex login. No product was published.');process.exitCode=1;}
}
