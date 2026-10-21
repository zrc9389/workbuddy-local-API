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
let view = 'overview', timer, loading = false, startup = null, startupSession = null, startupGeneration = 0;
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
export function destroyStartup() {
  startupGeneration++;
  releaseStartupRefresh();
  startup?.animation?.destroy();
  startup = null;
  startupSession = null;
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
export async function go(value) {
  cancelReads(); view = Object.hasOwn(titles, value) && (value !== 'logs' || logsAvailable()) ? value : 'overview';
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'view-' + view; });
  document.querySelectorAll('.nav a').forEach(el => { const on = el.dataset.view === view; el.classList.toggle('on',on); if (on) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
  $('ttl').textContent = titles[view]; $('btnAdd').hidden = view !== 'accounts'; $('btnRefresh').hidden = view !== 'accounts' && view !== 'overview';
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
    await api('balance_all', {method:'POST', body:'{}'});
    await loadOverview(true);
  }
  catch (error) { if (error.name !== 'AbortError') toast('账号刷新未完成：' + error.message, 'err'); }
  finally {
    loading = false;
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
    setTimeout(() => button.classList.remove('refreshing'), 500);
  }
};
document.addEventListener('panel:authenticated', async () => {
  const authToken = session.csrf_token || 'authenticated';
  if (startup || startupSession === authToken) return;
  startupSession = authToken;
  ensureAnimationSettings();
  // The overlay's own teardown is the authoritative moment to abort the login
  // refresh, so no late POST can outlive the animation.
  const animation = startStartupAnimation({ onFinish: releaseStartupRefresh });
  startup = {animation};
  const generation = startupGeneration;
  const stale = () => generation !== startupGeneration || !session.authenticated;
  const startedAt = Date.now();
  const deadline = startedAt + TARGET_MS, hardDeadline = startedAt + HARD_LIMIT_MS;
  const preferencesPromise = import('./preferences.js').then(({getPreferences}) => getPreferences()).catch(() => null);
  const animationStylePromise = preferencesPromise.then(preferences => {
    if (!preferences || !preferences.animation_style) return null;
    const style = applyAnimationPreference(styleFromPreferences(preferences));
    animation.setStyle(style);
    return style;
  }).catch(() => null);
  // Login refreshes enabled subscriptions exactly once. It shares the startup
  // abort signal and hard deadline, so the animation never waits for a late
  // upstream response; failures surface as an in-memory event, not a dialog.
  const refreshController = new AbortController();
  startupRefreshAbort = refreshController;
  // The cutoff fires exactly with the animation hard limit, so a late POST can
  // never outlive the overlay even if the refresh ignores its own budget.
  const refreshCutoff = setTimeout(() => refreshController.abort(), Math.max(0, hardDeadline - Date.now()));
  const refreshWork = import('./egress.js')
    .then(m => m.refreshSubscriptionsOnce?.({signal: refreshController.signal, timeoutMs: 4000}))
    .catch(() => null)
    .finally(() => {
      clearTimeout(refreshCutoff);
      if (startupRefreshAbort === refreshController) startupRefreshAbort = null;
    });
  const work = Promise.allSettled([
    loadCapabilities(),
    bootstrapAccounts(hardDeadline),
    preferencesPromise,
    animationStylePromise,
    refreshWork,
  ]);
  const result = await withinStartupBudget(work, deadline);
  if (stale()) { destroyStartup(); return; }
  const values = result?.timed_out ? null : result;
  if (values) {
    const preferences = values[2]?.status === 'fulfilled' ? values[2].value : null;
    if (preferences?.theme) setTheme(preferences.theme);
    const style = values[3]?.status === 'fulfilled' ? values[3].value : null;
    if (style) animation.setStyle(style);
  }
  animation.setPhase('syncing');
  await go(location.hash.slice(1));
  if (stale()) { destroyStartup(); return; }
  if (!timer) timer = visibleInterval(refreshVisible,5000);
  if (values) {
    // The animation has played its full target; never keep refreshing behind
    // the user's back once the overlay is gone.
    releaseStartupRefresh();
    animation.destroy();
    startup = null;
    return;
  }
  withinStartupBudget(work, hardDeadline).then(values => {
    if (stale()) return;
    const preferences = values?.[2]?.status === 'fulfilled' ? values[2].value : null;
    if (preferences?.theme) setTheme(preferences.theme);
    const style = values?.[3]?.status === 'fulfilled' ? values[3].value : null;
    if (style) applyAnimationPreference(style);
    releaseStartupRefresh();
    startup?.animation?.destroy();
    startup = null;
  }).catch(() => {
    if (!stale()) destroyStartup();
  });
});
document.addEventListener('panel:session', event => { if (!event.detail?.authenticated) destroyStartup(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshVisible().catch(() => {}); });
document.addEventListener('panel:capabilities', event => { if (!event.detail.logs && view === 'logs') go('overview'); });
