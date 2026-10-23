import {performanceRead,performanceCampaignCSV,performanceAccount} from '../performance.mjs';
import {hash} from '../core/repository.mjs';
import {inferCampaignBudgetUnits,campaignUnitsToRub,parseCampaignCSV,campaignReportRub} from '../core/campaign-budget.mjs';
const metadata=rows=>rows.map(c=>({id:String(c.id),weeklyBudget:c.weeklyBudget,budgetType:c.budgetType,updatedAt:c.updatedAt,autoIncrease:c.autoIncrease})).sort((a,b)=>a.id.localeCompare(b.id));
export async function readCampaignBudgetEvidence({read=performanceRead,csv=performanceCampaignCSV,account=performanceAccount,date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}={}){
 const accountRef=await account(),before=await read('/api/client/campaign',undefined,{accountRef});if(!Array.isArray(before.list)||Number(before.total??before.list.length)!==before.list.length)throw Error('campaigns_incomplete');
 const report=await csv({from:date,to:date},{accountRef}),after=await read('/api/client/campaign',undefined,{accountRef});if(!Array.isArray(after.list)||Number(after.total??after.list.length)!==after.list.length||hash(metadata(before.list))!==hash(metadata(after.list))||await account()!==accountRef)throw Error('campaign_budget_changed_during_read');
 const evidence=inferCampaignBudgetUnits(after.list,report.text),spentTodayByCampaign={};for(const row of parseCampaignCSV(report.text)){try{spentTodayByCampaign[row.ID]=campaignReportRub(row['Расход, ₽']);}catch{spentTodayByCampaign[row.ID]=null;}}return {...evidence,spentTodayByCampaign,accountRef,date,checkedAt:new Date().toISOString(),metadataHash:hash(metadata(after.list))};
}
export function automaticBudgetIncreaseDisabled(value){return value===false||value&&typeof value==='object'&&!Array.isArray(value)&&(Object.keys(value).length===0||value.enabled===false);}
export function attachCampaignBudgets(campaigns,evidence){return campaigns.map(c=>{let weeklyBudgetRub=null,budgetVerified=false;try{weeklyBudgetRub=campaignUnitsToRub(c.rawWeeklyBudget,evidence);budgetVerified=c.budgetType==='PRODUCT_CAMPAIGN_BUDGET_TYPE_WEEKLY'&&evidence.accountRef===c.accountRef&&weeklyBudgetRub>0&&automaticBudgetIncreaseDisabled(c.autoIncrease);}catch{}return {...c,weeklyBudgetRub,budgetVerified,budgetCurrency:'RUB',budgetEvidenceHash:evidence?.evidenceHash||null,budgetUnitsPerRub:evidence?.unitsPerRub||null,campaignSpentToday:evidence?.spentTodayByCampaign?.[c.id]??null,budgetDate:evidence?.date||null,autoIncreaseDisabled:automaticBudgetIncreaseDisabled(c.autoIncrease)===true};});}

import {performanceSetWeeklyBudget,performanceResumeCampaign} from '../performance.mjs';
import {readSkuCampaigns} from './ozon-campaigns.mjs';
import {readPrice} from './ozon-prices.mjs';
import {ozonCall} from './ozon-products.mjs';
import {contributionAt} from '../core/product-strategies.mjs';
import {rubToCampaignUnits} from '../core/campaign-budget.mjs';
async function managedBudgetContext(store,policy,observation,id,{campaigns=readSkuCampaigns,budgets=readCampaignBudgetEvidence}={}){
 if(policy.mode!=='auto'||policy.allowAds!==true||!policy.managedCampaignId||policy.managedCampaignId!==id||!policy.advertisingAccountRef)throw Object.assign(Error('campaign_policy_invalid'),{noWrite:true});
 const r=await campaigns(store,observation.priceContext,{withSpend:false,includeStopped:true}),expected=observation.campaigns?.find(c=>c.id===id),current=r.items.find(c=>c.id===id);
 if(!current||!expected||current.fingerprint!==expected.fingerprint||current.exclusive!==true||current.accountRef!==policy.advertisingAccountRef||current.sellerRef!==policy.accountRef)throw Object.assign(Error('campaign_context_changed'),{noWrite:true});
 const evidence=await budgets();if(evidence.accountRef!==current.accountRef)throw Object.assign(Error('ads_connection_unverified'),{noWrite:true});const verified=attachCampaignBudgets([current],evidence)[0];if(!verified.budgetVerified)throw Object.assign(Error('campaign_budget_unverified'),{noWrite:true});return {campaign:verified,evidence};
}
export async function reduceCampaignWeeklyBudget(store,policy,observation,target,{campaigns=readSkuCampaigns,budgets=readCampaignBudgetEvidence,set=performanceSetWeeklyBudget,canExecute=async()=>true}={}){
 let checked;try{checked=await managedBudgetContext(store,policy,observation,target.id,{campaigns,budgets});if(typeof target.weeklyBudgetRub!=='number'||target.weeklyBudgetRub<=0||target.weeklyBudgetRub>policy.cpcWeeklyBudget||target.weeklyBudgetRub>=checked.campaign.weeklyBudgetRub)throw Error('campaign_budget_increase_not_allowed');}catch(e){e.noWrite=true;throw e;}
 const raw=rubToCampaignUnits(target.weeklyBudgetRub,checked.evidence);if(!await canExecute())throw Object.assign(Error('strategy_action_cancelled'),{noWrite:true});const receipt=await set(target.id,raw,checked.campaign.accountRef,{canExecute}),after=(await campaigns(store,observation.priceContext,{withSpend:false,includeStopped:true})).items.find(c=>c.id===target.id);
 return {kind:'campaign_budget',accepted:true,verified:Boolean(after&&after.accountRef===checked.campaign.accountRef&&after.sellerRef===checked.campaign.sellerRef&&after.rawWeeklyBudget===raw&&after.budgetType==='PRODUCT_CAMPAIGN_BUDGET_TYPE_WEEKLY'&&automaticBudgetIncreaseDisabled(after.autoIncrease)),campaignId:target.id,weeklyBudgetRub:target.weeklyBudgetRub,rawWeeklyBudget:raw,receiptHash:hash(receipt)};
}
export async function resumeManagedCampaign(store,policy,observation,id,{campaigns=readSkuCampaigns,budgets=readCampaignBudgetEvidence,price=readPrice,call=ozonCall,resume=performanceResumeCampaign,canExecute=async()=>true}={}){
 let checked;try{
  checked=await managedBudgetContext(store,policy,observation,id,{campaigns,budgets});const c=checked.campaign,day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(policy.allowCampaignResume!==true||c.enabled||!['sales','launch','balanced','clearance'].includes(policy.strategy)||policy.cpcWeeklyBudget<=0||c.weeklyBudgetRub>policy.cpcWeeklyBudget||policy.adDailyBudget<=0||c.budgetDate!==day||typeof c.campaignSpentToday!=='number'||c.campaignSpentToday>=policy.adDailyBudget)throw Error('campaign_resume_outside_policy');
  const p=await price(store,policy.sku),e=contributionAt(p.price,policy);if(p.fingerprint!==observation.priceContext.fingerprint||p.currency!==policy.currency||p.accountRef!==policy.accountRef||!e||e.marginPct<policy.minMarginPct)throw Error('campaign_economics_changed');
  const d=await call(store,'/v3/product/info/list',{sku:[policy.sku]}),item=d.items?.find(p=>String(p.id)===observation.productId&&p.offer_id===observation.offerId),rows=item?.stocks?.stocks?.filter(s=>String(s.sku)===policy.sku)||[];let stock=0;
  if(!rows.length)throw Error('stock_unknown');for(const r of rows){const present=Number(r.present),reserved=Number(r.reserved);if(r.present==null||r.reserved==null||!Number.isSafeInteger(present)||!Number.isSafeInteger(reserved)||present<0||reserved<0)throw Error('stock_unknown');stock+=Math.max(0,present-reserved);}if(stock<=policy.stockReserve)throw Error('low_stock');
 }catch(e){e.noWrite=true;throw e;}
 if(!await canExecute())throw Object.assign(Error('strategy_action_cancelled'),{noWrite:true});const receipt=await resume(id,checked.campaign.accountRef,{canExecute}),after=(await campaigns(store,observation.priceContext,{withSpend:false,includeStopped:true})).items.find(c=>c.id===id),within=Boolean(after&&after.accountRef===checked.campaign.accountRef&&after.sellerRef===checked.campaign.sellerRef&&after.rawWeeklyBudget===checked.campaign.rawWeeklyBudget&&after.budgetType==='PRODUCT_CAMPAIGN_BUDGET_TYPE_WEEKLY'&&automaticBudgetIncreaseDisabled(after.autoIncrease));
 return {kind:'campaign_resume',accepted:true,verified:within&&after.enabled===true,policyViolation:!within,campaignId:id,weeklyBudgetRub:checked.campaign.weeklyBudgetRub,receiptHash:hash(receipt)};
}
