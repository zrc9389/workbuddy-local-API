import { showModal, hideModal } from './modals.js';
import { $, esc, toast } from './common.js';
import { api } from './api.js';
let policies = null, busy = false, redraw = () => {}, editing = null;
export async function loadModelPolicy() {
  try { const data = await api('model_policy'); policies = data.models || null; }
  catch { policies = null; }
  return policies;
}
export function displayContext(model) { return policies?.[model.id]?.context_length || model.context_length; }
export function modelPolicyCell(id) {
  if (!policies) return '<p class="note">策略未读取</p>';
  const policy = policies[id] || {};
  const disabled = busy ? ' disabled' : '';
  return '<div class="model-policy-actions"><button class="xs ' + (policy.disabled ? '' : 'primary') + '" data-model-toggle="' + esc(id) + '"' + disabled + '>' + (policy.disabled ? '已禁用 · 启用' : '已启用 · 禁用') + '</button>' +
    '<button class="xs" data-model-context="' + esc(id) + '"' + disabled + '>上下文展示</button></div>' + (policy.context_length ? '<div class="note">显示覆盖 ' + esc(policy.context_length) + ' tokens · 不改变上游</div>' : '');
}
export function openContextEditor(id) {
  if (!policies || busy) return;
  editing = id; $('modelContextName').textContent = id;
  $('modelContextValue').value = String(policies[id]?.context_length || 0);
  $('modelContextError').textContent = ''; showModal('modelContextVeil'); $('modelContextValue').focus();
}
async function save(id, patch) {
  if (busy || !policies) return false;
  busy = true; redraw();
  try {
    // Read current policy before patching so a context-only edit preserves enablement.
    const current = (await api('model_policy')).models?.[id] || {};
    await api('model_policy', {method:'POST',body:JSON.stringify({id,disabled:!!current.disabled,context_length:current.context_length || 0,...patch})});
    policies = (await api('model_policy')).models || null;
    if (!policies) throw new Error('策略回读失败');
    return true;
  } catch (error) { policies = null; throw error; }
  finally { busy = false; redraw(); }
}
export function bindModelPolicy(onChange) {
  redraw = onChange;
  $('mdBody').addEventListener('click', async event => {
    const button = event.target.closest('button[data-model-toggle],button[data-model-context]'); if (!button || !policies || busy) return;
    if (button.dataset.modelContext) { openContextEditor(button.dataset.modelContext); return; }
    const id = button.dataset.modelToggle, disabled = !policies[id]?.disabled;
    if (!confirm((disabled ? '禁用后阻止聊天调用并从公开列表移除。确认禁用 ' : '启用后允许聊天调用。确认启用 ') + id + '？')) return;
    try { if (await save(id,{disabled})) toast('模型启用状态已更新并回读','ok'); }
    catch (error) { toast('模型策略未确认：' + error.message + '，请刷新模型页核实','err'); }
  });
  $('btnModelContextCancel').onclick = () => { if (!busy) { editing = null; hideModal('modelContextVeil'); } };
  $('modelContextForm').onsubmit = async event => {
    event.preventDefault(); if (!editing || busy) return;
    const raw = $('modelContextValue').value.trim(), value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 0) { $('modelContextError').textContent = '请输入非负整数；0 表示恢复上游展示值。'; return; }
    $('btnModelContextSave').disabled = true;
    try { if (await save(editing,{context_length:value})) { editing = null; hideModal('modelContextVeil'); toast('上下文展示已更新；未改变上游真实限制','ok'); } }
    catch (error) { $('modelContextError').textContent = '保存或回读失败：' + error.message + '。请重新获取模型策略后核对。'; }
    finally { $('btnModelContextSave').disabled = false; }
  };
}

document.addEventListener('panel:session', event => { if (!event.detail.authenticated) { policies = null; editing = null; $('modelContextVeil').classList.remove('on'); } });
