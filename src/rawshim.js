// What LibRaw's WebAssembly build needs to run in node.
//
// libraw-wasm is made for a browser page. It starts a module Worker, which in
// turn starts more (Emscripten's pthreads, all sharing one WebAssembly memory),
// and it loads its .wasm with fetch and a synchronous XMLHttpRequest. Node has
// none of that. This file gives it the three things it asks for, over node's
// own worker_threads, so the decoder is the very one the app runs:
//
//   Worker           a web-style Worker (onmessage, postMessage, terminate)
//   fetch            for file: URLs
//   XMLHttpRequest   synchronous, for file: URLs
//
// installRawShim() puts them on globalThis in the thread that calls it. Every
// worker this Worker starts runs src/rawshim-worker.js first, which sets the
// same up inside it (that is what makes the nested workers work), so nothing
// has to be carried through NODE_OPTIONS or a command line.
//
// It is plain files on disk, so it works from a global npm install and from
// the packaged app run as node (ELECTRON_RUN_AS_NODE, asar off). file: URLs go
// through fileURLToPath, which reads a Windows drive letter correctly.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';

const BOOT = fileURLToPath(new URL('./rawshim-worker.js', import.meta.url));

/** A file: URL (string or URL) as bytes, or null when it is not one. */
function readFileUrl(u) {
  const s = String(u);
  if (!s.startsWith('file:')) return null;
  return fs.readFileSync(fileURLToPath(s));
}

const arrayBufferOf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);

/** fetch that also reads file: URLs. Anything else goes to the real one. */
export function makeFetch(realFetch) {
  return async function fetchFile(u, options) {
    const s = String(u);
    if (!s.startsWith('file:')) return realFetch(u, options);
    let bytes;
    try { bytes = readFileUrl(s); } catch (err) {
      return new Response(null, { status: 404, statusText: err.code || 'not found' });
    }
    return new Response(bytes, {
      status: 200,
      headers: { 'content-type': s.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
    });
  };
}

/** The synchronous XMLHttpRequest Emscripten uses for a file: URL. */
export class FileXMLHttpRequest {
  open(method, url) { this.method = method; this.url = String(url); }
  send() {
    try {
      this.response = arrayBufferOf(readFileUrl(this.url));
      this.status = 200;
    } catch {
      this.response = null;
      this.status = 404;
    }
  }
  getResponseHeader() { return null; }
}

/**
 * A web-style Worker over a worker_thread. `options.name` becomes the worker's
 * `name` global, which the Emscripten build reads to know it is a pthread.
 */
export class RawWorker {
  constructor(url, options = {}) {
    this._thread = new NodeWorker(BOOT, { workerData: { url: String(url), name: options.name || '' } });
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this._listeners = { message: new Set(), error: new Set() };
    this._thread.on('message', (data) => this._emit('message', { data, target: this }));
    this._thread.on('error', (error) => this._emit('error', { error, message: error && error.message, target: this }));
  }

  _emit(type, event) {
    const handler = this['on' + type];
    if (typeof handler === 'function') handler.call(this, event);
    for (const l of this._listeners[type] || []) l.call(this, event);
    // An error nobody is listening for must not vanish: the decode would hang.
    if (type === 'error' && typeof handler !== 'function' && !(this._listeners.error && this._listeners.error.size)) {
      process.nextTick(() => { throw event.error; });
    }
  }

  postMessage(message, transfer) { this._thread.postMessage(message, Array.isArray(transfer) ? transfer : transfer && transfer.transfer); }
  addEventListener(type, fn) { (this._listeners[type] ||= new Set()).add(fn); }
  removeEventListener(type, fn) { this._listeners[type] && this._listeners[type].delete(fn); }
  terminate() { return this._thread.terminate(); }
  unref() { this._thread.unref(); }
}

/** Put Worker, fetch and XMLHttpRequest on `scope` (globalThis unless a test says otherwise). */
export function installRawShim(scope = globalThis) {
  if (scope.__rawShim) return;
  scope.__rawShim = true;
  scope.Worker = RawWorker;
  scope.fetch = makeFetch(scope.fetch);
  scope.XMLHttpRequest = FileXMLHttpRequest;
}
