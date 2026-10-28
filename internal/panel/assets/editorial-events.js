/**
 * editorial-events.js
 * WorkBuddy Panel 生产级 CSP 事件委托系统 (符合 script-src-attr 'none')
 * 零内联 on* 属性，基于语义化 data-action 与 data-hover-* 实现安全分发
 */

export function handleDataAction(el, ev) {
    const action = el.dataset?.action;
    if (!action) return false;
    const globalObj = typeof window !== 'undefined' ? window : globalThis;
    const wb = globalObj.WBState;

    switch (action) {
        case 'switch-customization-tab':
            if (typeof globalObj.switchCustomizationTab === 'function') globalObj.switchCustomizationTab(el.dataset.tab);
            return true;
        case 'select-custom-music':
            if (typeof globalObj.selectCustomMusic === 'function') globalObj.selectCustomMusic(el.dataset.musicId);
            return true;
        case 'delete-custom-music':
            if (typeof globalObj.deleteCustomMusic === 'function') globalObj.deleteCustomMusic(el.dataset.musicId);
            return true;
        case 'select-custom-slogan':
            if (typeof globalObj.selectCustomSlogan === 'function') globalObj.selectCustomSlogan(el.dataset.sloganId);
            return true;
        case 'delete-custom-slogan':
            if (typeof globalObj.deleteCustomSlogan === 'function') globalObj.deleteCustomSlogan(el.dataset.sloganId);
            return true;
        case 'select-custom-theme':
            if (typeof globalObj.selectCustomTheme === 'function') globalObj.selectCustomTheme(el.dataset.themeId);
            return true;
        case 'switch-login-realm':
            if (typeof globalObj.switchLoginRealm === 'function') globalObj.switchLoginRealm(el.dataset.realm);
            return true;
        case 'open-oauth':
            if (typeof globalObj.openOAuthLoginLink === 'function') globalObj.openOAuthLoginLink();
            return true;
        case 'copy-oauth':
            if (typeof globalObj.copyOAuthLoginLink === 'function') globalObj.copyOAuthLoginLink();
            return true;
        case 'bind-egress':
            if (typeof globalObj.bindAccountEgress === 'function') globalObj.bindAccountEgress(el.dataset.uid, el.dataset.node);
            return true;
        case 'toggle-account-manual':
            if (typeof globalObj.toggleAccountManual === 'function') globalObj.toggleAccountManual(el.dataset.uid);
            return true;
        case 'delete-account':
            if (typeof globalObj.deleteAccountItem === 'function') globalObj.deleteAccountItem(el.dataset.uid);
            return true;
        case 'clear-selected-account':
            if (wb) wb.selectedAccountUid = null;
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'select-account-egress':
            if (wb) {
                wb.selectedAccountUid = el.dataset.uid;
                wb.accountNodePage = 0;
            }
            if (typeof globalObj.notifyEditorialStatus === 'function') globalObj.notifyEditorialStatus('SELECT EGRESS // ACC: ' + (el.dataset.name || '').toUpperCase());
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'set-account-filter':
            if (wb) {
                wb.accountFilter = el.dataset.filter;
                wb.accountPage = 0;
            }
            if (typeof globalObj.notifyEditorialStatus === 'function') globalObj.notifyEditorialStatus('ACCOUNT FILTER -> ' + el.dataset.filter);
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'set-egress-tab':
            if (wb) {
                wb.egressTab = el.dataset.tab;
                wb.egressPage = 0;
            }
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'probe-node':
            if (typeof globalObj.probeSingleNode === 'function') globalObj.probeSingleNode(el.dataset.nodeId);
            return true;
        case 'toggle-sub':
            if (typeof globalObj.toggleDisableSub === 'function') globalObj.toggleDisableSub(el.dataset.subId);
            return true;
        case 'select-sub':
            if (typeof globalObj.selectActiveSub === 'function') globalObj.selectActiveSub(el.dataset.subId);
            return true;
        case 'delete-sub':
            if (typeof globalObj.deleteSubscription === 'function') globalObj.deleteSubscription(el.dataset.subId);
            return true;
        case 'refresh-sub':
            if (typeof globalObj.refreshSingleSub === 'function') globalObj.refreshSingleSub(el.dataset.subId);
            return true;
        case 'set-task-step':
            if (wb && wb.tasks) wb.tasks.selectedStepCode = el.dataset.stepCode || null;
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'set-usage-range':
            if (wb) wb.usageRange = el.dataset.range;
            if (typeof globalObj.syncDynamicBottomButtons === 'function') globalObj.syncDynamicBottomButtons();
            if (typeof globalObj.notifyEditorialStatus === 'function') globalObj.notifyEditorialStatus('TIME WINDOW -> ' + el.dataset.range);
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'set-package-view':
            if (wb) {
                wb.packageView = el.dataset.view;
                if (el.dataset.expiring !== undefined) {
                    wb.packageExpiringOnly = el.dataset.expiring === 'true';
                    wb.packageAccountPage = 0;
                }
            }
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'select-package-uid':
            if (wb) {
                wb.selectedPackageUid = el.dataset.uid || null;
                wb.packageDetailPage = 0;
            }
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'set-log-filter':
            if (wb) {
                wb.logFilterCode = el.dataset.filter;
                wb.logPage = 0;
            }
            if (typeof globalObj.notifyEditorialStatus === 'function') globalObj.notifyEditorialStatus('LOG FILTER -> ' + el.dataset.filter);
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'select-log':
            if (wb) wb.selectedLogId = el.dataset.id;
            if (typeof globalObj.notifyEditorialStatus === 'function') globalObj.notifyEditorialStatus('INSPECTING TRACE // ' + el.dataset.id);
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'clear-selected-log':
            if (wb) wb.selectedLogId = null;
            if (typeof globalObj.renderEditorialStage === 'function') globalObj.renderEditorialStage(true);
            return true;
        case 'trigger-music-input':
            const doc = el?.ownerDocument || (typeof document !== 'undefined' ? document : globalObj.document);
            doc?.getElementById('custom-music-file-hidden')?.click();
            return true;
        case 'trigger-import-json':
            if (typeof globalObj.triggerImportJsonConfig === 'function') globalObj.triggerImportJsonConfig();
            return true;
        case 'export-json':
            if (typeof globalObj.exportGlobalJsonConfig === 'function') globalObj.exportGlobalJsonConfig();
            return true;
        case 'hover-package':
            if (typeof globalObj.hoverPackageModelPoint === 'function') globalObj.hoverPackageModelPoint(parseInt(el.dataset.idx, 10));
            return true;
        case 'page-change':
            const fnName = el.dataset.pageFn;
            const pageVal = parseInt(el.dataset.page, 10);
            if (typeof globalObj[fnName] === 'function') {
                globalObj[fnName](pageVal);
            }
            return true;
    }
    return false;
}

export function initEditorialEventDelegation(targetDoc) {
    const globalObj = typeof window !== 'undefined' ? window : globalThis;
    const doc = targetDoc || (typeof document !== 'undefined' ? document : globalObj.document);
    if (!doc || doc._editorialDelegated) return;
    doc._editorialDelegated = true;

    // 1. 全局点击委托 (click)
    doc.addEventListener('click', (ev) => {
        const el = ev.target?.closest ? ev.target.closest('[data-action]') : null;
        if (!el) return;
        if (handleDataAction(el, ev)) {
            ev.preventDefault();
        }
    }, true);

    // 2. 文件变更委托 (change)
    doc.addEventListener('change', (ev) => {
        const el = ev.target?.closest ? (ev.target.closest('[data-action-change="custom-music-file"]') || (ev.target?.id === 'custom-music-file-hidden' ? ev.target : null)) : null;
        if (el && typeof globalObj.handleCustomMusicFileSelected === 'function') {
            globalObj.handleCustomMusicFileSelected(el);
        }
    }, true);

    // 3. 键盘回车委托 (keydown Enter)
    doc.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            const el = ev.target?.closest ? ev.target.closest('[data-action-enter="import-callback-url"]') : null;
            if (el && typeof globalObj.importFromPastedCallbackUrl === 'function') {
                ev.preventDefault();
                globalObj.importFromPastedCallbackUrl();
            }
        }
    }, true);

    // 4. 鼠标悬停高亮委托 (mouseover 冒泡)
    doc.addEventListener('mouseover', (ev) => {
        const el = ev.target?.closest ? ev.target.closest('[data-hover-vertex]') : null;
        if (el && typeof globalObj.setVertexHover === 'function') {
            globalObj.setVertexHover(parseInt(el.dataset.hoverVertex, 10), el.dataset.hoverLabel || '');
        }
        const modelEl = ev.target?.closest ? ev.target.closest('[data-hover-model]') : null;
        if (modelEl) {
            const type = modelEl.dataset.hoverModel;
            const idx = parseInt(modelEl.dataset.hoverIdx, 10);
            if (type === 'usage' && typeof globalObj.hoverUsagePoint === 'function') globalObj.hoverUsagePoint(idx);
            else if (type === 'error' && typeof globalObj.hoverErrorModelPoint === 'function') globalObj.hoverErrorModelPoint(idx);
            else if (type === 'package' && typeof globalObj.hoverPackageModelPoint === 'function') globalObj.hoverPackageModelPoint(idx);
            else if (type === 'account' && typeof globalObj.hoverAccountModelPoint === 'function') globalObj.hoverAccountModelPoint(idx);
        }
    }, true);

    // 5. 鼠标离开恢复委托 (mouseout 冒泡)
    doc.addEventListener('mouseout', (ev) => {
        const el = ev.target?.closest ? ev.target.closest('[data-hover-vertex]') : null;
        if (el && (!ev.relatedTarget || !el.contains(ev.relatedTarget)) && typeof globalObj.setVertexHover === 'function') {
            globalObj.setVertexHover(-1);
        }
        const modelEl = ev.target?.closest ? ev.target.closest('[data-hover-model]') : null;
        if (modelEl && (!ev.relatedTarget || !modelEl.contains(ev.relatedTarget))) {
            const type = modelEl.dataset.hoverModel;
            if (type === 'usage' && typeof globalObj.hoverUsagePoint === 'function') globalObj.hoverUsagePoint(-1);
            else if (type === 'error' && typeof globalObj.hoverErrorModelPoint === 'function') globalObj.hoverErrorModelPoint(-1);
            else if (type === 'package' && typeof globalObj.hoverPackageModelPoint === 'function') globalObj.hoverPackageModelPoint(-1);
            else if (type === 'account' && typeof globalObj.hoverAccountModelPoint === 'function') globalObj.hoverAccountModelPoint(-1);
        }
    }, true);

    // 6. 输入框聚焦高亮委托 (focusin)
    doc.addEventListener('focusin', (ev) => {
        const el = ev.target?.closest ? ev.target.closest('[data-hover-vertex]') : null;
        if (el && typeof globalObj.setVertexHover === 'function') {
            globalObj.setVertexHover(parseInt(el.dataset.hoverVertex, 10), el.dataset.hoverLabel || '');
        }
    }, true);

    // 7. 输入框失焦恢复委托 (focusout)
    doc.addEventListener('focusout', (ev) => {
        const el = ev.target?.closest ? ev.target.closest('[data-hover-vertex]') : null;
        if (el && typeof globalObj.setVertexHover === 'function') {
            globalObj.setVertexHover(-1);
        }
    }, true);
}
