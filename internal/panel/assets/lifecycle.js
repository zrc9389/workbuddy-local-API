import { session, cancelReads } from './api.js';
const timers = new Set();
const pageCleanups = new Set();
let viewCleanups = new Set();
// Skip hidden/locked pages and overlapping polls. In-flight GETs are cancelled on hide.
export function visibleInterval(fn, ms) {
  let busy = false;
  const timer = setInterval(async () => {
    if (!timers.has(timer)) return;
    if (busy || document.hidden || !session.authenticated) return;
    busy = true;
    try { await fn(); } catch (error) { if (error.name !== 'AbortError') console.warn('刷新失败', error.message); }
    finally { busy = false; }
  }, ms);
  timers.add(timer); return timer;
}
export function clearVisibleInterval(timer) { clearInterval(timer); timers.delete(timer); }
// Page-owned resources run once when the document is hidden for unload or
// explicitly disposed. The disposer is idempotent.
export function registerPageCleanup(cleanup) {
  if (typeof cleanup !== 'function') return () => {};
  pageCleanups.add(cleanup);
  return () => { if (pageCleanups.delete(cleanup)) cleanup(); };
}
// View-owned resources run when navigating away, hiding the page or unloading
// it. The returned disposer only unregisters without invoking it.
export function registerViewCleanup(cleanup) {
  if (typeof cleanup !== 'function') return () => {};
  viewCleanups.add(cleanup);
  return () => { viewCleanups.delete(cleanup); };
}
// The router swaps `.view[hidden]` in place and rewrites the history entry
// without emitting hashchange, so leaving a view is detected on its section.
const viewHooks = new Map(), viewHidden = new WeakMap();
let viewObserver = null;
function ensureViewObserver() {
  if (viewObserver || typeof MutationObserver === 'undefined') return;
  viewObserver = new MutationObserver(() => {
    for (const [element, hooks] of viewHooks) {
      const hidden = !!element.hidden, wasHidden = viewHidden.get(element) === true;
      viewHidden.set(element, hidden);
      if (!hidden || wasHidden) continue;
      for (const hook of hooks) { try { hook(); } catch (error) { if (error.name !== 'AbortError') console.warn('视图离开清理失败', error.message); } }
    }
  });
  viewObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['hidden'], subtree: true});
  registerPageCleanup(() => { viewObserver?.disconnect(); viewObserver = null; viewHooks.clear(); });
}
// Fires only on the visible -> hidden transition, so repeated attribute
// mutations cannot re-run an already released view.
export function onViewHidden(viewId, cleanup) {
  if (typeof cleanup !== 'function') return () => {};
  const element = document.getElementById('view-' + viewId);
  if (!element) return () => {};
  if (!viewHooks.has(element)) viewHooks.set(element, new Set());
  viewHooks.get(element).add(cleanup);
  viewHidden.set(element, !!element.hidden);
  ensureViewObserver();
  return () => { viewHooks.get(element)?.delete(cleanup); };
}
function runViewCleanups(permanent) {
  const pending = viewCleanups;
  if (permanent) viewCleanups = new Set();
  for (const cleanup of pending) { try { cleanup(); } catch (error) { if (error.name !== 'AbortError') console.warn('视图清理失败', error.message); } }
}
export function clearViewCleanups() { runViewCleanups(true); }
export function pauseViewResources() { runViewCleanups(false); }
let pageStopped = false;
function stopPage() {
  if (pageStopped) return;
  pageStopped = true;
  clearViewCleanups();
  for (const cleanup of pageCleanups) { try { cleanup(); } catch (error) { if (error.name !== 'AbortError') console.warn('页面清理失败', error.message); } }
  pageCleanups.clear();
  cancelReads();
  for (const timer of timers) clearInterval(timer);
  timers.clear();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) return; if (!pageStopped) pauseViewResources(); cancelReads(); });
addEventListener('pagehide', stopPage);
addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
export function disposeLifecycle() { stopPage(); }
