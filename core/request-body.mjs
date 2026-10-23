export const IMAGE_UPLOAD_BYTES=12_000_000;
export const PAGE_UPLOAD_BYTES=8_000_000;
const JSON_BYTES=2_000_000;
const imageTypes=new Set(['image/png','image/jpeg','image/webp','application/octet-stream']);
const tooLarge=()=>Object.assign(Error('上传内容超过限制：图片最多 12 MB，保存页面最多 8 MB，JSON 最多 2 MB'),{status:413});

// Large binary uploads are limited to this one asset endpoint. Other commands
// keep their existing JSON limit; uploaded bytes never become operation data.
export async function workspaceBody(req,{resource,id,action}){
 if(req.method==='GET')return {};
 const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
 const binary=req.method==='POST'&&resource==='assets'&&!id&&!action&&imageTypes.has(type);
 const html=req.method==='POST'&&['page-imports','studio-imports'].includes(resource)&&!id&&!action&&type==='text/html';
 const limit=html?PAGE_UPLOAD_BYTES:binary?IMAGE_UPLOAD_BYTES:JSON_BYTES;
 if(Number(req.headers['content-length'])>limit)throw tooLarge();
 const chunks=[];let size=0;
 for await(const chunk of req){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>limit)throw tooLarge();chunks.push(bytes);}
 const bytes=Buffer.concat(chunks,size);
 if(binary){if(!bytes.length)throw Error('请选择非空图片');return {imageBytes:bytes};}
 if(html){if(!bytes.length)throw Error('请选择已保存的商品 HTML');return {html:bytes.toString('utf8')};}
 return JSON.parse(bytes.toString('utf8')||'{}');
}
