const AI_NAMES = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'Kimi', 'GLM'];
const ANIMATION_STYLES = ['names', 'orbital', 'scan', 'minimal'];
const TARGET_MS = 8000;
const HARD_LIMIT_MS = 10000;
const PREVIEW_MS = 3200;
const PREVIEW_HARD_LIMIT_MS = 4200;
const NAME_INTERVAL_MS = 1100;
const FADE_MS = 280;
const STYLE_ID = 'wbStartupStyle';
const STYLE = `
.wb-startup{position:fixed;inset:0;z-index:60;display:grid;place-items:center;overflow:hidden;color:#f4ede7;background:radial-gradient(ellipse at 50% 40%,rgba(212,119,86,.18),transparent 55%),#17120f;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wb-startup[hidden]{display:none}
.wb-startup-glow{position:absolute;width:min(62vw,560px);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(212,119,86,.24),transparent 68%);filter:blur(18px);opacity:.85}
.wb-startup-stage{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:28px}
.wb-startup-ring{position:relative;width:82px;height:82px;margin-bottom:34px}
.wb-startup-ring::before,.wb-startup-ring::after{content:"";position:absolute;inset:0;border-radius:50%;border:1px solid rgba(244,237,231,.16)}
.wb-startup-ring::after{inset:10px;border-color:rgba(212,119,86,.68);border-top-color:transparent;animation:wb-startup-turn 2s linear infinite}
.wb-startup-name{min-height:1.16em;font-size:clamp(36px,7vw,66px);line-height:1.1;font-weight:560;letter-spacing:-.045em;transition:opacity .28s ease,transform .28s ease}
.wb-startup-name.is-fading{opacity:0;transform:translateY(-5px)}
.wb-startup-phase{margin-top:18px;color:rgba(244,237,231,.6);font-size:11px;letter-spacing:.15em;text-transform:uppercase;transition:opacity .28s ease}
.wb-startup[data-style="minimal"] .wb-startup-glow{opacity:.32;filter:blur(34px)}
.wb-startup[data-style="minimal"] .wb-startup-ring{width:34px;height:34px;margin-bottom:26px}
.wb-startup[data-style="minimal"] .wb-startup-ring::before{border-color:rgba(244,237,231,.12)}
.wb-startup[data-style="minimal"] .wb-startup-name{font-size:clamp(22px,3.3vw,34px);font-weight:480;letter-spacing:-.02em}
.wb-startup[data-style="orbital"] .wb-startup-ring{width:184px;height:184px}
.wb-startup[data-style="orbital"] .wb-startup-ring::before{inset:0;border-color:rgba(244,237,231,.1);animation:wb-startup-pulse 2.8s ease-in-out infinite}
.wb-startup[data-style="orbital"] .wb-startup-ring::after{inset:0;border:1px dashed rgba(212,119,86,.5);border-top-color:transparent;animation:wb-startup-turn 8s linear infinite}
.wb-startup[data-style="orbital"] .wb-startup-name{font-size:clamp(30px,5vw,48px)}
.wb-startup-orbit{position:absolute;inset:0;border-radius:50%;pointer-events:none}
.wb-startup:not([data-style="orbital"]) .wb-startup-orbit{display:none}
.wb-startup-orbit span{position:absolute;top:50%;left:50%;width:9px;height:9px;margin:-4.5px;border-radius:50%;background:#e8a279;box-shadow:0 0 16px rgba(212,119,86,.9);transform:rotate(var(--a)) translateX(calc(var(--r) * 1px))}
.wb-startup-orbit span:nth-child(2n){background:#f4ede7;width:5px;height:5px;margin:-2.5px;opacity:.7}
.wb-startup[data-style="scan"] .wb-startup-glow{opacity:.4;width:min(82vw,760px);border-radius:12%;background:linear-gradient(90deg,transparent,rgba(212,119,86,.24),transparent);aspect-ratio:auto;height:44px;top:50%;margin-top:-22px;filter:blur(20px)}
.wb-startup[data-style="scan"] .wb-startup-ring{width:52px;height:52px;margin-bottom:30px}
.wb-startup-scanline{position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(244,237,231,.9),transparent);box-shadow:0 0 24px 3px rgba(212,119,86,.55);animation:wb-startup-scan 2.2s cubic-bezier(.45,0,.25,1) infinite}
.wb-startup:not([data-style="scan"]) .wb-startup-scanline{display:none}
.wb-startup[data-style="scan"] .wb-startup-name{font-size:clamp(28px,5vw,50px);text-shadow:0 0 34px rgba(212,119,86,.35)}
.wb-startup-preview{bottom:auto;top:auto;height:min(64vh,520px);border-radius:24px;box-shadow:0 34px 90px rgba(0,0,0,.45);border:1px solid rgba(244,237,231,.14)}
.wb-startup-preview .wb-startup-stage{transform:scale(.92)}
@keyframes wb-startup-turn{to{transform:rotate(360deg)}}
@keyframes wb-startup-pulse{0%,100%{transform:scale(.92);opacity:.35}50%{transform:scale(1.06);opacity:.7}}
@keyframes wb-startup-scan{0%{transform:translateY(0);opacity:0}12%{opacity:1}88%{opacity:1}100%{transform:translateY(min(64vh,520px));opacity:0}}
@media (prefers-reduced-motion:reduce){.wb-startup-ring::after,.wb-startup-scanline,.wb-startup-orbit span{animation:none}.wb-startup-name,.wb-startup-phase{transition:none}}
`;

function mountStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (document.head || document.body || document.documentElement).appendChild(style);
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function removeElement(element) {
  if (!element) return;
  element.remove?.();
  if (element.parentNode) element.parentNode.removeChild(element);
}

export function normalizeAnimationStyle(value) {
  const style = String(value || '').trim().toLowerCase();
  return ANIMATION_STYLES.includes(style) ? style : 'names';
}

function phaseText(style, syncing) {
  if (syncing) return 'Syncing your accounts';
  if (style === 'orbital') return 'Aligning your accounts';
  if (style === 'scan') return 'Scanning the workspace';
  if (style === 'minimal') return 'Opening your workspace';
  return 'Waking the workspace';
}

export function startStartupAnimation(options = {}) {
  const onFinish = typeof options.onFinish === 'function' ? options.onFinish : () => {};
  const style = normalizeAnimationStyle(options.style ?? options.animationStyle);
  const preview = options.preview === true;
  const targetMs = options.targetMs ?? (preview ? PREVIEW_MS : TARGET_MS);
  const hardLimitMs = options.hardLimitMs ?? (preview ? PREVIEW_HARD_LIMIT_MS : HARD_LIMIT_MS);
  const schedule = options.schedule || setTimeout;
  const repeat = options.repeat || setInterval;
  const cancelSchedule = options.cancelSchedule || clearTimeout;
  const cancelRepeat = options.cancelRepeat || clearInterval;
  const host = options.host && typeof options.host.appendChild === 'function' ? options.host : null;
  const previous = (!preview && !host) ? document.getElementById('wbStartup') : null;
  if (previous) removeElement(previous);
  const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  mountStyle();
  const root = node('div', preview ? 'wb-startup wb-startup-preview' : 'wb-startup');
  if (!preview && !host) root.id = 'wbStartup';
  if (preview) root.id = 'wbStartupPreview';
  root.dataset.style = style;
  root.dataset.phase = 'names';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-label', preview ? '启动动画预览' : '正在启动工作台');
  const glow = node('div', 'wb-startup-glow');
  glow.setAttribute('aria-hidden', 'true');
  const stage = node('div', 'wb-startup-stage');
  const ring = node('div', 'wb-startup-ring');
  ring.setAttribute('aria-hidden', 'true');
  const name = node('p', 'wb-startup-name', AI_NAMES[0]);
  const phase = node('p', 'wb-startup-phase', phaseText(style, false));
  stage.appendChild(ring);
  stage.appendChild(name);
  stage.appendChild(phase);
  root.appendChild(glow);
  root.appendChild(stage);
  const orbit = node('div', 'wb-startup-orbit');
  const dots = preview ? 10 : 18;
  for (let index = 0; index < dots; index++) {
    const dot = node('span');
    dot.style?.setProperty?.('--a', (index * 360 / dots) + 'deg');
    dot.style?.setProperty?.('--r', String(64 + (index % 3) * 11));
    orbit.appendChild(dot);
  }
  ring.appendChild(orbit);
  const scanline = node('div', 'wb-startup-scanline');
  scanline.setAttribute('aria-hidden', 'true');
  stage.appendChild(scanline);
  (host || document.body || document.documentElement).appendChild(root);

  let nameIndex = 0;
  let nameTimer = null;
  let fadeTimer = null;
  let targetTimer = null;
  let hardTimer = null;
  let finished = false;
  let paused = false;
  let phaseName = 'idle';

  function clearTimers() {
    if (nameTimer !== null) cancelRepeat(nameTimer);
    if (fadeTimer !== null) cancelSchedule(fadeTimer);
    if (targetTimer !== null) cancelSchedule(targetTimer);
    if (hardTimer !== null) cancelSchedule(hardTimer);
    nameTimer = fadeTimer = targetTimer = hardTimer = null;
  }

  function teardown() {
    if (finished) return;
    finished = true;
    clearTimers();
    document.removeEventListener('visibilitychange', onVisibility);
    removeElement(root);
    onFinish();
  }

  function finish() { teardown(); }
  function destroy() { teardown(); }

  function setPhase(value) {
    if (finished) return;
    phaseName = value === 'syncing' ? 'syncing' : 'names';
    root.dataset.phase = phaseName;
    phase.textContent = phaseText(root.dataset.style, phaseName === 'syncing');
  }

  function setStyle(value) {
    if (finished) return;
    const next = normalizeAnimationStyle(value);
    root.dataset.style = next;
    phase.textContent = phaseText(next, phaseName === 'syncing');
    syncMotion(next);
    return next;
  }

  function onVisibility() {
    if (document.hidden) {
      paused = true;
      if (nameTimer !== null) { cancelRepeat(nameTimer); nameTimer = null; }
      if (fadeTimer !== null) { cancelSchedule(fadeTimer); fadeTimer = null; }
      name.classList.remove('is-fading');
      return;
    }
    if (paused && !finished && !reduced && nameTimer === null && needsNameCycle() && !options.staticName) resumeNames();
    paused = false;
  }

  function resumeNames() {
    if (nameTimer !== null) return;
    nameTimer = repeat(() => {
      nameIndex = (nameIndex + 1) % AI_NAMES.length;
      name.classList.add('is-fading');
      fadeTimer = schedule(() => {
        fadeTimer = null;
        if (finished) return;
        name.textContent = AI_NAMES[nameIndex];
        name.classList.remove('is-fading');
      }, FADE_MS);
    }, NAME_INTERVAL_MS);
  }
  function syncMotion(value) {
    const motionStyle = value === undefined ? root.dataset.style : normalizeAnimationStyle(value);
    if (motionStyle === 'orbital' || motionStyle === 'scan') {
      if (nameTimer !== null) { cancelRepeat(nameTimer); nameTimer = null; }
      if (fadeTimer !== null) { cancelSchedule(fadeTimer); fadeTimer = null; }
      name.classList.remove('is-fading');
      name.textContent = AI_NAMES[nameIndex];
      return;
    }
    if (!reduced && !document.hidden) resumeNames();
  }
  function needsNameCycle() {
    return root.dataset.style !== 'orbital' && root.dataset.style !== 'scan';
  }
  document.addEventListener('visibilitychange', onVisibility);
  setPhase('running');
  if (!reduced && !document.hidden) resumeNames();
  syncMotion(style);
  targetTimer = schedule(() => {
    targetTimer = null;
    if (!finished) setPhase('syncing');
  }, targetMs);
  if (hardLimitMs > 0) hardTimer = schedule(finish, hardLimitMs);
  return { root, style, preview, setStyle, setPhase, finish, destroy, finished: () => finished };
}

export { AI_NAMES, ANIMATION_STYLES, TARGET_MS, HARD_LIMIT_MS, PREVIEW_MS, PREVIEW_HARD_LIMIT_MS };
