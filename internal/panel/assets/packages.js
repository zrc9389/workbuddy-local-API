import { $, esc } from './common.js';
import { api } from './api.js';
import { paginate, pagerHTML, bindPager } from './pagination.js';
const DAY = 86400000;
// 到期展示上限：上游存在远期包（实测 2928 天），统一折到 30 天内，既不显示原值也不归零。
export const MAX_EXPIRY_DAYS = 30;
let accounts = [], accountPage = 1, chartPage = 1;
const detailPages = new Map();
export function pkExpiryMs(pack) {
  const raw = Number(pack?.expires_at); if (Number.isFinite(raw) && raw > 0) return raw;
  let text = String(pack?.end_time || '').trim(); if (!text || text.startsWith('0001-')) return null;
  text = text.includes('T') ? text : text.replace(' ','T'); if (!/(?:Z|[+-]\d\d:\d\d)$/.test(text)) text += '+08:00';
  const value = Date.parse(text); return Number.isFinite(value) ? value : null;
}
export function pkDetailCompare(a,b) {
  const first = pkExpiryMs(a) ?? Infinity, second = pkExpiryMs(b) ?? Infinity;
  return (first !== second ? first - second : 0) || (Number(b.size)||0) - (Number(a.size)||0);
}
export function pkDetailGroups(packs,limit = 5) {
  const active = (packs || []).filter(pack => Number.isFinite(Number(pack.remain)) && Number(pack.remain) > 0);
  active.sort(pkDetailCompare);
  const size = Math.max(1,Math.min(100,Math.floor(Number(limit))||5)), visible = active.slice(0,size), rest = active.slice(size);
  return {visible,rest,used:[],restSize:rest.reduce((n,p)=>n+(Number(p.size)||0),0),restRemain:rest.reduce((n,p)=>n+(Number(p.remain)||0),0),usedSize:0};
}
function fmtCredits(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number).toLocaleString('zh-CN') : '未知';
}
// 未取得余额 = 请求失败/字段缺失/不可解析，与余额 0 严格区分。
export function pkHasBalance(account) {
  return !account?.error && account?.remain != null && Number.isFinite(Number(account.remain));
}
export function pkAccountSegments(account,now) {
  let balance = Math.max(0,Number(account.remain)||0); const result = [];
  // Respect the observed account balance even if upstream repeats package rows.
  for (const pack of account.packages || []) {
    const remain = Number(pack.remain); if (!Number.isFinite(remain) || remain <= 0 || balance <= 0) continue;
    const amount = Math.min(balance,remain), expiresAt = pkExpiryMs(pack); balance -= amount;
    result.push({amount,expiresAt,days:expiresAt == null ? null : Math.max(0,Math.ceil((expiresAt-now)/DAY)),source:pack.name||'积分',uid:String(account.uid||''),accountName:account.nickname||account.uid||'未命名账号'});
  }
  return result.sort((a,b)=>(a.expiresAt??Infinity)-(b.expiresAt??Infinity));
}
export function creditDaysLabel(days) {
  const value = Math.ceil(Number(days));
  if (!Number.isFinite(value)) return '未知';
  if (value <= 0) return '已到期';
  return Math.min(MAX_EXPIRY_DAYS,value) + ' 天内';
}
export function summarizeCreditDays(list,now) {
  const buckets = new Map(); let unavailable = 0;
  for (const account of list || []) {
    if (!pkHasBalance(account)) {unavailable++;continue;}
    for (const part of pkAccountSegments(account,now)) {
      if (part.days == null) continue;
      const days = Math.min(MAX_EXPIRY_DAYS,Math.max(0,Math.ceil(Number(part.days)||0)));
      if (!buckets.has(days)) buckets.set(days,{days,credits:0,segments:[]});
      const row = buckets.get(days); row.credits += part.amount; row.segments.push({...part,days});
    }
  }
  return {rows:[...buckets.values()].sort((a,b)=>a.days-b.days),accountCount:(list||[]).length,unavailable};
}
function expiryText(pack) {
  const timestamp = pkExpiryMs(pack); return timestamp == null ? '到期时间未知' : '到期 ' + new Date(timestamp).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
}
function render() {
  const summary = summarizeCreditDays(accounts,Date.now()), total = accounts.reduce((sum,a)=>sum+(pkHasBalance(a) ? Number(a.remain)||0 : 0),0);
  const known = accounts.filter(pkHasBalance).length;
  $('pkStats').innerHTML = '<article class="stat"><span>已读取账号</span><strong>' + known + ' / ' + accounts.length + '</strong></article><article class="stat"><span>已知剩余积分</span><strong>' + fmtCredits(total) + '</strong></article><article class="stat warn" title="请求失败或字段缺失，不按 0 计"><span>未取得余额</span><strong>' + summary.unavailable + '</strong></article>';
  const chart = paginate(summary.rows,chartPage,20); chartPage = chart.page;
  const max = Math.max(1,...summary.rows.map(row=>row.credits));
  $('pkChart').innerHTML = '<div class="expiry-list">' + (chart.rows.map(row=>'<div class="expiry-row"><span>' + creditDaysLabel(row.days) + '</span><div class="expiry-track"><i style="width:' + (row.credits/max*100) + '%"></i></div><strong>' + fmtCredits(row.credits) + '</strong></div>').join('') || '<div class="empty">暂无已知到期日的余额</div>') + '</div>';
  $('pkChartPages').innerHTML = pagerHTML(chart,'expiry');
  const result = paginate(accounts,accountPage,12); accountPage = result.page;
  $('pkBody').innerHTML = result.rows.map(account=>{
    const groups = pkDetailGroups(account.packages), ordered = [...groups.visible,...groups.rest], detail = paginate(ordered,detailPages.get(account.uid),5); detailPages.set(account.uid,detail.page);
    const tag = pkHasBalance(account) ? '<span class="tag ok">' + fmtCredits(account.remain) + ' 积分</span>' : '<span class="tag warn">未读取</span>';
    const body = pkHasBalance(account) && Number(account.remain) > 0
      ? detail.rows.map(pack=>'<div class="package-entry"><strong>' + esc(pack.name||'积分包') + '</strong><p>剩余 ' + fmtCredits(pack.remain) + ' / ' + fmtCredits(pack.size) + ' · 已用 ' + fmtCredits(pack.used) + '</p><p class="hint">' + esc(expiryText(pack)) + '</p>' + (pack.created_at?'<p class="hint">发放 '+esc(pack.created_at)+'</p>':'') + '</div>').join('') + (!ordered.length?'<p class="hint">无剩余积分包</p>':'') + pagerHTML(detail,account.uid)
      : (account.error ? '<p class="error-text">'+esc(account.error)+'</p>' : pkHasBalance(account) ? '<p class="hint">无剩余积分包</p>' : '<p class="hint">未取得余额</p>');
    return '<article class="package-card"><div class="card-heading"><h3>' + esc(account.nickname||account.uid) + '</h3>' + tag + '</div><p class="hint mono">' + esc(account.uid) + '</p>' + body + '</article>';
  }).join('') || '<div class="empty">暂无账号积分数据</div>';
  $('pkPages').innerHTML = pagerHTML(result,'accounts'); $('pkNote').textContent = '';
}
export async function loadPackages() {
  $('pkNote').textContent = '正在读取积分包…';
  try { const response = await api('packages'); accounts = response.accounts || []; render(); }
  catch (error) { if (error.name === 'AbortError') return; accounts = []; $('pkStats').innerHTML = ''; $('pkChart').innerHTML = ''; $('pkChartPages').innerHTML = ''; $('pkPages').innerHTML = ''; $('pkBody').innerHTML = '<div class="error-notice">积分读取失败：' + esc(error.message) + '</div>'; $('pkNote').textContent = '数据未取得'; }
}
bindPager('pkPages',(_key,page)=>{accountPage=page;render();});
bindPager('pkChartPages',(_key,page)=>{chartPage=page;render();});
bindPager('pkBody',(uid,page)=>{detailPages.set(uid,page);render();});
document.addEventListener('panel:session',event=>{if(!event.detail.authenticated){accounts=[];detailPages.clear();accountPage=1;chartPage=1;$('pkBody').innerHTML='';$('pkStats').innerHTML='';$('pkChart').innerHTML='';}});
