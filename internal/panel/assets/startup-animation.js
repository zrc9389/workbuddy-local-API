import { session } from './api.js';

const AI_NAMES = ['GPT', 'Claude', 'Gemini', 'Grok', 'DeepSeek', 'Qwen', 'Kimi', 'Llama'];
const ANIMATION_STYLES = ['names', 'orbital', 'scan', 'minimal'];
const TARGET_MS = 8000;
// Allow bootstrap/refresh to settle for up to 20 seconds after the 8s minimum.
const HARD_LIMIT_MS = 20000;
const PREVIEW_MS = 3200;
const PREVIEW_HARD_LIMIT_MS = 4200;
const WORD_INTERVAL_MS = 1000;
const WORD_MOVE_MS = 360;
const EXIT_MS = 360;
const FRAME_MS = 60;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PHASE_STEPS = [
  [0, 'STAGE 01 // ACCOUNT SYNC'],
  [42, 'STAGE 02 // MODELS'],
  [78, 'STAGE 03 // FINALIZING'],
];

function reduceMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function easeOutExpo(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

// 参考实现（F:\下载\新建 文本文档.html）的非线性加载曲线：快冲 42% → 放缓蓄力 → 冲顶。
export function nonLinearProgress(value) {
  const t = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  if (t < 0.35) return (t / 0.35) * 0.42;
  if (t < 0.65) return 0.42 + ((t - 0.35) / 0.3) * 0.18;
  return 0.6 + easeOutExpo((t - 0.65) / 0.35) * 0.4;
}

function phaseFor(percent) {
  let label = PHASE_STEPS[0][1];
  for (const [threshold, text] of PHASE_STEPS) {
    if (percent >= threshold) label = text;
  }
  return label;
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
  const requestFrame = typeof options.requestFrame === 'function'
    ? options.requestFrame
    : (typeof globalThis.requestAnimationFrame === 'function' ? fn => globalThis.requestAnimationFrame(fn) : null);
  const cancelFrame = typeof options.cancelFrame === 'function'
    ? options.cancelFrame
    : (typeof globalThis.cancelAnimationFrame === 'function' ? id => globalThis.cancelAnimationFrame(id) : null);
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

  const noise = node('div', 'wb-startup-noise');
  noise.setAttribute('aria-hidden', 'true');
  const glow = node('div', 'wb-startup-glow');
  glow.setAttribute('aria-hidden', 'true');
  const fx = node('div', 'wb-startup-fx');
  fx.setAttribute('aria-hidden', 'true');
  buildFx(fx, style);

  // 1) 顶部元数据条：左侧脉冲点 + INITIALIZING，右侧 STAGE 0N // PHASE
  const header = node('header', 'wb-startup-header');
  const meta = node('div', 'wb-startup-meta');
  const dot = node('span', 'wb-startup-dot');
  dot.setAttribute('aria-hidden', 'true');
  meta.appendChild(dot);
  meta.appendChild(node('span', 'wb-startup-meta-label', 'INITIALIZING ENVIRONMENT'));
  const phaseLabel = node('span', 'wb-startup-phase', phaseFor(0));
  header.appendChild(meta);
  header.appendChild(phaseLabel);

  // 2) 中央衬线斜体词轮播
  const stage = node('div', 'wb-startup-stage');
  const brand = node('p', 'wb-startup-brand', 'W·');
  brand.setAttribute('aria-hidden', 'true');
  const ring = node('div', 'wb-startup-ring');
  ring.setAttribute('aria-hidden', 'true');
  const orbit = node('div', 'wb-startup-orbit');
  const dots = preview ? 10 : 18;
  for (let index = 0; index < dots; index++) {
    const particle = node('span');
    particle.style?.setProperty?.('--a', (index * 360 / dots) + 'deg');
    particle.style?.setProperty?.('--r', String(52 + (index % 3) * 9));
    particle.style?.setProperty?.('--d', String((index % 6) * 60) + 'ms');
    orbit.appendChild(particle);
  }
  const arcSlot = node('div', 'wb-startup-arc');
  ring.appendChild(orbit);
  ring.appendChild(arcSlot);

  const mask = node('div', 'wb-startup-word-mask');
  let wordEl = node('div', 'wb-startup-word is-active', AI_NAMES[0]);
  mask.appendChild(wordEl);
  const tagline = node('p', 'wb-startup-tagline', 'WORKSPACE ONLINE');

  stage.appendChild(brand);
  stage.appendChild(ring);
  stage.appendChild(mask);
  stage.appendChild(tagline);

  // 3) 底部：1px 非线性进度条 + 4) 衬线大号计数器
  const footer = node('footer', 'wb-startup-footer');
  const track = node('div', 'wb-startup-progress');
  const fill = node('div', 'wb-startup-progress-fill');
  track.appendChild(fill);
  const counter = node('p', 'wb-startup-count');
  counter.setAttribute('aria-hidden', 'true');
  const counterValue = node('span', 'wb-startup-count-value', '00');
  counter.appendChild(counterValue);
  counter.appendChild(node('span', 'wb-startup-count-unit', '%'));

  const curtain = curtainLayer();
  const decorations = [glow, curtain, fx];
  root.appendChild(noise);
  if (style !== 'minimal') decorations.forEach(layer => root.appendChild(layer));
  root.appendChild(header);
  root.appendChild(stage);
  root.appendChild(footer);

  const fills = [fill];

  function syncDecorations(next) {
    if (next === 'minimal') {
      decorations.forEach(layer => removeElement(layer, root));
      return;
    }
    for (const layer of decorations) {
      if (layer.parentNode || root.children?.includes?.(layer)) continue;
      if (root.insertBefore) root.insertBefore(layer, header);
      else root.appendChild(layer);
    }
  }

  function syncReadout(next) {
    clearChildren(footer);
    clearChildren(arcSlot);
    track.classList?.toggle?.('is-arc', next === 'orbital');
    if (next === 'names') footer.appendChild(track);
    if (next === 'orbital') arcSlot.appendChild(track);
    footer.appendChild(counter);
  }

  function syncCurtain(next) {
    if (next !== 'names') { removeElement(curtain, root); return; }
    if (curtain.parentNode || root.children?.includes?.(curtain)) return;
    if (root.insertBefore) root.insertBefore(curtain, header);
    else root.appendChild(curtain);
  }

  // minimal 只留 W· 标记：不挂元数据条、词轮播、进度条与计数器。
  function syncChrome(next) {
    const hidden = next === 'minimal';
    const chrome = [
      [header, root], [ring, stage], [mask, stage], [tagline, stage], [footer, root],
    ];
    if (hidden) {
      for (const [element, container] of chrome) removeElement(element, container);
      return;
    }
    if (!root.children?.includes?.(header)) {
      if (root.insertBefore) root.insertBefore(header, stage);
      else root.appendChild(header);
    }
    for (const element of [ring, mask, tagline]) {
      if (!stage.children?.includes?.(element)) stage.appendChild(element);
    }
    if (!root.children?.includes?.(footer)) root.appendChild(footer);
  }
  syncReadout(style);
  syncCurtain(style);
  syncChrome(style);
  parent.appendChild(root);

  const startedAt = Date.now();
  let finished = false;
  let notified = false;
  let released = false;
  let paused = !!document.hidden;
  let hiddenAt = paused ? startedAt : 0;
  let hiddenTotal = 0;
  let wordIndex = 0;
  let lastPercent = -1;
  let nextWordAt = WORD_INTERVAL_MS;
  let tickTimer = null;
  let frameId = null;
  let targetTimer = null;
  let hardTimer = null;
  let exitTimer = null;
  let phaseName = 'names';
  const wordTimers = new Set();

  if (paused) root.classList.add('is-paused');

  function clearWordTimers(removeAll) {
    for (const timer of wordTimers) cancelSchedule(timer);
    wordTimers.clear();
    for (const element of Array.from(mask.children || [])) {
      if (removeAll || element !== wordEl) removeElement(element, mask);
    }
    if (removeAll) {
      if (Array.isArray(mask.children)) mask.children.length = 0;
      wordEl = null;
      return;
    }
    wordEl.className = 'wb-startup-word is-active';
  }

  function clearTimers() {
    stopFrames();
    if (targetTimer !== null) { cancelSchedule(targetTimer); targetTimer = null; }
    if (hardTimer !== null) { cancelSchedule(hardTimer); hardTimer = null; }
    if (exitTimer !== null) { cancelSchedule(exitTimer); exitTimer = null; }
    clearWordTimers(true);
  }

  function stopFrames() {
    if (frameId !== null && cancelFrame) { cancelFrame(frameId); frameId = null; }
    if (tickTimer !== null) { cancelRepeat(tickTimer); tickTimer = null; }
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
    stopFrames();
    if (targetTimer !== null) { cancelSchedule(targetTimer); targetTimer = null; }
    if (hardTimer !== null) { cancelSchedule(hardTimer); hardTimer = null; }
    clearWordTimers(true);
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
    phaseLabel.textContent = phaseName === 'syncing'
      ? 'STAGE 03 // FINALIZING'
      : phaseFor(lastPercent < 0 ? 0 : lastPercent);
    if (phaseName === 'syncing' && root.dataset.style === 'names') root.classList.add('is-gate');
  }

  function setStyle(value) {
    if (finished) return style;
    const next = normalizeAnimationStyle(value);
    root.dataset.style = next;
    buildFx(fx, next);
    syncDecorations(next);
    syncCurtain(next);
    syncReadout(next);
    syncChrome(next);
    phaseLabel.textContent = phaseName === 'syncing' ? 'STAGE 03 // FINALIZING' : phaseFor(lastPercent < 0 ? 0 : lastPercent);
    if (next === 'names' && phaseName === 'syncing') root.classList.add('is-gate');
    return next;
  }

  function elapsedNow() {
    const now = Date.now();
    const hidden = paused ? Math.max(0, now - hiddenAt) : 0;
    return Math.max(0, now - startedAt - hiddenTotal - hidden);
  }

  function rotateWord() {
    if (finished || paused || !wordEl || options.staticName || root.dataset.style === 'minimal') return;
    const nextIndex = (wordIndex + 1) % AI_NAMES.length;
    const current = wordEl;
    const incoming = node('div', 'wb-startup-word is-enter', AI_NAMES[nextIndex]);
    incoming.setAttribute('aria-hidden', 'true');
    mask.appendChild(incoming);
    const promote = schedule(() => {
      wordTimers.delete(promote);
      if (finished || released) return;
      incoming.className = 'wb-startup-word is-active';
      current.className = 'wb-startup-word is-leave';
      wordIndex = nextIndex;
      wordEl = incoming;
      const cleanup = schedule(() => {
        wordTimers.delete(cleanup);
        if (released) return;
        removeElement(current, mask);
      }, WORD_MOVE_MS);
      wordTimers.add(cleanup);
    }, 20);
    wordTimers.add(promote);
  }

  function render() {
    if (finished) return;
    const elapsed = elapsedNow();
    const raw = targetMs > 0 ? Math.min(1, elapsed / targetMs) : 1;
    const progress = nonLinearProgress(raw);
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    for (const bar of fills) {
      bar.style.transform = 'scaleX(' + progress.toFixed(4) + ')';
    }
    root.style?.setProperty?.('--wb-progress', progress.toFixed(4));
    if (percent !== lastPercent) {
      lastPercent = percent;
      counterValue.textContent = String(percent).padStart(2, '0');
      if (phaseName !== 'syncing') phaseLabel.textContent = phaseFor(percent);
    }
    if (elapsed >= nextWordAt) {
      nextWordAt = elapsed + WORD_INTERVAL_MS;
      rotateWord();
    }
  }

  function loop() {
    frameId = null;
    if (finished || paused || released) return;
    render();
    scheduleFrame();
  }

  function scheduleFrame() {
    if (finished || paused || released) return;
    if (requestFrame && cancelFrame) {
      if (frameId === null) frameId = requestFrame(loop);
      return;
    }
    if (tickTimer === null) tickTimer = repeat(loop, FRAME_MS);
  }

  function onVisibility() {
    if (finished) return;
    if (document.hidden) {
      if (!paused) { paused = true; hiddenAt = Date.now(); }
      stopFrames();
      clearWordTimers();
      root.classList.add('is-paused');
      return;
    }
    if (paused) {
      hiddenTotal += Math.max(0, Date.now() - hiddenAt);
      hiddenAt = 0;
      paused = false;
    }
    root.classList.remove('is-paused');
    render();
    scheduleFrame();
  }

  function onPageHide() {
    destroy();
  }

  document.addEventListener('visibilitychange', onVisibility);
  globalThis.addEventListener?.('pagehide', onPageHide);
  render();
  if (!paused) scheduleFrame();
  targetTimer = schedule(() => {
    targetTimer = null;
    if (!finished) setPhase('syncing');
  }, targetMs);
  if (hardLimitMs > 0) hardTimer = schedule(() => { hardTimer = null; destroy(); }, hardLimitMs);

  return { root, style, preview, setStyle, setPhase, finish, destroy, finished: () => finished };
}

export { AI_NAMES, ANIMATION_STYLES, TARGET_MS, HARD_LIMIT_MS, PREVIEW_MS, PREVIEW_HARD_LIMIT_MS };
