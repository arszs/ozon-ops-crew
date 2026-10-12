// Process-local Retry-After handling. No request is retried by this module.
export class ApiCooldown{
 constructor({now=()=>Date.now(),fallbackMs=60000}={}){this.now=now;this.fallbackMs=fallbackMs;this.until=new Map();}
 check(account,code){const retryAt=this.until.get(account)||0;if(retryAt>this.now()){const e=Error(code);e.retryAt=retryAt;throw e;}this.until.delete(account);}
 reject(account,response,code){
  const value=response.headers?.get('retry-after')?.trim(),n=value&&/^\d+$/.test(value)?Number(value)*1000:null,date=value&&value.length>=20&&n===null?Date.parse(value):NaN;
  const delay=n!==null&&Number.isSafeInteger(n)?n:Number.isFinite(date)?date-this.now():this.fallbackMs;
  const retryAt=Math.max(this.until.get(account)||0,Math.min(8640000000000000,this.now()+Math.max(1000,delay)));
  this.until.set(account,retryAt);const e=Error(code);e.retryAt=retryAt;throw e;
 }
}
