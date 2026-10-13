import {wbRead,wbAccount,wbRegion} from './wb-api.mjs';
import {wbCharacteristics} from './wb-content.mjs';
import {storeCredentials} from './marketplaces.mjs';
import {hash} from '../core/repository.mjs';

const id=v=>{if(!Number.isSafeInteger(Number(v))||Number(v)<=0)throw Error('WB 标识无效');return Number(v);};
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||[...v].length>max)throw Error(label+'不能为空或超过 '+max+' 字符');return v.trim();};
const directories={'цвет':'colors','пол':'kinds','страна производства':'countries','сезон':'seasons','ставка ндс':'vat','тнвэд':'tnved','тн вэд':'tnved'};
const documentTypes={1:[15001136,15001137,15001138],2:[15001135,15001137,15001138],3:[62945173,15000785,15004302],4:[15001574,15002355,15002356,15002357],5:[15003071,15003939],7:[15003924,15003925],8:[15003920,15003921],9:[1897013,15004284]};
const docIds=new Set(Object.values(documentTypes).flat());
export const wbSchemaHash=s=>hash({subjectId:s.subjectId,items:s.items});

export async function validateWbMapping(store,mapping,{read=wbRead}={}){
 const schema=await wbCharacteristics(store,id(mapping?.subjectId),{read,locale:'ru'});
 if(!schema.items.length)throw Error('WB 未返回此类目的特征，不能核验映射');
 if(!Array.isArray(mapping?.attributes)||mapping.attributes.length>200)throw Error('请填写 WB 商品特征');
 const ids=new Set(),attributes=[],dictionaryEvidence=[];
 for(const a of mapping.attributes){
  const def=schema.items.find(d=>d.id===id(a.id));if(!def||ids.has(def.id)||def.namedField||def.type===0)throw Error('WB 未知、重复或非 characteristics 特征');ids.add(def.id);
  let value;if(def.type===1){if(!Array.isArray(a.value)||!a.value.length||a.value.length>100||def.maxCount>0&&a.value.length>def.maxCount)throw Error('WB 特征数量无效：'+def.name);value=a.value.map(v=>text(v,1000,def.name));if(new Set(value).size!==value.length)throw Error('WB 特征值重复：'+def.name);}
  else if(def.type===4){if(typeof a.value!=='number'||!Number.isFinite(a.value)||Math.abs(a.value)>1e12)throw Error('WB 数值特征无效：'+def.name);value=a.value;}
  else throw Error('WB 特征类型尚不支持：'+def.name);
  const directory=directories[def.name.trim().toLowerCase()];
  if(directory){const path='/content/v2/directory/'+directory+'?'+new URLSearchParams(directory==='tnved'?{subjectID:String(schema.subjectId)}:{locale:'ru'}),r=await read(store,path);if(!Array.isArray(r.data))throw Error('WB 特征值字典格式无效');
   const values=Array.isArray(value)?value:[String(value)];for(const v of values){const entry=r.data.find(d=>typeof d==='string'?d===v:(d.name===v||d.tnved===v));if(!entry)throw Error('WB 字典中未找到值：'+def.name+' / '+v);if(directory==='tnved'&&entry.isKiz===true)dictionaryEvidence.push({id:def.id,value:v,requiresKiz:true});}
   dictionaryEvidence.push({id:def.id,directory,hash:hash(r.data)});
  }
  attributes.push({id:def.id,value});
 }
 const missing=schema.items.filter(d=>d.required&&!d.namedField&&!docIds.has(d.id)&&d.type!==0&&!ids.has(d.id));if(missing.length)throw Error('缺少 WB 必填特征：'+missing.map(d=>d.name+' ['+d.id+']').join('、'));
 return {category:{id:schema.subjectId,name:schema.subjectName||String(schema.subjectId),required:schema.items.filter(d=>d.required).map(d=>d.name)},attributes,schema,schemaHash:wbSchemaHash(schema),dictionaryEvidence,confidence:1,confidenceKind:'human_mapping_schema_checked',dictionarySource:schema.source};
}

function documents(config,schema){
 if(config.documents?.excludeDocuments===true){if(config.documents.items?.length)throw Error('不能同时声明免证与填写证件');return {excludeDocuments:true};}
 const items=config.documents?.items;if(!Array.isArray(items)||!items.length||items.length>20)throw Error('请提供所需证件，或明确确认此商品不需要证件');
 return {excludeDocuments:false,items:items.map(d=>{
  if(!documentTypes[d.type]?.some(x=>schema.items.some(a=>a.id===x)))throw Error('WB 此类目未提供该证件类型');
  const out={type:id(d.type),number:text(d.number,300,'证件编号')};
  for(const k of ['productNumber','tradeName','applicant'])if(d[k])out[k]=text(d[k],500,'证件资料');
  for(const k of ['startDate','endDate'])if(d[k]){if(typeof d[k]!=='string'||!/^\d{4}-\d\d-\d\dT/.test(d[k])||!Number.isFinite(Date.parse(d[k])))throw Error('证件日期需要 ISO 日期时间');out[k]=d[k];}
  if(typeof d.isEndless!=='boolean'||!out.startDate||!d.isEndless&&!out.endDate)throw Error('请明确证件有效期');out.isEndless=d.isEndless;
  if(out.endDate&&Date.parse(out.endDate)<=Date.parse(out.startDate))throw Error('证件截止日期无效');return out;
 })};
}
export function buildWbImportPayload(job){
 const t=job.artifacts.translate?.output,m=job.artifacts.map_attributes?.output,c=job.publishConfig;
 if(!m?.schema||m.schema.subjectId!==Number(m.category.id)||m.schemaHash!==wbSchemaHash(m.schema))throw Error('WB 类目特征尚未核验');
 if(!c||!['rightsConfirmed','complianceConfirmed','contentReviewed'].every(k=>c[k]===true))throw Error('请确认 WB 商品权利、合规和俄语资料');
 const variant={vendorCode:text(job.canonical.sku,72,'卖家货号'),title:text(t?.title,60,'WB 标题'),description:text(t?.description,1000,'本工具 WB 描述'),brand:typeof c.brand==='string'?c.brand.trim():'',dimensions:{},characteristics:structuredClone(m.attributes)};
 if(variant.brand.length>100)throw Error('品牌过长');
 for(const k of ['length','width','height'])variant.dimensions[k]=id(c[k]);
 if(!/^\d+(\.\d{1,3})?$/.test(String(c.weightBrutto))||Number(c.weightBrutto)<=0||Number(c.weightBrutto)>10000)throw Error('包装重量需要正数 kg，最多三位小数');variant.dimensions.weightBrutto=Number(c.weightBrutto);
 if(!Array.isArray(c.sizes)||!c.sizes.length||c.sizes.length>100)throw Error('请填写实际尺码与条码');
 const sizes=new Set(),barcodes=new Set();variant.sizes=c.sizes.map(s=>{
  const techSize=text(s.techSize,50,'商品尺码'),wbSize=typeof s.wbSize==='string'?s.wbSize.trim():'';if(wbSize.length>50||sizes.has(techSize))throw Error('WB 尺码重复或过长');sizes.add(techSize);
  if(!Array.isArray(s.skus)||!s.skus.length||s.skus.length>20)throw Error('请填写已核对的条码；本流程不会自动生成');
  const skus=s.skus.map(v=>{if(typeof v!=='string'||!/^\d{8,30}$/.test(v)||barcodes.has(v))throw Error('条码需要 8–30 位数字且不能重复');barcodes.add(v);return v;});return {techSize,...(wbSize?{wbSize}:{}),skus};
 });
 if(typeof c.kizMarked!=='boolean')throw Error('请明确标识码确认状态');variant.kizMarked=c.kizMarked;
 if(m.dictionaryEvidence?.some(e=>e.requiresKiz)&&!variant.kizMarked)throw Error('所选商品编码需要标识码，请核实后确认');
 variant.documents=documents(c,m.schema);
 const named={'бренд':()=>!!variant.brand,'наименование':()=>true,'описание':()=>true,'размер':()=>variant.sizes.every(s=>s.techSize),'российский размер':()=>variant.sizes.every(s=>s.wbSize),'длина упаковки':()=>true,'ширина упаковки':()=>true,'высота упаковки':()=>true,'вес с упаковкой (кг)':()=>true};
 for(const d of m.schema.items.filter(d=>d.required&&d.namedField&&!docIds.has(d.id)))if(!named[d.name.toLowerCase()]?.())throw Error('请填写 WB 必填独立资料：'+d.name);
 // The creation API's size price is RUB. Do not copy a Chinese source price or infer the account currency.
 return [{subjectID:id(m.category.id),variants:[variant]}];
}

export async function findWbCard(store,vendorCode,{read=wbRead,accountRef,trash=false}={}){
 const d=await read(store,trash?'/content/v2/get/cards/trash':'/content/v2/get/cards/list',{settings:{cursor:{limit:100},filter:{textSearch:vendorCode,...(trash?{}:{withPhoto:-1})}}},{accountRef});
 if(!Array.isArray(d.cards)||!Number.isSafeInteger(d.cursor?.total)||d.cursor.total!==d.cards.length||d.cards.length>=100)throw Error('WB 查询结果不完整，不能判断货号是否存在');
 const exact=d.cards.filter(c=>c.vendorCode===vendorCode);if(exact.length>1)throw Error('WB 货号对应多个商品，需要人工核对');return exact[0]||null;
}
export function checkWbWriteProfile(store){if(!['personal','service','base-with-secret'].includes(store.wbContentTokenType))throw Error('请在私有连接配置中核实 wbContentTokenType；创建流程支持 personal / service / base-with-secret');}
export async function preflightWbImport(store,job,{read=wbRead,accountRef=wbAccount,clock=()=>Date.now()}={}){
 checkWbWriteProfile(store);const owner=await accountRef(store),rawRead=read;read=(s,p,b,o={})=>rawRead(s,p,b,{...o,accountRef:owner});const mapping=await validateWbMapping(store,job.mapping,{read});
 if(mapping.schemaHash!==job.artifacts.map_attributes.output.schemaHash||hash(mapping.attributes)!==hash(job.artifacts.map_attributes.output.attributes))throw Error('WB 类目要求已变化，请重新映射并确认');
 const body=buildWbImportPayload({...job,artifacts:{...job.artifacts,map_attributes:{...job.artifacts.map_attributes,output:mapping}}}),vendorCode=body[0].variants[0].vendorCode;
 if(await findWbCard(store,vendorCode,{read,accountRef:owner})||await findWbCard(store,vendorCode,{read,accountRef:owner,trash:true}))throw Error('WB 已有此货号或回收站记录；不覆盖现有商品');
 const limits=await read(store,'/content/v2/cards/limits',undefined,{accountRef:owner});if(!Number.isSafeInteger(limits.data?.freeLimits)||limits.data.freeLimits<1)throw Error('WB 没有可用免费创建额度；不会自动使用付费额度');
 if(await accountRef(store)!==owner)throw Error('WB 账户已变化');
 return {accountRef:owner,checkedAt:new Date(clock()).toISOString(),schemaHash:mapping.schemaHash,freeLimits:limits.data.freeLimits,payloadHash:hash(body),region:wbRegion(store)};
}

export function createWbImportSubmit({read=wbRead,accountRef=wbAccount,getCredentials=storeCredentials,fetcher=fetch,clock=()=>Date.now()}={}){
 return async(store,operation,job)=>{
  const p=operation.payload;let c,owner;
  try{
   if(store.marketplace!=='wb'||store.mode!=='live'||operation.kind!=='publish'||operation.approvedHash!==operation.payloadHash||operation.payloadHash!==hash(p))throw Error('WB 发布审批无效');
   if(clock()-Date.parse(p.wbContext?.checkedAt)>900000||clock()-Date.parse(operation.approvedAt)>900000||!Number.isFinite(Date.parse(p.wbContext?.checkedAt))||!Number.isFinite(Date.parse(operation.approvedAt)))throw Error('WB 发布确认已过期，请重新拟定');
   const fresh=await preflightWbImport(store,job,{read,accountRef,clock});owner=fresh.accountRef;
   if(owner!==p.wbContext.accountRef||fresh.payloadHash!==hash(p.apiBody)||fresh.schemaHash!==p.wbContext.schemaHash)throw Error('WB 账户或发布内容已变化');
   c=await getCredentials(store);if(await wbAccount(store,{getCredentials:async()=>c})!==owner)throw Error('WB 账户已变化');
   if(clock()-Date.parse(p.wbContext.checkedAt)>900000||clock()-Date.parse(operation.approvedAt)>900000)throw Error('WB 发布确认已过期，请重新拟定');
  }catch(e){e.noWrite=true;throw e;}
  // One attempt only. Any failure after fetch starts needs read-back, never automatic retry.
  let response;try{response=await fetcher('https://content-api.wildberries.'+wbRegion(store)+'/content/v2/cards/upload',{method:'POST',headers:{Authorization:c.WB_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(p.apiBody),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('WB 创建响应不确定，请查询货号，禁止重复提交');}
  if(!response.ok){const e=Error('WB 创建 HTTP '+response.status+'；请查询货号后核对');if(response.status===429){const seconds=Number(response.headers?.get('Retry-After')||response.headers?.get('X-Ratelimit-Retry')||60);e.retryAt=clock()+Math.max(60,Number.isFinite(seconds)?seconds:60)*1000;}throw e;}
  let d;try{d=await response.json();}catch{throw Error('WB 创建响应格式不明，请查询货号');}
  if(d?.error!==false||d.errorText||d.additionalErrors&&Object.keys(d.additionalErrors).length)throw Error('WB 未明确接受创建，请查询货号与平台错误');
  if(await accountRef(store)!==owner)throw Error('WB 账户已变化，创建结果需核对原账户');
  return {mode:'live',marketplace:'wb',externalWrite:true,status:'submitted',vendorCode:p.apiBody[0].variants[0].vendorCode,accountRef:owner,payloadHash:operation.payloadHash,imagesSubmitted:false,moderationVerified:false};
 };
}
export const submitWbImport=createWbImportSubmit();

export async function wbImportStatus(store,operation,{read=wbRead,accountRef=wbAccount}={}){
 const owner=await accountRef(store);if(owner!==operation.payload.wbContext.accountRef)throw Error('WB 账户已变化，请使用原连接核对');
 const expected=operation.payload.apiBody[0],wanted=expected.variants[0],card=await findWbCard(store,wanted.vendorCode,{read,accountRef:owner});
 if(await accountRef(store)!==owner)throw Error('WB 账户已变化');
 if(!card)return {status:'pending',imported:false,moderationVerified:false,imagesSubmitted:false,message:'WB 尚未返回此货号；创建可能需要 30 分钟。请在 WB 草稿错误列表核对，不要重复提交。'};
 const match=wbCardMatches(card,expected);
 const productId=id(card.nmID);return {status:match?'card_observed':'mismatch',imported:match,productId,vendorCode:wanted.vendorCode,cardHash:hash(card),photosCount:Array.isArray(card.photos)?card.photos.length:null,imagesSubmitted:false,moderationVerified:false,message:match?'已读取到匹配商品卡片；图片、价格、库存及平台审核仍需完成。':'此货号的内容与确认版本不同；不要覆盖或重复提交。'};
}

export function wbCardMatches(card,expected){const wanted=expected.variants[0];return card.subjectID===expected.subjectID&&card.title===wanted.title&&card.description===wanted.description&&(card.brand||'')===wanted.brand&&Object.entries(wanted.dimensions).every(([k,v])=>card.dimensions?.[k]===v)&&wanted.characteristics.every(a=>card.characteristics?.some(x=>x.id===a.id&&hash(x.value)===hash(a.value)))&&card.sizes?.length===wanted.sizes.length&&wanted.sizes.every(s=>card.sizes.some(x=>x.techSize===s.techSize&&(!s.wbSize||x.wbSize===s.wbSize)&&x.skus?.length===s.skus.length&&s.skus.every(b=>x.skus.includes(b))));}
