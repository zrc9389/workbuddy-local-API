import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('./assets/geometric.js', import.meta.url), 'utf8');
const method = src.slice(src.indexOf('            playCustomBackgroundTrack('), src.indexOf('            // 任务执行与系统报错音效'));

test('custom audio repeats after two seconds, including subsequent ends and stale events', () => {
  const timers = new Map(); let id = 0; const instances = [];
  class Audio { constructor(url) { this.url = url; this.paused = true; this.events = {}; this.plays = 0; instances.push(this); } addEventListener(n, fn) { this.events[n] = fn; } play() { this.paused = false; this.plays++; return Promise.resolve(); } pause() { this.paused = true; } }
  const ctx = { Audio, setTimeout: (fn, ms) => { const key = ++id; timers.set(key, {fn, ms}); return key; }, clearTimeout: key => timers.delete(key), WBState: {customization: {randomMusic:false, musicList:[]}}, notifyEditorialStatus() {} };
  const C = vm.runInNewContext('(class {' + method + '})', ctx); const engine = new C();
  Object.assign(engine, {audioGeneration:0, isInitialized:true, isMuted:false, fadingAudios:new Set(), fadeAudio() {}});
  engine.playCustomBackgroundTrack('data:audio/mpeg;base64,YQ=='); const first = instances[0];
  assert.equal(first.loop, false); assert.equal(first.plays, 1);
  engine.playCustomBackgroundTrack(first.url); first.events.ended();
  let timer = [...timers.values()].at(-1); assert.equal(timer.ms, 2000); timer.fn(); assert.equal(first.plays, 2);
  first.events.ended(); timer = [...timers.values()].at(-1); timer.fn(); assert.equal(first.plays, 3);
  engine.playCustomBackgroundTrack('data:audio/wav;base64,Yg=='); const count = timers.size; first.events.ended(); assert.equal(timers.size, count);
});

test('default ambient schedules a 100 second cycle and a two second gap', () => {
  const timers = []; const ctx = {setTimeout:(fn,ms) => {timers.push({fn,ms}); return timers.length;}, clearTimeout(){}, WBState:{customization:{randomMusic:false,musicList:[]}}};
  const C = vm.runInNewContext('(class {' + method + '})', ctx); const engine = new C();
  Object.assign(engine,{audioGeneration:0,isInitialized:true,isMuted:false,fadingAudios:new Set(),fadeAudio(){}});
  engine.playCustomBackgroundTrack('',true); assert.equal(timers[0].ms,100000); timers[0].fn(); assert.equal(timers[1].ms,2000); timers[1].fn(); assert.equal(timers[2].ms,100000);
});

test('random playback follows each track end regardless of duration, and survives mute', () => {
  const timers = new Map(); let id = 0; const instances = [];
  class Audio {
    constructor(url) { this.url=url; this.paused=true; this.ended=false; this.events={}; this.plays=0; instances.push(this); }
    addEventListener(n,fn) { this.events[n]=fn; }
    play() { this.paused=false; this.ended=false; this.plays++; return Promise.resolve(); }
    pause() { this.paused=true; }
    end() { this.paused=true; this.ended=true; this.events.ended(); }
  }
  const cust={randomMusic:true,musicList:[{id:'short',url:'short'},{id:'long',url:'long'}]};
  const ctx={Audio, setTimeout:(fn,ms)=>{const k=++id;timers.set(k,{fn,ms});return k;},clearTimeout:k=>timers.delete(k),WBState:{customization:cust},Math:Object.create(Math),notifyEditorialStatus(){},document:{getElementById(){return null;}}};
  ctx.Math.random=()=>0.9;
  const mute=src.slice(src.indexOf('            setMute(mute)'),src.indexOf('            // 平滑淡入淡出 HTML5 Audio'));
  const C=vm.runInNewContext('(class {'+mute+method+'})',ctx); const engine=new C();
  Object.assign(engine,{audioGeneration:0,isInitialized:true,isMuted:false,fadingAudios:new Set(),fadeAudio(){}});
  engine.playCustomBackgroundTrack('short'); const short=instances[0];
  assert.equal(timers.size,0); short.end();
  engine.setMute(true); engine.setMute(false);
  assert.equal(short.plays,1); const timer=[...timers.values()].at(-1); assert.equal(timer.ms,2000); timer.fn();
  const long=instances.at(-1); assert.equal(long.url,'long'); assert.equal(long.plays,1);
  long.end(); assert.equal([...timers.values()].at(-1).ms,2000);
});

test('old default timers cannot replace a newer track', () => {
  const timers=[]; const instances=[];
  class Audio { constructor(url){this.url=url;this.paused=true;instances.push(this);} addEventListener(){} play(){this.paused=false;return Promise.resolve();} pause(){this.paused=true;} }
  const ctx={Audio,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},WBState:{customization:{randomMusic:false,musicList:[]}},notifyEditorialStatus(){}};
  const C=vm.runInNewContext('(class {'+method+'})',ctx); const engine=new C();
  Object.assign(engine,{audioGeneration:0,isInitialized:true,isMuted:false,fadingAudios:new Set(),fadeAudio(){}});
  engine.playCustomBackgroundTrack('',true); const stale=timers[0]; engine.playCustomBackgroundTrack('long'); stale.fn();
  assert.equal(timers.length,1); assert.equal(engine.currentCustomUrl,'long');
});

test('login gesture prepares and reuses a muted media element for the chosen track', () => {
  const instances=[], revoked=[];
  class Audio {
    constructor(url){this.src=url;this.paused=true;this.plays=0;instances.push(this);}
    addEventListener(){}
    play(){this.paused=false;this.plays++;return Promise.resolve();}
    pause(){this.paused=true;}
  }
  const prepare=src.slice(src.indexOf('            prepareMediaGesture()'),src.indexOf('            init(enableSound',src.indexOf('            prepareMediaGesture()')));
  const ctx={Audio, URL:{revokeObjectURL:u=>revoked.push(u)},generateSyntheticWavUrl:()=> 'blob:silence', setTimeout(){},clearTimeout(){}, WBState:{customization:{randomMusic:false,musicList:[]}},notifyEditorialStatus(){}};
  const C=vm.runInNewContext('(class {'+prepare+method+'})',ctx); const engine=new C();
  Object.assign(engine,{audioGeneration:0,isInitialized:true,isMuted:false,fadingAudios:new Set(),fadeAudio(){}});
  engine.prepareMediaGesture();
  assert.equal(instances.length,1); assert.equal(instances[0].muted,true); assert.equal(instances[0].plays,1);
  engine.playCustomBackgroundTrack('/panel/api/music/file/chosen');
  assert.equal(instances.length,1); assert.equal(instances[0].src,'/panel/api/music/file/chosen');
  assert.equal(instances[0].muted,false); assert.equal(instances[0].plays,2); assert.deepEqual(revoked,['blob:silence']);
});

test('switching to default removes the retired background player', () => {
  class HTMLElement {}
  class Audio extends HTMLElement {
    constructor(url){super();this.src=url;this.paused=true;this.dataset={};this.isConnected=false;}
    addEventListener(){} play(){this.paused=false;return Promise.resolve();} pause(){this.paused=true;}
    remove(){this.parentNode=null;this.isConnected=false;}
  }
  const document={body:{appendChild(a){a.parentNode=this;a.isConnected=true;}}};
  const ctx={Audio,HTMLElement,document,setTimeout(){return 1;},clearTimeout(){},WBState:{customization:{randomMusic:false,musicList:[]}},notifyEditorialStatus(){}};
  const C=vm.runInNewContext('(class {'+method+'})',ctx); const engine=new C();
  Object.assign(engine,{audioGeneration:0,isInitialized:true,isMuted:false,fadingAudios:new Set(),fadeAudio(a,from,to,ms,done){if(done)done();}});
  engine.playCustomBackgroundTrack('/chosen'); const player=engine.customAudio;
  assert.equal(player.isConnected,true);
  engine.playCustomBackgroundTrack('',true);
  assert.equal(player.isConnected,false); assert.equal(player.paused,true); assert.equal(player.src,'');
});

test('logout uses one third volume and preserves mute', () => {
  const begin=src.indexOf('            // 登录页背景音量为主场景的三分之一。');
  const end=src.indexOf("            if (soundscape) soundscape.playCustomBackgroundTrack('', true);",begin);
  assert.ok(begin >= 0 && end > begin);
  let target;
  const gain={value:0.7,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(v){target=v;}};
  const context={soundscape:{masterGain:{gain},ctx:{currentTime:3},isMuted:false}};
  vm.runInNewContext(src.slice(begin,end),context);
  assert.equal(target,0.7/3);
  context.soundscape.isMuted=true;
  vm.runInNewContext(src.slice(begin,end),context);
  assert.equal(target,0);
});
