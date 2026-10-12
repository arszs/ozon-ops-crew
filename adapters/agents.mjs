import {canonical,DEMO_LOCALIZATION} from '../core/canonical.mjs';
import {dictionaries} from './marketplaces.mjs';
export const STAGES=['extract','translate','image_edit','map_attributes','validate'];
export async function runAgent(stage,job,store){
 const p=job.canonical;switch(stage){
 case 'extract':return {agent:'Ingestion Agent',tool:'canonical.normalize',output:canonical({...p,sourceUrl:p.source.url,itemId:p.source.itemId})};
 case 'translate':{
  const localized=job.mode==='mock'?structuredClone(DEMO_LOCALIZATION):p.localized;
  if(!localized?.title||!localized?.description||!localized?.attributes)throw Error('需要俄语译文：未连接翻译模型。可在结构化导出 localized 中提供人工译文。');
  return {agent:'Localization Agent',tool:job.mode==='mock'?'fixture.localization':'provided.localization',prompt:'仅使用源商品事实；不添加未经证实的品牌、认证或功效。',output:{...localized,version:(job.translationVersion||0)+1,provenance:job.mode==='mock'?'mock':'user_supplied',glossary:job.glossary||{}}};
 }
 case 'image_edit':{
  if(job.mode!=='mock')throw Error('OCR/图像编辑服务未连接。真实图片需要人工核验与处理。');
  return {agent:'Image Agent',tool:'demo.infographic.svg',output:{mode:'mock',ocrVerified:false,images:[0,1].map(i=>({sourceText:p.images[i]?.textZh||'',translatedText:job.artifacts.translate.output.imageTexts[i],url:`/api/workspace/jobs/${job.id}/image/${i}`,width:900,height:1200,rightsConfirmed:true})),notice:'演示模板重绘；不是对淘宝原图的真实 OCR 或修图'}};
 }
 case 'map_attributes':{
  const dictionary=await dictionaries(store,p.categoryZh);if(job.mode!=='mock')throw Error('真实品类需从 API 字典人工选择；禁止虚构 ID');
  return {agent:'Category Mapping Agent',tool:'marketplace.dictionary',output:{category:dictionary.items[0],confidence:0.86,confidenceKind:'demo_heuristic_not_calibrated',dictionarySource:dictionary.source,attributes:job.artifacts.translate.output.attributes,firstCategoryReview:true}};
 }
 case 'validate':{
  const localized=job.artifacts.translate.output,category=job.artifacts.map_attributes.output.category,issues=[];
  if(localized.title.length>category.titleLimit)issues.push({level:'error',field:'title',message:`标题超过演示限制 ${category.titleLimit}`});
  for(const k of category.required)if(!localized.attributes[k])issues.push({level:'error',field:k,message:'缺少必填属性'});
  for(const word of job.bannedWords||[])if((localized.title+' '+localized.description).toLowerCase().includes(word.toLowerCase()))issues.push({level:'error',field:'content',message:'含禁用品牌词：'+word});
  if(!p.images.every(i=>i.rightsConfirmed))issues.push({level:'error',field:'images',message:'未确认图片版权'});
  issues.push({level:'review',field:'certification',message:'认证、商标及图片标识需要人工确认；不构成合规保证'});
  return {agent:'Compliance Agent',tool:'rules.validate',output:{passed:!issues.some(i=>i.level==='error'),issues,rulesSource:'mock-snapshot-2026-10-12',liveRulesVerified:false}};
 }
 default:throw Error('Unknown stage');
 }
}
