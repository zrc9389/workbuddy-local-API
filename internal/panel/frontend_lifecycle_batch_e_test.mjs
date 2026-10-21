import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, mockAPI, flush } from './frontend_helpers_test.mjs';

const dom = setupDOM();
const $ = dom.$;
const pageHideListeners = [];
const nativeAdd = globalThis.addEventListener;
const pageShowListeners = [];
globalThis.addEventListener = (type, fn) => { if (type === 'pagehide') pageHideListeners.push(fn); if (type === 'pageshow') pageShowListeners.push(fn); return nativeAdd(type, fn); };
const client = await import('./assets/api.js');
const lifecycle = await import('./assets/lifecycle.js');
const egress = await import('./assets/egress.js');
const common = await import('./assets/common.js');

function auth() { client.acceptSession({ authenticated: true, csrf_token: 'token' }); }
function staleButton() {
  return { dataset: { testNodes: '' }, disabled: false, closest(selector) { return selector === 'button[data-test-nodes]' ? this : null; } };
}
function clickTest() {
  return $('nodeList').fire('click', { target: { closest: selector => selector === 'button[data-test-nodes]' ? staleButton() : null } });
}
function metaAPI(overrides = {}) {
  return mockAPI((url, opts) => {
    for (const [suffix, value] of Object.entries(overrides)) if (url.endsWith(suffix)) return typeof value === 'function' ? value(url, opts) : value;
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/nodes')) return { nodes: [{ id: 'n1', name: 'A', status: 'testing' }], bindings: [] };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/tests')) return { id: 'cached', running: true, total: 1 };
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct' }] };
    throw new Error(url);
  });
}

test('egress reads cached status without tests, then explicit testing polls and close stops it', async () => {
  auth();
  let posts = 0;
  const calls = metaAPI({ 'meta/tests': (_url, opts) => { if (opts.method === 'POST') { posts++; return { id: 'job', running: true, total: 1 }; } return { id: posts ? 'job' : 'cached', running: true, total: 1 }; } });
  await egress.loadEgress();
  assert.equal(posts, 0);
  assert.equal(dom.intervals.size, 0);
  assert.ok(calls.every(call => call.opts.method === 'GET'));
  await egress.openNodeModal('acct');
  assert.equal(posts, 0);
  assert.equal(dom.intervals.size, 0);
  const pending = clickTest();
  await flush();
  assert.equal(posts, 1);
  await pending;
  assert.equal(dom.intervals.size, 1);
  egress.closeNodeModal();
  assert.equal(dom.intervals.size, 0);
  const before = $('nodeStatus').textContent;
  await egress.pollNodeTests();
  assert.equal($('nodeStatus').textContent, before);
});

test('closing the modal does not leave polling running', async () => {
  auth();
  const calls = metaAPI();
  await egress.loadEgress();
  await egress.openNodeModal();
  const posted = await client.api('meta/tests', { method: 'POST', body: '{}' });
  assert.equal(posted.id, 'cached');
  const before = $('nodeStatus').textContent;
  egress.closeNodeModal();
  assert.equal($('nodeStatus').textContent, before);
  assert.equal(dom.intervals.size, 0);
  assert.ok(calls.some(call => call.url.endsWith('meta/tests')));
});

test('toast timers are tracked and cleared without affecting page lifecycle', async () => {
  auth();
  const el = common.toast('done', 'ok');
  assert.ok(el);
  common.clearToasts();
  assert.equal(el.textContent, 'done');
});

test('settings does not fetch subscriptions; a subscription GET parses the body once', async () => {
  auth();
  const nativeFetch = globalThis.fetch;
  const calls = mockAPI(() => ({ subscriptions: [] }));
  const config = await import('./assets/config.js');
  await config.loadConfig();
  const before = calls.length;
  await flush();
  assert.equal(calls.length, before);
  let reads = 0;
  globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => { reads++; return { subscriptions: [] }; } });
  try {
    await client.api('meta/subscriptions');
    assert.equal(reads, 1);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('hiding the egress section through normal navigation stops modal polling, and repeated mutations stay idle', async () => {
  auth();
  let posts = 0;
  const calls = metaAPI({ 'meta/tests': (_url, opts) => { if (opts.method === 'POST') { posts++; return { id: 'job', running: true, total: 1 }; } return { id: 'job', running: true, total: 1, completed: 0 }; } });
  await egress.loadEgress();
  await egress.openNodeModal('acct');
  egress.startNodeTests();
  await flush();
  assert.equal(posts, 1);
  assert.equal(dom.intervals.size, 1);
  const view = $('view-egress');
  view.hidden = false;
  await dom.mutation();
  view.hidden = true;
  await dom.mutation();
  assert.equal(dom.intervals.size, 0, '路由隐藏出口视图时必须停止轮询');
  assert.equal(dom.shell.inert, false, '离开视图必须关闭模态框');
  const before = $('nodeStatus').textContent;
  const reads = calls.length;
  await dom.mutation();
  assert.equal(calls.length, reads, '重复的 hidden 属性变更不得再次发起请求');
  await egress.pollNodeTests();
  assert.equal($('nodeStatus').textContent, before);
  view.hidden = false;
  await dom.mutation();
  assert.equal(dom.intervals.size, 0, '回到视图不会自动恢复测试轮询');
});

test('leaving the egress section aborts the in-flight poll and blocks its late response', async () => {
  auth();
  let release, holdNodes = false;
  const calls = mockAPI((url, opts) => {
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/nodes') && holdNodes) return new Promise(resolve => { release = () => resolve({ nodes: [{ id: 'late', name: 'LATE', status: 'ok', delay_ms: 9 }], bindings: [] }); });
    if (url.endsWith('meta/nodes')) return { nodes: [{ id: 'n1', name: 'A', status: 'testing' }], bindings: [] };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/tests')) return { id: 'job', running: true, total: 1 };
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct' }] };
    throw new Error(url);
  });
  await egress.loadEgress();
  await egress.openNodeModal();
  const view = $('view-egress');
  view.hidden = false;
  await dom.mutation();
  holdNodes = true;
  const pending = egress.pollNodeTests();
  await flush();
  const polled = calls.filter(call => call.opts.signal).at(-1);
  assert.ok(polled, '轮询必须携带可中止的 signal');
  view.hidden = true;
  await dom.mutation();
  assert.equal(polled.opts.signal.aborted, true, '离开视图必须中止在途轮询');
  release();
  await pending;
  assert.doesNotMatch($('nodeList').innerHTML, /LATE/, '中止后的迟到响应不得渲染');
});

test('opening and closing the node modal twenty times leaves zero intervals and no listeners', async () => {
  auth();
  metaAPI();
  await egress.loadEgress();
  const shell = dom.shell;
  const documentListeners = Object.fromEntries(['visibilitychange', 'panel:session', 'panel:subscriptions-refreshed', 'hashchange'].map(type => [type, (dom.events.get(type) || []).length]));
  for (let index = 0; index < 20; index++) {
    await egress.openNodeModal('acct');
    assert.equal(shell.inert, true, 'open mounts exactly one modal owner');
    egress.closeNodeModal();
    assert.equal(shell.inert, false, 'close releases the shell every time');
    assert.equal(dom.intervals.size, 0, 'close leaves no interval behind');
  }
  const nodesAfter = dom.nodes.size;
  for (let index = 0; index < 20; index++) {
    await egress.openNodeModal('acct');
    egress.closeNodeModal();
  }
  assert.equal(dom.nodes.size, nodesAfter, 'DOM nodes do not accumulate');
  assert.equal(dom.views.length, 9, 'view list stays fixed');
  for (const [type, count] of Object.entries(documentListeners)) {
    assert.equal((dom.events.get(type) || []).length, count, 'document listener count stays fixed for ' + type);
  }
});

test('hiding pauses polling inside the 30 minute window and resumes, then stops after the deadline', async () => {
  auth();
  metaAPI({ 'meta/tests': (_url, opts) => opts.method === 'POST' ? { id: 'job', running: true, total: 1 } : { id: 'job', running: true, completed: 0 } });
  await egress.loadEgress();
  await egress.openNodeModal('acct');
  egress.startNodeTests();
  await flush();
  assert.equal(dom.intervals.size, 1, 'testing starts one poll interval');
  document.hidden = true;
  await dom.emit('visibilitychange');
  assert.equal(dom.intervals.size, 0, 'hidden stops the poll interval');
  document.hidden = false;
  await dom.emit('visibilitychange');
  assert.equal(dom.intervals.size, 1, 'visible inside the window resumes polling');
  egress.closeNodeModal();
  assert.equal(dom.intervals.size, 0);
});

test('resuming after the 30 minute window stops polling instead of restarting it', async () => {
  auth();
  metaAPI({ 'meta/tests': (_url, opts) => opts.method === 'POST' ? { id: 'job', running: true, total: 1 } : { id: 'job', running: true, completed: 0 } });
  await egress.loadEgress();
  await egress.openNodeModal('acct');
  egress.startNodeTests();
  await flush();
  assert.equal(dom.intervals.size, 1);
  document.hidden = true;
  await dom.emit('visibilitychange');
  assert.equal(dom.intervals.size, 0, 'hidden pauses polling');
  const realNow = Date.now;
  Date.now = () => realNow() + 31 * 60 * 1000;
  try {
    document.hidden = false;
    await dom.emit('visibilitychange');
  } finally {
    Date.now = realNow;
  }
  assert.equal(dom.intervals.size, 0, 'past 30 minutes the poll stays stopped');
  assert.match($('nodeError').textContent, /已停止等待测试结果/);
  egress.closeNodeModal();
  assert.equal(dom.intervals.size, 0);
});

test('navigating away and back twenty times leaves no timers or in-flight reads', async () => {
  auth();
  const calls = metaAPI({ 'meta/tests': (_url, opts) => opts.method === 'POST' ? { id: 'job', running: true, total: 1 } : { id: 'job', running: true, completed: 0 } });
  await egress.loadEgress();
  const view = $('view-egress');
  // Earlier tests may have started the router's 5s visible refresh; only the
  // egress-owned intervals matter, so compare against that baseline.
  const baselineIntervals = dom.intervals.size;
  for (let index = 0; index < 20; index++) {
    view.hidden = false;
    await dom.mutation();
    await egress.openNodeModal('acct');
    egress.startNodeTests();
    await flush();
    assert.equal(dom.intervals.size, baselineIntervals + 1, 'one poll interval while the modal is open');
    view.hidden = true;
    await dom.mutation();
    const postsAfterHide = calls.filter(call => call.url.endsWith('meta/tests') && call.opts.method === 'POST').length;
    await flush();
    assert.equal(calls.filter(call => call.url.endsWith('meta/tests') && call.opts.method === 'POST').length, postsAfterHide, 'no test POST after leaving the view');
    assert.equal(dom.intervals.size, baselineIntervals, 'leaving the view stops the interval every time');
    assert.equal(dom.shell.inert, false, 'leaving the view releases the shell');
  }
});

// pagehide permanently tears down the lifecycle registry, so this case must run
// after every assertion that depends on view cleanup still working.
test('pagehide runs page and view cleanups once and stops stale interval callbacks', async () => {
  auth();
  let viewRuns = 0, pageRuns = 0, ticks = 0;
  const timer = lifecycle.visibleInterval(() => { ticks++; }, 50);
  const tick = dom.intervals.get(timer);
  await tick();
  assert.equal(ticks, 1);
  lifecycle.registerViewCleanup(() => viewRuns++);
  document.hidden = true;
  await dom.emit('visibilitychange');
  assert.equal(viewRuns, 1, '页面隐藏必须清理视图资源');
  document.hidden = false;
  lifecycle.clearViewCleanups();
  assert.equal(viewRuns, 2, '隐藏只暂停资源并保留登记；离开页面再清理一次');
  lifecycle.clearViewCleanups();
  assert.equal(viewRuns, 2, '永久清理后不得重复执行');
  lifecycle.registerPageCleanup(() => pageRuns++);
  for (const listener of pageHideListeners) await listener({ type: 'pagehide' });
  assert.equal(pageRuns, 1);
  await tick();
  assert.equal(ticks, 1);
  for (const listener of pageHideListeners) await listener({ type: 'pagehide' });
  assert.equal(pageRuns, 1);
});

test('login refreshes enabled subscriptions once, serially, and navigation never repeats it', async () => {
  const order = [];
  const calls = mockAPI(async (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark' };
    if (url === '/panel/api/session/bootstrap') return { running: true };
    if (url.endsWith('/session/bootstrap/status')) return { running: false, completed: true };
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/tests')) return { id: 'cached', running: false, total: 0 };
    if (url.endsWith('meta/subscriptions')) {
      if (method === 'GET') return { subscriptions: [
        { id: 'sub-a', enabled: true }, { id: 'sub-off', enabled: false }, { id: 'sub-b', enabled: true },
      ] };
      const body = JSON.parse(opts.body);
      order.push('start:' + body.id);
      await flush();
      order.push('end:' + body.id);
      if (body.id === 'sub-b') throw new Error('upstream failed');
      return { ok: true, nodes: 2 };
    }
    if (url.endsWith('meta/nodes')) return { nodes: [{ id: 'n1', name: 'A', status: 'ok', delay_ms: 8 }], bindings: [] };
    if (url.endsWith('/overview')) return { total: 0, accounts: [] };
    throw new Error(method + ' ' + url);
  });
  const router = await import('./assets/router.js');
  client.acceptSession({ authenticated: true, csrf_token: 'login-refresh' });
  await dom.emit('panel:authenticated');
  await flush();
  assert.deepEqual(order, ['start:sub-a', 'end:sub-a', 'start:sub-b', 'end:sub-b'], 'one serial sequence, each enabled id once');
  const refreshPosts = calls.filter(call => call.url.endsWith('meta/subscriptions') && call.opts.method === 'POST');
  assert.equal(refreshPosts.length, 2, 'exactly one POST per enabled subscription');
  assert.ok(refreshPosts.every(call => JSON.parse(call.opts.body).action === 'refresh'), 'refresh action only');
  assert.ok(refreshPosts.every(call => call.opts.signal instanceof AbortSignal), 'refresh carries an abort signal');
  assert.equal(calls.filter(call => call.url.endsWith('meta/tests') && call.opts.method === 'POST').length, 0, 'login never posts tests');
  assert.equal($('egressRefreshHint').textContent, '1 个订阅刷新失败', 'failure count lands in the egress hint');
  const intervalsAfterLogin = dom.intervals.size;

  await dom.emit('panel:authenticated');
  await flush();
  assert.equal(calls.filter(call => call.url.endsWith('meta/subscriptions') && call.opts.method === 'POST').length, 2, 'duplicate auth event stays idempotent');

  for (let index = 0; index < 20; index++) await router.go(index % 2 ? 'accounts' : 'egress');
  assert.equal(calls.filter(call => call.url.endsWith('meta/subscriptions') && call.opts.method === 'POST').length, 2, 'navigation never refreshes subscriptions');
  assert.equal(calls.filter(call => call.url.endsWith('meta/tests') && call.opts.method === 'POST').length, 0, 'navigation never posts tests');
  assert.equal(dom.intervals.size, intervalsAfterLogin, 'navigation does not add timers');
  location.hash = '#egress';
  await dom.emit('hashchange');
  location.hash = '#overview';
  await dom.emit('hashchange');
  assert.equal(calls.filter(call => call.url.endsWith('meta/subscriptions') && call.opts.method === 'POST').length, 2, 'hashchange never refreshes subscriptions');
  assert.equal(calls.filter(call => call.url.endsWith('meta/tests') && call.opts.method === 'POST').length, 0, 'hashchange never posts tests');
  const hint = $('egressRefreshHint');
  hint.textContent = '';
  const toastsBefore = $('toasts').children.length;
  document.dispatchEvent(new CustomEvent('panel:subscriptions-refreshed', { detail: { ok: true, refreshed: 2, failed: [], nodes: [] } }));
  assert.equal(hint.textContent, '', 'a clean refresh clears the stale failure hint');
  document.dispatchEvent(new CustomEvent('panel:subscriptions-refreshed', { detail: { ok: false, refreshed: 0, failed: [{ id: 'sub-a', error: 'x' }, { id: 'sub-b', error: 'y' }], nodes: [] } }));
  assert.equal(hint.textContent, '2 个订阅刷新失败', 'the page shows the failure count without a dialog');
  assert.equal($('toasts').children.length, toastsBefore, 'refresh failures never use a global toast');
  router.destroyStartup();
  client.lockSession();
});

test('logging out aborts the in-flight login refresh instead of waiting for it', async () => {
  let refreshSignal = null;
  mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark' };
    if (url === '/panel/api/session/bootstrap') return { running: true };
    if (url.endsWith('/session/bootstrap/status')) return { running: false, completed: true };
    if (url.endsWith('meta/subscriptions') && method === 'GET') return { subscriptions: [{ id: 'sub-slow', enabled: true }] };
    if (url.endsWith('meta/subscriptions')) {
      refreshSignal = opts.signal;
      return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))));
    }
    if (url.endsWith('meta/nodes')) return { nodes: [], bindings: [] };
    if (url.endsWith('/overview')) return { total: 0, accounts: [] };
    throw new Error(method + ' ' + url);
  });
  const router = await import('./assets/router.js');
  client.acceptSession({ authenticated: true, csrf_token: 'logout-refresh' });
  const pending = dom.emit('panel:authenticated');
  for (let attempt = 0; attempt < 20 && !refreshSignal; attempt++) await flush();
  assert.ok(refreshSignal, 'the refresh POST carries a signal');
  assert.equal(refreshSignal.aborted, false);
  client.lockSession();
  assert.equal(refreshSignal.aborted, true, 'logout aborts the late refresh');
  await pending;
  router.destroyStartup();
});

test('pagehide aborts the login refresh, runs cleanup once, and pageshow does not reinitialize', async () => {
  let refreshSignal = null, bootstrapPosts = 0;
  mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark' };
    if (url === '/panel/api/session/bootstrap') { bootstrapPosts++; return { running: true }; }
    if (url.endsWith('/session/bootstrap/status')) return { running: false, completed: true };
    if (url.endsWith('meta/subscriptions') && method === 'GET') return { subscriptions: [{ id: 'sub-slow', enabled: true }] };
    if (url.endsWith('meta/subscriptions')) {
      refreshSignal = opts.signal;
      return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))));
    }
    if (url.endsWith('meta/nodes')) return { nodes: [], bindings: [] };
    if (url.endsWith('/overview')) return { total: 0, accounts: [] };
    throw new Error(method + ' ' + url);
  });
  const router = await import('./assets/router.js');
  client.acceptSession({ authenticated: true, csrf_token: 'pagehide-refresh' });
  const pending = dom.emit('panel:authenticated');
  for (let attempt = 0; attempt < 20 && !refreshSignal; attempt++) await flush();
  assert.ok(refreshSignal);
  for (const listener of pageHideListeners) await listener({ type: 'pagehide' });
  assert.equal(refreshSignal.aborted, true, 'pagehide aborts the late refresh');
  assert.equal(document.getElementById('wbStartup'), null, 'pagehide tears the overlay down once');
  const postsAfterHide = bootstrapPosts;
  for (const listener of pageShowListeners) await listener({ type: 'pageshow', persisted: true });
  await flush();
  assert.equal(bootstrapPosts, postsAfterHide, 'pageshow alone never reinitializes the login flow');
  assert.equal(document.getElementById('wbStartup'), null, 'pageshow does not remount the overlay');
  // A second pagehide must be a no-op thanks to the idempotence flag.
  for (const listener of pageHideListeners) await listener({ type: 'pagehide' });
  assert.equal(document.getElementById('wbStartup'), null, 'repeated pagehide stays torn down');
  await pending;
  router.destroyStartup();
  client.lockSession();
});
