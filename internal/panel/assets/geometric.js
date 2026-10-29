import { initEditorialEventDelegation, handleDataAction } from './editorial-events.js';
'use strict';
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
                this.isMuted = true;
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

            initForLogin() {
                if (this.isInitialized && this.ctx) {
                    if (this.ctx.state === 'suspended') this.ctx.resume();
                    return;
                }
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                this.ctx = new AudioCtx();
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = 0.7 / 3; // 登录页为主场景音量的三分之一
                this.masterGain.connect(this.ctx.destination);

                this.defaultAmbientGain = this.ctx.createGain();
                this.defaultAmbientGain.gain.value = 1.0;
                this.defaultAmbientGain.connect(this.masterGain);

                this.isMuted = false;
                this.isInitialized = true;
                this.isCustomActive = false;

                this.startRainAmbience();
                this.startAmbientPadLoop();
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
                    this.setMute(!enableSound);
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
                if (!this.isInitialized && !mute) {
                    this.init(true);
                    return;
                }
                if (this.ctx && this.ctx.state === 'suspended' && !mute) {
                    this.ctx.resume();
                }
                const now = this.ctx ? this.ctx.currentTime : 0;
                if (this.masterGain && this.ctx) {
                    this.masterGain.gain.cancelScheduledValues(now);
                    this.masterGain.gain.setTargetAtTime(mute ? 0.0 : 0.7, now, 0.1);
                }

                // 全局静音/取消静音联动：静音时统一静音并清理在途循环定时器，取消静音时恢复当前激活轨道的音量与100s调度
                if (mute) {
                    if (this.customAudio) {
                        if (this.customAudio._fadeRaf) {
                            cancelAnimationFrame(this.customAudio._fadeRaf);
                            this.customAudio._fadeRaf = null;
                        }
                        this.customAudio.volume = 0.0;
                    }
                    this.fadingAudios.forEach(aud => {
                        if (aud._fadeRaf) cancelAnimationFrame(aud._fadeRaf);
                        aud.volume = 0.0;
                        try { aud.pause(); aud.src = ''; if (aud.parentNode) aud.remove(); } catch (e) {}
                    });
                    this.fadingAudios.clear();
                } else {
                    if (this.isCustomActive && this.customAudio) {
                        this.customAudio.volume = 0.7;
                        if (this.customAudio.paused && !this.customAudio.ended) {
                            this.customAudio.play().catch(() => {});
                        }
                        if (this.defaultAmbientGain && this.ctx) {
                            this.defaultAmbientGain.gain.cancelScheduledValues(now);
                            this.defaultAmbientGain.gain.setValueAtTime(0.0, now);
                        }
                    } else {
                        if (this.defaultAmbientGain && this.ctx) {
                            this.defaultAmbientGain.gain.cancelScheduledValues(now);
                            this.defaultAmbientGain.gain.setTargetAtTime(1.0, now, 0.1);
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

                    // 2. 默认环境音平滑淡入到 1.0
                    if (this.defaultAmbientGain && this.ctx) {
                        const now = this.ctx.currentTime;
                        this.defaultAmbientGain.gain.cancelScheduledValues(now);
                        this.defaultAmbientGain.gain.setValueAtTime(this.defaultAmbientGain.gain.value, now);
                        this.defaultAmbientGain.gain.linearRampToValueAtTime(1.0, now + fadeSec);
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
                                        const targetVol = this.isMuted ? 0.0 : 0.7;
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
                    const targetVol = this.isMuted ? 0.0 : 0.7;
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
                maxOut: String(item.max_output_tokens || '—'), ttft: null, trend: []}));
            WBState.modelCacheHot = result.cached === true;
            return true;
        }

        function syncLogsData(logs) {
            if (!logs) return;
            if (Array.isArray(logs.entries)) {
                WBState.logs = logs.entries.map((item, i) => {
                    const timeStr = item.time ? (item.time.includes('T') ? item.time.split('T')[1].slice(0, 8) : item.time) : '12:00:00';
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
                comp: String(item.completion_tokens || 0), credits: String(item.credits || 0)
            }));
            const points = Array.isArray(data.series) ? data.series.slice(-24) : [];
            if (points.length >= 2) {
                const series = { labels: points.map(point => String(point.t).slice(11, 16)),
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
                else if (WBState.tasks.running) setPreviewFrameState('busy', 0);
                else if (wasRunning) setPreviewFrameState('success', 800);
            }
            WBState.tasks.pausedAll = !!maintenance.paused;
            WBState.tasks.activeStep = maintenance.steps.findIndex(step => step.state === 'running');
            WBState.tasks.steps = maintenance.steps.map((step, index) => ({
                code: String(index + 1).padStart(2, '0'), key: step.name,
                name: ({token: '访问令牌续期', checkin: '每日签到', activity: '每日活跃上报', travel: '猫猫旅行状态'})[step.name] || step.name,
                backendState: step.state,
                dur: (() => { const start = Date.parse(step.started_at); const end = Date.parse(step.finished_at); return Number.isFinite(start) && start > 946684800000 ? Math.max(0, Math.round(((Number.isFinite(end) && end > start ? end : Date.now()) - start) / 1000)) + 's' : '—'; })(), progress: ['done', 'failed'].includes(step.state) ? 100 : (step.total > 0 ? Math.round((step.accounts || []).length * 100 / step.total) : 0),
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
                    stateSpan.textContent = WBState.tasks.pausedAll ? '已暂停（排程停用）' : (WBState.tasks.running ? '排程停用（本次运行中）' : '已停用');
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
            if (WBState.tasks.running) setPreviewFrameState('busy', 0);
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
                const bundle = await safeApiFetch('/api/preload-bundle', {}, 3000);
                if (!bundle || !bundle.ciphertext || !bundle.iv) throw new Error('bootstrap unavailable');
                memoryEncryptedBundle = bundle;
                backendPreloadFinished = true;
                backendPreloadSuccess = true;
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
                const [ovRes, egressRes, pkgRes, logsRes, customRes, modelsRes] = await Promise.all([
                    safeApiFetch('/panel/api/overview', {}, 3500),
                    safeApiFetch('/panel/api/meta/nodes', {}, 3500),
                    safeApiFetch('/panel/api/packages', {}, 3500),
                    safeApiFetch('/panel/api/request_logs?summary=1&limit=50', {}, 3500),
                    safeApiFetch('/panel/api/customization', {}, 3500),
                    safeApiFetch('/panel/api/models', {}, 10000)
                ]);
                if (epoch !== authTransitionEpoch) return;
                if (ovRes) syncOverviewData(ovRes);
                const preferences = await safeApiFetch('/panel/api/preferences', {}, 3500);
                if (epoch !== authTransitionEpoch) return;
                if (Number.isInteger(preferences?.credit_guard_low)) WBState.configThreshold = preferences.credit_guard_low;
                if (Number.isInteger(preferences?.subscription_refresh_hours)) WBState.configCacheHours = preferences.subscription_refresh_hours;
                if (egressRes) syncEgressData(egressRes);
                if (pkgRes) syncPackagesData(pkgRes);
                if (logsRes) syncLogsData(logsRes);
                const usage = await safeApiFetch('/panel/api/usage?hours=24', {}, 10000);
                if (epoch !== authTransitionEpoch) return;
                syncUsageData(usage);
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
                    if (!WBState.subscriptions.some(item => item.id === WBState.activeSubId)) WBState.activeSubId = WBState.subscriptions[0]?.id || '';
                }
                syncModelsData(modelsRes);
                if (customRes && typeof customRes === 'object') {
                    const container = customRes.data && typeof customRes.data === 'object' ? customRes.data : customRes;
                    const saved = container.customization && typeof container.customization === 'object' ? container.customization : container;
                    // 音乐由 /panel/api/music 单独加载，避免旧个性化快照覆盖最新选择。
                    if (Array.isArray(saved.sloganList)) WBState.customization.sloganList = saved.sloganList.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.text === 'string' && typeof s.date === 'string');
                    if (typeof saved.activeSloganId === 'string' && WBState.customization.sloganList.some(s => s.id === saved.activeSloganId)) WBState.customization.activeSloganId = saved.activeSloganId;
                    if (typeof saved.randomMotto === 'boolean') WBState.customization.randomMotto = saved.randomMotto;
                }
            } catch (e) {
                console.warn('Authenticated panel preload failed:', e);
            }
        }

        function startStrictLoadingSequence() {
            const statusEl = document.getElementById('loading-status');
            const progressBarEl = document.getElementById('mini-progress-bar');

            // 在加载阶段预热登录页音频；进入密码框时只需恢复已创建的 AudioContext。
            try {
                if (typeof soundscape !== 'undefined' && soundscape) soundscape.initForLogin();
            } catch (e) {
                console.warn('Login audio preload deferred:', e);
            }

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
                                    soundscape.initForLogin();
                                    soundscape.activateLoginAudio();
                                    if (soundscape.ctx && soundscape.ctx.state === 'suspended') {
                                        const resume = soundscape.ctx.resume();
                                        if (resume && typeof resume.catch === 'function') resume.catch(() => {});
                                    }
                                }
                            } catch (e) {}
                            requestAnimationFrame(() => {
                                promptBox.style.opacity = '1';
                                if (accessKeyInput) accessKeyInput.focus();
                                if (btnEnterSystem) scrambleText(btnEnterSystem, '[ ACCESS WORKSPACE ]', 480);
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

        function triggerAccessDeniedAnimation(message = '[ ACCESS DENIED // INVALID ACCESS KEY ]') {
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
            
            if (pwdHint) {
                pwdHint.classList.add('text-[#ff5c74]');
                scrambleText(pwdHint, message, 320);
            }
            if (enterBtn) {
                scrambleText(enterBtn, '[ RE-ENTER KEY ]', 260);
            }

            setTimeout(() => {
                pwdContainer.classList.remove('access-denied-shake');
                accessKeyInput.classList.remove('access-denied-border');
                accessKeyInput.value = '';
                accessKeyInput.focus();
                if (pwdHint) {
                    pwdHint.classList.remove('text-[#ff5c74]');
                    scrambleText(pwdHint, 'PRESS ENTER OR CLICK TO DECRYPT', 320);
                }
                if (enterBtn) {
                    scrambleText(enterBtn, '[ ACCESS WORKSPACE ]', 320);
                }
                isAuthenticating = false;
            }, 1200);
        }

        async function submitPasswordAndEnter(withSound = true) {
            if (logoutResetTimer) return;
            if (isAuthenticating) return;
            isAuthenticating = true;
            // 在真实点击或回车的同步调用栈中解锁音频上下文；不能等网络
            // 登录返回后再 resume，否则浏览器可能把它当成无手势自动播放。
            if (withSound && soundscape) {
                soundscape.initForLogin();
                if (soundscape.ctx?.state === 'suspended') soundscape.ctx.resume().catch(() => {});
                soundscape.activateLoginAudio();
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
                triggerAccessDeniedAnimation();
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
                triggerAccessDeniedAnimation(failureMessage);
            }
        }

        if (btnEnterSystem) {
            btnEnterSystem.addEventListener('click', () => submitPasswordAndEnter(true));
        }
        const accessKeyInput = document.getElementById('input-access-key');
        if (accessKeyInput) {
            accessKeyInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitPasswordAndEnter(true);
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

        let currentWeatherKey = 'overcast';
        let blendedTheme = JSON.parse(JSON.stringify(WEATHER_THEMES.overcast));

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

        let mainSceneActive = false;
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
            transitionType: 'CARD_FLIP' // 'DIFFUSION' (全界面扩散) | 'CARD_FLIP' (牌面翻转)
        };

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

        function spawnGridHighlightWave(col, row, intensity = 1.0) {
            if (gridHighlightWaves.length > 10) gridHighlightWaves.shift();
            gridHighlightWaves.push({
                col,
                row,
                radius: 0.1,
                maxRadius: 9.5,
                speed: 0.22,
                intensity
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
        function renderMainWorld(now) {
            if (!mainSceneActive) {
                requestAnimationFrame(renderMainWorld);
                return;
            }

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
                hw.intensity *= 0.962;
                if (hw.radius > hw.maxRadius || hw.intensity < 0.03) {
                    gridHighlightWaves.splice(wIdx, 1);
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
                        waveBoost = Math.max(waveBoost, ringProfile * hw.intensity);
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
                    const delay = Math.min(0.52, t.centerDist * 0.40);
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

                    drop.y += drop.speed * currentUiScale;
                    drop.nx -= 0.00025;
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

            requestAnimationFrame(renderMainWorld);
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
            accounts:   { num: '02', navKey: 'accounts',   geoId: 'accounts',   geoLabel: 'VAULT CUBE',     title: 'IDENTITY VAULT',     cn: '账号池',   role: 'MULTI-ACCOUNT POOL & SAFEGUARDS',     desc: '整号余额低于阈值自动退池保护，支持单号独占绑定独立出口节点。', btn1: '[ INGEST TOKEN ]',   btn2: '[ REFRESH POOL ]' },
            egress:     { num: '03', navKey: 'egress',     geoId: 'egress',     geoLabel: 'DIAMOND',        title: 'NETWORK EGRESS',     cn: '账号出口', role: 'MIHOMO KERNEL // BANDWIDTH & NODES',  desc: '按启用订阅隔离展示出口节点、绑定账号归属与实时测速状态。', btn1: '[ REFRESH ALL ]',   btn2: '[ + IMPORT SUB ]' },
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

        const WBState = {
            currentChapter: 'overview',
            overrideSphere: false,
            isGlobalSpinning: false,
            spinTimer: null,
            hoveredVertexIdx: -1,
            hoveredTag: '',
            lastChartRevealAt: 0,
            chartClipSeq: 0,

            overviewMode: 'TRAFFIC', // 'TRAFFIC' | 'RESOURCE'
            uptimeSec: 412929,
            goroutines: 34,
            memMb: 48.2,
            cpuPct: 14.6,
            cpuHistory: [12.4, 15.1, 13.8, 18.2, 16.5, 14.0, 13.2, 19.4, 17.1, 15.0, 16.8, 14.2, 15.9, 14.6],
            memHistory: [46.0, 46.4, 46.8, 47.5, 48.1, 47.9, 47.6, 48.8, 48.5, 48.0, 48.4, 48.1, 48.3, 48.2],

            accountFilter: 'ALL',
            accountPage: 0,
            selectedAccountUid: null,
            accountNodePage: 0,
            accountSubmode: null, // null | 'LOGIN' | 'IMPORT'
            loginRealm: 'CN',
            ingestMode: 'OAUTH',
            loginAuthUrl: 'https://auth.workbuddy.cn/oauth/device?user_code=WB-89F2-K41A',

            egressTab: 'NODES',
            egressPage: 0,
            egressSubPage: 0,
            activeSubId: 'SUB-01', // Comment 5: 当前启用展示节点的订阅源
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
                activeSloganId: 's-1',
                sloganList: [
                    { id: 's-1', date: '2026-10-24 12:00', name: 'SILENT ARCHITECTURE', text: 'SILENT ARCHITECTURE // 静默架构 · 跨域协议中继与多租户网关' },
                ],
                randomTheme: false,
                activeTheme: 'overcast',
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
                labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
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
                labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
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
        window.WBState = WBState;
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

            return `<span class="task-line-shell ${animateBars ? 'task-line-enter' : ''} inline-block relative bg-white/12 align-middle shrink-0 overflow-hidden" style="width:${widthPx}px;height:1.8px;">
                <span class="task-active-track absolute left-0 top-0 bottom-0 overflow-hidden" style="width:${isPaused ? '0%' : '100%'};transition:width 0.45s cubic-bezier(0, 0, 0.2, 1);">
                    <span class="absolute left-0 top-0 bottom-0 bg-white/90" style="width:${currentWhitePct}%;"></span>
                    ${redPct > 0 ? `<span class="absolute top-0 bottom-0 bg-[#ff5c74] ${popCls}" style="left:${okTargetPct}%;width:${redPct}%;box-shadow:0 0 6px rgba(255,92,116,0.65);"></span>` : ""}
                </span>
                <span class="task-gray-track absolute top-0 bottom-0 " style="background-color:#9ca3af;right:0;width:${isPaused ? '100%' : '0%'};box-shadow:${isPaused ? '-2.5px 0 0 0 #050605' : 'none'};transition:width 0.45s cubic-bezier(0, 0, 0.2, 1), box-shadow 0.2s ease;"></span>
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
                stateLabel = WBState.tasks.pausedAll ? '已暂停' : (WBState.tasks.running ? '排程停用（本次运行中）' : '停用');
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
        window.changeEgressSubPage     = (p) => { WBState.egressSubPage = p;      renderEditorialStage(true); soundscape.triggerTileNote(5); };
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
            setPreviewFrameState('busy', 0);
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
                    t1 = '[ + NEW MOTTO ]';
                    t2 = '[ RANDOM ASSIGN ]';
                } else if (cust.currentTab === 'theme') {
                    t1 = '[ RANDOM THEME ]';
                    t2 = '[ RANDOM ASSIGN ]';
                }
            } else if (ch === 'sphere') {
                if (WBState.sphereUpdating) {
                    t1 = '[ UPDATING... ]';
                } else if (WBState.sphereUpdateReady) {
                    t1 = '[ RESTART & UPDATE ]';
                } else if (WBState.sphereCheckingUpdate) {
                    t1 = '[ CHECKING... ]';
                } else {
                    t1 = '[ CHECK UPDATE ]';
                }
                t2 = '[ <- MATRIX ]';
            } else if (ch === 'overview' || ch === 'gateway') {
                t1 = WBState.overviewMode === 'TRAFFIC' ? '[ RESOURCE CURVE ]' : '[ TRAFFIC CURVE ]';
            } else if (ch === 'accounts') {
                if (WBState.accountSubmode === 'INGEST') {
                    t1 = '[ <- POOL ]';
                    t2 = '[ √ INGEST ]';
                } else if (WBState.accountSubmode) {
                    t1 = '[ <- POOL ]';
                    t2 = '[ √ CONFIRM ]';
                } else {
                    t1 = '[ INGEST TOKEN ]';
                    t2 = '[ REFRESH POOL ]';
                }
            } else if (ch === 'egress') {
                if (WBState.importingSub) {
                    t1 = '[ <- NODES ]';
                    t2 = '[ √ CONFIRM ]';
                } else {
                    t1 = '[ REFRESH ALL ]';
                    t2 = '[ + IMPORT SUB ]';
                }
            } else if (ch === 'tasks' || ch === 'scheduler') {
                t1 = '[ START ALL TASKS ]';
                t2 = WBState.tasks.scheduleEnabled === false ? '[ ENABLE ALL TASKS ]' : '[ DISABLE ALL TASKS ]';
            } else if (ch === 'usage') {
                t1 = WBState.usageView === 'CURVE' ? '[ MODEL RANK ]' : '[ TIME CURVE ]';
                t2 = WBState.usageRange === '24H' ? '[ TIME: 6H ]' : '[ TIME: 24H ]';
            } else if (ch === "packages") {
                if (WBState.selectedPackageUid) {
                    t1 = "[ PACKAGE DETAIL ]";
                    t2 = "[ <- ACCOUNTS ]";
                } else if (WBState.packageView === "MODEL") {
                    t1 = "[ <- PACKAGES ]";
                    t2 = WBState.packageModelMode === "ACCOUNT" ? "[ MODEL: EXPIRY ]" : "[ MODEL: ACCOUNT ]";
                } else {
                    t1 = "[ EXPIRY MODEL ]";
                    t2 = WBState.packageListSort === "USAGE" ? "[ SORT: NAME ]" : "[ SORT: USAGE ]";
                }
            } else if (ch === 'logs') {
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
                l1.textContent = '核心版本'; v1.textContent = '3.0.1'; v1.className = "text-[22px] font-['Space_Grotesk'] font-medium text-white tracking-tight leading-normal tabular-nums-left whitespace-nowrap";
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
                l2.textContent = '目录缓存'; v2.textContent = WBState.modelCacheHot ? '热命中' : '已同步';
                l3.textContent = '平均首字延迟'; v3.textContent = avgTtft === null ? '—' : `${avgTtft} ms`;
            } else if (ch === 'tasks' || ch === 'scheduler') {
                const faultSteps = WBState.tasks.steps.filter(s => (s.failures?.length || 0) > 0).length;
                // Comment 11: 修改为 4项定时任务
                l1.textContent = '维护工序'; v1.textContent = '4 项维护任务';
                l2.textContent = '运行状态'; v2.textContent = WBState.tasks.scheduleEnabled === false ? (WBState.tasks.running ? '排程停用，本次运行中' : '已全部停用') : (WBState.tasks.running ? '执行锁定' : '空闲就绪');
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
            WBState.usageHoverIdx = idx;
            const ds = WBState.usageRange === '24H' ? WBState.usage24h : WBState.usage6h;
            const hIdx = idx >= 0 ? idx : ds.labels.length - 1;
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
            if (idx >= 0) setVertexHover(idx * 3, `${ds.labels[idx]} // OUT ${ds.outVals[idx]}K`);
            else setVertexHover(-1);
        };

        window.hoverErrorModelPoint = (idx) => {
            WBState.logModelHoverIdx = idx;
            const em = WBState.errorModelSeries;
            const hIdx = idx >= 0 ? idx : 4;
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
            if (idx >= 0) setVertexHover(idx * 2 + 1, `${em.labels[idx]} // L=${em.lambdaVals[idx].toFixed(2)}`);
            else setVertexHover(-1);
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
                            const previewText = `${s.name} // ${s.text.replace(/\n/g, ' ')}`;
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
                const primaryArr = isRes ? WBState.cpuHistory : WBState.downHistory;
                const secondaryArr = isRes ? WBState.memHistory : WBState.upHistory;
                const [pPts, sPts] = overviewChartPoints(primaryArr, secondaryArr);

                const headerLeft = isRes ? '系统资源变动曲线（实线服务 CPU / 虚线服务内存）' : '吞吐呼吸曲线（实线下行速率 / 虚线上行速率）';
                const headerRight = isRes
                    ? ('CPU ' + (WBState.cpuAvailable ? WBState.cpuPct.toFixed(1) + '%' : '—') + ' / 服务内存 ' + (WBState.serviceMemoryAvailable ? WBState.memMb.toFixed(1) + ' MB' : '—'))
                    : (WBState.trafficAvailable ? 'UP ' + WBState.upMbps.toFixed(2) + ' MB/s' : 'UP —');

                const clipId = 'ov-clip-' + (++WBState.chartClipSeq);
                const clipDef = animate ? ('<defs><clipPath id="' + clipId + '"><rect x="0" y="-6" width="540" height="84" class="svg-clip-spread-rect" /></clipPath></defs>') : '';
                const clipAttr = animate ? ('clip-path="url(#' + clipId + ')"') : '';

                commitStageMarkup(container, `
                    <div class="flex flex-col justify-start space-y-4 pt-1">
                        <div>
                            <div class="flex justify-between items-center text-[10px] tracking-[0.15em] text-white/42 mb-2 h-[16px] shrink-0">
                                <span class="overflow-hidden whitespace-nowrap">${headerLeft}</span>
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
                            <div data-hover-vertex="0" data-hover-label="MEM // ${WBState.memMb.toFixed(1)}MB">
                                <div class="text-[9.5px] tracking-[0.14em] text-white/36 mb-1 whitespace-nowrap">服务总内存</div>
                                <div id="ov-val-mem" class="text-white/88 tabular-nums-left whitespace-nowrap">${WBState.serviceMemoryAvailable ? WBState.memMb.toFixed(1) + ' MB' : '—'}</div>
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
                                <div class="inline-flex items-center space-x-5 py-0.5 max-w-sm">
                                    <button class="editorial-text-btn text-white text-[11.5px] px-0.5" data-action="open-oauth">[ 跳转浏览器授权 &rarr; ]</button>
                                    <button id="btn-oauth-status" class="editorial-text-btn text-[11.5px] px-0.5" data-action="copy-oauth">[ 复制授权链接 ]</button>
                                </div>
                                <!-- 兜底导入：适度收拢上方单元格，留出充足间距彻底避免与下方紧贴 -->
                                <div class="pt-1 border-t border-white/10 mt-1">
                                    <div class="flex justify-between items-center text-[11.5px] tracking-[0.12em] text-white/45 mb-1">
                                        <span>导入账号凭据 JSON（单个对象或数组）</span>
                                    </div>
                                    <div class="w-full pb-1 mb-3">
                                        <textarea id="inp-account-credentials" class="editorial-input credential-paste w-full font-mono text-[12px]" rows="2" wrap="off" autocomplete="off" placeholder="粘贴凭据 JSON"></textarea>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `, animate);
                    renderPagerControls(0, 1, '');
                    return;
                }

                if (WBState.selectedAccountUid) {
                    const acc = WBState.accounts.find(a => a.uid === WBState.selectedAccountUid);
                    if (acc) {
                        const rawLow = isRawLowBalance(acc);
                        let curModeLabel = '正常选号';
                        if (acc.state === 'BLOCKED' || acc.blocked) curModeLabel = '启用';
                        else if (!acc.manualOn) curModeLabel = '已停用';
                        else if (rawLow && !acc.forceOverride) curModeLabel = '低额保护';
                        else if (rawLow && acc.forceOverride) curModeLabel = '强行启用';

                        // 构建节点状态并严格按优先级排序：0=当前已绑/空闲可选(按ping升序) -> 1=超时节点 -> 2=已被其他账号绑定节点
                        const decoratedNodes = WBState.nodes.map(n => {
                            const owner = WBState.accounts.find(a => a.uid !== acc.uid && (IS_PROD_ENV ? a.egressNodeId === n.id : a.egress === n.name));
                            const isCurrent = IS_PROD_ENV ? acc.egressNodeId === n.id : acc.egress === n.name;
                            const isOccupied = Boolean(owner);
                            const isTimeout = Boolean(n.timeout);
                            let rankGroup = 0;
                            if (isCurrent) rankGroup = -1;
                            else if (isTimeout) rankGroup = 1;
                            else if (isOccupied) rankGroup = 2;
                            return { ...n, owner, isCurrent, isOccupied, isTimeout, rankGroup };
                        }).sort((a, b) => {
                            if (a.rankGroup !== b.rankGroup) return a.rankGroup - b.rankGroup;
                            return (a.ping || 9999) - (b.ping || 9999);
                        });

                        const nodesPerPage = 9; // 3 列 × 3 行，支持百级节点翻页且高度恒定零溢出
                        const totalNodePages = Math.max(1, Math.ceil(decoratedNodes.length / nodesPerPage));
                        if (WBState.accountNodePage >= totalNodePages) WBState.accountNodePage = totalNodePages - 1;
                        const nodeSlice = decoratedNodes.slice(WBState.accountNodePage * nodesPerPage, (WBState.accountNodePage + 1) * nodesPerPage);

                        const nodeCellsHtml = nodeSlice.map(n => {
                            const disabled = n.isTimeout;
                            let nameCls = 'text-white/82';
                            let rightHtml = '';
                            let borderCls = 'border-white/10 hover:border-white/40 cursor-pointer';
                            const latencyLabel = n.status === 'error' ? '失败' : n.status === 'untested' ? '未测速' : n.status === 'testing' ? '测速中' : `${n.ping}ms`;
                            const latencyClass = n.status === 'error' ? 'tone-fault' : n.status === 'untested' || n.status === 'testing' ? 'text-white/45' : n.ping < 800 ? 'tone-forced' : 'tone-guard';

                            if (n.isTimeout) {
                                nameCls = 'text-white/28';
                                borderCls = 'border-white/[0.05] cursor-not-allowed';
                                rightHtml = `<span class="text-[10.5px] tone-fault opacity-80 whitespace-nowrap shrink-0">超时</span>`;
                            } else if (n.isCurrent) {
                                nameCls = 'text-white font-medium';
                                borderCls = 'border-white/80 bg-white/[0.05] cursor-pointer';
                                rightHtml = `<span class="text-[10.5px] ${latencyClass} tabular-nums-left whitespace-nowrap">${latencyLabel}</span>`;
                            } else if (n.isOccupied) {
                                nameCls = 'text-white/70';
                                borderCls = 'border-white/10 hover:border-white/40 cursor-pointer';
                                rightHtml = n.status === 'error'
                                    ? `<span class="text-[10px] tone-fault tabular-nums-left whitespace-nowrap shrink-0">失败</span>`
                                    : `<span class="text-[10px] tone-guard tabular-nums-left whitespace-nowrap shrink-0">已绑定</span>`;
                            } else {
                                rightHtml = `<span class="text-[10.5px] ${latencyClass} tabular-nums-left whitespace-nowrap">${latencyLabel}</span>`;
                            }

                            const clickAttr = disabled ? '' : `data-action="bind-egress" data-uid="${escapeDisplayText(acc.uid)}" data-node="${escapeDisplayText(IS_PROD_ENV ? n.id : n.name)}"`;
                            return `
                                <div ${clickAttr} class="flex min-w-0 justify-between items-center gap-2 px-2 py-2 border-b ${borderCls} transition-colors text-left">
                                    <span class="text-[11px] ${nameCls} min-w-0 flex-1 fade-truncate" title="${escapeDisplayText(n.name)}">${escapeDisplayText(n.name)}</span>
                                    ${rightHtml}
                                </div>
                            `;
                        }).join('');

                        commitStageMarkup(container, `
                            <div class="space-y-3 text-left">
                                <div class="flex justify-between items-center border-b border-white/10 pb-2">
                                    <div class="flex items-center space-x-4 text-xs text-left">
                                        <span class="text-white font-medium">${acc.name}</span>
                                        <span class="text-white/40 text-[11px]">${acc.region}</span>
                                        <span class="text-white/42 text-[11px] tabular-nums-left">熔断 ${escapeDisplayText(acc.breakerAt || '—')}</span>
                                        <button class="editorial-text-btn text-white" data-action="toggle-account-manual" data-uid="${escapeDisplayText(acc.uid)}">[${curModeLabel}]</button>
                                    </div>
                                    <button class="editorial-text-btn" data-action="clear-selected-account">&larr; 返回列表</button>
                                </div>
                                <div class="flex justify-between items-center text-[10px] tracking-[0.12em] text-white/40">
                                    <span>账号绑定出口（当前：<strong class="text-white font-normal">${escapeDisplayText(acc.egress)}</strong>）</span>
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
                    let egressCls = 'text-white/65 hover:text-white';
                    if (WBState.egressProbed) {
                        if (acc._probeResult === 'FAIL') egressCls = 'tone-fault';
                        else if (acc._probeResult === 'DUPLICATE') egressCls = 'tone-guard';
                        else if (acc._probeResult === 'PASS') egressCls = 'tone-forced';
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
                                <span class="text-white/45 text-[10.5px] font-['Space_Grotesk'] text-left tracking-wider">${acc.region}</span>
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
                        const accCls = n.timeout || n.status === 'error' ? 'tone-fault' : boundCount > 1 ? 'tone-guard' : boundCount === 1 ? 'tone-forced' : 'text-white/30';
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
                        stateLabel = WBState.tasks.pausedAll ? '已暂停' : (WBState.tasks.running ? '排程停用（本次运行中）' : '停用');
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
                             style="grid-template-columns: minmax(120px, 144px) 108px 64px 48px 56px minmax(96px, 1fr);"
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

                commitStageMarkup(container, `<div>${WBState.tasks.running ? `<button class="editorial-text-btn mb-3" data-action="toggle-maintenance-pause">${WBState.tasks.pausedAll ? '继续本次任务' : '暂停本次任务'}</button>` : ''}${rowsHtml}</div>`, animate);
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
                            <span class="text-white/85 font-['Space_Grotesk'] tabular-nums-left">${r.credits} 积分</span>
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
                        <div class="flex justify-between items-center text-[10.5px] tracking-[0.14em] text-white/45">
                            <span id="usage-cursor-readout" class="tabular-nums-left">时刻 <strong class="text-white font-normal">${ds.labels[hIdx]}</strong> &mdash; 输出 ${ds.outVals[hIdx]}K / 输入 ${ds.inVals[hIdx]}K</span>
                            <div class="space-x-4">
                                <button class="editorial-tab ${WBState.usageRange==='6H'?'active':''}" data-action="set-usage-range" data-range="6H">6H</button>
                                <button class="editorial-tab ${WBState.usageRange==='24H'?'active':''}" data-action="set-usage-range" data-range="24H">24H</button>
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
                        <div class="flex justify-between text-[9.5px] tracking-[0.14em] text-white/32">
                            ${ds.labels.map(l => `<span>${l}</span>`).join('')}
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
                                <div class="editorial-row py-2.5 grid items-center gap-x-3 text-xs text-left"
                                     style="grid-template-columns: minmax(0, 1.45fr) 64px 150px 76px;"
                                     data-hover-vertex="${idx * 5 + 1}" data-hover-label='${p.id} // ${p.days}D LEFT'>
                                    <span class="text-white font-medium max-w-[145px] fade-truncate text-left">${p.name}</span>
                                    <span class="text-white/40 text-[10.5px] tabular-nums-left">顺位 ${String(globalOrder).padStart(2, '0')}</span>
                                    <div class="flex items-center space-x-2.5">
                                        <span class="text-white/88 font-['Space_Grotesk'] tabular-nums-left w-[98px] shrink-0">${p.remain.toLocaleString()} <span class="text-white/35 text-[10.5px]">/ ${p.total.toLocaleString()}</span></span>
                                        ${renderHairlineMeter(ratio, 36)}
                                    </div>
                                    <span class="text-[11px] ${tone} tabular-nums-left whitespace-nowrap">${p.days == null ? '到期时间未知' : p.days + ' 天到期'}</span>
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
                            <div class="editorial-row py-2.5 grid items-center gap-x-4 text-xs text-left cursor-pointer"
                                 style="grid-template-columns: minmax(100px, 1.4fr) 58px 76px 42px minmax(80px, 1fr) 58px;"
                                 data-action="select-package-uid" data-uid="${escapeDisplayText(acc.uid)}"
                                 data-hover-vertex="${vIdx}" data-hover-label="ACC // ${acc.name.toUpperCase()}"
                                 >
                                <span class="text-white font-medium max-w-[130px] truncate text-left" title="${acc.name}">${acc.name}</span>
                                <span class="text-white/52 text-[11px] tabular-nums-left">${activePacks.length} 个包</span>
                                <span class="text-white/90 font-['Space_Grotesk'] tabular-nums-left w-[76px] shrink-0">${balNum.toLocaleString()}</span>
                                <div class="flex items-center">${renderHairlineMeter(ratio, 42)}</div>
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

                        const curvePts = `0,50 ${points.map(p => `${p.x},${p.y}`).join(' ')} 520,50`;
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
                                        <span class="text-white/60 font-mono">B(i)/Q(i) // 账号额度统计</span>
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
                                <svg viewBox="0 0 520 70" class="w-full h-[70px] overflow-visible">
                                    ${clipDef}
                                    <line x1="40" y1="0" x2="40" y2="70" stroke="#ff5c74" stroke-width="1" stroke-dasharray="2 3" opacity="0.65" />
                                    <line x1="210" y1="0" x2="210" y2="70" stroke="rgba(255,255,255,0.22)" stroke-width="1" stroke-dasharray="2 3" />
                                    <line x1="0" y1="68" x2="520" y2="68" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
                                    <g ${clipAttr}>
                                        <polyline fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.35" points="${curvePts}" />
                                        ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#ffffff" opacity="0.9" />`).join('')}
                                    </g>
                                    <line id="pkg-model-cursor" x1="${initP.x}" y1="0" x2="${initP.x}" y2="68" stroke="#f0c987" stroke-width="1.2" opacity="0.8" />
                                </svg>
                                <div class="flex justify-between items-center text-[9px] tracking-[0.14em] text-white/35 mt-1.5 font-mono">
                                    <span>1D</span><span>3D</span><span>5D</span><span>10D</span><span>20D</span><span>30D</span>
                                </div>
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
                    const hIdx = WBState.logModelHoverIdx >= 0 ? WBState.logModelHoverIdx : 4;
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

        window.openOAuthLoginLink = () => {
            if (!WBState.loginState) {
                WBState.loginState = 'WB-STATE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
            }
            try {
                window.open(WBState.loginAuthUrl, '_blank', 'noopener,noreferrer');
            } catch(e) {}
            notifyEditorialStatus('OPENED BROWSER FOR OAUTH // WAITING FOR AUTHORIZATION...');

            WBState.oauthPollStatus = 'WAITING';
            const btn = document.getElementById('btn-oauth-status');
            if (btn) {
                btn.textContent = '[ 等待授权中... ... ]';
                btn.className = 'editorial-text-btn text-yellow-400 oauth-polling-pulse';
                btn.style.color = '#facc15';
                btn.style.borderColor = 'rgba(250, 204, 21, 0.4)';
                btn.style.textShadow = '0 0 8px rgba(250, 204, 21, 0.5)';
            }

            startOAuthPolling();
        };

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
            setPreviewFrameState('busy', 0);
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
            setPreviewFrameState('busy', 0);
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
            setPreviewFrameState('busy', 0);
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
            setPreviewFrameState('busy', 0);
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
                const node = WBState.nodes.find(n => n.name === acc.egress);
                const nodePrefix = (acc.egress || '').split('-')[0] || acc.region || 'GLOBAL';
                if (!node || node.timeout) {
                    acc._probeResult = 'FAIL'; // 不通: 红色
                    failCount++;
                } else if ((regionUsage[nodePrefix] || 0) > 1) {
                    acc._probeResult = 'DUPLICATE'; // 相同地区: 黄色
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
                setPreviewFrameState("success", 800);
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
        return daysArr.map((day, i) => {
            let expAcc = 0;
            let packs = 0;
            WBState.accounts.forEach(acc => {
                const activePacks = getAccountActivePackages(acc);
                if (activePacks.some(p => p.days !== null && p.days <= day)) expAcc++;
                packs += activePacks.filter(p => p.days !== null && p.days <= day).length;
            });
            const remaining = allPacks.filter(p => p.days > day).reduce((sum, p) => sum + (Number(p.remain) || 0), 0);
            const survival = total > 0 ? 100 * remaining / total : 0;
            const x = [40, 110, 210, 310, 410, 500][i];
            const y = Math.round(68 - (survival / 100) * 50);
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
            titleEl.textContent = `时段 ${p.day}天 — 存活积分 ${p.survival.toFixed(1)}% / 预计到期 ${p.expAcc} 账号 / 临期包 ${p.packs}`;
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
            setPreviewFrameState('busy', 0);

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
                            if (WBState.tasks.running) setPreviewFrameState('busy', 0);
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
                const ringState = WBState.ringState || (WBState.inTaskFaultFlash ? "error" : "idle");

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
            if (finishMusicPicker) finishMusicPicker('success');
            finishMusicPicker = null;
            if (nameEl) {
                nameEl.textContent = file.name;
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
            updateEditorialKeyFigures(false);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
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
                const result = await safeApiFetch('/panel/api/music/upload', {method:'POST', headers:{'Content-Type':mime, 'X-Audio-Name':encodeURIComponent(name)}, body:file}, 0x7fffffff);
                await new Promise(resolve => setTimeout(resolve, Math.max(0, 350 - (Date.now() - started))));
                if (!result || !Array.isArray(result.musicList)) {
                    finishFeedback('error'); notifyEditorialStatus('MUSIC // SAVE FAILED'); return;
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
                setPreviewFrameState('busy', 0);
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
            const nextCustomization = { ...WBState.customization, sloganList: [item, ...WBState.customization.sloganList], isAdding: false };
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

        function selectCustomSlogan(id) {
            WBState.customization.randomMotto = false;
            WBState.customization.activeSloganId = id;
            const s = WBState.customization.sloganList.find(x => x.id === id);
            soundscape.triggerTileNote(5);
            notifyEditorialStatus('MOTTO', 'SET -> ' + (s ? s.name : id));
            applyCurrentMottoToHome();
            updateEditorialKeyFigures(false);
            renderEditorialStage(false);
            syncDynamicBottomButtons();
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
            const cur = cust.sloganList.find(s => s.id === cust.activeSloganId);
            if (!cur) return;
            const subtitleEl = document.getElementById('prompt-subtitle');
            if (subtitleEl) {
                subtitleEl.textContent = cur.text;
            }
        }

        function switchChapterInPlace(chapterId) {
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
            spawnGridHighlightWave(Math.floor(GRID_COLS * 0.5), Math.floor(GRID_ROWS * 0.5), 1.45);

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
                    scrambleText(document.getElementById('page-archive-tag'), document.getElementById('page-archive-tag').textContent, 380);
                });
            }, 640);
        }

        function triggerReturnToMatrix() {
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
                spawnGridHighlightWave(Math.floor(GRID_COLS * 0.5), Math.floor(GRID_ROWS * 0.5), 1.15);
            }, 1020);
        }

        // 概览页秒级静默原地更新（In-Place DOM Mutation）：仅更新文本和曲线折点，绝不清空重建 DOM，彻底根除字体跳动
        function updateOverviewStageInPlace() {
            const isRes = WBState.overviewMode === 'RESOURCE';
            const rightHeaderEl = document.getElementById('ov-header-right');
            if (rightHeaderEl) {
                rightHeaderEl.textContent = isRes
                    ? ('CPU ' + (WBState.cpuAvailable ? WBState.cpuPct.toFixed(1) + '%' : '—') + ' / 服务内存 ' + (WBState.serviceMemoryAvailable ? WBState.memMb.toFixed(1) + ' MB' : '—'))
                    : (WBState.trafficAvailable ? 'UP ' + WBState.upMbps.toFixed(2) + ' MB/s' : 'UP —');
            }
            const pPoly = document.getElementById('ov-poly-primary');
            const sPoly = document.getElementById('ov-poly-secondary');
            if (pPoly && sPoly) {
                const primaryArr = isRes ? WBState.cpuHistory : WBState.downHistory;
                const secondaryArr = isRes ? WBState.memHistory : WBState.upHistory;
                const [pPts, sPts] = overviewChartPoints(primaryArr, secondaryArr);
                pPoly.setAttribute('points', pPts);
                sPoly.setAttribute('points', sPts);
            }
            const memValEl = document.getElementById('ov-val-mem');
            const uptimeValEl = document.getElementById('ov-val-uptime');
            if (memValEl) memValEl.textContent = WBState.serviceMemoryAvailable ? WBState.memMb.toFixed(1) + ' MB' : '—';
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

        // 秒级实时心跳：静默更新数值（animate=false，绝不重播入场动画或产生抖动）
        setInterval(() => {
            WBState.uptimeSec++;
            if (IS_PROD_ENV) {
                if (pageTransition.state === 'IN_PAGE') {
                    updateEditorialKeyFigures(false);
                    if (['overview', 'gateway', 'sphere'].includes(WBState.currentChapter)) updateOverviewStageInPlace();
                }
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

            if (hoveredTile && hoveredTile.project) {
                triggerEnterNewPage(hoveredTile.project.id);
                return;
            }

            let bestProjTile = null;
            let minProjDist = Infinity;
            for (let i = 0; i < gridTiles.length; i++) {
                const gt = gridTiles[i];
                if (!gt.project) continue;
                const dRender = Math.hypot(e.clientX - gt.screenX, e.clientY - gt.screenY);
                const dStable = Math.hypot(e.clientX - gt.stableScreenX, e.clientY - gt.stableScreenY);
                const effectiveDist = Math.min(dRender, dStable);
                const hitRadius = Math.max(76, gt.screenSize * 3.4);
                if (effectiveDist <= hitRadius && effectiveDist < minProjDist) {
                    minProjDist = effectiveDist;
                    bestProjTile = gt;
                }
            }
            if (bestProjTile) {
                triggerEnterNewPage(bestProjTile.project.id);
                return;
            }

            if (hoveredTile) {
                let nearestProj = null;
                let minGridD = Infinity;
                PROJECTS.forEach(p => {
                    const d = Math.hypot(p.col - hoveredTile.c, p.row - hoveredTile.r);
                    if (d < minGridD) { minGridD = d; nearestProj = p; }
                });
                if (nearestProj && minGridD <= 1.7) {
                    triggerEnterNewPage(nearestProj.id);
                    return;
                }
                spawnGridHighlightWave(hoveredTile.c, hoveredTile.r, 1.25);
            }

            disturbGridAtScreenPos(e.clientX, e.clientY, 180, 36);
            const waterLineY = window.innerHeight * (4 / 7);
            spawnPondRipple(e.clientX, Math.max(e.clientY, waterLineY + 18), 90, 0.78);
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
                WBState.customization.activeTheme = weatherKey;
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
                if (!WBState.sphereUpdateReady) {
                    if (WBState.sphereCheckingUpdate) return;
                    WBState.sphereCheckingUpdate = true;
                    soundscape.triggerTileNote(7);
                    notifyEditorialStatus('CHECKING UPDATE // /panel/api/update/check');
                    if (btn1) {
                        btn1.classList.remove('border-white/50', 'border-rose-500', 'border-emerald-400');
                        btn1.classList.add('border-amber-400', 'text-amber-300', 'animate-pulse', 'bg-amber-400/10');
                    }
                    setPreviewFrameState('busy', 0);
                    syncDynamicBottomButtons();

                    const checkPromise = (typeof safeApiFetch === 'function')
                        ? safeApiFetch('/panel/api/update/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 2500)
                        : fetch('/panel/api/update/check', { method: 'POST' }).then(r => r.json()).catch(() => null);

                    Promise.all([
                        checkPromise,
                        new Promise(resolve => setTimeout(resolve, 800))
                    ]).then(([data]) => {
                        WBState.sphereCheckingUpdate = false;
                        if (data && data.has_update === false) {
                            WBState.sphereUpdateReady = false;
                            syncDynamicBottomButtons();
                            if (btn1) {
                                btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse', 'border-rose-500');
                                btn1.classList.add('border-emerald-400');
                                setTimeout(() => btn1.classList.remove('border-emerald-400'), 1200);
                            }
                            setPreviewFrameState('success', 1200);
                            notifyEditorialStatus('UPDATE CHECK COMPLETE // ALREADY UP TO DATE');
                        } else if (data && data.has_update === true && data.data?.artifact?.verified === true) {
                            WBState.sphereUpdateReady = true;
                            if (btn1) {
                                btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse', 'border-rose-500', 'border-white/50');
                                btn1.classList.add('border-emerald-400', 'text-emerald-300', 'bg-emerald-400/10');
                            }
                            setPreviewFrameState('success', 1200);
                            notifyEditorialStatus(`UPDATE AVAILABLE // V${data.current_version || '—'} -> V${data.latest_version || '—'}`);
                            syncDynamicBottomButtons();
                        } else {
                            throw new Error('Check failed');
                        }
                    }).catch(() => {
                        WBState.sphereCheckingUpdate = false;
                        WBState.sphereUpdateReady = false;
                        syncDynamicBottomButtons();
                        if (btn1) {
                            btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse', 'border-emerald-400');
                            btn1.classList.add('border-rose-500', 'text-rose-400', 'canvas-fault-jolt');
                            setTimeout(() => { btn1.classList.remove('canvas-fault-jolt'); if (WBState.currentChapter === 'sphere') syncDynamicBottomButtons(); }, 1200);
                        }
                        setPreviewFrameState('error', 800);
                        notifyEditorialStatus('UPDATE CHECK FAILED // CLICK TO RETRY');
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
                    setPreviewFrameState('busy', 0);
                    syncDynamicBottomButtons();

                    const applyPromise = (typeof safeApiFetch === 'function')
                        ? safeApiFetch('/panel/api/update/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 0x7fffffff)
                        : fetch('/panel/api/update/apply', { method: 'POST' }).then(r => r.json()).catch(() => null);

                    applyPromise.then(data => {
                        if (!data || data.ok !== true) throw new Error('verified update is unavailable');
                        WBState.sphereUpdateApplied = true;
                        if (btn1) {
                            btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse');
                            btn1.classList.add('border-emerald-400', 'text-emerald-300');
                        }
                        setPreviewFrameState('success', 1000);
                        WBState.sphereUpdating = false;
                        notifyEditorialStatus('UPDATE INSTALLED // RESTART SERVICE TO ACTIVATE');
                    }).catch(() => {
                        WBState.sphereUpdating = false;
                        syncDynamicBottomButtons();
                        if (btn1) {
                            btn1.classList.remove('border-amber-400', 'text-amber-300', 'animate-pulse');
                            btn1.classList.add('border-rose-500', 'text-rose-400', 'canvas-fault-jolt');
                            setTimeout(() => { btn1.classList.remove('canvas-fault-jolt'); if (WBState.currentChapter === 'sphere') syncDynamicBottomButtons(); }, 1200);
                        }
                        setPreviewFrameState('error', 800);
                        notifyEditorialStatus('UPDATE FAILED');
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
                notifyEditorialStatus(WBState.overviewMode === 'RESOURCE' ? 'VIEW -> CPU & MEMORY CURVE' : 'VIEW -> NETWORK THROUGHPUT CURVE');
                renderEditorialStage(true);
            } else if (ch === 'accounts') {
                WBState.selectedAccountUid = null;
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
                    setPreviewFrameState('busy', 0);
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
                    setPreviewFrameState('busy', 0);
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
                    setPreviewFrameState('busy', 0);
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
                    if (!isChangingPwd) setPreviewFrameState('busy', 0);

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
                if (WBState.accountSubmode) {
                    window.importFromPastedCallbackUrl();
                } else {
                    triggerGlobalDataRefresh();
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
                const nextTargetBtnText = WBState.usageRange === '24H' ? '[ TIME: 6H ]' : '[ TIME: 24H ]';
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
            setPreviewFrameState('busy', 0);
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
        const waveCtx = waveCanvas.getContext('2d');
        let wavePhase = 0;

        function animateSoundWaveIcon() {
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
            requestAnimationFrame(animateSoundWaveIcon);
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
                soundscape.fadeAudio(soundscape.customAudio, soundscape.customAudio.volume, withSound ? 0.7 : 0.0, 1200);
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
                    notifyEditorialStatus('ACCOUNT DELETE FAILED // 状态未改变');
                    return;
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
            }
        });

        document.getElementById('btn-copy-email').addEventListener('click', () => {
            const endpoint = 'http://127.0.0.1:7863/v1';
            navigator.clipboard?.writeText(endpoint);
            const emailText = document.getElementById('email-text');
            scrambleText(emailText, '[ ENDPOINT COPIED TO CLIPBOARD ]', 350);
            setTimeout(() => {
                scrambleText(emailText, '[ 127.0.0.1:7863/V1 ]', 400);
            }, 2200);
        });

        async function refreshEgressView(nodeID = null) {
            if (WBState._egressRefreshing) return;
            WBState._egressRefreshing = true;
            // 大按钮始终保留原样；批量操作只驱动右侧圆环。
            const finishFeedback = !nodeID
                ? Object.assign((state, ringState = state) => setPreviewFrameState(ringState, 800), { rebind: () => {} })
                : beginActionFeedback();
            if (!nodeID) setPreviewFrameState('busy', 0);
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
                    const allFailed = status.total > 0 && status.failed >= status.total;
                    const ringFailed = status.cancelled || boundFailure || (!nodeID && allFailed);
                    const nodeFailed = nodeID && (!selected || selected.timeout || selected.status === 'error');
                    finishFeedback(status.cancelled || nodeFailed || (!nodeID && allFailed) ? 'error' : 'success', ringFailed ? 'error' : 'success');
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
                WBState.loginAuthUrl = '';
                WBState.loginState = '';
                renderEditorialStage(false);
            };
            window.openOAuthLoginLink = async () => {
                const finishFeedback = beginActionFeedback();
                const authWindow = window.open('about:blank', '_blank');
                if (authWindow) authWindow.opener = null;
                const result = await safeApiFetch('/panel/api/login/start', {method: 'POST', body: JSON.stringify({realm: WBState.loginRealm.toLowerCase()})}, 35000);
                if (!result?.state || !result?.url) { finishFeedback('error'); if (authWindow) authWindow.close(); notifyEditorialStatus('获取授权链接失败'); return; }
                let authURL;
                try { authURL = new URL(result.url); } catch (_) { finishFeedback('error'); if (authWindow) authWindow.close(); notifyEditorialStatus('授权链接无效'); return; }
                if (authURL.protocol !== 'https:' || authURL.username || authURL.password) { finishFeedback('error'); if (authWindow) authWindow.close(); notifyEditorialStatus('授权链接无效'); return; }
                WBState.loginState = result.state;
                WBState.loginAuthUrl = authURL.href;
                if (authWindow) authWindow.location.href = authURL.href;
                else notifyEditorialStatus('浏览器阻止了新窗口，请复制授权链接');
                finishFeedback('success'); // Link obtained; authorization completion is reported separately.
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
                const finishFeedback = beginActionFeedback(input);
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
            requestAnimationFrame(renderMainWorld);
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
        handleCustomMusicFileSelected, openCustomMusicPicker });
    initEditorialEventDelegation(document);
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (typeof window !== 'undefined' && window.requestAnimationFrame ? window.requestAnimationFrame : (cb => setTimeout(cb, 16)));
    if (typeof updateResponsiveScale === 'function') updateResponsiveScale();
    if (typeof initIntroGrid === 'function') initIntroGrid();
    if (typeof renderIntroGrid === 'function') raf(renderIntroGrid);
    if (typeof startStrictLoadingSequence === 'function') startStrictLoadingSequence();

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
