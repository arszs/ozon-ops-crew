const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pageImportPanel(storeOptions,result){
 return `<section class="card"><h2>把淘宝商品带到 Ozon</h2><p>选择已保存的商品页，自动生成俄语标题、描述和图片预览。提交前可以修改。</p><form id="page-import-form"><label>目标店铺<select name="storeId">${storeOptions}</select></label><details id="transfer-source-link"><summary>补充商品链接（可选）</summary><label>商品链接<input name="sourceUrl" type="url" placeholder="https://item.taobao.com/item.htm?id=…"></label></details><label>淘宝商品页 HTML<input name="html" type="file" accept=".html,.htm,text/html" required></label><label><input name="sourceImageRightsConfirmed" type="checkbox"> 我确认可以使用来源图片（未确认时只生成草稿）</label><button class="primary">生成商品草稿</button></form>${result?.state==='needs_review'?`<p class="warning">需要进一步核对：${(result.issues||[]).map(esc).join(' / ')}</p><button id="download-page-review" class="quiet">下载核对包，交给 Codex</button>`:''}</section>`;
}
export function bindPageImport({api,action,result,onResult}){
 const form=document.querySelector('#page-import-form');if(form)form.onsubmit=e=>{
  e.preventDefault();const f=new FormData(form),file=f.get('html');
  action(async()=>{if(!file?.size||file.size>8_000_000)throw Error('请选择不超过 8 MB 的 HTML 文件');const q=new URLSearchParams({storeId:f.get('storeId')});if(f.get('sourceUrl'))q.set('sourceUrl',f.get('sourceUrl'));if(f.get('sourceImageRightsConfirmed')==='on')q.set('sourceImageRightsConfirmed','true');const data=await api('/page-imports?'+q,new Blob([await file.arrayBuffer()],{type:'text/html'}));onResult(data);},'页面处理完成，请核对草稿与缺失资料；尚未发布');
 };
 const download=document.querySelector('#download-page-review');if(download)download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result.reviewPacket,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='page-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}
