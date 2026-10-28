import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('both account delete handlers cancel without fetch or XHR', async () => {
  let network = 0;
  const deny = () => { network++; throw new Error('network called'); };
  const html = readFileSync(new URL('./assets/geometric.js', import.meta.url), 'utf8');
  const start = html.indexOf('window.deleteAccountItem = async function(uid) {');
  const end = html.indexOf("        document.getElementById('btn-about')", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({window:{confirm:()=>false}, WBState:{accounts:[{uid:'a'}]}, IS_PROD_ENV:true, safeApiFetch:deny, fetch:deny, XMLHttpRequest:deny});
  const geometry = vm.runInContext(html.slice(start,end)+'; window.deleteAccountItem',context);
  await geometry('a');
  let listener;
  const code = readFileSync(new URL('./assets/account-actions.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'').replace('export function bindAccountActions','function bindAccountActions');
  const moduleContext = vm.createContext({$:()=>({addEventListener:(_event,fn)=>{listener=fn}}),accountByUID:()=>({nickname:'A'}),confirm:()=>false,api:deny,fetch:deny,XMLHttpRequest:deny});
  vm.runInContext(code,moduleContext);
  await listener({target:{closest:()=>({disabled:false,dataset:{a:'remove',u:'a'}})}});
  assert.equal(network,0);
});
