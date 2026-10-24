import {parse} from 'parse5';
import {hash} from './repository.mjs';
const attr=(n,k)=>n.attrs?.find(a=>a.name===k)?.value||'';
export function mediaFilename(value){try{const name=decodeURIComponent(String(value).split(/[?#]/)[0].split('/').at(-1)||'');return name.match(/^(.+?\.(?:jpe?g|png|webp))/i)?.[1]||null;}catch{return null;}}
export function sourceMediaInventory(html){const urls=[...html.matchAll(/https:\/\/(?:img|gw)\.alicdn\.com\/[^\s<>"'\\]+?\.(?:jpg|jpeg|png|webp)/gi)].map(m=>m[0]),rows=[];
 function walk(n,ancestry=''){const cls=attr(n,'class'),context=ancestry+' '+cls;if(n.tagName==='img'&&/mainPic--|thumbnailPic--|descV6-mobile-image/.test(cls)&&!/comment|review|recommend|shopIcon/i.test(context)){const value=attr(n,'data-src')||attr(n,'src'),name=mediaFilename(value),role=/descV6-mobile-image/.test(cls)?'detail':'gallery';if(name&&!rows.some(r=>r.name===name&&r.role===role)){const url=/^https:\/\/(?:img|gw)\.alicdn\.com\//.test(value)?urls.find(u=>mediaFilename(u)===name):urls.find(u=>mediaFilename(u)===name);rows.push({key:hash({role,name}),index:rows.length,role,name,url:url||null,filename:decodeURIComponent(value.split('/').at(-1)||''),localCompanionRequired:!url});}}for(const child of n.childNodes||[])if(!['script','style','template','noscript','iframe','nav','header','footer'].includes(child.tagName))walk(child,context);}
 walk(parse(html));if(rows.length>100)throw Error('Страница содержит больше 100 товарных изображений; разделите источник');return rows;
}
