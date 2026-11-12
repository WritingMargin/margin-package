// Node is a test harness only. The shipped runner and worker use browser APIs.
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
const bundle=await build({entryPoints:[new URL('./worker.mjs',import.meta.url).pathname],bundle:true,platform:'browser',format:'iife',write:false,target:'es2022'});
const source=`import {parentPort} from 'node:worker_threads';\nglobalThis.self=globalThis;globalThis.postMessage=value=>parentPort.postMessage(value);parentPort.on('message',data=>self.onmessage({data}));\n${bundle.outputFiles[0].text}`;
export function workerFactory(){
 const worker=new Worker(new URL('data:text/javascript;base64,'+Buffer.from(source).toString('base64')));
 const adapter={postMessage:data=>worker.postMessage(data),terminate:()=>worker.terminate()};
 worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.({message:error.message}));
 return adapter;
}
