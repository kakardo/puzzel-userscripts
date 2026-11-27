// ==UserScript==
// @name         PCC Chat Quick Emoji
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.2_2026-11-27
// @description  One-press emoji buttons in the agent application's chat, in the row under the message box right after its own buttons (emoji picker, attachment and the rest), like PCM Quick Emoji does for PCM replies. A press puts the emoji where the cursor is in the message, as if typed, so the chat sees it as normal text; the cursor stays in the message. Each also has a shortcut: typing :1, :2 and so on (after a space or at the start of a line) changes it into the emoji at that place in the row right away; hovering a button shows its shortcut. The emojis are a list at the top. The buttons appear as soon as a chat is on screen: checked a few times after the page has loaded, and shortly after each click on the page (opening or switching to a chat) and each time the message box gets the focus, so they also come back if the application redraws the chat. Event-driven: one click and one focus listener on the page, no observers, no polling.
// @author       Kardo Rostam
// @match        https://app.puzzel.com/agent*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Agent_View/PCC_Chat_Quick_Emoji.user.js
// ==/UserScript==

// @created = 2026-11-27 09:40

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    // The buttons, in this order. Written as code points so the file stays
    // plain text: 1F642 slightly smiling face, 1F60A smiling face with
    // smiling eyes, 1F604 grinning face with smiling eyes, 1F605 grinning
    // face with sweat.
    var EMOJIS = [0x1F642, 0x1F60A, 0x1F604, 0x1F605];

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var GROUP_ID = 'pcc-quick-emoji';
    var LOG = '[PCC Chat Quick Emoji]';
    // The chat's emoji picker button, recognised by its label.
    var PICKER_RE = /emoji/i;

    var style = document.createElement('style');
    style.textContent = [
        '#' + GROUP_ID + ' { display: inline-flex; align-items: center; gap: 2px; margin-left: 8px; padding-left: 8px; border-left: 1px solid rgba(127,127,127,.35); }',
        '#' + GROUP_ID + ' button { border: 0; background: none; padding: 2px 4px; border-radius: 6px; font-size: 20px; line-height: 1; cursor: pointer; }',
        '#' + GROUP_ID + ' button:hover { background: rgba(127,127,127,.18); }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);

    // THE MESSAGE BOX
    // A text field or an editable area, the kind a chat message is typed in.
    function isComposer(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.tagName === 'INPUT' && /^(text|search)?$/i.test(el.getAttribute('type') || '')) return true;
        return el.isContentEditable === true || el.getAttribute('role') === 'textbox';
    }

    // The chat's own "Insert emoji" button, the one on screen: the row it
    // sits in is where the quick buttons go.
    function pickerButton() {
        var buttons = document.querySelectorAll('button, [role="button"]');
        for (var i = 0; i < buttons.length; i += 1) {
            var b = buttons[i];
            var label = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.getAttribute('data-testid') || '');
            if (PICKER_RE.test(label) && !b.closest('#' + GROUP_ID) && b.getClientRects().length) return b;
        }
        return null;
    }

    // Inserted where the cursor is, the way typing would, so the chat's own
    // code sees an ordinary input.
    function insert(composer, text) {
        if (document.activeElement !== composer) composer.focus();
        var done = false;
        try { done = document.execCommand('insertText', false, text); } catch (_) { done = false; }
        if (done) return;
        // Fallback for a plain text field.
        if (composer.tagName === 'TEXTAREA') {
            var start = composer.selectionStart || 0;
            var end = composer.selectionEnd || 0;
            composer.setRangeText(text, start, end, 'end');
            composer.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    var lastComposer = null;

    // Without a focused message box yet: the message box in the same chat
    // as the buttons (the nearest one going up from the button row).
    function composerNear(el) {
        for (var box = el.parentElement; box && box !== document.body; box = box.parentElement) {
            var found = box.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
            if (found) return found;
        }
        return null;
    }

    function buildGroup() {
        var group = document.createElement('span');
        group.id = GROUP_ID;
        EMOJIS.forEach(function (code, index) {
            var emoji = String.fromCodePoint(code);
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = emoji;
            button.title = 'Add ' + emoji + ' to the message (shortcut :' + (index + 1) + ')';
            // Pressing must not take the focus (and the cursor) away from
            // the message.
            button.addEventListener('mousedown', function (event) { event.preventDefault(); });
            button.addEventListener('click', function (event) {
                event.preventDefault();
                var composer = lastComposer && lastComposer.isConnected ? lastComposer : composerNear(group);
                if (composer) {
                    lastComposer = composer;
                    insert(composer, emoji);
                }
            });
            group.appendChild(button);
        });
        return group;
    }

    function place() {
        var picker = pickerButton();
        if (!picker) return;
        // The row of buttons: the picker's parent, or, when the picker sits
        // alone in a wrapper of its own, the element holding that wrapper.
        var item = picker;
        while (item.parentElement && item.parentElement.children.length === 1) item = item.parentElement;
        var row = item.parentElement;
        if (!row) return;
        var group = document.getElementById(GROUP_ID);
        if (group && group.parentElement === row && group === row.lastElementChild) return;
        if (!group) group = buildGroup();
        row.appendChild(group);
    }

    // Placed on its own, without the message box having the focus: a few
    // times after the page has loaded (a chat open at load), and shortly
    // after any click (opening or switching to a chat), once the chat has
    // been drawn. A press of a quick emoji then uses the chat's message box.
    var LOAD_CHECKS_MS = [1000, 3000, 6000];
    var AFTER_CLICK_MS = 400;
    var clickTimer = 0;

    function placeSoon() {
        try { place(); } catch (err) { console.warn(LOG, err); }
    }

    LOAD_CHECKS_MS.forEach(function (ms) { window.setTimeout(placeSoon, ms); });
    document.addEventListener('click', function () {
        window.clearTimeout(clickTimer);
        clickTimer = window.setTimeout(placeSoon, AFTER_CLICK_MS);
    }, true);

    // SHORTCUTS
    // ":1" typed in the message becomes the first emoji of the row, ":2"
    // the second and so on, as soon as the number is typed. Only after a
    // space or at the start of a line, so a time such as 12:15 is left
    // alone. The two characters are selected and replaced the way typing
    // would, so the chat sees a normal edit.
    var SHORTCUT_RE = new RegExp('(^|\\s):([1-' + Math.min(EMOJIS.length, 9) + '])$');

    function textBeforeCaret(composer) {
        if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
            return composer.value.slice(0, composer.selectionStart || 0);
        }
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return '';
        var range = sel.getRangeAt(0).cloneRange();
        range.setStart(composer, 0);
        return range.toString();
    }

    function selectBack(composer, chars) {
        if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
            var end = composer.selectionStart || 0;
            composer.setSelectionRange(end - chars, end);
            return true;
        }
        var sel = window.getSelection();
        if (!sel || typeof sel.modify !== 'function') return false;
        for (var i = 0; i < chars; i += 1) sel.modify('extend', 'backward', 'character');
        return sel.toString().length === chars;
    }

    document.addEventListener('input', function (event) {
        if (event.isComposing || (event.inputType && event.inputType !== 'insertText')) return;
        var path = event.composedPath ? event.composedPath() : [event.target];
        var composer = path[0];
        if (!isComposer(composer)) return;
        var match = textBeforeCaret(composer).match(SHORTCUT_RE);
        if (!match) return;
        var emoji = String.fromCodePoint(EMOJIS[Number(match[2]) - 1]);
        if (selectBack(composer, 2)) insert(composer, emoji);
    }, true);

    // The real element that got the focus, also inside a component's own
    // shadow root.
    document.addEventListener('focusin', function (event) {
        var path = event.composedPath ? event.composedPath() : [event.target];
        var target = path[0];
        if (!isComposer(target)) return;
        lastComposer = target;
        try { place(); } catch (err) { console.warn(LOG, err); }
    }, true);
})();
