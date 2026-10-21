import { api, session } from './api.js';
import { $, toast } from './common.js';

const RING_RADIUS = 62;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_ANIMATION_MS = 320;
const LEGEND_STAGGER_MS = 40;
const THEME_WASH_MS = 470;
const SEGMENTS = [
  { key: 'healthy', tone: 'good', label: '可用' },
  { key: 'cooling', tone: 'warn', label: '冷却' },
  { key: 'disabled', tone: 'bad', label: '禁用' },
];
const LEGEND_KEYS = [
  ['total', 'total', 'ovLegendTotal', 'ovBarTotal'],
  ['healthy', 'healthy', 'ovLegendHealthy', 'ovBarHealthy'],
  ['cooling', 'cooling', 'ovLegendCooling', 'ovBarCooling'],
  ['disabled', 'disabled', 'ovLegendDisabled', 'ovBarDisabled'],
];
let ringTimer = 0;
let themeWash = null;
let themeWashTimer = 0;

function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function overviewCounts(data = {}) {
  const total = safeCount(data.total);
  const healthy = safeCount(data.healthy);
  const cooling = safeCount(data.cooling);
  const disabled = safeCount(data.disabled);
  return { total, healthy, cooling, disabled, unclassified: Math.max(0, total - healthy - cooling - disabled) };
}

export function ringSegments(data = {}) {
  const counts = overviewCounts(data);
  if (!counts.total) return [];
  const visible = SEGMENTS.map(segment => ({ ...segment, value: counts[segment.key] })).filter(segment => segment.value > 0);
  const rendered = visible.reduce((sum, segment) => sum + segment.value, 0);
  if (rendered < counts.total) visible.push({ key: 'unclassified', tone: 'muted', label: '其他', value: counts.total - rendered });
  return visible.map(segment => ({ ...segment, share: segment.value / counts.total }));
}

export function ringMarkup(data = {}) {
  const segments = ringSegments(data);
  let offset = 0;
  return segments.map(segment => {
    const length = segment.share * RING_CIRCUMFERENCE;
    const circle = '<circle class="ring-segment ' + segment.tone + '" cx="80" cy="80" r="' + RING_RADIUS +
      '" stroke-dasharray="' + length.toFixed(3) + ' ' + (RING_CIRCUMFERENCE - length).toFixed(3) +
      '" stroke-dashoffset="' + (-offset).toFixed(3) +
      '" style="--ring-len:' + length.toFixed(3) + ';--ring-gap:' + (RING_CIRCUMFERENCE - length).toFixed(3) +
      ';--ring-circ:' + RING_CIRCUMFERENCE.toFixed(3) + '"></circle>';
    offset += length;
    return circle;
  }).join('');
}

export function ringLabel(data = {}) {
  const counts = overviewCounts(data);
  const parts = ['账号总数 ' + counts.total, '可用 ' + counts.healthy, '冷却 ' + counts.cooling, '禁用 ' + counts.disabled];
  if (counts.unclassified) parts.push('其他 ' + counts.unclassified);
  return parts.join('；');
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = String(value);
}

function setPercent(id, value) {
  const node = $(id);
  if (node) node.style.setProperty('--pct', value.toFixed(2) + '%');
}

function motionAllowed() {
  if (typeof document === 'undefined' || document.hidden) return false;
  const target = $('view-overview') || document.documentElement;
  if (target?.dataset?.motionMode === 'off') return false;
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return query?.matches !== true;
}

// 圆环进入动画：进入概览后首次 0 -> 目标值播放一次，320ms 后回到静态，避免常驻动画层。
function playRingAnimation(segments) {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = 0; }
  const view = $('view-overview');
  if (!segments || !segments.innerHTML) return;
  if (!motionAllowed()) {
    if (view) view.dataset.motion = 'off';
    return;
  }
  if (view) view.dataset.motion = 'on';
  ringTimer = setTimeout(() => {
    ringTimer = 0;
    if (view) view.dataset.motion = 'off';
  }, RING_ANIMATION_MS + LEGEND_STAGGER_MS * 3);
  ringTimer.unref?.();
}

function render(data = {}) {
  const counts = overviewCounts(data);
  setText('ovTotal', counts.total);
  for (const [, valueKey, numberId, barId] of LEGEND_KEYS) {
    const value = counts[valueKey];
    setText(numberId, value);
    setPercent(barId, counts.total ? value / counts.total * 100 : 0);
  }
  setText('ovRingLabel', ringLabel(data));
  const segments = $('ovRingSegments');
  if (segments) {
    segments.innerHTML = ringMarkup(data);
    playRingAnimation(segments);
  }
  const status = $('ovStatus');
  if (status) status.textContent = counts.total ? '统计来自本机账号池' : '账号池为空';
  $('view-overview')?.toggleAttribute?.('data-empty', counts.total === 0);
}

export function reflectOverviewStats(data = {}) {
  render(data);
  return overviewCounts(data);
}

export function resetOverview() {
  render({});
  setText('ovStatus', '登录后读取概览');
}

let themeBound = false;
let savingTheme = false;

function effectiveTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function reflectTheme(theme = effectiveTheme()) {
  const button = $('ovTheme');
  if (!button) return;
  button.setAttribute('aria-pressed', String(theme === 'light'));
  button.setAttribute('aria-label', theme === 'light' ? '切换到深色主题' : '切换到浅色主题');
  setText('ovThemeLabel', theme === 'light' ? '日间' : '夜间');
}

async function saveTheme(next) {
  const current = await api('preferences');
  await api('preferences', {
    method: 'POST',
    body: JSON.stringify({ credit_guard_low: current.credit_guard_low ?? 100, theme: next }),
  });
}

function washOrigin(button) {
  const orb = button?.querySelector?.('.daynight-orb');
  const rect = orb?.getBoundingClientRect?.() || button?.getBoundingClientRect?.();
  const x = rect ? rect.left + rect.width / 2 : (globalThis.innerWidth || 0) / 2;
  const y = rect ? rect.top + rect.height / 2 : (globalThis.innerHeight || 0) / 2;
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
}

// 昼夜切换：先铺一层目标主题色的遮罩（clip 半径 0），下一帧切换主题并向外扩散 470ms。
function playThemeWash(button, next, commit) {
  if (themeWashTimer) { clearTimeout(themeWashTimer); themeWashTimer = 0; }
  if (themeWash) { themeWash.remove?.(); themeWash = null; }
  const raf = globalThis.requestAnimationFrame;
  if (!motionAllowed() || typeof raf !== 'function') { commit(); return false; }
  const host = document.body;
  if (!host?.appendChild) { commit(); return false; }
  const layer = document.createElement('div');
  layer.className = 'theme-wash to-' + next;
  layer.setAttribute('aria-hidden', 'true');
  const { x, y } = washOrigin(button);
  layer.style.setProperty('--theme-x', x + 'px');
  layer.style.setProperty('--theme-y', y + 'px');
  host.appendChild(layer);
  themeWash = layer;
  raf(() => {
    commit();
    layer.classList.add('on');
  });
  themeWashTimer = setTimeout(() => {
    themeWashTimer = 0;
    layer.remove?.();
    if (themeWash === layer) themeWash = null;
  }, THEME_WASH_MS);
  themeWashTimer.unref?.();
  return true;
}

function applyThemeInstant(next) {
  document.documentElement.dataset.theme = next;
  reflectTheme(next);
  document.dispatchEvent(new CustomEvent('panel:theme', { detail: { theme: next } }));
}

function bindTheme() {
  if (themeBound) return;
  themeBound = true;
  const button = $('ovTheme');
  if (!button) return;
  button.onclick = async () => {
    if (savingTheme) return;
    const previous = effectiveTheme(), next = previous === 'dark' ? 'light' : 'dark';
    playThemeWash(button, next, () => applyThemeInstant(next));
    if (!session.authenticated) return;
    savingTheme = true;
    button.disabled = true;
    try { await saveTheme(next); }
    catch (error) {
      document.documentElement.dataset.theme = previous;
      reflectTheme(previous);
      toast('主题未保存：' + error.message, 'err');
    }
    finally { savingTheme = false; button.disabled = false; }
  };
  document.addEventListener('panel:theme', event => reflectTheme(event.detail?.theme || effectiveTheme()));
  reflectTheme();
}

export function bindOverview() {
  bindTheme();
  document.addEventListener('panel:session', () => { if (!session.authenticated) resetOverview(); });
  const base = $('ovBaseURL');
  if (base) base.textContent = globalThis.location?.origin ? globalThis.location.origin + '/v1' : '—';
}

export async function loadOverviewView() {
  if (!session.authenticated) { resetOverview(); return null; }
  const data = await api('overview');
  if (!session.authenticated) return null;
  reflectOverviewStats(data);
  return data;
}

bindOverview();
