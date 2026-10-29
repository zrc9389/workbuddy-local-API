import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./assets/geometric.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
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

test('expiry cursor keeps its last selected point on mouseout and redraw', () => {
  const state = {packageModelHoverIdx: -1};
  const line = {attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }};
  const readout = {textContent: ''};
  const points = [{day: 1, survival: 90, expAcc: 1, packs: 2, x: 40}, {day: 3, survival: 80, expAcc: 2, packs: 3, x: 110}];
  const handler = runFunction(functionSource('    window.hoverPackageModelPoint = (idx) => {', '    window.hoverAccountModelPoint = (idx) => {'), 'window.hoverPackageModelPoint', {
    window: {}, WBState: state, getWeibullModelPoints: () => points,
    document: {getElementById: id => id === 'pkg-model-cursor' ? line : readout}, setVertexHover() {}, Number,
  });
  handler(0);
  handler(-1);
  assert.equal(state.packageModelHoverIdx, 0);
  assert.equal(line.attrs.x1, 40);
  assert.match(readout.textContent, /1天/);
  assert.match(html, /points[Math.max(0, Math.min(points.length - 1, WBState.packageModelHoverIdx))]/);
});

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
      feedbackTarget: null,
      beginActionFeedback: () => { frameStates.push('busy'); return state => frameStates.push(state); },
      setPreviewFrameState: state => frameStates.push(state),
      soundscape: {triggerTileNote() {}}, IS_PROD_ENV: true,
      safeApiFetch: async (url, options) => { calls.push([url, options]); return {ok: true, components}; },
      syncOverviewData() {}, syncEgressData() {}, syncPackagesData() {}, syncLogsData() {}, syncUsageData() {},
      notifyEditorialStatus: value => notices.push(value),
      Promise, Object, pageTransition: {state: 'IN_PAGE'}, renderEditorialStage() {},
      setTimeout: fn => { fn(); return 1; },
    },
  );
  await refresh();
  assert.equal(calls[0][0], '/panel/api/refresh');
  assert.equal(calls.length, 6);
  assert.ok(calls.some(([url]) => url === '/panel/api/usage?hours=24'));
  assert.match(notices.at(-1), /packages/);
  assert.ok(frameStates.includes('error'), 'partial result must not flash success');
});

test('maintenance results escape markup and avoid repainting unchanged state', () => {
  const frames = [];
  const state = {currentChapter:'tasks', accounts: [{uid: 'test-uid', name: 'Test Account', region: 'CN'}], tasks: {running: false}};
  const sync = runFunction(
    functionSource('        let maintenanceFingerprint =', '        async function triggerBackendPreload() {'),
    '({ syncMaintenanceData, escapeDisplayText })', {WBState: state, JSON, String, Math, setPreviewFrameState: value => frames.push(value)},
  );
  const payload = {running: false, paused: false, steps: [{name: 'checkin', state: 'failed', total: 1, failed: 1, accounts: [{uid: 'test-uid', state: 'failed', message: '<img src=x onerror=alert(1)>'}]}]};
  assert.equal(sync.syncMaintenanceData(payload), true);
  assert.equal(sync.syncMaintenanceData(payload), false);
  assert.equal(state.tasks.steps[0].failures[0].region, 'CN');
  assert.equal(sync.escapeDisplayText(state.tasks.steps[0].failures[0].reason), '&lt;img src=x onerror=alert(1)&gt;');
  sync.syncMaintenanceData({...payload, running: true});
  sync.syncMaintenanceData(payload);
  assert.deepEqual(frames, ['error', 'error', 'error']);
});

test('maintenance start reports conflict and authentication failures distinctly', async () => {
  const notices = [];
  let statusCode = 409;
  let synced = null;
  const start = runFunction(
    functionSource('        let maintenanceStarting = false;', '        function runFourStepPipeline() {'),
    'startMaintenance',
    {
      window: {}, csrfToken: 'csrf', AbortSignal,
      fetch: async () => ({status: statusCode, ok: false}),
      safeApiFetch: async () => ({running: true, steps: []}),
      syncMaintenanceData: value => { synced = value; },
      renderEditorialStage() {}, notifyEditorialStatus: value => notices.push(value),
    },
  );
  await start();
  assert.equal(synced.running, true);
  assert.match(notices.at(-1), /正在运行/);
  statusCode = 403;
  await start();
  assert.match(notices.at(-1), /重新登录/);
});

test('embedded boot and audio contracts are tied to backend bootstrap and looping playback', () => {
  assert.match(html, /async function triggerBackendPreload()/);
  assert.match(html, /safeApiFetch\('\/api\/preload-bundle'/);
  assert.match(html, /backendPreloadSuccess/);
  assert.match(html, /const MAX_LOADING_WAIT_MS = 6000/);
  assert.match(html, /newAudio.loop = false/);
  assert.match(html, /audioGeneration/);
  assert.match(html, /ENTER A NAME AND SELECT AN AUDIO FILE/);
  assert.doesNotMatch(html, /10 \* 1024 \* 1024/);
  assert.match(html, /safeApiFetch\('\/panel\/api\/customization'/);
  assert.ok(html.includes('MUSIC // SAVE FAILED'));
});

test('music upload retains the previous state on failure and sends the original file', async () => {
  const calls = [], notices = [];
  const file = {name:'track.FLAC', type:'', size:30 * 1024 * 1024};
  const state = {customization:{musicList:[{id:'m-default'}], activeMusicId:'m-default', randomMusic:false, isAdding:true}};
  let success = false;
  const save = runFunction(functionSource('        let musicQueue =', '        async function saveCustomSlogan()'), 'saveCustomMusic', {
    document:{getElementById:id => id === 'custom-music-name-input' ? {value:'新音频'} : {files:[file]}},
    WBState:state, Promise, encodeURIComponent, setTimeout: fn => fn(),
    safeApiFetch: async (...args) => { calls.push(args); return success ? {musicList:[{id:'new'}],activeMusicId:'m-default',randomMusic:false} : null; },
    beginActionFeedback: () => () => {}, setPreviewFrameState(){}, notifyEditorialStatus: value => notices.push(value), soundscape:{triggerTileNote(){}},
    updateEditorialKeyFigures(){},renderEditorialStage(){},syncDynamicBottomButtons(){}
  });
  await save(); assert.equal(state.customization.musicList[0].id,'m-default'); assert.match(notices.at(-1),/SAVE FAILED/);
  success=true; await save(); assert.equal(state.customization.musicList[0].id,'new');
  assert.equal(calls[1][1].body,file); assert.equal(calls[1][1].headers['Content-Type'],'audio/flac');
});


test('shared action feedback follows outcomes and ignores stale concurrent results', () => {
  const states = [], timers = [], listeners = {};
  const classes = () => { const values = new Set(); return {values, add: x => values.add(x), remove: (...xs) => xs.forEach(x => values.delete(x))}; };
  const row = {classList: classes()};
  const button = {classList: classes(), closest: () => row};
  const helper = runFunction(
    functionSource('        let feedbackTarget = null;', '        window.setPreviewFrameState = setPreviewFrameState;'),
    'beginActionFeedback',
    {document: {addEventListener: (name, fn) => { listeners[name] = fn; }}, setPreviewFrameState: state => states.push(state), setTimeout: fn => timers.push(fn)}
  );
  const first = helper(button);
  assert.ok(button.classList.values.has('action-feedback-busy'));
  const second = helper(button);
  first('error');
  assert.ok(button.classList.values.has('action-feedback-busy'));
  assert.deepEqual(states, ['busy', 'busy']);
  second('success');
  assert.ok(row.classList.values.has('action-feedback-success'));
  assert.equal(states.at(-1), 'success');
  timers.forEach(fn => fn());
  assert.equal(button.classList.values.size, 0);
});

test('isolated account enable failure shows error without changing state', async () => {
  const notices = [], frames = [], account = {uid:'u', manualOn:false, state:'BLOCKED'};
  const window = {};
  const handler = runFunction(functionSource('window.toggleAccountManual = async (uid) => {', '            window.bindAccountEgress = async'), 'window.toggleAccountManual', {
    window, WBState:{accounts:[account]}, safeApiFetch:async () => null,
    beginActionFeedback: () => x => frames.push(x), notifyEditorialStatus:x => notices.push(x), encodeURIComponent,
  });
  await handler('u');
  assert.equal(account.manualOn, false);
  assert.equal(frames[0], 'error');
  assert.match(notices[0], /重新授权/);
});

test('credential import submits JSON and only closes after success', async () => {
  const window = {}, input = {value:'{"uid":"fake","accessToken":"fake"}'}, calls = [], notices = [];
  const state = {accountSubmode:'INGEST'};
  let result = null;
  const handler = runFunction(functionSource('window.importFromPastedCallbackUrl = async () => {\n                const input', '            window.probeSingleNode = '), 'window.importFromPastedCallbackUrl', {
    window, document:{getElementById:()=>input}, WBState:state, JSON, setTimeout: fn => fn(),
    safeApiFetch:async (...args)=>{calls.push(args); return result}, beginActionFeedback: () => () => {},
    notifyEditorialStatus:x=>notices.push(x), loadAuthenticatedPanelData:async()=>{}, renderEditorialStage(){},
  });
  await handler();
  assert.equal(state.accountSubmode,'INGEST');
  assert.match(notices.at(-1),/失败/);
  result = {ok:true};
  await handler();
  assert.equal(calls[0][0], '/panel/api/accounts/import');
  assert.equal(state.accountSubmode,null);
  assert.equal(input.value,'');
});

test('feedback rebinds to the same node after redraw and finishes on the new element', () => {
  const states = [], timers = [], candidates = [];
  const classes = () => { const values = new Set(); return {values, add: x => values.add(x), remove: (...xs) => xs.forEach(x => values.delete(x))}; };
  const make = id => ({dataset:{action:'probe-node', nodeId:id}, classList:classes(), closest:()=>null});
  const old = make('a'), unrelated = make('b'), next = make('a');
  const helper = runFunction(functionSource('        let feedbackTarget = null;', '        window.setPreviewFrameState = setPreviewFrameState;'), 'beginActionFeedback', {
    document:{addEventListener(){}, querySelectorAll:()=>candidates}, setPreviewFrameState:x=>states.push(x), setTimeout:fn=>timers.push(fn)
  });
  const finish = helper(old);
  candidates.push(unrelated, next);
  finish.rebind();
  assert.ok(next.classList.values.has('action-feedback-busy'));
  assert.equal(unrelated.classList.values.size, 0);
  finish('error');
  assert.ok(next.classList.values.has('action-feedback-error'));
  assert.equal(states.at(-1), 'error');
  timers.forEach(fn=>fn());
  assert.equal(next.classList.values.size, 0);
});

test('node batch keeps its large button unchanged and ring reflects actual bound timeouts', async () => {
  const frames=[], feedback=[];
  const state={egressTab:'NODES',nodes:[],_egressRefreshing:false};
  let nodes=[{id:'ok',status:'ok',binding_count:1},{id:'bad',status:'timeout',binding_count:0}];
  const refresh=runFunction(functionSource('        async function refreshEgressView(', '        function handleViewportScaleSync()'), 'refreshEgressView', {
    WBState:state, setPreviewFrameState:x=>frames.push(x), beginActionFeedback:()=>{feedback.push('paint'); const f=(...v)=>feedback.push(v);f.rebind=()=>{};return f},
    safeApiFetch:async url=>url.endsWith('/tests')?{id:'job',running:false,total:2,completed:2,failed:1}: {nodes},
    syncEgressData:data=>{state.nodes=data.nodes.map(n=>({...n,timeout:n.status==='timeout',bindingCount:n.binding_count}))},
    notifyEditorialStatus(){},renderEditorialStage(){},loadAuthenticatedPanelData:async()=>{},setTimeout,Promise
  });
  await refresh(); assert.deepEqual(frames,['busy','success']); assert.equal(feedback.length,0);
  nodes=[{id:'ok',status:'ok',binding_count:1},{id:'bad',status:'timeout',binding_count:1}];
  await refresh(); assert.equal(frames.at(-1),'error'); assert.equal(feedback.length,0);
  nodes=[{id:'ok',status:'ok',binding_count:0},{id:'bad',status:'error',binding_count:1}];
  await refresh(); assert.equal(frames.at(-1),'error'); assert.equal(feedback.length,0);
});

test('audio picker reports pending, selection and cancellation', () => {
  const events = [], listeners = new Map();
  const input = {files:[], addEventListener:(name,fn)=>listeners.set(name,fn), removeEventListener:name=>listeners.delete(name), click(){events.push('open')}};
  const name = {value:'', textContent:'', className:''};
  const api = runFunction(functionSource('        let finishMusicPicker = null;', '        let musicQueue = Promise.resolve();'), '({openCustomMusicPicker, handleCustomMusicFileSelected})', {
    document:{getElementById:()=>name}, beginActionFeedback:()=>{events.push('busy'); return x=>events.push(x)}
  });
  api.openCustomMusicPicker({}, input);
  assert.deepEqual(events,['busy','open']);
  listeners.get('cancel')();
  assert.equal(events.at(-1),'idle');
  api.openCustomMusicPicker({},input);
  input.files=[{name:'track.mp3'}];
  api.handleCustomMusicFileSelected(input);
  assert.equal(events.at(-1),'success');
  assert.equal(name.value,'track');
  assert.equal(listeners.has('cancel'),false);
});

test('update check and apply reflect actual asynchronous outcomes', async () => {
  const state = {currentChapter:'sphere', sphereUpdateReady:false, sphereUpdating:false};
  const classes = new Set(), frames = [], timers = [], requests = [];
  const button = {classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)), remove:(...xs)=>xs.forEach(x=>classes.delete(x))}, addEventListener:(_type,fn)=>button.handler=fn};
  let resolveRequest;
  const source = functionSource("        document.getElementById('btn-page-chord').addEventListener('click', () => {", '// second ch removed') + '});';
  runFunction(source, 'null', {document:{getElementById:()=>button}, WBState:state, soundscape:{triggerTileNote(){}}, notifyEditorialStatus(){}, syncDynamicBottomButtons(){}, setPreviewFrameState:x=>frames.push(x),
    safeApiFetch:(...args)=>{requests.push(args); return new Promise(resolve=>resolveRequest=resolve)},
    setTimeout:fn=>{timers.push(fn)}, Promise, Error, location:{reload(){}}
  });
  button.handler();
  assert.equal(state.sphereCheckingUpdate,true);
  assert.equal(frames.at(-1),'busy');
  resolveRequest({has_update:true,current_version:'1',latest_version:'2',data:{artifact:{verified:true}}});
  timers.shift()();
  for (let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.sphereUpdateReady,true);
  assert.equal(frames.at(-1),'success');
  button.handler();
  assert.equal(state.sphereUpdating,true);
  assert.equal(frames.at(-1),'busy');
  assert.equal(requests[1][2],0x7fffffff);
  resolveRequest({ok:false});
  for (let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.sphereUpdating,false);
  assert.equal(frames.at(-1),'error');
  assert.ok(classes.has('border-rose-500'));
});
