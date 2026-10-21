import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, mockAPI, flush } from './frontend_helpers_test.mjs';

const dom = setupDOM();
const $ = dom.$;
const client = await import('./assets/api.js');
const egress = await import('./assets/egress.js');

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
