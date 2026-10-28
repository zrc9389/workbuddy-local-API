import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./assets/geometric.js', import.meta.url), 'utf8');
function functionSource(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.notEqual(start, -1, `missing inline handler: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  assert.ok(end > start, `missing inline handler boundary: ${endMarker}`);
  return html.slice(start, end);
}
function runFunction(source, name, globals) {
  const context = vm.createContext(globals);
  return vm.runInContext(`${source}; ${name}`, context);
}

test('actual geometry account delete requires confirmation, calls backend and only mutates after success', async () => {
  const calls = [], notices = [];
  const account = {uid: 'acct-1', name: 'Primary'};
  const state = {accounts: [account], accountPage: 0};
  let accepted = false, response = {ok: true};
  const handler = runFunction(
    functionSource('window.deleteAccountItem = async function(uid) {', '        document.getElementById(\'btn-about\')'),
    'window.deleteAccountItem',
    {
      window: {confirm: message => { return accepted; }},
      WBState: state, IS_PROD_ENV: true,
      safeApiFetch: async (...args) => { calls.push(args); return response; },
      soundscape: {triggerTileNote() {}},
      notifyEditorialStatus: value => notices.push(value),
      updateEditorialKeyFigures() {}, renderEditorialStage() {}, Math, encodeURIComponent,
    },
  );
  await handler('acct-1');
  assert.equal(state.accounts.length, 1, 'cancel keeps the account in view');
  assert.equal(calls.length, 0);
  assert.match(functionSource('window.deleteAccountItem = async function(uid) {', '        document.getElementById(\'btn-about\')'), /window\.confirm/);

  accepted = true; response = {ok: false};
  await handler('acct-1');
  assert.equal(state.accounts.length, 1, 'backend failure keeps the account in view');
  assert.equal(calls[0][0], '/panel/api/accounts/acct-1/remove');
  assert.match(notices.at(-1), /DELETE FAILED/);

  response = {ok: true};
  await handler('acct-1');
  assert.equal(state.accounts.length, 0, 'successful backend delete updates the UI');
});

test('actual geometry refresh calls the component endpoint and treats partial results as failure state', async () => {
  const calls = [], notices = [], frameStates = [];
  const components = {balance: {ok: true}, usage: {ok: true}, errors: {ok: true}, packages: {ok: false}};
  const refresh = runFunction(
    functionSource('        async function triggerGlobalDataRefresh() {', '        document.getElementById(\'btn-refresh-all\')'),
    'triggerGlobalDataRefresh',
    {
      setPreviewFrameState: state => frameStates.push(state),
      soundscape: {triggerTileNote() {}}, IS_PROD_ENV: true,
      safeApiFetch: async (url, options) => { calls.push([url, options]); return {ok: true, components}; },
      syncOverviewData() {}, syncEgressData() {}, syncPackagesData() {}, syncLogsData() {},
      notifyEditorialStatus: value => notices.push(value),
      Promise, Object, pageTransition: {state: 'IN_PAGE'}, renderEditorialStage() {},
      setTimeout: fn => { fn(); return 1; },
    },
  );
  await refresh();
  assert.equal(calls[0][0], '/panel/api/refresh');
  assert.equal(calls.length, 5);
  assert.match(notices.at(-1), /packages/);
  assert.ok(frameStates.includes('error'), 'partial result must not flash success');
});

test('actual geometry music import validates files and commits only after persistence succeeds', async () => {
  const notices = [], calls = [];
  const original = {currentTab: 'music', musicList: [{id: 'existing'}]};
  const state = {customization: original};
  const nameInput = {value: 'New track'};
  let file = {name: 'track.mp3', type: 'audio/mpeg', size: 100};
  class Reader {
    readAsDataURL() { this.onload({target: {result: 'data:audio/mpeg;base64,AA=='}}); }
  }
  const save = runFunction(
    functionSource('        function saveCustomMusic() {', '        function selectCustomMusic(id) {'),
    'saveCustomMusic',
    {
      document: {getElementById: id => id === 'custom-music-name-input' ? nameInput : {files: [file]}},
      WBState: state, FileReader: Reader, Date, Promise, IS_PROD_ENV: true,
      safeApiFetch: async (...args) => { calls.push(args); return calls.length === 1 ? {ok: false} : {ok: true}; },
      notifyEditorialStatus: value => notices.push(value),
      soundscape: {triggerTileNote() {}}, renderEditorialStage() {}, syncDynamicBottomButtons() {},
      setPreviewFrameState() {}, setTimeout() {},
    },
  );
  file = {name: 'bad.txt', type: 'text/plain', size: 100};
  save();
  assert.equal(calls.length, 0, 'non-audio file is rejected before persistence');
  assert.equal(state.customization.musicList.length, 1);

  file = {name: 'track.mp3', type: 'audio/mpeg', size: 20 * 1024 * 1024};
  save();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(state.customization.musicList.length, 1, 'failed persistence leaves the list unchanged');
  assert.match(notices.at(-1), /SAVE FAILED/);

  save();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(state.customization.musicList.length, 2, 'successful persistence commits the imported track');
  assert.equal(state.customization.musicList[0].name, 'New track');
  assert.deepEqual(JSON.parse(calls[1][1].body).customization.musicList[0].name, 'New track');
});

test('embedded boot and audio contracts are tied to backend bootstrap and looping playback', () => {
  assert.match(html, /async function triggerBackendPreload()/);
  assert.match(html, /safeApiFetch\('\/api\/preload-bundle'/);
  assert.match(html, /backendPreloadSuccess/);
  assert.match(html, /const MAX_LOADING_WAIT_MS = 6000/);
  assert.match(html, /newAudio.loop = true/);
  assert.match(html, /audioGeneration/);
  assert.match(html, /SELECT A VALID AUDIO FILE/);
  assert.doesNotMatch(html, /10 \* 1024 \* 1024/);
  assert.match(html, /safeApiFetch\('\/panel\/api\/customization'/);
  assert.match(html, /AUDIO FILE COULD NOT BE VALIDATED/);
});
