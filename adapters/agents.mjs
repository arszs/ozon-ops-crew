import {validateWbMapping,buildWbImportPayload} from './wb-products.mjs';
import {localize} from './codex.mjs';
import {processImages} from './media.mjs';
import {validateMapping,buildImportPayload} from './ozon-products.mjs';
import {canonical,DEMO_LOCALIZATION} from '../core/canonical.mjs';
import {dictionaries} from './marketplaces.mjs';
export const STAGES=['extract','translate','image_edit','map_attributes','validate'];
export async function runAgent(stage,job,store){
 const p=job.canonical;switch(stage){
 case 'extract':return {agent:'Ingestion Agent',tool:'canonical.normalize',output:canonical({...p,sourceUrl:p.source.url,itemId:p.source.itemId})};
 case 'translate':{
  if(job.mode!=='mock'&&!p.localized){const result=await localize(p,{marketplace:store.marketplace});return {agent:'Localization Agent',tool:'codex.subscription.localize',...result,output:{...result.output,version:(job.translationVersion||0)+1}};}
  const localized=job.mode==='mock'?structuredClone(DEMO_LOCALIZATION):p.localized;
  if(!localized?.title||!localized?.description||!localized?.attributes)throw Error('需要俄语译文：未连接翻译模型。可在结构化导出 localized 中提供人工译文。');
  return {agent:'Localization Agent',tool:job.mode==='mock'?'fixture.localization':'provided.localization',prompt:'仅使用源商品事实；不添加未经证实的品牌、认证或功效。',output:{...localized,version:(job.translationVersion||0)+1,provenance:job.mode==='mock'?'mock':'user_supplied',glossary:job.glossary||{}}};
 }
 case 'image_edit':{
  if(job.mode!=='mock')return {agent:'Image Agent',tool:'codex.vision.flat_text_render',output:await processImages(p)};
  return {agent:'Image Agent',tool:'demo.infographic.svg',output:{mode:'mock',ocrVerified:false,images:[0,1].map(i=>({sourceText:p.images[i]?.textZh||'',translatedText:job.artifacts.translate.output.imageTexts[i],url:`/api/workspace/jobs/${job.id}/image/${i}`,width:900,height:1200,rightsConfirmed:true})),notice:'演示模板重绘；不是对淘宝原图的真实 OCR 或修图'}};
 }
 case 'map_attributes':{
  if(job.mode!=='mock'&&(store.mode==='live'||job.mapping)){if(store.marketplace==='wb')return {agent:'Category Mapping Agent',tool:'wb.characteristics.verify',output:await validateWbMapping(store,job.mapping||p.mapping)};return {agent:'Category Mapping Agent',tool:'ozon.attributes.verify',output:await validateMapping(job.mode==='sample'?{id:'ozon-live',marketplace:'ozon',mode:'live'}:store,job.mapping||p.mapping)};}
  const dictionary=await dictionaries(store,p.categoryZh);
  return {agent:'Category Mapping Agent',tool:'marketplace.dictionary',output:{category:dictionary.items[0],confidence:0.86,confidenceKind:'demo_heuristic_not_calibrated',dictionarySource:dictionary.source,attributes:job.artifacts.translate.output.attributes,firstCategoryReview:true}};
 }
 case 'validate':{
  const localized=job.artifacts.translate.output,category=job.artifacts.map_attributes.output.category,issues=[];
  if(store.mode==='live'){try{if(store.marketplace==='wb')buildWbImportPayload(job);else buildImportPayload(job);}catch(e){issues.push({level:'error',field:'publication',message:e.message});}for(const word of job.bannedWords||[])if((localized.title+' '+localized.description).toLowerCase().includes(word.toLowerCase()))issues.push({level:'error',field:'content',message:'禁用词：'+word});return {agent:'Compliance Agent',tool:store.marketplace==='wb'?'wb.payload.validate':'ozon.payload.validate',output:{passed:!issues.length,issues:[...issues,{level:'review',message:'特征结构已核验；商品事实、证件、权利与平台审核仍需核对'}],rulesSource:store.marketplace==='wb'?'live WB characteristics + local draft guards':'live Ozon attributes + local payload guards',liveRulesVerified:false}};}
  if(localized.title.length>category.titleLimit)issues.push({level:'error',field:'title',message:`标题超过演示限制 ${category.titleLimit}`});
  for(const k of (job.artifacts.map_attributes.output.schema?[]:category.required))if(!localized.attributes[k])issues.push({level:'error',field:k,message:'缺少必填属性'});
  for(const word of job.bannedWords||[])if((localized.title+' '+localized.description).toLowerCase().includes(word.toLowerCase()))issues.push({level:'error',field:'content',message:'含禁用品牌词：'+word});
  if(!p.images.every(i=>i.rightsConfirmed))issues.push({level:'error',field:'images',message:'未确认图片版权'});
  issues.push({level:'review',field:'certification',message:'认证、商标及图片标识需要人工确认；不构成合规保证'});
  return {agent:'Compliance Agent',tool:'rules.validate',output:{passed:!issues.some(i=>i.level==='error'),issues,rulesSource:'mock-snapshot-2026-10-12',liveRulesVerified:false}};
 }
 default:throw Error('Unknown stage');
 }
}
