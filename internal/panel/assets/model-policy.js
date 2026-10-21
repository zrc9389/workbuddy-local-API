import { $, esc, toast } from './common.js';
import { api } from './api.js';
let policies = null, busy = false, redraw = () => {};
export async function loadModelPolicy() {
  try { const data = await api('model_policy'); policies = data.models || null; }
  catch { policies = null; }
  return policies;
}
export function policyReady() { return policies != null; }
export function modelDisabled(id) { return !!(policies && policies[id]?.disabled); }
export function displayContext(model) { return policies?.[model.id]?.context_length || model.context_length; }
// 启用优先、禁用置底；组内保持接口原顺序，策略未读取时完全不重排。
export function sortModelsByPolicy(list, table = policies) {
  const rows = Array.isArray(list) ? list : [];
  if (!table) return [...rows];
  return rows.map((model,index)=>({model,index}))
    .sort((a,b)=>((table[a.model.id]?.disabled ? 1 : 0) - (table[b.model.id]?.disabled ? 1 : 0)) || a.index - b.index)
    .map(entry=>entry.model);
}
// 卡片右上角唯一开关：role=switch，checked 表示启用。
export function modelPolicySwitch(id) {
  if (!policies) return '<button type="button" class="model-switch unknown" role="switch" aria-checked="false" aria-label="' + esc(id) + ' 策略未读取" title="策略未读取" disabled><i></i></button>';
  const disabled = !!policies[id]?.disabled;
  return '<button type="button" class="model-switch' + (disabled ? ' off' : '') + '" role="switch" aria-checked="' + (!disabled) + '" aria-label="' + esc(id) + (disabled ? ' 已禁用，点击启用' : ' 已启用，点击禁用') + '" title="' + (disabled ? '已禁用，点击启用' : '已启用，点击禁用') + '" data-model-toggle="' + esc(id) + '"' + (busy ? ' disabled' : '') + '><i></i></button>';
}
async function save(id, patch) {
  if (busy || !policies) return false;
  busy = true; redraw();
  try {
    // Read current policy before patching so an enablement change preserves the display-only context override.
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
    const button = event.target.closest('button[data-model-toggle]'); if (!button || !policies || busy) return;
    const id = button.dataset.modelToggle, disabled = !policies[id]?.disabled;
    if (!confirm((disabled ? '禁用后阻止聊天调用并从公开列表移除。确认禁用 ' : '启用后允许聊天调用。确认启用 ') + id + '？')) return;
    try { if (await save(id,{disabled})) toast('模型启用状态已更新并回读','ok'); }
    catch (error) { toast('模型策略未确认：' + error.message + '，请刷新模型页核实','err'); }
  });
}
document.addEventListener('panel:session', event => { if (!event.detail.authenticated) { policies = null; busy = false; } });
