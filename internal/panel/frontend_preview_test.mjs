import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM,mockAPI,flush} from './frontend_helpers_test.mjs';
const dom=setupDOM(),$=dom.$;
const calls=mockAPI(url=>{
 if(url==='/auth/session')return{authenticated:true,csrf_token:'fixture',default_password:true};
 if(url.endsWith('/capabilities'))return{logs:true};if(url.endsWith('/preferences'))return{credit_guard_low:100,theme:'dark'};
 if(url.endsWith('/overview'))return{demo:true,total:0,healthy:0,accounts:[],logging_enabled:true};
 if(url.endsWith('/model_policy'))return{models:{}};if(url.endsWith('/meta/status'))return{available:false,running:false};
 if(url.endsWith('/meta/nodes'))return{nodes:[],bindings:[]};if(url.endsWith('/maintenance/status'))return{running:false,steps:[]};
 return{accounts:[],models:[],probes:{},entries:[],series:[],totals:{},archive:{enabled:true},recent:[]};
});

test('actual app entry evaluates with strict real HTML IDs, and every view route is reachable',async()=>{
 await import('./app.js');await flush();await flush();
 const router=await import('./assets/router.js');assert.equal($('ttl').textContent,'概览');
 for(const view of ['overview','accounts','usage','packages','taskscenter','models','egress','config','logs']){
  await router.go(view);assert.equal(dom.views.find(el=>!el.hidden)?.id,'view-'+view,view);
 }
 assert.equal($('demoNotice').hidden,false);assert.equal($('localBaseURL').textContent,'http://[::1]:9123/v1');
 await router.go('unknown');assert.equal($('ttl').textContent,'概览');
 const before=calls.length;await router.refreshVisible();assert.equal(calls.length,before);
 assert.equal(calls.filter(c=>c.opts.method==='POST' && c.url==='/panel/api/session/bootstrap').length,1);
 assert.equal(calls.some(c=>c.url==='/panel/api/balance_all'),false);
 await router.go('accounts');
 const refreshStart=calls.length;
 await dom.click('btnRefresh');
 const refreshCalls=calls.slice(refreshStart);
 const refreshMethods = refreshCalls.map(c=>[c.opts.method,c.url]);
 assert.ok(refreshMethods.some(([m,u])=>m==='POST'&&u==='/panel/api/refresh'),'must trigger global refresh');
 assert.ok(refreshMethods.some(([m,u])=>m==='GET'&&u==='/panel/api/overview'),'must re-read overview');
});

test('no_logs capability prevents navigation and background log reads without suppressing usage',async()=>{
 const cap=await import('./assets/capabilities.js'),router=await import('./assets/router.js');const requests=mockAPI(url=>url.endsWith('/capabilities')?{logs:false}:{accounts:[],totals:{}});
 await cap.loadCapabilities();cap.applyOverviewCapabilities({logging_enabled:true});assert.equal(cap.logsAvailable(),false);assert.equal($('logsNavItem').hidden,true);await router.go('logs');assert.equal($('ttl').textContent,'概览');await router.refreshVisible();assert.ok(!requests.some(c=>/\/(logs|request_logs|request_metrics)(\?|$)/.test(c.url)));
 const usageBefore=requests.filter(c=>c.url==='/panel/api/usage?hours=0').length;
 $('usStats').innerHTML='';
 await router.go('usage');
 const usageAfter=requests.filter(c=>c.url==='/panel/api/usage?hours=0').length;
 assert.ok($('usStats').innerHTML.length>0,'usage renders from cache or a fresh request');
 assert.ok(usageAfter-usageBefore<=1,'a repeat visit never issues more than one usage request');
});
