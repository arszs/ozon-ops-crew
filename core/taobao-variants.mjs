// Read JSON data only; never execute scripts from a saved product page.
function jsonObject(html,key){
 const marker='"'+key+'"',at=html.indexOf(marker);if(at<0)return null;let start=at+marker.length;while(/\s|:/.test(html[start]||'')&&start<html.length)start++;if(html[start]!=='{')return null;
 let depth=0,string=false,escape=false;for(let i=start;i<Math.min(html.length,start+2_000_000);i++){const c=html[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&!--depth){try{return JSON.parse(html.slice(start,i+1));}catch{return null;}}}return null;
}
export function taobaoVariants(html){
 const base=jsonObject(html,'skuBase'),core=jsonObject(html,'skuCore');if(!Array.isArray(base?.skus)||!Array.isArray(base?.props))return [];
 const values=new Map();for(const p of base.props.slice(0,20)){if(!/^\d+$/.test(p.pid||''))continue;for(const v of (p.values||[]).slice(0,200)){if(!/^\d+$/.test(v.vid||'')||typeof v.name!=='string'||!v.name.trim()||v.name.length>400)continue;values.set(p.pid+':'+v.vid,{pid:String(p.pid),vid:String(v.vid),group:String(p.name||''),label:v.name.trim()});}}
 const out=[];for(const s of base.skus.slice(0,2000)){if(!/^\d+$/.test(s.skuId||'')||typeof s.propPath!=='string')continue;const ids=s.propPath.split(';').filter(Boolean),parts=ids.map(id=>values.get(id));if(!parts.length||parts.some(p=>!p)||new Set(parts.map(p=>p.pid)).size!==parts.length)continue;const quantity=Number(core?.sku2info?.[s.skuId]?.quantity);out.push({skuId:String(s.skuId),parts,label:parts.map(p=>p.group?p.group+': '+p.label:p.label).join(' · '),available:Number.isFinite(quantity)?quantity>0:null});}return out;
}
