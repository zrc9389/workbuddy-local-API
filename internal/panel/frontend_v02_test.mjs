import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('v0.2 Overview exposes the visual contract without legacy search or task UI', () => {
 const html = read('index.html');
 assert.match(html, /data-view="overview"/);
 assert.match(html, /id="view-overview"[^>]*>[\s\S]*overview-grid[\s\S]*<\/section>/);
 assert.match(html, /class="overview-grid"/);
 assert.match(html, /id="ovRingSegments"/);
 assert.match(html, /id="ovTheme"[^>]*aria-pressed/);
 assert.match(html, /id="ovBaseURL"/);
 assert.doesNotMatch(html, /id="btnTheme"/);
 assert.match(html, /id="ovTheme"[^>]*aria-pressed/);
 assert.ok(html.indexOf('data-view="overview"') < html.indexOf('data-view="accounts"'));
 assert.doesNotMatch(html, /type="search"|id="(?:accQ|accStatus|accRealm|mdQ|mdRealm|reqQ|reqOutcome|reqRange|usRange|cfgForm|logChips|accSelectPage|accBulk\w*|btnCheckinAll|btnTravelAll|btnActivityAll|btnKeepaliveAll|preferencesForm|creditGuardLow|settingTheme|btnPreferencesSave)"/);
 assert.match(html, /id="passwordForm"/);assert.match(html, /系统设置/);
 assert.doesNotMatch(read('assets/config.js'), /credit_guard_low|creditGuardLow|settingTheme|savePreferences|setTheme/);
 assert.match(html, /id="btnRunAll"/);
 assert.match(html, /id="demoNotice"[^>]*hidden/);
});

test('responsive surfaces wrap content instead of concealing horizontal overflow', () => {
 const css = read('assets/styles.css');
 assert.match(css, /overflow-wrap:\s*anywhere/);
 assert.match(css, /minmax\(0,\s*1fr\)/);
 assert.match(css, /aspect-ratio:\s*2\s*\/\s*1/);
 assert.match(css, /\.overview-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*2fr\)\s*minmax\(0,\s*1fr\)/);
 assert.match(css, /@media \(max-width:980px\)[\s\S]*?\.overview-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
 assert.match(css, /prefers-reduced-motion/);
 assert.doesNotMatch(css, /overflow-x:\s*(?:hidden|clip|auto|scroll)|text-overflow:\s*ellipsis|white-space:\s*nowrap/);
});

test('batch D navigation keeps nine flat entries, no nav groups and a floating glass nav', () => {
 const html = read('index.html'), css = read('assets/styles.css'), nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
 const entries = [...nav.matchAll(/class="nav-item"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/g)].map(match => match[1]);
 assert.deepEqual(entries, ['概览','账号池','账号任务','账号出口','积分用量','积分构成','模型查看','错误记录','系统设置']);
 assert.doesNotMatch(nav, /nav-group|nav-label|nav-sub|nav-index|nav-arrow|运行日志/);
 assert.doesNotMatch(html.slice(0, html.indexOf('</nav>')), /id="btnTheme"|theme-toggle|本机会话/);
 assert.match(html, /id="ovTheme"[^>]*aria-pressed/);
 assert.match(css, /\.shell\s*\{[^}]*width:\s*100%/);
 assert.match(css, /\.shell\s*\{[^}]*max-width:\s*none/);
 assert.match(css, /\.shell\s*\{[^}]*padding:\s*16px\s+20px\s+48px\s+16px/);
 assert.match(css, /\.nav\s*\{[^}]*position:\s*sticky[^}]*top:\s*16px[^}]*border-radius:\s*var\(--glass-radius\)/);
 const navRadius = css.match(/\.nav\s*\{[^}]*border-radius:\s*([^;}]+)/);
 assert.ok(navRadius && navRadius[1].trim() !== '0', 'floating nav must not use a zero radius');
 assert.match(css, /\.nav\s*\{[^}]*padding:\s*26px\s+16px\s+18px/);
const responsiveCss = css.slice(css.indexOf('/* ===== 11 responsive ===== */'));
 assert.equal((responsiveCss.match(/@media \(max-width:700px\)/g) || []).length, 1, 'responsive section keeps exactly one 700px block');
 assert.match(css, /@media \(max-width:980px\)[\s\S]*?\.nav\s*\{[^}]*height:\s*auto/);
 assert.match(css, /button\.refreshing\s*\{[^}]*border-color:\s*var\(--accent\)[^}]*color:\s*var\(--accent\)/);
 assert.doesNotMatch(css.slice(css.indexOf('button.refreshing'), css.indexOf('button.primary')), /box-shadow|background/);
 assert.match(css, /@media \(max-width:980px\)[\s\S]*?\.nav-list\s*\{[^}]*flex-wrap:\s*wrap/);
 assert.match(css, /\.model-grid\s*\{[^}]*minmax\(min\(100%,\s*280px\),\s*1fr\)/);
});

test('batch B/C integration exposes egress subscription entry, error detail and node filter markup', () => {
 const html = read('index.html'), css = read('assets/styles.css');
 for (const id of ['btnEgressImport','egressSubscriptionName','reqDetailVeil','reqDetailTitle','btnCloseReqDetail','reqDetailBody','nodeSubscriptionFilter']) {
  assert.match(html, new RegExp('id="' + id + '"'), id);
 }
 assert.match(html, /id="egressSubscriptionName"[^>]*maxlength="64"/);
 assert.match(html, /id="egressSubscriptionName"[^>]*type="text"/);
 assert.match(html, /<select id="nodeSubscriptionFilter"[^>]*>[\s\S]*?<option value="">全部订阅<\/option>/);
 assert.match(html, /<div class="veil" id="reqDetailVeil" inert>[\s\S]*?aria-labelledby="reqDetailTitle"[\s\S]*?id="btnCloseReqDetail"/);
 assert.match(html, /id="reqDetailBody"/);
 assert.ok(html.indexOf('id="nodeAccount"') < html.indexOf('id="nodeSubscriptionFilter"'), 'filter follows account label');
 assert.ok(html.indexOf('id="nodeSubscriptionFilter"') < html.indexOf('id="nodeStatus"'), 'filter precedes node status');
 assert.match(html, /id="logsNavItem" class="nav-item"><a href="#logs" data-view="logs">错误记录<\/a>/);
 assert.doesNotMatch(html, /id="logsNavItem"[^>]*hidden/);
 for (const cls of ['subscription-detail-row','subscription-detail-main','subscription-detail-actions']) {
  assert.ok(css.includes('.' + cls + ' {'), cls);
 }
 assert.match(css, /\.subscription-detail-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)\s+auto/);
 assert.match(css, /\.req-detail-modal\s*\{[^}]*width:\s*min\(100%,\s*760px\)/);
 assert.match(css, /#nodeSubscriptionFilter\s*\{[^}]*width:\s*100%/);
});

test('batch D2 exposes four startup animation choices with local font fallbacks', () => {
 const html = read('index.html'), css = read('assets/styles.css'), settings = read('assets/animation-settings.js');
 const select = html.match(/<select id="animationStyle"[^>]*>([\s\S]*?)<\/select>/);
 assert.ok(select, 'animationStyle select present');
 const options = [...select[1].matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map(m => ({value: m[1], label: m[2]}));
 assert.deepEqual(options.map(o => o.value), ['names','orbital','scan','minimal']);
 for (const [i, label] of ['名称轮播','轨道聚合','扫描唤醒','极简淡入'].entries()) assert.match(options[i].label, new RegExp(label));
 for (const [key, label] of [['names','名称轮播'],['orbital','轨道聚合'],['scan','扫描唤醒'],['minimal','极简淡入']]) assert.match(settings, new RegExp(key + ": '" + label + "'"));
 assert.match(html, /<button id="animationPreview" type="button">预览动画<\/button>/);
 assert.match(html, /id="animationNote"[^>]*role="status"/);
 assert.ok(html.indexOf('id="animationStyle"') < html.indexOf('id="animationPreview"'), 'preview follows select');
 assert.ok(html.indexOf('id="view-config"') < html.indexOf('id="animationStyle"'), 'control lives in settings');
 assert.doesNotMatch(html, /<form id="animationForm"/, 'selection saves directly; no nested form under CSP form-action none');
 assert.match(css, /--font:[^;]*'Source Sans 3'[^;]*'Noto Sans SC'[^;]*sans-serif/);
 assert.match(css, /--display:[^;]*'Source Serif 4'[^;]*'Noto Serif SC'[^;]*serif/);
 assert.match(css, /@font-face/);
 assert.match(css, /\/panel\/assets\/fonts\/[^"')]+\.woff2/);
 assert.doesNotMatch(css, /@import|fonts\.googleapis|fonts\.gstatic/);
 assert.doesNotMatch(css, /url\(\s*['"]?https?:\/\//);
 assert.match(css, /\.motion-settings select\s*\{[^}]*appearance:\s*none/);
 assert.match(css, /\.motion-settings > label\s*\{[^}]*margin-top:\s*16px/);
 assert.match(css, /@media \(max-width:700px\)[\s\S]*?\.motion-settings \.form-actions button\s*\{[^}]*width:\s*100%/);
});

test('legacy search and batch maintenance controls are removed, not just CSS-hidden', () => {
 for (const name of ['account-table','account-actions','accounts','models','usage','packages','logs','tasks','config','router','common','egress']) {
  const source = read(`assets/${name}.js`);
  assert.doesNotMatch(source, /accQ|accBulk|selectedAccounts|mdFilter|mdMatch|mdSearchText|reqFilter|reqMatch|trangeBind|trangeQuery|tasks\/scan_all|tasks\/run_queue|checkin_all|travel_all|activity_all|keepalive_all|collectConfig|cfgForm/ , name);
 }
});

import {setupDOM,mockAPI} from './frontend_helpers_test.mjs';
const dom=setupDOM(),$=dom.$;

test('package grouping retains expiry-first order, size tie break, aggregation and input immutability',async()=>{
 const pk=await import('./assets/packages.js');
 const packs=[{id:'small-late',size:100,remain:1,expires_at:400},{id:'zero-early-b',size:200,remain:0,expires_at:200},{id:'small-early',size:100,remain:2,expires_at:200},{id:'large-unknown',size:300,remain:3},{id:'zero-early-a',size:200,remain:-1,expires_at:200},{id:'small-unknown',size:100,remain:1},{id:'large-early',size:300,remain:4,expires_at:200},{id:'zero-late',size:300,remain:0,expires_at:300}];
 const original=JSON.stringify(packs),result=pk.pkDetailGroups(packs,2);
 assert.deepEqual(result.visible.map(p=>p.id),['large-early','small-early']);assert.deepEqual(result.rest.map(p=>p.id),['small-late','large-unknown','small-unknown']);assert.deepEqual(result.used,[]);assert.equal(result.restSize,500);assert.equal(result.restRemain,5);assert.equal(result.usedSize,0);assert.equal(JSON.stringify(packs),original);
});

test('credit expiry summary clamps duplicate package balance and never invents unknown expiry dates',async()=>{
 const pk=await import('./assets/packages.js'),day=86400000,now=100000;
 const result=pk.summarizeCreditDays([{uid:'a',remain:100,packages:[{name:'soon',remain:30,expires_at:now+day},{name:'later',remain:100,expires_at:now+7*day}]},{uid:'b',remain:55,packages:[{name:'soon',remain:20,expires_at:now+day},{name:'unknown',remain:5}]},{uid:'error',error:'offline'}],now);
 assert.deepEqual(result.rows.map(({days,credits})=>({days,credits})),[{days:1,credits:50},{days:7,credits:70}]);assert.equal(result.unavailable,1);assert.equal(result.accountCount,3);assert.equal(pk.pkExpiryMs({end_time:'2026-10-19 12:00:00'}),Date.parse('2026-10-19T12:00:00+08:00'));assert.equal(pk.pkExpiryMs({end_time:'0001-01-01'}),null);
});

test('usage chart separates prompt/completion classes and exposes complete escaped values, zero samples stay unknown',async()=>{
 const usage=await import('./assets/usage.js');const chart=usage.usageChart([{t:'<unsafe>',prompt_tokens:20,completion_tokens:5,total_tokens:25}]);assert.match(chart,/class="p"/);assert.match(chart,/class="c"/);assert.match(chart,/Prompt 20/);assert.match(chart,/Completion 5/);assert.match(chart,/aria-label=/);assert.doesNotMatch(chart,/<unsafe>/);
 usage.renderUsage({totals:{requests:1,total_tokens:25,credit_samples:0},by_account:Array.from({length:103},(_,i)=>({key:'u'+i,requests:1})),series:Array.from({length:103},(_,i)=>({t:'2026-10-19T00:00:00Z',total_tokens:i}))});assert.match($('usStats').innerHTML,/未知/);assert.equal(($('usageDetails').innerHTML.match(/class="data-row"/g)||[]).length,15);assert.equal(($('usChart').innerHTML.match(/class="chart-column"/g)||[]).length,12);
});

test('request list keeps details out of the row and archive empty is authoritative',async()=>{
 const client=await import('./assets/api.js');client.acceptSession({authenticated:true,csrf_token:'fixture'});const cap=await import('./assets/capabilities.js');mockAPI(()=>({logs:true}));await cap.loadCapabilities();
 const logs=await import('./assets/logs.js'),time=new Date(2026,8,28,14,5,6).toISOString();const entry={time,status:429,outcome:'http_error',model:'glm',account:'账号',duration_ms:1250,total_tokens:2300,credit_known:true,credit:0.12,request_id:'req-1',client_ip:'203.0.113.7',user_agent:'python-requests/2.31.0',cache_hit_tokens:2257,cache_miss_tokens:43};
 assert.match(logs.requestLogText(entry),/glm/);assert.match(logs.requestLogText(entry),/429/);assert.doesNotMatch(logs.requestLogText(entry),/账号|203\.0\.113\.7|python-requests|req-1/);assert.doesNotMatch(logs.requestCard({...entry,user_agent:'<script>'}),/<script>/);
 const calls=mockAPI(url=>url.endsWith('/request_metrics')?{archive:{enabled:true},recent:[entry]}:url.includes('/request_logs')?{entries:[]}:{entries:[]});await logs.loadLogs();assert.match($('reqBody').innerHTML,/暂无错误记录/);assert.doesNotMatch($('reqBody').innerHTML,/req-1/);assert.ok(calls.some(c=>c.url==='/panel/api/request_logs?summary=1&limit=1000'));
});

test('settings keep only password, startup animation and no subscription or endpoint blocks',async()=>{
 const html=read('index.html'),config=read('assets/config.js');
 const settings=html.slice(html.indexOf('id="view-config"'),html.indexOf('id="view-logs"'));
 for(const gone of ['subscription-manager','subscriptionForm','subscriptionURL','subscriptionName','subscriptionCount','subscriptionList','btnSubscriptionSave','subscriptionNote','endpoints','localBaseURL','localChatURL','localResponsesURL','settingTheme','creditGuardLow','btnPreferencesSave'])assert.ok(!settings.includes(gone),gone);
 assert.ok(!settings.includes('管理订阅、密码和本机接口'),'settings subtitle removed');
 assert.match(settings,/id="passwordForm"/);assert.match(settings,/修改后所有管理会话会退出。/);
 assert.match(settings,/id="animationStyle"/);assert.match(settings,/id="animationPreview"/);assert.match(settings,/id="animationNote"/);
 assert.doesNotMatch(settings,/名称轮播：英文 AI 名称逐字切换/);
 assert.doesNotMatch(config,/subscriptionForm|subscriptionURL|btnSubscriptionSave/);
 assert.doesNotMatch(config,/credit_guard_low|creditGuardLow|settingTheme|btnPreferencesSave|savePreferences|setTheme/);
});
test('overview only requests accounts after authentication and keeps the aggregate contract',async()=>{
 const client=await import('./assets/api.js'),overview=await import('./assets/overview.js');client.lockSession();
 const calls=mockAPI(()=>({total:9,healthy:4,cooling:2,disabled:3,accounts:[]}));
 assert.equal(await overview.loadOverviewView(),null);assert.equal(calls.length,0);
 client.acceptSession({authenticated:true,csrf_token:'fixture'});
 const data=await overview.loadOverviewView();assert.equal(data.total,9);assert.deepEqual(calls.map(c=>c.url),['/panel/api/overview']);
 assert.equal(calls[0].opts.method,'GET');
});
