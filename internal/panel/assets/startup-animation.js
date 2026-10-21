import { session } from './api.js';

const AI_NAMES = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Kimi', 'GLM'];
const ANIMATION_STYLES = ['names', 'orbital', 'scan', 'minimal'];
const TARGET_MS = 8000;
const HARD_LIMIT_MS = 12000;
const PREVIEW_MS = 3200;
const PREVIEW_HARD_LIMIT_MS = 4200;
const NAME_INTERVAL_MS = 1000;
const FADE_MS = 180;
const EXIT_MS = 360;
const TICK_MS = 100;
const SVG_NS = 'http://www.w3.org/2000/svg';

function reduceMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function svgNode(tag, className) {
  const element = document.createElementNS ? document.createElementNS(SVG_NS, tag) : node('div', className);
  element.setAttribute?.('class', className);
  return element;
}

function clearChildren(element) {
  element.textContent = '';
  if (Array.isArray(element.children)) element.children.length = 0;
}

function removeElement(element, host) {
  if (!element) return;
  element.remove?.();
  if (element.parentNode?.removeChild) element.parentNode.removeChild(element);
  if (Array.isArray(host?.children)) {
    const index = host.children.indexOf(element);
    if (index >= 0) host.children.splice(index, 1);
  }
}

export function normalizeAnimationStyle(value) {
  const style = String(value || '').trim().toLowerCase();
  return ANIMATION_STYLES.includes(style) ? style : 'names';
}

function phaseText(style, syncing) {
  if (syncing) return 'Syncing your accounts';
  if (style === 'orbital') return 'Aligning your accounts';
  if (style === 'scan') return 'Scanning the workspace';
  if (style === 'minimal') return 'Opening your workspace';
  return 'Waking the workspace';
}

function curtainLayer() {
  const svg = svgNode('svg', 'wb-startup-curtain');
  svg.setAttribute?.('viewBox', '0 0 100 100');
  svg.setAttribute?.('preserveAspectRatio', 'none');
  svg.setAttribute?.('aria-hidden', 'true');
  const path = svgNode('path', 'wb-startup-curtain-path');
  path.setAttribute?.('d', 'M0 20 Q50 2 100 20 L100 100 L0 100 Z');
  svg.appendChild(path);
  return svg;
}

function shutterLayer() {
  const shutters = node('div', 'wb-startup-shutters');
  shutters.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 5; index++) {
    const column = node('span', 'wb-startup-shutter');
    column.style?.setProperty?.('--i', String(index));
    shutters.appendChild(column);
  }
  return shutters;
}

function gateLayer() {
  const gate = node('div', 'wb-startup-gate');
  gate.setAttribute('aria-hidden', 'true');
  gate.appendChild(node('span', 'wb-startup-gate-half is-top'));
  gate.appendChild(node('span', 'wb-startup-gate-half is-bottom'));
  gate.appendChild(node('span', 'wb-startup-gate-seam'));
  return gate;
}

function beamLayer() {
  const beam = node('div', 'wb-startup-beam');
  beam.setAttribute('aria-hidden', 'true');
  return beam;
}

function buildFx(container, style) {
  clearChildren(container);
  if (style === 'names') {
    container.appendChild(shutterLayer());
    container.appendChild(gateLayer());
  } else if (style === 'scan') {
    container.appendChild(shutterLayer());
    container.appendChild(beamLayer());
  } else if (style === 'orbital') {
    container.appendChild(shutterLayer());
  }
}

export function startStartupAnimation(options = {}) {
  const onFinish = typeof options.onFinish === 'function' ? options.onFinish : () => {};
  const style = normalizeAnimationStyle(options.style ?? options.animationStyle);
  const preview = options.preview === true;
  const targetMs = options.targetMs ?? (preview ? PREVIEW_MS : TARGET_MS);
  const hardLimitMs = options.hardLimitMs ?? (preview ? PREVIEW_HARD_LIMIT_MS : HARD_LIMIT_MS);
  const schedule = options.schedule || setTimeout;
  const repeat = options.repeat || setInterval;
  const cancelSchedule = options.cancelSchedule || clearTimeout;
  const cancelRepeat = options.cancelRepeat || clearInterval;
  const host = options.host && typeof options.host.appendChild === 'function' ? options.host : null;
  const exitMs = Number.isFinite(options.exitMs) ? Math.max(0, options.exitMs) : EXIT_MS;
  const reduced = reduceMotion();

  if (reduced) {
    // 减少动画：直接给出静态品牌，绝不创建遮罩层，也绝不遮挡登录/概览。
    let done = false;
    const settle = () => { if (done) return; done = true; onFinish(); };
    return {
      root: null,
      style,
      preview,
      reduced: true,
      setStyle: value => normalizeAnimationStyle(value),
      setPhase: () => {},
      finish: settle,
      destroy: settle,
      finished: () => done,
    };
  }

  const parent = host || document.body || document.documentElement;
  const previous = (!preview && !host) ? document.getElementById('wbStartup') : null;
  if (previous) removeElement(previous, previous.parentNode || parent);

  const shell = document.querySelector?.('.shell') || null;
  const shellWasInert = !!shell?.inert;
  if (!preview && shell) shell.inert = true;

  const root = node('div', preview ? 'wb-startup wb-startup-preview' : 'wb-startup');
  if (!preview && !host) root.id = 'wbStartup';
  if (preview) root.id = 'wbStartupPreview';
  root.dataset.style = style;
  root.dataset.phase = 'names';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-label', preview ? '启动动画预览' : '正在启动工作台');
  root.style?.setProperty?.('--wb-duration', String(Math.max(0, targetMs)) + 'ms');

  const noise = node('div', 'wb-startup-noise');
  noise.setAttribute('aria-hidden', 'true');
  const glow = node('div', 'wb-startup-glow');
  glow.setAttribute('aria-hidden', 'true');
  const fx = node('div', 'wb-startup-fx');
  fx.setAttribute('aria-hidden', 'true');
  buildFx(fx, style);

  const stage = node('div', 'wb-startup-stage');
  const brand = node('p', 'wb-startup-brand', 'W·');
  brand.setAttribute('aria-hidden', 'true');
  const ring = node('div', 'wb-startup-ring');
  ring.setAttribute('aria-hidden', 'true');
  const orbit = node('div', 'wb-startup-orbit');
  const dots = preview ? 10 : 18;
  for (let index = 0; index < dots; index++) {
    const dot = node('span');
    dot.style?.setProperty?.('--a', (index * 360 / dots) + 'deg');
    dot.style?.setProperty?.('--r', String(52 + (index % 3) * 9));
    dot.style?.setProperty?.('--d', String((index % 6) * 60) + 'ms');
    orbit.appendChild(dot);
  }
  ring.appendChild(orbit);
  const name = node('p', 'wb-startup-name', AI_NAMES[0]);
  const tagline = node('p', 'wb-startup-tagline', 'Workspace online');
  const phase = node('p', 'wb-startup-phase', phaseText(style, false));
  stage.appendChild(brand);
  stage.appendChild(ring);
  stage.appendChild(name);
  stage.appendChild(tagline);
  stage.appendChild(phase);

  const footer = node('div', 'wb-startup-footer');
  const meta = node('div', 'wb-startup-meta');
  meta.appendChild(node('span', 'wb-startup-meta-mark', 'WorkBuddy'));
  meta.appendChild(node('span', 'wb-startup-meta-hint', 'Local workspace'));
  const readout = node('div', 'wb-startup-readout');
  const track = node('div', 'wb-startup-progress');
  track.appendChild(node('div', 'wb-startup-progress-fill'));
  const counter = node('p', 'wb-startup-count');
  counter.setAttribute('aria-hidden', 'true');
  const counterValue = node('span', 'wb-startup-count-value', '00');
  counter.appendChild(counterValue);
  counter.appendChild(node('span', 'wb-startup-count-unit', '%'));
  readout.appendChild(track);
  readout.appendChild(counter);
  footer.appendChild(meta);
  footer.appendChild(readout);

  const curtain = curtainLayer();
  const decorations = [glow, curtain, fx];
  root.appendChild(noise);
  if (style !== 'minimal') decorations.forEach(layer => root.appendChild(layer));
  root.appendChild(stage);
  root.appendChild(footer);

  function syncDecorations(next) {
    if (next === 'minimal') {
      decorations.forEach(layer => removeElement(layer, root));
      return;
    }
    for (const layer of decorations) {
      if (layer.parentNode || root.children?.includes?.(layer)) continue;
      if (root.insertBefore) root.insertBefore(layer, stage);
      else root.appendChild(layer);
    }
  }
  parent.appendChild(root);

  const startedAt = Date.now();
  let finished = false;
  let notified = false;
  let released = false;
  let paused = !!document.hidden;
  let hiddenAt = paused ? startedAt : 0;
  let hiddenTotal = 0;
  let nameIndex = 0;
  let lastPercent = -1;
  let nextNameAt = NAME_INTERVAL_MS;
  let tickTimer = null;
  let fadeTimer = null;
  let targetTimer = null;
  let hardTimer = null;
  let exitTimer = null;
  let phaseName = 'names';

  if (paused) root.classList.add('is-paused');

  function clearTimers() {
    if (tickTimer !== null) { cancelRepeat(tickTimer); tickTimer = null; }
    if (fadeTimer !== null) { cancelSchedule(fadeTimer); fadeTimer = null; }
    if (targetTimer !== null) { cancelSchedule(targetTimer); targetTimer = null; }
    if (hardTimer !== null) { cancelSchedule(hardTimer); hardTimer = null; }
    if (exitTimer !== null) { cancelSchedule(exitTimer); exitTimer = null; }
  }

  function restoreShell() {
    if (!shell) return;
    shell.inert = session.authenticated ? shellWasInert : true;
  }

  function release() {
    if (released) return;
    released = true;
    clearTimers();
    document.removeEventListener('visibilitychange', onVisibility);
    globalThis.removeEventListener?.('pagehide', onPageHide);
    removeElement(root, parent);
  }

  function notify() {
    if (notified) return;
    notified = true;
    restoreShell();
    onFinish();
  }

  function dismiss(graceful) {
    if (finished) return;
    finished = true;
    if (tickTimer !== null) { cancelRepeat(tickTimer); tickTimer = null; }
    if (fadeTimer !== null) { cancelSchedule(fadeTimer); fadeTimer = null; }
    if (targetTimer !== null) { cancelSchedule(targetTimer); targetTimer = null; }
    if (hardTimer !== null) { cancelSchedule(hardTimer); hardTimer = null; }
    notify();
    if (!graceful || exitMs === 0) { release(); return; }
    root.classList.add('is-leaving');
    exitTimer = schedule(() => {
      exitTimer = null;
      release();
    }, exitMs);
  }

  function finish() { dismiss(true); }

  function destroy() {
    // 契约要求 destroy() 同步无残留；主链路的 360ms 退场由 syncing 相位驱动。
    if (released) return;
    if (finished) { release(); return; }
    dismiss(false);
  }

  function setPhase(value) {
    if (finished) return;
    phaseName = value === 'syncing' ? 'syncing' : 'names';
    root.dataset.phase = phaseName;
    phase.textContent = phaseText(root.dataset.style, phaseName === 'syncing');
    if (phaseName === 'syncing' && root.dataset.style === 'names') root.classList.add('is-gate');
  }

  function setStyle(value) {
    if (finished) return style;
    const next = normalizeAnimationStyle(value);
    root.dataset.style = next;
    buildFx(fx, next);
    syncDecorations(next);
    phase.textContent = phaseText(next, phaseName === 'syncing');
    if (next === 'names' && phaseName === 'syncing') root.classList.add('is-gate');
    return next;
  }

  function elapsedNow() {
    const now = Date.now();
    const hidden = paused ? Math.max(0, now - hiddenAt) : 0;
    return Math.max(0, now - startedAt - hiddenTotal - hidden);
  }

  function rotateName() {
    if (finished || paused || options.staticName || root.dataset.style === 'minimal') return;
    nameIndex = (nameIndex + 1) % AI_NAMES.length;
    name.classList.add('is-fading');
    fadeTimer = schedule(() => {
      fadeTimer = null;
      if (finished || paused) return;
      name.textContent = AI_NAMES[nameIndex];
      name.classList.remove('is-fading');
    }, FADE_MS);
  }

  function tick() {
    if (finished || paused) return;
    const elapsed = elapsedNow();
    const percent = Math.max(0, Math.min(100, Math.floor((elapsed / Math.max(1, targetMs)) * 100)));
    if (percent !== lastPercent) {
      lastPercent = percent;
      counterValue.textContent = percent < 10 ? '0' + percent : String(percent);
    }
    if (elapsed >= nextNameAt) {
      nextNameAt = elapsed + NAME_INTERVAL_MS;
      rotateName();
    }
  }

  function startTicking() {
    if (tickTimer !== null || finished) return;
    tickTimer = repeat(tick, TICK_MS);
  }

  function onVisibility() {
    if (finished) return;
    if (document.hidden) {
      if (!paused) { paused = true; hiddenAt = Date.now(); }
      if (tickTimer !== null) { cancelRepeat(tickTimer); tickTimer = null; }
      if (fadeTimer !== null) { cancelSchedule(fadeTimer); fadeTimer = null; }
      name.classList.remove('is-fading');
      root.classList.add('is-paused');
      return;
    }
    if (paused) {
      hiddenTotal += Math.max(0, Date.now() - hiddenAt);
      hiddenAt = 0;
      paused = false;
    }
    root.classList.remove('is-paused');
    startTicking();
    tick();
  }

  function onPageHide() {
    destroy();
  }

  document.addEventListener('visibilitychange', onVisibility);
  globalThis.addEventListener?.('pagehide', onPageHide);
  if (!paused) startTicking();
  targetTimer = schedule(() => {
    targetTimer = null;
    if (!finished) setPhase('syncing');
  }, targetMs);
  if (hardLimitMs > 0) hardTimer = schedule(() => { hardTimer = null; destroy(); }, hardLimitMs);

  return { root, style, preview, setStyle, setPhase, finish, destroy, finished: () => finished };
}

export { AI_NAMES, ANIMATION_STYLES, TARGET_MS, HARD_LIMIT_MS, PREVIEW_MS, PREVIEW_HARD_LIMIT_MS };
