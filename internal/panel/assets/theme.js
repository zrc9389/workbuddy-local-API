import { $ , toast } from './common.js';
import { session } from './api.js';
import { savePreferences } from './preferences.js';
let theme = 'dark', saving = false;
try { theme = localStorage.getItem('wb2api.theme') || 'dark'; } catch { /* Storage is optional. */ }
const system = matchMedia('(prefers-color-scheme: light)');
export function currentTheme() { return theme; }
export function setTheme(value) {
  theme = ['light','dark','auto'].includes(value) ? value : 'dark';
  const effective = theme === 'auto' ? (system.matches ? 'light' : 'dark') : theme;
  document.documentElement.dataset.theme = effective;
  document.dispatchEvent(new CustomEvent('panel:theme', { detail: { theme: effective } }));
  const legacyButton = $('btnTheme');
  if (legacyButton) {
    legacyButton.textContent = effective === 'dark' ? '浅色 ↗' : '深色 ↗';
    legacyButton.setAttribute('aria-label', effective === 'dark' ? '切换浅色主题' : '切换深色主题');
  }
  try { localStorage.setItem('wb2api.theme', theme); } catch { /* Storage is optional. */ }
}
system.addEventListener?.('change', () => setTheme(theme));
const legacyButton = $('btnTheme');
if (legacyButton) legacyButton.onclick = async () => {
  if (saving) return;
  const previous = theme, next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next); if (!session.authenticated) return;
  saving = true; legacyButton.disabled = true;
  try { const saved = await savePreferences({theme:next}); setTheme(saved.theme || next); }
  catch (error) { setTheme(previous); toast('主题未保存：' + error.message, 'err'); }
  finally { saving = false; legacyButton.disabled = false; }
};
function motionState() { document.documentElement.dataset.paused = String(document.hidden); }
document.addEventListener('visibilitychange', motionState); motionState(); setTheme(theme);
