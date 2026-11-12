import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {pack} from '../../../packages/plugin-sdk/pack.mjs';
const here=dirname(fileURLToPath(import.meta.url)),root=await mkdtemp(join(tmpdir(),'margin-http-browser-'));
try{
 const payload=join(root,'payload');await mkdir(join(payload,'ui'),{recursive:true});
 const sdk=await readFile(join(here,'../../../packages/plugin-sdk/browser.mjs'),'utf8');
 const html=(await readFile(join(here,'playground.html'),'utf8')).replace('/*SDK*/',()=>sdk.replace(/<\/script/gi,'<\\/script'));
 await writeFile(join(payload,'ui/playground.html'),html);
 console.log(await pack(['--directory',payload,'--manifest',join(here,'manifest.json'),'--output',resolve(process.argv[2]??'http-playground-0.1.0.margin-plugin')]));
}finally{await rm(root,{recursive:true,force:true});}
