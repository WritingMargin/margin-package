import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildUI } from './build-ui.mjs';
import { pack } from '../../../packages/plugin-sdk/pack.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const root=await mkdtemp(join(tmpdir(),'margin-notebook-browser-'));
try {
 const payload=join(root,'payload');await mkdir(payload);
 await buildUI(join(payload,'ui/notebook.html'));
 const manifest=JSON.parse(await readFile(join(here,'manifest.json'),'utf8'));
 const path=join(root,'manifest.json');await writeFile(path,JSON.stringify(manifest));
 const output=resolve(process.argv[2]??`python-notebook-${manifest.version}.margin-plugin`);
 await pack(['--directory',payload,'--manifest',path,'--output',output]);
 console.log(`Portable notebook package ready: ${output}`);
} finally {await rm(root,{recursive:true,force:true});}
