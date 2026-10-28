// @file_name = PCM_Collapse_Categories.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-28
// @created = 2026-10-28 10:26

// ==UserScript==
// @name         PCM Collapse Categories
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-28
// @description  Folds away the Categories section of the Attributes widget, so only its heading shows ("Categories" with an arrow). Clicking the heading opens and closes it. When any category has a value the section opens by itself and the heading says how many are set, so a filled-in category is never hidden. Works for whichever category fields PCM shows for the ticket's team, and applies again when PCM rebuilds the section after a save or a team change. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Collapse_Categories.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Collapse_Categories.user.js
// ==/UserScript==

(function () {
    'use strict';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate || !D.installNavigationHooks) {
        console.error('[PCM Collapse Categories] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    // From the Attributes form: div.display-ticket-assignable-categories
    // holds a <header>Categories</header> and fieldset.categories with one
    // select per category; an empty category has the value "".
    var BOX_SELECTOR = '.display-ticket-assignable-categories';
    var FIELDS_SELECTOR = 'fieldset.categories';
    var DONE_ATTR = 'data-pcm-categories';
    var COLLAPSED_CLASS = 'pcm-categories-collapsed';
    var STYLE_ID = 'pcm-collapse-categories-style';
    var SCAN_DELAY_MS = 150;

    D.ensureStyleTag(STYLE_ID, [
        BOX_SELECTOR + '.' + COLLAPSED_CLASS + ' > ' + FIELDS_SELECTOR + ' {',
        '    display: none !important;',
        '}',
        BOX_SELECTOR + '[' + DONE_ATTR + '] > header {',
        '    cursor: pointer;',
        '    user-select: none;',
        '}',
        BOX_SELECTOR + '[' + DONE_ATTR + '] > header:hover {',
        '    opacity: .8;',
        '}',
        '.pcm-categories-caret {',
        '    display: inline-block;',
        '    margin-left: 8px;',
        '    font-size: 1.4em;',
        '    line-height: 1;',
        '    vertical-align: -2px;',
        '    transition: transform .15s ease;',
        '}',
        BOX_SELECTOR + ':not(.' + COLLAPSED_CLASS + ') .pcm-categories-caret {',
        '    transform: rotate(90deg);',
        '}',
        '.pcm-categories-count {',
        '    margin-left: 8px;',
        '    font-size: .75em;',
        '    color: #888;',
        '}'
    ].join('\n'));

    // A category counts as set when its select has a value other than "".
    function setCount(box) {
        var count = 0;
        box.querySelectorAll(FIELDS_SELECTOR + ' select').forEach(function (select) {
            if (select.value !== '') count += 1;
        });
        return count;
    }

    function updateCount(box) {
        var span = box.querySelector('.pcm-categories-count');
        if (!span) return;
        var count = setCount(box);
        var text = count ? '(' + count + ' set)' : '';
        if (span.textContent !== text) span.textContent = text;
    }

    // PCM may rebuild the whole section, or keep the outer box and only
    // replace the heading and fields inside it. So the set-up lives on the
    // heading: a heading without the arrow is new, and the section is then
    // decided again (folded unless something is set). Clicks and changes
    // are caught on the outer box once, so they keep working whatever PCM
    // swaps inside it. Fields that arrive after the heading open a folded
    // section once they carry a value, unless you folded it yourself.
    function setUpHeading(box, header) {
        var caret = document.createElement('span');
        caret.className = 'pcm-categories-caret';
        caret.textContent = '\u25B8';
        var count = document.createElement('span');
        count.className = 'pcm-categories-count';
        header.appendChild(caret);
        header.appendChild(count);
        header.title = 'Show or hide the categories';
        delete box.dataset.pcmUserToggled;
        box.classList.toggle(COLLAPSED_CLASS, setCount(box) === 0);
    }

    function bindBox(box) {
        if (box.dataset.pcmBound) return;
        box.dataset.pcmBound = '1';
        box.addEventListener('click', function (event) {
            var header = event.target.closest && event.target.closest('header');
            if (!header || header.parentElement !== box) return;
            box.classList.toggle(COLLAPSED_CLASS);
            box.dataset.pcmUserToggled = '1';
        });
        // select2 announces a pick with jQuery's own change event, which a
        // native listener does not receive, so the count listens to both.
        box.addEventListener('change', function () { updateCount(box); });
        if (window.jQuery) window.jQuery(box).on('change', function () { updateCount(box); });
    }

    function prepare(box) {
        var header = box.querySelector(':scope > header');
        if (!header) return;
        box.setAttribute(DONE_ATTR, '1');
        bindBox(box);
        if (!header.querySelector('.pcm-categories-caret')) {
            setUpHeading(box, header);
        } else if (!box.dataset.pcmUserToggled && box.classList.contains(COLLAPSED_CLASS) && setCount(box) > 0) {
            box.classList.remove(COLLAPSED_CLASS);
        }
        updateCount(box);
    }

    function ensure() {
        document.querySelectorAll(BOX_SELECTOR).forEach(prepare);
    }

    var gate = D.createVisibilityGate(ensure, SCAN_DELAY_MS);

    // BOOT
    // PCM rebuilds the Attributes widget after a save and the categories
    // after a team change; only additions are looked at, and ensure() is a
    // few reads when nothing changed.
    function start() {
        ensure();
        var root = document.getElementById('content') || document.body;
        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i += 1) {
                if (mutations[i].addedNodes.length) {
                    gate.schedule();
                    return;
                }
            }
        }).observe(root, { childList: true, subtree: true });
    }

    D.installNavigationHooks(function () { gate.schedule(); });
    D.bootUntil(function () { return !!document.body; }, start);
})();
