import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM,mockAPI} from './frontend_helpers_test.mjs';

const dom=setupDOM();
for(const id of ['subscriptionList','subscriptionCount'])dom.nodes.set(id,new dom.Element(id));
const client=await import('./assets/api.js');
client.acceptSession({authenticated:true,csrf_token:'fixture'});

test('subscription rows expose bounded management actions and never include the URL preview',async()=>{
 const config=await import('./assets/config.js');
 const calls=mockAPI(url=>url.endsWith('/meta/subscriptions')?{subscriptions:[
  {id:'sub-a',name:'主力',enabled:true,node_count:12,bindings:1,has_url:true,url_preview:'https://secret.example/…'},
  {id:'sub-b',name:'<script>',enabled:false,node_count:0,bindings:0,has_url:false},
 ]}:{});
 await config.loadSubscriptions();
 const html=globalThis.document.getElementById('subscriptionList').innerHTML;
 assert.match(html,/data-subscription-toggle="sub-a"/);
 assert.match(html,/data-subscription-rename="sub-a"/);
 assert.match(html,/data-subscription-refresh="sub-a"/);
 assert.match(html,/data-subscription-reveal="sub-a"/);
 assert.doesNotMatch(html,/secret\.example/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/先解除账号绑定/);
 assert.deepEqual(calls.map(call=>call.url),['/panel/api/meta/subscriptions']);
 assert.equal(calls[0].opts.method,'GET');
});

test('subscription actions use the documented body and refresh the list once',async()=>{
 const config=await import('./assets/config.js');
 const calls=mockAPI((url,opts)=>{
  if(opts.method==='GET')return{subscriptions:[{id:'sub-a',name:'A',enabled:true,has_url:true}]};
  return{ok:true,nodes:3};
 });
 await config.loadSubscriptions();
 await config.subscriptionAction('toggle','sub-a');
 assert.equal(calls.at(-2).opts.body,JSON.stringify({action:'toggle',id:'sub-a',enabled:false}));
 assert.equal(calls.at(-1).opts.method,'GET');
 await config.subscriptionAction('refresh','sub-a');
 assert.equal(calls.at(-2).opts.body,JSON.stringify({action:'refresh',id:'sub-a'}));
 assert.match(globalThis.document.getElementById('subscriptionNote').textContent,/3 个节点/);
});

test('explicit reveal issues one dedicated request only when invoked',async()=>{
 const config=await import('./assets/config.js');
 const calls=mockAPI((url,opts)=>{
  if(opts.method==='GET' && url.includes('reveal=1'))return{id:'sub-a',url:'https://secret.example/private'};
  return{subscriptions:[{id:'sub-a',name:'A',enabled:true,has_url:true}]};
 });
 await config.loadSubscriptions();
 assert.equal(calls.filter(call=>call.url.includes('reveal=1')).length,0);
 const url=await config.subscriptionAction('reveal','sub-a');
 assert.equal(url,'https://secret.example/private');
 assert.deepEqual(calls.filter(call=>call.url.includes('reveal=1')).map(call=>call.url),['/panel/api/meta/subscriptions?id=sub-a&reveal=1']);
});
