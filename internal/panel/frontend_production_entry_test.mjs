globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDOM } from './frontend_helpers_test.mjs';

const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');

test('index.html must have exactly one script tag pointing to /panel/app.js and zero inline business scripts', () => {
    // 匹配所有 <script 标签
    const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

    assert.equal(scriptMatches.length, 1, `expected exactly 1 script tag in index.html, found ${scriptMatches.length}`);

    const [fullTag, attrs, body] = scriptMatches[0];
    
    // 必须指向唯一的生产入口 /panel/app.js
    assert.match(attrs, /src="\/panel\/app\.js"/, 'script tag must have src="/panel/app.js"');
    assert.match(attrs, /type="module"/, 'script tag must be an ES module');

    // 绝对不允许任何内联业务脚本代码
    assert.equal(body.trim(), '', 'script tag must not contain inline business code');

    // 不存在多余的相对路径 app.js 引用
    assert.doesNotMatch(html, /src="app\.js"/, 'relative app.js duplicate reference must be removed');
});

test('index.html preserves allowed stylesheet links and inline style configurations', () => {
    // 允许且必须保留样式表
    assert.match(html, /<link rel="stylesheet" href="\/panel\/assets\/tailwind\.css">/);
    assert.match(html, /<link rel="stylesheet" href="\/panel\/assets\/styles\.css">/);
    assert.match(html, /<style>[\s\S]*<\/style>/, 'allowed inline styles must be preserved');
});

test('geometric and editorial event delegation runtimes guarantee idempotent single initialization', async () => {
    const dom = setupDOM();
    dom.Element.prototype.getContext = () => ({
        fillRect: () => {}, clearRect: () => {}, beginPath: () => {}, stroke: () => {}, fill: () => {},
        moveTo: () => {}, lineTo: () => {}, arc: () => {}, save: () => {}, restore: () => {},
        setTransform: () => {}, resetTransform: () => {}, scale: () => {}, translate: () => {},
        drawImage: () => {}, measureText: () => ({ width: 10 }), fillText: () => {}, strokeText: () => {},
        createImageData: () => ({ data: [] }), getImageData: () => ({ data: [] }), putImageData: () => {},
        setLineDash: () => {}, strokeRect: () => {}
    });

    globalThis.window = globalThis.window || globalThis;
    globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
    globalThis.window.innerWidth = 1200;
    globalThis.window.innerHeight = 800;

    const { bootGeometricRuntime } = await import('./assets/geometric.js');
    const { initEditorialEventDelegation } = await import('./assets/editorial-events.js');

    globalThis.window.__geometricBooted = false;
    globalThis.window.__geometricLoading = false;

    // 首次调用引导
    bootGeometricRuntime();
    assert.equal(globalThis.window.__geometricBooted, true, 'window.__geometricBooted must be true after initial boot');

    // 重复触发多次引导，验证状态守卫稳定且安全
    bootGeometricRuntime();
    bootGeometricRuntime();
    assert.equal(globalThis.window.__geometricBooted, true, 'repeated boots must remain guarded and idempotent');

    // 测试事件代理幂等性
    let listenerCount = 0;
    const mockDoc = {
        _editorialDelegated: false,
        addEventListener: () => { listenerCount++; }
    };

    initEditorialEventDelegation(mockDoc);
    const initialListeners = listenerCount;
    assert.ok(initialListeners > 0, 'delegation must register event listeners');
    assert.equal(mockDoc._editorialDelegated, true);

    // 重复初始化
    initEditorialEventDelegation(mockDoc);
    initEditorialEventDelegation(mockDoc);
    assert.equal(listenerCount, initialListeners, 'duplicate delegation calls must not register duplicate listeners');
});

