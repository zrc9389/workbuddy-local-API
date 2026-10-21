import { $, esc, toast } from './common.js';
import { api } from './api.js';
import { fmtTok } from './format.js';
import { paginate, pagerHTML, bindPager } from './pagination.js';
import { loadModelPolicy, modelDisabled, modelPolicySwitch, displayContext, bindModelPolicy, sortModelsByPolicy } from './model-policy.js';
import { visibleInterval, clearVisibleInterval } from './lifecycle.js';
const EFFORT_ORDER = ['off','low','medium','high','xhigh','max','ultra'];
// 与后端 panelModelsRefreshCool 一致：成功刷新后本地也进入冷却，避免无意义的重复 POST。
const REFRESH_COOLDOWN_SECONDS = 300;
let models = [], probes = {}, page = 1, meta = {}, refreshCooldownUntil = 0, cooldownTimer = null;
export function modelProbeLabel(model,probe) {
  if (!probe) return model.max_output_tokens ? '上游声称 ' + fmtTok(model.max_output_tokens) : '尚无实测';
  const measured = probe.measured ? fmtTok(probe.measured) : '未知', old = probe.tested_at && Date.now()-Date.parse(probe.tested_at)>30*86400000;
  return (probe.verdict==='at_least'?'实测至少 ':probe.verdict==='clamped'?'实测上限 ':'未测出 ') + measured + (probe.note?' · '+probe.note:'') + (probe.tested_at?' · '+probe.tested_at:'') + (old?' · 旧探测结果':'');
}
export function modelRateHTML(model) {
  const value = model.promo_credits != null && String(model.promo_credits) !== '' ? model.promo_credits : model.credits;
  return '<span>' + esc(value ?? '—') + (model.promo_label?' · '+esc(model.promo_label):'') + '</span>';
}
// 固定档位顺序：off → low → medium → high → xhigh → max → ultra；未声明的未知档位按原顺序追加末尾。
export function orderedEfforts(model) {
  const declared = Array.isArray(model?.supported_efforts) ? [...model.supported_efforts] : [];
  if (model?.can_disable_thinking && !declared.includes('off')) declared.push('off');
  const known = EFFORT_ORDER.filter(effort => declared.includes(effort));
  return [...known,...declared.filter(effort => !EFFORT_ORDER.includes(effort))];
}
export function effortRowHTML(model) {
  const efforts = orderedEfforts(model);
  if (!efforts.length) return '<div class="model-effort-row"><span class="model-label">推理档位</span><span class="hint">未声明</span></div>';
  return '<div class="model-effort-row"><span class="model-label">推理档位</span><div class="effort-pills">' + efforts.map(effort=>'<span class="effort-pill' + (effort==='off'?' off':'') + '">' + esc(effort) + '</span>').join('') + '</div></div>';
}
export function cacheStatusText(info = meta) {
  if (!info) return '缓存状态未知';
  if (info.stale) return '缓存已过期';
  const age = Number(info.cache_age_seconds);
  if (!info.cached) return Number.isFinite(age) ? '刚刚更新' : '缓存状态未知';
  if (!Number.isFinite(age) || age < 0) return '缓存时间未知';
  return '缓存 ' + Math.max(0,Math.floor(age/60)) + ' 分钟前';
}
function renderCacheTag() {
  const tag = $('mdCache'); if (!tag) return;
  tag.textContent = cacheStatusText();
  tag.classList.toggle('warn',!!meta.stale);
  tag.classList.toggle('muted',!meta.stale);
}
function renderRefreshState() {
  const button = $('btnModelsRefresh'), wait = $('mdRefreshWait'); if (!button || !wait) return;
  const remaining = Math.max(0,Math.ceil((refreshCooldownUntil-Date.now())/1000));
  wait.textContent = remaining > 0 ? '剩余 ' + remaining + ' 秒' : '';
  button.classList.toggle('cooldown',remaining > 0);
  if (!remaining && cooldownTimer) { clearVisibleInterval(cooldownTimer); cooldownTimer = null; }
  if (remaining > 0 && !cooldownTimer) {
    cooldownTimer = visibleInterval(renderRefreshState,1000);
  }
}
export function startModelCooldown(seconds) {
  const value = Math.max(0,Math.ceil(Number(seconds)||0));
  refreshCooldownUntil = value ? Date.now()+value*1000 : 0;
  renderRefreshState();
  return value;
}
export function modelCooldownRemaining(now = Date.now()) { return Math.max(0,Math.ceil((refreshCooldownUntil-now)/1000)); }
export function renderModels() {
  const ordered = sortModelsByPolicy(models);
  const result = paginate(ordered,page,20); page = result.page;
  renderCacheTag();
  $('mdBody').innerHTML = result.rows.map(model=>{
    const probe = probes[model.realm+':'+model.id] || probes[model.id];
    const tags = [(model.supports_images||model.supports_vision)?'视觉':'',(model.supports_tool_call||model.supports_tools)?'工具':'',model.supports_reasoning?'推理':''].filter(Boolean);
    const disabled = modelDisabled(model.id);
    return '<article class="model-card' + (disabled?' is-disabled':'') + '"><div class="model-card-head"><div class="model-identity"><h3>' + esc(model.name||model.id) + '</h3><p class="hint mono">' + esc(model.id) + '</p></div>' + modelPolicySwitch(model.id) + '</div>' + effortRowHTML(model) + '<div class="model-metrics"><div><span>上下文</span><strong>' + esc(model.context_length==null?'未知':fmtTok(displayContext(model))) + '</strong></div><div><span>倍率</span><strong>' + modelRateHTML(model) + '</strong></div><div><span>输出 Token</span><strong>' + esc(modelProbeLabel(model,probe)) + '</strong></div></div>' + (tags.length?'<div class="model-capabilities">' + tags.map(tag=>'<span class="tag ok">' + tag + '</span>').join('') + '</div>':'') + '</article>';
  }).join('') || '<div class="empty">暂无模型声明</div>';
  $('mdPages').innerHTML = pagerHTML(result,'models');
}
export async function loadModels() {
  try {
    const [response,measurements] = await Promise.all([api('models'),api('model_probes').catch(error=>{if(error.name==='AbortError')throw error;return {}; }),loadModelPolicy()]);
    models=response.models||[]; probes=measurements.probes||{};
    meta={cached:!!response.cached,stale:!!response.stale,cache_age_seconds:response.cache_age_seconds};
    renderModels(); renderRefreshState();
  }
  catch(error) {if(error.name==='AbortError')return;models=[];$('mdPages').innerHTML='';$('mdBody').innerHTML='<div class="error-notice">模型读取失败：'+esc(error.message)+'</div>';if($('mdCache'))$('mdCache').textContent='读取失败';}
}
export async function refreshModels() {
  if (modelCooldownRemaining() > 0) { renderRefreshState(); return {ok:false,cooldown_seconds:modelCooldownRemaining()}; }
  const button = $('btnModelsRefresh'); const wait = $('mdRefreshWait');
  if (button) { button.classList.add('refreshing'); button.disabled = true; }
  if (wait) wait.textContent = '刷新中…';
  try {
    const data = await api('models/refresh',{method:'POST'});
    if (data.ok) {
      models = data.models || []; meta = {cached:!!data.cached,stale:!!data.stale,cache_age_seconds:data.cache_age_seconds};
      renderModels(); startModelCooldown(REFRESH_COOLDOWN_SECONDS); toast('模型目录已刷新','ok'); return data;
    }
    startModelCooldown(data.cooldown_seconds);
    return data;
  } catch (error) {
    if (error.name !== 'AbortError') toast('模型刷新未完成：' + error.message,'err');
    throw error;
  } finally {
    if (button) { button.classList.remove('refreshing'); button.disabled = false; }
    if (wait && refreshCooldownUntil <= Date.now()) wait.textContent = '';
    renderRefreshState();
  }
}
bindPager('mdPages',(_key,value)=>{page=value;renderModels();}); bindModelPolicy(renderModels);
if ($('btnModelsRefresh')) $('btnModelsRefresh').onclick = () => { refreshModels().catch(()=>{}); };
document.addEventListener('panel:session',event=>{if(!event.detail.authenticated){models=[];probes={};meta={};page=1;startModelCooldown(0);if($('mdBody'))$('mdBody').innerHTML='';if($('mdCache'))$('mdCache').textContent='缓存状态未知';}});
