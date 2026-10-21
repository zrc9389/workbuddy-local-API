import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM,mockAPI,flush} from './frontend_helpers_test.mjs';
const dom=setupDOM(),$=dom.$,client=await import('./assets/api.js');
const pool=Array.from({length:1003},(_,i)=>({uid:'uid-'+i,nickname:'用户 '+i,realm:i%2?'global':'cn',manual_disabled:i===0,system_blocked:i===1,balance_blocked:i===2,balance_known:i!==3,cool_remaining_sec:i===4?20:0,credits:i}));
const fakeButton=(dataset,disabled=false)=>({dataset,disabled,closest(){return this;}});

test('account cards have bounded pagination, explicit state precedence/reasons, no selection or old actions',async()=>{
 const table=await import('./assets/account-table.js'),rows=await import('./assets/account-rows.js');
 assert.equal(table.accountPage(pool).rows.length,25);assert.equal(table.accountPage(pool,{pageSize:99999}).rows.length,100);
 table.renderAccounts(pool);assert.equal(($('accBody').innerHTML.match(/data-account=/g)||[]).length,25);assert.doesNotMatch($('accBody').innerHTML,/checkbox|data-a="(?:revive|pause|resume|checkin|travel|tasks|disable)"/);
 await dom.click('accNext');assert.match($('accPageInfo').textContent,/2 \/ 41/);table.renderAccounts(pool.slice(0,1));assert.match($('accPageInfo').textContent,/1 \/ 1/);
 assert.equal(rows.accountState({manual_disabled:true,system_blocked:true,balance_blocked:true}).tone,'bad');assert.equal(rows.accountState({system_blocked:true}).tone,'warn');assert.equal(rows.accountState({balance_blocked:true,disabled:false}).tone,'warn');assert.equal(rows.accountState({cool_remaining_sec:2}).tone,'warn');assert.equal(rows.accountState({balance_known:false,credits:0}).tone,'ok');
 assert.match(rows.accountCard({uid:'a',manual_disabled:true}),/手动启用/);assert.match(rows.accountCard({uid:'a',balance_known:false,credits:0}),/余额未知/);assert.match(rows.accountCard({uid:'a',balance_known:true,credits:0}),/<strong>0<\/strong>/);
 assert.match(rows.accountCard({uid:'a',credits_total:-1}),/不限量/);assert.doesNotMatch(rows.accountCard({uid:'<unsafe>',nickname:'<script>'}),/<script>|data-u="<unsafe>"/);
});

test('manual enable/disable uses exact boolean endpoint and deletion confirms; unknown actions do nothing',async()=>{
 const table=await import('./assets/account-table.js'),actions=await import('./assets/account-actions.js');client.acceptSession({authenticated:true,csrf_token:'token'});let refreshes=0;
 let account={uid:'uid/one',manual_disabled:true,system_blocked:true};table.renderAccounts([account]);
 const calls=mockAPI(()=>({ok:true}));actions.bindAccountActions({refresh:async()=>{refreshes++;account={...account,manual_disabled:false};table.renderAccounts([account]);}});
 await dom.click('accBody',{a:'toggle',u:'uid/one'});assert.equal(calls[0].url,'/panel/api/accounts/uid%2Fone/toggle_disabled');assert.deepEqual(JSON.parse(calls[0].opts.body),{disabled:false});assert.equal(calls[0].opts.headers.get('X-CSRF-Token'),'token');assert.equal(refreshes,1);assert.match($('accBody').innerHTML,/state-warn/);
 globalThis.confirm=()=>false;await dom.click('accBody',{a:'remove',u:'uid/one'});assert.equal(calls.length,1);
 await dom.click('accBody',{a:'revive',u:'uid/one'});assert.equal(calls.length,1);globalThis.confirm=()=>true;await dom.click('accBody',{a:'remove',u:'uid/one'});assert.equal(calls.at(-1).url,'/panel/api/accounts/uid%2Fone/remove');
});

test('overview reflects actual demo flag and does not request packages, balance or maintenance',async()=>{
 const accounts=await import('./assets/accounts.js');const calls=mockAPI(()=>({demo:true,total:5,healthy:2,cooling:1,disabled:1,accounts:pool.slice(0,5),version:'0.2',uptime_sec:60}));await accounts.loadOverview();assert.equal($('demoNotice').hidden,false);assert.equal($('sTotal').textContent,5);assert.deepEqual(calls.map(c=>c.url),['/panel/api/overview']);
 accounts.reflectOverview({demo:false,accounts:[]});assert.equal($('demoNotice').hidden,true);
});

test('four-job page keeps account outcomes collapsed and reveals only failures on demand',async()=>{
 const tasks=await import('./assets/tasks.js');client.acceptSession({authenticated:true,csrf_token:'token'});let status={run_id:'run-1',running:false,steps:[{name:'token',state:'done',completed:1,failed:1,accounts:[{uid:'<uid>',state:'done',message:'ok'},{uid:'bad',state:'failed',message:'<upstream error>'}]}]};
 let posts=0;const calls=mockAPI((url,opts)=>{if(opts.method==='POST'){posts++;status={...status,running:true};return {status:409,body:{error:'already running'}};}return status;});
 await tasks.loadTasks();assert.equal(($('maintenanceJobs').innerHTML.match(/class="job-card"/g)||[]).length,4);assert.doesNotMatch($('maintenanceJobs').innerHTML,/&lt;upstream error&gt;/);assert.match($('maintenanceJobs').innerHTML,/已完成/);assert.match($('maintenanceJobs').innerHTML,/查看 1 项失败/);assert.match($('maintenanceJobs').innerHTML,/has-failures/);
 await $('maintenanceJobs').fire('click',{target:{closest:()=>({dataset:{failures:'token'}})}});assert.match($('taskFailureBody').innerHTML,/&lt;upstream error&gt;/);assert.doesNotMatch($('taskFailureBody').innerHTML,/<upstream error>/);
 await dom.click('btnRunAll');assert.equal(posts,1);assert.equal($('btnRunAll').disabled,true);await dom.click('btnRunAll');assert.equal(posts,1);assert.equal(calls.find(c=>c.opts.method==='POST').url,'/panel/api/maintenance/run');assert.equal(calls.find(c=>c.opts.method==='POST').opts.body,'{}');assert.ok(calls.every(c=>/maintenance\/(run|status)$/.test(c.url)));
 status={...status,running:false};await tasks.loadTasks();assert.equal($('btnRunAll').disabled,false);
 const markup=tasks.maintenanceMarkup({steps:[{name:'travel',state:'cancelled',accounts:pool.map(a=>({uid:a.uid,state:'skipped',message:'skip'}))}]});assert.doesNotMatch(markup,/class="job-account"/);assert.match(markup,/已取消/);assert.match(markup,/跳过 1003/);
});

test('Meta view is read-only; opening reads cached nodes/tests without POST and only the explicit test action starts a job',async()=>{
 const egress=await import('./assets/egress.js');client.acceptSession({authenticated:true,csrf_token:'token'});let running=false;let bound=[];
 const nodes=[{id:'n1',name:'<node>',status:'ok',delay_ms:41},{id:'n2',name:'B',status:'timeout'},{id:'n3',name:'C',status:'error'},{id:'n4',name:'D',status:'testing'},{id:'n5',name:'E',status:'untested'}];
 const calls=mockAPI((url,opts)=>{
  if(url.endsWith('meta/status'))return{available:true,running:true};if(url.endsWith('meta/nodes'))return{nodes,bindings:bound};if(url.endsWith('meta/stats'))return{upload_total:1024,download_total:2048,upload_speed:10,download_speed:20,estimated:true};if(url.endsWith('/overview'))return{accounts:[{uid:'acct'}]};
  if(url.endsWith('meta/tests')){if(opts.method==='POST')running=true;return{id:'t1',running,total:5,completed:running?1:5,failed:2};}if(url.endsWith('/bind')){bound=[{uid:'acct',node:JSON.parse(opts.body).node}];return{ok:true};}throw new Error(url);
 });
 await egress.loadEgress();assert.ok(calls.every(c=>c.opts.method==='GET'));assert.match($('trafficDownload').textContent,/2.00 KB/);
 await egress.openNodeModal('acct');assert.ok(calls.every(c=>c.opts.method==='GET'));assert.deepEqual(calls.slice(-2).map(c=>c.url).sort(),['/panel/api/meta/nodes','/panel/api/meta/tests']);assert.equal(dom.intervals.size,0);
 const html=$('nodeList').innerHTML;assert.match(html,/data-test-nodes/);assert.match(html,/&lt;node&gt;<\/strong><span[^>]+>41 ms/);for(const state of ['超时','测试失败','测试中','未测试'])assert.ok(html.includes(state),state);assert.doesNotMatch(html,/<node>/);
 const testButton=fakeButton({testNodes:''});await $('nodeList').fire('click',{target:{closest:selector=>selector==='button[data-test-nodes]'?testButton:null}});assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);const started=calls.find(c=>c.opts.method==='POST');assert.equal(started.url,'/panel/api/meta/tests');assert.equal(started.opts.body,'{}');assert.equal(dom.intervals.size,1);assert.match($('nodeList').innerHTML,/测试进行中/);
 await $('nodeList').fire('click',{target:{closest:selector=>selector==='button[data-test-nodes]'?fakeButton({testNodes:''},true):null}});assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);
 running=false;await egress.pollNodeTests();assert.equal(dom.intervals.size,0);assert.match($('nodeList').innerHTML,/data-test-nodes[^>]*>重新测试延迟/);assert.doesNotMatch($('nodeList').innerHTML,/data-test-nodes[^>]*disabled/);egress.closeNodeModal();
 egress.closeNodeModal();assert.equal(dom.shell.inert,false);assert.equal(dom.intervals.size,0);
 assert.equal(egress.nodeLatency({status:'ok',delay_ms:42}).text,'42 ms');assert.equal(egress.formatBytes(undefined),'—');
});

test('Meta modal binds the selected account only on explicit action and verifies the binding through a read-back',async()=>{
 const egress=await import('./assets/egress.js');client.acceptSession({authenticated:true,csrf_token:'token'});let bound=[];
 const nodes=[{id:'n1',name:'A',status:'untested'},{id:'n2',name:'B',status:'untested'}];
 const calls=mockAPI((url,opts)=>{
  if(url.endsWith('meta/status'))return{available:true,running:false};if(url.endsWith('meta/nodes'))return{nodes,bindings:bound};if(url.endsWith('meta/stats'))return{};if(url.endsWith('/overview'))return{accounts:[{uid:'acct'}]};
  if(url.endsWith('meta/tests'))return{id:'t-done',running:false,total:2,completed:2,failed:0};if(url.endsWith('/bind')){bound=[{uid:'acct',node:JSON.parse(opts.body).node}];return{ok:true,binding:bound[0]};}throw new Error(url);
 });
 await egress.openNodeModal('acct');assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);assert.match($('nodeList').innerHTML,/data-bind-node="n1"/);
 const before=calls.length;await $('nodeList').fire('click',{target:{closest:selector=>selector==='button[data-test-nodes]'?null:fakeButton({bindNode:'n1'})}});const bindCalls=calls.slice(before);assert.equal(bindCalls.length,2);assert.equal(bindCalls[0].url,'/panel/api/meta/accounts/acct/bind');assert.deepEqual(JSON.parse(bindCalls[0].opts.body),{node:'n1'});assert.equal(bindCalls[1].url,'/panel/api/meta/nodes');assert.equal(bindCalls[1].opts.method,'GET');
 const html=$('nodeList').innerHTML;assert.match(html,/data-bind-node="n1"[^>]*aria-pressed="true"[^>]*disabled/);assert.match(html,/当前账号出口/);assert.match($('egressAccounts').innerHTML,/B|A/);egress.closeNodeModal();
});

test('cached running tests never start polling until the explicit test action is used',async()=>{
 const egress=await import('./assets/egress.js');client.acceptSession({authenticated:true,csrf_token:'token'});
 let posted=false;
 const calls=mockAPI((url,opts)=>{
  if(url.endsWith('/nodes'))return{nodes:[{id:'n1',name:'A',status:'testing'}],bindings:[]};
  if(url.endsWith('meta/tests')){if(opts.method==='POST')posted=true;return{id:'cached',running:true,total:1,completed:0,failed:0};}
  return{};
 });
 await egress.openNodeModal();assert.equal(posted,false);assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);assert.equal(dom.intervals.size,0);assert.match($('nodeStatus').textContent,/测试中/);
 await $('nodeList').fire('click',{target:{closest:selector=>selector==='button[data-test-nodes]'?fakeButton({testNodes:''}):null}});assert.equal(posted,true);assert.equal(dom.intervals.size,1);
 egress.closeNodeModal();assert.equal(dom.intervals.size,0);
});

test('closing the modal during a manual test request prevents late POST results from rendering',async()=>{
 const egress=await import('./assets/egress.js');client.acceptSession({authenticated:true,csrf_token:'token'});let release;
 const calls=mockAPI(async(url,opts)=>{
  if(url.endsWith('/nodes'))return{nodes:[{id:'n1',name:'A',status:'untested'}],bindings:[]};
  if(url.endsWith('meta/tests')&&opts.method==='POST'){await new Promise(done=>{release=done;});return{id:'late',running:true,total:1,completed:0,failed:0};}
  if(url.endsWith('meta/tests'))return{id:'old',running:false,total:1,completed:1,failed:0};
  return{};
 });
 await egress.openNodeModal();const before=$('nodeStatus').textContent;
 const pending=$('nodeList').fire('click',{target:{closest:selector=>selector==='button[data-test-nodes]'?fakeButton({testNodes:''}):null}});
 await flush();assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);
 egress.closeNodeModal();release();await pending;
 assert.equal($('nodeStatus').textContent,before);assert.doesNotMatch($('nodeStatus').textContent,/测试中/);assert.equal(dom.intervals.size,0);assert.equal(dom.shell.inert,false);
});

test('Meta 409 attaches the current job, unavailable core is explicit, close prevents stale polling updates',async()=>{
 const egress=await import('./assets/egress.js');let postStatus=409;
 const calls=mockAPI((url,opts)=>opts.method==='POST'?{status:postStatus,body:{error:'core unavailable'}}:url.endsWith('/nodes')?{nodes:[{id:'n1',name:'A',status:'untested'}],bindings:[]}:{id:'existing',running:false,total:0,completed:0,failed:0});
 await egress.openNodeModal();assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);assert.match($('nodeStatus').textContent,/已完成/);assert.equal(dom.intervals.size,0);
 const testButton=fakeButton({testNodes:''});await $('nodeList').fire('click',{target:{closest:selector=>selector==='button[data-test-nodes]'?testButton:null}});assert.equal(calls.filter(c=>c.opts.method==='POST').length,1);assert.match($('nodeStatus').textContent,/已完成/);assert.equal(dom.intervals.size,0);
 const beforeRetry=calls.length;await $('nodeList').fire('click',{target:{closest:selector=>selector==='button[data-test-nodes]'?fakeButton({testNodes:''}):null}});const retryCalls=calls.slice(beforeRetry);assert.deepEqual(retryCalls.map(c=>c.opts.method+':'+c.url),['POST:/panel/api/meta/tests','GET:/panel/api/meta/tests']);assert.match($('nodeStatus').textContent,/已完成/);assert.equal($('nodeError').textContent,'');
 egress.closeNodeModal();const before=$('nodeList').innerHTML;await egress.pollNodeTests();assert.equal($('nodeList').innerHTML,before);
});

test('Meta really uses the pinned upstream trend helper without claiming the full dashboard',async()=>{
 const egress=await import('./assets/egress.js'),helper=await import('../../third_party/meta/metacubexd/latency-trend.js');
 const html=egress.nodeTrendHTML([{delay:20},{delay:0},{delay:40}],helper);assert.match(html,/metacubexd 延迟趋势组件/);assert.match(html,/viewBox="0 0 100 50"/);assert.match(html,/M 0 45 L 100 5/);assert.equal(egress.nodeTrendHTML([{delay:0},{delay:20}],helper),'');
});

test('model context overrides preserve enabled state and read back zero to restore upstream display',async()=>{
 const policy=await import('./assets/model-policy.js');let saved={disabled:true,context_length:1000000};const calls=mockAPI((_url,opts)=>{if(opts.method==='POST')saved=JSON.parse(opts.body);return{models:{'test-model':saved}};});
 await policy.loadModelPolicy();assert.equal(policy.displayContext({id:'test-model',context_length:128000}),1000000);policy.bindModelPolicy(()=>{});policy.openContextEditor('test-model');$('modelContextValue').value='0';await $('modelContextForm').onsubmit({preventDefault(){}});
 assert.deepEqual(JSON.parse(calls.find(c=>c.opts.method==='POST').opts.body),{id:'test-model',disabled:true,context_length:0});assert.equal(policy.displayContext({id:'test-model',context_length:128000}),128000);
});
