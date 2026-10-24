import test from 'node:test';import assert from 'node:assert/strict';import {studioCategoryChoices,motorcycleCategoryConflict} from '../core/studio-categories.mjs';
test('a dedicated motorcycle switch category survives a large automotive shortlist and prevents a car-interior mapping',()=>{const car=Array.from({length:50},(_,i)=>({id:i,categoryId:1,name:'Переключатель салона автомобиля '+i})),motor={id:99,categoryId:2,name:'Переключатель для мототехники'},product={titleZh:'CFMOTO摩托车右手把开关',descriptionZh:'800NK'};assert.deepEqual(studioCategoryChoices([...car,motor],['переключателей'],product).map(c=>c.id),[99]);assert.ok(motorcycleCategoryConflict(product,car[0].name));assert.equal(motorcycleCategoryConflict(product,motor.name),false);assert.equal(studioCategoryChoices([...car,motor],['переключателей'],{titleZh:'汽车配件'}).length,35);});
test('category correction is verified only after live Ozon category and type both match the requested target',async()=>{const {reconcileStudioOzon}=await import('../core/studio-ozon.mjs');let task={state:'submitted',jobId:'j',categoryRepair:{categoryId:200,typeId:300,state:'accepted'},mediaEnhancement:{state:'ready',autoApplyBlocked:true}},result={imported:true,buyerUrl:'https://www.ozon.ru/product/1/',platformErrors:[],platformStatus:{is_created:true},categoryId:20,typeId:30};const studio={get:async()=>structuredClone(task),set:async(id,patch)=>(Object.assign(task,patch),structuredClone(task)),ws:{getJob:async()=>({state:'imported'}),syncPublished:async()=>({state:'imported',importResult:result})}};await reconcileStudioOzon(studio,'t');assert.equal(task.state,'submitted');assert.equal(task.categoryRepair.state,'accepted');result={...result,categoryId:200,typeId:300};await reconcileStudioOzon(studio,'t');assert.equal(task.state,'published');assert.equal(task.categoryRepair.state,'verified');});

test('camera glasses require their own live type and never fall back to VR, optical frames or unrelated kits',()=>{const product={titleZh:'夸克AI眼镜G1智能眼镜运动相机拍照',descriptionZh:'标准套装'},leaves=[{id:1,name:'VR-очки'},{id:2,name:'Очки без диоптрий'},{id:3,name:'Комплект охранной системы'},{id:4,name:'Очки с камерой'}];assert.deepEqual(studioCategoryChoices(leaves,['очки','комплект'],product).map(c=>c.id),[4]);assert.deepEqual(studioCategoryChoices(leaves.slice(0,3),['очки'],product),[]);});

const ignitionTitle='原厂春风摩托车250NK SR CLX CLC火花塞点火线圈高压包帽点火器';
const sparkProduct={titleZh:ignitionTitle,categoryZh:'摩托车火花塞',descriptionZh:ignitionTitle+'\n商品类型：火花塞\n数量：1个\n已选规格：【原装火花塞1个】',localized:{attributes:{'Тип':'Свеча зажигания'}}};
const sharedSpark={id:95765,categoryId:17028756,name:'Свеча зажигания',path:'Автомобильные товары / Запчасти'};
const genericMoto={id:42,categoryId:500,name:'Система зажигания для мототехники'};

test('an explicitly selected motorcycle spark plug retains the exact shared live type ahead of generic motorcycle matches',()=>{
 const generic=Array.from({length:50},(_,i)=>({...genericMoto,id:1000+i})),leaves=[...generic,sharedSpark];
 const choices=studioCategoryChoices(leaves,['свеча','зажигания','мотоциклов'],sparkProduct);
 assert.equal(choices.length,35);assert.equal(choices[0].id,95765);assert.equal(choices[0].categoryId,17028756);
 const dedicated={id:700,categoryId:701,name:'Свеча зажигания для мототехники'};
 assert.deepEqual(studioCategoryChoices([...leaves,dedicated],['зажигания'],sparkProduct).slice(0,2).map(c=>c.id),[700,95765]);
 assert.deepEqual(studioCategoryChoices([...leaves,dedicated],['cfmoto'],sparkProduct).map(c=>c.id),[700,95765]);
 // Exact selected type evidence also works when the title keywords do not match the shared leaf.
 assert.equal(studioCategoryChoices(leaves,['мототехники'],sparkProduct)[0].id,95765);
});

test('only the selected category, selected option or exact localized type can identify the shared spark plug',()=>{
 const leaves=[genericMoto,sharedSpark],base={titleZh:ignitionTitle,categoryZh:'摩托车配件'},selected=[
  {...base,categoryZh:'摩托车火花塞'},
  {...base,descriptionZh:ignitionTitle+'\n已选规格：【原装火花塞1个】'},
  {...base,localized:{attributes:{'Тип':'Свеча зажигания'}}}
 ];
 for(const product of selected)assert.equal(studioCategoryChoices(leaves,['зажигания'],product)[0].id,95765);
 const coil={...base,categoryZh:'摩托车点火线圈',descriptionZh:ignitionTitle+'\n商品类型：点火线圈\n已选规格：【原装高压包1个】',localized:{attributes:{'Тип':'Катушка зажигания'}}};
 const kit={...sparkProduct,descriptionZh:ignitionTitle+'\n商品类型：火花塞\n已选规格：【原装高压包1个+原装火花塞1个】'};
 for(const product of [base,coil,kit]){
  assert.deepEqual(studioCategoryChoices(leaves,['зажигания'],product).map(c=>c.id),[42]);
  assert.equal(motorcycleCategoryConflict(product,'Автомобильные товары / Свеча зажигания',sharedSpark.name),true);
 }
});

test('the shared automotive path exception requires the exact spark plug leaf and preserves motorcycle switch and coil restrictions',()=>{
 const fullPath=sharedSpark.path+' / '+sharedSpark.name;
 assert.equal(motorcycleCategoryConflict(sparkProduct,fullPath,sharedSpark.name),false);
 assert.equal(motorcycleCategoryConflict(sparkProduct,fullPath),true);
 for(const leaf of ['Катушка зажигания','Переключатель','Свеча зажигания для автомобиля','Комплект свечей зажигания'])assert.equal(motorcycleCategoryConflict(sparkProduct,'Автомобильные товары / Свеча зажигания / '+leaf,leaf),true);
 assert.equal(motorcycleCategoryConflict({titleZh:'CFMOTO摩托车右手把开关'},fullPath,sharedSpark.name),true);
});

test('real Ozon mapping offers and accepts the exact shared spark type from the live tree without a motorcycle-specific spark type',async()=>{
 const {mapStudioOzon}=await import('../core/studio-ozon.mjs');
 const task={product:sparkProduct,content:{output:{title:'Свеча зажигания для мотоциклов CFMOTO, 1 шт.',description:'Выбрана одна свеча зажигания.'}}};
 const attempts=[];
 const call=async(store,path,body,options)=>{
  assert.notEqual(options?.write,true);attempts.push(path);
  if(path==='/v1/description-category/tree')return {result:[{description_category_id:17028756,category_name:'Автомобильные товары',children:[{type_id:95765,type_name:'Свеча зажигания'}]},{description_category_id:500,category_name:'Мототехника',children:[{type_id:42,type_name:genericMoto.name}]}]};
  assert.equal(path,'/v1/description-category/attribute');assert.equal(body.description_category_id,17028756);assert.equal(body.type_id,95765);return {result:[]};
 };
 let phase=0;
 const run=async({prompt,schema})=>{
  if(++phase===1){assert.ok(schema.properties.typeId.enum.includes(95765));assert.ok(prompt.includes('"name":"Свеча зажигания"'));return {output:{typeId:95765,reason:'Точный выбранный тип'}};}
  return {output:{attributes:[],missing:[]}};
 };
 const mapping=await mapStudioOzon({},task,{call,run});assert.deepEqual(mapping,{categoryId:17028756,typeId:95765,name:'Свеча зажигания',attributes:[]});assert.equal(phase,2);assert.equal(attempts.length,2);
});
