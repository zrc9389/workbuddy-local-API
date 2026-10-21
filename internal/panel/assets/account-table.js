import { $ } from './common.js';
import { paginate } from './pagination.js';
import { renderAccountRows } from './account-rows.js';
let accounts = [], page = 1, busy = false;
export function accountPage(list, options = {}) { return paginate(list, options.page, options.pageSize); }
export function accountByUID(uid) { return accounts.find(account => account.uid === uid); }
function draw() {
  const result = accountPage(accounts, {page}); page = result.page;
  renderAccountRows(result.rows, busy);
  $('accPageInfo').textContent = result.page + ' / ' + result.pages + ' 页 · ' + result.count + ' 个账号';
  $('accPrev').disabled = busy || result.page <= 1; $('accNext').disabled = busy || result.page >= result.pages;
}
export function renderAccounts(list) { accounts = Array.isArray(list) ? list : []; draw(); }
export function setAccountBusy(value) { busy = value; draw(); }
$('accPrev').onclick = () => { if (!busy && page > 1) { page--; draw(); } };
$('accNext').onclick = () => { if (!busy) { page++; draw(); } };
document.addEventListener('panel:session', event => { if (!event.detail.authenticated) { accounts = []; page = 1; draw(); } });
