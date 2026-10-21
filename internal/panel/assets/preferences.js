import { api } from './api.js';
export async function getPreferences() { return api('preferences'); }
export async function savePreferences(patch) {
  const current = await getPreferences();
  await api('preferences', {method:'POST', body:JSON.stringify({credit_guard_low: current.credit_guard_low ?? 100, theme: current.theme || 'dark', ...patch})});
  return getPreferences();
}
