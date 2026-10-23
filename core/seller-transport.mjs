import {ApiCooldown} from './api-cooldown.mjs';
// One queue for Seller reads and writes across the dashboard and operations.
// Credentials and write guards are checked by each caller after its turn arrives.
export class SellerRequestQueue{
 constructor({intervalMs=350,now=()=>Date.now(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){this.intervalMs=intervalMs;this.now=now;this.wait=wait;this.lastStarted=null;this.tail=Promise.resolve();}
 run(task){const request=this.tail.then(async()=>{const gap=this.lastStarted===null?0:this.intervalMs-(this.now()-this.lastStarted);if(gap>0)await this.wait(gap);this.lastStarted=this.now();return task();});this.tail=request.catch(()=>{});return request;}
}
export const sellerRequests=new SellerRequestQueue();
export const sellerCooldown=new ApiCooldown();
