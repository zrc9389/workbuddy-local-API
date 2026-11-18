import assert from 'node:assert/strict';
import test from 'node:test';
import { setupDOM } from './frontend_helpers_test.mjs';

const dom = setupDOM();
dom.Element.prototype.getContext = () => ({
    fillRect() {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {}, moveTo() {}, lineTo() {},
    arc() {}, save() {}, restore() {}, setTransform() {}, resetTransform() {}, scale() {}, translate() {},
    drawImage() {}, measureText() { return { width: 10 }; }, fillText() {}, strokeText() {},
    createImageData() { return { data: [] }; }, getImageData() { return { data: [] }; }, putImageData() {},
    setLineDash() {}, strokeRect() {},
});
dom.Element.prototype.blur = () => {};
globalThis.window = globalThis;
globalThis.location = { protocol: 'http:', pathname: '/panel/', port: '7863', origin: 'http://127.0.0.1:7863' };
globalThis.innerWidth = 390;
globalThis.innerHeight = 844;

let rafCalls = [];
globalThis.requestAnimationFrame = (cb) => {
    rafCalls.push(cb);
    return rafCalls.length;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({}) });

const { bootGeometricRuntime } = await import('./assets/geometric.js');
bootGeometricRuntime();

test('paired pointerdown + touchstart on same [data-hover-model] invokes hoverUsagePoint only once', () => {
    globalThis.WBState.usageRange = '6H';
    globalThis.WBState.usage6h = {
        labels: ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00'],
        outVals: [10, 20, 30, 40, 50, 60],
        inVals: [1, 2, 3, 4, 5, 6],
    };

    const origHover = globalThis.hoverUsagePoint;
    let callCount = 0;
    globalThis.hoverUsagePoint = (idx) => {
        callCount++;
        return origHover ? origHover(idx) : undefined;
    };
    try {
        const usageTrack = { getBoundingClientRect: () => ({ left: 20, width: 300 }) };
        const usageHit = {
            dataset: { hoverModel: 'UsageModel', hoverIdx: '2' },
            parentElement: usageTrack,
            closest(sel) { return sel === '[data-hover-model]' ? this : null; },
        };

        // 模拟移动浏览器单次触控成对派发 pointerdown + touchstart
        document.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', target: usageHit, clientX: 140 });
        document.dispatchEvent({ type: 'touchstart', target: usageHit, touches: [{ clientX: 140 }] });

        assert.equal(callCount, 1, `expected deduplicated single hoverUsagePoint call, got ${callCount}`);
    } finally {
        globalThis.hoverUsagePoint = origHover;
    }
});

test('document.hidden pauses background rAF rescheduling and visibilitychange resumes cleanly', () => {
    const bgLoopNames = new Set(['renderIntroGrid', 'renderMainWorld', 'renderProjectArtifactPreview', 'animateSoundWaveIcon']);
    // 1. 触发 hidden 状态下的 rAF 回调，确认所有背景视觉循环均停止重调度
    globalThis.document.hidden = true;
    const prevCallbacks = rafCalls.slice();
    rafCalls = [];
    for (const cb of prevCallbacks) {
        try { cb(performance.now()); } catch {}
    }
    const scheduledBgLoops = rafCalls.map(fn => fn.name).filter(name => bgLoopNames.has(name));
    assert.equal(scheduledBgLoops.length, 0, `expected 0 background rAF loops while document.hidden=true, got ${scheduledBgLoops.join(', ')}`);

    // 2. 恢复可见并派发 visibilitychange，确认暂停的背景循环被重新拉起
    globalThis.document.hidden = false;
    document.dispatchEvent({ type: 'visibilitychange' });
    const resumedBgLoops = rafCalls.map(fn => fn.name).filter(name => bgLoopNames.has(name));
    assert.ok(resumedBgLoops.length > 0, 'expected visibilitychange to resume paused background rAF loops');
});
