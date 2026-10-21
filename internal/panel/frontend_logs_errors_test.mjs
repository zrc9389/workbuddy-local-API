import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM, mockAPI} from './frontend_helpers_test.mjs';

const dom = setupDOM(), $ = dom.$;

// The visual batch will add this markup. Keep the test independent of index.html
// while exercising the exact IDs the production markup must provide.
function installDetailMarkup() {
  const veil = new dom.Element('reqDetailVeil');
  veil.controls = [new dom.Element('btnCloseReqDetail')];
  dom.nodes.set('reqDetailVeil', veil);
  dom.nodes.set('reqDetailBody', new dom.Element('reqDetailBody'));
  dom.nodes.set('btnCloseReqDetail', veil.controls[0]);
}

test('error list stays compact and opens details on demand', async () => {
  installDetailMarkup();
  const client = await import('./assets/api.js');
  client.acceptSession({authenticated:true, csrf_token:'fixture'});
  const logs = await import('./assets/logs.js');
  const entry = {
    time: '2026-10-20T14:05:06Z', status: 429, outcome: 'http_error', model: 'glm',
    account: 'private-account', client_ip: '203.0.113.7', user_agent: 'private-agent/1.0',
    request_id: 'req-private', path: '/v1/chat/completions', duration_ms: 1250,
    total_tokens: 2300, prompt_tokens: 2000, completion_tokens: 300, credit_known: true,
    credit: 0.12, attempts: 3, cache_hit_tokens: 2257, cache_miss_tokens: 43,
  };
  const card = logs.requestCard(entry, 0);
  assert.match(card, /data-error-index="0"/);
  assert.match(card, /额度或限流/);
  assert.doesNotMatch(card, /private-account|203\.0\.113\.7|private-agent|req-private/);
  assert.doesNotMatch(card, /成功/);
  const all = logs.requestLogText(entry);
  assert.match(all, /glm/);
  assert.match(all, /429/);
  assert.doesNotMatch(all, /private-account|203\.0\.113\.7|private-agent|req-private/);
  const detail = logs.openRequestDetail(entry);
  assert.match(detail, /private-account/);
  assert.match(detail, /req-private/);
  assert.match(detail, /203\.0\.113\.7/);
  assert.match(detail, /现有事件没有独立额度字段/);
  assert.equal($('reqDetailVeil').classes.has('on'), true);
});

test('details escape untrusted fields and success rows are filtered from the archive', async () => {
  installDetailMarkup();
  const client = await import('./assets/api.js');
  client.acceptSession({authenticated:true, csrf_token:'fixture'});
  const cap = await import('./assets/capabilities.js');
  mockAPI(url => url.endsWith('/capabilities') ? {logs:true} : {entries:[]});
  await cap.loadCapabilities();
  const logs = await import('./assets/logs.js');
  const unsafe = logs.requestDetailHtml({model:'<script>', account:'<img onerror=x>', status:500, outcome:'http_error'});
  assert.doesNotMatch(unsafe, /<script>|<img/);
  assert.match(unsafe, /&lt;script&gt;/);
  mockAPI(url => {
    if (url.endsWith('/request_metrics')) return {archive:{enabled:true}, recent:[{request_id:'mem-success', status:200, ok:true, outcome:'success'}]};
    if (url.includes('/request_logs')) return {entries:[{request_id:'disk-ok', status:200, ok:true, outcome:'success'}, {request_id:'disk-fail', status:502, outcome:'http_error', model:'m'}]};
    if (url.endsWith('/capabilities')) return {logs:true};
    return {entries:[]};
  });
  await logs.loadLogs();
  assert.doesNotMatch($('reqBody').innerHTML, /disk-ok|mem-success/);
  assert.match($('reqBody').innerHTML, /502/);
  assert.doesNotMatch($('reqBody').innerHTML, /disk-fail/);
  assert.match($('reqCount').textContent, /最长保留 24 小时/);
});

test('summary fetch is used for the list and detail is fetched by stable id on click', async () => {
  installDetailMarkup();
  const client = await import('./assets/api.js');
  client.acceptSession({authenticated:true, csrf_token:'fixture'});
  const cap = await import('./assets/capabilities.js');
  const calls = mockAPI(url => {
    if (url.endsWith('/capabilities')) return {logs:true};
    if (url.endsWith('/request_metrics')) return {archive:{enabled:true}, recent:[]};
    if (url.includes('summary=1')) return {entries:[
      {id:'a'.repeat(32), time:'2026-10-20T14:05:06Z', model:'glm', status:429, outcome:'http_error', duration_ms:900},
      {id:'b'.repeat(32), time:'2026-10-20T14:06:06Z', model:'glm', status:502, outcome:'http_error', duration_ms:800},
    ]};
    if (url.includes('/request_logs?id=')) return {entry:{time:'2026-10-20T14:05:06Z', model:'glm', status:429, outcome:'http_error',
      account:'private-account', request_id:'req-private', client_ip:'203.0.113.7', user_agent:'ua'}};
    return {entries:[]};
  });
  await cap.loadCapabilities();
  const logs = await import('./assets/logs.js');
  await logs.loadLogs();
  const list = $('reqBody').innerHTML;
  assert.match(list, /data-error-index="0"/);
  assert.match(list, /data-error-index="1"/);
  assert.doesNotMatch(list, /a{32}/);
  assert.doesNotMatch(list, /req-private|private-account|203\.0\.113\.7/);
  assert.ok(!calls.some(c => /\/panel\/api\/logs(\?|$)/.test(c.url)), 'error page must not read system logs');
  assert.equal($('logBox').innerHTML, '');
  assert.equal($('logNote').textContent, '');
  dom.nodes.get('reqBody').listeners.get('click')[0]({target:{closest:()=>({dataset:{errorIndex:'0'}})}});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.some(c => c.url.includes('/request_logs?id=' + 'a'.repeat(32))), 'detail must be fetched by id');
  assert.match($('reqDetailBody').innerHTML, /req-private|private-account/);
});

test('memory-only metrics expose summaries and still allow id lookup', async () => {
  installDetailMarkup();
  const client = await import('./assets/api.js');
  client.acceptSession({authenticated:true, csrf_token:'fixture'});
  const cap = await import('./assets/capabilities.js');
  mockAPI(url => {
    if (url.endsWith('/capabilities')) return {logs:true};
    if (url.endsWith('/request_metrics')) return {archive:{enabled:false}, recent:[
      {id:'c'.repeat(32), time:'2026-10-20T14:05:06Z', model:'glm', status:503, outcome:'stream_error', duration_ms:10},
    ]};
    if (url.includes('/request_logs?id=')) return {entry:{status:503, outcome:'stream_error', account:'private-account'}};
    return {entries:[]};
  });
  await cap.loadCapabilities();
  const logs = await import('./assets/logs.js');
  await logs.loadLogs();
  assert.match($('reqBody').innerHTML, /data-error-index="0"/);
  assert.doesNotMatch($('reqBody').innerHTML, /c{32}/);
  assert.match($('reqBody').innerHTML, /503/);
});
