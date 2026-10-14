const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mode=r=>r.mode==='live'?'API':'演示';
const kind=r=>r.kind==='question'?'买家提问':'买家评价';
const storeName=(data,r)=>data.stores.find(s=>s.id===r.storeId)?.name||r.storeId;
const translated=r=>r.textZh&&!r.textZh.startsWith('待翻译')?r.textZh:'';
export function reviewChoices(data,{query='',storeId='',selectedId=''}={}){
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const matches=data.reviews.filter(r=>{const text=[r.textRu,translated(r),r.externalId,storeName(data,r)].join(' ').toLocaleLowerCase();return (!storeId||r.storeId===storeId)&&terms.every(term=>text.includes(term));}).slice().reverse();
 const shown=matches.slice(0,100),selected=data.reviews.find(r=>r.id===selectedId);
 if(selected&&!shown.some(r=>r.id===selected.id))shown.unshift(selected);
 return {rows:shown,total:matches.length,selectedOutsideFilter:!!selected&&!matches.some(r=>r.id===selected.id),html:'<option value="">请选择评价</option>'+shown.map(r=>`<option value="${esc(r.id)}">${esc(mode(r)+' · '+storeName(data,r)+' · '+kind(r)+' · '+(r.rating==null?'':r.rating+'★ · ')+(translated(r)||r.textRu||'平台未提供文本').slice(0,100))}</option>`).join('')};
}
export function reviewPickerFields(data){return `<div class="form-grid"><label>按店铺筛选<select name="reviewStore"><option value="">全部店铺</option>${data.stores.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label><label>搜索评价<input type="search" name="reviewSearch" placeholder="中文、俄文、评价编号或店铺名"></label></div><label>选择买家评价<select name="reviewId" required>${reviewChoices(data).html}</select></label><p class="muted" data-review-count></p><div data-review-preview aria-live="polite"><p>选择后会显示俄文原文及中文理解；请人工核对 SKU 与图片的对应关系。</p></div>`;}
function preview(data,r){if(!r)return '<p>请选择一条评价，再核对商品 SKU、图片和已确认事实。</p>';return `<p><b>${esc(storeName(data,r))}</b> · ${mode(r)} · ${kind(r)}${r.rating==null?'':' · '+esc(r.rating)+'★'}</p><div class="diff-grid"><div><small>买家原文 · 俄语</small><p lang="ru">${esc(r.textRu||'平台未提供文本')}</p></div><div><small>中文理解</small><p>${esc(translated(r)||'尚未翻译。可以先在客户沟通生成翻译，或核对原文后继续。')}</p></div></div><p class="muted">请确认下方 SKU、图片与这条评价属于同一商品。</p>`;}
export function bindReviewPicker(data,form){
 if(!form?.elements.reviewSearch)return;
 const e=form.elements;
 const render=()=>{const id=e.reviewId.value,result=reviewChoices(data,{query:e.reviewSearch.value,storeId:e.reviewStore.value,selectedId:id});e.reviewId.innerHTML=result.html;e.reviewId.value=data.reviews.some(r=>r.id===id)?id:'';form.querySelector('[data-review-count]').textContent=`找到 ${result.total} 条${result.total>100?'，先显示最近 100 条，请继续输入关键词':''}${result.selectedOutsideFilter?'；已选评价保留在列表中，但不符合当前搜索':''}`;form.querySelector('[data-review-preview]').innerHTML=preview(data,data.reviews.find(r=>r.id===e.reviewId.value));};
 e.reviewSearch.oninput=render;
 e.reviewStore.onchange=()=>{e.reviewId.value='';e.productConfirmed.checked=false;render();};
 e.reviewId.onchange=()=>{e.productConfirmed.checked=false;render();};
 form.onCreativeReviewRefresh=render;if(!form.onCreativeReviewRestore){form.onCreativeReviewRestore=()=>form.onCreativeReviewRefresh?.();form.addEventListener('draft-restored',form.onCreativeReviewRestore);}render();
}
export function prepareCreativeReview(data,form,id){
 const r=data.reviews.find(r=>r.id===id);if(!r||!form)return false;
 form.elements.reviewStore.value=r.storeId;form.elements.reviewSearch.value='';
 form.elements.reviewId.innerHTML=reviewChoices(data,{storeId:r.storeId,selectedId:id}).html;
 form.elements.reviewId.value=id;form.elements.productConfirmed.checked=false;
 form.onCreativeReviewRefresh?.();return true;
}
