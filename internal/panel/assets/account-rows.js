import { esc, dur, parseAPITime } from './common.js';
export function accountState(account, now = Date.now()) {
  const cooling = Math.max(Number(account.cool_remaining_sec) || 0, (parseAPITime(account.breaker_until) - now) / 1000, (parseAPITime(account.degrade_until) - now) / 1000, 0);
  const reasons = [];
  if (account.manual_disabled) reasons.push('手动禁用；只有手动启用才会解除');
  if (account.balance_blocked) reasons.push('余额保护：已知余额低于保护阈值');
  if (account.system_blocked || (account.disabled && !account.manual_disabled)) reasons.push('系统阻断：等待系统条件恢复');
  if (account.paused) reasons.push('旧状态：暂停选号');
  if (cooling > 0) reasons.push((account.cool_kind === 'hard_credit' ? '积分冷却' : '限流 / 熔断冷却') + '，剩余 ' + dur(cooling));
  if (account.reason) reasons.push(String(account.reason));
  const tone = account.manual_disabled ? 'bad' : (account.balance_blocked || account.system_blocked || account.disabled || account.paused || cooling > 0) ? 'warn' : 'ok';
  return { tone, label: tone === 'bad' ? '手动禁用' : tone === 'warn' ? '暂不可用' : '健康', reasons: reasons.length ? reasons : ['正常参与选号'], cooling };
}
function shortUID(value) {
  const text = String(value || '');
  return text.length > 8 ? '#' + text.slice(-6) : '';
}
export function accountCard(account, busy = false) {
  const state = accountState(account), uid = esc(account.uid);
  const balance = account.credits_total === -1 ? '不限量' : account.balance_known === true && account.credits != null ? esc(account.credits) + (account.credits_total > 0 ? ' / ' + esc(account.credits_total) : '') : '余额未知';
  const node = account.egress_node || account.node_name || '选择节点';
  const suffix = shortUID(account.uid);
  return '<article class="account-card state-' + state.tone + '" data-account="' + uid + '" data-state="' + state.tone + '"><div class="card-heading"><div class="account-title"><h3>' + esc(account.nickname || '未命名账号') + '</h3>' + (suffix ? '<span class="account-suffix mono">' + esc(suffix) + '</span>' : '') + '</div><span class="tag ' + state.tone + '" title="' + esc(state.reasons.join('；')) + '">' + state.label + '</span></div><div class="account-balance"><span>可用积分</span><strong>' + balance + '</strong></div><div class="card-actions"><span class="egress-current" title="当前出口：' + esc(node) + '">' + esc(node) + '</span><div class="action-pair"><button class="egress-badge" data-a="egress" data-u="' + uid + '"' + (busy ? ' disabled' : '') + '>出口</button><button data-a="toggle" data-u="' + uid + '" aria-pressed="' + !!account.manual_disabled + '"' + (busy ? ' disabled' : '') + '>' + (account.manual_disabled ? '启用' : '禁用') + '</button><button class="danger ghost" data-a="remove" data-u="' + uid + '"' + (busy ? ' disabled' : '') + '>删除</button></div></div></article>';
}
export function renderAccountRows(list, busy = false) {
  document.getElementById('accBody').innerHTML = list.map(account => accountCard(account, busy)).join('') || '<div class="empty"><strong>账号池还是空的</strong><p>添加账号后，状态与出口会显示在这里。</p></div>';
}
