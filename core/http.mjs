import {AdMonitor} from './ad-monitor.mjs';
import {AdReadingService,planAdRange} from './ad-reading-service.mjs';
import {ledgerTrialStatus} from './finance-reconciliation.mjs';
import {FinanceService} from './finance-service.mjs';
import {CatalogueService} from './catalogue-service.mjs';
import {WbFinanceService} from './wb-finance-service.mjs';
import {WbPriceService} from './wb-price-service.mjs';
import {WbInventoryService} from './wb-inventory-service.mjs';
import {assetPath,saveImage} from '../adapters/media.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {Workspace} from './workspace.mjs';
import {DEMO_PRODUCT} from './canonical.mjs';
const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
export async function createWorkspaceAPI(root,live){
 let config={};try{config=JSON.parse(await readFile(join(homedir(),'.config/ozon-ops-crew/connection.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const ws=new Workspace(join(root,'runtime/workspace.json'),{stores:config.stores||[],liveSnapshot:()=>live.get().data});await ws.init();
 const catalogue=new CatalogueService(join(root,'runtime/catalogue.sqlite'));
 const wbFinance=new WbFinanceService(join(root,'runtime/wb-finance.sqlite'));
 const wbPrices=new WbPriceService(join(root,'runtime/wb-prices.sqlite'),{catalogue});
 const wbInventory=new WbInventoryService(join(root,'runtime/wb-inventory.sqlite'),{catalogue});
 const advertising=new AdReadingService(join(root,'runtime/advertising.json'));await advertising.ready;
 const monitoring=new AdMonitor(join(root,'runtime/ad-monitoring.json'),{workspace:ws,advertising});await monitoring.ready;monitoring.start();
 const finance=new FinanceService(join(root,'runtime/finance.json'));await finance.ready;
 return async(req,res,url)=>{
  const parts=url.pathname.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='workspace')return false;
  res.setHeader('Content-Type','application/json');
  const send=(data,status=200)=>{res.writeHead(status);res.end(JSON.stringify(data));return true;};
  try{
   if(req.headers['sec-fetch-site']==='cross-site')return send({error:'Forbidden'},403);
   if(req.method!=='GET'&&req.headers.origin&&!['http://'+req.headers.host].includes(req.headers.origin))return send({error:'Origin rejected'},403);
   let body={};if(req.method!=='GET'){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2_000_000)return send({error:'Payload too large'},413);}body=JSON.parse(text||'{}');}
   const [, ,resource,id,action,index]=parts;
   if(req.method==='GET'){
    if(!resource){const view=await ws.view(),db=await ws.repo.read();view.catalogueStatus=Object.fromEntries(await Promise.all(view.stores.filter(s=>s.mode==='live'&&['ozon','wb'].includes(s.marketplace)).map(async s=>{try{return [s.id,await catalogue.status(ws.resolveStore(db,s.id))];}catch{return [s.id,{state:'unavailable',total:null,loaded:null,complete:false}];}})));view.wbFinance=Object.fromEntries(await Promise.all(view.stores.filter(s=>s.mode==='live'&&s.marketplace==='wb').map(async s=>{try{return [s.id,await wbFinance.get(ws.resolveStore(db,s.id))];}catch{return [s.id,{state:'unavailable',error:'WB 财务连接不可用'}];}})));view.adMonitors=await monitoring.list();view.adMonitorWorker=monitoring.status;view.adReadings=await advertising.list(view.stores.map(s=>ws.resolveStore(db,s.id)));view.financeReadings=await finance.list(view.stores.map(s=>ws.resolveStore(db,s.id)));for(const t of view.trials)if(t.source==='api_accruals_seller_costs')t.sourceStatus=ledgerTrialStatus(t,view.financeReadings,view.adReadings,view.trialPlans.find(p=>p.id===t.planId));return send(view);}
    if(resource==='assets'&&id){res.setHeader('Content-Type','image/png');res.end(await readFile(assetPath(id)));return true;}
    if(resource==='stores'&&action==='catalogue'){const store=ws.resolveStore(await ws.repo.read(),id);return send(await catalogue.query(store,{q:url.searchParams.get('q')||'',offset:Number(url.searchParams.get('offset')||0)}));}
    if(resource==='stores'&&action==='wb-characteristics')return send(await ws.wbCharacteristics(id,url.searchParams.get('subjectId')));
    if(resource==='stores'&&action==='wb-finance')return send(await wbFinance.get(ws.resolveStore(await ws.repo.read(),id),{sku:url.searchParams.get('sku')}));
    if(resource==='stores'&&action==='wb-prices')return send(await wbPrices.get(ws.resolveStore(await ws.repo.read(),id),url.searchParams.get('nmID')));
    if(resource==='stores'&&action==='wb-inventory')return send(await wbInventory.get(ws.resolveStore(await ws.repo.read(),id),url.searchParams.get('nmID')));
    if(resource==='stores'&&action==='attributes')return send(await ws.attributes(id,url.searchParams.get('categoryId'),url.searchParams.get('typeId')));
    if(resource==='stores'&&action==='values')return send(await ws.values(id,Object.fromEntries(url.searchParams)));
    if(resource==='benchmark')return send(await ws.benchmark());
    if(resource==='sample')return send(DEMO_PRODUCT);
    if(resource==='digest')return send(await ws.digest());
    if(resource==='stores'&&action==='dictionary')return send(await ws.dictionary(id,url.searchParams.get('q')||''));
    if(resource==='jobs'&&id){const job=await ws.getJob(id);if(action==='image'){
     const i=Number(index);if(![0,1].includes(i)||job.mode!=='mock'||!job.artifacts.image_edit)throw Error('Image not available');
     const source=url.searchParams.get('source')==='1',title=source?job.canonical.images[i].textZh:job.artifacts.image_edit.output.images[i].translatedText;
     res.setHeader('Content-Type','image/svg+xml');res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><rect width="900" height="1200" fill="${i?'#e6edf4':'#f0f2e8'}"/><text x="70" y="90" font-family="sans-serif" font-size="24" fill="#52655b">${source?'演示原图 · 非淘宝抓取':'DEMO · ШАБЛОН ИНФОГРАФИКИ'}</text><foreignObject x="70" y="150" width="760" height="200"><div xmlns="http://www.w3.org/1999/xhtml" style="font:700 58px sans-serif;color:#16392b;line-height:1.1">${esc(title)}</div></foreignObject><path d="M170 490 L640 440 L755 585 L280 650Z" fill="#7c9291"/><path d="M280 650 L755 585 L710 970 L295 1030Z" fill="#aebcbb"/><path d="M170 490 L280 650 L295 1030 L185 850Z" fill="#607977"/><path d="M190 485 L640 438 L700 502 L245 570Z" fill="#d3dcda"/><rect x="450" y="680" width="100" height="25" rx="12" fill="#55716d"/><text x="70" y="1125" font-family="sans-serif" font-size="26" fill="#52655b">${source?'灰色 · 聚丙烯 · 30升':'Серый · Полипропилен · 30 л'}</text></svg>`);return true;
    }return send(job);}
   }
   if(req.method==='POST'){
    if(resource==='stores'&&!id)return send(await ws.addStore(body));
    if(resource==='stores'&&action==='wb-finance-reconcile')return send(await wbFinance.reconcile(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-finance')return send(await wbFinance.start(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-prices')return send(await wbPrices.refresh(ws.resolveStore(await ws.repo.read(),id),body.nmID));
    if(resource==='stores'&&action==='wb-inventory')return send(await wbInventory.start(ws.resolveStore(await ws.repo.read(),id),body.nmID,{restart:body.restart===true}));
    if(resource==='stores'&&action==='catalogue'){const store=ws.resolveStore(await ws.repo.read(),id);return send(await catalogue.start(store,{restart:body.restart===true}));}
    if(resource==='stores'&&action==='finance'){const store=ws.resolveStore(await ws.repo.read(),id);return send(await finance.start(store,body));}
    if(resource==='stores'&&action==='finance-reconcile'){const store=ws.resolveStore(await ws.repo.read(),id);return send(await finance.reconcile(store,body.runId,body));}
    if(resource==='stores'&&action==='sync'){const store=ws.resolveStore(await ws.repo.read(),id);return send(store.mode==='live'&&store.marketplace==='wb'?await catalogue.start(store):await ws.synchronize(id));}
    if(resource==='stores'&&action==='reviews')return send(await ws.syncMessages(id));
    if(resource==='stores'&&action==='demo-review')return send(await ws.demoReview(id));
    if(resource==='jobs'&&!id)return send(await ws.importProduct(body));
    if(resource==='jobs'&&action==='step')return send(await ws.step(id));
    if(resource==='jobs'&&action==='retry')return send(await ws.retry(id,body.stage));
    if(resource==='jobs'&&action==='setup')return send(await ws.setup(id,body));
    if(resource==='assets'&&!id){if(typeof body.base64!=='string'||body.base64.length>1_800_000)throw Error('Image too large (max 1.3 MB)');return send(await saveImage(Buffer.from(body.base64,'base64')));}
    if(resource==='jobs'&&action==='edit')return send(await ws.edit(id,body));
    if(resource==='jobs'&&action==='category-approval')return send(await ws.approveCategory(id,body.revision));
    if(resource==='jobs'&&action==='publish-plan')return send(await ws.preparePublish(id));
    if(resource==='jobs'&&action==='sync')return send(await ws.syncPublished(id));
    if(resource==='operations'&&!id)return send(await ws.planOperation(body));
    if(resource==='operations'&&action==='approve')return send(await ws.approveOperation(id,body.payloadHash));
    if(resource==='operations'&&action==='execute')return send(await ws.executeOperation(id));
    if(resource==='reviews'&&action==='draft')return send(await ws.draftMessage(id));
    if(resource==='cost-profiles'&&!id)return send(await ws.saveCosts(body));
    if(resource==='trial-plans'&&!id)return send(await ws.planTrial(body,{finance,advertising}));
    if(resource==='trial-plans'&&action==='ad-monitor')return send(await monitoring.configure(id,body.enabled));
    if(resource==='trial-plans'&&action==='ad-read'){const db=await ws.repo.read(),plan=db.trialPlans?.find(p=>p.id===id);if(!plan)throw Error('Plan not found');return send(await advertising.start(ws.resolveStore(db,plan.storeId),{...planAdRange(plan,body.period),refresh:body.refresh===true}));}
    if(resource==='trial-plans'&&action==='ledger-result')return send(await ws.recordLedgerTrial(id,body,finance,advertising));
    if(resource==='trial-plans'&&action==='cpo-check')return send(await ws.inspectTrialCpo(id));
    if(resource==='trial-plans'&&action==='cpo-operation')return send(await ws.prepareTrialCpo(id,{phase:body.phase||'test'}));
    if(resource==='operations'&&action==='cpo-status')return send(await ws.reconcileCpo(id));
    if(resource==='trial-plans'&&action==='price-operation')return send(await ws.prepareTrialPrice(id));
    if(resource==='operations'&&action==='price-status')return send(await ws.reconcilePrice(id));
    if(resource==='trial-plans'&&action==='cancel')return send(await ws.cancelTrialPlan(id));
    if(resource==='trials'&&!id)return send(await ws.recordTrial(body));
    if(resource==='assessments')return send(await ws.assessment(body));
   }
   return send({error:'Not found'},404);
  }catch(e){return send({error:String(e.message).slice(0,500)},400);}
 };
}
