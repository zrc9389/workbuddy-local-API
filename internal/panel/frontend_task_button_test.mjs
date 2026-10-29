import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './frontend_helpers_test.mjs';
import {handleDataAction} from './assets/editorial-events.js';

test('task buttons enable and run immediately, disable future schedules, and stop on save failure', async () => {
  const dom = setupDOM();
  dom.Element.prototype.getContext = () => ({
    fillRect() {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {}, moveTo() {}, lineTo() {},
    arc() {}, save() {}, restore() {}, setTransform() {}, resetTransform() {}, scale() {}, translate() {},
    drawImage() {}, measureText() { return {width: 10}; }, fillText() {}, strokeText() {},
    createImageData() { return {data: []}; }, getImageData() { return {data: []}; }, putImageData() {},
    setLineDash() {}, strokeRect() {}
  });
  dom.Element.prototype.blur = () => {};
  globalThis.window = globalThis;
  globalThis.location = {protocol: 'http:', pathname: '/panel/', port: '7863', origin: 'http://127.0.0.1:7863'};
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 800;
  globalThis.requestAnimationFrame = () => 1;
  const calls = [];
  let failSchedule = false;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url, options});
    if (url === '/panel/api/tasks/schedule' && failSchedule) return {status: 500, ok: false, json: async () => ({})};
    if (url === '/panel/api/maintenance/run') return {status: 200, ok: true, json: async () => ({running: true, steps: [{name:'token', state:'running', total:16, completed:7, failed:8, accounts:[...Array.from({length:7}, (_, i) => ({uid:'ok'+i, state:'done'})), ...Array.from({length:8}, (_, i) => ({uid:'bad'+i, state:'failed', message:'401'})), {uid:'off', state:'skipped'}]}]})};
    if (url === '/panel/api/maintenance/pause') {
      const paused = JSON.parse(options.body).paused;
      return {status:200, ok:true, json:async () => ({running:true, paused, steps:[]})};
    }
    const enabled = options.body ? JSON.parse(options.body).enabled : true;
    return {status: 200, ok: true, json: async () => ({enabled, status: enabled ? 'enabled' : 'disabled'})};
  };
  await import('./assets/geometric.js');
  globalThis.WBState.currentChapter = 'tasks';
  globalThis.csrfToken = 'test-csrf';
  await dom.$('btn-page-chord').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  const call = calls.find(item => item.url === '/panel/api/tasks/schedule');
  assert.ok(call, 'task start click must reach schedule API');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(call.options.body, JSON.stringify({enabled: true}));
  const run = calls.find(item => item.url === '/panel/api/maintenance/run');
  assert.ok(run, 'start must immediately run the maintenance batch');
  assert.ok(calls.indexOf(call) < calls.indexOf(run));
  assert.equal(run.options.method, 'POST');
  assert.equal(run.options.headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(globalThis.WBState.tasks.steps[0].processedCount, 16);
  assert.equal(globalThis.WBState.tasks.steps[0].okCount, 7);
  assert.equal(globalThis.WBState.tasks.steps[0].skippedCount, 1);
  assert.equal(globalThis.WBState.tasks.steps[0].failures.length, 8);
  assert.match(dom.$('editorial-stage-body').innerHTML, /已处理 16，成功 7，失败 8，跳过 1/);
  handleDataAction({dataset:{action:'toggle-maintenance-pause'}}, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(globalThis.WBState.tasks.pausedAll, true);
  handleDataAction({dataset:{action:'toggle-maintenance-pause'}}, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(globalThis.WBState.tasks.pausedAll, false);
  assert.deepEqual(calls.filter(item => item.url === '/panel/api/maintenance/pause').map(item => JSON.parse(item.options.body).paused), [true, false]);
  const stopButton = dom.$('btn-page-ripple');
  for (const handler of stopButton.listeners.get('click') || []) await handler.call(stopButton, {});
  await new Promise(resolve => setImmediate(resolve));
  const disable = calls.filter(item => item.url === '/panel/api/tasks/schedule').at(-1);
  assert.equal(disable.options.method, 'POST');
  assert.equal(disable.options.headers['X-CSRF-Token'], 'test-csrf');
  assert.equal(disable.options.body, JSON.stringify({enabled: false}));
  assert.equal(globalThis.WBState.tasks.scheduleEnabled, false);
  assert.equal(calls.filter(item => item.url === '/panel/api/maintenance/run').length, 1, 'disable must not start a batch');
  for (const handler of stopButton.listeners.get('click') || []) await handler.call(stopButton, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(calls.filter(item => item.url === '/panel/api/tasks/schedule').at(-1).options.body).enabled, true);
  assert.equal(globalThis.WBState.tasks.scheduleEnabled, true);
  assert.equal(calls.filter(item => item.url === '/panel/api/maintenance/run').length, 1, 're-enabling the schedule must not start a batch');
  failSchedule = true;
  await dom.$('btn-page-chord').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(item => item.url === '/panel/api/maintenance/run').length, 1, 'failed schedule save must not start a batch');
});
