import { $ } from './common.js';
import { api } from './api.js';
let logs = null, authoritative = false;
export function logsAvailable() { return logs === true; }
function apply(value) {
  if (typeof value !== 'boolean') return;
  const changed = logs !== value; logs = value;
  if ($('logsNavItem')) $('logsNavItem').hidden = !logs;
  if (changed) document.dispatchEvent(new CustomEvent('panel:capabilities',{detail:{logs}}));
}
export function applyOverviewCapabilities(data) { if (!authoritative && typeof data.logging_enabled === 'boolean') apply(data.logging_enabled); }
export async function loadCapabilities() {
  try {
    const data = await api('capabilities');
    if (typeof data.logs === 'boolean') { authoritative = true; apply(data.logs); return; }
    throw new Error('capabilities missing logs');
  } catch (error) { if (error.name === 'AbortError') return; }
  // Older local backends may only report this in overview. Unknown never polls logs.
  authoritative = false;
  try { applyOverviewCapabilities(await api('overview')); } catch { /* Preserve known state. */ }
}
