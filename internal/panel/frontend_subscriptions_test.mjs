import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupDOM} from './frontend_helpers_test.mjs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
setupDOM();

test('config.js no longer owns any subscription logic',async()=>{
 const config=await import('./assets/config.js');
 const source=read('assets/config.js');
 assert.doesNotMatch(source,/subscription/i);
 assert.deepEqual(Object.keys(config).sort(),['loadConfig']);
});

test('view-config exposes no subscription DOM ids or actions',()=>{
 const html=read('index.html');
 const settings=html.slice(html.indexOf('id="view-config"'),html.indexOf('id="view-logs"'));
 assert.doesNotMatch(settings,/subscription/i);
});

test('subscription UI lives only in the egress view and keeps bounded actions',()=>{
 const html=read('index.html');
 const egressView=html.slice(html.indexOf('id="view-egress"'),html.indexOf('<!-- ===== /view:egress ===== -->'));
 for(const id of ['egressSubscriptionForm','egressSubscriptionURL','egressSubscriptionName','egressSubscriptionNote','subscriptionDetailList','subscriptionDetailNote','subscriptionRevealURL'])assert.ok(egressView.includes('id="'+id+'"'),id);
 const outside=html.slice(0,html.indexOf('id="view-egress"'))+html.slice(html.indexOf('<!-- ===== /view:egress ===== -->'));
 assert.doesNotMatch(outside,/id="(?:egress)?[Ss]ubscription|id="subscription(?:List|Count|Note|Form|URL)"/);
 const egressSource=read('assets/egress.js');
 for(const action of ['data-subscription-toggle','data-subscription-delete','data-subscription-reveal'])assert.ok(egressSource.includes(action),action);
 assert.match(egressSource,/item\.url_preview/,'details show the masked preview only');
 assert.match(egressSource,/subscriptions\?id=' \+ encodeURIComponent\(id\) \+ '&reveal=1'/,'the plain URL requires an explicit reveal request');
});
