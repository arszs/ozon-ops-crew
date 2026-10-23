import {AsyncLocalStorage} from 'node:async_hooks';
// Serialize operations on one physical marketplace product across connection
// aliases and entry points. Different products need not wait for each other.
const tails=new Map(),held=new AsyncLocalStorage();
export function withProductMutation(accountRef,productId,work){
 if(typeof accountRef!=='string'||!accountRef||!['number','string'].includes(typeof productId)||!/^[1-9]\d*$/.test(String(productId))||typeof work!=='function')return Promise.reject(Object.assign(Error('product_mutation_identity_invalid'),{noWrite:true}));
 const key=JSON.stringify([accountRef,String(productId)]),parent=held.getStore();if(parent?.has(key))return Promise.resolve().then(work);
 const previous=tails.get(key)||Promise.resolve(),next=previous.catch(()=>{}).then(()=>held.run(new Set([...(parent||[]),key]),work));
 tails.set(key,next);return next.finally(()=>{if(tails.get(key)===next)tails.delete(key);});
}
