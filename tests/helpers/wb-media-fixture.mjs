import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {Workspace} from '../../core/workspace.mjs';
import {DEMO_PRODUCT} from '../../core/canonical.mjs';
import {saveImage} from '../../adapters/media.mjs';
import {wbAccount} from '../../adapters/wb-api.mjs';
import {validateWbMapping,buildWbImportPayload} from '../../adapters/wb-products.mjs';
import {readWbMediaTarget,createWbMediaUpload} from '../../adapters/wb-media.mjs';
import {hash} from '../../core/repository.mjs';

export async function mediaFixture({onUpload}={}){
 const dir=await mkdtemp(join(tmpdir(),'wb-media-')),oldAssets=process.env.OPS_ASSET_DIR;process.env.OPS_ASSET_DIR=join(dir,'assets');
 const store={id:'wb-media-test',name:'合成测试店铺 · 无真实 API 请求',marketplace:'wb',mode:'live',wbRegion:'cn',wbContentTokenType:'personal'},credentials=async()=>({WB_API_TOKEN:'synthetic-media-token'}),account=()=>wbAccount(store,{getCredentials:credentials});
 const images=[];
 for(const [i,title] of ['30 л · Вместительный','Складной · Легко хранить'].entries()){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="${i?'#e8eddf':'#e9ece9'}"/><text x="50" y="140" font-family="Arial" font-size="46" fill="#263e35">${title}</text><rect x="150" y="380" width="600" height="500" rx="24" fill="#8fa29a"/><path d="M150 430 H750 M450 430 V880" stroke="#5b7568" stroke-width="10"/><text x="80" y="1100" font-family="Arial" font-size="32" fill="#263e35">SYNTHETIC TEST · NO REAL PRODUCT</text></svg>`;
  images.push({...await saveImage(await sharp(Buffer.from(svg)).png().toBuffer()),rightsConfirmed:true,translatedText:title});
 }
 const mapping={subjectId:100,attributes:[{id:1,value:['Полипропилен']}]};let card=null;const submissions=[];
 const read=async(s,path)=>path.includes('/charcs/')?{data:[{charcID:1,subjectID:100,subjectName:'Короба',name:'Материал',required:true,charcType:1,maxCount:1,existNamedField:false}]}:{cards:card?[card]:[],cursor:{total:card?1:0}};
 const state={store,credentials,account,images,submissions,read,get card(){return card;},set card(v){card=v;}};
 const upload=createWbMediaUpload({getCredentials:credentials,fetcher:async(url,options)=>{
  const n=Number(options.headers['X-Photo-Number']),blob=options.body.get('uploadfile'),bytes=Buffer.from(await blob.arrayBuffer());submissions.push({url,headers:options.headers,name:blob.name,bytes});
  const accept=()=>{card.photos[n-1]={big:`https://basket-01.wbbasket.ru/vol123/part12345/12345/images/big/${n}.webp`};};
  if(onUpload)return onUpload({n,accept,state});accept();return {ok:true,json:async()=>({error:false,errorText:'',additionalErrors:null})};
 }});
 const ws=new Workspace(join(dir,'workspace.json'),{stores:[store],wbMediaTarget:(s,p)=>readWbMediaTarget(s,p,{read,accountRef:account}),wbMediaUpload:upload,wbMediaWait:async()=>{}});await ws.init();
 const j=await ws.importProduct({storeId:store.id,product:{...DEMO_PRODUCT,sku:'TEST-WB-MEDIA',itemId:'123456789',sourceUrl:'https://item.taobao.com/item.htm?id=123456789',titleZh:'合成收纳盒 · 图片上传测试',images:images.map(i=>({...i,url:'https://example.com/synthetic.png'}))}});
 await ws.repo.mutate(db=>Object.assign(db.jobs.find(x=>x.id===j.id),{state:'imported',mapping,artifacts:{translate:{output:{title:'Складной короб',description:'Короб из полипропилена, 30 л.'}},image_edit:{output:{images}},map_attributes:{output:null},validate:{output:{passed:true,issues:[]}}},publishConfig:{brand:'',length:30,width:20,height:10,weightBrutto:'0.5',sizes:[{techSize:'0',skus:['1234567890123']}],documents:{excludeDocuments:true},kizMarked:false,rightsConfirmed:true,complianceConfirmed:true,contentReviewed:true},importResult:{imported:true,productId:12345,photosCount:0},wbPublicationStage:'images_pending'}));
 const verified=await validateWbMapping(store,mapping,{read});await ws.repo.mutate(db=>db.jobs.find(x=>x.id===j.id).artifacts.map_attributes.output=verified);
 const job=await ws.getJob(j.id),body=buildWbImportPayload(job),payload={marketplace:'wb',jobId:j.id,revision:job.revision,apiBody:body,wbContext:{accountRef:await account()}};
 card={nmID:12345,subjectID:100,...structuredClone(body[0].variants[0]),photos:[]};
 const publication={id:'synthetic-publication',kind:'publish',storeId:store.id,state:'verified',mode:'live',payload,payloadHash:hash(payload)};
 await ws.repo.mutate(db=>db.operations.push(publication));
 return Object.assign(state,{ws,id:j.id,publication,dir,cleanup:async()=>{if(oldAssets===undefined)delete process.env.OPS_ASSET_DIR;else process.env.OPS_ASSET_DIR=oldAssets;await rm(dir,{recursive:true,force:true});}});
}
