import { $ } from './common.js';
export async function loadConfig() {
  const title = $('ttl');
  if (title) title.textContent = '系统设置';
}

