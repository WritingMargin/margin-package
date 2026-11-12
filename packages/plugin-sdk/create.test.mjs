import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createProject} from './create.mjs';
const sdk=dirname(fileURLToPath(import.meta.url));
async function temporary(run){const dir=await mkdtemp(join(tmpdir(),'margin-browser-sdk-'));try{await run(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('scaffolder rejects traversal and never overwrites existing projects',()=>temporary(async dir=>{
 await assert.rejects(createProject(['create','alias','--block'],dir),/Supported option/);
 for(const name of ['../escape','/absolute','nested/path','Bad Name'])await assert.rejects(createProject(['create',name],dir),/lowercase name/);
 await mkdir(join(dir,'existing'));await writeFile(join(dir,'existing/keep.txt'),'untouched');
 await assert.rejects(createProject(['create','existing'],dir),/already exists/);
 assert.equal(await readFile(join(dir,'existing/keep.txt'),'utf8'),'untouched');
}));
test('default scaffold tests, checks and packs a portable UI without secrets or servers',()=>temporary(async dir=>{
 const target=await createProject(['create','writing-card','--sdk',sdk],dir);
 for(const command of [['test'],['run','check'],['run','pack']])execFileSync('npm',command,{cwd:target,stdio:'pipe',env:{...process.env,NODE_DISABLE_COMPILE_CACHE:'1'}});
 const manifest=JSON.parse(await readFile(join(target,'manifest.json'),'utf8'));
 assert.deepEqual(manifest.actions,[]);assert.equal(manifest.blocks[0].reader,true);
 const files=await readdir(target);assert(!files.includes('.env'));assert(!files.some(name=>name.startsWith('server')));
 const html=await readFile(join(target,'dist/block.html'),'utf8');assert.match(html,/connectBlock/);assert.doesNotMatch(html,/client.action\('text.count'/);
 const packed=await readFile(join(target,'writing-card-0.1.0.margin-plugin'));assert(packed.length<40000);assert.match(packed.toString(),/margin.package\/v2/);assert.doesNotMatch(packed.toString(),/runtime\/node/);
}));
