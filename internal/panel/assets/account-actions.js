import { $, toast } from './common.js';
import { api, session } from './api.js';
import { accountByUID, setAccountBusy } from './account-table.js';
import { openNodeModal } from './egress.js';
let busy = false, refresh = async () => {};
export function bindAccountActions(options) { refresh = options.refresh; }
$('accBody').addEventListener('click', async event => {
  const button = event.target.closest('button[data-a]');
  if (!button || busy || button.disabled) return;
  const {a: action, u: uid} = button.dataset, account = accountByUID(uid);
  if (!account) return;
  if (action === 'egress') { await openNodeModal(uid); return; }
  if (action !== 'toggle' && action !== 'remove') return;
  const disabled = !account.manual_disabled;
  if (action === 'remove' && !confirm('删除账号 ' + (account.nickname || uid) + '？此操作不会注销上游账号。')) return;
  busy = true; setAccountBusy(true);
  try {
    await api('accounts/' + encodeURIComponent(uid) + (action === 'remove' ? '/remove' : '/toggle_disabled'), {method: 'POST', body: JSON.stringify(action === 'remove' ? {} : {disabled})});
    await refresh(); toast(action === 'remove' ? '账号已删除' : disabled ? '已手动禁用' : '手动禁用已解除；系统保护仍单独生效', 'ok');
  } catch (error) { toast('操作未确认：' + error.message + '。请刷新核对状态。', 'err'); if (session.authenticated) await refresh().catch(() => {}); }
  finally { busy = false; setAccountBusy(false); }
});
