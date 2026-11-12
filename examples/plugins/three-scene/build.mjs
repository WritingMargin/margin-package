import { build } from 'esbuild';
import { mkdtemp,mkdir,copyFile,writeFile,readFile,rm } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pack } from '../../../packages/plugin-sdk/pack.mjs';
import plugin from './plugin.mjs';
import { inlineDocument } from './inline-document.mjs';
const here=dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url);
const output=resolve(process.argv[2]??`three-scene-${plugin.manifest.version}.margin-plugin`);
const root=await mkdtemp(join(tmpdir(),'margin-three-browser-'));
try {
 const payload=join(root,'payload');await mkdir(join(payload,'ui'),{recursive:true});
 const options={bundle:true,platform:'browser',format:'iife',target:'es2022',minify:true,write:false,legalComments:'none'};
 const worker=await build({...options,entryPoints:[join(here,'worker.mjs')]});
 const ui=await build({...options,entryPoints:[join(here,'ui/main.mjs')],define:{__MARGIN_THREE_WORKER__:JSON.stringify(worker.outputFiles[0].text)}});
 const css=await readFile(join(here,'../../../packages/plugin-sdk/select.css'),'utf8')+'\n'+await readFile(join(here,'ui/scene.css'),'utf8');
 const html=inlineDocument(await readFile(join(here,'ui/scene.html'),'utf8'),ui.outputFiles[0].text,css);
 await writeFile(join(payload,'ui/scene.html'),html);
 await copyFile(join(dirname(dirname(require.resolve('three'))),'LICENSE'),join(payload,'THREE-LICENSE.txt'));
 const manifest=join(root,'manifest.json');await writeFile(manifest,JSON.stringify(plugin.manifest));
 await pack(['--directory',payload,'--manifest',manifest,'--output',output]);
 console.log(`Portable Three.js package ready: ${output}`);
} finally {await rm(root,{recursive:true,force:true});}
