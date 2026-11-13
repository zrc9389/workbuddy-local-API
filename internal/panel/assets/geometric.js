    function formatCredits(val) {
        if (val === null || val === undefined || isNaN(val)) return '0';
        const num = Number(val);
        return parseFloat(num.toFixed(2)).toString();
    }
import { initEditorialEventDelegation, handleDataAction } from './editorial-events.js';
'use strict';
let mainSceneActive = false;
// CN 是模型家族筛选，不改变上游提供的路由域；仅识别明确的模型名前缀。
export function isChineseModel(model) {
    const matches = value => {
        let id = String(value || '').trim().toLowerCase().replace(/^(?:cn|global):/, '');
        id = id.replace(/^(?:deepseek|moonshotai|moonshot|qwen|alibaba|zhipuai|z-ai|minimax|xiaomi)\//, '');
        return /^(?:deepseek|kimi|qwen|glm|minimax|mimo|hy|hunyuan|doubao|ernie|baichuan|yi|spark|step|internlm)(?:$|[-_.\s\d])/.test(id);
    };
    const vendor = String(model?.vendor || '').trim().toLowerCase();
    const chineseVendors = new Set(['deepseek', 'moonshot', 'moonshotai', 'alibaba', 'qwen', 'zhipuai', 'z-ai', 'minimax', 'xiaomi', 'tencent', 'bytedance', 'baidu', 'baichuan', '01.ai', 'iflytek', 'stepfun', 'shanghai ai laboratory']);
    return matches(model?.id) || matches(model?.name) || chineseVendors.has(vendor);
}

export function modelMatchesFilter(model, filter) {
    // CN / GLOBAL 表示模型目录来源，而非模型厂商国籍。同名模型可能
    // 同时出现在两个上游目录，必须按后端记录的 realm 分开。
    return filter === 'ALL' || String(model?.realm || '').toUpperCase() === filter;
}

export function expiryTone(days) {
    if (!Number.isFinite(days) || days <= 0) return 'text-white/50';
    if (days <= 1) return 'tone-fault';
    return days <= 7 ? 'tone-guard' : 'text-white/50';
}
        /* =========================================================================
         * 1. 字符乱码解码工具 (Scramble Text Effect)
         * ========================================================================= */
        const GLITCH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0987654321@#$%&*+=-?/<>';

        function scrambleText(element, targetText, duration = 280) {
            if (!element) return;
            clearInterval(element._scrambleTimer);
            const str = String(targetText);
            const length = str.length;
            let step = 0;
            const totalSteps = Math.max(6, Math.floor(duration / 25));

            element._scrambleTimer = setInterval(() => {
                step++;
                const progress = step / totalSteps;
                let output = '';
                for (let i = 0; i < length; i++) {
                    const ch = str[i];
                    if (ch === ' ' || ch === '[' || ch === ']' || ch === '/' || ch === '-' || ch === '—') {
                        output += ch;
                    } else if (i < Math.floor(progress * length)) {
                        output += ch;
                    } else if (ch.charCodeAt(0) > 127) {
                        output += progress > 0.65 ? ch : '·';
                    } else {
                        output += GLITCH_CHARS[(i * 7 + step * 3) % 26];
                    }
                }
                element.textContent = output;
                if (step >= totalSteps) {
                    clearInterval(element._scrambleTimer);
                    element.textContent = str;
                }
            }, 25);
        }

        // ==================== 菜单页点击进入：中心向四周扩散 -> 方块化为密集颗粒、东北偏东微风柔和消散变稀疏引擎 ====================
        let disperseTransitionParticles = [];
        let transitionModeQueue = ['PARTICLE_DISPERSE', 'CARD_FLIP', 'DIFFUSION'];
        let lastPickedTransitionMode = null;

        function pickNextAutoTransitionMode() {
            if (!transitionModeQueue.length) {
                const pool = ['CARD_FLIP', 'DIFFUSION', 'PARTICLE_DISPERSE'];
                for (let i = pool.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const tmp = pool[i];
                    pool[i] = pool[j];
                    pool[j] = tmp;
                }
                if (pool[0] === lastPickedTransitionMode) {
                    const swapIdx = 1 + Math.floor(Math.random() * (pool.length - 1));
                    const tmp = pool[0];
                    pool[0] = pool[swapIdx];
                    pool[swapIdx] = tmp;
                }
                transitionModeQueue = pool;
            }
            const next = transitionModeQueue.shift();
            lastPickedTransitionMode = next;
            return next;
        }

        // 方块解构为密集微粒（消散前不稀疏，保持原方块紧凑轮廓）
        // 随风向东北偏东方向（ENE，约 -22°，向右偏上）柔和吹散，在飞行中阶梯式蒸发变少、变稀疏
        // 菜单返回时：原本散落在东北偏东远空的稀疏星尘粒子，逆风柔和飞回并加速汇聚，在原位重组成紧密方阵
        function spawnConvergingReturnParticles(tiles, theme) {
            disperseTransitionParticles = [];
            const now = performance.now();
            const duration = pageTransition.durationIn || 1050;

            for (let i = 0; i < tiles.length; i++) {
                const tile = tiles[i];
                if (tile.revealAlpha <= 0.05) continue;

                const cx = tile.stableScreenX;
                const cy = tile.stableScreenY;
                const tileSize = Math.max(10, tile.screenSize || 20);
                const gridN = tile.project ? 5 : 4;
                const cellStep = tileSize / gridN;
                const baseDotSize = Math.max(1.15, Math.min(2.4, cellStep * 0.58));

                const centerProximity = Math.max(0, 1 - tile.centerDist * 0.9);
                const hue = (theme ? theme.tileBaseHue : 195) + tile.normC * 16;
                const sat = Math.min(65, (theme ? theme.tileSat : 18) + centerProximity * 26);
                const light = Math.min(94, 70 + centerProximity * 18 + (tile.project ? 10 : 0));
                const innerColor = `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;

                // 从矩阵四周向中心收敛的轻柔波次延迟
                const waveDelay = Math.min(0.24, (1.3 - tile.centerDist) * 0.16) * duration;

                for (let gy = 0; gy < gridN; gy++) {
                    for (let gx = 0; gx < gridN; gx++) {
                        const isEdge = (gx === 0 || gx === gridN - 1 || gy === 0 || gy === gridN - 1);
                        const targetX = cx + ((gx + 0.5) / gridN - 0.5) * tileSize;
                        const targetY = cy + ((gy + 0.5) / gridN - 0.5) * tileSize;

                        // 起点位于东北偏东（ENE）远方空气中，空间大幅拉开，呈现极度稀疏散落感
                        const dist = (80 + Math.random() * 110 + tile.centerDist * 35) * currentUiScale;
                        const angle = -0.384 + (Math.random() - 0.5) * 0.42; // ENE 远端分布
                        const startX = targetX + Math.cos(angle) * dist;
                        const startY = targetY + Math.sin(angle) * dist;

                        const flightDuration = duration * (0.68 + Math.random() * 0.22);
                        const delay = waveDelay + Math.random() * 90;

                        disperseTransitionParticles.push({
                            isReturn: true,
                            startX,
                            startY,
                            targetX,
                            targetY,
                            x: startX,
                            y: startY,
                            startTime: now + delay,
                            duration: flightDuration,
                            size: baseDotSize * (isEdge ? 1.05 : 0.95),
                            baseAlpha: tile.project ? 0.98 : (isEdge ? 0.92 : 0.78),
                            color: (isEdge || tile.project && (gx % 2 === 0 && gy % 2 === 0)) ? '#ffffff' : innerColor,
                            curveOffset: (Math.random() - 0.5) * 24 * currentUiScale,
                            tileRef: tile
                        });
                    }
                }
            }
        }

        function spawnTileParticlesGentleWind(tile, theme, fallbackSize = 20) {
            const cx = tile.screenX || tile.stableScreenX;
            const cy = tile.screenY || tile.stableScreenY;
            const tileSize = Math.max(10, tile.screenSize || fallbackSize);

            // 保持高密度点阵：普通方块 6x6=36 颗，项目方块 7x7=49 颗，确保消散前呈现完整紧实结构
            const gridN = tile.project ? 7 : 6;
            const cellStep = tileSize / gridN;
            const baseDotSize = Math.max(1.15, Math.min(2.4, cellStep * 0.58));

            const centerProximity = Math.max(0, 1 - tile.centerDist * 0.9);
            const hue = (theme ? theme.tileBaseHue : 195) + tile.normC * 16;
            const sat = Math.min(65, (theme ? theme.tileSat : 18) + centerProximity * 26);
            const light = Math.min(94, 68 + centerProximity * 18 + (tile.project ? 10 : 0));
            const innerColor = `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;

            // 东北偏东风向基准（East-Northeast）：约 -22° (弧度 -0.384)
            // 向量主成分向右 (cos ≈ 0.927)，微向上升浮 (sin ≈ -0.375)
            const windAngleBase = -0.384;

            for (let gy = 0; gy < gridN; gy++) {
                for (let gx = 0; gx < gridN; gx++) {
                    const isEdge = (gx === 0 || gx === gridN - 1 || gy === 0 || gy === gridN - 1);
                    // 初始微弱扰动，保持方阵紧凑感
                    const jitterX = (Math.random() - 0.5) * cellStep * 0.12;
                    const jitterY = (Math.random() - 0.5) * cellStep * 0.12;
                    const px = cx + ((gx + 0.5) / gridN - 0.5) * tileSize + jitterX;
                    const py = cy + ((gy + 0.5) / gridN - 0.5) * tileSize + jitterY;

                    // 迎风起舞延迟：西南角粒子先微动起飞，东北角微滞后，形成风拂过沙雕的连贯脱离感
                    const windwardNorm = (gx / gridN) * 0.6 + ((gridN - 1 - gy) / gridN) * 0.4;
                    const holdFrames = Math.floor(windwardNorm * 5 + Math.random() * 3.5);

                    // 东北偏东微风初速度与加速度：轻柔自然，风一吹就跑
                    const angleJitter = (Math.random() - 0.5) * 0.22;
                    const windAngle = windAngleBase + angleJitter;
                    const windSpeed = (0.75 + Math.random() * 1.15) * currentUiScale;
                    const vx = Math.cos(windAngle) * windSpeed;
                    const vy = Math.sin(windAngle) * windSpeed;

                    // 持续微风牵引加速度（向东北偏东加速吹拂）
                    const windAccel = (0.055 + Math.random() * 0.065) * currentUiScale;
                    const ax = Math.cos(windAngle) * windAccel;
                    const ay = Math.sin(windAngle) * windAccel;

                    // 阶梯式消融寿命：实现“飞行中变少、变稀疏”的核心机制
                    // 35% 快速消散蒸发；40% 中途消解；仅 25% 成为远逝星尘，在空气中被风吹得很开很稀疏
                    const tierRand = Math.random();
                    let maxAge;
                    if (tierRand < 0.35) {
                        maxAge = 16 + Math.floor(Math.random() * 10); // 早期消失
                    } else if (tierRand < 0.75) {
                        maxAge = 28 + Math.floor(Math.random() * 16); // 中期消失
                    } else {
                        maxAge = 48 + Math.floor(Math.random() * 22); // 后期稀疏留存
                    }

                    disperseTransitionParticles.push({
                        x: px,
                        y: py,
                        vx,
                        vy,
                        ax,
                        ay,
                        size: baseDotSize * (isEdge ? 1.05 : 0.95),
                        baseAlpha: tile.project ? 0.98 : (isEdge ? 0.92 : 0.78),
                        age: 0,
                        holdFrames,
                        maxAge,
                        floatSpeed: 0.08 + Math.random() * 0.05,
                        floatPhase: Math.random() * Math.PI * 2,
                        floatAmp: (0.18 + Math.random() * 0.22) * currentUiScale,
                        color: (isEdge || tile.project && (gx % 2 === 0 && gy % 2 === 0)) ? '#ffffff' : innerColor
                    });
                }
            }
        }

        function updateAndRenderDisperseParticles(ctx, waterLineY, canvasH, now) {
            if (!disperseTransitionParticles.length) return;
            ctx.save();
            const curTime = performance.now();

            for (let i = disperseTransitionParticles.length - 1; i >= 0; i--) {
                const p = disperseTransitionParticles[i];

                if (p.isReturn) {
                    // ================= 粒子返回汇聚逻辑 =================
                    if (curTime < p.startTime) continue;
                    const elapsed = curTime - p.startTime;
                    const progress = Math.min(1, elapsed / p.duration);

                    if (progress >= 1) {
                        // 粒子到达目标位置，完成方块结晶重组
                        if (p.tileRef) {
                            p.tileRef.glow = Math.max(p.tileRef.glow, 0.75);
                        }
                        disperseTransitionParticles[i] = disperseTransitionParticles[disperseTransitionParticles.length - 1];
                        disperseTransitionParticles.pop();
                        continue;
                    }

                    // 三次缓动：远端起步平缓轻盈，接近目标时顺滑减速咬合
                    const ease = progress < 0.5
                        ? 4 * progress * progress * progress
                        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

                    // 流线型轻柔气流弧度（随进度由弯曲归直到精准靶心）
                    const arc = Math.sin(progress * Math.PI) * p.curveOffset;
                    p.x = p.startX + (p.targetX - p.startX) * ease + arc * 0.35;
                    p.y = p.startY + (p.targetY - p.startY) * ease + arc;

                    // 稀疏度到密实度视觉映射：远端微弱若隐若现，汇拢时清晰凝聚
                    const alpha = p.baseAlpha * Math.min(1, progress * 2.2);
                    const curSize = p.size * (0.82 + progress * 0.26);

                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
                    ctx.fillRect(p.x - curSize * 0.5, p.y - curSize * 0.5, curSize, curSize);

                    // 水面同步映射粒子归位倒影
                    if (waterLineY && p.y < waterLineY) {
                        const distAbove = waterLineY - p.y;
                        const reflY = waterLineY + 12 * currentUiScale + distAbove * 0.48;
                        if (reflY < canvasH - 4) {
                            ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.20));
                            ctx.fillRect(p.x - curSize * 0.5, reflY - curSize * 0.35, curSize * 1.05, curSize * 0.65);
                        }
                    }
                    continue;
                }

                // ================= 粒子消散逻辑 =================
                if (p.holdFrames > 0) {
                    p.holdFrames--;
                    // 静止待发时轻微感知风动微颤
                    p.x += (Math.random() - 0.5) * 0.25 * currentUiScale;
                    p.y += (Math.random() - 0.5) * 0.25 * currentUiScale;
                } else {
                    p.age++;
                    // 顺东北偏东风向持续加速
                    p.vx += p.ax;
                    p.vy += p.ay;
                    p.x += p.vx;
                    // 垂直方向融合柔和的浮力气流微波，像柳絮或轻尘在空中起伏
                    const airTurbulence = Math.sin(p.age * p.floatSpeed + p.floatPhase) * p.floatAmp;
                    p.y += p.vy + airTurbulence;
                }

                if (p.age >= p.maxAge || p.x > window.innerWidth + 40 || p.y < -40) {
                    disperseTransitionParticles[i] = disperseTransitionParticles[disperseTransitionParticles.length - 1];
                    disperseTransitionParticles.pop();
                    continue;
                }

                const lifeRatio = p.age / p.maxAge;
                // 柔和消融曲线：前 20% 保持清晰紧致颗粒感，随后随风逐渐变淡消逝
                const fadeCurve = lifeRatio < 0.20 ? 1 : Math.max(0, 1 - Math.pow((lifeRatio - 0.20) / 0.80, 1.45));
                const alpha = p.baseAlpha * fadeCurve;
                if (alpha <= 0.01) continue;

                // 尺寸在消散尾声轻微缩微，增强颗粒被风吹散蒸发的视觉说服力
                const curSize = p.size * (1 - lifeRatio * 0.38);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
                ctx.fillRect(p.x - curSize * 0.5, p.y - curSize * 0.5, curSize, curSize);

                // 水面同步映射柔和的倒影微粒（随水面涟漪波光起伏消逝）
                if (waterLineY && p.y < waterLineY) {
                    const distAbove = waterLineY - p.y;
                    const reflY = waterLineY + 12 * currentUiScale + distAbove * 0.48;
                    if (reflY < canvasH - 4) {
                        const waveShift = Math.sin((now || 0) * 0.0035 + p.y * 0.06) * 2.0 * currentUiScale;
                        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.20));
                        ctx.fillRect(p.x + waveShift - curSize * 0.5, reflY - curSize * 0.35, curSize * 1.05, curSize * 0.65);
                    }
                }
            }
            ctx.restore();
        }

        /* =========================================================================
         * 2. Web Audio API 程序化生成式声效引擎
         * ========================================================================= */
        class GenerativeSoundscape {
            constructor() {
                this.ctx = null;
                let savedMute = false;
                try {
                    const m = localStorage.getItem('workbuddy_sound_muted');
                    if (m !== null) savedMute = (m === '1' || m === 'true');
                } catch (e) {}
                this.isMuted = savedMute;
                this.isInitialized = false;
                this.masterGain = null;
                this.defaultAmbientGain = null; // 独立默认环境音总线节点
                this.customAudio = null;        // 当前激活的自定义 HTML5 Audio
                this.audioGeneration = 0;       // 丢弃过期切换的播放回调
                this.isCustomActive = false;    // 当前是否在播放自定义音乐
                this.fadingAudios = new Set();  // 正在淡出并待 pause 销毁的旧音频集合
                this.loginAudio = null;        // 浏览器自动播放策略下的登录页兜底音频
                this.preparedAudio = null;
                this.preparedAudioURL = '';
                // 登录成功后的受保护配置异步加载完成前，先暂存用户选择的曲目。
                // 这样主场景初始化不会抢先播放默认音频，避免默认音频闪入后再被替换。
                this.pendingAuthenticatedTrack = null;
                this.noteCount = 0;
                this.lastNoteTime = 0;
                this.scaleNotes = [
                    { name: 'D3', freq: 146.83 },
                    { name: 'F3', freq: 174.61 },
                    { name: 'G3', freq: 196.00 },
                    { name: 'A3', freq: 220.00 },
                    { name: 'C4', freq: 261.63 },
                    { name: 'D4', freq: 293.66 },
                    { name: 'E4', freq: 329.63 },
                    { name: 'F4', freq: 349.23 },
                    { name: 'G4', freq: 392.00 },
                    { name: 'A4', freq: 440.00 },
                    { name: 'C5', freq: 523.25 },
                    { name: 'D5', freq: 587.33 },
                    { name: 'E5', freq: 659.25 },
                    { name: 'G5', freq: 783.99 }
                ];
            }

            initForLogin(skipDefault = false) {
                if (this.isInitialized && this.ctx) {
                    if (this.ctx.state ===  suspended) this.ctx.resume().catch(() => {});
                    return;
                }
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                this.ctx = new AudioCtx();
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = 0.7 / 3; // 登录页为主场景音量的三分之一
                this.masterGain.connect(this.ctx.destination);

                this.defaultAmbientGain = this.ctx.createGain();
                this.defaultAmbientGain.gain.value = skipDefault ? 0.0 : 1.0;
                this.defaultAmbientGain.connect(this.masterGain);

                this.isMuted = false;
                this.isInitialized = true;
                this.isCustomActive = skipDefault;

                if (!skipDefault) {
                    this.startRainAmbience();
                    this.startAmbientPadLoop();
                }
            }

            startLoginAudioFallback() {
                if (this.loginAudio || typeof generateSyntheticWavUrl !== 'function') return;
                const url = generateSyntheticWavUrl(110.0, 220.0);
                if (!url) return;
                const audio = new Audio(url);
                audio.autoplay = true;
                audio.loop = true;
                audio.playsInline = true;
                audio.muted = true;
                audio.volume = 0.7 / 3;
                this.loginAudio = audio;
                // 先以静音状态启动，等待浏览器允许播放后再解除静音；
                // 直接先解除静音再 play 会被自动播放策略拒绝，留下 paused 音频。
                this.loginAudioReady = false;
                audio.play().then(() => {
                    this.loginAudioReady = true;
                }).catch(() => {});
            }

            activateLoginAudio() {
                if (!this.loginAudio) return;
                const audio = this.loginAudio;
                const start = () => {
                    audio.muted = false;
                    audio.volume = 0.7 / 3;
                    this.loginAudioReady = true;
                };
                // 已经在静音播放时，解除静音不会再次触发被拦截的 play。
                if (!audio.paused) {
                    start();
                    return;
                }
                audio.muted = true;
                audio.play().then(start).catch(() => {});
            }

            stopLoginAudio() {
                if (!this.loginAudio) return;
                try {
                    this.loginAudio.pause();
                    this.loginAudio.src = '';
                } catch (e) {}
                this.loginAudio = null;
            }

            prepareMediaGesture() {
                this.releasePreparedAudio();
                const url = generateSyntheticWavUrl(0, 0);
                if (!url) return;
                const audio = new Audio(url);
                audio.muted = true;
                audio.volume = 0;
                audio.loop = true;
                this.preparedAudio = audio;
                this.preparedAudioURL = url;
                try {
                    const play = audio.play();
                    if (play && typeof play.catch === 'function') play.catch(() => {});
                } catch (_) {}
            }

            releasePreparedAudio() {
                if (this.preparedAudio) {
                    try { this.preparedAudio.pause(); this.preparedAudio.src = ''; } catch (_) {}
                }
                if (this.preparedAudioURL) URL.revokeObjectURL(this.preparedAudioURL);
                this.preparedAudio = null;
                this.preparedAudioURL = '';
            }

            init(enableSound = true, options = {}) {
                const skipDefault = options && options.skipDefault === true;
                if (this.isInitialized && this.ctx) {
                    if (!this.isMuted) {
                        this.setMute(!enableSound);
                    }
                    if (this.ctx.state === 'suspended') this.ctx.resume();
                    if (!this.isMuted && this.masterGain) {
                        const now = this.ctx.currentTime;
                        this.masterGain.gain.cancelScheduledValues(now);
                        this.masterGain.gain.linearRampToValueAtTime(0.7, now + 1.2);
                    }
                    if (!skipDefault && !this.currentCustomUrl && !this.isCustomActive) {
                        this.playCustomBackgroundTrack('', true);
                    }
                    return;
                }
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AudioCtx();
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = enableSound ? 0.7 : 0.0;
                this.masterGain.connect(this.ctx.destination);

                this.defaultAmbientGain = this.ctx.createGain();
                this.defaultAmbientGain.gain.value = 1.0;
                this.defaultAmbientGain.connect(this.masterGain);

                this.isMuted = !enableSound;
                this.isInitialized = true;
                this.isCustomActive = false;

                this.startRainAmbience();
                this.startAmbientPadLoop();
                if (!skipDefault) this.playCustomBackgroundTrack('', true);
            }

            setMute(mute) {
                this.isMuted = mute;
                // 静音记忆双层持久化：本地与服务端全局同步，跨设备无缝统一单人偏好
                try {
                    localStorage.setItem('workbuddy_sound_muted', mute ? '1' : '0');
                } catch (e) {}
                try {
                    if (typeof safeApiFetch === 'function') {
                        safeApiFetch('/panel/api/customization', {
                            method: 'POST',
                            body: JSON.stringify({ is_muted: mute })
                        }, 5000).catch(() => {});
                    }
                } catch (e) {}

                if (!this.isInitialized && !mute) {
                    this.init(true);
                    return;
                }
                if (this.ctx && this.ctx.state === 'suspended' && !mute) {
                    this.ctx.resume();
                }
                const now = this.ctx ? this.ctx.currentTime : 0;
                const targetVol = ((typeof mainSceneActive !== 'undefined' && mainSceneActive) ? 0.7 : (0.7 / 3));

                // 核心交互规范：时长缩短至 1 秒 (1000ms)，静音时音量由大到小渐弱，取消静音时由小到大渐入，对称双向变换
                if (mute) {
                    if (this.masterGain && this.ctx) {
                        try {
                            const curG = Number.isFinite(this.masterGain.gain.value) ? this.masterGain.gain.value : targetVol;
                            this.masterGain.gain.cancelScheduledValues(now);
                            this.masterGain.gain.setValueAtTime(curG, now);
                            this.masterGain.gain.linearRampToValueAtTime(0.0, now + 1.0);
                        } catch (e) {}
                    }
                    if (this.customAudio) {
                        const curVol = (typeof this.customAudio.volume === 'number' && Number.isFinite(this.customAudio.volume)) ? this.customAudio.volume : targetVol;
                        this.fadeAudio(this.customAudio, curVol, 0.0, 1000, () => {
                            if (this.isMuted && this.customAudio) {
                                this.customAudio.volume = 0.0;
                            }
                        });
                    }
                    this.fadingAudios.forEach(aud => {
                        const curVol = (typeof aud.volume === 'number' && Number.isFinite(aud.volume)) ? aud.volume : targetVol;
                        this.fadeAudio(aud, curVol, 0.0, 1000, () => {
                            aud.volume = 0.0;
                            try { aud.pause(); aud.src = ''; if (aud.parentNode) aud.remove(); } catch (e) {}
                        });
                    });
                } else {
                    // 切换回来：音量由小到大平滑渐入（周期 1 秒）
                    if (this.masterGain && this.ctx) {
                        try {
                            this.masterGain.gain.cancelScheduledValues(now);
                            this.masterGain.gain.setValueAtTime(0.0, now);
                            this.masterGain.gain.linearRampToValueAtTime(targetVol, now + 1.0);
                        } catch (e) {}
                    }
                    if (this.isCustomActive && this.customAudio) {
                        if (this.customAudio.paused && !this.customAudio.ended) {
                            this.customAudio.play().catch(() => {});
                        }
                        this.fadeAudio(this.customAudio, 0.0, targetVol, 1000);
                        if (this.defaultAmbientGain && this.ctx) {
                            this.defaultAmbientGain.gain.cancelScheduledValues(now);
                            this.defaultAmbientGain.gain.setValueAtTime(0.0, now);
                        }
                    } else {
                        if (this.defaultAmbientGain && this.ctx) {
                            this.defaultAmbientGain.gain.cancelScheduledValues(now);
                            this.defaultAmbientGain.gain.setValueAtTime(0.0, now);
                            this.defaultAmbientGain.gain.linearRampToValueAtTime(1.0, now + 1.0);
                        }
                        if (this.customAudio) {
                            try { this.customAudio.pause(); } catch (e) {}
                        }
                    }
                }

                const muteLabel = document.getElementById('mute-label');
                if (muteLabel) muteLabel.textContent = mute ? 'Unmute' : 'Mute';
            }

            // 平滑淡入淡出 HTML5 Audio 工具方法 (1.5s 线性平滑渐变，无缝交叉过渡)
            fadeAudio(audio, startVol, targetVol, durationMs = 1500, onComplete = null) {
                if (!audio) {
                    if (onComplete) onComplete();
                    return;
                }
                if (audio._fadeRaf) {
                    cancelAnimationFrame(audio._fadeRaf);
                    audio._fadeRaf = null;
                }
                const startTime = performance.now();
                audio.volume = Math.max(0, Math.min(1, startVol));

                const step = (now) => {
                    const elapsed = now - startTime;
                    const progress = Math.min(1, elapsed / durationMs);
                    const currentVol = startVol + (targetVol - startVol) * progress;
                    try {
                        audio.volume = Math.max(0, Math.min(1, currentVol));
                    } catch (e) {}

                    if (progress < 1) {
                        audio._fadeRaf = requestAnimationFrame(step);
                    } else {
                        audio.volume = Math.max(0, Math.min(1, targetVol));
                        audio._fadeRaf = null;
                        if (onComplete) onComplete();
                    }
                };
                audio._fadeRaf = requestAnimationFrame(step);
            }

            playCustomBackgroundTrack(url, isDefault = false) {
                if (!isDefault && url && this.currentCustomUrl === url && this.customAudio && !this.customAudio.paused) return;
                if (!this.isInitialized) {
                    this.init(!this.isMuted);
                }
                const generation = ++this.audioGeneration;

                const fadeMs = 1500;
                const fadeSec = 1.5;

                // 模式 1：切换为默认环境音 (默认音乐时间设定为 100 秒，播放完后间隔 2 秒继续或随机)
                if (isDefault || !url) {
                    this.releasePreparedAudio?.();
                    if (this._customAudioTimer) {
                        clearTimeout(this._customAudioTimer);
                        this._customAudioTimer = null;
                    }
                    if (this._defaultAmbientTimer) {
                        clearTimeout(this._defaultAmbientTimer);
                        this._defaultAmbientTimer = null;
                    }
                    this.isCustomActive = false;
                    this.currentCustomUrl = null;

                    // 1. 旧自定义音乐平滑淡出到 0 并 pause 彻底停止
                    if (this.customAudio) {
                        const oldAudio = this.customAudio;
                        this.customAudio = null;
                        this.fadingAudios.add(oldAudio);
                        this.fadeAudio(oldAudio, oldAudio.volume, 0.0, fadeMs, () => {
                            try {
                                oldAudio.pause();
                                oldAudio.currentTime = 0;
                                oldAudio.src = '';
                                if (oldAudio.parentNode) oldAudio.remove();
                            } catch (e) {}
                            this.fadingAudios.delete(oldAudio);
                        });
                    }

                    // 2. 默认环境音平滑淡入（若静音则保持 0.0，绝不恢复有声）
                    if (this.defaultAmbientGain && this.ctx) {
                        const now = this.ctx.currentTime;
                        this.defaultAmbientGain.gain.cancelScheduledValues(now);
                        this.defaultAmbientGain.gain.setValueAtTime(this.defaultAmbientGain.gain.value, now);
                        const targetAmbient = this.isMuted ? 0.0 : 1.0;
                        this.defaultAmbientGain.gain.linearRampToValueAtTime(targetAmbient, now + fadeSec);
                    }

                    // 3. 默认音乐时长 100 秒计时，结束后间隔 2 秒循环或随机播放
                    const startDefaultCycle = () => {
                        if (this._defaultAmbientTimer) clearTimeout(this._defaultAmbientTimer);
                        this._defaultAmbientTimer = setTimeout(() => {
                            if (generation !== this.audioGeneration || this.isCustomActive) return;
                            // 100 秒期满：淡出默认环境音
                            if (this.defaultAmbientGain && this.ctx) {
                                const n = this.ctx.currentTime;
                                this.defaultAmbientGain.gain.cancelScheduledValues(n);
                                this.defaultAmbientGain.gain.setValueAtTime(this.defaultAmbientGain.gain.value, n);
                                this.defaultAmbientGain.gain.linearRampToValueAtTime(0.0, n + 1.0);
                            }

                            // 间隔 2 秒后继续播放当前音乐或播放随机音乐
                            if (this._customAudioTimer) clearTimeout(this._customAudioTimer);
                            this._customAudioTimer = setTimeout(() => {
                                if (generation !== this.audioGeneration || this.isCustomActive) return;
                                const cust = (typeof WBState !== 'undefined' && WBState.customization) ? WBState.customization : null;
                                if (cust && cust.randomMusic && Array.isArray(cust.musicList) && cust.musicList.length > 0) {
                                    // 随机音乐模式：间隔 2 秒后播放随机音乐
                                    const pool = cust.musicList;
                                    const pick = pool[Math.floor(Math.random() * pool.length)];
                                    cust.activeMusicId = pick.id;
                                    this.playCustomBackgroundTrack(pick.url, pick.isDefault || pick.id === 'm-default');
                                    if (typeof updateEditorialKeyFigures === 'function') updateEditorialKeyFigures(false);
                                    if (typeof renderEditorialStage === 'function') renderEditorialStage(false);
                                    if (typeof notifyEditorialStatus === 'function') notifyEditorialStatus('RANDOM', 'MUSIC -> ' + pick.name);
                                } else {
                                    // 选定当前默认音乐：重新淡入并循环 100 秒
                                    if (this.defaultAmbientGain && this.ctx) {
                                        const nowT = this.ctx.currentTime;
                                        this.defaultAmbientGain.gain.cancelScheduledValues(nowT);
                                        this.defaultAmbientGain.gain.setValueAtTime(0.0, nowT);
                                        this.defaultAmbientGain.gain.linearRampToValueAtTime(1.0, nowT + fadeSec);
                                    }
                                    startDefaultCycle();
                                }
                            }, 2000); // 间隔 2 秒
                        }, 100000); // 默认音乐时间设定为 100 秒
                    };
                    startDefaultCycle();
                    return;
                }

                // 模式 2：切换为自定义音乐
                if (this.currentCustomUrl === url && this.customAudio && !this.customAudio.paused) {
                    return; // 已经在循环播放该曲目，无需重新打断
                }
                if (this._customAudioTimer) {
                    clearTimeout(this._customAudioTimer);
                    this._customAudioTimer = null;
                }
                if (this._defaultAmbientTimer) {
                    clearTimeout(this._defaultAmbientTimer);
                    this._defaultAmbientTimer = null;
                }
                this.currentCustomUrl = url;
                this.isCustomActive = true;

                // 1. 默认环境音在 1.5s 内平滑衰减到 0.0
                if (this.defaultAmbientGain && this.ctx) {
                    const now = this.ctx.currentTime;
                    this.defaultAmbientGain.gain.cancelScheduledValues(now);
                    this.defaultAmbientGain.gain.setValueAtTime(this.defaultAmbientGain.gain.value, now);
                    this.defaultAmbientGain.gain.linearRampToValueAtTime(0.0, now + fadeSec);
                }

                // 2. 如果已有旧自定义音乐在播放，平滑将其音量降至 0 并彻底停止，绝不重叠
                if (this.customAudio) {
                    const oldAudio = this.customAudio;
                    this.customAudio = null;
                    this.fadingAudios.add(oldAudio);
                    this.fadeAudio(oldAudio, oldAudio.volume, 0.0, fadeMs, () => {
                        try {
                            oldAudio.pause();
                            oldAudio.currentTime = 0;
                            oldAudio.src = '';
                            if (oldAudio.parentNode) oldAudio.remove();
                        } catch (e) {}
                        this.fadingAudios.delete(oldAudio);
                    });
                }

                // 3. 播放结束后等待 2 秒，再重复或随机选择。
                try {
                    // 使用登录手势里已启动的静音媒体元素，避免认证及配置
                    // 请求结束后再创建播放器而丢失浏览器的播放授权。
                    const newAudio = this.preparedAudio || new Audio(url);
                    // Keep the active media element observable for browser diagnostics.
                    // It has no controls and does not affect the visual layout.
                    if (typeof HTMLElement !== 'undefined' && newAudio instanceof HTMLElement && !newAudio.isConnected) {
                        newAudio.hidden = true;
                        newAudio.dataset.workbuddyBackgroundAudio = 'active';
                        document.body.appendChild(newAudio);
                    }
                    if (this.preparedAudio) {
                        const preparedURL = this.preparedAudioURL;
                        this.preparedAudio = null;
                        this.preparedAudioURL = '';
                        newAudio.src = url;
                        newAudio.muted = false;
                        if (preparedURL) URL.revokeObjectURL(preparedURL);
                    }
                    newAudio.loop = false;
                    newAudio.volume = 0.0;
                    if (generation !== this.audioGeneration) {
                        try { newAudio.pause(); newAudio.src = ''; } catch (e) {}
                        return;
                    }
                    let hasTriggeredEnd = false;
                    const onTrackEnd = () => {
                        if (hasTriggeredEnd || generation !== this.audioGeneration || this.customAudio !== newAudio) return;
                        hasTriggeredEnd = true;
                        if (this._customAudioTimer) clearTimeout(this._customAudioTimer);
                        // 音乐播放完后：如果选定的是当前音乐，间隔 2 秒后继续重播；如果是随机音乐，间隔 2 秒后播放随机音乐
                        this._customAudioTimer = setTimeout(() => {
                            if (generation !== this.audioGeneration || !this.isCustomActive) return;
                            const cust = (typeof WBState !== 'undefined' && WBState.customization) ? WBState.customization : null;
                            if (cust && cust.randomMusic && Array.isArray(cust.musicList) && cust.musicList.length > 0) {
                                const pool = cust.musicList;
                                const pick = pool[Math.floor(Math.random() * pool.length)];
                                cust.activeMusicId = pick.id;
                                this.currentCustomUrl = null;
                                this.playCustomBackgroundTrack(pick.url, pick.isDefault || pick.id === 'm-default');
                                if (typeof updateEditorialKeyFigures === 'function') updateEditorialKeyFigures(false);
                                if (typeof renderEditorialStage === 'function') renderEditorialStage(false);
                                if (typeof notifyEditorialStatus === 'function') notifyEditorialStatus('RANDOM', 'MUSIC -> ' + pick.name);
                            } else {
                                // 选定的是当前音乐：间隔 2 秒后继续重播当前音乐
                                if (this.customAudio && this.currentCustomUrl === url && !this.fadingAudios.has(this.customAudio)) {
                                    try {
                                        this.customAudio.currentTime = 0;
                                        hasTriggeredEnd = false;
                                        const p = this.customAudio.play();
                                        if (p !== undefined) p.catch(() => {});
                                        const targetVol = this.isMuted ? 0.0 : ((typeof mainSceneActive !== 'undefined' && mainSceneActive) ? 0.7 : (0.7 / 3));
                                        this.fadeAudio(this.customAudio, 0.0, targetVol, fadeMs);
                                        return;
                                    } catch (e) {}
                                }
                                this.currentCustomUrl = null;
                                this.playCustomBackgroundTrack(url, false);
                            }
                        }, 2000); // 间隔 2 秒
                    };

                    newAudio.addEventListener('ended', onTrackEnd);
                    newAudio.addEventListener('error', () => {
                        if (generation === this.audioGeneration) notifyEditorialStatus('MUSIC // PLAYBACK FAILED');
                    });
                    this.customAudio = newAudio;
                    const targetVol = this.isMuted ? 0.0 : ((typeof mainSceneActive !== 'undefined' && mainSceneActive) ? 0.7 : (0.7 / 3));
                    this.fadeAudio(newAudio, 0.0, targetVol, fadeMs);
                    const playPromise = newAudio.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(e => console.warn('Audio play prevented:', e));
                    }
                } catch (e) {
                    console.error('Custom audio error:', e);
                }
            }

            // 任务执行与系统报错音效：双音调降频锯齿+方波警报脉冲
                        // 登录成功和弦琶音音效：上行纯净晶体和弦琶音
            triggerLoginSuccessSound() {
                if (!this.ctx) {
                    try {
                        const AudioCtx = window.AudioContext || window.webkitAudioContext;
                        if (AudioCtx) {
                            this.ctx = new AudioCtx();
                            this.masterGain = this.ctx.createGain();
                            this.masterGain.gain.value = this.isMuted ? 0.0 : 0.7;
                            this.masterGain.connect(this.ctx.destination);
                        }
                    } catch(e) {}
                }
                if (!this.ctx || this.isMuted) return;
                if (this.ctx.state === 'suspended') {
                    try { this.ctx.resume(); } catch(e) {}
                }
                try {
                    const now = this.ctx.currentTime;
                    // 上行和弦琶音: F4(349.23), A4(440.0), C5(523.25), E5(659.25), A5(880.0), C6(1046.5)
                    const notes = [349.23, 440.0, 523.25, 659.25, 880.0, 1046.5];
                    notes.forEach((freq, idx) => {
                        const noteStart = now + idx * 0.062;
                        const osc = this.ctx.createOscillator();
                        const gain = this.ctx.createGain();
                        const filter = this.ctx.createBiquadFilter();

                        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
                        osc.frequency.setValueAtTime(freq, noteStart);

                        filter.type = 'lowpass';
                        filter.frequency.setValueAtTime(freq * 3.5, noteStart);
                        filter.frequency.exponentialRampToValueAtTime(freq * 1.2, noteStart + (idx === notes.length - 1 ? 0.65 : 0.38));

                        const peakGain = 0.15 + (idx / notes.length) * 0.07;
                        gain.gain.setValueAtTime(0.0001, noteStart);
                        gain.gain.linearRampToValueAtTime(peakGain, noteStart + 0.012);
                        const dur = idx === notes.length - 1 ? 0.68 : 0.40;
                        gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + dur);

                        osc.connect(filter);
                        filter.connect(gain);
                        gain.connect(this.masterGain);

                        osc.start(noteStart);
                        osc.stop(noteStart + dur + 0.05);
                    });
                } catch (e) {}
            }

            triggerErrorSound() {
                if (!this.isInitialized || this.isMuted || !this.ctx) return;
                try {
                    const now = this.ctx.currentTime;
                    const osc1 = this.ctx.createOscillator();
                    const osc2 = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    const filter = this.ctx.createBiquadFilter();

                    osc1.type = 'sawtooth';
                    osc2.type = 'square';
                    osc1.frequency.setValueAtTime(148, now);
                    osc1.frequency.exponentialRampToValueAtTime(68, now + 0.32);
                    osc2.frequency.setValueAtTime(155, now);
                    osc2.frequency.exponentialRampToValueAtTime(71, now + 0.32);

                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(850, now);
                    filter.frequency.exponentialRampToValueAtTime(180, now + 0.32);

                    gain.gain.setValueAtTime(0.28, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

                    osc1.connect(filter);
                    osc2.connect(filter);
                    filter.connect(gain);
                    gain.connect(this.masterGain);

                    osc1.start(now);
                    osc2.start(now);
                    osc1.stop(now + 0.36);
                    osc2.stop(now + 0.36);
                } catch (e) {}
            }

            toggleMute() {
                this.setMute(!this.isMuted);
            }

            startRainAmbience() {
                const bufferSize = 2 * this.ctx.sampleRate;
                const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const output = noiseBuffer.getChannelData(0);
                let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
                for (let i = 0; i < bufferSize; i++) {
                    const white = Math.random() * 2 - 1;
                    b0 = 0.99886 * b0 + white * 0.0555179;
                    b1 = 0.99332 * b1 + white * 0.0750759;
                    b2 = 0.96900 * b2 + white * 0.1538520;
                    b3 = 0.86650 * b3 + white * 0.3104856;
                    b4 = 0.55000 * b4 + white * 0.5329522;
                    b5 = -0.7616 * b5 - white * 0.0168980;
                    output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.024;
                    b6 = white * 0.115926;
                }

                const whiteNoise = this.ctx.createBufferSource();
                whiteNoise.buffer = noiseBuffer;
                whiteNoise.loop = true;

                const filter = this.ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 1050;
                filter.Q.value = 0.65;

                const rainGain = this.ctx.createGain();
                rainGain.gain.value = 0.36;

                whiteNoise.connect(filter);
                filter.connect(rainGain);
                rainGain.connect(this.defaultAmbientGain || this.masterGain);
                whiteNoise.start(0);
            }

            startAmbientPadLoop() {
                const playPadChord = () => {
                    if (!this.isInitialized || (this.isCustomActive && this.defaultAmbientGain && this.defaultAmbientGain.gain.value <= 0.05)) return;
                    const now = this.ctx.currentTime;
                    const baseFreqs = [146.83, 220.00, 261.63, 329.63, 392.00];
                    baseFreqs.forEach((freq, idx) => {
                        const osc = this.ctx.createOscillator();
                        const gain = this.ctx.createGain();
                        const filter = this.ctx.createBiquadFilter();

                        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
                        osc.frequency.value = freq + (Math.random() - 0.5) * 1.2;

                        filter.type = 'lowpass';
                        filter.frequency.value = 540;

                        gain.gain.setValueAtTime(0.0008, now);
                        gain.gain.linearRampToValueAtTime(0.042, now + 3.2);
                        gain.gain.exponentialRampToValueAtTime(0.0008, now + 9.2);

                        osc.connect(filter);
                        filter.connect(gain);
                        gain.connect(this.defaultAmbientGain || this.masterGain);

                        osc.start(now);
                        osc.stop(now + 9.5);
                    });
                };

                playPadChord();
                setInterval(playPadChord, 7200);
            }

            triggerTileNote(index = 0) {
                const nowMs = performance.now();
                if (nowMs - this.lastNoteTime < 65) return;
                this.lastNoteTime = nowMs;

                this.noteCount++;
                const noteCounterEl = document.getElementById('note-counter');
                const chordIndicatorEl = document.getElementById('chord-indicator');
                const noteObj = this.scaleNotes[Math.abs(index) % this.scaleNotes.length];

                if (noteCounterEl) {
                    noteCounterEl.textContent = `${String(this.noteCount % 100).padStart(2, '0')} [ + ]`;
                }
                if (chordIndicatorEl) {
                    chordIndicatorEl.textContent = `( ${noteObj.name} )`;
                }

                if (!this.isInitialized || this.isMuted) return;

                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(noteObj.freq, now);
                osc.frequency.exponentialRampToValueAtTime(noteObj.freq * 1.003, now + 1.3);

                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.095, now + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.0005, now + 1.45);

                osc.connect(gain);
                gain.connect(this.masterGain);

                osc.start(now);
                osc.stop(now + 1.5);
            }

            triggerTransitionSweep(isOpening = true) {
                const indices = isOpening ? [0, 2, 4, 6, 9, 11, 13] : [13, 11, 9, 6, 4, 2, 0];
                indices.forEach((n, idx) => {
                    setTimeout(() => this.triggerTileNote(n), idx * 75);
                });
            }

            triggerTaskFaultAlarm() {
                if (!this.isInitialized) {
                    try { this.init(true); } catch (e) {}
                }
                if (!this.isInitialized || this.isMuted || !this.ctx) return;
                if (this.ctx.state === 'suspended') {
                    this.ctx.resume().catch(() => {});
                }

                const now = this.ctx.currentTime;
                const osc1 = this.ctx.createOscillator();
                const osc2 = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                const filter = this.ctx.createBiquadFilter();

                osc1.type = 'sawtooth';
                osc2.type = 'square';

                // 极具科技质感的工业报错脉冲蜂鸣音：双音微失谐与快速下行阻尼衰减
                osc1.frequency.setValueAtTime(420, now);
                osc1.frequency.exponentialRampToValueAtTime(180, now + 0.32);

                osc2.frequency.setValueAtTime(434, now);
                osc2.frequency.exponentialRampToValueAtTime(172, now + 0.32);

                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(1600, now);
                filter.frequency.exponentialRampToValueAtTime(320, now + 0.34);
                filter.Q.value = 4.2;

                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.24, now + 0.008);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

                osc1.connect(filter);
                osc2.connect(filter);
                filter.connect(gain);
                gain.connect(this.masterGain);

                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + 0.4);
                osc2.stop(now + 0.4);
            }
        }

        const soundscape = new GenerativeSoundscape();

        function generateSyntheticWavUrl(freq1, freq2) {
            try {
                const sampleRate = 22050;
                const duration = 2.0;
                const numSamples = Math.floor(sampleRate * duration);
                const buffer = new ArrayBuffer(44 + numSamples * 2);
                const view = new DataView(buffer);
                const writeString = (offset, str) => {
                    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
                };
                writeString(0, 'RIFF');
                view.setUint32(4, 36 + numSamples * 2, true);
                writeString(8, 'WAVE');
                writeString(12, 'fmt ');
                view.setUint32(16, 16, true);
                view.setUint16(20, 1, true);
                view.setUint16(22, 1, true);
                view.setUint32(24, sampleRate, true);
                view.setUint32(28, sampleRate * 2, true);
                view.setUint16(32, 2, true);
                view.setUint16(34, 16, true);
                writeString(36, 'data');
                view.setUint32(40, numSamples * 2, true);
                for (let i = 0; i < numSamples; i++) {
                    const t = i / sampleRate;
                    const s = Math.sin(2 * Math.PI * freq1 * t) * 0.35 + Math.sin(2 * Math.PI * freq2 * t) * 0.25;
                    const val = Math.max(-1, Math.min(1, s)) * 0x7fff;
                    view.setInt16(44 + i * 2, val, true);
                }
                const blob = new Blob([buffer], { type: 'audio/wav' });
                return URL.createObjectURL(blob);
            } catch (e) {
                return '';
            }
        }


        /* =========================================================================
         * 3. 全局鼠标位置追踪 (含防抖位移统计)
         * ========================================================================= */
        const pointer = {
            x: (typeof window !== 'undefined' ? window.innerWidth : 1200) / 2,
            y: (typeof window !== 'undefined' ? window.innerHeight : 800) / 2,
            vx: 0,
            vy: 0,
            normX: 0,
            normY: 0,
            smoothX: 0,
            smoothY: 0,
            active: false,
            lastHoverSwitchTime: 0,
            lastHoverLockX: -9999,
            lastHoverLockY: -9999
        };

        window.addEventListener('mousemove', (e) => {
            pointer.vx = e.clientX - pointer.x;
            pointer.vy = e.clientY - pointer.y;
            pointer.x = e.clientX;
            pointer.y = e.clientY;
            pointer.normX = (e.clientX / window.innerWidth - 0.5) * 2;
            pointer.normY = (e.clientY / window.innerHeight - 0.5) * 2;
            pointer.active = true;
        });

        /* =========================================================================
         * 4. 阶段 1 & 2：全屏“方块 + 中心圆点”矩阵与扩散/闪烁动画
         * ========================================================================= */
        const introCanvas = document.getElementById('intro-grid-canvas');
        const iCtx = introCanvas.getContext('2d');
        let introActive = true;
        let introCells = [];
        let outerEligibleCells = [];
        const INTRO_CELL_SIZE = 36;
        let introMaxRadius = 1000;
        let currentProgressValue = 0;
        let introStartTime = 0;
        let lastAmbientSpawnTime = 0;

        function initIntroGrid() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = window.innerWidth;
            const h = window.innerHeight;
            introCanvas.width = w * dpr;
            introCanvas.height = h * dpr;
            iCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

            introCells = [];
            outerEligibleCells = [];
            const cols = Math.ceil(w / INTRO_CELL_SIZE) + 1;
            const rows = Math.ceil(h / INTRO_CELL_SIZE) + 1;
            const offsetX = (w - cols * INTRO_CELL_SIZE) * 0.5;
            const offsetY = (h - rows * INTRO_CELL_SIZE) * 0.5;
            const cx = w * 0.5;
            const cy = h * 0.5;
            introMaxRadius = Math.hypot(cx, cy) * 0.98;
            const minOuterDist = Math.min(w, h) * 0.25;

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const x = offsetX + c * INTRO_CELL_SIZE + INTRO_CELL_SIZE * 0.5;
                    const y = offsetY + r * INTRO_CELL_SIZE + INTRO_CELL_SIZE * 0.5;
                    const dist = Math.hypot(x - cx, y - cy);

                    const hash = Math.abs(Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1;
                    const jitterDist = Math.max(0, dist + (hash - 0.5) * 48);

                    const cell = {
                        x,
                        y,
                        dist,
                        jitterDist,
                        revealTime: -1,
                        willWaveTwinkle: ((c * 17 + r * 31) % 9) < 5,
                        waveTwinkleDuration: 420 + hash * 240,
                        ambientStart: -1,
                        ambientDuration: 750,
                        ambientDoublePulse: hash > 0.45,
                        hoverEnergy: 0,
                        phaseSeed: hash * Math.PI * 2
                    };

                    introCells.push(cell);
                    if (dist > minOuterDist) {
                        outerEligibleCells.push(cell);
                    }
                }
            }
        }

        function renderIntroGrid(now) {
            if (!introActive) return;
            if (!introStartTime) introStartTime = now;

            const w = window.innerWidth;
            const h = window.innerHeight;
            iCtx.clearRect(0, 0, w, h);



            const elapsed = now - introStartTime;
            const waveDuration = 2650;
            const u = Math.min(1, elapsed / waveDuration);
            const easeOut = 1 - Math.pow(1 - u, 3.1);
            const currentWaveRadius = easeOut * (introMaxRadius * 1.04);

            if (elapsed > 1750 && now - lastAmbientSpawnTime > 75 && outerEligibleCells.length > 0) {
                lastAmbientSpawnTime = now;
                const candidate = outerEligibleCells[Math.floor(Math.random() * outerEligibleCells.length)];
                if (
                    candidate.revealTime > 0 &&
                    now - candidate.revealTime > candidate.waveTwinkleDuration + 250 &&
                    (candidate.ambientStart < 0 || now - candidate.ambientStart > candidate.ambientDuration + 400)
                ) {
                    candidate.ambientStart = now;
                    candidate.ambientDuration = 680 + Math.random() * 280;
                }
            }

            const boxHalf = (INTRO_CELL_SIZE - 6) * 0.5;
            const mouseDecaySpeed = Math.hypot(pointer.vx, pointer.vy);
            pointer.vx *= 0.85;
            pointer.vy *= 0.85;

            for (let i = 0; i < introCells.length; i++) {
                const cell = introCells[i];

                if (cell.revealTime < 0 && currentWaveRadius >= cell.jitterDist) {
                    cell.revealTime = now;
                }

                // 动量触发型高光：只有在鼠标移动瞬间激发那一下高光，静止后迅速暗淡，除非继续动
                if (pointer.active && mouseDecaySpeed > 0.15) {
                    const md = Math.hypot(cell.x - pointer.x, cell.y - pointer.y);
                    if (md < 88) {
                        const falloff = Math.pow(1 - md / 88, 2);
                        const moveFactor = Math.min(1.0, 0.25 + mouseDecaySpeed * 0.04);
                        const boost = falloff * moveFactor * 0.85;
                        if (boost > cell.hoverEnergy) cell.hoverEnergy = boost;
                    }
                }
                // 每帧平滑暗淡衰减 (约 250ms 内完全消退回无高光状态)
                cell.hoverEnergy *= 0.88;

                if (cell.revealTime < 0 && cell.hoverEnergy < 0.02) continue;

                const age = cell.revealTime >= 0 ? (now - cell.revealTime) : 0;
                const baseFade = cell.revealTime >= 0 ? Math.min(1, age / 280) : 0;

                let waveEnergy = 0;
                if (cell.revealTime >= 0 && age < cell.waveTwinkleDuration) {
                    const p = age / cell.waveTwinkleDuration;
                    const env = Math.sin(p * Math.PI);
                    if (cell.willWaveTwinkle) {
                        const pulse = 0.35 + 0.65 * Math.pow(Math.sin(p * Math.PI * 2.5 + cell.phaseSeed), 2);
                        waveEnergy = env * pulse * 0.88;
                    } else {
                        waveEnergy = env * 0.25;
                    }
                }

                let ambientEnergy = 0;
                if (cell.ambientStart > 0) {
                    const ap = (now - cell.ambientStart) / cell.ambientDuration;
                    if (ap >= 0 && ap < 1) {
                        const aEnv = Math.sin(ap * Math.PI);
                        const aPulse = cell.ambientDoublePulse
                            ? (0.4 + 0.6 * Math.pow(Math.sin(ap * Math.PI * 2.0), 2))
                            : 1.0;
                        ambientEnergy = aEnv * aPulse * 0.78;
                    } else {
                        cell.ambientStart = -1;
                    }
                }

                const activeEnergy = Math.min(1, Math.max(waveEnergy, ambientEnergy, cell.hoverEnergy));
                const radialFade = Math.max(0.14, 1 - Math.pow(cell.dist / (introMaxRadius * 1.12), 1.75));

                const borderAlpha = (0.026 * radialFade * baseFade) + activeEnergy * 0.17;
                if (borderAlpha > 0.01) {
                    iCtx.strokeStyle = `rgba(255, 255, 255, ${borderAlpha.toFixed(3)})`;
                    iCtx.lineWidth = 1;
                    iCtx.strokeRect(
                        Math.floor(cell.x - boxHalf) + 0.5,
                        Math.floor(cell.y - boxHalf) + 0.5,
                        boxHalf * 2,
                        boxHalf * 2
                    );
                }

                if (activeEnergy > 0.25) {
                    iCtx.fillStyle = `rgba(255, 255, 255, ${(activeEnergy * 0.028).toFixed(3)})`;
                    iCtx.fillRect(cell.x - boxHalf, cell.y - boxHalf, boxHalf * 2, boxHalf * 2);
                }

                const baseDotAlpha = 0.165 * radialFade * baseFade;
                const dotAlpha = Math.min(0.9, baseDotAlpha + activeEnergy * 0.72);
                if (dotAlpha > 0.015) {
                    iCtx.fillStyle = `rgba(255, 255, 255, ${dotAlpha.toFixed(3)})`;
                    const dotSize = activeEnergy > 0.45 ? 2.0 : 1.5;
                    iCtx.fillRect(cell.x - dotSize * 0.5, cell.y - dotSize * 0.5, dotSize, dotSize);
                }
            }

            requestAnimationFrame(renderIntroGrid);
        }

        /* =========================================================================
         * 5. 严格 000 -> 100 滚轮计数与 100 -> 000 极速回滚退场
         * ========================================================================= */
        const strips = [
            document.getElementById('strip-0'),
            document.getElementById('strip-1'),
            document.getElementById('strip-2')
        ];
        const DIGIT_HEIGHT = 148;

        strips.forEach((strip) => {
            strip.innerHTML = '';
            for (let d = 0; d <= 9; d++) {
                const div = document.createElement('div');
                div.className = `digit-item ${d === 0 ? 'digit-zero' : ''}`;
                div.textContent = d;
                strip.appendChild(div);
            }
        });

        function renderCounterValue(val, transitionSpeedMs = 140) {
            const clamped = Math.max(0, Math.min(100, Math.round(val)));
            const str = String(clamped).padStart(3, '0');
            for (let i = 0; i < 3; i++) {
                const digit = parseInt(str[i], 10);
                strips[i].style.transition = `transform ${transitionSpeedMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
                strips[i].style.transform = `translateY(-${digit * DIGIT_HEIGHT}px)`;
            }
        }

        // ==================== 生产后端与离线双模数据桥 ====================
        const IS_PROD_ENV = typeof window !== 'undefined' && (window.location?.protocol === 'http:' || window.location.protocol === 'https:') &&
                            (window.location.pathname.startsWith('/panel') || window.location.port === '7863');
        let csrfToken = '';
        let serverSession = null;
        let backendPreloadFinished = false;
        let backendPreloadSuccess = false;
        let memoryEncryptedBundle = null;

        async function decryptBundleWithKey(bundle, base64Key) {
            try {
                if (!window.crypto || !window.crypto.subtle) return null;
                const rawKey = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
                const cryptoKey = await window.crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
                const iv = Uint8Array.from(atob(bundle.iv), c => c.charCodeAt(0));
                const cipher = Uint8Array.from(atob(bundle.ciphertext), c => c.charCodeAt(0));
                const plainBuf = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher);
                const jsonStr = new TextDecoder().decode(plainBuf);
                return JSON.parse(jsonStr);
            } catch (err) {
                console.warn('[CRYPTO] Bundle decrypt failed:', err);
                return null;
            }
        }
        const MAX_LOADING_WAIT_MS = 6000; // 最长等待 6 秒保底防死锁

        async function safeApiFetch(url, options = {}, timeoutMs = 3000, acceptErrorJSON = false) {
            if (!IS_PROD_ENV) return null;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const headers = Object.assign({ 'Accept': 'application/json' }, options.headers || {});
                if (options.body != null && !headers['Content-Type'] && !headers['content-type']) {
                    headers['Content-Type'] = 'application/json';
                }
                const effectiveCsrf = csrfToken || window.csrfToken || localStorage.getItem('wb_csrf_token') || '';
                if (effectiveCsrf && options.method && options.method !== 'GET') {
                    headers['X-CSRF-Token'] = effectiveCsrf;
                }
                const res = await fetch(url, { ...options, headers, credentials: 'same-origin', signal: controller.signal });
                clearTimeout(timer);
                if (!res.ok && !acceptErrorJSON) return null;
                return await res.json();
            } catch (err) {
                clearTimeout(timer);
                return null;
            }
        }

        function syncOverviewData(ov) {
            if (!ov) return;
            if (typeof ov.version === 'string' && ov.version.trim()) {
                WBState.coreVersion = ov.version.trim().replace(/^v/i, '');
            }
            if (typeof ov.uptime_sec === 'number') WBState.uptimeSec = ov.uptime_sec;
            WBState.cpuAvailable = ov.service_cpu_available === true;
            if (WBState.cpuAvailable) WBState.cpuPct = ov.service_cpu_percent;
            WBState.serviceMemoryAvailable = ov.service_memory_available === true;
            if (WBState.serviceMemoryAvailable) WBState.memMb = ov.service_memory_bytes / 1048576;
            if (Array.isArray(ov.accounts)) {
                const merged = ov.accounts.map((raw, idx) => {
                    const previous = WBState.accounts.find(account => account.uid === String(raw.uid));
                    const isCooling = Boolean(raw.cooling);
                    const isManualOff = Boolean(raw.manual_disabled);
                    return {
                        uid: String(raw.uid || ("acc-" + (idx + 1))),
                        name: String(raw.nickname || raw.uid || ("账号-" + (idx + 1))),
                        region: (raw.realm === 'global' ? 'GLOBAL' : 'CN'),
                        balance: typeof raw.credits === 'number' ? raw.credits : 0,
                        quota: typeof raw.credits_total === 'number' ? raw.credits_total : 0,
                        manualOn: !isManualOff,
                        forceOverride: false,
                        coolSec: raw.cool_remaining_sec || 0,
                        state: raw.blocked ? 'BLOCKED' : (isCooling ? 'COOLING' : (raw.state || 'HEALTHY')),
                        blocked: Boolean(raw.blocked),
                        egress: '—',
                        unlimited: false,
                        packages: raw.blocked ? [] : (previous?.packages || [])
                    };
                });
                WBState.accounts = merged;
            }
        }

        function syncEgressData(eg) {
            if (!eg) return;
            if (Array.isArray(eg.nodes)) {
                WBState.nodes = eg.nodes.map((n, i) => ({
                    id: String(n.id || ("node-" + (i + 1))),
                    subId: String(n.provider || ''),
                    name: (() => {
                        if (typeof n.display_name === 'string' && n.display_name) return n.display_name;
                        const name = String(n.name || ("Node-" + (i + 1)));
                        const prefix = n.provider ? String(n.provider) + '/' : '';
                        return prefix && name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name;
                    })(),
                    ping: typeof n.delay_ms === 'number' ? n.delay_ms : 0,
                    status: n.status || 'untested',
                    timeout: n.status === 'timeout',
                    bindingCount: Number.isInteger(n.binding_count) ? n.binding_count : (Array.isArray(eg.bindings) ? eg.bindings.filter(b => b.node === n.id).length : 0),
                    trend: Array.isArray(n.history) ? n.history.map(item => item.delay || 0).slice(-7) : []
                }));
            }
            if (Array.isArray(eg.bindings)) {
                for (const account of WBState.accounts) { account.egress = '—'; account.egressNodeId = ''; }
                for (const binding of eg.bindings) {
                const account = WBState.accounts.find(item => item.uid === binding.uid);
                const node = WBState.nodes.find(item => item.id === binding.node);
                if (account && node) { account.egress = node.name; account.egressNodeId = node.id; }
                }
            }
        }

        function syncPackagesData(pkg) {
            if (!Array.isArray(pkg?.accounts)) return;
            for (const row of pkg.accounts) {
                const account = WBState.accounts.find(item => item.uid === row.uid);
                if (!account || account.blocked) continue;
                if (row.error) { account.packages = []; account.packagesError = true; continue; }
                account.packagesError = false;
                account.balance = row.remain;
                account.quota = row.size;
                account.packages = Array.isArray(row.packages) ? row.packages.map(item => ({
                    ...item, total: item.size, days: item.expires_at ? Math.ceil((item.expires_at - Date.now()) / 86400000) : null
                })) : [];
            }
        }

        function syncModelsData(result) {
            if (!Array.isArray(result?.models)) return false;
            WBState.models = result.models.map(item => ({id: item.id, name: item.name || item.id,
                realm: String(item.realm || '').toUpperCase(), vendor: item.vendor || '', ctx: String(item.context_length || '—'),
                maxOut: String(item.max_output_tokens || '—'),
                ttft: (typeof item.ttft === 'number' && item.ttft > 0) ? item.ttft : (typeof item.latency === 'number' && item.latency > 0 ? item.latency : null),
                trend: Array.isArray(item.trend) ? item.trend : []}));
            WBState.modelCacheHot = result.cached === true;
            const ageSec = (typeof result.cache_age_seconds === 'number') ? result.cache_age_seconds : 0;
            WBState.modelsLastRefreshed = Date.now() - (ageSec * 1000);
            return true;
        }

        function syncLogsData(logs) {
            if (!logs) return;
            if (Array.isArray(logs.entries)) {
                WBState.logs = logs.entries.map((item, i) => {
                    let timeStr = '12:00:00';
                    if (item.time) {
                        const d = new Date(item.time);
                        if (!isNaN(d.getTime())) {
                            const bd = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
                            timeStr = `${String(bd.getHours()).padStart(2, '0')}:${String(bd.getMinutes()).padStart(2, '0')}:${String(bd.getSeconds()).padStart(2, '0')}`;
                        } else {
                            timeStr = item.time.includes('T') ? item.time.split('T')[1].slice(0, 8) : item.time;
                        }
                    }
                    return {
                        id: String(item.id || i),
                        time: timeStr,
                        code: Number(item.status_code || item.status || 0),
                        uid: String(item.account_uid || ''),
                        egress: '',
                        summary: item.outcome === 'token_isolated' ? '令牌续期失败，账号已隔离，请重新授权' : String(item.message || item.error || item.outcome || '请求记录'),
                        raw: ''
                    };
                });
            }
        }

        function syncUsageData(data) {
            if (!data) return;
            WBState.usageCacheHitRate = data.totals?.cache_hit_rate ?? null;
            WBState.usageByModel = (data.by_model || []).map(item => ({
                name: item.key, reqs: String(item.requests || 0), prompt: String(item.prompt_tokens || 0),
                comp: String(item.completion_tokens || 0), credits: formatCredits(item.credits)
            }));
            const points = Array.isArray(data.series) ? data.series.slice(-24) : [];
            if (points.length >= 2) {
                const series = { labels: points.map(point => { if (!point.t) return ''; const d = new Date(point.t); if (isNaN(d.getTime())) return String(point.t).slice(11, 16); const bd = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000); return `${String(bd.getHours()).padStart(2, '0')}:${String(bd.getMinutes()).padStart(2, '0')}`; }),
                    inVals: points.map(point => point.prompt_tokens || 0),
                    outVals: points.map(point => point.completion_tokens || 0) };
                WBState.usage24h = series;
                WBState.usage6h = { labels: series.labels.slice(-6), inVals: series.inVals.slice(-6), outVals: series.outVals.slice(-6) };
            }
        }

        let maintenanceFingerprint = '';
        function syncMaintenanceData(maintenance) {
            if (!maintenance || !Array.isArray(maintenance.steps)) return false;
            const fingerprint = JSON.stringify(maintenance);
            if (maintenanceFingerprint === fingerprint) return false;
            maintenanceFingerprint = fingerprint;
            const wasRunning = WBState.tasks.running;
            WBState.tasks.running = !!maintenance.running;
            if (WBState.currentChapter === 'tasks' || WBState.currentChapter === 'scheduler') {
                if (maintenance.steps.some(step => step.failed > 0 || step.state === 'failed')) setPreviewFrameState('error', 800);
                else if (WBState.tasks.running) if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                else if (wasRunning) setPreviewFrameState('success', 800);
            }
            WBState.tasks.pausedAll = !!maintenance.paused;
            WBState.tasks.activeStep = maintenance.steps.findIndex(step => step.state === 'running');
            WBState.tasks.steps = maintenance.steps.map((step, index) => ({
                code: String(index + 1).padStart(2, '0'), key: step.name,
                name: ({token: '访问令牌续期', checkin: '每日签到', activity: '每日活跃上报', travel: '猫猫旅行状态'})[step.name] || step.name,
                backendState: step.state,
                dur: (() => { const start = Date.parse(step.started_at); const end = Date.parse(step.finished_at); return Number.isFinite(start) && start > 946684800000 ? (() => { const diff = ((Number.isFinite(end) && end > start ? end : Date.now()) - start); return diff < 1000 ? Math.max(0.1, (diff / 1000)).toFixed(1) + 's' : Math.round(diff / 1000) + 's'; })() : '—'; })(), progress: ['done', 'failed'].includes(step.state) ? 100 : (step.total > 0 ? Math.round((step.accounts || []).length * 100 / step.total) : 0),
                okCount: step.completed || 0, processedCount: (step.accounts || []).length, skippedCount: (step.accounts || []).filter(item => item.state === 'skipped').length, totalCount: step.total || 0,
                failures: (step.accounts || []).filter(item => item.state === 'failed').map(item => {
                    const account = WBState.accounts.find(entry => entry.uid === item.uid);
                    const message = String(item.message || '未提供失败原因');
                    return {uid: item.uid, name: account?.name || item.uid, region: account?.region || '—',
                        reason: /12153|refresh token is invalid/i.test(message) ? '刷新令牌已失效，需要重新授权' : message, time: '—'};
                })
            }));
            return true;
        }

        // Daily scheduler gate is separate from the pause state of one
        // already-running maintenance batch. Starting enables future daily
        // executions and then runs one batch immediately.
        function syncTaskScheduleData(schedule) {
            if (!schedule || typeof schedule.enabled !== 'boolean') return false;
            const changed = WBState.tasks.scheduleEnabled !== schedule.enabled;
            WBState.tasks.scheduleEnabled = schedule.enabled;
            return changed;
        }

        function updateTaskScheduleVisual(enabled, animate = true) {
            WBState.tasks.scheduleEnabled = !!enabled;
            const disabled = !WBState.tasks.scheduleEnabled;
            const gray = disabled || WBState.tasks.pausedAll;
            const rows = document.querySelectorAll('#editorial-stage-body .editorial-row');
            rows.forEach((rowEl, idx) => {
                const shell = rowEl.querySelector('.task-line-shell');
                if (!shell) return;
                const activeTrack = shell.querySelector('.task-active-track');
                const grayTrack = shell.querySelector('.task-gray-track');
                if (activeTrack) {
                    activeTrack.style.transition = animate ? 'width 0.55s cubic-bezier(0, 0, 0.2, 1)' : 'none';
                    activeTrack.style.width = gray ? '0%' : '100%';
                }
                if (grayTrack) {
                    grayTrack.style.transition = animate ? 'width 0.55s cubic-bezier(0, 0, 0.2, 1), box-shadow 0.2s ease' : 'none';
                    grayTrack.style.width = gray ? '100%' : '0%';
                    grayTrack.style.boxShadow = gray ? '-2.5px 0 0 0 #050605' : 'none';
                }
                const stateSpan = rowEl.children?.[5];
                if (stateSpan && disabled) {
                    stateSpan.textContent = (WBState.tasks.pausedAll || WBState.tasks.scheduleEnabled === false) ? '排程停用' : (WBState.tasks.running ? '执行中' : '空闲就绪');
                    stateSpan.className = 'text-[11px] tone-paused text-left transition-colors duration-300';
                } else if (stateSpan && !disabled) {
                    const step = WBState.tasks.steps[idx];
                    const failed = (step?.failures?.length || 0) > 0;
                    stateSpan.textContent = WBState.tasks.pausedAll ? '已暂停' : (failed ? '报错' : (step?.backendState === 'running' ? '执行中' : (step?.backendState === 'pending' ? '待运行' : '正常')));
                    stateSpan.className = `text-[11px] ${WBState.tasks.pausedAll ? 'tone-paused' : (failed ? 'tone-fault' : 'tone-normal')} text-left transition-colors duration-300`;
                }
            });
            updateEditorialKeyFigures(false);
            syncDynamicBottomButtons();
        }

        let taskActionPending = false;
        async function setDailyTasksEnabled(enabled) {
            if (!IS_PROD_ENV) {
                updateTaskScheduleVisual(enabled);
                setPreviewFrameState(enabled ? 'success' : 'busy', enabled ? 800 : 600);
                notifyEditorialStatus(enabled ? 'ALL DAILY TASKS ENABLED' : 'ALL DAILY TASKS DISABLED');
                return true;
            }
            const finishFeedback = beginActionFeedback();
            notifyEditorialStatus(enabled ? 'ENABLING ALL DAILY TASKS…' : 'DISABLING ALL DAILY TASKS…');
            const data = await safeApiFetch('/panel/api/tasks/schedule', {
                method: 'POST', body: JSON.stringify({enabled: !!enabled})
            }, 10000);
            if (!data || typeof data.enabled !== 'boolean') {
                finishFeedback('error');
                notifyEditorialStatus('每日排程更新失败，任务未启动');
                return false;
            }
            updateTaskScheduleVisual(data.enabled);
            finishFeedback(data.enabled === !!enabled ? 'success' : 'error');
            if (WBState.tasks.running) if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
            notifyEditorialStatus(data.enabled ? 'ALL DAILY TASKS ENABLED' : 'ALL DAILY TASKS DISABLED');
            return data.enabled === !!enabled;
        }

        async function startAllTasks() {
            if (taskActionPending) return;
            taskActionPending = true;
            try {
                if (!await setDailyTasksEnabled(true)) return;
                if (WBState.tasks.running) {
                    if (WBState.tasks.pausedAll) {
                        const status = await safeApiFetch('/panel/api/maintenance/pause', {method:'POST', body:JSON.stringify({paused:false})}, 10000);
                        if (!status) { setPreviewFrameState('error', 800); notifyEditorialStatus('任务恢复失败'); return; }
                        syncMaintenanceData(status);
                    }
                    renderEditorialStage(false);
                    return;
                }
                await runFourStepPipeline();
            } finally { taskActionPending = false; }
        }

        async function setDailyTasksFromToggle() {
            if (taskActionPending) return;
            taskActionPending = true;
            try { await setDailyTasksEnabled(WBState.tasks.scheduleEnabled === false); }
            finally { taskActionPending = false; }
        }

        function escapeDisplayText(value) {
            return String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
        }

        async function triggerBackendPreload() {
            if (!IS_PROD_ENV) {
                setTimeout(() => {
                    backendPreloadFinished = true;
                    backendPreloadSuccess = true;
                }, 400);
                return;
            }

            try {
                // 登录前只等待公开 bootstrap。受保护的面板接口必须等登录成功后再请求。
                const bundle = await safeApiFetch('/api/preload-bundle', {}, 5500);
                if (!bundle || !bundle.ciphertext || !bundle.iv) throw new Error('bootstrap unavailable');
                memoryEncryptedBundle = bundle;
                backendPreloadFinished = true;
                backendPreloadSuccess = true;

                // 若当前浏览器已具备有效登录态（例如刷新页面），开屏期并行预热拉取错误日志与用量
                safeApiFetch('/auth/session', {}, 1500).then(sess => {
                    if (sess && sess.authenticated) {
                        csrfToken = sess.csrf_token || csrfToken;
                        serverSession = sess;
                        Promise.all([
                            safeApiFetch('/panel/api/request_logs?summary=1&limit=50', {}, 2500),
                            safeApiFetch('/panel/api/usage?hours=24', {}, 2500)
                        ]).then(([logs, usage]) => {
                            if (logs) syncLogsData(logs);
                            if (usage) syncUsageData(usage);
                        }).catch(() => {});
                    }
                }).catch(() => {});
            } catch (e) {
                backendPreloadFinished = true;
                backendPreloadSuccess = false;
            }
        }

        async function loadAuthenticatedMusic() {
            if (!IS_PROD_ENV) return;
            const epoch = authTransitionEpoch;
            soundscape.pendingAuthenticatedTrack = { loading: true };
            const music = await safeApiFetch('/panel/api/music', {}, 3500);
            if (epoch !== authTransitionEpoch) return;
            if (music && Array.isArray(music.musicList)) {
                WBState.customization.musicList = music.musicList;
                WBState.customization.activeMusicId = music.activeMusicId;
                WBState.customization.randomMusic = music.randomMusic;
            }
            const active = music && Array.isArray(music.musicList)
                ? (WBState.customization.musicList.find(m => m.id === WBState.customization.activeMusicId)
                    || WBState.customization.musicList.find(m => m.id === 'm-default'))
                : null;
            const track = active ? {url: active.url, isDefault: !!active.isDefault || active.id === 'm-default'}
                : {url: '', isDefault: true};
            soundscape.pendingAuthenticatedTrack = track;
            if (soundscape.isInitialized && mainSceneActive) {
                soundscape.pendingAuthenticatedTrack = null;
                soundscape.playCustomBackgroundTrack(track.url, track.isDefault);
            }
        }

        async function loadAuthenticatedPanelData() {
            if (!IS_PROD_ENV) return;
            const epoch = authTransitionEpoch;
            try {
                const sessionRes = await safeApiFetch('/auth/session', {}, 2000);
                if (epoch !== authTransitionEpoch) return;
                if (sessionRes && sessionRes.csrf_token) {
                    csrfToken = sessionRes.csrf_token;
                    serverSession = sessionRes;
                }
                const [ovRes, egressRes, pkgRes, logsRes, usageRes, customRes, modelsRes, defEgressRes] = await Promise.all([
                    safeApiFetch('/panel/api/overview', {}, 3500),
                    safeApiFetch('/panel/api/meta/nodes', {}, 3500),
                    safeApiFetch('/panel/api/packages', {}, 3500),
                    safeApiFetch('/panel/api/request_logs?summary=1&limit=50', {}, 3500),
                    safeApiFetch('/panel/api/usage?hours=24', {}, 3500),
                    safeApiFetch('/panel/api/customization', {}, 3500),
                    safeApiFetch('/panel/api/models', {}, 10000),
                    safeApiFetch('/panel/api/egress/default', {}, 3500)
                ]);
                if (epoch !== authTransitionEpoch) return;
                if (ovRes) syncOverviewData(ovRes);
                const preferences = await safeApiFetch('/panel/api/preferences', {}, 3500);
                if (epoch !== authTransitionEpoch) return;
                if (Number.isInteger(preferences?.credit_guard_low)) WBState.configThreshold = preferences.credit_guard_low;
                if (Number.isInteger(preferences?.subscription_refresh_hours)) WBState.configCacheHours = preferences.subscription_refresh_hours;
                if (egressRes) syncEgressData(egressRes);
                if (pkgRes) syncPackagesData(pkgRes);
                if (defEgressRes?.ok && typeof defEgressRes.node_id === 'string') { WBState.systemDefaultNode = defEgressRes.node_id; WBState.systemDefaultNodeName = defEgressRes.node_name || ''; }
                if (logsRes) syncLogsData(logsRes);
                if (usageRes) syncUsageData(usageRes);
                const maintenance = await safeApiFetch('/panel/api/maintenance/status', {}, 10000);
                if (epoch !== authTransitionEpoch) return;
                syncMaintenanceData(maintenance);
                const schedule = await safeApiFetch('/panel/api/tasks/schedule', {}, 10000);
                if (epoch !== authTransitionEpoch) return;
                syncTaskScheduleData(schedule);
                const subscriptions = await safeApiFetch('/panel/api/meta/subscriptions', {}, 10000);
                if (epoch !== authTransitionEpoch) return;
                if (Array.isArray(subscriptions?.subscriptions)) {
                    WBState.subscriptions = subscriptions.subscriptions.map(item => {
                        const refreshed = Date.parse(item.last_refresh_at || '');
                        return {
                            id: item.id, name: item.name, disabled: !item.enabled, hasURL: item.has_url === true,
                            url: item.url_preview || '', ageHours: Number.isFinite(refreshed) && refreshed > 0 ? Math.max(0, (Date.now() - refreshed) / 3600000) : null
                        };
                    });
                    const savedActiveSub = (typeof localStorage !== 'undefined' && localStorage.getItem('wb_active_sub_id')) || '';
                    if (savedActiveSub && WBState.subscriptions.some(item => item.id === savedActiveSub)) {
                        WBState.activeSubId = savedActiveSub;
                    } else if (!WBState.subscriptions.some(item => item.id === WBState.activeSubId)) {
                        WBState.activeSubId = WBState.subscriptions[0]?.id || '';
                        if (WBState.activeSubId && typeof localStorage !== 'undefined') {
                            try { localStorage.setItem('wb_active_sub_id', WBState.activeSubId); } catch (_) {}
                        }
                    }
                }
                syncModelsData(modelsRes);
                if (customRes && typeof customRes === 'object') {
                    const container = customRes.data && typeof customRes.data === 'object' ? customRes.data : customRes;
                    const saved = container.customization && typeof container.customization === 'object' ? container.customization : container;
                    // 音乐由 /panel/api/music 单独加载，避免旧个性化快照覆盖最新选择。
                    if (Array.isArray(saved.sloganList)) WBState.customization.sloganList = saved.sloganList.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.text === 'string' && typeof s.date === 'string');
                    if (typeof saved.activeSloganId === 'string' && WBState.customization.sloganList.some(s => s.id === saved.activeSloganId)) WBState.customization.activeSloganId = saved.activeSloganId;
                    if (typeof saved.randomMotto === 'boolean') WBState.customization.randomMotto = saved.randomMotto;
                    if (typeof saved.is_muted === 'boolean' && typeof soundscape !== 'undefined' && soundscape) {
                        soundscape.isMuted = saved.is_muted;
                        const ml = document.getElementById('mute-label');
                        if (ml) ml.textContent = saved.is_muted ? 'Unmute' : 'Mute';
                    }
                }
            } catch (e) {
                console.warn('Authenticated panel preload failed:', e);
            }
        }

        
        // 核心规范：开机加载达到 100 并倒数至 0（100~0 回归）期间启动音频
        // 规则：优先播放用户先前在个性化中配置并选定的自定义音轨（1/3 音量）；若无则播放默认雨林氛围音
        function startAppropriateLoginSoundtrack() {
            if (typeof soundscape === 'undefined' || !soundscape) return;
            soundscape.loginSoundtrackTriggered = true;

            const resumeAnyPausedAudio = () => {
                if (soundscape.ctx && soundscape.ctx.state === 'suspended') {
                    soundscape.ctx.resume().catch(() => {});
                }
                if (soundscape.customAudio && soundscape.customAudio.paused) {
                    soundscape.customAudio.play().catch(() => {});
                }
            };

            if (soundscape._loginTrackStarted) {
                resumeAnyPausedAudio();
                return;
            }
            soundscape._loginTrackStarted = true;

            // 优先获取用户选定的自定义音乐
            let activeUrl = (typeof localStorage !== 'undefined' && localStorage.getItem('wb_active_music_url')) || '';
            let activeId = (typeof localStorage !== 'undefined' && localStorage.getItem('wb_active_music_id')) || '';

            if (!activeUrl && WBState.customization && Array.isArray(WBState.customization.musicList)) {
                const found = WBState.customization.musicList.find(m => m.id === WBState.customization.activeMusicId);
                if (found && found.url) {
                    activeUrl = found.url;
                    activeId = found.id;
                }
            }

            if (activeUrl && activeId !== 'm-default') {
                soundscape.playCustomBackgroundTrack(activeUrl, false);
                if (soundscape.customAudio) {
                    soundscape.customAudio.volume = soundscape.isMuted ? 0.0 : (0.7 / 3);
                    const p = soundscape.customAudio.play();
                    if (p && typeof p.catch === 'function') {
                        p.catch(() => {
                            // 浏览器原生自动播放受限时，由全局 capture 阶段的 triggerAudioOnUserGesture 接管
                        });
                    }
                }
            } else {
                soundscape.initForLogin();
                if (soundscape.ctx && soundscape.ctx.state === 'suspended') {
                    soundscape.ctx.resume().catch(() => {
                        // 由全局 capture 阶段的 triggerAudioOnUserGesture 接管
                    });
                }
            }
        }

        
        // 全局手势捕获唤醒：在捕获阶段拦截真实物理交互（点击任意区域、敲击键盘、轻触屏幕），过滤脚本伪手势并唤醒自选音乐
        // 全局手势捕获唤醒：在捕获阶段拦截真实物理交互（点击任意区域、敲击键盘、轻触屏幕），过滤脚本伪手势并唤醒自选音乐与点音反馈
        const triggerAudioOnUserGesture = (e) => {
            if (e && e.isTrusted === false) return; // 过滤程序模拟的伪事件（如 input.focus()）
            if (typeof soundscape === 'undefined' || !soundscape) return;
            if (soundscape.ctx && soundscape.ctx.state === 'suspended') {
                soundscape.ctx.resume().catch(() => {});
            }
            if (soundscape.customAudio) {
                if (soundscape.customAudio.paused) {
                    soundscape.customAudio.play().catch(() => {});
                }
            } else if (!soundscape._loginTrackStarted) {
                startAppropriateLoginSoundtrack();
            }
            // 任意物理点击触发清脆谐波点音
            if (e && (e.type === 'click' || e.type === 'pointerdown' || e.type === 'touchstart')) {
                if (typeof soundscape.triggerTileNote === 'function') {
                    soundscape.triggerTileNote(Math.floor(Math.random() * 5));
                }
            }
        };
        if (typeof window !== 'undefined') {
            ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'click'].forEach(evt => {
                window.addEventListener(evt, triggerAudioOnUserGesture, { capture: true, passive: true });
                if (typeof document !== 'undefined') {
                    document.addEventListener(evt, triggerAudioOnUserGesture, { capture: true, passive: true });
                }
            });
        }


        function startStrictLoadingSequence() {
            const statusEl = document.getElementById('loading-status');
            const progressBarEl = document.getElementById('mini-progress-bar');

            // 在加载阶段预热登录页音频；进入密码框时只需恢复已创建的 AudioContext。
            try {
                    const savedId = (typeof localStorage !== 'undefined' && localStorage.getItem('wb_active_music_id')) || '';
                    const isCustom = Boolean(savedId && savedId !== 'm-default');
                    soundscape.initForLogin(isCustom);
            } catch (e) {
                console.warn('Login audio preload deferred:', e);
            }

            // 在首屏加载期间异步并行拉取系统级公共音乐与全局个性化配置（标语与主题），确保未登录首页为所有访客展示系统级定制文案与主题
            (async () => {
                try {
                    const [music, customRes] = await Promise.all([
                        safeApiFetch('/panel/api/music', {}, 2500),
                        safeApiFetch('/panel/api/customization', {}, 2500)
                    ]);
                    if (music && Array.isArray(music.musicList)) {
                        WBState.customization.musicList = music.musicList;
                        WBState.customization.activeMusicId = music.activeMusicId;
                        WBState.customization.randomMusic = music.randomMusic;
                        const curMusic = music.musicList.find(m => m.id === music.activeMusicId);
                        if (curMusic && typeof localStorage !== 'undefined') {
                            localStorage.setItem('wb_active_music_id', curMusic.id || '');
                            localStorage.setItem('wb_active_music_url', curMusic.url || '');
                        }
                    }
                    if (customRes && typeof customRes === 'object') {
                        const container = customRes.data && typeof customRes.data === 'object' ? customRes.data : customRes;
                        const saved = container.customization && typeof container.customization === 'object' ? container.customization : container;
                        if (Array.isArray(saved.sloganList) && saved.sloganList.length > 0) {
                            WBState.customization.sloganList = saved.sloganList.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.text === 'string');
                            try { if (typeof localStorage !== 'undefined') localStorage.setItem('wb_slogan_list', JSON.stringify(WBState.customization.sloganList)); } catch (_) {}
                        }
                        if (typeof saved.activeSloganId === 'string' && WBState.customization.sloganList.some(s => s.id === saved.activeSloganId)) {
                            WBState.customization.activeSloganId = saved.activeSloganId;
                            try { if (typeof localStorage !== 'undefined') localStorage.setItem('wb_active_slogan_id', saved.activeSloganId); } catch (_) {}
                        }
                        if (typeof saved.randomMotto === 'boolean') {
                            WBState.customization.randomMotto = saved.randomMotto;
                        }
                        if (typeof saved.activeTheme === 'string') {
                            WBState.customization.activeTheme = saved.activeTheme;
                            try { if (typeof localStorage !== 'undefined') localStorage.setItem('wb_active_theme', saved.activeTheme); } catch (_) {}
                            if (typeof switchWeatherTheme === 'function') switchWeatherTheme(saved.activeTheme);
                        }
                        if (typeof applyCurrentMottoToHome === 'function') {
                            applyCurrentMottoToHome();
                        }
                    }
                } catch (_) {}
            })();

            const startTime = performance.now();
            let lastDisplayedInt = -1;
            let currentStatusText = '[ LOADING ASSETS ]';
            let phase = 'FAST_RISE_TO_69';
            let awaitStartTime = 0;
            let burstStartTime = 0;
            let burstFromVal = 69;
            let rewindStartTime = 0;
            let retryStartTime = 0;

            const FAST_RISE_MS = 450;
            const BURST_MS = 260;

            triggerBackendPreload();

            function stepCounter(now) {
                const totalElapsed = now - startTime;

                if (phase === 'FAST_RISE_TO_69') {
                    const u = Math.min(1, totalElapsed / FAST_RISE_MS);
                    const currentFloat = u * 69;
                    const intVal = Math.min(69, Math.floor(currentFloat));
                    currentProgressValue = intVal;
                    progressBarEl.style.width = intVal + '%';

                    if (intVal !== lastDisplayedInt) {
                        lastDisplayedInt = intVal;
                        renderCounterValue(intVal, 75);
                    }

                    if (u >= 1) {
                        if (backendPreloadFinished && backendPreloadSuccess) {
                            phase = 'BURST_TO_100';
                            burstStartTime = now;
                            burstFromVal = 69;
                        } else {
                            phase = 'SYNC_WAIT_BACKEND';
                            awaitStartTime = now;
                        }
                    }
                    requestAnimationFrame(stepCounter);
                } else if (phase === 'SYNC_WAIT_BACKEND') {
                    const waitElapsed = now - awaitStartTime;
                    const waitProgress = 69 + 29 * (1 - Math.exp(-waitElapsed / 2400));
                    const intVal = Math.min(98, Math.floor(waitProgress));
                    currentProgressValue = intVal;
                    progressBarEl.style.width = intVal + '%';

                    if (intVal !== lastDisplayedInt) {
                        lastDisplayedInt = intVal;
                        renderCounterValue(intVal, 160);

                        if (currentStatusText !== '[ ALMOST THERE... ]') {
                            currentStatusText = '[ ALMOST THERE... ]';
                            scrambleText(statusEl, currentStatusText, 360);
                        }
                    }

                    if (backendPreloadFinished && backendPreloadSuccess) {
                        phase = 'BURST_TO_100';
                        burstStartTime = now;
                        burstFromVal = intVal;
                    } else if ((backendPreloadFinished && !backendPreloadSuccess) || totalElapsed >= MAX_LOADING_WAIT_MS) {
                        phase = 'BACKEND_RETRY_WAIT';
                        retryStartTime = now;
                        currentStatusText = '[ RETRYING BACKEND ]';
                        scrambleText(statusEl, currentStatusText, 320);
                    }
                    requestAnimationFrame(stepCounter);
                } else if (phase === 'BACKEND_RETRY_WAIT') {
                    // 后端 bootstrap 失败时不伪装成 READY；短暂退避后重新请求。
                    const retryElapsed = now - retryStartTime;
                    currentProgressValue = 98;
                    progressBarEl.style.width = '98%';
                    if (retryElapsed >= 1200) {
                        backendPreloadFinished = false;
                        backendPreloadSuccess = false;
                        triggerBackendPreload();
                        awaitStartTime = now;
                        phase = 'SYNC_WAIT_BACKEND';
                        currentStatusText = '[ ALMOST THERE... ]';
                        scrambleText(statusEl, currentStatusText, 260);
                    }
                    requestAnimationFrame(stepCounter);
                } else if (phase === 'BURST_TO_100') {
                    const burstElapsed = now - burstStartTime;
                    const bu = Math.min(1, burstElapsed / BURST_MS);
                    const currentFloat = burstFromVal + (100 - burstFromVal) * (bu * (2 - bu));
                    const intVal = Math.min(100, Math.floor(currentFloat));
                    currentProgressValue = intVal;
                    progressBarEl.style.width = intVal + '%';

                    if (intVal !== lastDisplayedInt) {
                        lastDisplayedInt = intVal;
                        renderCounterValue(intVal, 110);

                        if (intVal === 100 && currentStatusText !== '[ READY ]') {
                            currentStatusText = '[ READY ]';
                            scrambleText(statusEl, currentStatusText, 280);
                        }
                    }

                    if (bu >= 1) {
                        currentProgressValue = 100;
                        progressBarEl.style.width = '100%';
                        renderCounterValue(100, 90);
                        setTimeout(() => {
                            phase = 'REWIND_TO_0';
                            rewindStartTime = performance.now();
                            requestAnimationFrame(stepCounter);
                        }, 180);
                    } else {
                        requestAnimationFrame(stepCounter);
                    }
                } else if (phase === 'REWIND_TO_0') {
                    // 核心契约：在 100~0 回归动画一开始就立即触发音频播放
                    startAppropriateLoginSoundtrack();
                    const rewindElapsed = now - rewindStartTime;
                    const rewindDuration = 520;
                    const t = Math.min(1, rewindElapsed / rewindDuration);
                    const rewindVal = Math.round(100 * (1 - t * t));
                    if (rewindVal !== lastDisplayedInt) {
                        lastDisplayedInt = rewindVal;
                        renderCounterValue(rewindVal, 75);
                    }

                    if (statusEl.textContent !== '[ READY ]') {
                        currentStatusText = '[ READY ]';
                        scrambleText(statusEl, '[ READY ]', 280);
                    }
                    progressBarEl.style.width = '100%';

                    if (t < 1) {
                        requestAnimationFrame(stepCounter);
                    } else {
                        phase = 'DONE';
                        const counterBox = document.getElementById('counter-box');
                        const promptBox = document.getElementById('prompt-box');
                        const accessKeyInput = document.getElementById('input-access-key');
                        const btnEnterSystem = document.getElementById('btn-enter-system');
                        counterBox.style.opacity = '0';
                        setTimeout(() => {
                            counterBox.classList.add('hidden');
                            promptBox.classList.remove('hidden');
                            promptBox.classList.add('flex');
                            try {
                                if (typeof soundscape !== 'undefined' && soundscape) {
                                    if (soundscape.customAudio && soundscape.customAudio.paused) {
                                        soundscape.customAudio.play().catch(() => {});
                                    } else if (!soundscape._loginTrackStarted) {
                                        startAppropriateLoginSoundtrack();
                                    }
                                    if (soundscape.ctx && soundscape.ctx.state === 'suspended') {
                                        const resume = soundscape.ctx.resume();
                                        if (resume && typeof resume.catch === 'function') resume.catch(() => {});
                                    }
                                }
                            } catch (e) {}
                            requestAnimationFrame(() => {
                                promptBox.style.opacity = '1';
                                if (accessKeyInput) accessKeyInput.focus();
                                void checkPasswordSessionInitialState();
                            });
                        }, 240);
                    }
                }
            }

            requestAnimationFrame(stepCounter);
        }

        const btnEnterSystem = document.getElementById('btn-enter-system');
        if (btnEnterSystem) {
            btnEnterSystem.addEventListener('mouseenter', () => {
                scrambleText(btnEnterSystem, btnEnterSystem.getAttribute('data-text') || '[ ACCESS WORKSPACE ]', 360);
            });
        }

        let isAuthenticating = false;
        let logoutResetTimer = null;
        let authTransitionEpoch = 0;
        let logoutPromise = null;

        let passwordResetTimer = null;
        let passwordUiMode = 'AUTH';
        let defaultPasswordSetup = false;

        function updatePasswordUiState(mode, message = '') {
            passwordUiMode = mode;
            const accessKeyInput = document.getElementById('input-access-key');
            const pwdHint = document.getElementById('password-hint');
            const enterBtn = document.getElementById('btn-enter-system');
            if (enterBtn && typeof clearInterval === 'function') {
                clearInterval(enterBtn._scrambleTimer);
                enterBtn._scrambleTimer = null;
            }
            const btnSpan = enterBtn ? (enterBtn.querySelector('span') || enterBtn) : null;

            if (mode === 'INIT') {
                const text = '[ INITIALIZE WORKSPACE ]';
                if (enterBtn) {
                    enterBtn.textContent = text;
                    enterBtn.setAttribute('data-text', text);
                    enterBtn.classList.remove('text-[#ff5c74]', 'border-[#ff5c74]/60');
                }
                if (btnSpan && btnSpan !== enterBtn) btnSpan.textContent = text;
                if (accessKeyInput) {
                    accessKeyInput.placeholder = 'CREATE ACCESS KEY';
                    accessKeyInput.classList.remove('access-denied-border');
                }
                if (pwdHint) {
                    pwdHint.classList.remove('text-[#ff5c74]');
                    pwdHint.textContent = message || 'INITIAL SETUP // CREATE YOUR ACCESS KEY';
                    pwdHint.style.opacity = '1';
                }
            } else if (mode === 'EMPTY_DENIED') {
                const text = '[ KEY REQUIRED ]';
                if (enterBtn) {
                    enterBtn.textContent = text;
                    enterBtn.setAttribute('data-text', text);
                    enterBtn.classList.add('text-[#ff5c74]', 'border-[#ff5c74]/60');
                }
                if (btnSpan && btnSpan !== enterBtn) btnSpan.textContent = text;
                if (accessKeyInput) accessKeyInput.placeholder = 'ENTER ACCESS KEY';
                if (pwdHint) {
                    pwdHint.classList.add('text-[#ff5c74]');
                    pwdHint.textContent = message || '[ ACCESS KEY REQUIRED // PLEASE ENTER KEY ]';
                    pwdHint.style.opacity = '1';
                }
            } else if (mode === 'DENIED') {
                const text = '[ RE-ENTER KEY ]';
                if (enterBtn) {
                    enterBtn.textContent = text;
                    enterBtn.setAttribute('data-text', text);
                    enterBtn.classList.add('text-[#ff5c74]', 'border-[#ff5c74]/60');
                }
                if (btnSpan && btnSpan !== enterBtn) btnSpan.textContent = text;
                if (accessKeyInput) accessKeyInput.placeholder = 'RE-ENTER ACCESS KEY';
                if (pwdHint) {
                    pwdHint.classList.add('text-[#ff5c74]');
                    pwdHint.textContent = message || '[ ACCESS DENIED // INVALID ACCESS KEY ]';
                    pwdHint.style.opacity = '1';
                }
            } else {
                const text = '[ ACCESS WORKSPACE ]';
                if (enterBtn) {
                    enterBtn.textContent = text;
                    enterBtn.setAttribute('data-text', text);
                    enterBtn.classList.remove('text-[#ff5c74]', 'border-[#ff5c74]/60');
                }
                if (btnSpan && btnSpan !== enterBtn) btnSpan.textContent = text;
                if (accessKeyInput) {
                    accessKeyInput.placeholder = 'ENTER ACCESS KEY';
                    accessKeyInput.classList.remove('access-denied-border');
                }
                if (pwdHint) {
                    pwdHint.classList.remove('text-[#ff5c74]');
                    pwdHint.textContent = message || 'ENTER ACCESS KEY TO UNLOCK WORKSPACE';
                    pwdHint.style.opacity = '1';
                }
            }
        }

        async function checkPasswordSessionInitialState() {
            try {
                const sessionRes = await safeApiFetch('/auth/session', {}, 2500);
                if (passwordUiMode === 'DENIED' || passwordUiMode === 'EMPTY_DENIED') return;
                if (sessionRes && sessionRes.default_password) {
                    defaultPasswordSetup = true;
                    updatePasswordUiState('INIT');
                } else {
                    defaultPasswordSetup = false;
                    updatePasswordUiState('AUTH');
                }
            } catch (_) {
                if (passwordUiMode === 'DENIED' || passwordUiMode === 'EMPTY_DENIED') return;
                updatePasswordUiState('AUTH');
            }
        }

        function triggerAccessDeniedAnimation(message = '', isEmpty = false) {
            const accessKeyInput = document.getElementById('input-access-key');
            const pwdContainer = document.getElementById('password-container');
            const pwdHint = document.getElementById('password-hint');
            const enterBtn = document.getElementById('btn-enter-system');

            if (!accessKeyInput || !pwdContainer) return;

            // 首次登录错误时必定播放报错提示音
            try {
                if (typeof soundscape !== 'undefined' && soundscape) {
                    if (!soundscape.ctx) {
                        soundscape.initForLogin();
                    }
                    if (soundscape.ctx && soundscape.ctx.state === 'suspended') {
                        soundscape.ctx.resume();
                    }
                    soundscape.triggerErrorSound();
                }
            } catch(e) {
                console.warn('Login error sound prevented:', e);
            }

            pwdContainer.classList.add('access-denied-shake');
            accessKeyInput.classList.add('access-denied-border');
            const mode = isEmpty ? 'EMPTY_DENIED' : 'DENIED';
            const defaultMsg = isEmpty ? '[ ACCESS KEY REQUIRED // PLEASE ENTER KEY ]' : '[ ACCESS DENIED // INVALID ACCESS KEY ]';
            updatePasswordUiState(mode, message || defaultMsg);

            setTimeout(() => {
                pwdContainer.classList.remove('access-denied-shake');
                isAuthenticating = false;
            }, 500);
            setTimeout(() => {
                accessKeyInput.classList.remove('access-denied-border');
            }, 1200);
        }

        async function submitPasswordAndEnter(withSound = true) {
            if (logoutResetTimer) return;
            if (isAuthenticating) return;
            clearTimeout(passwordResetTimer);
            isAuthenticating = true;
            // 在真实点击或回车的同步调用栈中解锁音频上下文；不能等网络
            // 登录返回后再 resume，否则浏览器可能把它当成无手势自动播放。
            if (withSound && soundscape) {
                if (soundscape.customAudio) {
                    if (soundscape.customAudio.paused) soundscape.customAudio.play().catch(() => {});
                } else {
                    startAppropriateLoginSoundtrack();
                }
                if (soundscape.ctx?.state === 'suspended') soundscape.ctx.resume().catch(() => {});
                soundscape.prepareMediaGesture();
            }
            if (logoutPromise && !(await logoutPromise)) {
                logoutPromise = endServerSession();
                if (!(await logoutPromise)) {
                    soundscape.releasePreparedAudio();
                    triggerAccessDeniedAnimation('[ LOGOUT FAILED // RETRY ]');
                    return;
                }
            }
            const accessKeyInput = document.getElementById('input-access-key');
            const entered = accessKeyInput?.value || '';

            // 严禁无密码登录：输入空的密码直接报错
            if (!entered) {
                soundscape.releasePreparedAudio();
                if (withSound && typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerErrorSound === 'function') {
                    soundscape.triggerErrorSound();
                }
                triggerAccessDeniedAnimation('[ ACCESS KEY REQUIRED // PLEASE ENTER KEY ]', true);
                clearTimeout(passwordResetTimer);
                passwordResetTimer = setTimeout(() => {
                    if (passwordUiMode === 'DENIED' || passwordUiMode === 'EMPTY_DENIED') {
                        updatePasswordUiState(defaultPasswordSetup ? 'INIT' : 'AUTH');
                    }
                    isAuthenticating = false;
                }, 1200);
                isAuthenticating = false;
                return;
            }

            const transitionEpoch = ++authTransitionEpoch;
            let authenticated = false;
            let authenticatedPanelReady = Promise.resolve();
            let failureMessage = '[ LOGIN UNAVAILABLE // RETRY ]';

            try {
                const response = await fetch('/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ password: entered }),
                    signal: AbortSignal.timeout(10000)
                });
                const loginRes = await response.json();
                if (response.status === 401) failureMessage = '[ ACCESS DENIED // INVALID ACCESS KEY ]';
                else if (response.status === 429) failureMessage = '[ TOO MANY ATTEMPTS // WAIT AND RETRY ]';
                else if (!response.ok) failureMessage = '[ LOGIN FAILED // RETRY ]';
                if (transitionEpoch !== authTransitionEpoch) return;
                if (loginRes && loginRes.authenticated) {
                    authenticated = true;
                    if (loginRes.csrf_token) {
                        csrfToken = loginRes.csrf_token;
                        window.csrfToken = loginRes.csrf_token;
                    }
                    // Resolve protected music/preferences before entering the main
                    // scene.  Starting the scene first races the default track
                    // against the user's configured track and causes a visible
                    // audio snap during the login transition.
                    authenticatedPanelReady = loadAuthenticatedMusic();
                    void loadAuthenticatedPanelData().then(() => {
                        // 数据可能在用户进入某个章节后才到达。刷新可见内容，
                        // 但不要销毁正在输入的凭据、订阅或个性化表单。
                        if (transitionEpoch !== authTransitionEpoch || pageTransition.state !== 'IN_PAGE'
                            || WBState.accountSubmode || WBState.importingSub || WBState.customization.isAdding) return;
                        updateEditorialKeyFigures(false);
                        renderEditorialStage(false);
                    });
                }
            } catch (e) {
                authenticated = false;
            }
            if (authenticated) {
                if (accessKeyInput) accessKeyInput.value = '';
                await authenticatedPanelReady.catch(() => {});
                if (transitionEpoch !== authTransitionEpoch) { isAuthenticating = false; return; }
                soundscape.stopLoginAudio();
                const pwdContainer = document.getElementById('password-container');
                const pwdHint = document.getElementById('password-hint');

                if (pwdContainer) {
                    pwdContainer.style.transition = 'opacity 380ms cubic-bezier(0.16, 1, 0.3, 1), transform 380ms cubic-bezier(0.16, 1, 0.3, 1)';
                    pwdContainer.style.opacity = '0';
                    pwdContainer.style.transform = 'translateY(10px)';
                }
                if (pwdHint) pwdHint.style.opacity = '0';

                setTimeout(() => {
                    if (transitionEpoch !== authTransitionEpoch) {
                        isAuthenticating = false;
                        return;
                    }
                    enterMainExperience(withSound);
                    isAuthenticating = false;
                }, 420);
            } else {
                soundscape.releasePreparedAudio();
                if (withSound && typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerErrorSound === 'function') {
                    soundscape.triggerErrorSound();
                }
                triggerAccessDeniedAnimation(failureMessage, false);
                const inpKey = document.getElementById('input-access-key');
                clearTimeout(passwordResetTimer);
                // 输错后保留 1.2 秒供用户辨识错误，随后清空输入并平滑恢复初始状态
                passwordResetTimer = setTimeout(() => {
                    if (inpKey) inpKey.value = '';
                    if (passwordUiMode === 'DENIED' || passwordUiMode === 'EMPTY_DENIED') {
                        updatePasswordUiState(defaultPasswordSetup ? 'INIT' : 'AUTH');
                    }
                }, 1200);
            }
        }

        if (btnEnterSystem) {
            btnEnterSystem.addEventListener('click', () => submitPasswordAndEnter(true));
        }
        const accessKeyInput = document.getElementById('input-access-key');
        if (accessKeyInput) {
            accessKeyInput.addEventListener('focus', () => startAppropriateLoginSoundtrack(), { passive: true });
            accessKeyInput.addEventListener('click', () => startAppropriateLoginSoundtrack(), { passive: true });
            accessKeyInput.addEventListener('keydown', (e) => {
                startAppropriateLoginSoundtrack();
                if (e.key === 'Enter') submitPasswordAndEnter(true);
            });
            accessKeyInput.addEventListener('input', () => {
                isAuthenticating = false;
                clearTimeout(passwordResetTimer);
                if (passwordUiMode === 'DENIED' || passwordUiMode === 'EMPTY_DENIED') {
                    accessKeyInput.classList.remove('access-denied-border');
                    updatePasswordUiState(defaultPasswordSetup ? 'INIT' : 'AUTH');
                }
            });
        }

        /* =========================================================================
         * 6. 阶段 3：主场景
         *    - 三种自然天气（阴天 / 夜晚 / 黄昏，已移除蓝调时刻）
         *    - 鼠标缝隙防抖保底机制（稳定基座碰撞 + 滞回锁定 + 冷却保护）
         *    - 点击方块由中心向四周旋转扩散进入新页面动效 + 水面阴影与倒影同步处理
         *    - 四周同时不多于 2 个的多样化几何悬浮特效（渐显 -> 悬浮演进 -> 渐隐 -> 异地重现）
         * ========================================================================= */
        const worldCanvas = document.getElementById('main-world-canvas');
        const wCtx = worldCanvas.getContext('2d');
        const labelsLayer = document.getElementById('project-labels-layer');

        let currentUiScale = 1;
        let currentPageScale = 1;
        function updateResponsiveScale() {
            const w = window.innerWidth;
            const h = window.innerHeight;
            currentUiScale = Math.max(0.45, Math.min(1.85, Math.min(w / 1440, h / 860)));
            const safeStageH = h - 74 * currentUiScale - 24;
            currentPageScale = Math.max(0.40, Math.min(1.85, Math.min((w - 64) / 1100, safeStageH / 664)));
            document.documentElement.style.setProperty('--ui-scale', currentUiScale.toFixed(4));
            document.documentElement.style.setProperty('--page-scale', currentPageScale.toFixed(4));
        }

        // 三种自然天气配色方案（阴天 / 夜晚 / 黄昏）
        const WEATHER_THEMES = {
            overcast: {
                name: '阴天',
                skyTop: [11, 22, 14],
                skyMid: [25, 44, 29],
                horizonMist: [62, 86, 68],
                canopyLight: [195, 215, 204],
                waterTop: [26, 40, 32],
                waterBottom: [7, 13, 10],
                waterSkyGlow: [204, 220, 212],
                waterShadowRgb: [3, 7, 5],
                leafHueRange: [96, 134],
                leafSat: 34,
                leafLight: 18,
                tileBaseHue: 192,
                tileHueSpread: 26,
                tileSat: 48,
                rainColor: 'rgba(215, 232, 222, 0.24)',
                rippleColor: [225, 240, 232]
            },
            night: {
                name: '夜晚',
                skyTop: [4, 9, 16],
                skyMid: [10, 22, 34],
                horizonMist: [24, 48, 66],
                canopyLight: [130, 175, 210],
                waterTop: [10, 20, 32],
                waterBottom: [3, 6, 11],
                waterSkyGlow: [120, 165, 205],
                waterShadowRgb: [1, 3, 7],
                leafHueRange: [155, 195],
                leafSat: 38,
                leafLight: 11,
                tileBaseHue: 206,
                tileHueSpread: 30,
                tileSat: 64,
                rainColor: 'rgba(165, 205, 240, 0.20)',
                rippleColor: [175, 215, 245]
            },
            dusk: {
                name: '黄昏',
                skyTop: [24, 18, 22],
                skyMid: [58, 38, 30],
                horizonMist: [132, 84, 56],
                canopyLight: [242, 188, 138],
                waterTop: [46, 33, 28],
                waterBottom: [14, 10, 11],
                waterSkyGlow: [235, 178, 132],
                waterShadowRgb: [8, 4, 4],
                leafHueRange: [72, 112],
                leafSat: 32,
                leafLight: 16,
                tileBaseHue: 34,
                tileHueSpread: 28,
                tileSat: 56,
                rainColor: 'rgba(240, 205, 175, 0.21)',
                rippleColor: [245, 212, 182]
            }
        };

        let currentWeatherKey = (typeof localStorage !== 'undefined' && localStorage.getItem('wb_active_theme')) || 'overcast';
        if (!WEATHER_THEMES[currentWeatherKey]) currentWeatherKey = 'overcast';
        let blendedTheme = JSON.parse(JSON.stringify(WEATHER_THEMES[currentWeatherKey]));

        function lerpNum(a, b, t) {
            return a + (b - a) * t;
        }
        function lerpRGB(arrA, arrB, t) {
            return [
                lerpNum(arrA[0], arrB[0], t),
                lerpNum(arrA[1], arrB[1], t),
                lerpNum(arrA[2], arrB[2], t)
            ];
        }
        function stepWeatherBlend() {
            const target = WEATHER_THEMES[currentWeatherKey];
            const speed = 0.05;
            blendedTheme.skyTop = lerpRGB(blendedTheme.skyTop, target.skyTop, speed);
            blendedTheme.skyMid = lerpRGB(blendedTheme.skyMid, target.skyMid, speed);
            blendedTheme.horizonMist = lerpRGB(blendedTheme.horizonMist, target.horizonMist, speed);
            blendedTheme.canopyLight = lerpRGB(blendedTheme.canopyLight, target.canopyLight, speed);
            blendedTheme.waterTop = lerpRGB(blendedTheme.waterTop, target.waterTop, speed);
            blendedTheme.waterBottom = lerpRGB(blendedTheme.waterBottom, target.waterBottom, speed);
            blendedTheme.waterSkyGlow = lerpRGB(blendedTheme.waterSkyGlow, target.waterSkyGlow, speed);
            blendedTheme.waterShadowRgb = lerpRGB(blendedTheme.waterShadowRgb, target.waterShadowRgb, speed);
            blendedTheme.rippleColor = lerpRGB(blendedTheme.rippleColor, target.rippleColor, speed);
            blendedTheme.leafHueRange = [
                lerpNum(blendedTheme.leafHueRange[0], target.leafHueRange[0], speed),
                lerpNum(blendedTheme.leafHueRange[1], target.leafHueRange[1], speed)
            ];
            blendedTheme.leafSat = lerpNum(blendedTheme.leafSat, target.leafSat, speed);
            blendedTheme.leafLight = lerpNum(blendedTheme.leafLight, target.leafLight, speed);
            blendedTheme.tileBaseHue = lerpNum(blendedTheme.tileBaseHue, target.tileBaseHue, speed);
            blendedTheme.tileHueSpread = lerpNum(blendedTheme.tileHueSpread, target.tileHueSpread, speed);
            blendedTheme.tileSat = lerpNum(blendedTheme.tileSat, target.tileSat, speed);
            blendedTheme.rainColor = target.rainColor;
        }

        const GRID_COLS = 32;
        const GRID_ROWS = 12;

        // 12 个真实项目节点定义
        // WorkBuddy Local 核心业务模块矩阵 (彻底消除重复，全量高精度模块化命名)
        const PROJECTS = [
            { id: 'overview', title: 'SYSTEM OVERVIEW', col: 6, row: 2, labelPos: 'top', role: 'CORE ENGINE // HEALTH & TOPOLOGY', desc: '全局系统运行健康状况。高耸六角长棱柱，汇总 16 个凭据沙箱可用率、Loopback 端口映射状态与 Token 综合指标。', spec: 'LOCAL MESH / 127.0.0.1', spec2: '16 ACCOUNTS ACTIVE', spec3: 'STATUS: 100% HEALTHY', btn1: '[ REFRESH METRICS ]', btn2: '[ EXPORT TOPOLOGY ]' },
            { id: 'egress', title: 'NETWORK EGRESS', col: 13, row: 1, labelPos: 'top', role: 'DIAMOND MESH // TUNNEL CORE', desc: '多协议代理出站网络（Hysteria2 / TUIC / Shadowsocks）。经典明亮式多面切割钻石拓扑，25 顶点，实时上下行吞吐监测与 48h 订阅节点热重载。', spec: '25-VERTEX DIAMOND', spec2: '5 NODES CONNECTED', spec3: 'DOWN: 24.8MB/s • UP: 1.2MB/s', btn1: '[ PROBE ALL LATENCIES ]', btn2: '[ PURGE NODE CACHE ]' },
            { id: 'accounts', title: 'IDENTITY VAULT', col: 21, row: 1, labelPos: 'top', role: 'MULTI-ACCOUNT POOL & QUOTA', desc: '多账号凭据安全隔离沙箱。硬朗正方体多维金库，实时监测各账号积分余额、生命周期健康度与凭据自动续约保活状态。', spec: 'HEAVY VAULT CUBE', spec2: '16 CREDENTIAL VAULTS', spec3: 'ROTATION: AUTOMATIC', btn1: '[ SYNC CREDENTIALS ]', btn2: '[ ADD NEW ACCOUNT ]' },
            { id: 'tasks', title: 'AUTOMATION RUNS', col: 19, row: 3, labelPos: 'top', role: 'CRON ENGINE & BACKGROUND ROTATION', desc: '全自动日常维护作业流水线。空间三维十字机械梁架，包含令牌保活巡检、每日自动签到、旅行出勤与失败队列自动重试机制。', spec: '3D CROSS-BEAM FRAME', spec2: '4 ACTIVE PIPELINES', spec3: 'LAST RUN: 3M AGO', btn1: '[ TRIGGER ALL JOBS ]', btn2: '[ VIEW FAILURE LOGS ]' },
            { id: 'usage', title: 'TELEMETRY USAGE', col: 6, row: 5, labelPos: 'bottom', role: 'TOKEN TIMESERIES & THROUGHPUT', desc: '高分辨率 Token 消耗时间线图谱。阶梯式神殿方台，区分 Prompt / Completion 双轨指标，精准追踪各模型端点的调用频次与速率限制。', spec: 'STEPPED ZIGGURAT', spec2: 'HOURLY WINDOWS', spec3: 'RATE LIMITS: OPTIMAL', btn1: '[ ZOOM TIMESERIES ]', btn2: '[ EXPORT CSV ]' },
            { id: 'models', title: 'MODEL REGISTRY', col: 18, row: 5, labelPos: 'top', role: 'INFERENCE CONTEXT & CAPABILITIES', desc: '上游大模型动态目录与能力矩阵。双正交长柱交叉体，覆盖 Minimax、Claude、GPT 等核心端点，自动标定上下文窗口、视觉与函数调用支持。', spec: 'INTERSECTING PRISMS', spec2: '128K-1M CONTEXT', spec3: 'TOOL CALLING: ACTIVE', btn1: '[ RE-PROBE CAPABILITIES ]', btn2: '[ TEST LATENCY ]' },
            { id: 'packages', title: 'BALANCE ALLOCATION', col: 28, row: 6, labelPos: 'right', role: 'CREDIT LIFECYCLE & DECAY', desc: '积分包容量分布与到期衰减预测模型。二十四面高阶平衡星晶，26 顶点对称构造，按 FIFO 优先级智能调度消耗包，杜绝额度过期浪费。', spec: '26-VERTEX BALANCE CORE', spec2: '30-DAY PROJECTION', spec3: 'EXPIRY RISK: 0%', btn1: '[ SIMULATE RUNTIME ]', btn2: '[ REBALANCE ]' },
            { id: 'logs', title: 'INCIDENT ARCHIVE', col: 6, row: 8, labelPos: 'top', role: 'ANOMALY AUDIT & STACK TRACES', desc: '请求级网关拦截流水与异常堆栈审计。错位滑移断层立方块，结构化追踪网络超时、鉴权阻断与上游熔断记录。', spec: 'SHEARED VOXEL BLOCK', spec2: 'BUFFER: 100 MiB', spec3: 'ERRORS (24H): 0', btn1: '[ TAIL LIVE LOGS ]', btn2: '[ CLEAR ARCHIVE ]' },
            { id: 'encryption', title: 'ENCRYPTION MATRIX', col: 14, row: 8, labelPos: 'top', role: 'HARDWARE CIPHER // KEY VAULT', desc: '高阶星状大斜方截半立方体加密笼架。32 顶点，64 空间交叉棱线，保护管理会话主密码与端到端凭据令牌。', spec: '32-VERTEX STELLATED CAGE', spec2: '64 EDGES HARDENED', spec3: 'CIPHER: AES-GCM-256', btn1: '[ ROTATE CIPHER KEY ]', btn2: '[ PURGE ACCESS ]' },
            { id: 'gateway', title: 'SERVICE DISPATCH', col: 6, row: 10, labelPos: 'top', role: 'LOOPBACK GATEWAY COMPATIBILITY', desc: '横向宽幅扁平长方体通道。对外暴露 /v1/chat/completions 与 /v1/responses，实现零修改无缝接入第三方生态客户端。', spec: 'HORIZONTAL CONDUIT SLAB', spec2: 'PORT: 7863', spec3: 'LATENCY: <1ms', btn1: '[ COPY BASE URL ]', btn2: '[ TEST COMPATIBILITY ]' },
            { id: 'customization', title: 'PERSONALIZATION', col: 28, row: 2, labelPos: 'top', role: 'THEME & ACOUSTIC ENVIRONMENT', desc: '定制工作台环境主题、动态壁纸、专属标语与声景系统。', spec: 'PRISM CHORD / 10 PRESETS', spec2: 'ACOUSTIC AMBIENT: ACTIVE', spec3: 'THEME: DYNAMIC', btn1: '[ RANDOM THEME ]', btn2: '[ RANDOM ASSIGN ]' },
            { id: 'sphere', title: 'CLASSIC SPHERE CORE', col: 13, row: 11, labelPos: 'top', role: 'ORIGINAL HARMONIC GEODESIC SPHERE', desc: '原版最开始非常完美的经典立体纯白球形。三层经纬度空间网格环与 20 个交接顶点小方块，展现经典极客声光谐振。', spec: 'ORIGINAL CLASSIC SPHERE', spec2: '60 FPS SYNCHRONIZED', spec3: 'HARMONIC: ACTIVE', btn1: '[ PULSE WAVE ]', btn2: '[ HARMONIC SWEEP ]' },
            { id: 'scheduler', title: 'KERNEL SCHEDULER', col: 21, row: 10, labelPos: 'bottom', role: 'STELLATED DODECAHEDRON MATRIX', desc: '开普勒小星状十二面体高阶几何。32 个交接顶点、60 条五角星交叉射线，象征十二向并发任务调度与高维系统总线。', spec: '32-VERTEX KEPLER STAR', spec2: '12-WAY CONCURRENCY', spec3: 'BUS: REALTIME 60FPS', btn1: '[ DISPATCH CORE ]', btn2: '[ VIEW TELEMETRY ]' }
        ];

        /* =========================================================================
         * 四周多样化几何悬浮特效系统（严格保证同时间不多于 2 个，渐显 -> 演进 -> 渐隐 -> 异地重现）
         * ========================================================================= */
        // 12 个分布在矩阵四周外围的安全锚点槽位（绝不压盖中间矩阵）
        // 12 个分布在矩阵四周外围的安全锚点槽位（离中心主体更远，视野开阔通透且安全在视口内）
        const PERIPHERY_SLOTS = [
            { id: 'slot-tl-1', offsetX: -0.82, offsetY: -0.48 },
            { id: 'slot-tl-2', offsetX: -0.74, offsetY: -0.26 },
            { id: 'slot-bl-1', offsetX: -0.80, offsetY:  0.25 },
            { id: 'slot-bl-2', offsetX: -0.72, offsetY:  0.50 },
            { id: 'slot-tr-1', offsetX:  0.82, offsetY: -0.46 },
            { id: 'slot-tr-2', offsetX:  0.74, offsetY: -0.24 },
            { id: 'slot-br-1', offsetX:  0.81, offsetY:  0.26 },
            { id: 'slot-br-2', offsetX:  0.72, offsetY:  0.50 },
            { id: 'slot-top-l', offsetX: -0.46, offsetY: -0.64 },
            { id: 'slot-top-r', offsetX:  0.48, offsetY: -0.64 },
            { id: 'slot-bot-l', offsetX: -0.44, offsetY:  0.64 },
            { id: 'slot-bot-r', offsetX:  0.46, offsetY:  0.64 }
        ];

        // 6 种截然不同的几何悬浮特效类型，拒绝单一
        const GEOMETRY_TYPES = [
            'wireframe-octahedron', // 1. 3D 旋转线框八面体 + 顶点脉冲 + 坐标铭牌
            'orbital-gyro',         // 2. 双环反向陀螺仪同心轨道 + 游走卫星点
            'isometric-prism',      // 3. 等轴测立体六棱晶格 + 激光扫描切面
            'constellation-triad',  // 4. 动态三角拓扑测绘网 + 折线游标脉冲
            'rhombus-matrix',       // 5. 四重嵌套呼吸旋转菱形矩阵 + 极坐标刻度
            'helix-caliper'         // 6. 精密游标卡尺框 + 动态双螺旋相位波束
        ];

        const MAX_CONCURRENT_GEOMETRIES = 2;
        let activeFloatingGeometries = [];
        let lastGeoSpawnCheck = 0;
        let lastUsedGeoTypeIndex = -1;

        function updateAndSpawnFloatingGeometries(now) {
            // 移除已结束生命周期的几何悬浮特效
            for (let i = activeFloatingGeometries.length - 1; i >= 0; i--) {
                if (now - activeFloatingGeometries[i].bornTime >= activeFloatingGeometries[i].duration) {
                    activeFloatingGeometries.splice(i, 1);
                }
            }

            // 严格保证同时间不多于 2 个，且错开生成时间
            if (activeFloatingGeometries.length < MAX_CONCURRENT_GEOMETRIES && now - lastGeoSpawnCheck > 950) {
                lastGeoSpawnCheck = now;

                // 挑选当前未被占用的外围位置槽位（且尽量与当前存活的另一个保持较远距离）
                const occupiedSlots = activeFloatingGeometries.map(g => g.slotIdx);
                const availableSlotIndices = [];
                for (let s = 0; s < PERIPHERY_SLOTS.length; s++) {
                    if (!occupiedSlots.includes(s)) {
                        if (occupiedSlots.length > 0) {
                            const otherSlot = PERIPHERY_SLOTS[occupiedSlots[0]];
                            const dist = Math.hypot(
                                PERIPHERY_SLOTS[s].offsetX - otherSlot.offsetX,
                                PERIPHERY_SLOTS[s].offsetY - otherSlot.offsetY
                            );
                            if (dist < 0.55) continue; // 确保两个特效分布在不同方位
                        }
                        availableSlotIndices.push(s);
                    }
                }

                if (availableSlotIndices.length > 0) {
                    const slotIdx = availableSlotIndices[Math.floor(Math.random() * availableSlotIndices.length)];
                    // 轮换不同几何形态，确保不与上一个重复
                    let typeIdx = Math.floor(Math.random() * GEOMETRY_TYPES.length);
                    if (typeIdx === lastUsedGeoTypeIndex) {
                        typeIdx = (typeIdx + 1 + Math.floor(Math.random() * (GEOMETRY_TYPES.length - 1))) % GEOMETRY_TYPES.length;
                    }
                    lastUsedGeoTypeIndex = typeIdx;

                    activeFloatingGeometries.push({
                        slotIdx,
                        type: GEOMETRY_TYPES[typeIdx],
                        bornTime: now,
                        duration: 4200 + Math.random() * 1600, // 4.2s ~ 5.8s 完整渐显->悬浮->渐隐周期
                        seed: Math.random() * 100,
                        codeTag: `[ GEO // 0${typeIdx + 1} ]`
                    });
                }
            }
        }

        // 绘制单个多样化几何悬浮特效（含下方水面对应阴影与倒影）
        function drawFloatingGeometryItem(ctx, item, cx, cy, scale, now, waterLineY, h) {
            const age = now - item.bornTime;
            const p = Math.max(0, Math.min(1, age / item.duration));

            // 平滑渐显 (0~0.22) -> 稳定悬浮 (0.22~0.76) -> 平滑渐隐 (0.76~1.0)
            let envAlpha = 1;
            if (p < 0.22) {
                const u = p / 0.22;
                envAlpha = u * u * (3 - 2 * u);
            } else if (p > 0.76) {
                const u = (1 - p) / 0.24;
                envAlpha = u * u * (3 - 2 * u);
            }

            if (envAlpha <= 0.01) return;

            const tSec = now * 0.001 + item.seed;
            const floatY = Math.sin(tSec * 1.6) * 6 * scale;
            const floatX = Math.cos(tSec * 1.2) * 4 * scale;
            const x = cx + floatX;
            const y = cy + floatY;

            ctx.save();
            ctx.globalAlpha *= envAlpha * 0.88;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = Math.max(0.85, 1.05 * scale);

            const r = 24 * scale;

            if (item.type === 'wireframe-octahedron') {
                // 1. 3D 旋转线框八面体
                const rotY = tSec * 1.15;
                const rotX = 0.45 + Math.sin(tSec * 0.8) * 0.25;
                const rawVerts = [
                    [0, -1.15, 0], [0, 1.15, 0],
                    [-1, 0, 0], [1, 0, 0],
                    [0, 0, -1], [0, 0, 1]
                ];
                const proj = rawVerts.map(([vx, vy, vz]) => {
                    const x1 = vx * Math.cos(rotY) - vz * Math.sin(rotY);
                    const z1 = vx * Math.sin(rotY) + vz * Math.cos(rotY);
                    const y2 = vy * Math.cos(rotX) - z1 * Math.sin(rotX);
                    return [x + x1 * r, y + y2 * r];
                });
                const edges = [
                    [0,2],[0,3],[0,4],[0,5],
                    [1,2],[1,3],[1,4],[1,5],
                    [2,4],[4,3],[3,5],[5,2]
                ];
                ctx.beginPath();
                edges.forEach(([a, b]) => {
                    ctx.moveTo(proj[a][0], proj[a][1]);
                    ctx.lineTo(proj[b][0], proj[b][1]);
                });
                ctx.stroke();

                // 顶点高亮小方块
                proj.forEach(([px, py]) => {
                    ctx.fillRect(px - 1.5 * scale, py - 1.5 * scale, 3 * scale, 3 * scale);
                });
            } else if (item.type === 'orbital-gyro') {
                // 2. 双环陀螺仪同心轨道 + 游走卫星
                ctx.beginPath();
                ctx.arc(x, y, r * 0.95, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                ctx.stroke();

                // 旋转弧段
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
                ctx.beginPath();
                ctx.arc(x, y, r * 0.95, tSec * 1.4, tSec * 1.4 + Math.PI * 0.75);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(x, y, r * 0.62, -tSec * 1.8, -tSec * 1.8 + Math.PI * 1.15);
                ctx.stroke();

                // 椭圆倾斜内环
                ctx.beginPath();
                ctx.ellipse(x, y, r * 0.85, r * 0.34, tSec * 0.7, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
                ctx.stroke();

                // 轨道卫星点
                const satAngle = tSec * 2.2;
                const sx = x + Math.cos(satAngle) * r * 0.95;
                const sy = y + Math.sin(satAngle) * r * 0.95;
                ctx.fillRect(sx - 2.2 * scale, sy - 2.2 * scale, 4.4 * scale, 4.4 * scale);

                // 中心准星
                const cs = 3.5 * scale;
                ctx.beginPath();
                ctx.moveTo(x - cs, y); ctx.lineTo(x + cs, y);
                ctx.moveTo(x, y - cs); ctx.lineTo(x, y + cs);
                ctx.stroke();
            } else if (item.type === 'isometric-prism') {
                // 3. 等轴测多层六棱柱晶格 + 激光扫描切面
                const topY = y - r * 0.55;
                const botY = y + r * 0.55;
                const rx = r * 0.82;
                const ry = r * 0.32;
                const topPts = [];
                const botPts = [];
                for (let k = 0; k < 6; k++) {
                    const ang = tSec * 0.65 + (k * Math.PI) / 3;
                    topPts.push([x + Math.cos(ang) * rx, topY + Math.sin(ang) * ry]);
                    botPts.push([x + Math.cos(ang) * rx, botY + Math.sin(ang) * ry]);
                }

                ctx.beginPath();
                for (let k = 0; k < 6; k++) {
                    const nk = (k + 1) % 6;
                    ctx.moveTo(topPts[k][0], topPts[k][1]);
                    ctx.lineTo(topPts[nk][0], topPts[nk][1]);
                    ctx.moveTo(botPts[k][0], botPts[k][1]);
                    ctx.lineTo(botPts[nk][0], botPts[nk][1]);
                    ctx.moveTo(topPts[k][0], topPts[k][1]);
                    ctx.lineTo(botPts[k][0], botPts[k][1]);
                }
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
                ctx.stroke();

                // 扫描切面层
                const scanRatio = 0.5 + 0.5 * Math.sin(tSec * 2.4);
                const scanY = lerpNum(topY, botY, scanRatio);
                ctx.beginPath();
                for (let k = 0; k < 6; k++) {
                    const ang = tSec * 0.65 + (k * Math.PI) / 3;
                    const px = x + Math.cos(ang) * rx;
                    const py = scanY + Math.sin(ang) * ry;
                    if (k === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.stroke();
            } else if (item.type === 'constellation-triad') {
                // 4. 动态三角拓扑测绘网格 + 游走脉冲包
                const pts = [0, 1, 2].map(idx => {
                    const ang = tSec * 0.55 + idx * ((Math.PI * 2) / 3);
                    const rad = r * (0.85 + 0.2 * Math.sin(tSec * 1.7 + idx));
                    return [x + Math.cos(ang) * rad, y + Math.sin(ang) * rad];
                });

                ctx.beginPath();
                ctx.moveTo(pts[0][0], pts[0][1]);
                ctx.lineTo(pts[1][0], pts[1][1]);
                ctx.lineTo(pts[2][0], pts[2][1]);
                ctx.closePath();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.stroke();

                // 中心重心连线
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
                ctx.beginPath();
                pts.forEach(([px, py]) => {
                    ctx.moveTo(x, y);
                    ctx.lineTo(px, py);
                });
                ctx.stroke();

                // 三个顶点绘制微缩空心框
                const bs = 5.5 * scale;
                pts.forEach(([px, py]) => {
                    ctx.fillStyle = '#050806';
                    ctx.fillRect(px - bs * 0.5, py - bs * 0.5, bs, bs);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
                    ctx.strokeRect(px - bs * 0.5, py - bs * 0.5, bs, bs);
                });

                // 沿三角形边游走的数据亮点
                const edgeProgress = (tSec * 0.9) % 3;
                const edgeIdx = Math.floor(edgeProgress);
                const edgeU = edgeProgress - edgeIdx;
                const pStart = pts[edgeIdx];
                const pEnd = pts[(edgeIdx + 1) % 3];
                const dx = lerpNum(pStart[0], pEnd[0], edgeU);
                const dy = lerpNum(pStart[1], pEnd[1], edgeU);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(dx - 2 * scale, dy - 2 * scale, 4 * scale, 4 * scale);
            } else if (item.type === 'rhombus-matrix') {
                // 5. 四重嵌套旋转菱形矩阵 + 四角括弧
                for (let k = 0; k < 3; k++) {
                    const subR = r * (0.95 - k * 0.28);
                    const rot = (k % 2 === 0 ? 1 : -1) * tSec * (0.7 + k * 0.25) + Math.PI * 0.25;
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(rot);
                    ctx.strokeStyle = `rgba(255, 255, 255, ${(0.88 - k * 0.22).toFixed(2)})`;
                    ctx.strokeRect(-subR * 0.65, -subR * 0.65, subR * 1.3, subR * 1.3);
                    ctx.restore();
                }
                ctx.fillRect(x - 2 * scale, y - 2 * scale, 4 * scale, 4 * scale);
            } else if (item.type === 'helix-caliper') {
                // 6. 精密游标卡尺框 + 动态双螺旋相位波
                const wBox = r * 1.35;
                const hBox = r * 0.75;
                const bl = 5 * scale;
                // 左右卡尺角标
                ctx.beginPath();
                ctx.moveTo(x - wBox + bl, y - hBox); ctx.lineTo(x - wBox, y - hBox); ctx.lineTo(x - wBox, y + hBox); ctx.lineTo(x - wBox + bl, y + hBox);
                ctx.moveTo(x + wBox - bl, y - hBox); ctx.lineTo(x + wBox, y - hBox); ctx.lineTo(x + wBox, y + hBox); ctx.lineTo(x + wBox - bl, y + hBox);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
                ctx.stroke();

                // 双螺旋离散相位节点
                const steps = 9;
                for (let s = 0; s < steps; s++) {
                    const u = (s / (steps - 1)) * 2 - 1;
                    const px = x + u * (wBox - 6 * scale);
                    const waveY1 = y + Math.sin(u * Math.PI * 1.2 + tSec * 2.6) * (hBox * 0.65);
                    const waveY2 = y - Math.sin(u * Math.PI * 1.2 + tSec * 2.6) * (hBox * 0.65);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
                    ctx.beginPath();
                    ctx.moveTo(px, waveY1);
                    ctx.lineTo(px, waveY2);
                    ctx.stroke();

                    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
                    ctx.fillRect(px - 1.5 * scale, waveY1 - 1.5 * scale, 3 * scale, 3 * scale);
                    ctx.fillRect(px - 1.5 * scale, waveY2 - 1.5 * scale, 3 * scale, 3 * scale);
                }
            }

            // 底部微缩技术编号铭牌
            ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
            ctx.font = `${Math.max(8, 8.5 * scale).toFixed(1)}px "JetBrains Mono", monospace`;
            ctx.fillText(item.codeTag, x - r * 0.75, y + r * 1.38);
            ctx.restore();

            // 若位于水面上方，在下方 3/7 水面绘制对应的水面柔和暗影与微弱几何倒影
            const reflY = waterLineY + (waterLineY - y) * 0.48;
            if (reflY > waterLineY && reflY < h) {
                ctx.save();
                ctx.globalAlpha = envAlpha * 0.22;
                // 水面暗影椭圆
                const shGrad = ctx.createRadialGradient(x, reflY, 2, x, reflY, r * 1.2);
                shGrad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
                shGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = shGrad;
                ctx.beginPath();
                ctx.ellipse(x, reflY, r * 1.2, r * 0.35, 0, 0, Math.PI * 2);
                ctx.fill();

                // 水面几何倒影残影
                ctx.strokeStyle = 'rgba(220, 240, 255, 0.45)';
                ctx.lineWidth = 0.8 * scale;
                ctx.strokeRect(x - r * 0.5, reflY - r * 0.16, r, r * 0.32);
                ctx.restore();
            }
        }

        /* =========================================================================
         * 四周多样化随机长几何连线系统
         *  - 突破单一固定直角与正方向限制：支持 45° 倒角斜折、任意斜角折转、直接斜向导轨、阶梯式 S 折线
         *  - 多样化线条视觉：双轨平行导轨、节奏工程虚线、细密刻度游标线、微光实线
         *  - 多样化几何端点：极坐标同心环、45° 菱形微晶、双层精密微框、光学十字、动态 HUD 数据标签
         *  - 随机游走方向：支持正向与反向随机流动，伴随高光脉冲与水面倒影
         *  - 严格保持最少 2 条，最多 3 条，处于边缘与中心主体 1/2 处，避开正上下左右
         * ========================================================================= */
        const PERIPHERY_LONG_LINKS_CONFIG = [
            // ---------------- 偏正上方组 (Top Dominant，分布在正上方两侧开阔带) ----------------
            {
                id: 'link-top-l1',
                quadrant: 'TOP_LEFT',
                from: { offsetX: -0.26, offsetY: -0.74, type: 'polar-ring', tag: '[ RAD // 01 ]' },
                to:   { offsetX: -0.58, offsetY: -0.86, type: 'cross',      tag: '[ DST // 382 ]' },
                routingType: 'CHAMFER', // 45° 倒角斜折线
                bendRatio: 0.52
            },
            {
                id: 'link-top-r1',
                quadrant: 'TOP_RIGHT',
                from: { offsetX:  0.25, offsetY: -0.75, type: 'polar-ring', tag: '[ RAD // 02 ]' },
                to:   { offsetX:  0.58, offsetY: -0.88, type: 'rhombus',    tag: '[ DST // 376 ]' },
                routingType: 'CHAMFER',
                bendRatio: 0.54
            },
            {
                id: 'link-top-span',
                quadrant: 'TOP_SPAN',
                from: { offsetX: -0.18, offsetY: -0.70, type: 'rhombus',    tag: '[ + ]' },
                to:   { offsetX:  0.28, offsetY: -0.85, type: 'double-box', tag: '[ REF // T1 ]' },
                routingType: 'STEPPED', // 阶梯式 S 折线
                bendRatio: 0.50
            },
            {
                id: 'link-top-flank-l',
                quadrant: 'TOP_LEFT',
                from: { offsetX: -0.42, offsetY: -0.68, type: 'double-box', tag: '[ VEC // TL ]' },
                to:   { offsetX: -0.75, offsetY: -0.54, type: 'cross',      tag: '' },
                routingType: 'DIAGONAL_BEND', // 斜向任意角折转
                bendRatio: 0.42
            },
            {
                id: 'link-top-flank-r',
                quadrant: 'TOP_RIGHT',
                from: { offsetX:  0.44, offsetY: -0.68, type: 'mini-box',   tag: '[ + ]' },
                to:   { offsetX:  0.75, offsetY: -0.54, type: 'double-box', tag: '[ REF // TR ]' },
                routingType: 'DIAGONAL_BEND',
                bendRatio: 0.58
            },

            // ---------------- 偏正下方组 (Bottom Dominant，分布在正下方两侧积水带) ----------------
            {
                id: 'link-bot-l1',
                quadrant: 'BOT_LEFT',
                from: { offsetX: -0.25, offsetY:  0.70, type: 'double-box', tag: '[ RAD // 03 ]' },
                to:   { offsetX: -0.56, offsetY:  0.86, type: 'cross',      tag: '[ DST // 364 ]' },
                routingType: 'CHAMFER',
                bendRatio: 0.50
            },
            {
                id: 'link-bot-r1',
                quadrant: 'BOT_RIGHT',
                from: { offsetX:  0.24, offsetY:  0.72, type: 'double-box', tag: '[ RAD // 04 ]' },
                to:   { offsetX:  0.56, offsetY:  0.88, type: 'polar-ring', tag: '[ DST // 371 ]' },
                routingType: 'CHAMFER',
                bendRatio: 0.52
            },
            {
                id: 'link-bot-span',
                quadrant: 'BOT_SPAN',
                from: { offsetX: -0.16, offsetY:  0.68, type: 'rhombus',    tag: '[ + ]' },
                to:   { offsetX:  0.26, offsetY:  0.84, type: 'polar-ring', tag: '[ REF // B1 ]' },
                routingType: 'DIRECT_VECTOR', // 直接斜向导轨 + 中点法线刻度
                bendRatio: 0.50
            },
            {
                id: 'link-bot-flank-l',
                quadrant: 'BOT_LEFT',
                from: { offsetX: -0.42, offsetY:  0.64, type: 'mini-box',   tag: '[ VEC // BL ]' },
                to:   { offsetX: -0.74, offsetY:  0.48, type: 'double-box', tag: '' },
                routingType: 'DIAGONAL_BEND',
                bendRatio: 0.40
            },
            {
                id: 'link-bot-flank-r',
                quadrant: 'BOT_RIGHT',
                from: { offsetX:  0.44, offsetY:  0.64, type: 'double-box', tag: '[ VEC // BR ]' },
                to:   { offsetX:  0.74, offsetY:  0.48, type: 'cross',      tag: '[ + ]' },
                routingType: 'STEPPED',
                bendRatio: 0.50
            }
        ];

        const LINK_LINE_STYLES = ['DUAL_TRACK', 'DASHED_CADENCE', 'TICK_METRIC', 'BEAM_GLOW'];

        const MIN_PERIPHERY_LINKS = 2; // 严格保证最少 2 条
        const MAX_PERIPHERY_LINKS = 3; // 严格保证最多 3 条
        let activePeripheryLinks = [];
        let lastLinkCheckTime = 0;
        let nextLinkSpawnInterval = 1400;

        function updateAndRenderPeripheryLinks(ctx, w, h, gridCenterX, gridCenterY, spanW, spanH, overShiftX, overShiftY, scale, now, waterLineY) {
            // 1. 剔除寿命耗尽的连线
            for (let i = activePeripheryLinks.length - 1; i >= 0; i--) {
                const link = activePeripheryLinks[i];
                if (now - link.bornTime >= link.duration) {
                    activePeripheryLinks.splice(i, 1);
                }
            }

            // 2. 调度生成：严格控制在最少 2 条、最多 3 条之间，充分随机性
            while (activePeripheryLinks.length < MIN_PERIPHERY_LINKS) {
                const occupiedQuadrants = activePeripheryLinks.map(l => l.config.quadrant);
                const candidates = PERIPHERY_LONG_LINKS_CONFIG.filter(c => !occupiedQuadrants.includes(c.quadrant));
                const pool = candidates.length > 0 ? candidates : PERIPHERY_LONG_LINKS_CONFIG;
                const picked = pool[Math.floor(Math.random() * pool.length)];
                
                // 随机决定线条样式、流动方向与微扰比率
                const lineStyle = LINK_LINE_STYLES[Math.floor(Math.random() * LINK_LINE_STYLES.length)];
                const flowDir = Math.random() > 0.5 ? 1 : -1; // 随机流动方向 (正向或反向)
                const bendPerturb = (Math.random() - 0.5) * 0.22; // 随机折角比率偏置

                activePeripheryLinks.push({
                    config: picked,
                    lineStyle,
                    flowDir,
                    bendRatio: Math.max(0.28, Math.min(0.72, (picked.bendRatio || 0.5) + bendPerturb)),
                    bornTime: now - Math.random() * 1800,
                    duration: 4500 + Math.random() * 3400,
                    fadeInRatio: 0.18 + Math.random() * 0.08,
                    fadeOutRatio: 0.18 + Math.random() * 0.08,
                    pulseSpeed: 0.85 + Math.random() * 0.65,
                    seed: Math.random() * 100
                });
            }

            if (activePeripheryLinks.length < MAX_PERIPHERY_LINKS && (now - lastLinkCheckTime > nextLinkSpawnInterval)) {
                lastLinkCheckTime = now;
                nextLinkSpawnInterval = 2000 + Math.random() * 2800;

                if (Math.random() < 0.72) {
                    const occupiedQuadrants = activePeripheryLinks.map(l => l.config.quadrant);
                    const candidates = PERIPHERY_LONG_LINKS_CONFIG.filter(c => !occupiedQuadrants.includes(c.quadrant));
                    const pool = candidates.length > 0 ? candidates : PERIPHERY_LONG_LINKS_CONFIG;
                    if (pool.length > 0) {
                        const picked = pool[Math.floor(Math.random() * pool.length)];
                        const lineStyle = LINK_LINE_STYLES[Math.floor(Math.random() * LINK_LINE_STYLES.length)];
                        const flowDir = Math.random() > 0.5 ? 1 : -1;
                        const bendPerturb = (Math.random() - 0.5) * 0.22;

                        activePeripheryLinks.push({
                            config: picked,
                            lineStyle,
                            flowDir,
                            bendRatio: Math.max(0.28, Math.min(0.72, (picked.bendRatio || 0.5) + bendPerturb)),
                            bornTime: now,
                            duration: 4400 + Math.random() * 3200,
                            fadeInRatio: 0.18 + Math.random() * 0.08,
                            fadeOutRatio: 0.18 + Math.random() * 0.08,
                            pulseSpeed: 0.85 + Math.random() * 0.65,
                            seed: Math.random() * 100
                        });
                    }
                }
            }

            // 3. 计算并绘制每条长连线
            activePeripheryLinks.forEach(link => {
                const age = now - link.bornTime;
                const p = Math.max(0, Math.min(1, age / link.duration));

                let alpha = 1;
                if (p < link.fadeInRatio) {
                    const u = p / link.fadeInRatio;
                    alpha = u * u * (3 - 2 * u);
                } else if (p > 1 - link.fadeOutRatio) {
                    const u = (1 - p) / link.fadeOutRatio;
                    alpha = u * u * (3 - 2 * u);
                }
                if (alpha <= 0.01) return;

                const driftAx = Math.sin(now * 0.0012 + link.seed) * 3.5 * scale;
                const driftAy = Math.cos(now * 0.0015 + link.seed) * 4.0 * scale;
                const driftBx = Math.sin(now * 0.0013 + link.seed + 2.5) * 3.5 * scale;
                const driftBy = Math.cos(now * 0.0016 + link.seed + 2.5) * 4.0 * scale;

                const padX = 40 * scale;
                const padTop = 50 * scale; // 顶部安全边距，避开顶栏控制栏
                const padBot = 45 * scale; // 底部安全边距，避开底栏

                const rawAx = gridCenterX + link.config.from.offsetX * spanW + overShiftX + driftAx;
                const rawAy = gridCenterY + link.config.from.offsetY * spanH + overShiftY + driftAy;
                const rawBx = gridCenterX + link.config.to.offsetX * spanW + overShiftX + driftBx;
                const rawBy = gridCenterY + link.config.to.offsetY * spanH + overShiftY + driftBy;

                const pA = {
                    x: Math.max(padX, Math.min(w - padX, rawAx)),
                    y: Math.max(padTop, Math.min(h - padBot, rawAy))
                };
                const pB = {
                    x: Math.max(padX, Math.min(w - padX, rawBx)),
                    y: Math.max(padTop, Math.min(h - padBot, rawBy))
                };

                // 生成多折点几何路径 (非固定直角、多角度与倒角折线)
                const pathPoints = buildLinkPathPoints(pA, pB, link.config.routingType, link.bendRatio, scale);

                ctx.save();
                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.62).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.8, 1.05 * scale);

                // 根据不同线条视觉风格绘制 (双轨、虚线刻度、游标尺或光束)
                renderStyledPolyline(ctx, pathPoints, link.lineStyle, alpha, scale);

                // 拐角处微缩几何标与连接环
                renderPathJointMarkers(ctx, pathPoints, alpha, scale);

                // 沿折线移动的高光数据脉冲粒子 (方向随机，支持正向或反向游走)
                renderLinkPulseParticles(ctx, pathPoints, age, link.pulseSpeed, link.flowDir, alpha, scale);

                // 绘制两端多样化几何端点 (极坐标同心环、菱形晶体、双层框、十字准星)
                drawPeripheryLinkNode(ctx, pA.x, pA.y, link.config.from, alpha, scale);
                drawPeripheryLinkNode(ctx, pB.x, pB.y, link.config.to, alpha, scale);

                // 水面积水倒影
                if (pathPoints.some(pt => pt.y > waterLineY - 120)) {
                    drawStyledLinkReflection(ctx, pathPoints, link.lineStyle, alpha, scale, waterLineY, h);
                }

                ctx.restore();
            });
        }

        // 构建丰富多样的非直角、斜向与倒角折线路径点
        function buildLinkPathPoints(pA, pB, routingType, bendRatio, scale) {
            const pts = [pA];
            const dx = pB.x - pA.x;
            const dy = pB.y - pA.y;

            if (routingType === 'CHAMFER') {
                // 45° 倒角斜折线：经过两个斜角倒角点，避开纯生硬直角
                const chamferDist = Math.min(28 * scale, Math.min(Math.abs(dx), Math.abs(dy)) * 0.35);
                const midX = pA.x + dx * bendRatio;
                const signX = Math.sign(dx) || 1;
                const signY = Math.sign(dy) || 1;
                pts.push({ x: midX - signX * chamferDist, y: pA.y });
                pts.push({ x: midX, y: pA.y + signY * chamferDist });
                pts.push({ x: midX, y: pB.y - signY * chamferDist });
                pts.push({ x: midX + signX * chamferDist, y: pB.y });
            } else if (routingType === 'DIAGONAL_BEND') {
                // 斜向任意角度钝角/锐角折弯 (拐点位置随机浮动，折角随自然方位延伸)
                const elbowX = pA.x + dx * bendRatio + (Math.sin(bendRatio * 8) * 22 * scale);
                const elbowY = pA.y + dy * (1 - bendRatio) + (Math.cos(bendRatio * 8) * 18 * scale);
                pts.push({ x: elbowX, y: elbowY });
            } else if (routingType === 'DIRECT_VECTOR') {
                // 直接斜向导轨：中间带有法线刻度指示标
                const midPt = { x: (pA.x + pB.x) * 0.5, y: (pA.y + pB.y) * 0.5 };
                pts.push(midPt);
            } else if (routingType === 'STEPPED') {
                // 阶梯式 S 折线：两个折弯点构成的阶梯引线
                const stepX1 = pA.x + dx * 0.40;
                const stepY1 = pA.y + dy * 0.35;
                const stepX2 = pA.x + dx * 0.70;
                const stepY2 = pA.y + dy * 0.65;
                pts.push({ x: stepX1, y: stepY1 });
                pts.push({ x: stepX2, y: stepY2 });
            } else {
                // 斜向折角默认
                pts.push({ x: pB.x, y: pA.y });
            }

            pts.push(pB);
            return pts;
        }

        // 根据艺术风格绘制折线 (双轨平行、节奏虚线点规、齿梳刻度游标、光晕流光)
        function renderStyledPolyline(ctx, pts, style, alpha, scale) {
            if (pts.length < 2) return;

            if (style === 'DUAL_TRACK') {
                // 样式 1：双轨平行导轨线 (两根间距 3px 的平行微线 + 微型联轴标)
                const offset = 2.0 * scale;
                [-offset, offset].forEach(off => {
                    ctx.beginPath();
                    for (let i = 0; i < pts.length; i++) {
                        const pt = pts[i];
                        const ox = pt.x + (i % 2 === 0 ? -off : off) * 0.35;
                        const oy = pt.y + off * 0.7;
                        if (i === 0) ctx.moveTo(ox, oy);
                        else ctx.lineTo(ox, oy);
                    }
                    ctx.stroke();
                });

                // 轨距中段横向微型联轴齿标
                if (pts.length >= 2) {
                    const mX = (pts[0].x + pts[1].x) * 0.5;
                    const mY = (pts[0].y + pts[1].y) * 0.5;
                    ctx.beginPath();
                    ctx.moveTo(mX - 3 * scale, mY - 3 * scale);
                    ctx.lineTo(mX + 3 * scale, mY + 3 * scale);
                    ctx.stroke();
                }
            } else if (style === 'DASHED_CADENCE') {
                // 样式 2：节奏工程虚线刻度
                ctx.save();
                ctx.setLineDash([7 * scale, 3.5 * scale, 2.5 * scale, 3.5 * scale]);
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.stroke();
                ctx.restore();
            } else if (style === 'TICK_METRIC') {
                // 样式 3：游标齿梳测量线 (主线 + 密集等距微刻度线)
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.stroke();

                // 沿主线绘制微型刻度短须
                for (let i = 0; i < pts.length - 1; i++) {
                    const p1 = pts[i];
                    const p2 = pts[i + 1];
                    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    const steps = Math.min(8, Math.floor(segLen / (28 * scale)));
                    const nx = -(p2.y - p1.y) / Math.max(1, segLen);
                    const ny = (p2.x - p1.x) / Math.max(1, segLen);
                    for (let s = 1; s <= steps; s++) {
                        const u = s / (steps + 1);
                        const qx = lerpNum(p1.x, p2.x, u);
                        const qy = lerpNum(p1.y, p2.y, u);
                        const tickLen = (s % 2 === 0 ? 3.5 : 2.0) * scale;
                        ctx.beginPath();
                        ctx.moveTo(qx - nx * tickLen, qy - ny * tickLen);
                        ctx.lineTo(qx + nx * tickLen, qy + ny * tickLen);
                        ctx.stroke();
                    }
                }
            } else {
                // 样式 4：微光流光主线
                ctx.save();
                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.25).toFixed(3)})`;
                ctx.lineWidth = Math.max(1.8, 2.6 * scale);
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.stroke();

                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.88).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.75, 0.95 * scale);
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.stroke();
                ctx.restore();
            }
        }

        // 折角/拐点处微缩十字与环形铰链刻度
        function renderPathJointMarkers(ctx, pts, alpha, scale) {
            for (let i = 1; i < pts.length - 1; i++) {
                const jx = pts[i].x;
                const jy = pts[i].y;
                const crossS = 3.2 * scale;
                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.85).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.75, 0.95 * scale);
                ctx.beginPath();
                ctx.moveTo(jx - crossS, jy); ctx.lineTo(jx + crossS, jy);
                ctx.moveTo(jx, jy - crossS); ctx.lineTo(jx, jy + crossS);
                ctx.stroke();

                // 折角微型同心圆环铰链
                ctx.beginPath();
                ctx.arc(jx, jy, 1.8 * scale, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // 沿折线路径游走移动的数据脉冲粒子 (支持正反向随机流动)
        function renderLinkPulseParticles(ctx, pts, age, speed, flowDir, alpha, scale) {
            if (pts.length < 2) return;

            // 计算整条折线总长度与各段累积长度
            let totalLen = 0;
            const segLens = [];
            for (let i = 0; i < pts.length - 1; i++) {
                const sl = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
                segLens.push(sl);
                totalLen += sl;
            }
            if (totalLen <= 1) return;

            // 根据 flowDir 支持正向从 A->B 或反向从 B->A 流动
            let normProgress = (age * 0.001 * speed) % 1;
            if (flowDir < 0) normProgress = 1 - normProgress;

            const travelDist = normProgress * totalLen;
            const currentPos = interpolatePathAtDistance(pts, segLens, travelDist);

            if (currentPos) {
                // 主脉冲高光方块
                const dSize = 2.8 * scale;
                ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.95).toFixed(3)})`;
                ctx.fillRect(currentPos.x - dSize * 0.5, currentPos.y - dSize * 0.5, dSize, dSize);

                // 伴随微型从属尾随粒子
                const trailDist = Math.max(0, Math.min(totalLen, travelDist - flowDir * 9 * scale));
                const trailPos = interpolatePathAtDistance(pts, segLens, trailDist);
                if (trailPos) {
                    const trailSize = 1.6 * scale;
                    ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.65).toFixed(3)})`;
                    ctx.fillRect(trailPos.x - trailSize * 0.5, trailPos.y - trailSize * 0.5, trailSize, trailSize);
                }
            }
        }

        // 根据折线累积距离插值位置
        function interpolatePathAtDistance(pts, segLens, dist) {
            let acc = 0;
            for (let i = 0; i < segLens.length; i++) {
                const sl = segLens[i];
                if (dist <= acc + sl || i === segLens.length - 1) {
                    const localDist = dist - acc;
                    const u = Math.max(0, Math.min(1, localDist / Math.max(1, sl)));
                    return {
                        x: lerpNum(pts[i].x, pts[i + 1].x, u),
                        y: lerpNum(pts[i].y, pts[i + 1].y, u)
                    };
                }
                acc += sl;
            }
            return pts[pts.length - 1];
        }

        // 绘制端点几何标记 (极坐标同心环、菱形晶体、双层微框、光学十字)
        function drawPeripheryLinkNode(ctx, ax, ay, node, alpha, scale) {
            ctx.save();
            if (node.type === 'polar-ring') {
                // 极坐标同心环刻度
                const r1 = 6.5 * scale;
                const r2 = 3.2 * scale;
                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.88).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.75, 1.0 * scale);
                ctx.beginPath();
                ctx.arc(ax, ay, r1, 0, Math.PI * 2);
                ctx.stroke();

                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.52).toFixed(3)})`;
                ctx.beginPath();
                ctx.arc(ax, ay, r2, 0, Math.PI * 2);
                ctx.stroke();

                // 四向外伸刻度切线
                const cl = 2.4 * scale;
                ctx.beginPath();
                ctx.moveTo(ax - r1 - cl, ay); ctx.lineTo(ax - r1, ay);
                ctx.moveTo(ax + r1, ay); ctx.lineTo(ax + r1 + cl, ay);
                ctx.moveTo(ax, ay - r1 - cl); ctx.lineTo(ax, ay - r1);
                ctx.moveTo(ax, ay + r1); ctx.lineTo(ax, ay + r1 + cl);
                ctx.stroke();

                ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.95).toFixed(3)})`;
                ctx.fillRect(ax - 1 * scale, ay - 1 * scale, 2 * scale, 2 * scale);
            } else if (node.type === 'rhombus') {
                // 45° 旋转菱形微晶体
                const rs = 7.5 * scale;
                ctx.save();
                ctx.translate(ax, ay);
                ctx.rotate(Math.PI * 0.25);
                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.85).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.8, 1.05 * scale);
                ctx.strokeRect(-rs * 0.5, -rs * 0.5, rs, rs);
                ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.9).toFixed(3)})`;
                ctx.fillRect(-1.2 * scale, -1.2 * scale, 2.4 * scale, 2.4 * scale);
                ctx.restore();
            } else if (node.type === 'double-box') {
                // 双层精密微框
                const s = 18 * scale;
                const innerS = 10.5 * scale;
                ctx.fillStyle = `rgba(10, 18, 15, ${(alpha * 0.60).toFixed(3)})`;
                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.86).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.85, 1.1 * scale);
                ctx.fillRect(ax - s * 0.5, ay - s * 0.5, s, s);
                ctx.strokeRect(ax - s * 0.5, ay - s * 0.5, s, s);

                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.50).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.7, 0.9 * scale);
                ctx.strokeRect(ax - innerS * 0.5, ay - innerS * 0.5, innerS, innerS);

                const dotS = 2.2 * scale;
                ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.92).toFixed(3)})`;
                ctx.fillRect(ax - dotS * 0.5, ay - dotS * 0.5, dotS, dotS);
            } else if (node.type === 'mini-box') {
                // 微型刻度方框
                const ms = 7 * scale;
                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.78).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.75, 1 * scale);
                ctx.strokeRect(ax - ms * 0.5, ay - ms * 0.5, ms, ms);
                ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.9).toFixed(3)})`;
                ctx.fillRect(ax - 1.2 * scale, ay - 1.2 * scale, 2.4 * scale, 2.4 * scale);
            } else {
                // cross 十字准星
                const cs = 5 * scale;
                ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.78).toFixed(3)})`;
                ctx.lineWidth = Math.max(0.75, 1 * scale);
                ctx.beginPath();
                ctx.moveTo(ax - cs, ay); ctx.lineTo(ax + cs, ay);
                ctx.moveTo(ax, ay - cs); ctx.lineTo(ax, ay + cs);
                ctx.stroke();

                ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.9).toFixed(3)})`;
                ctx.fillRect(ax - 1 * scale, ay - 1 * scale, 2 * scale, 2 * scale);
            }

            if (node.tag) {
                ctx.font = `${Math.round(8.5 * scale)}px "Space Mono", monospace`;
                ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.68).toFixed(3)})`;
                ctx.fillText(node.tag, ax + 12 * scale, ay + 3 * scale);
            }
            ctx.restore();
        }

        // 绘制多折点连线在积水面的微弱倒影
        function drawStyledLinkReflection(ctx, pts, lineStyle, alpha, scale, waterLineY, h) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, waterLineY, window.innerWidth, h - waterLineY);
            ctx.clip();

            ctx.strokeStyle = `rgba(200, 230, 255, ${(alpha * 0.20).toFixed(3)})`;
            ctx.lineWidth = Math.max(0.7, 0.9 * scale);
            ctx.beginPath();
            for (let i = 0; i < pts.length; i++) {
                const pt = pts[i];
                const ry = waterLineY + (waterLineY - pt.y) * 0.65;
                if (i === 0) ctx.moveTo(pt.x, ry);
                else ctx.lineTo(pt.x, ry);
            }
            ctx.stroke();
            ctx.restore();
        }

        // mainSceneActive hoisted to module top
        let mainEnterTimestamp = 0;
        let gridTiles = [];
        let tileMap = {};
        let hoveredTile = null;

        let gridHighlightWaves = [];
        let lastHighlightWaveTime = -Infinity;
        const POINTER_WAVE_INTERVAL_MS = 180;

        let treeTrunks = [];
        let canopyBranches = [];
        let leafClusters = [];
        let waterRipples = [];
        let fallingRain = [];
        let lastMouseRipplePos = { x: 0, y: 0 };

        /* =========================================================================
         * 点击方块“由中心向四周旋转扩散进入新页面”状态机
         * ========================================================================= */
        const pageTransition = {
            state: 'IDLE', // 'IDLE' | 'EXPANDING_TO_PAGE' | 'IN_PAGE' | 'CONVERGING_TO_GRID'
            startTime: 0,
            durationOut: 1320, // 由中心向四周动效过渡耗时 (ms)
            durationIn: 1050,  // 由四周向中心收敛返回耗时 (ms)
            activeProject: null,
            progress: 0,       // 0 (正常网格) ~ 1 (完全进入新页面)
            transitionType: 'CARD_FLIP', // 'DIFFUSION' (全界面扩散) | 'CARD_FLIP' (牌面翻转)
            clickX: null,
            clickY: null
        };
        let lastPointerX = null;
        let lastPointerY = null;
        window.addEventListener('click', (ev) => {
            lastPointerX = ev.clientX;
            lastPointerY = ev.clientY;
        }, true);

        function isCellInCloudShape(col, row) {
            for (const p of PROJECTS) {
                if (Math.abs(p.col - col) <= 1 && Math.abs(p.row - row) <= 1) return true;
            }
            const nx = (col - (GRID_COLS - 1) * 0.5) / (GRID_COLS * 0.5);
            const ny = (row - (GRID_ROWS - 1) * 0.5) / (GRID_ROWS * 0.5);
            const d = nx * nx * 0.80 + ny * ny * 0.88;
            const hash = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
            const rand = hash - Math.floor(hash);
            if (d < 0.66) return true;
            if (d < 0.96 && rand > 0.24) return true;
            if (d < 1.18 && rand > 0.62) return true;
            return false;
        }

        function rowToNorm(r) {
            return (r - (GRID_ROWS - 1) * 0.5) / (GRID_ROWS * 0.5);
        }

        function generateForestSceneData() {
            treeTrunks = [
                { nx: 0.06, topY: 0.0, botY: 0.58, width: 0.028, lean: 0.04, blur: 3 },
                { nx: 0.15, topY: 0.0, botY: 0.57, width: 0.018, lean: -0.02, blur: 4 },
                { nx: 0.27, topY: 0.0, botY: 0.56, width: 0.012, lean: 0.03, blur: 5 },
                { nx: 0.74, topY: 0.0, botY: 0.56, width: 0.014, lean: -0.03, blur: 5 },
                { nx: 0.85, topY: 0.0, botY: 0.57, width: 0.020, lean: 0.02, blur: 4 },
                { nx: 0.94, topY: 0.0, botY: 0.58, width: 0.032, lean: -0.04, blur: 3 }
            ];

            canopyBranches = [
                { x1: 0.0, y1: 0.08, cx: 0.18, cy: 0.14, x2: 0.36, y2: 0.06, thick: 0.008 },
                { x1: 0.04, y1: 0.22, cx: 0.16, cy: 0.25, x2: 0.29, y2: 0.19, thick: 0.006 },
                { x1: 1.0, y1: 0.07, cx: 0.82, cy: 0.15, x2: 0.62, y2: 0.05, thick: 0.008 },
                { x1: 0.96, y1: 0.24, cx: 0.81, cy: 0.27, x2: 0.68, y2: 0.20, thick: 0.006 },
                { x1: 0.22, y1: 0.0, cx: 0.38, cy: 0.09, x2: 0.52, y2: 0.04, thick: 0.005 },
                { x1: 0.78, y1: 0.0, cx: 0.61, cy: 0.10, x2: 0.46, y2: 0.03, thick: 0.005 }
            ];

            leafClusters = [];
            const totalClusters = 145;
            for (let i = 0; i < totalClusters; i++) {
                const seed = Math.abs(Math.sin(i * 45.23 + 19.1) * 43758.54) % 1;
                const seed2 = Math.abs(Math.cos(i * 17.89 + 7.3) * 23421.67) % 1;
                let nx = seed;
                let ny = seed2 * 0.55;
                if (nx > 0.25 && nx < 0.75 && ny > 0.24) {
                    if (i % 2 === 0) ny *= 0.42;
                    else nx = nx < 0.5 ? nx * 0.5 : 1 - (1 - nx) * 0.5;
                }

                const layer = i < 65 ? 0 : (i < 115 ? 1 : 2);
                leafClusters.push({
                    nx,
                    ny,
                    rx: (layer === 0 ? 0.045 : layer === 1 ? 0.024 : 0.014) * (0.7 + seed * 0.65),
                    ry: (layer === 0 ? 0.028 : layer === 1 ? 0.015 : 0.009) * (0.7 + seed2 * 0.65),
                    angle: (seed - 0.5) * 1.4,
                    hueOffset: (seed - 0.5) * 26,
                    lightOffset: (layer === 2 ? 7 : layer === 1 ? 2 : -4) + (seed2 - 0.5) * 10,
                    alpha: layer === 0 ? 0.32 : layer === 1 ? 0.52 : 0.68,
                    swaySpeed: 0.5 + seed * 0.9,
                    swayAmp: 0.003 + seed2 * 0.005,
                    phase: i * 0.7,
                    layer,
                    subLeaves: 4 + (i % 4)
                });
            }
        }

        function resizeMainWorldCanvas() {
            updateResponsiveScale();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = window.innerWidth;
            const h = window.innerHeight;
            worldCanvas.width = w * dpr;
            worldCanvas.height = h * dpr;
            wCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function initMainWorld() {
            resizeMainWorldCanvas();
            generateForestSceneData();

            const h = window.innerHeight;

            gridTiles = [];
            tileMap = {};
            labelsLayer.innerHTML = '';

            const hintLabel = document.createElement('div');
            hintLabel.id = 'floating-grid-hint';
            hintLabel.className = 'project-dom-label';
            hintLabel.textContent = '[ SELECT A PROJECT TILE TO VISIT ]';
            labelsLayer.appendChild(hintLabel);

            for (let r = 0; r < GRID_ROWS; r++) {
                for (let c = 0; c < GRID_COLS; c++) {
                    if (!isCellInCloudShape(c, r)) continue;
                    const project = PROJECTS.find(p => p.col === c && p.row === r) || null;
                    const normC = (c - (GRID_COLS - 1) * 0.5) / (GRID_COLS * 0.5);
                    const normR = rowToNorm(r);
                    const centerDist = Math.hypot(normC, normR);
                    const radialAngle = Math.atan2(normR, normC);

                    let domLabel = null;
                    if (project) {
                        domLabel = document.createElement('div');
                        domLabel.className = 'project-dom-label cursor-pointer pointer-events-auto';
                        domLabel.textContent = project.title;
                        domLabel.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            pageTransition.clickX = ev.clientX;
                            pageTransition.clickY = ev.clientY;
                            if (pageTransition.state === 'IDLE') {
                                triggerEnterNewPage(project.id);
                            }
                        });
                        labelsLayer.appendChild(domLabel);
                    }

                    const seed = Math.abs(Math.sin(c * 19.19 + r * 73.73) * 43758.5453) % 1;

                    const tile = {
                        c,
                        r,
                        normC,
                        normR,
                        centerDist,
                        radialAngle,
                        project,
                        domLabel,
                        ox: 0,
                        oy: 0,
                        vx: 0,
                        vy: 0,
                        z: 0,
                        vz: 0,
                        targetZ: 0,
                        glow: 0,
                        waveGlow: 0,
                        revealAlpha: 0,
                        phaseOffset: c * 0.42 + r * 0.68 + seed * Math.PI,
                        freqMod: 0.88 + seed * 0.28,
                        spinDir: seed > 0.5 ? 1 : -1,
                        screenX: 0,
                        screenY: 0,
                        stableScreenX: 0,
                        stableScreenY: 0,
                        screenSize: 24,
                        rotAngle: 0,
                        tiltScaleX: 1,
                        tiltScaleY: 1,
                        transAlpha: 1
                    };
                    gridTiles.push(tile);
                    tileMap[`${c}_${r}`] = tile;
                }
            }

            fallingRain = [];
            for (let i = 0; i < 115; i++) {
                fallingRain.push({
                    nx: Math.random(),
                    y: Math.random() * h,
                    len: 15 + Math.random() * 24,
                    speed: 14 + Math.random() * 9,
                    hitRatioY: (4 / 7) + Math.random() * (3 / 7)
                });
            }
        }

        function spawnPondRipple(x, y, maxR = 65, strength = 0.65) {
            if (waterRipples.length > 90) waterRipples.shift();
            waterRipples.push({
                x,
                y,
                r: 2,
                maxR: (maxR + Math.random() * 22) * currentUiScale,
                alpha: strength,
                speed: (1.25 + Math.random() * 0.55) * currentUiScale
            });
        }

        function spawnGridHighlightWave(col, row, intensity = 1.0, isFullScreenNoDecay = false) {
            if (gridHighlightWaves.length > 10) gridHighlightWaves.shift();
            gridHighlightWaves.push({
                col,
                row,
                radius: 0.1,
                maxRadius: isFullScreenNoDecay ? 45.0 : 18.2,
                speed: isFullScreenNoDecay ? 0.38 : 0.11,
                intensity,
                isFullScreenNoDecay
            });
        }

        function disturbGridAtScreenPos(sx, sy, radius = 105, force = 14) {
            if (pageTransition.state !== 'IDLE') return;
            const scaledRadius = radius * currentUiScale;
            let closestTile = null;
            let minDist = Infinity;

            for (let i = 0; i < gridTiles.length; i++) {
                const t = gridTiles[i];
                const dx = t.stableScreenX - sx;
                const dy = t.stableScreenY - sy;
                const d = Math.hypot(dx, dy);
                if (d < minDist) {
                    minDist = d;
                    closestTile = t;
                }
                if (d < scaledRadius && d > 0.001) {
                    const factor = Math.pow(1 - d / scaledRadius, 2);
                    t.vz += force * factor * 0.16;
                    const pushStrength = Math.min(2.0, force * 0.07) * factor;
                    t.vx += (dx / d) * pushStrength + pointer.vx * factor * 0.03;
                    t.vy += (dy / d) * pushStrength + pointer.vy * factor * 0.03;
                    t.glow = Math.min(1, t.glow + factor * 0.85);
                }
            }

            const now = performance.now();
            if (closestTile && minDist < scaledRadius * 0.65 && now - lastHighlightWaveTime >= POINTER_WAVE_INTERVAL_MS) {
                lastHighlightWaveTime = now;
                spawnGridHighlightWave(closestTile.c, closestTile.r, Math.min(1, 0.55 + force * 0.03));
            }
        }

        // 绘制旋转/倾斜方块工具函数（支持点击后由中心向四周 3D 旋转翻转效果）
        function drawTransformedTileQuad(ctx, cx, cy, wSize, hSize, rotRad, drawBevel = false, bevelAlpha = 0, currentScale = 1, isBack = false) {
            if (Math.abs(rotRad) < 0.005 && Math.abs(wSize - hSize) < 0.1 && !isBack) {
                const half = wSize * 0.5;
                ctx.fillRect(cx - half, cy - half, wSize, hSize);
                if (drawBevel && bevelAlpha > 0.01) {
                    const bevelPad = Math.max(1, 1.5 * currentScale);
                    ctx.save();
                    ctx.fillStyle = `rgba(255, 255, 255, ${bevelAlpha.toFixed(3)})`;
                    ctx.beginPath();
                    ctx.moveTo(cx - half + bevelPad, cy - half + bevelPad);
                    ctx.lineTo(cx + half - bevelPad, cy - half + bevelPad);
                    ctx.lineTo(cx - half + bevelPad, cy + half - bevelPad);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
                ctx.strokeRect(cx - half, cy - half, wSize, hSize);
                return;
            }

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(rotRad);
            const hw = wSize * 0.5;
            const hh = hSize * 0.5;

            if (isBack) {
                // 关键修复：牌背保证原有的颜色 (不涂黑)，保留原有天气主题青绿/玉石底色，并叠加高质感晶纹反光
                ctx.fillRect(-hw, -hh, wSize, hSize);

                ctx.save();
                // 牌背微透明反向光泽层
                ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                ctx.fillRect(-hw, -hh, wSize, hSize);

                // 牌背高亮精细微边框
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
                ctx.lineWidth = Math.max(0.85, 1.15 * currentScale);
                ctx.strokeRect(-hw, -hh, wSize, hSize);

                if (wSize > 6 * currentScale) {
                    // 内层精细游标边框
                    const innerPad = Math.max(1.4, 2.0 * currentScale);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                    ctx.lineWidth = Math.max(0.6, 0.8 * currentScale);
                    ctx.strokeRect(-hw + innerPad, -hh + innerPad, wSize - innerPad * 2, hSize - innerPad * 2);

                    // 中心微雕十字
                    const cs = Math.min(hw * 0.45, 3.5 * currentScale);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
                    ctx.beginPath();
                    ctx.moveTo(-cs, 0); ctx.lineTo(cs, 0);
                    ctx.moveTo(0, -cs); ctx.lineTo(0, cs);
                    ctx.stroke();
                }
                ctx.restore();
            } else {
                ctx.fillRect(-hw, -hh, wSize, hSize);
                if (drawBevel && bevelAlpha > 0.01) {
                    const bevelPad = Math.max(1, 1.5 * currentScale);
                    ctx.fillStyle = `rgba(255, 255, 255, ${bevelAlpha.toFixed(3)})`;
                    ctx.beginPath();
                    ctx.moveTo(-hw + bevelPad, -hh + bevelPad);
                    ctx.lineTo(hw - bevelPad, -hh + bevelPad);
                    ctx.lineTo(-hw + bevelPad, hh - bevelPad);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.strokeRect(-hw, -hh, wSize, hSize);
            }
            ctx.restore();
        }

        function drawSemiFocusedFoliage(ctx, w, waterLineY, now, isReflection = false) {
            const [hueMin, hueMax] = blendedTheme.leafHueRange;
            const baseSat = blendedTheme.leafSat;
            const baseLight = blendedTheme.leafLight;

            ctx.save();
            if (isReflection) {
                ctx.beginPath();
                ctx.rect(0, waterLineY, w, window.innerHeight - waterLineY);
                ctx.clip();
                ctx.translate(0, waterLineY * 2);
                ctx.scale(1, -0.76);
                ctx.globalAlpha = 0.42;
            } else {
                ctx.beginPath();
                ctx.rect(0, 0, w, waterLineY + 2);
                ctx.clip();
            }

            const parallaxX = -pointer.smoothX * 16 * currentUiScale;
            const parallaxY = -pointer.smoothY * 9 * currentUiScale;

            const trunkRgb = blendedTheme.skyTop;
            ctx.fillStyle = `rgba(${Math.max(4, trunkRgb[0] - 4)}, ${Math.max(6, trunkRgb[1] - 3)}, ${Math.max(5, trunkRgb[2] - 4)}, 0.72)`;
            for (let i = 0; i < treeTrunks.length; i++) {
                const tr = treeTrunks[i];
                const tx = tr.nx * w + parallaxX * (0.5 + (i % 2) * 0.3);
                const topW = tr.width * w * 0.75;
                const botW = tr.width * w * 1.15;
                const leanOffset = tr.lean * w;

                ctx.beginPath();
                ctx.moveTo(tx - topW * 0.5, tr.topY * waterLineY);
                ctx.lineTo(tx + topW * 0.5, tr.topY * waterLineY);
                ctx.lineTo(tx + leanOffset + botW * 0.5, tr.botY * window.innerHeight);
                ctx.lineTo(tx + leanOffset - botW * 0.5, tr.botY * window.innerHeight);
                ctx.closePath();
                ctx.fill();
            }

            ctx.strokeStyle = `rgba(${Math.max(5, trunkRgb[0] - 2)}, ${Math.max(9, trunkRgb[1])}, ${Math.max(6, trunkRgb[2] - 2)}, 0.65)`;
            ctx.lineCap = 'round';
            for (let i = 0; i < canopyBranches.length; i++) {
                const br = canopyBranches[i];
                ctx.lineWidth = Math.max(2, br.thick * w);
                ctx.beginPath();
                ctx.moveTo(br.x1 * w + parallaxX * 0.7, br.y1 * waterLineY + parallaxY * 0.5);
                ctx.quadraticCurveTo(
                    br.cx * w + parallaxX * 0.7,
                    br.cy * waterLineY + parallaxY * 0.5,
                    br.x2 * w + parallaxX * 0.7,
                    br.y2 * waterLineY + parallaxY * 0.5
                );
                ctx.stroke();
            }

            for (let i = 0; i < leafClusters.length; i++) {
                const lc = leafClusters[i];
                const swayX = Math.sin(now * 0.001 * lc.swaySpeed + lc.phase) * (lc.swayAmp * w);
                const swayY = Math.cos(now * 0.0008 * lc.swaySpeed + lc.phase) * (lc.swayAmp * waterLineY * 0.5);
                const depthFactor = lc.layer === 0 ? 0.45 : lc.layer === 1 ? 0.8 : 1.15;

                const cx = lc.nx * w + swayX + parallaxX * depthFactor;
                const cy = lc.ny * window.innerHeight + swayY + parallaxY * depthFactor;
                const rx = lc.rx * w;
                const ry = lc.ry * window.innerHeight;

                const hue = lerpNum(hueMin, hueMax, 0.5) + lc.hueOffset;
                const sat = Math.max(12, Math.min(68, baseSat + (lc.layer === 2 ? 6 : 0)));
                const light = Math.max(5, Math.min(42, baseLight + lc.lightOffset));

                if (lc.layer === 0) {
                    const grad = ctx.createRadialGradient(cx, cy, rx * 0.1, cx, cy, rx * 1.25);
                    grad.addColorStop(0, `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${lc.alpha})`);
                    grad.addColorStop(0.65, `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${(light * 0.8).toFixed(0)}%, ${(lc.alpha * 0.55).toFixed(3)})`);
                    grad.addColorStop(1, 'transparent');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.ellipse(cx, cy, rx * 1.25, ry * 1.25, lc.angle, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    const coreGrad = ctx.createRadialGradient(cx, cy, rx * 0.15, cx, cy, rx);
                    coreGrad.addColorStop(0, `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${(light + 4).toFixed(0)}%, ${lc.alpha})`);
                    coreGrad.addColorStop(0.72, `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${(lc.alpha * 0.65).toFixed(3)})`);
                    coreGrad.addColorStop(1, 'transparent');
                    ctx.fillStyle = coreGrad;

                    for (let s = 0; s < lc.subLeaves; s++) {
                        const subAngle = lc.angle + (s - lc.subLeaves * 0.5) * 0.48;
                        const offsetDist = rx * 0.28;
                        const lx = cx + Math.cos(subAngle) * offsetDist;
                        const ly = cy + Math.sin(subAngle) * offsetDist * 0.7;
                        ctx.beginPath();
                        ctx.ellipse(lx, ly, rx * 0.68, ry * 0.46, subAngle, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            ctx.restore();
        }

        /* =========================================================================
         * 鼠标悬停防抖保底算法（解决放在方块缝隙或边缘时频繁跳动问题）
         * ========================================================================= */
        function selectStableHoveredTile(now, step, gap) {
            if (!pointer.active || pageTransition.state !== 'IDLE') return null;

            const mouseMoveDist = Math.hypot(pointer.x - pointer.lastHoverLockX, pointer.y - pointer.lastHoverLockY);

            // 保底机制 1：若当前已有锁定方块，给该方块赋予宽裕的“滞回保持区 (Hysteresis Keep-Alive Zone)”
            // 只要鼠标仍在当前方块中心 + 缝隙缓冲半径内，绝不脱锁或跳变到相邻方块
            if (hoveredTile && hoveredTile.revealAlpha > 0.2) {
                const keepAliveHalf = (hoveredTile.screenSize + gap * 1.15) * 0.5;
                const dx = Math.abs(pointer.x - hoveredTile.stableScreenX);
                const dy = Math.abs(pointer.y - hoveredTile.stableScreenY);
                if (dx <= keepAliveHalf && dy <= keepAliveHalf) {
                    return hoveredTile;
                }
            }

            // 保底机制 2：若鼠标几乎静止（放在两条缝隙正中间未移动），保持上一次状态，不因呼吸波产生切换
            if (mouseMoveDist < 2.8 && now - pointer.lastHoverSwitchTime < 260) {
                return hoveredTile;
            }

            // 保底机制 3：寻找距离鼠标最近的稳定基座中心，且必须进入方块“核心有效区 (Inner Core)”才触发新锁定
            let bestCandidate = null;
            let minDist = Infinity;
            const innerCoreHalf = step * 0.44; // 留出缝隙死区缓冲，避免在缝隙正中间摇摆

            for (let i = 0; i < gridTiles.length; i++) {
                const t = gridTiles[i];
                if (t.revealAlpha <= 0.2) continue;
                const dx = Math.abs(pointer.x - t.stableScreenX);
                const dy = Math.abs(pointer.y - t.stableScreenY);
                if (dx <= innerCoreHalf && dy <= innerCoreHalf) {
                    const d = Math.hypot(dx, dy);
                    if (d < minDist) {
                        minDist = d;
                        bestCandidate = t;
                    }
                }
            }

            // 保底机制 4：最小切换冷却时间 (95ms)，彻底杜绝高频帧间震荡
            if (bestCandidate !== hoveredTile) {
                if (now - pointer.lastHoverSwitchTime < 95) {
                    return hoveredTile;
                }
                pointer.lastHoverSwitchTime = now;
                pointer.lastHoverLockX = pointer.x;
                pointer.lastHoverLockY = pointer.y;
                return bestCandidate;
            }

            return hoveredTile;
        }

        /* =========================================================================
         * 核心物理与视觉渲染循环 (60fps)
         * ========================================================================= */
        let mainWorldRafId = null;
        let lastMainWorldNow = 0;

        function renderMainWorld(now) {
            if (mainWorldRafId) {
                cancelAnimationFrame(mainWorldRafId);
                mainWorldRafId = null;
            }
            if (!mainSceneActive) {
                mainWorldRafId = requestAnimationFrame(renderMainWorld);
                return;
            }
            if (!now) now = performance.now();
            if (!lastMainWorldNow) lastMainWorldNow = now;
            const dtMs = Math.min(48, Math.max(8, now - lastMainWorldNow));
            lastMainWorldNow = now;
            const dtScale = dtMs / 16.67;

            stepWeatherBlend();

            const w = window.innerWidth;
            const h = window.innerHeight;
            const elapsedSinceEnter = (now - mainEnterTimestamp) * 0.001;
            const waterLineY = h * (4 / 7);

            const highlightWaveRadius = elapsedSinceEnter * 1.35;
            const envRevealAlpha = Math.max(0, Math.min(1, elapsedSinceEnter / 1.35));

            pointer.smoothX += (pointer.normX - pointer.smoothX) * 0.06;
            pointer.smoothY += (pointer.normY - pointer.smoothY) * 0.06;

            // 更新页面旋转过渡进度 (0 -> 1 或 1 -> 0)
            if (pageTransition.state === 'EXPANDING_TO_PAGE') {
                const u = Math.min(1, (now - pageTransition.startTime) / pageTransition.durationOut);
                pageTransition.progress = u;
                if (u >= 1) {
                    pageTransition.state = 'IN_PAGE';
                    pageTransition.progress = 1;
                }
            } else if (pageTransition.state === 'CONVERGING_TO_GRID') {
                const u = Math.min(1, (now - pageTransition.startTime) / pageTransition.durationIn);
                // 平滑三次缓动，确保方块由新页面收拢回网格时在最后一刻绝对平滑归位
                const smoothU = u * u * (3 - 2 * u);
                pageTransition.progress = 1 - smoothU;
                if (u >= 1) {
                    pageTransition.state = 'IDLE';
                    pageTransition.progress = 0;
                    labelsLayer.style.opacity = '1';
                }
            }

            // 1. 绘制底层背景色与自然天气环境
            wCtx.fillStyle = '#040605';
            wCtx.fillRect(0, 0, w, h);

            if (envRevealAlpha > 0.01) {
                wCtx.save();
                wCtx.globalAlpha = envRevealAlpha;

                const st = blendedTheme.skyTop;
                const sm = blendedTheme.skyMid;
                const hm = blendedTheme.horizonMist;
                const wt = blendedTheme.waterTop;
                const wb = blendedTheme.waterBottom;
                const cl = blendedTheme.canopyLight;
                const wg = blendedTheme.waterSkyGlow;

                // 上方 4/7：森林天空与林间薄雾基底
                const skyGrad = wCtx.createLinearGradient(0, 0, 0, waterLineY);
                skyGrad.addColorStop(0, `rgb(${st[0]|0}, ${st[1]|0}, ${st[2]|0})`);
                skyGrad.addColorStop(0.62, `rgb(${sm[0]|0}, ${sm[1]|0}, ${sm[2]|0})`);
                skyGrad.addColorStop(1, `rgb(${hm[0]|0}, ${hm[1]|0}, ${hm[2]|0})`);
                wCtx.fillStyle = skyGrad;
                wCtx.fillRect(0, 0, w, waterLineY + 2);

                const canopyLightGrad = wCtx.createRadialGradient(
                    w * 0.5 - pointer.smoothX * 22 * currentUiScale,
                    waterLineY * 0.65 - pointer.smoothY * 14 * currentUiScale,
                    15 * currentUiScale,
                    w * 0.5,
                    waterLineY * 0.72,
                    w * 0.48
                );
                canopyLightGrad.addColorStop(0, `rgba(${cl[0]|0}, ${cl[1]|0}, ${cl[2]|0}, 0.34)`);
                canopyLightGrad.addColorStop(0.5, `rgba(${hm[0]|0}, ${hm[1]|0}, ${hm[2]|0}, 0.16)`);
                canopyLightGrad.addColorStop(1, 'transparent');
                wCtx.fillStyle = canopyLightGrad;
                wCtx.fillRect(0, 0, w, waterLineY + 2);

                drawSemiFocusedFoliage(wCtx, w, waterLineY, now, false);

                // 下方 3/7：积水区域基底与上方树冠镜像倒影
                const waterGrad = wCtx.createLinearGradient(0, waterLineY, 0, h);
                waterGrad.addColorStop(0, `rgb(${wt[0]|0}, ${wt[1]|0}, ${wt[2]|0})`);
                waterGrad.addColorStop(0.45, `rgb(${((wt[0]+wb[0])*0.5)|0}, ${((wt[1]+wb[1])*0.5)|0}, ${((wt[2]+wb[2])*0.5)|0})`);
                waterGrad.addColorStop(1, `rgb(${wb[0]|0}, ${wb[1]|0}, ${wb[2]|0})`);
                wCtx.fillStyle = waterGrad;
                wCtx.fillRect(0, waterLineY, w, h - waterLineY);

                drawSemiFocusedFoliage(wCtx, w, waterLineY, now, true);

                const pondGlow = wCtx.createRadialGradient(
                    w * 0.5 + pointer.smoothX * 15 * currentUiScale,
                    waterLineY + (h - waterLineY) * 0.52,
                    15 * currentUiScale,
                    w * 0.5,
                    waterLineY + (h - waterLineY) * 0.48,
                    w * 0.45
                );
                pondGlow.addColorStop(0, `rgba(${wg[0]|0}, ${wg[1]|0}, ${wg[2]|0}, 0.34)`);
                pondGlow.addColorStop(0.5, `rgba(${wg[0]|0}, ${wg[1]|0}, ${wg[2]|0}, 0.14)`);
                pondGlow.addColorStop(1, 'transparent');
                wCtx.fillStyle = pondGlow;
                wCtx.fillRect(0, waterLineY, w, h - waterLineY);

                const shoreMist = wCtx.createLinearGradient(0, waterLineY - 22 * currentUiScale, 0, waterLineY + 28 * currentUiScale);
                shoreMist.addColorStop(0, 'transparent');
                shoreMist.addColorStop(0.48, `rgba(${cl[0]|0}, ${cl[1]|0}, ${cl[2]|0}, 0.16)`);
                shoreMist.addColorStop(0.52, `rgba(${wg[0]|0}, ${wg[1]|0}, ${wg[2]|0}, 0.22)`);
                shoreMist.addColorStop(1, 'transparent');
                wCtx.fillStyle = shoreMist;
                wCtx.fillRect(0, waterLineY - 22 * currentUiScale, w, 50 * currentUiScale);

                wCtx.strokeStyle = `rgba(${wg[0]|0}, ${wg[1]|0}, ${wg[2]|0}, 0.08)`;
                wCtx.lineWidth = 1;
                for (let wy = waterLineY + 8; wy < h; wy += 14 * currentUiScale) {
                    const waveOffset = Math.sin(wy * 0.08 + now * 0.002) * 18 * currentUiScale;
                    const lineLen = (60 + ((wy * 13) % 110)) * currentUiScale;
                    const lx = ((wy * 73) % w) + waveOffset;
                    wCtx.beginPath();
                    wCtx.moveTo(lx - lineLen * 0.5, wy);
                    wCtx.lineTo(lx + lineLen * 0.5, wy);
                    wCtx.stroke();
                }

                const vignette = wCtx.createRadialGradient(w * 0.5, h * 0.5, w * 0.24, w * 0.5, h * 0.5, w * 0.72);
                vignette.addColorStop(0, 'transparent');
                vignette.addColorStop(1, 'rgba(3, 5, 4, 0.74)');
                wCtx.fillStyle = vignette;
                wCtx.fillRect(0, 0, w, h);

                wCtx.restore();
            }

            // -----------------------------------------------------------------
            // 2. 物理网格、中心向外旋转扩散过渡、以及稳定防抖碰撞计算
            // -----------------------------------------------------------------
            const totalGridSpan = Math.min(w * 0.64, h * 1.12);
            const step = Math.max(14, totalGridSpan / GRID_COLS);
            const gap = Math.max(3.5, step * 0.24);
            const baseCellSize = step - gap;

            const gridCenterX = w * 0.5;
            const gridCenterY = waterLineY - (GRID_ROWS * 0.30) * step;

            const mouseSpeed = Math.hypot(pointer.vx, pointer.vy);
            if (pointer.active && mouseSpeed > 0.45 && pageTransition.state === 'IDLE') {
                disturbGridAtScreenPos(pointer.x, pointer.y, step * 3.6, Math.min(20, mouseSpeed * 0.85));

                const distMoved = Math.hypot(pointer.x - lastMouseRipplePos.x, pointer.y - lastMouseRipplePos.y);
                if (distMoved > 18 * currentUiScale) {
                    lastMouseRipplePos.x = pointer.x;
                    lastMouseRipplePos.y = pointer.y;
                    const rippleY = pointer.y >= waterLineY
                        ? pointer.y
                        : waterLineY + (waterLineY - pointer.y) * 0.45;
                    if (rippleY >= waterLineY && rippleY <= h) {
                        spawnPondRipple(
                            pointer.x,
                            rippleY,
                            pointer.y >= waterLineY ? 58 : 38,
                            pointer.y >= waterLineY ? 0.62 : 0.35
                        );
                    }
                }
            }
            pointer.vx *= 0.85;
            pointer.vy *= 0.85;

            for (let wIdx = gridHighlightWaves.length - 1; wIdx >= 0; wIdx--) {
                const hw = gridHighlightWaves[wIdx];
                hw.radius += hw.speed;
                if (hw.isFullScreenNoDecay) {
                    if (hw.radius > hw.maxRadius) {
                        gridHighlightWaves.splice(wIdx, 1);
                    }
                } else {
                    hw.intensity *= 0.962;
                    if (hw.radius > hw.maxRadius || hw.intensity < 0.03) {
                        gridHighlightWaves.splice(wIdx, 1);
                    }
                }
            }

            const rotY = pointer.smoothX * 0.14;
            const rotX = -pointer.smoothY * 0.11;
            const fov = 900 * currentUiScale;

            // 更新每个方块的弹簧物理、稳定基座坐标、以及“由中心向四周旋转”过渡矩阵
            for (let i = 0; i < gridTiles.length; i++) {
                const t = gridTiles[i];

                const waveDiff = highlightWaveRadius - t.centerDist;
                if (waveDiff >= 0) {
                    t.revealAlpha = Math.min(1, t.revealAlpha + 0.08);
                    if (waveDiff < 0.26) {
                        const pulse = Math.sin((waveDiff / 0.26) * Math.PI);
                        t.glow = Math.max(t.glow, pulse * 0.95);
                        t.vz += pulse * 1.5;
                        t.vx += Math.cos(t.phaseOffset) * pulse * 0.45;
                        t.vy += Math.sin(t.phaseOffset) * pulse * 0.45;
                    }
                }

                let waveBoost = 0;
                for (let wIdx = 0; wIdx < gridHighlightWaves.length; wIdx++) {
                    const hw = gridHighlightWaves[wIdx];
                    const gridDist = Math.hypot(t.c - hw.col, t.r - hw.row);
                    const ringDelta = Math.abs(gridDist - hw.radius);
                    const ringWidth = 1.65;
                    if (ringDelta < ringWidth) {
                        const ringProfile = Math.cos((ringDelta / ringWidth) * (Math.PI * 0.5));
                        const waveDecay = hw.isFullScreenNoDecay ? 1.0 : Math.max(0, 1 - hw.radius / hw.maxRadius);
                        waveBoost = Math.max(waveBoost, ringProfile * hw.intensity * waveDecay);
                    }
                }
                t.waveGlow = Math.max(t.waveGlow * 0.88, waveBoost);

                const timeSec = now * 0.001 * t.freqMod;
                const breathWaveZ =
                    Math.sin(timeSec * 2.1 + t.c * 0.34 + t.r * 0.27) * 5.6 +
                    Math.cos(timeSec * 1.5 - t.c * 0.22 + t.r * 0.45) * 4.0;

                const targetWaveX =
                    Math.sin(timeSec * 1.7 + t.phaseOffset) * 1.8 +
                    Math.cos(timeSec * 1.1 + t.r * 0.55) * 1.0;
                const targetWaveY =
                    Math.cos(timeSec * 1.6 + t.phaseOffset * 0.9) * 1.8 +
                    Math.sin(timeSec * 1.2 + t.c * 0.42) * 1.0;

                const springKZ = 0.11;
                const dampingZ = 0.85;
                t.vz = (t.vz + (t.targetZ + t.waveGlow * 8.5 + breathWaveZ - t.z) * springKZ) * dampingZ;
                t.z += t.vz;

                const springKXY = 0.095;
                const dampingXY = 0.84;
                t.vx = (t.vx + (targetWaveX - t.ox) * springKXY) * dampingXY;
                t.vy = (t.vy + (targetWaveY - t.oy) * springKXY) * dampingXY;
                t.ox += t.vx;
                t.oy += t.vy;

                const maxSway = gap * 0.42;
                t.ox = Math.max(-maxSway, Math.min(maxSway, t.ox));
                t.oy = Math.max(-maxSway, Math.min(maxSway, t.oy));

                t.glow *= 0.91;

                // A. 计算不受 Z 轴跳动与微摇摆影响的“稳定基座投影坐标” (用于防抖碰撞检测)
                const baseLocalX = (t.c - (GRID_COLS - 1) * 0.5) * step;
                const baseLocalY = (t.r - (GRID_ROWS - 1) * 0.5) * step;
                const basePx = baseLocalX * Math.cos(rotY);
                const basePy = baseLocalY * Math.cos(rotX);
                const basePz = baseLocalX * Math.sin(rotY) - baseLocalY * Math.sin(rotX);
                const baseScale = fov / Math.max(100, fov - basePz);
                t.stableScreenX = gridCenterX + basePx * baseScale;
                t.stableScreenY = gridCenterY + basePy * baseScale;

                // B. 计算含弹簧与“由中心向四周旋转扩散动效”的真实渲染坐标
                let localX = baseLocalX + t.ox * currentUiScale;
                let localY = baseLocalY + t.oy * currentUiScale;
                let zScaled = t.z * currentUiScale;

                t.rotAngle = 0;
                t.tiltScaleX = 1;
                t.tiltScaleY = 1;
                t.transAlpha = 1;
                t.isBackFace = false;

                if (pageTransition.progress > 0.001) {
                    // 关键动效：由中心 (centerDist = 0) 向四周 (centerDist = 1.3) 依次触发翻转或扩散
                    const oCol = (typeof pageTransition.originCol === 'number') ? pageTransition.originCol : (GRID_COLS - 1) * 0.5;
                    const oRow = (typeof pageTransition.originRow === 'number') ? pageTransition.originRow : (GRID_ROWS - 1) * 0.5;
                    const relDist = Math.hypot((t.c - oCol) / (GRID_COLS * 0.5), (t.r - oRow) / (GRID_ROWS * 0.5));
                    const delay = Math.min(0.52, relDist * 0.40);
                    const localP = Math.max(0, Math.min(1, (pageTransition.progress - delay) / (1 - delay)));
                    // 三次缓动曲线
                    const easeP = localP < 0.5
                        ? 4 * localP * localP * localP
                        : 1 - Math.pow(-2 * localP + 2, 3) / 2;

                    if (pageTransition.transitionType === 'CARD_FLIP') {
                        // ================= 牌面翻转效果 (Card Flip Wave) =================
                        const waveLift = Math.sin(easeP * Math.PI);
                        const slightSpread = 1 + easeP * (0.24 + t.centerDist * 0.14);
                        localX *= slightSpread;
                        localY *= slightSpread;
                        const flipAngle = easeP * Math.PI;
                        const cosFlip = Math.cos(flipAngle);
                        t.rotAngle = t.phaseOffset * 0.14 * Math.sin(easeP * Math.PI);
                        t.tiltScaleX = Math.max(0.04, Math.abs(cosFlip));
                        t.tiltScaleY = 1.0 + waveLift * 0.18;
                        t.isBackFace = (cosFlip < 0);
                        zScaled += waveLift * 65 * currentUiScale + easeP * 28 * currentUiScale;
                        t.glow = Math.max(t.glow, waveLift * 0.95);
                        t.transAlpha = Math.max(0.06, 1 - Math.pow(easeP, 2.4) * 0.90);
                    } else if (pageTransition.transitionType === 'DIFFUSION') {
                        // ================= 全界面扩散效果 (Vortex & Radial Diffusion) =================
                        const vortexAngle = easeP * 1.25;
                        const radialPush = 1 + easeP * (1.85 + t.centerDist * 1.15);
                        const cosV = Math.cos(vortexAngle);
                        const sinV = Math.sin(vortexAngle);
                        const rx = (localX * cosV - localY * sinV) * radialPush;
                        const ry = (localX * sinV + localY * cosV) * radialPush;
                        localX = rx;
                        localY = ry;
                        t.rotAngle = easeP * Math.PI * 2.25 * t.spinDir + t.phaseOffset * 0.2 * easeP;
                        t.tiltScaleX = Math.max(0.22, Math.abs(Math.cos(easeP * Math.PI * 1.5)));
                        t.tiltScaleY = Math.max(0.22, Math.abs(Math.cos(easeP * Math.PI * 1.1)));
                        zScaled += Math.sin(easeP * Math.PI) * 140 * currentUiScale + easeP * 95 * currentUiScale;
                        t.glow = Math.max(t.glow, Math.sin(easeP * Math.PI) * 0.95);
                        t.transAlpha = Math.max(0.06, 1 - easeP * 0.88);
                    } else {
                        // ================= 粒子消散效果 (PARTICLE_DISPERSE：由中心向四周波浪扩散，方块化为密集颗粒、东北偏东随风柔和消散变稀疏) =================
                        const pDelay = Math.min(0.48, t.centerDist * 0.38);
                        const pLocal = Math.max(0, Math.min(1, (pageTransition.progress - pDelay) / (1 - pDelay)));

                        if (pageTransition.state === 'EXPANDING_TO_PAGE' || pageTransition.state === 'IN_PAGE') {
                            if (pLocal > 0 && pLocal < 0.08) {
                                // 波前刚触达时微泛柔白微光呼吸，随即原地化为密集点阵颗粒
                                t.glow = Math.max(t.glow, 0.88);
                            }
                            if (pLocal >= 0.045 && !t._disintegrated && pageTransition.state === 'EXPANDING_TO_PAGE') {
                                t._disintegrated = true;
                                spawnTileParticlesGentleWind(t, blendedTheme, baseCellSize * baseScale);
                            }
                            // 方块实体在原地自然切换为密集点阵粒子，随后由微风拂过吹散消隐
                            t.transAlpha = pLocal < 0.035 ? 1 : Math.max(0, 1 - (pLocal - 0.035) / 0.085);
                        } else {
                            // 粒子返回矩阵时：粒子还在空中汇聚时方块实体隐形，粒子落位凝结瞬间 (progress < 0.16) 方块结晶显现
                            const returnProgress = 1 - pageTransition.progress; // 0 (刚点返回) ~ 1 (完全回到网格)
                            if (returnProgress < 0.78) {
                                t.transAlpha = 0;
                            } else {
                                const settleProg = (returnProgress - 0.78) / 0.22;
                                t.transAlpha = Math.min(1, settleProg);
                                t.glow = Math.max(t.glow, Math.sin(settleProg * Math.PI) * 0.85);
                            }
                        }
                    }
                }

                const px = localX * Math.cos(rotY) - zScaled * Math.sin(rotY);
                const py = localY * Math.cos(rotX) + zScaled * Math.sin(rotX);
                const pz = localX * Math.sin(rotY) - localY * Math.sin(rotX) + zScaled;
                const scale = fov / Math.max(100, fov - pz);

                t.screenX = gridCenterX + px * scale;
                t.screenY = gridCenterY + py * scale;
                t.screenSize = baseCellSize * scale;
            }

            // 执行带保底防抖机制的悬停检测
            const newHoveredTile = selectStableHoveredTile(now, step, gap);

            for (let i = 0; i < gridTiles.length; i++) {
                gridTiles[i].targetZ = (gridTiles[i] === newHoveredTile) ? 18 : 0;
            }

            if (newHoveredTile) {
                newHoveredTile.glow = Math.min(1, newHoveredTile.glow + 0.42);
            }

            if (newHoveredTile && newHoveredTile !== hoveredTile) {
                hoveredTile = newHoveredTile;
                soundscape.triggerTileNote(hoveredTile.c + hoveredTile.r * 3);
                if (now - lastHighlightWaveTime >= POINTER_WAVE_INTERVAL_MS) {
                    lastHighlightWaveTime = now;
                    spawnGridHighlightWave(hoveredTile.c, hoveredTile.r, 1.0);
                }

                const reflRippleY = Math.min(h - 12, waterLineY + 24 * currentUiScale + (GRID_ROWS - hoveredTile.r) * step * 0.42);
                spawnPondRipple(
                    hoveredTile.screenX + (Math.random() - 0.5) * 20 * currentUiScale,
                    reflRippleY,
                    hoveredTile.project ? 72 : 45,
                    0.58
                );
                worldCanvas.style.cursor = hoveredTile.project ? 'pointer' : 'crosshair';

                const hintEl = document.getElementById('hover-sound-status');
                if (hoveredTile.project && hintEl) {
                    scrambleText(hintEl, `[ CLICK TO ENTER // ${hoveredTile.project.title} ]`, 240);
                } else if (hintEl && hintEl.textContent !== '[ HOVER TO GENERATE SOUNDS ]') {
                    scrambleText(hintEl, '[ HOVER TO GENERATE SOUNDS ]', 240);
                }
            } else if (!newHoveredTile && hoveredTile) {
                hoveredTile = null;
                worldCanvas.style.cursor = 'default';
            }

            if (hoveredTile && pageTransition.state === 'IDLE') {
                for (let i = 0; i < gridTiles.length; i++) {
                    const t = gridTiles[i];
                    const gDist = Math.hypot(t.c - hoveredTile.c, t.r - hoveredTile.r);
                    if (gDist < 4.2) {
                        const halo = Math.pow(1 - gDist / 4.2, 1.8) * 0.62;
                        t.glow = Math.max(t.glow, halo);
                    }
                }
            }

            // -----------------------------------------------------------------
            // 3. 绘制下方 3/7 积水区域的【水面阴影 (Water Shadow)】与【3D 旋转透视倒影】
            // -----------------------------------------------------------------
            wCtx.save();
            wCtx.beginPath();
            wCtx.rect(0, waterLineY, w, h - waterLineY);
            wCtx.clip();

            const wg = blendedTheme.waterSkyGlow;
            const shRgb = blendedTheme.waterShadowRgb;

            // 3A. 绘制整体网格在水面投射的环境软阴影底盘（随旋转扩散动态消散）
            const cloudShadowAlpha = (1 - pageTransition.progress * 0.85) * envRevealAlpha * 0.42;
            if (cloudShadowAlpha > 0.01) {
                const shadowCenterY = waterLineY + (GRID_ROWS * 0.35) * step;
                const shadowRadiusX = (GRID_COLS * 0.48) * step * (1 + pageTransition.progress * 0.6);
                const shadowRadiusY = (GRID_ROWS * 0.34) * step * (1 + pageTransition.progress * 0.4);
                const bulkShadowGrad = wCtx.createRadialGradient(
                    gridCenterX, shadowCenterY, shadowRadiusY * 0.1,
                    gridCenterX, shadowCenterY, shadowRadiusX
                );
                bulkShadowGrad.addColorStop(0, `rgba(${shRgb[0]|0}, ${shRgb[1]|0}, ${shRgb[2]|0}, ${cloudShadowAlpha.toFixed(3)})`);
                bulkShadowGrad.addColorStop(0.65, `rgba(${shRgb[0]|0}, ${shRgb[1]|0}, ${shRgb[2]|0}, ${(cloudShadowAlpha * 0.45).toFixed(3)})`);
                bulkShadowGrad.addColorStop(1, 'transparent');
                wCtx.fillStyle = bulkShadowGrad;
                wCtx.beginPath();
                wCtx.ellipse(gridCenterX, shadowCenterY, shadowRadiusX, shadowRadiusY, 0, 0, Math.PI * 2);
                wCtx.fill();
            }

            // 3B. 逐方块绘制【独立水面阴影 (Umbra Shadow)】与【水面旋转镜面倒影】
            for (let i = 0; i < gridTiles.length; i++) {
                const t = gridTiles[i];
                if (t.revealAlpha <= 0.02) continue;

                const totalTileGlow = Math.min(1, t.glow + t.waveGlow * 0.85);
                const distFromBottomRow = (GRID_ROWS - 1 - t.r) + 0.65;
                const perspectiveDepth = distFromBottomRow * step * 0.56;
                const spreadFactor = 1 + distFromBottomRow * 0.062;

                const waterWaveX = Math.sin(now * 0.004 + t.r * 0.9 + t.c * 0.3) * (2.5 + distFromBottomRow * 0.75) * currentUiScale;
                const reflX = gridCenterX + (t.screenX - gridCenterX) * spreadFactor + waterWaveX;
                const reflY = waterLineY + 14 * currentUiScale + perspectiveDepth + (t.z * 0.22 + t.oy * 0.35) * currentUiScale;

                const reflW = t.screenSize * spreadFactor * t.tiltScaleX;
                const reflH = t.screenSize * 0.44 * t.tiltScaleY;

                const depthFade = Math.max(0, 1 - distFromBottomRow / (GRID_ROWS + 1.8));
                const baseAlpha = t.revealAlpha * t.transAlpha * depthFade;

                if (baseAlpha > 0.01) {
                    // 1) 绘制方块正下方的水面投射暗影（当方块旋转升起或扩散时，阴影偏移拉大并柔化）
                    const heightFactor = Math.max(0, t.z / 45) + pageTransition.progress * 0.8;
                    const shadowOffsetX = (8 + heightFactor * 14) * currentUiScale;
                    const shadowOffsetY = (5 + heightFactor * 9) * currentUiScale;
                    const shadowScale = 1.15 + heightFactor * 0.35;
                    const shadowAlpha = Math.max(0.03, baseAlpha * (0.48 - Math.min(0.32, heightFactor * 0.22)));

                    wCtx.fillStyle = `rgba(${shRgb[0]|0}, ${shRgb[1]|0}, ${shRgb[2]|0}, ${shadowAlpha.toFixed(3)})`;
                    wCtx.strokeStyle = 'transparent';
                    drawTransformedTileQuad(
                        wCtx,
                        reflX + shadowOffsetX,
                        reflY + shadowOffsetY,
                        reflW * shadowScale,
                        reflH * shadowScale,
                        -t.rotAngle * 0.65,
                        false,
                        0,
                        currentUiScale
                    );

                    // 2) 绘制方块在水面的旋转高光折射倒影
                    const reflAlpha = baseAlpha * (0.24 + totalTileGlow * 0.48);
                    wCtx.fillStyle = `rgba(${wg[0]|0}, ${wg[1]|0}, ${wg[2]|0}, ${(reflAlpha * 0.50).toFixed(3)})`;
                    wCtx.strokeStyle = `rgba(240, 248, 255, ${Math.min(0.95, reflAlpha * 1.15).toFixed(3)})`;
                    wCtx.lineWidth = Math.max(0.7, 0.9 * currentUiScale);
                    drawTransformedTileQuad(
                        wCtx,
                        reflX,
                        reflY,
                        reflW,
                        reflH,
                        -t.rotAngle,
                        false,
                        0,
                        currentUiScale,
                        t.isBackFace || false
                    );
                }
            }
            wCtx.restore();

            // -----------------------------------------------------------------
            // 4. 绘制下落雨丝与下方 3/7 积水区域的透视涟漪
            // -----------------------------------------------------------------
            if (envRevealAlpha > 0.1) {
                wCtx.save();
                wCtx.globalAlpha = envRevealAlpha;

                wCtx.strokeStyle = blendedTheme.rainColor;
                wCtx.lineWidth = Math.max(0.8, 1 * currentUiScale);
                for (let i = 0; i < fallingRain.length; i++) {
                    const drop = fallingRain[i];
                    const dx = drop.nx * w;
                    const hitY = drop.hitRatioY * h;
                    wCtx.beginPath();
                    wCtx.moveTo(dx, drop.y);
                    wCtx.lineTo(dx - 1.5 * currentUiScale, drop.y + drop.len * currentUiScale);
                    wCtx.stroke();

                    drop.y += drop.speed * currentUiScale * dtScale;
                    drop.nx -= 0.00025 * dtScale;
                    if (drop.nx < 0) drop.nx += 1;

                    if (drop.y >= hitY) {
                        if (Math.random() < 0.35) {
                            spawnPondRipple(dx, hitY, 24 + Math.random() * 40, 0.46);
                        }
                        drop.y = -25;
                        drop.nx = Math.random();
                        drop.hitRatioY = (4 / 7) + Math.random() * (3 / 7);
                    }
                }

                const rc = blendedTheme.rippleColor;
                for (let i = waterRipples.length - 1; i >= 0; i--) {
                    const rp = waterRipples[i];
                    rp.r += rp.speed;
                    rp.alpha *= 0.978;

                    if (rp.y >= waterLineY - 4) {
                        wCtx.beginPath();
                        wCtx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.25, 0, 0, Math.PI * 2);
                        wCtx.strokeStyle = `rgba(${rc[0]|0}, ${rc[1]|0}, ${rc[2]|0}, ${rp.alpha.toFixed(3)})`;
                        wCtx.lineWidth = Math.max(0.8, 1.05 * currentUiScale);
                        wCtx.stroke();

                        if (rp.r > 14 * currentUiScale) {
                            wCtx.beginPath();
                            wCtx.ellipse(rp.x, rp.y, rp.r * 0.58, rp.r * 0.15, 0, 0, Math.PI * 2);
                            wCtx.strokeStyle = `rgba(${rc[0]|0}, ${rc[1]|0}, ${rc[2]|0}, ${(rp.alpha * 0.42).toFixed(3)})`;
                            wCtx.stroke();
                        }
                    }

                    if (rp.alpha < 0.018 || rp.r > rp.maxR) {
                        waterRipples.splice(i, 1);
                    }
                }
                wCtx.restore();
            }

            // -----------------------------------------------------------------
            // 5. 绘制主体全息折射网格单元（支持中心向四周 3D 旋转翻转扩散）
            // -----------------------------------------------------------------
            for (let i = 0; i < gridTiles.length; i++) {
                const t = gridTiles[i];
                const effectiveAlpha = t.revealAlpha * t.transAlpha;
                if (effectiveAlpha <= 0.01) continue;

                const x = t.screenX;
                const y = t.screenY;
                const wSize = t.screenSize * t.tiltScaleX;
                const hSize = t.screenSize * t.tiltScaleY;
                const half = t.screenSize * 0.5;
                const combinedGlow = Math.min(1, t.glow + t.waveGlow * 0.92);

                const causticWave =
                    Math.sin(t.c * 0.35 - now * 0.0022 + t.z * 0.09) *
                    Math.cos(t.r * 0.45 + now * 0.0017);
                const centerProximity = Math.max(0, 1 - t.centerDist * 0.9);
                const hue = blendedTheme.tileBaseHue + causticWave * blendedTheme.tileHueSpread + t.normC * 16;
                const sat = blendedTheme.tileSat + centerProximity * 30;
                const light = 46 + centerProximity * 30 + combinedGlow * 24;
                const fillAlpha = Math.min(0.94, effectiveAlpha * (0.28 + centerProximity * 0.36 + combinedGlow * 0.38));

                const borderAlpha = Math.min(1, effectiveAlpha * (t.project ? 0.98 : 0.48 + centerProximity * 0.30 + combinedGlow * 0.50));
                const bevelAlpha = Math.min(0.62, effectiveAlpha * (0.11 + centerProximity * 0.12 + combinedGlow * 0.34));

                wCtx.fillStyle = `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${fillAlpha.toFixed(3)})`;
                wCtx.strokeStyle = `rgba(255, 255, 255, ${borderAlpha.toFixed(3)})`;
                wCtx.lineWidth = (t.project ? 1.4 : 1.0) * Math.max(0.75, currentUiScale);

                drawTransformedTileQuad(
                    wCtx,
                    x,
                    y,
                    wSize,
                    hSize,
                    t.rotAngle,
                    centerProximity > 0.12 || combinedGlow > 0.04,
                    bevelAlpha,
                    currentUiScale,
                    t.isBackFace || false
                );

                // 方块内部中心圆点
                const dotAlpha = Math.min(1, effectiveAlpha * (0.55 + centerProximity * 0.22 + combinedGlow * 0.45));
                const dotHalf = (1.2 + combinedGlow * 0.7) * Math.max(0.75, currentUiScale);
                wCtx.fillStyle = `rgba(255, 255, 255, ${dotAlpha.toFixed(3)})`;
                wCtx.fillRect(x - dotHalf, y - dotHalf, dotHalf * 2, dotHalf * 2);

                // 项目节点双层嵌套高亮方框与自适应标签定位
                if (t.project) {
                    const innerW = wSize * 0.64;
                    const innerH = hSize * 0.64;
                    wCtx.fillStyle = 'transparent';
                    wCtx.strokeStyle = `rgba(255, 255, 255, ${(effectiveAlpha * 0.96).toFixed(3)})`;
                    wCtx.lineWidth = 1.15 * Math.max(0.75, currentUiScale);
                    drawTransformedTileQuad(wCtx, x, y, innerW, innerH, t.rotAngle, false, 0, currentUiScale);

                    if (t.domLabel) {
                        const labelAlpha = effectiveAlpha * Math.max(0, 1 - pageTransition.progress * 2.2);
                        t.domLabel.style.opacity = labelAlpha.toFixed(2);
                        t.domLabel.style.fontSize = `${Math.max(8, 10 * currentUiScale).toFixed(1)}px`;
                        if (hoveredTile === t) {
                            t.domLabel.classList.add('hovered');
                        } else {
                            t.domLabel.classList.remove('hovered');
                        }

                        const labelOffset = 11 * currentUiScale;
                        if (t.project.labelPos === 'top') {
                            t.domLabel.style.left = `${x}px`;
                            t.domLabel.style.top = `${y - half - labelOffset}px`;
                            t.domLabel.style.transform = 'translate(-50%, -50%)';
                        } else if (t.project.labelPos === 'bottom') {
                            t.domLabel.style.left = `${x}px`;
                            t.domLabel.style.top = `${y + half + labelOffset + 1}px`;
                            t.domLabel.style.transform = 'translate(-50%, -50%)';
                        } else if (t.project.labelPos === 'right') {
                            t.domLabel.style.left = `${x + half + labelOffset}px`;
                            t.domLabel.style.top = `${y}px`;
                            t.domLabel.style.transform = 'translate(0%, -50%)';
                        }
                    }
                }
            }

            // -----------------------------------------------------------------
            // 6. 四周多样化几何悬浮特效（严格同时间不多于 2 个，渐显 -> 悬浮 -> 渐隐 -> 异地出现）
            // -----------------------------------------------------------------
            if (elapsedSinceEnter > 0.6) {
                updateAndSpawnFloatingGeometries(now);

                const overShiftX = -pointer.smoothX * 24 * currentUiScale;
                const overShiftY = -pointer.smoothY * 16 * currentUiScale;
                const cloudHalfW = (GRID_COLS * 0.5) * step;
                const cloudHalfH = (GRID_ROWS * 0.5) * step;
                // 1. 几何图案稍微离中心主体远一些 (增加外推跨度倍率，并保障在视口安全范围内)
                const peripherySpanW = Math.max(cloudHalfW * 1.62, w * 0.48);
                const peripherySpanH = Math.max(cloudHalfH * 1.66, h * 0.42);

                const marginEdge = 42 * currentUiScale;
                for (let i = 0; i < activeFloatingGeometries.length; i++) {
                    const item = activeFloatingGeometries[i];
                    const slot = PERIPHERY_SLOTS[item.slotIdx];
                    const rawGx = gridCenterX + slot.offsetX * peripherySpanW + overShiftX;
                    const rawGy = gridCenterY + slot.offsetY * peripherySpanH + overShiftY;
                    const gx = Math.max(marginEdge, Math.min(w - marginEdge, rawGx));
                    const gy = Math.max(marginEdge, Math.min(h - marginEdge, rawGy));
                    drawFloatingGeometryItem(wCtx, item, gx, gy, currentUiScale, now, waterLineY, h);
                }

                // 2. 绘制四周不规律动态长几何连线系统 (范围偏正上下分布，离中心更远，最少2条最多3条，定时出现与消失)
                // 采用专门的连线出线外推跨度，将线条充分推向偏正上与偏正下开阔空间
                const linksSpanW = Math.max(cloudHalfW * 1.68, w * 0.50);
                const linksSpanH = Math.max(cloudHalfH * 1.85, h * 0.48);
                updateAndRenderPeripheryLinks(wCtx, w, h, gridCenterX, gridCenterY, linksSpanW, linksSpanH, overShiftX, overShiftY, currentUiScale, now, waterLineY);
            }

            // 更新并绘制转场粒子流 (中心向四周波浪扩散，方块化为一颗颗粒子向左逐渐消散)
            updateAndRenderDisperseParticles(wCtx, waterLineY, h, now);

            // 更新右上角 `[ SELECT A PROJECT TILE TO VISIT ]` 引导文字的 3D 跟随位置
            const hintEl = document.getElementById('floating-grid-hint');
            const topRightTile = tileMap['24_0'] || tileMap['21_1'];
            if (hintEl && topRightTile) {
                const hintAlpha = Math.min(1, elapsedSinceEnter * 0.8) * Math.max(0, 1 - pageTransition.progress * 2.5);
                hintEl.style.opacity = hintAlpha.toFixed(2);
                hintEl.style.fontSize = `${Math.max(8, 10 * currentUiScale).toFixed(1)}px`;
                hintEl.style.left = `${topRightTile.screenX + baseCellSize * 0.9}px`;
                hintEl.style.top = `${topRightTile.screenY - baseCellSize * 2.55}px`;
                hintEl.style.transform = 'translate(-50%, -50%)';
            }

            mainWorldRafId = requestAnimationFrame(renderMainWorld);
        }

        /* =========================================================================
         * 7. WorkBuddy 大留白画廊数据层 + 原装 12 尊立体几何框内纯虚线变形引擎
         * ========================================================================= */
        const projectPageView = document.getElementById('project-page-view');
        const previewCanvas = document.getElementById('project-preview-canvas');
        const pCtx = previewCanvas.getContext('2d');

        // 高分屏与整体放大缩小清晰抗锯齿初始化（保持逻辑尺寸 320x320 不变）
        const PREVIEW_LOGICAL_SIZE = 320;
        function setupCrispPreviewCanvas() {
            const effectiveScale = Math.max(1, currentPageScale || 1);
            const dpr = Math.min((window.devicePixelRatio || 1) * effectiveScale, 3);
            previewCanvas.width = Math.round(PREVIEW_LOGICAL_SIZE * dpr);
            previewCanvas.height = Math.round(PREVIEW_LOGICAL_SIZE * dpr);
            pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        // Comment 1: 底部三段式按钮专用设置器（固定括号不动，仅在定宽中间槽位内等长解码，零闪烁）
        function stripBtnBrackets(raw) {
            return String(raw || '').replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim();
        }
        function scrambleActionButton(btnEl, rawTarget, duration = 220) {
            if (!btnEl) return;
            const core = stripBtnBrackets(rawTarget);
            btnEl.setAttribute('data-scramble', core);
            const midEl = btnEl.querySelector('.btn-mid');
            if (!midEl) {
                scrambleText(btnEl, rawTarget, duration);
                return;
            }
            clearInterval(midEl._scrambleTimer);
            if (duration <= 0) {
                midEl.textContent = core;
                return;
            }
            const len = core.length;
            let step = 0;
            const totalSteps = Math.max(6, Math.floor(duration / 25));
            midEl._scrambleTimer = setInterval(() => {
                step++;
                const progress = step / totalSteps;
                let out = '';
                for (let i = 0; i < len; i++) {
                    const ch = core[i];
                    if (ch === ' ' || ch === '/' || ch === '-' || ch === '+') {
                        out += ch;
                    } else if (i < Math.floor(progress * len)) {
                        out += ch;
                    } else {
                        out += GLITCH_CHARS[(i * 11 + step * 5) % 36];
                    }
                }
                midEl.textContent = out;
                if (step >= totalSteps) {
                    clearInterval(midEl._scrambleTimer);
                    midEl.textContent = core;
                }
            }, 25);
        }
        setupCrispPreviewCanvas();

        const CHAPTER_META = {
            overview:   { num: '01', navKey: 'overview',   geoId: 'overview',   geoLabel: 'OBELISK',        title: 'SYSTEM OVERVIEW',    cn: '系统概览', role: 'CORE ENGINE // HEALTH & TOPOLOGY',    desc: '汇总本地网关运行健康度、凭据池可用率与实时资源吞吐状态。', btn1: '[ RESOURCE CURVE ]', btn2: '[ COPY ENDPOINT ]' },
            accounts:   { num: '02', navKey: 'accounts',   geoId: 'accounts',   geoLabel: 'VAULT CUBE',     title: 'IDENTITY VAULT',     cn: '账号池',   role: 'MULTI-ACCOUNT POOL & SAFEGUARDS',     desc: '整号余额低于阈值自动退池保护，支持单号独占绑定独立出口节点。', btn1: '[ ADD ACCOUNT ]',   btn2: '[ REFRESH POOL ]' },
            egress:     { num: '03', navKey: 'egress',     geoId: 'egress',     geoLabel: 'DIAMOND',        title: 'NETWORK EGRESS',     cn: '账号出口', role: 'MIHOMO KERNEL // BANDWIDTH & NODES',  desc: '按启用订阅隔离展示出口节点、绑定账号归属与实时测速状态。', btn1: '[ REFRESH ALL ]',   btn2: '[ + IMPORT SUBSCRIPTION ]' },
            models:     { num: '04', navKey: 'models',     geoId: 'models',     geoLabel: 'CROSS PRISMS',   title: 'MODEL REGISTRY',     cn: '模型查看', role: 'UPSTREAM DIRECTORY & CONTEXT SPEC',   desc: '清爽呈现可用大模型名称、上下文容量、输出上限与实时首字响应延迟。', btn1: '[ FETCH MODELS ]',   btn2: '[ FILTER REALM ]' },
            tasks:      { num: '05', navKey: 'tasks',      geoId: 'tasks',      geoLabel: 'CROSS FRAME',    title: 'AUTOMATION RUNS',    cn: '账号任务', role: 'SCHEDULED PIPELINE & MUTEX GUARD',    desc: '按序执行每日活跃上报、访问令牌续期、猫猫旅行状态与每日定时签到四道工序。', btn1: '[ RUN PIPELINE ]',   btn2: '[ PAUSE TASKS ]' },
            usage:      { num: '06', navKey: 'usage',      geoId: 'usage',      geoLabel: 'ZIGGURAT',       title: 'TELEMETRY USAGE',    cn: '积分用量', role: 'DUAL-TRACK TOKEN TIMESERIES',         desc: '追踪 24H 周期内分时段 Token 吞吐趋势，支持 6H/24H 时序跨度与按模型排行视图。', btn1: '[ MODEL RANK ]',     btn2: '[ TIME: 6H ]' },
            packages:   { num: '07', navKey: 'packages',   geoId: 'packages',   geoLabel: 'BALANCE STAR',   title: 'BALANCE ALLOCATION', cn: '积分构成', role: 'PER-ACCOUNT PACKAGES & FIFO DECAY',   desc: '按账号独立归档多笔生效积分包，支持逐号翻页检视消耗顺位与全局临期分布。', btn1: '[ EXPIRY MODEL ]',   btn2: '[ SORT: EXPIRY ]' },
            logs:       { num: '08', navKey: 'logs',       geoId: 'logs',       geoLabel: 'SHEARED CUBE',   title: 'INCIDENT ARCHIVE',   cn: '错误记录', role: 'ANOMALY TRACE & HAWKES INTENSITY',    desc: '分页归档网关层拦截的限流与上游异常记录，支持切换时间与错误量数学模型。', btn1: '[ ERROR MODEL ]',    btn2: '[ EXPORT LOGS ]' },
            encryption: { num: '09', navKey: 'encryption', geoId: 'encryption', geoLabel: 'CIPHER CAGE',    title: 'SYSTEM CONFIG',      cn: '系统设置', role: 'ACCESS CIPHER & SAFEGUARD POLICY',    desc: '维护工作台访问密码、低额退池阈值、订阅刷新周期以及全局 JSON 配置备份。', btn1: '[ SAVE CONFIG ]',    btn2: '[ LOG OUT ]' },
            gateway:    { num: '01', navKey: 'overview',   geoId: 'gateway',    geoLabel: 'CONDUIT SLAB',   title: 'SERVICE DISPATCH',   cn: '网关通道', role: 'LOOPBACK COMPATIBILITY ENDPOINT',     desc: '对外提供标准兼容接口 /v1/chat/completions 与 /v1/responses，支持客户端直连。', btn1: '[ RESOURCE CURVE ]', btn2: '[ COPY ENDPOINT ]' },
            customization: { num: '10', navKey: 'customization', geoId: 'customization', geoLabel: 'PRISM CHORD', title: 'PERSONALIZATION', cn: '个性化', role: 'THEME & ACOUSTIC ENVIRONMENT', desc: '定制工作台环境主题、动态壁纸、专属标语与声景系统。', btn1: '[ RANDOM THEME ]', btn2: '[ RANDOM ASSIGN ]' },
            sphere:     { num: '00', navKey: 'sphere',     geoId: 'sphere',     geoLabel: 'CLASSIC SPHERE', title: 'CLASSIC SPHERE',     cn: '谐振核心', role: 'ORIGINAL GEODESIC HARMONIC CORE',     desc: '保留初始三层经纬空间网格环与 20 枚交接锚定节点，同步反映本地网关运行声光状态。', btn1: '[ CHECK UPDATE ]',   btn2: '[ RETURN MATRIX ]' },
            scheduler:  { num: '05', navKey: 'tasks',      geoId: 'scheduler',  geoLabel: 'KEPLER STAR',    title: 'KERNEL SCHEDULER',   cn: '并发调度', role: 'STELLATED DODECAHEDRON BUS',          desc: '十二向并发维护任务调度总线，与四步定时巡检流水线共享并发互斥锁与暂停控制。', btn1: '[ RUN PIPELINE ]',   btn2: '[ PAUSE TASKS ]' }
        };

        
    function getBeijingCurrentHour() {
        try {
            const str = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
            const h = parseInt(str, 10);
            if (Number.isFinite(h)) return h;
        } catch (_) {}
        return (new Date().getUTCHours() + 8) % 24;
    }

    // 积分用量时间轴截止位：按照用户明确规范，严格锚定真实北京时间“后一位”（当前小时 + 1）作为时段结算截止点
    function getBeijingUsageTargetHour() {
        return getBeijingCurrentHour();
    }

        const WBState = {
            currentChapter: 'overview',
            overrideSphere: false,
            isGlobalSpinning: false,
            spinTimer: null,
            hoveredVertexIdx: -1,
            hoveredTag: '',
            lastChartRevealAt: 0,
            chartClipSeq: 0,

            overviewMode: (typeof localStorage !== 'undefined' && localStorage.getItem('wb_overview_mode')) || 'TRAFFIC', // 'TRAFFIC' | 'RESOURCE'
            uptimeSec: 412929,
            coreVersion: '3.0.1',
            goroutines: 34,
            memMb: 48.2,
            cpuPct: 14.6,
            cpuHistory: [12.4, 15.1, 13.8, 18.2, 16.5, 14.0, 13.2, 19.4, 17.1, 15.0, 16.8, 14.2, 15.9, 14.6],
            memHistory: [46.0, 46.4, 46.8, 47.5, 48.1, 47.9, 47.6, 48.8, 48.5, 48.0, 48.4, 48.1, 48.3, 48.2],

            accountFilter: (typeof localStorage !== 'undefined' && localStorage.getItem('wb_account_filter')) || 'ALL',
            accountPage: 0,
            selectedAccountUid: null,
            accountNodePage: 0,
            accountSubmode: null, // null | 'LOGIN' | 'IMPORT'
            loginRealm: 'CN',
            loginAuthUrls: { CN: '', GLOBAL: '' },
            loginStates: { CN: '', GLOBAL: '' },
            ingestMode: 'OAUTH',
            loginAuthUrl: 'https://auth.workbuddy.cn/oauth/device?user_code=WB-89F2-K41A',
            systemDefaultNode: '',
            systemDefaultNodeName: '',
            pickingDefaultEgress: false,
            selectingSystemDefault: false,
            accountNodeSortMode: (typeof localStorage !== 'undefined' && localStorage.getItem('wb_account_node_sort_mode')) || 'LATENCY',

            egressTab: (typeof localStorage !== 'undefined' && localStorage.getItem('wb_egress_tab')) || 'NODES',
            egressPage: 0,
            egressSubPage: (typeof localStorage !== 'undefined' && parseInt(localStorage.getItem('wb_egress_sub_page') || '0', 10)) || 0,
            activeSubId: (typeof localStorage !== 'undefined' && localStorage.getItem('wb_active_sub_id')) || 'SUB-01', // Comment 5: 当前启用展示节点的订阅源
            importingSub: false,
            downMbps: 26.4,
            upMbps: 1.48,
            downHistory: [19.2, 21.8, 20.4, 24.6, 27.1, 25.3, 23.0, 28.4, 26.9, 24.2, 27.8, 25.6, 29.1, 26.4],
            upHistory:   [1.12, 1.25, 1.18, 1.42, 1.60, 1.38, 1.29, 1.72, 1.54, 1.35, 1.64, 1.41, 1.78, 1.48],

            modelPage: 0,
            modelRealmFilter: 'ALL', // 'ALL' | 'CN' | 'GLOBAL'
            modelCacheHot: true,

            usageRange: '24H',
            usageView: 'CURVE', // 'CURVE' | 'RANK'
            usageHoverIdx: -1,
            usageModelPage: 0,

            packageView: 'ACCOUNTS', // 'ACCOUNTS' | 'EXPIRY' | 'MODEL'
            packageExpiringOnly: false,
            packageSort: 'EXPIRY', // 'EXPIRY' | 'ACCOUNT'
            packageAccountPage: 0,
            selectedPackageUid: null,
            packageDetailPage: 0,
            packageModelHoverIdx: -1,
            egressProbed: false,

            logPage: 0,
            logView: 'LIST', // 'LIST' | 'MODEL' (Comment 17)
            logModelHoverIdx: -1,
            logFilterCode: 'ALL', // 'ALL' | '429' | '401' | '5XX'
            selectedLogId: null,

            configThreshold: 100,
            configCacheHours: 48,
            configTransition: 'AUTO',

            customization: {
                currentTab: 'music', // 'music' | 'slogan' | 'theme'
                isAdding: false,
                randomMusic: false,
                activeMusicId: 'm-default',
                musicList: [
                    { id: 'm-default', date: '2026-10-24 12:00', name: 'Canopy Ambient // 默认雨林氛围音', isDefault: true, url: '' },
                ],
                randomMotto: false,
                activeSloganId: (typeof localStorage !== 'undefined' && localStorage.getItem('wb_active_slogan_id')) || 's-1',
                sloganList: (() => {
                    try {
                        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('wb_slogan_list') : null;
                        if (raw) {
                            const list = JSON.parse(raw);
                            if (Array.isArray(list) && list.length > 0) return list;
                        }
                    } catch (_) {}
                    return [
                        { id: 's-1', date: '2026-10-24 12:00', name: 'SILENT ARCHITECTURE', text: 'SILENT ARCHITECTURE // 静默架构 · 跨域协议中继与多租户网关' },
                    ];
                })(),
                randomTheme: false,
                activeTheme: (typeof localStorage !== 'undefined' && localStorage.getItem('wb_active_theme')) || 'overcast',
                themeList: [
                    { id: 'overcast', name: 'OVERCAST // 阴天极简' },
                    { id: 'dusk',     name: 'DUSK // 黄昏微光' },
                    { id: 'night',    name: 'NIGHT // 深邃极夜' }
                ]
            },

            // 12 个账号严格遵循 1 账号独占绑定 1 出口节点
            accounts: [
                {
                    uid: '#7890ab', name: 'Primary-01', region: 'CN', balance: 4280, quota: 5000, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '—', manualOn: true, forceOverride: false, egress: 'HK-BGP-01',
                    packages: [
                        { id: 'P-78-1', name: '每日签到激励包', remain: 180, total: 200, days: 4 },
                        { id: 'P-78-2', name: '猫猫旅行探索包', remain: 400, total: 500, days: 9 },
                        { id: 'P-78-3', name: '月度优先体验包', remain: 1200, total: 1500, days: 18 },
                        { id: 'P-78-4', name: '标准配额包', remain: 1500, total: 1800, days: 26 },
                        { id: 'P-78-5', name: '季度长效储备包', remain: 1000, total: 1000, days: 82 }
                    ]
                },
                {
                    uid: '#3f92c1', name: 'Enterprise-A', region: 'GLOBAL', balance: 0, quota: 0, unlimited: true,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '—', manualOn: false, forceOverride: false, egress: 'SG-IEPL-01',
                    packages: [
                        { id: 'P-3F-1', name: '企业无上限主约包', remain: 99999, total: 99999, days: 180 },
                        { id: 'P-3F-2', name: '跨区并发加速包', remain: 5000, total: 5000, days: 60 }
                    ]
                },
                {
                    uid: '#a41e88', name: 'Studio-Node', region: 'CN', balance: 82, quota: 2000, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '18:20:11', manualOn: true, forceOverride: false, egress: 'HK-BGP-02',
                    packages: [
                        { id: 'P-A4-1', name: '每日签到激励包', remain: 32, total: 200, days: 2 },
                        { id: 'P-A4-2', name: '活动补偿体验包', remain: 50, total: 800, days: 11 },
                        { id: 'P-A4-3', name: '基础算力包', remain: 0, total: 1000, days: 21 }
                    ]
                },
                {
                    uid: '#90d14b', name: 'Burst-Worker', region: 'GLOBAL', balance: 1940, quota: 3000, unlimited: false,
                    state: 'COOLING', coolSec: 38, breakerAt: '19:54:12', degradeAt: '19:41:05', manualOn: true, forceOverride: false, egress: 'JP-TYO-01',
                    packages: [
                        { id: 'P-90-1', name: '海外节点周度包', remain: 240, total: 500, days: 5 },
                        { id: 'P-90-2', name: '标准算力包', remain: 900, total: 1500, days: 19 },
                        { id: 'P-90-3', name: '开发者扩容礼盒', remain: 800, total: 1000, days: 45 },
                        { id: 'P-90-4', name: '签到连击加成包', remain: 0, total: 200, days: 12 }
                    ]
                },
                {
                    uid: '#55c02e', name: 'Reserve-02', region: 'CN', balance: 3610, quota: 5000, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '—', manualOn: false, forceOverride: false, egress: 'HK-IEPL-03',
                    packages: [
                        { id: 'P-55-1', name: '每日签到激励包', remain: 210, total: 300, days: 6 },
                        { id: 'P-55-2', name: '猫猫旅行远征包', remain: 600, total: 700, days: 14 },
                        { id: 'P-55-3', name: '标准配额包', remain: 1300, total: 2000, days: 24 },
                        { id: 'P-55-4', name: '团队共享扩容包', remain: 1500, total: 2000, days: 68 }
                    ]
                },
                {
                    uid: '#d82b71', name: 'Relay-Alpha', region: 'GLOBAL', balance: 64, quota: 1500, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '16:08:49', manualOn: true, forceOverride: false, egress: 'US-SJC-01',
                    packages: [
                        { id: 'P-D8-1', name: '轻量试用额度包', remain: 64, total: 500, days: 3 },
                        { id: 'P-D8-2', name: '国际配额包', remain: 0, total: 1000, days: 16 }
                    ]
                },
                {
                    uid: '#19fa63', name: 'Core-Pool-07', region: 'CN', balance: 4890, quota: 5000, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '—', manualOn: true, forceOverride: false, egress: 'TW-TPE-01',
                    packages: [
                        { id: 'P-19-1', name: '每日签到激励包', remain: 190, total: 200, days: 7 },
                        { id: 'P-19-2', name: '猫猫旅行奇遇包', remain: 500, total: 500, days: 15 },
                        { id: 'P-19-3', name: '高校认证专享包', remain: 2200, total: 2300, days: 42 },
                        { id: 'P-19-4', name: '年度基础算力包', remain: 2000, total: 2000, days: 145 }
                    ]
                },
                {
                    uid: '#6b44e0', name: 'Edge-Relay', region: 'GLOBAL', balance: 2740, quota: 4000, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '15:42:03', manualOn: true, forceOverride: false, egress: 'JP-TYO-02',
                    packages: [
                        { id: 'P-6B-1', name: '国际周度签到包', remain: 340, total: 500, days: 8 },
                        { id: 'P-6B-2', name: '国际标准包', remain: 1400, total: 2000, days: 22 },
                        { id: 'P-6B-3', name: '季度稳定储备包', remain: 1000, total: 1500, days: 74 }
                    ]
                },
                {
                    uid: '#c17a39', name: 'Core-Pool-09', region: 'CN', balance: 3120, quota: 4000, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '—', manualOn: true, forceOverride: false, egress: 'KR-ICN-01',
                    packages: [
                        { id: 'P-C1-1', name: '每日签到激励包', remain: 120, total: 200, days: 5 },
                        { id: 'P-C1-2', name: '标准配额包', remain: 1500, total: 1800, days: 20 },
                        { id: 'P-C1-3', name: '季度算力扩容包', remain: 1500, total: 2000, days: 58 }
                    ]
                },
                {
                    uid: '#84e510', name: 'Audit-Hold', region: 'GLOBAL', balance: 1420, quota: 3000, unlimited: false,
                    state: 'BLOCKED', coolSec: 0, breakerAt: '17:15:30', degradeAt: '—', manualOn: true, forceOverride: false, egress: 'US-LAX-01',
                    packages: [
                        { id: 'P-84-1', name: '国际基础包', remain: 420, total: 1000, days: 12 },
                        { id: 'P-84-2', name: '备用算力包', remain: 1000, total: 2000, days: 64 }
                    ]
                },
                {
                    uid: '#2d9b77', name: 'Core-Pool-11', region: 'CN', balance: 4510, quota: 5000, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '—', manualOn: true, forceOverride: false, egress: 'SG-IEPL-02',
                    packages: [
                        { id: 'P-2D-1', name: '猫猫旅行满载包', remain: 510, total: 600, days: 10 },
                        { id: 'P-2D-2', name: '标准配额包', remain: 2000, total: 2400, days: 25 },
                        { id: 'P-2D-3', name: '年度长效储备包', remain: 2000, total: 2000, days: 210 }
                    ]
                },
                {
                    uid: '#f0632a', name: 'Core-Pool-12', region: 'GLOBAL', balance: 3880, quota: 5000, unlimited: false,
                    state: 'HEALTHY', coolSec: 0, breakerAt: '—', degradeAt: '—', manualOn: true, forceOverride: false, egress: 'DE-FRA-01',
                    packages: [
                        { id: 'P-F0-1', name: '国际优先体验包', remain: 380, total: 500, days: 6 },
                        { id: 'P-F0-2', name: '国际月度包', remain: 1500, total: 2500, days: 27 },
                        { id: 'P-F0-3', name: '季度团队储备包', remain: 2000, total: 2000, days: 88 }
                    ]
                }
            ],

            // 多订阅隔离节点库：涵盖空闲快节点(<800ms绿色)、空闲慢节点(>=800ms橙色)、超时节点、已被其他账号占用节点 (Comment 5, 7, 20, 21)
            nodes: [
                // SUB-01: 亚太专线主订阅 (16 节点)
                { id: 'n01', subId: 'SUB-01', name: 'HK-BGP-01',  ping: 22,   timeout: false, trend: [24, 21, 23, 22, 25, 21, 22] },
                { id: 'n02', subId: 'SUB-01', name: 'HK-BGP-02',  ping: 28,   timeout: false, trend: [31, 29, 27, 30, 28, 29, 28] },
                { id: 'n03', subId: 'SUB-01', name: 'HK-IEPL-03', ping: 31,   timeout: false, trend: [34, 32, 30, 33, 31, 32, 31] },
                { id: 'n04', subId: 'SUB-01', name: 'HK-IEPL-04', ping: 34,   timeout: false, trend: [36, 35, 33, 34, 36, 35, 34] },
                { id: 'n05', subId: 'SUB-01', name: 'TW-TPE-01',  ping: 41,   timeout: false, trend: [44, 42, 40, 43, 41, 42, 41] },
                { id: 'n06', subId: 'SUB-01', name: 'TW-TPE-02',  ping: 46,   timeout: false, trend: [49, 47, 45, 48, 46, 47, 46] },
                { id: 'n07', subId: 'SUB-01', name: 'SG-IEPL-01', ping: 52,   timeout: false, trend: [56, 54, 51, 55, 53, 52, 52] },
                { id: 'n08', subId: 'SUB-01', name: 'SG-IEPL-02', ping: 58,   timeout: false, trend: [62, 59, 57, 60, 58, 59, 58] },
                { id: 'n09', subId: 'SUB-01', name: 'SG-BGP-03',  ping: 67,   timeout: false, trend: [71, 68, 66, 70, 67, 68, 67] },
                { id: 'n10', subId: 'SUB-01', name: 'JP-TYO-01',  ping: 74,   timeout: false, trend: [79, 75, 73, 77, 74, 76, 74] },
                { id: 'n11', subId: 'SUB-01', name: 'JP-TYO-02',  ping: 82,   timeout: false, trend: [88, 84, 81, 85, 83, 82, 82] },
                { id: 'n12', subId: 'SUB-01', name: 'JP-OSA-03',  ping: 112,  timeout: false, trend: [118, 114, 110, 116, 113, 111, 112] },
                { id: 'n13', subId: 'SUB-01', name: 'KR-ICN-01',  ping: 89,   timeout: false, trend: [94, 91, 88, 92, 90, 89, 89] },
                { id: 'n14', subId: 'SUB-01', name: 'IN-BOM-01',  ping: 865,  timeout: false, trend: [890, 875, 860, 880, 870, 862, 865] },
                { id: 'n15', subId: 'SUB-01', name: 'AU-SYD-01',  ping: 940,  timeout: false, trend: [965, 950, 935, 955, 948, 942, 940] },
                { id: 'n16', subId: 'SUB-01', name: 'HK-EDGE-09', ping: 9999, timeout: true,  trend: [999, 999, 999, 999, 999, 999, 999] },

                // SUB-02: 全球容灾备用源 (12 节点)
                { id: 'n17', subId: 'SUB-02', name: 'US-SJC-01',  ping: 134,  timeout: false, trend: [142, 138, 135, 140, 136, 133, 134] },
                { id: 'n18', subId: 'SUB-02', name: 'US-LAX-01',  ping: 148,  timeout: false, trend: [155, 150, 147, 152, 149, 148, 148] },
                { id: 'n19', subId: 'SUB-02', name: 'US-SEA-02',  ping: 162,  timeout: false, trend: [170, 165, 160, 168, 164, 161, 162] },
                { id: 'n20', subId: 'SUB-02', name: 'DE-FRA-01',  ping: 176,  timeout: false, trend: [184, 179, 175, 181, 178, 177, 176] },
                { id: 'n21', subId: 'SUB-02', name: 'UK-LON-01',  ping: 192,  timeout: false, trend: [201, 195, 190, 198, 194, 191, 192] },
                { id: 'n22', subId: 'SUB-02', name: 'NL-AMS-02',  ping: 205,  timeout: false, trend: [215, 208, 204, 210, 207, 206, 205] },
                { id: 'n23', subId: 'SUB-02', name: 'CA-YVR-01',  ping: 158,  timeout: false, trend: [164, 160, 156, 161, 159, 157, 158] },
                { id: 'n24', subId: 'SUB-02', name: 'FR-PAR-01',  ping: 830,  timeout: false, trend: [850, 842, 825, 845, 836, 832, 830] },
                { id: 'n25', subId: 'SUB-02', name: 'BR-GRU-01',  ping: 1120, timeout: false, trend: [1150, 1135, 1110, 1140, 1128, 1122, 1120] },
                { id: 'n26', subId: 'SUB-02', name: 'ZA-JNB-01',  ping: 1280, timeout: false, trend: [1310, 1295, 1270, 1300, 1288, 1282, 1280] },
                { id: 'n27', subId: 'SUB-02', name: 'US-IAD-09',  ping: 9999, timeout: true,  trend: [999, 999, 999, 999, 999, 999, 999] },
                { id: 'n28', subId: 'SUB-02', name: 'RU-MOW-04',  ping: 9999, timeout: true,  trend: [999, 999, 999, 999, 999, 999, 999] },

                // SUB-03: 欧美高速专线备用源 (3 节点)
                { id: 'n29', subId: 'SUB-03', name: 'US-SJC-02',  ping: 138,  timeout: false, trend: [145, 140, 136, 142, 139, 137, 138] },
                { id: 'n30', subId: 'SUB-03', name: 'US-ORD-01',  ping: 155,  timeout: false, trend: [162, 158, 154, 160, 156, 153, 155] },
                { id: 'n31', subId: 'SUB-03', name: 'UK-LON-02',  ping: 185,  timeout: false, trend: [192, 188, 184, 190, 186, 183, 185] },

                // SUB-04: 日韩专线直连容灾 (3 节点)
                { id: 'n32', subId: 'SUB-04', name: 'JP-TYO-03',  ping: 68,   timeout: false, trend: [72, 70, 67, 71, 69, 68, 68] },
                { id: 'n33', subId: 'SUB-04', name: 'JP-OSA-01',  ping: 75,   timeout: false, trend: [80, 77, 74, 78, 76, 75, 75] },
                { id: 'n34', subId: 'SUB-04', name: 'KR-ICN-02',  ping: 62,   timeout: false, trend: [66, 64, 61, 65, 63, 62, 62] },

                // SUB-05: 新加坡金融低延迟专线 (3 节点)
                { id: 'n35', subId: 'SUB-05', name: 'SG-FIN-01',  ping: 48,   timeout: false, trend: [51, 49, 47, 50, 48, 49, 48] },
                { id: 'n36', subId: 'SUB-05', name: 'SG-FIN-02',  ping: 50,   timeout: false, trend: [53, 52, 49, 52, 51, 50, 50] },
                { id: 'n37', subId: 'SUB-05', name: 'SG-BGP-04',  ping: 55,   timeout: false, trend: [58, 56, 54, 57, 55, 56, 55] }
            ],

            subscriptions: [
                { id: 'SUB-01', name: '亚太专线主订阅',   ageHours: 11.4, url: 'https://sub.workbuddy.local/feed/meta' },
                { id: 'SUB-02', name: '全球容灾备用源',   ageHours: 53.6, url: 'https://sub.workbuddy.local/feed/backup' },
                { id: 'SUB-03', name: '欧美高速专线备用源', ageHours: 6.2,  url: 'https://sub.workbuddy.local/feed/us-eu-premium' },
                { id: 'SUB-04', name: '日韩专线直连容灾',   ageHours: 18.5, url: 'https://sub.workbuddy.local/feed/jp-kr-direct' },
                { id: 'SUB-05', name: '新加坡金融低延迟专线', ageHours: 1.4,  url: 'https://sub.workbuddy.local/feed/sg-fin-lowlatency' }
            ],

            models: [
                { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', realm: 'GLOBAL', ctx: '200K', maxOut: '64K',  ttft: 162, trend: [174, 168, 165, 170, 160, 164, 162] },
                { id: 'claude-opus-4-6',   name: 'Claude Opus 4.6',   realm: 'GLOBAL', ctx: '200K', maxOut: '32K',  ttft: 238, trend: [255, 248, 242, 250, 244, 240, 238] },
                { id: 'gpt-5-4',           name: 'GPT-5.4',           realm: 'GLOBAL', ctx: '400K', maxOut: '128K', ttft: 184, trend: [196, 190, 188, 192, 185, 187, 184] },
                { id: 'minimax-m3-1',      name: 'MiniMax M3.1 Flash',realm: 'CN',     ctx: '256K', maxOut: '64K',  ttft: 118, trend: [128, 122, 125, 120, 119, 121, 118] },
                { id: 'deepseek-v4-pro',   name: 'DeepSeek V4 Pro',   realm: 'CN',     ctx: '128K', maxOut: '64K',  ttft: 146, trend: [158, 152, 149, 151, 147, 148, 146] },
                { id: 'gemini-3-pro',      name: 'Gemini 3 Pro',      realm: 'GLOBAL', ctx: '1M',   maxOut: '64K',  ttft: 195, trend: [210, 204, 198, 202, 196, 199, 195] }
            ],

            tasks: {
                running: false,
                pausedAll: false,
                scheduleEnabled: true,
                activeStep: -1,
                selectedStepCode: null,
                steps: [
                    { code: '01', key: 'activity', name: '每日活跃上报', dur: '142 ms', progress: 100, okCount: 10, totalCount: 10, failures: [] },
                    { code: '02', key: 'token',    name: '访问令牌续期', dur: '218 ms', progress: 100, okCount: 10, totalCount: 10, failures: [] },
                    { code: '03', key: 'travel',   name: '猫猫旅行状态', dur: '306 ms', progress: 100, okCount: 9,  totalCount: 10, failures: [
                        { uid: '#84e510', name: 'Audit-Hold', region: 'GLOBAL', time: '17:15:30', reason: 'HTTP 401 刷新令牌失效，猫猫旅行状态巡检被上游拒绝' }
                    ] },
                    { code: '04', key: 'checkin',  name: '每日定时签到', dur: '94 ms',  progress: 100, okCount: 10, totalCount: 10, failures: [] }
                ]
            },

            usageRange: '24H', // '6H' | '24H'（日志上限 24 小时，精准聚焦 6H/24H）
            usage6h: {
                labels: ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'],
                outVals: [42, 68, 95, 128, 86, 110],
                inVals:  [21, 33, 46,  62, 41,  53]
            },
            usage24h: {
                labels: (() => {
                    const now = new Date(Date.now() + 8 * 3600000);
                    const curH = now.getUTCHours();
                    const lbs = [];
                    for (let step = 6; step >= 0; step--) {
                        const h = (curH - step * 4 + 48) % 24;
                        lbs.push(String(h).padStart(2, '0') + ':00');
                    }
                    return lbs;
                })(),
                outVals: [120, 86, 210, 380, 440, 355, 290],
                inVals:  [58,  42, 95,  172, 205, 168, 134]
            },
            usage7d: {
                labels: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
                outVals: [1420, 1680, 1590, 2140, 2380, 1890, 1840],
                inVals:  [680,  790,  740,  1020, 1150, 880,  860]
            },
            usageByModel: [
                { name: 'Claude Sonnet 4.5', reqs: '1,420', prompt: '4.8M', comp: '1.9M', credits: '6,840' },
                { name: 'GPT-5.4',           reqs: '960',   prompt: '3.2M', comp: '1.1M', credits: '4,520' },
                { name: 'DeepSeek V4 Pro',   reqs: '1,850', prompt: '5.6M', comp: '2.4M', credits: '2,190' },
                { name: 'Claude Opus 4.6',   reqs: '310',   prompt: '1.1M', comp: '0.4M', credits: '3,680' },
                { name: 'Claude 3.5 Sonnet', reqs: '2,180', prompt: '6.4M', comp: '2.8M', credits: '5,120' },
                { name: 'GPT-4o',            reqs: '1,150', prompt: '3.9M', comp: '1.4M', credits: '3,890' },
                { name: 'Gemini 1.5 Pro',    reqs: '890',   prompt: '2.8M', comp: '0.9M', credits: '1,950' },
                { name: 'Qwen 2.5 72B',      reqs: '1,640', prompt: '5.1M', comp: '2.2M', credits: '1,680' }
            ],

            // Comment 17: 时间-错误量数学模型采样（Hawkes 自激衰减强度 λ(t) = μ + Σα·exp(-βΔt)）
            errorModelSeries: {
                labels: (() => {
                    const curH = getBeijingCurrentHour();
                    const lbs = [];
                    for (let s = 6; s >= 0; s--) {
                        lbs.push(String((curH - s * 4 + 48) % 24).padStart(2, '0') + ':00');
                    }
                    return lbs;
                })(),
                rawCounts: [0, 1, 0, 2, 4, 2, 1],
                lambdaVals: [0.18, 0.72, 0.34, 1.86, 3.64, 2.15, 1.08],
                mu: 0.18,
                alpha: 0.92,
                beta: 0.64,
                warnLine: 2.50
            },

            logs: [
                { id: 'INC-912', time: '20:18:04', code: 403, uid: '#a6ebea', egress: 'JP-TYO-01', summary: '区域策略风控拦截，已自动转由离岸专用节点复验', raw: '{"error":{"code":"permission_denied","message":"geographic_restriction_enforced"}}' },
                { id: 'INC-911', time: '20:02:19', code: 422, uid: '#cff721', egress: 'US-SJC-01', summary: 'Prompt 超过上游单次窗口，已触发分段压缩路由', raw: '{"error":{"code":"context_length_exceeded","max_allowed":204800,"received":211420}}' },
                { id: 'INC-910', time: '19:54:12', code: 429, uid: '#90d14b', egress: 'JP-TYO-01', summary: '上游速率限制，已自动切换备用凭据重试成功', raw: '{"error":{"code":"rate_limit_exceeded","retry_after_ms":38000,"upstream":"jp-tyo-01"}}' },
                { id: 'INC-909', time: '18:20:11', code: 502, uid: '#a41e88', egress: 'HK-BGP-02', summary: '边缘连接瞬断，网关层 120ms 内无感重连恢复', raw: '{"error":{"code":"bad_gateway","message":"upstream_tls_handshake_eof"}}' },
                { id: 'INC-908', time: '17:15:30', code: 401, uid: '#84e510', egress: 'US-LAX-01', summary: '刷新令牌失效，该账号已自动隔离等待重新授权', raw: '{"error":{"code":"invalid_grant","message":"refresh_token_revoked"}}' },
                { id: 'INC-907', time: '16:08:49', code: 400, uid: '#d82b71', egress: 'US-SJC-01', summary: '参数格式不符，上游 JSON 校验失败并已自动回退纠正', raw: '{"error":{"code":"invalid_request_body","field":"tools.function.parameters"}}' },
                { id: 'INC-906', time: '15:42:03', code: 408, uid: '#6b44e0', egress: 'JP-TYO-02', summary: '首字响应等待超时，网关已无感重路由至备用节点', raw: '{"error":{"code":"request_timeout","ttft_deadline_ms":15000}}' },
                { id: 'INC-905', time: '14:19:27', code: 429, uid: '#7890ab', egress: 'HK-BGP-01', summary: '短时突发配额触顶，退避 12s 后自动恢复正常选号', raw: '{"error":{"code":"burst_quota_limit","cooldown_sec":12}}' },
                { id: 'INC-904', time: '12:50:44', code: 404, uid: '#f0632a', egress: 'DE-FRA-01', summary: '目标模型已被上游下线，自动重定向至兼容新版本', raw: '{"error":{"code":"model_not_found","model":"gpt-4o-2024-05-13"}}' },
                { id: 'INC-903', time: '11:05:18', code: 401, uid: '#55c02e', egress: 'HK-IEPL-03', summary: '设备指纹会话过期，令牌保活工序已自动续签', raw: '{"error":{"code":"session_expired","action":"auto_renewed"}}' },
                { id: 'INC-902', time: '09:33:51', code: 429, uid: '#c17a39', egress: 'KR-ICN-01', summary: '模型级并发限流，网关队列平滑缓冲 180ms 放行', raw: '{"error":{"code":"model_rate_limited","model":"claude-opus-4-6"}}' }
            ]
        };
        window.WBState = WBState; window.soundscape = soundscape; window.spawnGridHighlightWave = spawnGridHighlightWave; window.gridHighlightWaves = gridHighlightWaves;
        if (IS_PROD_ENV) {
            WBState.accounts = [];
            WBState.nodes = [];
            WBState.subscriptions = [];
            WBState.models = [];
            WBState.logs = [];
            WBState.usageByModel = [];
            WBState.loginAuthUrl = '';
            WBState.uptimeSec = 0;
            WBState.goroutines = 0;
            WBState.memMb = 0;
            WBState.cpuPct = 0;
            WBState.cpuHistory = Array(14).fill(0);
            WBState.memHistory = Array(14).fill(0);
            WBState.trafficAvailable = false;
            WBState.downMbps = 0;
            WBState.upMbps = 0;
            WBState.downHistory = Array(14).fill(0);
            WBState.upHistory = Array(14).fill(0);
            WBState.tasks.steps = [];
            for (const series of [WBState.usage6h, WBState.usage24h, WBState.usage7d]) {
                series.outVals = series.outVals.map(() => 0);
                series.inVals = series.inVals.map(() => 0);
            }
            WBState.errorModelSeries.rawCounts.fill(0);
            WBState.errorModelSeries.lambdaVals.fill(0);
        }


        function isRawLowBalance(acc) {
            return !acc.unlimited && acc.balance < WBState.configThreshold;
        }

        function isLowBalanceProtected(acc) {
            return acc.manualOn && isRawLowBalance(acc) && !acc.forceOverride;
        }

        function isAccountRoutable(acc) {
            return acc.manualOn && acc.state === 'HEALTHY' && (!isRawLowBalance(acc) || acc.forceOverride);
        }

        function getAccountNameByUid(uid) {
            const found = WBState.accounts.find(a => a.uid === uid);
            return found ? found.name : uid;
        }

        function getActiveSubNodes() {
            return WBState.nodes.filter(n => n.subId === WBState.activeSubId);
        }

        function formatUptime(sec) {
            const d = Math.floor(sec / 86400);
            const h = Math.floor((sec % 86400) / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const s = sec % 60;
            return `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }

        function notifyEditorialStatus(msg) {
            const el = document.getElementById('editorial-status-line');
            if (el) scrambleText(el, msg, 320);
        }

        function setVertexHover(idx, tag = '') {
            WBState.hoveredVertexIdx = idx;
            WBState.hoveredTag = tag;
            const fpsEl = document.getElementById('preview-fps');
            if (fpsEl) {
                if (idx >= 0 && tag) {
                    scrambleText(fpsEl, tag, 220);
                } else {
                    fpsEl.textContent = 'SYNC // 60 FPS';
                }
            }
        }

        function renderHairlineSpark(arr, w = 60, h = 15, animateSpread = true) {
            if (!arr || !arr.length) return '';
            const min = Math.min(...arr);
            const max = Math.max(...arr, min + 1);
            const pts = arr.map((v, i) => {
                const x = (i / Math.max(1, arr.length - 1)) * (w - 4) + 2;
                const y = h - 3 - ((v - min) / (max - min)) * (h - 6);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
            const last = pts.split(' ').pop().split(',');
            if (animateSpread) {
                const cid = 'sp-clip-' + (++WBState.chartClipSeq);
                // Comment 12: 使用 svg-mini-clip-rect 实现由快到慢、由左到右蔓延入场动画
                return `<svg width="${w}" height="${h}" class="block overflow-visible opacity-85">
                    <defs><clipPath id="${cid}"><rect x="0" y="-4" width="${w + 8}" height="${h + 8}" class="svg-mini-clip-rect" /></clipPath></defs>
                    <g clip-path="url(#${cid})">
                        <polyline fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.2" points="${pts}" />
                        <circle cx="${last[0]}" cy="${last[1]}" r="1.6" fill="#ffffff" />
                    </g>
                </svg>`;
            }
            return `<svg width="${w}" height="${h}" class="block overflow-visible opacity-80">
                <polyline fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="1.15" points="${pts}" />
                <circle cx="${last[0]}" cy="${last[1]}" r="1.6" fill="#ffffff" />
            </svg>`;
        }

        function renderHairlineMeter(ratio, widthPx = 44) {
            const pct = Math.max(5, Math.min(100, Math.round(ratio * 100)));
            return `<span class="inline-block relative bg-white/12 align-middle shrink-0" style="width:${widthPx}px;height:1.5px;">
                <span class="absolute left-0 top-0 bottom-0 bg-white/90" style="width:${pct}%;"></span>
            </span>`;
        }

        function overviewChartPoints(primary, secondary) {
            const values = [...primary, ...secondary].map(v => Number.isFinite(v) ? v : 0);
            const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            const spread = Math.max(0.001, ...values.map(v => Math.abs(v - mean)));
            const make = arr => arr.map((v, i) => {
                const x = i * 520 / Math.max(1, arr.length - 1);
                const y = Math.max(10, Math.min(60, 42 - ((Number.isFinite(v) ? v : 0) - mean) / spread * 20));
                return x.toFixed(1) + ',' + y.toFixed(1);
            }).join(' ');
            return [make(primary), make(secondary)];
        }

        // Comment 4 & 10: 任务页进度条：停用时灰线从右向左以快到慢替换白/红线，启用时白/红线从左向右以快到慢替换灰线，中间始终留有一小条缝隙不相贴；快速切换时平滑减速反向
        function renderTaskStatusLine(step, widthPx = 108, animateBars = false) {
            const total = Math.max(1, step.totalCount || 1);
            const failed = step.failures ? step.failures.length : Math.max(0, total - step.okCount);
            const prog = Math.max(0, Math.min(100, step.progress ?? 100));
            const isPaused = !!WBState.tasks?.pausedAll || WBState.tasks?.scheduleEnabled === false;

            const okCount = Math.max(0, total - failed);
            const okTargetPct = Math.round((okCount / total) * 100);
            const currentWhitePct = Math.min(okTargetPct, prog);
            const redPct = (failed > 0 && prog > okTargetPct) ? Math.min(100 - okTargetPct, prog - okTargetPct) : 0;
            const popCls = redPct > 0 ? "task-fault-pop" : "";

            const initActiveWidth = animateBars ? '0%' : (isPaused ? '0%' : '100%');
            const initGrayWidth   = animateBars ? '100%' : (isPaused ? '100%' : '0%');

            return `<span class="task-line-shell inline-block relative bg-white/12 align-middle shrink-0 overflow-hidden" style="width:${widthPx}px;height:1.8px;">
                <span class="task-active-track absolute left-0 top-0 bottom-0 overflow-hidden" style="width:${initActiveWidth};">
                    <span class="absolute left-0 top-0 bottom-0 bg-white/90" style="width:${currentWhitePct}%;"></span>
                    ${redPct > 0 ? `<span class="absolute top-0 bottom-0 bg-[#ff5c74] ${popCls}" style="left:${okTargetPct}%;width:${redPct}%;box-shadow:0 0 6px rgba(255,92,116,0.65);"></span>` : ""}
                </span>
                <span class="task-gray-track absolute top-0 bottom-0 " style="background-color:#9ca3af;right:0;width:${initGrayWidth};box-shadow:${isPaused ? '-2.5px 0 0 0 #050605' : 'none'};"></span>
            </span>`;
        }

        function updateTaskRowInPlace(idx) {
            const rows = document.querySelectorAll('#editorial-stage-body .editorial-row');
            const rowEl = rows[idx];
            if (!rowEl) return;
            const st = WBState.tasks.steps[idx];
            if (!st) return;
            const isCur = WBState.tasks.running && WBState.tasks.activeStep === idx;
            const failCnt = st.failures ? st.failures.length : Math.max(0, st.totalCount - st.okCount);
            const hasFault = failCnt > 0 && !(WBState.tasks.running && (st.progress ?? 0) < 12);

            let stateLabel = '正常';
            let stateCls = 'tone-normal';
            if (WBState.tasks.pausedAll || WBState.tasks.scheduleEnabled === false) {
                stateLabel = WBState.tasks.pausedAll ? '已暂停' : '排程停用';
                stateCls = 'tone-paused';
            } else if (isCur && !hasFault) {
                stateLabel = '执行中';
                stateCls = 'text-white';
            } else if (hasFault) {
                stateLabel = '报错';
                stateCls = 'tone-fault';
            }

            const lineContainer = rowEl.children[1];
            if (lineContainer) lineContainer.innerHTML = renderTaskStatusLine(st, 108, false);

            const durSpan = rowEl.children[4];
            if (durSpan) durSpan.textContent = st.dur;

            const stateSpan = rowEl.children[5];
            if (stateSpan) {
                stateSpan.className = `text-[11px] ${stateCls} text-left transition-colors duration-300`;
                stateSpan.textContent = stateLabel;
            }
        }

        function renderPagerControls(curPage, totalPages, onPageFnName, forceShow = false) {
            const pagerEl = document.getElementById('editorial-pager');
            if (!pagerEl) return;
            if (!onPageFnName || (totalPages <= 1 && !forceShow)) {
                pagerEl.innerHTML = `<span class="text-white/30">CHAPTER ${CHAPTER_META[WBState.currentChapter]?.num || '01'} / 09</span>`;
                return;
            }
            const safeTotal = Math.max(1, totalPages);
            const safeCur = Math.min(Math.max(0, curPage), safeTotal - 1);
            const pStr = `${String(safeCur + 1).padStart(2, '0')} / ${String(safeTotal).padStart(2, '0')}`;
            pagerEl.innerHTML = `
                <button class="editorial-text-btn" ${safeCur <= 0 ? 'disabled' : ''} data-action="page-change" data-page-fn="${onPageFnName}" data-page="${safeCur - 1}">&larr; PREV</button>
                <span class="text-white/75 font-mono">${pStr}</span>
                <button class="editorial-text-btn" ${safeCur >= safeTotal - 1 ? 'disabled' : ''} data-action="page-change" data-page-fn="${onPageFnName}" data-page="${safeCur + 1}">NEXT &rarr;</button>
            `;
        }

        window.changeAccountPage       = (p) => { WBState.accountPage = p;        renderEditorialStage(true); soundscape.triggerTileNote(4); };
        window.changeAccountNodePage   = (p) => { WBState.accountNodePage = p;    renderEditorialStage(true); soundscape.triggerTileNote(5); };
        window.changeEgressPage        = (p) => { WBState.egressPage = p;         renderEditorialStage(true); soundscape.triggerTileNote(5); };
        window.changeEgressSubPage     = (p) => { WBState.egressSubPage = p; try { if (typeof localStorage !== 'undefined') localStorage.setItem('wb_egress_sub_page', String(p)); } catch (_) {} renderEditorialStage(true); soundscape.triggerTileNote(5); };
        window.changeModelPage         = (p) => { WBState.modelPage = p;          renderEditorialStage(true); soundscape.triggerTileNote(6); };
        window.changePackageAccPage    = (p) => { WBState.packageAccountPage = p; renderEditorialStage(true); soundscape.triggerTileNote(6); };
        window.changePackageDetailPage = (p) => { WBState.packageDetailPage = p;  renderEditorialStage(true); soundscape.triggerTileNote(7); };
        window.changeLogPage           = (p) => { WBState.logPage = p;            renderEditorialStage(true); soundscape.triggerTileNote(7); };
        window.changeUsageModelPage    = (p) => { WBState.usageModelPage = p;     renderEditorialStage(true); soundscape.triggerTileNote(6); };
        window.changeCustomizationPage = (p) => { WBState.customization.page = p; renderEditorialStage(true); soundscape.triggerTileNote(5); };

        // 全局统一 3D 几何画框状态与动效规范 (黄: 刷新/任务执行; 红: 报错颤抖; 绿: 成功短暂变绿)
        // Comment 4: 特效仅作用于模型外围圆圈那小部分白色亮弧，外围方框 preview-canvas 绝不变色！
        function setPreviewFrameState(state, durationMs = 800) {
            const canvasBox = document.getElementById("preview-canvas");
            const canvasEl = document.getElementById("project-preview-canvas");
            if (canvasBox) canvasBox.style.borderColor = ""; // 确保外围方框绝不变色！

            if (WBState._ringTimer) {
                clearTimeout(WBState._ringTimer);
                WBState._ringTimer = null;
            }

            WBState.ringState = state; // "idle" | "busy" | "error" | "success"

            if (state === "busy" || state === "yellow") {
                WBState.ringState = "busy";
                if (window.triggerModelSpinAcceleration) window.triggerModelSpinAcceleration(durationMs || 0);
                WBState._ringTimer = setTimeout(() => {
                    if (WBState.ringState === "busy") setPreviewFrameState("idle");
                }, (durationMs > 0 ? durationMs : 10000));
            } else if (state === "error" || state === "red") {
                WBState.ringState = "error";
                if (canvasEl) {
                    canvasEl.classList.remove("canvas-fault-jolt");
                    void canvasEl.offsetWidth;
                    canvasEl.classList.add("canvas-fault-jolt");
                }
                if (typeof soundscape !== "undefined" && soundscape?.triggerErrorSound) {
                    soundscape.triggerErrorSound();
                }
                WBState._ringTimer = setTimeout(() => {
                    WBState.ringState = "idle";
                    if (canvasEl) canvasEl.classList.remove("canvas-fault-jolt");
                }, durationMs || 700);
            } else if (state === "success" || state === "green") {
                WBState.ringState = "success";
                WBState._ringTimer = setTimeout(() => {
                    WBState.ringState = "idle";
                }, durationMs || 800);
            } else {
                WBState.ringState = "idle";
                if (canvasEl) canvasEl.classList.remove("canvas-fault-jolt");
            }
        }
        // Visual feedback is explicitly started by an operation and finished by its result.
        // Keep the initiating element even when focus moves; concurrent operations cannot
        // let an older result overwrite the latest ring state.
        let feedbackTarget = null;
        let feedbackSequence = 0;
        document.addEventListener('click', ev => {
            feedbackTarget = ev.target?.closest?.('button, [data-action]') || null;
        }, true);
        function beginActionFeedback(target = feedbackTarget, line = null) {
            const token = ++feedbackSequence;
            const row = target?.closest?.('.editorial-row');
            const elements = [...new Set([target, row, line].filter(Boolean))];
            const action = target?.dataset?.action;
            const nodeId = target?.dataset?.nodeId;
            const subId = target?.dataset?.subId;
            let currentState = 'busy';
            const rebind = () => {
                if (!action || (nodeId === undefined && subId === undefined)) return;
                const replacement = [...document.querySelectorAll('[data-action]')].find(el =>
                    el.dataset.action === action && el.dataset.nodeId === nodeId && el.dataset.subId === subId);
                if (!replacement || elements.includes(replacement)) return;
                elements.push(replacement);
                replacement._actionFeedbackToken = token;
                const replacementRow = replacement.closest?.('.editorial-row');
                if (replacementRow && !elements.includes(replacementRow)) {
                    replacementRow._actionFeedbackToken = token;
                    elements.push(replacementRow);
                }
                paint(currentState);
            };
            const paint = state => {
                currentState = state;
                elements.forEach(el => {
                    if (state !== 'busy' && el._actionFeedbackToken !== token) return;
                    if (state === 'busy') el._actionFeedbackToken = token;
                    el.classList.remove('action-feedback-busy', 'action-feedback-success', 'action-feedback-error');
                    if (state !== 'idle') el.classList.add('action-feedback-' + state);
                });
            };
            paint('busy');
            if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
            let finished = false;
            const finish = (state, ringState = state) => {
                if (finished) return;
                finished = true;
                paint(state);
                if (token === feedbackSequence) setPreviewFrameState(ringState, 800);
                setTimeout(() => paint('idle'), 1200);
            };
            finish.rebind = rebind;
            return finish;
        }
        window.setPreviewFrameState = setPreviewFrameState;
        window.triggerRingState = setPreviewFrameState;

        function triggerTaskFaultAlarmVisual() {
            setPreviewFrameState('error', 700);
        }
        window.triggerTaskFaultAlarmVisual = triggerTaskFaultAlarmVisual;

        // Comment 1: 同步底部按钮文案，仅作用于定宽中间槽位，括号永不闪烁
        function syncDynamicBottomButtons() {
            const ch = WBState.currentChapter;
            const btn1 = document.getElementById('btn-page-chord');
            const btn2 = document.getElementById('btn-page-ripple');
            if (!btn1 || !btn2) return;
            let t1 = CHAPTER_META[ch]?.btn1 || '[ ACTION 01 ]';
            let t2 = CHAPTER_META[ch]?.btn2 || '[ ACTION 02 ]';

            // 重置基础类名，确保更新按钮的绿色仅在关于页面 (sphere) 且更新就绪时生效，绝不污染其他所有页面
            if (ch === 'sphere' && (WBState.sphereUpdateApplied || (WBState.sphereUpdateReady && !WBState.sphereUpdating))) {
                btn1.className = 'editorial-action-btn border border-emerald-400 hover:border-emerald-300 text-emerald-300 bg-emerald-400/10 transition-colors';
            } else if (ch === 'sphere' && (WBState.sphereCheckingUpdate || WBState.sphereUpdating)) {
                btn1.className = 'editorial-action-btn border border-amber-400 hover:border-amber-300 text-amber-300 bg-amber-400/10 animate-pulse transition-colors';
            } else {
                btn1.className = 'editorial-action-btn border border-white/25 hover:border-white bg-white/[0.04] text-white/80 hover:text-white transition-colors';
            }
            btn2.className = 'editorial-action-btn border border-white/25 hover:border-white bg-white/[0.02] text-white/70 hover:text-white transition-colors';

            if (ch === 'customization') {
                const cust = WBState.customization;
                if (cust.isAdding) {
                    t1 = '[ <- CANCEL ]';
                    t2 = '[ √ CONFIRM ]';
                } else if (cust.currentTab === 'music') {
                    t1 = '[ + IMPORT MUSIC ]';
                    t2 = '[ RANDOM ASSIGN ]';
                } else if (cust.currentTab === 'slogan') {
                    t1 = '[ + NEW SLOGAN ]';
                    t2 = '[ RANDOM ASSIGN ]';
                } else if (cust.currentTab === 'theme') {
                    t1 = '[ RANDOM THEME ]';
                    t2 = '[ RANDOM ASSIGN ]';
                }
            } else if (ch === 'sphere') {
                t2 = '[ MATRIX ]';
                if (WBState.sphereUpdateApplied) {
                    t1 = '[ RESTART REQUIRED ]';
                } else if (WBState.sphereUpdating) {
                    t1 = '[ UPDATING... ]';
                } else if (WBState.sphereUpdateReady) {
                    t1 = '[ RESTART & UPDATE ]';
                } else if (WBState.sphereCheckingUpdate) {
                    t1 = '[ CHECKING... ]';
                } else {
                    t1 = '[ CHECK UPDATE ]';
                }
            } else if (ch === 'overview' || ch === 'gateway') {
                t1 = WBState.overviewMode === 'TRAFFIC' ? '[ RESOURCE CURVE ]' : '[ TRAFFIC CURVE ]';
            } else if (ch === 'accounts') {
                if (WBState.selectedAccountUid || WBState.selectingSystemDefault) {
                    t1 = '[ <- POOL ]';
                    t2 = WBState.accountNodeSortMode === 'NAME' ? '[ SORT: PING ]' : '[ SORT: NAME ]';
                } else if (WBState.accountSubmode === 'INGEST') {
                    t1 = '[ <- POOL ]';
                    t2 = '[ √ INGEST ]';
                } else if (WBState.accountSubmode) {
                    t1 = '[ <- POOL ]';
                    t2 = '[ √ CONFIRM ]';
                } else {
                    t1 = '[ ADD ACCOUNT ]';
                    t2 = '[ REFRESH POOL ]';
                }
            } else if (ch === 'egress') {
                if (WBState.importingSub) {
                    t1 = '[ <- NODES ]';
                    t2 = '[ √ CONFIRM ]';
                } else {
                    t1 = '[ REFRESH ALL ]';
                    t2 = '[ + IMPORT SUBSCRIPTION ]';
                }
            } else if (ch === 'tasks' || ch === 'scheduler') {
                t1 = '[ START ALL TASKS ]';
                t2 = WBState.tasks.scheduleEnabled === false ? '[ ENABLE ALL TASKS ]' : '[ DISABLE ALL TASKS ]';
            } else if (ch === 'usage') {
                const targetH = getBeijingUsageTargetHour();
                WBState.usage24h.labels = [];
                for (let s = 6; s >= 0; s--) {
                    const h = (targetH - s * 4 + 48) % 24;
                    WBState.usage24h.labels.push(String(h).padStart(2, '0') + ':00');
                }
                WBState.usage6h.labels = [];
                for (let s = 5; s >= 0; s--) {
                    const h = (targetH - s + 48) % 24;
                    WBState.usage6h.labels.push(String(h).padStart(2, '0') + ':00');
                }
                if (WBState.usage24h.outVals && WBState.usage24h.outVals.length >= 6) {
                    WBState.usage6h.outVals = WBState.usage24h.outVals.slice(-6);
                    WBState.usage6h.inVals = WBState.usage24h.inVals.slice(-6);
                }
                t1 = WBState.usageView === 'CURVE' ? '[ MODEL RANK ]' : '[ TIME CURVE ]';
                t2 = WBState.usageRange === '6H' ? '[ TIME: 6H ]' : '[ TIME: 24H ]';
            } else if (ch === "packages") {
                if (WBState.selectedPackageUid) {
                    t1 = "[ PACKAGE DETAIL ]";
                    t2 = "[ <- ACCOUNTS ]";
                } else if (WBState.packageView === "MODEL") {
                    t1 = "[ <- PACKAGES ]";
                    t2 = WBState.packageModelMode === "ACCOUNT" ? "[ SWITCH: EXPIRY ]" : "[ SWITCH: ACCOUNT ]";
                } else {
                    t1 = "[ EXPIRY MODEL ]";
                    t2 = WBState.packageListSort === "USAGE" ? "[ SORT: NAME ]" : "[ SORT: USAGE ]";
                }
            } else if (ch === 'logs') {
                const bjNowLogs = new Date(Date.now() + 8 * 3600000);
                const curLogH = bjNowLogs.getUTCHours();
                WBState.errorModelSeries.labels = [];
                for (let s = 6; s >= 0; s--) {
                    const h = (curLogH - s * 4 + 48) % 24;
                    WBState.errorModelSeries.labels.push(String(h).padStart(2, '0') + ':00');
                }
                t1 = WBState.logView === 'LIST' ? '[ ERROR MODEL ]' : '[ LOG ARCHIVE ]';
            } else if (ch === 'encryption') {
                t1 = '[ √ SAVE ]';
                t2 = '[ <- LOG OUT ]';
            }

            const c1 = stripBtnBrackets(t1);
            const c2 = stripBtnBrackets(t2);
            if (btn1.getAttribute('data-scramble') !== c1) {
                scrambleActionButton(btn1, t1, 180);
            }
            if (btn2.getAttribute('data-scramble') !== c2) {
                scrambleActionButton(btn2, t2, 180);
            }
        }

        function getAccountActivePackages(acc) {
            if (acc.blocked || acc.state === 'BLOCKED') return [];
            return (acc.packages || []).filter(p => (p.remain !== undefined ? p.remain : ((p.total || 0) - (p.used || 0))) > 0 && (p.days === null || p.days > 0)).sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
        }

        function updateEditorialKeyFigures(animateKpi = false) {
            const l1 = document.getElementById('spec-label-1'), v1 = document.getElementById('page-spec-1');
            const l2 = document.getElementById('spec-label-2'), v2 = document.getElementById('page-spec-2');
            const l3 = document.getElementById('spec-label-3'), v3 = document.getElementById('page-spec-3');
            if (!l1 || !v1) return;

            if (animateKpi) {
                const strip = document.getElementById('editorial-kpi-strip');
                if (strip) {
                    strip.classList.remove('editorial-kpi-fade');
                    void strip.offsetWidth;
                    strip.classList.add('editorial-kpi-fade');
                }
            }

            const ch = WBState.currentChapter;
            if (ch === 'customization') {
                const cust = WBState.customization;
                const mName = cust.randomMusic ? '[ 随机 ]' : (cust.musicList.find(m => m.id === cust.activeMusicId)?.name.split('//')[0].trim() || 'Canopy Ambient');
                const sName = cust.randomMotto ? '[ 随机 ]' : (cust.sloganList.find(s => s.id === cust.activeSloganId)?.name || 'SILENT ARCHITECTURE');
                const tName = cust.randomTheme ? '[ 随机 ]' : (cust.themeList.find(t => t.id === cust.activeTheme)?.name.split('//')[0].trim() || 'OVERCAST');

                l1.textContent = '当前音频'; v1.textContent = mName; v1.className = "text-[22px] font-['Space_Grotesk'] font-medium text-white tracking-tight leading-normal tabular-nums-left truncate max-w-[180px]";
                l2.textContent = '当前文案'; v2.textContent = sName; v2.className = "text-[22px] font-['Space_Grotesk'] font-medium text-white tracking-tight leading-normal tabular-nums-left truncate max-w-[180px]";
                l3.textContent = '当前主题'; v3.textContent = tName; v3.className = "text-[22px] font-['Space_Grotesk'] font-medium text-white tracking-tight leading-normal tabular-nums-left truncate max-w-[180px]";
                return;
            } else if (ch === 'sphere') {
                const col2 = l2 ? (document.getElementById('kpi-col-2') || l2.parentElement) : null;
                if (col2) col2.style.transform = 'translateX(-16px)';
                l1.textContent = '核心版本'; v1.textContent = WBState.coreVersion || '3.0.1'; v1.className = "text-[22px] font-['Space_Grotesk'] font-medium text-white tracking-tight leading-normal tabular-nums-left whitespace-nowrap";
                l2.textContent = '网关端点'; v2.textContent = '127.0.0.1:7863'; v2.className = "text-[22px] font-['Space_Grotesk'] font-medium text-white tracking-tight leading-normal tabular-nums-left whitespace-nowrap";
                l3.textContent = 'FPS'; v3.textContent = '60'; v3.className = "text-[22px] font-['Space_Grotesk'] font-medium text-white tracking-tight leading-normal tabular-nums-left whitespace-nowrap";
                return;
            } else {
                const col2 = l2 ? (document.getElementById('kpi-col-2') || l2.parentElement) : null;
                if (col2) col2.style.transform = '';
                const stdKpi = "text-[22px] font-['Space_Grotesk'] font-medium text-white tracking-tight leading-normal tabular-nums-left whitespace-nowrap";
                if (v1.className !== stdKpi) v1.className = stdKpi;
                if (v2.className !== stdKpi) v2.className = stdKpi;
                if (v3.className !== stdKpi) v3.className = stdKpi;
            }
            const totalAcc = WBState.accounts.length;
            const routableAcc = WBState.accounts.filter(isAccountRoutable).length;
            const lowAcc = WBState.accounts.filter(isLowBalanceProtected).length;
            const forcedAcc = WBState.accounts.filter(a => a.manualOn && isRawLowBalance(a) && a.forceOverride).length;
            const coolingAcc = WBState.accounts.filter(a => a.state === 'COOLING').length;

            if (ch === 'accounts') {
                l1.textContent = '可用选号池'; v1.textContent = `${routableAcc} / ${totalAcc}`;
                // Comment 5: 不要出现强启，保持展示低额保护总数
                l2.textContent = `低额保护 (<${WBState.configThreshold})`; v2.textContent = `${lowAcc}`;
                l3.textContent = '限流冷却中'; v3.textContent = `${coolingAcc}`;
            } else if (ch === 'egress') {
                const activeSub = WBState.subscriptions.find(s => s.id === WBState.activeSubId) || WBState.subscriptions[0];
                const expiredCnt = WBState.subscriptions.filter(s => s.ageHours > WBState.configCacheHours).length;
                l1.textContent = '下行速率'; v1.textContent = WBState.trafficAvailable ? `${WBState.downMbps.toFixed(1)} MB/s` : '—';
                l2.textContent = '上行速率'; v2.textContent = WBState.trafficAvailable ? `${WBState.upMbps.toFixed(2)} MB/s` : '—';
                l3.textContent = '当前启用订阅'; v3.textContent = activeSub ? activeSub.name : (expiredCnt ? `${expiredCnt} 源待刷新` : '全部有效');
            } else if (ch === 'models') {
                const list = WBState.models.filter(m => modelMatchesFilter(m, WBState.modelRealmFilter));
                        const measured = list.filter(m => Number.isFinite(m.ttft));
                        const avgTtft = measured.length ? Math.round(measured.reduce((s, m) => s + m.ttft, 0) / measured.length) : null;
                l1.textContent = WBState.modelRealmFilter === 'ALL' ? '可用模型' : `${WBState.modelRealmFilter} 模型`;
                v1.textContent = `${list.length}`;
                l2.textContent = '目录缓存'; v2.textContent = (WBState.modelsLastRefreshed && (Date.now() - WBState.modelsLastRefreshed < 86400000)) ? '已同步' : '热命中';
                l3.textContent = '平均首字延迟'; v3.textContent = avgTtft === null ? '—' : `${avgTtft} ms`;
            } else if (ch === 'tasks' || ch === 'scheduler') {
                const faultSteps = WBState.tasks.steps.filter(s => (s.failures?.length || 0) > 0).length;
                // Comment 11: 修改为 4项定时任务
                l1.textContent = '维护工序'; v1.textContent = '4 项维护任务';
                l2.textContent = '运行状态'; v2.textContent = (WBState.tasks.scheduleEnabled === false || WBState.tasks.pausedAll) ? '排程停用' : (WBState.tasks.running ? '执行锁定' : '空闲就绪');
                l3.textContent = '异常工序'; v3.textContent = WBState.tasks.scheduleEnabled === false ? '每日调度已暂停' : (faultSteps > 0 ? `${faultSteps} 项含报错` : '全部正常');
            } else if (ch === 'usage') {
                const ds = WBState.usageRange === '24H' ? WBState.usage24h : WBState.usage6h;
                const sumOut = ds.outVals.reduce((a, b) => a + b, 0);
                const sumIn  = ds.inVals.reduce((a, b) => a + b, 0);
                l1.textContent = WBState.usageRange === '24H' ? '24H 输出总量' : '6H 输出总量';
                v1.textContent = `${((sumOut) / 1000).toFixed(2)}M`;
                l2.textContent = '输入总量'; v2.textContent = `${((sumIn) / 1000).toFixed(2)}M`;
                l3.textContent = '缓存命中率'; v3.textContent = WBState.usageCacheHitRate == null ? '—' : WBState.usageCacheHitRate.toFixed(1) + '%';
            } else if (ch === 'packages') {
                let totalPackCount = 0;
                let threeDaysCredits = 0;
                WBState.accounts.filter(a => !a.blocked && a.state !== 'BLOCKED').forEach(acc => {
                    const activePacks = getAccountActivePackages(acc);
                    totalPackCount += activePacks.length;
                    activePacks.forEach(p => {
                        if (p.days != null && p.days <= 1) threeDaysCredits += (p.remain !== undefined ? p.remain : p.total || 0);
                    });
                });
                l1.textContent = '持包账号数'; v1.textContent = `${WBState.accounts.filter(a => !a.blocked && a.state !== 'BLOCKED' && getAccountActivePackages(a).length > 0).length} 个账号`;
                l2.textContent = '生效独立包'; v2.textContent = `${totalPackCount}`;
                l3.textContent = '1天内到期'; v3.textContent = threeDaysCredits.toLocaleString();
            } else if (ch === 'logs') {
                l1.textContent = '归档异常数'; v1.textContent = `${WBState.logs.length} 条`;
                l2.textContent = '自动故障转移'; v2.textContent = '—';
                l3.textContent = '隔离待授权'; v3.textContent = `${WBState.accounts.filter(a => a.state === 'BLOCKED').length}`;
            } else if (ch === 'encryption') {
                l1.textContent = '鉴权门禁'; v1.textContent = 'PBKDF2 保护';
                l2.textContent = '低额退池阈值'; v2.textContent = `< ${WBState.configThreshold}`;
                l3.textContent = '订阅定时刷新'; v3.textContent = `${WBState.configCacheHours} 小时`;
            } else {
                // Comments 13, 14, 15: 上方依次为 可用账号、账号额度、实时下行(或负载)
                let totalBal = 0;
                WBState.accounts.forEach(a => { if (!a.blocked && a.state !== 'BLOCKED' && typeof a.balance === 'number') totalBal += a.balance; });
                l1.textContent = '可用账号'; v1.textContent = `${routableAcc} / ${totalAcc}`;
                l2.textContent = '账号额度'; v2.textContent = totalBal.toLocaleString();
                l3.textContent = WBState.overviewMode === 'RESOURCE' ? 'CPU 实时负载' : '实时下行';
                v3.textContent = WBState.overviewMode === 'RESOURCE' ? (WBState.cpuAvailable ? WBState.cpuPct.toFixed(1) + '%' : '—') : (WBState.trafficAvailable ? `${WBState.downMbps.toFixed(1)} MB/s` : '—');
            }
        }

        function commitStageMarkup(container, innerHtml, animate) {
            if (animate) {
                container.innerHTML = `<div class="w-full editorial-soft-swap">${innerHtml}</div>`;
            } else {
                container.innerHTML = `<div class="w-full">${innerHtml}</div>`;
            }
        }

        // 无重绘悬停游标更新，防止打断 SVG 曲线从左向右蔓延入场动画 (Comment 12)
        window.hoverUsagePoint = (idx) => {
            const ds = WBState.usageRange === '24H' ? WBState.usage24h : WBState.usage6h;
            if (idx >= 0) {
                WBState.usageHoverIdx = idx;
                setVertexHover(idx * 3, `${ds.labels[idx]} // OUT ${ds.outVals[idx]}K`);
            } else {
                setVertexHover(-1);
                return; // 移开时不自动跳回默认时间！保持在最后悬停点
            }
            const hIdx = WBState.usageHoverIdx >= 0 ? WBState.usageHoverIdx : ds.labels.length - 1;
            const curX = ((hIdx / (ds.labels.length - 1)) * 520).toFixed(1);
            const lineEl = document.getElementById('usage-cursor-line');
            const labelEl = document.getElementById('usage-cursor-readout');
            if (lineEl) {
                lineEl.setAttribute('x1', curX);
                lineEl.setAttribute('x2', curX);
            }
            if (labelEl) {
                labelEl.innerHTML = `时刻 <strong class="text-white font-normal">${ds.labels[hIdx]}</strong> &mdash; 输出 ${ds.outVals[hIdx]}K / 输入 ${ds.inVals[hIdx]}K`;
            }
        };

        window.hoverErrorModelPoint = (idx) => {
            const em = WBState.errorModelSeries;
            if (idx >= 0) {
                WBState.logModelHoverIdx = idx;
                setVertexHover(idx * 2 + 1, `${em.labels[idx]} // L=${em.lambdaVals[idx].toFixed(2)}`);
            } else {
                setVertexHover(-1);
                return; // 移开时不自动跳回 16点！保持在最后悬停点
            }
            const hIdx = WBState.logModelHoverIdx >= 0 ? WBState.logModelHoverIdx : (em.labels.length - 1);
            const curX = ((hIdx / (em.labels.length - 1)) * 520).toFixed(1);
            const lineEl = document.getElementById('err-model-cursor-line');
            const labelEl = document.getElementById('err-model-readout');
            if (lineEl) {
                lineEl.setAttribute('x1', curX);
                lineEl.setAttribute('x2', curX);
            }
            if (labelEl) {
                labelEl.innerHTML = `时段 <strong class="text-white font-normal">${em.labels[hIdx]}</strong> &mdash; 强度 &lambda;(t) = <strong class="text-white font-normal">${em.lambdaVals[hIdx].toFixed(2)}</strong> / 观测 ${em.rawCounts[hIdx]} 次`;
            }
        };

        function renderEditorialStage(animate = false) {
            const container = document.getElementById('editorial-stage-body');
            if (!container) return;
            updateEditorialKeyFigures(false);
            syncDynamicBottomButtons();

            const ch = WBState.currentChapter;
            if (animate) {
                WBState.lastChartRevealAt = performance.now();
            }

            // 1. 系统概览 / 网关通道 / 谐振球体（带从左向右由快到慢蔓延曲线动画 Comment 12）
            if (ch === 'customization') {
                const cust = WBState.customization;
                const activeTab = cust.currentTab;

                // 选项卡头部：音频 / 文案 / 主题
                let tabHeader = `
                    <div class="flex items-center space-x-5 mb-2 shrink-0 text-left">
                        <button data-action="switch-customization-tab" data-tab="music" class="editorial-tab ${activeTab === 'music' ? 'active' : ''}">音频</button>
                        <button data-action="switch-customization-tab" data-tab="slogan" class="editorial-tab ${activeTab === 'slogan' ? 'active' : ''}">文案</button>
                        <button data-action="switch-customization-tab" data-tab="theme" class="editorial-tab ${activeTab === 'theme' ? 'active' : ''}">主题</button>
                    </div>
                `;

                let innerContent = '';
                const pageSize = 4;
                let totalPages = 1;

                if (cust.isAdding) {
                    if (activeTab === 'music') {
                        innerContent = `
                            <div class="space-y-4 pt-1 text-left font-mono max-w-lg">
                                <div class="border-b border-white/10 pb-3">
                                    <div class="text-[10px] tracking-[0.16em] text-white/40 uppercase mb-1">音乐名称 (英文/自定义)</div>
                                    <input id="custom-music-name-input" type="text" placeholder="e.g. Canopy Horizon 01" autocomplete="off" style="background-color: transparent !important; color: #ffffff !important;" class="editorial-input w-full font-mono text-white placeholder:text-neutral-600 text-xs">
                                </div>
                                <div class="border-b border-white/10 pb-3">
                                    <div class="text-[10px] tracking-[0.16em] text-white/40 uppercase mb-1">音频文件 (支持 MP3/WAV/FLAC)</div>
                                    <div class="flex items-center space-x-3 pt-1 w-full">
                                        <button type="button" data-action="trigger-music-input" class="editorial-text-btn text-white/75 hover:text-white text-left font-mono text-xs shrink-0">
                                            [ 选择本地音频文件 ]
                                        </button>
                                        <span id="custom-music-file-name" class="font-mono text-xs text-neutral-500 flex-1 min-w-0 whitespace-nowrap">未选择任何文件</span>
                                    </div>
                                    <input id="custom-music-file-hidden" type="file" accept="audio/*" class="hidden" data-action-change="custom-music-file">
                                </div>
                            </div>
                        `;
                    } else if (activeTab === 'slogan') {
                        innerContent = `
                            <div class="space-y-4 pt-1 text-left font-mono max-w-lg">
                                <div class="border-b border-white/10 pb-3">
                                    <div class="text-[10px] tracking-[0.16em] text-white/40 uppercase mb-1">文案标题</div>
                                    <input id="custom-slogan-name-input" type="text" placeholder="e.g. SILENT REALM" class="editorial-input w-full font-mono text-neutral-400 placeholder:text-neutral-600 text-xs">
                                </div>
                                <div class="border-b border-white/10 pb-3">
                                    <div class="text-[10px] tracking-[0.16em] text-white/40 uppercase mb-1">文案内容 (最多 50 字，手动敲回车换行)</div>
                                    <textarea id="custom-slogan-text-input" maxlength="50" rows="2" placeholder="输入首页展示文案..." class="editorial-input w-full font-mono text-neutral-400 placeholder:text-neutral-600 text-xs resize-none"></textarea>
                                </div>
                            </div>
                        `;
                    }
                } else {
                    let list = [];
                    if (activeTab === 'music') {
                        list = cust.musicList.slice().sort((a, b) => b.date.localeCompare(a.date));
                    } else if (activeTab === 'slogan') {
                        list = cust.sloganList.slice().sort((a, b) => b.date.localeCompare(a.date));
                    } else if (activeTab === 'theme') {
                        list = cust.themeList;
                    }

                    totalPages = Math.max(1, Math.ceil(list.length / pageSize));
                    if (typeof cust.page !== 'number') cust.page = 0;
                    if (cust.page >= totalPages) cust.page = totalPages - 1;
                    if (cust.page < 0) cust.page = 0;

                    const slice = list.slice(cust.page * pageSize, (cust.page + 1) * pageSize);

                    // 账号池标准风格：flex items-center text-xs text-left w-full
                    // 左侧主体：116px(日期/ID) minmax(0, 1fr)(核心文本) 48px(分类标识)
                    // 右侧操作：w-[32px] 启用/选择 + ml-2.5 w-[32px] 删除
                    if (activeTab === 'music') {
                        const rows = slice.map((m) => {
                            const isAct = (!cust.randomMusic && m.id === cust.activeMusicId);
                            const actBtn = isAct
                                ? `<span class="editorial-text-btn w-[32px] text-left shrink-0 tone-forced font-medium cursor-default">启用</span>`
                                : `<button data-action="select-custom-music" data-music-id="${m.id}" class="editorial-text-btn w-[32px] text-left shrink-0 text-white/60 hover:text-white transition-colors">选择</button>`;
                            const delBtn = (!m.isDefault && m.id !== 'm-default')
                                ? `<button data-action="delete-custom-music" data-music-id="${m.id}" class="editorial-text-btn w-[32px] text-left shrink-0 ml-2.5 text-white/35 hover:text-red-400 transition-colors" title="删除该音乐">删除</button>`
                                : `<span class="w-[32px] shrink-0 ml-2.5 inline-block"></span>`;
                            const tag = (m.isDefault || m.id === 'm-default')
                                ? `<span class="text-white/40 text-[10.5px] font-['Space_Grotesk'] tracking-wider text-left">内置</span>`
                                : `<span class="text-emerald-400/80 text-[10.5px] font-['Space_Grotesk'] tracking-wider text-left">本地</span>`;
                            return `
                                <div class="editorial-row py-2.5 flex items-center text-xs text-left w-full">
                                    <div class="grid items-center text-left flex-1 min-w-0" style="grid-template-columns: 116px minmax(0, 1fr); column-gap: 16px;">
                                        <span class="font-mono text-[11px] text-white/40 tabular-nums-left truncate">${escapeDisplayText(m.date)}</span>
                                        <span class="font-mono text-xs text-white/85 truncate pr-2" title="${escapeDisplayText(m.name)}">${escapeDisplayText(m.name)}</span>
                                    </div>
                                    <div class="flex items-center shrink-0 ml-4">
                                        ${actBtn}
                                        ${delBtn}
                                    </div>
                                </div>
                            `;
                        }).join('');
                        innerContent = `<div>${rows || '<div class="py-6 text-xs text-white/35 text-left">暂无音频记录</div>'}</div>`;
                    } else if (activeTab === 'slogan') {
                        const rows = slice.map((s) => {
                            const isAct = (!cust.randomMotto && s.id === cust.activeSloganId);
                            const actBtn = isAct
                                ? `<span class="editorial-text-btn w-[32px] text-left shrink-0 tone-forced font-medium cursor-default">启用</span>`
                                : `<button data-action="select-custom-slogan" data-slogan-id="${escapeDisplayText(s.id)}" class="editorial-text-btn w-[32px] text-left shrink-0 text-white/60 hover:text-white transition-colors">选择</button>`;
                            const delBtn = (s.id !== 's-1')
                                ? `<button data-action="delete-custom-slogan" data-slogan-id="${escapeDisplayText(s.id)}" class="editorial-text-btn w-[32px] text-left shrink-0 ml-2.5 text-white/35 hover:text-red-400 transition-colors" title="删除该文案">删除</button>`
                                : `<span class="w-[32px] shrink-0 ml-2.5 inline-block"></span>`;
                            const previewText = `${s.name} // ${s.text.replace(/\n+/g, ' // ')}`;
                            const isBuiltin = (s.id === 's-1' || s.id === 's-2' || s.id === 's-3');
                            const tag = isBuiltin
                                ? `<span class="text-white/40 text-[10.5px] font-['Space_Grotesk'] tracking-wider text-left">经典</span>`
                                : `<span class="text-white/45 text-[10.5px] font-['Space_Grotesk'] tabular-nums text-left">${s.text.length}字</span>`;
                            return `
                                <div class="editorial-row py-2.5 flex items-center text-xs text-left w-full">
                                    <div class="grid items-center text-left flex-1 min-w-0" style="grid-template-columns: 116px minmax(0, 1fr); column-gap: 16px;">
                                        <span class="font-mono text-[11px] text-white/40 tabular-nums-left truncate">${escapeDisplayText(s.date)}</span>
                                        <span class="font-mono text-xs text-white/85 fade-out-tail flex-1 min-w-0 pr-2" title="${escapeDisplayText(previewText)}">${escapeDisplayText(previewText)}</span>
                                    </div>
                                    <div class="flex items-center shrink-0 ml-4">
                                        ${actBtn}
                                        ${delBtn}
                                    </div>
                                </div>
                            `;
                        }).join('');
                        innerContent = `<div>${rows || '<div class="py-6 text-xs text-white/35 text-left">暂无文案记录</div>'}</div>`;
                    } else if (activeTab === 'theme') {
                        const rows = slice.map((t) => {
                            const isAct = (!cust.randomTheme && t.id === cust.activeTheme);
                            const actBtn = isAct
                                ? `<span class="editorial-text-btn w-[32px] text-left shrink-0 tone-forced font-medium cursor-default">启用</span>`
                                : `<button data-action="select-custom-theme" data-theme-id="${t.id}" class="editorial-text-btn w-[32px] text-left shrink-0 text-white/60 hover:text-white transition-colors">选择</button>`;
                            const cleanName = t.name.replace(/^[A-Z]+\s*\/\/\s*/, '');
                            const tag = `<span class="text-white/40 text-[10.5px] font-['Space_Grotesk'] tracking-wider text-left">预设</span>`;
                            return `
                                <div class="editorial-row py-2.5 flex items-center text-xs text-left w-full">
                                    <div class="grid items-center text-left flex-1 min-w-0" style="grid-template-columns: 116px minmax(0, 1fr); column-gap: 16px;">
                                        <span class="font-mono text-[11px] text-white/40 tracking-wider truncate">${t.id.toUpperCase()}</span>
                                        <span class="font-mono text-xs text-white/85 truncate pr-2" title="${cleanName}">${cleanName}</span>
                                    </div>
                                    <div class="flex items-center shrink-0 ml-4">
                                        ${actBtn}
                                        <span class="w-[32px] shrink-0 ml-2.5 inline-block"></span>
                                    </div>
                                </div>
                            `;
                        }).join('');
                        innerContent = `<div>${rows || '<div class="py-6 text-xs text-white/35 text-left">暂无主题记录</div>'}</div>`;
                    }
                }

                commitStageMarkup(container, `<div class="w-full flex flex-col justify-start text-left">${tabHeader}${innerContent}</div>`, animate);
                renderPagerControls(cust.page || 0, totalPages, 'changeCustomizationPage', totalPages > 1);
                return;
            } else if (ch === 'sphere') {
                const markup = `
                    <div class="space-y-3.5 text-left font-mono">
                        <div class="border-b border-white/10 pb-2">
                            <div class="text-[11px] tracking-[0.14em] text-white/40 uppercase mb-1">项目简介</div>
                            <div class="text-xs text-white/85">这是一款中等量级work buddy账号额度反向代理网页服务系统</div>
                        </div>
                        <div class="grid grid-cols-2 gap-4 border-b border-white/10 pb-2">
                            <div>
                                <div class="text-[11px] tracking-[0.14em] text-white/40 uppercase mb-1">网关端点</div>
                                <div class="text-xs text-white/85">127.0.0.1:7863 / V1</div>
                            </div>
                            <div>
                                <div class="text-[11px] tracking-[0.14em] text-white/40 uppercase mb-1">运行健康</div>
                                <div class="text-xs text-emerald-400">100% HEALTHY / ZERO DOWNTIME</div>
                            </div>
                        </div>
                        <div class="text-[11px] text-white/50 leading-relaxed">
                            极简空间感知与硬件共鸣。所有会话数据与凭据均在本地受 PBKDF2 与 AES-256-GCM 双层隔离保护。
                        </div>
                    </div>
                `;
                commitStageMarkup(container, markup, animate);
                return;
            } else if (ch === 'overview' || ch === 'gateway' || ch === 'sphere') {
                const isRes = WBState.overviewMode === 'RESOURCE';
                const primaryArr = isRes ? WBState.cpuHistory : WBState.upHistory;
                const secondaryArr = isRes ? WBState.memHistory : WBState.downHistory;
                const [pPts, sPts] = overviewChartPoints(primaryArr, secondaryArr);

                const headerLeft = isRes ? '系统资源变动曲线（CPU负载 / 服务总内存）' : '吞吐呼吸曲线（上行速率 / 下行速率）';
                const headerRight = isRes
                    ? ('CPU负载 ' + (WBState.cpuAvailable ? WBState.cpuPct.toFixed(1) + '%' : '—') + ' / 服务总内存 ' + (WBState.serviceMemoryAvailable ? WBState.memMb.toFixed(1) + ' MB' : '—'))
                    : (WBState.trafficAvailable
                        ? '上行速率 ' + WBState.upMbps.toFixed(2) + ' MB/s / 下行速率 ' + WBState.downMbps.toFixed(2) + ' MB/s'
                        : '上行速率 — / 下行速率 —');
                const metric1Label = isRes ? '服务总内存' : '实时上行';
                const metric1Val = isRes
                    ? (WBState.serviceMemoryAvailable ? WBState.memMb.toFixed(1) + ' MB' : '—')
                    : (WBState.trafficAvailable ? WBState.upMbps.toFixed(2) + ' MB/s' : '—');
                const metric1Hover = isRes ? `MEM // ${WBState.memMb.toFixed(1)}MB` : `UP // ${WBState.upMbps.toFixed(2)}MB/s`;

                const clipId = 'ov-clip-' + (++WBState.chartClipSeq);
                const clipDef = animate ? ('<defs><clipPath id="' + clipId + '"><rect x="0" y="-6" width="540" height="84" class="svg-clip-spread-rect" /></clipPath></defs>') : '';
                const clipAttr = animate ? ('clip-path="url(#' + clipId + ')"') : '';

                commitStageMarkup(container, `
                    <div class="flex flex-col justify-start space-y-4 pt-1">
                        <div>
                            <div class="flex justify-between items-center text-[10px] tracking-[0.15em] text-white/42 mb-2 h-[16px] shrink-0">
                                <span id="ov-header-left" class="overflow-hidden whitespace-nowrap">${headerLeft}</span>
                                <span id="ov-header-right" class="text-white/70 tabular-nums-left overflow-hidden whitespace-nowrap">${headerRight}</span>
                            </div>
                            <svg viewBox="0 0 520 70" class="w-full h-[70px] overflow-visible">
                                ${clipDef}
                                <line x1="0" y1="68" x2="520" y2="68" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
                                <g ${clipAttr}>
                                    <polyline id="ov-poly-primary" fill="none" stroke="rgba(255,255,255,0.88)" stroke-width="1.35" points="${pPts}" />
                                    <polyline id="ov-poly-secondary" fill="none" stroke="rgba(255,255,255,0.40)" stroke-width="1.1" stroke-dasharray="3 4" points="${sPts}" />
                                </g>
                            </svg>
                        </div>
                        <div class="grid grid-cols-4 gap-6 pt-1 text-[11px] text-left h-[44px] shrink-0">
                            <div id="ov-cell-metric1" data-hover-vertex="0" data-hover-label="${metric1Hover}">
                                <div id="ov-lbl-metric1" class="text-[9.5px] tracking-[0.14em] text-white/36 mb-1 whitespace-nowrap">${metric1Label}</div>
                                <div id="ov-val-mem" class="text-white/88 tabular-nums-left whitespace-nowrap">${metric1Val}</div>
                            </div>
                            <div data-hover-vertex="4" data-hover-label="UPTIME // ${formatUptime(WBState.uptimeSec)}">
                                <div class="text-[9.5px] tracking-[0.14em] text-white/36 mb-1 whitespace-nowrap">启动时间</div>
                                <div id="ov-val-uptime" class="text-white/88 tabular-nums-left whitespace-nowrap">${formatUptime(WBState.uptimeSec)}</div>
                            </div>
                            <div data-hover-vertex="8" data-hover-label='PORT // 7863'>
                                <div class="text-[9.5px] tracking-[0.14em] text-white/36 mb-1 whitespace-nowrap">监听端点</div>
                                <div class="text-white/88 tabular-nums-left whitespace-nowrap">127.0.0.1:7863</div>
                            </div>
                            <div data-hover-vertex="12" data-hover-label="CACHE">
                                <div class="text-[9.5px] tracking-[0.14em] text-white/36 mb-1 whitespace-nowrap">缓存命中</div>
                                <div class="text-white/88 tabular-nums-left whitespace-nowrap">${WBState.usageCacheHitRate == null ? '—' : WBState.usageCacheHitRate.toFixed(1) + '%'}</div>
                            </div>
                        </div>
                    </div>
                `, animate);
                renderPagerControls(0, 1, '');
                return;
            }

            // 2. 账号池 (accounts)：
            // - Comment 2: 去除 #7890ab 等编号
            // - Comment 3: CN/GLOBAL 左移，除最后出口和启用外全部统一向左对齐等宽间距
            // - Comment 14/15: 删除右上辅助提示字
            // - Comment 20: 独立出口节点选择页面重构（3列网格分页、1号1出口互斥变灰、<800绿色/>=800橙色、超时与不可选统一后置）
            if (ch === 'accounts') {
                if (WBState.selectedAccountUid || WBState.selectingSystemDefault) {
                    const isSystemDefault = Boolean(WBState.selectingSystemDefault);
                    let acc = null;
                    let targetTitle = '';
                    let targetRegion = '';
                    let targetEgress = '';
                    let curModeLabel = '';
                    let targetUid = '';

                    if (isSystemDefault) {
                        targetTitle = '系统全局默认出口';
                        targetRegion = 'CN / GLOBAL';
                        const defN = WBState.nodes.find(n => n.id === WBState.systemDefaultNode);
                        targetEgress = defN ? defN.name : (WBState.systemDefaultNode ? '已配置出口' : '未指定（本机直连）');
                        curModeLabel = '全局出网';
                        targetUid = '__SYSTEM__';
                    } else {
                        acc = WBState.accounts.find(a => a.uid === WBState.selectedAccountUid);
                        if (!acc) return;
                        const rawLow = isRawLowBalance(acc);
                        curModeLabel = '正常选号';
                        if (acc.state === 'BLOCKED' || acc.blocked) curModeLabel = '启用';
                        else if (!acc.manualOn) curModeLabel = '已停用';
                        else if (rawLow && !acc.forceOverride) curModeLabel = '低额保护';
                        else if (rawLow && acc.forceOverride) curModeLabel = '强行启用';
                        targetTitle = acc.name;
                        targetRegion = acc.region;
                        targetEgress = acc.egress;
                        targetUid = acc.uid;
                    }

                    // 进入详情时锁定展示顺序；支持按名称与按延迟实时切换
                    if (!WBState.frozenAccountNodeIds || WBState.frozenAccountNodesUid !== targetUid) {
                        const initialList = WBState.nodes.map(n => {
                            const isCurrent = isSystemDefault
                                ? (n.id === WBState.systemDefaultNode)
                                : (IS_PROD_ENV ? (n.id === acc.egressNodeId || n.name === acc.egress) : n.name === acc.egress);
                            const owner = isSystemDefault ? null : WBState.accounts.find(a => a.uid !== acc.uid && (IS_PROD_ENV ? a.egressNodeId === n.id : a.egress === n.name));
                            const isOccupied = Boolean(owner);
                            const isUnavailable = Boolean(n.timeout || n.status === 'error');
                            let rankGroup = 0;
                            if (isCurrent) rankGroup = -1;
                            else if (isOccupied) rankGroup = 1;
                            else if (isUnavailable) rankGroup = 2;
                            else rankGroup = 0;
                            return { id: n.id, name: n.name, rankGroup, ping: n.ping || 9999 };
                        }).sort((a, b) => {
                            if (a.rankGroup !== b.rankGroup) return a.rankGroup - b.rankGroup;
                            if (WBState.accountNodeSortMode === 'NAME') {
                                return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
                            }
                            return (a.ping || 9999) - (b.ping || 9999);
                        });
                        WBState.frozenAccountNodeIds = initialList.map(n => n.id);
                        WBState.frozenAccountNodesUid = targetUid;
                    }

                    const orderedNodes = WBState.frozenAccountNodeIds.map(id => WBState.nodes.find(n => n.id === id)).filter(Boolean);
                    WBState.nodes.forEach(n => { if (!WBState.frozenAccountNodeIds.includes(n.id)) orderedNodes.push(n); });

                    const decoratedNodes = orderedNodes.map(n => {
                        const owner = isSystemDefault ? null : WBState.accounts.find(a => a.uid !== acc.uid && (IS_PROD_ENV ? a.egressNodeId === n.id : a.egress === n.name));
                        const isCurrent = isSystemDefault
                            ? (n.id === WBState.systemDefaultNode)
                            : (IS_PROD_ENV ? (n.id === acc.egressNodeId || n.name === acc.egress) : n.name === acc.egress);
                        const isOccupied = Boolean(owner);
                        const isTimeout = Boolean(n.timeout);
                        return { ...n, owner, isCurrent, isOccupied, isTimeout };
                    });

                    const nodesPerPage = 9; // 3 列 × 3 行
                    const totalNodePages = Math.max(1, Math.ceil(decoratedNodes.length / nodesPerPage));
                    if (WBState.accountNodePage >= totalNodePages) WBState.accountNodePage = totalNodePages - 1;
                    const nodeSlice = decoratedNodes.slice(WBState.accountNodePage * nodesPerPage, (WBState.accountNodePage + 1) * nodesPerPage);

                    const nodeCellsHtml = nodeSlice.map(n => {
                        const disabled = Boolean(n.isTimeout || n.timeout || n.status === 'error' || n.status === 'timeout');
                        let nameCls = 'text-white/82';
                        let rightHtml = '';

                        const latencyLabel = Boolean(n.timeout || n.status === 'error') ? '超时' : n.status === 'untested' ? '未测速' : n.status === 'testing' ? '测速中' : `${n.ping}ms`;
                        const isDead = Boolean(latencyLabel === '超时' || n.isTimeout || n.timeout || n.status === 'error' || n.status === 'timeout' || (typeof n.ping === 'number' && n.ping >= 9999));
                        const latencyClass = isDead ? 'tone-fault' : n.status === 'untested' || n.status === 'testing' ? 'text-white/45' : n.ping < 800 ? 'tone-forced' : 'tone-guard';

                        let borderStyle = '';
                        let borderCls = '';

                        if (isDead) {
                            nameCls = 'text-white/28';
                            borderCls = 'cursor-not-allowed';
                            borderStyle = 'border-bottom: none !important; border-bottom-width: 0 !important;';
                            rightHtml = `<span class="text-[10.5px] tone-fault opacity-80 whitespace-nowrap shrink-0">超时</span>`;
                        } else if (n.isCurrent) {
                            nameCls = 'text-white font-medium';
                            borderCls = 'bg-white/[0.05] cursor-pointer';
                            borderStyle = 'border-bottom: 1px solid rgba(255,255,255,0.8) !important;';
                            rightHtml = `<span class="text-[10.5px] ${latencyClass} tabular-nums-left whitespace-nowrap">${latencyLabel}</span>`;
                        } else if (n.isOccupied) {
                            nameCls = 'text-white/70';
                            borderCls = 'hover:border-white/40 cursor-pointer';
                            borderStyle = 'border-bottom: 1px solid rgba(255,255,255,0.1) !important;';
                            rightHtml = n.status === 'error'
                                ? `<span class="text-[10px] tone-fault tabular-nums-left whitespace-nowrap shrink-0">超时</span>`
                                : `<span class="text-[10px] tone-guard tabular-nums-left whitespace-nowrap shrink-0">已绑定</span>`;
                        } else {
                            borderCls = 'hover:border-white/40 cursor-pointer';
                            borderStyle = 'border-bottom: 1px solid rgba(255,255,255,0.1) !important;';
                            rightHtml = `<span class="text-[10.5px] ${latencyClass} tabular-nums-left whitespace-nowrap">${latencyLabel}</span>`;
                        }

                        let clickAttr = disabled ? '' : (isSystemDefault
                            ? `data-action="select-default-egress" data-node="${escapeDisplayText(n.id)}"`
                            : `data-action="bind-egress" data-uid="${escapeDisplayText(acc.uid)}" data-node="${escapeDisplayText(IS_PROD_ENV ? n.id : n.name)}"`);

                        return `
                            <div ${clickAttr} style="${borderStyle}" class="flex min-w-0 justify-between items-center gap-2 px-2 py-2 ${borderCls} transition-colors text-left">
                                <span class="text-[11px] ${nameCls} min-w-0 flex-1 fade-truncate" title="${escapeDisplayText(n.name)}">${escapeDisplayText(n.name)}</span>
                                ${rightHtml}
                            </div>
                        `;
                    }).join('');

                    const topActionHtml = isSystemDefault
                        ? `<button class="editorial-text-btn text-white" data-action="select-default-egress" data-node="">[恢复本机直连]</button>`
                        : `<button class="editorial-text-btn text-white" data-action="toggle-account-manual" data-uid="${escapeDisplayText(acc.uid)}">[${curModeLabel}]</button>`;

                    commitStageMarkup(container, `
                        <div class="space-y-3 text-left">
                            <div class="flex justify-between items-center border-b border-white/10 pb-2">
                                <div class="flex items-center space-x-4 text-xs text-left">
                                    <span class="text-white font-medium">${escapeDisplayText(targetTitle)}</span>
                                    <span class="text-white/40 text-[11px]">${escapeDisplayText(targetRegion)}</span>
                                    ${(!isSystemDefault && (acc.state === 'BLOCKED' || acc.state === 'TOKEN_EXPIRED' || acc.state === 'UNAUTHORIZED')) ? '' : (!isSystemDefault ? `<span class="text-white/42 text-[11px] tabular-nums-left">熔断 ${escapeDisplayText(acc.breakerAt || '—')}</span>` : '')}
                                    ${topActionHtml}
                                </div>
                            </div>
                            <div class="flex justify-between items-center text-[10px] tracking-[0.12em] text-white/40">
                                <span>${isSystemDefault ? '系统默认出口' : '账号绑定出口'}（当前：<strong class="text-white font-normal">${escapeDisplayText(targetEgress)}</strong>）</span>
                                <span class="space-x-3">
                                    <span class="tone-forced">&lt;800ms</span>
                                    <span class="tone-guard">&ge;800ms</span>
                                    <span class="text-white/28">超时不可选择</span>
                                </span>
                            </div>
                            <div class="grid grid-cols-3 gap-x-4 gap-y-1.5 pt-0.5">
                                ${nodeCellsHtml}
                            </div>
                        </div>
                    `, animate);
                    renderPagerControls(WBState.accountNodePage, totalNodePages, 'changeAccountNodePage', true);
                    return;
                }


                                if (WBState.accountSubmode) {
                    commitStageMarkup(container, `
                        <div class="space-y-2.5 text-left">
                            <div class="flex justify-between items-center border-b border-white/10 pb-1.5 mb-0.5">
                                <div class="flex items-center space-x-6 text-xs text-left">
                                    <button class="editorial-tab ${WBState.loginRealm==='CN'?'active':''}" data-action="switch-login-realm" data-realm="CN">CN 国内域</button>
                                    <button class="editorial-tab ${WBState.loginRealm==='GLOBAL'?'active':''}" data-action="switch-login-realm" data-realm="GLOBAL">GLOBAL 国际域</button>
                                </div>
                            </div>
                            <div class="space-y-2 pt-0.5 text-left">
                                <div>
                                    <div class="text-[11.5px] tracking-[0.12em] text-white/45 mb-1">设备代码授权端点（完成浏览器授权后自动载入池中）</div>
                                    <div class="text-[12.5px] font-mono text-white/90 border-b border-white/15 pb-1 max-w-xl fade-truncate selectable-text">${escapeDisplayText(WBState.loginAuthUrl || '请点击下方按钮获取授权链接')}</div>
                                </div>
                                <div class="flex items-center space-x-3 py-0.5 max-w-xl whitespace-nowrap">
                                    <button id="btn-oauth-action" class="editorial-text-btn shrink-0 ${WBState.oauthWaiting ? 'oauth-polling-pulse animate-pulse text-yellow-400 font-medium' : 'text-white'} text-[11.5px] px-0.5" data-action="open-oauth">${WBState.oauthWaiting ? '[ 授权等待中... ]' : '[ 跳转浏览器授权 &rarr; ]'}</button>
                                    <button class="editorial-text-btn shrink-0 text-[11.5px] px-0.5 text-white/70 hover:text-white" data-action="reset-oauth">[ 重置 ]</button>
                                    <button id="btn-oauth-status" class="editorial-text-btn shrink-0 text-[11.5px] px-0.5" data-action="copy-oauth">[ 复制授权链接 ]</button>
                                    <span class="text-white/20 shrink-0">|</span>
                                    ${(() => {
                                        const n = WBState.nodes.find(item => item.id === WBState.systemDefaultNode);
                                        const btnCls = n ? (n.ping < 800 ? 'tone-forced font-medium' : 'tone-guard font-medium') : 'text-white/60 hover:text-white';
                                        if (!n) {
                                            const label = WBState.systemDefaultNodeName || (WBState.systemDefaultNode ? '已配置出口' : '未指定 (严禁直连)');
                                            const defaultBtnCls = n ? (n.ping < 800 ? 'tone-forced font-medium' : 'tone-guard font-medium') : 'text-amber-400/80 font-medium';
                                            return `<button class="editorial-text-btn shrink-0 text-[11.5px] px-0.5 ${defaultBtnCls}" data-action="open-default-egress-stage" title="选择默认出网节点">[ 默认出口: ${escapeDisplayText(label)} ▾ ]</button>`;
                                        }
                                        const rawName = String(n.name || '').trim();
                                        // 纯文本截断：超过 9 个字符以三个点省略号截断，去除延迟，括号与箭头绝对完整闭合
                                        const displayName = rawName.length > 9 ? rawName.slice(0, 9) + '...' : rawName;
                                        return `<button class="editorial-text-btn shrink-0 text-[11.5px] px-0.5 ${btnCls}" data-action="open-default-egress-stage" title="${escapeDisplayText(rawName)} // 点击更换全局默认出网出口">[ 默认出口: ${escapeDisplayText(displayName)} ▾ ]</button>`;
                                    })()}
                                </div>
                                ${WBState.pickingDefaultEgress ? `
                                    <div class="mt-2 p-3 bg-white/[0.03] border border-white/10 rounded-sm space-y-2 max-w-xl">
                                        <div class="flex justify-between items-center text-[10.5px] text-white/50 tracking-wider">
                                            <span>选择系统默认出网节点（仅用于登录授权与未指定账号）</span>
                                            <button class="editorial-text-btn text-white/40 hover:text-red-400" data-action="select-default-egress" data-node="">[ 恢复本机直连 ]</button>
                                        </div>
                                        <div class="grid grid-cols-3 gap-2 pt-1">
                                            ${WBState.nodes.slice(0, 9).map(n => {
                                                const isTimeout = Boolean(n.timeout || n.status === 'error' || (typeof n.ping === 'number' && n.ping >= 9999));
                                                const isSelected = n.id === WBState.systemDefaultNode;
                                                const borderCls = isSelected ? 'border-white/80 bg-white/[0.08]' : (isTimeout ? 'border-white/[0.05] opacity-35 cursor-not-allowed' : 'border-white/10 hover:border-white/40 cursor-pointer');
                                                const clickAttr = isTimeout ? '' : `data-action="select-default-egress" data-node="${escapeDisplayText(n.id)}"`;
                                                return `
                                                    <div ${clickAttr} class="flex justify-between items-center px-2 py-1.5 border ${borderCls} text-[10.5px]">
                                                        <span class="truncate flex-1 text-left ${isSelected ? 'text-white font-medium' : 'text-white/75'}" title="${escapeDisplayText(n.name)}">${escapeDisplayText(n.name)}</span>
                                                        <span class="${isTimeout ? 'tone-fault' : n.ping < 800 ? 'tone-forced' : 'tone-guard'} text-[9.5px] ml-1 shrink-0">${isTimeout ? '超时' : n.ping + 'ms'}</span>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                    </div>
                                ` : ''}
                                <!-- 凭据导入：与上方设备代码授权端点保持完全一致的紧凑留白与底线间距 -->
                                <div class="mt-2 pt-1 border-t border-white/10">
                                    <div class="text-[11.5px] tracking-[0.12em] text-white/45 mb-1 flex items-center"><span class="inline-block w-1.5 h-1.5 rounded-full bg-white/40 mr-1.5"></span><span>导入账号凭据 JSON（单个对象或数组）</span></div>
                                    <div class="max-w-xl">
                                        <textarea id="inp-account-credentials" class="editorial-input credential-paste w-full font-mono text-[12.5px] text-white/90 border-b border-white/15 pb-1" rows="1" style="height:26px; min-height:26px; resize:none; padding-top:2px; padding-bottom:2px; scrollbar-width:none; -ms-overflow-style:none;" wrap="off" autocomplete="off" placeholder="粘贴凭据 JSON"></textarea>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `, animate);
                    renderPagerControls(0, 1, '');
                    return;
                }

                const filtered = WBState.accounts.filter(a => {
                    if (WBState.accountFilter === 'ROUTABLE') return isAccountRoutable(a);
                    if (WBState.accountFilter === 'GUARD') return isLowBalanceProtected(a) || a.state !== 'HEALTHY' || (a.manualOn && isRawLowBalance(a) && a.forceOverride);
                    if (WBState.accountFilter === 'OFF') return !a.manualOn;
                    return true;
                });

                const pageSize = 4;
                const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
                if (WBState.accountPage >= totalPages) WBState.accountPage = totalPages - 1;
                const slice = filtered.slice(WBState.accountPage * pageSize, (WBState.accountPage + 1) * pageSize);

                // Comment 2 & 3: 去除 #7890ab，CN/GLOBAL 左移，除最后出口和启用外，前 4 列统一向左对齐 + 等宽间距 (column-gap: 20px)
                const rowsHtml = slice.map((acc, idx) => {
                    const rawLow = isRawLowBalance(acc);
                    const lowProtected = isLowBalanceProtected(acc);
                    const forcedOn = acc.manualOn && rawLow && acc.forceOverride;
                    const quotaStr = acc.unlimited ? 'UNLIMITED' : acc.balance.toLocaleString();

                    let statusText = '正常';
                    let statusCls = 'tone-normal';
                    let actionLabel = '停用';

                    // Comment 1: 出现令牌隔离这种严重报错的时候，无论是否停用或启用，均显示令牌隔离
                    const isTokenBlocked = (acc.state === 'BLOCKED' || acc.state === 'TOKEN_EXPIRED' || acc.state === 'UNAUTHORIZED');
                    if (isTokenBlocked) {
                        statusText = '令牌隔离';
                        statusCls = 'tone-fault';
                        actionLabel = '启用';
                    } else if (!acc.manualOn) {
                        statusText = '停用';
                        statusCls = 'tone-paused';
                        actionLabel = '启用';
                    } else if (lowProtected) {
                        statusText = '低额保护';
                        statusCls = 'tone-guard';
                        actionLabel = '启用';
                    } else if (forcedOn) {
                        statusText = '强行启用';
                        statusCls = 'tone-forced';
                        actionLabel = '停用';
                    } else if (acc.state === 'COOLING') {
                        statusText = '限流冷却';
                        statusCls = 'tone-guard';
                        actionLabel = '停用';
                    }

                    // 出口检测连通性着色：出口变色而非账号归属地变色 (通=绿色, 不通=红色, 相同地区=黄色)
                    let regionCls = 'text-white/45';
                    let egressCls = 'text-white/65 hover:text-white';
                    if (WBState.egressProbed) {
                        // 依规范：变色作用于出口节点而非国家分类。独占地区=绿色，同地区/未分配=黄色，超时=红色
                        if (acc._probeResult === 'FAIL') egressCls = 'tone-fault font-medium underline';
                        else if (acc._probeResult === 'DUPLICATE' || acc._probeResult === 'LOCAL') egressCls = 'tone-guard font-medium';
                        else if (acc._probeResult === 'PASS') egressCls = 'tone-forced font-medium';
                    }

                    const vIdx = (WBState.accountPage * pageSize + idx) * 2;
                    // 账号池排版重构：取消两端散开的 justify-between，改为一体化紧凑等宽流式对齐
                    // 消除原先“状态”与“出口”之间多达 150px 的超大空隙，间隙收拢为舒适的 32px
                    // 账号名采用 font-mono 与 108px 充足宽度，完全容纳 11 位数字账号，绝不触发边缘渐隐
                    return `
                        <div class="editorial-row py-2.5 flex items-center text-xs text-left w-full"
                             data-hover-vertex="${vIdx}" data-hover-label="ACC // ${acc.name.toUpperCase()}"
                             >
                            <div class="grid items-center text-left cursor-pointer shrink-0"
                                 style="grid-template-columns: 108px 46px 74px 62px; column-gap: 10px;"
                                 data-action="select-account-egress" data-uid="${escapeDisplayText(acc.uid)}" data-name="${acc.name}">
                                <span class="text-white font-mono text-[11.5px] tracking-tight text-left truncate" title="${acc.name}">${acc.name}</span>
                                <span class="${regionCls} text-[10.5px] font-['Space_Grotesk'] text-left tracking-wider" title="地区状态">${acc.region}</span>
                                <span class="text-white/90 font-['Space_Grotesk'] tabular-nums text-left">${quotaStr}</span>
                                <span class="text-[11px] ${statusCls} text-left tracking-tight">${statusText}</span>
                            </div>
                            <div class="flex items-center shrink-0 ml-8">
                                <button class="editorial-text-btn w-[86px] max-w-[86px] text-left truncate ${egressCls}" title="点击更换绑定出口"
                                        data-action="select-account-egress" data-uid="${escapeDisplayText(acc.uid)}" data-name="${acc.name}">${acc.egress}</button>
                                <button class="editorial-text-btn w-[30px] text-left shrink-0 ml-3.5" data-action="toggle-account-manual" data-uid="${escapeDisplayText(acc.uid)}">${actionLabel}</button>
                                <button class="editorial-text-btn w-[30px] text-left shrink-0 ml-2.5 text-white/35 hover:text-red-400 transition-colors" title="永久删除该账号" data-action="delete-account" data-uid="${escapeDisplayText(acc.uid)}">删除</button>
                            </div>
                        </div>
                    `;
                }).join('');

                commitStageMarkup(container, `
                    <div>
                        <div class="flex items-center space-x-5 mb-2 text-left">
                            <button class="editorial-tab ${WBState.accountFilter==='ALL'?'active':''}" data-action="set-account-filter" data-filter="ALL">全部</button>
                            <button class="editorial-tab ${WBState.accountFilter==='ROUTABLE'?'active':''}" data-action="set-account-filter" data-filter="ROUTABLE">可用</button>
                            <button class="editorial-tab ${WBState.accountFilter==='GUARD'?'active':''}" data-action="set-account-filter" data-filter="GUARD">保护与冷却</button>
                            <button class="editorial-tab ${WBState.accountFilter==='OFF'?'active':''}" data-action="set-account-filter" data-filter="OFF">手动停用</button>
                        </div>
                        <div>${rowsHtml || '<div class="py-6 text-xs text-white/35 text-left">当前筛选下暂无账号记录</div>'}</div>
                    </div>
                `, animate);
                renderPagerControls(WBState.accountPage, totalPages, 'changeAccountPage', true);
                return;
            }

            // 3. 账号出口 (egress)：
            // - Comment 5: 订阅来源右侧增加“选择”，点击变为橙色“启用”并切换节点列表展示的订阅源
            // - Comment 6: 订阅 URL 最多占当前页面 1/3 宽度，剩余省略号
            // - Comment 7: 节点列表右侧操作由“设为主用”改为“刷新”
            // - Comment 21: 节点列表前面为节点名，中间为绑定该节点的账号名称
            if (ch === 'egress') {
                if (WBState.importingSub) {
                    commitStageMarkup(container, `
                        <div class="space-y-4">
                            <div class="flex justify-between items-center border-b border-white/10 pb-2.5">
                                <span class="text-[11px] tracking-[0.16em] text-white/85">导入节点订阅链接</span>
                            </div>
                            <div class="grid grid-cols-3 gap-6 text-left">
                                <div data-hover-vertex="2" data-hover-label='NAME // 订阅名称'
                                     >
                                    <div class="text-[9.5px] tracking-[0.14em] text-white/38 mb-1">订阅名称</div>
                                    <input id="inp-sub-name" class="editorial-input w-full" value="新增专线订阅"
                                           data-hover-vertex="2" data-hover-label='NAME // 订阅名称'
                                           data-hover-vertex="2" data-hover-label="NAME // 订阅名称"
                                           data-hover-vertex="2" data-hover-label="NAME // 订阅名称"
                                           data-hover-vertex="2" data-hover-label="NAME // 订阅名称"
                                           
                                            />
                                </div>
                                <div class="col-span-2"
                                     data-hover-vertex="7" data-hover-label='URL // 订阅地址'
                                     >
                                    <div class="text-[9.5px] tracking-[0.14em] text-white/38 mb-1">订阅地址 URL</div>
                                    <input id="inp-sub-url" class="editorial-input w-full" placeholder="https://..."
                                           data-hover-vertex="7" data-hover-label='URL // 订阅地址'
                                           data-hover-vertex="7" data-hover-label="URL // 订阅地址"
                                           data-hover-vertex="7" data-hover-label="URL // 订阅地址"
                                           data-hover-vertex="7" data-hover-label="URL // 订阅地址"
                                           
                                            />
                                </div>
                            </div>
                            <div class="pt-1 text-left">
                            </div>
                        </div>
                    `, animate);
                    ['inp-sub-name', 'inp-sub-url'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.addEventListener('keydown', (e) => {
                                if (e.key === 'Enter' || e.keyCode === 13) {
                                    if (e.preventDefault) e.preventDefault();
                                    confirmImportSub();
                                }
                            });
                        }
                    });
                    renderPagerControls(0, 1, '');
                    return;
                }

                const subNodes = getActiveSubNodes();
                let innerListHtml = '';
                let totalPages = 1;

                if (WBState.egressTab === 'NODES') {
                    const pageSize = 4;
                    totalPages = Math.max(1, Math.ceil(subNodes.length / pageSize));
                    if (WBState.egressPage >= totalPages) WBState.egressPage = totalPages - 1;
                    const slice = subNodes.slice(WBState.egressPage * pageSize, (WBState.egressPage + 1) * pageSize);

                    innerListHtml = slice.map((n, idx) => {
                        const boundAccounts = WBState.accounts.filter(a => IS_PROD_ENV ? a.egressNodeId === n.id : a.egress === n.name);
                        const boundCount = IS_PROD_ENV ? (n.bindingCount ?? boundAccounts.length) : boundAccounts.length;
                        const accLabel = boundCount > 1 ? `${boundCount} 个账号` : (boundAccounts[0]?.name || (boundCount ? '1 个账号' : '未绑定'));
                        const accCls = boundCount === 0 ? 'text-white/30' : (n.timeout || n.status === 'error' ? 'tone-fault' : boundCount > 1 ? 'tone-guard' : 'tone-forced');
                        const pingTxt = n.status === 'testing' ? '测速中' : n.timeout ? '超时' : n.status === 'error' ? '失败' : IS_PROD_ENV && n.status === 'untested' ? '未测速' : `${n.ping} ms`;
                        const pingCls = n.timeout || n.status === 'error' ? 'tone-fault' : n.status === 'testing' || n.status === 'untested' ? 'tone-guard' : (n.ping < 800 ? 'tone-forced' : 'tone-guard');

                        return `
                            <div class="editorial-row py-2.5 grid items-center gap-x-5 text-xs text-left"
                                 style="grid-template-columns: minmax(0, 1fr) 110px 64px 72px 44px;"
                                 data-hover-vertex="${idx * 5 + 2}" data-hover-label='${escapeDisplayText(n.name)} // ${n.timeout ? 'TIMEOUT' : n.ping + 'MS'}'>
                                <span class="text-white font-medium min-w-0 fade-truncate text-left" title="${escapeDisplayText(n.name)}">${escapeDisplayText(n.name)}</span>
                                <span class="${accCls} text-[11.5px] max-w-[130px] fade-truncate text-left">${escapeDisplayText(accLabel)}</span>
                                <div>${renderHairlineSpark(n.trend, 64, 15, animate)}</div>
                                <span class="${pingCls} font-['Space_Grotesk'] tabular-nums-left text-left">${pingTxt}</span>
                                <button class="editorial-text-btn text-left" data-action="probe-node" data-node-id="${escapeDisplayText(n.id)}">刷新</button>
                            </div>
                        `;
                    }).join('');
                    renderPagerControls(WBState.egressPage, totalPages, 'changeEgressPage', true);
                } else {
                    const pageSize = 3;
                    totalPages = Math.max(1, Math.ceil(WBState.subscriptions.length / pageSize));
                    if (WBState.egressSubPage >= totalPages) WBState.egressSubPage = Math.max(0, totalPages - 1);
                    if (WBState.egressSubPage < 0) WBState.egressSubPage = 0;
                    const subSlice = WBState.subscriptions.slice(WBState.egressSubPage * pageSize, (WBState.egressSubPage + 1) * pageSize);

                    innerListHtml = subSlice.map((s, idx) => {
                        const neverRefreshed = s.ageHours == null || !Number.isFinite(s.ageHours);
                        const expired = !neverRefreshed && s.ageHours > WBState.configCacheHours;
                        const nodeCnt = WBState.nodes.filter(n => n.subId === s.id).length;
                        const isSelectedSub = s.id === WBState.activeSubId;
                        const selectBtnHtml = isSelectedSub
                            ? `<button class="editorial-text-btn text-left" style="color:#f0c987;" data-action="select-sub" data-sub-id="${escapeDisplayText(s.id)}">查看</button>`
                            : `<button class="editorial-text-btn text-left" data-action="select-sub" data-sub-id="${escapeDisplayText(s.id)}">查看</button>`;

                        const disableBtnHtml = s.disabled
                            ? `<button class="editorial-text-btn text-left text-white/50 hover:text-white" data-action="toggle-sub" data-sub-id="${escapeDisplayText(s.id)}">启用</button>`
                            : `<button class="editorial-text-btn text-left text-white/40 hover:text-white" data-action="toggle-sub" data-sub-id="${escapeDisplayText(s.id)}">停用</button>`;

                        const delBtnHtml = `<button class="editorial-text-btn text-left text-white/35 hover:text-red-400 transition-colors" data-action="delete-sub" data-sub-id="${escapeDisplayText(s.id)}">删除</button>`;

                        const nodeCls = s.disabled ? 'text-white/20' : 'text-white/48';

                        return `
                            <div id="sub-row-${escapeDisplayText(s.id)}" class="editorial-row py-3 grid items-center gap-x-4 text-xs text-left"
                                 style="grid-template-columns: minmax(0, 1fr) 56px 128px 154px;"
                                 data-hover-vertex="${idx * 8 + 1}" data-hover-label='${escapeDisplayText(s.id)} // ${nodeCnt} NODES'>
                                <div class="min-w-0 max-w-[172px]">
                                    <div class="text-white font-medium max-w-[172px] fade-truncate">${escapeDisplayText(s.name)}</div>
                                    <div class="text-[10.5px] text-white/35 mt-0.5 max-w-[168px] fade-truncate selectable-text" title="${escapeDisplayText(s.url)}">${escapeDisplayText(s.url)}</div>
                                </div>
                                <span class="${nodeCls} text-[11px] tabular-nums-left">${nodeCnt} 节点</span>
                                <span class="text-[11px] tabular-nums-left ${expired ? 'tone-guard' : 'tone-normal'}">
                                    ${s.hasURL === false ? '缺少订阅链接' : neverRefreshed ? '尚未刷新' : expired ? `已缓存 (${s.ageHours.toFixed(1)}h)` : `有效 (${s.ageHours.toFixed(1)}h / ${WBState.configCacheHours}h)`}
                                </span>
                                <div class="flex items-center space-x-3">
                                    <button class="editorial-text-btn text-left" data-action="refresh-sub" data-sub-id="${escapeDisplayText(s.id)}">刷新</button>
                                    ${selectBtnHtml}
                                    ${disableBtnHtml}
                                    ${delBtnHtml}
                                </div>
                            </div>
                        `;
                    }).join('');                    // Comment 6: 订阅来源启用并强制展示底部分页器，方便换页浏览多条订阅
                    renderPagerControls(WBState.egressSubPage, totalPages, 'changeEgressSubPage', true);
                }

                commitStageMarkup(container, `
                    <div>
                        <div class="flex items-center space-x-6 mb-2 text-left">
                            <button class="editorial-tab ${WBState.egressTab==='NODES'?'active':''}" data-action="set-egress-tab" data-tab="NODES">节点列表</button>
                            <button class="editorial-tab ${WBState.egressTab==='SUBS'?'active':''}" data-action="set-egress-tab" data-tab="SUBS">订阅来源</button>
                        </div>
                        <div>${innerListHtml}</div>
                    </div>
                `, animate);
                return;
            }

            // 4. 模型查看 (models)：统一贴顶向上对齐，拉取模型放左钮、域筛选放右钮 (Comment 9)
            if (ch === 'models') {
                const filteredModels = WBState.models.filter(m => modelMatchesFilter(m, WBState.modelRealmFilter));

                const pageSize = 4;
                const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
                if (WBState.modelPage >= totalPages) WBState.modelPage = totalPages - 1;
                const slice = filteredModels.slice(WBState.modelPage * pageSize, (WBState.modelPage + 1) * pageSize);

                const rowsHtml = slice.map((m, idx) => `
                    <div class="editorial-row py-3 grid items-center gap-x-4 text-xs text-left"
                         style="grid-template-columns: 164px 116px 124px 62px 54px;"
                         data-hover-vertex="${idx * 3 + 1}" data-hover-label='TTFT // ${m.ttft}MS'>
                        <span class="text-white font-medium max-w-[156px] fade-truncate text-left">${m.name}</span>
                        <span class="text-[11.5px] text-white/60 tabular-nums-left">上下文 <strong class="text-white font-normal font-['Space_Grotesk'] ml-1">${m.ctx}</strong></span>
                        <span class="text-[11.5px] text-white/60 tabular-nums-left">最大输出 <strong class="text-white font-normal font-['Space_Grotesk'] ml-1">${m.maxOut}</strong></span>
                        <div>${renderHairlineSpark(m.trend, 52, 14, animate)}</div>
                        <span class="text-white/85 font-['Space_Grotesk'] tabular-nums-left">${m.ttft == null ? '—' : m.ttft + ' ms'}</span>
                    </div>
                `).join('');

                commitStageMarkup(container, `<div>${rowsHtml}</div>`, animate);
                renderPagerControls(WBState.modelPage, totalPages, 'changeModelPage', true);
                return;
            }

            // 5. 账号任务 (tasks / scheduler)：报错在 1/9 处突然冒红、4项定时任务 (Comment 10 & 11)
            if (ch === 'tasks' || ch === 'scheduler') {
                if (WBState.tasks.selectedStepCode) {
                    const step = WBState.tasks.steps.find(s => s.code === WBState.tasks.selectedStepCode);
                    if (step) {
                        const failRows = (step.failures || []).map(f => `
                            <div class="editorial-row py-2.5 grid items-center gap-x-4 text-xs text-left"
                                 style="grid-template-columns: 124px 58px minmax(0, 1fr);">
                                <span class="text-white font-medium truncate">${escapeDisplayText(f.name)}</span>
                                <span class="text-white/42 text-[11px] font-['Space_Grotesk']">${escapeDisplayText(f.region)}</span>
                                <span class="tone-fault text-[11.5px] truncate">${escapeDisplayText(f.reason)}</span>
                            </div>
                        `).join('');

                        commitStageMarkup(container, `
                            <div class="space-y-3">
                                <div class="flex justify-between items-center border-b border-white/10 pb-2.5">
                                    <div class="flex items-center space-x-3 text-left">
                                        <span class="text-white text-xs font-medium">${step.code} ${step.name}</span>
                                        <span class="text-[11px] ${(step.failures?.length || 0) > 0 ? 'tone-fault' : 'text-white/45'}">
                                            已处理 ${step.processedCount ?? step.okCount}/${step.totalCount}，成功 ${step.okCount}，失败 ${step.failures?.length || 0}，跳过 ${step.skippedCount || 0}
                                        </span>
                                    </div>
                                    <button class="editorial-text-btn" data-action="set-task-step">&larr; 返回任务列表</button>
                                </div>
                                <div>${failRows || '<div class="py-4 text-xs text-white/45 text-left">暂无失败记录。</div>'}</div>
                            </div>
                        `, animate);
                        renderPagerControls(0, 1, '');
                        return;
                    }
                }

                const rowsHtml = WBState.tasks.steps.map((st, idx) => {
                    const isCur = WBState.tasks.running && WBState.tasks.activeStep === idx;
                    const failCnt = st.failures ? st.failures.length : Math.max(0, st.totalCount - st.okCount);
                    const hasFault = failCnt > 0 && !(WBState.tasks.running && (st.progress ?? 0) < 12);

                    let stateLabel = st.backendState === 'pending' ? '待运行' : '正常';
                    let stateCls = 'tone-normal';
                    if (WBState.tasks.pausedAll || WBState.tasks.scheduleEnabled === false) {
                        stateLabel = WBState.tasks.pausedAll ? '已暂停' : '排程停用';
                        stateCls = 'tone-paused';
                    } else if (isCur && !hasFault) {
                        stateLabel = '执行中';
                        stateCls = 'text-white';
                    } else if (hasFault) {
                        stateLabel = '报错';
                        stateCls = 'tone-fault';
                    }

                    const processed = st.processedCount ?? st.okCount;
                    // 执行数始终用白色、总数始终用暗白；失败数字独立成列并只在
                    // 非零时变红，避免把“已处理”误读成失败数。
                    const ratioHtml = `<span style="color:#fff">${processed}</span><span style="color:rgba(255,255,255,.42)">/${st.totalCount}</span>`;
                    const failedHtml = failCnt > 0
                        ? `<span class="tone-fault font-medium">${failCnt}</span>`
                        : `<span class="text-white/45">0</span>`;

                    return `
                        <div class="editorial-row py-3 grid items-center gap-x-4 text-xs text-left cursor-pointer"
                             style="grid-template-columns: minmax(120px, 144px) 108px 64px 48px 56px minmax(130px, 1fr);"
                             data-action="set-task-step" data-step-code="${st.code}"
                             data-hover-vertex="${idx * 3}" data-hover-label='STEP ${st.code} // ${processed}/${st.totalCount}'>
                            <div class="flex items-center space-x-3 min-w-0">
                                <span class="text-white/38 font-mono shrink-0">${st.code}</span>
                                <span class="text-white font-medium max-w-[124px] whitespace-nowrap overflow-hidden">${st.name}</span>
                            </div>
                            <div class="flex items-center">${renderTaskStatusLine(st, 108, animate)}</div>
                            <div class="font-['Space_Grotesk'] tabular-nums-left" title="已处理 ${processed}，成功 ${st.okCount}，失败 ${failCnt}，跳过 ${st.skippedCount || 0}">${ratioHtml}</div>
                            <div class="font-['Space_Grotesk'] tabular-nums-left" title="失败账号数">${failedHtml}</div>
                            <span class="text-white/52 font-['Space_Grotesk'] tabular-nums-left">${st.dur}</span>
                            <span class="text-[11px] ${stateCls} text-left">${stateLabel}</span>
                        </div>
                    `;
                }).join('');

                commitStageMarkup(container, `<div>${rowsHtml}</div>`, animate);
                if (animate) {
                    requestAnimationFrame(() => {
                        const rows = container.querySelectorAll('.editorial-row');
                        rows.forEach((rowEl) => {
                            const shell = rowEl.querySelector('.task-line-shell');
                            if (!shell) return;
                            const activeTrack = shell.querySelector('.task-active-track');
                            const grayTrack = shell.querySelector('.task-gray-track');
                            const isP = !!WBState.tasks?.pausedAll || WBState.tasks?.scheduleEnabled === false;
                            if (activeTrack) {
                                activeTrack.style.transition = 'width 0.55s cubic-bezier(0, 0, 0.2, 1)';
                                activeTrack.style.width = isP ? '0%' : '100%';
                            }
                            if (grayTrack) {
                                grayTrack.style.transition = 'width 0.55s cubic-bezier(0, 0, 0.2, 1), box-shadow 0.2s ease';
                                grayTrack.style.width = isP ? '100%' : '0%';
                                grayTrack.style.boxShadow = isP ? '-2.5px 0 0 0 #050605' : 'none';
                            }
                        });
                    });
                }
                renderPagerControls(0, 1, '');
                return;
            }

            // 6. 积分用量 (usage)：线性图从左向右由快到慢快速蔓延入场动画 (Comment 12)
            if (ch === 'usage') {
                if (WBState.usageView === 'RANK') {
                    const pageSize = 4;
                    const totalPages = Math.max(1, Math.ceil(WBState.usageByModel.length / pageSize));
                    const curP = (typeof WBState.usageModelPage === 'number') ? WBState.usageModelPage : 0;
                    WBState.usageModelPage = Math.min(Math.max(0, curP), totalPages - 1);
                    const slice = WBState.usageByModel.slice(WBState.usageModelPage * pageSize, (WBState.usageModelPage + 1) * pageSize);
                    const pageOffset = WBState.usageModelPage * pageSize;

                    const rankRows = slice.map((r, idx) => `
                        <div class="editorial-row py-2.5 grid items-center gap-x-4 text-xs text-left"
                             style="grid-template-columns: 168px 86px 136px 84px;"
                             data-hover-vertex="${(pageOffset + idx) * 4 + 2}" data-hover-label="${r.name.toUpperCase()}"
                             >
                            <span class="text-white font-medium truncate">${r.name}</span>
                            <span class="text-white/55 tabular-nums-left">请求 <strong class="text-white/90 font-normal font-['Space_Grotesk']">${r.reqs}</strong></span>
                            <span class="text-white/55 tabular-nums-left">I/O <strong class="text-white/90 font-normal font-['Space_Grotesk']">${r.prompt} / ${r.comp}</strong></span>
                            <span class="text-white/85 font-['Space_Grotesk'] tabular-nums-left">${formatCredits(r.credits)} 积分</span>
                        </div>
                    `).join('');

                    commitStageMarkup(container, `
                        <div>
                            <div class="flex items-center justify-between mb-2 text-[10.5px] tracking-[0.14em] text-white/45">
                                <span>按模型真实消耗统计</span>
                            </div>
                            <div>${rankRows}</div>
                        </div>
                    `, animate);
                    renderPagerControls(WBState.usageModelPage, totalPages, 'changeUsageModelPage', true);
                    return;
                }

                const ds = WBState.usageRange === '24H' ? WBState.usage24h : WBState.usage6h;
                const maxV = Math.max(1, ...ds.outVals, ...ds.inVals) * 1.15;
                const w = 520, h = 128;
                const outPts = ds.outVals.map((v, i) => `${((i / (ds.outVals.length - 1)) * w).toFixed(1)},${(h - 18 - (v / maxV) * (h - 32)).toFixed(1)}`).join(' ');
                const inPts  = ds.inVals.map((v, i) => `${((i / (ds.inVals.length - 1)) * w).toFixed(1)},${(h - 18 - (v / maxV) * (h - 32)).toFixed(1)}`).join(' ');

                const hIdx = WBState.usageHoverIdx >= 0 ? WBState.usageHoverIdx : ds.labels.length - 1;
                const curX = ((hIdx / (ds.labels.length - 1)) * w).toFixed(1);

                const hitCols = ds.labels.map((lb, i) => `
                    <div class="flex-1 h-full cursor-crosshair"
                         data-hover-model="Usage" data-hover-idx="${i}"
                         ></div>
                `).join('');

                const clipId = 'usg-clip-' + (++WBState.chartClipSeq);
                const clipDef = animate ? `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="540" height="140" class="svg-clip-spread-rect" /></clipPath></defs>` : '';
                const clipAttr = animate ? `clip-path="url(#${clipId})"` : '';

                commitStageMarkup(container, `
                    <div class="space-y-3 pt-0.5">
                        <div class="flex items-center justify-between text-[10.5px] tracking-[0.14em] text-white/45 whitespace-nowrap overflow-hidden text-ellipsis w-full">
                            <div class="flex items-center space-x-3 tabular-nums-left whitespace-nowrap overflow-hidden text-ellipsis">
                                <span id="usage-cursor-readout">时刻 <strong class="text-white font-normal">${ds.labels[hIdx] || ''}</strong> &mdash; 输出 ${ds.outVals[hIdx] || 0}K / 输入 ${ds.inVals[hIdx] || 0}K</span>
                                <span class="text-white/28">|</span>
                                <span class="text-white/60">${WBState.usageRange}区间累计: 输出 ${((ds.outVals.reduce((a,b)=>a+b,0))/1000).toFixed(2)}M / 输入 ${((ds.inVals.reduce((a,b)=>a+b,0))/1000).toFixed(2)}M</span>
                            </div>
                        </div>
                        <div class="relative w-full h-[132px]">
                            <svg viewBox="0 0 ${w} ${h}" class="w-full h-full overflow-visible">
                                ${clipDef}
                                <line x1="0" y1="${h - 18}" x2="${w}" y2="${h - 18}" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
                                <line id="usage-cursor-line" x1="${curX}" y1="6" x2="${curX}" y2="${h - 18}" stroke="rgba(255,255,255,0.32)" stroke-width="1" stroke-dasharray="2 3" />
                                <g ${clipAttr}>
                                    <polyline fill="none" stroke="#ffffff" stroke-width="1.4" points="${outPts}" />
                                    <polyline fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.15" stroke-dasharray="3 4" points="${inPts}" />
                                </g>
                            </svg>
                            <div class="absolute inset-0 flex">${hitCols}</div>
                        </div>
                        <div class="relative w-full h-4 mt-1 text-[9.5px] tracking-[0.14em] text-white/40 font-mono">
                            ${ds.labels.map((l, i) => {
                                const pct = (i / (ds.labels.length - 1)) * 100;
                                return `<span class="absolute whitespace-nowrap" style="left:${pct.toFixed(2)}%; transform:translateX(-50%);">${l}</span>`;
                            }).join('')}
                        </div>
                    </div>
                `, animate);
                renderPagerControls(0, 1, '');
                return;
            }

            // 7. 积分构成 (packages)：
            // - Comment 6: 增加跟账号相关的到期时间分布数学模型视图与平滑出现特效
            // - Comment 7: Tab 标题去掉 (12)，固定宽度防跳动
            // - Comment 10: KPI 不显示个包，只显示纯数字
            // - Comment 11: 底部右按钮支持账号排序与临期时间排序切换
            if (ch === 'packages') {
                if (WBState.selectedPackageUid) {
                    const accIdx = WBState.accounts.findIndex(a => a.uid === WBState.selectedPackageUid);
                    const acc = WBState.accounts[accIdx];
                    if (acc) {
                        const activePacks = getAccountActivePackages(acc);
                        const pageSize = 4;
                        const totalPages = Math.max(1, Math.ceil(activePacks.length / pageSize));
                        if (WBState.packageDetailPage >= totalPages) WBState.packageDetailPage = totalPages - 1;
                        const slice = activePacks.slice(WBState.packageDetailPage * pageSize, (WBState.packageDetailPage + 1) * pageSize);

                        const prevAcc = WBState.accounts[(accIdx - 1 + WBState.accounts.length) % WBState.accounts.length];
                        const nextAcc = WBState.accounts[(accIdx + 1) % WBState.accounts.length];

                        const packRows = slice.map((p, idx) => {
                            const globalOrder = WBState.packageDetailPage * pageSize + idx + 1;
                            const ratio = p.remain / Math.max(1, p.total);
                            const tone = expiryTone(p.days);
                            return `
                                <div class="editorial-row py-2.5 grid items-center gap-x-4 text-xs text-left"
                                     style="grid-template-columns: minmax(180px, 1fr) 140px 88px;"
                                     data-hover-vertex="${idx * 5 + 1}" data-hover-label='${p.id} // ${p.days}D LEFT'>
                                    <span class="text-white font-medium max-w-[210px] fade-truncate text-left pr-2" title="${escapeDisplayText(p.name)}">${p.name}</span>
                                    <div class="text-left font-['Space_Grotesk'] tabular-nums-left">
                                        <span class="text-white/90">${p.remain.toLocaleString()}</span> <span class="text-white/40">/</span> <span class="text-white/60">${p.total.toLocaleString()}</span>
                                    </div>
                                    <span class="text-[11px] ${tone} tabular-nums-left whitespace-nowrap text-left">${p.days == null ? '未知' : p.days + ' 天到期'}</span>
                                </div>
                            `;
                        }).join('');

                        commitStageMarkup(container, `
                            <div>
                                <div class="flex justify-between items-center border-b border-white/10 pb-2 mb-1">
                                    <div class="flex items-center space-x-2.5 text-left">
                                        <span class="text-white text-xs font-medium">${acc.name}</span>
                                        <span class="text-white/38 text-[10.5px]">&bull; ${activePacks.length} 个独立生效包</span>
                                    </div>
                                    <!-- Comment 9: 去除右上角上一号下一号返回按钮 -->
                                </div>
                                <div>${packRows || '<div class="py-6 text-xs text-white/35 text-left">该账号当前无剩余生效积分包</div>'}</div>
                            </div>
                        `, animate);
                        renderPagerControls(WBState.packageDetailPage, totalPages, 'changePackageDetailPage', true);
                        return;
                    }
                }

                // Comment 1 & 2: Chapter 07 积分构成 Stage
                if (WBState.packageView === 'LIST' || WBState.packageView === 'ACCOUNTS') {
                    // Comment 1: 规定一个页面只能有 4 行
                    const pageSize = 4;
                    let sortedAccounts;
                    if (WBState.packageListSort === 'USAGE') {
                        // 按积分用量最少排序 (余额升序)
                        sortedAccounts = WBState.accounts.filter(a => !a.blocked && a.state !== 'BLOCKED').sort((a, b) => (a.balance || 0) - (b.balance || 0));
                    } else {
                        // 按账号名称排序 (1~9, 然后 A~Z)
                        sortedAccounts = sortAccountsAlphanumeric(WBState.accounts.filter(a => !a.blocked && a.state !== 'BLOCKED'));
                    }

                    const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / pageSize));
                    if (WBState.packageAccountPage >= totalPages) WBState.packageAccountPage = totalPages - 1;
                    const slice = sortedAccounts.slice(WBState.packageAccountPage * pageSize, (WBState.packageAccountPage + 1) * pageSize);

                    const accPackRows = slice.map((acc, idx) => {
                        const activePacks = getAccountActivePackages(acc);
                        const minDays = activePacks[0]?.days ?? null;
                        const tone = expiryTone(minDays);
                        const balNum = typeof acc.balance === 'number' ? acc.balance : 0;
                        const quotaNum = typeof acc.quota === 'number' && acc.quota > 0 ? acc.quota : 5000;
                        const ratio = Math.max(0, Math.min(1, balNum / quotaNum));
                        const vIdx = idx * 4 + 1;
                        return `
                            <div class="editorial-row py-2.5 grid items-center text-xs text-left cursor-pointer"
                                 style="grid-template-columns: 140px 68px 96px 110px 50px; column-gap: 20px;"
                                 data-action="select-package-uid" data-uid="${escapeDisplayText(acc.uid)}"
                                 data-hover-vertex="${vIdx}" data-hover-label="ACC // ${acc.name.toUpperCase()}"
                                 >
                                <span class="text-white font-medium font-mono text-[11.5px] truncate text-left w-[140px] shrink-0" title="${acc.name}">${acc.name}</span>
                                <span class="text-white/52 text-[11px] tabular-nums-left">${activePacks.length} 个包</span>
                                <span class="text-white/90 font-['Space_Grotesk'] tabular-nums-left shrink-0">${balNum.toLocaleString()}</span>
                                <span class="text-[11px] ${tone} tabular-nums-left whitespace-nowrap">${minDays === null ? (acc.packagesError ? '获取失败' : activePacks.length ? '到期时间未知' : '无生效包') : minDays + ' 天到期'}</span>
                                <button class="editorial-text-btn text-left">查看 &rarr;</button>
                            </div>
                        `;
                    }).join('');

                    const sortHint = WBState.packageListSort === 'USAGE' ? '积分最少优先' : '账号名 1-9 A-Z';
                    commitStageMarkup(container, `
                        <div>
                            <div class="flex justify-between items-center space-x-5 mb-2.5 text-left border-b border-white/10 pb-2">
                                <div class="flex items-center space-x-5 text-left">
                                    <button class="editorial-tab active" data-action="set-package-view" data-view="LIST">按账号查看</button>
                                    
                                </div>
                                <div class="flex items-center space-x-3">
                                    <span class="text-[10px] text-white/38 font-mono">${sortHint}</span>
                                </div>
                            </div>
                            <div>${accPackRows}</div>
                        </div>
                    `, animate);
                    renderPagerControls(WBState.packageAccountPage, totalPages, 'changePackageAccountPage', true);
                    return;
                }

                // Comment 2: 数学模型页面 (MODEL)
                if (WBState.packageView === 'MODEL') {
                    if (WBState.packageModelMode === 'ACCOUNT') {
                        // 模型 2: 按账号排序的折线统计图 (账号优先排序为从 1~9，然后是从 A 到 Z)
                        const sortedAccs = sortAccountsAlphanumeric(WBState.accounts.filter(a => !a.blocked && a.state !== 'BLOCKED'));
                        const pageSize = 6;
                        const totalPages = Math.max(1, Math.ceil(sortedAccs.length / pageSize));
                        const curP = (typeof WBState.packageModelAccountPage === 'number') ? WBState.packageModelAccountPage : 0;
                        WBState.packageModelAccountPage = Math.min(Math.max(0, curP), totalPages - 1);
                        const slice = sortedAccs.slice(WBState.packageModelAccountPage * pageSize, (WBState.packageModelAccountPage + 1) * pageSize);

                        const xCoords = [40, 120, 200, 280, 360, 440];
                        const points = slice.map((acc, i) => {
                            const bal = typeof acc.balance === 'number' ? acc.balance : 0;
                            const quota = typeof acc.quota === 'number' && acc.quota > 0 ? acc.quota : 5000;
                            const ratio = Math.max(0, Math.min(1, bal / quota));
                            const x = xCoords[i] !== undefined ? xCoords[i] : (40 + i * 80);
                            const y = Math.round(62 - ratio * 46);
                            return { acc, x, y, bal, quota, ratio };
                        });

                        const baselineY = 62;
                        let curvePts = `0,${baselineY} 520,${baselineY}`;
                        if (points.length > 0) {
                            const firstP = points[0];
                            const lastP = points[points.length - 1];
                            const dyStart = baselineY - firstP.y;
                            const startRiseX = Math.max(0, firstP.x - dyStart);
                            const startSeg = startRiseX > 0 ? `0,${baselineY} ${startRiseX},${baselineY}` : `0,${Math.min(baselineY, firstP.y + firstP.x)}`;

                            const dyEnd = baselineY - lastP.y;
                            const dropX = lastP.x + dyEnd;
                            const endSeg = dropX < 520 ? `${dropX},${baselineY} 520,${baselineY}` : `520,${lastP.y + (520 - lastP.x)}`;

                            curvePts = `${startSeg} ${points.map(p => `${p.x},${p.y}`).join(' ')} ${endSeg}`;
                        }
                        const clipId = 'acc-clip-' + (++WBState.chartClipSeq);
                        const clipDef = animate ? `<defs><clipPath id="${clipId}"><rect x="0" y="-6" width="540" height="84" class="svg-clip-spread-rect" /></clipPath></defs>` : '';
                        const clipAttr = animate ? `clip-path="url(#${clipId})"` : '';
                        const initP = points.find(p => p.acc.uid === WBState.packageModelAccountUid) || points[0] || { acc: { name: '--' }, x: 40, bal: 0, quota: 0 };
                        const initPacks = getAccountActivePackages(initP.acc);

                        commitStageMarkup(container, `
                            <div id="account-model-chart-wrap" class="flex flex-col justify-start space-y-4 pt-1">
                                <div>
                                    <div class="flex justify-between items-center text-[10px] tracking-[0.15em] text-white/42 mb-3">
                                        <span id="pkg-model-readout">账号 ${initP.acc.name} — 积分 ${initP.bal.toLocaleString()} / 额度 ${initP.quota.toLocaleString()} / 独立包 ${initPacks.length}</span>
                                        <span class="text-white/60 font-mono">BALANCE / QUOTA // 账号额度统计</span>
                                    </div>
                                    <svg viewBox="0 0 520 70" class="w-full h-[70px] overflow-visible">
                                        ${clipDef}
                                        <line x1="0" y1="62" x2="520" y2="62" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
                                        <line x1="0" y1="16" x2="520" y2="16" stroke="rgba(255,255,255,0.04)" stroke-dasharray="2 3" stroke-width="1" />
                                        <g ${clipAttr}>
                                            <polyline fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.35" points="${curvePts}" />
                                            ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#98dfc2" opacity="0.95" />`).join('')}
                                        </g>
                                        <line id="pkg-model-cursor" x1="${initP.x}" y1="0" x2="${initP.x}" y2="62" stroke="#f0c987" stroke-width="1.2" opacity="0.8" />
                                    </svg>
                                    <div class="flex justify-between items-center text-[9px] tracking-[0.08em] text-white/40 mt-1.5 font-mono">
                                        ${points.map(p => `<span class="w-[74px] truncate text-center" title="${p.acc.name}">${p.acc.name}</span>`).join('')}
                                    </div>
                                </div>
                                <div class="grid grid-cols-6 gap-2 pt-1 text-[10.5px]">
                                    ${points.map((p, idx) => `
                                        <div class="py-1 px-1.5 border border-white/10 hover:border-white/40 cursor-pointer transition-colors text-left"
                                             data-hover-model="AccountModel" data-hover-idx="${idx}"
                                             >
                                            <div class="text-[9px] text-white/40 mb-0.5 truncate">${p.acc.name}</div>
                                            <div class="text-white font-medium">${p.bal.toLocaleString()}</div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `, animate);
                        // Comment 2: 仅按账号排序的折线统计图页面出现换页功能，带平滑过渡动画
                        renderPagerControls(WBState.packageModelAccountPage || 0, totalPages, 'changeModelAccountPage', true);
                        return;
                    }

                    // 模型 1: 按天数排序的折线统计图 (Weibull 寿命衰减与到期分布模型，无换页)
                    const points = getWeibullModelPoints();
                    const curvePts = points.map(p => `${p.x},${p.y}`).join(' ');
                    const clipId = 'pkg-clip-' + (++WBState.chartClipSeq);
                    const clipDef = animate ? `<defs><clipPath id="${clipId}"><rect x="0" y="-6" width="540" height="84" class="svg-clip-spread-rect" /></clipPath></defs>` : '';
                    const clipAttr = animate ? `clip-path="url(#${clipId})"` : '';
                    const initP = points[Math.max(0, Math.min(points.length - 1, WBState.packageModelHoverIdx))];

                    commitStageMarkup(container, `
                        <div class="flex flex-col justify-start space-y-4 pt-1">
                            <div>
                                <div class="flex justify-between items-center text-[10px] tracking-[0.15em] text-white/42 mb-3">
                                    <span id="pkg-model-readout">时段 ${initP.day}天 — 存活积分 ${initP.survival.toFixed(1)}% / 预计到期 ${initP.expAcc} 账号 / 临期包 ${initP.packs}</span>
                                    <span class="text-white/60 font-mono">已知到期包剩余占比</span>
                                </div>
                                <svg viewBox="0 0 520 86" class="w-full h-[86px] overflow-visible">
                                    ${clipDef}
                                    <line x1="40" y1="0" x2="40" y2="70" stroke="#ff5c74" stroke-width="1" stroke-dasharray="2 3" opacity="0.65" />
                                    <line x1="210" y1="0" x2="210" y2="70" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="2 3" />
                                    <line x1="0" y1="68" x2="520" y2="68" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
                                    <g ${clipAttr}>
                                        <polyline fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.35" points="${curvePts}" />
                                        ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#ffffff" opacity="0.9" />`).join('')}
                                    </g>
                                    ${points.map(p => `<text x="${p.x}" y="82" fill="rgba(255,255,255,0.38)" font-size="9" font-family="Space Grotesk, monospace" text-anchor="middle">${p.day}D</text>`).join('')}
                                    <line id="pkg-model-cursor" x1="${initP.x}" y1="0" x2="${initP.x}" y2="68" stroke="#f0c987" stroke-width="1.2" opacity="0.8" />
                                </svg>
                            </div>
                            <div class="grid grid-cols-6 gap-2 pt-1 text-[10.5px]">
                                ${points.map((p, idx) => `
                                    <div class="py-1 px-1.5 border border-white/10 hover:border-white/40 cursor-pointer transition-colors text-left"
                                         data-hover-model="package" data-hover-idx="${idx}" data-action="hover-package" data-idx="${idx}"
                                         >
                                        <div class="text-[9px] text-white/40 mb-0.5">${p.day}天临界</div>
                                        <div class="text-white font-medium">${p.expAcc}号 / ${p.packs}包</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `, animate);
                    // Comment 2: 不在按天数排序的折线统计中出现换页功能
                    renderPagerControls(0, 1, '');
                    return;
                }

                if (WBState.packageView === 'EXPIRY') {
                    let urgentCnt = 0, urgentSum = 0;
                    let monthCnt = 0, monthSum = 0;
                    let longCnt = 0, longSum = 0;
                    WBState.accounts.forEach(acc => {
                        getAccountActivePackages(acc).forEach(p => {
                            if (p.days != null && p.days <= 7) { urgentCnt++; if (!acc.unlimited) urgentSum += p.remain; }
                            else if (p.days != null && p.days <= 30) { monthCnt++; if (!acc.unlimited) monthSum += p.remain; }
                            else { longCnt++; if (!acc.unlimited) longSum += p.remain; }
                        });
                    });
                    const buckets = [
                        { label: '7 天内临期优先消耗', cnt: urgentCnt, sum: urgentSum, cls: 'tone-guard', ratio: 0.28 },
                        { label: '8 - 30 天月度常规包', cnt: monthCnt, sum: monthSum, cls: 'text-white/85', ratio: 0.65 },
                        { label: '30 天以上远期储备包', cnt: longCnt, sum: longSum, cls: 'text-white/65', ratio: 0.88 }
                    ];
                    const bucketRows = buckets.map((b, i) => `
                        <div class="editorial-row py-3 grid items-center gap-x-4 text-xs text-left"
                             style="grid-template-columns: 168px 80px 140px 80px;"
                             data-hover-vertex="${i * 6 + 2}" data-hover-label='BUCKET // ${b.cnt} PACKS'>
                            <span class="text-white font-medium">${b.label}</span>
                            <span class="text-white/50 tabular-nums-left">${b.cnt} 个独立包</span>
                            <div class="flex items-center space-x-3">
                                <span class="${b.cls} font-['Space_Grotesk'] tabular-nums-left w-[76px] shrink-0">${b.sum.toLocaleString()}</span>
                                ${renderHairlineMeter(b.ratio, 42)}
                            </div>
                            <button class="editorial-text-btn text-left" data-action="set-package-view" data-view="ACCOUNTS" data-expiring="${i===0}">查看账号 &rarr;</button>
                        </div>
                    `).join('');

                    commitStageMarkup(container, `
                        <div>
                            <div class="flex items-center space-x-5 mb-2 text-left">
                                <button class="editorial-tab" data-action="set-package-view" data-view="ACCOUNTS">按账号查看</button>
                                
                            </div>
                            <div>${bucketRows}</div>
                        </div>
                    `, animate);
                    renderPagerControls(0, 1, '');
                    return;
                }

                // Comment 11: 账号列表根据 WBState.packageSort 排序 (EXPIRY=临期时间升序, ACCOUNT=账号名顺位)
                const accCandidates = (WBState.packageExpiringOnly
                    ? WBState.accounts.filter(acc => getAccountActivePackages(acc).some(p => p.days != null && p.days <= 7))
                    : WBState.accounts.slice()).sort((a, b) => {
                        if (WBState.packageSort === 'EXPIRY') {
                            const minA = getAccountActivePackages(a)[0]?.days ?? 999;
                            const minB = getAccountActivePackages(b)[0]?.days ?? 999;
                            return minA - minB;
                        }
                        return a.name.localeCompare(b.name);
                    });

                const pageSize = 4;
                const totalPages = Math.max(1, Math.ceil(accCandidates.length / pageSize));
                if (WBState.packageAccountPage >= totalPages) WBState.packageAccountPage = totalPages - 1;
                const slice = accCandidates.slice(WBState.packageAccountPage * pageSize, (WBState.packageAccountPage + 1) * pageSize);

                const accPackRows = slice.map((acc, idx) => {
                    const activePacks = getAccountActivePackages(acc);
                    const minDays = activePacks.length ? activePacks[0].days : 0;
                    const tone = expiryTone(minDays);
                    const balStr = acc.unlimited ? 'UNLIMITED' : acc.balance.toLocaleString();
                    const ratio = acc.unlimited ? 1 : (acc.balance / Math.max(1, acc.quota));
                    return `
                        <div class="editorial-row py-2.5 grid items-center gap-x-3 text-xs text-left cursor-pointer"
                             style="grid-template-columns: minmax(0, 1.4fr) 68px 136px 86px 46px;"
                             data-action="select-package-uid" data-uid="${escapeDisplayText(acc.uid)}"
                             data-hover-vertex="${idx * 5 + 2}" data-hover-label="${acc.name.toUpperCase()} // ${activePacks.length} PACKS"
                             >
                            <span class="text-white font-medium max-w-[130px] fade-truncate text-left">${acc.name}</span>
                            <span class="text-white/52 text-[11px] tabular-nums-left">${activePacks.length} 个包</span>
                            <div class="flex items-center space-x-2.5">
                                <span class="text-white/90 font-['Space_Grotesk'] tabular-nums-left w-[76px] shrink-0">${balStr}</span>
                                ${renderHairlineMeter(ratio, 38)}
                            </div>
                            <span class="text-[11px] ${tone} tabular-nums-left">${minDays ? minDays + ' 天到期' : '无生效包'}</span>
                            <span class="editorial-text-btn text-left">查看 &rarr;</span>
                        </div>
                    `;
                }).join('');

                commitStageMarkup(container, `
                    <div>
                        <!-- Comment 7: 去掉 (12)，固定 Tab 标题且避免切换跳动 -->
                        <div class="flex items-center space-x-5 mb-2 text-left">
                            <button class="editorial-tab active" data-action="set-package-view" data-view="ACCOUNTS">按账号查看</button>
                            
                        </div>
                        <div>${accPackRows || '<div class="py-6 text-xs text-white/35 text-left">暂无 7 天内含临期积分包的账号</div>'}</div>
                    </div>
                `, animate);
                renderPagerControls(WBState.packageAccountPage, totalPages, 'changePackageAccPage', true);
                return;
            }

            // 8. 错误记录 (logs)：
            // - Comment 15: 删除右上辅助提示字
            // - Comment 16: 右侧显示账号名称而非 #90d14b 编号（颜色保持不变）
            // - Comment 17: 点击按钮 1 切入时间-错误量关系数学模型（Hawkes 自激指数衰减曲线 + 左起由快到慢蔓延动画）
            if (ch === 'logs') {
                if (WBState.logView === 'MODEL') {
                    const em = WBState.errorModelSeries;
                    const maxL = 4.2;
                    const w = 520, h = 126;

                    // 生成高密度连续数学模型平滑曲线点集：λ(t) 在采样点间按 Hawkes 指数核连续插值
                    const densePts = [];
                    const samples = 48;
                    for (let s = 0; s <= samples; s++) {
                        const u = (s / samples) * (em.lambdaVals.length - 1);
                        const i0 = Math.floor(u);
                        const i1 = Math.min(em.lambdaVals.length - 1, i0 + 1);
                        const f = u - i0;
                        const smoothF = f * f * (3 - 2 * f);
                        const val = em.lambdaVals[i0] * (1 - smoothF) + em.lambdaVals[i1] * smoothF;
                        const px = (s / samples) * w;
                        const py = h - 18 - (Math.min(maxL, val) / maxL) * (h - 30);
                        densePts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
                    }

                    const warnY = (h - 18 - (em.warnLine / maxL) * (h - 30)).toFixed(1);
                    const hIdx = WBState.logModelHoverIdx >= 0 ? WBState.logModelHoverIdx : (em.labels.length - 1);
                    const curX = ((hIdx / (em.labels.length - 1)) * w).toFixed(1);

                    // 离散观测脉冲柱
                    const impulseBars = em.rawCounts.map((cnt, i) => {
                        const bx = ((i / (em.rawCounts.length - 1)) * w).toFixed(1);
                        const bh = Math.max(2, (cnt / maxL) * (h - 30));
                        const by = (h - 18 - bh).toFixed(1);
                        const strokeCol = cnt >= 3 ? '#ff5c74' : 'rgba(255,255,255,0.28)';
                        return `<line x1="${bx}" y1="${h - 18}" x2="${bx}" y2="${by}" stroke="${strokeCol}" stroke-width="2.2" />`;
                    }).join('');

                    const hitCols = em.labels.map((_, i) => `
                        <div class="flex-1 h-full cursor-crosshair"
                             data-hover-model="ErrorModel" data-hover-idx="${i}"
                             ></div>
                    `).join('');

                    const clipId = 'err-clip-' + (++WBState.chartClipSeq);
                    const clipDef = animate ? `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="540" height="140" class="svg-clip-spread-rect" /></clipPath></defs>` : '';
                    const clipAttr = animate ? `clip-path="url(#${clipId})"` : '';

                    commitStageMarkup(container, `
                        <div class="space-y-2.5 pt-0.5 text-left">
                            <div class="flex justify-between items-center text-[10.5px] tracking-[0.12em] text-white/45">
                                <span id="err-model-readout" class="tabular-nums-left">时段 <strong class="text-white font-normal">${em.labels[hIdx]}</strong> &mdash; 强度 &lambda;(t) = <strong class="text-white font-normal">${em.lambdaVals[hIdx].toFixed(2)}</strong> / 观测 ${em.rawCounts[hIdx]} 次</span>
                                <span class="font-mono text-[10px] text-white/40">&lambda;(t)=&mu;+&Sigma;&alpha;e<sup>-&beta;&Delta;t</sup> (&beta;=0.64)</span>
                            </div>
                            <div class="relative w-full h-[130px]">
                                <svg viewBox="0 0 ${w} ${h}" class="w-full h-full overflow-visible">
                                    ${clipDef}
                                    <line x1="0" y1="${h - 18}" x2="${w}" y2="${h - 18}" stroke="rgba(255,255,255,0.10)" stroke-width="1" />
                                    <line x1="0" y1="${warnY}" x2="${w}" y2="${warnY}" stroke="rgba(255,92,116,0.38)" stroke-width="1" stroke-dasharray="3 4" />
                                    <line id="err-model-cursor-line" x1="${curX}" y1="6" x2="${curX}" y2="${h - 18}" stroke="rgba(255,255,255,0.30)" stroke-width="1" stroke-dasharray="2 3" />
                                    <g ${clipAttr}>
                                        ${impulseBars}
                                        <polyline fill="none" stroke="#ffffff" stroke-width="1.45" points="${densePts.join(' ')}" />
                                    </g>
                                </svg>
                                <div class="absolute inset-0 flex">${hitCols}</div>
                            </div>
                            <div class="flex justify-between text-[9.5px] tracking-[0.14em] text-white/32">
                                ${em.labels.map(l => `<span>${l}</span>`).join('')}
                            </div>
                        </div>
                    `, animate);
                    renderPagerControls(0, 1, '');
                    return;
                }

                if (WBState.selectedLogId) {
                    const item = WBState.logs.find(x => x.id === WBState.selectedLogId);
                    if (item) {
                        const accName = getAccountNameByUid(item.uid);
                        commitStageMarkup(container, `
                            <div class="space-y-3.5 text-left">
                                <div class="flex justify-between items-center border-b border-white/10 pb-2.5">
                                    <span class="text-xs text-white font-medium tabular-nums-left">${item.time} &bull; HTTP ${item.code} &bull; ${accName} &rarr; ${item.egress}</span>
                                    <button class="editorial-text-btn" data-action="clear-selected-log">&larr; 返回记录</button>
                                </div>
                                <div class="text-xs text-white/70 text-left">${item.summary}</div>
                                <div class="pt-0.5 text-left">
                                    <div class="text-[9.5px] tracking-[0.14em] text-white/38 mb-1.5">上游原始响应快照</div>
                                    <div class="text-[11px] font-mono text-white/85 border-l border-white/25 pl-3 py-1 selectable-text break-all text-left">${item.raw}</div>
                                </div>
                            </div>
                        `, animate);
                        renderPagerControls(0, 1, '');
                        return;
                    }
                }

                const filteredLogs = WBState.logs.filter(item => {
                    if (WBState.logFilterCode === '4XX') return item.code >= 400 && item.code < 500;
                    if (WBState.logFilterCode === '5XX') return item.code >= 500;
                    return true;
                });
                const count4xx = WBState.logs.filter(x => x.code >= 400 && x.code < 500).length;
                const count5xx = WBState.logs.filter(x => x.code >= 500).length;

                const pageSize = 4;
                const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
                if (WBState.logPage >= totalPages) WBState.logPage = totalPages - 1;
                const slice = filteredLogs.slice(WBState.logPage * pageSize, (WBState.logPage + 1) * pageSize);

                const rowsHtml = slice.map((item, idx) => {
                    const accName = getAccountNameByUid(item.uid);
                    return `
                        <div class="editorial-row py-2.5 grid items-center gap-x-3 text-xs cursor-pointer text-left"
                             style="grid-template-columns: 68px 42px minmax(0, 1fr) 104px;"
                             data-action="select-log" data-id="${item.id}"
                             data-hover-vertex="${idx * 3 + 2}" data-hover-label="${item.code} // ${accName.toUpperCase()}"
                             >
                            <span class="text-white/42 font-mono text-[11px] tabular-nums-left">${item.time}</span>
                            <span class="${item.code === 401 ? 'tone-fault' : 'tone-guard'} font-medium font-['Space_Grotesk'] tabular-nums-left">${item.code}</span>
                            <span class="text-white/78 max-w-[270px] fade-truncate text-left">${item.summary}</span>
                            <span class="text-white/40 text-[11px] font-mono max-w-[104px] fade-truncate text-left">${accName}</span>
                        </div>
                    `;
                }).join('');

                commitStageMarkup(container, `
                    <div>
                        <div class="flex items-center space-x-5 mb-2 text-left">
                            <button class="editorial-tab ${(WBState.logFilterCode==='ALL'||!WBState.logFilterCode)?'active':''}" data-action="set-log-filter" data-filter="ALL">全部</button>
                            <button class="editorial-tab ${WBState.logFilterCode==='4XX'?'active':''}" data-action="set-log-filter" data-filter="4XX">4XX 上游</button>
                            <button class="editorial-tab ${WBState.logFilterCode==='5XX'?'active':''}" data-action="set-log-filter" data-filter="5XX">5XX 异常</button>
                        </div>
                        <div>${rowsHtml || '<div class="py-6 text-xs text-white/35 text-left">当前筛选下暂无异常拦截记录</div>'}</div>
                    </div>
                `, animate);
                renderPagerControls(WBState.logPage, totalPages, 'changeLogPage', true);
                return;
            }

            // 9. 系统设置 (encryption / config)：
            // - Comment 4: 在订阅定时刷新时间旁边上下排布“导入 JSON 配置”与“导出 JSON 配置”
            if (ch === 'encryption') {
                commitStageMarkup(container, `
                    <div class="space-y-6 pt-1 text-left">
                        <div class="grid grid-cols-3 gap-6">
                            <div>
                                <div class="text-[9.5px] tracking-[0.14em] text-white/38 mb-1">当前访问密码</div>
                                <input id="cfg-old-pwd" type="password" class="editorial-input w-full" placeholder="当前密码" />
                            </div>
                            <div>
                                <div class="text-[9.5px] tracking-[0.14em] text-white/38 mb-1">新访问密码</div>
                                <input id="cfg-new-pwd" type="password" class="editorial-input w-full" placeholder="输入新密码" />
                            </div>
                            <div>
                                <div class="text-[9.5px] tracking-[0.14em] text-white/38 mb-1">确认新密码</div>
                                <input id="cfg-rep-pwd" type="password" class="editorial-input w-full" placeholder="再次确认" />
                            </div>
                        </div>
                        <div class="grid grid-cols-3 gap-6 pt-1 items-start">
                            <div>
                                <div class="text-[9.5px] tracking-[0.14em] text-white/38 mb-1.5">整号低额自动退池保护阈值</div>
                                <div class="flex items-baseline space-x-2">
                                    <input id="cfg-threshold" type="number" inputmode="numeric" class="editorial-input w-full font-['Space_Grotesk'] tabular-nums-left" value="${WBState.configThreshold}" />
                                    <span class="text-[10.5px] text-white/38 shrink-0">积分</span>
                                </div>
                            </div>
                            <div>
                                <div class="text-[9.5px] tracking-[0.14em] text-white/38 mb-1.5">订阅定时刷新时间</div>
                                <div class="flex items-baseline space-x-2">
                                    <input id="cfg-sub-refresh" type="number" inputmode="numeric" class="editorial-input w-full font-['Space_Grotesk'] tabular-nums-left" value="${WBState.configCacheHours}" />
                                    <span class="text-[10.5px] text-white/38 shrink-0">小时</span>
                                </div>
                            </div>
                            <div class="flex flex-col items-start space-y-2 pt-0.5">
                                <button id="btn-import-json" class="editorial-text-btn text-white/75 hover:text-white text-left transition-colors" data-action="trigger-import-json">[ 导入 JSON 配置 ]</button>
                                <button id="btn-export-json" class="editorial-text-btn text-white/75 hover:text-white text-left transition-colors" data-action="export-json">[ 导出 JSON 配置 ]</button>
                            </div>
                        </div>
                    </div>
                `, animate);
                renderPagerControls(0, 1, '');
            }
        }

        // ==================== 各业务模块真实动作处理器 ====================
        window.toggleAccountManual = (uid) => {
            const acc = WBState.accounts.find(a => a.uid === uid);
            if (!acc) return;
            const rawLow = isRawLowBalance(acc);

            if (!acc.manualOn) {
                acc.manualOn = true;
                acc.forceOverride = rawLow;
            } else if (rawLow && !acc.forceOverride) {
                acc.manualOn = true;
                acc.forceOverride = true;
            } else {
                acc.manualOn = false;
                acc.forceOverride = false;
            }

            soundscape.triggerTileNote(acc.manualOn ? 8 : 3);
            const stateDesc = !acc.manualOn ? 'SUSPENDED' : (acc.forceOverride ? 'FORCE ENABLED' : 'ENABLED');
            notifyEditorialStatus(`ACCOUNT ${acc.name.toUpperCase()} -> ${stateDesc}`);
            renderEditorialStage(false);
        };

        window.switchLoginRealm = (realm) => {
            WBState.loginRealm = realm;
            const code = Math.random().toString(36).slice(2, 6).toUpperCase();
            WBState.loginAuthUrl = realm === 'CN'
                ? `https://auth.workbuddy.cn/oauth/device?user_code=WB-${code}-CN`
                : `https://auth.workbuddy.global/oauth/device?user_code=WB-${code}-GL`;
            soundscape.triggerTileNote(6);
            renderEditorialStage(false);
        };

        // Comment 4: 授权成功统一处理流程
        function handleOAuthComplete(authData) {
            if (IS_PROD_ENV) {
                if (WBState.oauthPollTimer) clearInterval(WBState.oauthPollTimer);
                WBState.oauthPollTimer = null;
                WBState.accountSubmode = null;
                loadAuthenticatedPanelData().then(() => renderEditorialStage(true));
                WBState.oauthWaiting = false; setPreviewFrameState('success', 800);
                notifyEditorialStatus('授权完成，正在加载账号');
                return;
            }
            if (WBState.oauthPollTimer) {
                clearInterval(WBState.oauthPollTimer);
                WBState.oauthPollTimer = null;
            }
            WBState.oauthPollStatus = 'SUCCESS';

            const btn = document.getElementById('btn-oauth-status');
            if (btn) {
                btn.textContent = '[ 授权成功 ]';
                btn.className = 'editorial-text-btn text-emerald-400';
                btn.style.color = '#4ade80';
                btn.style.borderColor = 'rgba(74, 222, 128, 0.5)';
                btn.style.textShadow = '0 0 8px rgba(74, 222, 128, 0.6)';
            }

            try {
                if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerTileNote === 'function') {
                    soundscape.triggerTileNote(12);
                }
            } catch(e) {}
            notifyEditorialStatus('OAUTH AUTHORIZATION SUCCESS // ACCOUNT POOL UPDATED');

            // 刷新出新账号并去重
            const uid = (authData && authData.uid) ? authData.uid : `#${Math.floor(0x100000 + Math.random() * 0xdf0000).toString(16).slice(0, 6)}`;
            const name = (authData && authData.nickname) ? authData.nickname : `OAuth-${uid.replace('#','').slice(0,6).toUpperCase()}`;
            if (!WBState.accounts.some(a => a.uid === uid)) {
                WBState.accounts.unshift({
                    uid: uid,
                    name: name,
                    region: WBState.loginRealm || 'CN',
                    balance: 5000,
                    quota: 5000,
                    unlimited: false,
                    state: 'HEALTHY',
                    coolSec: 0,
                    breakerAt: '—',
                    degradeAt: '—',
                    manualOn: true,
                    forceOverride: false,
                    egress: 'HK-IEPL-04',
                    packages: [{ id: 'P-01', name: '标准配额包', balance: 5000, quota: 5000, days: 30, active: true }]
                });
            }

            // 延时 800ms 后自动返回上一级页面
            setTimeout(() => {
                WBState.accountSubmode = null;
                WBState.oauthPollStatus = 'IDLE';
                renderEditorialStage(true);
            }, 800);
        }

        window.__simulateOAuthSuccess = (mockData) => {
            handleOAuthComplete(mockData);
        };

        function startOAuthPolling() {
            if (WBState.oauthPollTimer) {
                clearInterval(WBState.oauthPollTimer);
                WBState.oauthPollTimer = null;
            }

            let pollAttempts = 0;
            let pollInFlight = false;
            WBState.oauthPollTimer = setInterval(async () => {
                if (pollInFlight) return;
                pollAttempts++;
                if (!WBState.accountSubmode || pollAttempts > 60) {
                    clearInterval(WBState.oauthPollTimer);
                    WBState.oauthPollTimer = null;
                    WBState.oauthWaiting = false; setPreviewFrameState('idle');
                    notifyEditorialStatus('授权等待超时');
                    renderEditorialStage(false);
                    return;
                }
                try {
                    pollInFlight = true;
                    const st = encodeURIComponent(WBState.loginState || '');
                    const res = await safeApiFetch(`/panel/api/login/poll?state=${st}`, { method: 'GET' }, 65000);
                    if (res && (res.done === true || res.success === true)) {
                        handleOAuthComplete(res);
                    }
                } catch (_) {} finally { pollInFlight = false; }
            }, 2000);
        }

        window.copyOAuthLoginLink = async () => {
            if (!WBState.loginAuthUrl) { notifyEditorialStatus('请先获取授权链接'); return; }
            try { await navigator.clipboard.writeText(WBState.loginAuthUrl); notifyEditorialStatus('授权链接已复制'); }
            catch (_) { notifyEditorialStatus('复制失败，请手动复制授权链接'); }
        };

        function triggerJsonDownload(filename, payloadObj) {
            try {
                const blob = new Blob([JSON.stringify(payloadObj, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (_) { throw new Error('download failed'); }
        }

        // Comment 4: 系统设置 导入/导出 JSON 配置
        let jsonImportTimer = null;
        window.triggerImportJsonConfig = () => {
            const btnImport = document.getElementById('btn-import-json');
            if (btnImport) {
                btnImport.classList.remove('json-btn-success', 'json-btn-error');
                btnImport.classList.add('json-btn-busy');
            }
            if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
            clearTimeout(jsonImportTimer);
            jsonImportTimer = setTimeout(() => {
                btnImport?.classList.remove('json-btn-busy');
                setPreviewFrameState('error', 800);
                notifyEditorialStatus('导入等待超时，请重新选择文件');
            }, 60000);
            notifyEditorialStatus('WAITING FOR JSON CONFIG FILE...');

            const fileInp = document.getElementById('hidden-json-file-input');
            if (fileInp) {
                fileInp.value = '';
                fileInp.click();
            }
        };

        window.exportGlobalJsonConfig = async () => {
            const btnExport = document.getElementById('btn-export-json');
            if (btnExport) {
                btnExport.classList.remove('json-btn-success', 'json-btn-error');
                btnExport.classList.add('json-btn-busy');
            }
            if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
            notifyEditorialStatus('PREPARING GLOBAL JSON EXPORT...');

            if (IS_PROD_ENV) {
                const accounts = await safeApiFetch('/panel/api/accounts/export', {}, 30000);
                btnExport?.classList.remove('json-btn-busy');
                if (!Array.isArray(accounts)) {
                    btnExport?.classList.add('json-btn-error');
                    setPreviewFrameState('error', 800);
                    notifyEditorialStatus('账号导出失败');
                    return;
                }
                try { triggerJsonDownload('workbuddy-accounts.json', accounts); }
                catch (_) { btnExport?.classList.add('json-btn-error'); setPreviewFrameState('error', 800); notifyEditorialStatus('账号文件下载失败'); return; }
                btnExport?.classList.add('json-btn-success');
                setTimeout(() => btnExport?.classList.remove('json-btn-success'), 1200);
                setPreviewFrameState('success', 1200);
                notifyEditorialStatus('账号凭据已导出，请妥善保管文件');
                return;
            }

            setTimeout(() => {
                try {
                    const snapshot = {
                        exportedAt: new Date().toISOString(),
                        config: {
                            lowBalanceThreshold: WBState.configThreshold,
                            subscriptionRefreshHours: WBState.configCacheHours,
                            activeSubscription: WBState.activeSubId
                        },
                        subscriptions: WBState.subscriptions,
                        accounts: WBState.accounts
                    };
                    triggerJsonDownload('workbuddy-config-backup.json', snapshot);
                    soundscape.triggerTileNote(9);

                    if (btnExport) {
                        btnExport.classList.remove('json-btn-busy', 'json-btn-error');
                        btnExport.classList.add('json-btn-success');
                        setTimeout(() => btnExport.classList.remove('json-btn-success'), 1200);
                    }
                    setPreviewFrameState('success', 1200);
                    notifyEditorialStatus(`EXPORTED JSON CONFIG (${WBState.accounts.length} ACCOUNTS)`);
                } catch (err) {
                    if (btnExport) {
                        btnExport.classList.remove('json-btn-busy', 'json-btn-success');
                        btnExport.classList.add('json-btn-error');
                        setTimeout(() => btnExport.classList.remove('json-btn-error'), 800);
                    }
                    setPreviewFrameState('error', 800);
                    notifyEditorialStatus('EXPORT FAILED // SYSTEM BUSY');
                }
            }, 600);
        };

        window.exportIncidentLogsJson = () => {
            const snapshot = {
                exportedAt: new Date().toISOString(),
                filter: WBState.logFilterCode,
                incidents: WBState.logs.map(l => ({ ...l, accountName: getAccountNameByUid(l.uid) }))
            };
            triggerJsonDownload('workbuddy-incidents-trace.json', snapshot);
            soundscape.triggerTileNote(7);
            notifyEditorialStatus(`EXPORTED ${WBState.logs.length} INCIDENT TRACES JSON`);
        };

        // Comment 20: 1 账号 1 独立出口互斥绑定（若节点超时或已被其他账号绑定则禁止抢占）
        window.bindAccountEgress = (uid, nodeName) => {
            const acc = WBState.accounts.find(a => a.uid === uid);
            const node = WBState.nodes.find(n => n.name === nodeName);
            if (!acc || !node || node.timeout) return;
            const occupied = WBState.accounts.find(a => a.uid !== uid && a.egress === nodeName);
            if (occupied) return;
            acc.egress = nodeName;
            soundscape.triggerTileNote(10);
            notifyEditorialStatus(`${acc.name.toUpperCase()} BOUND TO ${nodeName}`);
            renderEditorialStage(false);
        };

        window.confirmImportAccount = () => {
            const nameEl = document.getElementById('inp-acc-name');
            const regEl = document.getElementById('inp-acc-region');
            const hex = Math.floor(0x100000 + Math.random() * 0xdf0000).toString(16).slice(0, 6);
            const uid = `#${hex}`;
            // 自动挑选一个尚未被占用的健康节点绑定
            const freeNode = WBState.nodes.find(n => !n.timeout && !WBState.accounts.some(a => a.egress === n.name));
            WBState.accounts.unshift({
                uid,
                name: (nameEl?.value || 'OAuth-Vault').trim(),
                region: (regEl?.value || 'GLOBAL').trim().toUpperCase(),
                balance: 5000,
                quota: 5000,
                unlimited: false,
                state: 'HEALTHY',
                coolSec: 0,
                breakerAt: '—',
                degradeAt: '—',
                manualOn: true,
                forceOverride: false,
                egress: freeNode ? freeNode.name : 'HK-IEPL-04',
                packages: [
                    { id: `P-${hex.slice(0,2).toUpperCase()}-1`, name: '初始配额包', remain: 5000, total: 5000, days: 30 }
                ]
            });
            WBState.accountSubmode = null;
            WBState.accountPage = 0;
            soundscape.triggerTransitionSweep(true);
            notifyEditorialStatus('NEW CREDENTIAL WRITTEN TO POOL');
            renderEditorialStage(true);
        };

        // Comment 5: 单节点测速刷新联动几何圆圈 (变黄慢闪 -> 成功短暂变绿 / 失败变红颤抖)
        window.probeSingleNode = (nodeId) => {
            const target = WBState.nodes.find(n => n.id === nodeId);
            if (!target) return;

            // 1. 刷新中：圆圈变黄，模型 2 倍速
            if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
            window.triggerModelSpinAcceleration(1200);
            soundscape.triggerTileNote(6);
            notifyEditorialStatus(`PROBING NODE ${target.name}...`);

            setTimeout(() => {
                if (target.timeout) {
                    // 3. 刷新失败：圆圈直接变红并颤抖
                    setPreviewFrameState('error', 800);
                    notifyEditorialStatus(`NODE ${target.name} TIMEOUT // PROBE FAILED`);
                } else {
                    // 2. 刷新成功：圆圈短暂变绿
                    const delta = Math.floor((Math.random() - 0.5) * 14);
                    target.ping = Math.max(16, target.ping + delta);
                    target.trend.shift();
                    target.trend.push(target.ping);
                    setPreviewFrameState('success', 800);
                    notifyEditorialStatus(`NODE ${target.name} PROBED // ${target.ping} MS`);
                }
                renderEditorialStage(false);
            }, 450);
        };

        // Comment 5: 切换启用订阅源（选中项变橙色“启用”，其他变回“选择”，节点列表联动隔离）
        window.selectActiveSub = (subId) => {
            WBState.activeSubId = subId;
            if (typeof localStorage !== 'undefined') {
                try { localStorage.setItem('wb_active_sub_id', subId); } catch (_) {}
            }
            WBState.egressPage = 0; // 重置节点列表至第1页以便查看新节点
            // 严格保留 WBState.egressSubPage，点击查看后还在当前订阅页面 (Comment 2)
            const sub = WBState.subscriptions.find(s => s.id === subId);
            soundscape.triggerTileNote(11);
            notifyEditorialStatus(`ACTIVE SUBSCRIPTION -> ${sub ? sub.name : subId}`);
            updateEditorialKeyFigures(true);
            renderEditorialStage(false);
        };

        window.toggleDisableSub = (subId) => {
            const sub = WBState.subscriptions.find(s => s.id === subId);
            if (!sub) return;
            sub.disabled = !sub.disabled;
            soundscape.triggerTileNote(sub.disabled ? 3 : 8);
            notifyEditorialStatus(`SUBSCRIPTION ${sub.name} ${sub.disabled ? 'DISABLED' : 'ENABLED'}`);
            renderEditorialStage(false);
        };

        window.deleteSubscription = (subId) => {
            WBState.subscriptions = WBState.subscriptions.filter(s => s.id !== subId);
            if (WBState.activeSubId === subId && WBState.subscriptions.length > 0) {
                WBState.activeSubId = WBState.subscriptions[0].id;
                if (typeof localStorage !== 'undefined') {
                    try { localStorage.setItem('wb_active_sub_id', WBState.activeSubId); } catch (_) {}
                }
            }
            soundscape.triggerTileNote(2);
            notifyEditorialStatus('SUBSCRIPTION DELETED');
            renderEditorialStage(false);
        };

        window.refreshSingleSub = (subId) => {
            const sub = WBState.subscriptions.find(s => s.id === subId);
            if (!sub) return;

            const rowEl = document.getElementById(`sub-row-${subId}`);
            const isInvalidOrExpired = (sub.ageHours > WBState.configCacheHours) || (sub.url && sub.url.includes('invalid'));

            if (isInvalidOrExpired) {
                // 异常提示：该订阅链接横线变红(仅一下)，底下横线颤抖，模型边框变红并颤抖
                if (rowEl) {
                    rowEl.style.borderBottomColor = '#ff5c74';
                    rowEl.classList.remove('input-error-shake');
                    void rowEl.offsetWidth;
                    rowEl.classList.add('input-error-shake');
                    setTimeout(() => {
                        rowEl.style.borderBottomColor = '';
                        rowEl.classList.remove('input-error-shake');
                    }, 650);
                }
                setPreviewFrameState('error', 700);
                notifyEditorialStatus(`SUBSCRIPTION ${sub.name} // LINK EXPIRED`);
                return;
            }

            // 正常刷新：边框呈黄色，模型 2 倍速，完成后变绿
            setPreviewFrameState('busy', 1000);
            sub.ageHours = 0.1;
            soundscape.triggerTileNote(9);
            setTimeout(() => {
                setPreviewFrameState('success', 800);
                notifyEditorialStatus(`SUBSCRIPTION ${sub.name} REFRESHED`);
                renderEditorialStage(false);
            }, 1000);
        };

        // Comment 3: 订阅拉取校验与动效 (黄色轻微晃动 -> 成功转绿平复 / 失败变红强烈抖动)
        let _lastSubImportClickTime = 0;
        window.confirmImportSub = async () => {
            const now = Date.now();
            if (now - _lastSubImportClickTime < 300) return;
            _lastSubImportClickTime = now;

            if (WBState._isPullingSub) return;

            const nameEl = document.getElementById('inp-sub-name');
            const urlEl = document.getElementById('inp-sub-url');
            const nameVal = (nameEl?.value || '').trim() || '新增专线订阅';
            const urlVal = (urlEl?.value || '').trim();

            const triggerError = () => {
                WBState._isPullingSub = false;
                setPreviewFrameState('error', 700);
                if (urlEl) {
                    urlEl.classList.remove('input-verifying-sway', 'input-success-green');
                    urlEl.classList.remove('input-error-shake');
                    urlEl.style.borderColor = '#ff5c74';
                    urlEl.style.borderBottomColor = '#ff5c74';
                    void urlEl.offsetWidth; // 强制触发 reflow 重新执行抖动动效
                    urlEl.classList.add('input-error-shake');
                    urlEl.focus();

                    const clearError = () => {
                        urlEl.classList.remove('input-error-shake', 'input-verifying-sway', 'input-success-green');
                        urlEl.style.borderColor = '';
                        urlEl.style.borderBottomColor = '';
                        urlEl.removeEventListener('input', clearError);
                    };
                    urlEl.addEventListener('input', clearError, { once: true });

                    if (urlEl._errorTimer) clearTimeout(urlEl._errorTimer);
                    urlEl._errorTimer = setTimeout(() => {
                        urlEl.classList.remove('input-error-shake');
                        urlEl.style.borderColor = '';
                        urlEl.style.borderBottomColor = '';
                    }, 1200);
                }
                try {
                    if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerTileNote === 'function') {
                        soundscape.triggerTileNote(2);
                    }
                } catch (_) {}
                notifyEditorialStatus('SUBSCRIPTION PULL FAILED // INVALID URL OR UNREACHABLE');
            };

            // 如果输入为空，直接触发错误报警
            if (!urlVal) {
                triggerError();
                return;
            }

            // 1. 格式校验函数：必须符合 http:// 或 https:// 协议且无空格
            const isValidHttpUrl = (str) => {
                if (!str || typeof str !== 'string') return false;
                const s = str.trim();
                if (!/^https?:\/\/.+/i.test(s) || s.includes(' ')) return false;
                try {
                    const parsed = new URL(s);
                    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
                } catch (_) {
                    return false;
                }
            };

            // 2. 验证中：线条变黄并添加轻微左右晃动类
            if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
            WBState._isPullingSub = true;
            if (urlEl) {
                urlEl.classList.remove('input-error-shake', 'input-success-green');
                urlEl.style.borderColor = '#facc15';
                urlEl.style.borderBottomColor = '#facc15';
                void urlEl.offsetWidth;
                urlEl.classList.add('input-verifying-sway');
            }
            notifyEditorialStatus('PULLING SUBSCRIPTION ENDPOINT...');

            // 协同后端拉取并保持约 350ms 的轻微晃动验证动效
            const verifyPromise = (async () => {
                if (!isValidHttpUrl(urlVal)) {
                    throw new Error('INVALID_URL');
                }
                if (IS_PROD_ENV) {
                    const res = await safeApiFetch('/panel/api/meta/subscriptions', {
                        method: 'POST',
                        body: JSON.stringify({ url: urlVal, name: nameVal })
                    }, 65000);
                    if (!res || res.ok !== true) throw new Error('PULL_FAILED');
                }
                return true;
            })();

            const animDelay = new Promise(resolve => setTimeout(resolve, 350));

            try {
                await Promise.all([verifyPromise, animDelay]);

                // 3. 成功显示绿线 500ms，随后立即进入订阅页；数据刷新在后台进行。
                if (urlEl) {
                    urlEl.classList.remove('input-verifying-sway', 'input-error-shake');
                    urlEl.classList.add('input-success-green');
                    urlEl.style.borderColor = '#4ade80';
                    urlEl.style.borderBottomColor = '#4ade80';
                }
                setPreviewFrameState('success', 800);
                try {
                    if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerTileNote === 'function') {
                        soundscape.triggerTileNote(12);
                    }
                } catch (_) {}
                notifyEditorialStatus('SUBSCRIPTION ENDPOINT VERIFIED');

                setTimeout(() => {
                    WBState._isPullingSub = false;
                    if (IS_PROD_ENV) {
                        WBState.importingSub = false;
                        WBState.egressTab = 'SUBS';
                        renderEditorialStage(true);
                        loadAuthenticatedPanelData().then(() => {
                            if (WBState.currentChapter === 'egress' && WBState.egressTab === 'SUBS' && !WBState.importingSub) renderEditorialStage(false);
                        });
                        return;
                    }
                    const nextId = `SUB-0${WBState.subscriptions.length + 1}`;
                    WBState.subscriptions.push({ id: nextId, name: nameVal, ageHours: 0.1, url: urlVal });
                    WBState.nodes.push(
                        { id: `n-${Date.now()}-1`, subId: nextId, name: `${nextId}-HK-01`, ping: 33, timeout: false, trend: [36, 34, 33, 35, 34, 33, 33] },
                        { id: `n-${Date.now()}-2`, subId: nextId, name: `${nextId}-SG-02`, ping: 59, timeout: false, trend: [64, 61, 60, 62, 59, 60, 59] }
                    );
                    WBState.activeSubId = nextId;
                    WBState.importingSub = false;
                    WBState.egressTab = 'SUBS';
                    setVertexHover(-1);
                    notifyEditorialStatus(`SUBSCRIPTION ${nextId} IMPORTED & ENABLED`);
                    renderEditorialStage(true);
                }, 500);
            } catch (err) {
                await animDelay;
                triggerError();
            }
        };

        // Comment 2: 账号池兜底输入验证微动效 (黄色轻微晃动 -> 成功变绿平复后返回 / 失败变红强烈抖动)
        let _lastOAuthImportClickTime = 0;
        window.importFromPastedCallbackUrl = async () => {
            const now = Date.now();
            if (now - _lastOAuthImportClickTime < 300) return;
            _lastOAuthImportClickTime = now;

            if (WBState._isImportingCallback) return;

            const inpEl = document.getElementById('inp-oauth-callback-url');
            const val = (inpEl?.value || '').trim();

            const triggerError = () => {
                WBState._isImportingCallback = false;
                setPreviewFrameState('error', 700);
                if (inpEl) {
                    inpEl.classList.remove('input-verifying-sway', 'input-success-green');
                    inpEl.classList.remove('input-error-shake');
                    inpEl.style.borderColor = '#ff5c74';
                    inpEl.style.borderBottomColor = '#ff5c74';
                    void inpEl.offsetWidth; // 触发 reflow 强制重新执行抖动动效
                    inpEl.classList.add('input-error-shake');
                    inpEl.focus();

                    const clearError = () => {
                        inpEl.classList.remove('input-error-shake', 'input-verifying-sway', 'input-success-green');
                        inpEl.style.borderColor = '';
                        inpEl.style.borderBottomColor = '';
                        inpEl.removeEventListener('input', clearError);
                    };
                    inpEl.addEventListener('input', clearError, { once: true });

                    if (inpEl._errorTimer) clearTimeout(inpEl._errorTimer);
                    inpEl._errorTimer = setTimeout(() => {
                        inpEl.classList.remove('input-error-shake');
                        inpEl.style.borderColor = '';
                        inpEl.style.borderBottomColor = '';
                    }, 1200);
                }
                try {
                    if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerTileNote === 'function') {
                        soundscape.triggerTileNote(2);
                    }
                } catch (_) {}
                notifyEditorialStatus('INVALID CALLBACK URL // REJECTED');
            };

            // 校验逻辑：检查输入值是否为合法 URL 且含有授权凭据特征
            const isValidCallbackUrl = (str) => {
                if (!str || typeof str !== 'string') return false;
                const s = str.trim();
                if (!/^https?:\/\/[^\s]+/i.test(s)) return false;
                try {
                    const parsed = new URL(s);
                    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
                    const hasCodeParam = /[?&](?:code|user_code|token|access_token)=([^&#]+)/i.test(s);
                    const isCallbackPath = /(?:oauth|callback|redirect)/i.test(parsed.pathname);
                    return hasCodeParam || isCallbackPath;
                } catch (_) {
                    return false;
                }
            };

            // 无论是输入为空还是输入其他内容，检测过程中均进行缓慢晃动的黄色高亮过渡 (Comment 1)
            setPreviewFrameState('busy', 400);
            WBState._isImportingCallback = true;
            if (inpEl) {
                inpEl.classList.remove('input-error-shake', 'input-success-green');
                inpEl.style.borderColor = '#facc15';
                inpEl.style.borderBottomColor = '#facc15';
                void inpEl.offsetWidth;
                inpEl.classList.add('input-verifying-sway');
            }
            notifyEditorialStatus('VERIFYING OAUTH CALLBACK URL...');

            // 检测过程保持约 350ms 缓慢晃动的黄色高亮微动效
            await new Promise(resolve => setTimeout(resolve, 350));

            // 输入为空或格式错误：检测错误变红并强烈颤抖报警
            if (!val || !isValidCallbackUrl(val)) {
                triggerError();
                return;
            }

            // 若验证成功：线条变绿（#4ade80），微动效平复（移除 .input-verifying-sway）
            if (inpEl) {
                inpEl.classList.remove('input-verifying-sway', 'input-error-shake');
                inpEl.classList.add('input-success-green');
                inpEl.style.borderColor = '#4ade80';
                inpEl.style.borderBottomColor = '#4ade80';
                    setPreviewFrameState('success', 800);
            }
            try {
                if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerTileNote === 'function') {
                    soundscape.triggerTileNote(10);
                }
            } catch (_) {}
            notifyEditorialStatus('OAUTH CALLBACK URL VERIFIED');

            // 延时约 300ms 写入新账号到池中并重置 WBState.accountSubmode = null，返回上一级并平滑刷新出新账号！
            setTimeout(() => {
                WBState._isImportingCallback = false;
                let codeMatch = val.match(/[?&](?:code|user_code|token|access_token)=([^&#]+)/i);
                let extractedCode = codeMatch ? decodeURIComponent(codeMatch[1]) : val.slice(0, 16);
                const hex = Math.floor(0x100000 + Math.random() * 0xdf0000).toString(16).slice(0, 6);
                const uid = `#${hex}`;
                const freeNode = WBState.nodes.find(n => !n.timeout && !WBState.accounts.some(a => a.egress === n.name));
                
                WBState.accounts.unshift({
                    uid,
                    name: `OAuth-${extractedCode.slice(0, 6).toUpperCase()}`,
                    region: WBState.loginRealm || 'CN',
                    balance: 5000,
                    quota: 5000,
                    unlimited: false,
                    state: 'HEALTHY',
                    coolSec: 0,
                    breakerAt: '—',
                    degradeAt: '—',
                    manualOn: true,
                    forceOverride: false,
                    egress: freeNode ? freeNode.name : 'HK-IEPL-04',
                    packages: [
                        { id: `P-${hex.slice(0,2).toUpperCase()}-1`, name: 'OAuth 授权凭据包', remain: 5000, total: 5000, days: 30 }
                    ]
                });
                WBState.accountSubmode = null;
                WBState.accountPage = 0;
                try {
                    if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerTileNote === 'function') {
                        soundscape.triggerTileNote(12);
                    }
                } catch(e) {}
                notifyEditorialStatus(`PARSED & IMPORTED OAUTH CREDENTIAL // ${extractedCode.slice(0, 8)}...`);
                renderEditorialStage(true);
            }, 300);
        };

        // Comment 8: 扫描所有账号绑定的出口连通性（通=绿色，不通/超时=红色，相同地区=黄色）
        function probeAllAccountEgress() {
            setPreviewFrameState('busy', 1200);
            WBState.egressProbed = true;
            let passCount = 0;
            let failCount = 0;
            let dupCount = 0;

            // 统计各出口节点所属地区的使用频率 (例如 HK-BGP-01 的地区是 HK)
            const regionUsage = {};
            WBState.accounts.forEach(acc => {
                const nodeName = acc.egress || '';
                const nodePrefix = nodeName.split('-')[0] || acc.region || 'GLOBAL';
                regionUsage[nodePrefix] = (regionUsage[nodePrefix] || 0) + 1;
            });

            WBState.accounts.forEach(acc => {
                const isDirect = !acc.egress || acc.egress === 'Direct' || acc.egress === 'DIRECT' || acc.egress === '本机出口';
                if (isDirect) {
                    acc._probeResult = 'LOCAL'; // 未选择出口节点统一变黄（视为本机出口）
                    dupCount++;
                    return;
                }
                const node = WBState.nodes.find(n => n.name === acc.egress);
                const nodePrefix = (acc.egress || '').split('-')[0] || acc.region || 'GLOBAL';
                if (!node || node.timeout || node.status === 'error') {
                    acc._probeResult = 'FAIL'; // 超时/不通: 红色
                    failCount++;
                } else if ((regionUsage[nodePrefix] || 0) > 1) {
                    acc._probeResult = 'DUPLICATE'; // 相同地区: 黄色警示
                    dupCount++;
                } else {
                    acc._probeResult = 'PASS'; // 通且独占地区: 绿色
                    passCount++;
                }
            });

            try {
                if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerTileNote === 'function') {
                    soundscape.triggerTileNote(failCount > 0 ? 3 : 8);
                }
            } catch(e) {}

            notifyEditorialStatus(`PROBED ALL ${WBState.accounts.length} ACCOUNT EGRESS // ${passCount} PASS, ${failCount} FAIL, ${dupCount} DUP REGION`);
            setTimeout(() => {
                const allTimedOut = failCount > 0 && passCount === 0 && dupCount === 0;
                setPreviewFrameState(allTimedOut ? "error" : "success", 800);
            }, 1200);
            renderEditorialStage(true);
        }

        // Comment 6: 积分构成数学模型悬停交互
        function sortAccountsAlphanumeric(accList) {
        return accList.slice().sort((a, b) => {
            const aName = a.name || '';
            const bName = b.name || '';
            const isADigit = /^\d/.test(aName);
            const isBDigit = /^\d/.test(bName);
            if (isADigit && !isBDigit) return -1;
            if (!isADigit && isBDigit) return 1;
            return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    function getWeibullModelPoints() {
        const daysArr = [1, 3, 5, 10, 20, 30];
        const allPacks = WBState.accounts.flatMap(getAccountActivePackages).filter(p => p.days != null);
        const total = allPacks.reduce((sum, p) => sum + (Number(p.remain) || 0), 0);
        const packCounts = daysArr.map(day => {
            let packs = 0;
            WBState.accounts.forEach(acc => {
                const activePacks = getAccountActivePackages(acc);
                packs += activePacks.filter(p => p.days !== null && p.days <= day).length;
            });
            return packs;
        });
        const maxPacks = Math.max(1, ...packCounts);
        return daysArr.map((day, i) => {
            let expAcc = 0;
            let packs = packCounts[i];
            WBState.accounts.forEach(acc => {
                const activePacks = getAccountActivePackages(acc);
                if (activePacks.some(p => p.days !== null && p.days <= day)) expAcc++;
            });
            const remaining = allPacks.filter(p => p.days > day).reduce((sum, p) => sum + (Number(p.remain) || 0), 0);
            const survival = total > 0 ? 100 * remaining / total : 0;
            const x = [40, 110, 210, 310, 410, 500][i];
            // 遵从要求：包越多则折线上点越高（SVG Y 越小）
            const y = Math.round(64 - (packs / maxPacks) * 48);
            return { day, survival, expAcc, packs, x, y };
        });
    }

    window.hoverPackageModelPoint = (idx) => {
        if (!Number.isInteger(idx) || idx < 0) { setVertexHover(-1); return; }
        const points = getWeibullModelPoints();
        const p = points[idx];
        if (!p) return;
        WBState.packageModelHoverIdx = idx;
        const titleEl = document.getElementById('pkg-model-readout');
        if (titleEl) {
            titleEl.textContent = `时段 ${p.day}天 — 存活积分 ${p.survival.toFixed(1)}% / 预计到期 ${p.expAcc} 账号 / 剩余包数 ${p.packs} 个`;
        }
        const curEl = document.getElementById('pkg-model-cursor');
        if (curEl) {
            const xVal = p.x;
            curEl.setAttribute('x1', xVal);
            curEl.setAttribute('x2', xVal);
        }
        setVertexHover(idx * 4 + 2, `EXPIRY // ${p.day}D`);
    };

    window.hoverAccountModelPoint = (idx) => {
        if (!Number.isInteger(idx) || idx < 0) { setVertexHover(-1); return; }
        const sortedAccs = sortAccountsAlphanumeric(WBState.accounts.filter(a => !a.blocked && a.state !== 'BLOCKED'));
        const pageSize = 6;
        const slice = sortedAccs.slice((WBState.packageModelAccountPage || 0) * pageSize, ((WBState.packageModelAccountPage || 0) + 1) * pageSize);
        const acc = slice[idx];
        if (!acc) return;
        WBState.packageModelAccountUid = acc.uid;
        const activePacks = getAccountActivePackages(acc);
        const titleEl = document.getElementById('pkg-model-readout');
        if (titleEl) {
            titleEl.textContent = `账号 ${acc.name} — 积分 ${(acc.balance || 0).toLocaleString()} / 额度 ${(acc.quota || 5000).toLocaleString()} / 独立包 ${activePacks.length}`;
        }
        const curEl = document.getElementById('pkg-model-cursor');
        if (curEl) {
            const xCoords = [40, 120, 200, 280, 360, 440];
            const xVal = xCoords[idx] !== undefined ? xCoords[idx] : 120;
            curEl.setAttribute('x1', xVal);
            curEl.setAttribute('x2', xVal);
        }
        setVertexHover(idx * 4 + 1, `ACC // ${acc.name.toUpperCase()}`);
    };

    window.changePackageAccountPage = (p) => {
        WBState.packageAccountPage = p;
        soundscape.triggerTileNote(3);
        renderEditorialStage(true);
    };

    window.changeModelAccountPage = (p) => {
        WBState.packageModelAccountPage = p;
        soundscape.triggerTileNote(3);
        renderEditorialStage(true);
    };

    function fetchUpstreamModels() {
            WBState.modelCacheHot = true;
            WBState.models.forEach(m => {
                m.ttft = Math.max(92, m.ttft + Math.floor((Math.random() - 0.5) * 16));
                m.trend.shift();
                m.trend.push(m.ttft);
            });
            notifyEditorialStatus(`SYNCED ${WBState.models.length} UPSTREAM MODELS`);
            updateEditorialKeyFigures(true);
            renderEditorialStage(true);
        }

        // Comment 10: 流水线执行时含报错工序推进到 1/9 处即突然冒红，绝不先走满白线到末尾
        let pipelineTimers = [];
        function clearPipelineTimers() {
            pipelineTimers.forEach(t => clearTimeout(t));
            pipelineTimers = [];
        }

        let maintenanceStarting = false;
        async function startMaintenance() {
            if (maintenanceStarting) return;
            maintenanceStarting = true;
            notifyEditorialStatus('正在启动任务…');
            try {
                const token = csrfToken || window.csrfToken || '';
                const response = await fetch('/panel/api/maintenance/run', {
                    method: 'POST', credentials: 'same-origin',
                    headers: {'Content-Type': 'application/json', 'X-CSRF-Token': token},
                    body: '{}', signal: AbortSignal.timeout(10000)
                });
                if (response.status === 409) {
                    const status = await safeApiFetch('/panel/api/maintenance/status', {}, 10000);
                    if (status && syncMaintenanceData(status)) renderEditorialStage(false);
                    notifyEditorialStatus('任务正在运行，请等待完成');
                } else if (response.status === 401 || response.status === 403) {
                    notifyEditorialStatus('登录已失效或验证失败，请重新登录');
                } else if (!response.ok) {
                    notifyEditorialStatus('任务启动失败，服务返回 HTTP ' + response.status);
                } else {
                    const status = await response.json();
                    syncMaintenanceData(status);
                    renderEditorialStage(false);
                    notifyEditorialStatus('任务已启动');
                }
            } catch (_) {
                notifyEditorialStatus('任务启动请求失败，请检查服务连接');
            } finally { maintenanceStarting = false; }
        }

        function runFourStepPipeline() {
            if (IS_PROD_ENV) {
                return startMaintenance();
            }
            if (WBState.tasks.running) return;
            clearPipelineTimers();
            WBState.tasks.pausedAll = false;
            WBState.tasks.selectedStepCode = null;
            WBState.tasks.running = true;
            WBState.tasks.activeStep = 0;
            WBState.tasks.steps.forEach((s, idx) => { s.progress = 0; updateTaskRowInPlace(idx); });
            updateEditorialKeyFigures(false);
            notifyEditorialStatus('SCHEDULED PIPELINE RUNNING // MUTEX LOCKED');

            // Comment 5: 流水线执行期间 3D 几何与外圈以 2.0 倍速旋转，直至任务执行结束
            if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);

            [0, 1, 2, 3].forEach((stepIdx) => {
                const tStart = setTimeout(() => {
                    if (WBState.tasks.pausedAll) return;
                    WBState.tasks.activeStep = stepIdx;
                    const st = WBState.tasks.steps[stepIdx];
                    const hasFail = (st.failures && st.failures.length > 0);
                    st.progress = hasFail ? 90 : 85;
                    st.dur = `${95 + Math.floor(Math.random() * 160)} ms`;

                    if (hasFail) {
                        setPreviewFrameState('error', 700);
                        setTimeout(() => {
                            if (WBState.tasks.running) if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                        }, 750);
                    } else {
                        soundscape.triggerTileNote(stepIdx * 3 + 2);
                    }

                    updateTaskRowInPlace(stepIdx);
                    updateEditorialKeyFigures(false);
                }, stepIdx * 360 + 60);
                pipelineTimers.push(tStart);

                const tFinish = setTimeout(() => {
                    if (WBState.tasks.pausedAll) return;
                    const st = WBState.tasks.steps[stepIdx];
                    st.progress = 100;
                    updateTaskRowInPlace(stepIdx);
                    updateEditorialKeyFigures(false);

                    if (stepIdx === 3) {
                        WBState.tasks.running = false;
                        WBState.tasks.activeStep = -1;
                        // 任务流水线全部结束，平稳恢复为 1.0x 转速
                        const anyStepFailed = WBState.tasks.steps.some(s => (s.failures && s.failures.length > 0) || s.progress < 100);
                        if (!anyStepFailed) {
                            setPreviewFrameState("success", 800);
                        } else {
                            setPreviewFrameState("idle"); // 存在报错时绝不显示绿色！
                        }
                        WBState.isGlobalSpinning = false;
                        if (WBState.spinTimer) {
                            clearTimeout(WBState.spinTimer);
                            WBState.spinTimer = null;
                        }
                        notifyEditorialStatus('PIPELINE COMPLETED // CHECK STATUS');
                        updateEditorialKeyFigures(false);
                    }
                }, stepIdx * 360 + 320);
                pipelineTimers.push(tFinish);
            });
        }

        // 统一任务流水线方法名别名导出
        function runTaskPipeline() {
            return runFourStepPipeline();
        }
        window.runTaskPipeline = runTaskPipeline;

        window.togglePauseAllTasks = togglePauseAllTasks;
        async function togglePauseAllTasks() {
            if (IS_PROD_ENV) {
                if (!WBState.tasks.running) { notifyEditorialStatus('当前没有正在运行的任务'); return; }
                if (taskActionPending) return;
                taskActionPending = true;
                try {
                    const status = await safeApiFetch('/panel/api/maintenance/pause', {method: 'POST', body: JSON.stringify({paused: !WBState.tasks.pausedAll})}, 10000);
                    if (!status) { notifyEditorialStatus('任务状态更新失败，请重试'); return; }
                    syncMaintenanceData(status);
                    renderEditorialStage(false);
                    notifyEditorialStatus(status.paused ? '当前账号处理结束后暂停本次任务' : '本次任务已继续');
                } finally { taskActionPending = false; }
                return;
            }
            clearPipelineTimers();
            WBState.isGlobalSpinning = false;
            if (WBState.spinTimer) {
                clearTimeout(WBState.spinTimer);
                WBState.spinTimer = null;
            }
            WBState.tasks.running = false;
            WBState.tasks.activeStep = -1;
            WBState.tasks.selectedStepCode = null;
            WBState.tasks.pausedAll = !WBState.tasks.pausedAll;
            const isP = WBState.tasks.pausedAll;
            notifyEditorialStatus(isP ? "ALL SCHEDULED TASKS PAUSED" : "ALL SCHEDULED TASKS RESUMED");

            const s2 = document.getElementById("page-spec-2");
            const s3 = document.getElementById("page-spec-3");
            const faultSteps = WBState.tasks.steps.filter(s => (s.failures?.length || 0) > 0).length;
            const targetS2 = isP ? "已全部停用" : (WBState.tasks.running ? "执行锁定" : "空闲就绪");
            const targetS3 = isP ? "已挂起" : (faultSteps > 0 ? `${faultSteps} 项含报错` : "全部正常");
            if (s2) scrambleText(s2, targetS2, 400);
            if (s3) scrambleText(s3, targetS3, 400);

            WBState.tasks.steps.forEach((st, idx) => {
                const rows = document.querySelectorAll("#editorial-stage-body .editorial-row");
                const rowEl = rows[idx];
                const stateSpan = rowEl?.children?.[5];
                if (stateSpan) {
                    scrambleText(stateSpan, isP ? "已暂停" : (st.failures?.length ? "报错" : "正常"), 360);
                }
                // Comment 4: 切换时不通过 innerHTML 销毁重建 DOM，保持 DOM 节点持久，实现平滑反向 transition
                const shell = rowEl?.querySelector(".task-line-shell");
                if (shell) {
                    const activeTrack = shell.querySelector(".task-active-track");
                    const grayTrack = shell.querySelector(".task-gray-track");
                    if (activeTrack) activeTrack.style.width = isP ? '0%' : '100%';
                    if (grayTrack) {
                        grayTrack.style.width = isP ? '100%' : '0%';
                        grayTrack.style.boxShadow = isP ? '-2.5px 0 0 0 #050605' : 'none';
                    }
                    const durSpan = rowEl.children[4];
                    if (durSpan) durSpan.textContent = st.dur;
                } else {
                    updateTaskRowInPlace(idx);
                }
            });
            syncDynamicBottomButtons();
        }

        // 重置主场景3D矩阵网格、瓦片与标签到初始完整可用状态，防止退出重登时原界面失效或不可点击
        function resetMainWorldState(showScene = true) {
            pageTransition.state = 'IDLE';
            pageTransition.progress = 0;
            hoveredTile = null;
            disperseTransitionParticles = [];
            if (Array.isArray(gridTiles)) {
                gridTiles.forEach(t => {
                    t._disintegrated = false;
                    t.transAlpha = 1;
                    t.revealAlpha = 1;
                    t.rotAngle = 0;
                    t.tiltScaleX = 1;
                    t.tiltScaleY = 1;
                    t.glow = 0;
                    t.targetZ = 0;
                    t.z = 0;
                    t.ox = 0;
                    t.oy = 0;
                    t.vx = 0;
                    t.vy = 0;
                    if (t.domLabel) {
                        t.domLabel.style.opacity = '1';
                        t.domLabel.style.pointerEvents = 'auto';
                        t.domLabel.classList.remove('hovered');
                    }
                });
            }
            if (labelsLayer) {
                labelsLayer.style.opacity = '1';
                labelsLayer.style.pointerEvents = 'none';
            }
            const ms = document.getElementById('main-scene');
            if (ms && showScene) {
                ms.classList.remove('pointer-events-none');
                ms.style.opacity = '1';
            }
        }

        function clearLocalSession() {
            csrfToken = '';
            window.csrfToken = '';
            localStorage.removeItem('wb_csrf_token');
            serverSession = null;
            memoryEncryptedBundle = null;
            WBState.accounts = [];
            WBState.subscriptions = [];
            WBState.currentChapter = null;
        }

        function endServerSession() {
            return safeApiFetch('/auth/logout', { method: 'POST', body: '{}' }).then(result => {
                if (!result || result.ok !== true) return false;
                clearLocalSession();
                return true;
            });
        }

        function logoutToStartPage(sessionAlreadyEnded = false) {
            authTransitionEpoch++;
            isAuthenticating = false;
            if (soundscape) {
                soundscape.releasePreparedAudio();
                soundscape.audioGeneration++;
                if (soundscape._customAudioTimer) {
                    clearTimeout(soundscape._customAudioTimer);
                    soundscape._customAudioTimer = null;
                }
                if (soundscape._defaultAmbientTimer) {
                    clearTimeout(soundscape._defaultAmbientTimer);
                    soundscape._defaultAmbientTimer = null;
                }
                soundscape.isCustomActive = false;
                soundscape.currentCustomUrl = null;
            }
            if (logoutResetTimer) clearTimeout(logoutResetTimer);
            logoutResetTimer = null;
            soundscape.triggerTransitionSweep(false);
            clearPipelineTimers();

            resetMainWorldState(false);
            WBState.currentChapter = null;
            mainSceneActive = false;

            // 登录页背景音量为主场景的三分之一。
            if (soundscape && soundscape.masterGain && soundscape.ctx) {
                const nowT = soundscape.ctx.currentTime;
                soundscape.masterGain.gain.cancelScheduledValues(nowT);
                soundscape.masterGain.gain.setValueAtTime(soundscape.masterGain.gain.value, nowT);
                soundscape.masterGain.gain.linearRampToValueAtTime(soundscape.isMuted ? 0 : 0.7 / 3, nowT + 1.2);
            }
            if (soundscape) soundscape.playCustomBackgroundTrack('', true);
            if (soundscape && soundscape.isMuted && soundscape.customAudio) {
                soundscape.customAudio.volume = 0.0;
            }

            projectPageView.style.opacity = '0';
            projectPageView.classList.add('pointer-events-none', 'hidden');
            projectPageView.classList.remove('flex');

            const mainScene = document.getElementById('main-scene');
            const topControls = document.getElementById('top-right-controls');
            const weatherSwitcher = document.getElementById('weather-switcher');
            const mainFooter = document.getElementById('main-footer');
            const introLayer = document.getElementById('intro-layer');
            const counterBox = document.getElementById('counter-box');
            const promptBox = document.getElementById('prompt-box');
            const pwdContainer = document.getElementById('password-container');
            const pwdHint = document.getElementById('password-hint');
            const accessInput = document.getElementById('input-access-key');
            const enterBtn = document.getElementById('btn-enter-system');
            const loadingStatus = document.getElementById('loading-status');

            if (mainScene) {
                mainScene.style.opacity = '0';
                mainScene.classList.add('pointer-events-none');
            }
            if (topControls) {
                topControls.classList.add('hidden');
                topControls.classList.remove('flex');
            }
            if (weatherSwitcher) {
                weatherSwitcher.classList.add('hidden');
                weatherSwitcher.classList.remove('flex');
            }
            if (mainFooter) mainFooter.style.opacity = '0';
            // 先注销服务端会话，再执行视觉复位，快速重登时不会保留旧会话。
            if (sessionAlreadyEnded) {
                clearLocalSession();
                logoutPromise = Promise.resolve(true);
            } else {
                logoutPromise = endServerSession();
            }

            logoutResetTimer = setTimeout(() => {
                logoutResetTimer = null;
                projectPageView.classList.add('hidden');
                projectPageView.classList.remove('flex');
                mainSceneActive = false;

                if (counterBox) {
                    counterBox.classList.remove('hidden');
                    counterBox.style.opacity = '1';
                }
                if (promptBox) {
                    promptBox.classList.add('hidden');
                    promptBox.classList.remove('flex');
                    promptBox.style.opacity = '0';
                }
                if (pwdContainer) {
                    pwdContainer.style.opacity = '1';
                    pwdContainer.style.transform = 'translateY(0)';
                }
                if (pwdHint) pwdHint.style.opacity = '1';
                if (loadingStatus) loadingStatus.textContent = '[ SESSION LOCKED // AUTH REQUIRED ]';
        if (accessInput) accessInput.value = '';
        applyCurrentMottoToHome();
                if (accessInput) {
                    accessInput.value = '';
                }

                // 显示开场层前绘制新首帧，避免露出上一轮网格残影。
                if (!introActive) {
                    introActive = true;
                    initIntroGrid();
                    introStartTime = performance.now();
                    lastAmbientSpawnTime = 0;
                    renderIntroGrid(introStartTime);
                }

                if (introLayer) {
                    introLayer.classList.remove('hidden');
                    introLayer.style.pointerEvents = 'auto';
                    requestAnimationFrame(() => {
                        introLayer.style.opacity = '1';
                        if (accessInput) accessInput.focus();
                        if (enterBtn) scrambleText(enterBtn, '[ ACCESS WORKSPACE ]', 420);
                    });
                }

                backendPreloadFinished = false;
                backendPreloadSuccess = false;
                startStrictLoadingSequence();

            }, 360);
        }

        // ==================== 原装 12 尊立体几何建模库（100% 源自 3.html） ====================
        function buildOriginalGeometry(geoId) {
            let verts = [];
            let edges = [];

            if (geoId === 'egress') {
                const yTable = -34, yGirdle = -4, yCulet = 46;
                const rTable = 24, rGirdle = 52;
                for (let i = 0; i < 8; i++) {
                    const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
                    verts.push([Math.cos(ang) * rTable, yTable, Math.sin(ang) * rTable]);
                    edges.push([i, (i + 1) % 8]);
                }
                for (let i = 0; i < 16; i++) {
                    const ang = (i / 16) * Math.PI * 2;
                    verts.push([Math.cos(ang) * rGirdle, yGirdle, Math.sin(ang) * rGirdle]);
                }
                for (let i = 8; i < 24; i++) edges.push([i, i === 23 ? 8 : i + 1]);
                for (let i = 0; i < 8; i++) {
                    edges.push([i, 8 + i * 2], [i, 8 + (i * 2 + 1) % 16], [i, 8 + (i * 2 + 2) % 16]);
                }
                verts.push([0, yCulet, 0]);
                for (let i = 8; i < 24; i++) edges.push([i, 24]);

            } else if (geoId === 'packages') {
                const rCore = 46, rStar = 64;
                verts.push([rCore,0,0], [-rCore,0,0], [0,rCore,0], [0,-rCore,0], [0,0,rCore], [0,0,-rCore]);
                const starSigns = [[1,1,1],[-1,1,1],[1,-1,1],[-1,-1,1],[1,1,-1],[-1,1,-1],[1,-1,-1],[-1,-1,-1]];
                starSigns.forEach(([sx, sy, sz]) => verts.push([sx * (rStar * 0.58), sy * (rStar * 0.58), sz * (rStar * 0.58)]));
                const midEdges = [[0,2],[2,1],[1,3],[3,0],[0,4],[2,4],[1,4],[3,4],[0,5],[2,5],[1,5],[3,5]];
                midEdges.forEach(([a, b]) => {
                    const va = verts[a], vb = verts[b];
                    verts.push([(va[0]+vb[0])*0.5, (va[1]+vb[1])*0.5, (va[2]+vb[2])*0.5]);
                    edges.push([a, b]);
                });
                const starConns = [[6,0],[6,2],[6,4],[7,1],[7,2],[7,4],[8,0],[8,3],[8,4],[9,1],[9,3],[9,4],[10,0],[10,2],[10,5],[11,1],[11,2],[11,5],[12,0],[12,3],[12,5],[13,1],[13,3],[13,5]];
                starConns.forEach(([s, m]) => edges.push([s, m]));

            } else if (geoId === 'customization') {
                // PRISM CHORD (调色棱镜与和弦琴弦：双层六棱柱 + 错位对角线和弦)
                const r = 48, h = 54;
                for (let i = 0; i < 6; i++) {
                    const ang = (i / 6) * Math.PI * 2;
                    verts.push([Math.cos(ang) * r, -h * 0.5, Math.sin(ang) * r]);
                    verts.push([Math.cos(ang) * r, h * 0.5, Math.sin(ang) * r]);
                }
                for (let i = 0; i < 6; i++) {
                    const next = (i + 1) % 6;
                    edges.push([i * 2, next * 2]);
                    edges.push([i * 2 + 1, next * 2 + 1]);
                    edges.push([i * 2, i * 2 + 1]);
                    edges.push([i * 2, next * 2 + 1]);
                    edges.push([i * 2, ((i + 3) % 6) * 2 + 1]);
                }
                verts.push([0, -h * 0.82, 0], [0, h * 0.82, 0]);
                for (let i = 0; i < 6; i++) {
                    edges.push([12, i * 2]);
                    edges.push([13, i * 2 + 1]);
                }
            } else if (geoId === 'sphere') {
                const r = 52, rings = 3, segs = 6;
                verts = [[0, -r * 1.12, 0], [0, r * 1.12, 0]];
                for (let j = 1; j <= rings; j++) {
                    const phi = (j / (rings + 1)) * Math.PI;
                    const y0 = -Math.cos(phi) * r;
                    const ringR = Math.sin(phi) * r;
                    for (let i = 0; i < segs; i++) {
                        const theta = (i / segs) * Math.PI * 2 + (j % 2) * (Math.PI / segs);
                        verts.push([Math.cos(theta) * ringR, y0, Math.sin(theta) * ringR]);
                    }
                }
                for (let a = 0; a < verts.length; a++) {
                    for (let b = a + 1; b < verts.length; b++) {
                        const d = Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1], verts[a][2] - verts[b][2]);
                        if (d < r * 0.98) edges.push([a, b]);
                    }
                }

            } else if (geoId === 'overview') {
                const r = 26, hCol = 48, hCap = 16;
                verts.push([0, -hCol - hCap, 0], [0, hCol + hCap, 0]);
                for (let i = 0; i < 6; i++) {
                    const ang = (i / 6) * Math.PI * 2;
                    verts.push([Math.cos(ang) * r, -hCol, Math.sin(ang) * r], [Math.cos(ang) * r, hCol, Math.sin(ang) * r]);
                }
                for (let i = 0; i < 6; i++) {
                    const cT = 2 + i * 2, cB = 3 + i * 2, nT = 2 + ((i + 1) % 6) * 2, nB = 3 + ((i + 1) % 6) * 2;
                    edges.push([0, cT], [1, cB], [cT, cB], [cT, nT], [cB, nB]);
                }

            } else if (geoId === 'accounts') {
                const s = 40;
                for (let x of [-s, s]) for (let y of [-s, s]) for (let z of [-s, s]) verts.push([x, y, z]);
                edges.push([0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]);
                const faceCenters = [[s,0,0],[-s,0,0],[0,s,0],[0,-s,0],[0,0,s],[0,0,-s]];
                faceCenters.forEach((fc, idx) => {
                    const fi = verts.length;
                    verts.push(fc);
                    const groups = [[1,3,5,7],[0,2,4,6],[2,3,6,7],[0,1,4,5],[4,5,6,7],[0,1,2,3]];
                    groups[idx].forEach(c => edges.push([fi, c]));
                });
                verts.push([0, 0, 0]);

            } else if (geoId === 'tasks') {
                const lArm = 64, wArm = 12;
                for (let x of [-wArm, wArm]) for (let y of [-wArm, wArm]) for (let z of [-wArm, wArm]) verts.push([x, y, z]);
                edges.push([0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]);
                [[lArm,0,0],[-lArm,0,0],[0,lArm,0],[0,-lArm,0],[0,0,lArm],[0,0,-lArm]].forEach(d => {
                    const bi = verts.length;
                    verts.push(d);
                    for (let k = 0; k < 4; k++) edges.push([bi, k * 2]);
                });

            } else if (geoId === 'usage') {
                [{ w: 50, h: 11, y: 24 }, { w: 34, h: 11, y: 2 }, { w: 18, h: 11, y: -20 }].forEach(tier => {
                    const b = verts.length;
                    for (let x of [-tier.w, tier.w]) for (let y of [tier.y - tier.h, tier.y + tier.h]) for (let z of [-tier.w, tier.w]) verts.push([x, y, z]);
                    [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]].forEach(([a, c]) => edges.push([b + a, b + c]));
                });

            } else if (geoId === 'models') {
                const lPrism = 60, wPrism = 12;
                for (let u of [-lPrism, lPrism]) for (let a of [-wPrism, wPrism]) for (let b of [-wPrism, wPrism]) {
                    verts.push([u * 0.86 + a * 0.5, u * 0.5 - a * 0.86, b]);
                }
                for (let u of [-lPrism, lPrism]) for (let a of [-wPrism, wPrism]) for (let b of [-wPrism, wPrism]) {
                    verts.push([-u * 0.86 + a * 0.5, u * 0.5 + a * 0.86, b]);
                }
                [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]].forEach(([a, b]) => {
                    edges.push([a, b], [a + 8, b + 8]);
                });
                edges.push([0,8],[1,9],[6,14],[7,15]);

            } else if (geoId === 'logs') {
                const s = 30, shift = 14;
                for (let x of [-s, s]) for (let y of [-s, s]) for (let z of [-s, s]) verts.push([x - shift * 0.5, y + shift * 0.5, z]);
                for (let x of [-s, s]) for (let y of [-s, s]) for (let z of [-s, s]) verts.push([x + shift * 0.5, y - shift * 0.5, z]);
                [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]].forEach(([a, b]) => {
                    edges.push([a, b], [a + 8, b + 8]);
                });
                edges.push([2, 8], [3, 9]);

            } else if (geoId === 'encryption') {
                const rInner = 28, rMid = 44, rStar = 62;
                verts.push([rInner,0,0], [-rInner,0,0], [0,rInner,0], [0,-rInner,0], [0,0,rInner], [0,0,-rInner]);
                for (let x of [-rMid*0.7, rMid*0.7]) for (let y of [-rMid*0.7, rMid*0.7]) for (let z of [-rMid*0.7, rMid*0.7]) verts.push([x, y, z]);
                const sVal = rStar * 0.58;
                [[sVal,sVal,sVal],[-sVal,-sVal,sVal],[-sVal,sVal,-sVal],[sVal,-sVal,-sVal],[-sVal,sVal,sVal],[sVal,-sVal,sVal],[sVal,sVal,-sVal],[-sVal,-sVal,-sVal]].forEach(p => verts.push(p));
                for (let i = 0; i < 10; i++) {
                    const ang = (i / 10) * Math.PI * 2;
                    verts.push([Math.cos(ang) * (rStar * 0.85), Math.sin(ang * 2) * 14, Math.sin(ang) * (rStar * 0.85)]);
                }
                [[0,2],[2,1],[1,3],[3,0],[0,4],[2,4],[1,4],[3,4],[0,5],[2,5],[1,5],[3,5]].forEach(([a, b]) => edges.push([a, b]));
                for (let i = 0; i < 8; i++) edges.push([6 + i, 14 + i], [6 + i, i % 6]);
                for (let i = 22; i < 32; i++) edges.push([i, i === 31 ? 22 : i + 1], [i, 14 + (i % 8)]);

            } else if (geoId === 'scheduler') {
                const phi = (1 + Math.sqrt(5)) * 0.5, invPhi = 1 / phi, rBase = 32, rApex = 64;
                for (let x of [-1, 1]) for (let y of [-1, 1]) for (let z of [-1, 1]) verts.push([x * rBase * invPhi, y * rBase * invPhi, z * rBase * invPhi]);
                for (let s1 of [-1, 1]) for (let s2 of [-1, 1]) {
                    verts.push([0, s1 * rBase, s2 * rBase * invPhi * invPhi]);
                    verts.push([s1 * rBase * invPhi * invPhi, 0, s2 * rBase]);
                    verts.push([s1 * rBase, s2 * rBase * invPhi * invPhi, 0]);
                }
                const aS = rApex * 0.72;
                [[0,aS*phi,aS],[0,-aS*phi,aS],[0,aS*phi,-aS],[0,-aS*phi,-aS],[aS,0,aS*phi],[-aS,0,aS*phi],[aS,0,-aS*phi],[-aS,0,-aS*phi],[aS*phi,aS,0],[-aS*phi,aS,0],[aS*phi,-aS,0],[-aS*phi,-aS,0]].forEach(p => verts.push(p));
                for (let i = 0; i < 12; i++) for (let k = 0; k < 5; k++) edges.push([20 + i, (i * 3 + k * 2) % 20]);

            } else {
                const rOct = 52, hHalf = 18;
                for (let i = 0; i < 8; i++) {
                    const ang = (i / 8) * Math.PI * 2;
                    verts.push([Math.cos(ang) * rOct, -hHalf, Math.sin(ang) * rOct], [Math.cos(ang) * rOct, hHalf, Math.sin(ang) * rOct]);
                }
                for (let i = 0; i < 8; i++) {
                    const tC = i * 2, bC = i * 2 + 1, tN = ((i + 1) % 8) * 2, bN = ((i + 1) % 8) * 2 + 1;
                    edges.push([tC, bC], [tC, tN], [bC, bN], [tC, bN]);
                }
            }
            return { verts, edges };
        }

        // ==================== 框内三维平滑插值变形与纯虚线连接状态机 ====================
        const morphEngine = {
            activeGeoId: '',
            fromVerts: [],
            toVerts: [],
            edges: [],
            edgeSet: new Set(),
            startTime: 0,
            duration: 540
        };

        function triggerInFrameGeometryMorph(targetGeoId) {
            const next = buildOriginalGeometry(targetGeoId);
            if (morphEngine.toVerts.length > 0) {
                const now = performance.now();
                const prevU = Math.min(1, (now - morphEngine.startTime) / morphEngine.duration);
                const easePrev = prevU * prevU * (3 - 2 * prevU);
                const snapshot = morphEngine.toVerts.map((tv, i) => {
                    const sv = morphEngine.fromVerts[i % morphEngine.fromVerts.length] || tv;
                    return [lerpNum(sv[0], tv[0], easePrev), lerpNum(sv[1], tv[1], easePrev), lerpNum(sv[2], tv[2], easePrev)];
                });
                morphEngine.fromVerts = next.verts.map((tv, i) => {
                    const src = snapshot[i % snapshot.length];
                    return [src[0], src[1], src[2]];
                });
            } else {
                morphEngine.fromVerts = next.verts.map(v => [v[0], v[1], v[2]]);
            }
            morphEngine.toVerts = next.verts;
            morphEngine.edges = next.edges;
            morphEngine.edgeSet = new Set(next.edges.map(([a, b]) => a < b ? `${a}_${b}` : `${b}_${a}`));
            morphEngine.activeGeoId = targetGeoId;
            morphEngine.startTime = performance.now();

            const geoTagEl = document.getElementById('preview-geo-tag');
            const meta = Object.values(CHAPTER_META).find(m => m.geoId === targetGeoId);
            const labelName = meta ? meta.geoLabel : targetGeoId.toUpperCase();
            if (geoTagEl) {
                scrambleText(geoTagEl, `[ ${labelName} // ${next.verts.length}V ]`, 340);
            }
        }

        function projectPoint(vx, vy, vz, rx, ry, rz, cx, cy, fov = 270) {
            let y1 = vy * Math.cos(rx) - vz * Math.sin(rx);
            let z1 = vy * Math.sin(rx) + vz * Math.cos(rx);
            let x2 = vx * Math.cos(ry) + z1 * Math.sin(ry);
            let z2 = -vx * Math.sin(ry) + z1 * Math.cos(ry);
            let x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
            let y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
            let s = fov / (fov - z2);
            return [cx + x3 * s, cy + y3 * s, z2];
        }

        let previewLastNow = 0;
        let previewAnimTime = 0;

        // 全局 3D 几何与外圈标尺加速旋转触发器（1.5 倍速，切记对右侧所有几何模型生效）
        window.triggerModelSpinAcceleration = function(durationMs = 1200) {
            WBState.isGlobalSpinning = true;
            if (WBState.spinTimer) {
                clearTimeout(WBState.spinTimer);
                WBState.spinTimer = null;
            }
            if (durationMs > 0) {
                WBState.spinTimer = setTimeout(() => {
                    WBState.isGlobalSpinning = false;
                    WBState.spinTimer = null;
                }, durationMs);
            }
            return function stopSpin() {
                if (WBState.spinTimer) {
                    clearTimeout(WBState.spinTimer);
                    WBState.spinTimer = null;
                }
                WBState.isGlobalSpinning = false;
            };
        };

        function renderProjectArtifactPreview(now) {
            if (pageTransition.state === 'IN_PAGE' || pageTransition.state === 'EXPANDING_TO_PAGE') {
                const cw = PREVIEW_LOGICAL_SIZE;
                const ch = PREVIEW_LOGICAL_SIZE;
                pCtx.clearRect(0, 0, cw, ch);

                //  物理硬裁剪保底：所有图形与虚线连接严格锁死在正方形画框之内，绝不越界半像素！
                pCtx.save();
                pCtx.beginPath();
                pCtx.rect(4, 4, cw - 8, ch - 8);
                pCtx.clip();

                const cx = cw * 0.5;
                const cy = ch * 0.5;
                if (!previewLastNow) previewLastNow = now;
                const dt = Math.min(64, Math.max(0, now - previewLastNow));
                previewLastNow = now;

                const speedMultiplier = WBState.isGlobalSpinning ? 2.0 : 1.0;
                previewAnimTime += dt * 0.0011 * speedMultiplier;
                const t = previewAnimTime;

                // 1. 外层双同心圆标尺与动态扫描光弧 (R=118)
                pCtx.setLineDash([]);
                pCtx.lineWidth = 1;
                const ringState = (WBState.oauthWaiting ? "busy" : (WBState.ringState || (WBState.inTaskFaultFlash ? "error" : "idle")));

                // 基础轨道圆恒定保持深暗色
                pCtx.strokeStyle = "rgba(255, 255, 255, 0.12)";
                pCtx.beginPath();
                pCtx.arc(cx, cy, 118, 0, Math.PI * 2);
                pCtx.stroke();

                // Comment 4: 模型外围圆圈那小部分扫描亮弧变色 (黄/红/绿)
                let rArcColor;
                if (ringState === "busy") {
                    // 黄色缓慢呼吸闪烁: 周期 1.8 秒，alpha 在 0.45 ~ 1.0 之间波动，最暗依然清晰可见亮黄色
                    const pulse = 0.72 + 0.28 * Math.sin(now * 0.0035);
                    rArcColor = `rgba(250, 204, 21, ${(pulse * 0.98).toFixed(3)})`;
                } else if (ringState === "error") {
                    rArcColor = "#ff5c74";
                } else if (ringState === "success") {
                    rArcColor = "#34d399";
                } else {
                    rArcColor = "rgba(255, 255, 255, 0.75)"; // 默认白色小段亮弧
                }

                pCtx.strokeStyle = rArcColor;
                pCtx.lineWidth = (ringState !== "idle") ? 2.0 : 1.2;
                pCtx.beginPath();
                pCtx.arc(cx, cy, 118, t * 1.25, t * 1.25 + Math.PI * 0.45);
                pCtx.stroke();
                pCtx.lineWidth = 1;

                pCtx.strokeStyle = "rgba(255, 255, 255, 0.06)";
                pCtx.beginPath();
                pCtx.arc(cx, cy, 126, 0, Math.PI * 2);
                pCtx.stroke();

                if (morphEngine.toVerts.length === 0) {
                    triggerInFrameGeometryMorph('overview');
                }

                // 2. 三维顶点平滑插值变形 (Vertex Morphing)
                const rawU = Math.min(1, (now - morphEngine.startTime) / morphEngine.duration);
                const easeU = rawU * rawU * (3 - 2 * rawU);
                const morphArc = Math.sin(rawU * Math.PI);

                const rx = t * 0.73, ry = t * 1.17, rz = t * 0.51;
                const proj = morphEngine.toVerts.map((tv, idx) => {
                    const sv = morphEngine.fromVerts[idx % morphEngine.fromVerts.length] || tv;
                    const vx = lerpNum(sv[0], tv[0], easeU);
                    const vy = lerpNum(sv[1], tv[1], easeU);
                    const vz = lerpNum(sv[2], tv[2], easeU);
                    return projectPoint(vx, vy, vz, rx, ry, rz, cx, cy);
                });

                //  3A. 框内纯虚线连接 I：切换章节时的内部拓扑重组虚线网 (100% 虚线，严格在 R=118 圆框内)
                if (morphArc > 0.02) {
                    const srcProj = morphEngine.fromVerts.map(([vx, vy, vz]) => projectPoint(vx, vy, vz, rx, ry, rz, cx, cy));
                    pCtx.save();
                    pCtx.setLineDash([3, 4]);
                    pCtx.lineWidth = 1.0;
                    pCtx.strokeStyle = `rgba(255, 255, 255, ${(morphArc * 0.42).toFixed(3)})`;
                    pCtx.beginPath();
                    // 源点到当前插值点的虚线牵引轨迹
                    for (let i = 0; i < proj.length; i++) {
                        const sp = srcProj[i % srcProj.length];
                        const cp = proj[i];
                        if (Math.hypot(cp[0] - sp[0], cp[1] - sp[1]) > 4) {
                            pCtx.moveTo(sp[0], sp[1]);
                            pCtx.lineTo(cp[0], cp[1]);
                        }
                    }
                    // 变形途中邻近非实棱顶点的瞬态虚线桥接
                    let bridgeCount = 0;
                    for (let a = 0; a < proj.length && bridgeCount < 14; a++) {
                        for (let b = a + 2; b < proj.length && bridgeCount < 14; b += 2) {
                            const key = `${a}_${b}`;
                            if (morphEngine.edgeSet.has(key)) continue;
                            const dist = Math.hypot(proj[a][0] - proj[b][0], proj[a][1] - proj[b][1]);
                            if (dist > 28 && dist < 82) {
                                pCtx.moveTo(proj[a][0], proj[a][1]);
                                pCtx.lineTo(proj[b][0], proj[b][1]);
                                bridgeCount++;
                            }
                        }
                    }
                    pCtx.stroke();
                    pCtx.restore();
                } else {
                    // 常驻极克制的框内呼吸对角虚线弦（仅 3 根，纯虚线，完全收敛在几何体内部）
                    pCtx.save();
                    pCtx.setLineDash([2, 5]);
                    pCtx.lineWidth = 0.85;
                    pCtx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
                    pCtx.beginPath();
                    const stepIdx = Math.max(1, Math.floor(proj.length / 3));
                    for (let k = 0; k < 3 && proj.length >= 4; k++) {
                        const iA = (k * stepIdx) % proj.length;
                        const iB = (iA + Math.floor(proj.length * 0.5)) % proj.length;
                        pCtx.moveTo(proj[iA][0], proj[iA][1]);
                        pCtx.lineTo(proj[iB][0], proj[iB][1]);
                    }
                    pCtx.stroke();
                    pCtx.restore();
                }

                //  3B. 框内纯虚线连接 II：左侧数据悬停时的框内标尺靶向虚线共鸣（绝不出框！）
                let targetedIdx = -1;
                if (WBState.hoveredVertexIdx >= 0 && proj.length > 0) {
                    targetedIdx = WBState.hoveredVertexIdx % proj.length;
                    const [tx, ty] = proj[targetedIdx];
                    const baseAng = Math.atan2(ty - cy, tx - cx);

                    pCtx.save();
                    pCtx.setLineDash([2.5, 4]);
                    pCtx.lineWidth = 1.05;
                    pCtx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
                    pCtx.beginPath();
                    // 从 R=118 标尺圆环上的两个相位锚点及圆心向目标顶点连接纯虚线（半径恒 <=118，绝不超出方框）
                    [-0.42, 0.42].forEach(offset => {
                        const ax = cx + Math.cos(baseAng + offset) * 118;
                        const ay = cy + Math.sin(baseAng + offset) * 118;
                        pCtx.moveTo(ax, ay);
                        pCtx.lineTo(tx, ty);
                    });
                    pCtx.moveTo(cx, cy);
                    pCtx.lineTo(tx, ty);
                    pCtx.stroke();

                    // 目标顶点外围虚线小方框靶标
                    pCtx.setLineDash([3, 2]);
                    pCtx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
                    pCtx.strokeRect(tx - 7, ty - 7, 14, 14);
                    pCtx.restore();
                }

                // 4. 绘制原装 1.6px 纯白立体几何棱线
                pCtx.setLineDash([]);
                pCtx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
                pCtx.lineWidth = 1.6;
                pCtx.beginPath();
                morphEngine.edges.forEach(([a, b]) => {
                    if (proj[a] && proj[b]) {
                        pCtx.moveTo(proj[a][0], proj[a][1]);
                        pCtx.lineTo(proj[b][0], proj[b][1]);
                    }
                });
                pCtx.stroke();

                // 5. 交接处精准锚定 4.5px 纯白实心方块节点
                proj.forEach(([px, py, pz], idx) => {
                    const zFactor = Math.max(0.45, Math.min(1.0, (pz + 100) / 200));
                    pCtx.fillStyle = '#ffffff';
                    pCtx.globalAlpha = idx === targetedIdx ? 1.0 : zFactor;
                    const size = idx === targetedIdx ? 5.5 : 4.5;
                    pCtx.fillRect(px - size * 0.5, py - size * 0.5, size, size);
                });
                pCtx.globalAlpha = 1.0;
                pCtx.restore();
            }
            requestAnimationFrame(renderProjectArtifactPreview);
        }

        // ==================== 章节填充、柔和过渡动画与底部功能按钮联动 ====================
        function populateProjectPageContent(rawId, animateContent = true) {
            let resolvedId = rawId;
            if (rawId === 'SETTINGS') resolvedId = 'encryption';
            else if (rawId === 'ABOUT') resolvedId = 'sphere';
            else if (rawId === 'SOCIALS') resolvedId = 'gateway';

            const meta = CHAPTER_META[resolvedId] || CHAPTER_META.overview;
            WBState.currentChapter = resolvedId;
            WBState.overrideSphere = false;
            WBState.selectedAccountUid = null;
            WBState.accountNodePage = 0;
            WBState.accountSubmode = null;
            WBState.importingSub = false;
            WBState.tasks.selectedStepCode = null;
            WBState.selectedPackageUid = null;
            WBState.selectedLogId = null;
            WBState.logView = 'LIST';
            WBState.logModelHoverIdx = -1;
            setVertexHover(-1);

            document.querySelectorAll('#chapter-nav .chapter-link').forEach(btn => {
                const isActive = (meta.navKey && meta.navKey !== 'sphere') ? (btn.getAttribute('data-chapter') === meta.navKey) : false;
                btn.classList.toggle('active', isActive);
            });

            scrambleText(document.getElementById('page-archive-tag'), `${meta.num} // ${meta.navKey.toUpperCase()}`, 320);
            scrambleText(document.getElementById('page-role'), meta.role, 340);
            scrambleText(document.getElementById('page-title'), meta.title, 320);

            const cnEl = document.getElementById('page-cn-subtitle');
            const descEl = document.getElementById('page-desc');
            if (cnEl) cnEl.textContent = meta.cn;
            if (descEl) descEl.textContent = meta.desc;

            syncDynamicBottomButtons();
            const btn1 = document.getElementById('btn-page-chord');
            const btn2 = document.getElementById('btn-page-ripple');
            if (btn1) scrambleActionButton(btn1, btn1.getAttribute('data-scramble') || meta.btn1, 230);
            if (btn2) scrambleActionButton(btn2, btn2.getAttribute('data-scramble') || meta.btn2, 230);

            const proj = PROJECTS.find(p => p.id === resolvedId) || PROJECTS[0];
            pageTransition.activeProject = proj;

            updateEditorialKeyFigures(animateContent);
            renderEditorialStage(animateContent);
            triggerInFrameGeometryMorph(meta.geoId);
        }

        
        // ==================== 个性化与自定义音景控制体系 ====================
        function switchCustomizationTab(tab) {
            WBState.customization.currentTab = tab;
            WBState.customization.page = 0;
            WBState.customization.isAdding = false;
            soundscape.triggerTileNote(3);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
        }

        function cancelCustomAdd() {
            WBState.customization.isAdding = false;
            soundscape.triggerTileNote(2);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
        }


        /* LAMEJS MP3 ENCODER EMBEDDED - 320KBPS HIGH FIDELITY STREAMING AUDIO */
        var lamejs = (function() {
function lamejs(){function X(c){return new Int32Array(c)}function K(c){return new Float32Array(c)}function ca(c){if(1==c.length)return K(c[0]);var k=c[0];c=c.slice(1);for(var n=[],u=0;u<k;u++)n.push(ca(c));return n}function Ia(c){if(1==c.length)return X(c[0]);var k=c[0];c=c.slice(1);for(var n=[],u=0;u<k;u++)n.push(Ia(c));return n}function dc(c){if(1==c.length)return new Int16Array(c[0]);var k=c[0];c=c.slice(1);for(var n=[],u=0;u<k;u++)n.push(dc(c));return n}function Ob(c){if(1==c.length)return Array(c[0]);
var k=c[0];c=c.slice(1);for(var n=[],u=0;u<k;u++)n.push(Ob(c));return n}function ra(c){this.ordinal=c}function G(c){this.ordinal=c}function la(c){this.ordinal=function(){return c}}function mc(){this.getLameVersion=function(){return"3.98.4"};this.getLameShortVersion=function(){return"3.98.4"};this.getLameVeryShortVersion=function(){return"LAME3.98r"};this.getPsyVersion=function(){return"0.93"};this.getLameUrl=function(){return"http://www.mp3dev.org/"};this.getLameOsBitness=function(){return"32bits"}}
function Y(){function c(f,b,c,a,m,k){for(;0!=m--;)c[a]=1E-10+f[b+0]*k[0]-c[a-1]*k[1]+f[b-1]*k[2]-c[a-2]*k[3]+f[b-2]*k[4]-c[a-3]*k[5]+f[b-3]*k[6]-c[a-4]*k[7]+f[b-4]*k[8]-c[a-5]*k[9]+f[b-5]*k[10]-c[a-6]*k[11]+f[b-6]*k[12]-c[a-7]*k[13]+f[b-7]*k[14]-c[a-8]*k[15]+f[b-8]*k[16]-c[a-9]*k[17]+f[b-9]*k[18]-c[a-10]*k[19]+f[b-10]*k[20],++a,++b}function k(f,b,c,a,m,k){for(;0!=m--;)c[a]=f[b+0]*k[0]-c[a-1]*k[1]+f[b-1]*k[2]-c[a-2]*k[3]+f[b-2]*k[4],++a,++b}function n(f){return f*f}var V=Y.RMS_WINDOW_TIME_NUMERATOR,
E=Y.RMS_WINDOW_TIME_DENOMINATOR,B=[[.038575994352,-3.84664617118067,-.02160367184185,7.81501653005538,-.00123395316851,-11.34170355132042,-9.291677959E-5,13.05504219327545,-.01655260341619,-12.28759895145294,.02161526843274,9.4829380631979,-.02074045215285,-5.87257861775999,.00594298065125,2.75465861874613,.00306428023191,-.86984376593551,1.2025322027E-4,.13919314567432,.00288463683916],[.0541865640643,-3.47845948550071,-.02911007808948,6.36317777566148,-.00848709379851,-8.54751527471874,-.00851165645469,
9.4769360780128,-.00834990904936,-8.81498681370155,.02245293253339,6.85401540936998,-.02596338512915,-4.39470996079559,.01624864962975,2.19611684890774,-.00240879051584,-.75104302451432,.00674613682247,.13149317958808,-.00187763777362],[.15457299681924,-2.37898834973084,-.09331049056315,2.84868151156327,-.06247880153653,-2.64577170229825,.02163541888798,2.23697657451713,-.05588393329856,-1.67148153367602,.04781476674921,1.00595954808547,.00222312597743,-.45953458054983,.03174092540049,.16378164858596,
-.01390589421898,-.05032077717131,.00651420667831,.0234789740702,-.00881362733839],[.30296907319327,-1.61273165137247,-.22613988682123,1.0797749225997,-.08587323730772,-.2565625775407,.03282930172664,-.1627671912044,-.00915702933434,-.22638893773906,-.02364141202522,.39120800788284,-.00584456039913,-.22138138954925,.06276101321749,.04500235387352,-8.28086748E-6,.02005851806501,.00205861885564,.00302439095741,-.02950134983287],[.33642304856132,-1.49858979367799,-.2557224142557,.87350271418188,-.11828570177555,
.12205022308084,.11921148675203,-.80774944671438,-.07834489609479,.47854794562326,-.0046997791438,-.12453458140019,-.0058950022444,-.04067510197014,.05724228140351,.08333755284107,.00832043980773,-.04237348025746,-.0163538138454,.02977207319925,-.0176017656815],[.4491525660845,-.62820619233671,-.14351757464547,.29661783706366,-.22784394429749,-.372563729424,-.01419140100551,.00213767857124,.04078262797139,-.42029820170918,-.12398163381748,.22199650564824,.04097565135648,.00613424350682,.10478503600251,
.06747620744683,-.01863887810927,.05784820375801,-.03193428438915,.03222754072173,.00541907748707],[.56619470757641,-1.04800335126349,-.75464456939302,.29156311971249,.1624213774223,-.26806001042947,.16744243493672,.00819999645858,-.18901604199609,.45054734505008,.3093178284183,-.33032403314006,-.27562961986224,.0673936833311,.00647310677246,-.04784254229033,.08647503780351,.01639907836189,-.0378898455484,.01807364323573,-.00588215443421],[.58100494960553,-.51035327095184,-.53174909058578,-.31863563325245,
-.14289799034253,-.20256413484477,.17520704835522,.1472815413433,.02377945217615,.38952639978999,.15558449135573,-.23313271880868,-.25344790059353,-.05246019024463,.01628462406333,-.02505961724053,.06920467763959,.02442357316099,-.03721611395801,.01818801111503,-.00749618797172],[.53648789255105,-.2504987195602,-.42163034350696,-.43193942311114,-.00275953611929,-.03424681017675,.04267842219415,-.04678328784242,-.10214864179676,.26408300200955,.14590772289388,.15113130533216,-.02459864859345,-.17556493366449,
-.11202315195388,-.18823009262115,-.04060034127,.05477720428674,.0478866554818,.0470440968812,-.02217936801134]],w=[[.98621192462708,-1.97223372919527,-1.97242384925416,.97261396931306,.98621192462708],[.98500175787242,-1.96977855582618,-1.97000351574484,.9702284756635,.98500175787242],[.97938932735214,-1.95835380975398,-1.95877865470428,.95920349965459,.97938932735214],[.97531843204928,-1.95002759149878,-1.95063686409857,.95124613669835,.97531843204928],[.97316523498161,-1.94561023566527,-1.94633046996323,
.94705070426118,.97316523498161],[.96454515552826,-1.92783286977036,-1.92909031105652,.93034775234268,.96454515552826],[.96009142950541,-1.91858953033784,-1.92018285901082,.92177618768381,.96009142950541],[.95856916599601,-1.9154210807478,-1.91713833199203,.91885558323625,.95856916599601],[.94597685600279,-1.88903307939452,-1.89195371200558,.89487434461664,.94597685600279]];this.InitGainAnalysis=function(f,b){a:{for(var c=0;c<MAX_ORDER;c++)f.linprebuf[c]=f.lstepbuf[c]=f.loutbuf[c]=f.rinprebuf[c]=
f.rstepbuf[c]=f.routbuf[c]=0;switch(0|b){case 48E3:f.reqindex=0;break;case 44100:f.reqindex=1;break;case 32E3:f.reqindex=2;break;case 24E3:f.reqindex=3;break;case 22050:f.reqindex=4;break;case 16E3:f.reqindex=5;break;case 12E3:f.reqindex=6;break;case 11025:f.reqindex=7;break;case 8E3:f.reqindex=8;break;default:b=INIT_GAIN_ANALYSIS_ERROR;break a}f.sampleWindow=0|(b*V+E-1)/E;f.lsum=0;f.rsum=0;f.totsamp=0;na.ill(f.A,0);b=INIT_GAIN_ANALYSIS_OK}if(b!=INIT_GAIN_ANALYSIS_OK)return INIT_GAIN_ANALYSIS_ERROR;
f.linpre=MAX_ORDER;f.rinpre=MAX_ORDER;f.lstep=MAX_ORDER;f.rstep=MAX_ORDER;f.lout=MAX_ORDER;f.rout=MAX_ORDER;na.fill(f.B,0);return INIT_GAIN_ANALYSIS_OK};this.AnalyzeSamples=function(f,b,v,a,m,u,e){if(0==u)return GAIN_ANALYSIS_OK;var l=0;var d=u;switch(e){case 1:a=b;m=v;break;case 2:break;default:return GAIN_ANALYSIS_ERROR}u<MAX_ORDER?(T.arraycopy(b,v,f.linprebuf,MAX_ORDER,u),T.arraycopy(a,m,f.rinprebuf,MAX_ORDER,u)):(T.arraycopy(b,v,f.linprebuf,MAX_ORDER,MAX_ORDER),T.arraycopy(a,m,f.rinprebuf,MAX_ORDER,
MAX_ORDER));for(;0<d;){var g=d>f.sampleWindow-f.totsamp?f.sampleWindow-f.totsamp:d;if(l<MAX_ORDER){e=f.linpre+l;var q=f.linprebuf;var D=f.rinpre+l;var p=f.rinprebuf;g>MAX_ORDER-l&&(g=MAX_ORDER-l)}else e=v+l,q=b,D=m+l,p=a;c(q,e,f.lstepbuf,f.lstep+f.totsamp,g,B[f.reqindex]);c(p,D,f.rstepbuf,f.rstep+f.totsamp,g,B[f.reqindex]);k(f.lstepbuf,f.lstep+f.totsamp,f.loutbuf,f.lout+f.totsamp,g,w[f.reqindex]);k(f.rstepbuf,f.rstep+f.totsamp,f.routbuf,f.rout+f.totsamp,g,w[f.reqindex]);e=f.lout+f.totsamp;q=f.loutbuf;
D=f.rout+f.totsamp;p=f.routbuf;for(var r=g%8;0!=r--;)f.lsum+=n(q[e++]),f.rsum+=n(p[D++]);for(r=g/8;0!=r--;)f.lsum+=n(q[e+0])+n(q[e+1])+n(q[e+2])+n(q[e+3])+n(q[e+4])+n(q[e+5])+n(q[e+6])+n(q[e+7]),e+=8,f.rsum+=n(p[D+0])+n(p[D+1])+n(p[D+2])+n(p[D+3])+n(p[D+4])+n(p[D+5])+n(p[D+6])+n(p[D+7]),D+=8;d-=g;l+=g;f.totsamp+=g;f.totsamp==f.sampleWindow&&(e=10*Y.STEPS_per_dB*Math.log10((f.lsum+f.rsum)/f.totsamp*.5+1E-37),e=0>=e?0:0|e,e>=f.A.length&&(e=f.A.length-1),f.A[e]++,f.lsum=f.rsum=0,T.arraycopy(f.loutbuf,
f.totsamp,f.loutbuf,0,MAX_ORDER),T.arraycopy(f.routbuf,f.totsamp,f.routbuf,0,MAX_ORDER),T.arraycopy(f.lstepbuf,f.totsamp,f.lstepbuf,0,MAX_ORDER),T.arraycopy(f.rstepbuf,f.totsamp,f.rstepbuf,0,MAX_ORDER),f.totsamp=0);if(f.totsamp>f.sampleWindow)return GAIN_ANALYSIS_ERROR}u<MAX_ORDER?(T.arraycopy(f.linprebuf,u,f.linprebuf,0,MAX_ORDER-u),T.arraycopy(f.rinprebuf,u,f.rinprebuf,0,MAX_ORDER-u),T.arraycopy(b,v,f.linprebuf,MAX_ORDER-u,u),T.arraycopy(a,m,f.rinprebuf,MAX_ORDER-u,u)):(T.arraycopy(b,v+u-MAX_ORDER,
f.linprebuf,0,MAX_ORDER),T.arraycopy(a,m+u-MAX_ORDER,f.rinprebuf,0,MAX_ORDER));return GAIN_ANALYSIS_OK};this.GetTitleGain=function(f){var b=f.A;var c=f.A.length,a,m=0;for(a=0;a<c;a++)m+=b[a];if(0==m)b=GAIN_NOT_ENOUGH_SAMPLES;else{m=0|Math.ceil(m*(1-.95));for(a=c;0<a--&&!(0>=(m-=b[a])););b=64.82-a/Y.STEPS_per_dB}for(c=0;c<f.A.length;c++)f.B[c]+=f.A[c],f.A[c]=0;for(c=0;c<MAX_ORDER;c++)f.linprebuf[c]=f.lstepbuf[c]=f.loutbuf[c]=f.rinprebuf[c]=f.rstepbuf[c]=f.routbuf[c]=0;f.totsamp=0;f.lsum=f.rsum=0;return b}}
function wc(){function c(b,c,a,f,k,e,l,d,g,q,D,p,r,t,J){this.vbr_q=b;this.quant_comp=c;this.quant_comp_s=a;this.expY=f;this.st_lrm=k;this.st_s=e;this.masking_adj=l;this.masking_adj_short=d;this.ath_lower=g;this.ath_curve=q;this.ath_sensitivity=D;this.interch=p;this.safejoint=r;this.sfb21mod=t;this.msfix=J}function k(b,c,a,f,k,e,l,d,g,q,D,p,r,t){this.quant_comp=c;this.quant_comp_s=a;this.safejoint=f;this.nsmsfix=k;this.st_lrm=e;this.st_s=l;this.nsbass=d;this.scale=g;this.masking_adj=q;this.ath_lower=
D;this.ath_curve=p;this.interch=r;this.sfscale=t}function n(b,c,a){var f=b.VBR==G.vbr_rh?B:w,k=b.VBR_q_frac,e=f[c];f=f[c+1];e.st_lrm+=k*(f.st_lrm-e.st_lrm);e.st_s+=k*(f.st_s-e.st_s);e.masking_adj+=k*(f.masking_adj-e.masking_adj);e.masking_adj_short+=k*(f.masking_adj_short-e.masking_adj_short);e.ath_lower+=k*(f.ath_lower-e.ath_lower);e.ath_curve+=k*(f.ath_curve-e.ath_curve);e.ath_sensitivity+=k*(f.ath_sensitivity-e.ath_sensitivity);e.interch+=k*(f.interch-e.interch);e.msfix+=k*(f.msfix-e.msfix);f=
e.vbr_q;0>f&&(f=0);9<f&&(f=9);b.VBR_q=f;b.VBR_q_frac=0;0!=a?b.quant_comp=e.quant_comp:0<Math.abs(b.quant_comp- -1)||(b.quant_comp=e.quant_comp);0!=a?b.quant_comp_short=e.quant_comp_s:0<Math.abs(b.quant_comp_short- -1)||(b.quant_comp_short=e.quant_comp_s);0!=e.expY&&(b.experimentalY=0!=e.expY);0!=a?b.internal_flags.nsPsy.attackthre=e.st_lrm:0<Math.abs(b.internal_flags.nsPsy.attackthre- -1)||(b.internal_flags.nsPsy.attackthre=e.st_lrm);0!=a?b.internal_flags.nsPsy.attackthre_s=e.st_s:0<Math.abs(b.internal_flags.nsPsy.attackthre_s-
-1)||(b.internal_flags.nsPsy.attackthre_s=e.st_s);0!=a?b.maskingadjust=e.masking_adj:0<Math.abs(b.maskingadjust-0)||(b.maskingadjust=e.masking_adj);0!=a?b.maskingadjust_short=e.masking_adj_short:0<Math.abs(b.maskingadjust_short-0)||(b.maskingadjust_short=e.masking_adj_short);0!=a?b.ATHlower=-e.ath_lower/10:0<Math.abs(10*-b.ATHlower)||(b.ATHlower=-e.ath_lower/10);0!=a?b.ATHcurve=e.ath_curve:0<Math.abs(b.ATHcurve- -1)||(b.ATHcurve=e.ath_curve);0!=a?b.athaa_sensitivity=e.ath_sensitivity:0<Math.abs(b.athaa_sensitivity-
-1)||(b.athaa_sensitivity=e.ath_sensitivity);0<e.interch&&(0!=a?b.interChRatio=e.interch:0<Math.abs(b.interChRatio- -1)||(b.interChRatio=e.interch));0<e.safejoint&&(b.exp_nspsytune|=e.safejoint);0<e.sfb21mod&&(b.exp_nspsytune|=e.sfb21mod<<20);0!=a?b.msfix=e.msfix:0<Math.abs(b.msfix- -1)||(b.msfix=e.msfix);0==a&&(b.VBR_q=c,b.VBR_q_frac=k)}function V(b,c,a){var m=E.nearestBitrateFullIndex(c);b.VBR=G.vbr_abr;b.VBR_mean_bitrate_kbps=c;b.VBR_mean_bitrate_kbps=Math.min(b.VBR_mean_bitrate_kbps,320);b.VBR_mean_bitrate_kbps=
Math.max(b.VBR_mean_bitrate_kbps,8);b.brate=b.VBR_mean_bitrate_kbps;320<b.VBR_mean_bitrate_kbps&&(b.disable_reservoir=!0);0<f[m].safejoint&&(b.exp_nspsytune|=2);0<f[m].sfscale&&(b.internal_flags.noise_shaping=2);if(0<Math.abs(f[m].nsbass)){var k=int(4*f[m].nsbass);0>k&&(k+=64);b.exp_nspsytune|=k<<2}0!=a?b.quant_comp=f[m].quant_comp:0<Math.abs(b.quant_comp- -1)||(b.quant_comp=f[m].quant_comp);0!=a?b.quant_comp_short=f[m].quant_comp_s:0<Math.abs(b.quant_comp_short- -1)||(b.quant_comp_short=f[m].quant_comp_s);
0!=a?b.msfix=f[m].nsmsfix:0<Math.abs(b.msfix- -1)||(b.msfix=f[m].nsmsfix);0!=a?b.internal_flags.nsPsy.attackthre=f[m].st_lrm:0<Math.abs(b.internal_flags.nsPsy.attackthre- -1)||(b.internal_flags.nsPsy.attackthre=f[m].st_lrm);0!=a?b.internal_flags.nsPsy.attackthre_s=f[m].st_s:0<Math.abs(b.internal_flags.nsPsy.attackthre_s- -1)||(b.internal_flags.nsPsy.attackthre_s=f[m].st_s);0!=a?b.scale=f[m].scale:0<Math.abs(b.scale- -1)||(b.scale=f[m].scale);0!=a?b.maskingadjust=f[m].masking_adj:0<Math.abs(b.maskingadjust-
0)||(b.maskingadjust=f[m].masking_adj);0<f[m].masking_adj?0!=a?b.maskingadjust_short=.9*f[m].masking_adj:0<Math.abs(b.maskingadjust_short-0)||(b.maskingadjust_short=.9*f[m].masking_adj):0!=a?b.maskingadjust_short=1.1*f[m].masking_adj:0<Math.abs(b.maskingadjust_short-0)||(b.maskingadjust_short=1.1*f[m].masking_adj);0!=a?b.ATHlower=-f[m].ath_lower/10:0<Math.abs(10*-b.ATHlower)||(b.ATHlower=-f[m].ath_lower/10);0!=a?b.ATHcurve=f[m].ath_curve:0<Math.abs(b.ATHcurve- -1)||(b.ATHcurve=f[m].ath_curve);0!=
a?b.interChRatio=f[m].interch:0<Math.abs(b.interChRatio- -1)||(b.interChRatio=f[m].interch);return c}var E;this.setModules=function(b){E=b};var B=[new c(0,9,9,0,5.2,125,-4.2,-6.3,4.8,1,0,0,2,21,.97),new c(1,9,9,0,5.3,125,-3.6,-5.6,4.5,1.5,0,0,2,21,1.35),new c(2,9,9,0,5.6,125,-2.2,-3.5,2.8,2,0,0,2,21,1.49),new c(3,9,9,1,5.8,130,-1.8,-2.8,2.6,3,-4,0,2,20,1.64),new c(4,9,9,1,6,135,-.7,-1.1,1.1,3.5,-8,0,2,0,1.79),new c(5,9,9,1,6.4,140,.5,.4,-7.5,4,-12,2E-4,0,0,1.95),new c(6,9,9,1,6.6,145,.67,.65,-14.7,
6.5,-19,4E-4,0,0,2.3),new c(7,9,9,1,6.6,145,.8,.75,-19.7,8,-22,6E-4,0,0,2.7),new c(8,9,9,1,6.6,145,1.2,1.15,-27.5,10,-23,7E-4,0,0,0),new c(9,9,9,1,6.6,145,1.6,1.6,-36,11,-25,8E-4,0,0,0),new c(10,9,9,1,6.6,145,2,2,-36,12,-25,8E-4,0,0,0)],w=[new c(0,9,9,0,4.2,25,-7,-4,7.5,1,0,0,2,26,.97),new c(1,9,9,0,4.2,25,-5.6,-3.6,4.5,1.5,0,0,2,21,1.35),new c(2,9,9,0,4.2,25,-4.4,-1.8,2,2,0,0,2,18,1.49),new c(3,9,9,1,4.2,25,-3.4,-1.25,1.1,3,-4,0,2,15,1.64),new c(4,9,9,1,4.2,25,-2.2,.1,0,3.5,-8,0,2,0,1.79),new c(5,
9,9,1,4.2,25,-1,1.65,-7.7,4,-12,2E-4,0,0,1.95),new c(6,9,9,1,4.2,25,-0,2.47,-7.7,6.5,-19,4E-4,0,0,2),new c(7,9,9,1,4.2,25,.5,2,-14.5,8,-22,6E-4,0,0,2),new c(8,9,9,1,4.2,25,1,2.4,-22,10,-23,7E-4,0,0,2),new c(9,9,9,1,4.2,25,1.5,2.95,-30,11,-25,8E-4,0,0,2),new c(10,9,9,1,4.2,25,2,2.95,-36,12,-30,8E-4,0,0,2)],f=[new k(8,9,9,0,0,6.6,145,0,.95,0,-30,11,.0012,1),new k(16,9,9,0,0,6.6,145,0,.95,0,-25,11,.001,1),new k(24,9,9,0,0,6.6,145,0,.95,0,-20,11,.001,1),new k(32,9,9,0,0,6.6,145,0,.95,0,-15,11,.001,1),
new k(40,9,9,0,0,6.6,145,0,.95,0,-10,11,9E-4,1),new k(48,9,9,0,0,6.6,145,0,.95,0,-10,11,9E-4,1),new k(56,9,9,0,0,6.6,145,0,.95,0,-6,11,8E-4,1),new k(64,9,9,0,0,6.6,145,0,.95,0,-2,11,8E-4,1),new k(80,9,9,0,0,6.6,145,0,.95,0,0,8,7E-4,1),new k(96,9,9,0,2.5,6.6,145,0,.95,0,1,5.5,6E-4,1),new k(112,9,9,0,2.25,6.6,145,0,.95,0,2,4.5,5E-4,1),new k(128,9,9,0,1.95,6.4,140,0,.95,0,3,4,2E-4,1),new k(160,9,9,1,1.79,6,135,0,.95,-2,5,3.5,0,1),new k(192,9,9,1,1.49,5.6,125,0,.97,-4,7,3,0,0),new k(224,9,9,1,1.25,5.2,
125,0,.98,-6,9,2,0,0),new k(256,9,9,1,.97,5.2,125,0,1,-8,10,1,0,0),new k(320,9,9,1,.9,5.2,125,0,1,-10,12,0,0,0)];this.apply_preset=function(b,c,a){switch(c){case W.R3MIX:c=W.V3;b.VBR=G.vbr_mtrh;break;case W.MEDIUM:c=W.V4;b.VBR=G.vbr_rh;break;case W.MEDIUM_FAST:c=W.V4;b.VBR=G.vbr_mtrh;break;case W.STANDARD:c=W.V2;b.VBR=G.vbr_rh;break;case W.STANDARD_FAST:c=W.V2;b.VBR=G.vbr_mtrh;break;case W.EXTREME:c=W.V0;b.VBR=G.vbr_rh;break;case W.EXTREME_FAST:c=W.V0;b.VBR=G.vbr_mtrh;break;case W.INSANE:return c=
320,b.preset=c,V(b,c,a),b.VBR=G.vbr_off,c}b.preset=c;switch(c){case W.V9:return n(b,9,a),c;case W.V8:return n(b,8,a),c;case W.V7:return n(b,7,a),c;case W.V6:return n(b,6,a),c;case W.V5:return n(b,5,a),c;case W.V4:return n(b,4,a),c;case W.V3:return n(b,3,a),c;case W.V2:return n(b,2,a),c;case W.V1:return n(b,1,a),c;case W.V0:return n(b,0,a),c}if(8<=c&&320>=c)return V(b,c,a);b.preset=0;return c}}function qb(){function u(a){this.bits=0|a}function k(a,d,p,b,e,c){d=.5946/d;for(a>>=1;0!=a--;)e[c++]=d>p[b++]?
0:1,e[c++]=d>p[b++]?0:1}function n(a,d,b,e,c,l){a>>=1;var h=a%2;for(a>>=1;0!=a--;){var p=b[e++]*d;var r=b[e++]*d;var t=0|p;var f=b[e++]*d;var g=0|r;var J=b[e++]*d;var D=0|f;p+=B.adj43[t];t=0|J;r+=B.adj43[g];c[l++]=0|p;f+=B.adj43[D];c[l++]=0|r;J+=B.adj43[t];c[l++]=0|f;c[l++]=0|J}0!=h&&(p=b[e++]*d,r=b[e++]*d,p+=B.adj43[0|p],r+=B.adj43[0|r],c[l++]=0|p,c[l++]=0|r)}function V(a,d,b,e){var p,c=d,h=p=0;do{var r=a[c++],l=a[c++];p<r&&(p=r);h<l&&(h=l)}while(c<b);p<h&&(p=h);switch(p){case 0:return p;case 1:c=
d;d=0;p=w.ht[1].hlen;do h=2*a[c+0]+a[c+1],c+=2,d+=p[h];while(c<b);e.bits+=d;return 1;case 2:case 3:c=d;d=f[p-1];p=0;h=w.ht[d].xlen;r=2==d?w.table23:w.table56;do l=a[c+0]*h+a[c+1],c+=2,p+=r[l];while(c<b);a=p&65535;p>>=16;p>a&&(p=a,d++);e.bits+=p;return d;case 4:case 5:case 6:case 7:case 8:case 9:case 10:case 11:case 12:case 13:case 14:case 15:c=d;d=f[p-1];r=h=p=0;l=w.ht[d].xlen;var g=w.ht[d].hlen,D=w.ht[d+1].hlen,q=w.ht[d+2].hlen;do{var m=a[c+0]*l+a[c+1];c+=2;p+=g[m];h+=D[m];r+=q[m]}while(c<b);a=d;
p>h&&(p=h,a++);p>r&&(p=r,a=d+2);e.bits+=p;return a;default:if(p>ia.IXMAX_VAL)return e.bits=ia.LARGE_BITS,-1;p-=15;for(c=24;32>c&&!(w.ht[c].linmax>=p);c++);for(h=c-8;24>h&&!(w.ht[h].linmax>=p);h++);p=h;r=65536*w.ht[p].xlen+w.ht[c].xlen;h=0;do l=a[d++],g=a[d++],0!=l&&(14<l&&(l=15,h+=r),l*=16),0!=g&&(14<g&&(g=15,h+=r),l+=g),h+=w.largetbl[l];while(d<b);a=h&65535;h>>=16;h>a&&(h=a,p=c);e.bits+=h;return p}}function E(a,d,p,b,e,l,h,g){for(var r=d.big_values,f=2;f<c.SBMAX_l+1;f++){var x=a.scalefac_band.l[f];
if(x>=r)break;var t=e[f-2]+d.count1bits;if(p.part2_3_length<=t)break;t=new u(t);x=V(b,x,r,t);t=t.bits;p.part2_3_length<=t||(p.assign(d),p.part2_3_length=t,p.region0_count=l[f-2],p.region1_count=f-2-l[f-2],p.table_select[0]=h[f-2],p.table_select[1]=g[f-2],p.table_select[2]=x)}}var B=null;this.qupvt=null;this.setModules=function(a){B=this.qupvt=a};var ha=[[0,0],[0,0],[0,0],[0,0],[0,0],[0,1],[1,1],[1,1],[1,2],[2,2],[2,3],[2,3],[3,4],[3,4],[3,4],[4,5],[4,5],[4,6],[5,6],[5,6],[5,7],[6,7],[6,7]],f=[1,2,
5,7,7,10,10,13,13,13,13,13,13,13,13];this.noquant_count_bits=function(a,d,p){var b=d.l3_enc,e=Math.min(576,d.max_nonzero_coeff+2>>1<<1);null!=p&&(p.sfb_count1=0);for(;1<e&&0==(b[e-1]|b[e-2]);e-=2);d.count1=e;for(var l=0,h=0;3<e&&!(1<((b[e-1]|b[e-2]|b[e-3]|b[e-4])&2147483647));e-=4){var f=2*(2*(2*b[e-4]+b[e-3])+b[e-2])+b[e-1];l+=w.t32l[f];h+=w.t33l[f]}f=l;d.count1table_select=0;l>h&&(f=h,d.count1table_select=1);d.count1bits=f;d.big_values=e;if(0==e)return f;d.block_type==c.SHORT_TYPE?(l=3*a.scalefac_band.s[3],
l>d.big_values&&(l=d.big_values),h=d.big_values):d.block_type==c.NORM_TYPE?(l=d.region0_count=a.bv_scf[e-2],h=d.region1_count=a.bv_scf[e-1],h=a.scalefac_band.l[l+h+2],l=a.scalefac_band.l[l+1],h<e&&(f=new u(f),d.table_select[2]=V(b,h,e,f),f=f.bits)):(d.region0_count=7,d.region1_count=c.SBMAX_l-1-7-1,l=a.scalefac_band.l[8],h=e,l>h&&(l=h));l=Math.min(l,e);h=Math.min(h,e);0<l&&(f=new u(f),d.table_select[0]=V(b,0,l,f),f=f.bits);l<h&&(f=new u(f),d.table_select[1]=V(b,l,h,f),f=f.bits);2==a.use_best_huffman&&
(d.part2_3_length=f,best_huffman_divide(a,d),f=d.part2_3_length);if(null!=p&&d.block_type==c.NORM_TYPE){for(b=0;a.scalefac_band.l[b]<d.big_values;)b++;p.sfb_count1=b}return f};this.count_bits=function(a,d,e,b){var p=e.l3_enc,l=ia.IXMAX_VAL/B.IPOW20(e.global_gain);if(e.xrpow_max>l)return ia.LARGE_BITS;l=B.IPOW20(e.global_gain);var h,f=0,g=0,r=0,D=0,m=0,q=p,v=0,C=d,I=0;var Q=null!=b&&e.global_gain==b.global_gain;var S=e.block_type==c.SHORT_TYPE?38:21;for(h=0;h<=S;h++){var u=-1;if(Q||e.block_type==c.NORM_TYPE)u=
e.global_gain-(e.scalefac[h]+(0!=e.preflag?B.pretab[h]:0)<<e.scalefac_scale+1)-8*e.subblock_gain[e.window[h]];if(Q&&b.step[h]==u)0!=g&&(n(g,l,C,I,q,v),g=0),0!=r&&(k(r,l,C,I,q,v),r=0);else{var Z=e.width[h];f+e.width[h]>e.max_nonzero_coeff&&(h=e.max_nonzero_coeff-f+1,na.fill(p,e.max_nonzero_coeff,576,0),Z=h,0>Z&&(Z=0),h=S+1);0==g&&0==r&&(q=p,v=m,C=d,I=D);null!=b&&0<b.sfb_count1&&h>=b.sfb_count1&&0<b.step[h]&&u>=b.step[h]?(0!=g&&(n(g,l,C,I,q,v),g=0,q=p,v=m,C=d,I=D),r+=Z):(0!=r&&(k(r,l,C,I,q,v),r=0,q=
p,v=m,C=d,I=D),g+=Z);if(0>=Z){0!=r&&(k(r,l,C,I,q,v),r=0);0!=g&&(n(g,l,C,I,q,v),g=0);break}}h<=S&&(m+=e.width[h],D+=e.width[h],f+=e.width[h])}0!=g&&n(g,l,C,I,q,v);0!=r&&k(r,l,C,I,q,v);if(0!=(a.substep_shaping&2))for(l=0,S=.634521682242439/B.IPOW20(e.global_gain+e.scalefac_scale),f=0;f<e.sfbmax;f++)if(Q=e.width[f],0==a.pseudohalf[f])l+=Q;else for(g=l,l+=Q;g<l;++g)p[g]=d[g]>=S?p[g]:0;return this.noquant_count_bits(a,e,b)};this.best_huffman_divide=function(a,d){var e=new rb,b=d.l3_enc,l=X(23),f=X(23),
h=X(23),g=X(23);if(d.block_type!=c.SHORT_TYPE||1!=a.mode_gr){e.assign(d);if(d.block_type==c.NORM_TYPE){for(var y=d.big_values,m=0;22>=m;m++)l[m]=ia.LARGE_BITS;for(m=0;16>m;m++){var D=a.scalefac_band.l[m+1];if(D>=y)break;var q=0,k=new u(q),v=V(b,0,D,k);q=k.bits;for(var C=0;8>C;C++){var I=a.scalefac_band.l[m+C+2];if(I>=y)break;k=q;k=new u(k);I=V(b,D,I,k);k=k.bits;l[m+C]>k&&(l[m+C]=k,f[m+C]=m,h[m+C]=v,g[m+C]=I)}}E(a,e,d,b,l,f,h,g)}y=e.big_values;if(!(0==y||1<(b[y-2]|b[y-1])||(y=d.count1+2,576<y))){e.assign(d);
e.count1=y;for(D=m=0;y>e.big_values;y-=4)q=2*(2*(2*b[y-4]+b[y-3])+b[y-2])+b[y-1],m+=w.t32l[q],D+=w.t33l[q];e.big_values=y;e.count1table_select=0;m>D&&(m=D,e.count1table_select=1);e.count1bits=m;e.block_type==c.NORM_TYPE?E(a,e,d,b,l,f,h,g):(e.part2_3_length=m,m=a.scalefac_band.l[8],m>y&&(m=y),0<m&&(a=new u(e.part2_3_length),e.table_select[0]=V(b,0,m,a),e.part2_3_length=a.bits),y>m&&(a=new u(e.part2_3_length),e.table_select[1]=V(b,m,y,a),e.part2_3_length=a.bits),d.part2_3_length>e.part2_3_length&&d.assign(e))}}};
var b=[1,1,1,1,8,2,2,2,4,4,4,8,8,8,16,16],v=[1,2,4,8,1,2,4,8,2,4,8,2,4,8,4,8],a=[0,0,0,0,3,1,1,1,2,2,2,3,3,3,4,4],m=[0,1,2,3,0,1,2,3,1,2,3,1,2,3,2,3];qb.slen1_tab=a;qb.slen2_tab=m;this.best_scalefac_store=function(d,e,p,l){var f=l.tt[e][p],g,h,r=0;for(g=h=0;g<f.sfbmax;g++){var y=f.width[g];h+=y;for(y=-y;0>y&&0==f.l3_enc[y+h];y++);0==y&&(f.scalefac[g]=r=-2)}if(0==f.scalefac_scale&&0==f.preflag){for(g=h=0;g<f.sfbmax;g++)0<f.scalefac[g]&&(h|=f.scalefac[g]);if(0==(h&1)&&0!=h){for(g=0;g<f.sfbmax;g++)0<
f.scalefac[g]&&(f.scalefac[g]>>=1);f.scalefac_scale=r=1}}if(0==f.preflag&&f.block_type!=c.SHORT_TYPE&&2==d.mode_gr){for(g=11;g<c.SBPSY_l&&!(f.scalefac[g]<B.pretab[g]&&-2!=f.scalefac[g]);g++);if(g==c.SBPSY_l){for(g=11;g<c.SBPSY_l;g++)0<f.scalefac[g]&&(f.scalefac[g]-=B.pretab[g]);f.preflag=r=1}}for(g=0;4>g;g++)l.scfsi[p][g]=0;if(2==d.mode_gr&&1==e&&l.tt[0][p].block_type!=c.SHORT_TYPE&&l.tt[1][p].block_type!=c.SHORT_TYPE){e=l.tt[1][p];h=l.tt[0][p];for(r=0;r<w.scfsi_band.length-1;r++){for(g=w.scfsi_band[r];g<
w.scfsi_band[r+1]&&!(h.scalefac[g]!=e.scalefac[g]&&0<=e.scalefac[g]);g++);if(g==w.scfsi_band[r+1]){for(g=w.scfsi_band[r];g<w.scfsi_band[r+1];g++)e.scalefac[g]=-1;l.scfsi[p][r]=1}}for(g=l=p=0;11>g;g++)-1!=e.scalefac[g]&&(l++,p<e.scalefac[g]&&(p=e.scalefac[g]));for(y=h=0;g<c.SBPSY_l;g++)-1!=e.scalefac[g]&&(y++,h<e.scalefac[g]&&(h=e.scalefac[g]));for(r=0;16>r;r++)p<b[r]&&h<v[r]&&(g=a[r]*l+m[r]*y,e.part2_length>g&&(e.part2_length=g,e.scalefac_compress=r));r=0}for(g=0;g<f.sfbmax;g++)-2==f.scalefac[g]&&
(f.scalefac[g]=0);0!=r&&(2==d.mode_gr?this.scale_bitcount(f):this.scale_bitcount_lsf(d,f))};var z=[0,18,36,54,54,36,54,72,54,72,90,72,90,108,108,126],e=[0,18,36,54,51,35,53,71,52,70,88,69,87,105,104,122],l=[0,10,20,30,33,21,31,41,32,42,52,43,53,63,64,74];this.scale_bitcount=function(a){var d,g=0,f=0,t=a.scalefac;if(a.block_type==c.SHORT_TYPE){var m=z;0!=a.mixed_block_flag&&(m=e)}else if(m=l,0==a.preflag){for(d=11;d<c.SBPSY_l&&!(t[d]<B.pretab[d]);d++);if(d==c.SBPSY_l)for(a.preflag=1,d=11;d<c.SBPSY_l;d++)t[d]-=
B.pretab[d]}for(d=0;d<a.sfbdivide;d++)g<t[d]&&(g=t[d]);for(;d<a.sfbmax;d++)f<t[d]&&(f=t[d]);a.part2_length=ia.LARGE_BITS;for(d=0;16>d;d++)g<b[d]&&f<v[d]&&a.part2_length>m[d]&&(a.part2_length=m[d],a.scalefac_compress=d);return a.part2_length==ia.LARGE_BITS};var d=[[15,15,7,7],[15,15,7,0],[7,3,0,0],[15,31,31,0],[7,7,7,0],[3,3,0,0]];this.scale_bitcount_lsf=function(a,e){var b,f,l,m,h=X(4),x=e.scalefac;a=0!=e.preflag?2:0;for(l=0;4>l;l++)h[l]=0;if(e.block_type==c.SHORT_TYPE){var y=1;var k=B.nr_of_sfb_block[a][y];
for(b=m=0;4>b;b++){var q=k[b]/3;for(l=0;l<q;l++,m++)for(f=0;3>f;f++)x[3*m+f]>h[b]&&(h[b]=x[3*m+f])}}else for(y=0,k=B.nr_of_sfb_block[a][y],b=m=0;4>b;b++)for(q=k[b],l=0;l<q;l++,m++)x[m]>h[b]&&(h[b]=x[m]);q=!1;for(b=0;4>b;b++)h[b]>d[a][b]&&(q=!0);if(!q){e.sfb_partition_table=B.nr_of_sfb_block[a][y];for(b=0;4>b;b++)e.slen[b]=g[h[b]];y=e.slen[0];b=e.slen[1];h=e.slen[2];f=e.slen[3];switch(a){case 0:e.scalefac_compress=(5*y+b<<4)+(h<<2)+f;break;case 1:e.scalefac_compress=400+(5*y+b<<2)+h;break;case 2:e.scalefac_compress=
500+3*y+b;break;default:T.err.printf("intensity stereo not implemented yet\n")}}if(!q)for(b=e.part2_length=0;4>b;b++)e.part2_length+=e.slen[b]*e.sfb_partition_table[b];return q};var g=[0,1,2,2,3,3,3,3,4,4,4,4,4,4,4,4];this.huffman_init=function(a){for(var d=2;576>=d;d+=2){for(var e=0,b;a.scalefac_band.l[++e]<d;);for(b=ha[e][0];a.scalefac_band.l[b+1]>d;)b--;0>b&&(b=ha[e][0]);a.bv_scf[d-2]=b;for(b=ha[e][1];a.scalefac_band.l[b+a.bv_scf[d-2]+2]>d;)b--;0>b&&(b=ha[e][1]);a.bv_scf[d-1]=b}}}function xc(){var c;
this.setModules=function(k){c=k};this.ResvFrameBegin=function(k,n){var u=k.internal_flags,E=u.l3_side,B=c.getframebits(k);n.bits=(B-8*u.sideinfo_len)/u.mode_gr;var w=2048*u.mode_gr-8;if(320<k.brate)var f=8*int(1E3*k.brate/(k.out_samplerate/1152)/8+.5);else f=11520,k.strict_ISO&&(f=8*int(32E4/(k.out_samplerate/1152)/8+.5));u.ResvMax=f-B;u.ResvMax>w&&(u.ResvMax=w);if(0>u.ResvMax||k.disable_reservoir)u.ResvMax=0;k=n.bits*u.mode_gr+Math.min(u.ResvSize,u.ResvMax);k>f&&(k=f);E.resvDrain_pre=0;null!=u.pinfo&&
(u.pinfo.mean_bits=n.bits/2,u.pinfo.resvsize=u.ResvSize);return k};this.ResvMaxBits=function(c,n,u,E){var k=c.internal_flags,w=k.ResvSize,f=k.ResvMax;0!=E&&(w+=n);0!=(k.substep_shaping&1)&&(f*=.9);u.bits=n;10*w>9*f?(E=w-9*f/10,u.bits+=E,k.substep_shaping|=128):(E=0,k.substep_shaping&=127,c.disable_reservoir||0!=(k.substep_shaping&1)||(u.bits-=.1*n));c=w<6*k.ResvMax/10?w:6*k.ResvMax/10;c-=E;0>c&&(c=0);return c};this.ResvAdjust=function(c,n){c.ResvSize-=n.part2_3_length+n.part2_length};this.ResvFrameEnd=
function(c,n){var k,u=c.l3_side;c.ResvSize+=n*c.mode_gr;n=0;u.resvDrain_post=0;u.resvDrain_pre=0;0!=(k=c.ResvSize%8)&&(n+=k);k=c.ResvSize-n-c.ResvMax;0<k&&(n+=k);k=Math.min(8*u.main_data_begin,n)/8;u.resvDrain_pre+=8*k;n-=8*k;c.ResvSize-=8*k;u.main_data_begin-=k;u.resvDrain_post+=n;c.ResvSize-=n}}function qa(){function u(a,e,b){for(;0<b;){if(0==D){D=8;q++;if(a.header[a.w_ptr].write_timing==g){var c=a;T.arraycopy(c.header[c.w_ptr].buf,0,d,q,c.sideinfo_len);q+=c.sideinfo_len;g+=8*c.sideinfo_len;c.w_ptr=
c.w_ptr+1&da.MAX_HEADER_BUF-1}d[q]=0}c=Math.min(b,D);b-=c;D-=c;d[q]|=e>>b<<D;g+=c}}function k(a,d){var b=a.internal_flags,c;8<=d&&(u(b,76,8),d-=8);8<=d&&(u(b,65,8),d-=8);8<=d&&(u(b,77,8),d-=8);8<=d&&(u(b,69,8),d-=8);if(32<=d){var h=e.getLameShortVersion();if(32<=d)for(c=0;c<h.length&&8<=d;++c)d-=8,u(b,h.charAt(c),8)}for(;1<=d;--d)u(b,b.ancillary_flag,1),b.ancillary_flag^=a.disable_reservoir?0:1}function n(a,d,e){for(var b=a.header[a.h_ptr].ptr;0<e;){var h=Math.min(e,8-(b&7));e-=h;a.header[a.h_ptr].buf[b>>
3]|=d>>e<<8-(b&7)-h;b+=h}a.header[a.h_ptr].ptr=b}function V(a,d){a<<=8;for(var e=0;8>e;e++)a<<=1,d<<=1,0!=((d^a)&65536)&&(d^=32773);return d}function E(a,d){var e=w.ht[d.count1table_select+32],b,h=0,c=d.big_values,g=d.big_values;for(b=(d.count1-d.big_values)/4;0<b;--b){var l=0,f=0;var p=d.l3_enc[c+0];0!=p&&(f+=8,0>d.xr[g+0]&&l++);p=d.l3_enc[c+1];0!=p&&(f+=4,l*=2,0>d.xr[g+1]&&l++);p=d.l3_enc[c+2];0!=p&&(f+=2,l*=2,0>d.xr[g+2]&&l++);p=d.l3_enc[c+3];0!=p&&(f++,l*=2,0>d.xr[g+3]&&l++);c+=4;g+=4;u(a,l+e.table[f],
e.hlen[f]);h+=e.hlen[f]}return h}function B(a,d,e,b,h){var c=w.ht[d],g=0;if(0==d)return g;for(;e<b;e+=2){var l=0,f=0,p=c.xlen,r=c.xlen,m=0,C=h.l3_enc[e],k=h.l3_enc[e+1];0!=C&&(0>h.xr[e]&&m++,l--);15<d&&(14<C&&(m|=C-15<<1,f=p,C=15),14<k&&(r=k-15,m<<=p,m|=r,f+=p,k=15),r=16);0!=k&&(m<<=1,0>h.xr[e+1]&&m++,l--);C=C*r+k;f-=l;l+=c.hlen[C];u(a,c.table[C],l);u(a,m,f);g+=l+f}return g}function K(a,d){var e=3*a.scalefac_band.s[3];e>d.big_values&&(e=d.big_values);var b=B(a,d.table_select[0],0,e,d);return b+=B(a,
d.table_select[1],e,d.big_values,d)}function f(a,d){var e=d.big_values;var b=d.region0_count+1;var h=a.scalefac_band.l[b];b+=d.region1_count+1;var c=a.scalefac_band.l[b];h>e&&(h=e);c>e&&(c=e);b=B(a,d.table_select[0],0,h,d);b+=B(a,d.table_select[1],h,c,d);return b+=B(a,d.table_select[2],c,e,d)}function b(){this.total=0}function v(d,e){var b=d.internal_flags;var c=b.w_ptr;var h=b.h_ptr-1;-1==h&&(h=da.MAX_HEADER_BUF-1);var l=b.header[h].write_timing-g;e.total=l;if(0<=l){var f=1+h-c;h<c&&(f=1+h-c+da.MAX_HEADER_BUF);
l-=8*f*b.sideinfo_len}d=a.getframebits(d);l+=d;e.total+=d;e.total=0!=e.total%8?1+e.total/8:e.total/8;e.total+=q+1;0>l&&T.err.println("strange error flushing buffer ... \n");return l}var a=this,m=null,z=null,e=null,l=null;this.setModules=function(a,d,b,c){m=a;z=d;e=b;l=c};var d=null,g=0,q=0,D=0;this.getframebits=function(a){var d=a.internal_flags;return 8*(0|72E3*(a.version+1)*(0!=d.bitrate_index?w.bitrate_table[a.version][d.bitrate_index]:a.brate)/a.out_samplerate+d.padding)};this.CRC_writeheader=
function(a,d){var e=V(d[2]&255,65535);e=V(d[3]&255,e);for(var b=6;b<a.sideinfo_len;b++)e=V(d[b]&255,e);d[4]=byte(e>>8);d[5]=byte(e&255)};this.flush_bitstream=function(a){var d=a.internal_flags,e;var c=d.l3_side;0>(e=v(a,new b))||(k(a,e),d.ResvSize=0,c.main_data_begin=0,d.findReplayGain&&(c=m.GetTitleGain(d.rgdata),d.RadioGain=Math.floor(10*c+.5)|0),d.findPeakSample&&(d.noclipGainChange=Math.ceil(200*Math.log10(d.PeakSample/32767))|0,0<d.noclipGainChange?EQ(a.scale,1)||EQ(a.scale,0)?d.noclipScale=
Math.floor(32767/d.PeakSample*100)/100:d.noclipScale=-1:d.noclipScale=-1))};this.add_dummy_byte=function(a,e,b){a=a.internal_flags;for(var c;0<b--;){c=e;for(var h=8;0<h;){0==D&&(D=8,q++,d[q]=0);var l=Math.min(h,D);h-=l;D-=l;d[q]|=c>>h<<D;g+=l}for(c=0;c<da.MAX_HEADER_BUF;++c)a.header[c].write_timing+=8}};this.format_bitstream=function(a){var d=a.internal_flags;var e=d.l3_side;var l=this.getframebits(a);k(a,e.resvDrain_pre);var h=a.internal_flags,p,y;var m=h.l3_side;h.header[h.h_ptr].ptr=0;na.fill(h.header[h.h_ptr].buf,
0,h.sideinfo_len,0);16E3>a.out_samplerate?n(h,4094,12):n(h,4095,12);n(h,a.version,1);n(h,1,2);n(h,a.error_protection?0:1,1);n(h,h.bitrate_index,4);n(h,h.samplerate_index,2);n(h,h.padding,1);n(h,a.extension,1);n(h,a.mode.ordinal(),2);n(h,h.mode_ext,2);n(h,a.copyright,1);n(h,a.original,1);n(h,a.emphasis,2);a.error_protection&&n(h,0,16);if(1==a.version){n(h,m.main_data_begin,9);2==h.channels_out?n(h,m.private_bits,3):n(h,m.private_bits,5);for(y=0;y<h.channels_out;y++)for(p=0;4>p;p++)n(h,m.scfsi[y][p],
1);for(p=0;2>p;p++)for(y=0;y<h.channels_out;y++){var q=m.tt[p][y];n(h,q.part2_3_length+q.part2_length,12);n(h,q.big_values/2,9);n(h,q.global_gain,8);n(h,q.scalefac_compress,4);q.block_type!=c.NORM_TYPE?(n(h,1,1),n(h,q.block_type,2),n(h,q.mixed_block_flag,1),14==q.table_select[0]&&(q.table_select[0]=16),n(h,q.table_select[0],5),14==q.table_select[1]&&(q.table_select[1]=16),n(h,q.table_select[1],5),n(h,q.subblock_gain[0],3),n(h,q.subblock_gain[1],3),n(h,q.subblock_gain[2],3)):(n(h,0,1),14==q.table_select[0]&&
(q.table_select[0]=16),n(h,q.table_select[0],5),14==q.table_select[1]&&(q.table_select[1]=16),n(h,q.table_select[1],5),14==q.table_select[2]&&(q.table_select[2]=16),n(h,q.table_select[2],5),n(h,q.region0_count,4),n(h,q.region1_count,3));n(h,q.preflag,1);n(h,q.scalefac_scale,1);n(h,q.count1table_select,1)}}else for(n(h,m.main_data_begin,8),n(h,m.private_bits,h.channels_out),y=p=0;y<h.channels_out;y++)q=m.tt[p][y],n(h,q.part2_3_length+q.part2_length,12),n(h,q.big_values/2,9),n(h,q.global_gain,8),n(h,
q.scalefac_compress,9),q.block_type!=c.NORM_TYPE?(n(h,1,1),n(h,q.block_type,2),n(h,q.mixed_block_flag,1),14==q.table_select[0]&&(q.table_select[0]=16),n(h,q.table_select[0],5),14==q.table_select[1]&&(q.table_select[1]=16),n(h,q.table_select[1],5),n(h,q.subblock_gain[0],3),n(h,q.subblock_gain[1],3),n(h,q.subblock_gain[2],3)):(n(h,0,1),14==q.table_select[0]&&(q.table_select[0]=16),n(h,q.table_select[0],5),14==q.table_select[1]&&(q.table_select[1]=16),n(h,q.table_select[1],5),14==q.table_select[2]&&
(q.table_select[2]=16),n(h,q.table_select[2],5),n(h,q.region0_count,4),n(h,q.region1_count,3)),n(h,q.scalefac_scale,1),n(h,q.count1table_select,1);a.error_protection&&CRC_writeheader(h,h.header[h.h_ptr].buf);m=h.h_ptr;h.h_ptr=m+1&da.MAX_HEADER_BUF-1;h.header[h.h_ptr].write_timing=h.header[m].write_timing+l;h.h_ptr==h.w_ptr&&T.err.println("Error: MAX_HEADER_BUF too small in bitstream.c \n");h=8*d.sideinfo_len;var D=0,B=a.internal_flags,z=B.l3_side;if(1==a.version)for(m=0;2>m;m++)for(y=0;y<B.channels_out;y++){var C=
z.tt[m][y],I=qb.slen1_tab[C.scalefac_compress],Q=qb.slen2_tab[C.scalefac_compress];for(p=q=0;p<C.sfbdivide;p++)-1!=C.scalefac[p]&&(u(B,C.scalefac[p],I),q+=I);for(;p<C.sfbmax;p++)-1!=C.scalefac[p]&&(u(B,C.scalefac[p],Q),q+=Q);q=C.block_type==c.SHORT_TYPE?q+K(B,C):q+f(B,C);q+=E(B,C);D+=q}else for(y=m=0;y<B.channels_out;y++){C=z.tt[m][y];var S=0;Q=p=q=0;if(C.block_type==c.SHORT_TYPE){for(;4>Q;Q++){var w=C.sfb_partition_table[Q]/3,Z=C.slen[Q];for(I=0;I<w;I++,p++)u(B,Math.max(C.scalefac[3*p],0),Z),u(B,
Math.max(C.scalefac[3*p+1],0),Z),u(B,Math.max(C.scalefac[3*p+2],0),Z),S+=3*Z}q+=K(B,C)}else{for(;4>Q;Q++)for(w=C.sfb_partition_table[Q],Z=C.slen[Q],I=0;I<w;I++,p++)u(B,Math.max(C.scalefac[p],0),Z),S+=Z;q+=f(B,C)}q+=E(B,C);D+=S+q}h+=D;k(a,e.resvDrain_post);h+=e.resvDrain_post;e.main_data_begin+=(l-h)/8;v(a,new b)!=d.ResvSize&&T.err.println("Internal buffer inconsistency. flushbits <> ResvSize");8*e.main_data_begin!=d.ResvSize&&(T.err.printf("bit reservoir error: \nl3_side.main_data_begin: %d \nResvoir size:             %d \nresv drain (post)         %d \nresv drain (pre)          %d \nheader and sideinfo:      %d \ndata bits:                %d \ntotal bits:               %d (remainder: %d) \nbitsperframe:             %d \n",
8*e.main_data_begin,d.ResvSize,e.resvDrain_post,e.resvDrain_pre,8*d.sideinfo_len,h-e.resvDrain_post-8*d.sideinfo_len,h,h%8,l),T.err.println("This is a fatal error.  It has several possible causes:"),T.err.println("90%%  LAME compiled with buggy version of gcc using advanced optimizations"),T.err.println(" 9%%  Your system is overclocked"),T.err.println(" 1%%  bug in LAME encoding library"),d.ResvSize=8*e.main_data_begin);if(1E9<g){for(a=0;a<da.MAX_HEADER_BUF;++a)d.header[a].write_timing-=g;g=0}return 0};
this.copy_buffer=function(a,e,b,c,h){var g=q+1;if(0>=g)return 0;if(0!=c&&g>c)return-1;T.arraycopy(d,0,e,b,g);q=-1;D=0;if(0!=h&&(c=X(1),c[0]=a.nMusicCRC,l.updateMusicCRC(c,e,b,g),a.nMusicCRC=c[0],0<g&&(a.VBR_seek_table.nBytesWritten+=g),a.decode_on_the_fly)){c=ca([2,1152]);h=g;for(var f=-1,p;0!=f;)if(f=z.hip_decode1_unclipped(a.hip,e,b,h,c[0],c[1]),h=0,-1==f&&(f=0),0<f){if(a.findPeakSample){for(p=0;p<f;p++)c[0][p]>a.PeakSample?a.PeakSample=c[0][p]:-c[0][p]>a.PeakSample&&(a.PeakSample=-c[0][p]);if(1<
a.channels_out)for(p=0;p<f;p++)c[1][p]>a.PeakSample?a.PeakSample=c[1][p]:-c[1][p]>a.PeakSample&&(a.PeakSample=-c[1][p])}if(a.findReplayGain&&m.AnalyzeSamples(a.rgdata,c[0],0,c[1],0,f,a.channels_out)==Y.GAIN_ANALYSIS_ERROR)return-6}}return g};this.init_bit_stream_w=function(a){d=new Int8Array(W.LAME_MAXMP3BUFFER);a.h_ptr=a.w_ptr=0;a.header[a.h_ptr].write_timing=0;q=-1;g=D=0}}function zb(){function c(a,b){var d=a[b+0]&255;d=d<<8|a[b+1]&255;d=d<<8|a[b+2]&255;return d=d<<8|a[b+3]&255}function k(a,b,d){a[b+
0]=d>>24&255;a[b+1]=d>>16&255;a[b+2]=d>>8&255;a[b+3]=d&255}function n(a,b,d){a[b+0]=d>>8&255;a[b+1]=d&255}function V(a,b,d){return 255&(a<<b|d&~(-1<<b))}function E(a,b){var d=a.internal_flags;b[0]=V(b[0],8,255);b[1]=V(b[1],3,7);b[1]=V(b[1],1,16E3>a.out_samplerate?0:1);b[1]=V(b[1],1,a.version);b[1]=V(b[1],2,1);b[1]=V(b[1],1,a.error_protection?0:1);b[2]=V(b[2],4,d.bitrate_index);b[2]=V(b[2],2,d.samplerate_index);b[2]=V(b[2],1,0);b[2]=V(b[2],1,a.extension);b[3]=V(b[3],2,a.mode.ordinal());b[3]=V(b[3],
2,d.mode_ext);b[3]=V(b[3],1,a.copyright);b[3]=V(b[3],1,a.original);b[3]=V(b[3],2,a.emphasis);b[0]=255;d=b[1]&241;var e=1==a.version?128:16E3>a.out_samplerate?32:64;a.VBR==G.vbr_off&&(e=a.brate);e=a.free_format?0:255&16*K.BitrateIndex(e,a.version,a.out_samplerate);b[1]=1==a.version?255&(d|10):255&(d|2);d=b[2]&13;b[2]=255&(e|d)}function B(a,b){return b=b>>8^z[(b^a)&255]}var K,f,b;this.setModules=function(a,c,d){K=a;f=c;b=d};var v=zb.NUMTOCENTRIES,a=zb.MAXFRAMESIZE,m=v+4+4+4+4+4+9+1+1+8+1+1+3+1+1+2+
4+2+2,z=[0,49345,49537,320,49921,960,640,49729,50689,1728,1920,51009,1280,50625,50305,1088,52225,3264,3456,52545,3840,53185,52865,3648,2560,51905,52097,2880,51457,2496,2176,51265,55297,6336,6528,55617,6912,56257,55937,6720,7680,57025,57217,8E3,56577,7616,7296,56385,5120,54465,54657,5440,55041,6080,5760,54849,53761,4800,4992,54081,4352,53697,53377,4160,61441,12480,12672,61761,13056,62401,62081,12864,13824,63169,63361,14144,62721,13760,13440,62529,15360,64705,64897,15680,65281,16320,16E3,65089,64001,
15040,15232,64321,14592,63937,63617,14400,10240,59585,59777,10560,60161,11200,10880,59969,60929,11968,12160,61249,11520,60865,60545,11328,58369,9408,9600,58689,9984,59329,59009,9792,8704,58049,58241,9024,57601,8640,8320,57409,40961,24768,24960,41281,25344,41921,41601,25152,26112,42689,42881,26432,42241,26048,25728,42049,27648,44225,44417,27968,44801,28608,28288,44609,43521,27328,27520,43841,26880,43457,43137,26688,30720,47297,47489,31040,47873,31680,31360,47681,48641,32448,32640,48961,32E3,48577,
48257,31808,46081,29888,30080,46401,30464,47041,46721,30272,29184,45761,45953,29504,45313,29120,28800,45121,20480,37057,37249,20800,37633,21440,21120,37441,38401,22208,22400,38721,21760,38337,38017,21568,39937,23744,23936,40257,24320,40897,40577,24128,23040,39617,39809,23360,39169,22976,22656,38977,34817,18624,18816,35137,19200,35777,35457,19008,19968,36545,36737,20288,36097,19904,19584,35905,17408,33985,34177,17728,34561,18368,18048,34369,33281,17088,17280,33601,16640,33217,32897,16448];this.addVbrFrame=
function(a){var b=a.internal_flags;var d=b.VBR_seek_table;a=w.bitrate_table[a.version][b.bitrate_index];d.nVbrNumFrames++;d.sum+=a;d.seen++;if(!(d.seen<d.want)&&(d.pos<d.size&&(d.bag[d.pos]=d.sum,d.pos++,d.seen=0),d.pos==d.size)){for(a=1;a<d.size;a+=2)d.bag[a/2]=d.bag[a];d.want*=2;d.pos/=2}};this.getVbrTag=function(a){var b=new VBRTagData,d=0;b.flags=0;var e=a[d+1]>>3&1,f=a[d+2]>>2&3,m=a[d+3]>>6&3,p=a[d+2]>>4&15;p=w.bitrate_table[e][p];b.samprate=14==a[d+1]>>4?w.samplerate_table[2][f]:w.samplerate_table[e][f];
f=d=0!=e?3!=m?d+36:d+21:3!=m?d+21:d+13;if(!(new String(a,f,4(),null)).equals("Xing")&&!(new String(a,f,4(),null)).equals("Info"))return null;d+=4;b.hId=e;f=b.flags=c(a,d);d+=4;0!=(f&1)&&(b.frames=c(a,d),d+=4);0!=(f&2)&&(b.bytes=c(a,d),d+=4);if(0!=(f&4)){if(null!=b.toc)for(m=0;m<v;m++)b.toc[m]=a[d+m];d+=v}b.vbrScale=-1;0!=(f&8)&&(b.vbrScale=c(a,d),d+=4);b.headersize=72E3*(e+1)*p/b.samprate;d+=21;e=a[d+0]<<4;e+=a[d+1]>>4;p=(a[d+1]&15)<<8;p+=a[d+2]&255;if(0>e||3E3<e)e=-1;if(0>p||3E3<p)p=-1;b.encDelay=
e;b.encPadding=p;return b};this.InitVbrTag=function(b){var e=b.internal_flags;var d=1==b.version?128:16E3>b.out_samplerate?32:64;b.VBR==G.vbr_off&&(d=b.brate);d=72E3*(b.version+1)*d/b.out_samplerate;var c=e.sideinfo_len+m;e.VBR_seek_table.TotalFrameSize=d;if(d<c||d>a)b.bWriteVbrTag=!1;else for(e.VBR_seek_table.nVbrNumFrames=0,e.VBR_seek_table.nBytesWritten=0,e.VBR_seek_table.sum=0,e.VBR_seek_table.seen=0,e.VBR_seek_table.want=1,e.VBR_seek_table.pos=0,null==e.VBR_seek_table.bag&&(e.VBR_seek_table.bag=
new int[400],e.VBR_seek_table.size=400),d=new Int8Array(a),E(b,d),e=e.VBR_seek_table.TotalFrameSize,c=0;c<e;++c)f.add_dummy_byte(b,d[c]&255,1)};this.updateMusicCRC=function(a,b,d,c){for(var e=0;e<c;++e)a[0]=B(b[d+e],a[0])};this.getLameTagFrame=function(a,c){var d=a.internal_flags;if(!a.bWriteVbrTag||d.Class_ID!=W.LAME_ID||0>=d.VBR_seek_table.pos)return 0;if(c.length<d.VBR_seek_table.TotalFrameSize)return d.VBR_seek_table.TotalFrameSize;na.fill(c,0,d.VBR_seek_table.TotalFrameSize,0);E(a,c);var e=new Int8Array(v);
if(a.free_format)for(var l=1;l<v;++l)e[l]=255&255*l/100;else{var m=d.VBR_seek_table;if(!(0>=m.pos))for(l=1;l<v;++l){var p=0|Math.floor(l/v*m.pos);p>m.pos-1&&(p=m.pos-1);p=0|256*m.bag[p]/m.sum;255<p&&(p=255);e[l]=255&p}}p=d.sideinfo_len;a.error_protection&&(p-=2);c[p++]=0;c[p++]=0;c[p++]=0;c[p++]=0;k(c,p,15);p+=4;k(c,p,d.VBR_seek_table.nVbrNumFrames);p+=4;m=d.VBR_seek_table.nBytesWritten+d.VBR_seek_table.TotalFrameSize;k(c,p,0|m);p+=4;T.arraycopy(e,0,c,p,e.length);p+=e.length;a.error_protection&&f.CRC_writeheader(d,
c);var r=0;for(l=0;l<p;l++)r=B(c[l],r);e=p;l=r;var t=a.internal_flags;p=0;r=a.encoder_delay;var u=a.encoder_padding,h=100-10*a.VBR_q-a.quality,x=b.getLameVeryShortVersion();var y=[1,5,3,2,4,0,3];var A=0|(255<a.lowpassfreq/100+.5?255:a.lowpassfreq/100+.5),z=0,w=0,O=a.internal_flags.noise_shaping,F=0,C,I=0!=(a.exp_nspsytune&1);var Q=0!=(a.exp_nspsytune&2);var S=C=!1,ma=a.internal_flags.nogap_total,Z=a.internal_flags.nogap_current,L=a.ATHtype;switch(a.VBR){case vbr_abr:var V=a.VBR_mean_bitrate_kbps;
break;case vbr_off:V=a.brate;break;default:V=a.VBR_min_bitrate_kbps}y=0+(a.VBR.ordinal()<y.length?y[a.VBR.ordinal()]:0);t.findReplayGain&&(510<t.RadioGain&&(t.RadioGain=510),-510>t.RadioGain&&(t.RadioGain=-510),w=11264,w=0<=t.RadioGain?w|t.RadioGain:w|512|-t.RadioGain);t.findPeakSample&&(z=Math.abs(0|t.PeakSample/32767*Math.pow(2,23)+.5));-1!=ma&&(0<Z&&(S=!0),Z<ma-1&&(C=!0));I=L+((I?1:0)<<4)+((Q?1:0)<<5)+((C?1:0)<<6)+((S?1:0)<<7);0>h&&(h=0);switch(a.mode){case MONO:Q=0;break;case STEREO:Q=1;break;
case DUAL_CHANNEL:Q=2;break;case JOINT_STEREO:Q=a.force_ms?4:3;break;default:Q=7}C=32E3>=a.in_samplerate?0:48E3==a.in_samplerate?2:48E3<a.in_samplerate?3:1;if(a.short_blocks==ra.short_block_forced||a.short_blocks==ra.short_block_dispensed||-1==a.lowpassfreq&&-1==a.highpassfreq||a.scale_left<a.scale_right||a.scale_left>a.scale_right||a.disable_reservoir&&320>a.brate||a.noATH||a.ATHonly||0==L||32E3>=a.in_samplerate)F=1;O=O+(Q<<2)+(F<<5)+(C<<6);t=t.nMusicCRC;k(c,e+p,h);p+=4;for(h=0;9>h;h++)c[e+p+h]=
255&x.charAt(h);p+=9;c[e+p]=255&y;p++;c[e+p]=255&A;p++;k(c,e+p,z);p+=4;n(c,e+p,w);p+=2;n(c,e+p,0);p+=2;c[e+p]=255&I;p++;c[e+p]=255<=V?255:255&V;p++;c[e+p]=255&r>>4;c[e+p+1]=255&(r<<4)+(u>>8);c[e+p+2]=255&u;p+=3;c[e+p]=255&O;p++;c[e+p++]=0;n(c,e+p,a.preset);p+=2;k(c,e+p,m);p+=4;n(c,e+p,t);p+=2;for(a=0;a<p;a++)l=B(c[e+a],l);n(c,e+p,l);return d.VBR_seek_table.TotalFrameSize};this.putVbrTag=function(b,c){if(0>=b.internal_flags.VBR_seek_table.pos)return-1;c.seek(c.length());if(0==c.length())return-1;c.seek(0);
var d=new Int8Array(10);c.readFully(d);d=(new String(d,"ISO-8859-1")).startsWith("ID3")?0:((d[6]&127)<<21|(d[7]&127)<<14|(d[8]&127)<<7|d[9]&127)+d.length;c.seek(d);d=new Int8Array(a);b=getLameTagFrame(b,d);if(b>d.length)return-1;if(1>b)return 0;c.write(d,0,b);return 0}}function U(c,k,n,w){this.xlen=c;this.linmax=k;this.table=n;this.hlen=w}function xa(c){this.bits=c}function yc(){this.setModules=function(c,k){}}function sb(){this.bits=this.over_SSD=this.over_count=this.max_noise=this.tot_noise=this.over_noise=
0}function zc(){this.scale_right=this.scale_left=this.scale=this.out_samplerate=this.in_samplerate=this.num_channels=this.num_samples=this.class_id=0;this.decode_only=this.bWriteVbrTag=this.analysis=!1;this.quality=0;this.mode=la.STEREO;this.write_id3tag_automatic=this.decode_on_the_fly=this.findReplayGain=this.free_format=this.force_ms=!1;this.error_protection=this.emphasis=this.extension=this.original=this.copyright=this.compression_ratio=this.brate=0;this.disable_reservoir=this.strict_ISO=!1;this.quant_comp_short=
this.quant_comp=0;this.experimentalY=!1;this.preset=this.exp_nspsytune=this.experimentalZ=0;this.VBR=null;this.maskingadjust_short=this.maskingadjust=this.highpasswidth=this.lowpasswidth=this.highpassfreq=this.lowpassfreq=this.VBR_hard_min=this.VBR_max_bitrate_kbps=this.VBR_min_bitrate_kbps=this.VBR_mean_bitrate_kbps=this.VBR_q=this.VBR_q_frac=0;this.noATH=this.ATHshort=this.ATHonly=!1;this.athaa_sensitivity=this.athaa_loudapprox=this.athaa_type=this.ATHlower=this.ATHcurve=this.ATHtype=0;this.short_blocks=
null;this.useTemporal=!1;this.msfix=this.interChRatio=0;this.tune=!1;this.lame_allocated_gfp=this.frameNum=this.framesize=this.encoder_padding=this.encoder_delay=this.version=this.tune_value_a=0;this.internal_flags=null}function Ac(){this.linprebuf=K(2*Y.MAX_ORDER);this.linpre=0;this.lstepbuf=K(Y.MAX_SAMPLES_PER_WINDOW+Y.MAX_ORDER);this.lstep=0;this.loutbuf=K(Y.MAX_SAMPLES_PER_WINDOW+Y.MAX_ORDER);this.lout=0;this.rinprebuf=K(2*Y.MAX_ORDER);this.rinpre=0;this.rstepbuf=K(Y.MAX_SAMPLES_PER_WINDOW+Y.MAX_ORDER);
this.rstep=0;this.routbuf=K(Y.MAX_SAMPLES_PER_WINDOW+Y.MAX_ORDER);this.first=this.freqindex=this.rsum=this.lsum=this.totsamp=this.sampleWindow=this.rout=0;this.A=X(0|Y.STEPS_per_dB*Y.MAX_dB);this.B=X(0|Y.STEPS_per_dB*Y.MAX_dB)}function Bc(u){this.quantize=u;this.iteration_loop=function(k,n,u,w){var B=k.internal_flags,E=K(sa.SFBMAX),f=K(576),b=X(2),v=B.l3_side;var a=new xa(0);this.quantize.rv.ResvFrameBegin(k,a);a=a.bits;for(var m=0;m<B.mode_gr;m++){var z=this.quantize.qupvt.on_pe(k,n,b,a,m,m);B.mode_ext==
c.MPG_MD_MS_LR&&(this.quantize.ms_convert(B.l3_side,m),this.quantize.qupvt.reduce_side(b,u[m],a,z));for(z=0;z<B.channels_out;z++){var e=v.tt[m][z];if(e.block_type!=c.SHORT_TYPE){var l=0;l=B.PSY.mask_adjust-l}else l=0,l=B.PSY.mask_adjust_short-l;B.masking_lower=Math.pow(10,.1*l);this.quantize.init_outer_loop(B,e);this.quantize.init_xrpow(B,e,f)&&(this.quantize.qupvt.calc_xmin(k,w[m][z],e,E),this.quantize.outer_loop(k,e,E,f,z,b[z]));this.quantize.iteration_finish_one(B,m,z)}}this.quantize.rv.ResvFrameEnd(B,
a)}}function Cc(){this.floor=this.decay=this.adjustLimit=this.adjust=this.aaSensitivityP=this.useAdjust=0;this.l=K(c.SBMAX_l);this.s=K(c.SBMAX_s);this.psfb21=K(c.PSFB21);this.psfb12=K(c.PSFB12);this.cb_l=K(c.CBANDS);this.cb_s=K(c.CBANDS);this.eql_w=K(c.BLKSIZE/2)}function za(u,k,n,w){this.l=X(1+c.SBMAX_l);this.s=X(1+c.SBMAX_s);this.psfb21=X(1+c.PSFB21);this.psfb12=X(1+c.PSFB12);var E=this.l,B=this.s;4==arguments.length&&(this.arrL=arguments[0],this.arrS=arguments[1],this.arr21=arguments[2],this.arr12=
arguments[3],T.arraycopy(this.arrL,0,E,0,Math.min(this.arrL.length,this.l.length)),T.arraycopy(this.arrS,0,B,0,Math.min(this.arrS.length,this.s.length)),T.arraycopy(this.arr21,0,this.psfb21,0,Math.min(this.arr21.length,this.psfb21.length)),T.arraycopy(this.arr12,0,this.psfb12,0,Math.min(this.arr12.length,this.psfb12.length)))}function ia(){function u(a,b){b=E.ATHformula(b,a);return b=Math.pow(10,(b-100)/10+a.ATHlower)}function k(a){this.s=a}var n=null,w=null,E=null;this.setModules=function(a,b,d){n=
a;w=b;E=d};this.IPOW20=function(b){return a[b]};var B=ia.IXMAX_VAL+2,ha=ia.Q_MAX,f=ia.Q_MAX2;this.nr_of_sfb_block=[[[6,5,5,5],[9,9,9,9],[6,9,9,9]],[[6,5,7,3],[9,9,12,6],[6,9,12,6]],[[11,10,0,0],[18,18,0,0],[15,18,0,0]],[[7,7,7,0],[12,12,12,0],[6,15,12,0]],[[6,6,6,3],[12,9,9,6],[6,12,9,6]],[[8,8,5,0],[15,12,9,0],[6,18,9,0]]];var b=[0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,3,3,3,2,0];this.pretab=b;this.sfBandIndex=[new za([0,6,12,18,24,30,36,44,54,66,80,96,116,140,168,200,238,284,336,396,464,522,576],[0,4,
8,12,18,24,32,42,56,74,100,132,174,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]),new za([0,6,12,18,24,30,36,44,54,66,80,96,114,136,162,194,232,278,332,394,464,540,576],[0,4,8,12,18,26,36,48,62,80,104,136,180,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]),new za([0,6,12,18,24,30,36,44,54,66,80,96,116,140,168,200,238,284,336,396,464,522,576],[0,4,8,12,18,26,36,48,62,80,104,134,174,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]),new za([0,4,8,12,16,20,24,30,36,44,52,62,74,90,110,134,162,196,238,288,342,418,576],[0,4,8,12,16,22,
30,40,52,66,84,106,136,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]),new za([0,4,8,12,16,20,24,30,36,42,50,60,72,88,106,128,156,190,230,276,330,384,576],[0,4,8,12,16,22,28,38,50,64,80,100,126,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]),new za([0,4,8,12,16,20,24,30,36,44,54,66,82,102,126,156,194,240,296,364,448,550,576],[0,4,8,12,16,22,30,42,58,78,104,138,180,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]),new za([0,6,12,18,24,30,36,44,54,66,80,96,116,140,168,200,238,284,336,396,464,522,576],[0,4,8,12,18,26,36,48,62,80,104,
134,174,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]),new za([0,6,12,18,24,30,36,44,54,66,80,96,116,140,168,200,238,284,336,396,464,522,576],[0,4,8,12,18,26,36,48,62,80,104,134,174,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]),new za([0,12,24,36,48,60,72,88,108,132,160,192,232,280,336,400,476,566,568,570,572,574,576],[0,8,16,24,36,52,72,96,124,160,162,164,166,192],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0])];var v=K(ha+f+1),a=K(ha),m=K(B),z=K(B);this.adj43=z;this.iteration_init=function(b){var e=b.internal_flags,d=e.l3_side;
if(0==e.iteration_init_init){e.iteration_init_init=1;d.main_data_begin=0;d=b.internal_flags.ATH.l;for(var g=b.internal_flags.ATH.psfb21,q=b.internal_flags.ATH.s,k=b.internal_flags.ATH.psfb12,p=b.internal_flags,r=b.out_samplerate,t=0;t<c.SBMAX_l;t++){var J=p.scalefac_band.l[t],h=p.scalefac_band.l[t+1];for(d[t]=Ma.MAX_VALUE;J<h;J++){var x=J*r/1152;x=u(b,x);d[t]=Math.min(d[t],x)}}for(t=0;t<c.PSFB21;t++)for(J=p.scalefac_band.psfb21[t],h=p.scalefac_band.psfb21[t+1],g[t]=Ma.MAX_VALUE;J<h;J++)x=J*r/1152,
x=u(b,x),g[t]=Math.min(g[t],x);for(t=0;t<c.SBMAX_s;t++){J=p.scalefac_band.s[t];h=p.scalefac_band.s[t+1];for(q[t]=Ma.MAX_VALUE;J<h;J++)x=J*r/384,x=u(b,x),q[t]=Math.min(q[t],x);q[t]*=p.scalefac_band.s[t+1]-p.scalefac_band.s[t]}for(t=0;t<c.PSFB12;t++){J=p.scalefac_band.psfb12[t];h=p.scalefac_band.psfb12[t+1];for(k[t]=Ma.MAX_VALUE;J<h;J++)x=J*r/384,x=u(b,x),k[t]=Math.min(k[t],x);k[t]*=p.scalefac_band.s[13]-p.scalefac_band.s[12]}if(b.noATH){for(t=0;t<c.SBMAX_l;t++)d[t]=1E-20;for(t=0;t<c.PSFB21;t++)g[t]=
1E-20;for(t=0;t<c.SBMAX_s;t++)q[t]=1E-20;for(t=0;t<c.PSFB12;t++)k[t]=1E-20}p.ATH.floor=10*Math.log10(u(b,-1));m[0]=0;for(d=1;d<B;d++)m[d]=Math.pow(d,4/3);for(d=0;d<B-1;d++)z[d]=d+1-Math.pow(.5*(m[d]+m[d+1]),.75);z[d]=.5;for(d=0;d<ha;d++)a[d]=Math.pow(2,-.1875*(d-210));for(d=0;d<=ha+f;d++)v[d]=Math.pow(2,.25*(d-210-f));n.huffman_init(e);d=b.exp_nspsytune>>2&63;32<=d&&(d-=64);g=Math.pow(10,d/4/10);d=b.exp_nspsytune>>8&63;32<=d&&(d-=64);q=Math.pow(10,d/4/10);d=b.exp_nspsytune>>14&63;32<=d&&(d-=64);k=
Math.pow(10,d/4/10);d=b.exp_nspsytune>>20&63;32<=d&&(d-=64);b=k*Math.pow(10,d/4/10);for(d=0;d<c.SBMAX_l;d++)p=6>=d?g:13>=d?q:20>=d?k:b,e.nsPsy.longfact[d]=p;for(d=0;d<c.SBMAX_s;d++)p=5>=d?g:10>=d?q:11>=d?k:b,e.nsPsy.shortfact[d]=p}};this.on_pe=function(a,b,d,c,f,m){var e=a.internal_flags,g=0,l=X(2),q;g=new xa(g);a=w.ResvMaxBits(a,c,g,m);g=g.bits;var h=g+a;h>da.MAX_BITS_PER_GRANULE&&(h=da.MAX_BITS_PER_GRANULE);for(q=m=0;q<e.channels_out;++q)d[q]=Math.min(da.MAX_BITS_PER_CHANNEL,g/e.channels_out),l[q]=
0|d[q]*b[f][q]/700-d[q],l[q]>3*c/4&&(l[q]=3*c/4),0>l[q]&&(l[q]=0),l[q]+d[q]>da.MAX_BITS_PER_CHANNEL&&(l[q]=Math.max(0,da.MAX_BITS_PER_CHANNEL-d[q])),m+=l[q];if(m>a)for(q=0;q<e.channels_out;++q)l[q]=a*l[q]/m;for(q=0;q<e.channels_out;++q)d[q]+=l[q],a-=l[q];for(q=m=0;q<e.channels_out;++q)m+=d[q];if(m>da.MAX_BITS_PER_GRANULE)for(q=0;q<e.channels_out;++q)d[q]*=da.MAX_BITS_PER_GRANULE,d[q]/=m;return h};this.reduce_side=function(a,b,d,c){b=.33*(.5-b)/.5;0>b&&(b=0);.5<b&&(b=.5);b=0|.5*b*(a[0]+a[1]);b>da.MAX_BITS_PER_CHANNEL-
a[0]&&(b=da.MAX_BITS_PER_CHANNEL-a[0]);0>b&&(b=0);125<=a[1]&&(125<a[1]-b?(a[0]<d&&(a[0]+=b),a[1]-=b):(a[0]+=a[1]-125,a[1]=125));b=a[0]+a[1];b>c&&(a[0]=c*a[0]/b,a[1]=c*a[1]/b)};this.athAdjust=function(a,b,d){b=aa.FAST_LOG10_X(b,10);a*=a;var c=0;b-=d;1E-20<a&&(c=1+aa.FAST_LOG10_X(a,10/90.30873362));0>c&&(c=0);return Math.pow(10,.1*(b*c+(d+90.30873362-94.82444863)))};this.calc_xmin=function(a,b,d,f){var e=0,g=a.internal_flags,m,l=0,k=0,v=g.ATH,h=d.xr,x=a.VBR==G.vbr_mtrh?1:0,y=g.masking_lower;if(a.VBR==
G.vbr_mtrh||a.VBR==G.vbr_mt)y=1;for(m=0;m<d.psy_lmax;m++){var A=a.VBR==G.vbr_rh||a.VBR==G.vbr_mtrh?athAdjust(v.adjust,v.l[m],v.floor):v.adjust*v.l[m];var n=d.width[m];var u=A/n;var B=2.220446049250313E-16;var z=n>>1;var C=0;do{var I=h[l]*h[l];C+=I;B+=I<u?I:u;l++;I=h[l]*h[l];C+=I;B+=I<u?I:u;l++}while(0<--z);C>A&&k++;m==c.SBPSY_l&&(u=A*g.nsPsy.longfact[m],B<u&&(B=u));0!=x&&(A=B);a.ATHonly||(B=b.en.l[m],0<B&&(u=C*b.thm.l[m]*y/B,0!=x&&(u*=g.nsPsy.longfact[m]),A<u&&(A=u)));0!=x?f[e++]=A:f[e++]=A*g.nsPsy.longfact[m]}C=
575;if(d.block_type!=c.SHORT_TYPE)for(A=576;0!=A--&&qa.EQ(h[A],0);)C=A;d.max_nonzero_coeff=C;for(var Q=d.sfb_smin;m<d.psymax;Q++,m+=3){var S;var w=a.VBR==G.vbr_rh||a.VBR==G.vbr_mtrh?athAdjust(v.adjust,v.s[Q],v.floor):v.adjust*v.s[Q];n=d.width[m];for(S=0;3>S;S++){C=0;z=n>>1;u=w/n;B=2.220446049250313E-16;do I=h[l]*h[l],C+=I,B+=I<u?I:u,l++,I=h[l]*h[l],C+=I,B+=I<u?I:u,l++;while(0<--z);C>w&&k++;Q==c.SBPSY_s&&(u=w*g.nsPsy.shortfact[Q],B<u&&(B=u));A=0!=x?B:w;a.ATHonly||a.ATHshort||(B=b.en.s[Q][S],0<B&&(u=
C*b.thm.s[Q][S]*y/B,0!=x&&(u*=g.nsPsy.shortfact[Q]),A<u&&(A=u)));0!=x?f[e++]=A:f[e++]=A*g.nsPsy.shortfact[Q]}a.useTemporal&&(f[e-3]>f[e-3+1]&&(f[e-3+1]+=(f[e-3]-f[e-3+1])*g.decay),f[e-3+1]>f[e-3+2]&&(f[e-3+2]+=(f[e-3+1]-f[e-3+2])*g.decay))}return k};this.calc_noise_core=function(a,b,d,c){var e=0,f=b.s,g=a.l3_enc;if(f>a.count1)for(;0!=d--;){var l=a.xr[f];f++;e+=l*l;l=a.xr[f];f++;e+=l*l}else if(f>a.big_values){var k=K(2);k[0]=0;for(k[1]=c;0!=d--;)l=Math.abs(a.xr[f])-k[g[f]],f++,e+=l*l,l=Math.abs(a.xr[f])-
k[g[f]],f++,e+=l*l}else for(;0!=d--;)l=Math.abs(a.xr[f])-m[g[f]]*c,f++,e+=l*l,l=Math.abs(a.xr[f])-m[g[f]]*c,f++,e+=l*l;b.s=f;return e};this.calc_noise=function(a,c,d,f,m){var e=0,g=0,l,q=0,u=0,h=0,x=-20,y=0,A=a.scalefac,n=0;for(l=f.over_SSD=0;l<a.psymax;l++){var B=a.global_gain-(A[n++]+(0!=a.preflag?b[l]:0)<<a.scalefac_scale+1)-8*a.subblock_gain[a.window[l]];if(null!=m&&m.step[l]==B){var z=m.noise[l];y+=a.width[l];d[e++]=z/c[g++];z=m.noise_log[l]}else{z=v[B+ia.Q_MAX2];var w=a.width[l]>>1;y+a.width[l]>
a.max_nonzero_coeff&&(w=a.max_nonzero_coeff-y+1,w=0<w?w>>1:0);y=new k(y);z=this.calc_noise_core(a,y,w,z);y=y.s;null!=m&&(m.step[l]=B,m.noise[l]=z);z=d[e++]=z/c[g++];z=aa.FAST_LOG10(Math.max(z,1E-20));null!=m&&(m.noise_log[l]=z)}null!=m&&(m.global_gain=a.global_gain);h+=z;0<z&&(B=Math.max(0|10*z+.5,1),f.over_SSD+=B*B,q++,u+=z);x=Math.max(x,z)}f.over_count=q;f.tot_noise=h;f.over_noise=u;f.max_noise=x;return q};this.set_pinfo=function(a,f,d,g,m){var e=a.internal_flags,l,k,q=0==f.scalefac_scale?.5:1,
v=f.scalefac,h=K(sa.SFBMAX),x=K(sa.SFBMAX),y=new sb;calc_xmin(a,d,f,h);calc_noise(f,h,x,y,null);var u=0;var n=f.sfb_lmax;f.block_type!=c.SHORT_TYPE&&0==f.mixed_block_flag&&(n=22);for(l=0;l<n;l++){var B=e.scalefac_band.l[l],z=e.scalefac_band.l[l+1],w=z-B;for(k=0;u<z;u++)k+=f.xr[u]*f.xr[u];k/=w;var C=1E15;e.pinfo.en[g][m][l]=C*k;e.pinfo.xfsf[g][m][l]=C*h[l]*x[l]/w;k=0<d.en.l[l]&&!a.ATHonly?k/d.en.l[l]:0;e.pinfo.thr[g][m][l]=C*Math.max(k*d.thm.l[l],e.ATH.l[l]);e.pinfo.LAMEsfb[g][m][l]=0;0!=f.preflag&&
11<=l&&(e.pinfo.LAMEsfb[g][m][l]=-q*b[l]);l<c.SBPSY_l&&(e.pinfo.LAMEsfb[g][m][l]-=q*v[l])}if(f.block_type==c.SHORT_TYPE)for(n=l,l=f.sfb_smin;l<c.SBMAX_s;l++){B=e.scalefac_band.s[l];z=e.scalefac_band.s[l+1];w=z-B;for(var I=0;3>I;I++){k=0;for(C=B;C<z;C++)k+=f.xr[u]*f.xr[u],u++;k=Math.max(k/w,1E-20);C=1E15;e.pinfo.en_s[g][m][3*l+I]=C*k;e.pinfo.xfsf_s[g][m][3*l+I]=C*h[n]*x[n]/w;k=0<d.en.s[l][I]?k/d.en.s[l][I]:0;if(a.ATHonly||a.ATHshort)k=0;e.pinfo.thr_s[g][m][3*l+I]=C*Math.max(k*d.thm.s[l][I],e.ATH.s[l]);
e.pinfo.LAMEsfb_s[g][m][3*l+I]=-2*f.subblock_gain[I];l<c.SBPSY_s&&(e.pinfo.LAMEsfb_s[g][m][3*l+I]-=q*v[n]);n++}}e.pinfo.LAMEqss[g][m]=f.global_gain;e.pinfo.LAMEmainbits[g][m]=f.part2_3_length+f.part2_length;e.pinfo.LAMEsfbits[g][m]=f.part2_length;e.pinfo.over[g][m]=y.over_count;e.pinfo.max_noise[g][m]=10*y.max_noise;e.pinfo.over_noise[g][m]=10*y.over_noise;e.pinfo.tot_noise[g][m]=10*y.tot_noise;e.pinfo.over_SSD[g][m]=y.over_SSD}}function Dc(){this.sfb_count1=this.global_gain=0;this.step=X(39);this.noise=
K(39);this.noise_log=K(39)}function rb(){this.xr=K(576);this.l3_enc=X(576);this.scalefac=X(sa.SFBMAX);this.mixed_block_flag=this.block_type=this.scalefac_compress=this.global_gain=this.count1=this.big_values=this.part2_3_length=this.xrpow_max=0;this.table_select=X(3);this.subblock_gain=X(4);this.sfbdivide=this.psymax=this.sfbmax=this.psy_lmax=this.sfb_smin=this.sfb_lmax=this.part2_length=this.count1table_select=this.scalefac_scale=this.preflag=this.region1_count=this.region0_count=0;this.width=X(sa.SFBMAX);
this.window=X(sa.SFBMAX);this.count1bits=0;this.sfb_partition_table=null;this.slen=X(4);this.max_nonzero_coeff=0;var c=this;this.assign=function(k){c.xr=new Float32Array(k.xr);c.l3_enc=new Int32Array(k.l3_enc);c.scalefac=new Int32Array(k.scalefac);c.xrpow_max=k.xrpow_max;c.part2_3_length=k.part2_3_length;c.big_values=k.big_values;c.count1=k.count1;c.global_gain=k.global_gain;c.scalefac_compress=k.scalefac_compress;c.block_type=k.block_type;c.mixed_block_flag=k.mixed_block_flag;c.table_select=new Int32Array(k.table_select);
c.subblock_gain=new Int32Array(k.subblock_gain);c.region0_count=k.region0_count;c.region1_count=k.region1_count;c.preflag=k.preflag;c.scalefac_scale=k.scalefac_scale;c.count1table_select=k.count1table_select;c.part2_length=k.part2_length;c.sfb_lmax=k.sfb_lmax;c.sfb_smin=k.sfb_smin;c.psy_lmax=k.psy_lmax;c.sfbmax=k.sfbmax;c.psymax=k.psymax;c.sfbdivide=k.sfbdivide;c.width=new Int32Array(k.width);c.window=new Int32Array(k.window);c.count1bits=k.count1bits;c.sfb_partition_table=k.sfb_partition_table.slice(0);
c.slen=new Int32Array(k.slen);c.max_nonzero_coeff=k.max_nonzero_coeff}}function Ec(){function u(c){this.ordinal=c}function k(c){for(var b=0;b<c.sfbmax;b++)if(0==c.scalefac[b]+c.subblock_gain[c.window[b]])return!1;return!0}var n;this.rv=null;var w;this.qupvt=null;var E,B=new yc,ha;this.setModules=function(c,b,k,a){n=c;this.rv=w=b;this.qupvt=E=k;ha=a;B.setModules(E,ha)};this.ms_convert=function(c,b){for(var f=0;576>f;++f){var a=c.tt[b][0].xr[f],m=c.tt[b][1].xr[f];c.tt[b][0].xr[f]=.5*(a+m)*aa.SQRT2;
c.tt[b][1].xr[f]=.5*(a-m)*aa.SQRT2}};this.init_xrpow=function(c,b,k){var a=0|b.max_nonzero_coeff;b.xrpow_max=0;na.fill(k,a,576,0);for(var f,v=f=0;v<=a;++v){var e=Math.abs(b.xr[v]);f+=e;k[v]=Math.sqrt(e*Math.sqrt(e));k[v]>b.xrpow_max&&(b.xrpow_max=k[v])}if(1E-20<f){k=0;0!=(c.substep_shaping&2)&&(k=1);for(a=0;a<b.psymax;a++)c.pseudohalf[a]=k;return!0}na.fill(b.l3_enc,0,576,0);return!1};this.init_outer_loop=function(f,b){b.part2_3_length=0;b.big_values=0;b.count1=0;b.global_gain=210;b.scalefac_compress=
0;b.table_select[0]=0;b.table_select[1]=0;b.table_select[2]=0;b.subblock_gain[0]=0;b.subblock_gain[1]=0;b.subblock_gain[2]=0;b.subblock_gain[3]=0;b.region0_count=0;b.region1_count=0;b.preflag=0;b.scalefac_scale=0;b.count1table_select=0;b.part2_length=0;b.sfb_lmax=c.SBPSY_l;b.sfb_smin=c.SBPSY_s;b.psy_lmax=f.sfb21_extra?c.SBMAX_l:c.SBPSY_l;b.psymax=b.psy_lmax;b.sfbmax=b.sfb_lmax;b.sfbdivide=11;for(var k=0;k<c.SBMAX_l;k++)b.width[k]=f.scalefac_band.l[k+1]-f.scalefac_band.l[k],b.window[k]=3;if(b.block_type==
c.SHORT_TYPE){var a=K(576);b.sfb_smin=0;b.sfb_lmax=0;0!=b.mixed_block_flag&&(b.sfb_smin=3,b.sfb_lmax=2*f.mode_gr+4);b.psymax=b.sfb_lmax+3*((f.sfb21_extra?c.SBMAX_s:c.SBPSY_s)-b.sfb_smin);b.sfbmax=b.sfb_lmax+3*(c.SBPSY_s-b.sfb_smin);b.sfbdivide=b.sfbmax-18;b.psy_lmax=b.sfb_lmax;var m=f.scalefac_band.l[b.sfb_lmax];T.arraycopy(b.xr,0,a,0,576);for(k=b.sfb_smin;k<c.SBMAX_s;k++)for(var n=f.scalefac_band.s[k],e=f.scalefac_band.s[k+1],l=0;3>l;l++)for(var d=n;d<e;d++)b.xr[m++]=a[3*d+l];a=b.sfb_lmax;for(k=
b.sfb_smin;k<c.SBMAX_s;k++)b.width[a]=b.width[a+1]=b.width[a+2]=f.scalefac_band.s[k+1]-f.scalefac_band.s[k],b.window[a]=0,b.window[a+1]=1,b.window[a+2]=2,a+=3}b.count1bits=0;b.sfb_partition_table=E.nr_of_sfb_block[0][0];b.slen[0]=0;b.slen[1]=0;b.slen[2]=0;b.slen[3]=0;b.max_nonzero_coeff=575;na.fill(b.scalefac,0);k=f.ATH;a=b.xr;if(b.block_type!=c.SHORT_TYPE)for(b=!1,m=c.PSFB21-1;0<=m&&!b;m--)for(n=f.scalefac_band.psfb21[m],e=f.scalefac_band.psfb21[m+1],l=E.athAdjust(k.adjust,k.psfb21[m],k.floor),1E-12<
f.nsPsy.longfact[21]&&(l*=f.nsPsy.longfact[21]),--e;e>=n;e--)if(Math.abs(a[e])<l)a[e]=0;else{b=!0;break}else for(l=0;3>l;l++)for(b=!1,m=c.PSFB12-1;0<=m&&!b;m--)for(n=3*f.scalefac_band.s[12]+(f.scalefac_band.s[13]-f.scalefac_band.s[12])*l+(f.scalefac_band.psfb12[m]-f.scalefac_band.psfb12[0]),e=n+(f.scalefac_band.psfb12[m+1]-f.scalefac_band.psfb12[m]),d=E.athAdjust(k.adjust,k.psfb12[m],k.floor),1E-12<f.nsPsy.shortfact[12]&&(d*=f.nsPsy.shortfact[12]),--e;e>=n;e--)if(Math.abs(a[e])<d)a[e]=0;else{b=!0;
break}};u.BINSEARCH_NONE=new u(0);u.BINSEARCH_UP=new u(1);u.BINSEARCH_DOWN=new u(2);this.trancate_smallspectrums=function(f,b,k,a){var m=K(sa.SFBMAX);if((0!=(f.substep_shaping&4)||b.block_type!=c.SHORT_TYPE)&&0==(f.substep_shaping&128)){E.calc_noise(b,k,m,new sb,null);for(var n=0;576>n;n++){var e=0;0!=b.l3_enc[n]&&(e=Math.abs(b.xr[n]));a[n]=e}n=0;e=8;b.block_type==c.SHORT_TYPE&&(e=6);do{var l,d,g=b.width[e];n+=g;if(!(1<=m[e]||(na.sort(a,n-g,g),qa.EQ(a[n-1],0)))){var q=(1-m[e])*k[e];var v=l=0;do{for(d=
1;v+d<g&&!qa.NEQ(a[v+n-g],a[v+n+d-g]);d++);var p=a[v+n-g]*a[v+n-g]*d;if(q<p){0!=v&&(l=a[v+n-g-1]);break}q-=p;v+=d}while(v<g);if(!qa.EQ(l,0)){do Math.abs(b.xr[n-g])<=l&&(b.l3_enc[n-g]=0);while(0<--g)}}}while(++e<b.psymax);b.part2_3_length=ha.noquant_count_bits(f,b,null)}};this.outer_loop=function(f,b,n,a,m,B){var e=f.internal_flags,l=new rb,d=K(576),g=K(sa.SFBMAX),q=new sb,v=new Dc,p=9999999,r=!1,t=!1,w=0,h,x=e.CurrentStep[m],y=!1,A=e.OldValue[m];var z=u.BINSEARCH_NONE;b.global_gain=A;for(h=B-b.part2_length;;){var H=
ha.count_bits(e,a,b,null);if(1==x||H==h)break;H>h?(z==u.BINSEARCH_DOWN&&(y=!0),y&&(x/=2),z=u.BINSEARCH_UP,H=x):(z==u.BINSEARCH_UP&&(y=!0),y&&(x/=2),z=u.BINSEARCH_DOWN,H=-x);b.global_gain+=H;0>b.global_gain&&(b.global_gain=0,y=!0);255<b.global_gain&&(b.global_gain=255,y=!0)}for(;H>h&&255>b.global_gain;)b.global_gain++,H=ha.count_bits(e,a,b,null);e.CurrentStep[m]=4<=A-b.global_gain?4:2;e.OldValue[m]=b.global_gain;b.part2_3_length=H;if(0==e.noise_shaping)return 100;E.calc_noise(b,n,g,q,v);q.bits=b.part2_3_length;
l.assign(b);m=0;for(T.arraycopy(a,0,d,0,576);!r;){do{h=new sb;y=255;x=0!=(e.substep_shaping&2)?20:3;if(e.sfb21_extra){if(1<g[l.sfbmax])break;if(l.block_type==c.SHORT_TYPE&&(1<g[l.sfbmax+1]||1<g[l.sfbmax+2]))break}A=l;H=a;z=f.internal_flags;var O=A,F=g,C=H,I=f.internal_flags;var Q=0==O.scalefac_scale?1.2968395546510096:1.6817928305074292;for(var S=0,ma=0;ma<O.sfbmax;ma++)S<F[ma]&&(S=F[ma]);ma=I.noise_shaping_amp;3==ma&&(ma=t?2:1);switch(ma){case 2:break;case 1:S=1<S?Math.pow(S,.5):.95*S;break;default:S=
1<S?1:.95*S}var Z=0;for(ma=0;ma<O.sfbmax;ma++){var L=O.width[ma];Z+=L;if(!(F[ma]<S)){if(0!=(I.substep_shaping&2)&&(I.pseudohalf[ma]=0==I.pseudohalf[ma]?1:0,0==I.pseudohalf[ma]&&2==I.noise_shaping_amp))break;O.scalefac[ma]++;for(L=-L;0>L;L++)C[Z+L]*=Q,C[Z+L]>O.xrpow_max&&(O.xrpow_max=C[Z+L]);if(2==I.noise_shaping_amp)break}}if(Q=k(A))A=!1;else if(Q=2==z.mode_gr?ha.scale_bitcount(A):ha.scale_bitcount_lsf(z,A)){if(1<z.noise_shaping)if(na.fill(z.pseudohalf,0),0==A.scalefac_scale){Q=A;for(F=O=0;F<Q.sfbmax;F++){I=
Q.width[F];C=Q.scalefac[F];0!=Q.preflag&&(C+=E.pretab[F]);O+=I;if(0!=(C&1))for(C++,I=-I;0>I;I++)H[O+I]*=1.2968395546510096,H[O+I]>Q.xrpow_max&&(Q.xrpow_max=H[O+I]);Q.scalefac[F]=C>>1}Q.preflag=0;Q.scalefac_scale=1;Q=!1}else if(A.block_type==c.SHORT_TYPE&&0<z.subblock_gain){b:{Q=z;O=A;F=H;C=O.scalefac;for(H=0;H<O.sfb_lmax;H++)if(16<=C[H]){H=!0;break b}for(I=0;3>I;I++){ma=S=0;for(H=O.sfb_lmax+I;H<O.sfbdivide;H+=3)S<C[H]&&(S=C[H]);for(;H<O.sfbmax;H+=3)ma<C[H]&&(ma=C[H]);if(!(16>S&&8>ma)){if(7<=O.subblock_gain[I]){H=
!0;break b}O.subblock_gain[I]++;S=Q.scalefac_band.l[O.sfb_lmax];for(H=O.sfb_lmax+I;H<O.sfbmax;H+=3)if(ma=O.width[H],Z=C[H],Z-=4>>O.scalefac_scale,0<=Z)C[H]=Z,S+=3*ma;else{C[H]=0;Z=E.IPOW20(210+(Z<<O.scalefac_scale+1));S+=ma*(I+1);for(L=-ma;0>L;L++)F[S+L]*=Z,F[S+L]>O.xrpow_max&&(O.xrpow_max=F[S+L]);S+=ma*(3-I-1)}Z=E.IPOW20(202);S+=O.width[H]*(I+1);for(L=-O.width[H];0>L;L++)F[S+L]*=Z,F[S+L]>O.xrpow_max&&(O.xrpow_max=F[S+L])}}H=!1}Q=H||k(A)}Q||(Q=2==z.mode_gr?ha.scale_bitcount(A):ha.scale_bitcount_lsf(z,
A));A=!Q}else A=!0;if(!A)break;0!=l.scalefac_scale&&(y=254);A=B-l.part2_length;if(0>=A)break;for(;(l.part2_3_length=ha.count_bits(e,a,l,v))>A&&l.global_gain<=y;)l.global_gain++;if(l.global_gain>y)break;if(0==q.over_count){for(;(l.part2_3_length=ha.count_bits(e,a,l,v))>p&&l.global_gain<=y;)l.global_gain++;if(l.global_gain>y)break}E.calc_noise(l,n,g,h,v);h.bits=l.part2_3_length;z=b.block_type!=c.SHORT_TYPE?f.quant_comp:f.quant_comp_short;y=q;A=h;Q=l;H=g;switch(z){default:case 9:0<y.over_count?(z=A.over_SSD<=
y.over_SSD,A.over_SSD==y.over_SSD&&(z=A.bits<y.bits)):z=0>A.max_noise&&10*A.max_noise+A.bits<=10*y.max_noise+y.bits;break;case 0:z=A.over_count<y.over_count||A.over_count==y.over_count&&A.over_noise<y.over_noise||A.over_count==y.over_count&&qa.EQ(A.over_noise,y.over_noise)&&A.tot_noise<y.tot_noise;break;case 8:z=A;F=1E-37;for(O=0;O<Q.psymax;O++)C=H[O],C=aa.FAST_LOG10(.368+.632*C*C*C),F+=C;z.max_noise=Math.max(1E-20,F);case 1:z=A.max_noise<y.max_noise;break;case 2:z=A.tot_noise<y.tot_noise;break;case 3:z=
A.tot_noise<y.tot_noise&&A.max_noise<y.max_noise;break;case 4:z=0>=A.max_noise&&.2<y.max_noise||0>=A.max_noise&&0>y.max_noise&&y.max_noise>A.max_noise-.2&&A.tot_noise<y.tot_noise||0>=A.max_noise&&0<y.max_noise&&y.max_noise>A.max_noise-.2&&A.tot_noise<y.tot_noise+y.over_noise||0<A.max_noise&&-.05<y.max_noise&&y.max_noise>A.max_noise-.1&&A.tot_noise+A.over_noise<y.tot_noise+y.over_noise||0<A.max_noise&&-.1<y.max_noise&&y.max_noise>A.max_noise-.15&&A.tot_noise+A.over_noise+A.over_noise<y.tot_noise+y.over_noise+
y.over_noise;break;case 5:z=A.over_noise<y.over_noise||qa.EQ(A.over_noise,y.over_noise)&&A.tot_noise<y.tot_noise;break;case 6:z=A.over_noise<y.over_noise||qa.EQ(A.over_noise,y.over_noise)&&(A.max_noise<y.max_noise||qa.EQ(A.max_noise,y.max_noise)&&A.tot_noise<=y.tot_noise);break;case 7:z=A.over_count<y.over_count||A.over_noise<y.over_noise}0==y.over_count&&(z=z&&A.bits<y.bits);z=z?1:0;if(0!=z)p=b.part2_3_length,q=h,b.assign(l),m=0,T.arraycopy(a,0,d,0,576);else if(0==e.full_outer_loop){if(++m>x&&0==
q.over_count)break;if(3==e.noise_shaping_amp&&t&&30<m)break;if(3==e.noise_shaping_amp&&t&&15<l.global_gain-w)break}}while(255>l.global_gain+l.scalefac_scale);3==e.noise_shaping_amp?t?r=!0:(l.assign(b),T.arraycopy(d,0,a,0,576),m=0,w=l.global_gain,t=!0):r=!0}f.VBR==G.vbr_rh||f.VBR==G.vbr_mtrh?T.arraycopy(d,0,a,0,576):0!=(e.substep_shaping&1)&&trancate_smallspectrums(e,b,n,a);return q.over_count};this.iteration_finish_one=function(c,b,k){var a=c.l3_side,f=a.tt[b][k];ha.best_scalefac_store(c,b,k,a);1==
c.use_best_huffman&&ha.best_huffman_divide(c,f);w.ResvAdjust(c,f)};this.VBR_encode_granule=function(c,b,k,a,m,n,e){var f=c.internal_flags,d=new rb,g=K(576),q=e,v=(e+n)/2,p=0,r=f.sfb21_extra;na.fill(d.l3_enc,0);do{f.sfb21_extra=v>q-42?!1:r;var t=outer_loop(c,b,k,a,m,v);0>=t?(p=1,e=b.part2_3_length,d.assign(b),T.arraycopy(a,0,g,0,576),e-=32,t=e-n,v=(e+n)/2):(n=v+32,t=e-n,v=(e+n)/2,0!=p&&(p=2,b.assign(d),T.arraycopy(g,0,a,0,576)))}while(12<t);f.sfb21_extra=r;2==p&&T.arraycopy(d.l3_enc,0,b.l3_enc,0,576)};
this.get_framebits=function(c,b){var f=c.internal_flags;f.bitrate_index=f.VBR_min_bitrate;n.getframebits(c);f.bitrate_index=1;var a=n.getframebits(c);for(var m=1;m<=f.VBR_max_bitrate;m++)f.bitrate_index=m,a=new xa(a),b[m]=w.ResvFrameBegin(c,a),a=a.bits};this.VBR_old_prepare=function(f,b,k,a,m,n,e,l,d){var g=f.internal_flags,q=1,v=0;g.bitrate_index=g.VBR_max_bitrate;var p=w.ResvFrameBegin(f,new xa(0))/g.mode_gr;get_framebits(f,n);for(var r=0;r<g.mode_gr;r++){var t=E.on_pe(f,b,l[r],p,r,0);g.mode_ext==
c.MPG_MD_MS_LR&&(ms_convert(g.l3_side,r),E.reduce_side(l[r],k[r],p,t));for(t=0;t<g.channels_out;++t){var u=g.l3_side.tt[r][t];if(u.block_type!=c.SHORT_TYPE){var h=1.28/(1+Math.exp(3.5-b[r][t]/300))-.05;h=g.PSY.mask_adjust-h}else h=2.56/(1+Math.exp(3.5-b[r][t]/300))-.14,h=g.PSY.mask_adjust_short-h;g.masking_lower=Math.pow(10,.1*h);init_outer_loop(g,u);d[r][t]=E.calc_xmin(f,a[r][t],u,m[r][t]);0!=d[r][t]&&(q=0);e[r][t]=126;v+=l[r][t]}}for(r=0;r<g.mode_gr;r++)for(t=0;t<g.channels_out;t++)v>n[g.VBR_max_bitrate]&&
(l[r][t]*=n[g.VBR_max_bitrate],l[r][t]/=v),e[r][t]>l[r][t]&&(e[r][t]=l[r][t]);return q};this.bitpressure_strategy=function(f,b,k,a){for(var m=0;m<f.mode_gr;m++)for(var n=0;n<f.channels_out;n++){for(var e=f.l3_side.tt[m][n],l=b[m][n],d=0,g=0;g<e.psy_lmax;g++)l[d++]*=1+.029*g*g/c.SBMAX_l/c.SBMAX_l;if(e.block_type==c.SHORT_TYPE)for(g=e.sfb_smin;g<c.SBMAX_s;g++)l[d++]*=1+.029*g*g/c.SBMAX_s/c.SBMAX_s,l[d++]*=1+.029*g*g/c.SBMAX_s/c.SBMAX_s,l[d++]*=1+.029*g*g/c.SBMAX_s/c.SBMAX_s;a[m][n]=0|Math.max(k[m][n],
.9*a[m][n])}};this.VBR_new_prepare=function(f,b,k,a,m,n){var e=f.internal_flags,l=1,d=0,g=0;if(f.free_format){e.bitrate_index=0;d=new xa(d);var q=w.ResvFrameBegin(f,d);d=d.bits;m[0]=q}else e.bitrate_index=e.VBR_max_bitrate,d=new xa(d),w.ResvFrameBegin(f,d),d=d.bits,get_framebits(f,m),q=m[e.VBR_max_bitrate];for(m=0;m<e.mode_gr;m++){E.on_pe(f,b,n[m],d,m,0);e.mode_ext==c.MPG_MD_MS_LR&&ms_convert(e.l3_side,m);for(var v=0;v<e.channels_out;++v){var p=e.l3_side.tt[m][v];e.masking_lower=Math.pow(10,.1*e.PSY.mask_adjust);
init_outer_loop(e,p);0!=E.calc_xmin(f,k[m][v],p,a[m][v])&&(l=0);g+=n[m][v]}}for(m=0;m<e.mode_gr;m++)for(v=0;v<e.channels_out;v++)g>q&&(n[m][v]*=q,n[m][v]/=g);return l};this.calc_target_bits=function(f,b,k,a,m,u){var e=f.internal_flags,l=e.l3_side;e.bitrate_index=e.VBR_max_bitrate;var d=new xa(0);u[0]=w.ResvFrameBegin(f,d);e.bitrate_index=1;d=n.getframebits(f)-8*e.sideinfo_len;m[0]=d/(e.mode_gr*e.channels_out);d=f.VBR_mean_bitrate_kbps*f.framesize*1E3;0!=(e.substep_shaping&1)&&(d*=1.09);d/=f.out_samplerate;
d-=8*e.sideinfo_len;d/=e.mode_gr*e.channels_out;var g=.93+.07*(11-f.compression_ratio)/5.5;.9>g&&(g=.9);1<g&&(g=1);for(f=0;f<e.mode_gr;f++){var q=0;for(m=0;m<e.channels_out;m++){a[f][m]=int(g*d);if(700<b[f][m]){var v=int((b[f][m]-700)/1.4),p=l.tt[f][m];a[f][m]=int(g*d);p.block_type==c.SHORT_TYPE&&v<d/2&&(v=d/2);v>3*d/2?v=3*d/2:0>v&&(v=0);a[f][m]+=v}a[f][m]>da.MAX_BITS_PER_CHANNEL&&(a[f][m]=da.MAX_BITS_PER_CHANNEL);q+=a[f][m]}if(q>da.MAX_BITS_PER_GRANULE)for(m=0;m<e.channels_out;++m)a[f][m]*=da.MAX_BITS_PER_GRANULE,
a[f][m]/=q}if(e.mode_ext==c.MPG_MD_MS_LR)for(f=0;f<e.mode_gr;f++)E.reduce_side(a[f],k[f],d*e.channels_out,da.MAX_BITS_PER_GRANULE);for(f=b=0;f<e.mode_gr;f++)for(m=0;m<e.channels_out;m++)a[f][m]>da.MAX_BITS_PER_CHANNEL&&(a[f][m]=da.MAX_BITS_PER_CHANNEL),b+=a[f][m];if(b>u[0])for(f=0;f<e.mode_gr;f++)for(m=0;m<e.channels_out;m++)a[f][m]*=u[0],a[f][m]/=b}}function Fc(){function u(b,c,a){for(var f=10,n=c+238-14-286,e=-15;0>e;e++){var l=k[f+-10];var d=b[n+-224]*l;var g=b[c+224]*l;l=k[f+-9];d+=b[n+-160]*
l;g+=b[c+160]*l;l=k[f+-8];d+=b[n+-96]*l;g+=b[c+96]*l;l=k[f+-7];d+=b[n+-32]*l;g+=b[c+32]*l;l=k[f+-6];d+=b[n+32]*l;g+=b[c+-32]*l;l=k[f+-5];d+=b[n+96]*l;g+=b[c+-96]*l;l=k[f+-4];d+=b[n+160]*l;g+=b[c+-160]*l;l=k[f+-3];d+=b[n+224]*l;g+=b[c+-224]*l;l=k[f+-2];d+=b[c+-256]*l;g-=b[n+256]*l;l=k[f+-1];d+=b[c+-192]*l;g-=b[n+192]*l;l=k[f+0];d+=b[c+-128]*l;g-=b[n+128]*l;l=k[f+1];d+=b[c+-64]*l;g-=b[n+64]*l;l=k[f+2];d+=b[c+0]*l;g-=b[n+0]*l;l=k[f+3];d+=b[c+64]*l;g-=b[n+-64]*l;l=k[f+4];d+=b[c+128]*l;g-=b[n+-128]*l;
l=k[f+5];d+=b[c+192]*l;g-=b[n+-192]*l;d*=k[f+6];l=g-d;a[30+2*e]=g+d;a[31+2*e]=k[f+7]*l;f+=18;c--;n++}g=b[c+-16]*k[f+-10];d=b[c+-32]*k[f+-2];g+=(b[c+-48]-b[c+16])*k[f+-9];d+=b[c+-96]*k[f+-1];g+=(b[c+-80]+b[c+48])*k[f+-8];d+=b[c+-160]*k[f+0];g+=(b[c+-112]-b[c+80])*k[f+-7];d+=b[c+-224]*k[f+1];g+=(b[c+-144]+b[c+112])*k[f+-6];d-=b[c+32]*k[f+2];g+=(b[c+-176]-b[c+144])*k[f+-5];d-=b[c+96]*k[f+3];g+=(b[c+-208]+b[c+176])*k[f+-4];d-=b[c+160]*k[f+4];g+=(b[c+-240]-b[c+208])*k[f+-3];d-=b[c+224];b=d-g;c=d+g;g=a[14];
d=a[15]-g;a[31]=c+g;a[30]=b+d;a[15]=b-d;a[14]=c-g;d=a[28]-a[0];a[0]+=a[28];a[28]=d*k[f+-36+7];d=a[29]-a[1];a[1]+=a[29];a[29]=d*k[f+-36+7];d=a[26]-a[2];a[2]+=a[26];a[26]=d*k[f+-72+7];d=a[27]-a[3];a[3]+=a[27];a[27]=d*k[f+-72+7];d=a[24]-a[4];a[4]+=a[24];a[24]=d*k[f+-108+7];d=a[25]-a[5];a[5]+=a[25];a[25]=d*k[f+-108+7];d=a[22]-a[6];a[6]+=a[22];a[22]=d*aa.SQRT2;d=a[23]-a[7];a[7]+=a[23];a[23]=d*aa.SQRT2-a[7];a[7]-=a[6];a[22]-=a[7];a[23]-=a[22];d=a[6];a[6]=a[31]-d;a[31]+=d;d=a[7];a[7]=a[30]-d;a[30]+=d;d=
a[22];a[22]=a[15]-d;a[15]+=d;d=a[23];a[23]=a[14]-d;a[14]+=d;d=a[20]-a[8];a[8]+=a[20];a[20]=d*k[f+-180+7];d=a[21]-a[9];a[9]+=a[21];a[21]=d*k[f+-180+7];d=a[18]-a[10];a[10]+=a[18];a[18]=d*k[f+-216+7];d=a[19]-a[11];a[11]+=a[19];a[19]=d*k[f+-216+7];d=a[16]-a[12];a[12]+=a[16];a[16]=d*k[f+-252+7];d=a[17]-a[13];a[13]+=a[17];a[17]=d*k[f+-252+7];d=-a[20]+a[24];a[20]+=a[24];a[24]=d*k[f+-216+7];d=-a[21]+a[25];a[21]+=a[25];a[25]=d*k[f+-216+7];d=a[4]-a[8];a[4]+=a[8];a[8]=d*k[f+-216+7];d=a[5]-a[9];a[5]+=a[9];a[9]=
d*k[f+-216+7];d=a[0]-a[12];a[0]+=a[12];a[12]=d*k[f+-72+7];d=a[1]-a[13];a[1]+=a[13];a[13]=d*k[f+-72+7];d=a[16]-a[28];a[16]+=a[28];a[28]=d*k[f+-72+7];d=-a[17]+a[29];a[17]+=a[29];a[29]=d*k[f+-72+7];d=aa.SQRT2*(a[2]-a[10]);a[2]+=a[10];a[10]=d;d=aa.SQRT2*(a[3]-a[11]);a[3]+=a[11];a[11]=d;d=aa.SQRT2*(-a[18]+a[26]);a[18]+=a[26];a[26]=d-a[18];d=aa.SQRT2*(-a[19]+a[27]);a[19]+=a[27];a[27]=d-a[19];d=a[2];a[19]-=a[3];a[3]-=d;a[2]=a[31]-d;a[31]+=d;d=a[3];a[11]-=a[19];a[18]-=d;a[3]=a[30]-d;a[30]+=d;d=a[18];a[27]-=
a[11];a[19]-=d;a[18]=a[15]-d;a[15]+=d;d=a[19];a[10]-=d;a[19]=a[14]-d;a[14]+=d;d=a[10];a[11]-=d;a[10]=a[23]-d;a[23]+=d;d=a[11];a[26]-=d;a[11]=a[22]-d;a[22]+=d;d=a[26];a[27]-=d;a[26]=a[7]-d;a[7]+=d;d=a[27];a[27]=a[6]-d;a[6]+=d;d=aa.SQRT2*(a[0]-a[4]);a[0]+=a[4];a[4]=d;d=aa.SQRT2*(a[1]-a[5]);a[1]+=a[5];a[5]=d;d=aa.SQRT2*(a[16]-a[20]);a[16]+=a[20];a[20]=d;d=aa.SQRT2*(a[17]-a[21]);a[17]+=a[21];a[21]=d;d=-aa.SQRT2*(a[8]-a[12]);a[8]+=a[12];a[12]=d-a[8];d=-aa.SQRT2*(a[9]-a[13]);a[9]+=a[13];a[13]=d-a[9];d=
-aa.SQRT2*(a[25]-a[29]);a[25]+=a[29];a[29]=d-a[25];d=-aa.SQRT2*(a[24]+a[28]);a[24]-=a[28];a[28]=d-a[24];d=a[24]-a[16];a[24]=d;d=a[20]-d;a[20]=d;d=a[28]-d;a[28]=d;d=a[25]-a[17];a[25]=d;d=a[21]-d;a[21]=d;d=a[29]-d;a[29]=d;d=a[17]-a[1];a[17]=d;d=a[9]-d;a[9]=d;d=a[25]-d;a[25]=d;d=a[5]-d;a[5]=d;d=a[21]-d;a[21]=d;d=a[13]-d;a[13]=d;d=a[29]-d;a[29]=d;d=a[1]-a[0];a[1]=d;d=a[16]-d;a[16]=d;d=a[17]-d;a[17]=d;d=a[8]-d;a[8]=d;d=a[9]-d;a[9]=d;d=a[24]-d;a[24]=d;d=a[25]-d;a[25]=d;d=a[4]-d;a[4]=d;d=a[5]-d;a[5]=d;d=
a[20]-d;a[20]=d;d=a[21]-d;a[21]=d;d=a[12]-d;a[12]=d;d=a[13]-d;a[13]=d;d=a[28]-d;a[28]=d;d=a[29]-d;a[29]=d;d=a[0];a[0]+=a[31];a[31]-=d;d=a[1];a[1]+=a[30];a[30]-=d;d=a[16];a[16]+=a[15];a[15]-=d;d=a[17];a[17]+=a[14];a[14]-=d;d=a[8];a[8]+=a[23];a[23]-=d;d=a[9];a[9]+=a[22];a[22]-=d;d=a[24];a[24]+=a[7];a[7]-=d;d=a[25];a[25]+=a[6];a[6]-=d;d=a[4];a[4]+=a[27];a[27]-=d;d=a[5];a[5]+=a[26];a[26]-=d;d=a[20];a[20]+=a[11];a[11]-=d;d=a[21];a[21]+=a[10];a[10]-=d;d=a[12];a[12]+=a[19];a[19]-=d;d=a[13];a[13]+=a[18];
a[18]-=d;d=a[28];a[28]+=a[3];a[3]-=d;d=a[29];a[29]+=a[2];a[2]-=d}var k=[-.1482523854003001,32.308141959636465,296.40344946382766,883.1344870032432,11113.947376231741,1057.2713659324597,305.7402417275812,30.825928907280012,3.8533188138216365,59.42900443849514,709.5899960123345,5281.91112291017,-5829.66483675846,-817.6293103748613,-76.91656988279972,-4.594269939176596,.9063471690191471,.1960342806591213,-.15466694054279598,34.324387823855965,301.8067566458425,817.599602898885,11573.795901679885,1181.2520595540152,
321.59731579894424,31.232021761053772,3.7107095756221318,53.650946155329365,684.167428119626,5224.56624370173,-6366.391851890084,-908.9766368219582,-89.83068876699639,-5.411397422890401,.8206787908286602,.3901806440322567,-.16070888947830023,36.147034243915876,304.11815768187864,732.7429163887613,11989.60988270091,1300.012278487897,335.28490093152146,31.48816102859945,3.373875931311736,47.232241542899175,652.7371796173471,5132.414255594984,-6909.087078780055,-1001.9990371107289,-103.62185754286375,
-6.104916304710272,.7416505462720353,.5805693545089249,-.16636367662261495,37.751650073343995,303.01103387567713,627.9747488785183,12358.763425278165,1412.2779918482834,346.7496836825721,31.598286663170416,3.1598635433980946,40.57878626349686,616.1671130880391,5007.833007176154,-7454.040671756168,-1095.7960341867115,-118.24411666465777,-6.818469345853504,.6681786379192989,.7653668647301797,-.1716176790982088,39.11551877123304,298.3413246578966,503.5259106886539,12679.589408408976,1516.5821921214542,
355.9850766329023,31.395241710249053,2.9164211881972335,33.79716964664243,574.8943997801362,4853.234992253242,-7997.57021486075,-1189.7624067269965,-133.6444792601766,-7.7202770609839915,.5993769336819237,.9427934736519954,-.17645823955292173,40.21879108166477,289.9982036694474,359.3226160751053,12950.259102786438,1612.1013903507662,362.85067106591504,31.045922092242872,2.822222032597987,26.988862316190684,529.8996541764288,4671.371946949588,-8535.899136645805,-1282.5898586244496,-149.58553632943463,
-8.643494270763135,.5345111359507916,1.111140466039205,-.36174739330527045,41.04429910497807,277.5463268268618,195.6386023135583,13169.43812144731,1697.6433561479398,367.40983966190305,30.557037410382826,2.531473372857427,20.070154905927314,481.50208566532336,4464.970341588308,-9065.36882077239,-1373.62841526722,-166.1660487028118,-9.58289321133207,.4729647758913199,1.268786568327291,-.36970682634889585,41.393213350082036,261.2935935556502,12.935476055240873,13336.131683328815,1772.508612059496,369.76534388639965,
29.751323653701338,2.4023193045459172,13.304795348228817,430.5615775526625,4237.0568611071185,-9581.931701634761,-1461.6913552409758,-183.12733958476446,-10.718010163869403,.41421356237309503,1.414213562373095,-.37677560326535325,41.619486213528496,241.05423794991074,-187.94665032361226,13450.063605744153,1836.153896465782,369.4908799925761,29.001847876923147,2.0714759319987186,6.779591200894186,377.7767837205709,3990.386575512536,-10081.709459700915,-1545.947424837898,-200.3762958015653,-11.864482073055006,
.3578057213145241,1.546020906725474,-.3829366947518991,41.1516456456653,216.47684307105183,-406.1569483347166,13511.136535077321,1887.8076599260432,367.3025214564151,28.136213436723654,1.913880671464418,.3829366947518991,323.85365704338597,3728.1472257487526,-10561.233882199509,-1625.2025997821418,-217.62525175416,-13.015432208941645,.3033466836073424,1.66293922460509,-.5822628872992417,40.35639251440489,188.20071124269245,-640.2706748618148,13519.21490106562,1927.6022433578062,362.8197642637487,
26.968821921868447,1.7463817695935329,-5.62650678237171,269.3016715297017,3453.386536448852,-11016.145278780888,-1698.6569643425091,-234.7658734267683,-14.16351421663124,.2504869601913055,1.76384252869671,-.5887180101749253,39.23429103868072,155.76096234403798,-889.2492977967378,13475.470561874661,1955.0535223723712,356.4450994756727,25.894952980042156,1.5695032905781554,-11.181939564328772,214.80884394039484,3169.1640829158237,-11443.321309975563,-1765.1588461316153,-251.68908574481912,-15.49755935939164,
.198912367379658,1.847759065022573,-.7912582233652842,37.39369355329111,119.699486012458,-1151.0956593239027,13380.446257078214,1970.3952110853447,348.01959814116185,24.731487364283044,1.3850130831637748,-16.421408865300393,161.05030052864092,2878.3322807850063,-11838.991423510031,-1823.985884688674,-268.2854986386903,-16.81724543849939,.1483359875383474,1.913880671464418,-.7960642926861912,35.2322109610459,80.01928065061526,-1424.0212633405113,13235.794061869668,1973.804052543835,337.9908651258184,
23.289159354463873,1.3934255946442087,-21.099669467133474,108.48348407242611,2583.700758091299,-12199.726194855148,-1874.2780658979746,-284.2467154529415,-18.11369784385905,.09849140335716425,1.961570560806461,-.998795456205172,32.56307803611191,36.958364584370486,-1706.075448829146,13043.287458812016,1965.3831106103316,326.43182772364605,22.175018750622293,1.198638339011324,-25.371248002043963,57.53505923036915,2288.41886619975,-12522.674544337233,-1914.8400385312243,-299.26241273417224,-19.37805630698734,
.04912684976946725,1.990369453344394,.0178904535*aa.SQRT2/2.384E-6,.008938074*aa.SQRT2/2.384E-6,.0015673635*aa.SQRT2/2.384E-6,.001228571*aa.SQRT2/2.384E-6,4.856585E-4*aa.SQRT2/2.384E-6,1.09434E-4*aa.SQRT2/2.384E-6,5.0783E-5*aa.SQRT2/2.384E-6,6.914E-6*aa.SQRT2/2.384E-6,12804.797818791945,1945.5515939597317,313.4244966442953,20.801593959731544,1995.1556208053692,9.000838926174497,-29.20218120805369],n=[[2.382191739347913E-13,6.423305872147834E-13,9.400849094049688E-13,1.122435026096556E-12,1.183840321267481E-12,
1.122435026096556E-12,9.40084909404969E-13,6.423305872147839E-13,2.382191739347918E-13,5.456116108943412E-12,4.878985199565852E-12,4.240448995017367E-12,3.559909094758252E-12,2.858043359288075E-12,2.156177623817898E-12,1.475637723558783E-12,8.371015190102974E-13,2.599706096327376E-13,-5.456116108943412E-12,-4.878985199565852E-12,-4.240448995017367E-12,-3.559909094758252E-12,-2.858043359288076E-12,-2.156177623817898E-12,-1.475637723558783E-12,-8.371015190102975E-13,-2.599706096327376E-13,-2.382191739347923E-13,
-6.423305872147843E-13,-9.400849094049696E-13,-1.122435026096556E-12,-1.183840321267481E-12,-1.122435026096556E-12,-9.400849094049694E-13,-6.42330587214784E-13,-2.382191739347918E-13],[2.382191739347913E-13,6.423305872147834E-13,9.400849094049688E-13,1.122435026096556E-12,1.183840321267481E-12,1.122435026096556E-12,9.400849094049688E-13,6.423305872147841E-13,2.382191739347918E-13,5.456116108943413E-12,4.878985199565852E-12,4.240448995017367E-12,3.559909094758253E-12,2.858043359288075E-12,2.156177623817898E-12,
1.475637723558782E-12,8.371015190102975E-13,2.599706096327376E-13,-5.461314069809755E-12,-4.921085770524055E-12,-4.343405037091838E-12,-3.732668368707687E-12,-3.093523840190885E-12,-2.430835727329465E-12,-1.734679010007751E-12,-9.74825365660928E-13,-2.797435120168326E-13,0,0,0,0,0,0,-2.283748241799531E-13,-4.037858874020686E-13,-2.146547464825323E-13],[.1316524975873958,.414213562373095,.7673269879789602,1.091308501069271,1.303225372841206,1.56968557711749,1.920982126971166,2.414213562373094,3.171594802363212,
4.510708503662055,7.595754112725146,22.90376554843115,.984807753012208,.6427876096865394,.3420201433256688,.9396926207859084,-.1736481776669303,-.7660444431189779,.8660254037844387,.5,-.5144957554275265,-.4717319685649723,-.3133774542039019,-.1819131996109812,-.09457419252642064,-.04096558288530405,-.01419856857247115,-.003699974673760037,.8574929257125442,.8817419973177052,.9496286491027329,.9833145924917901,.9955178160675857,.9991605581781475,.999899195244447,.9999931550702802],[0,0,0,0,0,0,2.283748241799531E-13,
4.037858874020686E-13,2.146547464825323E-13,5.461314069809755E-12,4.921085770524055E-12,4.343405037091838E-12,3.732668368707687E-12,3.093523840190885E-12,2.430835727329466E-12,1.734679010007751E-12,9.74825365660928E-13,2.797435120168326E-13,-5.456116108943413E-12,-4.878985199565852E-12,-4.240448995017367E-12,-3.559909094758253E-12,-2.858043359288075E-12,-2.156177623817898E-12,-1.475637723558782E-12,-8.371015190102975E-13,-2.599706096327376E-13,-2.382191739347913E-13,-6.423305872147834E-13,-9.400849094049688E-13,
-1.122435026096556E-12,-1.183840321267481E-12,-1.122435026096556E-12,-9.400849094049688E-13,-6.423305872147841E-13,-2.382191739347918E-13]],w=n[c.SHORT_TYPE],E=n[c.SHORT_TYPE],B=n[c.SHORT_TYPE],G=n[c.SHORT_TYPE],f=[0,1,16,17,8,9,24,25,4,5,20,21,12,13,28,29,2,3,18,19,10,11,26,27,6,7,22,23,14,15,30,31];this.mdct_sub48=function(b,k,a){for(var m=286,v=0;v<b.channels_out;v++){for(var e=0;e<b.mode_gr;e++){for(var l,d=b.l3_side.tt[e][v],g=d.xr,q=0,D=b.sb_sample[v][1-e],p=0,r=0;9>r;r++)for(u(k,m,D[p]),u(k,
m+32,D[p+1]),p+=2,m+=64,l=1;32>l;l+=2)D[p-1][l]*=-1;for(l=0;32>l;l++,q+=18){D=d.block_type;p=b.sb_sample[v][e];var t=b.sb_sample[v][1-e];0!=d.mixed_block_flag&&2>l&&(D=0);if(1E-12>b.amp_filter[l])na.fill(g,q+0,q+18,0);else{if(1>b.amp_filter[l])for(r=0;18>r;r++)t[r][f[l]]*=b.amp_filter[l];if(D==c.SHORT_TYPE){for(r=-3;0>r;r++){var J=n[c.SHORT_TYPE][r+3];g[q+3*r+9]=p[9+r][f[l]]*J-p[8-r][f[l]];g[q+3*r+18]=p[14-r][f[l]]*J+p[15+r][f[l]];g[q+3*r+10]=p[15+r][f[l]]*J-p[14-r][f[l]];g[q+3*r+19]=t[2-r][f[l]]*
J+t[3+r][f[l]];g[q+3*r+11]=t[3+r][f[l]]*J-t[2-r][f[l]];g[q+3*r+20]=t[8-r][f[l]]*J+t[9+r][f[l]]}r=g;p=q;for(J=0;3>J;J++){var h=r[p+6]*n[c.SHORT_TYPE][0]-r[p+15];t=r[p+0]*n[c.SHORT_TYPE][2]-r[p+9];var x=h+t;var y=h-t;h=r[p+15]*n[c.SHORT_TYPE][0]+r[p+6];t=r[p+9]*n[c.SHORT_TYPE][2]+r[p+0];var A=h+t;var N=-h+t;t=2.069978111953089E-11*(r[p+3]*n[c.SHORT_TYPE][1]-r[p+12]);h=2.069978111953089E-11*(r[p+12]*n[c.SHORT_TYPE][1]+r[p+3]);r[p+0]=1.90752519173728E-11*x+t;r[p+15]=1.90752519173728E-11*-A+h;y*=1.6519652744032674E-11;
A=9.537625958686404E-12*A+h;r[p+3]=y-A;r[p+6]=y+A;x=9.537625958686404E-12*x-t;N*=1.6519652744032674E-11;r[p+9]=x+N;r[p+12]=x-N;p++}}else{J=K(18);for(r=-9;0>r;r++)x=n[D][r+27]*t[r+9][f[l]]+n[D][r+36]*t[8-r][f[l]],y=n[D][r+9]*p[r+9][f[l]]-n[D][r+18]*p[8-r][f[l]],J[r+9]=x-y*w[3+r+9],J[r+18]=x*w[3+r+9]+y;r=g;p=q;x=J;var H=x[17]-x[9];var O=x[15]-x[11];var F=x[14]-x[12];N=x[0]+x[8];A=x[1]+x[7];h=x[2]+x[6];y=x[3]+x[5];r[p+17]=N+h-y-(A-x[4]);J=(N+h-y)*E[19]+(A-x[4]);t=(H-O-F)*E[18];r[p+5]=t+J;r[p+6]=t-J;
var C=(x[16]-x[10])*E[18];A=A*E[19]+x[4];t=H*E[12]+C+O*E[13]+F*E[14];J=-N*E[16]+A-h*E[17]+y*E[15];r[p+1]=t+J;r[p+2]=t-J;t=H*E[13]-C-O*E[14]+F*E[12];J=-N*E[17]+A-h*E[15]+y*E[16];r[p+9]=t+J;r[p+10]=t-J;t=H*E[14]-C+O*E[12]-F*E[13];J=N*E[15]-A+h*E[16]-y*E[17];r[p+13]=t+J;r[p+14]=t-J;H=x[8]-x[0];O=x[6]-x[2];F=x[5]-x[3];N=x[17]+x[9];A=x[16]+x[10];h=x[15]+x[11];y=x[14]+x[12];r[p+0]=N+h+y+(A+x[13]);t=(N+h+y)*E[19]-(A+x[13]);J=(H-O+F)*E[18];r[p+11]=t+J;r[p+12]=t-J;C=(x[7]-x[1])*E[18];A=x[13]-A*E[19];t=N*E[15]-
A+h*E[16]+y*E[17];J=H*E[14]+C+O*E[12]+F*E[13];r[p+3]=t+J;r[p+4]=t-J;t=-N*E[17]+A-h*E[15]-y*E[16];J=H*E[13]+C-O*E[14]-F*E[12];r[p+7]=t+J;r[p+8]=t-J;t=-N*E[16]+A-h*E[17]-y*E[15];J=H*E[12]-C+O*E[13]-F*E[14];r[p+15]=t+J;r[p+16]=t-J}}if(D!=c.SHORT_TYPE&&0!=l)for(r=7;0<=r;--r)D=g[q+r]*B[20+r]+g[q+-1-r]*G[28+r],p=g[q+r]*G[28+r]-g[q+-1-r]*B[20+r],g[q+-1-r]=D,g[q+r]=p}}k=a;m=286;if(1==b.mode_gr)for(e=0;18>e;e++)T.arraycopy(b.sb_sample[v][1][e],0,b.sb_sample[v][0][e],0,32)}}}function Xa(){this.thm=new Xb;this.en=
new Xb}function c(){var u=c.FFTOFFSET,k=c.MPG_MD_MS_LR,n=null,w=this.psy=null,E=null,B=null;this.setModules=function(c,b,k,a){n=c;w=this.psy=b;E=a;B=k};var ha=new Fc;this.lame_encode_mp3_frame=function(f,b,v,a,m,z){var e=Ob([2,2]);e[0][0]=new Xa;e[0][1]=new Xa;e[1][0]=new Xa;e[1][1]=new Xa;var l=Ob([2,2]);l[0][0]=new Xa;l[0][1]=new Xa;l[1][0]=new Xa;l[1][1]=new Xa;var d=[null,null],g=f.internal_flags,q=ca([2,4]),D=[.5,.5],p=[[0,0],[0,0]],r=[[0,0],[0,0]];d[0]=b;d[1]=v;if(0==g.lame_encode_frame_init){b=
f.internal_flags;var t,J;if(0==b.lame_encode_frame_init){v=K(2014);var h=K(2014);b.lame_encode_frame_init=1;for(J=t=0;t<286+576*(1+b.mode_gr);++t)t<576*b.mode_gr?(v[t]=0,2==b.channels_out&&(h[t]=0)):(v[t]=d[0][J],2==b.channels_out&&(h[t]=d[1][J]),++J);for(J=0;J<b.mode_gr;J++)for(t=0;t<b.channels_out;t++)b.l3_side.tt[J][t].block_type=c.SHORT_TYPE;ha.mdct_sub48(b,v,h)}}g.padding=0;0>(g.slot_lag-=g.frac_SpF)&&(g.slot_lag+=f.out_samplerate,g.padding=1);if(0!=g.psymodel)for(h=[null,null],t=0,J=X(2),v=
0;v<g.mode_gr;v++){for(b=0;b<g.channels_out;b++)h[b]=d[b],t=576+576*v-c.FFTOFFSET;b=f.VBR==G.vbr_mtrh||f.VBR==G.vbr_mt?w.L3psycho_anal_vbr(f,h,t,v,e,l,p[v],r[v],q[v],J):w.L3psycho_anal_ns(f,h,t,v,e,l,p[v],r[v],q[v],J);if(0!=b)return-4;f.mode==la.JOINT_STEREO&&(D[v]=q[v][2]+q[v][3],0<D[v]&&(D[v]=q[v][3]/D[v]));for(b=0;b<g.channels_out;b++){var x=g.l3_side.tt[v][b];x.block_type=J[b];x.mixed_block_flag=0}}else for(v=0;v<g.mode_gr;v++)for(b=0;b<g.channels_out;b++)g.l3_side.tt[v][b].block_type=c.NORM_TYPE,
g.l3_side.tt[v][b].mixed_block_flag=0,r[v][b]=p[v][b]=700;0==g.ATH.useAdjust?g.ATH.adjust=1:(b=g.loudness_sq[0][0],q=g.loudness_sq[1][0],2==g.channels_out?(b+=g.loudness_sq[0][1],q+=g.loudness_sq[1][1]):(b+=b,q+=q),2==g.mode_gr&&(b=Math.max(b,q)),b=.5*b*g.ATH.aaSensitivityP,.03125<b?(1<=g.ATH.adjust?g.ATH.adjust=1:g.ATH.adjust<g.ATH.adjustLimit&&(g.ATH.adjust=g.ATH.adjustLimit),g.ATH.adjustLimit=1):(q=31.98*b+6.25E-4,g.ATH.adjust>=q?(g.ATH.adjust*=.075*q+.925,g.ATH.adjust<q&&(g.ATH.adjust=q)):g.ATH.adjustLimit>=
q?g.ATH.adjust=q:g.ATH.adjust<g.ATH.adjustLimit&&(g.ATH.adjust=g.ATH.adjustLimit),g.ATH.adjustLimit=q));ha.mdct_sub48(g,d[0],d[1]);g.mode_ext=c.MPG_MD_LR_LR;if(f.force_ms)g.mode_ext=c.MPG_MD_MS_LR;else if(f.mode==la.JOINT_STEREO){for(v=h=q=0;v<g.mode_gr;v++)for(b=0;b<g.channels_out;b++)q+=r[v][b],h+=p[v][b];q<=1*h&&(q=g.l3_side.tt[0],b=g.l3_side.tt[g.mode_gr-1],q[0].block_type==q[1].block_type&&b[0].block_type==b[1].block_type&&(g.mode_ext=c.MPG_MD_MS_LR))}g.mode_ext==k&&(e=l,p=r);if(f.analysis&&
null!=g.pinfo)for(v=0;v<g.mode_gr;v++)for(b=0;b<g.channels_out;b++)g.pinfo.ms_ratio[v]=g.ms_ratio[v],g.pinfo.ms_ener_ratio[v]=D[v],g.pinfo.blocktype[v][b]=g.l3_side.tt[v][b].block_type,g.pinfo.pe[v][b]=p[v][b],T.arraycopy(g.l3_side.tt[v][b].xr,0,g.pinfo.xr[v][b],0,576),g.mode_ext==k&&(g.pinfo.ers[v][b]=g.pinfo.ers[v][b+2],T.arraycopy(g.pinfo.energy[v][b+2],0,g.pinfo.energy[v][b],0,g.pinfo.energy[v][b].length));if(f.VBR==G.vbr_off||f.VBR==G.vbr_abr){for(l=0;18>l;l++)g.nsPsy.pefirbuf[l]=g.nsPsy.pefirbuf[l+
1];for(v=r=0;v<g.mode_gr;v++)for(b=0;b<g.channels_out;b++)r+=p[v][b];g.nsPsy.pefirbuf[18]=r;r=g.nsPsy.pefirbuf[9];for(l=0;9>l;l++)r+=(g.nsPsy.pefirbuf[l]+g.nsPsy.pefirbuf[18-l])*c.fircoef[l];r=3350*g.mode_gr*g.channels_out/r;for(v=0;v<g.mode_gr;v++)for(b=0;b<g.channels_out;b++)p[v][b]*=r}g.iteration_loop.iteration_loop(f,p,D,e);n.format_bitstream(f);a=n.copy_buffer(g,a,m,z,1);f.bWriteVbrTag&&E.addVbrFrame(f);if(f.analysis&&null!=g.pinfo){for(b=0;b<g.channels_out;b++){for(m=0;m<u;m++)g.pinfo.pcmdata[b][m]=
g.pinfo.pcmdata[b][m+f.framesize];for(m=u;1600>m;m++)g.pinfo.pcmdata[b][m]=d[b][m-u]}B.set_frame_pinfo(f,e)}g.bitrate_stereoMode_Hist[g.bitrate_index][4]++;g.bitrate_stereoMode_Hist[15][4]++;2==g.channels_out&&(g.bitrate_stereoMode_Hist[g.bitrate_index][g.mode_ext]++,g.bitrate_stereoMode_Hist[15][g.mode_ext]++);for(f=0;f<g.mode_gr;++f)for(d=0;d<g.channels_out;++d)m=g.l3_side.tt[f][d].block_type|0,0!=g.l3_side.tt[f][d].mixed_block_flag&&(m=4),g.bitrate_blockType_Hist[g.bitrate_index][m]++,g.bitrate_blockType_Hist[g.bitrate_index][5]++,
g.bitrate_blockType_Hist[15][m]++,g.bitrate_blockType_Hist[15][5]++;return a}}function Gc(){this.size=this.pos=this.want=this.seen=this.sum=0;this.bag=null;this.TotalFrameSize=this.nBytesWritten=this.nVbrNumFrames=0}function Hc(){this.tt=[[null,null],[null,null]];this.resvDrain_post=this.resvDrain_pre=this.private_bits=this.main_data_begin=0;this.scfsi=[X(4),X(4)];for(var c=0;2>c;c++)for(var k=0;2>k;k++)this.tt[c][k]=new rb}function Ic(){this.last_en_subshort=ca([4,9]);this.lastAttacks=X(4);this.pefirbuf=
K(19);this.longfact=K(c.SBMAX_l);this.shortfact=K(c.SBMAX_s);this.attackthre_s=this.attackthre=0}function Xb(){this.l=K(c.SBMAX_l);this.s=ca([c.SBMAX_s,3]);var u=this;this.assign=function(k){T.arraycopy(k.l,0,u.l,0,c.SBMAX_l);for(var n=0;n<c.SBMAX_s;n++)for(var w=0;3>w;w++)u.s[n][w]=k.s[n][w]}}function da(){function u(){this.ptr=this.write_timing=0;this.buf=new Int8Array(40)}this.fill_buffer_resample_init=this.iteration_init_init=this.lame_encode_frame_init=this.Class_ID=0;this.mfbuf=ca([2,da.MFSIZE]);
this.full_outer_loop=this.use_best_huffman=this.subblock_gain=this.noise_shaping_stop=this.psymodel=this.substep_shaping=this.noise_shaping_amp=this.noise_shaping=this.highpass2=this.highpass1=this.lowpass2=this.lowpass1=this.mode_ext=this.samplerate_index=this.bitrate_index=this.VBR_max_bitrate=this.VBR_min_bitrate=this.mf_size=this.mf_samples_to_encode=this.resample_ratio=this.channels_out=this.channels_in=this.mode_gr=0;this.l3_side=new Hc;this.ms_ratio=K(2);this.slot_lag=this.frac_SpF=this.padding=
0;this.tag_spec=null;this.nMusicCRC=0;this.OldValue=X(2);this.CurrentStep=X(2);this.masking_lower=0;this.bv_scf=X(576);this.pseudohalf=X(sa.SFBMAX);this.sfb21_extra=!1;this.inbuf_old=Array(2);this.blackfilt=Array(2*da.BPC+1);this.itime=new Float64Array(2);this.sideinfo_len=0;this.sb_sample=ca([2,2,18,c.SBLIMIT]);this.amp_filter=K(32);this.header=Array(da.MAX_HEADER_BUF);this.ResvMax=this.ResvSize=this.ancillary_flag=this.w_ptr=this.h_ptr=0;this.scalefac_band=new za;this.minval_l=K(c.CBANDS);this.minval_s=
K(c.CBANDS);this.nb_1=ca([4,c.CBANDS]);this.nb_2=ca([4,c.CBANDS]);this.nb_s1=ca([4,c.CBANDS]);this.nb_s2=ca([4,c.CBANDS]);this.s3_ll=this.s3_ss=null;this.decay=0;this.thm=Array(4);this.en=Array(4);this.tot_ener=K(4);this.loudness_sq=ca([2,2]);this.loudness_sq_save=K(2);this.mld_l=K(c.SBMAX_l);this.mld_s=K(c.SBMAX_s);this.bm_l=X(c.SBMAX_l);this.bo_l=X(c.SBMAX_l);this.bm_s=X(c.SBMAX_s);this.bo_s=X(c.SBMAX_s);this.npart_s=this.npart_l=0;this.s3ind=Ia([c.CBANDS,2]);this.s3ind_s=Ia([c.CBANDS,2]);this.numlines_s=
X(c.CBANDS);this.numlines_l=X(c.CBANDS);this.rnumlines_l=K(c.CBANDS);this.mld_cb_l=K(c.CBANDS);this.mld_cb_s=K(c.CBANDS);this.numlines_l_num1=this.numlines_s_num1=0;this.pe=K(4);this.ms_ener_ratio_old=this.ms_ratio_l_old=this.ms_ratio_s_old=0;this.blocktype_old=X(2);this.nsPsy=new Ic;this.VBR_seek_table=new Gc;this.PSY=this.ATH=null;this.nogap_current=this.nogap_total=0;this.findPeakSample=this.findReplayGain=this.decode_on_the_fly=!0;this.AudiophileGain=this.RadioGain=this.PeakSample=0;this.rgdata=
null;this.noclipScale=this.noclipGainChange=0;this.bitrate_stereoMode_Hist=Ia([16,5]);this.bitrate_blockType_Hist=Ia([16,6]);this.hip=this.pinfo=null;this.in_buffer_nsamples=0;this.iteration_loop=this.in_buffer_1=this.in_buffer_0=null;for(var k=0;k<this.en.length;k++)this.en[k]=new Xb;for(k=0;k<this.thm.length;k++)this.thm[k]=new Xb;for(k=0;k<this.header.length;k++)this.header[k]=new u}function Jc(){function u(c,k,f){var b=0;f<<=1;var n=k+f;var a=4;do{var m;var u=a>>1;var e=a;var l=a<<1;var d=l+e;
a=l<<1;var g=k;var q=g+u;do{var B=c[g+0]-c[g+e];var p=c[g+0]+c[g+e];var r=c[g+l]-c[g+d];var t=c[g+l]+c[g+d];c[g+l]=p-t;c[g+0]=p+t;c[g+d]=B-r;c[g+e]=B+r;B=c[q+0]-c[q+e];p=c[q+0]+c[q+e];r=aa.SQRT2*c[q+d];t=aa.SQRT2*c[q+l];c[q+l]=p-t;c[q+0]=p+t;c[q+d]=B-r;c[q+e]=B+r;q+=a;g+=a}while(g<n);var E=w[b+0];var h=w[b+1];for(m=1;m<u;m++){var x=1-2*h*h;var y=2*h*E;g=k+m;q=k+e-m;do{var A=y*c[g+e]-x*c[q+e];t=x*c[g+e]+y*c[q+e];B=c[g+0]-t;p=c[g+0]+t;var K=c[q+0]-A;var H=c[q+0]+A;A=y*c[g+d]-x*c[q+d];t=x*c[g+d]+y*c[q+
d];r=c[g+l]-t;t=c[g+l]+t;var O=c[q+l]-A;var F=c[q+l]+A;A=h*t-E*O;t=E*t+h*O;c[g+l]=p-t;c[g+0]=p+t;c[q+d]=K-A;c[q+e]=K+A;A=E*F-h*r;t=h*F+E*r;c[q+l]=H-t;c[q+0]=H+t;c[g+d]=B-A;c[g+e]=B+A;q+=a;g+=a}while(g<n);x=E;E=x*w[b+0]-h*w[b+1];h=x*w[b+1]+h*w[b+0]}b+=2}while(a<f)}var k=K(c.BLKSIZE),n=K(c.BLKSIZE_s/2),w=[.9238795325112867,.3826834323650898,.9951847266721969,.0980171403295606,.9996988186962042,.02454122852291229,.9999811752826011,.006135884649154475],E=[0,128,64,192,32,160,96,224,16,144,80,208,48,176,
112,240,8,136,72,200,40,168,104,232,24,152,88,216,56,184,120,248,4,132,68,196,36,164,100,228,20,148,84,212,52,180,116,244,12,140,76,204,44,172,108,236,28,156,92,220,60,188,124,252,2,130,66,194,34,162,98,226,18,146,82,210,50,178,114,242,10,138,74,202,42,170,106,234,26,154,90,218,58,186,122,250,6,134,70,198,38,166,102,230,22,150,86,214,54,182,118,246,14,142,78,206,46,174,110,238,30,158,94,222,62,190,126,254];this.fft_short=function(k,w,f,b,v){for(k=0;3>k;k++){var a=c.BLKSIZE_s/2,m=65535&192*(k+1),B=
c.BLKSIZE_s/8-1;do{var e=E[B<<2]&255;var l=n[e]*b[f][v+e+m];var d=n[127-e]*b[f][v+e+m+128];var g=l-d;l+=d;var q=n[e+64]*b[f][v+e+m+64];d=n[63-e]*b[f][v+e+m+192];var D=q-d;q+=d;a-=4;w[k][a+0]=l+q;w[k][a+2]=l-q;w[k][a+1]=g+D;w[k][a+3]=g-D;l=n[e+1]*b[f][v+e+m+1];d=n[126-e]*b[f][v+e+m+129];g=l-d;l+=d;q=n[e+65]*b[f][v+e+m+65];d=n[62-e]*b[f][v+e+m+193];D=q-d;q+=d;w[k][a+c.BLKSIZE_s/2+0]=l+q;w[k][a+c.BLKSIZE_s/2+2]=l-q;w[k][a+c.BLKSIZE_s/2+1]=g+D;w[k][a+c.BLKSIZE_s/2+3]=g-D}while(0<=--B);u(w[k],a,c.BLKSIZE_s/
2)}};this.fft_long=function(n,w,f,b,v){n=c.BLKSIZE/8-1;var a=c.BLKSIZE/2;do{var m=E[n]&255;var B=k[m]*b[f][v+m];var e=k[m+512]*b[f][v+m+512];var l=B-e;B+=e;var d=k[m+256]*b[f][v+m+256];e=k[m+768]*b[f][v+m+768];var g=d-e;d+=e;a-=4;w[a+0]=B+d;w[a+2]=B-d;w[a+1]=l+g;w[a+3]=l-g;B=k[m+1]*b[f][v+m+1];e=k[m+513]*b[f][v+m+513];l=B-e;B+=e;d=k[m+257]*b[f][v+m+257];e=k[m+769]*b[f][v+m+769];g=d-e;d+=e;w[a+c.BLKSIZE/2+0]=B+d;w[a+c.BLKSIZE/2+2]=B-d;w[a+c.BLKSIZE/2+1]=l+g;w[a+c.BLKSIZE/2+3]=l-g}while(0<=--n);u(w,
a,c.BLKSIZE/2)};this.init_fft=function(u){for(u=0;u<c.BLKSIZE;u++)k[u]=.42-.5*Math.cos(2*Math.PI*(u+.5)/c.BLKSIZE)+.08*Math.cos(4*Math.PI*(u+.5)/c.BLKSIZE);for(u=0;u<c.BLKSIZE_s/2;u++)n[u]=.5*(1-Math.cos(2*Math.PI*(u+.5)/c.BLKSIZE_s))}}function Pb(){function u(a,d){for(var b=0,h=0;h<c.BLKSIZE/2;++h)b+=a[h]*d.ATH.eql_w[h];return b*=D}function k(a,c,d,b,f,e){if(c>a)if(c<a*r)var g=c/a;else return a+c;else{if(a>=c*r)return a+c;g=a/c}a+=c;if(6>=b+3){if(g>=p)return a;b=0|aa.FAST_LOG10_X(g,16);return a*
x[b]}b=0|aa.FAST_LOG10_X(g,16);c=0!=e?f.ATH.cb_s[d]*f.ATH.adjust:f.ATH.cb_l[d]*f.ATH.adjust;return a<t*c?a>c?(d=1,13>=b&&(d=y[b]),c=aa.FAST_LOG10_X(a/c,10/15),a*((h[b]-d)*c+d)):13<b?a:a*y[b]:a*h[b]}function n(a,c,d){0>a&&(a=0);0>c&&(c=0);if(0>=a)return c;if(0>=c)return a;var b=c>a?c/a:a/c;if(-2<=d&&2>=d){if(b>=p)return a+c;d=0|aa.FAST_LOG10_X(b,16);return(a+c)*A[d]}if(b<r)return a+c;a<c&&(a=c);return a}function w(a,d,b,h,f){var e,g,l=0,k=0;for(e=g=0;e<c.SBMAX_s;++g,++e){var m=a.bo_s[e],y=a.npart_s;
for(m=m<y?m:y;g<m;)l+=d[g],k+=b[g],g++;a.en[h].s[e][f]=l;a.thm[h].s[e][f]=k;if(g>=y){++e;break}k=a.PSY.bo_s_weight[e];y=1-k;l=k*d[g];k*=b[g];a.en[h].s[e][f]+=l;a.thm[h].s[e][f]+=k;l=y*d[g];k=y*b[g]}for(;e<c.SBMAX_s;++e)a.en[h].s[e][f]=0,a.thm[h].s[e][f]=0}function E(a,d,b,h){var f,e,g=0,l=0;for(f=e=0;f<c.SBMAX_l;++e,++f){var k=a.bo_l[f],m=a.npart_l;for(k=k<m?k:m;e<k;)g+=d[e],l+=b[e],e++;a.en[h].l[f]=g;a.thm[h].l[f]=l;if(e>=m){++f;break}l=a.PSY.bo_l_weight[f];m=1-l;g=l*d[e];l*=b[e];a.en[h].l[f]+=g;
a.thm[h].l[f]+=l;g=m*d[e];l=m*b[e]}for(;f<c.SBMAX_l;++f)a.en[h].l[f]=0,a.thm[h].l[f]=0}function B(a,c,d){return 1<=d?a:0>=d?c:0<c?Math.pow(a/c,d)*c:0}function W(a,d){for(var b=309.07,h=0;h<c.SBMAX_s-1;h++)for(var f=0;3>f;f++){var e=a.thm.s[h][f];if(0<e){e*=d;var g=a.en.s[h][f];g>e&&(b=g>1E10*e?b+23.02585092994046*N[h]:b+N[h]*aa.FAST_LOG10(g/e))}}return b}function f(a,d){for(var b=281.0575,h=0;h<c.SBMAX_l-1;h++){var f=a.thm.l[h];if(0<f){f*=d;var e=a.en.l[h];e>f&&(b=e>1E10*f?b+23.02585092994046*H[h]:
b+H[h]*aa.FAST_LOG10(e/f))}}return b}function b(a,c,b,d,h){var f,e;for(f=e=0;f<a.npart_l;++f){var g=0,l=0,k;for(k=0;k<a.numlines_l[f];++k,++e){var m=c[e];g+=m;l<m&&(l=m)}b[f]=g;d[f]=l;h[f]=g*a.rnumlines_l[f]}}function v(a,c,b,d){var h=J.length-1,f=0,e=b[f]+b[f+1];if(0<e){var g=c[f];g<c[f+1]&&(g=c[f+1]);e=20*(2*g-e)/(e*(a.numlines_l[f]+a.numlines_l[f+1]-1));e|=0;e>h&&(e=h);d[f]=e}else d[f]=0;for(f=1;f<a.npart_l-1;f++)e=b[f-1]+b[f]+b[f+1],0<e?(g=c[f-1],g<c[f]&&(g=c[f]),g<c[f+1]&&(g=c[f+1]),e=20*(3*
g-e)/(e*(a.numlines_l[f-1]+a.numlines_l[f]+a.numlines_l[f+1]-1)),e|=0,e>h&&(e=h),d[f]=e):d[f]=0;e=b[f-1]+b[f];0<e?(g=c[f-1],g<c[f]&&(g=c[f]),e=20*(2*g-e)/(e*(a.numlines_l[f-1]+a.numlines_l[f]-1)),e|=0,e>h&&(e=h),d[f]=e):d[f]=0}function a(a,c,b,d,f,h,e){var g=2*h;f=0<h?Math.pow(10,f):1;for(var l,k,m=0;m<e;++m){var y=a[2][m],p=a[3][m],q=c[0][m],n=c[1][m],x=c[2][m],r=c[3][m];q<=1.58*n&&n<=1.58*q?(l=b[m]*y,k=Math.max(x,Math.min(r,b[m]*p)),l=Math.max(r,Math.min(x,l))):(k=x,l=r);0<h&&(r=d[m]*f,q=Math.min(Math.max(q,
r),Math.max(n,r)),x=Math.max(k,r),r=Math.max(l,r),n=x+r,0<n&&q*g<n&&(q=q*g/n,x*=q,r*=q),k=Math.min(x,k),l=Math.min(r,l));k>y&&(k=y);l>p&&(l=p);c[2][m]=k;c[3][m]=l}}function m(a,c){a=0<=a?27*-a:a*c;return-72>=a?0:Math.exp(.2302585093*a)}function z(a){0>a&&(a=0);a*=.001;return 13*Math.atan(.76*a)+3.5*Math.atan(a*a/56.25)}function e(a,b,d,f,h,e,g,l,k,m,y,p){var q=K(c.CBANDS+1),n=l/(15<p?1152:384),x=X(c.HBLKSIZE),r;l/=k;var u=0,C=0;for(r=0;r<c.CBANDS;r++){var t;var A=z(l*u);q[r]=l*u;for(t=u;.34>z(l*t)-
A&&t<=k/2;t++);a[r]=t-u;for(C=r+1;u<t;)x[u++]=r;if(u>k/2){u=k/2;++r;break}}q[r]=l*u;for(u=0;u<p;u++)r=m[u],A=m[u+1],r=0|Math.floor(.5+y*(r-.5)),0>r&&(r=0),t=0|Math.floor(.5+y*(A-.5)),t>k/2&&(t=k/2),d[u]=(x[r]+x[t])/2,b[u]=x[t],g[u]=(n*A-q[b[u]])/(q[b[u]+1]-q[b[u]]),0>g[u]?g[u]=0:1<g[u]&&(g[u]=1),A=z(l*m[u]*y),A=Math.min(A,15.5)/15.5,e[u]=Math.pow(10,1.25*(1-Math.cos(Math.PI*A))-2.5);for(b=u=0;b<C;b++)d=a[b],A=z(l*u),e=z(l*(u+d-1)),f[b]=.5*(A+e),A=z(l*(u-.5)),e=z(l*(u+d-.5)),h[b]=e-A,u+=d;return C}
function l(a,b,d,f,h,e){var g=ca([c.CBANDS,c.CBANDS]),l=0;if(e)for(var k=0;k<b;k++)for(e=0;e<b;e++){var y=d[k]-d[e];y=0<=y?3*y:1.5*y;if(.5<=y&&2.5>=y){var p=y-.5;p=8*(p*p-2*p)}else p=0;y+=.474;y=15.811389+7.5*y-17.5*Math.sqrt(1+y*y);-60>=y?p=0:(y=Math.exp(.2302585093*(p+y)),p=y/.6609193);y=p*f[e];g[k][e]=y*h[k]}else for(e=0;e<b;e++){p=15+Math.min(21/d[e],12);var q;var n;k=p;for(q=0;1E-20<m(q,k);--q);var x=q;for(n=0;1E-12<Math.abs(n-x);)q=(n+x)/2,0<m(q,k)?n=q:x=q;y=x;for(q=0;1E-20<m(q,k);q+=1);x=0;
for(n=q;1E-12<Math.abs(n-x);)q=(n+x)/2,0<m(q,k)?x=q:n=q;x=n;var r=0;for(n=0;1E3>=n;++n)q=y+n*(x-y)/1E3,q=m(q,k),r+=q;q=1001/(r*(x-y));for(k=0;k<b;k++)y=q*m(d[k]-d[e],p)*f[e],g[k][e]=y*h[k]}for(k=0;k<b;k++){for(e=0;e<b&&!(0<g[k][e]);e++);a[k][0]=e;for(e=b-1;0<e&&!(0<g[k][e]);e--);a[k][1]=e;l+=a[k][1]-a[k][0]+1}d=K(l);for(k=f=0;k<b;k++)for(e=a[k][0];e<=a[k][1];e++)d[f++]=g[k][e];return d}function d(a){a=z(a);a=Math.min(a,15.5)/15.5;return Math.pow(10,1.25*(1-Math.cos(Math.PI*a))-2.5)}function g(a,c){-.3>
a&&(a=3410);a=Math.max(.1,a/1E3);return 3.64*Math.pow(a,-.8)-6.8*Math.exp(-.6*Math.pow(a-3.4,2))+6*Math.exp(-.15*Math.pow(a-8.7,2))+.001*(.6+.04*c)*Math.pow(a,4)}var q=new Jc,D=1/217621504/(c.BLKSIZE/2),p,r,t,J=[1,.79433,.63096,.63096,.63096,.63096,.63096,.25119,.11749],h=[3.3246*3.3246,3.23837*3.23837,9.9500500969,9.0247369744,8.1854926609,7.0440875649,2.46209*2.46209,2.284*2.284,4.4892710641,1.96552*1.96552,1.82335*1.82335,1.69146*1.69146,2.4621061921,2.1508568964,1.37074*1.37074,1.31036*1.31036,
1.5691069696,1.4555939904,1.16203*1.16203,1.2715945225,1.09428*1.09428,1.0659*1.0659,1.0779838276,1.0382591025,1],x=[1.7782755904,1.35879*1.35879,1.38454*1.38454,1.39497*1.39497,1.40548*1.40548,1.3537*1.3537,1.6999465924,1.22321*1.22321,1.3169398564,1],y=[5.5396212496,2.29259*2.29259,4.9868695969,2.12675*2.12675,2.02545*2.02545,1.87894*1.87894,1.74303*1.74303,1.61695*1.61695,2.2499700001,1.39148*1.39148,1.29083*1.29083,1.19746*1.19746,1.2339655056,1.0779838276],A=[1.7782755904,1.35879*1.35879,1.38454*
1.38454,1.39497*1.39497,1.40548*1.40548,1.3537*1.3537,1.6999465924,1.22321*1.22321,1.3169398564,1],N=[11.8,13.6,17.2,32,46.5,51.3,57.5,67.1,71.5,84.6,97.6,130],H=[6.8,5.8,5.8,6.4,6.5,9.9,12.1,14.4,15,18.9,21.6,26.9,34.2,40.2,46.8,56.5,60.7,73.9,85.7,93.4,126.1],O=[-1.730326E-17,-.01703172,-1.349528E-17,.0418072,-6.73278E-17,-.0876324,-3.0835E-17,.1863476,-1.104424E-16,-.627638];this.L3psycho_anal_ns=function(a,d,h,e,g,l,m,y,p,n){var x=a.internal_flags,r=ca([2,c.BLKSIZE]),t=ca([2,3,c.BLKSIZE_s]),A=
K(c.CBANDS+1),I=K(c.CBANDS+1),C=K(c.CBANDS+2),Q=X(2),S=X(2),z,D,F,H,N,Z,L,V=ca([2,576]),ma=X(c.CBANDS+2),R=X(c.CBANDS+2);na.fill(R,0);var T=x.channels_out;a.mode==la.JOINT_STEREO&&(T=4);var M=a.VBR==G.vbr_off?0==x.ResvMax?0:x.ResvSize/x.ResvMax*.5:a.VBR==G.vbr_rh||a.VBR==G.vbr_mtrh||a.VBR==G.vbr_mt?.6:1;for(z=0;z<x.channels_out;z++){var Y=d[z],ha=h+576-350-21+192;for(F=0;576>F;F++){var U;var da=Y[ha+F+10];for(H=U=0;9>H;H+=2)da+=O[H]*(Y[ha+F+H]+Y[ha+F+21-H]),U+=O[H+1]*(Y[ha+F+H+1]+Y[ha+F+21-H-1]);
V[z][F]=da+U}g[e][z].en.assign(x.en[z]);g[e][z].thm.assign(x.thm[z]);2<T&&(l[e][z].en.assign(x.en[z+2]),l[e][z].thm.assign(x.thm[z+2]))}for(z=0;z<T;z++){var Qa=K(12),ya=[0,0,0,0],qa=K(12),ia=1,sa=K(c.CBANDS),Fa=K(c.CBANDS),ta=[0,0,0,0],za=K(c.HBLKSIZE),Wb=ca([3,c.HBLKSIZE_s]);for(F=0;3>F;F++)Qa[F]=x.nsPsy.last_en_subshort[z][F+6],qa[F]=Qa[F]/x.nsPsy.last_en_subshort[z][F+4],ya[0]+=Qa[F];if(2==z)for(F=0;576>F;F++){var Ya=V[0][F];var Xa=V[1][F];V[0][F]=Ya+Xa;V[1][F]=Ya-Xa}var Ia=V[z&1],ec=0;for(F=0;9>
F;F++){for(var xa=ec+64,Ga=1;ec<xa;ec++)Ga<Math.abs(Ia[ec])&&(Ga=Math.abs(Ia[ec]));x.nsPsy.last_en_subshort[z][F]=Qa[F+3]=Ga;ya[1+F/3]+=Ga;Ga=Ga>Qa[F+3-2]?Ga/Qa[F+3-2]:Qa[F+3-2]>10*Ga?Qa[F+3-2]/(10*Ga):0;qa[F+3]=Ga}if(a.analysis){var Qb=qa[0];for(F=1;12>F;F++)Qb<qa[F]&&(Qb=qa[F]);x.pinfo.ers[e][z]=x.pinfo.ers_save[z];x.pinfo.ers_save[z]=Qb}var Ma=3==z?x.nsPsy.attackthre_s:x.nsPsy.attackthre;for(F=0;12>F;F++)0==ta[F/3]&&qa[F]>Ma&&(ta[F/3]=F%3+1);for(F=1;4>F;F++)1.7>(ya[F-1]>ya[F]?ya[F-1]/ya[F]:ya[F]/
ya[F-1])&&(ta[F]=0,1==F&&(ta[0]=0));0!=ta[0]&&0!=x.nsPsy.lastAttacks[z]&&(ta[0]=0);if(3==x.nsPsy.lastAttacks[z]||0!=ta[0]+ta[1]+ta[2]+ta[3])ia=0,0!=ta[1]&&0!=ta[0]&&(ta[1]=0),0!=ta[2]&&0!=ta[1]&&(ta[2]=0),0!=ta[3]&&0!=ta[2]&&(ta[3]=0);2>z?S[z]=ia:0==ia&&(S[0]=S[1]=0);p[z]=x.tot_ener[z];var P=a,Ha=za,Gb=Wb,La=r,kb=z&1,Ra=t,Na=z&1,cb=e,Aa=z,va=d,qb=h,Va=P.internal_flags;if(2>Aa)q.fft_long(Va,La[kb],Aa,va,qb),q.fft_short(Va,Ra[Na],Aa,va,qb);else if(2==Aa){for(var ja=c.BLKSIZE-1;0<=ja;--ja){var Hb=La[kb+
0][ja],Ib=La[kb+1][ja];La[kb+0][ja]=(Hb+Ib)*aa.SQRT2*.5;La[kb+1][ja]=(Hb-Ib)*aa.SQRT2*.5}for(var Ba=2;0<=Ba;--Ba)for(ja=c.BLKSIZE_s-1;0<=ja;--ja)Hb=Ra[Na+0][Ba][ja],Ib=Ra[Na+1][Ba][ja],Ra[Na+0][Ba][ja]=(Hb+Ib)*aa.SQRT2*.5,Ra[Na+1][Ba][ja]=(Hb-Ib)*aa.SQRT2*.5}Ha[0]=La[kb+0][0];Ha[0]*=Ha[0];for(ja=c.BLKSIZE/2-1;0<=ja;--ja){var fc=La[kb+0][c.BLKSIZE/2-ja],tb=La[kb+0][c.BLKSIZE/2+ja];Ha[c.BLKSIZE/2-ja]=.5*(fc*fc+tb*tb)}for(Ba=2;0<=Ba;--Ba)for(Gb[Ba][0]=Ra[Na+0][Ba][0],Gb[Ba][0]*=Gb[Ba][0],ja=c.BLKSIZE_s/
2-1;0<=ja;--ja)fc=Ra[Na+0][Ba][c.BLKSIZE_s/2-ja],tb=Ra[Na+0][Ba][c.BLKSIZE_s/2+ja],Gb[Ba][c.BLKSIZE_s/2-ja]=.5*(fc*fc+tb*tb);var oa=0;for(ja=11;ja<c.HBLKSIZE;ja++)oa+=Ha[ja];Va.tot_ener[Aa]=oa;if(P.analysis){for(ja=0;ja<c.HBLKSIZE;ja++)Va.pinfo.energy[cb][Aa][ja]=Va.pinfo.energy_save[Aa][ja],Va.pinfo.energy_save[Aa][ja]=Ha[ja];Va.pinfo.pe[cb][Aa]=Va.pe[Aa]}2==P.athaa_loudapprox&&2>Aa&&(Va.loudness_sq[cb][Aa]=Va.loudness_sq_save[Aa],Va.loudness_sq_save[Aa]=u(Ha,Va));b(x,za,A,sa,Fa);v(x,sa,Fa,ma);for(L=
0;3>L;L++){var ea=void 0,Ab=void 0,Bb=Wb,Sa=I,Za=C,ub=z,zb=L,Ja=a.internal_flags;for(ea=Ab=0;ea<Ja.npart_s;++ea){for(var Rb=0,rb=0,db=Ja.numlines_s[ea],sb=0;sb<db;++sb,++Ab){var Cb=Bb[zb][Ab];Rb+=Cb;rb<Cb&&(rb=Cb)}Sa[ea]=Rb}for(Ab=ea=0;ea<Ja.npart_s;ea++){var Db=Ja.s3ind_s[ea][0],$a=Ja.s3_ss[Ab++]*Sa[Db];for(++Db;Db<=Ja.s3ind_s[ea][1];)$a+=Ja.s3_ss[Ab]*Sa[Db],++Ab,++Db;var vb=2*Ja.nb_s1[ub][ea];Za[ea]=Math.min($a,vb);Ja.blocktype_old[ub&1]==c.SHORT_TYPE&&(vb=16*Ja.nb_s2[ub][ea],Za[ea]=Math.min(vb,
Za[ea]));Ja.nb_s2[ub][ea]=Ja.nb_s1[ub][ea];Ja.nb_s1[ub][ea]=$a}for(;ea<=c.CBANDS;++ea)Sa[ea]=0,Za[ea]=0;w(x,I,C,z,L);for(Z=0;Z<c.SBMAX_s;Z++){var Ta=x.thm[z].s[Z][L];Ta*=.8;if(2<=ta[L]||1==ta[L+1]){var wb=0!=L?L-1:2;Ga=B(x.thm[z].s[Z][wb],Ta,.6*M);Ta=Math.min(Ta,Ga)}if(1==ta[L])wb=0!=L?L-1:2,Ga=B(x.thm[z].s[Z][wb],Ta,.3*M),Ta=Math.min(Ta,Ga);else if(0!=L&&3==ta[L-1]||0==L&&3==x.nsPsy.lastAttacks[z])wb=2!=L?L+1:0,Ga=B(x.thm[z].s[Z][wb],Ta,.3*M),Ta=Math.min(Ta,Ga);var Yb=Qa[3*L+3]+Qa[3*L+4]+Qa[3*L+
5];6*Qa[3*L+5]<Yb&&(Ta*=.5,6*Qa[3*L+4]<Yb&&(Ta*=.5));x.thm[z].s[Z][L]=Ta}}x.nsPsy.lastAttacks[z]=ta[2];for(D=N=0;D<x.npart_l;D++){for(var eb=x.s3ind[D][0],Jb=A[eb]*J[ma[eb]],lb=x.s3_ll[N++]*Jb;++eb<=x.s3ind[D][1];)Jb=A[eb]*J[ma[eb]],lb=k(lb,x.s3_ll[N++]*Jb,eb,eb-D,x,0);lb*=.158489319246111;C[D]=x.blocktype_old[z&1]==c.SHORT_TYPE?lb:B(Math.min(lb,Math.min(2*x.nb_1[z][D],16*x.nb_2[z][D])),lb,M);x.nb_2[z][D]=x.nb_1[z][D];x.nb_1[z][D]=lb}for(;D<=c.CBANDS;++D)A[D]=0,C[D]=0;E(x,A,C,z)}if((a.mode==la.STEREO||
a.mode==la.JOINT_STEREO)&&0<a.interChRatio){var xb=a.interChRatio,fa=a.internal_flags;if(1<fa.channels_out){for(var Ca=0;Ca<c.SBMAX_l;Ca++){var Sb=fa.thm[0].l[Ca],Eb=fa.thm[1].l[Ca];fa.thm[0].l[Ca]+=Eb*xb;fa.thm[1].l[Ca]+=Sb*xb}for(Ca=0;Ca<c.SBMAX_s;Ca++)for(var fb=0;3>fb;fb++)Sb=fa.thm[0].s[Ca][fb],Eb=fa.thm[1].s[Ca][fb],fa.thm[0].s[Ca][fb]+=Eb*xb,fa.thm[1].s[Ca][fb]+=Sb*xb}}if(a.mode==la.JOINT_STEREO){for(var Oa,ka=0;ka<c.SBMAX_l;ka++)if(!(x.thm[0].l[ka]>1.58*x.thm[1].l[ka]||x.thm[1].l[ka]>1.58*
x.thm[0].l[ka])){var Ua=x.mld_l[ka]*x.en[3].l[ka],gb=Math.max(x.thm[2].l[ka],Math.min(x.thm[3].l[ka],Ua));Ua=x.mld_l[ka]*x.en[2].l[ka];var gc=Math.max(x.thm[3].l[ka],Math.min(x.thm[2].l[ka],Ua));x.thm[2].l[ka]=gb;x.thm[3].l[ka]=gc}for(ka=0;ka<c.SBMAX_s;ka++)for(var ua=0;3>ua;ua++)x.thm[0].s[ka][ua]>1.58*x.thm[1].s[ka][ua]||x.thm[1].s[ka][ua]>1.58*x.thm[0].s[ka][ua]||(Ua=x.mld_s[ka]*x.en[3].s[ka][ua],gb=Math.max(x.thm[2].s[ka][ua],Math.min(x.thm[3].s[ka][ua],Ua)),Ua=x.mld_s[ka]*x.en[2].s[ka][ua],gc=
Math.max(x.thm[3].s[ka][ua],Math.min(x.thm[2].s[ka][ua],Ua)),x.thm[2].s[ka][ua]=gb,x.thm[3].s[ka][ua]=gc);Oa=a.msfix;if(0<Math.abs(Oa)){var Kb=Oa,hc=Kb,Zb=Math.pow(10,a.ATHlower*x.ATH.adjust);Kb*=2;hc*=2;for(var wa=0;wa<c.SBMAX_l;wa++){var ba=x.ATH.cb_l[x.bm_l[wa]]*Zb;var Wa=Math.min(Math.max(x.thm[0].l[wa],ba),Math.max(x.thm[1].l[wa],ba));var ab=Math.max(x.thm[2].l[wa],ba);var mb=Math.max(x.thm[3].l[wa],ba);if(Wa*Kb<ab+mb){var hb=Wa*hc/(ab+mb);ab*=hb;mb*=hb}x.thm[2].l[wa]=Math.min(ab,x.thm[2].l[wa]);
x.thm[3].l[wa]=Math.min(mb,x.thm[3].l[wa])}Zb*=c.BLKSIZE_s/c.BLKSIZE;for(wa=0;wa<c.SBMAX_s;wa++)for(var Da=0;3>Da;Da++)ba=x.ATH.cb_s[x.bm_s[wa]]*Zb,Wa=Math.min(Math.max(x.thm[0].s[wa][Da],ba),Math.max(x.thm[1].s[wa][Da],ba)),ab=Math.max(x.thm[2].s[wa][Da],ba),mb=Math.max(x.thm[3].s[wa][Da],ba),Wa*Kb<ab+mb&&(hb=Wa*Kb/(ab+mb),ab*=hb,mb*=hb),x.thm[2].s[wa][Da]=Math.min(x.thm[2].s[wa][Da],ab),x.thm[3].s[wa][Da]=Math.min(x.thm[3].s[wa][Da],mb)}}var ib=a.internal_flags;a.short_blocks!=ra.short_block_coupled||
0!=S[0]&&0!=S[1]||(S[0]=S[1]=0);for(var Ka=0;Ka<ib.channels_out;Ka++)Q[Ka]=c.NORM_TYPE,a.short_blocks==ra.short_block_dispensed&&(S[Ka]=1),a.short_blocks==ra.short_block_forced&&(S[Ka]=0),0!=S[Ka]?ib.blocktype_old[Ka]==c.SHORT_TYPE&&(Q[Ka]=c.STOP_TYPE):(Q[Ka]=c.SHORT_TYPE,ib.blocktype_old[Ka]==c.NORM_TYPE&&(ib.blocktype_old[Ka]=c.START_TYPE),ib.blocktype_old[Ka]==c.STOP_TYPE&&(ib.blocktype_old[Ka]=c.SHORT_TYPE)),n[Ka]=ib.blocktype_old[Ka],ib.blocktype_old[Ka]=Q[Ka];for(z=0;z<T;z++){var Ea=0;if(1<
z){var Lb=y;Ea=-2;var Tb=c.NORM_TYPE;if(n[0]==c.SHORT_TYPE||n[1]==c.SHORT_TYPE)Tb=c.SHORT_TYPE;var Fb=l[e][z-2]}else Lb=m,Ea=0,Tb=n[z],Fb=g[e][z];Lb[Ea+z]=Tb==c.SHORT_TYPE?W(Fb,x.masking_lower):f(Fb,x.masking_lower);a.analysis&&(x.pinfo.pe[e][z]=Lb[Ea+z])}return 0};var F=[-1.730326E-17,-.01703172,-1.349528E-17,.0418072,-6.73278E-17,-.0876324,-3.0835E-17,.1863476,-1.104424E-16,-.627638];this.L3psycho_anal_vbr=function(d,h,e,g,l,k,m,x,y,p){for(var r=d.internal_flags,A,t,I=K(c.HBLKSIZE),C=ca([3,c.HBLKSIZE_s]),
Q=ca([2,c.BLKSIZE]),z=ca([2,3,c.BLKSIZE_s]),S=ca([4,c.CBANDS]),D=ca([4,c.CBANDS]),O=ca([4,3]),L=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],H=X(2),N=d.mode==la.JOINT_STEREO?4:r.channels_out,Z=ca([2,576]),G=d.internal_flags,V=G.channels_out,ma=d.mode==la.JOINT_STEREO?4:V,R=0;R<V;R++){firbuf=h[R];for(var T=e+576-350-21+192,M=0;576>M;M++){var Y;var ha=firbuf[T+M+10];for(var U=Y=0;9>U;U+=2)ha+=F[U]*(firbuf[T+M+U]+firbuf[T+M+21-U]),Y+=F[U+1]*(firbuf[T+M+U+1]+firbuf[T+M+21-U-1]);Z[R][M]=ha+Y}l[g][R].en.assign(G.en[R]);
l[g][R].thm.assign(G.thm[R]);2<ma&&(k[g][R].en.assign(G.en[R+2]),k[g][R].thm.assign(G.thm[R+2]))}for(R=0;R<ma;R++){var da=K(12),ya=K(12),qa=[0,0,0,0],ia=Z[R&1],sa=0,Fa=3==R?G.nsPsy.attackthre_s:G.nsPsy.attackthre,na=1;if(2==R)for(M=0,U=576;0<U;++M,--U){var ta=Z[0][M],za=Z[1][M];Z[0][M]=ta+za;Z[1][M]=ta-za}for(M=0;3>M;M++)ya[M]=G.nsPsy.last_en_subshort[R][M+6],da[M]=ya[M]/G.nsPsy.last_en_subshort[R][M+4],qa[0]+=ya[M];for(M=0;9>M;M++){for(var Xa=sa+64,Ya=1;sa<Xa;sa++)Ya<Math.abs(ia[sa])&&(Ya=Math.abs(ia[sa]));
G.nsPsy.last_en_subshort[R][M]=ya[M+3]=Ya;qa[1+M/3]+=Ya;Ya=Ya>ya[M+3-2]?Ya/ya[M+3-2]:ya[M+3-2]>10*Ya?ya[M+3-2]/(10*Ya):0;da[M+3]=Ya}for(M=0;3>M;++M){var Ia=ya[3*M+3]+ya[3*M+4]+ya[3*M+5],Wb=1;6*ya[3*M+5]<Ia&&(Wb*=.5,6*ya[3*M+4]<Ia&&(Wb*=.5));O[R][M]=Wb}if(d.analysis){var xa=da[0];for(M=1;12>M;M++)xa<da[M]&&(xa=da[M]);G.pinfo.ers[g][R]=G.pinfo.ers_save[R];G.pinfo.ers_save[R]=xa}for(M=0;12>M;M++)0==L[R][M/3]&&da[M]>Fa&&(L[R][M/3]=M%3+1);for(M=1;4>M;M++){var Qb=qa[M-1],Ga=qa[M];4E4>Math.max(Qb,Ga)&&Qb<
1.7*Ga&&Ga<1.7*Qb&&(1==M&&L[R][0]<=L[R][M]&&(L[R][0]=0),L[R][M]=0)}L[R][0]<=G.nsPsy.lastAttacks[R]&&(L[R][0]=0);if(3==G.nsPsy.lastAttacks[R]||0!=L[R][0]+L[R][1]+L[R][2]+L[R][3])na=0,0!=L[R][1]&&0!=L[R][0]&&(L[R][1]=0),0!=L[R][2]&&0!=L[R][1]&&(L[R][2]=0),0!=L[R][3]&&0!=L[R][2]&&(L[R][3]=0);2>R?H[R]=na:0==na&&(H[0]=H[1]=0);y[R]=G.tot_ener[R]}var qb=d.internal_flags;d.short_blocks!=ra.short_block_coupled||0!=H[0]&&0!=H[1]||(H[0]=H[1]=0);for(var Ma=0;Ma<qb.channels_out;Ma++)d.short_blocks==ra.short_block_dispensed&&
(H[Ma]=1),d.short_blocks==ra.short_block_forced&&(H[Ma]=0);for(var P=0;P<N;P++){var Ha=P&1;A=Q;var Gb=d,La=P,kb=g,Ra=I,Na=A,cb=Ha,Aa=Gb.internal_flags;if(2>La)q.fft_long(Aa,Na[cb],La,h,e);else if(2==La)for(var va=c.BLKSIZE-1;0<=va;--va){var rb=Na[cb+0][va],Va=Na[cb+1][va];Na[cb+0][va]=(rb+Va)*aa.SQRT2*.5;Na[cb+1][va]=(rb-Va)*aa.SQRT2*.5}Ra[0]=Na[cb+0][0];Ra[0]*=Ra[0];for(va=c.BLKSIZE/2-1;0<=va;--va){var ja=Na[cb+0][c.BLKSIZE/2-va],Hb=Na[cb+0][c.BLKSIZE/2+va];Ra[c.BLKSIZE/2-va]=.5*(ja*ja+Hb*Hb)}var Ib=
0;for(va=11;va<c.HBLKSIZE;va++)Ib+=Ra[va];Aa.tot_ener[La]=Ib;if(Gb.analysis){for(va=0;va<c.HBLKSIZE;va++)Aa.pinfo.energy[kb][La][va]=Aa.pinfo.energy_save[La][va],Aa.pinfo.energy_save[La][va]=Ra[va];Aa.pinfo.pe[kb][La]=Aa.pe[La]}var Ba=P,zb=I,tb=d.internal_flags;2==d.athaa_loudapprox&&2>Ba&&(tb.loudness_sq[g][Ba]=tb.loudness_sq_save[Ba],tb.loudness_sq_save[Ba]=u(zb,tb));if(0!=H[Ha]){var oa=void 0,ea=r,Ab=I,Bb=S[P],Sa=D[P],Za=P,ub=K(c.CBANDS),sb=K(c.CBANDS),Ja=X(c.CBANDS+2);b(ea,Ab,Bb,ub,sb);v(ea,ub,
sb,Ja);var Rb=0;for(oa=0;oa<ea.npart_l;oa++){var Xb,db=ea.s3ind[oa][0],cc=ea.s3ind[oa][1],Cb=0,Db=0;Cb=Ja[db];Db+=1;var $a=ea.s3_ll[Rb]*Bb[db]*J[Ja[db]];++Rb;for(++db;db<=cc;){Cb+=Ja[db];Db+=1;var vb=ea.s3_ll[Rb]*Bb[db]*J[Ja[db]];$a=Xb=n($a,vb,db-oa);++Rb;++db}Cb=(1+2*Cb)/(2*Db);var Ta=.5*J[Cb];$a*=Ta;if(ea.blocktype_old[Za&1]==c.SHORT_TYPE){var wb=2*ea.nb_1[Za][oa];Sa[oa]=0<wb?Math.min($a,wb):Math.min($a,.3*Bb[oa])}else{var Yb=16*ea.nb_2[Za][oa],eb=2*ea.nb_1[Za][oa];0>=Yb&&(Yb=$a);0>=eb&&(eb=$a);
wb=ea.blocktype_old[Za&1]==c.NORM_TYPE?Math.min(eb,Yb):eb;Sa[oa]=Math.min($a,wb)}ea.nb_2[Za][oa]=ea.nb_1[Za][oa];ea.nb_1[Za][oa]=$a;vb=ub[oa];vb*=ea.minval_l[oa];vb*=Ta;Sa[oa]>vb&&(Sa[oa]=vb);1<ea.masking_lower&&(Sa[oa]*=ea.masking_lower);Sa[oa]>Bb[oa]&&(Sa[oa]=Bb[oa]);1>ea.masking_lower&&(Sa[oa]*=ea.masking_lower)}for(;oa<c.CBANDS;++oa)Bb[oa]=0,Sa[oa]=0}else for(var Jb=r,lb=P,xb=0;xb<Jb.npart_l;xb++)Jb.nb_2[lb][xb]=Jb.nb_1[lb][xb],Jb.nb_1[lb][xb]=0}2==H[0]+H[1]&&d.mode==la.JOINT_STEREO&&a(S,D,r.mld_cb_l,
r.ATH.cb_l,d.ATHlower*r.ATH.adjust,d.msfix,r.npart_l);for(P=0;P<N;P++)Ha=P&1,0!=H[Ha]&&E(r,S[P],D[P],P);for(var fa=0;3>fa;fa++){for(P=0;P<N;++P)if(Ha=P&1,0!=H[Ha]){var Ca=r,Sb=P;if(0==fa)for(var Eb=0;Eb<Ca.npart_s;Eb++)Ca.nb_s2[Sb][Eb]=Ca.nb_s1[Sb][Eb],Ca.nb_s1[Sb][Eb]=0}else{t=z;var fb=P,Oa=fa,ka=C,Ua=t,gb=Ha,gc=d.internal_flags;0==Oa&&2>fb&&q.fft_short(gc,Ua[gb],fb,h,e);if(2==fb)for(var ua=c.BLKSIZE_s-1;0<=ua;--ua){var Kb=Ua[gb+0][Oa][ua],hc=Ua[gb+1][Oa][ua];Ua[gb+0][Oa][ua]=(Kb+hc)*aa.SQRT2*.5;
Ua[gb+1][Oa][ua]=(Kb-hc)*aa.SQRT2*.5}ka[Oa][0]=Ua[gb+0][Oa][0];ka[Oa][0]*=ka[Oa][0];for(ua=c.BLKSIZE_s/2-1;0<=ua;--ua){var Zb=Ua[gb+0][Oa][c.BLKSIZE_s/2-ua],wa=Ua[gb+0][Oa][c.BLKSIZE_s/2+ua];ka[Oa][c.BLKSIZE_s/2-ua]=.5*(Zb*Zb+wa*wa)}var ba=void 0,Wa=void 0,ab=void 0,mb=C,hb=S[P],Da=D[P],ib=P,Ka=fa,Ea=d.internal_flags,Lb=new float[c.CBANDS],Tb=K(c.CBANDS),Fb=new int[c.CBANDS];for(ba=Wa=0;ba<Ea.npart_s;++ba){var Ob=0,Pb=0,dc=Ea.numlines_s[ba];for(ab=0;ab<dc;++ab,++Wa){var nc=mb[Ka][Wa];Ob+=nc;Pb<nc&&
(Pb=nc)}hb[ba]=Ob;Lb[ba]=Pb;Tb[ba]=Ob/dc}for(;ba<c.CBANDS;++ba)Lb[ba]=0,Tb[ba]=0;var Mb=Ea,nb=Lb,Ub=Tb,$b=Fb,ac=J.length-1,pa=0,Pa=Ub[pa]+Ub[pa+1];if(0<Pa){var bb=nb[pa];bb<nb[pa+1]&&(bb=nb[pa+1]);Pa=20*(2*bb-Pa)/(Pa*(Mb.numlines_s[pa]+Mb.numlines_s[pa+1]-1));var ob=0|Pa;ob>ac&&(ob=ac);$b[pa]=ob}else $b[pa]=0;for(pa=1;pa<Mb.npart_s-1;pa++)Pa=Ub[pa-1]+Ub[pa]+Ub[pa+1],0<Pa?(bb=nb[pa-1],bb<nb[pa]&&(bb=nb[pa]),bb<nb[pa+1]&&(bb=nb[pa+1]),Pa=20*(3*bb-Pa)/(Pa*(Mb.numlines_s[pa-1]+Mb.numlines_s[pa]+Mb.numlines_s[pa+
1]-1)),ob=0|Pa,ob>ac&&(ob=ac),$b[pa]=ob):$b[pa]=0;Pa=Ub[pa-1]+Ub[pa];0<Pa?(bb=nb[pa-1],bb<nb[pa]&&(bb=nb[pa]),Pa=20*(2*bb-Pa)/(Pa*(Mb.numlines_s[pa-1]+Mb.numlines_s[pa]-1)),ob=0|Pa,ob>ac&&(ob=ac),$b[pa]=ob):$b[pa]=0;for(Wa=ba=0;ba<Ea.npart_s;ba++){var yb=Ea.s3ind_s[ba][0],mc=Ea.s3ind_s[ba][1];var lc=Fb[yb];var tc=1;var ic=Ea.s3_ss[Wa]*hb[yb]*J[Fb[yb]];++Wa;for(++yb;yb<=mc;){lc+=Fb[yb];tc+=1;var bc=Ea.s3_ss[Wa]*hb[yb]*J[Fb[yb]];ic=n(ic,bc,yb-ba);++Wa;++yb}lc=(1+2*lc)/(2*tc);var uc=.5*J[lc];ic*=uc;
Da[ba]=ic;Ea.nb_s2[ib][ba]=Ea.nb_s1[ib][ba];Ea.nb_s1[ib][ba]=ic;bc=Lb[ba];bc*=Ea.minval_s[ba];bc*=uc;Da[ba]>bc&&(Da[ba]=bc);1<Ea.masking_lower&&(Da[ba]*=Ea.masking_lower);Da[ba]>hb[ba]&&(Da[ba]=hb[ba]);1>Ea.masking_lower&&(Da[ba]*=Ea.masking_lower)}for(;ba<c.CBANDS;++ba)hb[ba]=0,Da[ba]=0}0==H[0]+H[1]&&d.mode==la.JOINT_STEREO&&a(S,D,r.mld_cb_s,r.ATH.cb_s,d.ATHlower*r.ATH.adjust,d.msfix,r.npart_s);for(P=0;P<N;++P)Ha=P&1,0==H[Ha]&&w(r,S[P],D[P],P,fa)}for(P=0;P<N;P++)if(Ha=P&1,0==H[Ha])for(var Vb=0;Vb<
c.SBMAX_s;Vb++){var vc=K(3);for(fa=0;3>fa;fa++){var jb=r.thm[P].s[Vb][fa];jb*=.8;if(2<=L[P][fa]||1==L[P][fa+1]){var jc=0!=fa?fa-1:2,kc=B(r.thm[P].s[Vb][jc],jb,.36);jb=Math.min(jb,kc)}else if(1==L[P][fa])jc=0!=fa?fa-1:2,kc=B(r.thm[P].s[Vb][jc],jb,.18),jb=Math.min(jb,kc);else if(0!=fa&&3==L[P][fa-1]||0==fa&&3==r.nsPsy.lastAttacks[P])jc=2!=fa?fa+1:0,kc=B(r.thm[P].s[Vb][jc],jb,.18),jb=Math.min(jb,kc);jb*=O[P][fa];vc[fa]=jb}for(fa=0;3>fa;fa++)r.thm[P].s[Vb][fa]=vc[fa]}for(P=0;P<N;P++)r.nsPsy.lastAttacks[P]=
L[P][2];for(var Nb=d.internal_flags,pb=0;pb<Nb.channels_out;pb++){var oc=c.NORM_TYPE;0!=H[pb]?Nb.blocktype_old[pb]==c.SHORT_TYPE&&(oc=c.STOP_TYPE):(oc=c.SHORT_TYPE,Nb.blocktype_old[pb]==c.NORM_TYPE&&(Nb.blocktype_old[pb]=c.START_TYPE),Nb.blocktype_old[pb]==c.STOP_TYPE&&(Nb.blocktype_old[pb]=c.SHORT_TYPE));p[pb]=Nb.blocktype_old[pb];Nb.blocktype_old[pb]=oc}for(P=0;P<N;P++){if(1<P){var pc=x;var qc=-2;var rc=c.NORM_TYPE;if(p[0]==c.SHORT_TYPE||p[1]==c.SHORT_TYPE)rc=c.SHORT_TYPE;var sc=k[g][P-2]}else pc=
m,qc=0,rc=p[P],sc=l[g][P];pc[qc+P]=rc==c.SHORT_TYPE?W(sc,r.masking_lower):f(sc,r.masking_lower);d.analysis&&(r.pinfo.pe[g][P]=pc[qc+P])}return 0};this.psymodel_init=function(a){var b=a.internal_flags,f,h=!0,g=13,k=0,m=0,x=-8.25,y=-4.5,n=K(c.CBANDS),u=K(c.CBANDS),A=K(c.CBANDS),w=a.out_samplerate;switch(a.experimentalZ){default:case 0:h=!0;break;case 1:h=a.VBR==G.vbr_mtrh||a.VBR==G.vbr_mt?!1:!0;break;case 2:h=!1;break;case 3:g=8,k=-1.75,m=-.0125,x=-8.25,y=-2.25}b.ms_ener_ratio_old=.25;b.blocktype_old[0]=
b.blocktype_old[1]=c.NORM_TYPE;for(f=0;4>f;++f){for(var v=0;v<c.CBANDS;++v)b.nb_1[f][v]=1E20,b.nb_2[f][v]=1E20,b.nb_s1[f][v]=b.nb_s2[f][v]=1;for(var z=0;z<c.SBMAX_l;z++)b.en[f].l[z]=1E20,b.thm[f].l[z]=1E20;for(v=0;3>v;++v){for(z=0;z<c.SBMAX_s;z++)b.en[f].s[z][v]=1E20,b.thm[f].s[z][v]=1E20;b.nsPsy.lastAttacks[f]=0}for(v=0;9>v;v++)b.nsPsy.last_en_subshort[f][v]=10}b.loudness_sq_save[0]=b.loudness_sq_save[1]=0;b.npart_l=e(b.numlines_l,b.bo_l,b.bm_l,n,u,b.mld_l,b.PSY.bo_l_weight,w,c.BLKSIZE,b.scalefac_band.l,
c.BLKSIZE/1152,c.SBMAX_l);for(f=0;f<b.npart_l;f++)z=k,n[f]>=g&&(z=m*(n[f]-g)/(24-g)+k*(24-n[f])/(24-g)),A[f]=Math.pow(10,z/10),b.rnumlines_l[f]=0<b.numlines_l[f]?1/b.numlines_l[f]:0;b.s3_ll=l(b.s3ind,b.npart_l,n,u,A,h);for(f=v=0;f<b.npart_l;f++){m=Ma.MAX_VALUE;for(z=0;z<b.numlines_l[f];z++,v++)k=w*v/(1E3*c.BLKSIZE),k=this.ATHformula(1E3*k,a)-20,k=Math.pow(10,.1*k),k*=b.numlines_l[f],m>k&&(m=k);b.ATH.cb_l[f]=m;m=-20+20*n[f]/10;6<m&&(m=100);-15>m&&(m=-15);m-=8;b.minval_l[f]=Math.pow(10,m/10)*b.numlines_l[f]}b.npart_s=
e(b.numlines_s,b.bo_s,b.bm_s,n,u,b.mld_s,b.PSY.bo_s_weight,w,c.BLKSIZE_s,b.scalefac_band.s,c.BLKSIZE_s/384,c.SBMAX_s);for(f=v=0;f<b.npart_s;f++){z=x;n[f]>=g&&(z=y*(n[f]-g)/(24-g)+x*(24-n[f])/(24-g));A[f]=Math.pow(10,z/10);m=Ma.MAX_VALUE;for(z=0;z<b.numlines_s[f];z++,v++)k=w*v/(1E3*c.BLKSIZE_s),k=this.ATHformula(1E3*k,a)-20,k=Math.pow(10,.1*k),k*=b.numlines_s[f],m>k&&(m=k);b.ATH.cb_s[f]=m;m=-7+7*n[f]/12;12<n[f]&&(m*=1+3.1*Math.log(1+m));12>n[f]&&(m*=1+2.3*Math.log(1-m));-15>m&&(m=-15);m-=8;b.minval_s[f]=
Math.pow(10,m/10)*b.numlines_s[f]}b.s3_ss=l(b.s3ind_s,b.npart_s,n,u,A,h);p=Math.pow(10,.5625);r=Math.pow(10,1.5);t=Math.pow(10,1.5);q.init_fft(b);b.decay=Math.exp(-2.302585092994046/(.01*w/192));f=3.5;0!=(a.exp_nspsytune&2)&&(f=1);0<Math.abs(a.msfix)&&(f=a.msfix);a.msfix=f;for(h=0;h<b.npart_l;h++)b.s3ind[h][1]>b.npart_l-1&&(b.s3ind[h][1]=b.npart_l-1);b.ATH.decay=Math.pow(10,576*b.mode_gr/w*-1.2);b.ATH.adjust=.01;b.ATH.adjustLimit=1;if(-1!=a.ATHtype){v=a.out_samplerate/c.BLKSIZE;for(f=k=h=0;f<c.BLKSIZE/
2;++f)k+=v,b.ATH.eql_w[f]=1/Math.pow(10,this.ATHformula(k,a)/10),h+=b.ATH.eql_w[f];h=1/h;for(f=c.BLKSIZE/2;0<=--f;)b.ATH.eql_w[f]*=h}for(h=v=0;h<b.npart_s;++h)for(f=0;f<b.numlines_s[h];++f)++v;for(h=v=0;h<b.npart_l;++h)for(f=0;f<b.numlines_l[h];++f)++v;for(f=v=0;f<b.npart_l;f++)k=w*(v+b.numlines_l[f]/2)/(1*c.BLKSIZE),b.mld_cb_l[f]=d(k),v+=b.numlines_l[f];for(;f<c.CBANDS;++f)b.mld_cb_l[f]=1;for(f=v=0;f<b.npart_s;f++)k=w*(v+b.numlines_s[f]/2)/(1*c.BLKSIZE_s),b.mld_cb_s[f]=d(k),v+=b.numlines_s[f];for(;f<
c.CBANDS;++f)b.mld_cb_s[f]=1;return 0};this.ATHformula=function(a,b){switch(b.ATHtype){case 0:a=g(a,9);break;case 1:a=g(a,-1);break;case 2:a=g(a,0);break;case 3:a=g(a,1)+6;break;case 4:a=g(a,b.ATHcurve);break;default:a=g(a,0)}return a}}function W(){function u(){this.mask_adjust_short=this.mask_adjust=0;this.bo_l_weight=K(c.SBMAX_l);this.bo_s_weight=K(c.SBMAX_s)}function k(){this.lowerlimit=0}function n(a,b){this.lowpass=b}function V(a){return 1<a?0:0>=a?1:Math.cos(Math.PI/2*a)}function E(a,b){switch(a){case 44100:return b.version=
1,0;case 48E3:return b.version=1;case 32E3:return b.version=1,2;case 22050:return b.version=0;case 24E3:return b.version=0,1;case 16E3:return b.version=0,2;case 11025:return b.version=0;case 12E3:return b.version=0,1;case 8E3:return b.version=0,2;default:return b.version=0,-1}}function B(a,b,d){16E3>d&&(b=2);d=w.bitrate_table[b][1];for(var c=2;14>=c;c++)0<w.bitrate_table[b][c]&&Math.abs(w.bitrate_table[b][c]-a)<Math.abs(d-a)&&(d=w.bitrate_table[b][c]);return d}function U(a,b,d){16E3>d&&(b=2);for(d=
0;14>=d;d++)if(0<w.bitrate_table[b][d]&&w.bitrate_table[b][d]==a)return d;return-1}function f(a,b){var d=[new n(8,2E3),new n(16,3700),new n(24,3900),new n(32,5500),new n(40,7E3),new n(48,7500),new n(56,1E4),new n(64,11E3),new n(80,13500),new n(96,15100),new n(112,15600),new n(128,17E3),new n(160,17500),new n(192,18600),new n(224,19400),new n(256,19700),new n(320,20500)];b=e.nearestBitrateFullIndex(b);a.lowerlimit=d[b].lowpass}function b(a){var b=c.BLKSIZE+a.framesize-c.FFTOFFSET;return b=Math.max(b,
512+a.framesize-32)}function v(f,g,k,p,q,n,r){var h=f.internal_flags,x=0,y=[null,null],u=[null,null];if(4294479419!=h.Class_ID)return-3;if(0==p)return 0;var t=d.copy_buffer(h,q,n,r,0);if(0>t)return t;n+=t;x+=t;u[0]=g;u[1]=k;if(qa.NEQ(f.scale,0)&&qa.NEQ(f.scale,1))for(t=0;t<p;++t)u[0][t]*=f.scale,2==h.channels_out&&(u[1][t]*=f.scale);if(qa.NEQ(f.scale_left,0)&&qa.NEQ(f.scale_left,1))for(t=0;t<p;++t)u[0][t]*=f.scale_left;if(qa.NEQ(f.scale_right,0)&&qa.NEQ(f.scale_right,1))for(t=0;t<p;++t)u[1][t]*=f.scale_right;
if(2==f.num_channels&&1==h.channels_out)for(t=0;t<p;++t)u[0][t]=.5*(u[0][t]+u[1][t]),u[1][t]=0;g=b(f);y[0]=h.mfbuf[0];y[1]=h.mfbuf[1];for(k=0;0<p;){var v=[null,null];v[0]=u[0];v[1]=u[1];t=new a;var A=f;var w=y;var B=k,E=p,D=t,H=A.internal_flags;if(.9999>H.resample_ratio||1.0001<H.resample_ratio)for(var O=0;O<H.channels_out;O++){var G=new m,J=D,N,V=w[O],T=H.mf_size,U=A.framesize,W=v[O],X=B,aa=E,ha=G,la=O,ca=A.internal_flags,ia=0,sa=A.out_samplerate/z(A.out_samplerate,A.in_samplerate);sa>da.BPC&&(sa=
da.BPC);var ra=1E-4>Math.abs(ca.resample_ratio-Math.floor(.5+ca.resample_ratio))?1:0;var R=1/ca.resample_ratio;1<R&&(R=1);var na=31;0==na%2&&--na;na+=ra;ra=na+1;if(0==ca.fill_buffer_resample_init){ca.inbuf_old[0]=K(ra);ca.inbuf_old[1]=K(ra);for(N=0;N<=2*sa;++N)ca.blackfilt[N]=K(ra);ca.itime[0]=0;for(ia=ca.itime[1]=0;ia<=2*sa;ia++){var M=0,za=(ia-sa)/(2*sa);for(N=0;N<=na;N++){var Fa=ca.blackfilt[ia],Ia=N,xa=N-za,Qa=Math.PI*R;xa/=na;0>xa&&(xa=0);1<xa&&(xa=1);var Ma=xa-.5;xa=.42-.5*Math.cos(2*xa*Math.PI)+
.08*Math.cos(4*xa*Math.PI);M+=Fa[Ia]=1E-9>Math.abs(Ma)?Qa/Math.PI:xa*Math.sin(na*Qa*Ma)/(Math.PI*na*Ma)}for(N=0;N<=na;N++)ca.blackfilt[ia][N]/=M}ca.fill_buffer_resample_init=1}M=ca.inbuf_old[la];for(R=0;R<U;R++){N=R*ca.resample_ratio;ia=0|Math.floor(N-ca.itime[la]);if(na+ia-na/2>=aa)break;za=N-ca.itime[la]-(ia+na%2*.5);za=0|Math.floor(2*za*sa+sa+.5);for(N=Fa=0;N<=na;++N)Ia=0|N+ia-na/2,Fa+=(0>Ia?M[ra+Ia]:W[X+Ia])*ca.blackfilt[za][N];V[T+R]=Fa}ha.num_used=Math.min(aa,na+ia-na/2);ca.itime[la]+=ha.num_used-
R*ca.resample_ratio;if(ha.num_used>=ra)for(N=0;N<ra;N++)M[N]=W[X+ha.num_used+N-ra];else{V=ra-ha.num_used;for(N=0;N<V;++N)M[N]=M[N+ha.num_used];for(ia=0;N<ra;++N,++ia)M[N]=W[X+ia]}J.n_out=R;D.n_in=G.num_used}else for(D.n_out=Math.min(A.framesize,E),D.n_in=D.n_out,A=0;A<D.n_out;++A)w[0][H.mf_size+A]=v[0][B+A],2==H.channels_out&&(w[1][H.mf_size+A]=v[1][B+A]);w=t.n_in;t=t.n_out;if(h.findReplayGain&&!h.decode_on_the_fly&&l.AnalyzeSamples(h.rgdata,y[0],h.mf_size,y[1],h.mf_size,t,h.channels_out)==Y.GAIN_ANALYSIS_ERROR)return-6;
p-=w;k+=w;h.mf_size+=t;1>h.mf_samples_to_encode&&(h.mf_samples_to_encode=c.ENCDELAY+c.POSTDELAY);h.mf_samples_to_encode+=t;if(h.mf_size>=g){w=r-x;0==r&&(w=0);t=f;w=e.enc.lame_encode_mp3_frame(t,y[0],y[1],q,n,w);t.frameNum++;t=w;if(0>t)return t;n+=t;x+=t;h.mf_size-=f.framesize;h.mf_samples_to_encode-=f.framesize;for(w=0;w<h.channels_out;w++)for(t=0;t<h.mf_size;t++)y[w][t]=y[w][t+f.framesize]}}return x}function a(){this.n_out=this.n_in=0}function m(){this.num_used=0}function z(a,b){return 0!=b?z(b,
a%b):a}var e=this;W.V9=410;W.V8=420;W.V7=430;W.V6=440;W.V5=450;W.V4=460;W.V3=470;W.V2=480;W.V1=490;W.V0=500;W.R3MIX=1E3;W.STANDARD=1001;W.EXTREME=1002;W.INSANE=1003;W.STANDARD_FAST=1004;W.EXTREME_FAST=1005;W.MEDIUM=1006;W.MEDIUM_FAST=1007;W.LAME_MAXMP3BUFFER=147456;var l,d,g,q,D,p=new Pb,r,t,J;this.enc=new c;this.setModules=function(a,b,c,f,e,k,m,n,u){l=a;d=b;g=c;q=f;D=e;r=k;t=n;J=u;this.enc.setModules(d,p,q,r)};this.lame_init=function(){var a=new zc;a.class_id=4294479419;var b=a.internal_flags=new da;
a.mode=la.NOT_SET;a.original=1;a.in_samplerate=44100;a.num_channels=2;a.num_samples=-1;a.bWriteVbrTag=!0;a.quality=-1;a.short_blocks=null;b.subblock_gain=-1;a.lowpassfreq=0;a.highpassfreq=0;a.lowpasswidth=-1;a.highpasswidth=-1;a.VBR=G.vbr_off;a.VBR_q=4;a.ATHcurve=-1;a.VBR_mean_bitrate_kbps=128;a.VBR_min_bitrate_kbps=0;a.VBR_max_bitrate_kbps=0;a.VBR_hard_min=0;b.VBR_min_bitrate=1;b.VBR_max_bitrate=13;a.quant_comp=-1;a.quant_comp_short=-1;a.msfix=-1;b.resample_ratio=1;b.OldValue[0]=180;b.OldValue[1]=
180;b.CurrentStep[0]=4;b.CurrentStep[1]=4;b.masking_lower=1;b.nsPsy.attackthre=-1;b.nsPsy.attackthre_s=-1;a.scale=-1;a.athaa_type=-1;a.ATHtype=-1;a.athaa_loudapprox=-1;a.athaa_sensitivity=0;a.useTemporal=null;a.interChRatio=-1;b.mf_samples_to_encode=c.ENCDELAY+c.POSTDELAY;a.encoder_padding=0;b.mf_size=c.ENCDELAY-c.MDCTDELAY;a.findReplayGain=!1;a.decode_on_the_fly=!1;b.decode_on_the_fly=!1;b.findReplayGain=!1;b.findPeakSample=!1;b.RadioGain=0;b.AudiophileGain=0;b.noclipGainChange=0;b.noclipScale=-1;
a.preset=0;a.write_id3tag_automatic=!0;a.lame_allocated_gfp=1;return a};this.nearestBitrateFullIndex=function(a){var b=[8,16,24,32,40,48,56,64,80,96,112,128,160,192,224,256,320];var d=b[16];var c=16;var f=b[16];var e=16;for(var h=0;16>h;h++)if(Math.max(a,b[h+1])!=a){d=b[h+1];c=h+1;f=b[h];e=h;break}return d-a>a-f?e:c};this.lame_init_params=function(a){var b=a.internal_flags;b.Class_ID=0;null==b.ATH&&(b.ATH=new Cc);null==b.PSY&&(b.PSY=new u);null==b.rgdata&&(b.rgdata=new Ac);b.channels_in=a.num_channels;
1==b.channels_in&&(a.mode=la.MONO);b.channels_out=a.mode==la.MONO?1:2;b.mode_ext=c.MPG_MD_MS_LR;a.mode==la.MONO&&(a.force_ms=!1);a.VBR==G.vbr_off&&128!=a.VBR_mean_bitrate_kbps&&0==a.brate&&(a.brate=a.VBR_mean_bitrate_kbps);a.VBR!=G.vbr_off&&a.VBR!=G.vbr_mtrh&&a.VBR!=G.vbr_mt&&(a.free_format=!1);a.VBR==G.vbr_off&&0==a.brate&&qa.EQ(a.compression_ratio,0)&&(a.compression_ratio=11.025);a.VBR==G.vbr_off&&0<a.compression_ratio&&(0==a.out_samplerate&&(a.out_samplerate=map2MP3Frequency(int(.97*a.in_samplerate))),
a.brate=0|16*a.out_samplerate*b.channels_out/(1E3*a.compression_ratio),b.samplerate_index=E(a.out_samplerate,a),a.free_format||(a.brate=B(a.brate,a.version,a.out_samplerate)));0!=a.out_samplerate&&(16E3>a.out_samplerate?(a.VBR_mean_bitrate_kbps=Math.max(a.VBR_mean_bitrate_kbps,8),a.VBR_mean_bitrate_kbps=Math.min(a.VBR_mean_bitrate_kbps,64)):32E3>a.out_samplerate?(a.VBR_mean_bitrate_kbps=Math.max(a.VBR_mean_bitrate_kbps,8),a.VBR_mean_bitrate_kbps=Math.min(a.VBR_mean_bitrate_kbps,160)):(a.VBR_mean_bitrate_kbps=
Math.max(a.VBR_mean_bitrate_kbps,32),a.VBR_mean_bitrate_kbps=Math.min(a.VBR_mean_bitrate_kbps,320)));if(0==a.lowpassfreq){switch(a.VBR){case G.vbr_off:var e=new k;f(e,a.brate);e=e.lowerlimit;break;case G.vbr_abr:e=new k;f(e,a.VBR_mean_bitrate_kbps);e=e.lowerlimit;break;case G.vbr_rh:var h=[19500,19E3,18600,18E3,17500,16E3,15600,14900,12500,1E4,3950];if(0<=a.VBR_q&&9>=a.VBR_q){e=h[a.VBR_q];h=h[a.VBR_q+1];var m=a.VBR_q_frac;e=linear_int(e,h,m)}else e=19500;break;default:h=[19500,19E3,18500,18E3,17500,
16500,15500,14500,12500,9500,3950],0<=a.VBR_q&&9>=a.VBR_q?(e=h[a.VBR_q],h=h[a.VBR_q+1],m=a.VBR_q_frac,e=linear_int(e,h,m)):e=19500}a.mode!=la.MONO||a.VBR!=G.vbr_off&&a.VBR!=G.vbr_abr||(e*=1.5);a.lowpassfreq=e|0}0==a.out_samplerate&&(2*a.lowpassfreq>a.in_samplerate&&(a.lowpassfreq=a.in_samplerate/2),e=a.lowpassfreq|0,h=a.in_samplerate,m=44100,48E3<=h?m=48E3:44100<=h?m=44100:32E3<=h?m=32E3:24E3<=h?m=24E3:22050<=h?m=22050:16E3<=h?m=16E3:12E3<=h?m=12E3:11025<=h?m=11025:8E3<=h&&(m=8E3),-1==e?e=m:(15960>=
e&&(m=44100),15250>=e&&(m=32E3),11220>=e&&(m=24E3),9970>=e&&(m=22050),7230>=e&&(m=16E3),5420>=e&&(m=12E3),4510>=e&&(m=11025),3970>=e&&(m=8E3),e=h<m?44100<h?48E3:32E3<h?44100:24E3<h?32E3:22050<h?24E3:16E3<h?22050:12E3<h?16E3:11025<h?12E3:8E3<h?11025:8E3:m),a.out_samplerate=e);a.lowpassfreq=Math.min(20500,a.lowpassfreq);a.lowpassfreq=Math.min(a.out_samplerate/2,a.lowpassfreq);a.VBR==G.vbr_off&&(a.compression_ratio=16*a.out_samplerate*b.channels_out/(1E3*a.brate));a.VBR==G.vbr_abr&&(a.compression_ratio=
16*a.out_samplerate*b.channels_out/(1E3*a.VBR_mean_bitrate_kbps));a.bWriteVbrTag||(a.findReplayGain=!1,a.decode_on_the_fly=!1,b.findPeakSample=!1);b.findReplayGain=a.findReplayGain;b.decode_on_the_fly=a.decode_on_the_fly;b.decode_on_the_fly&&(b.findPeakSample=!0);if(b.findReplayGain&&l.InitGainAnalysis(b.rgdata,a.out_samplerate)==Y.INIT_GAIN_ANALYSIS_ERROR)return a.internal_flags=null,-6;b.decode_on_the_fly&&!a.decode_only&&(null!=b.hip&&J.hip_decode_exit(b.hip),b.hip=J.hip_decode_init());b.mode_gr=
24E3>=a.out_samplerate?1:2;a.framesize=576*b.mode_gr;a.encoder_delay=c.ENCDELAY;b.resample_ratio=a.in_samplerate/a.out_samplerate;switch(a.VBR){case G.vbr_mt:case G.vbr_rh:case G.vbr_mtrh:a.compression_ratio=[5.7,6.5,7.3,8.2,10,11.9,13,14,15,16.5][a.VBR_q];break;case G.vbr_abr:a.compression_ratio=16*a.out_samplerate*b.channels_out/(1E3*a.VBR_mean_bitrate_kbps);break;default:a.compression_ratio=16*a.out_samplerate*b.channels_out/(1E3*a.brate)}a.mode==la.NOT_SET&&(a.mode=la.JOINT_STEREO);0<a.highpassfreq?
(b.highpass1=2*a.highpassfreq,b.highpass2=0<=a.highpasswidth?2*(a.highpassfreq+a.highpasswidth):2*a.highpassfreq,b.highpass1/=a.out_samplerate,b.highpass2/=a.out_samplerate):(b.highpass1=0,b.highpass2=0);0<a.lowpassfreq?(b.lowpass2=2*a.lowpassfreq,0<=a.lowpasswidth?(b.lowpass1=2*(a.lowpassfreq-a.lowpasswidth),0>b.lowpass1&&(b.lowpass1=0)):b.lowpass1=2*a.lowpassfreq,b.lowpass1/=a.out_samplerate,b.lowpass2/=a.out_samplerate):(b.lowpass1=0,b.lowpass2=0);e=a.internal_flags;var n=32,v=-1;if(0<e.lowpass1){var z=
999;for(h=0;31>=h;h++)m=h/31,m>=e.lowpass2&&(n=Math.min(n,h)),e.lowpass1<m&&m<e.lowpass2&&(z=Math.min(z,h));e.lowpass1=999==z?(n-.75)/31:(z-.75)/31;e.lowpass2=n/31}0<e.highpass2&&e.highpass2<.75/31*.9&&(e.highpass1=0,e.highpass2=0,T.err.println("Warning: highpass filter disabled.  highpass frequency too small\n"));if(0<e.highpass2){n=-1;for(h=0;31>=h;h++)m=h/31,m<=e.highpass1&&(v=Math.max(v,h)),e.highpass1<m&&m<e.highpass2&&(n=Math.max(n,h));e.highpass1=v/31;e.highpass2=-1==n?(v+.75)/31:(n+.75)/31}for(h=
0;32>h;h++)m=h/31,v=e.highpass2>e.highpass1?V((e.highpass2-m)/(e.highpass2-e.highpass1+1E-20)):1,m=e.lowpass2>e.lowpass1?V((m-e.lowpass1)/(e.lowpass2-e.lowpass1+1E-20)):1,e.amp_filter[h]=v*m;b.samplerate_index=E(a.out_samplerate,a);if(0>b.samplerate_index)return a.internal_flags=null,-1;if(a.VBR==G.vbr_off)if(a.free_format)b.bitrate_index=0;else{if(a.brate=B(a.brate,a.version,a.out_samplerate),b.bitrate_index=U(a.brate,a.version,a.out_samplerate),0>=b.bitrate_index)return a.internal_flags=null,-1}else b.bitrate_index=
1;a.analysis&&(a.bWriteVbrTag=!1);null!=b.pinfo&&(a.bWriteVbrTag=!1);d.init_bit_stream_w(b);e=b.samplerate_index+3*a.version+6*(16E3>a.out_samplerate?1:0);for(h=0;h<c.SBMAX_l+1;h++)b.scalefac_band.l[h]=q.sfBandIndex[e].l[h];for(h=0;h<c.PSFB21+1;h++)m=(b.scalefac_band.l[22]-b.scalefac_band.l[21])/c.PSFB21,m=b.scalefac_band.l[21]+h*m,b.scalefac_band.psfb21[h]=m;b.scalefac_band.psfb21[c.PSFB21]=576;for(h=0;h<c.SBMAX_s+1;h++)b.scalefac_band.s[h]=q.sfBandIndex[e].s[h];for(h=0;h<c.PSFB12+1;h++)m=(b.scalefac_band.s[13]-
b.scalefac_band.s[12])/c.PSFB12,m=b.scalefac_band.s[12]+h*m,b.scalefac_band.psfb12[h]=m;b.scalefac_band.psfb12[c.PSFB12]=192;b.sideinfo_len=1==a.version?1==b.channels_out?21:36:1==b.channels_out?13:21;a.error_protection&&(b.sideinfo_len+=2);e=a.internal_flags;a.frameNum=0;a.write_id3tag_automatic&&t.id3tag_write_v2(a);e.bitrate_stereoMode_Hist=Ia([16,5]);e.bitrate_blockType_Hist=Ia([16,6]);e.PeakSample=0;a.bWriteVbrTag&&r.InitVbrTag(a);b.Class_ID=4294479419;for(e=0;19>e;e++)b.nsPsy.pefirbuf[e]=700*
b.mode_gr*b.channels_out;-1==a.ATHtype&&(a.ATHtype=4);switch(a.VBR){case G.vbr_mt:a.VBR=G.vbr_mtrh;case G.vbr_mtrh:null==a.useTemporal&&(a.useTemporal=!1);g.apply_preset(a,500-10*a.VBR_q,0);0>a.quality&&(a.quality=LAME_DEFAULT_QUALITY);5>a.quality&&(a.quality=0);5<a.quality&&(a.quality=5);b.PSY.mask_adjust=a.maskingadjust;b.PSY.mask_adjust_short=a.maskingadjust_short;b.sfb21_extra=a.experimentalY?!1:44E3<a.out_samplerate;b.iteration_loop=new VBRNewIterationLoop(D);break;case G.vbr_rh:g.apply_preset(a,
500-10*a.VBR_q,0);b.PSY.mask_adjust=a.maskingadjust;b.PSY.mask_adjust_short=a.maskingadjust_short;b.sfb21_extra=a.experimentalY?!1:44E3<a.out_samplerate;6<a.quality&&(a.quality=6);0>a.quality&&(a.quality=LAME_DEFAULT_QUALITY);b.iteration_loop=new VBROldIterationLoop(D);break;default:b.sfb21_extra=!1,0>a.quality&&(a.quality=LAME_DEFAULT_QUALITY),e=a.VBR,e==G.vbr_off&&(a.VBR_mean_bitrate_kbps=a.brate),g.apply_preset(a,a.VBR_mean_bitrate_kbps,0),a.VBR=e,b.PSY.mask_adjust=a.maskingadjust,b.PSY.mask_adjust_short=
a.maskingadjust_short,b.iteration_loop=e==G.vbr_off?new Bc(D):new ABRIterationLoop(D)}if(a.VBR!=G.vbr_off){b.VBR_min_bitrate=1;b.VBR_max_bitrate=14;16E3>a.out_samplerate&&(b.VBR_max_bitrate=8);if(0!=a.VBR_min_bitrate_kbps&&(a.VBR_min_bitrate_kbps=B(a.VBR_min_bitrate_kbps,a.version,a.out_samplerate),b.VBR_min_bitrate=U(a.VBR_min_bitrate_kbps,a.version,a.out_samplerate),0>b.VBR_min_bitrate)||0!=a.VBR_max_bitrate_kbps&&(a.VBR_max_bitrate_kbps=B(a.VBR_max_bitrate_kbps,a.version,a.out_samplerate),b.VBR_max_bitrate=
U(a.VBR_max_bitrate_kbps,a.version,a.out_samplerate),0>b.VBR_max_bitrate))return-1;a.VBR_min_bitrate_kbps=w.bitrate_table[a.version][b.VBR_min_bitrate];a.VBR_max_bitrate_kbps=w.bitrate_table[a.version][b.VBR_max_bitrate];a.VBR_mean_bitrate_kbps=Math.min(w.bitrate_table[a.version][b.VBR_max_bitrate],a.VBR_mean_bitrate_kbps);a.VBR_mean_bitrate_kbps=Math.max(w.bitrate_table[a.version][b.VBR_min_bitrate],a.VBR_mean_bitrate_kbps)}a.tune&&(b.PSY.mask_adjust+=a.tune_value_a,b.PSY.mask_adjust_short+=a.tune_value_a);
e=a.internal_flags;switch(a.quality){default:case 9:e.psymodel=0;e.noise_shaping=0;e.noise_shaping_amp=0;e.noise_shaping_stop=0;e.use_best_huffman=0;e.full_outer_loop=0;break;case 8:a.quality=7;case 7:e.psymodel=1;e.noise_shaping=0;e.noise_shaping_amp=0;e.noise_shaping_stop=0;e.use_best_huffman=0;e.full_outer_loop=0;break;case 6:e.psymodel=1;0==e.noise_shaping&&(e.noise_shaping=1);e.noise_shaping_amp=0;e.noise_shaping_stop=0;-1==e.subblock_gain&&(e.subblock_gain=1);e.use_best_huffman=0;e.full_outer_loop=
0;break;case 5:e.psymodel=1;0==e.noise_shaping&&(e.noise_shaping=1);e.noise_shaping_amp=0;e.noise_shaping_stop=0;-1==e.subblock_gain&&(e.subblock_gain=1);e.use_best_huffman=0;e.full_outer_loop=0;break;case 4:e.psymodel=1;0==e.noise_shaping&&(e.noise_shaping=1);e.noise_shaping_amp=0;e.noise_shaping_stop=0;-1==e.subblock_gain&&(e.subblock_gain=1);e.use_best_huffman=1;e.full_outer_loop=0;break;case 3:e.psymodel=1;0==e.noise_shaping&&(e.noise_shaping=1);e.noise_shaping_amp=1;e.noise_shaping_stop=1;-1==
e.subblock_gain&&(e.subblock_gain=1);e.use_best_huffman=1;e.full_outer_loop=0;break;case 2:e.psymodel=1;0==e.noise_shaping&&(e.noise_shaping=1);0==e.substep_shaping&&(e.substep_shaping=2);e.noise_shaping_amp=1;e.noise_shaping_stop=1;-1==e.subblock_gain&&(e.subblock_gain=1);e.use_best_huffman=1;e.full_outer_loop=0;break;case 1:e.psymodel=1;0==e.noise_shaping&&(e.noise_shaping=1);0==e.substep_shaping&&(e.substep_shaping=2);e.noise_shaping_amp=2;e.noise_shaping_stop=1;-1==e.subblock_gain&&(e.subblock_gain=
1);e.use_best_huffman=1;e.full_outer_loop=0;break;case 0:e.psymodel=1,0==e.noise_shaping&&(e.noise_shaping=1),0==e.substep_shaping&&(e.substep_shaping=2),e.noise_shaping_amp=2,e.noise_shaping_stop=1,-1==e.subblock_gain&&(e.subblock_gain=1),e.use_best_huffman=1,e.full_outer_loop=0}b.ATH.useAdjust=0>a.athaa_type?3:a.athaa_type;b.ATH.aaSensitivityP=Math.pow(10,a.athaa_sensitivity/-10);null==a.short_blocks&&(a.short_blocks=ra.short_block_allowed);a.short_blocks!=ra.short_block_allowed||a.mode!=la.JOINT_STEREO&&
a.mode!=la.STEREO||(a.short_blocks=ra.short_block_coupled);0>a.quant_comp&&(a.quant_comp=1);0>a.quant_comp_short&&(a.quant_comp_short=0);0>a.msfix&&(a.msfix=0);a.exp_nspsytune|=1;0>a.internal_flags.nsPsy.attackthre&&(a.internal_flags.nsPsy.attackthre=Pb.NSATTACKTHRE);0>a.internal_flags.nsPsy.attackthre_s&&(a.internal_flags.nsPsy.attackthre_s=Pb.NSATTACKTHRE_S);0>a.scale&&(a.scale=1);0>a.ATHtype&&(a.ATHtype=4);0>a.ATHcurve&&(a.ATHcurve=4);0>a.athaa_loudapprox&&(a.athaa_loudapprox=2);0>a.interChRatio&&
(a.interChRatio=0);null==a.useTemporal&&(a.useTemporal=!0);b.slot_lag=b.frac_SpF=0;a.VBR==G.vbr_off&&(b.slot_lag=b.frac_SpF=72E3*(a.version+1)*a.brate%a.out_samplerate|0);q.iteration_init(a);p.psymodel_init(a);return 0};this.lame_encode_flush=function(a,e,f,g){var k=a.internal_flags,l=dc([2,1152]),h=0,m=k.mf_samples_to_encode-c.POSTDELAY,p=b(a);if(1>k.mf_samples_to_encode)return 0;var n=0;a.in_samplerate!=a.out_samplerate&&(m+=16*a.out_samplerate/a.in_samplerate);var q=a.framesize-m%a.framesize;576>
q&&(q+=a.framesize);a.encoder_padding=q;for(q=(m+q)/a.framesize;0<q&&0<=h;){var r=p-k.mf_size;m=a.frameNum;r*=a.in_samplerate;r/=a.out_samplerate;1152<r&&(r=1152);1>r&&(r=1);h=g-n;0==g&&(h=0);h=this.lame_encode_buffer(a,l[0],l[1],r,e,f,h);f+=h;n+=h;q-=m!=a.frameNum?1:0}k.mf_samples_to_encode=0;if(0>h)return h;h=g-n;0==g&&(h=0);d.flush_bitstream(a);h=d.copy_buffer(k,e,f,h,1);if(0>h)return h;f+=h;n+=h;h=g-n;0==g&&(h=0);if(a.write_id3tag_automatic){t.id3tag_write_v1(a);h=d.copy_buffer(k,e,f,h,0);if(0>
h)return h;n+=h}return n};this.lame_encode_buffer=function(a,b,d,c,e,f,g){var h=a.internal_flags,k=[null,null];if(4294479419!=h.Class_ID)return-3;if(0==c)return 0;if(null==h.in_buffer_0||h.in_buffer_nsamples<c)h.in_buffer_0=K(c),h.in_buffer_1=K(c),h.in_buffer_nsamples=c;k[0]=h.in_buffer_0;k[1]=h.in_buffer_1;for(var l=0;l<c;l++)k[0][l]=b[l],1<h.channels_in&&(k[1][l]=d[l]);return v(a,k[0],k[1],c,e,f,g)}}function Kc(){this.setModules=function(c,k){}}function Lc(){this.setModules=function(c,k,n){}}function Mc(){}
function Nc(){this.setModules=function(c,k){}}function Fa(){this.sampleRate=this.channels=this.dataLen=this.dataOffset=0}function cc(c){return c.charCodeAt(0)<<24|c.charCodeAt(1)<<16|c.charCodeAt(2)<<8|c.charCodeAt(3)}var na={fill:function(c,k,n,w){if(2==arguments.length)for(var u=0;u<c.length;u++)c[u]=arguments[1];else for(u=k;u<n;u++)c[u]=w}},T={arraycopy:function(c,k,n,w,E){for(E=k+E;k<E;)n[w++]=c[k++]}},aa={SQRT2:1.4142135623730951,FAST_LOG10:function(c){return Math.log10(c)},FAST_LOG10_X:function(c,
k){return Math.log10(c)*k}};ra.short_block_allowed=new ra(0);ra.short_block_coupled=new ra(1);ra.short_block_dispensed=new ra(2);ra.short_block_forced=new ra(3);var Ma={MAX_VALUE:3.4028235E38};G.vbr_off=new G(0);G.vbr_mt=new G(1);G.vbr_rh=new G(2);G.vbr_abr=new G(3);G.vbr_mtrh=new G(4);G.vbr_default=G.vbr_mtrh;la.STEREO=new la(0);la.JOINT_STEREO=new la(1);la.DUAL_CHANNEL=new la(2);la.MONO=new la(3);la.NOT_SET=new la(4);Y.STEPS_per_dB=100;Y.MAX_dB=120;Y.GAIN_NOT_ENOUGH_SAMPLES=-24601;Y.GAIN_ANALYSIS_ERROR=
0;Y.GAIN_ANALYSIS_OK=1;Y.INIT_GAIN_ANALYSIS_ERROR=0;Y.INIT_GAIN_ANALYSIS_OK=1;Y.YULE_ORDER=10;Y.MAX_ORDER=Y.YULE_ORDER;Y.MAX_SAMP_FREQ=48E3;Y.RMS_WINDOW_TIME_NUMERATOR=1;Y.RMS_WINDOW_TIME_DENOMINATOR=20;Y.MAX_SAMPLES_PER_WINDOW=Y.MAX_SAMP_FREQ*Y.RMS_WINDOW_TIME_NUMERATOR/Y.RMS_WINDOW_TIME_DENOMINATOR+1;qa.EQ=function(c,k){return Math.abs(c)>Math.abs(k)?Math.abs(c-k)<=1E-6*Math.abs(c):Math.abs(c-k)<=1E-6*Math.abs(k)};qa.NEQ=function(c,k){return!qa.EQ(c,k)};zb.NUMTOCENTRIES=100;zb.MAXFRAMESIZE=2880;
var w={t1HB:[1,1,1,0],t2HB:[1,2,1,3,1,1,3,2,0],t3HB:[3,2,1,1,1,1,3,2,0],t5HB:[1,2,6,5,3,1,4,4,7,5,7,1,6,1,1,0],t6HB:[7,3,5,1,6,2,3,2,5,4,4,1,3,3,2,0],t7HB:[1,2,10,19,16,10,3,3,7,10,5,3,11,4,13,17,8,4,12,11,18,15,11,2,7,6,9,14,3,1,6,4,5,3,2,0],t8HB:[3,4,6,18,12,5,5,1,2,16,9,3,7,3,5,14,7,3,19,17,15,13,10,4,13,5,8,11,5,1,12,4,4,1,1,0],t9HB:[7,5,9,14,15,7,6,4,5,5,6,7,7,6,8,8,8,5,15,6,9,10,5,1,11,7,9,6,4,1,14,4,6,2,6,0],t10HB:[1,2,10,23,35,30,12,17,3,3,8,12,18,21,12,7,11,9,15,21,32,40,19,6,14,13,22,34,
46,23,18,7,20,19,33,47,27,22,9,3,31,22,41,26,21,20,5,3,14,13,10,11,16,6,5,1,9,8,7,8,4,4,2,0],t11HB:[3,4,10,24,34,33,21,15,5,3,4,10,32,17,11,10,11,7,13,18,30,31,20,5,25,11,19,59,27,18,12,5,35,33,31,58,30,16,7,5,28,26,32,19,17,15,8,14,14,12,9,13,14,9,4,1,11,4,6,6,6,3,2,0],t12HB:[9,6,16,33,41,39,38,26,7,5,6,9,23,16,26,11,17,7,11,14,21,30,10,7,17,10,15,12,18,28,14,5,32,13,22,19,18,16,9,5,40,17,31,29,17,13,4,2,27,12,11,15,10,7,4,1,27,12,8,12,6,3,1,0],t13HB:[1,5,14,21,34,51,46,71,42,52,68,52,67,44,43,19,
3,4,12,19,31,26,44,33,31,24,32,24,31,35,22,14,15,13,23,36,59,49,77,65,29,40,30,40,27,33,42,16,22,20,37,61,56,79,73,64,43,76,56,37,26,31,25,14,35,16,60,57,97,75,114,91,54,73,55,41,48,53,23,24,58,27,50,96,76,70,93,84,77,58,79,29,74,49,41,17,47,45,78,74,115,94,90,79,69,83,71,50,59,38,36,15,72,34,56,95,92,85,91,90,86,73,77,65,51,44,43,42,43,20,30,44,55,78,72,87,78,61,46,54,37,30,20,16,53,25,41,37,44,59,54,81,66,76,57,54,37,18,39,11,35,33,31,57,42,82,72,80,47,58,55,21,22,26,38,22,53,25,23,38,70,60,51,
36,55,26,34,23,27,14,9,7,34,32,28,39,49,75,30,52,48,40,52,28,18,17,9,5,45,21,34,64,56,50,49,45,31,19,12,15,10,7,6,3,48,23,20,39,36,35,53,21,16,23,13,10,6,1,4,2,16,15,17,27,25,20,29,11,17,12,16,8,1,1,0,1],t15HB:[7,12,18,53,47,76,124,108,89,123,108,119,107,81,122,63,13,5,16,27,46,36,61,51,42,70,52,83,65,41,59,36,19,17,15,24,41,34,59,48,40,64,50,78,62,80,56,33,29,28,25,43,39,63,55,93,76,59,93,72,54,75,50,29,52,22,42,40,67,57,95,79,72,57,89,69,49,66,46,27,77,37,35,66,58,52,91,74,62,48,79,63,90,62,40,
38,125,32,60,56,50,92,78,65,55,87,71,51,73,51,70,30,109,53,49,94,88,75,66,122,91,73,56,42,64,44,21,25,90,43,41,77,73,63,56,92,77,66,47,67,48,53,36,20,71,34,67,60,58,49,88,76,67,106,71,54,38,39,23,15,109,53,51,47,90,82,58,57,48,72,57,41,23,27,62,9,86,42,40,37,70,64,52,43,70,55,42,25,29,18,11,11,118,68,30,55,50,46,74,65,49,39,24,16,22,13,14,7,91,44,39,38,34,63,52,45,31,52,28,19,14,8,9,3,123,60,58,53,47,43,32,22,37,24,17,12,15,10,2,1,71,37,34,30,28,20,17,26,21,16,10,6,8,6,2,0],t16HB:[1,5,14,44,74,63,
110,93,172,149,138,242,225,195,376,17,3,4,12,20,35,62,53,47,83,75,68,119,201,107,207,9,15,13,23,38,67,58,103,90,161,72,127,117,110,209,206,16,45,21,39,69,64,114,99,87,158,140,252,212,199,387,365,26,75,36,68,65,115,101,179,164,155,264,246,226,395,382,362,9,66,30,59,56,102,185,173,265,142,253,232,400,388,378,445,16,111,54,52,100,184,178,160,133,257,244,228,217,385,366,715,10,98,48,91,88,165,157,148,261,248,407,397,372,380,889,884,8,85,84,81,159,156,143,260,249,427,401,392,383,727,713,708,7,154,76,73,
141,131,256,245,426,406,394,384,735,359,710,352,11,139,129,67,125,247,233,229,219,393,743,737,720,885,882,439,4,243,120,118,115,227,223,396,746,742,736,721,712,706,223,436,6,202,224,222,218,216,389,386,381,364,888,443,707,440,437,1728,4,747,211,210,208,370,379,734,723,714,1735,883,877,876,3459,865,2,377,369,102,187,726,722,358,711,709,866,1734,871,3458,870,434,0,12,10,7,11,10,17,11,9,13,12,10,7,5,3,1,3],t24HB:[15,13,46,80,146,262,248,434,426,669,653,649,621,517,1032,88,14,12,21,38,71,130,122,216,
209,198,327,345,319,297,279,42,47,22,41,74,68,128,120,221,207,194,182,340,315,295,541,18,81,39,75,70,134,125,116,220,204,190,178,325,311,293,271,16,147,72,69,135,127,118,112,210,200,188,352,323,306,285,540,14,263,66,129,126,119,114,214,202,192,180,341,317,301,281,262,12,249,123,121,117,113,215,206,195,185,347,330,308,291,272,520,10,435,115,111,109,211,203,196,187,353,332,313,298,283,531,381,17,427,212,208,205,201,193,186,177,169,320,303,286,268,514,377,16,335,199,197,191,189,181,174,333,321,305,289,
275,521,379,371,11,668,184,183,179,175,344,331,314,304,290,277,530,383,373,366,10,652,346,171,168,164,318,309,299,287,276,263,513,375,368,362,6,648,322,316,312,307,302,292,284,269,261,512,376,370,364,359,4,620,300,296,294,288,282,273,266,515,380,374,369,365,361,357,2,1033,280,278,274,267,264,259,382,378,372,367,363,360,358,356,0,43,20,19,17,15,13,11,9,7,6,4,7,5,3,1,3],t32HB:[1,10,8,20,12,20,16,32,14,12,24,0,28,16,24,16],t33HB:[15,28,26,48,22,40,36,64,14,24,20,32,12,16,8,0],t1l:[1,4,3,5],t2l:[1,4,
7,4,5,7,6,7,8],t3l:[2,3,7,4,4,7,6,7,8],t5l:[1,4,7,8,4,5,8,9,7,8,9,10,8,8,9,10],t6l:[3,4,6,8,4,4,6,7,5,6,7,8,7,7,8,9],t7l:[1,4,7,9,9,10,4,6,8,9,9,10,7,7,9,10,10,11,8,9,10,11,11,11,8,9,10,11,11,12,9,10,11,12,12,12],t8l:[2,4,7,9,9,10,4,4,6,10,10,10,7,6,8,10,10,11,9,10,10,11,11,12,9,9,10,11,12,12,10,10,11,11,13,13],t9l:[3,4,6,7,9,10,4,5,6,7,8,10,5,6,7,8,9,10,7,7,8,9,9,10,8,8,9,9,10,11,9,9,10,10,11,11],t10l:[1,4,7,9,10,10,10,11,4,6,8,9,10,11,10,10,7,8,9,10,11,12,11,11,8,9,10,11,12,12,11,12,9,10,11,12,
12,12,12,12,10,11,12,12,13,13,12,13,9,10,11,12,12,12,13,13,10,10,11,12,12,13,13,13],t11l:[2,4,6,8,9,10,9,10,4,5,6,8,10,10,9,10,6,7,8,9,10,11,10,10,8,8,9,11,10,12,10,11,9,10,10,11,11,12,11,12,9,10,11,12,12,13,12,13,9,9,9,10,11,12,12,12,9,9,10,11,12,12,12,12],t12l:[4,4,6,8,9,10,10,10,4,5,6,7,9,9,10,10,6,6,7,8,9,10,9,10,7,7,8,8,9,10,10,10,8,8,9,9,10,10,10,11,9,9,10,10,10,11,10,11,9,9,9,10,10,11,11,12,10,10,10,11,11,11,11,12],t13l:[1,5,7,8,9,10,10,11,10,11,12,12,13,13,14,14,4,6,8,9,10,10,11,11,11,11,
12,12,13,14,14,14,7,8,9,10,11,11,12,12,11,12,12,13,13,14,15,15,8,9,10,11,11,12,12,12,12,13,13,13,13,14,15,15,9,9,11,11,12,12,13,13,12,13,13,14,14,15,15,16,10,10,11,12,12,12,13,13,13,13,14,13,15,15,16,16,10,11,12,12,13,13,13,13,13,14,14,14,15,15,16,16,11,11,12,13,13,13,14,14,14,14,15,15,15,16,18,18,10,10,11,12,12,13,13,14,14,14,14,15,15,16,17,17,11,11,12,12,13,13,13,15,14,15,15,16,16,16,18,17,11,12,12,13,13,14,14,15,14,15,16,15,16,17,18,19,12,12,12,13,14,14,14,14,15,15,15,16,17,17,17,18,12,13,13,14,
14,15,14,15,16,16,17,17,17,18,18,18,13,13,14,15,15,15,16,16,16,16,16,17,18,17,18,18,14,14,14,15,15,15,17,16,16,19,17,17,17,19,18,18,13,14,15,16,16,16,17,16,17,17,18,18,21,20,21,18],t15l:[3,5,6,8,8,9,10,10,10,11,11,12,12,12,13,14,5,5,7,8,9,9,10,10,10,11,11,12,12,12,13,13,6,7,7,8,9,9,10,10,10,11,11,12,12,13,13,13,7,8,8,9,9,10,10,11,11,11,12,12,12,13,13,13,8,8,9,9,10,10,11,11,11,11,12,12,12,13,13,13,9,9,9,10,10,10,11,11,11,11,12,12,13,13,13,14,10,9,10,10,10,11,11,11,11,12,12,12,13,13,14,14,10,10,10,
11,11,11,11,12,12,12,12,12,13,13,13,14,10,10,10,11,11,11,11,12,12,12,12,13,13,14,14,14,10,10,11,11,11,11,12,12,12,13,13,13,13,14,14,14,11,11,11,11,12,12,12,12,12,13,13,13,13,14,15,14,11,11,11,11,12,12,12,12,13,13,13,13,14,14,14,15,12,12,11,12,12,12,13,13,13,13,13,13,14,14,15,15,12,12,12,12,12,13,13,13,13,14,14,14,14,14,15,15,13,13,13,13,13,13,13,13,14,14,14,14,15,15,14,15,13,13,13,13,13,13,13,14,14,14,14,14,15,15,15,15],t16_5l:[1,5,7,9,10,10,11,11,12,12,12,13,13,13,14,11,4,6,8,9,10,11,11,11,12,12,
12,13,14,13,14,11,7,8,9,10,11,11,12,12,13,12,13,13,13,14,14,12,9,9,10,11,11,12,12,12,13,13,14,14,14,15,15,13,10,10,11,11,12,12,13,13,13,14,14,14,15,15,15,12,10,10,11,11,12,13,13,14,13,14,14,15,15,15,16,13,11,11,11,12,13,13,13,13,14,14,14,14,15,15,16,13,11,11,12,12,13,13,13,14,14,15,15,15,15,17,17,13,11,12,12,13,13,13,14,14,15,15,15,15,16,16,16,13,12,12,12,13,13,14,14,15,15,15,15,16,15,16,15,14,12,13,12,13,14,14,14,14,15,16,16,16,17,17,16,13,13,13,13,13,14,14,15,16,16,16,16,16,16,15,16,14,13,14,14,
14,14,15,15,15,15,17,16,16,16,16,18,14,15,14,14,14,15,15,16,16,16,18,17,17,17,19,17,14,14,15,13,14,16,16,15,16,16,17,18,17,19,17,16,14,11,11,11,12,12,13,13,13,14,14,14,14,14,14,14,12],t16l:[1,5,7,9,10,10,11,11,12,12,12,13,13,13,14,10,4,6,8,9,10,11,11,11,12,12,12,13,14,13,14,10,7,8,9,10,11,11,12,12,13,12,13,13,13,14,14,11,9,9,10,11,11,12,12,12,13,13,14,14,14,15,15,12,10,10,11,11,12,12,13,13,13,14,14,14,15,15,15,11,10,10,11,11,12,13,13,14,13,14,14,15,15,15,16,12,11,11,11,12,13,13,13,13,14,14,14,14,
15,15,16,12,11,11,12,12,13,13,13,14,14,15,15,15,15,17,17,12,11,12,12,13,13,13,14,14,15,15,15,15,16,16,16,12,12,12,12,13,13,14,14,15,15,15,15,16,15,16,15,13,12,13,12,13,14,14,14,14,15,16,16,16,17,17,16,12,13,13,13,13,14,14,15,16,16,16,16,16,16,15,16,13,13,14,14,14,14,15,15,15,15,17,16,16,16,16,18,13,15,14,14,14,15,15,16,16,16,18,17,17,17,19,17,13,14,15,13,14,16,16,15,16,16,17,18,17,19,17,16,13,10,10,10,11,11,12,12,12,13,13,13,13,13,13,13,10],t24l:[4,5,7,8,9,10,10,11,11,12,12,12,12,12,13,10,5,6,7,8,
9,10,10,11,11,11,12,12,12,12,12,10,7,7,8,9,9,10,10,11,11,11,11,12,12,12,13,9,8,8,9,9,10,10,10,11,11,11,11,12,12,12,12,9,9,9,9,10,10,10,10,11,11,11,12,12,12,12,13,9,10,9,10,10,10,10,11,11,11,11,12,12,12,12,12,9,10,10,10,10,10,11,11,11,11,12,12,12,12,12,13,9,11,10,10,10,11,11,11,11,12,12,12,12,12,13,13,10,11,11,11,11,11,11,11,11,11,12,12,12,12,13,13,10,11,11,11,11,11,11,11,12,12,12,12,12,13,13,13,10,12,11,11,11,11,12,12,12,12,12,12,13,13,13,13,10,12,12,11,11,11,12,12,12,12,12,12,13,13,13,13,10,12,12,
12,12,12,12,12,12,12,12,13,13,13,13,13,10,12,12,12,12,12,12,12,12,13,13,13,13,13,13,13,10,13,12,12,12,12,12,12,13,13,13,13,13,13,13,13,10,9,9,9,9,9,9,9,9,9,9,9,10,10,10,10,6],t32l:[1,5,5,7,5,8,7,9,5,7,7,9,7,9,9,10],t33l:[4,5,5,6,5,6,6,7,5,6,6,7,6,7,7,8]};w.ht=[new U(0,0,null,null),new U(2,0,w.t1HB,w.t1l),new U(3,0,w.t2HB,w.t2l),new U(3,0,w.t3HB,w.t3l),new U(0,0,null,null),new U(4,0,w.t5HB,w.t5l),new U(4,0,w.t6HB,w.t6l),new U(6,0,w.t7HB,w.t7l),new U(6,0,w.t8HB,w.t8l),new U(6,0,w.t9HB,w.t9l),new U(8,
0,w.t10HB,w.t10l),new U(8,0,w.t11HB,w.t11l),new U(8,0,w.t12HB,w.t12l),new U(16,0,w.t13HB,w.t13l),new U(0,0,null,w.t16_5l),new U(16,0,w.t15HB,w.t15l),new U(1,1,w.t16HB,w.t16l),new U(2,3,w.t16HB,w.t16l),new U(3,7,w.t16HB,w.t16l),new U(4,15,w.t16HB,w.t16l),new U(6,63,w.t16HB,w.t16l),new U(8,255,w.t16HB,w.t16l),new U(10,1023,w.t16HB,w.t16l),new U(13,8191,w.t16HB,w.t16l),new U(4,15,w.t24HB,w.t24l),new U(5,31,w.t24HB,w.t24l),new U(6,63,w.t24HB,w.t24l),new U(7,127,w.t24HB,w.t24l),new U(8,255,w.t24HB,w.t24l),
new U(9,511,w.t24HB,w.t24l),new U(11,2047,w.t24HB,w.t24l),new U(13,8191,w.t24HB,w.t24l),new U(0,0,w.t32HB,w.t32l),new U(0,0,w.t33HB,w.t33l)];w.largetbl=[65540,327685,458759,589832,655369,655370,720906,720907,786443,786444,786444,851980,851980,851980,917517,655370,262149,393222,524295,589832,655369,720906,720906,720907,786443,786443,786444,851980,917516,851980,917516,655370,458759,524295,589832,655369,720905,720906,786442,786443,851979,786443,851979,851980,851980,917516,917517,720905,589832,589832,
655369,720905,720906,786442,786442,786443,851979,851979,917515,917516,917516,983052,983052,786441,655369,655369,720905,720906,786442,786442,851978,851979,851979,917515,917516,917516,983052,983052,983053,720905,655370,655369,720906,720906,786442,851978,851979,917515,851979,917515,917516,983052,983052,983052,1048588,786441,720906,720906,720906,786442,851978,851979,851979,851979,917515,917516,917516,917516,983052,983052,1048589,786441,720907,720906,786442,786442,851979,851979,851979,917515,917516,983052,
983052,983052,983052,1114125,1114125,786442,720907,786443,786443,851979,851979,851979,917515,917515,983051,983052,983052,983052,1048588,1048589,1048589,786442,786443,786443,786443,851979,851979,917515,917515,983052,983052,983052,983052,1048588,983053,1048589,983053,851978,786444,851979,786443,851979,917515,917516,917516,917516,983052,1048588,1048588,1048589,1114125,1114125,1048589,786442,851980,851980,851979,851979,917515,917516,983052,1048588,1048588,1048588,1048588,1048589,1048589,983053,1048589,
851978,851980,917516,917516,917516,917516,983052,983052,983052,983052,1114124,1048589,1048589,1048589,1048589,1179661,851978,983052,917516,917516,917516,983052,983052,1048588,1048588,1048589,1179661,1114125,1114125,1114125,1245197,1114125,851978,917517,983052,851980,917516,1048588,1048588,983052,1048589,1048589,1114125,1179661,1114125,1245197,1114125,1048589,851978,655369,655369,655369,720905,720905,786441,786441,786441,851977,851977,851977,851978,851978,851978,851978,655366];w.table23=[65538,262147,
458759,262148,327684,458759,393222,458759,524296];w.table56=[65539,262148,458758,524296,262148,327684,524294,589831,458757,524294,589831,655368,524295,524295,589832,655369];w.bitrate_table=[[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,-1],[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,-1],[0,8,16,24,32,40,48,56,64,-1,-1,-1,-1,-1,-1,-1]];w.samplerate_table=[[22050,24E3,16E3,-1],[44100,48E3,32E3,-1],[11025,12E3,8E3,-1]];w.scfsi_band=[0,6,11,16,21];ia.Q_MAX=257;ia.Q_MAX2=116;ia.LARGE_BITS=1E5;
ia.IXMAX_VAL=8206;var sa={};sa.SFBMAX=3*c.SBMAX_s;c.ENCDELAY=576;c.POSTDELAY=1152;c.MDCTDELAY=48;c.FFTOFFSET=224+c.MDCTDELAY;c.DECDELAY=528;c.SBLIMIT=32;c.CBANDS=64;c.SBPSY_l=21;c.SBPSY_s=12;c.SBMAX_l=22;c.SBMAX_s=13;c.PSFB21=6;c.PSFB12=6;c.BLKSIZE=1024;c.HBLKSIZE=c.BLKSIZE/2+1;c.BLKSIZE_s=256;c.HBLKSIZE_s=c.BLKSIZE_s/2+1;c.NORM_TYPE=0;c.START_TYPE=1;c.SHORT_TYPE=2;c.STOP_TYPE=3;c.MPG_MD_LR_LR=0;c.MPG_MD_LR_I=1;c.MPG_MD_MS_LR=2;c.MPG_MD_MS_I=3;c.fircoef=[-.1039435,-.1892065,-.0432472*5,-.155915,3.898045E-17,
.0467745*5,.50455,.756825,.187098*5];da.MFSIZE=3456+c.ENCDELAY-c.MDCTDELAY;da.MAX_HEADER_BUF=256;da.MAX_BITS_PER_CHANNEL=4095;da.MAX_BITS_PER_GRANULE=7680;da.BPC=320;Fa.RIFF=cc("RIFF");Fa.WAVE=cc("WAVE");Fa.fmt_=cc("fmt ");Fa.data=cc("data");Fa.readHeader=function(c){var k=new Fa,n=c.getUint32(0,!1);if(Fa.RIFF==n&&(c.getUint32(4,!0),Fa.WAVE==c.getUint32(8,!1)&&Fa.fmt_==c.getUint32(12,!1))){var u=c.getUint32(16,!0),w=20;switch(u){case 16:case 18:k.channels=c.getUint16(w+2,!0);k.sampleRate=c.getUint32(w+
4,!0);break;default:throw"extended fmt chunk not implemented";}w+=u;u=Fa.data;for(var B=0;u!=n;){n=c.getUint32(w,!1);B=c.getUint32(w+4,!0);if(u==n)break;w+=B+8}k.dataLen=B;k.dataOffset=w+8;return k}};sa.SFBMAX=3*c.SBMAX_s;lamejs.Mp3Encoder=function(c,k,n){3!=arguments.length&&(console.error("WARN: Mp3Encoder(channels, samplerate, kbps) not specified"),c=1,k=44100,n=128);var u=new W,w=new Kc,B=new Y,G=new qa,f=new wc,b=new ia,v=new Ec,a=new zb,m=new mc,z=new Nc,e=new xc,l=new qb,d=new Lc,g=new Mc;
u.setModules(B,G,f,b,v,a,m,z,g);G.setModules(B,g,m,a);z.setModules(G,m);f.setModules(u);v.setModules(G,e,b,l);b.setModules(l,e,u.enc.psy);e.setModules(G);l.setModules(b);a.setModules(u,G,m);w.setModules(d,g);d.setModules(m,z,f);var q=u.lame_init();q.num_channels=c;q.in_samplerate=k;q.brate=n;q.mode=la.STEREO;q.quality=3;q.bWriteVbrTag=!1;q.disable_reservoir=!0;q.write_id3tag_automatic=!1;u.lame_init_params(q);var D=1152,p=0|1.25*D+7200,r=new Int8Array(p);this.encodeBuffer=function(a,b){1==c&&(b=a);
a.length>D&&(D=a.length,p=0|1.25*D+7200,r=new Int8Array(p));a=u.lame_encode_buffer(q,a,b,a.length,r,0,p);return new Int8Array(r.subarray(0,a))};this.flush=function(){var a=u.lame_encode_flush(q,r,0,p);return new Int8Array(r.subarray(0,a))}};lamejs.WavHeader=Fa}lamejs();

            return typeof lamejs !== 'undefined' ? lamejs : null;
        })();
        if (typeof window !== 'undefined') window.lamejs = lamejs;
        if (typeof globalThis !== 'undefined') globalThis.lamejs = lamejs;

        let finishMusicPicker = null;
        let cancelMusicPicker = null;
        function openCustomMusicPicker(button, input) {
            if (!input || finishMusicPicker) return;
            finishMusicPicker = beginActionFeedback(button);
            cancelMusicPicker = () => {
                if (finishMusicPicker) finishMusicPicker('idle');
                finishMusicPicker = null;
                cancelMusicPicker = null;
            };
            input.addEventListener('cancel', cancelMusicPicker, {once: true});
            try { input.click(); } catch (_) { cancelMusicPicker(); }
        }
        function handleCustomMusicFileSelected(input) {
            const file = input?.files?.[0];
            if (cancelMusicPicker) input.removeEventListener('cancel', cancelMusicPicker);
            cancelMusicPicker = null;
            const nameEl = document.getElementById('custom-music-file-name');
            if (!file) {
                if (finishMusicPicker) finishMusicPicker('idle');
                finishMusicPicker = null;
                if (nameEl) {
                    nameEl.textContent = '未选择任何文件';
                    nameEl.className = 'font-mono text-xs text-neutral-500 max-w-[280px] whitespace-nowrap';
                }
                return;
            }

            // 1. 时长预检门禁（上限 15 分钟 = 900 秒）：直接报错拦截拒传，绝不暴力切割
            if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Audio !== 'undefined') {
                try {
                    const tempProbeUrl = URL.createObjectURL(file);
                    const probeAudio = new Audio();
                    probeAudio.src = tempProbeUrl;
                    probeAudio.onloadedmetadata = () => {
                        try { URL.revokeObjectURL(tempProbeUrl); } catch (_) {}
                        const maxSec = 15 * 60; // 15 分钟
                        if (probeAudio.duration > maxSec) {
                            input.value = '';
                            if (finishMusicPicker) finishMusicPicker('error');
                            finishMusicPicker = null;
                            if (nameEl) {
                                const mins = Math.round(probeAudio.duration / 60);
                                nameEl.textContent = `[ 时长超限: 约 ${mins} 分钟 // 超过 15 分钟上限，已拒传 ]`;
                                nameEl.className = 'font-mono text-xs tone-fault max-w-[340px] whitespace-nowrap';
                            }
                            // 动效闭环：输入横线变红颤抖 + 右侧3D圆圈变红抖动 + 报错音效
                            const inputLine = document.getElementById('custom-music-name-input') || (nameEl ? nameEl.parentElement : null);
                            if (inputLine && inputLine.style) {
                                inputLine.style.borderBottomColor = '#ff5c74';
                                inputLine.classList.remove('input-error-shake');
                                void inputLine.offsetWidth;
                                inputLine.classList.add('input-error-shake');
                                setTimeout(() => {
                                    inputLine.style.borderBottomColor = '';
                                    inputLine.classList.remove('input-error-shake');
                                }, 650);
                            }
                            if (typeof setPreviewFrameState === 'function') setPreviewFrameState('error', 800);
                            if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerErrorSound === 'function') {
                                soundscape.triggerErrorSound();
                            }
                            notifyEditorialStatus('MUSIC // DURATION > 15 MINS (REJECTED)');
                            return;
                        }
                    };
                    probeAudio.onerror = () => {
                        try { URL.revokeObjectURL(tempProbeUrl); } catch (_) {}
                    };
                } catch (_) {}
            }

            if (finishMusicPicker) finishMusicPicker('success');
            finishMusicPicker = null;
            if (nameEl) {
                const isOver50M = file.size > 50 * 1024 * 1024;
                const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
                nameEl.textContent = isOver50M ? `${file.name} (${sizeMb}MB > 50MB, 上传将自动进行320k压缩)` : `${file.name} (${sizeMb}MB)`;
                nameEl.className = 'font-mono text-xs text-neutral-300 fade-out-tail flex-1 min-w-0';
            }
            const nameInp = document.getElementById('custom-music-name-input');
            if (nameInp && !nameInp.value.trim()) {
                const baseName = file.name.replace(/\.[^/.]+$/, '');
                nameInp.value = baseName;
            }
        }

        let musicQueue = Promise.resolve();
        function queueMusic(task) {
            const result = musicQueue.then(task);
            musicQueue = result.catch(() => {});
            return result;
        }
        function applyMusicState(state) {
            const cust = WBState.customization;
            cust.musicList = state.musicList;
            cust.activeMusicId = state.activeMusicId;
            cust.randomMusic = state.randomMusic;
            // 持久化用户选定的音乐 ID 与 URL，确保在未登录首屏即可播放用户选择的音乐
            const curMusic = Array.isArray(cust.musicList) ? cust.musicList.find(m => m.id === cust.activeMusicId) : null;
            if (curMusic && typeof localStorage !== 'undefined') {
                try {
                    localStorage.setItem('wb_active_music_id', curMusic.id || '');
                    localStorage.setItem('wb_active_music_url', curMusic.url || '');
                } catch (_) {}
            }
            updateEditorialKeyFigures(false);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
        }

        async function compressAudioTo320kMp3(file, onStatus) {
            const AudioContextClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || (typeof AudioContext !== 'undefined' ? AudioContext : null);
            if (!AudioContextClass) throw new Error('NO_AUDIO_CONTEXT');
            const OfflineContextClass = (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext)) || (typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null);
            if (!OfflineContextClass) throw new Error('NO_OFFLINE_AUDIO_CONTEXT');

            if (onStatus) onStatus('MUSIC // DECODING AUDIO...');
            const arrayBuffer = await file.arrayBuffer();
            const audioCtx = new AudioContextClass();
            let decodedBuffer;
            try {
                decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            } finally {
                try { if (typeof audioCtx.close === 'function') audioCtx.close(); } catch (_) {}
            }
            if (!decodedBuffer) throw new Error('DECODE_FAILED');

            // 时长硬门禁：上限 15 分钟（900 秒），直接报错绝不切割
            if (decodedBuffer.duration > 15 * 60) {
                throw new Error('DURATION_EXCEEDED');
            }

            if (onStatus) onStatus('MUSIC // RESAMPLING TO 44.1KHZ CD MASTER...');
            const targetRate = 44100;
            const targetChannels = Math.min(2, decodedBuffer.numberOfChannels || 2);
            const targetFrames = Math.ceil(decodedBuffer.duration * targetRate);
            const offlineCtx = new OfflineContextClass(targetChannels, targetFrames, targetRate);
            const src = offlineCtx.createBufferSource();
            src.buffer = decodedBuffer;
            src.connect(offlineCtx.destination);
            src.start(0);
            const resampled = await offlineCtx.startRendering();

            if (onStatus) onStatus('MUSIC // ENCODING TO 320K MP3...');
            const totalSamples = resampled.length;
            const leftFloat = resampled.getChannelData(0);
            const rightFloat = targetChannels > 1 ? resampled.getChannelData(1) : leftFloat;

            const left16 = new Int16Array(totalSamples);
            const right16 = new Int16Array(totalSamples);
            for (let i = 0; i < totalSamples; i++) {
                let s0 = leftFloat[i];
                left16[i] = s0 < 0 ? Math.max(-32768, Math.floor(s0 * 32768)) : Math.min(32767, Math.floor(s0 * 32767));
                let s1 = rightFloat[i];
                right16[i] = s1 < 0 ? Math.max(-32768, Math.floor(s1 * 32768)) : Math.min(32767, Math.floor(s1 * 32767));
            }

            const Lame = (typeof window !== 'undefined' && window.lamejs) || (typeof globalThis !== 'undefined' && globalThis.lamejs) || (typeof lamejs !== 'undefined' ? lamejs : null);
            if (!Lame || typeof Lame.Mp3Encoder !== 'function') {
                throw new Error('NO_LAME_ENCODER');
            }

            const mp3encoder = new Lame.Mp3Encoder(targetChannels, targetRate, 320);
            const mp3Chunks = [];
            const sampleBlock = 1152;
            for (let i = 0; i < totalSamples; i += sampleBlock) {
                const l = left16.subarray(i, i + sampleBlock);
                const r = right16.subarray(i, i + sampleBlock);
                const chunk = mp3encoder.encodeBuffer(l, r);
                if (chunk && chunk.length > 0) mp3Chunks.push(chunk);
            }
            const endChunk = mp3encoder.flush();
            if (endChunk && endChunk.length > 0) mp3Chunks.push(endChunk);

            return new Blob(mp3Chunks, { type: 'audio/mpeg' });
        }


        if (typeof window !== 'undefined') {
            window.compressAudioTo320kMp3 = compressAudioTo320kMp3;
            window.saveCustomMusic = saveCustomMusic;
            window.applyCurrentMottoToHome = applyCurrentMottoToHome;
            window.pageTransition = pageTransition;
        }
        function saveCustomMusic() {
            const name = document.getElementById('custom-music-name-input')?.value.trim();
            const file = document.getElementById('custom-music-file-hidden')?.files?.[0];
            const types = { mp3:'audio/mpeg', wav:'audio/wav', flac:'audio/flac', m4a:'audio/mp4', aac:'audio/aac', ogg:'audio/ogg', opus:'audio/ogg', webm:'audio/webm' };
            const mime = file?.type?.startsWith('audio/') ? file.type : types[file?.name?.split('.').pop().toLowerCase()];
            const line = document.getElementById('custom-music-name-input');
            const finishFeedback = beginActionFeedback(line);
            if (!name || !file || !mime || !file.size) {
                finishFeedback('error');
                notifyEditorialStatus('MUSIC // ENTER A NAME AND SELECT AN AUDIO FILE');
                return;
            }
            return queueMusic(async () => {
                const started = Date.now();
                let uploadPayload = file;
                let uploadMime = mime;

                // 2. 体积策略分流：小于等于 50MB 直接放行原文件；大于 50MB 启动 320k 压缩管线
                if (file.size > 50 * 1024 * 1024) {
                    notifyEditorialStatus('MUSIC // FILE > 50MB, COMPRESSING TO 320K MP3...');
                    try {
                        const compressedBlob = await compressAudioTo320kMp3(file, statusText => {
                            notifyEditorialStatus(statusText);
                        });
                        if (!compressedBlob || compressedBlob.size === 0) {
                            throw new Error('COMPRESSION_EMPTY');
                        }
                        uploadPayload = compressedBlob;
                        uploadMime = 'audio/mpeg';
                        const origMb = (file.size / 1048576).toFixed(1);
                        const compMb = (compressedBlob.size / 1048576).toFixed(1);
                        notifyEditorialStatus('MUSIC // COMPRESSED: ' + origMb + 'MB -> ' + compMb + 'MB // UPLOADING...');
                    } catch (e) {
                        finishFeedback('error');
                        const inputLine = document.getElementById('custom-music-name-input');
                        if (inputLine && inputLine.style) {
                            inputLine.style.borderBottomColor = '#ff5c74';
                            inputLine.classList.remove('input-error-shake');
                            void inputLine.offsetWidth;
                            inputLine.classList.add('input-error-shake');
                            setTimeout(() => {
                                inputLine.style.borderBottomColor = '';
                                inputLine.classList.remove('input-error-shake');
                            }, 650);
                        }
                        if (typeof setPreviewFrameState === 'function') setPreviewFrameState('error', 800);
                        if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerErrorSound === 'function') {
                            soundscape.triggerErrorSound();
                        }
                        if (e && e.message === 'DURATION_EXCEEDED') {
                            notifyEditorialStatus('MUSIC // DURATION > 15 MINS (REJECTED)');
                        } else {
                            notifyEditorialStatus('MUSIC // 转码失败，建议使用工具转为 320k MP3 后上传');
                        }
                        return;
                    }
                }

                const result = await safeApiFetch('/panel/api/music/upload', {method:'POST', headers:{'Content-Type':uploadMime, 'X-Audio-Name':encodeURIComponent(name)}, body:uploadPayload}, 0x7fffffff);
                await new Promise(resolve => setTimeout(resolve, Math.max(0, 350 - (Date.now() - started))));
                if (!result || !Array.isArray(result.musicList)) {
                    finishFeedback('error');
                    const inputLine = document.getElementById('custom-music-name-input');
                    if (inputLine && inputLine.style) {
                        inputLine.style.borderBottomColor = '#ff5c74';
                        inputLine.classList.remove('input-error-shake');
                        void inputLine.offsetWidth;
                        inputLine.classList.add('input-error-shake');
                        setTimeout(() => {
                            inputLine.style.borderBottomColor = '';
                            inputLine.classList.remove('input-error-shake');
                        }, 650);
                    }
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('error', 800);
                    if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerErrorSound === 'function') {
                        soundscape.triggerErrorSound();
                    }
                    notifyEditorialStatus('MUSIC // SAVE FAILED');
                    return;
                }
                finishFeedback('success');
                await new Promise(resolve => setTimeout(resolve, 500));
                WBState.customization.isAdding = false;
                applyMusicState(result);
                soundscape.triggerTileNote(8);
                notifyEditorialStatus('MUSIC', 'IMPORTED -> ' + name);
            });
        }
        function musicAction(action, id) {
            return queueMusic(async () => {
                if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                const result = await safeApiFetch('/panel/api/music/action', {method:'POST', body:JSON.stringify({action, id})}, 30000);
                if (!result || !Array.isArray(result.musicList)) {
                    setPreviewFrameState('error', 800); notifyEditorialStatus('MUSIC // SAVE FAILED'); return;
                }
                applyMusicState(result);
                const current = result.musicList.find(m => m.id === result.activeMusicId);
                if (current) soundscape.playCustomBackgroundTrack(current.url, current.isDefault || current.id === 'm-default');
                setPreviewFrameState('success', 800);
            });
        }
        function selectCustomMusic(id) { return musicAction('select', id); }
        function deleteCustomMusic(id) { return musicAction('delete', id); }

        async function saveCustomSlogan() {
            const nameInp = document.getElementById('custom-slogan-name-input');
            const textInp = document.getElementById('custom-slogan-text-input');
            const name = (nameInp ? nameInp.value.trim() : '') || 'Custom Motto ' + (WBState.customization.sloganList.length + 1);
            let text = (textInp ? textInp.value.trim() : '') || '极简代码与静默守候。';
            if (text.length > 50) text = text.slice(0, 50);

            if (!nameInp?.value.trim() || !textInp?.value.trim()) {
                const targetInp = !nameInp?.value.trim() ? nameInp : textInp;
                targetInp?.classList.remove('input-error-shake');
                targetInp?.style.setProperty('border-bottom-color', '#ff5c74', 'important');
                void targetInp?.offsetWidth;
                targetInp?.classList.add('input-error-shake');
                setPreviewFrameState('error', 700);
                setTimeout(() => {
                    targetInp?.classList.remove('input-error-shake');
                    targetInp?.style.removeProperty('border-bottom-color');
                }, 750);
                notifyEditorialStatus('MOTTO // PLEASE FILL IN TITLE & CONTENT');
                return;
            }

            const newId = 's-' + Date.now();
            const now = new Date();
            const dateStr = now.toISOString().slice(0, 16).replace('T', ' ');

            const item = { id: newId, date: dateStr, name, text };
            const nextList = [item, ...WBState.customization.sloganList];
            const nextCustomization = { ...WBState.customization, sloganList: nextList, activeSloganId: newId, isAdding: false };
            WBState.customization.sloganList = nextList;
            WBState.customization.activeSloganId = newId;
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('wb_active_slogan_id', newId);
                    localStorage.setItem('wb_slogan_list', JSON.stringify(nextList));
                }
            } catch (_) {}
            const finishFeedback = beginActionFeedback(textInp);
            const started = Date.now();
            const result = IS_PROD_ENV ? await safeApiFetch('/panel/api/customization', { method: 'POST', body: JSON.stringify({ customization: nextCustomization }) }, 30000) : { ok: true };
            await new Promise(resolve => setTimeout(resolve, Math.max(0, 350 - (Date.now() - started))));
            if (!result || result.ok !== true) {
                finishFeedback('error');
                notifyEditorialStatus('MOTTO // SAVE FAILED');
                return;
            }
            finishFeedback('success');
            await new Promise(resolve => setTimeout(resolve, 500));
            WBState.customization = nextCustomization;
            soundscape.triggerTileNote(8);
            notifyEditorialStatus('MOTTO', 'IMPORTED -> ' + name);
            applyCurrentMottoToHome();
            updateEditorialKeyFigures(false);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
        }

        async function syncCustomizationToBackend() {
            if (!IS_PROD_ENV) return;
            try {
                const payload = {
                    sloganList: WBState.customization.sloganList,
                    activeSloganId: WBState.customization.activeSloganId,
                    randomMotto: WBState.customization.randomMotto,
                    activeTheme: WBState.customization.activeTheme,
                    randomTheme: WBState.customization.randomTheme
                };
                await safeApiFetch('/panel/api/customization', {
                    method: 'POST',
                    body: JSON.stringify({ customization: payload })
                }, 10000);
            } catch (e) {
                console.warn('Sync customization to backend failed:', e);
            }
        }

        function selectCustomSlogan(id) {
            WBState.customization.randomMotto = false;
            WBState.customization.activeSloganId = id; try { if (typeof localStorage !== 'undefined') { localStorage.setItem('wb_active_slogan_id', id); localStorage.setItem('wb_slogan_list', JSON.stringify(WBState.customization.sloganList)); } } catch (_) {}
            const s = WBState.customization.sloganList.find(x => x.id === id);
            soundscape.triggerTileNote(5);
            notifyEditorialStatus('MOTTO', 'SET -> ' + (s ? s.name : id));
            applyCurrentMottoToHome();
            updateEditorialKeyFigures(false);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
            syncCustomizationToBackend();
        }

        function deleteCustomSlogan(id) {
            WBState.customization.sloganList = WBState.customization.sloganList.filter(x => x.id !== id);
            if (WBState.customization.activeSloganId === id && WBState.customization.sloganList.length > 0) {
                WBState.customization.activeSloganId = WBState.customization.sloganList[0].id;
                applyCurrentMottoToHome();
            }
            soundscape.triggerTileNote(2);
            updateEditorialKeyFigures(false);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
            syncCustomizationToBackend();
        }

        function selectCustomTheme(themeId) {
            WBState.customization.randomTheme = false;
            WBState.customization.activeTheme = themeId;
            soundscape.triggerTileNote(2);
            notifyEditorialStatus('THEME', 'APPLIED -> ' + themeId.toUpperCase());
            if (typeof switchWeatherTheme === 'function') switchWeatherTheme(themeId);
            updateEditorialKeyFigures(false);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
            try { if (typeof localStorage !== 'undefined') localStorage.setItem('wb_active_theme', themeId); } catch (_) {}
            syncCustomizationToBackend();
        }

        function cycleCustomTheme() {
            const themes = ['overcast', 'dusk', 'night'];
            const cur = WBState.customization.activeTheme;
            const remaining = themes.filter(t => t !== cur);
            const nextTheme = remaining[Math.floor(Math.random() * remaining.length)] || themes[0];
            selectCustomTheme(nextTheme);
        }

        function triggerRandomCustomization() {
            const cust = WBState.customization;
            soundscape.triggerTileNote(7);
            if (cust.currentTab === 'music') {
                const pool = cust.musicList;
                const pick = pool[Math.floor(Math.random() * pool.length)];
                if (pick) musicAction('random', pick.id);
                return;
            } else if (cust.currentTab === 'slogan') {
                cust.randomMotto = true;
                const pool = cust.sloganList;
                const pick = pool[Math.floor(Math.random() * pool.length)];
                cust.activeSloganId = pick.id;
                notifyEditorialStatus('RANDOM', 'MOTTO -> ' + pick.name);
                applyCurrentMottoToHome();
            } else if (cust.currentTab === 'theme') {
                cust.randomTheme = true;
                const themes = ['overcast', 'dusk', 'night'];
                const pick = themes[Math.floor(Math.random() * themes.length)];
                cust.activeTheme = pick;
                notifyEditorialStatus('RANDOM', 'THEME -> ' + pick.toUpperCase());
                if (typeof switchWeatherTheme === 'function') switchWeatherTheme(pick);
            }
            updateEditorialKeyFigures(false);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
        }

        function applyCurrentMottoToHome() {
            const cust = WBState.customization;
            const cur = cust.sloganList.find(s => s.id === cust.activeSloganId) || cust.sloganList[0];
            const subtitleEl = document.getElementById('prompt-subtitle');
            if (subtitleEl && cur) {
                subtitleEl.style.whiteSpace = 'pre-line';
                subtitleEl.classList.add('whitespace-pre-line', 'leading-relaxed');
                subtitleEl.textContent = cur.text;
            }
        }

        function switchChapterInPlace(chapterId) {
            setPreviewFrameState('idle');
            WBState.egressProbed = false;
            if (WBState.currentChapter === chapterId) return;
            soundscape.triggerTileNote(6);
            populateProjectPageContent(chapterId, true);
            const m = CHAPTER_META[chapterId];
            if (m) notifyEditorialStatus(`CHAPTER -> ${m.num} ${m.title} // ${m.geoLabel}`);
        }

        function triggerEnterNewPage(projectId, forcedMode = null) {
            if (pageTransition.state === 'IN_PAGE') {
                switchChapterInPlace(projectId);
                return;
            }
            if (pageTransition.state !== 'IDLE') return;

            // 三大进场动画共存轮换：保留原有 CARD_FLIP (牌面翻转) 与 DIFFUSION (全界面扩散)，并加入 PARTICLE_DISPERSE (中心向四周扩散向左粒子消散)
            const pref = WBState.configTransition;
            const chosenMode = forcedMode || (pref !== 'AUTO' ? pref : pickNextAutoTransitionMode());
            pageTransition.transitionType = chosenMode;
            pageTransition.state = 'EXPANDING_TO_PAGE';
            pageTransition.startTime = performance.now();

            // 重置网格各方块的粒子消散状态，清空残留粒子
            gridTiles.forEach(t => { t._disintegrated = false; });
            disperseTransitionParticles = [];

            populateProjectPageContent(projectId, true);

            const weatherBar = document.getElementById('weather-switcher');
            if (weatherBar) {
                weatherBar.style.transition = 'opacity 300ms ease';
                weatherBar.style.opacity = '0';
                weatherBar.style.pointerEvents = 'none';
            }

            soundscape.triggerTransitionSweep(true);
            if (projectId !== 'sphere') {
                let targetCol = null;
                let targetRow = null;

                let px = (typeof pageTransition.clickX === 'number') ? pageTransition.clickX : null;
                let py = (typeof pageTransition.clickY === 'number') ? pageTransition.clickY : null;

                if (px === null || py === null) {
                    if (typeof lastPointerX === 'number' && typeof lastPointerY === 'number') {
                        px = lastPointerX;
                        py = lastPointerY;
                    }
                }

                if (px !== null && py !== null) {
                    let bestTile = null, bestDist = Infinity;
                    for (let i = 0; i < gridTiles.length; i++) {
                        const gt = gridTiles[i];
                        const d = Math.hypot(px - gt.stableScreenX, py - gt.stableScreenY);
                        if (d < bestDist) { bestDist = d; bestTile = gt; }
                    }
                    if (bestTile) {
                        targetCol = bestTile.c;
                        targetRow = bestTile.r;
                    }
                }

                // 无指针（如快捷键）时兜底根据 PROJECTS 查找 targetCol/targetRow，绝不盲目回退到正中心
                if (targetCol === null || targetRow === null) {
                    const matchedProj = PROJECTS.find(p => p.id === projectId);
                    if (matchedProj) {
                        targetCol = matchedProj.col;
                        targetRow = matchedProj.row;
                    } else {
                        targetCol = Math.floor(GRID_COLS * 0.5);
                        targetRow = Math.floor(GRID_ROWS * 0.5);
                    }
                }

                pageTransition.originCol = targetCol;
                pageTransition.originRow = targetRow;
                spawnGridHighlightWave(targetCol, targetRow, 1.25, false);
            }

            const w = window.innerWidth;
            const h = window.innerHeight;
            const waterLineY = h * (4 / 7);
            for (let k = 0; k < 4; k++) {
                setTimeout(() => {
                    spawnPondRipple(
                        w * (0.35 + Math.random() * 0.3),
                        waterLineY + (h - waterLineY) * (0.25 + Math.random() * 0.5),
                        115 + k * 25,
                        0.82
                    );
                }, k * 140);
            }

            setTimeout(() => {
                projectPageView.classList.remove('hidden', 'pointer-events-none');
                projectPageView.classList.add('flex');
                requestAnimationFrame(() => {
                    projectPageView.style.opacity = '1';
                    const tagEl = document.getElementById('page-archive-tag');
                    const titleEl = document.getElementById('page-title');
                    const roleEl = document.getElementById('page-role');
                    if (tagEl) scrambleText(tagEl, tagEl.textContent, 320);
                    if (titleEl) scrambleText(titleEl, titleEl.textContent, 360);
                    if (roleEl) scrambleText(roleEl, roleEl.textContent, 340);
                    renderEditorialStage(true); // 进入内页时执行舞台初始动画
                });
            }, 640);
        }

        function triggerReturnToMatrix() {
            setPreviewFrameState('idle');
            WBState.egressProbed = false;
            if (pageTransition.state !== 'IN_PAGE' && pageTransition.state !== 'EXPANDING_TO_PAGE') return;

            soundscape.triggerTransitionSweep(false);
            projectPageView.style.opacity = '0';
            projectPageView.classList.add('pointer-events-none');

            const weatherBar = document.getElementById('weather-switcher');
            if (weatherBar) {
                weatherBar.style.opacity = '1';
                weatherBar.style.pointerEvents = 'auto';
            }

            pageTransition.state = 'CONVERGING_TO_GRID';
            pageTransition.startTime = performance.now();
            pageTransition.clickX = null;
            pageTransition.clickY = null;
            gridTiles.forEach(t => { t._disintegrated = false; });

            // 若当前为粒子模式，触发稀疏星尘微风汇聚重组动效
            if (pageTransition.transitionType === 'PARTICLE_DISPERSE') {
                spawnConvergingReturnParticles(gridTiles, blendedTheme);
            } else {
                disperseTransitionParticles = [];
            }

            const w = window.innerWidth;
            const h = window.innerHeight;
            const waterLineY = h * (4 / 7);
            spawnPondRipple(w * 0.5, waterLineY + (h - waterLineY) * 0.42, 130, 0.78);

            setTimeout(() => {
                projectPageView.classList.add('hidden');
                projectPageView.classList.remove('flex');
            }, 1020);
        }

        // 概览页秒级静默原地更新（In-Place DOM Mutation）：仅更新文本和曲线折点，绝不清空重建 DOM，彻底根除字体跳动
        function updateOverviewStageInPlace() {
            const isRes = WBState.overviewMode === 'RESOURCE';
            const leftHeaderEl = document.getElementById('ov-header-left');
            if (leftHeaderEl) {
                leftHeaderEl.textContent = isRes
                    ? '系统资源变动曲线（CPU负载 / 服务总内存）'
                    : '吞吐呼吸曲线（上行速率 / 下行速率）';
            }
            const rightHeaderEl = document.getElementById('ov-header-right');
            if (rightHeaderEl) {
                rightHeaderEl.textContent = isRes
                    ? ('CPU负载 ' + (WBState.cpuAvailable ? WBState.cpuPct.toFixed(1) + '%' : '—') + ' / 服务总内存 ' + (WBState.serviceMemoryAvailable ? WBState.memMb.toFixed(1) + ' MB' : '—'))
                    : (WBState.trafficAvailable
                        ? '上行速率 ' + WBState.upMbps.toFixed(2) + ' MB/s / 下行速率 ' + WBState.downMbps.toFixed(2) + ' MB/s'
                        : '上行速率 — / 下行速率 —');
            }
            const pPoly = document.getElementById('ov-poly-primary');
            const sPoly = document.getElementById('ov-poly-secondary');
            if (pPoly && sPoly) {
                const primaryArr = isRes ? WBState.cpuHistory : WBState.upHistory;
                const secondaryArr = isRes ? WBState.memHistory : WBState.downHistory;
                const [pPts, sPts] = overviewChartPoints(primaryArr, secondaryArr);
                pPoly.setAttribute('points', pPts);
                sPoly.setAttribute('points', sPts);
            }
            const metric1LblEl = document.getElementById('ov-lbl-metric1');
            const metric1CellEl = document.getElementById('ov-cell-metric1');
            const memValEl = document.getElementById('ov-val-mem');
            const uptimeValEl = document.getElementById('ov-val-uptime');

            if (metric1LblEl) {
                metric1LblEl.textContent = isRes ? '服务总内存' : '实时上行';
            }
            if (metric1CellEl) {
                metric1CellEl.setAttribute('data-hover-label', isRes ? `MEM // ${WBState.memMb.toFixed(1)}MB` : `UP // ${WBState.upMbps.toFixed(2)}MB/s`);
            }
            if (memValEl) {
                memValEl.textContent = isRes
                    ? (WBState.serviceMemoryAvailable ? WBState.memMb.toFixed(1) + ' MB' : '—')
                    : (WBState.trafficAvailable ? WBState.upMbps.toFixed(2) + ' MB/s' : '—');
            }
            if (uptimeValEl) uptimeValEl.textContent = formatUptime(WBState.uptimeSec);
        }

        let statusPollRunning = false;
        setInterval(async () => {
            if (!IS_PROD_ENV || !mainSceneActive || statusPollRunning) return;
            statusPollRunning = true;
            try {
                const overview = await safeApiFetch('/panel/api/overview', {}, 10000);
                if (overview) {
                    WBState.cpuAvailable = overview.service_cpu_available === true;
                    if (WBState.cpuAvailable) { WBState.cpuPct = overview.service_cpu_percent; WBState.cpuHistory.shift(); WBState.cpuHistory.push(WBState.cpuPct); }
                    WBState.serviceMemoryAvailable = overview.service_memory_available === true;
                    if (WBState.serviceMemoryAvailable) WBState.memMb = overview.service_memory_bytes / 1048576;
                }
                if (typeof overview?.uptime_sec === 'number') WBState.uptimeSec = overview.uptime_sec;
                const traffic = await safeApiFetch('/panel/api/meta/stats', {}, 10000);
                WBState.trafficAvailable = !!traffic && !traffic.demo && (!traffic.running || !!traffic.sampled_at);
                if (WBState.trafficAvailable) {
                    WBState.downMbps = traffic.download_speed / 1048576;
                    WBState.upMbps = traffic.upload_speed / 1048576;
                    WBState.downHistory.shift(); WBState.downHistory.push(WBState.downMbps);
                    WBState.upHistory.shift(); WBState.upHistory.push(WBState.upMbps);
                }
                if (WBState.serviceMemoryAvailable) {
                    WBState.memHistory.shift(); WBState.memHistory.push(WBState.memMb);
                }
                if (pageTransition.state === 'IN_PAGE' && ['tasks', 'scheduler'].includes(WBState.currentChapter)) {
                    const status = await safeApiFetch('/panel/api/maintenance/status', {}, 10000);
                    if (status && syncMaintenanceData(status)) renderEditorialStage(false);
                    const schedule = await safeApiFetch('/panel/api/tasks/schedule', {}, 10000);
                    if (schedule && syncTaskScheduleData(schedule)) updateTaskScheduleVisual(schedule.enabled, false);
                }
            } finally { statusPollRunning = false; }
        }, 10000);

        let isEmailCopying = false;
        let emailCopyTimer = null;
        function updateBottomRightUptime() {
            if (isEmailCopying) return;
            const el = document.getElementById('email-text');
            if (el) el.textContent = `[ UPTIME // ${formatUptime(WBState.uptimeSec)} ]`;
        }

        let telemetryPollRunning = false;
        async function sampleTelemetryNow() {
            if (!IS_PROD_ENV || telemetryPollRunning) return;
            telemetryPollRunning = true;
            try {
                const data = await safeApiFetch('/api/telemetry', {}, 1500);
                if (data) {
                    WBState.cpuAvailable = data.service_cpu_available === true;
                    if (WBState.cpuAvailable && typeof data.service_cpu_percent === 'number') {
                        WBState.cpuPct = data.service_cpu_percent;
                    }
                    WBState.serviceMemoryAvailable = data.service_memory_available === true;
                    if (WBState.serviceMemoryAvailable && typeof data.service_memory_bytes === 'number') {
                        WBState.memMb = data.service_memory_bytes / 1048576;
                    }
                    WBState.trafficAvailable = data.traffic_available === true;
                    if (WBState.trafficAvailable) {
                        WBState.upMbps = (Number(data.upload_speed) || 0) / 1048576;
                        WBState.downMbps = (Number(data.download_speed) || 0) / 1048576;
                    }
                    if (typeof data.uptime_sec === 'number') {
                        WBState.uptimeSec = data.uptime_sec;
                    }
                }
            } catch (e) {
                // Ignore transient telemetry error
            } finally {
                telemetryPollRunning = false;
            }
            WBState.cpuHistory.shift();  WBState.cpuHistory.push(WBState.cpuPct);
            WBState.memHistory.shift();  WBState.memHistory.push(WBState.memMb);
            WBState.upHistory.shift();   WBState.upHistory.push(WBState.upMbps);
            WBState.downHistory.shift(); WBState.downHistory.push(WBState.downMbps);

            if (pageTransition.state === 'IN_PAGE') {
                updateEditorialKeyFigures(false);
                if (['overview', 'gateway', 'sphere'].includes(WBState.currentChapter)) {
                    updateOverviewStageInPlace();
                }
            }
        }
        // 开屏立即进行首拍采样，无需等待1秒
        sampleTelemetryNow();

        // 秒级实时心跳：静默更新数值（animate=false，绝不重播入场动画或产生抖动）
        setInterval(() => {
            WBState.uptimeSec++;
            updateBottomRightUptime();
            if (IS_PROD_ENV) {
                sampleTelemetryNow();
                return;
            }
            let coolingChanged = false;
            WBState.accounts.forEach(acc => {
                if (acc.state === 'COOLING' && acc.coolSec > 0) {
                    acc.coolSec--;
                    if (acc.coolSec <= 0) {
                        acc.state = 'HEALTHY';
                        coolingChanged = true;
                    }
                }
            });

            WBState.downMbps = +(23.5 + Math.sin(Date.now() * 0.0013) * 3.8 + (Math.random() - 0.5) * 1.4).toFixed(2);
            WBState.upMbps   = +(1.35 + Math.cos(Date.now() * 0.0017) * 0.28 + (Math.random() - 0.5) * 0.12).toFixed(2);
            WBState.cpuPct   = +(14.5 + Math.sin(Date.now() * 0.0011) * 4.2 + (Math.random() - 0.5) * 1.6).toFixed(1);
            WBState.memMb    = +(48.2 + Math.cos(Date.now() * 0.0009) * 1.4 + (Math.random() - 0.5) * 0.4).toFixed(1);
            WBState.downHistory.shift(); WBState.downHistory.push(WBState.downMbps);
            WBState.upHistory.shift();   WBState.upHistory.push(WBState.upMbps);
            WBState.cpuHistory.shift();  WBState.cpuHistory.push(WBState.cpuPct);
            WBState.memHistory.shift();  WBState.memHistory.push(WBState.memMb);

            if (pageTransition.state === 'IN_PAGE') {
                updateEditorialKeyFigures(false);
                if (WBState.currentChapter === 'overview' || WBState.currentChapter === 'gateway' || WBState.currentChapter === 'sphere') {
                    // 心跳刷新：采用就地静默更新 (In-Place)，彻底杜绝清空重建 DOM 导致的字体乱跳
                    updateOverviewStageInPlace();
                } else if (WBState.currentChapter === 'accounts' && coolingChanged && !WBState.accountSubmode && !WBState.selectedAccountUid) {
                    renderEditorialStage(false);
                }
            }
        }, 1000);

        // ==================== 主场景与内页全量事件绑定 ====================
        worldCanvas.addEventListener('click', (e) => {
            if (pageTransition.state !== 'IDLE') return;
            pageTransition.clickX = e.clientX;
            pageTransition.clickY = e.clientY;

            // 1. 寻找屏幕点击位置最近的网格瓦片
            let closestTile = null;
            let minTileDist = Infinity;
            for (let i = 0; i < gridTiles.length; i++) {
                const t = gridTiles[i];
                const d = Math.hypot(e.clientX - t.stableScreenX, e.clientY - t.stableScreenY);
                if (d < minTileDist) {
                    minTileDist = d;
                    closestTile = t;
                }
            }

            // 若距离最近瓦片超过网格步长的 1.5 倍，判定为点击在边缘空白空旷区，绝不误触菜单项
            const maxAllowDist = closestTile ? (closestTile.screenSize * 1.5) : 80;
            if (closestTile && minTileDist <= maxAllowDist) {
                // 2. 严格限制判定范围：目标及周围 8 格构成的 3x3 (切比雪夫距离 <= 1)
                const cands = [];
                for (let i = 0; i < PROJECTS.length; i++) {
                    const p = PROJECTS[i];
                    if (Math.abs(p.col - closestTile.c) <= 1 && Math.abs(p.row - closestTile.r) <= 1) {
                        const distToProj = Math.hypot(closestTile.c - p.col, closestTile.r - p.row);
                        cands.push({ proj: p, dist: distToProj });
                    }
                }
                if (cands.length > 0) {
                    // 重叠区归最近目标
                    cands.sort((a, b) => a.dist - b.dist);
                    triggerEnterNewPage(cands[0].proj.id);
                    return;
                }

            }

            // 未命中 3x3 范围：仅产生局部轻柔水波与微扰动，绝不误触进入页面
            disturbGridAtScreenPos(e.clientX, e.clientY, 90, 12);
            const waterLineY = window.innerHeight * (4 / 7);
            spawnPondRipple(e.clientX, Math.max(e.clientY, waterLineY + 18), 65, 0.50);
        });

        function switchWeatherTheme(weatherKey) {
            if (!WEATHER_THEMES[weatherKey]) return;
            currentWeatherKey = weatherKey;
            document.querySelectorAll('#weather-switcher .weather-btn').forEach(b => {
                if (b.getAttribute('data-weather') === weatherKey) {
                    b.classList.add('active');
                } else {
                    b.classList.remove('active');
                }
            });
            if (window.WBState && WBState.customization) {
                WBState.customization.activeTheme = weatherKey; try { if (typeof localStorage !== 'undefined') localStorage.setItem('wb_active_theme', weatherKey); } catch (_) {}
                if (WBState.currentChapter === 'customization') {
                    updateEditorialKeyFigures(false);
                    renderEditorialStage(false);
                }
            }
            soundscape.triggerTileNote(6);
            spawnGridHighlightWave(Math.floor(GRID_COLS * 0.5), Math.floor(GRID_ROWS * 0.5), 0.95);
        }

        document.querySelectorAll('#weather-switcher .weather-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const weatherKey = btn.getAttribute('data-weather');
                switchWeatherTheme(weatherKey);
            });
        });

        document.querySelectorAll('#chapter-nav .chapter-link').forEach((btn) => {
            btn.addEventListener('click', () => {
                const ch = btn.getAttribute('data-chapter');
                if (ch) switchChapterInPlace(ch);
            });
        });

        const backGridBtn = document.getElementById('btn-back-to-grid');
        if (backGridBtn) {
            backGridBtn.addEventListener('mouseenter', () => {
                const target = backGridBtn.getAttribute('data-scramble') || backGridBtn.textContent.trim();
                scrambleText(backGridBtn, target, 240);
            });
        }
        ['btn-page-chord', 'btn-page-ripple'].forEach(btnId => {
            const el = document.getElementById(btnId);
            if (el) {
                el.addEventListener('mouseenter', () => {
                    const target = el.getAttribute('data-scramble') || '';
                    scrambleActionButton(el, target, 210);
                });
            }
        });

        previewCanvas.addEventListener('click', () => {
            [0, 3, 5, 8, 11].forEach((n, idx) => setTimeout(() => soundscape.triggerTileNote(n), idx * 80));
            notifyEditorialStatus('3D HARMONIC RESONANCE SWEEP');
        });

        document.getElementById('btn-toggle-sphere')?.addEventListener('click', () => {
            WBState.overrideSphere = !WBState.overrideSphere;
            const targetGeo = WBState.overrideSphere ? 'sphere' : (CHAPTER_META[WBState.currentChapter]?.geoId || 'overview');
            triggerInFrameGeometryMorph(targetGeo);
            soundscape.triggerTileNote(9);
        });

        // 底部按钮 1：高价值视角切换与核心写操作（含 Comment 9 拉取模型、Comment 17 时间-错误量数学模型）
        document.getElementById('btn-page-chord').addEventListener('click', () => {
            const ch = WBState.currentChapter;
            if (ch === 'sphere') {
                const btn1 = document.getElementById('btn-page-chord');
                if (WBState.sphereUpdateApplied) {
                    notifyEditorialStatus('UPDATE ALREADY INSTALLED // RESTART SERVICE TO ACTIVATE');
                    return;
                }
                if (!WBState.sphereUpdateReady) {
                    if (WBState.sphereCheckingUpdate) return;
                    WBState.sphereCheckingUpdate = true;
                    soundscape.triggerTileNote(7);
                    notifyEditorialStatus('CHECKING UPDATE // /panel/api/update/check');
                    if (btn1) {
                        btn1.classList.remove('border-white/50', 'border-rose-500', 'border-emerald-400');
                        btn1.classList.add('border-amber-400', 'text-amber-300', 'animate-pulse', 'bg-amber-400/10');
                    }
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                    syncDynamicBottomButtons();

                    const checkPromise = (typeof safeApiFetch === 'function')
                        ? safeApiFetch('/panel/api/update/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 15000, true)
                        : fetch('/panel/api/update/check', { method: 'POST' }).then(r => r.json()).catch(() => null);

                    Promise.all([
                        checkPromise,
                        new Promise(resolve => setTimeout(resolve, 800))
                    ]).then(([data]) => {
                        WBState.sphereCheckingUpdate = false;
                        if (data && data.ok !== false && data.has_update === false) {
                            WBState.sphereUpdateReady = false;
                            syncDynamicBottomButtons();
                            if (btn1) {
                                btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse', 'border-rose-500');
                                btn1.classList.add('border-emerald-400');
                                setTimeout(() => btn1.classList.remove('border-emerald-400'), 1200);
                            }
                            setPreviewFrameState('success', 1200);
                            notifyEditorialStatus('UPDATE CHECK COMPLETE // ALREADY UP TO DATE');
                        } else if (data && data.ok !== false && data.has_update === true && data.data?.artifact?.verified === true) {
                            WBState.sphereUpdateReady = true;
                            if (btn1) {
                                btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse', 'border-rose-500', 'border-white/50');
                                btn1.classList.add('border-emerald-400', 'text-emerald-300', 'bg-emerald-400/10');
                            }
                            setPreviewFrameState('success', 1200);
                            notifyEditorialStatus(`UPDATE AVAILABLE // V${String(data.current_version || '—').replace(/^v/i, '')} -> V${String(data.latest_version || '—').replace(/^v/i, '')}`);
                            syncDynamicBottomButtons();
                        } else if (data && data.ok !== false && data.has_update === true) {
                            throw new Error('no verified binary for this platform');
                        } else if (data && data.error) {
                            throw new Error(data.code ? `${data.code}: ${data.error}` : data.error);
                        } else {
                            throw new Error('Check failed');
                        }
                    }).catch((err) => {
                        WBState.sphereCheckingUpdate = false;
                        WBState.sphereUpdateReady = false;
                        syncDynamicBottomButtons();
                        if (btn1) {
                            btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse', 'border-emerald-400');
                            btn1.classList.add('border-rose-500', 'text-rose-400', 'canvas-fault-jolt');
                            setTimeout(() => { btn1.classList.remove('canvas-fault-jolt'); if (WBState.currentChapter === 'sphere') syncDynamicBottomButtons(); }, 1200);
                        }
                        setPreviewFrameState('error', 800);
                        notifyEditorialStatus(err && err.message && err.message !== 'Check failed'
                            ? `UPDATE CHECK FAILED // ${String(err.message).toUpperCase()}`
                            : 'UPDATE CHECK FAILED // CLICK TO RETRY');
                    });
                } else {
                    if (WBState.sphereUpdating) {
                        notifyEditorialStatus('UPDATE IN PROGRESS');
                        return;
                    }
                    WBState.sphereUpdating = true;
                    soundscape.triggerTileNote(11);
                    if (btn1) {
                        btn1.classList.remove('border-emerald-400', 'text-emerald-300', 'bg-emerald-400/10');
                        btn1.classList.add('border-amber-400', 'text-amber-300', 'animate-pulse', 'bg-amber-400/10');
                    }
                    notifyEditorialStatus('APPLYING UPDATE // /panel/api/update/apply');
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                    syncDynamicBottomButtons();

                    const applyPromise = (typeof safeApiFetch === 'function')
                        ? safeApiFetch('/panel/api/update/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 0x7fffffff, true)
                        : fetch('/panel/api/update/apply', { method: 'POST' }).then(r => r.json()).catch(() => null);

                    applyPromise.then(data => {
                        if (!data || data.ok !== true) {
                            throw new Error(data && data.error ? (data.code ? `${data.code}: ${data.error}` : data.error) : 'verified update is unavailable');
                        }
                        WBState.sphereUpdateApplied = true;
                        WBState.sphereUpdateReady = false;
                        WBState.sphereUpdating = false;
                        if (btn1) {
                            btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse');
                            btn1.classList.add('border-emerald-400', 'text-emerald-300');
                        }
                        setPreviewFrameState('success', 1000);
                        syncDynamicBottomButtons();
                        notifyEditorialStatus('UPDATE INSTALLED // RESTART SERVICE TO ACTIVATE');
                    }).catch((err) => {
                        WBState.sphereUpdating = false;
                        syncDynamicBottomButtons();
                        if (btn1) {
                            btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse');
                            btn1.classList.add('border-rose-500', 'text-rose-400', 'canvas-fault-jolt');
                            setTimeout(() => { btn1.classList.remove('canvas-fault-jolt'); if (WBState.currentChapter === 'sphere') syncDynamicBottomButtons(); }, 1200);
                        }
                        setPreviewFrameState('error', 800);
                        notifyEditorialStatus(err && err.message && err.message !== 'verified update is unavailable'
                            ? `UPDATE FAILED // ${String(err.message).toUpperCase()}`
                            : 'UPDATE FAILED');
                    });
                }
                return;
            }

// second ch removed
            if (ch === 'customization') {
                const cust = WBState.customization;
                if (cust.isAdding) {
                    cancelCustomAdd();
                } else if (cust.currentTab === 'music' || cust.currentTab === 'slogan') {
                    cust.isAdding = true;
                    renderEditorialStage(true);
                    syncDynamicBottomButtons();
                } else if (cust.currentTab === 'theme') {
                    cycleCustomTheme();
                }
                return;
            }
            soundscape.triggerTileNote(8);
            if (ch === 'overview' || ch === 'gateway') {
                WBState.overviewMode = WBState.overviewMode === 'TRAFFIC' ? 'RESOURCE' : 'TRAFFIC';
                try { if (typeof localStorage !== 'undefined') localStorage.setItem('wb_overview_mode', WBState.overviewMode); } catch (_) {}
                notifyEditorialStatus(WBState.overviewMode === 'RESOURCE' ? 'VIEW -> CPU & MEMORY CURVE' : 'VIEW -> NETWORK THROUGHPUT CURVE');
                renderEditorialStage(true);
            } else if (ch === 'accounts') {
                if (WBState.selectedAccountUid || WBState.selectingSystemDefault) {
                    WBState.selectedAccountUid = null;
                    WBState.selectingSystemDefault = false;
                    WBState.frozenAccountNodeIds = null;
                    WBState.frozenAccountNodesUid = null;
                    soundscape.triggerTileNote(4);
                    updateEditorialKeyFigures(true);
                    renderEditorialStage(true);
                    return;
                }
                if (WBState.accountSubmode) {
                    WBState.accountSubmode = null;
                    if (WBState.oauthPollTimer) {
                        clearInterval(WBState.oauthPollTimer);
                        WBState.oauthPollTimer = null;
                    }
                    renderEditorialStage(true);
                    return;
                }
                WBState.accountSubmode = 'INGEST';
                renderEditorialStage(true);
            } else if (ch === 'egress') {
                if (IS_PROD_ENV && !WBState.importingSub) {
                    refreshEgressView();
                    return;
                }
                // Comment 3 & 4: 刷新全量节点，右侧几何模型圆圈黄色慢闪，非全超时则短暂变绿，全部超时才变红颤抖
                if (WBState.importingSub) {
                    WBState.importingSub = false;
                    renderEditorialStage(true);
                } else {
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                    window.triggerModelSpinAcceleration(1200);
                    soundscape.triggerTileNote(7);

                    setTimeout(() => {
                        let allTimeout = true;
                        if (WBState.egressTab === 'SUBS') {
                            WBState.subscriptions.forEach(sub => { sub.ageHours = 0.1; });
                            WBState.nodes.forEach(n => {
                                if (!n.timeout) {
                                    n.ping = Math.max(16, n.ping + Math.floor((Math.random() - 0.5) * 12));
                                    n.trend.shift();
                                    n.trend.push(n.ping);
                                }
                            });
                            allTimeout = WBState.nodes.length > 0 && WBState.nodes.every(n => n.timeout);
                            notifyEditorialStatus(`REFRESHED ALL ${WBState.subscriptions.length} SUBSCRIPTIONS`);
                        } else {
                            const activeNodes = getActiveSubNodes();
                            activeNodes.forEach(n => {
                                if (!n.timeout) {
                                    n.ping = Math.max(16, n.ping + Math.floor((Math.random() - 0.5) * 12));
                                    n.trend.shift();
                                    n.trend.push(n.ping);
                                }
                            });
                            allTimeout = activeNodes.length > 0 && activeNodes.every(n => n.timeout);
                            notifyEditorialStatus(`REFRESHED ${activeNodes.length} NODES IN ACTIVE SUB`);
                        }

                        // 只有全部节点超时才变红颤抖，只要有可用节点就短暂变绿
                        if (allTimeout) {
                            setPreviewFrameState('error', 800);
                        } else {
                            setPreviewFrameState('success', 800);
                        }
                        updateEditorialKeyFigures(true);
                        renderEditorialStage(true);
                    }, 500);
                }
                } else if (ch === "models") {
                if (IS_PROD_ENV) {
                    // 模型页面的大按钮不变色；结果只反馈到右侧圆环。
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                    safeApiFetch('/panel/api/models/refresh', {method: 'POST', body: '{}'}, 30000, true).then(result => {
                        setPreviewFrameState(Array.isArray(result?.models) && !result.stale ? 'success' : 'error', 800);
                        if (!Array.isArray(result?.models)) {
                            notifyEditorialStatus(result?.error?.includes('没有可用账号') ? '模型获取失败 // 没有可用账号' : '模型获取失败 // 请检查账号与出口');
                            return;
                        }
                        syncModelsData(result);
                        notifyEditorialStatus(result.stale ? '模型刷新失败，显示旧缓存' : '模型列表已更新');
                        updateEditorialKeyFigures(false);
                        renderEditorialStage(true);
                    });
                    return;
                }
                setPreviewFrameState("busy", 1200);
                soundscape.triggerTileNote(7);
                notifyEditorialStatus("FETCHING ALL MODELS // CN & GLOBAL");
                const pFetch = (typeof safeApiFetch === "function")
                    ? safeApiFetch("/panel/api/models", {}, 2500)
                    : Promise.resolve(true);
                pFetch.then((res) => {
                    setTimeout(() => {
                        setPreviewFrameState("success", 800);
                        notifyEditorialStatus("MODELS SYNCHRONIZED");
                        renderEditorialStage(true);
                    }, 1200);
                }).catch(() => {
                    setTimeout(() => {
                        setPreviewFrameState("error", 700);
                        notifyEditorialStatus("MODEL FETCH FAILED");
                    }, 1200);
                });
            } else if (ch === 'tasks' || ch === 'scheduler') {
                void startAllTasks();
            } else if (ch === 'usage') {
                WBState.usageView = WBState.usageView === 'CURVE' ? 'RANK' : 'CURVE';
                if (WBState.usageView === 'RANK') WBState.usageModelPage = 0;
                notifyEditorialStatus(WBState.usageView === 'RANK' ? 'USAGE -> BY MODEL BREAKDOWN' : 'USAGE -> TIMESERIES CURVE');
                renderEditorialStage(true);
            } else if (ch === 'packages') {
                WBState.selectedPackageUid = null;
                WBState.packageView = (WBState.packageView === 'MODEL' ? 'LIST' : 'MODEL');
                notifyEditorialStatus(WBState.packageView === 'MODEL' ? 'VIEW -> MATHEMATICAL MODEL' : 'VIEW -> ACCOUNT PACKAGE LIST');
                renderEditorialStage(true);
            } else if (ch === 'logs') {
                WBState.selectedLogId = null;
                WBState.logView = WBState.logView === 'LIST' ? 'MODEL' : 'LIST';
                WBState.logModelHoverIdx = -1;
                notifyEditorialStatus(WBState.logView === 'MODEL' ? 'ERROR MODEL -> HAWKES INTENSITY CURVE' : 'ERROR ARCHIVE -> INCIDENT LIST');
                renderEditorialStage(true);
            } else if (ch === 'encryption') {
                const elOld = document.getElementById('cfg-old-pwd');
                const elNew = document.getElementById('cfg-new-pwd');
                const elRep = document.getElementById('cfg-rep-pwd');
                const elTh = document.getElementById('cfg-threshold');
                const elSub = document.getElementById('cfg-sub-refresh');

                const oldVal = elOld?.value || '';
                const newVal = elNew?.value || '';
                const repVal = elRep?.value || '';
                const isChangingPwd = Boolean(oldVal || newVal || repVal);

                if (IS_PROD_ENV && !isChangingPwd) {
                    const threshold = Number(elTh?.value);
                    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000000) {
                        beginActionFeedback()('error');
                        notifyEditorialStatus('低额保护阈值必须在 1 到 1000000 之间');
                        return;
                    }
                    const refreshHours = Number(elSub?.value);
                    if (!Number.isInteger(refreshHours) || refreshHours < 1 || refreshHours > 8760) {
                        beginActionFeedback()('error');
                        notifyEditorialStatus('订阅刷新间隔必须在 1 到 8760 小时之间');
                        return;
                    }
                    const finishFeedback = beginActionFeedback(elTh, elSub);
                    safeApiFetch('/panel/api/preferences', {method: 'POST', body: JSON.stringify({credit_guard_low: threshold, subscription_refresh_hours: refreshHours})}, 10000).then(result => {
                        finishFeedback(result ? 'success' : 'error');
                        if (!result) { notifyEditorialStatus('设置保存失败'); return; }
                        WBState.configThreshold = result.credit_guard_low;
                        WBState.configCacheHours = result.subscription_refresh_hours;
                        notifyEditorialStatus('设置已保存');
                        updateEditorialKeyFigures(true);
                    });
                    return;
                }

                if (IS_PROD_ENV && isChangingPwd && (Number(elTh?.value) !== WBState.configThreshold || Number(elSub?.value) !== WBState.configCacheHours)) {
                    notifyEditorialStatus('请分别保存密码和数值设置');
                    return;
                }

                // --- Comment 1: 密码修改状态机规范 ---
                if (isChangingPwd) {
                    const missing = [];
                    if (!oldVal && elOld) missing.push(elOld);
                    if (!newVal && elNew) missing.push(elNew);
                    if (!repVal && elRep) missing.push(elRep);

                    if (missing.length > 0) {
                        missing.forEach(el => {
                            el.classList.add('input-error-shake');
                            el.style.borderBottomColor = '#ff5c74';
                            setTimeout(() => {
                                el.classList.remove('input-error-shake');
                                el.style.borderBottomColor = '';
                            }, 650);
                        });
                        setPreviewFrameState('error', 800);
                        notifyEditorialStatus('PASSWORD // ALL 3 FIELDS REQUIRED');
                        return;
                    }

                    // (1) 输入密码后，应当只有上方的三条线有黄色抖动情况，右侧圆圈同步变黄
                    const pwdInputs = [elOld, elNew, elRep];
                    pwdInputs.forEach(el => {
                        el.classList.add('input-verifying-sway');
                        el.style.borderBottomColor = '#facc15';
                    });
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                    notifyEditorialStatus('VERIFYING CREDENTIALS // PBKDF2...');

                    setTimeout(async () => {
                        const stopPasswordWait = () => pwdInputs.forEach(el => {
                            el.classList.remove('input-verifying-sway');
                            el.style.borderBottomColor = '';
                        });

                        let checkOk = false;
                // (3) 新密码与确认值不同时，只标记确认输入框。
                        if (newVal !== repVal) {
                            stopPasswordWait();
                            elRep.classList.add('input-error-shake');
                            elRep.style.borderBottomColor = '#ff5c74';
                            setTimeout(() => {
                                elRep.classList.remove('input-error-shake');
                                elRep.style.borderBottomColor = '';
                            }, 650);
                            setPreviewFrameState('error', 800);
                            notifyEditorialStatus('CONFIRM PASSWORD MISMATCH');
                            return;
                        }

                        // (4) 若全部正确，则向后端提交修改，只有确认新密码的横线变绿，右侧圆圈白色线条变绿
                        if (IS_PROD_ENV) {
                            try {
                                const pwdRes = await safeApiFetch('/auth/password', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ old_password: oldVal, new_password: newVal, confirm_password: repVal })
                                }, 3000);
                                if (pwdRes && pwdRes.ok === true) {
                                    checkOk = true;
                                    if (pwdRes.csrf_token) {
                                        csrfToken = pwdRes.csrf_token;
                                        window.csrfToken = pwdRes.csrf_token;
                                        localStorage.setItem('wb_csrf_token', pwdRes.csrf_token);
                                    }
                                }
                            } catch (e) {
                                checkOk = false;
                            }
                        }

                        stopPasswordWait();
                        if (checkOk) {
                            elRep.classList.add('input-success-green');
                            setTimeout(() => {
                                elRep.classList.remove('input-success-green');
                                elOld.value = '';
                                elNew.value = '';
                                elRep.value = '';
                            }, 1200);
                            setPreviewFrameState('success', 1000);
                            soundscape.triggerTileNote(11);
                            notifyEditorialStatus('PASSWORD SUCCESSFULLY UPDATED // 请重新登录');
                            if (IS_PROD_ENV) setTimeout(() => logoutToStartPage(true), 1200);
                        } else {
                            elOld.classList.add('input-error-shake');
                            elOld.style.borderBottomColor = '#ff5c74';
                            setTimeout(() => {
                                elOld.classList.remove('input-error-shake');
                                elOld.style.borderBottomColor = '';
                            }, 650);
                            setPreviewFrameState('error', 800);
                            notifyEditorialStatus('PASSWORD UPDATE FAILED');
                        }
                    }, 420);
                }

                if (IS_PROD_ENV) return;

                // --- Comment 1: 保护阈值和刷新时间独立校验与动效 ---
                const rawThStr = (elTh?.value || '').trim();
                const rawSubStr = (elSub?.value || '').trim();
                const thVal = parseInt(rawThStr, 10);
                const subVal = parseInt(rawSubStr, 10);

                const thChanged = (!Number.isNaN(thVal) && thVal !== WBState.configThreshold) || rawThStr === '99999' || thVal < 0;
                const subChanged = (!Number.isNaN(subVal) && subVal !== WBState.configCacheHours) || rawSubStr === '99999' || subVal < 0;

                const cfgChangedInputs = [];
                if (thChanged && elTh) cfgChangedInputs.push({ el: elTh, val: thVal, type: 'th' });
                if (subChanged && elSub) cfgChangedInputs.push({ el: elSub, val: subVal, type: 'sub' });

                if (cfgChangedInputs.length > 0) {
                    // (1) & (2) 只对改动的那一条或两条横线生效黄色轻微晃动
                    cfgChangedInputs.forEach(item => {
                        item.el.classList.add('input-verifying-sway');
                        item.el.style.borderBottomColor = '#facc15';
                    });
                    if (!isChangingPwd) if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);

                    setTimeout(() => {
                        let hasConfigError = false;

                        cfgChangedInputs.forEach(item => {
                            item.el.classList.remove('input-verifying-sway');
                            item.el.style.borderBottomColor = '';

                            // (3) 负数变红报错；(4) 输入 99999 或以上报错，必须在 99999 以下 (0 <= val < 99999)
                            const isInvalid = Number.isNaN(item.val) || item.val < 0 || item.val >= 99999;
                            if (isInvalid) {
                                hasConfigError = true;
                                item.el.classList.add('input-error-shake');
                                item.el.style.borderBottomColor = '#ff5c74';
                                setTimeout(() => {
                                    item.el.classList.remove('input-error-shake');
                                    item.el.style.borderBottomColor = '';
                                }, 700);
                            } else {
                                // 校验成功变绿
                                if (item.type === 'th') {
                                    WBState.configThreshold = item.val;
                                    WBState.accounts.forEach(a => { if (!isRawLowBalance(a)) a.forceOverride = false; });
                                } else if (item.type === 'sub') {
                                    WBState.configCacheHours = item.val;
                                }
                                item.el.style.borderBottomColor = '#4ade80';
                                setTimeout(() => { item.el.style.borderBottomColor = ''; }, 800);
                            }
                        });

                        // (5) 右侧模型圆圈白色线条同理联动
                        if (!isChangingPwd) {
                            if (hasConfigError) {
                                setPreviewFrameState('error', 800);
                                notifyEditorialStatus('CONFIG ERROR // MUST BE BETWEEN 0 AND 99998');
                            } else {
                                setPreviewFrameState('success', 800);
                                notifyEditorialStatus(`SAVED // FLOOR <${WBState.configThreshold} & SUB REFRESH ${WBState.configCacheHours}H`);
                            }
                        }
                        updateEditorialKeyFigures(true);
                    }, 380);
                }
            } else {
                [0, 3, 5, 8, 11].forEach((n, idx) => setTimeout(() => soundscape.triggerTileNote(n), idx * 90));
                notifyEditorialStatus('HARMONIC RESONANCE TRIGGERED');
            }
        });

        // 底部按钮 2：控制动作与便捷工具
        document.getElementById('btn-page-ripple').addEventListener('click', function() {
            // 点击后白上一下 (140ms)，随后立刻平滑变回半透明并主动失焦
            const btnEl = this;
            btnEl.classList.add('btn-flash-white');
            setTimeout(() => {
                btnEl.classList.remove('btn-flash-white');
                btnEl.blur();
            }, 140);

            const ch = WBState.currentChapter;
            if (ch === 'sphere') {
                soundscape.triggerTileNote(9);
                // 按钮 2 [ RETURN MATRIX ] 改造为切换几何模型：点击时右侧球形几何切换为随机抽取的其他几何体，再次点击切回球形，以此往复
                const curGeo = morphEngine.activeGeoId || 'sphere';
                if (curGeo === 'sphere') {
                    const pool = ['overview', 'accounts', 'egress', 'tasks', 'usage', 'models', 'packages', 'logs', 'encryption', 'customization'];
                    const nextGeo = pool[Math.floor(Math.random() * pool.length)];
                    triggerInFrameGeometryMorph(nextGeo);
                    notifyEditorialStatus('GEOMETRY SWITCHED -> ' + nextGeo.toUpperCase());
                } else {
                    triggerInFrameGeometryMorph('sphere');
                    notifyEditorialStatus('GEOMETRY SWITCHED -> CLASSIC SPHERE');
                }
                return;
            }

            // second ch removed
            if (ch === 'customization') {
                const cust = WBState.customization;
                if (cust.isAdding) {
                    if (cust.currentTab === 'music') saveCustomMusic();
                    else if (cust.currentTab === 'slogan') saveCustomSlogan();
                } else {
                    triggerRandomCustomization();
                }
                return;
            }
            soundscape.triggerTileNote(5);
            if (ch === 'overview' || ch === 'gateway') {
                navigator.clipboard?.writeText('http://127.0.0.1:7863/v1');
                notifyEditorialStatus('COPIED // HTTP://127.0.0.1:7863/V1');
            } else if (ch === 'accounts') {
                if (WBState.selectedAccountUid || WBState.selectingSystemDefault) {
                    WBState.accountNodeSortMode = WBState.accountNodeSortMode === 'NAME' ? 'LATENCY' : 'NAME';
                    WBState.accountNodePage = 0;
                    WBState.frozenAccountNodeIds = null;
                    soundscape.triggerTileNote(8);
                    notifyEditorialStatus('NODE SORT -> ' + (WBState.accountNodeSortMode === 'NAME' ? 'BY NAME (A-Z)' : 'BY LATENCY (PING)'));
                    updateEditorialKeyFigures(false);
                    renderEditorialStage(true);
                    return;
                }
                if (WBState.accountSubmode) {
                    window.importFromPastedCallbackUrl();
                } else {
                    probeAllAccountEgress();
                    renderEditorialStage(false);
                }
            } else if (ch === 'egress') {
                // Comment 3: 导入页面为确定导入，非导入页面为进入导入
                if (WBState.importingSub) {
                    confirmImportSub();
                } else {
                    WBState.importingSub = true;
                    renderEditorialStage(true);
                }
            } else if (ch === 'models') {
                const order = ['ALL', 'CN', 'GLOBAL'];
                WBState.modelRealmFilter = order[(order.indexOf(WBState.modelRealmFilter) + 1) % order.length];
                WBState.modelPage = 0;
                notifyEditorialStatus(`MODEL REALM FILTER -> ${WBState.modelRealmFilter}`);
                renderEditorialStage(true);
            } else if (ch === 'tasks' || ch === 'scheduler') {
                void setDailyTasksFromToggle();
            } else if (ch === 'usage') {
                WBState.usageRange = (WBState.usageRange === '6H') ? '24H' : '6H';
                if (WBState.usageRange === '6H' && WBState.usage24h.outVals && WBState.usage24h.outVals.length >= 6) {
                    WBState.usage6h.outVals = WBState.usage24h.outVals.slice(-6);
                    WBState.usage6h.inVals = WBState.usage24h.inVals.slice(-6);
                }
                const nextTargetBtnText = WBState.usageRange === '6H' ? '[ TIME: 6H ]' : '[ TIME: 24H ]';
                scrambleActionButton(document.getElementById('btn-page-ripple'), nextTargetBtnText, 220);
                notifyEditorialStatus(`TIME WINDOW -> ${WBState.usageRange} (MAX 24H ARCHIVE)`);
                renderEditorialStage(true);
            } else if (ch === 'packages') {
                WBState.selectedPackageUid = null;
                if (WBState.packageView === 'MODEL') {
                    // 数学模型页面：切换到另外一个数学模型 (按天数到期衰减 <-> 按账号额度统计)
                    WBState.packageModelMode = (WBState.packageModelMode === 'ACCOUNT' ? 'EXPIRY' : 'ACCOUNT');
                    notifyEditorialStatus(WBState.packageModelMode === 'ACCOUNT' ? 'MODEL -> ACCOUNT QUOTA CURVE (1-9 TO A-Z)' : 'MODEL -> WEIBULL EXPIRY DECAY');
                    renderEditorialStage(true);
                } else {
                    // 非数学模型页面：切换“按账号名称排序”与“按积分用量最少排序”
                    WBState.packageListSort = (WBState.packageListSort === 'USAGE' ? 'NAME' : 'USAGE');
                    notifyEditorialStatus(WBState.packageListSort === 'USAGE' ? 'SORT -> LEAST USAGE / BALANCE' : 'SORT -> ACCOUNT NAME (1-9 TO A-Z)');
                    renderEditorialStage(true);
                }
            } else if (ch === 'logs') {
                exportIncidentLogsJson();
            } else if (ch === 'encryption') {
                logoutToStartPage();
            } else {
                const w = window.innerWidth, h = window.innerHeight, waterLineY = h * (4 / 7);
                for (let i = 0; i < 3; i++) spawnPondRipple(w * (0.3 + i * 0.2), waterLineY + (h - waterLineY) * 0.45, 110, 0.85);
                notifyEditorialStatus('WATER HARMONIC PULSE TRIGGERED');
            }
        });

        document.getElementById('hidden-json-file-input')?.addEventListener('change', async (ev) => {
            const file = ev.target?.files?.[0];
            if (!file) return;
            if (IS_PROD_ENV) {
                const btn = document.getElementById('btn-import-json');
                let result = null;
                try {
                    if (file.size > 8 * 1024 * 1024) throw new Error('oversized');
                    const payload = JSON.parse(await file.text());
                    result = await safeApiFetch('/panel/api/accounts/import', {method: 'POST', body: JSON.stringify(payload)}, 59000, true);
                } catch (_) {}
                clearTimeout(jsonImportTimer);
                btn?.classList.remove('json-btn-busy');
                btn?.classList.add(result?.ok ? 'json-btn-success' : 'json-btn-error');
                setTimeout(() => btn?.classList.remove('json-btn-success', 'json-btn-error'), 1200);
                setPreviewFrameState(result?.ok ? 'success' : 'error', 1200);
                notifyEditorialStatus(result?.ok ? ('新增 ' + result.imported + ' 个账号，保留 ' + result.retained.length + ' 个已有账号') : (result?.rollback_failed?.length ? 'Meta 回滚失败，代理内核已停止，请检查状态' : '导入失败或结果未知，请刷新账号列表核对'));
                if (result?.ok) { await loadAuthenticatedPanelData(); renderEditorialStage(false); }
                ev.target.value = '';
                return;
            }

            const btnImport = document.getElementById('btn-import-json');
            // Comment 9: 导入过程中按钮与圆环变黄慢闪
            if (btnImport) {
                btnImport.classList.remove('tone-fault', 'tone-forced');
                btnImport.classList.add('tone-guard', 'animate-pulse');
            }
            if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
            notifyEditorialStatus(`IMPORTING JSON CONFIG // ${file.name.toUpperCase()}...`);

            const reader = new FileReader();
            reader.onload = () => {
                setTimeout(() => {
                    try {
                        const parsed = JSON.parse(String(reader.result || '{}'));
                        let valid = false;
                        if (Array.isArray(parsed)) {
                            if (parsed.length > 0 && parsed[0].uid) {
                                WBState.accounts = parsed;
                                valid = true;
                            }
                        } else if (parsed && typeof parsed === 'object') {
                            if (parsed.config && typeof parsed.config === 'object') {
                                if (typeof parsed.config.lowBalanceThreshold === 'number') {
                                    WBState.configThreshold = Math.max(0, Math.floor(parsed.config.lowBalanceThreshold));
                                }
                                if (typeof parsed.config.subscriptionRefreshHours === 'number') {
                                    WBState.configCacheHours = Math.max(1, Math.floor(parsed.config.subscriptionRefreshHours));
                                }
                                if (typeof parsed.config.activeSubscription === 'string') {
                                    WBState.activeSubId = parsed.config.activeSubscription;
                                }
                            }
                            if (Array.isArray(parsed.subscriptions) && parsed.subscriptions.length > 0) {
                                WBState.subscriptions = parsed.subscriptions;
                            }
                            if (Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
                                WBState.accounts = parsed.accounts;
                            }
                            valid = true;
                        }

                        if (!valid) throw new Error('Invalid JSON configuration structure');

                        // 导入成功：按钮变绿，圆环短暂变绿
                        if (btnImport) {
                            btnImport.classList.remove('tone-guard', 'animate-pulse', 'tone-fault');
                            btnImport.classList.add('tone-forced');
                            setTimeout(() => btnImport.classList.remove('tone-forced'), 800);
                        }
                        setPreviewFrameState('success', 800);
                        soundscape.triggerTileNote(10);
                        updateEditorialKeyFigures(true);
                        renderEditorialStage(true);
                        notifyEditorialStatus(`IMPORTED JSON CONFIG // ${file.name.toUpperCase()}`);
                    } catch (err) {
                        // 导入失败：按钮变红颤抖，圆环变红颤抖
                        if (btnImport) {
                            btnImport.classList.remove('tone-guard', 'animate-pulse', 'tone-forced');
                            btnImport.classList.add('tone-fault', 'canvas-fault-jolt');
                            setTimeout(() => {
                                btnImport.classList.remove('tone-fault', 'canvas-fault-jolt');
                            }, 650);
                        }
                        setPreviewFrameState('error', 800);
                        soundscape.triggerTileNote(1);
                        notifyEditorialStatus(`IMPORT FAILED // INVALID JSON STRUCTURE`);
                    }
                }, 400);
            };
            reader.readAsText(file);
        });

        /* =========================================================================
         * 8. 顶栏声波指示器动画与进入主场景过渡（100% 保留原版时序）
         * ========================================================================= */
        const waveCanvas = document.getElementById('sound-wave-canvas');
        const waveCtx = waveCanvas ? waveCanvas.getContext('2d') : null;
        let wavePhase = 0;
        let soundWaveRafId = null;

        function animateSoundWaveIcon() {
            if (!waveCtx) return;
            if (soundWaveRafId) {
                cancelAnimationFrame(soundWaveRafId);
                soundWaveRafId = null;
            }
            waveCtx.clearRect(0, 0, 22, 12);
            waveCtx.strokeStyle = '#ffffff';
            waveCtx.lineWidth = 1.4;
            waveCtx.beginPath();
            for (let x = 0; x <= 22; x++) {
                const amp = soundscape.isMuted ? 0.4 : 4.2;
                const y = 6 + Math.sin(x * 0.45 + wavePhase) * amp;
                if (x === 0) waveCtx.moveTo(x, y);
                else waveCtx.lineTo(x, y);
            }
            waveCtx.stroke();
            wavePhase += 0.18;
            soundWaveRafId = requestAnimationFrame(animateSoundWaveIcon);
        }

        function enterMainExperience(withSound) {
            if (logoutResetTimer) { clearTimeout(logoutResetTimer); logoutResetTimer = null; }
            const transitionEpoch = authTransitionEpoch;
            isAuthenticating = false;
            try {
                if (typeof WBState !== 'undefined' && WBState.customization) {
                    const sub = WBState.customization.musicList.find(x => x.id === 'm-subwave');
                    if (sub && !sub.url) sub.url = generateSyntheticWavUrl(55.0, 110.0);
                    const zen = WBState.customization.musicList.find(x => x.id === 'm-zenith');
                    if (zen && !zen.url) zen.url = generateSyntheticWavUrl(196.0, 392.0);
                }
            } catch (e) {}
            const pendingTrack = soundscape.pendingAuthenticatedTrack;
            soundscape.init(withSound, { skipDefault: !!pendingTrack && !pendingTrack.isDefault });
            if (pendingTrack && !pendingTrack.isDefault && soundscape.defaultAmbientGain && soundscape.ctx) {
                const gain = soundscape.defaultAmbientGain.gain;
                gain.cancelScheduledValues(soundscape.ctx.currentTime);
                gain.setValueAtTime(0, soundscape.ctx.currentTime);
            }
            if (pendingTrack && !pendingTrack.loading) {
                soundscape.pendingAuthenticatedTrack = null;
                soundscape.playCustomBackgroundTrack(pendingTrack.url, pendingTrack.isDefault);
            }
            if (soundscape.customAudio) {
                const targetV = soundscape.isMuted ? 0.0 : (withSound ? 0.7 : 0.0);
                soundscape.fadeAudio(soundscape.customAudio, soundscape.customAudio.volume, targetV, 1200);
            }

            const introLayer = document.getElementById('intro-layer');
            const mainScene = document.getElementById('main-scene');
            const topControls = document.getElementById('top-right-controls');
            const weatherSwitcher = document.getElementById('weather-switcher');
            const mainFooter = document.getElementById('main-footer');
            const projectPageView = document.getElementById('project-page-view');

            introLayer.style.opacity = '0';
            introLayer.style.pointerEvents = 'none';
            mainScene.style.transition = 'opacity 900ms ease-in-out';

            if (projectPageView) {
                projectPageView.classList.add('hidden', 'pointer-events-none');
                projectPageView.classList.remove('flex');
                projectPageView.style.opacity = '0';
            }
            // 复位内部瓦片，但先保持主场景隐藏；由下方同一过渡统一显现。
            resetMainWorldState(false);

            scrambleText(document.getElementById('role-tag'), '[ LOCAL CONTROL MESH ]', 750);

            setTimeout(() => {
                if (transitionEpoch !== authTransitionEpoch) return;
                introActive = false;
                introLayer.classList.add('hidden');
                mainScene.classList.remove('pointer-events-none');
                mainScene.style.opacity = '1';

                mainSceneActive = true;
                mainEnterTimestamp = performance.now();
                resetMainWorldState();

                setTimeout(() => {
                    if (transitionEpoch !== authTransitionEpoch) return;
                    topControls.classList.remove('hidden');
                    topControls.classList.add('flex');
                    weatherSwitcher.classList.remove('hidden');
                    weatherSwitcher.classList.add('flex');
                    mainFooter.style.opacity = '1';
                    scrambleText(document.getElementById('hover-sound-status'), '[ HOVER TO GENERATE SOUNDS ]', 650);
                }, 850);
            }, 420);
        }

        document.getElementById('btn-mute').addEventListener('click', () => {
            soundscape.toggleMute();
            notifyEditorialStatus(`AUDIO HARMONICS -> ${soundscape.isMuted ? 'MUTED' : 'UNMUTED (60FPS SYNC)'}`);
        });
        const initialMuteLabel = document.getElementById('mute-label');
        if (initialMuteLabel && soundscape.isMuted) {
            initialMuteLabel.textContent = 'Unmute';
        }

        // 顶栏全局数据刷新（刷新账号池、用量、积分构成、错误记录）
        // 顶栏轻量快速刷新：仅刷新账号池额度、用量积分、构成和错误记录（不测速出口、不全量重置）
        async function triggerGlobalDataRefresh() {
            const finishFeedback = beginActionFeedback(feedbackTarget);
            soundscape.triggerTileNote(7);
            if (!IS_PROD_ENV) { finishFeedback('error'); notifyEditorialStatus('REFRESH UNAVAILABLE // DEMO DATA IS READ-ONLY'); return; }
            const result = await safeApiFetch('/panel/api/refresh', { method: 'POST', body: '{}' }, 30000, true);
            if (!result || result.ok !== true) {
                const failed = Object.entries(result?.components || {}).filter(([, value]) => value?.ok !== true).map(([name]) => ({balance:'账号额度或出口', usage:'用量存储', errors:'错误记录', packages:'积分构成'})[name] || name);
                finishFeedback('error');
                notifyEditorialStatus(failed.length ? '刷新失败 // 请检查 ' + failed.join('、') : '刷新失败 // 服务连接异常');
                return;
            }
            const [overview, egress, packages, logs, usage] = await Promise.all([
                safeApiFetch('/panel/api/overview', {}, 10000),
                safeApiFetch('/panel/api/meta/nodes', {}, 10000),
                safeApiFetch('/panel/api/packages', {}, 10000),
                safeApiFetch('/panel/api/request_logs?summary=1&limit=50', {}, 10000),
                safeApiFetch('/panel/api/usage?hours=24', {}, 10000)
            ]);
            syncOverviewData(overview);
            syncEgressData(egress);
            if (packages?.accounts) syncPackagesData(packages);
            if (logs) syncLogsData(logs);
            if (usage) syncUsageData(usage);
            const failed = Object.entries(result.components || {}).filter(([, value]) => value?.ok !== true);
            notifyEditorialStatus(failed.length ? 'REFRESH PARTIAL // ' + failed.map(([name]) => name).join(', ') : 'REFRESHED // QUOTA, TELEMETRY & LOGS SYNCED');
            if (pageTransition.state === 'IN_PAGE') renderEditorialStage(false);
            finishFeedback(failed.length || !overview || !egress || !packages || !logs || !usage ? 'error' : 'success');
        }
        document.getElementById('btn-refresh-all')?.addEventListener('click', triggerGlobalDataRefresh);

        // 单账号删除功能
        window.deleteAccountItem = async function(uid) {
            const acc = WBState.accounts.find(a => a.uid === uid);
            if (!acc) return;
            const label = acc.name || uid;
            if (!window.confirm(`永久删除账号「${label}」？出口绑定、用量与任务记录将清理，凭证隔离保留七天后清理。`)) return;
            if (IS_PROD_ENV) {
                const result = await safeApiFetch('/panel/api/accounts/' + encodeURIComponent(uid) + '/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 30000);
                if (!result || result.ok !== true) {
                    // 协同幂等优化：若该账号已被他人或另一端先行删除（404 / not found），视为已成功删除，平滑移除该行，绝不突兀报错
                    const isAlreadyGone = result?.status === 404 || String(result?.error || '').toLowerCase().includes('not found') || String(result?.message || '').toLowerCase().includes('not found');
                    if (!isAlreadyGone) {
                        notifyEditorialStatus('ACCOUNT DELETE FAILED // 状态未改变');
                        return;
                    }
                }
            }
            soundscape.triggerTileNote(2);
            WBState.accounts = WBState.accounts.filter(a => a.uid !== uid);
            const totalPages = Math.ceil(WBState.accounts.length / 4) || 1;
            if (WBState.accountPage >= totalPages) {
                WBState.accountPage = Math.max(0, totalPages - 1);
            }
            notifyEditorialStatus(`ACCOUNT REMOVED // ${acc.name.toUpperCase()}`);
            updateEditorialKeyFigures(true);
            renderEditorialStage(true);
        };

        document.getElementById('btn-about').addEventListener('click', () => {
            if (pageTransition.state === 'IDLE') triggerEnterNewPage('sphere');
            else if (pageTransition.state === 'IN_PAGE') switchChapterInPlace('sphere');
            return;
        });
        document.getElementById('btn-about-noop')?.addEventListener('click', () => {
            if (pageTransition.state === 'IDLE') triggerEnterNewPage('sphere');
            else if (pageTransition.state === 'IN_PAGE') switchChapterInPlace('sphere');
        });

        document.getElementById('btn-socials').addEventListener('click', () => {
            if (pageTransition.state === 'IDLE') triggerEnterNewPage('gateway');
            else if (pageTransition.state === 'IN_PAGE') switchChapterInPlace('gateway');
        });

        document.getElementById('btn-back-to-grid').addEventListener('click', triggerReturnToMatrix);

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && (pageTransition.state === 'IN_PAGE' || pageTransition.state === 'EXPANDING_TO_PAGE')) {
                triggerReturnToMatrix();
                return;
            }
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
            if (pageTransition.state === 'IN_PAGE') {
                const chapterKeys = {
                    '1': 'overview', '2': 'accounts', '3': 'egress',
                    '4': 'models',   '5': 'tasks',    '6': 'usage',
                    '7': 'packages', '8': 'logs',     '9': 'encryption',
                    '0': 'customization'
                };
                if (chapterKeys[e.key]) switchChapterInPlace(chapterKeys[e.key]);
            } else if (pageTransition.state === 'IDLE') {
                const chapterKeys = {
                    '1': 'overview', '2': 'accounts', '3': 'egress',
                    '4': 'models',   '5': 'tasks',    '6': 'usage',
                    '7': 'packages', '8': 'logs',     '9': 'encryption',
                    '0': 'customization'
                };
                if (chapterKeys[e.key]) {
                    pageTransition.clickX = null;
                    pageTransition.clickY = null;
                    lastPointerX = null;
                    lastPointerY = null;
                    triggerEnterNewPage(chapterKeys[e.key]);
                }
            }
        });

        const btnCopyEmail = document.getElementById('btn-copy-email');
        if (btnCopyEmail) {
            btnCopyEmail.addEventListener('click', () => {
                const endpoint = 'http://127.0.0.1:7863/v1';
                navigator.clipboard?.writeText(endpoint);
                const emailText = document.getElementById('email-text');
                isEmailCopying = true;
                if (emailCopyTimer) clearTimeout(emailCopyTimer);
                if (emailText) scrambleText(emailText, '[ ENDPOINT COPIED TO CLIPBOARD ]', 350);
                emailCopyTimer = setTimeout(() => {
                    isEmailCopying = false;
                    const el = document.getElementById('email-text');
                    if (el) scrambleText(el, `[ UPTIME // ${formatUptime(WBState.uptimeSec)} ]`, 400);
                }, 2200);
            });
        }

        async function refreshEgressView(nodeID = null) {
            if (WBState._egressRefreshing) return;
            WBState._egressRefreshing = true;
            // 大按钮始终保留原样；批量操作只驱动右侧圆环。
            const finishFeedback = !nodeID
                ? Object.assign((state, ringState = state) => setPreviewFrameState(ringState, 800), { rebind: () => {} })
                : beginActionFeedback();
            if (!nodeID) if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
            try {
                if (!nodeID && WBState.egressTab === 'SUBS') {
                    const ids = WBState.subscriptions.map(item => item.id);
                    let failed = 0;
                    for (const id of ids) {
                        const result = await safeApiFetch('/panel/api/meta/subscriptions', {method: 'POST', body: JSON.stringify({action: 'refresh', id})}, 65000);
                        if (!result || result.ok !== true) failed++;
                    }
                    await loadAuthenticatedPanelData();
                    notifyEditorialStatus('订阅刷新完成：' + (ids.length - failed) + ' 成功，' + failed + ' 失败');
                    finishFeedback(failed ? 'error' : 'success');
                } else {
                    const job = await safeApiFetch('/panel/api/meta/tests', {method: 'POST', body: JSON.stringify(nodeID ? {node: nodeID} : {})}, 10000);
                    if (!job || !job.id) { notifyEditorialStatus('节点测速启动失败'); finishFeedback('error'); return; }
                    notifyEditorialStatus('节点测速进行中');
                    let status = job;
                    while (status.running) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        status = await safeApiFetch('/panel/api/meta/tests', {}, 10000);
                        if (!status || status.id !== job.id) { notifyEditorialStatus('节点测速状态读取失败'); finishFeedback('error'); return; }
                        syncEgressData(await safeApiFetch('/panel/api/meta/nodes', {}, 10000));
                        renderEditorialStage(false);
                        finishFeedback.rebind();
                    }
                    const finalNodes = await safeApiFetch('/panel/api/meta/nodes', {}, 10000);
                    if (!finalNodes || !Array.isArray(finalNodes.nodes)) {
                        notifyEditorialStatus('节点测速结果读取失败'); finishFeedback('error'); return;
                    }
                    syncEgressData(finalNodes);
                    notifyEditorialStatus('节点测速完成：' + status.completed + '，失败 ' + status.failed);
                    const selected = nodeID ? WBState.nodes.find(n => n.id === nodeID) : null;
                    const boundFailure = WBState.nodes.some(n => n.bindingCount > 0 && (n.timeout || n.status === 'error'));
                    const allTimeout = status.total > 0 && status.failed >= status.total;
                    const ringFailed = status.cancelled || boundFailure || (!nodeID && allTimeout);
                    const nodeFailed = nodeID && (!selected || selected.timeout || selected.status === 'error');
                    finishFeedback(status.cancelled || nodeFailed || (!nodeID && allTimeout) ? 'error' : 'success', ringFailed ? 'error' : 'success');
                }
                renderEditorialStage(false);
                finishFeedback.rebind();
            } finally { WBState._egressRefreshing = false; }
        }
        function handleViewportScaleSync() {
            updateResponsiveScale();
            if (introActive) initIntroGrid();
            resizeMainWorldCanvas();
            setupCrispPreviewCanvas();
        }
        if (IS_PROD_ENV) {
            window.toggleAccountManual = async (uid) => {
                const account = WBState.accounts.find(item => item.uid === uid);
                if (!account) return;
                if (account.state === 'BLOCKED') { beginActionFeedback()('error'); notifyEditorialStatus('令牌已隔离，请重新授权'); return; }
                const result = await safeApiFetch('/panel/api/accounts/' + encodeURIComponent(uid) + '/toggle_disabled', {method: 'POST', body: JSON.stringify({disabled: account.manualOn})}, 10000);
                if (!result?.ok) { beginActionFeedback()('error'); notifyEditorialStatus(account.state === 'BLOCKED' ? '令牌已隔离，请重新授权' : '账号状态更新失败'); return; }
                syncOverviewData(await safeApiFetch('/panel/api/overview', {}, 10000));
                renderEditorialStage(false);
            };
            window.bindAccountEgress = async (uid, nodeName) => {
                const node = WBState.nodes.find(item => item.id === nodeName);
                if (!node) return;
                if (node.timeout) { beginActionFeedback()('error'); notifyEditorialStatus('节点超时，请重新测速'); return; }
                const result = await safeApiFetch('/panel/api/meta/accounts/' + encodeURIComponent(uid) + '/bind', {method: 'POST', body: JSON.stringify({node: node.id})}, 40000);
                if (!result?.ok) { notifyEditorialStatus('出口绑定失败'); return; }
                syncEgressData(await safeApiFetch('/panel/api/meta/nodes', {}, 10000));
                renderEditorialStage(false);
            };
            window.switchLoginRealm = (realm) => {
                WBState.loginRealm = realm;
                if (!WBState.loginAuthUrls) WBState.loginAuthUrls = { CN: '', GLOBAL: '' };
                if (!WBState.loginStates) WBState.loginStates = { CN: '', GLOBAL: '' };
                WBState.loginAuthUrl = WBState.loginAuthUrls[realm] || '';
                WBState.loginState = WBState.loginStates[realm] || '';
                renderEditorialStage(false);
            };
            window.openOAuthLoginLink = async () => {
                if (!WBState.systemDefaultNode) {
                    notifyEditorialStatus('AUTH // 严禁直连：请先在上方指定【默认出口】节点后再发起授权');
                    if (typeof soundscape !== 'undefined' && soundscape && typeof soundscape.triggerErrorSound === 'function') {
                        soundscape.triggerErrorSound();
                    }
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('error', 800);
                    return;
                }

                // 立即触发黄色慢闪动效与等待文本（周期 1.8s）
                WBState.oauthWaiting = true;
                WBState.oauthPollStatus = 'WAITING';
                if (typeof setPreviewFrameState === 'function') {
                    setPreviewFrameState('busy', 0);
                }
                renderEditorialStage(false);

                const finishFeedback = beginActionFeedback();
                const authWindow = window.open('about:blank', '_blank');
                if (authWindow) authWindow.opener = null;

                const result = await safeApiFetch('/panel/api/login/start', {method: 'POST', body: JSON.stringify({realm: WBState.loginRealm.toLowerCase()})}, 35000);
                if (!result?.state || !result?.url) {
                    WBState.oauthWaiting = false;
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('error', 800);
                    finishFeedback('error');
                    if (authWindow) authWindow.close();
                    notifyEditorialStatus(result?.error || '获取授权链接失败');
                    renderEditorialStage(false);
                    return;
                }

                let authURL;
                try {
                    authURL = new URL(result.url);
                } catch (_) {
                    WBState.oauthWaiting = false;
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('error', 800);
                    finishFeedback('error');
                    if (authWindow) authWindow.close();
                    notifyEditorialStatus('授权链接无效');
                    renderEditorialStage(false);
                    return;
                }

                if (authURL.protocol !== 'https:' || authURL.username || authURL.password) {
                    WBState.oauthWaiting = false;
                    if (typeof setPreviewFrameState === 'function') setPreviewFrameState('error', 800);
                    finishFeedback('error');
                    if (authWindow) authWindow.close();
                    notifyEditorialStatus('授权链接无效');
                    renderEditorialStage(false);
                    return;
                }

                WBState.loginState = result.state;
                WBState.loginAuthUrl = authURL.href;
                if (!WBState.loginAuthUrls) WBState.loginAuthUrls = { CN: '', GLOBAL: '' };
                if (!WBState.loginStates) WBState.loginStates = { CN: '', GLOBAL: '' };
                WBState.loginAuthUrls[WBState.loginRealm] = authURL.href;
                WBState.loginStates[WBState.loginRealm] = result.state;
                if (authWindow) authWindow.location.href = authURL.href;
                else notifyEditorialStatus('浏览器阻止了新窗口，请复制授权链接');

                notifyEditorialStatus('OPENED BROWSER FOR OAUTH // WAITING FOR AUTHORIZATION...');
                startOAuthPolling();
                renderEditorialStage(false);
            };
            const subscriptionAction = async (action, id, extra = {}) => {
                const finishFeedback = beginActionFeedback();
                const result = await safeApiFetch('/panel/api/meta/subscriptions', {method: 'POST', body: JSON.stringify({action, id, ...extra})}, 65000, true);
                if (!result || result.ok === false) {
                    finishFeedback('error');
                    notifyEditorialStatus(result?.error === 'subscription has no stored URL' ? '缺少订阅链接，请重新导入' : '订阅操作失败');
                    return;
                }
                finishFeedback('success');
                await loadAuthenticatedPanelData();
                renderEditorialStage(false);
                finishFeedback.rebind();
            };
            window.toggleDisableSub = (id) => {
                const item = WBState.subscriptions.find(sub => sub.id === id);
                if (item) return subscriptionAction('toggle', id, {enabled: !!item.disabled});
            };
            window.deleteSubscription = (id) => {
                if (window.confirm('删除此订阅？')) return subscriptionAction('delete', id);
            };
            window.refreshSingleSub = (id) => subscriptionAction('refresh', id);
            window.importFromPastedCallbackUrl = async () => {
                const input = document.getElementById('inp-account-credentials');
                if (typeof setPreviewFrameState === 'function') setPreviewFrameState('busy', 0);
                if (input?.classList) {
                    input.classList.remove('input-error-shake', 'input-success-green');
                    input.classList.add('input-verifying');
                }
                notifyEditorialStatus('正在解析并验证凭据 JSON…');
                await new Promise(r => setTimeout(r, 600)); // 黄色晃动等待反馈
                const finishFeedback = beginActionFeedback(input);
                if (input?.classList) input.classList.remove('input-verifying');
                let payload;
                try { payload = JSON.parse(input?.value || ''); } catch (_) {
                    finishFeedback('error');
                    notifyEditorialStatus('凭据 JSON 无效');
                    return;
                }
                const started = Date.now();
                const result = await safeApiFetch('/panel/api/accounts/import', {method: 'POST', body: JSON.stringify(payload)}, 59000, true);
                await new Promise(resolve => setTimeout(resolve, Math.max(0, 350 - (Date.now() - started))));
                if (!result?.ok) {
                    finishFeedback('error');
                    notifyEditorialStatus(result?.rollback_failed?.length ? 'Meta 回滚失败，代理内核已停止，请检查状态' : '凭据导入失败，请检查格式及账号状态');
                    await loadAuthenticatedPanelData();
                    return;
                }
                finishFeedback('success');
                await new Promise(resolve => setTimeout(resolve, 500));
                if (input) input.value = '';
                WBState.accountSubmode = null;
                await loadAuthenticatedPanelData();
                renderEditorialStage(true);
                notifyEditorialStatus('账号凭据已导入');
            };
            window.probeSingleNode = (nodeID) => {
                if (WBState.nodes.some(node => node.id === nodeID)) return refreshEgressView(nodeID);
                beginActionFeedback()('error');
                notifyEditorialStatus('节点不存在，请刷新列表');
            };
        }
        window.addEventListener('resize', handleViewportScaleSync);
        window.visualViewport?.addEventListener('resize', handleViewportScaleSync);

        /* =========================================================================
         * 全局输入框拓扑共鸣监听 (focusin / focusout / input 委托机制)
         * 确保整个内页中任何 .editorial-input 输入框在获得焦点（点击准备输入）时，
         * 右侧几何旋转视窗都能绘制纯虚线标尺靶向连接效果，并在失焦时优雅复原。
         * ========================================================================= */
        document.addEventListener('focusin', (e) => {
            const target = e.target;
            if (!target || !target.matches) return;
            if (target.matches('.editorial-input') || target.matches('input') || target.matches('textarea')) {
                if (target.id === 'inp-sub-name') {
                    setVertexHover(2, 'NAME // 订阅名称');
                } else if (target.id === 'inp-sub-url') {
                    setVertexHover(7, 'URL // 订阅地址');
                } else if (target.id === 'inp-acc-name') {
                    setVertexHover(3, 'ACC // 备注名称');
                } else if (target.id === 'inp-acc-region') {
                    setVertexHover(1, 'REGION // 节点区域');
                } else if (target.id === 'inp-acc-token') {
                    setVertexHover(5, 'TOKEN // 凭据内容');
                } else if (target.id === 'inp-oauth-callback-url') {
                    setVertexHover(4, 'OAUTH // 回调URL');
                } else if (target.id && target.id.startsWith('cfg-')) {
                    const cfgMap = {
                        'cfg-old-pwd': [2, 'PWD // 当前密码'],
                        'cfg-new-pwd': [4, 'PWD // 新设密码'],
                        'cfg-rep-pwd': [6, 'PWD // 密码确认'],
                        'cfg-threshold': [8, 'LIMIT // 熔断阈值'],
                        'cfg-sub-refresh': [10, 'SYNC // 刷新间隔']
                    };
                    const item = cfgMap[target.id];
                    if (item) setVertexHover(item[0], item[1]);
                    else setVertexHover(4, 'CONFIG // 系统参数');
                } else if (target.id && target.id.includes('custom-music')) {
                    setVertexHover(3, 'AUDIO // 音轨定义');
                } else if (target.id && target.id.includes('custom-slogan')) {
                    setVertexHover(5, 'MOTTO // 首页标语');
                } else {
                    const placeholder = target.placeholder || target.getAttribute('aria-label') || '';
                    const tagLabel = (target.id || 'INPUT').replace(/^inp-|^cfg-/, '').toUpperCase();
                    const tag = placeholder ? `${tagLabel} // ${placeholder}` : `${tagLabel} // 准备输入`;
                    let hash = 0;
                    const str = target.id || target.name || 'input';
                    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
                    const vIdx = Math.abs(hash) % 12;
                    setVertexHover(vIdx, tag);
                }
            }
        });

        document.addEventListener('focusout', (e) => {
            const target = e.target;
            if (target && target.matches && (target.matches('.editorial-input') || target.matches('input') || target.matches('textarea'))) {
                const next = e.relatedTarget;
                if (!next || !(next.matches && (next.matches('.editorial-input') || next.matches('input') || next.matches('textarea')))) {
                    setVertexHover(-1);
                }
            }
        });

        document.addEventListener('input', (e) => {
            const target = e.target;
            if (target && target.matches && (target.matches('.editorial-input') || target.matches('input') || target.matches('textarea'))) {
                if (target.id === 'inp-sub-name') {
                    setVertexHover(2, 'NAME // 订阅名称');
                } else if (target.id === 'inp-sub-url') {
                    setVertexHover(7, 'URL // 订阅地址');
                }
            }
        });

        /* =========================================================================
         * 10. 启动入口
         * ========================================================================= */
        window.onload = () => {
            updateResponsiveScale();
            initIntroGrid();
            requestAnimationFrame(renderIntroGrid);
            startStrictLoadingSequence();

            initMainWorld();
            renderMainWorld();
            requestAnimationFrame(renderProjectArtifactPreview);
            animateSoundWaveIcon();
        };

function bootGeometricRuntime() {
    if (typeof window === 'undefined') return;
    if (window.__geometricBooted) return;
    window.__geometricBooted = true;
    Object.assign(window, { renderEditorialStage, notifyEditorialStatus, setVertexHover,
        syncDynamicBottomButtons, switchCustomizationTab, selectCustomMusic,
        deleteCustomMusic, selectCustomSlogan, deleteCustomSlogan, selectCustomTheme,
        handleCustomMusicFileSelected, openCustomMusicPicker, setPreviewFrameState, switchChapterInPlace, probeAllAccountEgress, triggerReturnToMatrix });
    initEditorialEventDelegation(document);
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (typeof window !== 'undefined' && window.requestAnimationFrame ? window.requestAnimationFrame : (cb => setTimeout(cb, 16)));
    if (typeof updateResponsiveScale === 'function') updateResponsiveScale();
    if (typeof initIntroGrid === 'function') initIntroGrid();
    if (typeof renderIntroGrid === 'function') raf(renderIntroGrid);
    if (typeof startStrictLoadingSequence === 'function') startStrictLoadingSequence();

    if (typeof switchWeatherTheme === 'function' && currentWeatherKey) {
        switchWeatherTheme(currentWeatherKey);
    }
    if (typeof applyCurrentMottoToHome === 'function') {
        applyCurrentMottoToHome();
    }
    if (typeof initMainWorld === 'function') initMainWorld();
    if (typeof renderMainWorld === 'function') raf(renderMainWorld);
    if (typeof renderProjectArtifactPreview === 'function') raf(renderProjectArtifactPreview);
    if (typeof animateSoundWaveIcon === 'function') animateSoundWaveIcon();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        bootGeometricRuntime();
    } else {
        window.addEventListener('DOMContentLoaded', bootGeometricRuntime, { once: true });
        window.addEventListener('load', bootGeometricRuntime, { once: true });
    }
}
export { initEditorialEventDelegation, handleDataAction, bootGeometricRuntime };

window.resetOAuthLoginLink = () => {
    if (WBState.oauthPollTimer) {
        clearInterval(WBState.oauthPollTimer);
        WBState.oauthPollTimer = null;
    }
    if (WBState.loginAuthUrls) WBState.loginAuthUrls[WBState.loginRealm] = '';
    if (WBState.loginStates) WBState.loginStates[WBState.loginRealm] = '';
    WBState.loginAuthUrl = '';
    WBState.loginState = '';
    WBState.oauthWaiting = false;
    WBState.oauthPollStatus = 'IDLE';
    setPreviewFrameState('idle');
    notifyEditorialStatus('RESET');
    renderEditorialStage(false);
};

        window.selectSystemDefaultEgress = async (nodeID) => {
            const finishFeedback = beginActionFeedback();
            try {
                const res = await safeApiFetch('/panel/api/egress/default', {
                    method: 'POST',
                    body: JSON.stringify({ node: nodeID || '' })
                }, 35000);
                if (!res?.ok) {
                    finishFeedback('error');
                    notifyEditorialStatus('设置默认出口失败 // ' + (res?.error || '网络超时'));
                    return;
                }
                WBState.systemDefaultNode = nodeID || '';
                WBState.systemDefaultNodeName = res.node_name || '';
                WBState.pickingDefaultEgress = false;
                finishFeedback('success');
                notifyEditorialStatus(nodeID ? ('DEFAULT EGRESS SET -> ' + (res.node_name || nodeID).toUpperCase()) : 'DEFAULT EGRESS CLEARED // DIRECT');
                renderEditorialStage(false);
            } catch (err) {
                finishFeedback('error');
                notifyEditorialStatus('设置默认出口异常');
            }
        };
