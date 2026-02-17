/* ═══════════════════════════════════════════════════════════
   ANTIGRAVITY — Scroll Engine & Interactions
   Virtual smooth scroll, double-buffered canvas,
   delta-time lerp, progressive frame loading, single rAF
   ═══════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    /* ── Configuration ──────────────────────────────────── */
    const CONFIG = {
        FRAME_COUNT: 150,
        FRAME_PATH: './frames/',
        PARALLAX_SPEEDS: { layer1: 0.2, layer2: 0.5 },
        HERO_SCALE_MAX: 1.12,
        LERP_FACTOR: 0.08,        // Smooth scroll easing (lower = smoother)
        CANVAS_LERP: 0.14,
        TARGET_FPS: 60,
        PRELOAD_RADIUS: 12,
        BATCH_LOAD: 3,
        MIN_FRAMES_TO_START: 25,   // Frames needed before hiding preloader
    };

    /* ── Creative loading messages ──────────────────────── */
    const LOADING_MESSAGES = [
        'CALIBRATING GRAVITY WELLS...',
        'BENDING SPACETIME FABRIC...',
        'CHARGING PHOTON DRIVES...',
        'SYNCING QUANTUM FIELDS...',
        'INITIALIZING VOID ENGINE...',
        'DEFRAGMENTING DARK MATTER...',
        'ALIGNING STELLAR COORDINATES...',
        'WARMING UP WARP CORES...',
    ];

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
        contentHeight: 0,
    };

    /* ── DOM References ─────────────────────────────────── */
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);
    const DOM = {};

    /* ── Canvas ─────────────────────────────────────────── */
    let ctx, offscreen, offCtx;
    let canvasW = 0, canvasH = 0, dpr = 1;

    /* ── Frame Storage ─────────────────────────────────── */
    const frames = new Array(CONFIG.FRAME_COUNT).fill(null);
    const frameStatus = new Uint8Array(CONFIG.FRAME_COUNT);
    let anyFrameReady = false;
    let framesLoadedCount = 0;

    /* ── Mouse parallax element arrays ─────────────────── */
    let blobEls = [];
    let shardEls = [];

    /* ── Loading message rotation ──────────────────────── */
    let msgIndex = 0;
    let msgTimer = null;

    /* ── Service Worker ────────────────────────────────── */
    function registerSW() {
        if ('serviceWorker' in navigator && location.protocol !== 'file:') {
            navigator.serviceWorker.register('./sw.js').catch(() => { });
        }
    }

    /* ── Frame URL builder ─────────────────────────────── */
    function frameUrl(i) {
        return `${CONFIG.FRAME_PATH}${String(i + 1).padStart(3, '0')}.png`;
    }

    /* ── Load a single frame ───────────────────────────── */
    function loadFrame(index) {
        if (frameStatus[index] >= 1) return;
        frameStatus[index] = 1;

        const url = frameUrl(index);
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

    /* ── Preloader ─────────────────────────────────────── */
    function updatePreloader() {
        const progress = Math.min((framesLoadedCount / CONFIG.MIN_FRAMES_TO_START) * 100, 100);

        const textEl = document.getElementById('loader-progress');
        const barEl = document.getElementById('loader-bar-inner');
        const loaderEl = document.getElementById('preloader');

        if (textEl) textEl.textContent = `${Math.round(progress)}%`;
        if (barEl) barEl.style.width = `${progress}%`;

        if (framesLoadedCount >= CONFIG.MIN_FRAMES_TO_START && loaderEl && !loaderEl.classList.contains('hidden')) {
            loaderEl.classList.add('hidden');
            clearInterval(msgTimer);
            setTimeout(() => { loaderEl.style.display = 'none'; }, 800);
        }
    }

    function rotateLoadingMessage() {
        const el = document.getElementById('loader-status');
        if (!el) return;
        msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
        el.textContent = LOADING_MESSAGES[msgIndex];
    }

    /* ── Progressive Preloader ─────────────────────────── */
    let preloadTimer = null;

    function preloadFrames() {
        // Phase 1: evenly-spaced keyframes
        const keyCount = 20;
        for (let i = 0; i < keyCount; i++) {
            loadFrame(Math.round(i * (CONFIG.FRAME_COUNT - 1) / (keyCount - 1)));
        }
        // Phase 2: proximity + trickle
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
            if (frameStatus[i] === 0) { loadFrame(i); loaded++; }
        }
        if (frameStatus.every((s) => s >= 1)) {
            clearInterval(preloadTimer);
        }
    }

    /* ── Canvas Sizing ─────────────────────────────────── */
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

        offscreen = document.createElement('canvas');
        offscreen.width = pw;
        offscreen.height = ph;
        offCtx = offscreen.getContext('2d', { alpha: false });

        state.displayedFrame = -1;
    }

    /* ── Update body height to match content ────────────── */
    function syncBodyHeight() {
        if (!DOM.smoothContent) return;
        state.contentHeight = DOM.smoothContent.offsetHeight;
        document.body.style.height = state.contentHeight + 'px';
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

    /* ── Blit ──────────────────────────────────────────── */
    function blitBuffer() {
        if (!offscreen) return;
        ctx.drawImage(offscreen, 0, 0);
    }

    /* ── Delta-time Lerp ───────────────────────────────── */
    function lerp(current, target, factor, dt) {
        const r = current + (target - current) * (1 - Math.pow(1 - factor, dt * CONFIG.TARGET_FPS));
        return Math.abs(target - r) < 0.5 ? target : r;
    }

    /* ── Scroll Handler (captures native scroll value) ── */
    function onScroll() {
        state.targetScrollY = window.scrollY;

        const max = document.documentElement.scrollHeight - window.innerHeight;
        state.targetScrollProgress = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
        state.targetFrame = Math.min(
            Math.round(state.targetScrollProgress * (CONFIG.FRAME_COUNT - 1)),
            CONFIG.FRAME_COUNT - 1
        );

        if (DOM.nav) DOM.nav.classList.toggle('scrolled', window.scrollY > 80);
        if (DOM.heroContent) DOM.heroContent.classList.toggle('faded', window.scrollY > window.innerHeight * 0.15);
    }

    /* ═══════════════════════════════════════════════════════
       SINGLE rAF LOOP
       ═══════════════════════════════════════════════════════ */
    function animate(timestamp) {
        const dt = Math.min((timestamp - state.lastTime) / 1000, 0.1) || 0.016;
        state.lastTime = timestamp;

        // ── Smooth scroll interpolation ──
        state.smoothScrollY = lerp(state.smoothScrollY, state.targetScrollY, CONFIG.LERP_FACTOR, dt);
        state.smoothScrollProgress = lerp(state.smoothScrollProgress, state.targetScrollProgress, CONFIG.CANVAS_LERP, dt);

        // ── Virtual Scroll: translate the entire content container ──
        if (DOM.smoothContent) {
            DOM.smoothContent.style.transform = `translate3d(0, ${-state.smoothScrollY}px, 0)`;
        }

        // ── Parallax layers (different speeds via translate3d) ──
        if (DOM.layer1) {
            DOM.layer1.style.transform = `translate3d(0, ${-(state.smoothScrollY * CONFIG.PARALLAX_SPEEDS.layer1)}px, 0)`;
        }
        if (DOM.layer2) {
            DOM.layer2.style.transform = `translate3d(0, ${-(state.smoothScrollY * CONFIG.PARALLAX_SPEEDS.layer2)}px, 0)`;
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

        // ── Canvas draw (only on frame change) ──
        if (renderFrame !== state.displayedFrame && anyFrameReady) {
            const cf = Math.min(Math.max(renderFrame, 0), CONFIG.FRAME_COUNT - 1);
            drawFrameToBuffer(cf);
            blitBuffer();
            state.displayedFrame = cf;
        }

        // ── Mouse parallax (translate3d for GPU compositing) ──
        state.smoothMouseX += (state.mouseX - state.smoothMouseX) * 0.04;
        state.smoothMouseY += (state.mouseY - state.smoothMouseY) * 0.04;

        const mx = state.smoothMouseX;
        const my = state.smoothMouseY;

        for (let i = 0; i < blobEls.length; i++) {
            const f = 8 + i * 4;
            blobEls[i].style.transform = `translate3d(${mx * f}px, ${my * f}px, 0)`;
        }
        for (let i = 0; i < shardEls.length; i++) {
            const f = 5 + i * 3;
            shardEls[i].style.transform = `translate3d(${mx * f}px, ${my * f}px, 0)`;
        }

        requestAnimationFrame(animate);
    }

    /* ── Intersection Observer ─────────────────────────── */
    function initRevealObserver() {
        // Use the smooth-wrapper as root so elements within the translated container are observed correctly
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
                    // Since we use virtual scroll, scrollIntoView won't work correctly.
                    // Instead, we set window.scrollTo using the element's offsetTop.
                    window.scrollTo({ top: t.offsetTop, behavior: 'smooth' });
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
            syncBodyHeight();
            if (state.displayedFrame >= 0) {
                drawFrameToBuffer(state.displayedFrame);
                blitBuffer();
            }
        }, 100);
    }

    /* ── Initialize ─────────────────────────────────────── */
    function init() {
        // Cache DOM
        DOM.layer1 = $('#parallax-layer-1');
        DOM.layer2 = $('#parallax-layer-2');
        DOM.canvas = $('#frame-canvas');
        DOM.heroSection = $('#hero');
        DOM.heroContent = $('.hero-content');
        DOM.nav = $('#main-nav');
        DOM.smoothWrapper = $('#smooth-wrapper');
        DOM.smoothContent = $('#smooth-content');
        DOM.revealEls = $$('.reveal-up');

        ctx = DOM.canvas.getContext('2d', { alpha: false });
        blobEls = Array.from(document.querySelectorAll('.chrome-blob'));
        shardEls = Array.from(document.querySelectorAll('.crystal-shard'));

        // Register Service Worker
        registerSW();

        // Rotating loading messages
        msgTimer = setInterval(rotateLoadingMessage, 2500);

        // Sync body height for virtual scroll
        syncBodyHeight();

        // Start loading
        preloadFrames();
        initRevealObserver();
        initSmoothNav();

        // Events
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });
        document.addEventListener('mousemove', (e) => {
            state.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
            state.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
        }, { passive: true });

        onScroll();
        requestAnimationFrame(animate);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
