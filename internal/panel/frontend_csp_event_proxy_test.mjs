import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM } from './frontend_helpers_test.mjs';
import { initEditorialEventDelegation, handleDataAction } from './assets/editorial-events.js';

test('production geometric.js event delegation processes all actions without eval or inline handlers', async () => {
    const dom = setupDOM();

    // 禁用 eval，证明生产代理模块绝不依赖动态求值
    const originalEval = globalThis.eval;
    globalThis.eval = () => { throw new Error('eval is strictly forbidden under CSP'); };

    try {
        let notifiedMsg = '';
        let stageRendered = false;
        let trackPlayed = null;
        let vertexHoverState = { idx: null, label: null };
        let usagePointHovered = null;

        globalThis.WBState = {
            selectedAccountUid: 'acc_original',
            accountNodePage: 5,
            accountFilter: 'ALL',
            usageRange: '6H',
            logFilterCode: 'ALL',
            selectedLogId: 'log_old',
            packageView: 'MODEL',
            selectedPackageUid: 'pkg_old',
            packageExpiringOnly: false,
            tasks: { selectedStepCode: 'old_step' },
            customization: {
                currentTab: 'slogan',
                activeMusicId: 'm-default',
                musicList: [
                    { id: 'm-default', name: 'Default Ambient', url: '', isDefault: true },
                    { id: 'm-custom-01', name: 'Cyber Wave', url: 'data:audio/wav;base64,AAA', isDefault: false }
                ]
            }
        };

        globalThis.notifyEditorialStatus = (msg) => { notifiedMsg = msg; };
        globalThis.renderEditorialStage = (flag) => { stageRendered = flag; };
        globalThis.setVertexHover = (idx, label) => { vertexHoverState = { idx, label }; };
        globalThis.hoverUsagePoint = (idx) => { usagePointHovered = idx; };
        globalThis.soundscape = {
            playCustomBackgroundTrack: (url, isDefault) => {
                trackPlayed = { url, isDefault };
            },
            triggerTileNote: () => {}
        };
        globalThis.switchCustomizationTab = (tab) => {
            globalThis.WBState.customization.currentTab = tab;
        };
        globalThis.selectCustomMusic = (id) => {
            globalThis.WBState.customization.activeMusicId = id;
            const m = globalThis.WBState.customization.musicList.find(x => x.id === id);
            if (m) globalThis.soundscape.playCustomBackgroundTrack(m.url, m.isDefault);
        };
        globalThis.deleteCustomMusic = (id) => {
            globalThis.WBState.customization.musicList = globalThis.WBState.customization.musicList.filter(x => x.id !== id);
            if (globalThis.WBState.customization.activeMusicId === id) {
                globalThis.WBState.customization.activeMusicId = 'm-default';
            }
        };
        globalThis.syncDynamicBottomButtons = () => {};

        // 构造事件监听模拟环境并挂载生产代理器
        const registered = new Map();
        const testDoc = {
            _editorialDelegated: false,
            addEventListener: (type, fn) => {
                if (!registered.has(type)) registered.set(type, []);
                registered.get(type).push(fn);
            },
            getElementById: (id) => {
                if (id === 'custom-music-file-hidden') return fakeFileInput;
                return null;
            }
        };

        let fileInputTriggered = false;
        const fakeFileInput = {
            id: 'custom-music-file-hidden',
            click: () => { fileInputTriggered = true; }
        };

        // 直接初始化生产导出的代理函数！
        initEditorialEventDelegation(testDoc);
        assert.equal(testDoc._editorialDelegated, true, 'production delegation must mark document');

        async function fireDocEvent(type, targetEl, extra = {}) {
            const handlers = registered.get(type) || [];
            const ev = {
                target: targetEl,
                preventDefault: () => {},
                ...extra
            };
            for (const h of handlers) {
                h(ev);
            }
        }

        function createEl(dataset = {}, id = '') {
        const el = { id, dataset, ownerDocument: testDoc, closest: (sel) => {
            if (sel.includes('[data-action]') && dataset.action) return el;
            if (sel.includes('[data-hover-vertex]') && dataset.hoverVertex !== undefined) return el;
            if (sel.includes('[data-hover-model]') && dataset.hoverModel) return el;
            if (sel.includes('[data-action-change]') && dataset.actionChange) return el;
            return null;
        } };
        return el;
    }

        // 1. 验证音乐选项卡与选择音乐
        await fireDocEvent('click', createEl({ action: 'switch-customization-tab', tab: 'music' }));
        assert.equal(globalThis.WBState.customization.currentTab, 'music');

        await fireDocEvent('click', createEl({ action: 'select-custom-music', musicId: 'm-custom-01' }));
        assert.equal(globalThis.WBState.customization.activeMusicId, 'm-custom-01');
        assert.deepEqual(trackPlayed, { url: 'data:audio/wav;base64,AAA', isDefault: false });

        // 2. 验证音乐删除
        await fireDocEvent('click', createEl({ action: 'delete-custom-music', musicId: 'm-custom-01' }));
        assert.equal(globalThis.WBState.customization.activeMusicId, 'm-default');
        assert.equal(globalThis.WBState.customization.musicList.length, 1);

        // 3. 验证触发文件选择框
        await fireDocEvent('click', createEl({ action: 'trigger-music-input' }));
        assert.equal(fileInputTriggered, true, 'trigger-music-input must click file element');

        // 4. 验证复合状态：账号选择与重置
        await fireDocEvent('click', createEl({ action: 'select-account-egress', uid: 'acc_target_99', name: 'target-node' }));
        assert.equal(globalThis.WBState.selectedAccountUid, 'acc_target_99');
        assert.equal(globalThis.WBState.accountNodePage, 0);
        assert.equal(notifiedMsg, 'SELECT EGRESS // ACC: TARGET-NODE');
        assert.equal(stageRendered, true);

        await fireDocEvent('click', createEl({ action: 'clear-selected-account' }));
        assert.equal(globalThis.WBState.selectedAccountUid, null);

        // 5. 验证过滤与用量范围
        await fireDocEvent('click', createEl({ action: 'set-usage-range', range: '24H' }));
        assert.equal(globalThis.WBState.usageRange, '24H');

        await fireDocEvent('click', createEl({ action: 'set-log-filter', filter: '5XX' }));
        assert.equal(globalThis.WBState.logFilterCode, '5XX');

        // 6. 验证无内联属性的悬停高亮 (mouseover / mouseout)
        await fireDocEvent('mouseover', createEl({ hoverVertex: '5', hoverLabel: 'LABEL_5' }));
        assert.deepEqual(vertexHoverState, { idx: 5, label: 'LABEL_5' });

        await fireDocEvent('mouseout', createEl({ hoverVertex: '5', hoverLabel: 'LABEL_5' }), { relatedTarget: null });
        assert.deepEqual(vertexHoverState, { idx: -1, label: undefined });

        await fireDocEvent('mouseover', createEl({ hoverModel: 'usage', hoverIdx: '3' }));
        assert.equal(usagePointHovered, 3);

        await fireDocEvent('mouseout', createEl({ hoverModel: 'usage', hoverIdx: '3' }), { relatedTarget: null });
        assert.equal(usagePointHovered, -1);

    } finally {
        globalThis.eval = originalEval;
    }
});

