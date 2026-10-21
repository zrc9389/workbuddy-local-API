import { $, esc } from './common.js';
import { api } from './api.js';
import { fmtTok, fmtMs, fmtRate, fmtCredit, fmtCreditRatio, fmtModelRate, cacheRateText } from './format.js';
import { paginate, pagerHTML, bindPager } from './pagination.js';
let data = null, chartPage = 1;
const pages = new Map();
const dimensions = [['by_account','按账号'],['by_model','按模型'],['by_realm','按区域'],['credit_by_account','账号积分观测'],['credit_by_model','模型积分观测']];
export function usageChart(points) {
  if (!points.length) return '<div class="empty">暂无 Token 记录。仅显示本机观测，不生成示例流量。</div>';
  const max = Math.max(1,...points.map(point => Number(point.total_tokens) || Number(point.prompt_tokens || 0) + Number(point.completion_tokens || 0)));
  return '<div class="usage-chart">' + points.map(point => {
    const prompt = Math.max(0,Number(point.prompt_tokens)||0), completion = Math.max(0,Number(point.completion_tokens)||0);
    const when = new Date(point.t), label = Number.isFinite(when.getTime()) ? when.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : String(point.t || '未知时间');
    const tooltip = label + ' · Prompt ' + prompt + ' · Completion ' + completion + ' · 合计 ' + (point.total_tokens ?? prompt + completion);
    return '<div class="chart-column"><div class="chart-bar" title="' + esc(tooltip) + '" tabindex="0" aria-label="' + esc(tooltip) + '"><i class="p" style="height:' + (prompt / max * 140) + 'px"></i><i class="c" style="height:' + (completion / max * 140) + 'px"></i></div><span class="chart-tooltip">' + esc(fmtTok(point.total_tokens ?? prompt + completion)) + '</span><span class="chart-label">' + esc(label) + '</span></div>';
  }).join('') + '</div>';
}
function metric(label,value) { return '<article class="stat"><span>' + label + '</span><strong>' + esc(value) + '</strong></article>'; }
function detailCard(row,credit) {
  const metric = (label,value) => '<div><dt>' + label + '</dt><dd>' + esc(value) + '</dd></div>';
  return '<article class="data-row"><strong>' + esc(row.extra || row.nickname || row.key || '未命名') + '</strong><p class="hint mono">' + esc(row.key || '') + (row.realm ? ' · ' + esc(row.realm) : '') + '</p><dl class="mini-metrics">' + metric('请求',fmtTok(row.requests)) + (credit ? metric('积分',row.credit_samples ? fmtCredit(row.credits) : '未知') + metric('倍率',fmtModelRate(row.rate)) + metric('积分 / 1M Token',fmtCreditRatio(row.credits_per_1m_tokens,row.credit_samples,row.credit_tokens)) + metric('积分样本',String(row.credit_samples ?? 0)) : metric('失败',fmtTok(row.errors)) + metric('Prompt / Completion',fmtTok(row.prompt_tokens) + ' / ' + fmtTok(row.completion_tokens)) + metric('合计 Token',fmtTok(row.total_tokens)) + metric('平均延迟 / 速率',fmtMs(row.avg_latency_ms) + ' / ' + fmtRate(row.avg_tokens_per_second))) + metric('缓存命中率',cacheRateText(row.cache_hit_tokens,row.cache_miss_tokens)) + '</dl></article>';
}
export function renderUsage(snapshot) {
  data = snapshot;
  const total = snapshot.totals || {};
  $('usStats').innerHTML = metric('请求',total.requests == null ? '—' : fmtTok(total.requests)) + metric('Token 合计',total.total_tokens == null ? '—' : fmtTok(total.total_tokens)) + metric('积分观测',total.credit_samples ? fmtCredit(total.credits) : '未知') + metric('缓存命中率',cacheRateText(total.cache_hit_tokens,total.cache_miss_tokens));
  $('usNote').textContent = '本机全部已记录历史' + (snapshot.since ? ' · 起于 ' + snapshot.since : '') + ' · 未提供积分字段时不按 0 处理';
  const chart = paginate(snapshot.series || [],chartPage,12); chartPage = chart.page;
  $('usChart').innerHTML = usageChart(chart.rows); $('usChartPages').innerHTML = pagerHTML(chart,'timeline');
  $('usageDetails').innerHTML = dimensions.map(([key,title]) => {
    const result = paginate(snapshot[key] || [],pages.get(key),15); pages.set(key,result.page);
    return '<section class="surface"><h3>' + title + '</h3><div class="data-list">' + (result.rows.map(row => detailCard(row,key.startsWith('credit_'))).join('') || '<div class="empty">暂无记录</div>') + '</div>' + pagerHTML(result,key) + '</section>';
  }).join('');
}
export async function loadUsage() {
  try { renderUsage(await api('usage?hours=0')); }
  catch (error) { if (error.name === 'AbortError') return; data = null; $('usStats').innerHTML = ''; $('usageDetails').innerHTML = ''; $('usChartPages').innerHTML = ''; $('usChart').innerHTML = '<div class="error-notice">用量读取失败：' + esc(error.message) + '</div>'; $('usNote').textContent = '未取得统计数据'; }
}
bindPager('usChartPages', (_key,page) => { chartPage = page; if (data) renderUsage(data); });
bindPager('usageDetails',(key,page) => { pages.set(key,page); if (data) renderUsage(data); });
document.addEventListener('panel:session', event => { if (!event.detail.authenticated) { data = null; pages.clear(); chartPage = 1; $('usStats').innerHTML = ''; $('usageDetails').innerHTML = ''; $('usChart').innerHTML = ''; } });
