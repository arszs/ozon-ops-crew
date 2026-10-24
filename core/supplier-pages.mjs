import {parse} from 'parse5';
import {hash} from './repository.mjs';
import {supplierSource,supplierProductURL} from './supplier-source.mjs';
const attr=(n,k)=>n.attrs?.find(a=>a.name===k)?.value||'';
const excluded=new Set(['script','style','iframe','noscript','template','nav','header','footer']);
function text(n){if(excluded.has(n.tagName))return '';return n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join(' ');}
const plain=html=>text(parse(String(html||''))).replace(/\s+/g,' ').trim();
// Parse JSON only. Never evaluate a supplier's JavaScript or copy account/shop data.
export function embeddedJSONObject(html,marker){
 const at=html.indexOf(marker);if(at<0)return null;let start=at+marker.length;while(/[\s=]/.test(html[start]||'')&&start<html.length)start++;if(html[start]!=='{')return null;
 let depth=0,string=false,escape=false;for(let i=start;i<Math.min(html.length,start+8_000_000);i++){const c=html[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){try{return JSON.parse(html.slice(start,i+1));}catch{return null;}}}return null;
}
function imageURL(raw){try{const u=new URL(String(raw||'').replace(/^http:/,'https:'),'https://www.yiwugo.com');if(u.protocol!=='https:'||u.username||u.password||u.port||!['alicdn.com','yiwugo.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))||!/[.](?:jpe?g|png|webp)(?:$|[?])/i.test(u.href))return null;return u.href;}catch{return null;}}
function mediaInventory(gallery,details,selectedURL){
 const rows=[];for(const [role,list] of [['gallery',gallery],['detail',details]])for(const raw of list){const url=imageURL(raw);if(!url)continue;const filename=decodeURIComponent(new URL(url).pathname.split('/').at(-1)),name=filename.match(/^(.+?[.](?:jpe?g|png|webp))/i)?.[1];if(!name)continue;const old=rows.find(r=>r.name===name&&r.role===role);if(old){if(old.url.split('?')[0]!==url.split('?')[0])throw Error('Неоднозначные имена фотографий в источнике');if(url===selectedURL)old.selected=true;continue;}rows.push({key:hash({role,name}),index:rows.length,role,name,url,filename,localCompanionRequired:false,...(url===selectedURL?{selected:true}:{})});}
 if(rows.length>100)throw Error('В источнике больше 100 товарных изображений');return rows;
}
function descriptionImages(html){const out=[];function walk(n){if(excluded.has(n.tagName))return;if(n.tagName==='img'){const u=imageURL(attr(n,'data-src')||attr(n,'src'));if(u)out.push(u);}for(const child of n.childNodes||[])walk(child);}walk(parse(html||''));return out;}
function canonicalLink(html){let found=null;function walk(n){if(n.tagName==='link'&&attr(n,'rel')==='canonical')found=attr(n,'href');for(const child of n.childNodes||[])walk(child);}walk(parse(html));return found;}
export function supplierPageEvidence(html,{sourceUrl}={}){
 let source;if(sourceUrl)source=supplierSource(sourceUrl);else if(html.includes('window.__INITIAL_STATE__')&&html.includes('productDetailVO'))return parseYiwugoPage(html);
 else{try{source=supplierSource(canonicalLink(html));}catch{return null;}}
 return source.platform==='yiwugo'?parseYiwugoPage(html,{sourceUrl:source.url}):source.platform==='1688'?parse1688Page(html,{sourceUrl:source.url}):null;
}
export function parse1688Page(html,{sourceUrl}={}){
 const s=supplierSource(sourceUrl||canonicalLink(html));if(s.platform!=='1688'||!/^\d+$/.test(s.itemId||''))throw Error('Нужна прямая ссылка на товар 1688');
 const products=[];function scan(value){if(Array.isArray(value)){for(const item of value)scan(item);return;}if(!value||typeof value!=='object')return;const type=value['@type'];if(type==='Product'||Array.isArray(type)&&type.includes('Product'))products.push(value);if(value['@graph'])scan(value['@graph']);}
 function walk(n){if(n.tagName==='script'&&attr(n,'type').split(';')[0].trim()==='application/ld+json'){try{scan(JSON.parse((n.childNodes||[]).filter(c=>c.nodeName==='#text').map(c=>c.value).join('')));}catch{}}for(const c of n.childNodes||[])walk(c);}walk(parse(html));
 const matching=value=>{try{const x=supplierSource(value);return x.platform==='1688'&&x.itemId===s.itemId;}catch{return false;}},canonical=canonicalLink(html),candidates=products.filter(p=>{const identity=p.url||p.mainEntityOfPage?.['@id']||p.mainEntityOfPage;return identity?matching(identity):matching(canonical);});
 if(candidates.length!==1)throw Error('1688 ещё не подтвердил единственный товар и его номер; дождитесь загрузки страницы');
 const p=candidates[0],requested=new URL(s.url).searchParams.get('skuId'),variants=(Array.isArray(p.hasVariant)?p.hasVariant:[]).filter(v=>/^\d+$/.test(String(v.sku||''))).map(v=>({skuId:String(v.sku),label:String(v.name||[v.color,v.size].filter(Boolean).join(' / ')),product:v})),variant=requested?variants.find(v=>v.skuId===requested):variants.find(v=>!String(v.product.offers?.availability||'').includes('OutOfStock'));
 if(requested&&!variant&&String(p.sku)!==requested)throw Error('1688 не подтвердил выбранный SKU; другой вариант не подставлен');
 if(variants.length&&!variant)throw Error('Нет доступного подтверждённого варианта 1688');
 const selected=variant?.product||p,offers=Array.isArray(selected.offers)?selected.offers:[selected.offers],offer=offers.length===1?offers[0]:null,price=Number(offer?.price);
 if(!offer||offer['@type']==='AggregateOffer'||offer.priceCurrency!=='CNY'||!Number.isFinite(price)||price<=0)throw Error('1688 не подтвердил точную цену варианта; оптовый диапазон не используется как цена товара');
 const title=String(p.name||'').trim();if(!title)throw Error('1688 не вернул название товара');
 const props=[...(Array.isArray(p.additionalProperty)?p.additionalProperty:[]),...(selected!==p&&Array.isArray(selected.additionalProperty)?selected.additionalProperty:[])].filter(a=>typeof a.name==='string'&&['string','number'].includes(typeof a.value)),brand=typeof p.brand==='string'?p.brand:p.brand?.name,skuId=variant?.skuId||(/^\d+$/.test(String(p.sku||''))?String(p.sku):null),label=variant?.label||title,url=new URL(supplierProductURL(s.url));if(skuId)url.searchParams.set('skuId',skuId);
 const imageList=v=>(Array.isArray(v)?v:[v]).map(i=>typeof i==='string'?i:i?.url||i?.contentUrl).filter(Boolean),gallery=[...imageList(selected.image),...imageList(p.image)],selectedImage=imageURL(imageList(selected.image)[0]),description=[p.description,selected!==p?selected.description:null].filter(v=>typeof v==='string').join('\n'),inventory=mediaInventory(gallery,descriptionImages(description),selectedImage);
 const content=[title,'已选规格：'+label,'商品单价：'+price+' CNY',...(brand?['品牌：'+brand]:[]),...props.map(a=>a.name+'：'+a.value),plain(description)].filter(Boolean).join('\n').slice(0,24000);
 return {sourcePlatform:'1688',sourceUrl:url.href,itemId:s.itemId,skuId,title,text:content,variantOptions:variants.map(v=>({skuId:v.skuId,label:v.label,available:!String(v.product.offers?.availability||'').includes('OutOfStock'),parts:[{pid:'specification',vid:v.skuId,label:v.label}]})),selectedOptions:variant?[{pid:'specification',vid:variant.skuId,label}]:[],displayedPrices:[price],selectedVariants:[label],selectionPolicy:variant?(requested?'requested-sku':'first-available'):'single-product',imageUrls:inventory.filter(r=>r.role==='gallery').map(r=>r.url).slice(0,30),mediaInventory:inventory,sourceHash:hash(html),evidenceHash:hash({title,content,skuId,price,inventory})};
}
export function parseYiwugoPage(html,{sourceUrl}={}){
 const state=embeddedJSONObject(html,'window.__INITIAL_STATE__'),d=state?.c?.detail,p=d?.productDetailVO;
 if(!p||!/^\d+$/.test(String(p.id||''))||typeof p.title!=='string'||!p.title.trim())throw Error('Иуго ещё не вернул данные товара; дождитесь загрузки страницы');
 const s=supplierSource(sourceUrl||'https://www.yiwugo.com/product/detail/'+p.id+'.html');if(s.platform!=='yiwugo'||s.itemId!==String(p.id))throw Error('Страница Иуго не соответствует номеру товара в ссылке');
 const tiers=(d.sdiProductsPriceList||[]).filter(t=>String(t.productId)===s.itemId&&Number(t.startNumber)>0&&Number(t.sellPrice)>0).sort((a,b)=>Number(a.startNumber)-Number(b.startNumber)),basePrice=Number(tiers[0]?.sellPrice??p.sellPrice)/100;
 const requested=new URL(s.url).searchParams.get('skuId'),variants=(d.productPropertySkuBoList||[]).filter(v=>String(v.productId)===s.itemId&&/^\d+$/.test(String(v.id))&&typeof v.propertyValues==='string'&&v.propertyValues.trim()).map(v=>({skuId:String(v.id),label:v.propertyValues,price:Number(v.price)>0?Number(v.price)/100:String(p.priceType)==='1'?basePrice:0,available:Number(v.stock)>0,picture:imageURL(v.picture),parts:[{pid:'specification',vid:String(v.id),label:v.propertyValues,group:'规格'}]}));
 const selected=requested?variants.find(v=>v.skuId===requested):variants.find(v=>v.available&&v.price>0&&!/请勿拍|补运费|运费专用/.test(v.label));
 if(requested&&!selected||variants.length&&!selected)throw Error('Выбранный вариант Иуго недоступен или не найден');
 // Monetary fields in Yiwugo's INITIAL_STATE are integer fen; the rendered page shows CNY.
 const price=selected?.price??basePrice;
 if(!Number.isFinite(price)||price<=0||!selected&&Number(p.maxPrice)>Number(p.sellPrice)&&!d.sdiProductsPriceList?.length)throw Error('Иуго не подтвердил цену конкретного варианта');
 const clean=new URL(supplierProductURL(s.url));if(selected)clean.searchParams.set('skuId',selected.skuId);
 const attributes=(d.productExtendList||[]).filter(a=>typeof a.name==='string'&&typeof a.value==='string').map(a=>({name:a.name,value:a.value}));if(p.goodsCode)attributes.push({name:'货号',value:String(p.goodsCode)});
 const details=String(p.detaill||''),selectedLabel=selected?.label||'规格未设置',gallery=[...(selected?.picture?[selected.picture]:[]),p.picture1,p.picture,...(d.sdiProductsPicList||[]).map(i=>i.picture||i.picture1)],inventory=mediaInventory(gallery,descriptionImages(details),selected?.picture);
 if(!selected&&inventory.find(r=>r.role==='gallery'))inventory.find(r=>r.role==='gallery').selected=true;
 const title=p.title.trim(),lines=[title,'已选规格：'+selectedLabel,'商品单价：'+price.toFixed(2)+' CNY',...attributes.map(a=>a.name+'：'+a.value),...(p.startNumber?['起订量：'+p.startNumber+(p.metric||'')]:[]),...(Number(p.freight)===0&&Number(p.freedelivery)===1?['快递: 免运费']:['境内运费：未确认']),plain(details)].filter(Boolean),content=lines.join('\n').slice(0,24000),variantOptions=variants.map(({picture,...v})=>v);
 return {sourcePlatform:'yiwugo',sourceUrl:clean.href,itemId:s.itemId,skuId:selected?.skuId||null,title,text:content,variantOptions,selectedOptions:selected?.parts||[],displayedPrices:[price],selectedVariants:[selectedLabel],selectionPolicy:selected?(requested?'requested-sku':'first-available'):'single-product',imageUrls:inventory.filter(r=>r.role==='gallery').map(r=>r.url).slice(0,30),mediaInventory:inventory,sourceHash:hash(html),evidenceHash:hash({title,content,price,sku:selected?.skuId,inventory}),minimumOrderQuantity:Number(p.startNumber)||null};
}
