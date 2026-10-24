import test from 'node:test';
import assert from 'node:assert/strict';
import {mapStudioOzon} from '../core/studio-ozon.mjs';
const permission='Уникальный код детали. Если у товара нет партномера, укажите код продавца';
async function mapping({description=permission,id=7236,name='Партномер (артикул производителя)',sku='TB-671986030275-5010440571503',number}={}){
 const product={sku,titleZh:'摩托车火花塞',descriptionZh:'已选规格：火花塞1个',attributes:number?{'Партномер':number}:{}};
 let phase=0;
 return mapStudioOzon({}, {product,content:{output:{title:'Свеча зажигания',description:'Одна свеча.'}}}, {
  run:async()=>({output:++phase===1?{typeId:95765}:{attributes:number?[{id,value:number,evidence:number}]:[],missing:[]}}),
  call:async(store,path,body,options)=>{assert.notEqual(options?.write,true);if(path.endsWith('/tree'))return {result:[{description_category_id:17028756,children:[{type_id:95765,type_name:'Свеча зажигания'}]}]};assert.ok(path.endsWith('/attribute'));return {result:[{id,name,description,is_required:true,dictionary_id:0}]};}
 });
}
test('live permission allows an existing seller code without fabricating an OEM number',async()=>{
 const m=await mapping();assert.deepEqual(m.attributes,[{id:7236,values:[{value:'TB-671986030275-5010440571503'}]}]);
});
test('seller code fallback requires the specific field and explicit live permission',async()=>{
 await assert.rejects(mapping({description:'Укажите только артикул производителя'}),/Не хватает подтверждённых данных/);
 await assert.rejects(mapping({id:999}),/Не хватает подтверждённых данных/);
 await assert.rejects(mapping({sku:''}),/Не хватает подтверждённых данных/);
});
test('an evidenced manufacturer number takes precedence over the seller code',async()=>{
 const m=await mapping({number:'EXAMPLE-123'});assert.equal(m.attributes[0].values[0].value,'EXAMPLE-123');
});
test('live grouping permission uses a unique seller key without inventing a technical model',async()=>{
 const m=await mapping({id:9048,name:'Название модели (для объединения в одну карточку)',description:'Заполните данное поле любым одинаковым значением на товарах, которые хотите объединить.'});assert.equal(m.attributes[0].id,9048);assert.equal(m.attributes[0].values[0].value,'TB-671986030275-5010440571503');
 await assert.rejects(mapping({id:9048,name:'Модель',description:'Укажите модель производителя'}),/Не хватает подтверждённых данных/);
});
