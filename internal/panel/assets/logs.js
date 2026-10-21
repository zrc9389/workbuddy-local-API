import { $, esc } from './common.js';
import { api } from './api.js';
import { logsAvailable } from './capabilities.js';
import { fmtTok, fmtMs, fmtCredit, cacheRateText } from './format.js';
import { paginate, pagerHTML, bindPager } from './pagination.js';
import { showModal, hideModal } from './modals.js';

// 错误页只展示模型请求错误摘要；详情按稳定 ID 在点击时单独 GET。
let requests = [], requestPage = 1;
const outcomes = {success:'成功',http_error:'HTTP 错误',stream_error:'流错误',interrupted:'中断'};
const errorCatalog = {
  quota: {label:'额度或限流', detail:'状态码或上游错误提示显示额度不足/限流；现有事件没有独立额度字段，无法可靠区分这两种原因。'},
  timeout: {label:'超时或冲突', detail:'状态码或上游错误提示显示超时或请求冲突。'},
  auth: {label:'鉴权或权限', detail:'状态码或上游错误提示显示鉴权失败、无权限或账号不可用。'},
  conflict: {label:'超时或冲突', detail:'状态码或上游错误提示显示请求冲突、并发占用或上游超时。'},
  rate: {label:'限流或冷却', detail:'状态码或上游错误提示显示调用过于频繁或账号冷却。'},
  server: {label:'上游或服务错误', detail:'状态码或上游错误提示显示服务端或上游异常。'},
};

// errorKind 只根据现有事件字段给出保守分类。Event 没有原始错误正文，
// 因此这里的“额度”只是状态码层面的推断，详情弹窗会明确说明这一限制。
export function errorKind(entry) {
  if (entry && entry.error_kind) return entry.error_kind;
  const status = Number(entry && entry.status) || 0;
  if (status === 429) return 'quota';
  if (status === 402) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 409) return 'conflict';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  if (entry && entry.outcome === 'interrupted') return 'timeout';
  if (entry && entry.outcome === 'stream_error') return 'server';
  return 'other';
}

function errorLabel(entry) {
  const kind = errorKind(entry);
  return (errorCatalog[kind] || {}).label || (kind === 'conflict' ? '超时或冲突' : '请求错误');
}

function errorTone(entry) {
  const kind = errorKind(entry);
  return kind === 'quota' || kind === 'rate' ? 'warn' : kind === 'other' ? 'muted' : 'bad';
}

function timeText(entry) {
  if (!entry || !entry.time) return '—';
  const d = new Date(entry.time);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {hour12:false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

export function requestLogText(entry) {
  return [timeText(entry), entry.model || '未知模型', errorLabel(entry), String(entry.status || '—'), fmtMs(entry.duration_ms)].join(' · ');
}

// 列表行只渲染摘要字段；稳定 ID 放在 data 属性中，不进入可见文本。
export function requestCard(entry, index = 0) {
  const tone = errorTone(entry), id = entry && entry.id ? String(entry.id) : '';
  return '<button type="button" class="request-row" data-error-index="' + esc(index) + '"' +
    (id ? ' data-event-id="' + esc(id) + '"' : '') + '>' +
    '<span class="request-time">' + esc(timeText(entry)) + '</span>' +
    '<strong>' + esc(entry.model || '未知模型') + '</strong>' +
    '<span class="tag ' + tone + '">' + esc(errorLabel(entry)) + '</span>' +
    '<span class="request-status">' + esc(entry.status == null || entry.status === 0 ? '—' : entry.status) + '</span>' +
    '<span class="request-duration">' + esc(fmtMs(entry.duration_ms)) + '</span>' +
    '<span class="request-open" aria-hidden="true">详情 ›</span>' +
    '</button>';
}

function detailRow(label, value) {
  return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value == null || value === '' ? '—' : value) + '</dd></div>';
}

export function requestDetailHtml(entry) {
  if (!entry) return '<p class="empty">记录不存在</p>';
  const tokens = Number(entry.total_tokens) || Number(entry.prompt_tokens || 0) + Number(entry.completion_tokens || 0);
  const kind = errorKind(entry);
  const hint = (errorCatalog[kind] || {}).detail || '';
  return '<div class="card-heading"><div><p class="eyebrow">ERROR / DETAIL</p><h3>' + esc(entry.model || '未知模型') + '</h3></div><span class="tag ' + errorTone(entry) + '">' + esc(errorLabel(entry)) + '</span></div>' +
    (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') +
    '<dl class="mini-metrics">' +
      detailRow('时间', timeText(entry)) + detailRow('HTTP 状态', entry.status == null ? '—' : String(entry.status)) +
      detailRow('结果', outcomes[entry.outcome] || entry.outcome || '—') + detailRow('请求路径', entry.path) +
      detailRow('账号', entry.account) + detailRow('延迟 / 首字节', fmtMs(entry.duration_ms) + ' / ' + fmtMs(entry.ttfb_ms)) +
      detailRow('尝试次数', entry.attempts == null ? '—' : String(entry.attempts)) +
      detailRow('Token', fmtTok(tokens) + '（' + fmtTok(entry.prompt_tokens || 0) + ' / ' + fmtTok(entry.completion_tokens || 0) + '）') +
      detailRow('积分', entry.credit_known ? fmtCredit(entry.credit) : '未知') +
      detailRow('缓存命中率', cacheRateText(entry.cache_hit_tokens, entry.cache_miss_tokens)) +
      detailRow('来源 IP', entry.client_ip) + detailRow('User Agent', entry.user_agent) + detailRow('请求 ID', entry.request_id) +
    '</dl>';
}

function showDetail(html) {
  const body = $('reqDetailBody'), veil = $('reqDetailVeil');
  if (!body || !veil) return null;
  body.innerHTML = html;
  showModal('reqDetailVeil');
  return body.innerHTML;
}

export function openRequestDetail(entry) {
  return showDetail(requestDetailHtml(entry));
}

// loadRequestDetail 按稳定 ID 请求单条详情；列表本身不携带 request_id/账号。
export async function loadRequestDetail(id) {
  if (!id) return null;
  showDetail('<p class="hint">正在读取详情…</p>');
  try {
    const data = await api('request_logs?id=' + encodeURIComponent(id));
    if (!data || !data.entry) {
      showDetail('<p class="empty">记录已在保留期内被清理</p>');
      return null;
    }
    return showDetail(requestDetailHtml(data.entry));
  } catch (error) {
    if (error.name === 'AbortError') return null;
    showDetail('<p class="error-text">' + esc(error.message) + '</p>');
    return null;
  }
}

function closeRequestDetail() {
  hideModal('reqDetailVeil');
}

function render() {
  const req = paginate(requests,requestPage,25); requestPage=req.page;
  const offset=(req.page-1)*req.size;
  bindRequestDetail();
  $('reqBody').innerHTML=req.rows.map((entry,index)=>requestCard(entry,offset+index)).join('')||'<div class="empty">暂无错误记录</div>';
  $('reqPages').innerHTML=pagerHTML(req,'requests');
  $('reqCount').textContent=requests.length+' 条错误 · 最长保留 24 小时'+(requests.length?' · 点击任一记录查看详情':'');
  // 错误页不再渲染普通运行日志；清空旧节点，避免上一版本残留内容。
  $('logBox').innerHTML='';
  $('logPages').innerHTML='';
  $('logNote').textContent='';
}

export async function loadLogs() {
  if(!logsAvailable())return;
  try {
    const [metrics,archive]=await Promise.all([api('request_metrics'),api('request_logs?summary=1&limit=1000')]);
    if(!logsAvailable())return;
    const rows=metrics.archive?.enabled?(archive.entries||[]):(metrics.recent||[]);
    requests=rows.filter(entry=>entry.outcome!=='success'&&!entry.ok);
    $('reqSummary').textContent='已完成 '+fmtTok(metrics.completed)+' · 成功率 '+(metrics.success_rate==null?'—':Number(metrics.success_rate).toFixed(1)+'%')+' · HTTP 成功率 '+(metrics.http_success_rate==null?'—':Number(metrics.http_success_rate).toFixed(1)+'%')+' · 平均 '+fmtMs(metrics.avg_duration_ms)+' · 进行中 '+(metrics.in_flight??'—');
    $('reqNote').textContent=(metrics.archive?.enabled?'使用磁盘错误归档':'错误归档未启用，展示内存错误记录')+(metrics.archive?.dropped_writes?' · 未写入 '+metrics.archive.dropped_writes+' 条':'')+(metrics.archive?.last_error?' · 写入错误：'+metrics.archive.last_error:'')+' · 最多保留 24 小时；额度与限流仅按状态码归类';render();
  } catch(error) {if(error.name==='AbortError')return;requests=[];$('reqSummary').textContent='记录读取失败';$('reqNote').textContent=error.message;$('reqBody').innerHTML='';$('reqPages').innerHTML='';$('logBox').innerHTML='';$('logPages').innerHTML='';$('logNote').textContent='';}
}
bindPager('reqPages',(_key,page)=>{requestPage=page;render();});
function bindRequestDetail() {
  const body = $('reqBody');
  if (!body || body.dataset.detailBound === '1') return;
  // 详情弹窗由视觉批次注入；目标节点齐全后才写标记，避免永久失去绑定。
  if (!$('reqDetailVeil') || !$('reqDetailBody')) return;
  body.dataset.detailBound = '1';
  body.addEventListener('click',event=>{
    const row=event.target.closest?.('button[data-error-index]');
    if(!row)return;
    const entry=requests[Number(row.dataset.errorIndex)];
    if(!entry)return;
    if(entry.id) loadRequestDetail(entry.id);
    else openRequestDetail(entry);
  });
  $('btnCloseReqDetail')?.addEventListener('click',closeRequestDetail);
  $('reqDetailVeil')?.addEventListener('click',event=>{if(event.target.id==='reqDetailVeil')closeRequestDetail();});
}
bindRequestDetail();
document.addEventListener('panel:session',event=>{if(!event.detail.authenticated){requests=[];requestPage=1;$('reqBody').innerHTML='';}});
