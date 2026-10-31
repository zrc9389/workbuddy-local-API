import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const geoPath = path.join(__dirname, "assets/geometric.js");
const cssPath = path.join(__dirname, "assets/tailwind.css");
const eventsPath = path.join(__dirname, "assets/editorial-events.js");

const geoSrc = fs.readFileSync(geoPath, "utf8");
const cssSrc = fs.readFileSync(cssPath, "utf8");
const eventsSrc = fs.readFileSync(eventsPath, "utf8");

test("PHASE2-01: password input border has 1.2s transition and fadeout timer, button stays until input", () => {
    assert.match(cssSrc, /#input-access-key\s*\{[^}]*transition:[^}]*border-color\s+1\.2s\s+ease/);
    assert.match(cssSrc, /#input-access-key\s*\{[^}]*transition:[^}]*box-shadow\s+1\.2s\s+ease/);
    assert.match(geoSrc, /setTimeout\s*\(\s*\(\)\s*=>\s*\{\s*accessKeyInput\.classList\.remove\(\x27access-denied-border\x27\);\s*\},\s*1200\);/);
    assert.match(geoSrc, /accessKeyInput\.addEventListener\(\x27input\x27[^}]*updatePasswordUiState/);
});

test("PHASE2-02: editorial-events routes reset-oauth to resetOAuthLoginLink", () => {
    assert.match(eventsSrc, /case\s+[\x27"]reset-oauth[\x27"]:\s+if\s*\(typeof\s+globalObj\.resetOAuthLoginLink\s*===\s*[\x27"]function[\x27"]\)\s+globalObj\.resetOAuthLoginLink\(\);\s+return\s+true;/);
    assert.match(geoSrc, /window\.resetOAuthLoginLink\s*=/);
    assert.match(geoSrc, /clearInterval\(WBState\.oauthPollTimer\)/);
    assert.match(geoSrc, /setPreviewFrameState\([\x27"]idle[\x27"]\)/);
});

test("PHASE2-03: OAuth polling success and timeout lifecycle transitions to idle/success", () => {
    assert.match(geoSrc, /WBState\.oauthWaiting\s*=\s*false;\s*setPreviewFrameState\([\x27"]success[\x27"],\s*800\);/);
    assert.match(geoSrc, /if\s*\(!WBState\.accountSubmode\s*\|\|\s*pollAttempts\s*>\s*60\)[^}]*setPreviewFrameState\([\x27"]idle[\x27"]\)/);
});

test("PHASE2-04: Theme and Slogan persistence initializes from localStorage and restores on boot", () => {
    assert.match(geoSrc, /let\s+currentWeatherKey\s*=\s*\(typeof\s+localStorage\s*!==\s*[\x27"]undefined[\x27"]\s*&&\s*localStorage\.getItem\([\x27"]wb_active_theme[\x27"]\)\)\s*\|\|\s*[\x27"]overcast[\x27"]/);
    assert.match(geoSrc, /switchWeatherTheme\(currentWeatherKey\)/);
    assert.match(geoSrc, /applyCurrentMottoToHome\(\)/);
});

test("PHASE2-05: Account egress probing handles unconfigured node as LOCAL (yellow) and clears on chapter switch", () => {
    assert.match(geoSrc, /acc\._probeResult\s*=\s*[\x27"]LOCAL[\x27"];/);
    assert.match(geoSrc, /function\s+switchChapterInPlace\(chapterId\)\s*\{[^}]*WBState\.egressProbed\s*=\s*false;/);
    assert.match(geoSrc, /function\s+triggerReturnToMatrix\(\)\s*\{[^}]*WBState\.egressProbed\s*=\s*false;/);
    assert.doesNotMatch(geoSrc, /egressCls\s*=\s*[\x27"]tone-fault[\x27"]/);
});

test("PHASE2-06: Main menu click restricts to 3x3 neighbors and resolves Euclidean nearest candidate", () => {
    assert.match(geoSrc, /Math\.abs\(p\.col\s*-\s*closestTile\.c\)\s*<=\s*1\s*&&\s*Math\.abs\(p\.row\s*-\s*closestTile\.r\)\s*<=\s*1/);
    assert.match(geoSrc, /cands\.sort\(\(a,\s*b\)\s*=>\s*a\.dist\s*-\s*b\.dist\)/);
});