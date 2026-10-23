import {ozonCall} from './ozon-products.mjs';
import {priceAccount,readPrice} from './ozon-prices.mjs';
import {readOzonCatalogue,catalogueProduct} from './ozon-catalogue.mjs';
import {readCpo,submitCpoDisable} from './ozon-cpo.mjs';
import {readAdvertisingSlice} from './ozon-ad-readings.mjs';
import {hash} from '../core/repository.mjs';
import {decideStrategy} from '../core/product-strategies.mjs';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const num=v=>['string','number'].includes(typeof v)&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const safeId=v=>(typeof v==='string'||Number.isSafeInteger(v))&&/^[1-9]\d*$/.test(String(v))?String(v):null;
export class OzonStrategyAdapter{
 constructor({call=ozonCall,account=priceAccount,price=readPrice,catalogue=readOzonCatalogue,cpo=readCpo,ads=readAdvertisingSlice,disable=submitCpoDisable,reviews=null,live=()=>null}={}){Object.assign(this,{call,account,price,catalogue,cpo,ads,disable,reviews,live});}
 async verifyProduct(store,sku){const c=await this.price(store,sku);return {sku:c.sku,productId:c.productId,offerId:c.offerId,currency:c.currency,price:c.price};}
 async overview(store){const c=await this.catalogue(store),snapshot=store.id==='ozon-live'?this.live():null;const bySku=new Map((snapshot?.rows||[]).map(r=>[r.sku,r]));const products=c.products.filter(p=>p.sku).map(p=>{const row=bySku.get(p.sku),metrics={period:snapshot?.period||null,orderedUnits:snapshot?.sources?.analytics?.ok&&snapshot.analyticsComplete&&row?row.orderedUnits:null,orderedAmount:snapshot?.sources?.analytics?.ok&&snapshot.analyticsComplete&&row?row.orderRevenue:null,orderCurrency:'RUB',netAccrued:row?.netAccrued||null,adSpendRub:row?.adSpend??null,adSpendComplete:false,confirmedProfit:null,profitComplete:false};return {...p,metrics,buyerUrl:'https://www.ozon.ru/product/'+p.sku+'/'};});
  return {products,catalogueComplete:c.catalogueComplete,source:c.source,period:snapshot?.period||null,metricsAt:snapshot?.fetchedAt||null,profit:null,profitComplete:false,unmatchedAdvertisingProducts:(snapshot?.rows||[]).filter(r=>!products.some(p=>p.sku===r.sku)&&r.strategies?.length).length};
 }
 publicObservation(o){const {accountRef,priceContext,cpoContext,...v}=o;return v;}
 async observe(store,policy){const accountRef=await this.account(store),c=await this.price(store,policy.sku);if(c.accountRef!==accountRef)throw Error('strategy_account_changed');const details=await this.call(store,'/v3/product/info/list',{sku:[policy.sku]});if(!Array.isArray(details.items)||details.items.length!==1)throw Error('strategy_identity_mismatch');const raw=details.items[0],row=catalogueProduct(raw).find(p=>p.sku===policy.sku&&p.productId===c.productId&&p.offerId===c.offerId);if(!row)throw Error('strategy_identity_mismatch');
  const stocks=raw.stocks?.stocks?.filter(s=>String(s.sku)===policy.sku)||[],available=stocks.map(s=>num(s.present)!==null&&num(s.reserved)!==null?Math.max(0,num(s.present)-num(s.reserved)):null);const stock=available.length&&available.every(v=>v!==null)?available.reduce((a,b)=>a+b,0):null;
  const o={storeId:store.id,sku:policy.sku,productId:c.productId,offerId:c.offerId,name:c.name,currency:c.currency,price:c.price,stock,accountRef,checkedAt:new Date().toISOString(),autoPromotions:c.autoApply===false&&c.autoAdd===false?false:c.autoApply===true||c.autoAdd===true?true:null,marketingPrice:c.marketingPrice,priceContext:c,ads:null,promotions:null,metrics:null,canTestDemand:policy.strategy==='launch',capabilities:{price:'available',ads:'not_checked',promotions:'not_checked',reviews:'not_checked'},warnings:[]};
  if(policy.allowAds){try{const state=await this.cpo(store,policy.sku),date=today(),report=await this.ads(store,{sku:policy.sku,from:date,to:date});o.cpoContext=state;o.ads={enabled:state.enabled,instrument:'CPO',currency:'RUB',spentToday:report.cpo.ok?report.cpo.spend:null,complete:report.cpo.ok===true&&num(report.cpo.spend)!==null,platformCapVerified:false,platformDailyCap:null,reportAt:report.checkedAt,scope:'selected_product_cpo'};o.capabilities.ads='cpo_pause_only';}catch{o.capabilities.ads='unavailable';o.warnings.push('ads_connection_unavailable');}}
  if(policy.allowPromotions){try{o.promotions=await this.promotions(store,o);o.capabilities.promotions='available';}catch{o.capabilities.promotions='unavailable';o.warnings.push('promotions_unavailable');}}
  return o;
 }
 async promotions(store,o){const d=await this.call(store,'/v1/actions',undefined,{method:'GET'});if(!Array.isArray(d.result))throw Error('strategy_promotion_schema');const offers=[];for(const action of d.result.slice(0,20)){const id=safeId(action.id);if(!id)continue;const end=Date.parse(action.date_end),start=Date.parse(action.date_start);if(!Number.isFinite(end)||!Number.isFinite(start)||start>Date.now()||end<Date.now())continue;
   let offset=0;for(let page=0;page<10;page++){const r=await this.call(store,'/v1/actions/candidates',{action_id:Number(id),limit:100,offset});if(!Array.isArray(r.result?.products)||num(r.result?.total)===null)throw Error('strategy_promotion_schema');const candidate=r.result.products.find(p=>String(p.id??p.product_id)===o.productId);if(candidate){const price=num(candidate.action_price)>0?num(candidate.action_price):num(candidate.max_action_price),currency=candidate.currency_code||candidate.currency||action.currency_code||null;offers.push({id,productId:o.productId,title:String(action.title||''),price,currency,eligible:price!==null&&price>0&&['RUB','CNY'].includes(currency),joined:candidate.add_mode==='SELLER'||candidate.add_mode==='AUTO',endsAt:action.date_end,stock:num(candidate.stock),source:'Ozon actions/candidates'});break;}offset+=r.result.products.length;if(offset>=Number(r.result.total)||!r.result.products.length)break;}
  }return offers;
 }
 async prepare(store,policy,old,action){try{const fresh=await this.observe(store,policy);if(fresh.accountRef!==old.accountRef||fresh.productId!==old.productId||fresh.offerId!==old.offerId||fresh.currency!==old.currency||fresh.priceContext.fingerprint!==old.priceContext.fingerprint)throw Error('strategy_context_changed');const match=decideStrategy(policy,fresh).actions.find(a=>a.kind===action.kind&&hash(a.target)===hash(action.target));if(!match)throw Error('strategy_action_no_longer_valid');return fresh;}catch(e){e.noWrite=true;throw e;}}
 async submit(store,policy,context,action){
  if(await this.account(store)!==context.accountRef)throw Object.assign(Error('strategy_account_changed'),{noWrite:true});
  if(action.kind==='price'){
   const c=await this.price(store,policy.sku);if(c.fingerprint!==context.priceContext.fingerprint)throw Object.assign(Error('strategy_context_changed'),{noWrite:true});
   const target=Number(action.target);if(!Number.isSafeInteger(Number(c.productId))||!['RUB','CNY'].includes(c.currency)||!Number.isFinite(target)||target<=0||target<c.minPrice||c.oldPrice>0&&target>=c.oldPrice||!['0','0.05','0.07','0.1','0.2','0.22'].includes(c.vat))throw Object.assign(Error('strategy_platform_price_limit'),{noWrite:true});
   const body={prices:[{product_id:Number(c.productId),price:target.toFixed(2),currency_code:c.currency,old_price:String(c.oldPrice),vat:c.vat,auto_add_to_ozon_actions_list_enabled:'UNKNOWN',price_strategy_enabled:'UNKNOWN'}]};const r=await this.call(store,'/v1/product/import/prices',body,{write:true});const result=r.result;if(!Array.isArray(result)||result.length!==1||String(result[0].product_id)!==c.productId||result[0].offer_id!==c.offerId||result[0].updated!==true||!Array.isArray(result[0].errors)||result[0].errors.length)throw Error('strategy_price_receipt_unknown');const after=await this.price(store,policy.sku);return {accepted:true,verified:after.accountRef===c.accountRef&&after.price===target&&after.currency===c.currency,kind:'price',price:target,currency:c.currency,receiptHash:hash(r)};
  }
  if(action.kind==='ads_pause'){
   const c=context.cpoContext;if(!c||c.enabled!==true)throw Object.assign(Error('strategy_ads_unavailable'),{noWrite:true});const op={kind:'cpo_disable',payload:{sku:policy.sku,target:false,context:c,apiBody:{skus:[policy.sku]}}};op.payloadHash=hash(op.payload);const r=await this.disable(store,op);const after=await this.cpo(store,policy.sku);return {...r,kind:'ads_pause',verified:after.enabled===false&&after.accountRef===c.accountRef};
  }
  if(action.kind==='promotion_join'){
   const offer=context.promotions?.find(p=>p.id===action.target.id&&p.price===action.target.price&&p.currency===policy.currency&&p.eligible&&!p.joined);if(!offer||action.target.stock>context.stock-policy.stockReserve||action.target.stock<=0)throw Object.assign(Error('strategy_promotion_changed'),{noWrite:true});
   const r=await this.call(store,'/v1/actions/products/activate',{action_id:Number(offer.id),products:[{product_id:Number(context.productId),action_price:offer.price,stock:action.target.stock}]},{write:true});if(!Array.isArray(r.result?.product_ids)||!r.result.product_ids.some(id=>String(id)===context.productId)||(r.result.rejected||[]).length)throw Error('strategy_promotion_receipt_unknown');return {accepted:true,verified:false,kind:'promotion_join',actionId:offer.id,productId:context.productId,receiptHash:hash(r)};
  }
  throw Object.assign(Error('strategy_platform_cap_unavailable'),{noWrite:true});
 }
 async reconcile(store,action){
  if(await this.account(store)!==action.accountRef)throw Error('strategy_account_changed');
  if(action.kind==='price'){const c=await this.price(store,action.sku);return {verified:c.currency===action.context.currency&&c.price===action.target&&c.productId===action.context.productId,observedAt:new Date().toISOString()};}
  if(action.kind==='ads_pause'){const c=await this.cpo(store,action.sku);return {verified:c.enabled===false&&c.accountRef===action.context.cpoContext?.accountRef,observedAt:new Date().toISOString()};}
  if(action.kind==='promotion_join'){const r=await this.call(store,'/v1/actions/products',{action_id:Number(action.target.id),limit:100,offset:0});const product=r.result?.products?.find(p=>String(p.id??p.product_id)===action.context.productId);return {verified:Boolean(product&&num(product.action_price)===action.target.price),observedAt:new Date().toISOString()};}
  return {verified:false,observedAt:new Date().toISOString()};
 }
 async reconcileReview(service,store,item){if(!this.reviews)throw Error('reviews_read_unavailable');return this.reviews.reconcile(service,store,item);}
 async processReviews(input){return this.reviews?.process(input);}
}
