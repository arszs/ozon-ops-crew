import entries from './ui-messages.mjs';
import {createTranslator,LANGUAGES,LANGUAGE_KEY,preferredLanguage} from './i18n-core.mjs';
const translate=createTranslator(entries),textRecords=new WeakMap(),attributeRecords=new WeakMap();
function savedLanguage(){const browser=globalThis.navigator?.languages||[globalThis.navigator?.language];try{return preferredLanguage(localStorage.getItem(LANGUAGE_KEY)||localStorage.getItem('ops-lang'),browser);}catch{return preferredLanguage(null,browser);}}
let language=savedLanguage(),scheduled=false;const ownValidation=new Set();
const excluded='script,style,code,pre,textarea,[contenteditable], [data-no-i18n], [data-language-control], [lang="ru"]:not(html)';
export const currentLanguage=()=>language;
export const t=text=>translate(text,language);
function protectedNode(node){return !!node.parentElement?.closest(excluded);}
function text(node){if(protectedNode(node))return;const value=node.nodeValue;if(!value?.trim())return;let record=textRecords.get(node);if(!record||value!==record.current)record={source:value,current:value};const next=translate(record.source,language);if(value!==next)node.nodeValue=next;record.current=next;textRecords.set(node,record);}
function attributes(el){if(el.matches('script,style,code,pre')||el.closest('[data-no-i18n],[data-language-control],[lang="ru"]:not(html)'))return;let records=attributeRecords.get(el);if(!records){records={};attributeRecords.set(el,records);}for(const name of ['placeholder','aria-label','title','alt']){const value=el.getAttribute(name);if(!value)continue;let record=records[name];if(!record||value!==record.current)record={source:value,current:value};const next=translate(record.source,language);if(value!==next)el.setAttribute(name,next);record.current=next;records[name]=record;}}
function apply(root=document.documentElement){
 observer.disconnect();
 try{
  // Translating an option without an explicit value must not change FormData.
  for(const option of root.querySelectorAll?.('option:not([value])')||[])option.setAttribute('value',option.value);
  if(root.nodeType===Node.TEXT_NODE)text(root);else{if(root.nodeType===Node.ELEMENT_NODE)attributes(root);const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()))text(node);for(const el of root.querySelectorAll?.('[placeholder],[aria-label],[title],[alt]')||[])attributes(el);}
  document.documentElement.lang=language==='zh'?'zh-CN':language;for(const select of document.querySelectorAll('[data-language-control] select'))select.value=language;
 }finally{observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','aria-label','title','alt']});}
}
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;apply();});}
const observer=new MutationObserver(schedule);
export function setLanguage(next,{persist=true}={}){if(!LANGUAGES.includes(next))return;language=next;for(const el of ownValidation)el.setCustomValidity('');ownValidation.clear();if(persist)try{localStorage.setItem(LANGUAGE_KEY,next);localStorage.setItem('ops-lang',next==='zh'?'zh':'ru');}catch{}document.dispatchEvent(new CustomEvent('ops:languagechange',{detail:{language:next}}));apply();}
function mount(){if(document.querySelector('[data-language-control]'))return;const control=document.createElement('label');control.dataset.languageControl='';control.className='ops-language';control.title='Language / Язык / 语言';const icon=document.createElement('span');icon.textContent='◎';icon.setAttribute('aria-hidden','true');const select=document.createElement('select');select.setAttribute('aria-label','Language / Язык / 语言');for(const [value,label] of [['zh','中文'],['ru','Русский'],['en','English']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=language;select.addEventListener('change',()=>setLanguage(select.value));control.append(icon,select);const header=document.querySelector('body>header,main>header,header');(header||document.body).append(control);const old=document.getElementById('language');if(old)old.hidden=true;}
window.addEventListener('storage',event=>{if(event.key===LANGUAGE_KEY&&LANGUAGES.includes(event.newValue))setLanguage(event.newValue,{persist:false});});
const validation={ru:{required:'Заполните это поле.',url:'Введите корректную ссылку.',email:'Введите корректный адрес электронной почты.',number:'Введите корректное число.',invalid:'Проверьте значение поля.'},zh:{required:'请填写此字段。',url:'请输入有效链接。',email:'请输入有效电子邮箱地址。',number:'请输入有效数字。',invalid:'请检查此字段的值。'},en:{required:'Please fill out this field.',url:'Enter a valid URL.',email:'Enter a valid email address.',number:'Enter a valid number.',invalid:'Check the value of this field.'}};
document.addEventListener('invalid',event=>{const el=event.target;if(!el.setCustomValidity)return;const v=el.validity;const key=v.valueMissing?'required':v.typeMismatch&&el.type==='url'?'url':v.typeMismatch&&el.type==='email'?'email':v.badInput?'number':'invalid';el.setCustomValidity(validation[language][key]);ownValidation.add(el);},true);
document.addEventListener('input',event=>{event.target.setCustomValidity?.('');ownValidation.delete(event.target);},true);
document.addEventListener('change',event=>{event.target.setCustomValidity?.('');ownValidation.delete(event.target);},true);
mount();apply();
