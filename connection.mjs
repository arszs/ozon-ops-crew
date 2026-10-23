import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
// Local machine configuration contains paths, never browser-provided secrets.
export async function loadConnection(){
 try{const cfg=JSON.parse(await readFile(join(homedir(),'.config/ozon-ops-crew/connection.json'),'utf8'));
 for(const key of ['OZON_ENV_FILE','OZON_PERFORMANCE_ENV_FILE'])if(!process.env[key]&&typeof cfg[key]==='string')process.env[key]=cfg[key];
 }catch(e){if(e.code!=='ENOENT')throw Error('invalid_local_connection_config');}
}
