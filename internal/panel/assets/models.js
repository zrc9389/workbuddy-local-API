import { $, esc } from './common.js';
import { api } from './api.js';
import { fmtTok } from './format.js';
import { paginate, pagerHTML, bindPager } from './pagination.js';
import { loadModelPolicy, modelPolicyCell, displayContext, bindModelPolicy } from './model-policy.js';
let models = [], probes = {}, page = 1;
export function modelProbeLabel(model,probe) {
  if (!probe) return model.max_output_tokens ? '上游声称 ' + fmtTok(model.max_output_tokens) : '尚无实测';
  const measured = probe.measured ? fmtTok(probe.measured) : '未知', old = probe.tested_at && Date.now()-Date.parse(probe.tested_at)>30*86400000;
  return (probe.verdict==='at_least'?'实测至少 ':probe.verdict==='clamped'?'实测上限 ':'未测出 ') + measured + (probe.note?' · '+probe.note:'') + (probe.tested_at?' · '+probe.tested_at:'') + (old?' · 旧探测结果':'');
}
export function modelRateHTML(model) {
  const value = model.promo_credits != null && String(model.promo_credits) !== '' ? model.promo_credits : model.credits;
  return '<span>' + esc(value ?? '—') + (model.promo_label?' · '+esc(model.promo_label):'') + (model.promo_note?'<small class="hint"> '+esc(model.promo_note)+'</small>':'') + '</span>';
}
export function renderModels() {
  const result = paginate(models,page,20); page = result.page;
  $('mdNote').textContent = models.length + ' 个上游模型声明';
  $('mdBody').innerHTML = result.rows.map(model=>{
    const probe = probes[model.realm+':'+model.id] || probes[model.id];
    const efforts = [...(model.supported_efforts||[])]; if(model.can_disable_thinking && !efforts.includes('off')) efforts.push('off');
    return '<article class="model-card"><p class="eyebrow">' + esc((model.realm==='global'||model.id?.startsWith('global:'))?'GLOBAL':'CN') + (model.vendor?' · '+esc(model.vendor):'') + '</p><h3>' + esc(model.name||model.id) + '</h3><p class="hint mono">' + esc(model.id) + '</p><p class="hint">' + esc(model.description||'无额外能力说明') + '</p><dl class="mini-metrics"><div><dt>上下文展示</dt><dd>' + esc(model.context_length==null?'未知':fmtTok(displayContext(model))) + '</dd></div><div><dt>生效倍率</dt><dd>' + modelRateHTML(model) + '</dd></div><div><dt>推理档位</dt><dd>' + esc(efforts.join(' · ')||'未声明') + '</dd></div><div><dt>输出 Token</dt><dd>' + esc(modelProbeLabel(model,probe)) + '</dd></div></dl><p class="hint">' + [(model.supports_images||model.supports_vision)?'视觉':'',(model.supports_tool_call||model.supports_tools)?'工具':'',model.supports_reasoning?'推理':''].filter(Boolean).join(' · ') + '</p>' + modelPolicyCell(model.id) + '</article>';
  }).join('') || '<div class="empty">暂无模型声明</div>';
  $('mdPages').innerHTML = pagerHTML(result,'models');
}
export async function loadModels() {
  try { const [response,measurements] = await Promise.all([api('models'),api('model_probes').catch(error=>{if(error.name==='AbortError')throw error;return {}; }),loadModelPolicy()]); models=response.models||[];probes=measurements.probes||{};renderModels(); }
  catch(error) {if(error.name==='AbortError')return;models=[];$('mdPages').innerHTML='';$('mdBody').innerHTML='<div class="error-notice">模型读取失败：'+esc(error.message)+'</div>';$('mdNote').textContent='读取失败';}
}
bindPager('mdPages',(_key,value)=>{page=value;renderModels();}); bindModelPolicy(renderModels);
document.addEventListener('panel:session',event=>{if(!event.detail.authenticated){models=[];probes={};page=1;$('mdBody').innerHTML='';}});
