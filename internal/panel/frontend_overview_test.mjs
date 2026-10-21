import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupDOM,mockAPI} from './frontend_helpers_test.mjs';
const dom=setupDOM(),$=dom.$;
const client=await import('./assets/api.js');
const overview=await import('./assets/overview.js');
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');

function cssBlock(css, marker, nextMarker) {
  const start = css.indexOf(marker), end = css.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, marker + ' segment exists');
  return css.slice(start, end);
}

test('batch 1 nav is one flat list of nine entries in the fixed order',()=>{
 const html=read('index.html'),nav=html.slice(html.indexOf('<nav'),html.indexOf('</nav>'));
 const items=[...nav.matchAll(/<a href="#[^"]+" data-view="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match=>match[2]);
 assert.deepEqual(items,['概览','账号池','账号任务','账号出口','积分用量','积分构成','模型查看','错误记录','系统设置']);
 assert.doesNotMatch(nav,/nav-group|nav-label|nav-sub/);
 assert.match(nav,/class="nav glass-nav"/);
 const css=read('assets/styles.css'),navCss=cssBlock(css,'/* ===== 03 nav ===== */','/* ===== 04 overview ===== */');
 assert.doesNotMatch(navCss,/\.nav-group|\.nav-label|\.nav-sub/);
 assert.match(navCss,/\.nav \{ position: sticky; top: 16px/);
 assert.match(navCss,/\.nav \{[^}]*border-radius: var\(--glass-radius\)/);
 assert.match(navCss,/\.shell \{[^}]*padding: 16px 20px 48px 16px/);
});

test('selected nav keeps only text colour plus the 2px left rule',()=>{
 const css=read('assets/styles.css'),navCss=cssBlock(css,'/* ===== 03 nav ===== */','/* ===== 04 overview ===== */');
 const onRules=[...navCss.matchAll(/(?:^|\n)([^\n{}]*a\.on(?:::?[a-z-]+)?[^{]*)\{([^}]*)\}/g)]
  .filter(match=>!match[1].includes('::'))
  .map(match=>match[2]);
 assert.ok(onRules.length>0,'selected rules exist');
 for (const rule of onRules) {
  assert.doesNotMatch(rule,/(?:^|;)\s*background/);
  assert.doesNotMatch(rule,/box-shadow|outline/);
 }
 assert.match(navCss,/\.nav li > a\.on::before \{[^}]*width: 2px/);
 assert.match(navCss,/\.nav li > a:focus-visible \{[^}]*outline: 1px solid var\(--accent\)/);
});

test('overview ring stays left of the four stats and each stat has a percentage bar',()=>{
 const html=read('index.html'),view=html.slice(html.indexOf('id="view-overview"'),html.indexOf('id="view-accounts"'));
 assert.ok(view.indexOf('class="ring-figure"')<view.indexOf('class="overview-legend"'),'ring precedes legend');
 for (const id of ['ovBarTotal','ovBarHealthy','ovBarCooling','ovBarDisabled']) assert.match(view,new RegExp('id="'+id+'"[^>]*style="--pct:'));
 const css=read('assets/styles.css'),overviewCss=cssBlock(css,'/* ===== 04 overview ===== */','/* ===== 05 accounts ===== */');
 assert.match(overviewCss,/\.legend-row \{[^}]*grid-template-columns: minmax\(52px,\.8fr\) minmax\(48px,1fr\) auto/);
 assert.match(overviewCss,/\.legend-bar i \{[^}]*width: var\(--pct,0%\)/);
 assert.match(overviewCss,/\.legend-row strong \{[^}]*text-align: right/);
 assert.doesNotMatch(view,/账号池状态与本机接口|仅限本机 · 无需 API key|点击切换昼夜/);
});

test('ring bar widths follow the aggregate shares and ring markup stays dasharray based',()=>{
 overview.reflectOverviewStats({total:8,healthy:4,cooling:2,disabled:1});
 assert.equal($('ovBarTotal').style.getPropertyValue('--pct'),'100.00%');
 assert.equal($('ovBarHealthy').style.getPropertyValue('--pct'),'50.00%');
 assert.equal($('ovBarCooling').style.getPropertyValue('--pct'),'25.00%');
 assert.equal($('ovBarDisabled').style.getPropertyValue('--pct'),'12.50%');
 assert.match($('ovRingSegments').innerHTML,/stroke-dasharray=/);
 overview.reflectOverviewStats({total:0});
 assert.equal($('ovBarHealthy').style.getPropertyValue('--pct'),'0.00%');
});

test('each overview entry replays the 320ms ring reveal while reduced modes skip it',()=>{
 const view=$('view-overview');
 view.dataset.motion='off';
 overview.reflectOverviewStats({total:3,healthy:2,cooling:1,disabled:0});
 assert.equal(view.dataset.motion,'on');
 assert.match(read('index.html'),/class="ring-reveal"[^>]*pathLength="100"[^>]*stroke-dasharray="100 100"/);
 assert.match(read('assets/styles.css'),/@keyframes ring-reveal \{ from \{ stroke-dashoffset: 100; \} to \{ stroke-dashoffset: 0; \} \}/);
});

test('reduced motion or a hidden page renders the ring and rows without animation',()=>{
 const view=$('view-overview');
 document.hidden=true;
 overview.reflectOverviewStats({total:4,healthy:2,cooling:1,disabled:1});
 assert.notEqual(view.dataset.motion,'on');
 document.hidden=false;
 view.dataset.motionMode='off';
 overview.reflectOverviewStats({total:4,healthy:2,cooling:1,disabled:1});
 assert.notEqual(view.dataset.motion,'on');
 view.dataset.motionMode='on';
});

test('router titles follow the nav names',async()=>{
 const router=await import('./assets/router.js');
 client.acceptSession({authenticated:true,csrf_token:'fixture'});
 mockAPI(()=>({total:0,healthy:0,cooling:0,disabled:0,accounts:[]}));
 const expected={overview:'概览',accounts:'账号池',usage:'积分用量',packages:'积分构成',config:'系统设置'};
 for (const [name,title] of Object.entries(expected)) { await router.go(name); assert.equal($('ttl').textContent,title,name); }
});

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
