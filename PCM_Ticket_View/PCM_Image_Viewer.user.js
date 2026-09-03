// @file_name = PCM_Image_Viewer.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-09-03
// @created = 2026-09-03 09:43

// ==UserScript==
// @name         PCM Image Viewer
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-09-03
// @description  Upgrades the attachment preview modal on the ticket view. Adds an Open in tab button beside Download (same style, own colour) linking the previewed attachment, zoom controls for image previews (plus, minus, 1:1 actual size, Fit), and drag to pan: grab the image and drag to scroll around it when zoomed. The preview is a same-origin iframe, so zoom and pan act on the image document inside it directly, and controls appear only when the previewed attachment is an image. Purely event-driven via shown.bs.modal and the iframe load event: zero cost while no preview is open, no observers, no polling.
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
        '#' + GROUP_ID + ' .pcm-iv-btn {',
        '    margin-left: 4px;',
        '    min-width: 34px;',
        '}',
        '#' + GROUP_ID + ' {',
        '    margin-right: 14px;',
        '}'
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
        var f = Math.min(vw / img.naturalWidth, vh / img.naturalHeight, 1);
        return (f > 0 && isFinite(f)) ? f : 1;
    }

    function applyZoom(modal) {
        var img = getFrameImg(modal);
        if (!img || !img.naturalWidth) return;
        var f = factor === 0 ? fitFactor(modal) : factor;
        img.style.maxWidth = 'none';
        img.style.height = 'auto';
        img.style.width = Math.floor(img.naturalWidth * f) + 'px';
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
            group.appendChild(makeZoomButton('+', 'Zoom in', function () {
                factor = clampFactor(currentFactor(modal) * ZOOM_STEP);
                applyZoom(modal);
            }));
            group.appendChild(makeZoomButton('-', 'Zoom out', function () {
                factor = clampFactor(currentFactor(modal) / ZOOM_STEP);
                applyZoom(modal);
            }));
            group.appendChild(makeZoomButton('1:1', 'Actual size', function () {
                factor = 1;
                applyZoom(modal);
            }));
            group.appendChild(makeZoomButton('Fit', 'Fit to window', function () {
                factor = 0;
                applyZoom(modal);
            }));
            anchorParent.insertBefore(group, document.getElementById(OPEN_ID));
        }

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
        if (img) attachPan(modal);

        applyZoom(modal);
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
        jq(document).on('shown.bs.modal', function (event) {
            if (event.target && event.target.id === MODAL_ID) {
                ensureUi(event.target);
            }
        });
    }

    start();
})();
