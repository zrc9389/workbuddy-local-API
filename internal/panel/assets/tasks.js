import { $, esc, toast } from './common.js';
import { api } from './api.js';
import { showModal, hideModal } from './modals.js';
const JOBS = [['token','令牌保活'],['checkin','每日签到'],['activity','活跃上报'],['travel','旅行巡检']];
const labels = {pending:'等待',running:'执行中',done:'已完成',failed:'失败',cancelled:'已取消',skipped:'已跳过'};
let snapshot = {running:false,steps:[]}, starting = false;
function lastRunText(data) {
  if (!data.last_run_at) return '上次执行：尚无执行记录';
  return '上次执行：' + data.last_run_at + ' · 结果：' + (data.last_result || 'pending');
}
export function maintenanceMarkup(data) {
  return JOBS.map(([name, title], index) => {
    const step = (data.steps || []).find(item => item.name === name), state = step?.state || 'pending';
    const accounts = step?.accounts || [], failed = accounts.filter(account => account.state === 'failed');
    const total = step?.total ?? accounts.length;
    const completed = step?.completed ?? accounts.filter(account => account.state === 'done').length;
    const failedCount = step?.failed ?? failed.length;
    const skipped = step?.skipped ?? accounts.filter(account => account.state === 'skipped').length;
    const settled = completed + failedCount + skipped;
    const percent = total ? Math.min(100, settled / total * 100) : state === 'done' ? 100 : 0;
    const failureButton = failedCount ? '<button class="failure-link" type="button" data-failures="' + esc(name) + '" aria-controls="taskFailureVeil">查看 ' + failedCount + ' 项失败</button>' : '';
    return '<article class="job-card" data-state="' + esc(state) + '"><div class="card-heading"><div><span class="eyebrow">0' + (index + 1) + ' / MAINTENANCE</span><h3>' + title + '</h3></div><span class="tag ' + (state === 'done' ? 'ok' : state === 'failed' ? 'bad' : 'warn') + '">' + (labels[state] || esc(state)) + '</span></div><p class="job-last hint">' + esc(lastRunText(data)) + '</p><div class="progress ' + (failedCount ? 'has-failures' : '') + '" role="progressbar" aria-label="' + title + '进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(percent) + '"><i style="width:' + percent + '%"></i></div><div class="job-summary"><span>完成 ' + completed + ' / ' + total + '</span><span class="failure-count" data-state="' + (failedCount ? 'failed' : 'clear') + '">失败 ' + failedCount + '</span>' + (skipped ? '<span>跳过 ' + skipped + '</span>' : '') + failureButton + '</div></article>';
  }).join('');
}
function render() {
  $('btnRunAll').disabled = starting || snapshot.running === true;
  $('btnRunAll').textContent = '全部执行';
  $('btnRunAll').classList.toggle('refreshing', starting || snapshot.running === true);
  $('btnRunAll').setAttribute('aria-busy', String(starting || snapshot.running === true));
  $('maintenanceSummary').textContent = lastRunText(snapshot);
  $('maintenanceJobs').innerHTML = maintenanceMarkup(snapshot);
}
export async function loadTasks() {
  try { snapshot = await api('maintenance/status'); $('maintenanceError').hidden = true; render(); }
  catch (error) { if (error.name !== 'AbortError') { $('maintenanceError').hidden = false; $('maintenanceError').textContent = '任务状态读取失败：' + error.message; } }
}
$('btnRunAll').onclick = async () => {
  if (starting || snapshot.running) return;
  starting = true; render();
  try { snapshot = await api('maintenance/run', {method:'POST',body:'{}'}); await loadTasks(); }
  catch (error) { if (error.status === 409) { await loadTasks(); toast('已有一轮维护正在执行', 'ok'); } else toast('维护启动未确认：' + error.message, 'err'); }
  finally { starting = false; render(); }
};
function renderFailures(name) {
  const step = (snapshot.steps || []).find(item => item.name === name);
  const failures = (step?.accounts || []).filter(account => account.state === 'failed');
  $('taskFailureTitle').textContent = (JOBS.find(item => item[0] === name)?.[1] || '任务') + ' · 失败详情';
  $('taskFailureBody').innerHTML = failures.map(account => '<div class="job-account"><div><strong class="mono">' + esc(account.uid) + '</strong><p>' + esc(account.message || '无附加信息') + '</p></div><span class="tag bad">失败</span></div>').join('') || '<p class="hint">当前没有失败项。</p>';
}
$('maintenanceJobs').addEventListener('click', event => {
  const button = event.target.closest?.('[data-failures]');
  if (!button) return;
  renderFailures(button.dataset.failures);
  showModal('taskFailureVeil');
});
$('btnCloseTaskFailures').onclick = () => { hideModal('taskFailureVeil'); $('taskFailureBody').innerHTML = ''; };
document.addEventListener('panel:session', event => { if (!event.detail.authenticated) { snapshot = {running:false,steps:[]}; render(); } });
