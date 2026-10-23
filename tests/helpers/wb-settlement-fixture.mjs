import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WbFinanceService} from '../../core/wb-finance-service.mjs';
import {WB_REPORT_FIELDS,WB_DETAIL_MONEY} from '../../adapters/wb-finance.mjs';
export async function settlementFixture(){
 const dir=await mkdtemp(join(tmpdir(),'wb-settlement-')),store={id:'wb-settlement-test',name:'WB · 合成财务测试（无真实 API）',marketplace:'wb',mode:'live',wbRegion:'cn'},range={from:'2026-10-01',to:'2026-10-02'};
 let now=Date.parse('2026-10-13T01:00:00Z'),difference=false,service;
 const calls=[],zero=ks=>Object.fromEntries(ks.map(k=>[k,'0'])),base={dateFrom:range.from,dateTo:range.from,currency:'CNY',reportType:1};
 const headers=[{...base,...zero(WB_REPORT_FIELDS),reportId:'1',retailAmountSum:'1000',forPaySum:'800',deliveryServiceSum:'100',paidStorageSum:'25',deductionSum:'30',penaltySum:'5',additionalPaymentSum:'-10',cashbackAmountSum:'8',cashbackDiscountSum:'3',cashbackCommissionChangeSum:'1.6',paymentSchedule:'1',bankPaymentSum:'642.4'},{...base,...zero(WB_REPORT_FIELDS),dateFrom:range.to,dateTo:range.to,reportId:'2',retailAmountSum:'125',forPaySum:'100',bankPaymentSum:'100'}];
 const row=(id,amounts={},patch={})=>({...base,...zero(WB_DETAIL_MONEY),reportId:'1',rrdId:id,nmId:'123',vendorCode:'TEST-BOX',title:'折叠收纳盒 · 合成数据',quantity:1,docTypeName:'Продажа',sellerOperName:'Продажа',...amounts,...patch});
 const rows=[row('1',{retailAmount:'1250',forPay:'1000',deliveryService:'80',penalty:'5',additionalPayment:'-10',cashbackAmount:'10',cashbackDiscount:'3',cashbackCommissionChange:'2'},{quantity:5}),row('2',{retailAmount:'250',forPay:'200',deliveryService:'20',cashbackAmount:'2',cashbackCommissionChange:'0.4'},{docTypeName:'Возврат',sellerOperName:'Возврат'}),row('3',{paidStorage:'25',deduction:'30',paymentSchedule:'1'},{nmId:'0',docTypeName:'',sellerOperName:'Удержание'}),row('4',{retailAmount:'125',forPay:'100'},{reportId:'2',dateFrom:range.to,dateTo:range.to,nmId:'456',vendorCode:'TEST-OTHER',title:'第二商品 · 合成数据'})];
 const options={clock:()=>now,sleep:async ms=>{now+=ms;},accountRef:async()=> 'synthetic-settlement-owner',read:async(s,r,phase,cursor)=>{calls.push({phase,cursor});const h=structuredClone(headers);if(difference){h[0].bankPaymentSum='652.4';h[1].bankPaymentSum='90';}return cursor==='0'?{status:200,rows:phase==='list'?h:rows}:{status:204,rows:[]};}};
 const open=()=>new WbFinanceService(join(dir,'f.sqlite'),options);service=open();
 return {store,range,calls,get service(){return service;},set difference(v){difference=v;},async read(){await service.start(store,{...range,restart:true});await service.wait(store.id);return service.get(store,{sku:'123'});},reopen(){service.close();service=open();},async cleanup(){await service.wait(store.id);service.close();await rm(dir,{recursive:true,force:true});}};
}
