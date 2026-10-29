import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./assets/geometric.js', import.meta.url), 'utf8');
const slice = (a,b) => { const start=source.indexOf(a), end=source.indexOf(b,start); assert.ok(start>=0 && end>start); return source.slice(start,end); };
test('particle removal handles mixed expired and live particles without skipping survivors', () => {
  const fn=slice('        function updateAndRenderDisperseParticles(', '        /* =========================================================================');
  const particles=[{isReturn:true,startTime:0,duration:10,tileRef:{glow:0}}, {age:0,holdFrames:0,maxAge:10,x:1,y:1,vx:0,vy:0,ax:0,ay:0,floatSpeed:0,floatPhase:0,floatAmp:0,size:1,baseAlpha:1,color:'#fff'}, {age:10,holdFrames:0,maxAge:10,x:1,y:1,vx:0,vy:0,ax:0,ay:0,floatSpeed:0,floatPhase:0,floatAmp:0}];
  const ctx={save(){},restore(){},fillRect(){}};
  const context=vm.createContext({disperseTransitionParticles:particles,performance:{now:()=>20},window:{innerWidth:100},currentUiScale:1,Math});
  vm.runInContext(fn+'; updateAndRenderDisperseParticles',context)(ctx,0,100,20);
  assert.equal(particles.length,1); assert.equal(particles[0].age,1);
});
test('pointer disturbance shares the wave throttle and permits the first event', () => {
  const fn=slice('        function disturbGridAtScreenPos(', '        // 绘制旋转');
  const waves=[]; let now=0;
  const context=vm.createContext({pageTransition:{state:'IDLE'},currentUiScale:1,gridTiles:[{stableScreenX:0,stableScreenY:0,c:1,r:1}],pointer:{vx:0,vy:0},performance:{now:()=>now},lastHighlightWaveTime:-Infinity,POINTER_WAVE_INTERVAL_MS:180,spawnGridHighlightWave:(...args)=>waves.push(args),Math});
  const disturb=vm.runInContext(fn+'; disturbGridAtScreenPos',context);
  disturb(0,0); now=179; disturb(0,0); assert.equal(waves.length,1); now=180; disturb(0,0); assert.equal(waves.length,2);
  assert.match(source,/if \(now - lastHighlightWaveTime >= POINTER_WAVE_INTERVAL_MS\) \{\s*lastHighlightWaveTime = now;\s*spawnGridHighlightWave\(hoveredTile/);
});
