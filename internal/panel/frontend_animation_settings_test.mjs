import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, mockAPI, flush } from './frontend_helpers_test.mjs';

const dom = setupDOM();
const $ = dom.$;
const client = await import('./assets/api.js');
const animation = await import('./assets/startup-animation.js');
const settings = await import('./assets/animation-settings.js');

function resetSettings() {
  settings.destroyAnimationSettings();
  $('animationStyle').listeners.clear();
  $('animationPreview').listeners.clear();
  $('animationStyle').value = 'names';
  $('animationNote').textContent = '';
}

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

test('four animation styles share one lifecycle and expose distinct visuals', () => {
  const seen = [];
  const visuals = {};
  for (const style of animation.ANIMATION_STYLES) {
    const player = animation.startStartupAnimation({ style, targetMs: 50, hardLimitMs: 60 });
    visuals[style] = classesOf(player);
    seen.push(style);
    assert.equal(player.style, style);
    assert.equal(player.root.dataset.style, style);
    assert.equal(player.preview, false);
    assert.equal(document.getElementById('wbStartup'), null, 'fake DOM does not register dynamic ids');
    player.setStyle('minimal');
    assert.equal(player.root.dataset.style, 'minimal');
    player.finish();
    assert.equal(player.finished(), true);
    player.destroy();
    assert.equal(document.getElementById('wbStartup'), null);
  }
  assert.deepEqual(seen, ['names', 'orbital', 'scan', 'minimal']);
  assert.ok(visuals.names.includes('wb-startup-gate-seam'), 'names adds the center light gate');
  assert.equal(visuals.names.filter(name => name === 'wb-startup-shutter').length, 5);
  assert.ok(visuals.orbital.includes('wb-startup-orbit'), 'orbital aggregates particles');
  assert.equal(visuals.orbital.includes('wb-startup-gate-seam'), false);
  assert.ok(visuals.scan.includes('wb-startup-beam'), 'scan sweeps a light band');
  assert.equal(visuals.scan.includes('wb-startup-gate-seam'), false);
  assert.ok(visuals.minimal.includes('wb-startup-brand'));
  for (const decoration of ['wb-startup-shutter', 'wb-startup-gate-seam', 'wb-startup-beam', 'wb-startup-curtain-path']) {
    assert.equal(visuals.minimal.includes(decoration), false, 'minimal stays a static brand mark: ' + decoration);
  }
  assert.ok(visuals.names.includes('wb-startup-progress-fill'), 'names keeps the 1px bottom progress bar');
  assert.ok(visuals.orbital.includes('wb-startup-progress-fill'), 'orbital weakens the bar into the ring arc');
  assert.equal(visuals.scan.includes('wb-startup-progress-fill'), false, 'scan trades the bar for the tagline pulse');
  for (const style of ['names', 'orbital', 'scan']) {
    assert.ok(visuals[style].includes('wb-startup-count'), style + ' keeps the counter readout');
    assert.ok(visuals[style].some(name => name.startsWith('wb-startup-word')), style + ' keeps the serif word cycler');
    assert.ok(visuals[style].includes('wb-startup-header'), style + ' keeps the metadata header');
  }
  for (const style of ['minimal']) {
    assert.equal(visuals[style].includes('wb-startup-count'), false, 'minimal drops the counter');
    assert.equal(visuals[style].includes('wb-startup-word-mask'), false, 'minimal drops the word cycler');
    assert.equal(visuals[style].includes('wb-startup-header'), false, 'minimal drops the metadata header');
  }
  assert.equal(animation.normalizeAnimationStyle('ORBITAL'), 'orbital');
  assert.equal(animation.normalizeAnimationStyle('unknown'), 'names');
  assert.equal(animation.normalizeAnimationStyle(undefined), 'names');
});

test('startup animation honors 8s target and 20s hard limit by default', () => {
  assert.equal(animation.TARGET_MS, 8000);
  assert.equal(animation.HARD_LIMIT_MS, 20000);
  const scheduled = [];
  const player = animation.startStartupAnimation({
    schedule: (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; },
    repeat: () => 1,
    cancelSchedule: () => {},
    cancelRepeat: () => {},
  });
  assert.ok(scheduled.some(entry => entry.ms === 8000), 'phase switch waits for the 8s minimum');
  assert.ok(scheduled.some(entry => entry.ms === 20000), 'hard limit stays at 20s');
  player.destroy();
});

test('preview animation is isolated from the startup overlay and never refreshes accounts', async () => {
  resetSettings();
  client.acceptSession({ authenticated: true, csrf_token: 'preview-token' });
  const calls = mockAPI(() => ({ theme: 'dark', credit_guard_low: 100 }));
  const { previewStartupAnimation, destroyPreviewAnimation } = settings;
  const player = previewStartupAnimation('scan');
  await flush();
  assert.equal(player.preview, true);
  assert.equal(player.root.dataset.style, 'scan');
  assert.equal(document.getElementById('wbStartup'), null);
  assert.ok(calls.every(call => call.url === '/panel/api/preferences' && call.opts.method !== 'POST'));
  destroyPreviewAnimation();
  assert.equal(player.finished(), true);
  assert.equal(document.getElementById('wbStartupPreview'), null);
  client.lockSession();
});

test('repeated preview clicks destroy the previous player without leaking intervals', async () => {
  resetSettings();
  const { previewStartupAnimation, destroyPreviewAnimation } = settings;
  const before = dom.intervals.size;
  const first = previewStartupAnimation('names');
  assert.equal(dom.intervals.size, before + 1);
  const second = previewStartupAnimation('minimal');
  assert.equal(first.finished(), true);
  assert.equal(dom.intervals.size, before + 1);
  destroyPreviewAnimation();
  assert.equal(second.finished(), true);
  assert.equal(dom.intervals.size, before);
  assert.equal(document.getElementById('wbStartupPreview'), null);
});

test('settings controls are optional and degrade without throwing', async () => {
  resetSettings();
  const { bindAnimationSettings } = settings;
  const select = $('animationStyle');
  const preview = $('animationPreview');
  select.id = '';
  const destroy = bindAnimationSettings();
  assert.equal(typeof destroy, 'function');
  destroy();
  select.id = 'animationStyle';
  preview.id = '';
  const restore = bindAnimationSettings();
  assert.equal(typeof restore, 'function');
  restore();
  preview.id = 'animationPreview';
});

test('select changes persist axis through preferences only and never touch accounts', async () => {
  resetSettings();
  client.acceptSession({ authenticated: true, csrf_token: 'settings-token' });
  const calls = mockAPI((url, opts) => {
    if (opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      return { credit_guard_low: body.credit_guard_low, theme: body.theme, animation_style: body.animation_style };
    }
    return { credit_guard_low: 80, theme: 'light', animation_style: 'names' };
  });
  const destroy = settings.bindAnimationSettings();
  $('animationStyle').value = 'orbital';
  await $('animationStyle').fire('change');
  const posts = calls.slice(-1).filter(call => call.opts.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/panel/api/preferences');
  assert.equal(JSON.parse(posts[0].opts.body).animation_style, 'orbital');
  assert.equal(JSON.parse(posts[0].opts.body).credit_guard_low, 80);
  assert.equal(JSON.parse(posts[0].opts.body).theme, 'light');
  assert.equal(calls.some(call => /bootstrap|balance_all|overview/.test(call.url)), false);
  destroy();
  client.lockSession();
});

test('preview button drives the animation but sends no request when disconnected', async () => {
  resetSettings();
  const calls = mockAPI(() => ({ accounts: [] }));
  const destroy = settings.bindAnimationSettings();
  $('animationStyle').value = 'scan';
  await $('animationPreview').fire('click');
  await flush();
  assert.equal(calls.length, 0);
  assert.equal($('animationNote').textContent, '正在预览：扫描唤醒');
  settings.destroyPreviewAnimation();
  destroy();
});

test('preference read falls back safely and accepts backend animation fields', async () => {
  resetSettings();
  client.acceptSession({ authenticated: true, csrf_token: 'read-token' });
  mockAPI(() => ({ theme: 'dark', credit_guard_low: 100, animation_style: 'minimal' }));
  assert.equal(await settings.refreshAnimationPreference(), 'minimal');
  assert.equal($('animationStyle').value, 'minimal');
  mockAPI(() => ({ theme: 'dark' }));
  assert.equal(await settings.refreshAnimationPreference(), 'names');
  assert.equal($('animationStyle').value, 'names');
  client.lockSession();
});

test('previews and preferences leave browser storage untouched', async () => {
  resetSettings();
  const { previewStartupAnimation, destroyPreviewAnimation } = settings;
  const before = JSON.stringify([...dom.storage.entries()]);
  previewStartupAnimation('orbital');
  destroyPreviewAnimation();
  assert.equal(JSON.stringify([...dom.storage.entries()]), before);
  await sleep(1);
});

test('preview auto-finishes and releases every timer it created', async () => {
  resetSettings();
  const { previewStartupAnimation, destroyPreviewAnimation } = settings;
  const before = dom.intervals.size;
  const player = previewStartupAnimation('names', { targetMs: 20, hardLimitMs: 40 });
  assert.equal(dom.intervals.size, before + 1);
  await sleep(70);
  assert.equal(player.finished(), true);
  assert.equal(dom.intervals.size, before);
  destroyPreviewAnimation();
});

test('legacy preference payload without an animation field keeps the safe default', async () => {
  resetSettings();
  client.acceptSession({ authenticated: true, csrf_token: 'legacy-token' });
  const calls = mockAPI(() => ({ theme: 'dark', credit_guard_low: 100 }));
  assert.equal(await settings.refreshAnimationPreference(), 'names');
  assert.equal($('animationStyle').value, 'names');
  assert.deepEqual(calls.map(call => call.url), ['/panel/api/preferences']);
  assert.equal(calls[0].opts.method, 'GET');
  client.lockSession();
});

test('an old backend that drops animation_style is reported instead of silently pretending success', async () => {
  resetSettings();
  client.acceptSession({ authenticated: true, csrf_token: 'old-backend-token' });
  const calls = mockAPI(() => ({ theme: 'dark', credit_guard_low: 100 }));
  const destroy = settings.bindAnimationSettings();
  const start = calls.length;
  $('animationStyle').value = 'scan';
  await $('animationStyle').fire('change');
  await flush();
  assert.equal(calls.slice(start).filter(call => call.opts.method === 'POST').length, 1);
  assert.equal(JSON.parse(calls.slice(start).find(call => call.opts.method === 'POST')?.opts.body || '{}').animation_style, 'scan');
  assert.equal($('animationStyle').value, 'names');
  assert.match($('animationNote').textContent, /后端尚未保存动画偏好/);
  destroy();
  client.lockSession();
});
