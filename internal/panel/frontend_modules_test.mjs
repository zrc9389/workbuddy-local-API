import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {setupDOM,mockAPI} from './frontend_helpers_test.mjs';
const dom=setupDOM(),$=dom.$;
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const client=await import('./assets/api.js');

test('shell and module graph preserve session security and do not contain bearer/legacy key UI',()=>{
 const html=read('index.html');for(const view of ['overview','accounts','usage','packages','taskscenter','egress','models','config','logs'])assert.ok(html.includes(`id="view-${view}"`),view);
 assert.match(html,/type="module"/);assert.match(html,/\/panel\/assets\/styles.css/);assert.doesNotMatch(html,/api_key|keyInput|keyVeil|onsubmit=/);assert.match(html,/passwordForm/);assert.match(html,/123456/);assert.doesNotMatch(html,/preferencesForm|creditGuardLow|settingTheme|btnPreferencesSave/);assert.match(html,/系统设置/);assert.match(html,/subscriptionForm/);assert.match(html,/localBaseURL/);
 for(const name of readdirSync(new URL('assets/',import.meta.url)).filter(name=>name.endsWith('.js')))assert.doesNotMatch(read(`assets/${name}`),/Bearer |LS_KEY|api_key/);
 assert.ok(read('app.js').length<4000);
});

test('session transport uses credentials, in-memory CSRF, JSON defaults and multipart boundaries',async()=>{
 let status=200,body={authenticated:true,csrf_token:'test-token',default_password:true};const calls=mockAPI(()=>({status,body}));
 await client.refreshSession();await client.api('preferences',{method:'POST',body:'{}'});
 assert.equal(calls.at(-1).opts.credentials,'same-origin');assert.equal(calls.at(-1).opts.headers.get('X-CSRF-Token'),'test-token');assert.equal(calls.at(-1).opts.headers.get('Content-Type'),'application/json');
 const form=new FormData();form.append('file','test');await client.api('import/cockpit',{method:'POST',body:form});assert.equal(calls.at(-1).opts.headers.get('Content-Type'),null);
 await client.request('/auth/logout',{method:'POST'});assert.equal(calls.at(-1).opts.body,'{}');
 status=401;body={error:'expired'};await assert.rejects(client.api('overview'));assert.equal(client.session.authenticated,false);assert.equal(client.session.csrf_token,'');
 await assert.rejects(client.request('https://example.com/steal'),/不允许/);
});

test('GET cancellation, external aborts and a changed-session response are rejected',async()=>{
 client.acceptSession({authenticated:true,csrf_token:'token'});
 globalThis.fetch=(_url,opts)=>new Promise((_resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError'))));
 const pending=client.api('overview');client.cancelReads();await assert.rejects(pending,{name:'AbortError'});
 let release;globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});const stale=client.api('overview');client.lockSession();release({status:200,ok:true,json:async()=>({total:9})});await assert.rejects(stale,{name:'AbortError'});
});

test('pagination bounds every data set while keeping every final row reachable',async()=>{
 const {paginate,pagerHTML}=await import('./assets/pagination.js');const list=Array.from({length:1003},(_,i)=>i);
 assert.equal(paginate(list).rows.length,25);assert.equal(paginate(list,1,99999).rows.length,100);assert.deepEqual(paginate(list,99999,25).rows,[1000,1001,1002]);assert.equal(paginate([],200).page,1);
 assert.equal(paginate(list,-99,-2).size,1);assert.match(pagerHTML(paginate(list),'x"<'),/x&quot;&lt;/);
});

test('settings view is bounded and subscription import keeps its backend-only URL contract',async()=>{
 client.acceptSession({authenticated:true,csrf_token:'token'});const calls=mockAPI(()=>({nodes:3}));
 const config=await import('./assets/config.js');$('ttl').textContent='系统设置';
 assert.equal($('ttl').textContent,'系统设置');assert.equal($('subscriptionNote').textContent,'');
 $('subscriptionURL').value='javascript:alert(1)';await $('subscriptionForm').onsubmit({preventDefault(){}});assert.equal(calls.length,0);
 $('subscriptionURL').value='https://example.com/sub';await $('subscriptionForm').onsubmit({preventDefault(){}});
 assert.deepEqual(calls.map(c=>c.url),['/panel/api/meta/subscriptions','/panel/api/meta/subscriptions']);assert.equal(calls[0].opts.method,'POST');assert.equal(JSON.parse(calls[0].opts.body).url,'https://example.com/sub');
 assert.equal($('subscriptionURL').value,'');assert.match($('subscriptionNote').textContent,/已导入 3 个节点/);
});
test('background intervals pause hidden/locked pages and never overlap',async()=>{
 const {visibleInterval}=await import('./assets/lifecycle.js');client.acceptSession({authenticated:true,csrf_token:'token'});
 let count=0,release;const timer=visibleInterval(async()=>{count++;await new Promise(resolve=>release=resolve);},100);const tick=dom.intervals.get(timer);
 document.hidden=true;await tick();assert.equal(count,0);document.hidden=false;const first=tick();await tick();assert.equal(count,1);release();await first;
 client.lockSession();await tick();assert.equal(count,1);
});

test('credit/token/latency formatting retains observed zero, missing sample and cache semantics',async()=>{
 const f=await import('./assets/format.js'),common=await import('./assets/common.js');
 assert.equal(f.fmtCredit(0),'0');assert.equal(f.fmtCredit(0.125),'0.13');assert.equal(f.fmtCreditRatio(0,0,200),'—');assert.equal(f.fmtCreditRatio(0,1,200),'0 / 1M');assert.equal(f.fmtModelRate('0'),'x0');assert.equal(f.cacheRateText(2257,43),'98.1%');assert.equal(f.cacheRateText(0,0),'—');
 assert.equal(common.formatTokenCount(999999),'1m');assert.equal(common.formatLatency(1250),'1.3s');assert.equal(common.formatRate(0),'0.0tok/s');assert.equal(common.formatTokenCount(undefined),'—');assert.equal(common.esc('"<x>&\''),'&quot;&lt;x&gt;&amp;&#39;');
 const now=Date.parse('2026-10-19T00:00:00Z');const meta=common.rateLimitMeta({model:'<unsafe>',reset_at:new Date(now+3600000).toISOString(),until:new Date(now+60000).toISOString()},now);
 assert.match(meta.detail,/网关最快/);assert.match(meta.detail,/剩余/);assert.doesNotMatch(common.rateLimitRowsHtml([{model:'<unsafe>'}],now),/<unsafe>/);
 assert.equal(common.rateLimitMeta({model:'m',kind:'model_unavailable'},now).detail,'等待重新探测');
});

test('modal keyboard trapping and return focus work without introducing hidden controls',async()=>{
 const {showModal,hideModal}=await import('./assets/modals.js'),first=new dom.Element(),last=new dom.Element();$('nodeVeil').controls=[first,last];
 const previous=$('ovTheme');previous.focus();showModal('nodeVeil');assert.equal(dom.shell.inert,true);assert.equal(document.activeElement,first);
 last.focus();let prevented=false;for(const fn of dom.events.get('keydown'))fn({key:'Tab',shiftKey:false,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(document.activeElement,first);
 hideModal('nodeVeil');assert.equal(dom.shell.inert,false);assert.equal(document.activeElement,previous);
});

test('theme tolerates disabled storage and pauses fluid background when hidden',async()=>{
 globalThis.localStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){}};
 const theme=await import('./assets/theme.js');theme.setTheme('light');assert.equal(document.documentElement.dataset.theme,'light');document.hidden=true;await dom.emit('visibilitychange');assert.equal(document.documentElement.dataset.paused,'true');document.hidden=false;await dom.emit('visibilitychange');
});
