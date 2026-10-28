import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const geometric = readFileSync(new URL('./assets/geometric.js', import.meta.url), 'utf8');

test('current geometry frontend exposes only the local session API families', () => {
  const sources = html + '\n' + geometric;
  const requestPaths = [...sources.matchAll(/(?:safeApiFetch|fetch)\(\s*(['"])([^'"]+)\1/g)]
    .map(([, , path]) => path);
  for (const path of [
    '/api/preload-bundle', '/auth/session', '/auth/login', '/auth/logout', '/auth/password',
    '/panel/api/overview', '/panel/api/egress', '/panel/api/packages',
    '/panel/api/request_logs', '/panel/api/accounts/',
    '/panel/api/meta/subscriptions', '/panel/api/customization', '/panel/api/update/check',
    '/panel/api/update/apply', '/panel/api/models', '/panel/api/refresh',
  ]) {
    assert.ok(requestPaths.some(requestPath => requestPath === path || requestPath.startsWith(path + '?')), 'missing frontend API family: ' + path);
  }
  assert.match(sources, /`\/panel\/api\/login\/poll\?state=\$\{st\}`/);
  assert.ok(requestPaths.length > 0, 'frontend must issue requests through the local API transport');
  assert.ok(requestPaths.every(path => path.startsWith('/')), 'frontend API requests must stay same-origin');
  assert.doesNotMatch(sources, /Authorization\s*:/i);
});

test('refresh and deletion use the backend response contract', () => {
  const refreshStart = geometric.indexOf('async function triggerGlobalDataRefresh() {');
  const refreshEnd = geometric.indexOf("document.getElementById('btn-refresh-all')", refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'missing refresh handler');
  const refresh = geometric.slice(refreshStart, refreshEnd);
  assert.match(refresh, /safeApiFetch\('\/panel\/api\/refresh'/);
  assert.match(refresh, /result\.ok\s*!==\s*true/);
  assert.match(refresh, /Object\.entries\(result\.components \|\| \{\}\)/);

  const deleteStart = geometric.indexOf('window.deleteAccountItem = async function(uid) {');
  assert.ok(deleteStart >= 0, 'missing account deletion handler');
  const deletion = geometric.slice(deleteStart, geometric.indexOf("document.getElementById('btn-about')", deleteStart));
  assert.match(deletion, /safeApiFetch\('\/panel\/api\/accounts\/' \+ encodeURIComponent\(uid\) \+ '\/remove'/);
  assert.match(deletion, /result\.ok\s*!==\s*true/);
});

test('mutating frontend calls keep same-origin credentials and CSRF session handling', () => {
  assert.match(geometric, /credentials:\s*['"]same-origin['"]/);
  assert.match(geometric, /X-CSRF-Token/);
  assert.match(geometric, /\/auth\/logout/);
  assert.match(geometric, /\/panel\/api\/customization/);
});

test('runtime inline page uses the documented API paths and methods', () => {
  const found = [...geometric.matchAll(/(?:safeApiFetch|fetch)\(\s*(['"`])([^'"`]+)\1\s*(?:\s*\+\s*encodeURIComponent\(uid\)\s*\+\s*'\/remove')?\s*(?:,\s*(\{[\s\S]*?\}))?/g)]
    .filter(([, , path]) => path.startsWith('/'))
    .map(([, , path, options = '']) => [path.replace(/\$\{[^}]+\}/g, '{state}'), /method\s*:\s*['"]POST['"]/i.test(options) ? 'POST' : 'GET']);
  const expected = [
    ['GET','/api/preload-bundle'], ['GET','/auth/session'], ['POST','/auth/login'],
    ['POST','/auth/logout'], ['POST','/auth/password'], ['GET','/panel/api/overview'],
    ['GET','/panel/api/egress'], ['GET','/panel/api/packages'], ['GET','/panel/api/request_logs?summary=1&limit=50'], ['GET','/panel/api/customization'],
    ['GET','/panel/api/login/poll?state={state}'], ['POST','/panel/api/meta/subscriptions'],
    ['POST','/panel/api/customization'], ['POST','/panel/api/update/check'], ['POST','/panel/api/update/apply'],
    ['GET','/panel/api/models'], ['POST','/panel/api/refresh'], ['POST','/panel/api/accounts/'],
  ];
  for (const [method,path] of expected) {
    assert.ok(found.some(([p,m]) => p === path && m === method), `${method} ${path} missing`);
  }
  assert.deepEqual([...new Set(found.map(([p,m]) => `${m} ${p}`))].sort(), expected.map(([m,p]) => `${m} ${p}`).sort());
});

test('runtime page request and response fields stay bound to the contract', () => {
  for (const pattern of [
    /JSON\.stringify\(\{\s*password:\s*entered\s*\}\)/,
    /JSON\.stringify\(\{\s*old_password:\s*oldVal,\s*new_password:\s*newVal\s*\}\)/,
    /JSON\.stringify\(\{\s*url:\s*urlVal,\s*name:\s*nameVal\s*\}\)/,
    /JSON\.stringify\(\{\s*customization:\s*nextCustomization\s*\}\)/,
    /bundle\.ciphertext\s*\|\|\s*!bundle\.iv/,
    /loginRes\.authenticated/, /loginRes\.csrf_token/,
    /ov\.uptime_sec/, /ov\.accounts/, /eg\.nodes/, /logs\.entries/,
    /res\.done\s*===\s*true\s*\|\|\s*res\.success\s*===\s*true/,
    /result\.components\s*\|\|\s*\{\}/,
  ]) assert.match(geometric, pattern);
});
