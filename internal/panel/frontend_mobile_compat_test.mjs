import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupDOM} from './frontend_helpers_test.mjs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const dom = setupDOM();
dom.Element.prototype.getContext = () => ({
  fillRect() {}, clearRect() {}, beginPath() {}, stroke() {}, fill() {}, moveTo() {}, lineTo() {},
  arc() {}, save() {}, restore() {}, setTransform() {}, resetTransform() {}, scale() {}, translate() {},
  drawImage() {}, measureText() { return {width: 10}; }, fillText() {}, strokeText() {},
  createImageData() { return {data: []}; }, getImageData() { return {data: []}; }, putImageData() {},
  setLineDash() {}, strokeRect() {}
});
dom.Element.prototype.blur = () => {};
globalThis.window = globalThis;
globalThis.location = {protocol: 'http:', pathname: '/panel/', port: '7863', origin: 'http://127.0.0.1:7863'};
globalThis.innerWidth = 1440;
globalThis.innerHeight = 900;
globalThis.requestAnimationFrame = () => 1;
globalThis.fetch = async () => ({status: 200, ok: true, json: async () => ({})});

const {bootGeometricRuntime} = await import('./assets/geometric.js');
bootGeometricRuntime();

test('desktop viewport (1440x900) keeps exact original updateResponsiveScale formula', () => {
  globalThis.innerWidth = 1440;
  globalThis.innerHeight = 900;
  globalThis.updateResponsiveScale();

  const expectedUi = Math.max(0.45, Math.min(1.85, Math.min(1440 / 1440, 900 / 860)));
  const safeStageH = 900 - 74 * expectedUi - 24;
  const expectedPage = Math.max(0.40, Math.min(1.85, Math.min((1440 - 64) / 1100, safeStageH / 664)));

  assert.equal(dom.root.style.getPropertyValue('--ui-scale'), expectedUi.toFixed(4));
  assert.equal(dom.root.style.getPropertyValue('--page-scale'), expectedPage.toFixed(4));
});

test('mobile viewport (390x844 and 360x740) keeps --page-scale at 1 and readable --ui-scale', () => {
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 844;
  globalThis.updateResponsiveScale();

  assert.equal(dom.root.style.getPropertyValue('--page-scale'), '1.0000');
  const ui390 = parseFloat(dom.root.style.getPropertyValue('--ui-scale'));
  assert.ok(ui390 >= 0.82 && ui390 <= 1.0, `expected readable --ui-scale at 390px, got ${ui390}`);
  assert.equal(dom.root.style.getPropertyValue('--ui-scale'), Math.max(0.82, Math.min(1, 390 / 420)).toFixed(4));

  globalThis.innerWidth = 360;
  globalThis.innerHeight = 740;
  globalThis.updateResponsiveScale();
  assert.equal(dom.root.style.getPropertyValue('--page-scale'), '1.0000');
  assert.equal(dom.root.style.getPropertyValue('--ui-scale'), Math.max(0.82, Math.min(1, 360 / 420)).toFixed(4));
});

test('index.html isolates mobile overrides inside @media (max-width: 767px) and preserves all desktop classes', () => {
  // Desktop classes preserved untouched
  assert.match(html, /class="w-full my-auto grid grid-cols-12 gap-14 items-center pointer-events-auto py-2"/);
  assert.match(html, /class="col-span-7 flex flex-col justify-center"/);
  assert.match(html, /class="col-span-5 flex flex-col items-end justify-center"/);
  assert.match(html, /id="preview-canvas" class="relative w-\[356px\] h-\[356px\]/);
  assert.match(html, /id="project-page-view" class="fixed inset-0 z-40 hidden items-center justify-center overflow-hidden/);
  assert.match(html, /body,\s*html\s*\{[\s\S]*overflow:\s*hidden;/);

  // Mobile media query exists and contains required rules
  const mediaMatch = html.match(/@media\s*\(max-width:\s*767px\)\s*\{([\s\S]*?)@media\s*\(max-width:\s*400px\)/);
  assert.ok(mediaMatch, 'index.html must define @media (max-width: 767px) mobile block');
  const mobileBlock = mediaMatch[1];
  assert.match(mobileBlock, /#project-page-view[\s\S]*overflow-y:\s*auto\s*!important/);
  assert.match(mobileBlock, /#editorial-scale-shell[\s\S]*transform:\s*none\s*!important/);
  assert.match(mobileBlock, /#chapter-nav[\s\S]*overflow-x:\s*auto\s*!important/);
  assert.match(mobileBlock, /flex-direction:\s*column\s*!important/);
  assert.match(mobileBlock, /#preview-canvas[\s\S]*max-width:\s*320px\s*!important[\s\S]*height:\s*260px\s*!important/);
  assert.match(mobileBlock, /#password-container\s*>\s*div[\s\S]*max-width:\s*calc\(100vw - 36px\)/);
  assert.match(mobileBlock, /\.editorial-row[\s\S]*flex-wrap:\s*wrap\s*!important/);
});

test('touch events at 390x844 update Usage, Packages (Account/Expiry), and Error Model cursors', () => {
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 844;
  globalThis.updateResponsiveScale();

  // 1. Usage chart touch scrub
  globalThis.WBState.usageRange = '6H';
  globalThis.WBState.usage6h = {
    labels: ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00'],
    outVals: [100, 200, 300, 400, 500, 600],
    inVals: [10, 20, 30, 40, 50, 60]
  };
  globalThis.WBState.usageHoverIdx = -1;
  const usageTrack = {getBoundingClientRect: () => ({left: 20, width: 300})};
  const usageHit = {
    dataset: {hoverModel: 'UsageModel', hoverIdx: '0'},
    parentElement: usageTrack,
    closest(sel) { return sel === '[data-hover-model]' ? this : null; }
  };
  document.dispatchEvent({type: 'touchmove', target: usageHit, touches: [{clientX: 20 + 250}]});
  assert.equal(globalThis.WBState.usageHoverIdx, 5, 'touchmove near right side should select last usage bucket');

  document.dispatchEvent({type: 'touchstart', target: usageHit, touches: [{clientX: 20 + 60}]});
  assert.equal(globalThis.WBState.usageHoverIdx, 1, 'touchstart at 20% width should select bucket index 1');

  // 2. Packages Expiry chart touch scrub
  globalThis.WBState.packageModelHoverIdx = 0;
  const expirySvg = {
    getAttribute: (k) => (k === 'data-pkg-chart' ? 'expiry' : null),
    getBoundingClientRect: () => ({left: 10, width: 320}),
    closest(sel) { return sel === 'svg[data-pkg-chart]' ? this : null; }
  };
  document.dispatchEvent({type: 'touchmove', target: expirySvg, touches: [{clientX: 10 + 300}]});
  assert.equal(globalThis.WBState.packageModelHoverIdx, 5, 'touchmove on expiry SVG should select rightmost expiry point');

  // 3. Packages Account chart pointermove (touch)
  globalThis.WBState.accounts = [
    {uid: 'a1', name: 'acc1', balance: 1000, quota: 5000, packages: []},
    {uid: 'a2', name: 'acc2', balance: 2000, quota: 5000, packages: []},
    {uid: 'a3', name: 'acc3', balance: 3000, quota: 5000, packages: []}
  ];
  globalThis.WBState.packageModelAccountPage = 0;
  globalThis.WBState.packageModelAccountUid = null;
  const accountSvg = {
    getAttribute: (k) => (k === 'data-pkg-chart' ? 'account' : null),
    getBoundingClientRect: () => ({left: 0, width: 520}),
    closest(sel) { return sel === 'svg[data-pkg-chart]' ? this : null; }
  };
  document.dispatchEvent({type: 'pointermove', pointerType: 'touch', buttons: 1, target: accountSvg, clientX: 205});
  assert.equal(globalThis.WBState.packageModelAccountUid, 'a3', 'touch pointermove near x=210 should select 3rd account point');
  assert.equal(dom.$('pkg-model-cursor').getAttribute('x1'), 210);
  assert.match(dom.$('pkg-model-readout').textContent, /账号 acc3/);

  // 4. Error Model chart touch scrub
  globalThis.WBState.errorModelSeries = {
    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
    lambdaVals: [0, 0.2, 0.5, 1.1, 0.8, 0.3, 0.1],
    rawCounts: [0, 1, 2, 4, 2, 1, 0],
    warnLine: 2.0
  };
  globalThis.WBState.logModelHoverIdx = -1;
  const errTrack = {getBoundingClientRect: () => ({left: 0, width: 300})};
  const errHit = {
    dataset: {hoverModel: 'ErrorModel', hoverIdx: '0'},
    parentElement: errTrack,
    closest(sel) { return sel === '[data-hover-model]' ? this : null; }
  };
  document.dispatchEvent({type: 'touchmove', target: errHit, touches: [{clientX: 150}]});
  assert.equal(globalThis.WBState.logModelHoverIdx, 3, 'touchmove at 50% width should select midpoint error bucket 3');
});
