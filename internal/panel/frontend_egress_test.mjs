import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './frontend_helpers_test.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

test('egress binds by node ID and refreshes subscriptions individually', async () => {
  const dom = setupDOM();
  dom.Element.prototype.getContext = () => ({fillRect(){}, clearRect(){}, beginPath(){}, stroke(){}, fill(){}, moveTo(){}, lineTo(){}, arc(){}, save(){}, restore(){}, setTransform(){}, resetTransform(){}, scale(){}, translate(){}, drawImage(){}, measureText(){return {width:10}}, fillText(){}, strokeText(){}, createImageData(){return {data:[]}}, getImageData(){return {data:[]}}, putImageData(){}, setLineDash(){}, strokeRect(){}});
  dom.Element.prototype.blur = () => {};
  globalThis.window = globalThis;
  globalThis.location = {protocol:'http:', pathname:'/panel/', port:'7863', origin:'http://127.0.0.1:7863'};
  globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.csrfToken = 'fixture';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url, options});
    let body = {ok:true};
    if (url.endsWith('/meta/nodes')) body = {nodes:[{id:'one',name:'other/原名',provider:'p1'},{id:'two',name:'p2/🇺🇸美国04/推荐',display_name:'🇺🇸美国04/推荐',provider:'p2'}],bindings:[{uid:'a',node:'two'}]};
    if (url.endsWith('/meta/subscriptions') && !options.method) body = {subscriptions:[]};
    if (url.endsWith('/customization')) body = null;
    if (url.endsWith('/meta/tests')) body = {id:'fixture-job',running:false,completed:2,failed:0};
    return {status:200,ok:true,json:async()=>body};
  };
  const module = await import('./assets/geometric.js');
  const state = globalThis.WBState;
  state.nodes = [{id:'one',name:'same'},{id:'two',name:'same'}];
  state.accounts = [{uid:'a',name:'fixture',egress:'—'}];
  await globalThis.bindAccountEgress('a','two');
  const bind = calls.find(c=>c.url.endsWith('/meta/accounts/a/bind'));
  assert.equal(JSON.parse(bind.options.body).node, 'two');
  assert.equal(state.accounts[0].egressNodeId, 'two');
  assert.equal(state.nodes[0].name, 'other/原名');
  assert.equal(state.nodes[1].name, '🇺🇸美国04/推荐');
  assert.equal(state.nodes[1].id, 'two');
  state.currentChapter = 'egress'; state.egressTab = 'SUBS'; state.importingSub = false;
  state.subscriptions = [{id:'p1'},{id:'p2'}];
  await dom.$('btn-page-chord').fire('click');
  for (let i=0;i<20;i++) await new Promise(resolve=>setImmediate(resolve));
  const refreshes = calls.filter(c=>c.url.endsWith('/meta/subscriptions') && c.options.method === 'POST').map(c=>JSON.parse(c.options.body));
  assert.deepEqual(refreshes, [{action:'refresh',id:'p1'},{action:'refresh',id:'p2'}]);
  assert.ok(!calls.some(c=>c.url.endsWith('/meta/tests')));
  globalThis.confirm = () => true;
  await globalThis.deleteSubscription('p1');
  await globalThis.refreshSingleSub('p2');
  const actions = calls.filter(c=>c.url.endsWith('/meta/subscriptions') && c.options.method === 'POST').map(c=>JSON.parse(c.options.body));
  assert.deepEqual(actions.slice(-2), [{action:'delete',id:'p1'},{action:'refresh',id:'p2'}]);
  state.egressTab = 'NODES';
  await dom.$('btn-page-chord').fire('click');
  for (let i=0;i<10;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.ok(calls.some(c=>c.url.endsWith('/meta/tests') && c.options.method === 'POST'));
  assert.equal(state.accounts[0].egressNodeId, 'two');
  await globalThis.probeSingleNode('two');
  const jobs = calls.filter(c=>c.url.endsWith('/meta/tests') && c.options.method === 'POST');
  assert.deepEqual(JSON.parse(jobs.at(-1).options.body), {node:'two'});
  const count = jobs.length;
  await globalThis.probeSingleNode('missing');
  assert.equal(calls.filter(c=>c.url.endsWith('/meta/tests') && c.options.method === 'POST').length, count);
  state.nodes.push({id:'timed-out',name:'timeout',timeout:true,status:'timeout'});
  const beforeBind = calls.filter(c=>c.url.includes('/bind')).length;
  await globalThis.bindAccountEgress('a','timed-out');
  assert.equal(calls.filter(c=>c.url.includes('/bind')).length, beforeBind);
  state.currentChapter='accounts'; state.selectedAccountUid='a'; state.accountNodePage=0;
  Object.assign(state.accounts[0], {state:'BLOCKED',blocked:true,manualOn:false,region:'CN',balance:100,quota:100,egress:'—'});
  state.nodes=[{id:'err',name:'failed-node',status:'error',ping:0,timeout:false}, {id:'new',name:'new-node',status:'untested',ping:0,timeout:false}];
  module.bootGeometricRuntime();
  globalThis.renderEditorialStage(false);
  const markup=dom.$('editorial-stage-body').innerHTML;
  assert.doesNotMatch(markup,/熔断/);
  assert.match(markup,/\[启用\]/); assert.match(markup,/超时/); assert.match(markup,/未测速/);
  assert.doesNotMatch(markup,/>0ms</);
});

test('subscription import switches view 500ms after success without waiting for preload', async () => {
  const src=fs.readFileSync(new URL('./assets/geometric.js',import.meta.url),'utf8');
  const start=src.indexOf('        let _lastSubImportClickTime = 0;');
  const end=src.indexOf('        let _lastOAuthImportClickTime = 0;',start);
  assert.ok(start>=0 && end>start);
  const timers=[]; const renders=[];
  const elem=value=>({value,style:{},classList:{add(){},remove(){}},addEventListener(){},removeEventListener(){},focus(){},offsetWidth:0});
  const inputs={'inp-sub-name':elem('fixture'), 'inp-sub-url':elem('https://example.test/sub')};
  const state={_isPullingSub:false,importingSub:true,egressTab:'NODES',currentChapter:'egress'};
  const context={window:{},WBState:state,IS_PROD_ENV:true,URL,Date,document:{getElementById:id=>inputs[id]},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},
    safeApiFetch:async()=>({ok:true}),setPreviewFrameState(){},notifyEditorialStatus(){},
    renderEditorialStage:()=>renders.push(state.egressTab),loadAuthenticatedPanelData:()=>new Promise(()=>{}),
    soundscape:{triggerTileNote(){}}};
  vm.runInNewContext(src.slice(start,end),context);
  const pending=context.window.confirmImportSub();
  const yellow=timers.find(t=>t.ms===350); assert.ok(yellow); yellow.fn();
  await pending;
  const green=timers.find(t=>t.ms===500); assert.ok(green);
  assert.equal(state.importingSub,true);
  green.fn();
  assert.equal(state.importingSub,false); assert.equal(state.egressTab,'SUBS');
  assert.deepEqual(renders,['SUBS']);
});

test('egress 409 conflict prompts confirm and retries with force, and renders egress warnings', async () => {
  const state = globalThis.WBState;
  state.nodes = [
    {id:'n1', name:'HK-01', subId:'p1', bindingCount: 1, ping: 42, status: 'ok', timeout: false, trend: [40, 42]},
  ];
  state.accounts = [
    {uid:'acct-a', name:'Account A', egress:'HK-01', egressNodeId:'n1'},
    {uid:'acct-b', name:'Account B', egress:'—', egressNodeId:''},
  ];
  state.activeSubId = 'p1';
  const bindPayloads = [];
  const confirmMessages = [];
  let allowConfirm = false;
  globalThis.confirm = (msg) => {
    confirmMessages.push(msg);
    return allowConfirm;
  };
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/meta/accounts/acct-b/bind')) {
      const payload = JSON.parse(options.body);
      bindPayloads.push(payload);
      if (!payload.force) {
        return {
          status: 409,
          ok: false,
          json: async () => ({
            error: 'node already bound to another account',
            code: 'node_already_bound',
            node: 'n1',
            conflict_uids: ['acct-a'],
          }),
        };
      }
      return {status: 200, ok: true, json: async () => ({ok: true})};
    }
    if (url.endsWith('/meta/nodes')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          nodes: [{id:'n1', name:'p1/HK-01', display_name:'HK-01', provider:'p1', binding_count: 2, status:'ok', delay_ms: 42}],
          bindings: [{uid:'acct-a', node:'n1'}, {uid:'acct-b', node:'n1'}],
        }),
      };
    }
    if (url.endsWith('/panel/api/egress')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          accounts: [],
          groups: [],
          subnet_groups: [{subnet:'203.0.113.0/24', count: 2, uids:['acct-a','acct-b'], ips:['203.0.113.7','203.0.113.8']}],
          warnings: [{type:'same_subnet', key:'203.0.113.0/24', count: 2, uids:['acct-a','acct-b'], message:'2 个账号位于同一网段 203.0.113.0/24'}],
        }),
      };
    }
    return {status: 200, ok: true, json: async () => ({ok: true})};
  };

  // User cancels confirm -> no second force request
  allowConfirm = false;
  await globalThis.bindAccountEgress('acct-b', 'n1');
  assert.equal(bindPayloads.length, 1);
  assert.deepEqual(bindPayloads[0], {node: 'n1'});
  assert.equal(confirmMessages.length, 1);
  assert.match(confirmMessages[0], /acct-a/);

  // User confirms -> retries with force: true and syncs warnings
  allowConfirm = true;
  await globalThis.bindAccountEgress('acct-b', 'n1');
  assert.equal(bindPayloads.length, 3);
  assert.deepEqual(bindPayloads[2], {node: 'n1', force: true});
  assert.equal(state.accounts[1].egressNodeId, 'n1');
  assert.equal(state.egressWarnings.length, 1);
  assert.equal(state.egressWarnings[0].type, 'same_subnet');
});
