import {readFile,readdir,writeFile} from 'node:fs/promises';
const entries=[],missing=[];let total=0;
for(const [file,folder] of [['work/ui-messages-source.json','work/ui-translations-v2'],['work/ui-messages-extra.json','work/ui-translations-extra']]){
 let source;try{source=JSON.parse(await readFile(file,'utf8'));}catch(e){if(file.includes('extra'))continue;throw e;}
 total+=source.length;const translations=new Map();let names=[];try{names=await readdir(folder);}catch{}
 for(const name of names)if(name.endsWith('.json'))for(const t of JSON.parse(await readFile(folder+'/'+name,'utf8')))translations.set(t.id,t);
 for(const [id,s] of source.entries()){const native=/\p{Script=Han}/u.test(s)?'zh':'ru',r=translations.get(id);if(!r){missing.push(file+':'+id);continue;}entries.push({source:s,native,ru:native==='ru'?s:r.other,zh:native==='zh'?s:r.other,en:r.en});}
}
const overrides=[{source:'Стратегии и агенты',native:'ru',ru:'Стратегии и агенты',en:'Strategies and agents',zh:'策略与智能体'},{source:'Захотеть купить.',native:'ru',ru:'Захотеть купить.',zh:'更让人想买。',en:'Made to sell.'},{source:'中文工作台 · 俄语商品内容',native:'zh',ru:'Русский интерфейс · Карточки на русском',zh:'中文工作台 · 俄语商品内容',en:'English workspace · Russian product content'},{source:'中文交互演示 · 合成商品',native:'zh',ru:'Интерактивное демо · Синтетический товар',zh:'中文交互演示 · 合成商品',en:'Interactive demo · Synthetic product'}];
for(const e of overrides){const i=entries.findIndex(x=>x.source===e.source);if(i<0)entries.push(e);else entries[i]=e;}
for(const [source,ru,zh,en] of [['cover','Обложка','封面','Cover'],['compatibility','Совместимость','兼容性','Compatibility'],['contents','Комплект','包装内容','Contents']])entries.push({source,native:'en',ru,zh,en});
await writeFile('web/ui-messages.mjs','// Generated from application UI literals. No store data or credentials.\nexport default '+JSON.stringify(entries)+';\n');console.log(JSON.stringify({translated:total-missing.length,total,missing:missing.length}));if(process.argv.includes('--complete')&&missing.length)process.exitCode=1;
