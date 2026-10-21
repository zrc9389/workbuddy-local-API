// 兜底：app.js 若加载失败，body.is-booting 会永久遮住登录卡。
// 最坏时限（HARD_LIMIT_MS 12000 + 退场 360ms）之后再解封，避免与正常流程抢时序。
const WORST_CASE_MS = 13000;
setTimeout(() => {
  if (document.body?.classList?.contains?.('is-booting') && !document.getElementById('wbStartup')) {
    document.body.classList.remove('is-booting');
  }
}, WORST_CASE_MS);