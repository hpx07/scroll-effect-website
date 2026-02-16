/* ═══════════════════════════════════════════════════════════
   ANTIGRAVITY — Scroll Engine & Interactions
   Optimized: double-buffered canvas, skip-redundant draws,
   delta-time lerp, pre-decoded images, GPU compositing
   ═══════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    /* ── Configuration ──────────────────────────────────── */
    const CONFIG = {
        FRAME_COUNT: 150,
        FRAME_PATH: './frames/',
        PARALLAX_SPEEDS: {
            layer1: 0.2,
            layer2: 0.5,
        },
        HERO_SCALE_MAX: 1.12,
        LERP_FACTOR: 0.1,
        CANVAS_LERP: 0.14,
        TARGET_FPS: 60,
    };

    /* ── State ──────────────────────────────────────────── */
    const state = {
        scrollY: 0,
        targetScrollY: 0,
        smoothScrollY: 0,
        scrollProgress: 0,
        targetScrollProgress: 0,
        smoothScrollProgress: 0,
        currentFrame: -1,       // -1 so first draw always triggers
        displayedFrame: -1,     // track what's actually on screen
        targetFrame: 0,
        imagesLoaded: 0,
        allLoaded: false,
        lastTime: 0,
    };

    /* ── DOM References ─────────────────────────────────── */
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const DOM = {
        layer1: $('#parallax-layer-1'),
        layer2: $('#parallax-layer-2'),
        canvas: $('#frame-canvas'),
        heroSection: $('#hero'),
        heroContent: $('.hero-content'),
        nav: $('#main-nav'),
        revealEls: $$('.reveal-up'),
    };

    const ctx = DOM.canvas.getContext('2d', { alpha: false });

    /* ── Offscreen buffer for double-buffering ─────────── */
    let offscreen = null;
    let offCtx = null;
    let canvasW = 0;
    let canvasH = 0;
    let dpr = 1;

    /* ── Frame Image Preloader (with decode) ───────────── */
    const frames = [];

    function preloadFrames() {
        let loaded = 0;
        for (let i = 1; i <= CONFIG.FRAME_COUNT; i++) {
            const img = new Image();
            const num = String(i).padStart(2, '0');
            img.src = `${CONFIG.FRAME_PATH}${num}.png`;

            const onReady = () => {
                loaded++;
                if (loaded === CONFIG.FRAME_COUNT) {
                    state.allLoaded = true;
                    resizeCanvas();
                    drawFrameToBuffer(0);
                    blitBuffer();
                }
            };

            // Use decode() for flicker-free rendering when available
            img.onload = () => {
                if (img.decode) {
                    img.decode().then(onReady).catch(onReady);
                } else {
                    onReady();
                }
            };
            img.onerror = onReady;
            frames.push(img);
        }
    }

    /* ── Canvas Sizing ─────────────────────────────────── */
    function resizeCanvas() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvasW = window.innerWidth;
        canvasH = window.innerHeight;

        DOM.canvas.width = canvasW * dpr;
        DOM.canvas.height = canvasH * dpr;
        DOM.canvas.style.width = '100vw';
        DOM.canvas.style.height = '100vh';

        // Recreate offscreen buffer at matching size
        offscreen = document.createElement('canvas');
        offscreen.width = canvasW * dpr;
        offscreen.height = canvasH * dpr;
        offCtx = offscreen.getContext('2d', { alpha: false });

        // Force redraw after resize
        state.displayedFrame = -1;
    }

    /* ── Draw Frame to Offscreen Buffer ────────────────── */
    function drawFrameToBuffer(index) {
        if (!state.allLoaded || !offCtx) return;
        const img = frames[index];
        if (!img || !img.complete || !img.naturalWidth) return;

        const cw = canvasW * dpr;
        const ch = canvasH * dpr;

        // Cover-fit calculation
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const canvasRatio = cw / ch;
        let drawW, drawH, drawX, drawY;

        if (canvasRatio > imgRatio) {
            drawW = cw;
            drawH = cw / imgRatio;
            drawX = 0;
            drawY = (ch - drawH) / 2;
        } else {
            drawH = ch;
            drawW = ch * imgRatio;
            drawX = (cw - drawW) / 2;
            drawY = 0;
        }

        // Draw to offscreen (no visible flicker)
        offCtx.fillStyle = '#06050b';
        offCtx.fillRect(0, 0, cw, ch);
        offCtx.drawImage(img, drawX, drawY, drawW, drawH);
    }

    /* ── Blit offscreen buffer to visible canvas ───────── */
    function blitBuffer() {
        if (!offscreen) return;
        ctx.drawImage(offscreen, 0, 0);
    }

    /* ── Lerp with delta-time compensation ─────────────── */
    function lerp(current, target, factor, dt) {
        // Delta-time adjusted lerp for framerate independence
        const f = 1 - Math.pow(1 - factor, dt * CONFIG.TARGET_FPS);
        const result = current + (target - current) * f;
        // Snap when very close to avoid infinite micro-drifts
        if (Math.abs(target - result) < 0.001) return target;
        return result;
    }

    /* ── Core Scroll Handler ───────────────────────────── */
    function onScroll() {
        state.targetScrollY = window.scrollY;

        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        state.targetScrollProgress = maxScroll > 0
            ? Math.min(Math.max(window.scrollY / maxScroll, 0), 1)
            : 0;

        state.targetFrame = Math.min(
            Math.round(state.targetScrollProgress * (CONFIG.FRAME_COUNT - 1)),
            CONFIG.FRAME_COUNT - 1
        );

        // Nav
        DOM.nav.classList.toggle('scrolled', window.scrollY > 80);

        // Hero fade
        DOM.heroContent.classList.toggle('faded', window.scrollY > window.innerHeight * 0.15);
    }

    /* ── Animation Loop (rAF with delta-time) ──────────── */
    function animate(timestamp) {
        // Delta time in seconds (capped to avoid jumps after tab switch)
        const dt = Math.min((timestamp - state.lastTime) / 1000, 0.1) || 0.016;
        state.lastTime = timestamp;

        // Smooth interpolation with delta-time
        state.smoothScrollY = lerp(state.smoothScrollY, state.targetScrollY, CONFIG.LERP_FACTOR, dt);
        state.smoothScrollProgress = lerp(state.smoothScrollProgress, state.targetScrollProgress, CONFIG.CANVAS_LERP, dt);

        // Smooth frame interpolation
        const smoothFrame = lerp(
            state.currentFrame < 0 ? state.targetFrame : state.currentFrame,
            state.targetFrame,
            CONFIG.CANVAS_LERP,
            dt
        );
        state.currentFrame = smoothFrame;
        const renderFrame = Math.round(smoothFrame);

        // ── Layer 1: Deep background parallax (0.2x) ──
        const layer1Y = -(state.smoothScrollY * CONFIG.PARALLAX_SPEEDS.layer1);
        DOM.layer1.style.transform = `translate3d(0, ${layer1Y}px, 0)`;

        // ── Layer 2: Floating elements parallax (0.5x) ──
        const layer2Y = -(state.smoothScrollY * CONFIG.PARALLAX_SPEEDS.layer2);
        DOM.layer2.style.transform = `translate3d(0, ${layer2Y}px, 0)`;

        // ── Canvas: only redraw when frame actually changes ──
        if (state.allLoaded && renderFrame !== state.displayedFrame) {
            const clampedFrame = Math.min(Math.max(renderFrame, 0), CONFIG.FRAME_COUNT - 1);
            drawFrameToBuffer(clampedFrame);
            blitBuffer();
            state.displayedFrame = clampedFrame;
        }

        // Scale effect (continuous, not tied to frame changes)
        const scale = 1 + (state.smoothScrollProgress * (CONFIG.HERO_SCALE_MAX - 1));
        DOM.canvas.style.transform = `translate3d(0, 0, 0) scale(${scale})`;

        requestAnimationFrame(animate);
    }

    /* ── Intersection Observer for Reveal Animations ───── */
    function initRevealObserver() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

        DOM.revealEls.forEach((el) => observer.observe(el));
    }

    /* ── Smooth Scroll for Nav Links ───────────────────── */
    function initSmoothNav() {
        $$('.nav-link[href^="#"]').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.querySelector(link.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    /* ── Debounced Resize Handler ──────────────────────── */
    let resizeTimer;
    function onResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeCanvas();
            if (state.allLoaded && state.displayedFrame >= 0) {
                drawFrameToBuffer(state.displayedFrame);
                blitBuffer();
            }
        }, 100);
    }

    /* ── Mouse parallax on floating elements (subtle) ──── */
    function initMouseParallax() {
        let mouseX = 0, mouseY = 0;
        let currentMX = 0, currentMY = 0;

        document.addEventListener('mousemove', (e) => {
            mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
            mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
        }, { passive: true });

        // Cache DOM queries
        const blobs = document.querySelectorAll('.chrome-blob');
        const shards = document.querySelectorAll('.crystal-shard');

        function updateMouse() {
            currentMX += (mouseX - currentMX) * 0.04;
            currentMY += (mouseY - currentMY) * 0.04;

            blobs.forEach((blob, i) => {
                const factor = 8 + i * 4;
                blob.style.transform = `translate3d(${currentMX * factor}px, ${currentMY * factor}px, 0)`;
            });

            shards.forEach((shard, i) => {
                const factor = 5 + i * 3;
                shard.style.transform = `translate3d(${currentMX * factor}px, ${currentMY * factor}px, 0)`;
            });

            requestAnimationFrame(updateMouse);
        }

        requestAnimationFrame(updateMouse);
    }

    /* ── Initialize ─────────────────────────────────────── */
    function init() {
        preloadFrames();
        initRevealObserver();
        initSmoothNav();
        initMouseParallax();

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });

        onScroll();
        requestAnimationFrame(animate);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
