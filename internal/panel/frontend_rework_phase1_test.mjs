import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("assets/tailwind.css", import.meta.url), "utf8");
const js = readFileSync(new URL("assets/geometric.js", import.meta.url), "utf8");

test("REWORK-01: index.html and tailwind.css password button fixed 260x40 rules", () => {
    // 1. index.html inline style fixed size rules
    assert.match(html, /id="btn-enter-system"[^>]*style="[^"]*width:\s*260px\s*!important/i);
    assert.match(html, /id="btn-enter-system"[^>]*style="[^"]*height:\s*40px\s*!important/i);
    assert.match(html, /id="btn-enter-system"[^>]*style="[^"]*min-width:\s*260px\s*!important/i);
    assert.match(html, /id="btn-enter-system"[^>]*style="[^"]*max-width:\s*260px\s*!important/i);
    assert.match(html, /id="btn-enter-system"[^>]*style="[^"]*min-height:\s*40px\s*!important/i);
    assert.match(html, /id="btn-enter-system"[^>]*style="[^"]*max-height:\s*40px\s*!important/i);
    assert.match(html, /id="btn-enter-system"[^>]*style="[^"]*box-sizing:\s*border-box\s*!important/i);

    // 2. tailwind.css rules
    assert.match(css, /\.w-\\\[260px\\\]\s*\{\s*width:\s*260px\s*!important;?\s*\}/);
    assert.match(css, /\.h-\\\[40px\\\]\s*\{\s*height:\s*40px\s*!important;?\s*\}/);
    assert.match(css, /#btn-enter-system\s*\{[^}]*width:\s*260px\s*!important;/s);
    assert.match(css, /#btn-enter-system\s*\{[^}]*height:\s*40px\s*!important;/s);
    assert.match(css, /#btn-enter-system\s*\{[^}]*min-width:\s*260px\s*!important;/s);
    assert.match(css, /#btn-enter-system\s*\{[^}]*max-width:\s*260px\s*!important;/s);
    assert.match(css, /#btn-enter-system\s*\{[^}]*min-height:\s*40px\s*!important;/s);
    assert.match(css, /#btn-enter-system\s*\{[^}]*max-height:\s*40px\s*!important;/s);
    assert.match(css, /#btn-enter-system\s*\{[^}]*box-sizing:\s*border-box\s*!important;/s);
});

test("REWORK-02: state machine empty password vs wrong password text differentiation", () => {
    // 1. Static pattern checks
    assert.match(js, /updatePasswordUiState\s*\(\s*mode/);
    assert.match(js, /mode\s*===\s*['"]EMPTY_DENIED['"]/);
    assert.match(js, /\[ KEY REQUIRED \]/);
    assert.match(js, /\[ ACCESS KEY REQUIRED \/\/ PLEASE ENTER KEY \]/);
    assert.match(js, /mode\s*===\s*['"]DENIED['"]/);
    assert.match(js, /\[ RE-ENTER KEY \]/);
    assert.match(js, /\[ ACCESS DENIED \/\/ INVALID ACCESS KEY \]/);
    assert.match(js, /triggerAccessDeniedAnimation\([^,)]*,\s*true\)/);

    // 2. Functional execution via vm
    function createMockElement(id) {
        return {
            id,
            value: '',
            textContent: '',
            placeholder: '',
            attrs: {},
            style: {},
            classList: {
                classes: new Set(),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); }
            },
            setAttribute(k, v) { this.attrs[k] = v; },
            getAttribute(k) { return this.attrs[k]; },
            querySelector() { return null; }
        };
    }

    const enterBtn = createMockElement('btn-enter-system');
    const accessKeyInput = createMockElement('input-access-key');
    const pwdHint = createMockElement('password-hint');

    const domMap = {
        'btn-enter-system': enterBtn,
        'input-access-key': accessKeyInput,
        'password-hint': pwdHint
    };

    const fnStart = js.indexOf('function updatePasswordUiState(mode');
    const fnEnd = js.indexOf('async function checkPasswordSessionInitialState()');
    assert.ok(fnStart > 0 && fnEnd > fnStart);
    const fnSource = js.slice(fnStart, fnEnd);

    const context = vm.createContext({
        passwordUiMode: 'AUTH',
        document: {
            getElementById: (id) => domMap[id] || null
        }
    });

    vm.runInContext(`${fnSource}; globalThis.updatePasswordUiState = updatePasswordUiState;`, context);

    // Test EMPTY_DENIED
    context.updatePasswordUiState('EMPTY_DENIED');
    assert.equal(enterBtn.textContent, '[ KEY REQUIRED ]');
    assert.equal(enterBtn.getAttribute('data-text'), '[ KEY REQUIRED ]');
    assert.equal(pwdHint.textContent, '[ ACCESS KEY REQUIRED // PLEASE ENTER KEY ]');
    assert.ok(pwdHint.classList.contains('text-[#ff5c74]'));

    // Test DENIED
    context.updatePasswordUiState('DENIED');
    assert.equal(enterBtn.textContent, '[ RE-ENTER KEY ]');
    assert.equal(enterBtn.getAttribute('data-text'), '[ RE-ENTER KEY ]');
    assert.equal(pwdHint.textContent, '[ ACCESS DENIED // INVALID ACCESS KEY ]');
    assert.ok(pwdHint.classList.contains('text-[#ff5c74]'));
});

test("REWORK-03: state machine NOT reset by 1.2s timer, driven by input event", () => {
    // 1. Verify triggerAccessDeniedAnimation does NOT contain 1200ms timer
    const fnStart = js.indexOf('function triggerAccessDeniedAnimation(');
    const fnEnd = js.indexOf('async function submitPasswordAndEnter(');
    assert.ok(fnStart > 0 && fnEnd > fnStart);
    const fnSource = js.slice(fnStart, fnEnd);

    assert.doesNotMatch(fnSource, /1200/);
    assert.match(fnSource, /500/);
    // Timer only removes shake class and releases isAuthenticating
    assert.match(fnSource, /setTimeout\s*\(\s*\(\)\s*=>\s*\{[^}]*pwdContainer\.classList\.remove\(['"]access-denied-shake['"]\)[^}]*isAuthenticating\s*=\s*false[^}]*\}\s*,\s*500\s*\)/s);
    assert.doesNotMatch(fnSource, /accessKeyInput\.classList\.remove\(['"]access-denied-border['"]\)/);
    assert.doesNotMatch(fnSource, /accessKeyInput\.value\s*=\s*['"]['"]/);

    // 2. Verify input event listener handles DENIED and EMPTY_DENIED and removes red border
    const listenerStart = js.indexOf("accessKeyInput.addEventListener('input'");
    assert.ok(listenerStart > 0);
    const listenerSource = js.slice(listenerStart, listenerStart + 350);

    assert.match(listenerSource, /passwordUiMode\s*===\s*['"]DENIED['"]\s*\|\|\s*passwordUiMode\s*===\s*['"]EMPTY_DENIED['"]/);
    assert.match(listenerSource, /accessKeyInput\.classList\.remove\(['"]access-denied-border['"]\)/);
    assert.match(listenerSource, /updatePasswordUiState/);
});

test("REWORK-04: bottom right dynamic Uptime formatting and periodic update mechanism", () => {
    // 1. index.html initial labels
    assert.match(html, /id="btn-socials"[^>]*>\s*SYSTEM \/ UPTIME\s*<\/button>/);
    assert.match(html, /id="email-text"[^>]*>\[ UPTIME \/\/ 0d 00:00:00 \]<\/span>/);

    // 2. formatUptime function extraction and functional test
    const fnStart = js.indexOf('function formatUptime(sec)');
    const fnEnd = js.indexOf('function notifyEditorialStatus(msg)');
    assert.ok(fnStart > 0 && fnEnd > fnStart);
    const fnSource = js.slice(fnStart, fnEnd);

    const context = vm.createContext({});
    vm.runInContext(`${fnSource}; globalThis.formatUptime = formatUptime;`, context);

    assert.equal(context.formatUptime(0), '0d 00:00:00');
    assert.equal(context.formatUptime(59), '0d 00:00:59');
    assert.equal(context.formatUptime(3600), '0d 01:00:00');
    assert.equal(context.formatUptime(86400), '1d 00:00:00');
    assert.equal(context.formatUptime(90061), '1d 01:01:01');

    // 3. Heartbeat interval updates #email-text dynamically when not copying
    assert.match(js, /updateBottomRightUptime\s*\(\s*\)/);
    assert.match(js, /\[ UPTIME \/\/ \$\{formatUptime\(WBState\.uptimeSec\)\} \]/);

    // 4. btn-copy-email click listener has 2.2s (2200ms) restore timer
    const copyBtnIdx = js.indexOf("btnCopyEmail.addEventListener('click'");
    assert.ok(copyBtnIdx > 0);
    const copyBtnSource = js.slice(copyBtnIdx, copyBtnIdx + 900);
    assert.match(copyBtnSource, /2200/);
    assert.match(copyBtnSource, /\[ UPTIME \/\/ \$\{formatUptime\(WBState\.uptimeSec\)\} \]/);
});

test("REWORK-05: about page button clean text [ MATRIX ]", () => {
    // Verify sphere branch sets t2 = '[ MATRIX ]' without arrow
    const sphereIdx = js.indexOf("} else if (ch === 'sphere') {");
    assert.ok(sphereIdx > 0);
    const sphereBranch = js.slice(sphereIdx, sphereIdx + 500);

    assert.match(sphereBranch, /t2\s*=\s*['"]\[ MATRIX \]['"]/);
    assert.doesNotMatch(sphereBranch, /\[ <- MATRIX \]/);
});

test("REWORK-06: menu click coordinates cover canvas tile, DOM label overlay, and keyboard fallback", () => {
    // 1. domLabel records clickX/Y
    const domLabelIdx = js.indexOf("domLabel.addEventListener('click'");
    assert.ok(domLabelIdx > 0);
    const domLabelSource = js.slice(domLabelIdx, domLabelIdx + 300);
    assert.match(domLabelSource, /pageTransition\.clickX\s*=\s*ev\.clientX/);
    assert.match(domLabelSource, /pageTransition\.clickY\s*=\s*ev\.clientY/);

    // 2. window captures global click and records lastPointerX/Y
    assert.match(js, /window\.addEventListener\(\s*['"]click['"]\s*,\s*\(ev\)\s*=>\s*\{[^}]*lastPointerX\s*=\s*ev\.clientX;[^}]*lastPointerY\s*=\s*ev\.clientY;[^}]*\}\s*,\s*true\s*\)/s);

    // 3. triggerEnterNewPage falls back to lastPointerX/Y then PROJECTS find
    const enterFnIdx = js.indexOf('function triggerEnterNewPage(projectId');
    const enterFnEnd = js.indexOf('function triggerReturnToMatrix()');
    assert.ok(enterFnIdx > 0 && enterFnEnd > enterFnIdx);
    const enterFnSource = js.slice(enterFnIdx, enterFnEnd);

    assert.match(enterFnSource, /lastPointerX/);
    assert.match(enterFnSource, /PROJECTS\.find\(\s*p\s*=>\s*p\.id\s*===\s*projectId\s*\)/);
    assert.match(enterFnSource, /targetCol\s*=\s*matchedProj\.col/);
    assert.match(enterFnSource, /targetRow\s*=\s*matchedProj\.row/);

    // 4. Test logic with simulated coordinates
    const mockProjects = [
        { id: 'overview', col: 6, row: 2 },
        { id: 'egress', col: 13, row: 1 },
        { id: 'accounts', col: 21, row: 1 }
    ];

    function resolveHighlightCoords(projectId, ptClickX, ptClickY, lpX, lpY) {
        let targetCol = null;
        let targetRow = null;

        let px = (typeof ptClickX === 'number') ? ptClickX : null;
        let py = (typeof ptClickY === 'number') ? ptClickY : null;

        if (px === null || py === null) {
            if (typeof lpX === 'number' && typeof lpY === 'number') {
                px = lpX;
                py = lpY;
            }
        }

        if (px !== null && py !== null) {
            targetCol = Math.round(px / 10);
            targetRow = Math.round(py / 10);
        }

        if (targetCol === null || targetRow === null) {
            const matchedProj = mockProjects.find(p => p.id === projectId);
            if (matchedProj) {
                targetCol = matchedProj.col;
                targetRow = matchedProj.row;
            } else {
                targetCol = 16;
                targetRow = 6;
            }
        }
        return { targetCol, targetRow };
    }

    // Direct click coordinates
    const res1 = resolveHighlightCoords('overview', 50, 20, null, null);
    assert.equal(res1.targetCol, 5);
    assert.equal(res1.targetRow, 2);

    // Fallback to lastPointerX/Y
    const res2 = resolveHighlightCoords('egress', null, null, 130, 10);
    assert.equal(res2.targetCol, 13);
    assert.equal(res2.targetRow, 1);

    // Fallback to PROJECTS (keyboard / no pointer) - NOT center
    const res3 = resolveHighlightCoords('accounts', null, null, null, null);
    assert.equal(res3.targetCol, 21);
    assert.equal(res3.targetRow, 1);
});
