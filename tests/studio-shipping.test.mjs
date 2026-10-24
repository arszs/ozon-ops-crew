import test from 'node:test';import assert from 'node:assert/strict';
import {studioShipping,annotateStudioShipping} from '../core/studio-shipping.mjs';
test('explicit costs and actual source quotes take precedence over a shipping reserve',()=>{
 assert.deepEqual(studioShipping({text:'快递: 免运费'},{domesticShipping:7}),{amount:7,source:'configured',estimated:false});
 assert.deepEqual(studioShipping({text:'快递: 免运费'}),{amount:0,source:'source-page',estimated:false});assert.equal(studioShipping({text:'快递：12.50'}).amount,12.5);
});
test('unknown domestic freight uses a disclosed configurable reserve, not fabricated free shipping',()=>{const choice=studioShipping({text:'境内运费：未确认'},{},20);assert.equal(choice.amount,20);assert.equal(choice.estimated,true);const price=annotateStudioShipping({price:'300',assumptions:['中国境内运费来自保存页的展示路线，实际入仓路线可能不同。'],baseCalculation:{price:'100'}},choice);assert.equal(price.domesticShippingSource,'estimated-reserve');assert.equal(price.baseCalculation.domesticShippingEstimated,true);assert.ok(price.assumptions[0].includes('不是已确认运费'));assert.ok(!price.assumptions.some(s=>s.includes('来自保存页')));assert.equal(price.price,'300');assert.throws(()=>studioShipping({}, {},-1),/Некорректный/);});
