const money=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('zh-CN',{style:'currency',currency:'RUB'}).format(n):'—';
function status(source){
 if(source?.ok)return '已读取';
 if(source?.error?.includes('404'))return '此请求不可用（404）';
 if(source?.error?.includes('403'))return '无读取权限';
 if(source?.error?.includes('401'))return '连接授权失效';
 return '未读取 / 未通过校验';
}
export function adCoverage(d){
 if(!d)return '';
 const a=d.ads,s=d.sources||{};
 return `<details class="card ad-coverage"><summary>广告数据完整性 · 尚未核实全部费用</summary><p>同一报告期间 · 金额为卢布。这里只合计已读取的工具，不是全部广告成本。</p><div class="table-wrap"><table><thead><tr><th>广告工具</th><th>已读取支出</th><th>状态</th></tr></thead><tbody><tr><td>CPC · 按点击付费</td><td>${money(a?.cpcSpend)}</td><td>${status(s.cpc)}</td></tr><tr><td>CPO · 指定商品按订单付费</td><td>${money(a?.cpoSpend)}</td><td>${status(s.cpo)}</td></tr><tr><td>CPO · 全店商品推广</td><td>—</td><td>${s.allCpo?.ok?'报告已读取，金额尚未校验':status(s.allCpo)}</td></tr></tbody></table></div>${['cpc','cpo'].some(k=>typeof a?.unallocated?.[k]==='number'&&a.unallocated[k]!==0)?`<p class="warning">未归属 SKU 的报表差额：CPC ${money(a.unallocated.cpc)} / CPO ${money(a.unallocated.cpo)}。差额保留在店铺报表中，不分摊给商品。</p>`:''}<p class="muted">“—”代表未知；0 仅表示已读取报表范围内没有支出。广告报表与平台结算可能包含相同费用，不重复扣除。</p></details>`;
}
export function skuAdBreakdown(row){
 const a=row?.adBreakdown;
 return `<small>CPC ${money(a?.cpcSpend)} · 指定商品 CPO ${money(a?.cpoSpend)}<br>全店推广费用未知</small>`;
}
