import { api, session } from './api.js';
import { $, toast } from './common.js';

const RING_RADIUS = 62;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const SEGMENTS = [
  { key: 'healthy', tone: 'good', label: '可用' },
  { key: 'cooling', tone: 'warn', label: '冷却' },
  { key: 'disabled', tone: 'bad', label: '禁用' },
];

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
      '" stroke-dashoffset="' + (-offset).toFixed(3) + '"></circle>';
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

function render(data = {}) {
  const counts = overviewCounts(data);
  setText('ovTotal', counts.total);
  setText('ovLegendTotal', counts.total);
  setText('ovLegendHealthy', counts.healthy);
  setText('ovLegendCooling', counts.cooling);
  setText('ovLegendDisabled', counts.disabled);
  setText('ovRingLabel', ringLabel(data));
  const segments = $('ovRingSegments');
  if (segments) segments.innerHTML = ringMarkup(data);
  const status = $('ovStatus');
  if (status) status.textContent = counts.total ? '统计来自本机账号池' : '账号池为空';
  const foot = $('ovFoot');
  if (foot) foot.textContent = counts.total ? '计数为本机聚合值，不按分页计算。' : '添加账号后，这里会显示实时状态分布。';
  $('view-overview')?.toggleAttribute?.('data-empty', counts.total === 0);
}

export function reflectOverviewStats(data = {}) {
  render(data);
  return overviewCounts(data);
}

export function resetOverview() {
  render({});
  setText('ovStatus', '登录后读取概览');
  setText('ovFoot', '登录后读取本机账号池统计。');
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

function bindTheme() {
  if (themeBound) return;
  themeBound = true;
  const button = $('ovTheme');
  if (!button) return;
  button.onclick = async () => {
    if (savingTheme) return;
    const previous = effectiveTheme(), next = previous === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    reflectTheme(next);
    document.dispatchEvent(new CustomEvent('panel:theme', { detail: { theme: next } }));
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
