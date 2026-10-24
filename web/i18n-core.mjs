export const LANGUAGES=['zh','ru','en'];
export const LANGUAGE_KEY='ops-ui-language';
export const normalizeMessage=s=>String(s).replace(/\s+/g,' ').trim();
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function createTranslator(entries){
 const exact=new Map(),patterns=[],prefixes=[];
 for(const e of entries){if(!e.source||!LANGUAGES.every(k=>typeof e[k]==='string'))throw Error('Incomplete UI translation');const source=normalizeMessage(e.source),native=e.native||(/\p{Script=Han}/u.test(source)?'zh':'ru');exact.set(source,{...e,native});
  if(/⟦\d+⟧/.test(source)){const ids=[...source.matchAll(/⟦(\d+)⟧/g)].map(m=>m[1]),chunks=source.split(/⟦\d+⟧/g);if(chunks.join('').length>=3)patterns.push({e,ids,length:chunks.join('').length,re:new RegExp('^'+chunks.map(escape).join('([\\s\\S]*?)')+'$')});}
  else if(source.length>=3&&/[\p{Script=Han}\p{Script=Cyrillic}]/u.test(source))prefixes.push({source,e,native});
 }
 // UI rendered by older bilingual modules can already contain a translated label.
 // Register aliases after native sources so switching back remains reversible.
 for(const e of entries)for(const k of LANGUAGES){const alias=normalizeMessage(e[k]);if(!exact.has(alias))exact.set(alias,e);if(alias!==normalizeMessage(e.source)&&/⟦\d+⟧/.test(alias)){const ids=[...alias.matchAll(/⟦(\d+)⟧/g)].map(m=>m[1]),chunks=alias.split(/⟦\d+⟧/g);if(chunks.join('').length>=3)patterns.push({e,ids,length:chunks.join('').length,re:new RegExp('^'+chunks.map(escape).join('([\\s\\S]*?)')+'$')});}}
 patterns.sort((a,b)=>b.length-a.length);prefixes.sort((a,b)=>b.source.length-a.source.length);
 return function translate(value,language){if(!LANGUAGES.includes(language))throw Error('Unsupported UI language');const raw=String(value),s=normalizeMessage(raw);if(!s)return raw;let translated;const item=exact.get(s);
  if(item)translated=item[language];else{for(const p of patterns){const match=s.match(p.re);if(!match)continue;const vars=Object.fromEntries(p.ids.map((id,i)=>[id,exact.get(normalizeMessage(match[i+1]))?.[language]??match[i+1]]));translated=p.e[language].replace(/⟦(\d+)⟧/g,(m,id)=>vars[id]??m);break;}
   if(translated===undefined){for(const p of prefixes){if(!/[:：]$/.test(p.source))continue;if(s.startsWith(p.source)){translated=p.e[language]+s.slice(p.source.length);break;}}}
  }
  if(translated===undefined&&/[ ·→]/.test(s)){const parts=s.split(/(\s+[·→]\s+)/);if(parts.length>1){const next=parts.map(p=>exact.get(normalizeMessage(p))?.[language]??p).join('');if(next!==s)translated=next;}}
  if(translated===undefined)return raw;const leading=raw.match(/^\s*/)?.[0]||'',trailing=raw.match(/\s*$/)?.[0]||'';return leading+translated+trailing;
 };
}
export function preferredLanguage(saved,languages=[]){if(LANGUAGES.includes(saved))return saved;for(const locale of languages){const code=String(locale).toLowerCase().split(/[-_]/)[0];if(LANGUAGES.includes(code))return code;}return 'ru';}
