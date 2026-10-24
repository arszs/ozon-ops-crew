import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assetPath} from './media.mjs';
const gitBlobDigest=b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const digest=b=>createHash('sha256').update(b).digest('hex');
function run(binary,args,input){return new Promise((resolve,reject)=>{
 const env=Object.fromEntries(['PATH','HOME','USER','TMPDIR','LANG','GH_HOST','SSL_CERT_FILE','SSL_CERT_DIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const child=spawn(binary,args,{env,stdio:['pipe','pipe','pipe']});let output='',failed=false;
 const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');reject(Error('公开图片存储请求超时'));},45000);
 child.on('error',()=>{clearTimeout(timer);reject(Error('需要已登录的 GitHub CLI 才能使用公开图片存储'));});
 child.stdout.on('data',b=>{output+=b;if(output.length>20_000_000){failed=true;child.kill('SIGKILL');reject(Error('GitHub response too large'));}});child.stderr.resume();child.stdin.on('error',()=>{});
 child.on('close',code=>{clearTimeout(timer);if(failed)return;if(code!==0)reject(Error('GitHub 图片存储请求失败，请检查仓库权限'));else resolve(output);});child.stdin.end(input||'');
 });}
export async function githubJSON(path,body){const args=['api',path];if(body)args.push('--method',path.includes('/contents/')?'PUT':'POST','--input','-');return JSON.parse(await run('gh',args,body?JSON.stringify(body):undefined));}
export async function publishPublicImages(images,{api=githubJSON,repo,load=async id=>readFile(assetPath(id))}={}){
 if(!repo){const remote=(await run('git',['remote','get-url','origin'])).trim();repo=remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];}
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo||''))throw Error('请配置公开 GitHub 图片仓库');
 if(!Array.isArray(images)||!images.length||images.length>15||images.some(i=>!i.rightsConfirmed||!/^[a-f0-9]{64}$/.test(i.assetId||'')))throw Error('只能发布已确认使用权的本地商品图片');
 const metadata=await api('repos/'+repo);if(metadata.private!==false)throw Error('图片仓库必须是公开仓库；不会把私有仓库改为公开');
 const branch='product-media';try{await api('repos/'+repo+'/git/ref/heads/'+branch);}catch{
  const base=await api('repos/'+repo+'/git/ref/heads/'+encodeURIComponent(metadata.default_branch));await api('repos/'+repo+'/git/refs',{ref:'refs/heads/'+branch,sha:base.object.sha});
 }
 const urls=[];
 for(const image of images){const bytes=await load(image.assetId);if(bytes.length>10_000_000||digest(bytes)!==image.assetId)throw Error('图片文件校验失败');
  const path='product-media/'+image.assetId+'.png',endpoint='repos/'+repo+'/contents/'+path;let existing;
  try{existing=await api(endpoint+'?ref='+branch);}catch{}
  if(existing&&existing.sha===gitBlobDigest(bytes)){/* Git blob identity proves the exact local bytes without downloading them again. */}
  else if(existing){const data=existing.content?existing:await api('repos/'+repo+'/git/blobs/'+existing.sha);if(digest(Buffer.from(data.content||'','base64'))!==image.assetId)throw Error('公开图片内容与本地不一致，不覆盖');}
  else await api(endpoint,{message:'Host approved product image '+image.assetId.slice(0,12),content:bytes.toString('base64'),branch});
  urls.push('https://raw.githubusercontent.com/'+repo+'/'+branch+'/'+path);
 }
 return {urls,repo,branch,scope:'Only approved public product images; no credentials, source HTML or business reports uploaded.'};
}
export async function publishPublicVideo(video,{api=githubJSON,repo,load}={}){if(!/^[\w.-]+\/[\w.-]+$/.test(repo||'')||!video.rightsConfirmed||video.kind!=='photo-overview'||!/^[a-f0-9]{64}$/.test(video.assetId||''))throw Error('Нет подтверждённого фотообзора');if((await api('repos/'+repo)).private!==false)throw Error('Нужен публичный медиарепозиторий');const bytes=await (load|| (async id=>readFile((await import('../core/product-video.mjs')).videoPath(id))))(video.assetId);if(bytes.length>8_000_000||digest(bytes)!==video.assetId)throw Error('Не пройдена проверка видео');const path='product-media/'+video.assetId+'.mp4',endpoint='repos/'+repo+'/contents/'+path;let existing;try{existing=await api(endpoint+'?ref=product-media');}catch{}if(existing&&existing.sha===gitBlobDigest(bytes)){}else if(existing){const data=existing.content?existing:await api('repos/'+repo+'/git/blobs/'+existing.sha);if(digest(Buffer.from(data.content||'','base64'))!==video.assetId)throw Error('Публичное видео отличается от подготовленного');}else await api(endpoint,{message:'Host product photo overview '+video.assetId.slice(0,12),content:bytes.toString('base64'),branch:'product-media'});return {url:'https://raw.githubusercontent.com/'+repo+'/product-media/'+path,repo,branch:'product-media'};}
