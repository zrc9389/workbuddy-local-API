import { initEndpoints } from './assets/endpoints.js';
'use strict';
import './assets/theme.js';
import './assets/router.js';
import { initAuth } from './assets/auth.js';

initEndpoints();
initAuth();

// 浏览器端载入黑白科技 3D 几何与音频动力学完整运行时
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const isLiveDOM = !!document.getElementById('project-preview-canvas');
    if (isLiveDOM && !window.__geometricLoading) {
        window.__geometricLoading = true;
        import('./assets/geometric.js').catch(err => {
            console.error('Failed to load geometric runtime:', err);
        });
    }
}
