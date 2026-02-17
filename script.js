/* ═══════════════════════════════════════════════════════════
   ANTIGRAVITY — Scroll Engine & Interactions
   Optimized: double-buffered canvas, delta-time lerp,
   progressive load, single rAF loop, virtual scroll
   ═══════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    /* ── Configuration ──────────────────────────────────── */
    const CONFIG = {
        FRAME_COUNT: 150,
        FRAME_PATH: './frames/',
        PARALLAX_SPEEDS: { layer1: 0.2, layer2: 0.5 },
        HERO_SCALE_MAX: 1.12,
        LERP_FACTOR: 0.1,
        CANVAS_LERP: 0.14,
        TARGET_FPS: 60,
        PRELOAD_RADIUS: 12,       // frames ahead/behind to eagerly load
        BATCH_LOAD: 3,            // frames to trickle-load per tick
    };

    /* ── State ──────────────────────────────────────────── */
    const state = {
        targetScrollY: 0,
        smoothScrollY: 0,
        targetScrollProgress: 0,
        smoothScrollProgress: 0,
        currentFrame: -1,
        displayedFrame: -1,
        targetFrame: 0,
        lastTime: 0,
        mouseX: 0,
        mouseY: 0,
        smoothMouseX: 0,
        smoothMouseY: 0,
    };

    /* ── DOM References ─────────────────────────────────── */
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    const DOM = {};

    function cacheDOM() {
        DOM.layer1 = $('#parallax-layer-1');
        DOM.layer2 = $('#parallax-layer-2');
        DOM.canvas = $('#frame-canvas');
        DOM.heroSection = $('#hero');
        DOM.heroContent = $('.hero-content');
        DOM.nav = $('#main-nav');
        DOM.smoothWrapper = $('#smooth-wrapper');
        DOM.smoothContent = $('#smooth-content');
        DOM.revealEls = $$('.reveal-up');
    }

    /* ── Canvas contexts ───────────────────────────────── */
    let ctx, offscreen, offCtx;
    let canvasW = 0, canvasH = 0, dpr = 1;

    /* ── Frame Storage ─────────────────────────────────── */
    const frames = new Array(CONFIG.FRAME_COUNT).fill(null);
    const frameStatus = new Uint8Array(CONFIG.FRAME_COUNT);
    let anyFrameReady = false;
    let framesLoadedCount = 0;

    /* ── Cached element arrays for mouse parallax ──────── */
    let blobEls = [];
    let shardEls = [];

    /* ── Service Worker Registration ───────────────────── */
    function registerSW() {
        if ('serviceWorker' in navigator && location.protocol !== 'file:') {
            navigator.serviceWorker.register('./sw.js').catch(() => { });
        }
    }

    /* ── Build frame URL ───────────────────────────────── */
    function frameUrl(i) {
        return `${CONFIG.FRAME_PATH}${String(i + 1).padStart(3, '0')}.png`;
    }

    /* ── Load a single frame (CPU FORCE) ───────────────── */
    function loadFrame(index) {
        if (frameStatus[index] >= 1) return;
        frameStatus[index] = 1;

        const url = frameUrl(index);

        // FORCE CPU: Always use standard Image element
        const img = new Image();
        img.src = url;
        img.onload = () => {
            frames[index] = img;
            frameStatus[index] = 2;
            onFrameReady(index);
        };
        img.onerror = () => { frameStatus[index] = 0; };
    }

    function onFrameReady(index) {
        framesLoadedCount++;
        updatePreloader();

        if (!anyFrameReady) {
            anyFrameReady = true;
            resizeCanvas();
            drawFrameToBuffer(index);
            blitBuffer();
        }
    }

    /* ── Preloader Logic ───────────────────────────────── */
    function updatePreloader() {
        const progress = Math.min((framesLoadedCount / 25) * 100, 100);

        const textEl = document.getElementById('loader-progress');
        const barEl = document.getElementById('loader-bar-inner');
        const loaderEl = document.getElementById('preloader');

        if (textEl) textEl.textContent = `${Math.round(progress)}%`;
        if (barEl) barEl.style.width = `${progress}%`;

        if (framesLoadedCount >= 25 && loaderEl && !loaderEl.classList.contains('hidden')) {
            loaderEl.classList.add('hidden');
            setTimeout(() => {
                loaderEl.style.display = 'none';
            }, 800);
        }
    }

    /* ── Progressive Preloader ─────────────────────────── */
    let preloadTimer = null;

    function preloadFrames() {
        const keyCount = 20;
        for (let i = 0; i < keyCount; i++) {
            loadFrame(Math.round(i * (CONFIG.FRAME_COUNT - 1) / (keyCount - 1)));
        }
        preloadTimer = setInterval(proximityLoad, 80);
    }

    function proximityLoad() {
        const center = state.targetFrame;
        for (let d = 0; d <= CONFIG.PRELOAD_RADIUS; d++) {
            if (center + d < CONFIG.FRAME_COUNT) loadFrame(center + d);
            if (center - d >= 0) loadFrame(center - d);
        }
        let loaded = 0;
        for (let i = 0; i < CONFIG.FRAME_COUNT && loaded < CONFIG.BATCH_LOAD; i++) {
            if (frameStatus[i] === 0) {
                loadFrame(i);
                loaded++;
            }
        }
        if (frameStatus.every((s) => s >= 1)) {
            clearInterval(preloadTimer);
        }
    }

    /* ── Canvas Sizing & Body Height ───────────────────── */
    function resizeCanvas() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvasW = window.innerWidth;
        canvasH = window.innerHeight;

        const pw = canvasW * dpr;
        const ph = canvasH * dpr;

        DOM.canvas.width = pw;
        DOM.canvas.height = ph;
        DOM.canvas.style.width = canvasW + 'px';
        DOM.canvas.style.height = canvasH + 'px';

        offscreen = document.createElement('canvas'); // Standard canvas
        offscreen.width = pw;
        offscreen.height = ph;
        offCtx = offscreen.getContext('2d', { alpha: false });

        state.displayedFrame = -1;

        // Update virtual scroll height
        updateScrollHeight();
    }

    function updateScrollHeight() {
        if (DOM.smoothContent) {
            document.body.style.height = DOM.smoothContent.offsetHeight + 'px';
        }
    }

    /* ── Draw Frame to Offscreen Buffer ────────────────── */
    function drawFrameToBuffer(index) {
        if (!offCtx) return;

        let img = frames[index];
        if (!img) {
            for (let d = 1; d < CONFIG.FRAME_COUNT; d++) {
                if (index - d >= 0 && frames[index - d]) { img = frames[index - d]; break; }
                if (index + d < CONFIG.FRAME_COUNT && frames[index + d]) { img = frames[index + d]; break; }
            }
            if (!img) return;
        }

        const pw = canvasW * dpr;
        const ph = canvasH * dpr;
        const iw = img.width || img.naturalWidth;
        const ih = img.height || img.naturalHeight;
        const ir = iw / ih;
        const cr = pw / ph;
        let dw, dh, dx, dy;

        if (cr > ir) {
            dw = pw; dh = pw / ir; dx = 0; dy = (ph - dh) / 2;
        } else {
            dh = ph; dw = ph * ir; dx = (pw - dw) / 2; dy = 0;
        }

        offCtx.fillStyle = '#06050b';
        offCtx.fillRect(0, 0, pw, ph);
        offCtx.drawImage(img, dx, dy, dw, dh);
    }

    /* ── Blit buffer to visible canvas ─────────────────── */
    function blitBuffer() {
        if (!offscreen) return;
        ctx.drawImage(offscreen, 0, 0);
    }

    /* ── Delta-time Lerp ───────────────────────────────── */
    function lerp(c, t, f, dt) {
        const r = c + (t - c) * (1 - Math.pow(1 - f, dt * CONFIG.TARGET_FPS));
        return Math.abs(t - r) < 0.0005 ? t : r;
    }

    /* ── Scroll Handler ────────────────────────────────── */
    function onScroll() {
        state.targetScrollY = window.scrollY;

        const max = document.documentElement.scrollHeight - window.innerHeight;
        state.targetScrollProgress = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
        state.targetFrame = Math.min(
            Math.round(state.targetScrollProgress * (CONFIG.FRAME_COUNT - 1)),
            CONFIG.FRAME_COUNT - 1
        );

        DOM.nav.classList.toggle('scrolled', window.scrollY > 80);
        DOM.heroContent.classList.toggle('faded', window.scrollY > window.innerHeight * 0.15);
    }

    /* ═══════════════════════════════════════════════════════
       SINGLE rAF LOOP
       ═══════════════════════════════════════════════════════ */
    function animate(timestamp) {
        const dt = Math.min((timestamp - state.lastTime) / 1000, 0.1) || 0.016;
        state.lastTime = timestamp;

        // ── Smooth scroll values ──
        state.smoothScrollY = lerp(state.smoothScrollY, state.targetScrollY, CONFIG.LERP_FACTOR, dt);
        state.smoothScrollProgress = lerp(state.smoothScrollProgress, state.targetScrollProgress, CONFIG.CANVAS_LERP, dt);

        // ── VIRTUAL SCROLL (The Page Content) ──
        if (DOM.smoothContent) {
            // Using transform for content is mandatory for smooth scroll feel
            // even if parallax layers are on CPU.
            DOM.smoothContent.style.transform = `translate3d(0, ${-state.smoothScrollY}px, 0)`;
        }

        // ── Frame interpolation ──
        const sf = lerp(
            state.currentFrame < 0 ? state.targetFrame : state.currentFrame,
            state.targetFrame,
            CONFIG.CANVAS_LERP,
            dt
        );
        state.currentFrame = sf;
        const renderFrame = Math.round(sf);

        // ── Parallax layers (CPU FORCE: marginTop) ──
        DOM.layer1.style.marginTop = `${-(state.smoothScrollY * CONFIG.PARALLAX_SPEEDS.layer1)}px`;
        DOM.layer2.style.marginTop = `${-(state.smoothScrollY * CONFIG.PARALLAX_SPEEDS.layer2)}px`;

        // ── Canvas draw ──
        if (renderFrame !== state.displayedFrame && anyFrameReady) {
            const cf = Math.min(Math.max(renderFrame, 0), CONFIG.FRAME_COUNT - 1);
            drawFrameToBuffer(cf);
            blitBuffer();
            state.displayedFrame = cf;
        }

        // ── Mouse parallax (CPU FORCE: marginLeft/Top) ──
        state.smoothMouseX += (state.mouseX - state.smoothMouseX) * 0.04;
        state.smoothMouseY += (state.mouseY - state.smoothMouseY) * 0.04;

        const mx = state.smoothMouseX;
        const my = state.smoothMouseY;

        for (let i = 0; i < blobEls.length; i++) {
            const f = 8 + i * 4;
            blobEls[i].style.marginLeft = `${mx * f}px`;
            blobEls[i].style.marginTop = `${my * f}px`;
        }
        for (let i = 0; i < shardEls.length; i++) {
            const f = 5 + i * 3;
            shardEls[i].style.marginLeft = `${mx * f}px`;
            shardEls[i].style.marginTop = `${my * f}px`;
        }

        requestAnimationFrame(animate);
    }

    /* ── Intersection Observer ─────────────────────────── */
    function initRevealObserver() {
        const obs = new IntersectionObserver((entries) => {
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) {
                    entries[i].target.classList.add('visible');
                    obs.unobserve(entries[i].target);
                }
            }
        }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

        DOM.revealEls.forEach((el) => obs.observe(el));
    }

    /* ── Smooth Nav ────────────────────────────────────── */
    function initSmoothNav() {
        $$('.nav-link[href^="#"]').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const t = document.querySelector(link.getAttribute('href'));
                if (t) {
                    // For virtual scroll, we need to scroll the window to the target's offset
                    // But since target is transformed, we need to calculate its original offset
                    // This is tricky with virtual scroll. 
                    // Simple hack: window.scrollTo with calculated position.
                    // Since body height is set, window.scrollTo works.
                    // The onScroll handler will update state.targetScrollY.

                    // We need to account for the fact that elements are inside the transformed container?
                    // No, getBoundingClientRect() will return position relative to viewport.
                    // offsetTop is relative to parent.
                    // The safest way is to just use window.scrollTo because onScroll drives the transformer.

                    // Calculate absolute position relative to document top (ignoring current transform)
                    // Actually, since we essentially "hijack" the visual view, window scrollbar positions match the content height.
                    // So t.offsetTop should be roughly correct if smooth-content is relative?
                    // No, smooth-content is static in flow, but transformed.
                    // Let's just trust standard scrollIntoView for now, or use window.scrollTo(0, t.offsetTop)

                    window.scrollTo({
                        top: t.offsetTop,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }

    /* ── Debounced Resize ──────────────────────────────── */
    let resizeTimer;
    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeCanvas();
            if (state.displayedFrame >= 0) {
                drawFrameToBuffer(state.displayedFrame);
                blitBuffer();
            }
        }, 100);
    }

    /* ── Initialize ─────────────────────────────────────── */
    function init() {
        cacheDOM();

        ctx = DOM.canvas.getContext('2d', { alpha: false });
        blobEls = Array.from(document.querySelectorAll('.chrome-blob'));
        shardEls = Array.from(document.querySelectorAll('.crystal-shard'));

        registerSW();
        preloadFrames();
        initRevealObserver();
        initSmoothNav();

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });
        document.addEventListener('mousemove', (e) => {
            state.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
            state.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
        }, { passive: true });

        // Initial sizing
        resizeCanvas();
        onScroll();
        requestAnimationFrame(animate);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
