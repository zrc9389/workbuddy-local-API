import { esc, dur, parseAPITime, rateLimitRowsHtml, formatTokenCount, formatLatency, formatRate } from './common.js';
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
export function accountCard(account, busy = false) {
  const state = accountState(account), uid = esc(account.uid), token = account.token_usage || {};
  const balance = account.credits_total === -1 ? '不限量' : account.balance_known === true && account.credits != null ? esc(account.credits) + (account.credits_total > 0 ? ' / ' + esc(account.credits_total) : '') : '余额未知';
  const node = account.egress_node || account.node_name || '选择节点';
  return '<article class="account-card state-' + state.tone + '" data-account="' + uid + '"><div class="card-heading"><div><span class="eyebrow">' + (account.realm === 'global' ? 'GLOBAL' : 'CN') + (account.enterprise ? ' · ENTERPRISE' : '') + '</span><h3>' + esc(account.nickname || '未命名账号') + '</h3></div><span class="tag ' + state.tone + '">' + state.label + '</span></div><p class="account-uid mono">' + uid + '</p><ul class="state-reasons">' + state.reasons.map(reason => '<li>' + esc(reason) + '</li>').join('') + '</ul><div class="account-balance"><span>可用积分</span><strong>' + balance + '</strong></div><dl class="mini-metrics"><div><dt>请求</dt><dd>' + esc(token.request_count ?? '—') + '</dd></div><div><dt>Token</dt><dd>' + esc(formatTokenCount(token.total_tokens)) + '</dd></div><div><dt>延迟 / 速率</dt><dd>' + esc(formatLatency(token.last_latency_ms)) + ' / ' + esc(formatRate(token.last_tokens_per_second)) + '</dd></div></dl>' + rateLimitRowsHtml(account.rate_limited_models, Date.now()) + '<div class="card-actions"><button class="egress-badge" data-a="egress" data-u="' + uid + '"' + (busy ? ' disabled' : '') + '>出口 · ' + esc(node) + ' ↗</button><div class="action-pair"><button data-a="toggle" data-u="' + uid + '" aria-pressed="' + !!account.manual_disabled + '"' + (busy ? ' disabled' : '') + '>' + (account.manual_disabled ? '启用' : '禁用') + '</button><button class="danger ghost" data-a="remove" data-u="' + uid + '"' + (busy ? ' disabled' : '') + '>删除</button></div></div></article>';
}
export function renderAccountRows(list, busy = false) {
  document.getElementById('accBody').innerHTML = list.map(account => accountCard(account, busy)).join('') || '<div class="empty"><strong>账号池还是空的</strong><p>添加账号后，状态与出口会显示在这里。</p></div>';
}
