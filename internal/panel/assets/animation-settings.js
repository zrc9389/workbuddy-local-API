import { api, session } from './api.js';
import { startStartupAnimation, normalizeAnimationStyle, ANIMATION_STYLES } from './startup-animation.js';

const PREFERENCE_KEY = 'animation_style';
const LEGACY_KEYS = ['animation_style', 'startup_animation', 'animationStyle'];
const STYLE_LABELS = {
  names: '名称轮播',
  orbital: '轨道聚合',
  scan: '扫描唤醒',
  minimal: '极简淡入',
};

let activeOptions = null;
let previewPlayer = null;
let lastSelected = null;
let saving = false;
let previewGeneration = 0;
let settingsGeneration = 0;

function byId(id) {
  return globalThis.document?.getElementById?.(id) || null;
}

function note(text, tone = '') {
  const element = byId('animationNote');
  if (!element) return;
  element.textContent = text;
  if (element.dataset) element.dataset.tone = tone;
}

function styleFromPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') return 'names';
  for (const key of LEGACY_KEYS) {
    if (typeof preferences[key] === 'string' && preferences[key].trim()) {
      return normalizeAnimationStyle(preferences[key]);
    }
  }
  return 'names';
}

function preferencePatch(style) {
  return {
    [PREFERENCE_KEY]: normalizeAnimationStyle(style),
  };
}

async function readPreferences(options) {
  if (typeof options.getPreferences === 'function') return options.getPreferences();
  return api('preferences');
}

async function persistStyle(style, options) {
  if (typeof options.saveStyle === 'function') return options.saveStyle(style);
  const current = await api('preferences');
  const body = {
    credit_guard_low: current?.credit_guard_low ?? 100,
    theme: current?.theme || 'dark',
    ...preferencePatch(style),
  };
  return api('preferences', { method: 'POST', body: JSON.stringify(body) });
}

export function destroyPreviewAnimation() {
  previewGeneration++;
  previewPlayer?.destroy();
  previewPlayer = null;
}

export function destroyAnimationSettings() {
  settingsGeneration++;
  activeOptions?.destroy?.();
  activeOptions = null;
  destroyPreviewAnimation();
}

export function previewStartupAnimation(style, options = {}) {
  destroyPreviewAnimation();
  const generation = previewGeneration;
  const selected = normalizeAnimationStyle(style);
  const player = startStartupAnimation({
    preview: true,
    style: selected,
    onFinish: () => {
      if (generation === previewGeneration) {
        previewPlayer = null;
        note(STYLE_LABELS[selected] + '预览已结束');
      }
    },
    ...options,
  });
  previewPlayer = player;
  note('正在预览：' + STYLE_LABELS[selected]);
  return player;
}

export function applyAnimationPreference(style) {
  const select = byId('animationStyle');
  const selected = normalizeAnimationStyle(style);
  if (select) select.value = selected;
  lastSelected = selected;
  note('');
  return selected;
}

export async function refreshAnimationPreference(options = {}) {
  const select = byId('animationStyle');
  if (!select) return 'names';
  try {
    const preferences = await readPreferences(options);
    return applyAnimationPreference(styleFromPreferences(preferences));
  } catch {
    return applyAnimationPreference('names');
  }
}

export function bindAnimationSettings(options = {}) {
  const select = byId('animationStyle');
  const preview = byId('animationPreview');
  if (!select || !preview) return () => {};
  destroyAnimationSettings();
  const generation = settingsGeneration;
  let onPreviewBusy = false;
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    select.removeEventListener?.('change', onChange);
    preview.removeEventListener?.('click', onPreview);
    destroyPreviewAnimation();
    if (activeOptions?.destroy === destroy) activeOptions = null;
  };
  activeOptions = { destroy };

  select.value = normalizeAnimationStyle(select.value || lastSelected || 'names');
  lastSelected = select.value;

  async function onChange() {
    const selected = normalizeAnimationStyle(select.value);
    select.value = selected;
    lastSelected = selected;
    note('');
    if (!session.authenticated) {
      note('登录后可保存偏好');
      return;
    }
    if (saving) return;
    saving = true;
    try {
      const saved = await persistStyle(selected, options);
      if (generation !== settingsGeneration) return;
      const readBack = saved && typeof saved === 'object' ? saved : await api('preferences');
      if (generation !== settingsGeneration) return;
      const style = styleFromPreferences(readBack);
      select.value = style;
      lastSelected = style;
      if (style !== selected) note('后端尚未保存动画偏好，本次仅在当前页面生效', 'err');
      else note('动画偏好已保存');
    } catch (error) {
      if (generation === settingsGeneration && error?.name !== 'AbortError') note('动画偏好未保存，将在下次登录时重试', 'err');
    } finally {
      saving = false;
    }
  }

  function onPreview(event) {
    event?.preventDefault?.();
    if (onPreviewBusy) return;
    onPreviewBusy = true;
    try {
      previewStartupAnimation(select.value, options.previewOptions);
    } finally {
      onPreviewBusy = false;
    }
  }

  select.addEventListener?.('change', onChange);
  preview.addEventListener?.('click', onPreview);
  return destroy;
}

export { ANIMATION_STYLES, PREFERENCE_KEY, STYLE_LABELS, styleFromPreferences };
