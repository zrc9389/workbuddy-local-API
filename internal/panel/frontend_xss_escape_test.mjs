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

const { bootGeometricRuntime } = await import('./assets/geometric.js');
bootGeometricRuntime();

test('XSS escaping prevents raw HTML/attribute injection in accounts, packages and logs views', async () => {
    const payload = '<img src=x onerror=alert(1)>" onclick="evil()';
    const scriptPayload = '<script>window.__xss=1</script>';

    globalThis.WBState.accounts = [
        {
            uid: 'u-xss-1',
            name: payload,
            region: '<b>CN</b>',
            egress: '<svg onload=alert(2)>',
            state: 'ACTIVE',
            status: 'ACTIVE',
            balance: 100,
            quota: 200,
            bal: 100,
            quotaTotal: 200,
            manualOn: true,
            active: true,
            manualDisabled: false,
            packages: [
                {
                    id: 'pkg-"<img src=x>',
                    name: scriptPayload,
                    remain: 50,
                    total: 100,
                    days: 12,
                },
            ],
        },
    ];
    globalThis.WBState.logs = [
        {
            id: 'log-1"<x>',
            uid: 'u-xss-1',
            time: '12:00<script>',
            code: 500,
            model: '<img src=y onerror=1>',
            egress: '<iframe src=javascript:1>',
            summary: payload,
            raw: scriptPayload + ' " onmouseover="boom()',
        },
    ];

    const stage = dom.$('editorial-stage-body');
    const assertSafeMarkup = (label, html) => {
        assert.ok(!html.includes('<img '), `${label}: unescaped <img tag found`);
        assert.ok(!html.includes('<script>'), `${label}: unescaped <script> tag found`);
        assert.ok(!html.includes('<svg onload='), `${label}: unescaped <svg onload tag found`);
        assert.ok(!html.includes('<iframe '), `${label}: unescaped <iframe tag found`);
        assert.ok(!html.includes('<b>CN</b>'), `${label}: unescaped <b> tag found`);
        assert.ok(!html.includes('" onclick="evil()'), `${label}: unescaped attribute breakout found`);
    };

    // 1. Accounts chapter
    globalThis.WBState.currentChapter = 'accounts';
    globalThis.renderEditorialStage(false);
    assertSafeMarkup('accounts', stage.innerHTML);
    assert.ok(stage.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'), 'accounts name should be HTML escaped');

    // 2. Packages list view
    globalThis.WBState.currentChapter = 'packages';
    globalThis.WBState.packageView = 'LIST';
    globalThis.WBState.selectedPackageUid = null;
    globalThis.renderEditorialStage(false);
    assertSafeMarkup('packages-list', stage.innerHTML);

    // 3. Packages account detail view
    globalThis.WBState.selectedPackageUid = 'u-xss-1';
    globalThis.renderEditorialStage(false);
    assertSafeMarkup('packages-detail', stage.innerHTML);
    assert.ok(stage.innerHTML.includes('&lt;script&gt;window.__xss=1&lt;/script&gt;'), 'package name should be HTML escaped');

    // 4. Packages account model view
    globalThis.WBState.selectedPackageUid = null;
    globalThis.WBState.packageView = 'MODEL';
    globalThis.WBState.packageModelKind = 'ACCOUNT';
    globalThis.renderEditorialStage(false);
    assertSafeMarkup('packages-model', stage.innerHTML);

    // 5. Logs list view
    globalThis.WBState.currentChapter = 'logs';
    globalThis.WBState.logView = 'LIST';
    globalThis.WBState.selectedLogId = null;
    globalThis.renderEditorialStage(false);
    assertSafeMarkup('logs-list', stage.innerHTML);

    // 6. Logs detail view
    globalThis.WBState.selectedLogId = 'log-1"<x>';
    globalThis.renderEditorialStage(false);
    assertSafeMarkup('logs-detail', stage.innerHTML);
    assert.ok(stage.innerHTML.includes('&lt;script&gt;window.__xss=1&lt;/script&gt;'), 'log raw snapshot should be HTML escaped');
});
