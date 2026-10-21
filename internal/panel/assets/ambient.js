// 客户端动态背景：CSS 光场常驻，桌面可选单 Canvas 细流。
// 硬约束：不触达 API、不读布局、不改 DOM 内容、单例、可暂停/恢复/销毁。
const MAX_PARTICLES = 60;
const BASE_FPS = 30;
const DEGRADED_FPS = 20;
const DPR_MAX = 2;
const SLOW_FRAME_MS = 20;
const SLOW_WINDOW_MS = 3000;
const STREAM_COLOR = 'rgba(217,138,104,.30)';
const COOL_COLOR = 'rgba(110,146,170,.22)';

const state = {
  started: false,
  everStarted: false,
  destroyed: false,
  canvas: null,
  ctx: null,
  raf: 0,
  lastTs: 0,
  fpsCap: BASE_FPS,
  slowMs: 0,
  stage: 0,
  width: 0,
  height: 0,
  dpr: 1,
  count: 0,
  xs: null,
  ys: null,
  vx: null,
  vy: null,
  radius: null,
  listenersBound: false,
};

let motionQuery = null;
let viewportQuery = null;
function hasDom() { return typeof window !== 'undefined' && typeof document !== 'undefined'; }
function media(query) {
  if (typeof matchMedia !== 'function') return null;
  try { return matchMedia(query); } catch { return null; }
}
function motionQueryRef() { return motionQuery || (motionQuery = media('(prefers-reduced-motion: reduce)')); }
function viewportQueryRef() { return viewportQuery || (viewportQuery = media('(max-width: 700px)')); }
function prefersReducedMotion() { return !!motionQueryRef()?.matches; }
function isSmallViewport() { return !!viewportQueryRef()?.matches; }
function isLowCore() {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0;
  return !(typeof cores === 'number' && cores > 4);
}
function pausedByContract() {
  return document?.documentElement?.dataset?.paused === 'true';
}
function streamAllowed() {
  return state.started && !state.destroyed && state.stage < 2 && !!state.canvas &&
    !document.hidden && !pausedByContract() && !isSmallViewport() && !isLowCore() && !prefersReducedMotion();
}
function canCreateCanvas() {
  return state.started && !state.destroyed && state.stage < 2 &&
    !document.hidden && !pausedByContract() && !isSmallViewport() && !isLowCore() && !prefersReducedMotion();
}

function resetParticles() {
  const count = Math.min(48, MAX_PARTICLES);
  state.count = count;
  state.xs = new Float32Array(count);
  state.ys = new Float32Array(count);
  state.vx = new Float32Array(count);
  state.vy = new Float32Array(count);
  state.radius = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    state.xs[i] = Math.random() * state.width;
    state.ys[i] = state.height * (0.45 + Math.random() * 0.55);
    state.vx[i] = (Math.random() - 0.5) * 0.18;
    state.vy[i] = -0.05 - Math.random() * 0.12;
    state.radius[i] = 0.6 + Math.random() * 1.4;
  }
}

function resizeCanvas() {
  if (!state.canvas || !state.ctx) return;
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  state.dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  state.canvas.width = Math.round(state.width * state.dpr);
  state.canvas.height = Math.round(state.height * state.dpr);
  state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  resetParticles();
}

function ensureCanvas() {
  if (state.canvas) return true;
  const host = document.querySelector('.atmosphere');
  if (!host) return false;
  const canvas = document.createElement('canvas');
  canvas.className = 'ambient-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) { canvas.remove(); return false; }
  state.canvas = canvas;
  state.ctx = ctx;
  resizeCanvas();
  return true;
}

function drawFrame() {
  const ctx = state.ctx;
  if (!ctx || !state.count) return;
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = STREAM_COLOR;
  ctx.beginPath();
  for (let i = 0; i < state.count; i += 1) {
    let x = state.xs[i] + state.vx[i];
    let y = state.ys[i] + state.vy[i];
    if (y < -8) { y = state.height + 8; x = Math.random() * state.width; }
    if (x < -8) x = state.width + 8;
    if (x > state.width + 8) x = -8;
    state.xs[i] = x;
    state.ys[i] = y;
    const tail = state.radius[i] * 7;
    ctx.moveTo(x, y);
    ctx.lineTo(x - state.vx[i] * tail, y - state.vy[i] * tail);
  }
  ctx.stroke();
  ctx.fillStyle = COOL_COLOR;
  ctx.beginPath();
  for (let i = 0; i < state.count; i += 1) {
    const r = state.radius[i];
    ctx.moveTo(state.xs[i] + r, state.ys[i]);
    ctx.arc(state.xs[i], state.ys[i], r, 0, Math.PI * 2);
  }
  ctx.fill();
}

function noteCost(cost, interval) {
  if (cost > SLOW_FRAME_MS) state.slowMs += interval;
  else state.slowMs = Math.max(0, state.slowMs - interval * 0.5);
  if (state.slowMs < SLOW_WINDOW_MS) return;
  state.slowMs = 0;
  if (state.stage === 0) { state.stage = 1; state.fpsCap = DEGRADED_FPS; return; }
  state.stage = 2;
  stopFrames();
  if (state.canvas) state.canvas.style.display = 'none';
}

function frame(ts) {
  state.raf = 0;
  if (!streamAllowed()) return;
  const interval = 1000 / state.fpsCap;
  if (!state.lastTs) state.lastTs = ts - interval;
  const elapsed = ts - state.lastTs;
  if (elapsed < interval) { state.raf = requestAnimationFrame(frame); return; }
  state.lastTs = ts - (elapsed % interval);
  const started = performance.now();
  drawFrame();
  noteCost(performance.now() - started, interval);
  if (streamAllowed()) state.raf = requestAnimationFrame(frame);
}

function stopFrames() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  state.lastTs = 0;
}

function startFrames() {
  if (state.raf || !canCreateCanvas()) return;
  if (!state.canvas && !ensureCanvas()) return;
  state.canvas.style.display = '';
  state.lastTs = 0;
  state.raf = requestAnimationFrame(frame);
}

function onVisibilityChange() {
  if (!state.started || state.destroyed) return;
  if (document.hidden || pausedByContract()) stopFrames();
  else startFrames();
}
function onResize() {
  if (!state.canvas || state.destroyed) return;
  resizeCanvas();
}
function onMotionChange() {
  if (!state.started || state.destroyed) return;
  if (prefersReducedMotion()) stopFrames();
  else startFrames();
}
function onViewportChange() {
  if (!state.started || state.destroyed) return;
  if (isSmallViewport()) stopFrames();
  else startFrames();
}

function bindListeners() {
  if (state.listenersBound) return;
  state.listenersBound = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('resize', onResize, { passive: true });
  motionQueryRef()?.addEventListener?.('change', onMotionChange);
  viewportQueryRef()?.addEventListener?.('change', onViewportChange);
}
function unbindListeners() {
  if (!state.listenersBound) return;
  state.listenersBound = false;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('resize', onResize);
  motionQueryRef()?.removeEventListener?.('change', onMotionChange);
  viewportQueryRef()?.removeEventListener?.('change', onViewportChange);
}

export function startAmbient() {
  if (!hasDom() || state.destroyed) return;
  if (!state.everStarted) {
    state.everStarted = true;
    state.stage = 0;
    state.fpsCap = BASE_FPS;
    state.slowMs = 0;
  }
  state.started = true;
  bindListeners();
  startFrames();
}

export function stopAmbient() {
  state.started = false;
  stopFrames();
}

export function destroyAmbient() {
  stopAmbient();
  state.destroyed = true;
  unbindListeners();
  if (state.canvas) state.canvas.remove();
  state.canvas = null;
  state.ctx = null;
  state.count = 0;
  state.xs = state.ys = state.vx = state.vy = state.radius = null;
}

if (hasDom()) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startAmbient(), { once: true });
  else startAmbient();
}
