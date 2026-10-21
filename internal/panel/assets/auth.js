import { $, toast } from './common.js';
import { session, request, refreshSession, acceptSession, lockSession } from './api.js';
// One-time removal of the legacy secret, never migrate it into the password form.
try { localStorage.removeItem('wb2api.key'); } catch { /* Storage can be disabled. */ }
function booting() {
  return !!globalThis.document?.body?.classList?.contains?.('is-booting');
}
function reflectSession() {
  const locked = !session.authenticated;
  $('authVeil').classList.toggle('on', locked);
  document.querySelector('.shell').inert = locked;
  $('sessionState').textContent = locked ? '尚未登录' : '本机会话';
  $('defaultPasswordNotice').hidden = locked || !session.default_password;
  if (locked) { $('loginPassword').value = ''; $('oldPassword').value = ''; $('newPassword').value = ''; $('confirmPassword').value = ''; }
  // 启动动画还占着屏幕时不要抢焦点，否则键盘输入会落进看不见的密码框。
  if (locked && !booting()) $('loginPassword').focus();
}
document.addEventListener('panel:session', reflectSession);
$('loginForm').onsubmit = async event => {
  event.preventDefault(); const button = $('btnLogin'); button.disabled = true; $('authError').hidden = true;
  try {
    const d = await request('/auth/login', { method: 'POST', body: JSON.stringify({ password: $('loginPassword').value }) });
    if (!d.authenticated) throw new Error('密码不正确，请重试');
    $('loginPassword').value = ''; acceptSession(d);
    document.dispatchEvent(new CustomEvent('panel:authenticated'));
  } catch (error) { $('authError').textContent = error.message; $('authError').hidden = false; }
  finally { button.disabled = false; }
};
$('btnLogout').onclick = async () => {
  try { await request('/auth/logout', { method: 'POST' }); lockSession(); }
  catch (error) { toast('退出失败：' + error.message, 'err'); }
};
$('passwordForm').onsubmit = async event => {
  event.preventDefault();
  if ($('newPassword').value !== $('confirmPassword').value) { toast('两次输入的新密码不一致', 'err'); return; }
  const button = $('btnPasswordSave'); button.disabled = true;
  try {
    await request('/auth/password', { method: 'POST', body: JSON.stringify({ old_password: $('oldPassword').value, new_password: $('newPassword').value }) });
    $('passwordForm').reset(); lockSession(); toast('密码已修改，全部会话已退出，请重新登录', 'ok');
  } catch (error) { toast('修改密码失败：' + error.message, 'err'); }
  finally { button.disabled = false; }
};
export async function initAuth() {
  reflectSession();
  try {
    await refreshSession();
    if (session.authenticated) document.dispatchEvent(new CustomEvent('panel:authenticated'));
    else if (!booting()) $('loginPassword').focus();
  }
  catch (error) { $('authError').textContent = '无法检查会话：' + error.message; $('authError').hidden = false; }
}
