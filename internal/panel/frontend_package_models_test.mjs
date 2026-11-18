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

test('getWeibullModelPoints buckets packs into mutually exclusive intervals with max-bucket y scaling and zero baseline', () => {
    // 1. Mutually exclusive check: days=27, days=45, days=null all fall ONLY into bucket 5 (30D); buckets 0..4 stay 0 & y=68
    globalThis.WBState.accounts = [
        {
            uid: 'u-far-1',
            name: 'acct-far-1',
            balance: 1000,
            quota: 5000,
            packages: [
                { id: 'p27', days: 27, remain: 100 },
                { id: 'p45', days: 45, remain: 200 },
            ],
        },
        {
            uid: 'u-far-2',
            name: 'acct-far-2',
            balance: 500,
            quota: 5000,
            packages: [
                { id: 'pnull', days: null, remain: 300 },
            ],
        },
        {
            uid: 'u-blocked',
            name: 'acct-blocked',
            blocked: true,
            balance: 9999,
            quota: 9999,
            packages: [{ id: 'pb1', days: 1, remain: 9999 }],
        },
    ];
    const farPts = getWeibullModelPoints();
    assert.equal(farPts.length, 6);
    assert.deepEqual(farPts.map(p => p.x), [40, 110, 210, 310, 410, 500]);
    for (let i = 0; i < 5; i++) {
        assert.equal(farPts[i].packs, 0, `bucket ${i} must have 0 packs`);
        assert.equal(farPts[i].expAcc, 0, `bucket ${i} must have 0 accounts`);
        assert.equal(farPts[i].y, 68, `bucket ${i} with 0 packs must sit on baseline y=68`);
    }
    assert.equal(farPts[5].day, 30);
    assert.equal(farPts[5].axisLabel, '30D');
    assert.equal(farPts[5].rangeLabel, '21~30天+');
    assert.equal(farPts[5].cardLabel, '21-30天+');
    assert.equal(farPts[5].packs, 3);
    assert.equal(farPts[5].bucketPacks, 3);
    assert.equal(farPts[5].expiringPacks, 3);
    assert.equal(farPts[5].expAcc, 2);
    assert.equal(farPts[5].y, 16);

    // 2. Max-bucket normalization check: max bucket (4 packs) -> y=16, half bucket (2 packs) -> y=42, single pack (1) -> y=55, 0 -> y=68
    globalThis.WBState.accounts = [
        {
            uid: 'u-norm-1',
            name: 'acct-norm-1',
            balance: 1000,
            quota: 5000,
            packages: [
                { id: 'd1', days: 1, remain: 10 },        // bucket 0 (1 pack)
                { id: 'd6', days: 6, remain: 10 },        // bucket 3 (2 packs total)
                { id: 'd10', days: 10, remain: 10 },      // bucket 3
                { id: 'd11', days: 11, remain: 10 },      // bucket 4 (4 packs total -> max)
                { id: 'd15', days: 15, remain: 10 },      // bucket 4
            ],
        },
        {
            uid: 'u-norm-2',
            name: 'acct-norm-2',
            balance: 1000,
            quota: 5000,
            packages: [
                { id: 'd18', days: 18, remain: 10 },      // bucket 4
                { id: 'd20', days: 20, remain: 10 },      // bucket 4
            ],
        },
    ];
    const normPts = getWeibullModelPoints();
    assert.deepEqual(normPts.map(p => p.packs), [1, 0, 0, 2, 4, 0]);
    assert.deepEqual(normPts.map(p => p.expAcc), [1, 0, 0, 1, 2, 0]);
    assert.equal(normPts[4].y, 16, 'max bucket must map to top y=16');
    assert.equal(normPts[3].y, 42, 'half-max bucket must map to midpoint y=42');
    assert.equal(normPts[0].y, 55, 'quarter-max bucket must map to y=55');
    assert.equal(normPts[1].y, 68, 'zero bucket must map to baseline y=68');
    assert.equal(normPts[2].y, 68);
    assert.equal(normPts[5].y, 68);

    // 3. Empty packs state: all 6 buckets have packs=0 and y=68
    globalThis.WBState.accounts = [];
    const emptyPts = getWeibullModelPoints();
    assert.deepEqual(emptyPts.map(p => p.packs), [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(emptyPts.map(p => p.y), [68, 68, 68, 68, 68, 68]);
});

test('07 packages EXPIRY view renders bucket cards without % or / and updates compact readout on hover', () => {
    globalThis.WBState.accounts = [
        {
            uid: 'u-exp-1',
            name: 'acct-exp-1',
            balance: 1000,
            quota: 5000,
            packages: [
                { id: 'p1', days: 1, remain: 900 },
                { id: 'p15a', days: 15, remain: 25 },
                { id: 'p15b', days: 15, remain: 25 },
                { id: 'p27', days: 27, remain: 25 },
            ],
        },
    ];

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
    assert.match(expiryHtml, /时段 1天内 — 到期 1 包 \/ 1 账号/);

    // Bottom 6 cards must show interval labels and "${packs} 包" with zero "%" or "/"
    const cardSectionStart = expiryHtml.indexOf('<div class="grid grid-cols-6 gap-2 pt-1 text-[10.5px]">');
    assert.ok(cardSectionStart > 0, 'EXPIRY footer 6-column grid must exist');
    const cardSection = expiryHtml.slice(cardSectionStart);
    assert.equal((cardSection.match(/data-hover-model="package"/g) || []).length, 6);
    assert.ok(!cardSection.includes('%'), 'EXPIRY footer cards must not contain %');
    const cardValues = [...cardSection.matchAll(/<div class="text-white font-medium">([^<]+)<\/div>/g)].map(m => m[1]);
    assert.deepEqual(cardValues, ['1 包', '0 包', '0 包', '0 包', '2 包', '1 包']);
    for (const val of cardValues) {
        assert.ok(!val.includes('/') && !val.includes('%'), `card value "${val}" must not contain / or %`);
    }

    // Hover updates readout with matching rangeLabel (each rangeLabel includes its day figure)
    window.hoverPackageModelPoint(4);
    assert.equal(dom.$('pkg-model-readout').textContent, '时段 11~20天 — 到期 2 包 / 1 账号');
    window.hoverPackageModelPoint(5);
    assert.equal(dom.$('pkg-model-readout').textContent, '时段 21~30天+ — 到期 1 包 / 1 账号');
});

test('07 packages ACCOUNT view removes placeholder cards and drops polyline smoothly to baseline y=68', () => {
    globalThis.WBState.accounts = [
        {
            uid: 'u-acc-1',
            name: '1-alpha',
            balance: 5000, // ratio=1 -> y=16
            quota: 5000,
            packages: [{ id: 'a1', days: 10, remain: 5000 }],
        },
        {
            uid: 'u-acc-2',
            name: '2-beta',
            balance: 2500, // ratio=0.5 -> y=42
            quota: 5000,
            packages: [{ id: 'a2', days: 10, remain: 2500 }],
        },
    ];
    globalThis.WBState.currentChapter = 'packages';
    globalThis.WBState.packageView = 'MODEL';
    globalThis.WBState.packageModelMode = 'ACCOUNT';
    globalThis.WBState.packageModelAccountPage = 0;
    globalThis.WBState.packageModelAccountUid = 'u-acc-1';
    window.renderEditorialStage(false);

    const stageEl = dom.$('editorial-stage-body');
    const accountHtml = stageEl.innerHTML;

    assert.ok(!accountHtml.includes('BALANCE / QUOTA'), 'ACCOUNT view must not contain BALANCE / QUOTA prefix');
    assert.ok(!accountHtml.includes('border-white/5'), 'ACCOUNT view must not contain border-white/5 placeholder style');
    assert.match(accountHtml, /<span class="text-white\/60 font-mono shrink-0">账号额度统计<\/span>/);
    assert.match(accountHtml, /<svg data-pkg-chart="account" viewBox="0 0 520 86" class="w-full h-\[86px\] overflow-visible cursor-crosshair">/);

    // Polyline spans all 6 x-coordinates, dropping to zero-line y=68 after the 2nd real account
    assert.match(accountHtml, /<polyline[^>]*points="40,16 110,42 210,68 310,68 410,68 500,68"/);
    // Only 2 real circles and 2 x-axis labels (no dots/labels for zero-line tail)
    assert.equal((accountHtml.match(/<circle /g) || []).length, 2);
    assert.equal((accountHtml.match(/<text x="\d+" y="82"/g) || []).length, 2);
    // Footer renders strictly 2 real account cards and no "--" placeholder cards
    const cardSectionStart = accountHtml.indexOf('<div class="grid grid-cols-6 gap-2 pt-1 text-[10.5px]">');
    assert.ok(cardSectionStart > 0);
    const cardSection = accountHtml.slice(cardSectionStart);
    assert.equal((cardSection.match(/data-hover-model="AccountModel"/g) || []).length, 2);
    assert.ok(!cardSection.includes('>--<'), 'ACCOUNT footer must not render "--" placeholder cards');

    // Empty account list: flat baseline polyline across all 6 x-coords, 0 circles, 0 labels, 0 cards
    globalThis.WBState.accounts = [];
    window.renderEditorialStage(false);
    const emptyHtml = stageEl.innerHTML;
    assert.match(emptyHtml, /<polyline[^>]*points="40,68 110,68 210,68 310,68 410,68 500,68"/);
    assert.equal((emptyHtml.match(/<circle /g) || []).length, 0);
    assert.equal((emptyHtml.match(/<text x="\d+" y="82"/g) || []).length, 0);
    assert.equal((emptyHtml.match(/data-hover-model="AccountModel"/g) || []).length, 0);
});
