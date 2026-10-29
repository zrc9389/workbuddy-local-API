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
  assert.match(markup,/熔断 —/); assert.doesNotMatch(markup,/熔断 undefined/);
  assert.match(markup,/\[启用\]/); assert.match(markup,/失败/); assert.match(markup,/未测速/);
  assert.doesNotMatch(markup,/>0ms</);
});

test('subscription import switches view 500ms after success without waiting for preload', async () => {
  const src=fs.readFileSync(new URL('./assets/geometric.js',import.meta.url),'utf8');
  const start=src.indexOf('        let _lastSubImportClickTime = 0;');
  const end=src.indexOf('        // Comment 2: 账号池兜底',start);
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
