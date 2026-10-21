import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM,mockAPI} from './frontend_helpers_test.mjs';
const dom=setupDOM(),$=dom.$;
const client=await import('./assets/api.js');
const overview=await import('./assets/overview.js');

test('overview ring uses aggregate counts and account-pool tones without inventing totals',()=>{
 assert.deepEqual(overview.overviewCounts({total:6,healthy:2,cooling:1,disabled:2}),{total:6,healthy:2,cooling:1,disabled:2,unclassified:1});
 const segments=overview.ringSegments({total:6,healthy:2,cooling:1,disabled:2});
 assert.deepEqual(segments.map(s=>s.tone),['good','warn','bad','muted']);
 const markup=overview.ringMarkup({total:6,healthy:2,cooling:1,disabled:2});
 assert.match(markup,/class="ring-segment good"/);assert.match(markup,/class="ring-segment warn"/);assert.match(markup,/class="ring-segment bad"/);
 assert.doesNotMatch(markup,/NaN|undefined/);
 assert.equal(overview.ringMarkup({total:0}),'');
});

test('overview renders an explicit empty state and escaped-free numeric legend',()=>{
 overview.reflectOverviewStats({total:0,healthy:0,cooling:0,disabled:0});
 assert.equal($('ovTotal').textContent,'0');assert.equal($('ovRingSegments').innerHTML,'');assert.match($('ovStatus').textContent,/为空/);
 overview.reflectOverviewStats({total:8,healthy:5,cooling:2,disabled:1});
 assert.equal($('ovLegendTotal').textContent,'8');assert.equal($('ovLegendHealthy').textContent,'5');assert.equal($('ovLegendCooling').textContent,'2');assert.equal($('ovLegendDisabled').textContent,'1');
 assert.match($('ovRingLabel').textContent,/账号总数 8/);assert.match($('ovRingSegments').innerHTML,/ring-segment good/);
});

test('theme control exposes aria state, saves only theme and keeps local state on reduced-motion paths',async()=>{
 client.acceptSession({authenticated:true,csrf_token:'fixture'});
 document.documentElement.dataset.theme='dark';
 const calls=mockAPI((url,opts)=>opts.method==='POST'?({credit_guard_low:120,theme:JSON.parse(opts.body).theme}):({credit_guard_low:120,theme:'dark'}));
 await dom.click('ovTheme');
 assert.equal(document.documentElement.dataset.theme,'light');
 assert.equal($('ovTheme').getAttribute('aria-pressed'),'true');
 assert.deepEqual(JSON.parse(calls.find(c=>c.opts.method==='POST').opts.body),{credit_guard_low:120,theme:'light'});
 assert.ok(calls.every(c=>c.url==='/panel/api/preferences'));
 await dom.click('ovTheme');
 assert.equal(document.documentElement.dataset.theme,'dark');
});

test('overview is session-gated and the local API box never depends on accounts',async()=>{
 client.lockSession();overview.resetOverview();
 const calls=mockAPI(()=>({total:1,healthy:1,cooling:0,disabled:0,accounts:[]}));
 assert.equal(await overview.loadOverviewView(),null);assert.equal(calls.length,0);
 assert.equal($('ovBaseURL').textContent,'http://[::1]:9123/v1');
 client.acceptSession({authenticated:true,csrf_token:'fixture'});
 await overview.loadOverviewView();
 assert.deepEqual(calls.map(c=>c.url),['/panel/api/overview']);assert.equal(calls[0].opts.method,'GET');
 assert.ok(!calls.some(c=>/balance|package|sync/i.test(c.url)));
});


test('router loads the overview only after authentication and only once',async()=>{
 client.lockSession();const calls=mockAPI(()=>({total:3,healthy:2,cooling:1,disabled:0,accounts:[]}));
 const router=await import('./assets/router.js');
 await router.go('overview');assert.equal(calls.length,0);
 client.acceptSession({authenticated:true,csrf_token:'fixture'});
 await router.go('overview');
 assert.deepEqual(calls.map(c=>c.url),['/panel/api/overview']);
 assert.equal($('ovTotal').textContent,'3');
});
