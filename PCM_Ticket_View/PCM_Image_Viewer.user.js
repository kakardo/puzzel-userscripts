// @file_name = PCM_Image_Viewer.user.js
// @author = Kardo Rostam
// @version = 1.7_2026-11-17
// @created = 2026-09-03 09:43

// ==UserScript==
// @name         PCM Image Viewer
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.7_2026-11-17
// @description  Upgrades the attachment preview modal on the ticket view. Adds an Open in tab button beside Download (same style, own colour) linking the previewed attachment, zoom controls for image previews (one split button with zoom out on the left, the current zoom in per cent in the middle and zoom in on the right, and one button that shows the image at its actual size, reading 1:1, and once pressed or zoomed reads Fit and fits it back, always at the same width so the row never moves), and drag to pan: grab the image and drag to scroll around it when zoomed. The preview window fills the browser window (a small margin around it), and an image opens fitted to all of that space, in width and height, centred (small images are enlarged too, FIT_UPSCALE at the top turns that off); it fits again when the window is resized. The window's size rules are in place from the start and the attachment stays hidden until it is fitted, so nothing jumps from the normal size to the large one. The preview is a same-origin iframe, so zoom and pan act on the image document inside it directly, and controls appear only when the previewed attachment is an image. Purely event-driven via shown.bs.modal and the iframe load event: zero cost while no preview is open, no observers, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Image_Viewer.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Image_Viewer.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    var OPEN_LABEL = 'Open in tab';
    var ZOOM_STEP = 1.25;
    var ZOOM_MIN = 0.1;
    var ZOOM_MAX = 8;
    // Fit also enlarges images smaller than the space (false: never above
    // their actual size).
    var FIT_UPSCALE = true;
    // Space kept free around the preview window, in pixels.
    var WINDOW_MARGIN_PX = 16;
    // Gap between the buttons in the preview's header.
    var BUTTON_GAP_PX = 8;

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var MODAL_ID = 'attachment_preview_modal';
    var STYLE_ID = 'pcm-image-viewer-style';
    var OPEN_ID = 'pcm-iv-open';
    var GROUP_ID = 'pcm-iv-zoom';
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 250;

    // Current zoom factor. 0 is the sentinel for Fit (the browser's own
    // shrink-to-fit rendering, which is also the state on every open).
    var factor = 0;

    var CSS = [
        '.pcm-iv-btn {',
        '    background-color: #2f7d9e;',
        '    border-color: #276a86;',
        '    color: #fff;',
        '}',
        '.pcm-iv-btn:hover, .pcm-iv-btn:focus {',
        '    background-color: #276a86;',
        '    border-color: #1f596f;',
        '    color: #fff;',
        '}',
        '#' + GROUP_ID + ' > * { vertical-align: middle; }',
        '#' + GROUP_ID + ' > .pcm-iv-btn { margin-left: ' + BUTTON_GAP_PX + 'px; min-width: 40px; }',
        // Zoom out | 100% | zoom in, as one button with dividers.
        '#' + GROUP_ID + ' .pcm-iv-split { display: inline-flex; margin-left: 0; border-radius: 3px; overflow: hidden; }',
        '#' + GROUP_ID + ' .pcm-iv-split .pcm-iv-btn { margin: 0; min-width: 34px; }',
        '#' + GROUP_ID + ' .pcm-iv-split .pcm-iv-btn + span, #' + GROUP_ID + ' .pcm-iv-split span + .pcm-iv-btn { box-shadow: inset 1px 0 0 rgba(255,255,255,.35); }',
        '#' + GROUP_ID + ' .pcm-iv-level {',
        '    display: inline-flex; align-items: center; justify-content: center; min-width: 50px; padding: 0 6px;',
        '    background-color: #276a86; color: #fff; font-variant-numeric: tabular-nums; cursor: default;',
        '}',
        // One gap between all header buttons: Open in tab and the zoom group
        // keep it to their right, the 1:1/Fit button to its left.
        '#' + OPEN_ID + ' { margin-right: ' + BUTTON_GAP_PX + 'px !important; margin-left: 0 !important; }',
        '#' + GROUP_ID + ' { margin-right: ' + BUTTON_GAP_PX + 'px !important; }',
        // The preview window takes the whole browser window, and its body
        // (with the attachment's frame) all the height below the header.
        '#' + MODAL_ID + ' .modal-dialog {',
        '    width: calc(100vw - ' + (WINDOW_MARGIN_PX * 2) + 'px) !important; max-width: none !important;',
        '    height: calc(100vh - ' + (WINDOW_MARGIN_PX * 2) + 'px) !important; margin: ' + WINDOW_MARGIN_PX + 'px auto !important;',
        '}',
        '#' + MODAL_ID + ' .modal-content { height: 100% !important; display: flex !important; flex-direction: column !important; }',
        '#' + MODAL_ID + ' .modal-body { flex: 1 1 auto !important; min-height: 0 !important; padding: 8px !important; }',
        '#' + MODAL_ID + ' .modal-body iframe { width: 100% !important; height: 100% !important; min-height: 0 !important; border: 0; }',
        // Hidden until the attachment has loaded and been fitted, so it is
        // never seen at its own size first.
        '#' + MODAL_ID + ' .modal-body iframe:not([data-pcm-iv-ready]) { visibility: hidden; }'
    ].join('\n');

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function getFrame(modal) {
        return modal.querySelector('iframe.preview-frame, iframe');
    }

    // The preview iframe is same-origin (/secure_attachments/...), so the
    // browser's generated image document is reachable. Non-image
    // attachments (PDF viewer etc.) have no <img> and get no zoom UI.
    function getFrameImg(modal) {
        try {
            var frame = getFrame(modal);
            var doc = frame && frame.contentDocument;
            return doc ? doc.querySelector('img') : null;
        } catch (_) {
            return null;
        }
    }

    // Fit is computed explicitly (largest factor that shows the whole
    // image, never above 1) instead of clearing styles and hoping the
    // preview document's own CSS shrinks the image again: it did not
    // reassert itself after zooming, so Fit looked dead.
    function fitFactor(modal) {
        var frame = getFrame(modal);
        var img = getFrameImg(modal);
        if (!frame || !img || !img.naturalWidth) return 1;
        var doc = frame.contentDocument;
        var vw = (doc.documentElement && doc.documentElement.clientWidth) || frame.clientWidth;
        var vh = (doc.documentElement && doc.documentElement.clientHeight) || frame.clientHeight;
        var f = Math.min(vw / img.naturalWidth, vh / img.naturalHeight);
        if (!FIT_UPSCALE) f = Math.min(f, 1);
        return (f > 0 && isFinite(f)) ? f : 1;
    }

    function applyZoom(modal) {
        var img = getFrameImg(modal);
        if (!img || !img.naturalWidth) return;
        var f = factor === 0 ? fitFactor(modal) : factor;
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        img.style.height = 'auto';
        img.style.width = Math.floor(img.naturalWidth * f) + 'px';
        // Centred: across by auto margins, down by a top margin while the
        // image is lower than the space (0 when it is taller, so it can be
        // scrolled from its top).
        var doc = img.ownerDocument;
        if (doc.body && doc.body.style.margin !== '0px') doc.body.style.margin = '0';
        img.style.display = 'block';
        img.style.marginLeft = 'auto';
        img.style.marginRight = 'auto';
        var vh = (doc.documentElement && doc.documentElement.clientHeight) || 0;
        var h = Math.floor(img.naturalHeight * f);
        img.style.marginTop = Math.max(0, Math.floor((vh - h) / 2)) + 'px';
        showZoom(f);
    }

    // The per cent between the zoom buttons, and the size button's text:
    // 1:1 while fitted, Fit at any other zoom.
    function showZoom(f) {
        var group = document.getElementById(GROUP_ID);
        if (!group) return;
        var level = group.querySelector('.pcm-iv-level');
        if (level) level.textContent = Math.round(f * 100) + '%';
        var toggle = group.querySelector(':scope > .pcm-iv-btn');
        if (!toggle) return;
        var fitted = factor === 0;
        toggle.textContent = fitted ? '1:1' : 'Fit';
        toggle.title = fitted ? 'Show the image at its actual size (1:1)' : 'Fit the image to the window';
    }

    function currentFactor(modal) {
        var img = getFrameImg(modal);
        if (!img || !img.naturalWidth) return 1;
        if (factor !== 0) return factor;
        return fitFactor(modal);
    }

    function clampFactor(value) {
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
    }

    function makeZoomButton(label, title, onClick) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm pcm-iv-btn';
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', onClick);
        return btn;
    }

    function ensureUi(modal) {
        ensureStyle();
        var header = modal.querySelector('.modal-header');
        if (!header) return;
        // The Download anchor is not a direct child of the header, so
        // insert beside it in ITS parent (insertBefore throws otherwise).
        var download = header.querySelector('a.btn');
        var anchorParent = download ? download.parentNode : header;

        if (!document.getElementById(OPEN_ID)) {
            var open = document.createElement('a');
            open.id = OPEN_ID;
            open.className = 'btn btn-sm pull-right mr-2 pcm-iv-btn';
            open.target = '_blank';
            open.rel = 'noopener';
            open.textContent = OPEN_LABEL;
            open.title = 'Open this attachment in a new tab';
            anchorParent.insertBefore(open, download || null);
        }

        if (!document.getElementById(GROUP_ID)) {
            var group = document.createElement('span');
            group.id = GROUP_ID;
            group.className = 'pull-right';

            var split = document.createElement('span');
            split.className = 'pcm-iv-split';
            split.appendChild(makeZoomButton('\u2212', 'Zoom out', function () {
                factor = clampFactor(currentFactor(modal) / ZOOM_STEP);
                applyZoom(modal);
            }));
            var level = document.createElement('span');
            level.className = 'pcm-iv-level';
            level.title = 'Current zoom';
            split.appendChild(level);
            split.appendChild(makeZoomButton('+', 'Zoom in', function () {
                factor = clampFactor(currentFactor(modal) * ZOOM_STEP);
                applyZoom(modal);
            }));
            group.appendChild(split);

            // One button for both: 1:1 while the image is fitted, Fit once
            // it is shown at another size.
            group.appendChild(makeZoomButton('1:1', '', function () {
                factor = factor === 0 ? 1 : 0;
                applyZoom(modal);
            }));
            anchorParent.insertBefore(group, document.getElementById(OPEN_ID));
        }

        matchLook(download);

        var frame = getFrame(modal);
        if (frame && !frame.dataset.pcmIvHooked) {
            frame.dataset.pcmIvHooked = '1';
            frame.addEventListener('load', function () {
                syncState(modal);
            });
        }

        factor = 0;
        syncState(modal);
    }

    // The new controls look like PCM's own Download button, only in
    // their own colour: its shape, height, font and border are measured
    // and copied (so they also follow PCM if it changes that button). The
    // zoom button's three parts share one rounded outline.
    var LOOK_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'borderTopWidth', 'borderStyle'];

    function matchLook(download) {
        var group = document.getElementById(GROUP_ID);
        if (!group || !download) return;
        var cs = window.getComputedStyle(download);
        var h = Math.round(download.getBoundingClientRect().height);
        if (!h) return;
        var look = {};
        LOOK_PROPS.forEach(function (prop) { look[prop] = cs[prop]; });
        look.borderWidth = cs.borderTopWidth;
        delete look.borderTopWidth;
        look.height = h + 'px';
        look.boxSizing = 'border-box';
        look.display = 'inline-flex';
        look.alignItems = 'center';
        look.justifyContent = 'center';
        look.lineHeight = 'normal';
        look.verticalAlign = 'middle';

        function apply(el, extra) {
            if (!el) return;
            var wanted = Object.assign({}, look, extra || {});
            Object.keys(wanted).forEach(function (prop) {
                if (el.style[prop] !== wanted[prop]) el.style[prop] = wanted[prop];
            });
        }
        var outer = { borderRadius: cs.borderTopLeftRadius, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, paddingTop: '0', paddingBottom: '0' };
        apply(document.getElementById(OPEN_ID), outer);
        apply(group.querySelector(':scope > .pcm-iv-btn'), outer);
        fixToggleWidth(group.querySelector(':scope > .pcm-iv-btn'));
        var split = group.querySelector('.pcm-iv-split');
        if (split) {
            var r = cs.borderTopLeftRadius;
            if (split.style.borderRadius !== r) split.style.borderRadius = r;
            if (split.style.height !== look.height) split.style.height = look.height;
            Array.prototype.forEach.call(split.children, function (part) {
                apply(part, { borderRadius: '0', borderWidth: '0', paddingTop: '0', paddingBottom: '0' });
            });
        }
    }

    // The 1:1/Fit button keeps the width of its wider text, so the row
    // does not shift when the text changes. Measured once per look.
    function fixToggleWidth(toggle) {
        if (!toggle) return;
        var text = toggle.textContent;
        toggle.style.width = '';
        var widest = 0;
        ['1:1', 'Fit'].forEach(function (label) {
            toggle.textContent = label;
            widest = Math.max(widest, Math.ceil(toggle.getBoundingClientRect().width));
        });
        toggle.textContent = text;
        if (widest) toggle.style.width = widest + 'px';
    }

    // Drag to pan: grab the image and drag to scroll around it. The
    // listeners live inside the iframe's own document, so they die with
    // it on every attachment switch; nothing persists outside the
    // preview, and mousemove only fires while the preview is open.
    function attachPan(modal) {
        var frame = getFrame(modal);
        var doc;
        try { doc = frame && frame.contentDocument; } catch (_) { return; }
        var img = doc && doc.body && doc.querySelector('img');
        if (!doc || !img || doc.body.dataset.pcmIvPan) return;
        doc.body.dataset.pcmIvPan = '1';

        var scroller = doc.scrollingElement || doc.documentElement;
        var dragging = false;
        var moved = false;
        var startX = 0, startY = 0, startLeft = 0, startTop = 0;

        img.style.cursor = 'grab';

        doc.addEventListener('mousedown', function (e) {
            if (e.button !== 0 || e.target !== img) return;
            dragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = scroller.scrollLeft;
            startTop = scroller.scrollTop;
            img.style.cursor = 'grabbing';
            e.preventDefault(); // stops the native image drag ghost
        });

        doc.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true;
            scroller.scrollLeft = startLeft - dx;
            scroller.scrollTop = startTop - dy;
        });

        doc.addEventListener('mouseup', function () {
            if (!dragging) return;
            dragging = false;
            img.style.cursor = 'grab';
        });

        // A drag must not end as a click: the browser's built-in image
        // viewer toggles its own zoom on click, which would fight the
        // pan. Capture phase so this wins.
        doc.addEventListener('click', function (e) {
            if (moved && e.target === img) {
                moved = false;
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    // Runs on every modal open and every iframe load (PCM reuses the
    // modal and swaps the iframe src per attachment): reset to Fit,
    // point Open in tab at the current attachment, and only show the
    // zoom group when the preview is actually an image.
    function syncState(modal) {
        var frame = getFrame(modal);
        var open = document.getElementById(OPEN_ID);
        if (open && frame && frame.src) open.href = frame.src;

        var img = getFrameImg(modal);
        var group = document.getElementById(GROUP_ID);
        if (group) group.style.display = img ? '' : 'none';
        // Measured once it is shown (a hidden button has no width).
        if (group && img && !group.querySelector(':scope > .pcm-iv-btn').style.width) fixToggleWidth(group.querySelector(':scope > .pcm-iv-btn'));
        if (img) attachPan(modal);

        applyZoom(modal);
        reveal(frame);
    }

    // Shown once its document has finished loading (the load event calls
    // syncState again otherwise); REVEAL_MAX_MS shows it in any case.
    var REVEAL_MAX_MS = 3000;
    var revealTimer = 0;

    function reveal(frame) {
        if (!frame) return;
        var done = false;
        // An empty frame (about:blank, before PCM gives it the attachment)
        // also reports complete, so it must be showing a real address.
        try {
            var doc = frame.contentDocument;
            done = !doc || (doc.readyState === 'complete' && doc.location.href !== 'about:blank');
        } catch (_) { done = true; }
        if (done) frame.dataset.pcmIvReady = '1';
    }

    function hideUntilReady(modal) {
        var frame = getFrame(modal);
        if (!frame) return;
        delete frame.dataset.pcmIvReady;
        window.clearTimeout(revealTimer);
        revealTimer = window.setTimeout(function () { frame.dataset.pcmIvReady = '1'; }, REVEAL_MAX_MS);
    }

    // Bounded boot: only jQuery with Bootstrap's modal plugin is needed,
    // then everything is driven by events.
    var tries = 0;
    function start() {
        var jq = window.jQuery;
        if (!jq || !jq.fn || !jq.fn.modal) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) window.setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        // The size rules go in at once, so the window opens at its full
        // size; the attachment is hidden from the moment it starts to open.
        ensureStyle();
        jq(document).on('show.bs.modal', function (event) {
            if (event.target && event.target.id === MODAL_ID) hideUntilReady(event.target);
        });
        jq(document).on('shown.bs.modal', function (event) {
            if (event.target && event.target.id === MODAL_ID) {
                ensureUi(event.target);
            }
        });
        // A resized browser window: the open preview fits again (only in
        // Fit; a chosen zoom stays). One listener, debounced.
        var resizeTimer = 0;
        window.addEventListener('resize', function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(function () {
                var modal = document.getElementById(MODAL_ID);
                if (modal && factor === 0 && modal.getClientRects().length) applyZoom(modal);
            }, 150);
        });
    }

    start();
})();
