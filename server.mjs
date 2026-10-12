import {createWorkspaceAPI} from './core/http.mjs';
import {loadConnection} from './connection.mjs';
import {createLiveService} from './live-service.mjs';
import {campaigns,performanceConfigured} from './performance.mjs';
import http from 'node:http';
import {catalog,credentials} from './ozon.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaults,validatePolicy} from './web/engine.mjs';
const root=fileURLToPath(new URL('.',import.meta.url)); const port=Number(process.env.PORT||4173);
await mkdir(join(root,'runtime'),{recursive:true});
await loadConnection();
const live=await createLiveService(root);
const workspaceAPI=await createWorkspaceAPI(root,live);
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'); const path=url.pathname;
  if(req.headers.host && !['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);res.end();return;}
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  if(await workspaceAPI(req,res,url))return;
  if(path==='/api/live' && req.method==='GET'){if(req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(live.get(url.searchParams.get('refresh')==='1')));return;}
  if(path==='/api/campaigns' && req.method==='GET'){res.setHeader('Content-Type','application/json');try{res.end(JSON.stringify(await campaigns()));}catch(err){res.writeHead(502);res.end(JSON.stringify({error:err.message}));}return;}
  if(path==='/api/catalog' && req.method==='GET'){res.setHeader('Content-Type','application/json');try{res.end(JSON.stringify(await catalog(url.searchParams.get('cursor')||'')));}catch(err){res.writeHead(502);res.end(JSON.stringify({error:err.message}));}return;}
  if(path==='/api/policy'){
   res.setHeader('Content-Type','application/json');
   if(req.method==='GET'){try{res.end(await readFile(join(root,'runtime/policy.json')));}catch{res.end(JSON.stringify(defaults));}return;}
   if(req.method==='POST'){
    if(req.headers.origin && !['http://localhost:'+port,'http://127.0.0.1:'+port].includes(req.headers.origin)){res.writeHead(403);res.end('{}');return;}
    let body=''; for await(const chunk of req){body+=chunk;if(body.length>8192){res.writeHead(413);res.end();return;}}
    const p=validatePolicy(JSON.parse(body));await writeFile(join(root,'runtime/policy.json'),JSON.stringify(p,null,2));res.end(JSON.stringify(p));return;
   }
  }
  if(path==='/api/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({mode:'live',sellerConfigured:Boolean((await credentials()).key),performanceConfigured:await performanceConfigured(),externalWritesEnabled:true,externalWriteScope:['ozon.product.create.human-gated','ozon.price.trial.human-gated','ozon.cpo.disable.trial.human-gated','ozon.cpo.enable.trial.human-gated'],autopilotWritesEnabled:false}));return;}
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  const allowed=['/','/index.html','/style.css','/app.mjs','/engine.mjs','/demo.mjs','/mark.svg','/planning.mjs','/autopilot.mjs','/ad-optimizer.mjs','/stress.mjs','/experiments.mjs','/live-dashboard.mjs','/portal.mjs','/store-home.mjs','/sync-status.mjs','/profit-trials.mjs','/repeat-trials.mjs','/experiment-progress.mjs','/experiment-ads.mjs','/cpo-controls.mjs','/sku-economy.mjs','/sku-focus.mjs','/wb-finance.mjs','/wb-prices.mjs','/wb-inventory.mjs','/ad-coverage.mjs','/finance-ledger.mjs','/finance-costs.mjs','/catalogue.mjs','/decisions.mjs','/assortment.mjs','/form-state.mjs','/sku-costs.mjs','/migration-setup.mjs','/portal.css','/legacy.html'];
  if(!allowed.includes(path)){res.writeHead(404);res.end('Not found');return;}
  const f=path==='/'?'index.html':path.slice(1);res.setHeader('Content-Type',types[extname(f)]||'text/plain');res.end(await readFile(join(root,'web',f)));
 }catch(err){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Invalid request or configuration'}));}
}).listen(port,'127.0.0.1',()=>console.log(`Ozon Ops Crew: http://127.0.0.1:${port}`));
