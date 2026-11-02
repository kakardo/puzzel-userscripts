// @file_name = PCM_Ticket_Search_New_Tab.user.js
// @author = Kardo Rostam
// @version = 1.4_2026-11-02
// @created = 2026-10-28 14:11
// @note = run-at document-start on purpose: the arrow is added the moment the field is in the page. Tampermonkey can still start the script just after the first paint, so the arrow sits inside the field (taking no room) and only shows while the field has focus and something is typed.

// ==UserScript==
// @name         PCM Ticket Search New Tab
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.4_2026-11-02
// @description  Lets the "Ticket #" field in PCM's top bar open the ticket in a new tab. A small arrow inside the field's right edge (taking no room, so the field never moves; it fades in while the field has focus and something is typed, so it never covers the text) opens the typed number in a new tab, and the field's tooltip explains the options; Ctrl+Enter or Shift+Enter opens the typed ticket number in a new tab and clears the field for the next number; plain Enter keeps working as before (same tab), unless ALWAYS_NEW_TAB is turned on at the top. Only plain ticket numbers are handled; anything else is left to PCM's own search. Works on every PCM page with the top bar. Standalone and event-driven: a key and a focus listener, plus one observer that only runs while the page loads; no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Ticket_Search_New_Tab.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Ticket_Search_New_Tab.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // true: every search from the field opens a new tab, plain Enter too.
    var ALWAYS_NEW_TAB = false;

    // INTERNAL SETTINGS
    // The top bar field is recognised by its "Ticket #" placeholder, so a
    // renamed id or class in PCM does not break it. A ticket page lives at
    // /tickets/<number>.
    var PLACEHOLDER_RE = /^\s*ticket\s*#/i;
    var NUMBER_RE = /^\s*#?\s*(\d+)\s*$/;

    function isSearchField(el) {
        return !!(el && el.tagName === 'INPUT' && PLACEHOLDER_RE.test(el.getAttribute('placeholder') || ''));
    }

    var BUTTON_CLASS = 'pcm-ticket-new-tab';
    var STYLE_ID = 'pcm-ticket-new-tab-style';
    var HINT = 'Enter: open here. Ctrl+Enter or \u2197: open in a new tab';

    // OPENING
    // Returns false when the field holds no plain ticket number, so the
    // caller can leave it to PCM's own search.
    function openInNewTab(field) {
        var match = (field.value || '').match(NUMBER_RE);
        if (!match) return false;
        window.open(window.location.origin + '/tickets/' + match[1], '_blank', 'noopener');
        field.value = '';
        return true;
    }

    // THE VISIBLE BUTTON
    // A small arrow inside the field's right edge, so opening in a new tab can be
    // seen and clicked, not only known as a shortcut. Added while the page
    // loads and again whenever the field gets focus, in case PCM has
    // redrawn the top bar; after loading nothing watches the page.
    var style = document.createElement('style');
    style.id = STYLE_ID;
    // The arrow sits inside the field's right edge: its negative left
    // margin equals its width plus the right margin, so it takes no room
    // in the row and the field never moves, however late it arrives
    // (Tampermonkey can start the script just after the first paint).
    // The field is too narrow for both the "Ticket #" placeholder and the
    // arrow, and PCM only widens it while it has focus, so the arrow only
    // shows (fading in) while the field has focus and something is typed.
    // Pressing the arrow does not take the focus away (see mousedown).
    style.textContent = [
        'input:placeholder-shown + .' + BUTTON_CLASS + ',',
        'input:not(:focus) + .' + BUTTON_CLASS + ' {',
        '    opacity: 0;',
        '    visibility: hidden;',
        '}',
        '.' + BUTTON_CLASS + ' {',
        '    position: relative;',
        '    z-index: 2;',
        '    box-sizing: border-box;',
        '    width: 22px;',
        '    height: 20px;',
        '    margin: 0 3px 0 -25px;',
        '    padding: 0;',
        '    border: 0;',
        '    border-radius: 3px;',
        '    background: transparent;',
        '    color: #607080;',
        '    font-size: 14px;',
        '    font-weight: 700;',
        '    line-height: 20px;',
        '    text-align: center;',
        '    vertical-align: middle;',
        '    cursor: pointer;',
        '    transition: opacity .2s ease-out, visibility .2s;',
        '}',
        '.' + BUTTON_CLASS + ':hover {',
        '    background: #e3e8ee;',
        '    color: #1e5bd8;',
        '}'
    ].join('\n');
    if (!document.getElementById(STYLE_ID)) (document.head || document.documentElement).appendChild(style);

    function ensureButton(field) {
        if (!field.title) field.title = HINT;
        var next = field.nextElementSibling;
        if (next && next.classList.contains(BUTTON_CLASS)) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = BUTTON_CLASS;
        button.textContent = '\u2197';
        button.title = 'Open the ticket number in a new tab (or press Ctrl+Enter in the field)';
        button.addEventListener('mousedown', function (event) { event.preventDefault(); });
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (!openInNewTab(field)) field.focus();
        });
        field.insertAdjacentElement('afterend', button);
    }

    // Returns true when at least one field has its button.
    function ensureAll() {
        var found = false;
        document.querySelectorAll('input[placeholder]').forEach(function (el) {
            if (isSearchField(el)) {
                ensureButton(el);
                found = true;
            }
        });
        return found;
    }

    // While the page is being parsed, every batch of new nodes is checked
    // for the field, so the button is in place before the first paint and
    // the top bar does not shift; the watcher stops once the field has its
    // button or the page is parsed, whichever comes first.
    if (!ensureAll()) {
        var early = new MutationObserver(function () {
            if (ensureAll()) early.disconnect();
        });
        early.observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener('DOMContentLoaded', function () {
            early.disconnect();
            ensureAll();
        }, { once: true });
    }
    document.addEventListener('focusin', function (event) {
        if (isSearchField(event.target)) ensureButton(event.target);
    }, true);

    // THE SHORTCUT
    // One listener for the whole page, in the capture phase, so it acts
    // before PCM's own Enter handling and keeps working when PCM redraws
    // the top bar.
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' || event.isComposing) return;
        var field = event.target;
        if (!isSearchField(field)) return;
        var wantsNewTab = ALWAYS_NEW_TAB || event.ctrlKey || event.metaKey || event.shiftKey;
        if (!wantsNewTab || !NUMBER_RE.test(field.value || '')) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openInNewTab(field);
    }, true);
})();
