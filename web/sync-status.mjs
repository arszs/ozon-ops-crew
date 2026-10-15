const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={catalog:'目录数量',analytics:'订购金额与件数',finance:'平台记账',campaigns:'广告活动',cpc:'按点击付费支出',cpo:'指定商品 CPO 支出',allCpo:'全商品推广支出',adExpenses:'广告费用明细',membership:'指定商品 CPO 状态',products:'商品价格与库存',adMetrics:'广告汇总',catalogProducts:'目录商品详情'};
const reason=code=>String(code).includes('429')?'请求过于频繁，已暂停后续请求':String(code).includes('401')?'连接授权失效':String(code).includes('403')?'无读取权限':String(code).includes('404')?'此接口暂不可用':String(code).includes('not_configured')?'尚未配置连接':'未能读取，请稍后重试';
const time=s=>Number.isFinite(Date.parse(s))?new Date(s).toLocaleString('zh-CN',{timeZone:'Europe/Moscow',hour12:false}):'未知';
export function syncStatus(live){
 const d=live?.data,a=live?.lastAttempt,waiting=Date.parse(live?.refreshAfter)>Date.now(),sources=Object.entries(a?.sources||{}),failed=sources.filter(([,s])=>!s.ok&&!s.skipped);
 let headline='';
 if(live?.state==='syncing')headline=`<p class="home-status" role="status">${d?'正在更新 Ozon 报表，显示上次快照；更新后再决定平台操作。':'正在核对连接并读取 Ozon 经营报表，未返回的数据保持未知。'}</p>`;
 else if(live?.state==='error')headline=`<p class="warning">Ozon 更新失败。${d?'已保留上次快照，请勿把旧数据当成最新结果。':'尚无可用报表；缺失数据不代表零销售。'}${waiting?` 下次可重试：${esc(time(live.refreshAfter))}（莫斯科）。`:''}</p>`;
 else if(live?.stale&&d)headline='<p class="warning">当前为旧快照。刷新后再决定价格或广告操作。</p>';
 else if(!d)headline='<p class="home-status">等待 Ozon 经营报表。缺失数据不代表零销售。</p>';
 if(waiting&&live?.state!=='error')headline+=`<p class="home-status">Ozon 限制了读取频率；${esc(time(live.refreshAfter))}（莫斯科）后可再次刷新。已取得的数据保留。</p>`;
 if(a?.finishedAt)headline+=`<details class="sync-status"><summary>${a.fromCache?'已保存的读取结果':'最新读取'}：${sources.filter(([,s])=>s.ok).length} 项成功${failed.length?' · '+failed.length+' 项未取得':''} · ${esc(time(a.finishedAt))}（莫斯科）</summary>${failed.length?`<p>${a.state==='failed'?'以下是最近一次失败尝试；已保留的金额来自更早快照。':'本次未取得的金额保持未知。'}未知费用不视为零。</p>`:''}<ul>${sources.map(([k,s])=>`<li><span>${esc(names[k]||(k.startsWith('membership:')?'广告商品状态':'其他来源'))}</span><b>${s.ok?'已读取':s.skipped?'未尝试':reason(s.error)}</b></li>`).join('')}</ul>${a.error==='account_changed_during_sync'?'<p>读取期间连接账户已变化，混合结果已丢弃。请重新读取。</p>':''}</details>`;
 return headline;
}
