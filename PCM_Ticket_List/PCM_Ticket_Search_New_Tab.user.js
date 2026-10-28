// @file_name = PCM_Ticket_Search_New_Tab.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-28
// @created = 2026-10-28 14:11

// ==UserScript==
// @name         PCM Ticket Search New Tab
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-28
// @description  Lets the "Ticket #" field in PCM's top bar open the ticket in a new tab. A small arrow button right after the field opens the typed number in a new tab, and the field's tooltip explains the options; Ctrl+Enter or Shift+Enter opens the typed ticket number in a new tab and clears the field for the next number; plain Enter keeps working as before (same tab), unless ALWAYS_NEW_TAB is turned on at the top. Only plain ticket numbers are handled; anything else is left to PCM's own search. Works on every PCM page with the top bar. Standalone and event-driven: a key and a focus listener, no observers, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/*
// @run-at       document-idle
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
    // A small arrow right after the field, so opening in a new tab can be
    // seen and clicked, not only known as a shortcut. Added when the page
    // is ready and again whenever the field gets focus, in case PCM has
    // redrawn the top bar; nothing watches the page.
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
        '.' + BUTTON_CLASS + ' {',
        '    margin-left: 4px;',
        '    padding: 0 7px;',
        '    height: 24px;',
        '    border: 1px solid rgba(255,255,255,0.35);',
        '    border-radius: 3px;',
        '    background: rgba(255,255,255,0.12);',
        '    color: #fff;',
        '    font-size: 14px;',
        '    font-weight: 700;',
        '    line-height: 22px;',
        '    vertical-align: middle;',
        '    cursor: pointer;',
        '}',
        '.' + BUTTON_CLASS + ':hover {',
        '    background: rgba(255,255,255,0.28);',
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

    function ensureAll() {
        document.querySelectorAll('input[placeholder]').forEach(function (el) {
            if (isSearchField(el)) ensureButton(el);
        });
    }

    ensureAll();
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
