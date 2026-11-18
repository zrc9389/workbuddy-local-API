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
globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;
globalThis.requestAnimationFrame = () => 1;
globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({}) });

const { bootGeometricRuntime, getWeibullModelPoints } = await import('./assets/geometric.js');
bootGeometricRuntime();

test('getWeibullModelPoints computes survival and y height strictly by pack count (more packs -> higher survival & higher y position)', () => {
    // Scenario A: 1000 total credits, 100 surviving credits after day 1 (2 active packs total, 1 surviving)
    globalThis.WBState.accounts = [
        {
            uid: 'u-pack-a',
            name: 'acct-a',
            balance: 1000,
            quota: 5000,
            packages: [
                { id: 'p1', days: 1, remain: 900 },
                { id: 'p2', days: 15, remain: 100 },
            ],
        },
        {
            uid: 'u-blocked',
            name: 'acct-blocked',
            blocked: true,
            balance: 9999,
            quota: 9999,
            packages: [{ id: 'pb', days: 15, remain: 9999 }],
        },
    ];
    const ptsA = getWeibullModelPoints();
    const d1A = ptsA[0];
    assert.equal(d1A.day, 1);
    assert.equal(d1A.remainingPacks, 1);
    assert.equal(d1A.expiringPacks, 1);
    assert.equal(d1A.packs, 1);
    assert.equal(d1A.expAcc, 1);
    assert.equal(d1A.survival, 50);
    assert.equal(d1A.y, Math.round(64 - 0.5 * 48)); // 40

    // Scenario B: IDENTICAL 1000 total credits & IDENTICAL 100 surviving credits after day 1,
    // but split into 5 active packs (4 surviving, 1 expiring) -> 80% > 50%, SVG y=26 < 40 (higher on chart)
    globalThis.WBState.accounts = [
        {
            uid: 'u-pack-b',
            name: 'acct-b',
            balance: 1000,
            quota: 5000,
            packages: [
                { id: 'q1', days: 1, remain: 900 },
                { id: 'q2', days: 15, remain: 25 },
                { id: 'q3', days: 15, remain: 25 },
                { id: 'q4', days: 15, remain: 25 },
                { id: 'q5', days: 15, remain: 25 },
            ],
        },
    ];
    const ptsB = getWeibullModelPoints();
    const d1B = ptsB[0];
    assert.equal(d1B.day, 1);
    assert.equal(d1B.remainingPacks, 4);
    assert.equal(d1B.expiringPacks, 1);
    assert.equal(d1B.packs, 4);
    assert.equal(d1B.expAcc, 1);
    assert.equal(d1B.survival, 80);
    assert.equal(d1B.y, Math.round(64 - 0.8 * 48)); // 26
    assert.ok(d1B.survival > d1A.survival, 'more surviving packs must yield higher survival ratio despite identical credits');
    assert.ok(d1B.y < d1A.y, 'more surviving packs must plot higher on chart (smaller SVG y)');

    // At day 20, all 5 packs have expired -> survival 0%, y = 64
    const d20B = ptsB[4];
    assert.equal(d20B.day, 20);
    assert.equal(d20B.remainingPacks, 0);
    assert.equal(d20B.expiringPacks, 5);
    assert.equal(d20B.survival, 0);
    assert.equal(d20B.y, 64);

    // Empty active packs edge case
    globalThis.WBState.accounts = [];
    const ptsEmpty = getWeibullModelPoints();
    assert.equal(ptsEmpty[0].survival, 0);
    assert.equal(ptsEmpty[0].remainingPacks, 0);
    assert.equal(ptsEmpty[0].expiringPacks, 0);
    assert.equal(ptsEmpty[0].y, 64);
});

test('07 packages EXPIRY model view renders compact pack readout without legacy labels and ACCOUNT model view removes BALANCE / QUOTA prefix', () => {
    globalThis.WBState.accounts = [
        {
            uid: 'u-1',
            name: '1-alpha-very-long-account-name',
            balance: 1000,
            quota: 5000,
            packages: [
                { id: 'q1', days: 1, remain: 900 },
                { id: 'q2', days: 15, remain: 25 },
                { id: 'q3', days: 15, remain: 25 },
                { id: 'q4', days: 15, remain: 25 },
                { id: 'q5', days: 15, remain: 25 },
            ],
        },
    ];

    // 1. EXPIRY model view
    globalThis.WBState.currentChapter = 'packages';
    globalThis.WBState.packageView = 'MODEL';
    globalThis.WBState.packageModelMode = 'EXPIRY';
    globalThis.WBState.packageModelHoverIdx = 0;
    window.renderEditorialStage(false);

    const stageEl = dom.$('editorial-stage-body');
    const expiryHtml = stageEl.innerHTML;
    assert.ok(!expiryHtml.includes('存活积分'), 'EXPIRY view must not contain 存活积分');
    assert.ok(!expiryHtml.includes('已知到期包剩余占比'), 'EXPIRY view must not contain 已知到期包剩余占比');
    assert.match(expiryHtml, /id="pkg-model-readout"[^>]*truncate/);
    assert.match(expiryHtml, /时段 1天 — 存活 4 包 \/ 临期 1 包 \/ 1 账号/);
    assert.match(expiryHtml, /80% \/ 4包/);

    // Verify hoverPackageModelPoint updates readout in the same compact pack format
    window.hoverPackageModelPoint(4);
    assert.equal(dom.$('pkg-model-readout').textContent, '时段 20天 — 存活 0 包 / 临期 5 包 / 1 账号');
    assert.ok(!dom.$('pkg-model-readout').textContent.includes('存活积分'));

    // 2. ACCOUNT model view
    globalThis.WBState.packageModelMode = 'ACCOUNT';
    window.renderEditorialStage(false);

    const accountHtml = stageEl.innerHTML;
    assert.ok(!accountHtml.includes('BALANCE / QUOTA'), 'ACCOUNT view must not contain BALANCE / QUOTA prefix');
    assert.match(accountHtml, /<span class="text-white\/60 font-mono shrink-0">账号额度统计<\/span>/);
    assert.match(accountHtml, /class="flex justify-between items-center gap-3 text-\[10px\]/);
    assert.match(accountHtml, /<span id="pkg-model-readout" class="min-w-0 truncate">/);
    assert.match(accountHtml, /<svg data-pkg-chart="account" viewBox="0 0 520 86" class="w-full h-\[86px\] overflow-visible cursor-crosshair">/);
    assert.match(accountHtml, /y1="68" x2="520" y2="68"/);
    assert.match(accountHtml, /id="pkg-model-cursor" x1="40" y1="0" x2="40" y2="68"/);
    assert.match(accountHtml, /<circle cx="40" cy="54" r="2\.5" fill="#ffffff" opacity="0\.9"/);
    assert.ok(!accountHtml.includes('relative w-full h-5 mt-1.5 font-mono'), 'ACCOUNT X-axis ticks must live inside 86px SVG like EXPIRY');
    assert.equal((accountHtml.match(/<div class="py-1 px-1\.5 border border-white\/(10|5)/g) || []).length, 6, 'ACCOUNT footer must preserve 6 fixed card slots');
});
