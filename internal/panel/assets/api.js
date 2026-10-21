// All network access uses the local session; CSRF exists only in memory.
export const session = { authenticated: false, csrf_token: '', default_password: false };
const reads = new Set();
let epoch = 0;
function emitSession() { document.dispatchEvent(new CustomEvent('panel:session', { detail: { ...session } })); }
export function lockSession() {
  epoch++;
  Object.assign(session, { authenticated: false, csrf_token: '', default_password: false });
  cancelReads(); emitSession();
}
export function cancelReads() { for (const controller of reads) controller.abort(); reads.clear(); }
export async function request(path, opts = {}) {
  if (!path.startsWith('/panel/api/') && !path.startsWith('/auth/')) throw new Error('不允许的请求路径');
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && !opts.body) opts = { ...opts, body: '{}' };
  const headers = new Headers(opts.headers || {});
  if (opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (method !== 'GET' && path !== '/auth/login') {
    if (!session.authenticated || !session.csrf_token) { lockSession(); throw new Error('请先登录管理会话'); }
    headers.set('X-CSRF-Token', session.csrf_token);
  }
  const controller = new AbortController(), started = epoch;
  const abort = () => controller.abort();
  opts.signal?.addEventListener('abort', abort, { once: true });
  if (opts.signal?.aborted) controller.abort();
  if (method === 'GET') reads.add(controller);
  const timeout = setTimeout(abort, method === 'GET' ? 60000 : 180000);
  try {
    const r = await fetch(path, { ...opts, method, headers, credentials: 'same-origin', signal: controller.signal });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { lockSession(); throw new Error('会话已失效，请重新登录'); }
    if (!r.ok) { const error = new Error(typeof d.error === 'string' ? d.error : d.error?.message || ('HTTP ' + r.status)); error.status = r.status; error.data = d; throw error; }
    if (started !== epoch && path.startsWith('/panel/api/')) throw new DOMException('会话已变更', 'AbortError');
    return d;
  } finally {
    clearTimeout(timeout); reads.delete(controller); opts.signal?.removeEventListener('abort', abort);
  }
}
export function api(path, opts) { return request('/panel/api/' + path, opts); }
export function acceptSession(d) {
  Object.assign(session, { authenticated: !!d.authenticated, csrf_token: d.authenticated ? (d.csrf_token || '') : '', default_password: !!d.default_password });
  emitSession(); return session;
}
export async function refreshSession() { return acceptSession(await request('/auth/session')); }
