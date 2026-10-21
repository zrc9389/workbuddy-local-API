import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, mockAPI, flush } from './frontend_helpers_test.mjs';

const dom = setupDOM();
const $ = dom.$;
const client = await import('./assets/api.js');
const animation = await import('./assets/startup-animation.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('startup animation cycles English AI names and finishes at the hard limit', async () => {
  assert.deepEqual(animation.AI_NAMES, ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Kimi', 'GLM']);
  assert.equal(animation.TARGET_MS, 8000);
  assert.equal(animation.HARD_LIMIT_MS, 10000);
  let finished = 0;
  const player = animation.startStartupAnimation({ onFinish: () => finished++ });
  assert.equal(player.root.parentNode, document.body);
  assert.equal(player.root.dataset.phase, 'names');
  assert.equal(player.root.querySelector?.('.wb-startup-name')?.textContent || 'GPT', 'GPT');
  player.setPhase('syncing');
  assert.equal(player.root.dataset.phase, 'syncing');
  player.destroy();
  assert.equal(finished, 1);
  assert.equal(player.finished(), true);
  player.finish();
  player.destroy();
  assert.equal(finished, 1);
});

test('startup animation hides and removes itself at ten seconds, and stops cycling while hidden', async () => {
  let removed = 0;
  const player = animation.startStartupAnimation({ targetMs: 30, hardLimitMs: 60, onFinish: () => removed++ });
  assert.equal(player.finished(), false);
  const initialIntervals = dom.intervals.size;
  document.hidden = true;
  for (const listener of dom.events.get('visibilitychange') || []) listener({ type: 'visibilitychange' });
  assert.equal(dom.intervals.size, initialIntervals - 1);
  document.hidden = false;
  for (const listener of dom.events.get('visibilitychange') || []) listener({ type: 'visibilitychange' });
  assert.equal(dom.intervals.size, initialIntervals);
  await sleep(90);
  assert.equal(removed, 1);
  assert.equal(player.finished(), true);
  assert.equal(dom.intervals.size, initialIntervals - 1);
});

test('the hard limit tears down the overlay even when the target phase is still running', () => {
  const scheduled = [];
  const repeats = [];
  let finished = 0;
  const player = animation.startStartupAnimation({
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    repeat: (fn, ms) => { repeats.push({ fn, ms }); return repeats.length; },
    cancelSchedule: () => {},
    cancelRepeat: () => {},
    onFinish: () => finished++,
  });
  assert.equal(player.finished(), false);
  const hard = scheduled.find(entry => entry.ms === 10000);
  assert.ok(hard);
  hard.fn();
  assert.equal(player.finished(), true);
  assert.equal(finished, 1);
  assert.equal(document.getElementById('wbStartup'), null);
});

test('authentication starts one bootstrap and does not repeat on a duplicate session event', async () => {
  const calls = mockAPI(url => {
    if (url === '/panel/api/session/bootstrap') return { running: true };
    if (url === '/panel/api/session/bootstrap/status') return { running: false, completed: true, ok: 3 };
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark', credit_guard_low: 100 };
    return { total: 0, healthy: 0, cooling: 0, disabled: 0, accounts: [] };
  });
  const router = await import('./assets/router.js');
  client.acceptSession({ authenticated: true, csrf_token: 'fixture' });
  await dom.emit('panel:authenticated');
  await dom.emit('panel:authenticated');
  await flush();
  const posts = calls.filter(call => call.url === '/panel/api/session/bootstrap' && call.opts.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].opts.headers.get('X-CSRF-Token'), 'fixture');
  assert.equal($('ttl').textContent, '概览');
  router.destroyStartup();
  client.lockSession();
});

test('a successful password login starts the animation before hiding the login card', async () => {
  const calls = mockAPI(url => {
    if (url === '/auth/login') return { authenticated: true, csrf_token: 'login-token', default_password: false };
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark', credit_guard_low: 100 };
    if (url === '/panel/api/session/bootstrap') return { running: true };
    if (url.endsWith('/bootstrap/status')) return { running: true };
    return { total: 0, healthy: 0, cooling: 0, disabled: 0, accounts: [] };
  });
  await import('./assets/auth.js');
  client.lockSession();
  $('loginPassword').value = 'fixture-password';
  await $('loginForm').onsubmit({ preventDefault() {} });
  assert.equal(calls.filter(call => call.url === '/auth/login').length, 1);
  assert.equal($('authVeil').classList.contains('on'), false);
  assert.ok(calls.some(call => call.url === '/panel/api/session/bootstrap' && call.opts.method === 'POST'));
  const router = await import('./assets/router.js');
  router.destroyStartup();
  client.lockSession();
});

test('bootstrap failure is silent and still enters the workspace', async () => {
  const calls = mockAPI(url => {
    if (url === '/panel/api/session/bootstrap') throw new Error('upstream unavailable');
    if (url.endsWith('/capabilities')) return { logs: false };
    if (url.endsWith('/preferences')) throw new Error('preferences unavailable');
    return { total: 0, healthy: 0, cooling: 0, disabled: 0, accounts: [] };
  });
  const router = await import('./assets/router.js');
  client.acceptSession({ authenticated: true, csrf_token: 'fixture' });
  const authError = $('authError');
  authError.textContent = '';
  await dom.emit('panel:authenticated');
  await flush();
  assert.equal(authError.textContent, '');
  assert.equal($('toasts').children.length, 0);
  assert.equal(calls.some(call => call.url === '/panel/api/session/bootstrap'), true);
  assert.equal(document.getElementById('wbStartup'), null);
  router.destroyStartup();
  client.lockSession();
});

test('destroyStartup releases the overlay and all of its timers', async () => {
  const router = await import('./assets/router.js');
  client.acceptSession({ authenticated: true, csrf_token: 'fixture' });
  let releaseBootstrap;
  mockAPI(url => {
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark', credit_guard_low: 100 };
    if (url.endsWith('/bootstrap/status')) return new Promise(resolve => { releaseBootstrap = () => resolve({ running: false, completed: true }); });
    return { total: 0, healthy: 0, cooling: 0, disabled: 0, accounts: [] };
  });
  dom.emit('panel:authenticated');
  await flush();
  router.destroyStartup();
  releaseBootstrap?.();
  await flush();
  assert.equal(dom.nodes.has('wbStartup'), false);
  assert.equal(document.getElementById('wbStartup'), null);
  client.lockSession();
});

test('existing valid cookie enters sync without showing the login form again', async () => {
  dom.$('authVeil').classList.add('on');
  const calls = mockAPI(url => {
    if (url === '/auth/session') return { authenticated: true, csrf_token: 'cookie', default_password: false };
    if (url === '/panel/api/session/bootstrap') return { running: true };
    if (url === '/panel/api/session/bootstrap/status') return { running: false, completed: true };
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark' };
    return { total: 0, healthy: 0, cooling: 0, disabled: 0, accounts: [] };
  });
  const auth = await import('./assets/auth.js');
  await auth.initAuth();
  await flush();
  assert.equal(calls.filter(call => call.url === '/auth/login').length, 0);
  assert.equal(calls.filter(call => call.url === '/panel/api/session/bootstrap').length, 1);
  assert.equal($('authVeil').classList.contains('on'), false);
  const router = await import('./assets/router.js');
  router.destroyStartup();
  client.lockSession();
});

test('logging out destroys the overlay and lets a stale bootstrap finish safely', async () => {
  let releaseStatus;
  mockAPI(url => {
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark', credit_guard_low: 100 };
    if (url === '/panel/api/session/bootstrap') return { running: true };
    if (url.endsWith('/bootstrap/status')) return new Promise(resolve => {
      releaseStatus = () => resolve({ running: false, completed: true });
    });
    return { total: 0, healthy: 0, cooling: 0, disabled: 0, accounts: [] };
  });
  client.acceptSession({ authenticated: true, csrf_token: 'logout' });
  dom.emit('panel:authenticated');
  await flush();
  assert.equal(typeof releaseStatus, 'function');
  client.lockSession();
  releaseStatus?.();
  await flush();
  assert.equal(document.getElementById('wbStartup'), null);
});
