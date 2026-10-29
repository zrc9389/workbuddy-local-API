import test from 'node:test';
import assert from 'node:assert/strict';
import {setupDOM} from './frontend_helpers_test.mjs';

test('model refresh replaces the previous snapshot and normalizes realm', async () => {
  const dom = setupDOM();
  dom.Element.prototype.getContext = () => ({fillRect(){}, clearRect(){}, beginPath(){}, stroke(){}, fill(){}, moveTo(){}, lineTo(){}, arc(){}, save(){}, restore(){}, setTransform(){}, resetTransform(){}, scale(){}, translate(){}, drawImage(){}, measureText(){return {width:10}}, fillText(){}, strokeText(){}, createImageData(){return {data:[]}}, getImageData(){return {data:[]}}, putImageData(){}, setLineDash(){}, strokeRect(){}});
  dom.Element.prototype.blur = () => {};
  globalThis.window = globalThis;
  globalThis.location = {protocol:'http:', pathname:'/panel/', port:'7863', origin:'http://127.0.0.1:7863'};
  globalThis.innerWidth = 1200; globalThis.innerHeight = 800;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.fetch = async () => ({ok:true, json:async () => ({models:[{id:'cn:new', name:'new', realm:'cn', context_length:100}], cached:false})});
  const {isChineseModel, modelMatchesFilter, expiryTone} = await import('./assets/geometric.js');
  WBState.currentChapter = 'models';
  WBState.models = [{id:'cn:old', realm:'CN'}];
  await dom.$('btn-page-chord').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(WBState.models.map(m => m.id), ['cn:new']);
  assert.equal(WBState.models[0].realm, 'CN');
  assert.equal(WBState.models[0].ttft, null);
  assert.equal(WBState.modelCacheHot, false);

  let errorBodyRead = false;
  globalThis.fetch = async () => ({ok:false, json:async () => { errorBodyRead = true; return {ok:false, error:'没有可用账号：请先在面板添加账号再查询'}; }});
  await dom.$('btn-page-chord').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(WBState.models.map(m => m.id), ['cn:new']);
  assert.equal(errorBodyRead, true);

  for (const id of ['cn:deepseek-v4.1-flash', 'global:Kimi-K2.5', 'qwen-2.5', 'glm-5.3', 'minimax-m3', 'deepseek/deepseek-r1', 'cn:mimo-v2.6-pro', 'xiaomi/mimo-v2.6-pro']) {
    assert.equal(isChineseModel({id}), true, id);
  }
  // 项目内能力目录列出的 18 个国产家族样本，包括先前漏掉的混元。
  for (const id of ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4.1-flash', 'kimi-k2.7', 'kimi-k2.6', 'kimi-k2.5', 'kimi-k3', 'kimi-k2.8-preview', 'glm-5.2', 'glm-5.1', 'glm-5.3', 'glm-5.3-flash', 'glm-5v-turbo', 'minimax-m3', 'hy3', 'hy3-preview', 'hy4-preview', 'hy4-preview-x']) {
    assert.equal(isChineseModel({id}), true, id);
  }
  assert.equal(isChineseModel({id:'model-x', vendor:'Tencent'}), true);
  assert.equal(isChineseModel({id:'model-x', vendor:'OpenAI'}), false);
  for (const id of ['cn:gpt-5', 'global:claude-sonnet', 'cn:auto', 'cn:space-bunny', 'mimosa', 'deepseekish', 'my-kimi-helper', 'other/deepseek-r1', '']) {
    assert.equal(isChineseModel({id}), false, id);
  }
  assert.equal(modelMatchesFilter({id:'global:kimi-k2.5', realm:'GLOBAL'}, 'CN'), false);
  assert.equal(modelMatchesFilter({id:'cn:gpt-5', realm:'CN'}, 'CN'), true);
  assert.equal(modelMatchesFilter({id:'cn:space-bunny', realm:'CN'}, 'CN'), true);
  assert.equal(modelMatchesFilter({id:'cn:auto', realm:'CN'}, 'CN'), true);
  assert.equal(modelMatchesFilter({id:'global:kimi-k2.5', realm:'GLOBAL'}, 'GLOBAL'), true);
  for (const [days, tone] of [[null,'text-white/50'],[0,'text-white/50'],[1,'tone-fault'],[2,'tone-guard'],[7,'tone-guard'],[8,'text-white/50']]) {
    assert.equal(expiryTone(days), tone, String(days));
  }

  WBState.accounts = [
    {name:'available', packages:[{days:1, remain:20}, {days:10, remain:80}]},
    {name:'blocked', blocked:true, packages:[{days:1, remain:900}]}
  ];
  window.hoverPackageModelPoint(0);
  assert.match(dom.$('pkg-model-readout').textContent, /1天.*80\.0%.*1 账号.*1/);
  window.hoverPackageModelPoint(3);
  assert.match(dom.$('pkg-model-readout').textContent, /10天.*0\.0%.*1 账号.*2/);
});
