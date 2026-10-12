import {wbDecimal,decimalText} from '../adapters/wb-finance.mjs';
import {maskPII} from './repository.mjs';
export const WB_COST_FIELDS=['cogs','tax','external'];
export const WB_COST_CHECKS=['costsReviewed','periodReviewed','noDoubleCount'];
const money=value=>{if(typeof value!=='string'||!/^[-+]?\d{1,13}(\.\d{1,6})?$/.test(value))throw Error('所有成本金额必填，最多六位小数；未知不能填零');const n=wbDecimal(value);if(n>1000000000000000000n||n< -1000000000000000000n)throw Error('成本金额超出范围');return decimalText(n);};
export function reconcileWbContribution(view,input){
 const s=view.snapshot;
 if(view.state!=='complete'||!s?.complete||s.stale||!s.evidenceHash)throw Error('请先完成并刷新此期间的 WB 财务读取');
 if(input.runId!==s.runId||input.reportHash!==s.evidenceHash)throw Error('财务版本已变化，请重新打开成本核对');
 if(typeof input.currency!=='string'||!Object.hasOwn(s.totals,input.currency))throw Error('请选择报表实际币种；不自动换汇');
 if(typeof input.evidence!=='string'||input.evidence.trim().length<5||input.evidence.length>1000)throw Error('请填写成本来源、退货处理及适用报表说明（5–1000 字符）');
 const costs=Object.fromEntries(WB_COST_FIELDS.map(k=>[k,money(input[k])])),checks=Object.fromEntries(WB_COST_CHECKS.map(k=>[k,input[k]===true]));
 const reportTotal=s.totals[input.currency].bankPaymentSum;
 const contribution=decimalText(WB_COST_FIELDS.reduce((v,k)=>v-wbDecimal(costs[k]),wbDecimal(reportTotal)));
 const coverage=s.coverage.byCurrency[input.currency];
 return {currency:input.currency,source:'wb_reports_seller_costs',basis:'returned_daily_reports',reportId:s.runId,reportHash:s.evidenceHash,period:{...s.period},reportTotal,costs,checks,evidence:maskPII(input.evidence.trim()),result:{contribution,reviewed:WB_COST_CHECKS.every(k=>checks[k]),scopeComplete:coverage.missingDays.length===0,platformCostsDeductedAgain:false},coverage:structuredClone(coverage)};
}
export function wbContributionStatus(record,view){
 const s=view.snapshot;
 if(!s||record.reportId!==s.runId||record.reportHash!==s.evidenceHash)return 'superseded';
 if(view.state!=='complete'||!s.complete||s.stale)return 'stale';
 if(!record.result.reviewed)return 'needs_review';
 if(!record.result.scopeComplete)return 'partial';
 return 'current';
}
