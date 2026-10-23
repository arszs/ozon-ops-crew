import {Repository} from './repository.mjs';
// Conservative rolling window: account aliases and process restarts share the
// same local attempt history. Other applications can also consume Ozon's quota.
export class AnalyticsQuota{
 constructor(file,{now=()=>Date.now(),dailyLimit=50,minIntervalMs=60000}={}){this.repo=new Repository(file);this.now=now;this.dailyLimit=dailyLimit;this.minIntervalMs=minIntervalMs;}
 reserve(accountRef){if(typeof accountRef!=='string'||!accountRef)throw Error('analytics_account_required');return this.repo.mutate(db=>{
  const now=this.now();if(!Number.isFinite(now))throw Error('analytics_clock_invalid');db.analyticsRequests??={};
  for(const [key,rows] of Object.entries(db.analyticsRequests)){if(!Array.isArray(rows)||rows.some(t=>!Number.isFinite(t)))throw Error('analytics_quota_state_invalid');const recent=rows.filter(t=>t>now-86400000).sort((a,b)=>a-b);if(recent.length)db.analyticsRequests[key]=recent;else delete db.analyticsRequests[key];}
  const recent=db.analyticsRequests[accountRef]||[];
  if(recent.length>=this.dailyLimit)throw Object.assign(Error('seller_analytics_daily_limit'),{retryAt:recent[recent.length-this.dailyLimit]+86400000});
  if(recent.length&&recent.at(-1)+this.minIntervalMs>now)throw Object.assign(Error('seller_analytics_minute_limit'),{retryAt:recent.at(-1)+this.minIntervalMs});
  recent.push(now);db.analyticsRequests[accountRef]=recent;return {reserved:true,remaining:this.dailyLimit-recent.length};
 });}
}
