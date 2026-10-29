import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('./assets/geometric.js',import.meta.url),'utf8');
const begin=src.indexOf('        function clearLocalSession()');
const end=src.indexOf('        function logoutToStartPage(',begin);
test('logout clears client session only after confirmed server logout and can retry',async()=>{
 let ok=false, calls=0; const storage={removed:[],removeItem(k){this.removed.push(k);}};
 const context=vm.createContext({window:{csrfToken:'token'},localStorage:storage,WBState:{accounts:[1],subscriptions:[2],currentChapter:'accounts'},safeApiFetch:async(url,opts)=>{calls++;assert.equal(url,'/auth/logout');assert.equal(opts.body,'{}');return ok?{ok:true}:null;}});
 vm.runInContext("let csrfToken='token', serverSession={}, memoryEncryptedBundle={};"+src.slice(begin,end)+";globalThis.run=endServerSession;globalThis.state=()=>({csrfToken,serverSession,memoryEncryptedBundle});",context);
 assert.equal(await context.run(),false); assert.equal(context.state().csrfToken,'token');
 ok=true; assert.equal(await context.run(),true); assert.equal(calls,2); assert.equal(context.state().csrfToken,''); assert.equal(context.state().serverSession,null); assert.equal(context.state().memoryEncryptedBundle,null); assert.equal(storage.removed[0],'wb_csrf_token'); assert.equal(context.WBState.accounts.length,0);
});
test('logout restarts intro animation and rejects stale entry timers',()=>{
 const logout=src.slice(src.indexOf('        function logoutToStartPage('),src.indexOf('        // ==================== 原装',src.indexOf('        function logoutToStartPage(')));
 const enter=src.slice(src.indexOf('        function enterMainExperience('),src.indexOf("        document.getElementById('btn-mute')"));
 assert.match(logout,/introStartTime = performance\.now\(\);/); assert.ok(logout.indexOf('renderIntroGrid(introStartTime)') < logout.indexOf("introLayer.classList.remove('hidden')")); assert.match(logout,/startStrictLoadingSequence\(\)/); assert.match(enter,/transitionEpoch !== authTransitionEpoch/);
});
