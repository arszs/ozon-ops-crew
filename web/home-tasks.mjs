const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const check=new Set(['unknown','executing','submitted','partial']);
const actionable=new Set([...check,'pending','approved','blocked']);
const labels={publish:'商品卡片',wb_media:'俄语图片',wb_price:'商品价格',price:'商品价格',wb_stock:'可售库存',stock:'可售库存',reply:'买家回复',cpo_enable:'CPO 广告',cpo_disable:'CPO 广告'};
const descriptions={unknown:['结果不确定，先核对','不要重复发送；打开原操作，读取或人工核对平台结果。'],executing:['正在提交，请勿重复操作','打开原操作查看进度；尚不能认定平台已经生效。'],submitted:['已提交，核对平台结果','API 接受不等于操作已生效，也不等于商品已开售。'],partial:['部分已发送，先核对图片','先检查已发送部分，再决定如何继续。'],pending:['核对并确认此版本','查看店铺、内容和差异；确认后仍需单独执行。'],approved:['已确认，等待执行','再次核对目标；这里不会自动向平台提交。'],blocked:['操作已停止，查看原因','先核对停止原因；修改方案后需要重新确认。']};
function identity(o){const p=o.payload||{},c=p.context||{};return JSON.stringify([o.storeId,c.accountRef||p.accountRef||p.wbContext?.accountRef||'',o.kind?.startsWith('cpo_')?'cpo':o.kind,p.jobId||p.reviewId||c.product?.sku||c.price?.nmID||p.sku||o.id,o.kind==='wb_stock'?c.warehouse?.id:null]);}
// This is a view of saved work, not a live health check or a marketplace action.
export function homeTasks(data,storeId){
 const store=data.stores?.find(s=>s.id===storeId&&s.mode==='live');if(!store)return [];
 const jobs=(data.jobs||[]).filter(j=>j.storeId===storeId&&j.mode==='manual'&&!j.synthetic),byJob=new Map(jobs.map(j=>[j.id,j]));
 const excluded=new Set((data.jobs||[]).filter(j=>!byJob.has(j.id)).map(j=>j.id));
 const ops=(data.operations||[]).filter(o=>o.storeId===storeId&&o.mode==='live'&&!o.synthetic&&(!o.payload?.jobId||!excluded.has(o.payload.jobId)));
 const latest=new Map();for(const o of ops)latest.set(identity(o),o);
 const items=[];
 for(const o of ops){
  if(!actionable.has(o.state)||(!check.has(o.state)&&latest.get(identity(o))!==o))continue;
  const p=o.payload||{},c=p.context||{},j=byJob.get(p.jobId),[title,detail]=descriptions[o.state];
  if(j&&p.revision!=null&&p.revision!==j.revision&&!check.has(o.state))continue;
  items.push({id:'operation-'+o.id,operationId:o.id,jobId:p.jobId,kind:check.has(o.state)?'check':o.state==='blocked'?'fix':'approve',priority:check.has(o.state)?0:o.state==='blocked'?1:2,title:labels[o.kind]||'店铺操作',status:title,detail,product:j?.title||c.title||p.title||'',sku:String(c.product?.offerId||c.price?.vendorCode||p.vendorCode||j?.sku||p.sku||''),warehouse:c.warehouse?.name||'',storeId,page:'gates',target:'operation-'+o.id});
 }
 for(const j of jobs){
  // A publication/media task already takes the seller to the outstanding gate.
  if(items.some(x=>x.jobId===j.id))continue;
  let status,detail,kind='launch',priority=3;
  if(j.state==='needs_input'){status='补充资料，继续处理';detail='打开商品查看失败阶段和需要补充的字段。';kind='fix';priority=1;}
  else if(j.state==='review_gate'){status=j.gates?.category?.revision===j.revision?'准备发布确认':'确认翻译与类目';detail='对照中文原文和俄语草稿，再准备发布确认。';kind='approve';priority=2;}
  else if(['submitted','publishing'].includes(j.state)){status='核对商品创建结果';detail='打开商品读取平台结果；不要重复发布。';kind='check';priority=0;}
  else if(j.state==='imported'&&j.marketplace==='wb'){status='核对上架进度';detail='继续核对图片、价格、可售库存和平台草稿错误；开售状态仍需在 WB 后台确认。';}
  else if(['extract','translate','image_edit','map_attributes','validate','running'].includes(j.state)){status=j.state==='running'?'查看处理进度':'继续准备商品';detail='从保存的阶段继续；不会跳过人工确认。';}
  else continue;
  items.push({id:'job-'+j.id,jobId:j.id,kind,priority,title:'商品上架',status,detail,product:j.title||'',sku:j.sku||'',storeId,page:'migration'});
 }
 return items.sort((a,b)=>a.priority-b.priority);
}
export function homeTasksPanel(data,storeId,{limit=4}={}){
 const tasks=homeTasks(data,storeId),counts=[['check','核对结果'],['approve','等待确认 / 执行'],['fix','需要处理'],['launch','继续上架']];
 const rows=list=>list.map(t=>`<article class="home-task"><span class="home-task-status ${t.kind}">${esc(t.status)}</span><div><h3>${esc(t.product||t.sku||t.title)}</h3><p>${esc(t.title)}${t.sku?' · '+esc(t.sku):''}${t.warehouse?' · '+esc(t.warehouse):''}</p><small>${esc(t.detail)}</small></div>${t.page==='gates'?`<button class="quiet" data-nav="gates" data-record="${esc(t.target)}">查看操作 →</button>`:`<button class="quiet" data-task-job="${esc(t.jobId)}">查看商品 →</button>`}</article>`).join('');
 return `<section class="card home-tasks"><div class="section-head"><h2>店铺待办 <span class="muted">${tasks.length}</span></h2><button class="quiet" id="home-tasks-refresh">刷新待办</button></div>${tasks.length?`<div class="home-task-counts">${counts.map(([kind,label])=>{const n=tasks.filter(t=>t.kind===kind).length;return n?`<span><b>${n}</b> ${label}</span>`:'';}).join('')}</div>${rows(tasks.slice(0,limit))}${tasks.length>limit?`<details class="home-task-more"><summary>其余 ${tasks.length-limit} 项待办</summary>${rows(tasks.slice(limit))}</details>`:''}`:'<p>本店已保存的流程中暂无待办。可从商品页选择一个商品，或导入下一件商品。</p>'}<small class="muted">仅本店已保存的操作与商品流程；不含演示。刷新待办不会向平台提交或重新读取商品。暂无待办不代表店铺无异常。</small></section>`;
}
