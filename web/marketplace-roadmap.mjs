const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={primary:'核心场景',preview:'预研 · 待真实账号验证',planned:'计划中'};
export function marketplaceRoadmap(platforms=[],stores=[]){
 if(!platforms.length)return '';
 const row=p=>{const configured=stores.filter(s=>s.marketplace===p.id&&s.mode==='live').length;return `<article class="card"><div class="section-head"><h3>${esc(p.name)}</h3><span class="badge">${esc(labels[p.stage]||'未接入')}</span></div><p>${esc(p.summary)}</p><small class="muted">${esc(p.validation)}</small>${p.implemented?`<p class="muted">已配置 API 店铺：${configured} · 配置数量不代表连接成功</p>`:''}</article>`;};
 return `<section aria-label="平台接入进度">${platforms.filter(p=>p.stage==='primary').map(row).join('')}<details class="card"><summary>未来 API 适配器 · Amazon / Shopify / Wildberries / TikTok Shop</summary><p class="muted">各平台复用商品、审核与实验流程，按实际 API 能力分别接入。</p><div class="store-grid">${platforms.filter(p=>p.stage!=='primary').map(row).join('')}</div></details></section>`;
}
