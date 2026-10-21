import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDOM, mockAPI, flush } from './frontend_helpers_test.mjs';

const dom = setupDOM();
const $ = dom.$;
const client = await import('./assets/api.js');
const egress = await import('./assets/egress.js');
const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('assets/styles.css', import.meta.url), 'utf8');

function auth() { client.acceptSession({ authenticated: true, csrf_token: 'token' }); }
function clickTest() {
  const button = { dataset: { testNodes: '' }, disabled: false, closest: selector => selector === 'button[data-test-nodes]' ? button : null };
  return $('nodeList').fire('click', { target: { closest: selector => selector === 'button[data-test-nodes]' ? button : null } });
}
// index.html is owned by the visual batch; mount the real element from it when
// present, otherwise stand in the same contract here.
function mountFilter() {
  let select = $('nodeSubscriptionFilter');
  if (!select) {
    select = new dom.Element('nodeSubscriptionFilter');
    select.tagName = 'SELECT';
    dom.nodes.set('nodeSubscriptionFilter', select);
  }
  select.value = '';
  return select;
}

function clickCard(id) {
  return $('egressNodeGrid').fire('click', { target: { closest: selector => selector === '[data-node-id]' ? { dataset: { nodeId: id } } : null } });
}
function detailButton(name) {
  return { dataset: { subscriptionReveal: name }, closest: selector => selector === '[data-subscription-reveal]' ? { dataset: { subscriptionReveal: name } } : null };
}

const subscriptions = [{ id: 'sub-a', name: 'A 订阅', node_count: 2 }, { id: 'sub-b', name: 'B 订阅', node_count: 1 }];
const allNodes = [
  { id: 'a1', name: 'A1', provider: 'sub-a', status: 'ok', delay_ms: 11 },
  { id: 'a2', name: 'A2', provider: 'sub-a', status: 'ok', delay_ms: 12 },
  { id: 'b1', name: 'B1', provider: 'sub-b', status: 'ok', delay_ms: 13 },
];

function metaAPI() {
  return mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.includes('meta/nodes')) {
      const query = new URL(url, 'http://local').searchParams.get('subscription_id');
      const rows = query ? allNodes.filter(node => node.provider === query) : allNodes;
      return { nodes: rows, bindings: [{ uid: 'acct', node: 'a1' }] };
    }
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/subscriptions')) return { subscriptions };
    if (url.endsWith('meta/tests')) return method === 'POST' ? { id: 'job', running: true, total: 1 } : { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct' }] };
    throw new Error(method + ' ' + url);
  });
}

test('opening the node modal fills the filter from the cached subscription list with no POST', async () => {
  auth();
  const select = mountFilter();
  const calls = metaAPI();
  await egress.loadEgress();
  await egress.openNodeModal('acct');
  assert.equal(calls.filter(call => (call.opts.method || 'GET') !== 'GET').length, 0, '打开弹窗不得写请求');
  assert.ok(calls.some(call => call.url.endsWith('meta/subscriptions')), '筛选器读取的是订阅缓存接口');
  assert.match(select.innerHTML, /全部订阅/);
  assert.match(select.innerHTML, /sub-a/);
  assert.match(select.innerHTML, /sub-b/);
  assert.equal(select.value, '', '默认必须是全部订阅');
  assert.equal(dom.intervals.size, 0, '填充筛选器不得启动测速轮询');
  egress.closeNodeModal();
});

test('switching the filter issues one GET with the encoded id and never posts or polls', async () => {
  auth();
  const select = mountFilter();
  let calls = metaAPI();
  await egress.loadEgress();
  await egress.openNodeModal('acct');
  const before = calls.length;
  select.value = 'sub a&b';
  await select.fire('change');
  const fresh = calls.slice(before);
  assert.equal(fresh.length, 1, '仅一次请求');
  assert.equal(fresh[0].url, '/panel/api/meta/nodes?subscription_id=sub%20a%26b');
  assert.equal((fresh[0].opts.method || 'GET'), 'GET');
  assert.doesNotMatch(fresh[0].url, /meta\/tests/);
  assert.equal(dom.intervals.size, 0, '切换筛选不得开始轮询');
  egress.closeNodeModal();
});

test('a filter keeps only that subscription and preserves bindings for the shown nodes', async () => {
  auth();
  const select = mountFilter();
  metaAPI();
  await egress.openNodeModal('acct');
  select.value = 'sub-b';
  await select.fire('change');
  const html = $('nodeList').innerHTML;
  assert.match(html, /B1/);
  assert.doesNotMatch(html, /A1/);
  assert.doesNotMatch(html, /A2/);
  select.value = '';
  await select.fire('change');
  const reset = $('nodeList').innerHTML;
  assert.equal(reset, $('nodeList').innerHTML);
  assert.match(reset, /A1/);
  assert.match(reset, /B1/);
  assert.match(reset, /当前账号出口/, '回到全部订阅后仍能识别已绑定的 a1');
  egress.closeNodeModal();
});

test('without cached subscriptions the filter keeps the unfiltered node list', async () => {
  auth();
  const select = mountFilter();
  const calls = mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.includes('meta/nodes')) return { nodes: allNodes, bindings: [] };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/subscriptions')) return { subscriptions: [] };
    if (url.endsWith('meta/tests')) return method === 'POST' ? { id: 'x', running: false } : { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct' }] };
    throw new Error(method + ' ' + url);
  });
  await egress.openNodeModal('acct');
  assert.match(select.innerHTML, /全部订阅/);
  assert.doesNotMatch(select.innerHTML, /sub-a/);
  assert.match($('nodeList').innerHTML, /A1/);
  assert.match($('nodeList').innerHTML, /B1/);
  assert.ok(calls.some(call => call.url.endsWith('meta/nodes')));
  assert.equal(dom.intervals.size, 0);
  egress.closeNodeModal();
});

test('closing the modal cancels an in-flight filter request and blocks its late render', async () => {
  auth();
  const select = mountFilter();
  let release, hold = false;
  const calls = mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.includes('meta/nodes') && hold) return new Promise(resolve => {
      releases.push(() => resolve({ nodes: [{ id: 'late', name: 'LATE', provider: 'sub-a', status: 'ok', delay_ms: 1 }], bindings: [] }));
    });
    if (url.includes('meta/nodes')) return { nodes: allNodes, bindings: [] };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/subscriptions')) return { subscriptions };
    if (url.endsWith('meta/tests')) return method === 'POST' ? { id: 'x', running: false } : { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct' }] };
    throw new Error(method + ' ' + url);
  });
  const releases = [];
  release = () => releases.forEach(fn => fn());
  await egress.openNodeModal('acct');
  hold = true;
  select.value = 'sub-a';
  const pending = select.fire('change');
  await flush();
  const filtered = calls.filter(call => call.url.includes('subscription_id=sub-a')).at(-1);
  assert.ok(filtered, '筛选请求已发出');
  assert.ok(filtered.opts.signal, '筛选请求必须可中止');
  egress.closeNodeModal();
  assert.equal(filtered.opts.signal.aborted, true, '关闭弹窗必须中止在途筛选请求');
  release();
  await pending;
  assert.doesNotMatch($('nodeList').innerHTML, /LATE/, '关闭后迟到响应不得渲染');
  assert.equal(dom.intervals.size, 0);
});

test('rapid filter switches keep the newest result and ignore the older response', async () => {
  auth();
  const select = mountFilter();
  const pending = [];
  const calls = mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.includes('subscription_id=') && !url.includes('subscription_id=a1')) {
      return new Promise(resolve => pending.push(() => resolve({
        nodes: [{ id: url.endsWith('sub-b') ? 'b1' : 'a1', name: url.endsWith('sub-b') ? 'B1' : 'A1', provider: url.endsWith('sub-b') ? 'sub-b' : 'sub-a', status: 'ok', delay_ms: 1 }],
        bindings: [],
      })));
    }
    if (url.includes('meta/nodes')) return { nodes: allNodes, bindings: [] };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/subscriptions')) return { subscriptions };
    if (url.endsWith('meta/tests')) return method === 'POST' ? { id: 'x', running: false } : { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct' }] };
    throw new Error(method + ' ' + url);
  });
  await egress.openNodeModal('acct');
  select.value = 'sub-a';
  const first = select.fire('change');
  await flush();
  select.value = 'sub-b';
  const second = select.fire('change');
  await flush();
  assert.equal(pending.length, 2, '两次切换各自发出一次请求');
  // The older request resolves last on purpose.
  pending[1]();
  await second;
  pending[0]();
  await first;
  const html = $('nodeList').innerHTML;
  assert.match(html, /B1/, '最新筛选结果必须生效');
  assert.doesNotMatch(html, /A1/, '旧筛选的迟到响应不得覆盖新结果');
  assert.equal(dom.intervals.size, 0, '切换筛选不启动轮询');
  egress.closeNodeModal();
});

test('a filtered refresh preserves bindings for accounts outside the filter', async () => {
  auth();
  const select = mountFilter();
  mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/subscriptions')) return { subscriptions };
    if (url.includes('meta/nodes')) {
      const query = new URL(url, 'http://local').searchParams.get('subscription_id');
      if (query === 'sub-b') return { nodes: [allNodes[2]], bindings: [] };
      return { nodes: allNodes, bindings: [{ uid: 'acct', node: 'a1' }] };
    }
    if (url.endsWith('meta/tests')) return method === 'POST' ? { id: 'x', running: false } : { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct' }] };
    throw new Error(method + ' ' + url);
  });
  await egress.loadEgress();
  await egress.openNodeModal('acct');
  select.value = 'sub-b';
  await select.fire('change');
  assert.match($('nodeList').innerHTML, /B1/);
  assert.doesNotMatch($('nodeList').innerHTML, /A1/);
  // Switching back must still show a1 as the bound node of acct.
  select.value = '';
  await select.fire('change');
  assert.match($('nodeList').innerHTML, /当前账号出口/);
  assert.match($('egressAccounts').innerHTML, /A1/);
  egress.closeNodeModal();
});

test('latency polling under a filter keeps only that subscription and preserves outer bindings', async () => {
  auth();
  const select = mountFilter();
  let running = true;
  mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/subscriptions')) return { subscriptions };
    if (url.includes('meta/nodes')) {
      const query = new URL(url, 'http://local').searchParams.get('subscription_id');
      if (query === 'sub-b') return { nodes: [{ ...allNodes[2], status: running ? 'testing' : 'ok' }], bindings: [] };
      return { nodes: allNodes, bindings: [{ uid: 'acct', node: 'a1' }] };
    }
    if (url.endsWith('meta/tests')) {
      if (method === 'POST') return { id: 'job', running: true, total: 1, completed: 0 };
      return running ? { id: 'job', running: true, total: 1, completed: 0 } : { id: 'job', running: false, total: 1, completed: 1 };
    }
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct' }] };
    throw new Error(method + ' ' + url);
  });
  await egress.loadEgress();
  await egress.openNodeModal('acct');
  select.value = 'sub-b';
  await select.fire('change');
  const posted = clickTest();
  await flush();
  assert.equal(dom.intervals.size, 1, '筛选状态下显式测速应开始轮询');
  running = false;
  await egress.pollNodeTests();
  await posted;
  assert.equal(dom.intervals.size, 0, '测试结束后停止轮询');
  const html = $('nodeList').innerHTML;
  assert.match(html, /B1/);
  assert.doesNotMatch(html, /A1/);
  select.value = '';
  await select.fire('change');
  assert.match($('nodeList').innerHTML, /当前账号出口/, '轮询期间外部的绑定不得丢失');
  egress.closeNodeModal();
});

test('batch 3 first screen is a node grid with a compact subscription overview, not traffic cards', () => {
  const view = html.slice(html.indexOf('id="view-egress"'), html.indexOf('<!-- ===== /view:egress ===== -->'));
  assert.match(view, /id="egressOverviewText"/);
  assert.match(view, /id="egressNodeGrid"[^>]*class="egress-node-grid"/);
  assert.match(view, /id="nodeSubscriptionFilter"/);
  assert.ok(view.indexOf('egressOverviewText') < view.indexOf('egressNodeGrid'), 'overview precedes the node body');
  assert.ok(view.indexOf('egressNodeGrid') < view.indexOf('class="egress-metrics"'), 'traffic sits below the nodes');
  assert.doesNotMatch(view, /class="egress-top"/);
  assert.doesNotMatch(view, /class="metric-card"/);
  assert.doesNotMatch(html, /按账号独立绑定，不修改系统代理或 TUN/);
  assert.doesNotMatch(html, /内核累计值；重启可能归零/);
  assert.doesNotMatch(html, /每个账号使用一个独立出口/);
  assert.doesNotMatch(html, /延迟显示在节点名称后/);
  assert.match(css, /\.egress-node-grid\s*\{[^}]*repeat\(auto-fill,minmax\(150px,1fr\)\)/);
});

test('the main node grid binds with a read-back and keeps a 48h cache marker without clearing nodes', async () => {
  auth();
  const old = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
  let bound = [];
  const calls = mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/tests')) return { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [{ uid: 'acct', nickname: '主账号' }] };
    if (url.endsWith('meta/subscriptions')) return { subscriptions: [{ id: 'sub-a', name: '主力', enabled: true, node_count: 2, last_refresh_at: old, has_url: true, url_preview: 'https://secret.example/…' }] };
    if (url.includes('meta/nodes')) return { nodes: allNodes, bindings: bound };
    if (url.endsWith('/bind')) { bound = [{ uid: 'acct', node: JSON.parse(opts.body).node }]; return { ok: true }; }
    throw new Error(method + ' ' + url);
  });
  await egress.loadEgress();
  assert.match($('egressOverviewText').textContent, /1 个订阅 · 1 启用 · 2 节点/);
  assert.match($('egressOverviewText').textContent, /缓存已过期/);
  assert.match($('egressNodeGrid').innerHTML, /A1/);
  assert.doesNotMatch($('egressNodeGrid').innerHTML, /secret\.example/);
  assert.doesNotMatch($('egressNodeGrid').innerHTML, /绑定此节点/);
  assert.equal(dom.intervals.size, 0);
  await clickCard('a1');
  assert.equal($('egressAccountBar').hidden, false, 'no target UID falls back to the compact account picker');
  $('egressAccountSelect').value = 'acct';
  await $('egressAccountSelect').fire('change');
  const bindCalls = calls.filter(call => call.url.endsWith('/bind'));
  assert.deepEqual(JSON.parse(bindCalls[0].opts.body), { node: 'a1' });
  assert.ok(calls.some(call => call.url.endsWith('meta/nodes') && (call.opts.method || 'GET') === 'GET'), 'binding reads back');
  assert.match($('egressNodeGrid').innerHTML, /aria-pressed="true"/);
  assert.equal(dom.intervals.size, 0, 'binding never starts latency polling');
});

test('main filter switches with one GET and never posts or clears a failed read', async () => {
  auth();
  const calls = mockAPI((url, opts) => {
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/tests')) return { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [] };
    if (url.endsWith('meta/subscriptions')) return { subscriptions };
    if (url.includes('subscription_id=sub%20a%26b')) throw Object.assign(new Error('read failed'), { status: 500 });
    if (url.includes('meta/nodes')) return { nodes: allNodes, bindings: [] };
    throw new Error((opts.method || 'GET') + ' ' + url);
  });
  await egress.loadEgress();
  assert.match($('egressNodeGrid').innerHTML, /A1/);
  const before = calls.length;
  $('nodeSubscriptionFilter').value = 'sub a&b';
  await $('nodeSubscriptionFilter').fire('change');
  const fresh = calls.slice(before);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].url, '/panel/api/meta/nodes?subscription_id=sub%20a%26b');
  assert.equal(fresh[0].opts.method, 'GET');
  assert.match($('egressNodeGrid').innerHTML, /A1/, 'a failed filter read keeps the cached node list');
  assert.equal(dom.intervals.size, 0);
});

test('refreshSubscriptionsOnce refreshes enabled subscriptions serially, skips tests and absorbs a single failure', async () => {
  auth();
  const started = [];
  const events = [];
  document.addEventListener('panel:subscriptions-refreshed', event => events.push(event.detail));
  const calls = mockAPI(async (url, opts) => {
    if (url.endsWith('meta/subscriptions')) {
      if ((opts.method || 'GET') === 'GET') return { subscriptions: [
        { id: 'sub-a', enabled: true }, { id: 'sub-off', enabled: false }, { id: 'sub-b', enabled: true },
      ] };
      const body = JSON.parse(opts.body);
      started.push({id: body.id, action: body.action, signal: opts.signal});
      if (body.id === 'sub-b') throw new Error('upstream failed');
      return { ok: true, nodes: 1 };
    }
    if (url.endsWith('meta/nodes')) return { nodes: allNodes, bindings: [] };
    throw new Error(url);
  });
  const result = await egress.refreshSubscriptionsOnce({ timeoutMs: 8000 });
  assert.deepEqual(started.map(item => item.id), ['sub-a', 'sub-b'], 'enabled subscriptions refresh serially');
  assert.ok(started.every(item => item.action === 'refresh'), 'only the per-id refresh action is posted');
  assert.ok(started.every(item => item.signal instanceof AbortSignal), 'each refresh carries its own abort signal');
  assert.notEqual(started[0].signal, started[1].signal, 'each item owns an independent controller');
  assert.equal(result.refreshed, 1);
  assert.deepEqual(result.failed.map(item => item.id), ['sub-b']);
  assert.equal(result.nodes.length, 3);
  assert.equal(result.ok, false);
  assert.doesNotMatch(calls.map(call => call.url).join('\n'), /meta\/tests/);
  assert.equal(events.length, 1, 'the refresh notifies listeners through one in-memory event');
  assert.deepEqual(events[0].failed.map(item => item.id), ['sub-b']);
});

test('subscriptionCacheState reports 47h fresh, 49h expired and empty as never refreshed', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const fresh = egress.subscriptionCacheState(new Date(now - 47 * 3600000).toISOString(), now);
  assert.deepEqual(fresh, { expired: false, ageHours: 47, label: '缓存 47 小时前' });
  const stale = egress.subscriptionCacheState(new Date(now - 49 * 3600000).toISOString(), now);
  assert.deepEqual(stale, { expired: true, ageHours: 49, label: '缓存已过期' });
  assert.deepEqual(egress.subscriptionCacheState(null, now), { expired: false, ageHours: null, label: '未刷新过' });
  assert.deepEqual(egress.subscriptionCacheState('', now), { expired: false, ageHours: null, label: '未刷新过' });
  const exactly48 = egress.subscriptionCacheState(new Date(now - 48 * 3600000).toISOString(), now);
  assert.equal(exactly48.expired, false, 'only >48h expires');
});

test('subscription details request the reveal only on click and clear the plain URL on close', async () => {
  auth();
  const calls = mockAPI((url) => {
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/tests')) return { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [] };
    if (url.includes('reveal=1')) return { id: 'sub-a', url: 'https://secret.example/private?token=1' };
    if (url.endsWith('meta/subscriptions')) return { subscriptions: [{ id: 'sub-a', name: '主力', enabled: true, node_count: 2, has_url: true, url_preview: 'https://secret.example/…' }] };
    if (url.includes('meta/nodes')) return { nodes: allNodes, bindings: [] };
    throw new Error(url);
  });
  await egress.loadEgress();
  assert.equal(calls.filter(call => call.url.includes('reveal=1')).length, 0, 'loading never reveals');
  await dom.click('btnSubscriptionDetails');
  assert.equal(calls.filter(call => call.url.includes('reveal=1')).length, 0, 'opening details never reveals');
  assert.match($('subscriptionDetailList').innerHTML, /查看地址/);
  assert.doesNotMatch($('subscriptionDetailList').innerHTML, /private\?token/);
  await $('subscriptionDetailList').fire('click', { target: { closest: selector => selector === '[data-subscription-reveal]' ? { dataset: { subscriptionReveal: 'sub-a' } } : null } });
  assert.equal($('subscriptionRevealURL').textContent, 'https://secret.example/private?token=1');
  await dom.click('btnCloseSubscriptions');
  assert.equal($('subscriptionRevealURL').textContent, '');
  assert.equal($('subscriptionRevealLabel').textContent, '');
  assert.equal($('subscriptionDetailList').innerHTML, '');
  assert.deepEqual(calls.filter(call => call.url.includes('reveal=1')).map(call => call.url), ['/panel/api/meta/subscriptions?id=sub-a&reveal=1']);
});

test('inline import posts URL and optional name, then rereads subscriptions and nodes for four or more rows', async () => {
  auth();
  const rows = Array.from({ length: 5 }, (_, index) => ({ id: 'sub-' + index, name: '订阅 ' + index, enabled: true, node_count: index + 1 }));
  const calls = mockAPI((url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url.endsWith('meta/status')) return { available: true, running: true };
    if (url.endsWith('meta/stats')) return {};
    if (url.endsWith('meta/tests')) return { id: 'cached', running: false, total: 3 };
    if (url.endsWith('/overview')) return { accounts: [] };
    if (url.endsWith('meta/subscriptions')) return method === 'POST' ? { ok: true, nodes: 2 } : { subscriptions: rows };
    if (url.includes('meta/nodes')) return { nodes: allNodes, bindings: [] };
    throw new Error(method + ' ' + url);
  });
  await egress.loadEgress();
  assert.equal(calls.filter(call => call.url.endsWith('meta/subscriptions') && call.opts.method === 'POST').length, 0, 'loading never imports');
  await dom.click('btnEgressImport');
  $('egressSubscriptionURL').value = 'https://example.com/sub?token=x';
  $('egressSubscriptionName').value = '备用';
  const before = calls.length;
  await $('egressSubscriptionForm').onsubmit({ preventDefault() {} });
  const fresh = calls.slice(before);
  assert.deepEqual(JSON.parse(fresh[0].opts.body), { url: 'https://example.com/sub?token=x', name: '备用' });
  assert.ok(fresh.some(call => call.url.endsWith('meta/subscriptions') && call.opts.method === 'GET'), 'import rereads subscriptions');
  assert.ok(fresh.some(call => call.url.endsWith('meta/nodes')), 'import rereads nodes');
  assert.doesNotMatch(fresh.map(call => call.url).join('\n'), /meta\/tests/);
  assert.equal($('egressSubscriptionForm').hidden, true);
  assert.match($('egressOverviewText').textContent, /5 个订阅/);
});
