const supported=['taobao.com','tmall.com','1688.com','yiwugo.com'];
export function supplierURLFromShare(value){
 if(typeof value!=='string'||value.length>8000)throw Error('Вставьте ссылку на товар или текст «Поделиться» из приложения');
 const direct=value.trim();if(/^https:\/\/\S+$/.test(direct))return direct;
 const urls=[...new Set((direct.match(/https:\/\/[^\s<>"“”]+/gu)||[]).map(s=>s.replace(/[，。；、）】\])]+$/u,'')))].filter(s=>{try{const u=new URL(s);return supported.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}});
 if(urls.length!==1)throw Error(urls.length?'В тексте несколько ссылок на товары; вставьте одну':'В тексте не найдена ссылка на товар');return urls[0];
}
export function supplierSource(value){
 let u;try{u=new URL(supplierURLFromShare(value));}catch{throw Error('Введите одну ссылку на товар Taobao, Tmall, 1688 или Иуго');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!supported.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('Поддерживаются только HTTPS-ссылки Taobao, Tmall, 1688 и Иуго');
 const platform=u.hostname==='1688.com'||u.hostname.endsWith('.1688.com')?'1688':u.hostname==='yiwugo.com'||u.hostname.endsWith('.yiwugo.com')?'yiwugo':'taobao';
 const itemId=platform==='1688'?u.pathname.match(/\/offer\/(\d+)\.html$/)?.[1]||u.searchParams.get('offerId')||u.searchParams.get('id'):platform==='yiwugo'?u.pathname.match(/\/product\/detail\/(\d+)\.html$/)?.[1]||u.searchParams.get('productId'):u.searchParams.get('id');
 return {url:u.href,host:u.hostname,platform,itemId};
}
export function supplierProductURL(value){
 const s=supplierSource(value),u=new URL(s.url),allowed=s.platform==='taobao'?['item.taobao.com','detail.tmall.com'].includes(s.host):s.platform==='1688'?['detail.1688.com','m.1688.com','detail.m.1688.com'].includes(s.host):['yiwugo.com','www.yiwugo.com','m.yiwugo.com'].includes(s.host);
 if(!allowed||!/^\d+$/.test(s.itemId||''))throw Error('Нужна прямая ссылка на товар Taobao, Tmall, 1688 или Иуго с номером товара');
 const clean=new URL(s.platform==='taobao'?'https://'+s.host+'/item.htm':s.platform==='1688'?'https://detail.1688.com/offer/'+s.itemId+'.html':'https://www.yiwugo.com/product/detail/'+s.itemId+'.html');
 if(s.platform==='taobao')clean.searchParams.set('id',s.itemId);
 const sku=u.searchParams.get('skuId');if(sku){if(!/^\d+$/.test(sku))throw Error('Некорректный skuId');clean.searchParams.set('skuId',sku);}
 return clean.href;
}
