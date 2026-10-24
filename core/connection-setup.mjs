import {readFile,writeFile,mkdir,rename,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

let pending=Promise.resolve();
export function connectOzon(input,options={}){const task=pending.then(()=>connect(input,options));pending=task.catch(()=>{});return task;}
async function connect({name,clientId,apiKey},{fetcher=fetch,directory=join(homedir(),'.config','ozon-ops-crew')}={}){
 if(typeof name!=='string'||!name.trim()||name.length>80||!/^\d+$/.test(clientId||'')||typeof apiKey!=='string'||!/^[\x21-\x7e]{8,1000}$/.test(apiKey))throw Error('请填写店铺名称、Client ID 和 API key');
 let response;
 try{response=await fetcher('https://api-seller.ozon.ru/v3/product/list',{method:'POST',redirect:'error',headers:{'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'},body:JSON.stringify({filter:{visibility:'ALL'},limit:1,last_id:''}),signal:AbortSignal.timeout(30000)});}catch{throw Error('Ozon 连接失败，请检查网络');}
 if(!response.ok)throw Error('Ozon HTTP '+response.status+'：请核对密钥、权限或 IP 限制');
 const data=await response.json();if(!Array.isArray(data.result?.items))throw Error('Ozon 返回了无法识别的目录响应');
 const configFile=join(directory,'connection.json');let config={};try{config=JSON.parse(await readFile(configFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('本机连接配置读取失败');}
 const id='ozon-ui-'+createHash('sha256').update(clientId).digest('hex').slice(0,16);
 const envFile=join(directory,'credentials',id+'.env');await mkdir(dirname(envFile),{recursive:true,mode:0o700});
 await writeFile(envFile,`OZON_CLIENT_ID=${clientId}\nOZON_API_KEY=${apiKey}\n`,{mode:0o600});await chmod(envFile,0o600);
 const store={id,name:name.trim(),marketplace:'ozon',mode:'live',envFile};
 config.stores=[...(config.stores||[]).filter(s=>s.id!==id),store];
 const temporary=configFile+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(config,null,2),{mode:0o600});await rename(temporary,configFile);
 return {store,catalogTotal:data.result.total_items??data.result.total??null};
}
