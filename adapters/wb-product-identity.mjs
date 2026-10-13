import {hash} from '../core/repository.mjs';
import {wbRead,wbAccount} from './wb-api.mjs';
import {wbNmId} from './wb-prices.mjs';
import {findWbCard} from './wb-products.mjs';
export async function readWbProductIdentity(store,product,{read=wbRead,accountRef=wbAccount}={}){
 const owner=await accountRef(store),nmID=wbNmId(product.sku),card=await findWbCard(store,product.offerId,{read,accountRef:owner});
 if(!card||String(card.nmID)!==nmID||!Array.isArray(card.sizes)||!card.sizes.length)throw Error('WB 卡片与操作商品不匹配');
 const current={sku:nmID,offerId:product.offerId,sizes:card.sizes.map(s=>({chrtId:wbNmId(s.chrtID),techSize:s.techSize,skus:s.skus})).sort((a,b)=>a.chrtId.localeCompare(b.chrtId))};
 if(new Set(current.sizes.map(s=>s.chrtId)).size!==current.sizes.length)throw Error('WB 尺码重复');
 if(await accountRef(store)!==owner)throw Error('WB 账户已变化');
 return {accountRef:owner,product:current,title:card.title||product.offerId,identityHash:hash(current)};
}
