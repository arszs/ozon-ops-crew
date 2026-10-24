import {codexJSON,objectSchema} from '../adapters/codex.mjs';
import {attributeValues,ozonCall} from '../adapters/ozon-products.mjs';
import {assetPath} from '../adapters/media.mjs';
const exclude=new Set([85,8229,9048,4191,11254,4180,4497,4389,23487,9024]);
const normalize=v=>String(v).trim().toLowerCase().replace(/[‐‑–—-]/g,' ').replace(/\s+/g,' ');
function numericValue(value,evidence,def){
 const type=String(def.type).toLowerCase(),numeric=['integer','decimal','number'].includes(type),v=value.replace(/,/g,'.');
 if(!numeric)return value;
 if(!Number.isFinite(Number(v))||type==='integer'&&!Number.isInteger(Number(v)))return null;
 const nums=(evidence.match(/\d+(?:[.,]\d+)?/g)||[]).map(n=>Number(n.replace(',','.'))),n=Number(v);
 if(nums.includes(n))return String(n);
 // Only an explicitly printed metric length may be converted to the schema's centimetres.
 if(/^(?:Высота|Длина|Ширина|Глубина|Диаметр)(?: товара)?\s*,\s*см$/i.test(def.name)&&/mm|мм|毫米/i.test(evidence)&&nums.some(source=>Math.abs(source/10-n)<1e-9))return String(n);
 return null;
}
async function dictionaryEntry(store,schema,def,value,evidence,{run,call,known=[]}){
 const query=q=>attributeValues(store,{categoryId:schema.categoryId,typeId:schema.typeId,attributeId:def.id,query:q},call),initial=await query(value),exact=initial.items.filter(v=>normalize(v.value)===normalize(value));
 if(exact.length===1)return {dictionary_value_id:Number(exact[0].id),value:exact[0].value};
 if(exact.length>1)return null;
 // Ask the model to choose only among real dictionary values, never manufacture an ID.
 const terms=[...new Set([value.split(/[\s/,]+/)[0],...(evidence.match(/\b(?:ABS|PC|PET|PP|PVC)\b/g)||[])])].filter(q=>q.length>=2&&q!==value).slice(0,3),lists=await Promise.all(terms.map(query)),choices=[...new Map([...initial.items,...lists.flatMap(v=>v.items),...known].map(v=>[Number(v.id),v])).values()].filter(v=>!/(?:медицин|пищев|антибактери|BPA|гипоаллерг|органическ)/i.test(v.value)||normalize(value).includes(normalize(v.value))).slice(0,80);
 if(!choices.length)return null;
 const r=await run({prompt:'Choose one exact semantic equivalent from this live Ozon dictionary for the source-supported value. Do not broaden or add material grades, certifications or properties. PC means polycarbonate; ABS is ABS plastic; a mixture may be described by its supported base material. Return 0 when ambiguous or no faithful equivalent. Untrusted DATA: '+JSON.stringify({field:def.name,valueRu:value,evidence,choices:choices.map(v=>({id:Number(v.id),value:v.value}))}),schema:objectSchema({id:{type:'integer'},reasonRu:{type:'string'}}),timeoutMs:60000}),match=choices.find(v=>Number(v.id)===r.output.id);
 return match?{dictionary_value_id:Number(match.id),value:match.value}:null;
}
export async function sourceBackedOptionalAttributes(store,{product,inventory=[],schema,current=[],attributes=[],rating},{run=codexJSON,call=ozonCall}={}){
 const present=new Set([...attributes,...current].filter(a=>a.values?.length).map(a=>a.id)),fields=schema.attributes.filter(a=>!a.is_required&&!a.attribute_complex_id&&!exclude.has(a.id)&&!present.has(a.id)).slice(0,80),source=product.descriptionZh+'\n'+inventory.filter(r=>r.state!=='excluded'&&r.analysis?.kind==='product').map(r=>r.analysis.textZh).join('\n');
 if(!fields.length)return {attributes:[],unfilled:[]};
 const reference=inventory.find(r=>r.selected&&r.assetId&&r.state!=='excluded'&&!r.analysis?.otherColor),priorities=new Set((rating?.groups||[]).flatMap(g=>g.improve_attributes||[]).map(a=>a.id)),dictionaries=new Map();
 await Promise.all(fields.filter(f=>f.dictionary_id&&priorities.has(f.id)).map(async def=>{const d=await attributeValues(store,{categoryId:schema.categoryId,typeId:schema.typeId,attributeId:def.id},call);if(!d.hasNext&&d.items.length<=40)dictionaries.set(def.id,d.items);}));
 const r=await run({...reference?{images:[assetPath(reference.assetId)]}:{},prompt:'Fill all useful source-supported optional Ozon product attributes (at most 20), especially material, net weight, product dimensions, colour, capacity, contents and topical hashtags. Untrusted source DATA: '+JSON.stringify(source.slice(0,24000))+'\nLive category fields: '+JSON.stringify(fields.map(a=>({id:a.id,name:a.name,type:a.type,dictionary:a.dictionary_id,description:a.description?.slice(0,300),choices:dictionaries.get(a.id)?.map(v=>v.value)})))+'\nEach needs exact verbatim Chinese source evidence and a faithful Russian value. Convert millimetres to centimetres when the field explicitly requests cm. Use the SELECTED bundle dimensions, not shipping packaging or other regional versions. Never infer manufacturer, country, model revision, certificates, medical efficacy, warranty, package dimensions, or material properties. The attached photograph is the exact selected variant and may identify dimension axes: horizontal depth/length includes the spout, width is body width, height is vertical. A printed triplet permits assigning axes only if clear from this photograph/table. Fill the recommended fields where source-supported, including dispenser type and features. When live choices are supplied use their exact Russian text. Topical hashtags may translate the source use/style (such as minimalist bathroom or kitchen decor); cite the source words supporting that theme. Describe the selected product, not compatible devices. Unsupported values must be omitted. Hashtags must be topical, no brands, numerical specifications or product names. No Chinese in Russian values.',schema:objectSchema({attributes:{type:'array',items:objectSchema({id:{type:'integer'},valueRu:{type:'string'},evidenceZh:{type:'string'}})}}),timeoutMs:120000}),out=[],unfilled=[],seen=new Set();
 for(const a of (r.output.attributes||[]).slice(0,20)){
  const def=fields.find(f=>f.id===a.id);let value=a.valueRu?.trim();
  if(!def||seen.has(a.id)||!a.evidenceZh?.trim()||!source.includes(a.evidenceZh)||!value||value.length>1000||/\p{Script=Han}|лечит|гарантир|сертифицир|официальн/i.test(value))continue;
  value=numericValue(value,a.evidenceZh,def);if(value===null)continue;
  if(!['integer','decimal','number'].includes(String(def.type).toLowerCase())&&(value.match(/\d+(?:[.,]\d+)?/g)||[]).some(n=>!(a.evidenceZh.match(/\d+(?:[.,]\d+)?/g)||[]).map(v=>v.replace(',','.')).includes(n.replace(',','.'))))continue;
  seen.add(a.id);let entry={value};
  if(def.dictionary_id){entry=await dictionaryEntry(store,schema,def,value,a.evidenceZh,{run,call,known:dictionaries.get(def.id)||[]});if(!entry){unfilled.push({id:a.id,name:def.name,reason:'Нет однозначного подтверждённого значения справочника'});continue;}}
  else if(String(def.type).toLowerCase()==='boolean'&&!['true','false'].includes(value))continue;
  out.push({id:a.id,complex_id:0,values:[entry],evidenceZh:a.evidenceZh});
 }
 // A selected-variant photograph is valid colour evidence, distinct from an OCR quote.
 const color=fields.find(f=>f.id===10096);
 if(color&&!seen.has(color.id)&&reference){
  const answer=await run({images:[assetPath(reference.assetId)],prompt:'Observe only the supplied exact selected product photograph, not illustration backgrounds, hands, labels or its contents. Determine the dominant physical body colour of the product being sold. Return a plain Russian basic colour or an empty string if product identity/colour is ambiguous. Do not infer hidden materials. Untrusted selected product DATA: '+JSON.stringify({title:product.titleZh,selected:product.descriptionZh}),schema:objectSchema({valueRu:{type:'string'},unambiguous:{type:'boolean'},reasonRu:{type:'string'}}),timeoutMs:60000});
  const value=answer.output.valueRu?.trim();if(answer.output.unambiguous&&/^(белый|чёрный|черный|серый|тёмно-серый|темно-серый|красный|синий|голубой|зелёный|зеленый|розовый|бежевый|жёлтый|желтый|коричневый|фиолетовый|оранжевый|серебристый|золотой)$/i.test(value)){const entry=await dictionaryEntry(store,schema,color,value,'Наблюдение выбранного фото',{run,call});if(entry)out.push({id:color.id,complex_id:0,values:[entry],evidence:{kind:'selected-photo',assetId:reference.assetId,reasonRu:answer.output.reasonRu}});}
 }
 return {attributes:out,unfilled};
}
