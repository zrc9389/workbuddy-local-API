import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("assets/geometric.js", import.meta.url), "utf8");

test("BUG-FE-01: password button has fixed size and supports three text states", () => {
    assert.match(html, /id="btn-enter-system"[^>]*w-\[260px\]\s+h-\[40px\]/);
    assert.match(js, /updatePasswordUiState\s*\(\s*mode/);
    assert.match(js, /\[ INITIALIZE WORKSPACE \]/);
    assert.match(js, /\[ ACCESS WORKSPACE \]/);
    assert.match(js, /\[ RE-ENTER KEY \]/);
});

test("BUG-FE-02 & BUG-FE-04: enter page highlight uses click coords, sphere skips highlight", () => {
    assert.match(js, /spawnGridHighlightWave\s*\([^)]*isFullScreenNoDecay/);
    assert.match(js, /if\s*\(\s*projectId\s*!==\s*["']sphere["']\s*\)/);
    assert.match(js, /pageTransition\.clickX/);
});

test("BUG-FE-03: non-entering click keeps only local pond ripple and no grid wave", () => {
    const clickIdx = js.indexOf("worldCanvas.addEventListener('click'");
    assert.ok(clickIdx > 0);
    const clickHandler = js.slice(clickIdx, clickIdx + 2500);
    assert.doesNotMatch(clickHandler, /spawnGridHighlightWave\s*\(/);
    assert.match(clickHandler, /spawnPondRipple\s*\(/);
});

test("BUG-FE-05: return animation does not supplement center highlight wave", () => {
    const retIdx = js.indexOf("function triggerReturnToMatrix");
    assert.ok(retIdx > 0);
    const retBody = js.slice(retIdx, retIdx + 1500);
    assert.doesNotMatch(retBody, /spawnGridHighlightWave\s*\(/);
});

test("BUG-FE-06: egress ring pulses yellow during probe and shakes red only on all timeout", () => {
    assert.match(js, /const\s+allTimeout\s*=\s*status\.total\s*>\s*0\s*&&\s*status\.failed\s*>=\s*status\.total/);
    assert.match(js, /ringFailed\s*=\s*status\.cancelled\s*\|\|\s*boundFailure\s*\|\|\s*\(!nodeID\s*&&\s*allTimeout\)/);
});

test("BUG-FE-07: node failure and timeout unified to timeout, unavailable to end, no breaker text", () => {
    assert.ok(js.includes("Boolean(n.timeout || n.status === 'error') ? '超时'"));
    assert.match(js, /rankGroup\s*=\s*2;/);
    assert.ok(js.includes("acc.state === 'BLOCKED' || acc.state === 'TOKEN_EXPIRED'"));
});

test("BUG-FE-08: CN and GLOBAL OAuth links remembered separately", () => {
    assert.match(js, /loginAuthUrls:\s*\{\s*CN:\s*["']["'],\s*GLOBAL:\s*["']["']\s*\}/);
    assert.match(js, /WBState\.loginAuthUrls\[realm\]/);
});

test("BUG-FE-09: credential JSON import indicator position adjusted", () => {
    assert.match(js, /\u5bfc\u5165\u8d26\u53f7\u51ed\u636e JSON/);
    assert.match(js, /inline-block\s+w-1\.5\s+h-1\.5\s+rounded-full/);
});

test("BUG-FE-10: package table columns fixed width and aligned", () => {
    assert.match(js, /grid-template-columns:\s*140px\s+68px\s+96px\s+110px\s+50px/);
});

test("BUG-FE-11: usage chart uses Beijing time and shows interval accumulated totals", () => {
    assert.match(js, /d\.getTimezoneOffset\(\)\s*\+\s*480/);
    assert.match(js, /\u533a\u95f4\u7d2f\u8ba1:\s*\u8f93\u51fa/);
});
