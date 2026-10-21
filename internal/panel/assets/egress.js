import { $, esc, toast } from './common.js';
import { api, session } from './api.js';
import { paginate, pagerHTML, bindPager } from './pagination.js';
import { registerPageCleanup, registerViewCleanup, onViewHidden, visibleInterval, clearVisibleInterval } from './lifecycle.js';
import { showModal, hideModal } from './modals.js';
let nodes = [], bindings = [], accounts = [], nodePage = 1, accountPage = 1, targetUID = '', opened = false, starting = false, binding = false, polling = false, pollTimer = null, pollDeadline = 0, pollAbort = null, readAbort = null, pollGeneration = 0, generation = 0, trendGeneration = 0, status = {}, tests = {}, trendHelper = null, subscriptionFilter = '', filterGeneration = 0;
export function formatBytes(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return '—';
  let n = Number(value), unit = 0; const units = ['B','KB','MB','GB','TB'];
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
  return (unit ? n.toFixed(n >= 10 ? 1 : 2) : String(n)) + ' ' + units[unit];
}
export function nodeLatency(node) {
  return node.status === 'ok' && Number.isFinite(node.delay_ms) ? {tone:'ok',text:node.delay_ms + ' ms'} : ({testing:{tone:'warn',text:'测试中'},timeout:{tone:'warn',text:'超时'},error:{tone:'bad',text:'测试失败'}}[node.status] || {tone:'muted',text:'未测试'});
}
export function nodeTrendHTML(history, helper = trendHelper) {
  const samples = (history || []).filter(sample => Number.isFinite(sample.delay) && sample.delay > 0);
  if (samples.length < 2 || !helper) return '';
  const trend = helper.computeLatencyTrend(history);
  if (!trend) return '';
  const points = trend.points || trend;
  if (!Array.isArray(points)) return '';
  const path = helper.svgPathFromPoints(points);
  return '<svg class="latency-trend" viewBox="0 0 100 50" role="img" aria-label="metacubexd 延迟趋势组件"><path d="' + esc(path) + '"/></svg>';
}
async function loadTrendHelper() {
  if (trendHelper) return;
  const current = trendGeneration;
  try { trendHelper = await import('/panel/vendor/latency-trend.js'); if (opened) renderNodes(); }
  catch { /* Optional visualization unavailable; numeric measurements remain authoritative. */ }
  if (current !== trendGeneration) trendHelper = null;
}
function testText(data) {
  if (data.cancelled) return '测试已取消';
  if (data.running) return '测试中 · ' + (data.completed ?? 0) + ' / ' + (data.total ?? '—');
  return data.id ? '已完成 ' + (data.completed ?? 0) + ' / ' + (data.total ?? '—') + ' · 失败 ' + (data.failed ?? 0) : '尚未开始测试';
}
function testActionHTML() {
  const label = tests.running ? '测试进行中…' : tests.id ? '重新测试延迟' : '测试延迟';
  return '<div class="node-test-bar"><button type="button" class="primary" data-test-nodes aria-label="测试节点延迟"' + (starting || tests.running ? ' disabled' : '') + '>' + label + '</button><span class="hint">仅点击此按钮才提交测试请求。</span></div>';
}
function renderNodes() {
  const page = paginate(nodes, nodePage, 16); nodePage = page.page;
  const current = bindings.find(item => item.uid === targetUID)?.node;
  $('nodeStatus').textContent = testText(tests);
  $('nodeList').innerHTML = testActionHTML() + (page.rows.map(node => {
    const latency = nodeLatency(node), selected = current === node.id;
    return '<article class="node-card"><div class="node-title"><strong>' + esc(node.name || node.id) + '</strong><span class="tag ' + latency.tone + '">' + esc(latency.text) + '</span></div><p class="hint">' + esc(node.type || '代理节点') + (node.provider ? ' · ' + esc(node.provider) : '') + '</p>' + nodeTrendHTML(node.history) + (targetUID ? '<button data-bind-node="' + esc(node.id) + '" aria-pressed="' + selected + '"' + (binding || selected ? ' disabled' : '') + '>' + (selected ? '当前账号出口' : '绑定此节点') + '</button>' : '') + '</article>';
  }).join('') || '<div class="empty">尚无节点。请在设置中导入订阅；前端不会自动下载内核。</div>');
  $('nodePages').innerHTML = pagerHTML(page, 'nodes');
}
function renderAccounts() {
  const page = paginate(accounts, accountPage, 24); accountPage = page.page;
  $('egressAccounts').innerHTML = page.rows.map(account => {
    const bound = bindings.find(item => item.uid === account.uid), node = nodes.find(item => item.id === bound?.node), latency = node ? nodeLatency(node) : null;
    return '<article class="route-card"><div><strong>' + esc(account.nickname || account.uid) + '</strong><p class="mono hint">' + esc(account.uid) + '</p></div><button class="egress-badge" data-route-uid="' + esc(account.uid) + '">' + esc(node?.name || (bound ? bound.node : '未绑定节点')) + (latency ? ' · ' + esc(latency.text) : '') + ' ↗</button></article>';
  }).join('') || '<div class="empty">添加账号后可为每个账号独立绑定出口。</div>';
  $('egressPages').innerHTML = pagerHTML(page, 'routes');
}
const filterBound = new WeakSet();
function filterSelect() { return document.getElementById('nodeSubscriptionFilter'); }
function bindFilterSelect(select) {
  if (!select || filterBound.has(select) || typeof select.addEventListener !== 'function') return;
  filterBound.add(select);
  // Switching the filter is a read: it never starts latency tests or polling.
  select.addEventListener('change', () => applyNodeFilter());
}
function resetFilterSelect() {
  const select = filterSelect();
  if (!select) return;
  bindFilterSelect(select);
  select.innerHTML = '<option value="">全部订阅</option>';
  select.value = '';
}
// The option list comes from the cached GET meta/subscriptions; nothing here
// refreshes an upstream subscription or downloads a provider file.
function renderSubscriptionFilter(list) {
  const select = filterSelect();
  if (!select) return;
  bindFilterSelect(select);
  const options = ['<option value="">全部订阅</option>'], seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const id = item && typeof item.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const count = Number.isInteger(item.node_count) && item.node_count > 0 ? '（' + item.node_count + ' 个节点）' : '';
    options.push('<option value="' + esc(id) + '">' + esc(item.name || id) + count + '</option>');
  }
  select.innerHTML = options.join('');
  select.value = subscriptionFilter && seen.has(subscriptionFilter) ? subscriptionFilter : '';
  subscriptionFilter = select.value || '';
}
async function loadSubscriptionFilter(signal) {
  const select = filterSelect();
  if (!select) return [];
  bindFilterSelect(select);
  const current = generation;
  try {
    const result = await api('meta/subscriptions', { signal });
    if (!opened || current !== generation) return [];
    const list = Array.isArray(result?.subscriptions) ? result.subscriptions : [];
    renderSubscriptionFilter(list);
    return list;
  } catch {
    // Without a readable cache the modal keeps the unfiltered list.
    if (!opened || current !== generation) return [];
    renderSubscriptionFilter([]);
    return [];
  }
}
// The filtered response only carries bindings for the nodes it returns. Keep the
// bindings of nodes outside the filter so account cards stay truthful.
function mergeFilteredBindings(previous, next, visibleNodes) {
  const visible = new Set((visibleNodes || []).map(node => node.id));
  return previous.filter(item => !visible.has(item.node)).concat(next || []);
}
function nodesPath() {
  return subscriptionFilter ? 'meta/nodes?subscription_id=' + encodeURIComponent(subscriptionFilter) : 'meta/nodes';
}
async function applyNodeFilter() {
  const select = filterSelect();
  if (!select || !opened) return;
  const value = String(select.value || '');
  if (value === subscriptionFilter) return;
  subscriptionFilter = value; nodePage = 1;
  // Rapid switches must not let an older response overwrite the newer filter.
  const current = generation, filterEpoch = ++filterGeneration, signal = readAbort?.signal;
  $('nodeError').textContent = '';
  try {
    const data = await api(nodesPath(), { signal });
    if (!opened || current !== generation || filterEpoch !== filterGeneration) return;
    bindings = mergeFilteredBindings(bindings, data.bindings, data.nodes);
    nodes = data.nodes || []; renderNodes();
  } catch (error) {
    if (error.name === 'AbortError' || !opened || current !== generation || filterEpoch !== filterGeneration) return;
    $('nodeError').textContent = '节点筛选失败：' + error.message;
  }
}
function reflectMeta(core, stats, job) {
  status = core; tests = job;
  $('metaState').textContent = core.running ? '内核运行中' : core.available ? '内核待启动' : '内核不可用';
  $('metaState').className = 'tag ' + (core.running ? 'ok' : 'warn');
  $('metaError').textContent = core.error || '';
  $('trafficDownload').textContent = formatBytes(stats.download_total);
  $('trafficUpload').textContent = formatBytes(stats.upload_total);
  $('rateDownload').textContent = formatBytes(stats.download_speed) + (stats.download_speed == null ? '' : ' /s');
  $('rateUpload').textContent = formatBytes(stats.upload_speed) + (stats.upload_speed == null ? '' : ' /s');
  $('metaConnections').textContent = stats.active_connections == null ? '连接数未知' : stats.active_connections + ' 个活动连接';
  $('metaSample').textContent = stats.sampled_at ? '采样 ' + new Date(stats.sampled_at).toLocaleTimeString('zh-CN', {hour12:false}) + (stats.estimated ? ' · 内核估算' : '') : '暂无有效采样';
  const summary = $('metaTestSummary');
  if (summary) summary.textContent = testText(job);
}
export async function loadEgress() {
  $('egressError').hidden = true;
  try {
    const [core, data, stats, job, overview] = await Promise.all([api('meta/status'), api('meta/nodes'), api('meta/stats'), api('meta/tests'), api('overview')]);
    // The open node modal owns its filtered view; a background refresh must not
    // replace it with the unfiltered node set.
    if (!opened) { nodes = data.nodes || []; bindings = data.bindings || []; }
    accounts = overview.accounts || [];
    reflectMeta(core, stats, job); renderAccounts();
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('egressError').textContent = '出口状态读取失败：' + error.message; $('egressError').hidden = false;
    reflectMeta({available:false}, {}, {}); $('metaState').textContent = '连接未确认';
  }
}
function stopPolling() {
  if (pollTimer) clearVisibleInterval(pollTimer);
  pollTimer = null; pollDeadline = 0;
  if (pollAbort) { pollAbort.abort(); pollAbort = null; polling = false; }
}
function beginReads() {
  readAbort?.abort();
  readAbort = new AbortController();
  return readAbort.signal;
}
function abortReads() { readAbort?.abort(); readAbort = null; }
function startPolling() {
  stopPolling();
  pollDeadline = Date.now() + 30 * 60 * 1000 + 10000;
  const epoch = ++pollGeneration;
  pollTimer = visibleInterval(pollNodeTests, 1500);
  return epoch;
}
export async function pollNodeTests(epoch = pollGeneration) {
  if (!opened || polling) return;
  if (epoch !== pollGeneration) return;
  if (pollDeadline && Date.now() > pollDeadline) { stopPolling(); $('nodeError').textContent = '已停止等待测试结果。后端任务受并发与超时限制，可关闭后重新查看。'; return; }
  const current = generation, filterEpoch = filterGeneration, controller = new AbortController(), signal = controller.signal;
  pollAbort = controller; polling = true;
  try {
    const [job, data] = await Promise.all([api('meta/tests', {signal}), api(nodesPath(), {signal})]);
    if (!opened || current !== generation || epoch !== pollGeneration || filterEpoch !== filterGeneration) return;
    tests = job; bindings = mergeFilteredBindings(bindings, data.bindings, data.nodes); nodes = data.nodes || [];
    if (!job.running) stopPolling();
    renderNodes();
    if (!trendHelper && nodes.some(node => (node.history || []).length >= 2)) loadTrendHelper();
  } catch (error) { if (error.name !== 'AbortError' && opened && current === generation && epoch === pollGeneration && filterEpoch === filterGeneration) { stopPolling(); $('nodeError').textContent = '测试状态读取失败：' + error.message; } }
  finally { if (pollAbort === controller) { pollAbort = null; polling = false; } }
}
export async function startNodeTests() {
  if (!opened || starting || pollTimer) return;
  const current = generation;
  starting = true; renderNodes(); $('nodeError').textContent = '';
  try {
    let job;
    const signal = readAbort?.signal;
    try { job = await api('meta/tests', {method:'POST',body:'{}',signal}); }
    catch (error) { if (error.status !== 409) throw error; job = await api('meta/tests', {signal}); }
    if (!opened || current !== generation) return;
    tests = job; renderNodes();
    if (tests.running) { await pollNodeTests(); if (opened && current === generation && tests.running) startPolling(); }
  } catch (error) {
    if (error.name !== 'AbortError' && opened && current === generation) {
      $('nodeError').textContent = '无法启动节点测试：' + error.message;
      $('nodeStatus').textContent = '测试未启动';
    }
  } finally { if (current === generation) starting = false; if (opened && current === generation) renderNodes(); }
}
export async function openNodeModal(uid = '') {
  if (starting || opened || !session.authenticated) return;
  opened = true; starting = true; targetUID = uid; nodePage = 1; generation++;
  const current = generation;
  stopPolling();
  $('nodeTitle').textContent = uid ? '选择账号出口' : '节点延迟测试'; $('nodeAccount').textContent = uid || '全部订阅节点 · 不更改账号绑定';
  $('nodeError').textContent = ''; $('nodeStatus').textContent = '正在读取节点与测试记录…'; $('nodeList').innerHTML = '<div class="empty">正在读取节点…</div>'; $('nodePages').innerHTML = '';
  subscriptionFilter = ''; resetFilterSelect();
  const signal = beginReads();
  // The option list is the panel's cached subscription view; it never refreshes
  // an upstream subscription. Nodes stay unfiltered until the user picks one.
  const filterLoad = loadSubscriptionFilter(signal);
  showModal('nodeVeil');
  try {
    const [job, data] = await Promise.all([api('meta/tests', {signal}), api('meta/nodes', {signal})]);
    await filterLoad;
    if (!opened || current !== generation) return;
    tests = job; nodes = data.nodes || []; bindings = data.bindings || []; renderNodes();
    if (nodes.some(node => (node.history || []).length >= 2)) loadTrendHelper();
  } catch (error) { if (error.name !== 'AbortError' && opened && current === generation) { $('nodeError').textContent = '节点读取失败：' + error.message; $('nodeStatus').textContent = '尚未读取节点'; $('nodeList').innerHTML = '<div class="empty">请先在设置中配置有效订阅，并确认本机 Meta 内核可用。</div>'; } }
  finally { if (current === generation) starting = false; if (opened && current === generation) renderNodes(); }
}
export function closeNodeModal() { opened = false; starting = false; generation++; filterGeneration++; stopPolling(); abortReads(); targetUID = ''; subscriptionFilter = ''; hideModal('nodeVeil'); }
function stopEgressWork() {
  if (opened) closeNodeModal();
  if (pollTimer || pollAbort) stopPolling();
  abortReads();
  pollGeneration++;
  trendGeneration++;
  trendHelper = null;
}
function leaveEgress() {
  stopEgressWork();
  nodes = []; bindings = []; accounts = []; nodePage = 1; accountPage = 1; tests = {}; status = {}; subscriptionFilter = '';
}
async function bindAccountNode(node) {
  const uid = targetUID, current = generation, filterEpoch = filterGeneration;
  binding = true; renderNodes(); $('nodeError').textContent = '';
  try {
    const signal = readAbort?.signal;
    await api('meta/accounts/' + encodeURIComponent(uid) + '/bind', {method:'POST',body:JSON.stringify({node}),signal});
    const data = await api(nodesPath(), {signal});
    if (!opened || current !== generation || filterEpoch !== filterGeneration) return;
    bindings = mergeFilteredBindings(bindings, data.bindings, data.nodes);
    nodes = data.nodes || [];
    if (!bindings.some(item => item.uid === uid && item.node === node)) throw new Error('绑定回读不一致');
    toast('账号出口已绑定并回读', 'ok'); renderAccounts();
  } catch (error) { if (opened && current === generation) $('nodeError').textContent = '绑定未确认：' + error.message; }
  finally { binding = false; if (opened && current === generation) renderNodes(); }
}
$('btnCloseNodes').onclick = closeNodeModal;
const openNodesButton = $('btnOpenNodes');
if (openNodesButton) openNodesButton.onclick = () => openNodeModal();
bindPager('nodePages', (_key, page) => { nodePage = page; renderNodes(); });
bindPager('egressPages', (_key, page) => { accountPage = page; renderAccounts(); });
$('egressAccounts').addEventListener('click', event => { const button = event.target.closest('[data-route-uid]'); if (button) openNodeModal(button.dataset.routeUid); });
$('nodeList').addEventListener('click', async event => {
  const test = event.target.closest('button[data-test-nodes]');
  if (test) { if (!test.disabled) await startNodeTests(); return; }
  const button = event.target.closest('button[data-bind-node]');
  if (!button || button.disabled || binding || !targetUID || !opened || !nodes.some(node => node.id === button.dataset.bindNode)) return;
  await bindAccountNode(button.dataset.bindNode);
});
document.addEventListener('panel:session', event => { if (!event.detail.authenticated) { if (opened) closeNodeModal(); nodes = []; bindings = []; accounts = []; } });
registerViewCleanup(stopEgressWork);
onViewHidden('egress', stopEgressWork);
registerPageCleanup(leaveEgress);
document.addEventListener('hashchange', () => { if (location.hash.slice(1) !== 'egress') stopEgressWork(); });
