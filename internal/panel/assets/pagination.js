import { $, esc } from './common.js';
// Fixed-size, bounded DOM. Every row stays reachable, including after data shrink.
export function paginate(list, page = 1, pageSize = 25) {
  const rows = Array.isArray(list) ? list : [];
  const size = Math.max(1, Math.min(100, Math.floor(Number(pageSize)) || 25));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.max(1, Math.min(pages, Math.floor(Number(page)) || 1));
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages, count: rows.length, size };
}
export function pagerHTML(result, key) {
  return '<div class="pager"><button type="button" data-page-key="' + esc(key) + '" data-page="' + (result.page - 1) + '"' + (result.page <= 1 ? ' disabled' : '') + ' aria-label="上一页">←</button><span>' + result.page + ' / ' + result.pages + ' 页 · ' + result.count + ' 条</span><button type="button" data-page-key="' + esc(key) + '" data-page="' + (result.page + 1) + '"' + (result.page >= result.pages ? ' disabled' : '') + ' aria-label="下一页">→</button></div>';
}
export function bindPager(host, callback) {
  $(host).addEventListener('click', event => {
    const button = event.target.closest('button[data-page-key]');
    if (button && !button.disabled) callback(button.dataset.pageKey, Number(button.dataset.page));
  });
}
