// @file_name = PCM_Timeline_Box_Autosize.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-08
// @created = 2026-09-09 10:12
// @note = The timeline bodies are same-origin iframes with ids shaped email-<n>, note-<n> and api-<n>. PCM already sizes email iframes to their content with an inline height and never sizes notes, which take a flat height from a stylesheet and clip. This script sizes every type the same way.

// ==UserScript==
// @name         PCM Timeline Box Autosize
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-08
// @description  Sizes the Timeline message boxes to their own content so notes, mails and API entries stop clipping behind a scrollbar. Each box is a same-origin iframe measured from the inside, then clamped between a minimum and a maximum height, with optional full width. Dragging a box's resize handle pins that box to the dragged height and is remembered per box. A settings dropdown left of Timeline Options carries the on/off switch, the min and max, full width, which box types are handled, and a button to forget pinned sizes. Event-driven: a ResizeObserver per open box and one scoped MutationObserver for new boxes, all behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Timeline_Box_Autosize.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Timeline_Box_Autosize.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // Defaults only. Everything here is overridden by whatever is in
    // the settings dropdown, which persists in localStorage per browser.
    // Editing a default changes it only for a browser that has never
    // touched that setting; use "Reset settings" in the menu to adopt
    // new defaults everywhere.
    var DEFAULTS = {
        enabled: true,
        minHeight: 60,        // px floor, so a one-line note still has a usable box
        maxHeight: 900,       // px cap; past this the box scrolls instead of growing
        fullWidth: true,      // stretch the box to its container's width
        types: {              // which id prefixes to size
            note: true,
            email: true,
            api: true
        },
        allowPin: true        // let a drag-resize pin a box to that height
    };

    // Box types, matched against the iframe's id prefix. PCM names each
    // timeline body <type>-<numeric id>, which is also what makes a
    // stable per-box key for pinned heights. Add a row if a new type
    // shows up; an unknown type is ignored rather than guessed at.
    var TYPE_RE = /^(note|email|api)-(\d+)$/;

    // INTERNAL SETTINGS
    var SETTINGS_KEY = 'pcm-timeline-autosize';
    var PINS_KEY = 'pcm-timeline-autosize-pins';
    var PIN_LIMIT = 300;      // pins are per timeline entry, so they are pruned

    var STYLE_ID = 'pcm-timeline-autosize-style';
    var MENU_ID = 'pcm-timeline-autosize-menu';
    var TOGGLE_ID = 'pcm-timeline-autosize-toggle';
    var SIZED_ATTR = 'data-pcm-autosized';
    var PIN_ATTR = 'data-pcm-pinned';

    // A box is only re-measured when its content actually changes, so
    // these delays exist to absorb bursts (fonts, images, Display
    // Images), not to poll.
    var MEASURE_DEBOUNCE_MS = 60;
    var SCAN_DEBOUNCE_MS = 150;

    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate ||
        !D.installNavigationHooks || !D.readJson || !D.writeJson || !D.query || !D.queryAll) {
        console.error('[PCM Timeline Box Autosize] PCM_DOM shared library missing or stale (lib 2.0 or newer required), aborting.');
        return;
    }

    // SETTINGS
    // Merged one key at a time so a stored blob written by an older
    // version cannot drop a setting added later.
    function loadSettings() {
        var stored = D.readJson(SETTINGS_KEY, null);
        var out = {
            enabled: DEFAULTS.enabled,
            minHeight: DEFAULTS.minHeight,
            maxHeight: DEFAULTS.maxHeight,
            fullWidth: DEFAULTS.fullWidth,
            allowPin: DEFAULTS.allowPin,
            types: { note: DEFAULTS.types.note, email: DEFAULTS.types.email, api: DEFAULTS.types.api }
        };
        if (!stored || typeof stored !== 'object') return out;

        if (typeof stored.enabled === 'boolean') out.enabled = stored.enabled;
        if (typeof stored.fullWidth === 'boolean') out.fullWidth = stored.fullWidth;
        if (typeof stored.allowPin === 'boolean') out.allowPin = stored.allowPin;
        if (isSaneHeight(stored.minHeight)) out.minHeight = stored.minHeight;
        if (isSaneHeight(stored.maxHeight)) out.maxHeight = stored.maxHeight;
        if (stored.types && typeof stored.types === 'object') {
            Object.keys(out.types).forEach(function (key) {
                if (typeof stored.types[key] === 'boolean') out.types[key] = stored.types[key];
            });
        }
        // A stored min above max would freeze every box at the min.
        if (out.minHeight > out.maxHeight) out.minHeight = out.maxHeight;
        return out;
    }

    function isSaneHeight(value) {
        return typeof value === 'number' && isFinite(value) && value >= 20 && value <= 20000;
    }

    var settings = loadSettings();

    function saveSettings() {
        D.writeJson(SETTINGS_KEY, settings);
    }

    // PINNED HEIGHTS (PER BOX, KEYED BY THE IFRAME ID)
    function loadPins() {
        var stored = D.readJson(PINS_KEY, null);
        return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    }

    var pins = loadPins();

    // Pins accumulate one entry per timeline entry the agent has ever
    // resized, so the oldest are dropped once the map gets long. Order
    // is insertion order, which for plain string keys is what we want.
    function savePins() {
        var keys = Object.keys(pins);
        if (keys.length > PIN_LIMIT) {
            keys.slice(0, keys.length - PIN_LIMIT).forEach(function (key) {
                delete pins[key];
            });
        }
        D.writeJson(PINS_KEY, pins);
    }

    function forgetPins() {
        pins = {};
        D.writeJson(PINS_KEY, pins);
        boxes().forEach(function (frame) {
            frame.removeAttribute(PIN_ATTR);
        });
        applyAll();
    }

    // FINDING AND MEASURING THE BOXES
    function timelineWidget() {
        return D.findWidgetByTitle ? D.findWidgetByTitle('Timeline') : null;
    }

    // Scoped to the Timeline widget on purpose. Sizing every iframe on
    // the page would also catch the reply editor's own frames and
    // anything a future widget embeds.
    function boxes() {
        var root = timelineWidget() || document;
        return D.queryAll('iframe[id]', root).filter(function (frame) {
            return TYPE_RE.test(frame.id);
        });
    }

    function boxType(frame) {
        var m = TYPE_RE.exec(frame.id);
        return m ? m[1] : null;
    }

    function typeEnabled(frame) {
        var type = boxType(frame);
        return !!(type && settings.types[type]);
    }

    // Measured from inside the frame, as the bottom edge of the content
    // itself. Reading body/documentElement scrollHeight or offsetHeight
    // does not work: many mails and PCM's notes give html and body a
    // height of 100%, so those values follow the box's own height. Each
    // resize then measured a little more than before and the box kept
    // growing until it hit the maximum. The content's bounding box does
    // not depend on the box height, so the size settles.
    function contentHeight(frame) {
        var doc, win;
        try {
            doc = frame.contentDocument;
            win = frame.contentWindow;
        } catch (_) {
            return null;
        }
        if (!doc || !win || !doc.body) return null;

        var range = doc.createRange();
        range.selectNodeContents(doc.body);
        var rect = range.getBoundingClientRect();
        if (!rect || (rect.height === 0 && !doc.body.textContent.trim())) return null;

        var bodyStyle = win.getComputedStyle(doc.body);
        var bottom = rect.bottom + (win.scrollY || 0) +
            (parseFloat(bodyStyle.paddingBottom) || 0) +
            (parseFloat(bodyStyle.marginBottom) || 0);

        // The frame's own border is part of its height (border-box), so it
        // is added on top, or the content would sit behind a scrollbar.
        var frameStyle = window.getComputedStyle(frame);
        var border = frameStyle.boxSizing === 'border-box'
            ? (parseFloat(frameStyle.borderTopWidth) || 0) + (parseFloat(frameStyle.borderBottomWidth) || 0)
            : 0;

        var height = Math.ceil(bottom + border);
        return height > 0 ? height : null;
    }

    function clamp(height) {
        if (height < settings.minHeight) return settings.minHeight;
        if (height > settings.maxHeight) return settings.maxHeight;
        return height;
    }

    // APPLYING A SIZE
    // Every write is guarded by a read: an unconditional style write on
    // an element the page also observes is how observer feedback loops
    // start.
    function setStyle(el, prop, value) {
        if (el.style[prop] === value) return false;
        el.style[prop] = value;
        return true;
    }

    function applyBox(frame) {
        if (!settings.enabled || !typeEnabled(frame)) {
            release(frame);
            return;
        }

        var pinned = settings.allowPin ? pins[frame.id] : null;
        var target = isSaneHeight(pinned) ? pinned : null;

        if (target === null) {
            var measured = contentHeight(frame);
            // Nothing measurable yet (frame still loading): leave the
            // box exactly as PCM left it and wait for the load event.
            if (measured === null) return;
            // +1 absorbs sub-pixel rounding. Safe now that the measured
            // height does not follow the box's own height.
            target = clamp(measured + 1);
        }

        frame.setAttribute(SIZED_ATTR, '1');
        frame.setAttribute(PIN_ATTR, isSaneHeight(pinned) ? '1' : '0');

        setStyle(frame, 'height', target + 'px');
        // Only the capped case needs to scroll. Below the cap the box
        // fits its content, so a scrollbar would be dead chrome.
        setStyle(frame, 'overflowY', target >= settings.maxHeight ? 'auto' : 'hidden');
        setStyle(frame, 'resize', settings.allowPin ? 'vertical' : 'none');
        setStyle(frame, 'width', settings.fullWidth ? '100%' : '');
        setStyle(frame, 'maxWidth', settings.fullWidth ? '100%' : '');
    }

    // Hands the box back to PCM: our inline values are removed rather
    // than overwritten with guesses, so the page's own CSS applies again.
    function release(frame) {
        if (!frame.hasAttribute(SIZED_ATTR)) return;
        frame.removeAttribute(SIZED_ATTR);
        frame.removeAttribute(PIN_ATTR);
        ['height', 'overflowY', 'resize', 'width', 'maxWidth'].forEach(function (prop) {
            frame.style[prop] = '';
        });
    }

    function applyAll() {
        boxes().forEach(applyBox);
    }

    var applyGate = D.createVisibilityGate(applyAll, MEASURE_DEBOUNCE_MS);

    // WATCHING FOR CONTENT AND STRUCTURE CHANGES
    // One ResizeObserver for all inner bodies. This is the whole reason
    // the script needs no polling: clicking Display Images, a late web
    // font, or a slow image all resize the inner body and land here.
    var innerObserver = typeof window.ResizeObserver === 'function'
        ? new window.ResizeObserver(function () { applyGate.schedule(); })
        : null;

    var watched = new WeakSet();

    function watchBox(frame) {
        if (watched.has(frame)) return;
        watched.add(frame);

        // Fires for frames that are still loading, and again if PCM
        // swaps the src when an entry is re-rendered.
        frame.addEventListener('load', function () {
            observeInner(frame);
            applyGate.schedule();
        });

        // A drag on the resize handle is a deliberate pin. Recorded on
        // mouseup so the pin is the height the agent settled on, not
        // every intermediate height during the drag.
        frame.addEventListener('mouseup', function () {
            if (!settings.enabled || !settings.allowPin || !typeEnabled(frame)) return;
            var height = Math.round(frame.getBoundingClientRect().height);
            if (!isSaneHeight(height)) return;
            if (pins[frame.id] === height) return;
            pins[frame.id] = height;
            savePins();
            applyBox(frame);
        });

        observeInner(frame);
    }

    function observeInner(frame) {
        if (!innerObserver) return;
        var doc;
        try {
            doc = frame.contentDocument;
        } catch (_) {
            return;
        }
        if (!doc || !doc.body) return;
        try {
            innerObserver.observe(doc.body);
        } catch (_) {
            // A frame torn down mid-observe: the next scan re-observes.
        }
    }

    function scan() {
        boxes().forEach(function (frame) {
            watchBox(frame);
            applyBox(frame);
        });
    }

    var scanGate = D.createVisibilityGate(scan, SCAN_DEBOUNCE_MS);

    // Rooted on the Timeline widget, re-armed when the widget itself is
    // replaced. Only iframe-bearing mutations are acted on, so ordinary
    // timeline chatter costs one cheap check.
    var structureObserver = null;
    var structureRoot = null;

    function ensureStructureObserver() {
        if (structureRoot && !structureRoot.isConnected) structureRoot = null;

        var root = timelineWidget();
        if (!root || !root.isConnected || structureRoot === root) return;

        if (!structureObserver) {
            structureObserver = new MutationObserver(function (mutations) {
                for (var i = 0; i < mutations.length; i++) {
                    var added = mutations[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var node = added[j];
                        if (node.nodeType !== 1) continue;
                        if (node.tagName === 'IFRAME' ||
                            (node.querySelector && node.querySelector('iframe'))) {
                            scanGate.schedule();
                            return;
                        }
                    }
                }
            });
        }

        structureObserver.disconnect();
        structureObserver.observe(root, { childList: true, subtree: true });
        structureRoot = root;
    }

    // SETTINGS DROPDOWN, STYLED AS A TWIN OF TIMELINE OPTIONS
    function optionsButton() {
        return document.getElementById('timeline-options-dropdown');
    }

    function toolbar() {
        var btn = optionsButton();
        return btn ? btn.parentElement : null;
    }

    D.ensureStyleTag(STYLE_ID, [
        '#' + MENU_ID + ' {',
        '    min-width: 260px;',
        '    padding: 8px 12px;',
        '}',
        '#' + MENU_ID + ' .pcm-row {',
        '    display: flex;',
        '    align-items: center;',
        '    justify-content: space-between;',
        '    gap: 10px;',
        '    padding: 4px 0;',
        '    white-space: nowrap;',
        '}',
        '#' + MENU_ID + ' .pcm-row > span {',
        '    font-weight: 400;',
        '}',
        '#' + MENU_ID + ' input[type="number"] {',
        '    width: 78px;',
        '    padding: 1px 4px;',
        '}',
        '#' + MENU_ID + ' .pcm-sep {',
        '    margin: 6px 0;',
        '    border-top: 1px solid #e0e0e0;',
        '}',
        '#' + MENU_ID + ' .pcm-note {',
        '    padding-top: 2px;',
        '    font-size: 11px;',
        '    color: #888;',
        '    white-space: normal;',
        '}',
        '#' + MENU_ID + ' .pcm-btn-row {',
        '    display: flex;',
        '    gap: 6px;',
        '    padding-top: 4px;',
        '}'
    ].join('\n'));

    function checkboxRow(labelText, checked, onChange) {
        var row = document.createElement('div');
        row.className = 'pcm-row';

        var span = document.createElement('span');
        span.textContent = labelText;

        var input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!checked;
        input.addEventListener('change', function () {
            onChange(input.checked);
        });

        row.appendChild(span);
        row.appendChild(input);
        return row;
    }

    function numberRow(labelText, value, onChange) {
        var row = document.createElement('div');
        row.className = 'pcm-row';

        var span = document.createElement('span');
        span.textContent = labelText;

        var input = document.createElement('input');
        input.type = 'number';
        input.min = '20';
        input.max = '20000';
        input.step = '10';
        input.value = String(value);
        // 'change' not 'input': committing on every keystroke would
        // resize every box on the page for each digit typed.
        input.addEventListener('change', function () {
            var next = parseInt(input.value, 10);
            if (!isSaneHeight(next)) {
                input.value = String(onChange(null));
                return;
            }
            input.value = String(onChange(next));
        });

        row.appendChild(span);
        row.appendChild(input);
        return row;
    }

    function separator() {
        var sep = document.createElement('div');
        sep.className = 'pcm-sep';
        return sep;
    }

    function buildMenu() {
        var menu = document.createElement('ul');
        menu.className = 'dropdown-menu pull-right';
        menu.id = MENU_ID;

        var li = document.createElement('li');
        menu.appendChild(li);

        // Clicks inside the panel must not close the dropdown, which is
        // what Bootstrap does by default for anything in a
        // .dropdown-menu.
        li.addEventListener('click', function (event) {
            event.stopPropagation();
        });

        li.appendChild(checkboxRow('Auto-size boxes', settings.enabled, function (on) {
            settings.enabled = on;
            saveSettings();
            applyAll();
        }));

        li.appendChild(checkboxRow('Full width', settings.fullWidth, function (on) {
            settings.fullWidth = on;
            saveSettings();
            applyAll();
        }));

        li.appendChild(separator());

        li.appendChild(numberRow('Min height (px)', settings.minHeight, function (next) {
            if (next !== null) {
                settings.minHeight = Math.min(next, settings.maxHeight);
                saveSettings();
                applyAll();
            }
            return settings.minHeight;
        }));

        li.appendChild(numberRow('Max height (px)', settings.maxHeight, function (next) {
            if (next !== null) {
                settings.maxHeight = Math.max(next, settings.minHeight);
                saveSettings();
                applyAll();
            }
            return settings.maxHeight;
        }));

        li.appendChild(separator());

        li.appendChild(checkboxRow('Notes', settings.types.note, function (on) {
            settings.types.note = on;
            saveSettings();
            applyAll();
        }));

        li.appendChild(checkboxRow('Mails', settings.types.email, function (on) {
            settings.types.email = on;
            saveSettings();
            applyAll();
        }));

        li.appendChild(checkboxRow('API entries', settings.types.api, function (on) {
            settings.types.api = on;
            saveSettings();
            applyAll();
        }));

        li.appendChild(separator());

        li.appendChild(checkboxRow('Allow drag to pin a box', settings.allowPin, function (on) {
            settings.allowPin = on;
            saveSettings();
            applyAll();
        }));

        var note = document.createElement('div');
        note.className = 'pcm-note';
        note.textContent = 'Drag a box\'s bottom edge to pin it to that height. Pinned boxes keep their size until you forget them.';
        li.appendChild(note);

        var btnRow = document.createElement('div');
        btnRow.className = 'pcm-btn-row';

        var forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'btn btn-xs btn-default';
        forget.textContent = 'Forget pinned sizes';
        forget.addEventListener('click', function () {
            forgetPins();
            D.flashLabel(forget, 'Forgotten');
        });

        var reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'btn btn-xs btn-default';
        reset.textContent = 'Reset settings';
        reset.addEventListener('click', function () {
            try {
                window.localStorage.removeItem(SETTINGS_KEY);
            } catch (_) {
                // Storage unavailable: the in-memory reset below still
                // takes effect for this page.
            }
            settings = loadSettings();
            rebuildMenu();
            applyAll();
        });

        btnRow.appendChild(forget);
        btnRow.appendChild(reset);
        li.appendChild(btnRow);

        return menu;
    }

    function buildToggle() {
        var btn = document.createElement('button');
        btn.className = 'btn dropdown-toggle btn-xs btn-default';
        btn.id = TOGGLE_ID;
        btn.type = 'button';
        btn.setAttribute('data-toggle', 'dropdown');
        btn.title = 'Box sizing options';

        // Same three-part shape as the Timeline Options button: icon
        // label, text, caret label.
        var icon = document.createElement('label');
        icon.className = 'aa-pt-cogs-grey aa-14';

        var text = document.createElement('span');
        text.textContent = 'Box Sizing';

        var caret = document.createElement('label');
        caret.className = 'aa-pt-caret-down-grey aa-10 aa-mt-2';

        btn.appendChild(icon);
        btn.appendChild(text);
        btn.appendChild(caret);
        return btn;
    }

    function rebuildMenu() {
        var existing = document.getElementById(MENU_ID);
        if (!existing || !existing.parentElement) return;
        existing.parentElement.replaceChild(buildMenu(), existing);
    }

    function ensureControl() {
        var bar = toolbar();
        if (!bar) return false;

        var existing = document.getElementById(TOGGLE_ID);
        if (existing && existing.isConnected && existing.parentElement === bar) return true;
        if (existing) existing.remove();

        var oldMenu = document.getElementById(MENU_ID);
        if (oldMenu) oldMenu.remove();

        // Inserted before the Timeline Options button so it reads left
        // of it, matching where PCM's own toolbar buttons sit.
        var anchor = optionsButton();
        var toggle = buildToggle();
        var menu = buildMenu();

        bar.insertBefore(toggle, anchor);
        bar.insertBefore(menu, anchor);
        return true;
    }

    // BOOT
    function activate() {
        ensureControl();
        ensureStructureObserver();
        scan();
    }

    function onRouteChange() {
        structureRoot = null;
        D.bootUntil(function () {
            return !!(optionsButton() || boxes().length);
        }, activate, { BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 250 });
    }

    D.bootUntil(function () {
        return !!(document.body && (optionsButton() || boxes().length));
    }, function () {
        activate();
        D.installNavigationHooks(onRouteChange);

        // The cap is a pixel value, so a window resize does not change
        // it, but a full-width box needs its inner content re-measured
        // once the reflow settles.
        window.addEventListener('resize', function () {
            applyGate.schedule();
        });
    }, { BOOT_MAX_TRIES: 60, BOOT_INTERVAL_MS: 250 });
})();
