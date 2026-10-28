import { loadCapabilities, logsAvailable } from './capabilities.js';
import { $, toast } from './common.js';
import { api, session, cancelReads } from './api.js';
import { visibleInterval } from './lifecycle.js';
import { loadOverview } from './accounts.js';
import { loadModels } from './models.js';
import { loadLogs } from './logs.js';
import { loadConfig } from './config.js';
import { openAdd } from './add-account.js';
import { loadTasks } from './tasks.js';
import { loadUsage } from './usage.js';
import { loadPackages } from './packages.js';
import { loadEgress } from './egress.js';
import { setTheme } from './theme.js';
import { loadOverviewView } from './overview.js';
import { startStartupAnimation, TARGET_MS, HARD_LIMIT_MS } from './startup-animation.js';
import { bindAnimationSettings, applyAnimationPreference, styleFromPreferences } from './animation-settings.js';
const titles = {overview:'概览', accounts:'账号池', taskscenter:'账号任务', egress:'账号出口', usage:'积分用量', packages:'积分构成', models:'模型查看', logs:'错误记录', config:'系统设置'};
let view = 'overview', timer, loading = false, startupGeneration = 0;
let startupRun = null, startupPlayedFor = 0, sessionGeneration = 0, sessionAuthenticated = false;
let animationSettingsDestroy = null, animationSettingsAttempted = false;
let startupRefreshAbort = null, pagehideFired = false;

function ensureAnimationSettings() {
  if (animationSettingsAttempted) return;
  animationSettingsAttempted = true;
  animationSettingsDestroy = bindAnimationSettings({
    previewOptions: { onFinish: () => {} },
  });
}

function teardownAnimationSettings() {
  animationSettingsDestroy?.();
  animationSettingsDestroy = null;
  animationSettingsAttempted = false;
}

export async function bootstrapAccounts(deadline = Date.now() + HARD_LIMIT_MS) {
  const work = (async () => {
    await api('session/bootstrap', {method: 'POST', body: '{}'});
    while (Date.now() < deadline && session.authenticated) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      let state;
      try { state = await api('session/bootstrap/status', {signal: controller.signal}); }
      finally { clearTimeout(timeout); }
      if (!state.running || state.completed || state.partial || state.failed) return state;
      await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
    }
    return {running: true, timed_out: true};
  })();
  try { return await work; }
  catch (error) { if (error.name !== 'AbortError') console.warn('account bootstrap unavailable', error); return {error: error.message}; }
}
function withinStartupBudget(promise, deadline) {
  const remaining = Math.max(0, deadline - Date.now());
  let timer;
  const budget = new Promise(resolve => { timer = setTimeout(() => resolve({timed_out:true}), remaining); });
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer));
}
const STARTUP_EXIT_MS = 360;
const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const sleepUntil = deadline => delay(deadline - Date.now());
// The boot veil is painted from the first byte (body.is-booting) and only the
// overlay itself decides when the login card may appear.
function setBooting(active) {
  globalThis.document?.body?.classList?.[active ? 'add' : 'remove']?.('is-booting');
}
function applyStartupValues(values) {
  if (!values) return;
  const preferences = values[2]?.status === 'fulfilled' ? values[2].value : null;
  if (preferences?.theme) setTheme(preferences.theme);
  const style = values[3]?.status === 'fulfilled' ? values[3].value : null;
  if (style) applyAnimationPreference(style);
}
function markStartupClosed(run) {
  if (!run || run.closed) return;
  run.closed = true;
  run.releaseSkip?.();
  setBooting(false);
  if (startupRun === run) startupRun = null;
  if (Number.isFinite(run.playedFor)) startupPlayedFor = Math.max(startupPlayedFor, run.playedFor);
  if (!run.skipped) releaseStartupRefresh();
}
// Handoff into the workspace (or the login card) exactly once per run. Skipping
// the intro must still enter the workspace, otherwise the overview would stay
// on its placeholder text.
function enterWorkspace(run) {
  if (run?.entered) return;
  if (run) run.entered = true;
  if (!session.authenticated) { $('loginPassword')?.focus?.(); return; }
  void go(location.hash.slice(1)).catch(() => {});
  if (!timer) timer = visibleInterval(refreshVisible, 5000);
}
function skipStartup(run) {
  if (!run || run.closed || run.skipped) return;
  run.skipped = true;
  setBooting(false);
  // Skip ends the overlay only; background work keeps its own hard deadline.
  enterWorkspace(run);
  run.animation.finish();
}
function attachStartupSkip(run) {
  const onKey = event => { if (event?.key === 'Escape') skipStartup(run); };
  const onClick = () => skipStartup(run);
  globalThis.addEventListener?.('keydown', onKey);
  run.animation.root?.addEventListener?.('click', onClick);
  if (run.animation.root?.style) run.animation.root.style.pointerEvents = 'auto';
  run.releaseSkip = () => {
    globalThis.removeEventListener?.('keydown', onKey);
    run.animation.root?.removeEventListener?.('click', onClick);
  };
}
function beginStartup() {
  if (startupRun) return startupRun;
  let run = null;
  // onFinish fires when the 360ms exit starts, for both the timed path and skip.
  // Router owns the complete handoff so the workspace always opens before
  // the overlay is destroyed, including at the hard deadline.
  const animation = startStartupAnimation({ hardLimitMs: 0, onFinish: () => markStartupClosed(run) });
  const startedAt = Date.now();
  run = {
    animation, startedAt,
    deadline: startedAt + TARGET_MS,
    // Reserve the fade-out window inside the advertised hard limit.
    hardDeadline: startedAt + HARD_LIMIT_MS,
    dataDeadline: startedAt + Math.max(TARGET_MS, HARD_LIMIT_MS - STARTUP_EXIT_MS),
    generation: startupGeneration,
    playedFor: sessionGeneration,
    reduced: !animation.root,
    authenticated: false, closed: false, skipped: false, entered: false,
    data: null, values: null, valuesPromise: null, releaseSkip: null,
  };
  startupRun = run;
  if (run.reduced) { setBooting(false); return run; }
  setBooting(true);
  attachStartupSkip(run);
  driveStartup(run).catch(() => { if (!run.closed) destroyStartup(); });
  return run;
}
// One exit for every path: the overlay stays mounted until the full target has
// elapsed, then syncing + 360ms fade. Data readiness never shortens the dwell.
async function driveStartup(run) {
  await sleepUntil(run.deadline);
  if (run.closed || run.skipped) return;
  if (run.valuesPromise) await Promise.race([run.valuesPromise.catch(() => null), sleepUntil(run.dataDeadline)]);
  if (run.closed || run.skipped) return;
  run.animation.setPhase('syncing');
  setBooting(false);
  enterWorkspace(run);
  await delay(Math.min(STARTUP_EXIT_MS, Math.max(0, run.hardDeadline - Date.now())));
  if (run.closed) return;
  run.animation.destroy();
}
function attachStartupData(run) {
  if (run.data) return run.data;
  ensureAnimationSettings();
  const preferencesPromise = import('./preferences.js').then(({getPreferences}) => getPreferences()).catch(() => null);
  const animationStylePromise = preferencesPromise.then(preferences => {
    if (!preferences || !preferences.animation_style) return null;
    const style = applyAnimationPreference(styleFromPreferences(preferences));
    if (!run.closed) run.animation.setStyle(style);
    return style;
  }).catch(() => null);
  // Login refreshes enabled subscriptions exactly once. The overlay's own
  // teardown is the authoritative moment to abort it, so no late POST can
  // outlive the animation.
  const refreshController = new AbortController();
  startupRefreshAbort = refreshController;
  const refreshCutoff = setTimeout(() => refreshController.abort(), Math.max(0, run.dataDeadline - Date.now()));
  const refreshWork = import('./egress.js')
    .then(m => m.refreshSubscriptionsOnce?.({signal: refreshController.signal, timeoutMs: 4000}))
    .catch(() => null)
    .finally(() => {
      clearTimeout(refreshCutoff);
      if (startupRefreshAbort === refreshController) startupRefreshAbort = null;
    });
  run.data = Promise.allSettled([
    loadCapabilities(),
    bootstrapAccounts(run.dataDeadline),
    preferencesPromise,
    animationStylePromise,
    refreshWork,
  ]);
  if (run.reduced) {
    // No overlay to wait for: entering the workspace is not gated by 8s.
    void go(location.hash.slice(1)).catch(() => {});
    run.data.then(values => {
      applyStartupValues(values);
      if (startupRun === run) startupRun = null;
      startupPlayedFor = Math.max(startupPlayedFor, run.playedFor || 0);
    });
    return run.data;
  }
  const generation = run.generation;
  run.valuesPromise = withinStartupBudget(run.data, run.dataDeadline).then(result => {
    const values = result?.timed_out ? null : result;
    run.values = values;
    if (values && generation === startupGeneration && !run.closed) applyStartupValues(values);
    return values;
  }).catch(() => null);
  return run.data;
}
export function destroyStartup() {
  startupGeneration++;
  const run = startupRun;
  startupRun = null;
  releaseStartupRefresh();
  setBooting(false);
  run?.releaseSkip?.();
  run?.animation?.destroy();
  if (run) startupPlayedFor = Math.max(startupPlayedFor, run.playedFor || 0);
}
// The overlay is the only place a login refresh is allowed to run. Releasing it
// aborts any in-flight POST instead of waiting for a late upstream response.
function releaseStartupRefresh() {
  startupRefreshAbort?.abort();
  startupRefreshAbort = null;
}
function handlePageHide() {
  if (pagehideFired) return;
  pagehideFired = true;
  destroyStartup();
  teardownAnimationSettings();
}
addEventListener('pagehide', handlePageHide);
// BFCache restores skip module re-execution, so the flag must be cleared or a
// later pagehide would be ignored. Nothing is initialized again here; the
// lifecycle module reloads the document only for persisted restores.
addEventListener('pageshow', () => { pagehideFired = false; });
async function loadView() {
  if (!session.authenticated || document.hidden) return;
  if (view === 'overview') await loadOverviewView();
  else if (view === 'accounts') await loadOverview();
  else if (view === 'models') await loadModels();
  else if (view === 'config') await loadConfig();
  else if (view === 'logs' && logsAvailable()) await loadLogs();
  else if (view === 'usage') await loadUsage();
  else if (view === 'packages') await loadPackages();
  else if (view === 'taskscenter') await loadTasks();
  else if (view === 'egress') await loadEgress();
}
// 只切换外壳（标题、导航选中、视图显隐），不触发任何网络读取。
function renderChrome() {
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'view-' + view; });
  document.querySelectorAll('.nav a').forEach(el => { const on = el.dataset.view === view; el.classList.toggle('on',on); if (on) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
  $('ttl').textContent = titles[view]; $('btnAdd').hidden = view !== 'accounts'; $('btnRefresh').hidden = view !== 'accounts' && view !== 'overview';
}
export async function go(value) {
  cancelReads(); view = Object.hasOwn(titles, value) && (value !== 'logs' || logsAvailable()) ? value : 'overview';
  renderChrome();
  history.replaceState(null, '', '#' + view);
  globalThis.scrollTo?.({top:0,left:0,behavior:'instant'});
  try { await loadView(); } catch (error) { if (error.name !== 'AbortError') toast('读取失败：' + error.message, 'err'); }
}
export async function refreshVisible() {
  if (loading || !session.authenticated || document.hidden) return;
  loading = true;
  try { if (view === 'accounts' || view === 'logs' || view === 'taskscenter' || view === 'egress') await loadView(); }
  finally { loading = false; }
}
document.querySelectorAll('.nav a').forEach(link => { link.onclick = event => { event.preventDefault(); go(link.dataset.view); }; });
addEventListener('hashchange', () => go(location.hash.slice(1)));
$('btnAdd').onclick = openAdd;
$('btnRefresh').onclick = async () => {
  if (loading) return;
  const button = $('btnRefresh');
  if (!session.authenticated) return;
  button.classList.add('refreshing');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  loading = true;
  try {
    const result = await api('refresh', {method:'POST', body:'{}'});
    const failed = Object.entries(result.components || {}).filter(([, item]) => item?.ok !== true);
    await Promise.allSettled([loadOverview(true), loadUsage({force:true}), loadPackages(), loadLogs()]);
    if (!result.ok || failed.length) toast('刷新部分未完成：' + failed.map(([name]) => name).join('、'), 'err');
  }
  catch (error) { if (error.name !== 'AbortError') toast('账号刷新未完成：' + error.message, 'err'); }
  finally {
    loading = false;
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    setTimeout(() => button.classList.remove('refreshing'), 500);
  }
};
// A new session is a false -> true transition of the authenticated flag, never
// a csrf token. That keeps reload-with-cookie, manual login and logout->login
// each playing exactly once.
document.addEventListener('panel:session', event => {
  const authenticated = !!event.detail?.authenticated;
  if (authenticated && !sessionAuthenticated) sessionGeneration++;
  sessionAuthenticated = authenticated;
  if (!authenticated && startupRun?.authenticated) destroyStartup();
});
document.addEventListener('panel:authenticated', () => {
  if (!session.authenticated) return;
  if (startupPlayedFor === sessionGeneration) return;
  if (startupRun?.authenticated) return;
  const run = startupRun || beginStartup();
  if (!run) return;
  run.authenticated = true;
  run.playedFor = sessionGeneration;
  // 返回数据 Promise 只为让同步测试能等到一轮加载结束；真实 DOM 的
  // dispatchEvent 不会等待监听器返回值，动画节奏完全由 driveStartup 掌握。
  return attachStartupData(run);
});
// Boot the overlay before auth resolves so a cached cookie never flashes the
// login card first, and an anonymous visit still sees the full intro.
beginStartup();
renderChrome();
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshVisible().catch(() => {}); });
document.addEventListener('panel:capabilities', event => { if (!event.detail.logs && view === 'logs') go('overview'); });
