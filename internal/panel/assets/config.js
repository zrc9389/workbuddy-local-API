import { $, esc, toast } from './common.js';
import { api } from './api.js';
let subscriptions = [];
export async function loadConfig() {
  const title = $('ttl');
  if (title) title.textContent = '系统设置';
  await loadSubscriptions();
}

function note(text, error = false) {
  const el = globalThis.document?.getElementById('subscriptionNote');
  if (el) { el.textContent = text; el.dataset.tone = error ? 'err' : 'ok'; }
}

function subscriptionMeta(subscription) {
  const parts = [];
  parts.push(subscription.enabled ? '已启用' : '已停用');
  parts.push((subscription.node_count ?? 0) + ' 节点');
  if (subscription.bindings) parts.push((subscription.bindings) + ' 个账号绑定');
  if (subscription.last_error) parts.push('最近错误：' + subscription.last_error);
  return parts.join(' · ');
}

function subscriptionRow(subscription) {
  const id = subscription.id || '';
  const toggleLabel = subscription.enabled ? '停用' : '启用';
  return '<article class="subscription-row" data-subscription-id="' + esc(id) + '">' +
    '<div class="subscription-copy"><strong>' + esc(subscription.name || id) + '</strong>' +
    '<p class="hint">' + esc(subscriptionMeta(subscription)) + '</p></div>' +
    '<div class="subscription-actions">' +
    '<button type="button" data-subscription-toggle="' + esc(id) + '" data-enabled="' + (!subscription.enabled) + '">' + toggleLabel + '</button>' +
    '<button type="button" data-subscription-rename="' + esc(id) + '">改名</button>' +
    '<button type="button" data-subscription-refresh="' + esc(id) + '">刷新</button>' +
    '<button type="button" data-subscription-reveal="' + esc(id) + '"' + (subscription.has_url ? '' : ' disabled') + '>查看地址</button>' +
    '<button type="button" class="ghost" data-subscription-delete="' + esc(id) + '"' + (subscription.bindings ? ' disabled title="先解除账号绑定"' : '') + '>删除</button>' +
    '</div><p class="hint subscription-url" hidden></p></article>';
}

export function subscriptionRowsHTML(list, emptyText = '尚无订阅。导入后会在此集中管理。') {
  return (list || []).map(subscriptionRow).join('') || '<div class="empty">' + esc(emptyText) + '</div>';
}

function renderSubscriptions() {
  const host = globalThis.document?.getElementById('subscriptionList');
  if (host) host.innerHTML = subscriptionRowsHTML(subscriptions);
  const count = globalThis.document?.getElementById('subscriptionCount');
  if (count) count.textContent = subscriptions.length ? subscriptions.length + ' 个订阅' : '尚无订阅';
}

export async function loadSubscriptions() {
  try {
    const result = await api('meta/subscriptions');
    subscriptions = Array.isArray(result.subscriptions) ? result.subscriptions : [];
    renderSubscriptions();
    return subscriptions;
  } catch (error) {
    if (error.name !== 'AbortError') note('订阅列表读取失败：' + error.message, true);
    return subscriptions;
  }
}

async function mutateSubscription(body, successText) {
  const result = await api('meta/subscriptions', {method:'POST', body:JSON.stringify(body)});
  await loadSubscriptions();
  if (successText) note(successText);
  return result;
}

export async function subscriptionAction(action, id, extra = {}) {
  const subscription = subscriptions.find(item => item.id === id);
  if (!subscription) return null;
  if (action === 'toggle') {
    const enabled = !subscription.enabled;
    return mutateSubscription({action:'toggle', id, enabled}, enabled ? '订阅已启用。' : '订阅已停用。');
  }
  if (action === 'rename') {
    const asked = globalThis.prompt?.('新的订阅名称（最多 64 个字符）', subscription.name);
    const name = typeof asked === 'string' ? asked.trim() : '';
    if (!name || name === subscription.name) return null;
    return mutateSubscription({action:'rename', id, name}, '订阅名称已更新。');
  }
  if (action === 'refresh') {
    note('正在刷新订阅，请稍候…');
    const result = await api('meta/subscriptions', {method:'POST', body:JSON.stringify({action:'refresh', id})});
    await loadSubscriptions();
    note('订阅已刷新，共 ' + (result.nodes ?? '—') + ' 个节点。');
    return result;
  }
  if (action === 'delete') {
    if (!globalThis.confirm?.('删除该订阅？已绑定的账号必须先解除绑定。')) return null;
    return mutateSubscription({action:'delete', id}, '订阅已删除。');
  }
  if (action === 'reveal') {
    const result = await api('meta/subscriptions?id=' + encodeURIComponent(id) + '&reveal=1');
    return result?.url || '';
  }
  return null;
}

$('subscriptionForm').onsubmit = async event => {
  event.preventDefault(); const input = $('subscriptionURL'), button = $('btnSubscriptionSave');
  const raw = input.value.trim();
  try { const url = new URL(raw); if (!['https:','http:'].includes(url.protocol)) throw new Error(); }
  catch { toast('请输入有效的 HTTP(S) 订阅地址', 'err'); return; }
  button.disabled = true; note('正在由本机后端导入订阅…');
  try { const nameInput = globalThis.document?.getElementById('subscriptionName'); const body = {url:raw}; if (nameInput?.value.trim()) body.name = nameInput.value.trim(); const result = await api('meta/subscriptions', {method:'POST',body:JSON.stringify(body)}); input.value = ''; if (nameInput) nameInput.value = ''; await loadSubscriptions(); note('已导入 ' + (result.nodes ?? '—') + ' 个节点；订阅地址仅保存在后端。'); }
  catch (error) { note('订阅导入失败：' + error.message, true); }
  finally { button.disabled = false; }
};

const subscriptionList = globalThis.document?.getElementById('subscriptionList');
if (subscriptionList) subscriptionList.addEventListener('click', async event => {
  const button = event.target.closest('button[data-subscription-toggle],button[data-subscription-rename],button[data-subscription-refresh],button[data-subscription-reveal],button[data-subscription-delete]');
  if (!button || button.disabled) return;
  const id = button.dataset.subscriptionToggle || button.dataset.subscriptionRename || button.dataset.subscriptionRefresh || button.dataset.subscriptionReveal || button.dataset.subscriptionDelete;
  const action = button.dataset.subscriptionToggle ? 'toggle' : button.dataset.subscriptionRename ? 'rename' : button.dataset.subscriptionRefresh ? 'refresh' : button.dataset.subscriptionReveal ? 'reveal' : 'delete';
  button.disabled = true;
  try {
    const result = await subscriptionAction(action, id);
    if (action === 'reveal') {
      const row = button.closest('.subscription-row'), target = row?.querySelector('.subscription-url');
      if (target) { target.textContent = result || '订阅地址不可用'; target.hidden = !result; }
    }
  } catch (error) { note(error.status === 409 ? '该订阅仍有账号绑定，请先解除绑定。' : '订阅操作失败：' + error.message, true); }
  finally { button.disabled = false; }
});
