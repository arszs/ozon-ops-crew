const reveal=id=>{const panel=document.getElementById(id);panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'start'});};
document.getElementById('analyze').onclick=()=>reveal('brief');
document.getElementById('compare').onclick=()=>reveal('comparison');
document.getElementById('approval').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;const status=document.getElementById('approved');status.hidden=false;if(!form.checkValidity()){status.textContent='请先逐项勾选事实、图片和俄语检查，再确认版本。';return;}status.textContent='演示版本已确认。实际产品需保留原图、生成指令、版本哈希与人工确认记录；本页没有发布商品或启动广告。';};

document.getElementById('approval').oninput=()=>{document.getElementById('approved').hidden=true;};
