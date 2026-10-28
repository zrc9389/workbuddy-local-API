import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const assetDir = join(here, 'assets');
const sourceByFile = Object.fromEntries(readdirSync(assetDir).filter(name => name.endsWith('.js')).map(name => [name, readFileSync(join(assetDir, name), 'utf8')]));
const sources = Object.values(sourceByFile).join('\n');
const panel = readFileSync(join(here, 'panel.go'), 'utf8');

const contracts = [
  ['GET', 'overview', 'accounts.js'], ['GET', 'capabilities', 'capabilities.js'], ['GET', 'packages', 'packages.js'],
  ['GET', 'usage?hours=0', 'usage.js'], ['GET', 'maintenance/status', 'tasks.js'], ['POST', 'maintenance/run', 'tasks.js'],
  ['POST', 'session/bootstrap', 'router.js'], ['GET', 'session/bootstrap/status', 'router.js'],
  ['GET', 'meta/status', 'egress.js'], ['GET', 'meta/stats', 'egress.js'], ['GET', 'meta/nodes', 'egress.js'],
  ['GET', 'meta/tests', 'egress.js'], ['POST', 'meta/tests', 'egress.js'], ['GET', 'meta/subscriptions', 'egress.js'],
  ['POST', 'meta/subscriptions', 'egress.js'], ['POST', 'meta/accounts/', 'egress.js'],
  ['GET', 'models', 'models.js'], ['GET', 'model_probes', 'models.js'], ['POST', 'models/refresh', 'models.js'],
  ['GET', 'model_policy', 'model-policy.js'], ['POST', 'model_policy', 'model-policy.js'],
  ['GET', 'preferences', 'preferences.js'], ['POST', 'preferences', 'preferences.js'],
  ['GET', 'request_metrics', 'logs.js'], ['GET', 'request_logs', 'logs.js'],
  ['POST', 'accounts/', 'account-actions.js'], ['POST', 'login/start', 'add-account.js'],
  ['GET', 'login/poll?', 'add-account.js'], ['POST', 'import/cockpit', 'add-account.js'],
];

function backendHas(method, path) {
  const normalized = path.replace(/\?.*$/, '').replace(/\/$/, '');
  if (normalized.endsWith('/')) return panel.includes(method + ' /panel/api/' + normalized);
  return panel.includes(method + ' /panel/api/' + normalized) || panel.includes(method + ' /panel/api/' + normalized + '/{uid}');
}

test('active assets API families have registered backend handlers', () => {
  for (const [method, path, owner] of contracts) {
    const source = sourceByFile[owner] || sources;
    const key = path.replace(/\?.*$/, '').replace(/\/$/, '');
    assert.ok(source.includes("api('" + key) || source.includes('api("' + key), owner + ' must call ' + path);
    assert.ok(backendHas(method, key), method + ' /panel/api/' + path + ' must be registered');
  }
});

test('mutating contracts preserve request fields and query semantics', () => {
  assert.match(sources, /realm/); assert.match(sources, /disabled/); assert.match(sources, /body:JSON\.stringify\(\{node\}\)/);
  assert.match(sources, /action:'refresh'/); assert.match(sources, /action:'toggle'/); assert.match(sources, /action:'delete'/);
  assert.match(sources, /subscription_id=/); assert.match(sources, /reveal=1/); assert.match(sources, /summary=1&limit=1000/);
  assert.match(sources, /request_logs\?id=/); assert.match(sources, /old_password/); assert.match(sources, /new_password/);
});

test('all module access stays same-origin and uses session CSRF transport', () => {
  const api = sourceByFile['api.js'];
  assert.match(api, /credentials:\s*['"]same-origin['"]/); assert.match(api, /X-CSRF-Token/);
  assert.match(api, /path\.startsWith\('\/panel\/api\/'\)/); assert.doesNotMatch(sources, /Authorization\s*:/i);
});
