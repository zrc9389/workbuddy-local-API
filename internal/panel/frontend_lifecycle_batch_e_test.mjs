import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, mockAPI, flush } from './frontend_helpers_test.mjs';

const dom = setupDOM();
const $ = dom.$;
const pageHideListeners = [];
const nativeAdd = globalThis.addEventListener;
globalThis.addEventListener = (type, fn) => { if (type === 'pagehide') pageHideListeners.push(fn); return nativeAdd(type, fn); };
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
