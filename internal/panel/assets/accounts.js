import { renderAccounts } from './account-table.js';
import { bindAccountActions } from './account-actions.js';
import { applyOverviewCapabilities } from './capabilities.js';
import { api } from './api.js';
import { $, dur, toast } from './common.js';
import { reflectOverviewStats } from './overview.js';
export function reflectOverview(data) {
  reflectOverviewStats(data);
  applyOverviewCapabilities(data);
  $('demoNotice').hidden = data.demo !== true;
  $('navVer').textContent = data.version ? 'v' + String(data.version).replace(/^v/, '') : '本机';
  $('navState').textContent = data.healthy > 0 ? '服务正常' : data.total > 0 ? '暂无可用账号' : '等待添加账号';
  $('navPulse').className = 'pulse ' + (data.healthy > 0 ? 'ok' : 'warn');
  $('subMeta').textContent = Number.isFinite(data.uptime_sec) ? '已运行 ' + dur(data.uptime_sec) : '本机 · 密码保护';
  for (const [id, key] of [['sTotal','total'],['sHealthy','healthy'],['sCooling','cooling'],['sDisabled','disabled']]) $(id).textContent = data[key] ?? '—';
  renderAccounts(data.accounts || []);
}
export async function loadOverview(quiet = false) {
  try { const data = await api('overview'); reflectOverview(data); return data; }
  catch (error) { if (error.name !== 'AbortError' && !quiet) toast('账号读取失败：' + error.message, 'err'); throw error; }
}
bindAccountActions({refresh: () => loadOverview(true)});
