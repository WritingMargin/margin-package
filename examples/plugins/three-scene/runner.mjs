const activeWorkers = new Map();
export function activeWorkerCount() { return activeWorkers.size; }
const failure = message => ({ok:false,logs:[],error:message.slice(0,2000)});
function createWorker() {
  const source = typeof __MARGIN_THREE_WORKER__ === 'string' ? __MARGIN_THREE_WORKER__ : '';
  if (!source) throw new Error('Build the Three.js browser bundle before running it.');
  const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
  try { return new Worker(url); } finally { URL.revokeObjectURL(url); }
}
export async function stopWorkers() { for (const cancel of [...activeWorkers.values()]) cancel(); }
/** Each job is isolated in a disposable browser worker; no code reaches Margin's server. */
export function executeScene(code, signal, {timeoutMs=2000, workerFactory=createWorker}={}) {
  if (signal.aborted) return Promise.resolve(failure('Execution cancelled.'));
  return new Promise(resolve => {
    let worker;
    try { worker=workerFactory(); } catch(error) { resolve(failure(error.message)); return; }
    let settled=false;
    const finish=result=>{
      if(settled)return;
      settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);
      worker.terminate();activeWorkers.delete(worker);resolve(result);
    };
    const cancel=()=>finish(failure('Execution cancelled.'));
    const timer=setTimeout(()=>finish(failure('Three.js code exceeded its two-second execution limit.')),timeoutMs);
    activeWorkers.set(worker,cancel);
    signal.addEventListener('abort',cancel,{once:true});
    worker.onmessage=event=>finish(event.data);
    worker.onerror=event=>finish(failure(`Scene worker failed: ${event.message || 'unknown error'}`));
    if(signal.aborted)cancel();else worker.postMessage({code});
  });
}
