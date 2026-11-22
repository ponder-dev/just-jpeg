// The first thing every worker the raw shim starts runs (see rawshim.js).
//
// It makes this worker_thread look like a web worker to LibRaw's build:
// `self`, a WorkerGlobalScope (how Emscripten knows it is in a worker), a
// `name`, postMessage, onmessage, and the same Worker, fetch and
// XMLHttpRequest the main thread has, so the workers it starts work too.
// Then it loads the module it was started for.

import { parentPort, workerData } from 'node:worker_threads';
import { installRawShim } from './rawshim.js';

globalThis.self = globalThis;
globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
globalThis.name = workerData.name;
installRawShim(globalThis);

const listeners = new Set();
let handler = null;
let loaded = false;
const queue = [];

// A web worker's messages wait until its script has run. Messages that come
// while the module is still loading wait here, then go in order.
function deliver(data) {
  const event = { data, target: globalThis };
  if (typeof handler === 'function') handler(event);
  for (const l of listeners) l(event);
}
function flush() {
  while (loaded && (handler || listeners.size) && queue.length) deliver(queue.shift());
}

Object.defineProperty(globalThis, 'onmessage', {
  configurable: true,
  get: () => handler,
  set: (fn) => { handler = fn; flush(); },
});
globalThis.addEventListener = (type, fn) => { if (type === 'message') { listeners.add(fn); flush(); } };
globalThis.removeEventListener = (type, fn) => { if (type === 'message') listeners.delete(fn); };
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, Array.isArray(transfer) ? transfer : transfer && transfer.transfer);
globalThis.close = () => process.exit(0);

parentPort.on('message', (data) => { queue.push(data); flush(); });

await import(workerData.url);
loaded = true;
flush();
