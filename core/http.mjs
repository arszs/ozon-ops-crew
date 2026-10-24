import {StrategyDemoService} from './strategy-demo.mjs';
import {completedStrategyPriceTrials} from './strategy-trials.mjs';
import {StrategyService} from './strategy-service.mjs';
import {OzonStrategyAdapter} from '../adapters/ozon-strategy.mjs';
import {OzonReviewAgent} from '../adapters/ozon-review-agent.mjs';
import {startCreative,retryCreative,cancelCreative,creativeViews,attachCreativeImage,approveCreative} from './review-creatives.mjs';
import {workspaceBody} from './request-body.mjs';
import {hash} from './repository.mjs';
import {prepareWbTrialPrice,inspectWbTrialPrice} from './wb-price-trial.mjs';
import {WbTrialService} from './wb-trials.mjs';
import {WbListingErrorService} from './wb-listing-error-service.mjs';
import {wbAccount} from '../adapters/wb-api.mjs';
import {WbAdvertisingService} from './wb-advertising-service.mjs';
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
import {ProductStudio} from './product-studio.mjs';
import {DEMO_PRODUCT} from './canonical.mjs';
const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
export const wbStoredReportQuery=url=>Object.fromEntries(['sku','from','to'].map(key=>[key,url.searchParams.get(key)]));
export async function createWorkspaceAPI(root,live){
 let config={};try{config=JSON.parse(await readFile(join(homedir(),'.config/ozon-ops-crew/connection.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const ws=new Workspace(join(root,'runtime/workspace.json'),{stores:config.stores||[],liveSnapshot:()=>live.get().data});await ws.init();
 const studio=new ProductStudio(ws);await studio.init();
 const catalogue=new CatalogueService(join(root,'runtime/catalogue.sqlite'));
 ws.wbPriceProduct=async(store,nmID)=>{const owner=await wbAccount(store);try{return await catalogue.product(store,String(nmID),owner);}catch(e){const db=await ws.repo.read(),job=db.jobs.find(j=>j.storeId===store.id&&j.state==='imported'&&String(j.importResult?.productId)===String(nmID)),op=job&&db.operations.findLast(o=>o.kind==='publish'&&o.payload.jobId===job.id&&o.state==='verified');if(!job||op?.payload.wbContext?.accountRef!==owner)throw e;return {sku:String(nmID),offerId:job.canonical.sku};}};
 ws.wbStockProduct=ws.wbPriceProduct;
 const wbListingErrors=new WbListingErrorService(join(root,'runtime/wb-listing-errors.json'));await wbListingErrors.ready;
 const wbAds=new WbAdvertisingService(join(root,'runtime/wb-advertising.sqlite'));
 const wbFinance=new WbFinanceService(join(root,'runtime/wb-finance.sqlite'));
 const wbTrials=new WbTrialService(ws,wbFinance,wbAds);
 const wbPrices=new WbPriceService(join(root,'runtime/wb-prices.sqlite'),{catalogue});
 const wbInventory=new WbInventoryService(join(root,'runtime/wb-inventory.sqlite'),{catalogue});
 const advertising=new AdReadingService(join(root,'runtime/advertising.json'));await advertising.ready;
 const monitoring=new AdMonitor(join(root,'runtime/ad-monitoring.json'),{workspace:ws,advertising});await monitoring.ready;monitoring.start();
 const finance=new FinanceService(join(root,'runtime/finance.json'));await finance.ready;
 const strategyAdapter=new OzonStrategyAdapter({reviews:new OzonReviewAgent(),financial:store=>finance.list([store]),trialReader:async(store,policy)=>{const [db,readings,ads]=await Promise.all([ws.repo.read(),finance.list([store]),advertising.list([store])]);return completedStrategyPriceTrials(db,policy,{finance:readings,advertising:ads});},verifiedLive:(force=false)=>live.verified(force),live:()=>live.get().data});
 const agentDemo=new StrategyDemoService(join(root,'runtime/agent-demo.json'));await agentDemo.ready;
 const strategies=new StrategyService(join(root,'runtime/strategies.json'),{workspace:ws,adapter:strategyAdapter,finance});await strategies.ready;strategies.start();
 return async(req,res,url)=>{
  const parts=url.pathname.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='workspace')return false;
  res.setHeader('Content-Type','application/json');
  const send=(data,status=200)=>{res.writeHead(status);res.end(JSON.stringify(data));return true;};
  try{
   if(req.headers['sec-fetch-site']==='cross-site')return send({error:'Forbidden'},403);
   if(req.method!=='GET'&&req.headers.origin&&!['http://'+req.headers.host].includes(req.headers.origin))return send({error:'Origin rejected'},403);
   const [, ,resource,id,action,index]=parts;
   const body=await workspaceBody(req,{resource,id,action});
   if(resource==='agent-demo'){
    if(req.method==='GET'&&!id)return send(await agentDemo.view());
    if(req.method==='GET'&&id==='finance')return send(await agentDemo.financialView(url.searchParams.get('storeId'),url.searchParams.get('sku')));
    if(req.method==='GET'&&id==='campaigns')return send(await agentDemo.campaignChoices(url.searchParams.get('storeId'),url.searchParams.get('sku')));
    if(req.method==='POST'){
     if(id==='preview')return send(strategies.preview(body));if(id==='policies')return send(await agentDemo.configure(body));if(id==='pause')return send(await agentDemo.pause(body.paused));if(id==='pause-policy')return send(await agentDemo.pausePolicy(body.policyId));if(id==='acknowledge')return send(await agentDemo.acknowledge(body.ids));
     if(id==='run'){agentDemo.tick().catch(()=>{});return send({started:true,simulation:true});}if(id==='refresh')return send(await agentDemo.view());if(id==='scenario'){await agentDemo.scenario(body.scenario);return send(await agentDemo.view());}if(id==='reset'){await agentDemo.reset();return send(await agentDemo.view());}
     if(id==='reconcile')return send(await agentDemo.reconcile(body.actionId));if(id==='reconcile-review')return send(await agentDemo.reconcileReview(body.reviewId));if(id==='finance-read')return send(await agentDemo.financialRead(body));if(id==='finance-reconcile')return send(await agentDemo.financialReconcile(body));
    }return send({error:'demo_method_not_supported'},404);
   }
   if(req.method==='GET'){
    if(resource==='agents'&&id==='finance')return send(await strategies.financialView(url.searchParams.get('storeId'),url.searchParams.get('sku')));
    if(resource==='agents'&&id==='campaigns')return send(await strategies.campaignChoices(url.searchParams.get('storeId'),url.searchParams.get('sku')));
    if(resource==='agents'&&!id)return send(await strategies.view());
    if(resource==='studio')return send(id?await studio.refresh(id):await studio.list());
    if(!resource){const view=await ws.view(),db=await ws.repo.read();view.catalogueStatus=Object.fromEntries(await Promise.all(view.stores.filter(s=>s.mode==='live'&&['ozon','wb'].includes(s.marketplace)).map(async s=>{try{return [s.id,await catalogue.status(ws.resolveStore(db,s.id))];}catch{return [s.id,{state:'unavailable',total:null,loaded:null,complete:false}];}})));view.wbFinance=Object.fromEntries(await Promise.all(view.stores.filter(s=>s.mode==='live'&&s.marketplace==='wb').map(async s=>{try{return [s.id,await wbFinance.get(ws.resolveStore(db,s.id))];}catch{return [s.id,{state:'unavailable',error:'WB 财务连接不可用'}];}})));view.wbAds=Object.fromEntries(await Promise.all(view.stores.filter(s=>s.mode==='live'&&s.marketplace==='wb').map(async s=>{try{return [s.id,await wbAds.get(ws.resolveStore(db,s.id))];}catch{return [s.id,{state:'unavailable',error:'WB 广告连接不可用'}];}})));view.adMonitors=await monitoring.list();view.adMonitorWorker=monitoring.status;view.adReadings=await advertising.list(view.stores.map(s=>ws.resolveStore(db,s.id)));view.financeReadings=await finance.list(view.stores.map(s=>ws.resolveStore(db,s.id)));for(const t of view.trials)if(t.source==='api_accruals_seller_costs')t.sourceStatus=ledgerTrialStatus(t,view.financeReadings,view.adReadings,view.trialPlans.find(p=>p.id===t.planId));for(const t of view.trials)if(t.source==='wb_reports_seller_costs'){try{t.sourceStatus=await wbTrials.status(ws.resolveStore(db,t.storeId),db.trialPlans?.find(p=>p.id===t.planId),t);}catch{t.sourceStatus='unavailable';}}return send(view);}
    if(resource==='trial-plans'&&action==='wb-evidence')return send(await wbTrials.get(id));
    if(resource==='creatives'&&!id)return send(creativeViews(await ws.repo.read()));
    if(resource==='assets'&&id){res.setHeader('Content-Type','image/png');res.end(await readFile(assetPath(id)));return true;}
    if(resource==='stores'&&action==='wb-economics')return send(await wbFinance.skuCosts.query(ws.resolveStore(await ws.repo.read(),id),Object.fromEntries(url.searchParams)));
    if(resource==='stores'&&action==='catalogue'){const store=ws.resolveStore(await ws.repo.read(),id);return send(await catalogue.query(store,{q:url.searchParams.get('q')||'',offset:Number(url.searchParams.get('offset')||0)}));}
    if(resource==='stores'&&action==='wb-characteristics')return send(await ws.wbCharacteristics(id,url.searchParams.get('subjectId'),url.searchParams.get('locale')||'zh'));
    if(resource==='stores'&&action==='wb-ads')return send(await wbAds.get(ws.resolveStore(await ws.repo.read(),id),wbStoredReportQuery(url)));
    if(resource==='stores'&&action==='wb-finance')return send(await wbFinance.get(ws.resolveStore(await ws.repo.read(),id),wbStoredReportQuery(url)));
    if(resource==='stores'&&action==='wb-prices')return send(await wbPrices.get(ws.resolveStore(await ws.repo.read(),id),url.searchParams.get('nmID')));
    if(resource==='stores'&&action==='wb-listing-errors')return send(await wbListingErrors.get(ws.resolveStore(await ws.repo.read(),id),{vendorCode:url.searchParams.get('vendorCode')}));
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
    }if(job.marketplace==='wb'&&job.mode==='manual'){try{job.wbListingErrors=await wbListingErrors.get(ws.resolveStore(await ws.repo.read(),job.storeId),{vendorCode:job.canonical.sku});}catch{job.wbListingErrors={state:'unavailable',error:'WB 草稿错误连接不可用'};}}return send(job);}
   }
   if(req.method==='POST'){
    if(resource==='agents'&&id==='finance-read')return send(await strategies.financialRead(body));
    if(resource==='agents'&&id==='finance-reconcile')return send(await strategies.financialReconcile(body));
    if(resource==='agents'&&id==='preview')return send(strategies.preview(body));
    if(resource==='agents'&&id==='policies'&&!action)return send(await strategies.configure(body));
    if(resource==='agents'&&id==='pause-policy')return send(await strategies.pausePolicy(body.policyId));
    if(resource==='agents'&&id==='pause')return send(await strategies.pause(body.paused));
    if(resource==='agents'&&id==='acknowledge')return send(await strategies.acknowledge(body.ids));
    if(resource==='agents'&&id==='refresh'){await strategies.refreshStore(body.storeId,{forceMetrics:true});return send(await strategies.view());}
    if(resource==='agents'&&id==='run'){strategies.tick({force:true}).catch(()=>{});return send({started:true});}
    if(resource==='agents'&&id==='reconcile-review')return send(await strategies.reconcileReview(body.reviewId));
    if(resource==='agents'&&id==='reconcile')return send(await strategies.reconcile(body.actionId));
    if(resource==='studio'&&action==='repair-content')return send(await studio.repairContent(id));
    if(resource==='studio'&&action==='repair-manufacturer')return send(await studio.repairManufacturer(id));
    if(resource==='studio'&&action==='document-facts')return send(await studio.documentFacts(id,body));
    if(resource==='studio'&&action==='redesign')return send(await studio.redesign(id,body));
    if(resource==='studio'&&action==='recheck-sources')return send(await studio.recheckResearch(id));
    if(resource==='studio'&&action==='reprice')return send(await studio.reprice(id,body));
    if(resource==='studio'&&action==='publish')return send(await studio.publish(id,body));
    if(resource==='studio'&&action==='retry')return send(await studio.retry(id));
    if(resource==='studio-imports')return send(await studio.start({...body,...Object.fromEntries(url.searchParams)}));
    if(resource==='connections'&&id==='ozon')return send(await ws.connectOzon(body));
    if(resource==='jobs'&&action==='source-images')return send(await ws.keepSourceImages(id));
    if(resource==='page-imports'&&!id)return send(await ws.importPage({html:body.html,storeId:url.searchParams.get('storeId'),sourceUrl:url.searchParams.get('sourceUrl')||undefined,sourceImageRightsConfirmed:url.searchParams.get('sourceImageRightsConfirmed')==='true'}));
    if(resource==='stores'&&!id)return send(await ws.addStore(body));
    if(resource==='stores'&&action==='wb-finance-reconcile')return send(await wbFinance.reconcile(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-allocation-preview')return send(await wbFinance.skuCosts.preview(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-allocation-confirm')return send(await wbFinance.skuCosts.allocate(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&['wb-cost-template','wb-cost-preview','wb-cost-confirm'].includes(action))return send(await wbFinance.bulkCosts[{'wb-cost-template':'template','wb-cost-preview':'preview','wb-cost-confirm':'confirm'}[action]](ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-sku-reconcile')return send(await wbFinance.skuCosts.reconcile(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-ads')return send(await wbAds.start(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-ads-pause')return send(await wbAds.pause(ws.resolveStore(await ws.repo.read(),id)));
    if(resource==='stores'&&action==='wb-finance')return send(await wbFinance.start(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-stock-warehouses')return send(await ws.inspectWbStockWarehouses(id));
    if(resource==='stores'&&action==='wb-stock-context')return send(await ws.inspectWbStock(id,body.nmID,body.warehouseId));
    if(resource==='stores'&&action==='wb-stock-plan')return send(await ws.prepareWbStock(id,body));
    if(resource==='operations'&&action==='wb-stock-status')return send(await ws.reconcileWbStock(id));
    if(resource==='operations'&&action==='wb-stock-confirm')return send(await ws.confirmWbStock(id,body));
    if(resource==='stores'&&action==='price-conditions')return send(await ws.inspectPriceConditions(id,body.sku));
    if(resource==='stores'&&action==='wb-price-context')return send(await ws.inspectWbPrice(id,body.nmID));
    if(resource==='stores'&&action==='wb-price-trial-context'){const context=await ws.inspectWbPrice(id,body.nmID);return send({context,hash:hash(context)});}
    if(resource==='stores'&&action==='wb-price-plan')return send(await ws.prepareWbPrice(id,body));
    if(resource==='operations'&&action==='wb-price-status')return send(await ws.reconcileWbPrice(id));
    if(resource==='stores'&&action==='wb-prices')return send(await wbPrices.refresh(ws.resolveStore(await ws.repo.read(),id),body.nmID));
    if(resource==='stores'&&action==='wb-listing-errors')return send(await wbListingErrors.start(ws.resolveStore(await ws.repo.read(),id),body));
    if(resource==='stores'&&action==='wb-listing-errors-pause')return send(await wbListingErrors.pause(ws.resolveStore(await ws.repo.read(),id)));
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
    if(resource==='jobs'&&action==='edit-listing')return send(await ws.editOzonListing(id,body.kind,body));
    if(resource==='jobs'&&action==='inspect-listing')return send(await ws.inspectOzonListing(id));
    if(resource==='jobs'&&action==='host-images')return send(await ws.hostOzonImages(id));
    if(resource==='jobs'&&action==='repair-images')return send(await ws.repairOzonImages(id));
    if(resource==='jobs'&&action==='ogl-price')return send(await ws.priceOgl(id,body));
    if(resource==='jobs'&&action==='landed-price')return send(await ws.priceLanded(id,body));
    if(resource==='assets'&&!id){if(Buffer.isBuffer(body.imageBytes))return send(await saveImage(body.imageBytes));if(typeof body.base64!=='string'||body.base64.length>1_800_000)throw Error('旧版 base64 上传最多 1.3 MB；请使用图片文件上传（最多 12 MB）');return send(await saveImage(Buffer.from(body.base64,'base64')));}
    if(resource==='jobs'&&action==='edit')return send(await ws.edit(id,body));
    if(resource==='jobs'&&action==='category-approval')return send(await ws.approveCategory(id,body.revision));
    if(resource==='jobs'&&action==='wb-media-plan')return send(await ws.prepareWbMedia(id));
    if(resource==='operations'&&action==='wb-media-status')return send(await ws.readWbMediaResult(id));
    if(resource==='operations'&&action==='wb-media-confirm')return send(await ws.confirmWbMediaResult(id,body));
    if(resource==='jobs'&&action==='publish-plan')return send(await ws.preparePublish(id));
    if(resource==='jobs'&&action==='sync')return send(await ws.syncPublished(id));
    if(resource==='operations'&&!id)return send(await ws.planOperation(body));
    if(resource==='operations'&&action==='approve')return send(await ws.approveOperation(id,body.payloadHash));
    if(resource==='operations'&&action==='execute')return send(await ws.executeOperation(id));
    if(resource==='creatives'&&!id)return send(await startCreative(ws,body),202);
    if(resource==='creatives'&&action==='cancel')return send(await cancelCreative(ws,id));
    if(resource==='creatives'&&action==='retry')return send(await retryCreative(ws,id,body),202);
    if(resource==='creatives'&&action==='image')return send(await attachCreativeImage(ws,id,body));
    if(resource==='creatives'&&action==='approve')return send(await approveCreative(ws,id,body));
    if(resource==='reviews'&&action==='draft')return send(await ws.draftMessage(id));
    if(resource==='cost-profiles'&&!id)return send(await ws.saveCosts(body));
    if(resource==='trial-plans'&&!id)return send(await ws.planTrial(body,{finance,advertising,wbTrials}));
    if(resource==='trial-plans'&&action==='ad-monitor')return send(await monitoring.configure(id,body.enabled));
    if(resource==='trial-plans'&&action==='ad-read'){const db=await ws.repo.read(),plan=db.trialPlans?.find(p=>p.id===id);if(!plan)throw Error('Plan not found');return send(await advertising.start(ws.resolveStore(db,plan.storeId),{...planAdRange(plan,body.period),refresh:body.refresh===true}));}
    if(resource==='trial-plans'&&action==='wb-price-check')return send(await inspectWbTrialPrice(ws,id));
    if(resource==='trial-plans'&&action==='wb-price-operation')return send(await prepareWbTrialPrice(ws,id,body));
    if(resource==='trial-plans'&&action==='wb-read')return send(await wbTrials.read(id,body));
    if(resource==='trial-plans'&&action==='wb-result')return send(await wbTrials.save(id,body));
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
  }catch(e){return send({error:String(e.message).slice(0,500)},e.status===413?413:400);}
 };
}
