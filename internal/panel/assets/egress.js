import { $, ago, esc, toast } from './common.js';
import { api, session } from './api.js';
import { paginate, pagerHTML, bindPager } from './pagination.js';
import { registerPageCleanup, registerViewCleanup, onViewHidden, visibleInterval, clearVisibleInterval } from './lifecycle.js';
import { showModal, hideModal } from './modals.js';
let nodes = [], bindings = [], accounts = [], subscriptions = [], nodePage = 1, mainPage = 1, accountPage = 1, targetUID = '', opened = false, starting = false, binding = false, refreshing = false, polling = false, pollTimer = null, pollDeadline = 0, pollAbort = null, readAbort = null, pollGeneration = 0, generation = 0, trendGeneration = 0, status = {}, tests = {}, trendHelper = null, subscriptionFilter = '', mainFilter = '', filterGeneration = 0, subscriptionsOpen = false, detailGeneration = 0, pendingNode = '';
const CACHE_TTL_MS = 48 * 60 * 60 * 1000;
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
function displayNodeName(node) {
  const name = String(node?.name || node?.id || '');
  const stripped = name.replace(/^sub-[^/]+\//i, '').trim();
  return stripped || String(node?.id || '节点');
}
function providerLabel(node) {
  const source = subscriptions.find(item => item.id === node?.provider);
  return source?.name || node?.provider_name || '订阅';
}
function accountSelect() { return document.getElementById('egressAccountSelect'); }
function currentNodeUID() { return targetUID || String(accountSelect()?.value || ''); }
function boundNodesFor(uid) {
  return new Set(bindings.filter(item => !uid || item.uid === uid).map(item => item.node));
}
function overviewCacheText() {
  const stamps = subscriptions.filter(item => item.enabled !== false && item.last_refresh_at).map(item => ({ iso: item.last_refresh_at, ms: Date.parse(item.last_refresh_at) })).filter(item => Number.isFinite(item.ms));
  if (!stamps.length) return '尚未刷新';
  const latest = stamps.reduce((left, right) => right.ms > left.ms ? right : left);
  const age = Math.max(0, Date.now() - latest.ms);
  return age >= CACHE_TTL_MS ? '缓存已过期（>48h，' + ago(latest.iso) + '刷新）' : '缓存 ' + ago(latest.iso) + '刷新';
}
function renderOverview() {
  const text = $('egressOverviewText');
  if (!text) return;
  const enabled = subscriptions.filter(item => item.enabled !== false).length;
  const count = subscriptions.reduce((sum, item) => sum + (Number(item.node_count) || 0), 0) || nodes.length;
  text.textContent = subscriptions.length ? subscriptions.length + ' 个订阅 · ' + enabled + ' 启用 · ' + count + ' 节点 · ' + overviewCacheText() : '尚无订阅 · 0 节点';
}
function renderAccountSelect() {
  const select = accountSelect();
  if (!select) return;
  const current = String(select.value || '');
  select.innerHTML = '<option value="">选择账号</option>' + accounts.map(account => '<option value="' + esc(account.uid) + '">' + esc(account.nickname || account.uid) + '</option>').join('');
  select.value = accounts.some(account => account.uid === current) ? current : '';
}
function renderMainNodes() {
  const host = $('egressNodeGrid');
  if (!host) return;
  const page = paginate(nodes, mainPage, 60); mainPage = page.page;
  const uid = currentNodeUID(), selected = boundNodesFor(uid);
  host.innerHTML = page.rows.map(node => {
    const latency = nodeLatency(node), name = displayNodeName(node), isBound = selected.has(node.id);
    return '<button type="button" class="egress-node-card" data-node-id="' + esc(node.id) + '" aria-pressed="' + isBound + '" title="' + esc(name) + '"><span class="egress-node-check" aria-hidden="' + !isBound + '">✓</span><strong>' + esc(name) + '</strong><span class="egress-node-source">' + esc(providerLabel(node)) + '</span><span class="tag ' + latency.tone + '">' + esc(latency.text) + '</span>' + (isBound ? '<span class="sr-only">当前绑定</span>' : '') + '</button>';
  }).join('') || '<div class="empty">尚无节点</div>';
  $('egressNodePager').innerHTML = pagerHTML(page, 'egress-nodes');
  $('egressNodeCount').textContent = nodes.length ? '显示 ' + nodes.length + ' 个节点' : '';
  const statusEl = $('egressNodeStatus');
  if (statusEl) statusEl.textContent = tests.running ? testText(tests) : '';
}
function testText(data) {
  if (data.cancelled) return '测试已取消';
  if (data.running) return '测试中 · ' + (data.completed ?? 0) + ' / ' + (data.total ?? '—');
  return data.id ? '已完成 ' + (data.completed ?? 0) + ' / ' + (data.total ?? '—') + ' · 失败 ' + (data.failed ?? 0) : '尚未开始测试';
}
function testActionHTML() {
  const label = tests.running ? '测试进行中…' : tests.id ? '重新测试延迟' : '测试延迟';
  return '<div class="node-test-bar"><button type="button" class="primary" data-test-nodes aria-label="测试节点延迟"' + (starting || tests.running ? ' disabled' : '') + '>' + label + '</button></div>';
}
function renderNodes() {
  const page = paginate(nodes, nodePage, 16); nodePage = page.page;
  const current = bindings.find(item => item.uid === targetUID)?.node;
  $('nodeStatus').textContent = testText(tests);
  $('nodeList').innerHTML = testActionHTML() + (page.rows.map(node => {
    const latency = nodeLatency(node), selected = current === node.id, name = displayNodeName(node);
    const body = (selected ? '<span class="node-check" aria-hidden="false">✓</span>' : '') + '<div class="node-title"><strong>' + esc(name) + '</strong><span class="tag ' + latency.tone + '">' + esc(latency.text) + '</span></div><p class="hint">' + esc(node.type || '代理节点') + '</p>' + nodeTrendHTML(node.history) + (selected ? '<span class="sr-only">当前账号出口</span>' : '');
    return targetUID ? '<button type="button" class="node-card" data-bind-node="' + esc(node.id) + '" aria-pressed="' + selected + '"' + (binding || selected ? ' disabled' : '') + '>' + body + '</button>' : '<article class="node-card">' + body + '</article>';
  }).join('') || '<div class="empty">尚无节点</div>');
  $('nodePages').innerHTML = pagerHTML(page, 'nodes');
}
function renderAccounts() {
  const host = $('egressAccounts');
  if (!host) return;
  const page = paginate(accounts, accountPage, 24); accountPage = page.page;
  host.innerHTML = page.rows.map(account => {
    const bound = bindings.find(item => item.uid === account.uid), node = nodes.find(item => item.id === bound?.node), latency = node ? nodeLatency(node) : null;
    return '<article class="route-card"><div><strong>' + esc(account.nickname || account.uid) + '</strong><p class="mono hint">' + esc(account.uid) + '</p></div><button class="egress-badge" data-route-uid="' + esc(account.uid) + '">' + esc(node ? displayNodeName(node) : (bound ? displayNodeName({ id: bound.node }) : '未绑定节点')) + (latency ? ' · ' + esc(latency.text) : '') + ' ↗</button></article>';
  }).join('') || '<div class="empty">尚无账号</div>';
  $('egressPages').innerHTML = pagerHTML(page, 'routes');
  renderAccountSelect();
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
  select.value = '';
}
function renderSubscriptionFilter(list) {
  const select = filterSelect();
  if (!select) return;
  bindFilterSelect(select);
  const options = ['<option value="">全部订阅</option>'], seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const id = item && typeof item.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const count = Number.isFinite(Number(item.node_count)) ? Number(item.node_count) : 0;
    options.push('<option value="' + esc(id) + '">' + esc(item.name || id) + '（' + count + ' 个节点）</option>');
  }
  select.innerHTML = options.join('');
  select.value = subscriptionFilter && seen.has(subscriptionFilter) ? subscriptionFilter : '';
  subscriptionFilter = select.value || '';
}
async function loadSubscriptionList(signal) {
  bindFilterSelect(filterSelect());
  try {
    const result = await api('meta/subscriptions', { signal });
    // The list read is authoritative. Only aborts keep the last known rows so a
    // stale session can never keep showing an earlier subscription set.
    subscriptions = Array.isArray(result?.subscriptions) ? result.subscriptions : [];
  } catch (error) {
    if (error.name === 'AbortError') return subscriptions;
    subscriptions = [];
  }
  renderSubscriptionFilter(subscriptions);
  renderOverview();
  return subscriptions;
}
// The filtered response only carries bindings for the nodes it returns. Keep the
// bindings of nodes outside the filter so account cards stay truthful.
function mergeFilteredBindings(previous, next, visibleNodes) {
  const visible = new Set((visibleNodes || []).map(node => node.id));
  return previous.filter(item => !visible.has(item.node)).concat(next || []);
}
function nodesPath(filter = subscriptionFilter) {
  return filter ? 'meta/nodes?subscription_id=' + encodeURIComponent(filter) : 'meta/nodes';
}
function nodeErrorElement() { return opened ? $('nodeError') : $('egressNodeError'); }
function filterOwner() {
  // The filter element is the main page control; when the node modal is open it
  // becomes the modal's filter. Closing the modal restores the main filter value.
  return opened ? 'modal' : 'main';
}
async function applyNodeFilter() {
  const select = filterSelect();
  if (!select || !session.authenticated) return;
  const value = String(select.value || '');
  if (value === subscriptionFilter) return;
  const owner = filterOwner();
  subscriptionFilter = value; mainPage = 1; nodePage = 1;
  // Rapid switches must not let an older response overwrite the newer filter.
  const current = generation, filterEpoch = ++filterGeneration, signal = readAbort?.signal;
  const errorEl = nodeErrorElement();
  if (errorEl) errorEl.textContent = '';
  try {
    const data = await api(nodesPath(), { signal });
    if (current !== generation || filterEpoch !== filterGeneration) return;
    bindings = mergeFilteredBindings(bindings, data.bindings, data.nodes);
    nodes = data.nodes || [];
    if (owner === 'main') mainFilter = value;
    if (owner === 'modal') renderNodes(); else renderMainNodes();
  } catch (error) {
    if (error.name === 'AbortError' || current !== generation || filterEpoch !== filterGeneration) return;
    if (errorEl) errorEl.textContent = '节点筛选失败：' + error.message;
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
  const signal = beginReads();
  const current = generation;
  try {
    const [core, data, stats, job, overview] = await Promise.all([api('meta/status', {signal}), api(nodesPath(mainFilter), {signal}), api('meta/stats', {signal}), api('meta/tests', {signal}), api('overview', {signal})]);
    if (current !== generation) return;
    // The open node modal owns its view; a background refresh must not replace it.
    if (!opened) { nodes = data.nodes || []; bindings = data.bindings || []; }
    accounts = overview.accounts || [];
    reflectMeta(core, stats, job); renderAccounts(); renderMainNodes();
  } catch (error) {
    if (error.name === 'AbortError' || current !== generation) return;
    $('egressError').textContent = '出口状态读取失败：' + error.message; $('egressError').hidden = false;
    reflectMeta({available:false}, {}, {}); $('metaState').textContent = '连接未确认';
  }
  await loadSubscriptionList(signal);
  renderOverview();
}
async function reloadSubscriptionsAndNodes(signal = readAbort?.signal) {
  const current = generation;
  await loadSubscriptionList(signal);
  try {
    const data = await api(nodesPath(mainFilter), { signal });
    if (current !== generation) return;
    bindings = mergeFilteredBindings(bindings, data.bindings, data.nodes); nodes = data.nodes || []; mainPage = 1;
    renderMainNodes(); renderAccounts(); if (opened) renderNodes();
  } catch (error) {
    if (error.name !== 'AbortError' && current === generation) $('egressNodeError').textContent = '节点读取失败：' + error.message;
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
  if (pollDeadline && Date.now() > pollDeadline) { stopPolling(); $('nodeError').textContent = '已停止等待测试结果。'; return; }
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
async function loadTrendHelper() {
  if (trendHelper) return;
  const current = trendGeneration;
  try { trendHelper = await import('/panel/vendor/latency-trend.js'); if (opened) renderNodes(); }
  catch { /* Optional visualization unavailable; numeric measurements remain authoritative. */ }
  if (current !== trendGeneration) trendHelper = null;
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
  $('nodeTitle').textContent = uid ? '选择账号出口' : '节点延迟测试';
  $('nodeError').textContent = ''; $('nodeStatus').textContent = '正在读取节点与测试记录…'; $('nodeList').innerHTML = '<div class="empty">正在读取节点…</div>'; $('nodePages').innerHTML = '';
  // Opening the account-picker modal must not discard a filter the user has
  // already applied to the main egress grid.
  renderMainNodes();
  const signal = beginReads();
  showModal('nodeVeil');
  try {
    const [, job, data] = await Promise.all([loadSubscriptionList(signal), api('meta/tests', {signal}), api('meta/nodes', {signal})]);
    if (!opened || current !== generation) return;
    tests = job; nodes = data.nodes || []; bindings = data.bindings || []; renderNodes();
    if (nodes.some(node => (node.history || []).length >= 2)) loadTrendHelper();
  } catch (error) { if (error.name !== 'AbortError' && opened && current === generation) { $('nodeError').textContent = '节点读取失败：' + error.message; $('nodeStatus').textContent = '尚未读取节点'; $('nodeList').innerHTML = '<div class="empty">尚无节点</div>'; } }
  finally { if (current === generation) starting = false; if (opened && current === generation) renderNodes(); }
}
export function closeNodeModal() { opened = false; starting = false; generation++; filterGeneration++; stopPolling(); abortReads(); targetUID = ''; subscriptionFilter = ''; resetFilterSelect(); hideModal('nodeVeil'); renderMainNodes(); }
function closeSubscriptionDetails() {
  subscriptionsOpen = false; detailGeneration++;
  const label = $('subscriptionRevealLabel'), url = $('subscriptionRevealURL'), reveal = $('subscriptionReveal');
  if (label) label.textContent = '';
  if (url) url.textContent = '';
  if (reveal) reveal.hidden = true;
  const list = $('subscriptionDetailList'); if (list) list.innerHTML = '';
  const note = $('subscriptionDetailNote'); if (note) note.textContent = '';
  hideModal('subscriptionVeil');
}
function renderSubscriptionDetails() {
  const host = $('subscriptionDetailList');
  if (!host) return;
  host.innerHTML = subscriptions.map(item => {
    const enabled = item.enabled !== false, id = String(item.id || '');
    return '<article class="subscription-detail-row"><div class="subscription-detail-main"><strong>' + esc(item.name || id) + '</strong><span class="mono">' + esc(item.url_preview || (item.has_url ? '地址已保存' : '无地址')) + '</span></div><dl class="subscription-detail-facts"><div><dt>节点</dt><dd>' + esc(item.node_count ?? 0) + '</dd></div><div><dt>最近刷新</dt><dd>' + esc(item.last_refresh_at ? ago(item.last_refresh_at) : '未刷新') + '</dd></div></dl><div class="subscription-detail-actions"><button type="button" data-subscription-toggle="' + esc(id) + '" aria-pressed="' + enabled + '">' + (enabled ? '已启用' : '已停用') + '</button><button type="button" data-subscription-reveal="' + esc(id) + '">查看地址</button><button type="button" class="danger" data-subscription-delete="' + esc(id) + '">删除</button></div></article>';
  }).join('') || '<div class="empty">尚无订阅</div>';
}
async function openSubscriptionDetails() {
  if (!session.authenticated) return;
  subscriptionsOpen = true; detailGeneration++;
  const epoch = detailGeneration;
  $('subscriptionDetailNote').textContent = '';
  $('subscriptionDetailList').innerHTML = '<div class="empty">正在读取订阅…</div>';
  showModal('subscriptionVeil');
  await loadSubscriptionList(readAbort?.signal);
  if (!subscriptionsOpen || epoch !== detailGeneration) return;
  renderSubscriptionDetails();
}
async function revealSubscription(id, epoch) {
  const label = $('subscriptionRevealLabel'), url = $('subscriptionRevealURL'), reveal = $('subscriptionReveal'), note = $('subscriptionDetailNote');
  label.textContent = ''; url.textContent = ''; reveal.hidden = true; note.textContent = '';
  try {
    const data = await api('meta/subscriptions?id=' + encodeURIComponent(id) + '&reveal=1', { signal: readAbort?.signal });
    if (!subscriptionsOpen || epoch !== detailGeneration) return;
    const item = subscriptions.find(row => row.id === id);
    label.textContent = item?.name || id;
    url.textContent = data.url || '';
    reveal.hidden = false;
  } catch (error) {
    if (error.name !== 'AbortError' && subscriptionsOpen && epoch === detailGeneration) note.textContent = '地址读取失败：' + error.message;
  }
}
async function subscriptionDetailAction(action, id) {
  const item = subscriptions.find(row => row.id === id);
  if (!item) return;
  if (action === 'delete' && !confirm('删除订阅 ' + (item.name || id) + '？')) return;
  const note = $('subscriptionDetailNote'); note.textContent = '';
  try {
    const body = action === 'toggle' ? {action:'toggle', id, enabled: item.enabled === false} : {action:'delete', id};
    await api('meta/subscriptions', {method:'POST', body: JSON.stringify(body), signal: readAbort?.signal});
    $('subscriptionRevealLabel').textContent = ''; $('subscriptionRevealURL').textContent = ''; $('subscriptionReveal').hidden = true;
    await reloadSubscriptionsAndNodes();
    if (subscriptionsOpen) renderSubscriptionDetails();
  } catch (error) {
    if (error.name !== 'AbortError') note.textContent = (action === 'delete' ? '删除失败：' : '状态更新失败：') + error.message;
  }
}
async function importSubscription(event) {
  event.preventDefault();
  const urlInput = $('egressSubscriptionURL'), nameInput = $('egressSubscriptionName'), note = $('egressSubscriptionNote');
  const raw = String(urlInput.value || '').trim(), name = String(nameInput.value || '').trim();
  let parsed;
  try { parsed = new URL(raw); } catch { note.textContent = '请输入有效的 HTTP(S) 订阅地址'; return; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { note.textContent = '订阅地址只支持 HTTP(S)'; return; }
  note.textContent = '正在导入…';
  try {
    const result = await api('meta/subscriptions', {method:'POST', body: JSON.stringify(name ? {url:raw, name} : {url:raw}), signal: readAbort?.signal});
    urlInput.value = ''; nameInput.value = '';
    $('egressSubscriptionForm').hidden = true;
    note.textContent = '已导入 ' + (result.nodes ?? 0) + ' 个节点';
    await reloadSubscriptionsAndNodes();
  } catch (error) {
    if (error.name !== 'AbortError') note.textContent = '导入失败：' + error.message;
  }
}
async function refreshNodes() {
  if (refreshing || !session.authenticated) return;
  refreshing = true;
  const button = $('btnRefreshNodes'), hint = $('egressRefreshHint');
  button.classList.add('refreshing');
  hint.textContent = '';
  try {
    const result = await refreshSubscriptionsOnce({signal: readAbort?.signal, timeoutMs: 8000});
    if (result.nodes.length) { nodes = result.nodes; mainPage = 1; renderMainNodes(); }
    await loadSubscriptionList(readAbort?.signal);
    if (result.failed.length) hint.textContent = result.failed.length + ' 个订阅刷新失败';
  } finally {
    refreshing = false;
    button.classList.remove('refreshing');
  }
}
async function bindAccountNode(node, uid = targetUID) {
  if (!uid || binding) return;
  const already = bindings.some(item => item.uid === uid && item.node === node);
  if (already) { pendingNode = ''; $('egressAccountHint').textContent = ''; return; }
  const current = generation, filterEpoch = filterGeneration;
  binding = true; renderNodes(); renderMainNodes(); const errorEl = nodeErrorElement(); if (errorEl) errorEl.textContent = '';
  try {
    const signal = readAbort?.signal;
    await api('meta/accounts/' + encodeURIComponent(uid) + '/bind', {method:'POST',body:JSON.stringify({node}),signal});
    const data = await api(nodesPath(), {signal});
    if (current !== generation || filterEpoch !== filterGeneration) return;
    bindings = mergeFilteredBindings(bindings, data.bindings, data.nodes);
    nodes = data.nodes || [];
    if (!bindings.some(item => item.uid === uid && item.node === node)) throw new Error('绑定回读不一致');
    toast('账号出口已绑定并回读', 'ok'); pendingNode = ''; $('egressAccountHint').textContent = ''; renderAccounts();
  } catch (error) { if (current === generation) { const target = nodeErrorElement(); if (target) target.textContent = '绑定未确认：' + error.message; } }
  finally { binding = false; if (current === generation) { renderNodes(); renderMainNodes(); } }
}
export async function refreshSubscriptionsOnce({ signal, timeoutMs = 8000 } = {}) {
  const failed = [], refreshed = [];
  let list = [];
  const startedAt = Date.now();
  const totalBudget = Math.min(12000, Math.max(4000, Number(timeoutMs) || 8000));
  try {
    const result = await api('meta/subscriptions', { signal });
    list = Array.isArray(result?.subscriptions) ? result.subscriptions.filter(item => item && item.id && item.enabled === true) : [];
  } catch (error) {
    return { ok: false, refreshed: 0, failed: [{id: 'subscriptions', error: error.name === 'AbortError' ? '已取消' : error.message}], nodes: [] };
  }
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    if (signal?.aborted) {
      for (const rest of list.slice(index)) failed.push({id: rest.id, error: '已取消'});
      break;
    }
    const remaining = totalBudget - (Date.now() - startedAt);
    if (remaining <= 0) { for (const rest of list.slice(index)) failed.push({id: rest.id, error: '总预算已用尽'}); break; }
    const controller = new AbortController(), onAbort = () => controller.abort();
    let timedOut = false;
    signal?.addEventListener('abort', onAbort, {once:true});
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1, Math.min(4000, Number(timeoutMs) || 8000, remaining)));
    try {
      await api('meta/subscriptions', {method:'POST', body: JSON.stringify({action:'refresh', id:item.id}), signal:controller.signal});
      refreshed.push(item.id);
    } catch (error) {
      const reason = timedOut ? '超时' : controller.signal.aborted ? '已取消' : error.message;
      failed.push({id:item.id, error:reason});
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    }
  }
  let nextNodes = [];
  try {
    const data = await api('meta/nodes', { signal });
    nextNodes = Array.isArray(data?.nodes) ? data.nodes : [];
  } catch (error) {
    failed.push({id:'nodes', error:error.name === 'AbortError' ? '已取消' : error.message});
  }
  return { ok: failed.length === 0, refreshed: refreshed.length, failed, nodes: nextNodes };
}
function stopEgressWork() {
  if (opened) closeNodeModal();
  if (subscriptionsOpen) closeSubscriptionDetails();
  if (pollTimer || pollAbort) stopPolling();
  abortReads();
  pollGeneration++;
  trendGeneration++;
  trendHelper = null;
}
function leaveEgress() {
  stopEgressWork();
  nodes = []; bindings = []; accounts = []; subscriptions = []; nodePage = 1; mainPage = 1; accountPage = 1; tests = {}; status = {}; subscriptionFilter = ''; pendingNode = '';
  const grid = $('egressNodeGrid'); if (grid) grid.innerHTML = '';
  const overview = $('egressOverviewText'); if (overview) overview.textContent = '尚无订阅 · 0 节点';
  const form = $('egressSubscriptionForm'); if (form) form.hidden = true;
  const bar = $('egressAccountBar'); if (bar) bar.hidden = true;
  renderSubscriptionFilter([]);
}
$('btnCloseNodes').onclick = closeNodeModal;
const openNodesButton = $('btnOpenNodes');
if (openNodesButton) openNodesButton.onclick = () => openNodeModal();
const importButton = $('btnEgressImport');
if (importButton) importButton.onclick = () => { const form = $('egressSubscriptionForm'); form.hidden = !form.hidden; $('egressSubscriptionNote').textContent = ''; if (!form.hidden) $('egressSubscriptionURL').focus?.(); };
const importCancel = $('btnEgressImportCancel');
if (importCancel) importCancel.onclick = () => { $('egressSubscriptionForm').hidden = true; $('egressSubscriptionNote').textContent = ''; };
if ($('egressSubscriptionForm')) $('egressSubscriptionForm').onsubmit = importSubscription;
if ($('btnRefreshNodes')) $('btnRefreshNodes').onclick = refreshNodes;
if ($('btnSubscriptionDetails')) $('btnSubscriptionDetails').onclick = openSubscriptionDetails;
if ($('btnCloseSubscriptions')) $('btnCloseSubscriptions').onclick = closeSubscriptionDetails;
bindPager('nodePages', (_key, page) => { nodePage = page; renderNodes(); });
bindPager('egressNodePager', (_key, page) => { mainPage = page; renderMainNodes(); });
bindPager('egressPages', (_key, page) => { accountPage = page; renderAccounts(); });
if ($('egressAccounts')) $('egressAccounts').addEventListener('click', event => { const button = event.target.closest('[data-route-uid]'); if (button) openNodeModal(button.dataset.routeUid); });
if ($('egressNodeGrid')) $('egressNodeGrid').addEventListener('click', async event => {
  const card = event.target.closest('[data-node-id]');
  if (!card || binding || !nodes.some(node => node.id === card.dataset.nodeId)) return;
  const uid = currentNodeUID();
  if (uid) { await bindAccountNode(card.dataset.nodeId, uid); return; }
  pendingNode = card.dataset.nodeId;
  const bar = $('egressAccountBar'), select = accountSelect();
  if (bar) bar.hidden = false;
  if (select) { renderAccountSelect(); select.focus?.(); }
  const node = nodes.find(item => item.id === pendingNode);
  $('egressAccountHint').textContent = '已选 ' + displayNodeName(node) + '，选择账号后绑定';
});
if (accountSelect()) accountSelect().addEventListener('change', async () => {
  const uid = String(accountSelect().value || '');
  $('egressAccountHint').textContent = uid && pendingNode ? '正在绑定…' : '';
  renderMainNodes();
  if (uid && pendingNode) await bindAccountNode(pendingNode, uid);
});
if ($('subscriptionDetailList')) $('subscriptionDetailList').addEventListener('click', async event => {
  const toggle = event.target.closest('[data-subscription-toggle]');
  const remove = event.target.closest('[data-subscription-delete]');
  const reveal = event.target.closest('[data-subscription-reveal]');
  const epoch = detailGeneration;
  if (toggle) await subscriptionDetailAction('toggle', toggle.dataset.subscriptionToggle);
  else if (remove) await subscriptionDetailAction('delete', remove.dataset.subscriptionDelete);
  else if (reveal) await revealSubscription(reveal.dataset.subscriptionReveal, epoch);
});
$('nodeList').addEventListener('click', async event => {
  const test = event.target.closest('button[data-test-nodes]');
  if (test) { if (!test.disabled) await startNodeTests(); return; }
  const button = event.target.closest('button[data-bind-node]');
  if (!button || button.disabled || binding || !targetUID || !opened || !nodes.some(node => node.id === button.dataset.bindNode)) return;
  await bindAccountNode(button.dataset.bindNode);
});
document.addEventListener('panel:session', event => { if (!event.detail.authenticated) { if (opened) closeNodeModal(); if (subscriptionsOpen) closeSubscriptionDetails(); nodes = []; bindings = []; accounts = []; subscriptions = []; } });
registerViewCleanup(stopEgressWork);
onViewHidden('egress', stopEgressWork);
registerPageCleanup(leaveEgress);
document.addEventListener('hashchange', () => { if (location.hash.slice(1) !== 'egress') stopEgressWork(); });
