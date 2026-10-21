import { $ } from './common.js';
export function initEndpoints() {
  const base = location.origin + '/v1';
  $('localBaseURL').textContent = base;
  $('localChatURL').textContent = base + '/chat/completions';
  $('localResponsesURL').textContent = base + '/responses';
}
