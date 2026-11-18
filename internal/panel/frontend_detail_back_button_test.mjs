import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './frontend_helpers_test.mjs';
import {handleDataAction} from './assets/editorial-events.js';

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

const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({url, options});
  return {status: 200, ok: true, json: async () => ({enabled: true, running: true, steps: []})};
};

const {bootGeometricRuntime} = await import('./assets/geometric.js');
bootGeometricRuntime();

function flushScrambleIntervals() {
  for (let i = 0; i < 20; i++) {
    for (const fn of [...dom.intervals.values()]) {
      try { fn(); } catch {}
    }
  }
}

test('08 logs detail page removes top-right back button and uses #btn-page-chord [ <- LOGS ] without flipping to MODEL', async () => {
  globalThis.WBState.currentChapter = 'logs';
  globalThis.WBState.logView = 'LIST';
  globalThis.WBState.selectedLogId = null;
  globalThis.WBState.logs = [
    {
      id: 'log-err-1',
      time: '19:30:00',
      timestamp: Date.now() - 60_000,
      code: 502,
      model: 'claude-sonnet-4-6',
      uid: 'u1',
      egress: 'HK-01',
      summary: 'upstream bad gateway',
      raw: '{"error":"bad_gateway"}'
    }
  ];

  // Initial list state
  globalThis.renderEditorialStage(false);
  flushScrambleIntervals();
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), 'ERROR MODEL');

  // Enter detail view via data-action="select-log"
  handleDataAction({dataset: {action: 'select-log', id: 'log-err-1'}}, {});
  flushScrambleIntervals();

  const detailHtml = dom.$('editorial-stage-body').innerHTML;
  assert.match(detailHtml, /upstream bad gateway/);
  assert.doesNotMatch(detailHtml, /data-action="clear-selected-log"/);
  assert.doesNotMatch(detailHtml, /返回记录/);
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), '<- LOGS');

  // Clicking #btn-page-chord exits detail back to LIST without flipping logView to MODEL
  await dom.$('btn-page-chord').fire('click');
  flushScrambleIntervals();

  assert.equal(globalThis.WBState.selectedLogId, null);
  assert.equal(globalThis.WBState.logView, 'LIST');
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), 'ERROR MODEL');
  assert.match(dom.$('editorial-stage-body').innerHTML, /data-action="select-log"/);

  // Clicking #btn-page-chord again in LIST mode switches to MODEL
  await dom.$('btn-page-chord').fire('click');
  flushScrambleIntervals();
  assert.equal(globalThis.WBState.logView, 'MODEL');
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), 'LOG ARCHIVE');

  // Stale selectedLogId auto-clears and falls back to list cleanly
  globalThis.WBState.logView = 'LIST';
  globalThis.WBState.selectedLogId = 'missing-log-id';
  globalThis.renderEditorialStage(false);
  flushScrambleIntervals();
  assert.equal(globalThis.WBState.selectedLogId, null);
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), 'ERROR MODEL');
  assert.match(dom.$('editorial-stage-body').innerHTML, /data-action="select-log"/);
});

test('05 tasks detail page removes top-right back button and uses #btn-page-chord [ <- TASKS ] without triggering startAllTasks', async () => {
  fetchCalls.length = 0;
  globalThis.WBState.currentChapter = 'tasks';
  globalThis.WBState.tasks.selectedStepCode = null;
  globalThis.WBState.tasks.steps = [
    {
      code: '01',
      name: '令牌续期',
      okCount: 2,
      processedCount: 3,
      totalCount: 3,
      skippedCount: 0,
      failures: [{name: 'acc-alpha', region: 'CN', reason: 'HTTP 401 token expired'}]
    }
  ];

  // Initial task list state
  globalThis.renderEditorialStage(false);
  flushScrambleIntervals();
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), 'START ALL TASKS');

  // Enter task step failure detail via data-action="set-task-step"
  handleDataAction({dataset: {action: 'set-task-step', stepCode: '01'}}, {});
  flushScrambleIntervals();

  const detailHtml = dom.$('editorial-stage-body').innerHTML;
  assert.match(detailHtml, /HTTP 401 token expired/);
  assert.doesNotMatch(detailHtml, /返回任务列表/);
  assert.doesNotMatch(detailHtml, /data-action="set-task-step"/);
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), '<- TASKS');

  // Clicking #btn-page-chord returns to task list and NEVER calls startAllTasks APIs
  const callsBeforeBack = fetchCalls.length;
  await dom.$('btn-page-chord').fire('click');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(globalThis.WBState.tasks.selectedStepCode, null);
  const startTaskCalls = fetchCalls.slice(callsBeforeBack).filter(c =>
    c.url === '/panel/api/tasks/schedule' || c.url === '/panel/api/maintenance/run'
  );
  assert.equal(startTaskCalls.length, 0, 'back click in task detail must not trigger startAllTasks');
  assert.equal(fetchCalls.length, callsBeforeBack, 'back click in task detail must not issue any fetch');
  flushScrambleIntervals();
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), 'START ALL TASKS');
  assert.match(dom.$('editorial-stage-body').innerHTML, /data-action="set-task-step"/);

  // Stale selectedStepCode auto-clears and falls back to task list cleanly (scheduler alias too)
  globalThis.WBState.currentChapter = 'scheduler';
  globalThis.WBState.tasks.selectedStepCode = 'NO_SUCH_STEP';
  globalThis.renderEditorialStage(false);
  flushScrambleIntervals();
  assert.equal(globalThis.WBState.tasks.selectedStepCode, null);
  assert.equal(dom.$('btn-page-chord').getAttribute('data-scramble'), 'START ALL TASKS');
  assert.match(dom.$('editorial-stage-body').innerHTML, /data-action="set-task-step"/);
});
