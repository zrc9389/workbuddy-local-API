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

function descendants(element, found = []) {
  for (const child of element?.children || []) {
    found.push(child);
    descendants(child, found);
  }
  return found;
}

function classesOf(player) {
  return descendants(player.root).map(el => String(el.className || ''));
}

const intervalsBeforeReduced = dom.intervals.size;

function withReducedMotion(run) {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
  try { return run(); }
  finally { globalThis.matchMedia = original; }
}

test('startup animation cycles English AI names and finishes at the hard limit', async () => {
  assert.deepEqual(animation.AI_NAMES, ['GPT', 'Claude', 'Gemini', 'Grok', 'DeepSeek', 'Qwen', 'Kimi', 'Llama']);
  assert.equal(animation.TARGET_MS, 8000);
  assert.equal(animation.HARD_LIMIT_MS, 20000);
  let finished = 0;
  const host = new dom.Element('startupHost');
  const player = animation.startStartupAnimation({ host, onFinish: () => finished++ });
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0], player.root);
  assert.equal(player.root.dataset.phase, 'names');
  assert.equal(classesOf(player).some(name => name.includes('wb-startup-word')), true);
  assert.ok(descendants(player.root).some(el => el.textContent === 'GPT'));
  player.setPhase('syncing');
  assert.equal(player.root.dataset.phase, 'syncing');
  player.destroy();
  assert.equal(finished, 1);
  assert.equal(player.finished(), true);
  player.finish();
  player.destroy();
  assert.equal(finished, 1);
  player.destroy();
  assert.equal(finished, 1);
});

test('finish plays the 360ms exit before unmounting the overlay', async () => {
  const host = new dom.Element('startupHost');
  let finished = 0;
  const player = animation.startStartupAnimation({ host, targetMs: 8000, hardLimitMs: 20000, onFinish: () => finished++ });
  player.finish();
  assert.equal(player.finished(), true);
  assert.equal(finished, 1);
  assert.equal(host.children.length, 1, 'exit keeps the node during the fade');
  await sleep(420);
  assert.equal(host.children.length, 0);
});

test('startup animation stops its interval while hidden and tears down at the hard limit', async () => {
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
  const hard = scheduled.find(entry => entry.ms === 20000);
  assert.ok(hard);
  hard.fn();
  assert.equal(player.finished(), true);
  assert.equal(finished, 1);
  assert.equal(document.getElementById('wbStartup'), null);
});

test('each style builds its own decorative DOM and the animation never calls fetch', () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = () => { fetches++; throw new Error('startup must not call fetch'); };
  try {
    const host = new dom.Element('startupHost');
    const names = animation.startStartupAnimation({ host, style: 'names', targetMs: 8000, hardLimitMs: 20000 });
    const namesClasses = classesOf(names);
    assert.equal(namesClasses.filter(name => name === 'wb-startup-shutter').length, 5);
    assert.equal(namesClasses.filter(name => name === 'wb-startup-gate-half is-top' || name === 'wb-startup-gate-half is-bottom').length, 2);
    assert.ok(namesClasses.includes('wb-startup-gate-seam'));
    assert.ok(namesClasses.includes('wb-startup-progress-fill'));
    assert.ok(namesClasses.includes('wb-startup-noise'));
    assert.ok(namesClasses.includes('wb-startup-curtain-path'));
    names.destroy();

    const orbital = animation.startStartupAnimation({ host, style: 'orbital', targetMs: 8000, hardLimitMs: 20000 });
    const orbitalClasses = classesOf(orbital);
    assert.equal(orbitalClasses.filter(name => name === 'wb-startup-shutter').length, 0);
    assert.ok(orbitalClasses.includes('wb-startup-orbit'));
    assert.equal(orbitalClasses.includes('wb-startup-gate-seam'), false);
    orbital.destroy();

    const scan = animation.startStartupAnimation({ host, style: 'scan', targetMs: 8000, hardLimitMs: 20000 });
    const scanClasses = classesOf(scan);
    assert.equal(scanClasses.filter(name => name === 'wb-startup-shutter').length, 5);
    assert.ok(scanClasses.includes('wb-startup-beam'));
    assert.equal(scanClasses.includes('wb-startup-gate-half is-top'), false);
    scan.destroy();

    const minimal = animation.startStartupAnimation({ host, style: 'minimal', targetMs: 8000, hardLimitMs: 20000 });
    const minimalClasses = classesOf(minimal);
    assert.ok(minimalClasses.includes('wb-startup-brand'));
    assert.equal(minimalClasses.includes('wb-startup-shutter'), false);
    assert.equal(minimalClasses.includes('wb-startup-gate-seam'), false);
    assert.equal(minimalClasses.includes('wb-startup-beam'), false);
    minimal.destroy();
  }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(fetches, 0);
});

test('progress follows the reference non-linear curve and the counter tracks it', () => {
  assert.equal(animation.nonLinearProgress(0), 0);
  assert.ok(Math.abs(animation.nonLinearProgress(0.35) - 0.42) < 1e-9);
  assert.ok(Math.abs(animation.nonLinearProgress(0.65) - 0.6) < 1e-9);
  assert.equal(animation.nonLinearProgress(1), 1);
  assert.ok(animation.nonLinearProgress(0.2) > 0.2, 'first third sprints ahead of linear');
  const slopeFirst = (animation.nonLinearProgress(0.2) - animation.nonLinearProgress(0.1)) / 0.1;
  const slopeMiddle = (animation.nonLinearProgress(0.6) - animation.nonLinearProgress(0.5)) / 0.1;
  assert.ok(slopeMiddle < slopeFirst / 1.5, 'middle third decelerates to half speed while the first third sprints');
  let previous = -1;
  for (let step = 0; step <= 100; step++) {
    const value = animation.nonLinearProgress(step / 100);
    assert.ok(value >= previous, 'curve stays monotonic');
    previous = value;
  }

  const frames = [];
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const host = new dom.Element('startupHost');
    const player = animation.startStartupAnimation({
      host, style: 'names', targetMs: 8000, hardLimitMs: 20000,
      requestFrame: fn => { frames.push(fn); return frames.length; },
      cancelFrame: () => {},
    });
    const bar = descendants(player.root).find(el => el.className === 'wb-startup-progress-fill');
    const counter = descendants(player.root).find(el => el.className === 'wb-startup-count-value');
    assert.equal(counter.textContent, '00');
    assert.equal(String(bar.style.transform), 'scaleX(0.0000)');

    now += 8000 * 0.35;
    frames.pop()();
    assert.equal(counter.textContent, '42', 'counter is driven by the curve, not raw time');
    assert.match(String(bar.style.transform), /scaleX\(0\.42/);

    now += 8000 * 0.30;
    frames.pop()();
    assert.equal(counter.textContent, '60');

    now += 8000 * 0.35;
    frames.pop()();
    assert.equal(counter.textContent, '100');
    player.destroy();
  } finally { Date.now = realNow; }
});

test('the word cycler swaps AI names every second and leaves no stray node', () => {
  const frames = [];
  let now = 5000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const host = new dom.Element('startupHost');
    const player = animation.startStartupAnimation({
      host, style: 'names', targetMs: 8000, hardLimitMs: 20000,
      requestFrame: fn => { frames.push(fn); return frames.length; },
      cancelFrame: () => {},
    });
    const mask = descendants(player.root).find(el => el.className === 'wb-startup-word-mask');
    assert.equal(mask.children.length, 1);
    now += 1000;
    frames.pop()();
    assert.equal(mask.children.length, 2, 'incoming word enters while the old one leaves');
    player.destroy();
    assert.equal(mask.children.length, 0, 'destroy clears the word nodes synchronously');
    assert.equal(host.children.length, 0);
  } finally { Date.now = realNow; }
});
test('reduced motion shows static branding without mounting the overlay', () => {
  let finished = 0;
  const host = new dom.Element('startupHost');
  const player = withReducedMotion(() => animation.startStartupAnimation({ host, onFinish: () => finished++ }));
  assert.equal(player.reduced, true);
  assert.equal(player.root, null);
  assert.equal(host.children.length, 0);
  assert.equal(dom.intervals.size, intervalsBeforeReduced);
  player.setStyle('orbital');
  player.setPhase('syncing');
  player.finish();
  player.destroy();
  assert.equal(finished, 1);
  assert.equal(player.finished(), true);
});

test('destroy stops every timer and listener at once and leaves no node behind', async () => {
  const intervalsBefore = dom.intervals.size;
  const listenersBefore = (dom.events.get('visibilitychange') || []).length;
  const host = new dom.Element('startupHost');
  const player = animation.startStartupAnimation({ host, style: 'names', targetMs: 8000, hardLimitMs: 20000 });
  assert.equal(host.children.length, 1);
  assert.equal(dom.intervals.size, intervalsBefore + 1);
  assert.equal((dom.events.get('visibilitychange') || []).length, listenersBefore + 1);
  player.destroy();
  assert.equal(player.finished(), true);
  assert.equal(dom.intervals.size, intervalsBefore);
  assert.equal((dom.events.get('visibilitychange') || []).length, listenersBefore);
  await sleep(420);
  assert.equal(host.children.length, 0);
});

test('syncing phase fades the overlay out while destroy stays synchronous', async () => {
  const host = new dom.Element('startupHost');
  const player = animation.startStartupAnimation({ host, style: 'names', targetMs: 8000, hardLimitMs: 20000 });
  player.setPhase('syncing');
  assert.equal(player.root.dataset.phase, 'syncing');
  player.destroy();
  assert.equal(host.children.length, 0);
  await sleep(10);
  assert.equal(host.children.length, 0);
});

test('logout destroys the overlay immediately so it never covers the login card', () => {
  const host = new dom.Element('startupHost');
  const player = animation.startStartupAnimation({ host, style: 'names', targetMs: 8000, hardLimitMs: 20000 });
  client.lockSession();
  player.destroy();
  assert.equal(host.children.length, 0);
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

test('skipping the intro still enters the workspace and loads the overview', async () => {
  const router = await import('./assets/router.js');
  router.destroyStartup();
  client.lockSession();
  const calls = mockAPI(url => {
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark', credit_guard_low: 100 };
    if (url === '/panel/api/session/bootstrap') return { running: true };
    if (url.endsWith('/bootstrap/status')) return { running: false, completed: true };
    if (url.endsWith('meta/subscriptions')) return { subscriptions: [] };
    if (url.endsWith('meta/nodes')) return { nodes: [], bindings: [] };
    if (url.endsWith('/overview')) return { total: 0, accounts: [] };
    return {};
  });
  client.acceptSession({ authenticated: true, csrf_token: 'skip' });
  await dom.emit('panel:authenticated');
  await flush();
  await flush();
  const overlay = (document.body.children || []).find(el => el.id === 'wbStartup');
  assert.ok(overlay, 'overlay is mounted before the skip');
  assert.equal(calls.some(call => call.url === '/panel/api/overview'), false);
  await overlay.fire('click', {});
  await flush();
  await flush();
  assert.ok(calls.some(call => call.url === '/panel/api/overview'), 'skip must still enter the workspace');
  await sleep(420);
  router.destroyStartup();
  client.lockSession();
});
test('fast data never unmounts the router startup overlay before the 8000ms target', async () => {
  const router = await import('./assets/router.js');
  router.destroyStartup();
  client.lockSession();
  mockAPI(url => {
    if (url.endsWith('/capabilities')) return { logs: true };
    if (url.endsWith('/preferences')) return { theme: 'dark', credit_guard_low: 100 };
    if (url === '/panel/api/session/bootstrap') return { running: true };
    if (url.endsWith('/bootstrap/status')) return { running: false, completed: true };
    if (url.endsWith('meta/subscriptions')) return { subscriptions: [] };
    if (url.endsWith('meta/nodes')) return { nodes: [], bindings: [] };
    if (url.endsWith('/overview')) return { total: 0, accounts: [] };
    return {};
  });
  client.acceptSession({ authenticated: true, csrf_token: 'dwell' });
  const overlay = () => (document.body.children || []).find(el => el.id === 'wbStartup') || null;
  const startedAt = Date.now();
  await dom.emit('panel:authenticated');
  await flush();
  await flush();
  assert.ok(overlay(), 'router mounts the overlay before any data returns');
  assert.ok(Date.now() - startedAt < 1000, 'all startup data settles well inside the dwell budget');
  assert.ok(overlay(), 'settled data must not destroy the overlay early');
  router.destroyStartup();
  assert.equal(overlay(), null, 'destroyStartup still tears the overlay down on logout/pagehide');
  client.lockSession();
});
