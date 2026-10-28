// @file_name = PCM_Quick_Emoji.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-28
// @created = 2026-10-28 13:43

// ==UserScript==
// @name         PCM Quick Emoji
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-28
// @description  Adds one-press emoji buttons to the reply editor's toolbar, right after the emoji picker button, so a favourite emoji goes in where the cursor is without opening the picker. Starts with the smiling face; more are a list at the top. Uses the editor's own button style and inserts at the live cursor like typing, so rapid presses each add one and undo works as usual. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Quick_Emoji.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Quick_Emoji.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // One button per emoji, in this order. Written as escapes so the file
    // stays plain text; 😊 is the smiling face with smiling eyes.
    var EMOJIS = [
        { emoji: '😊', title: 'Smiling face' }
    ];

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.createVisibilityGate || !D.installNavigationHooks) {
        console.error('[PCM Quick Emoji] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    var GROUP_CLASS = 'pcm-quick-emoji';
    var SCAN_DELAY_MS = 150;
    // The picker button is recognised by its title, label or icon name.
    var PICKER_RE = /emoji|smil/i;

    // INSERTING
    // Straight at the browser's live cursor, the way typing does: the
    // browser's insertText puts the emoji where the cursor is, moves the
    // cursor after it, records an undo step and fires the input event
    // Summernote listens to. (Summernote's own insertText works from the
    // range it last remembered, which it does not always refresh between
    // quick presses, so rapid presses were lost.) When the cursor is not in
    // the text, the emoji goes at the end of the message.
    function cursorInside(editable) {
        var selection = window.getSelection();
        return !!(selection && selection.rangeCount && editable.contains(selection.getRangeAt(0).startContainer));
    }

    function caretToEnd(editable) {
        var range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function insert(editor, text) {
        var editable = editor.querySelector('.note-editable');
        if (!editable) return;
        var wasWriting = document.activeElement === editable && cursorInside(editable);
        if (document.activeElement !== editable) editable.focus();
        if (!wasWriting) caretToEnd(editable);
        document.execCommand('insertText', false, text);
    }

    // THE BUTTONS
    function findPickerGroup(toolbar) {
        var buttons = toolbar.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i += 1) {
            var b = buttons[i];
            var hint = (b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' +
                (b.getAttribute('data-original-title') || '') + ' ' + b.innerHTML;
            if (PICKER_RE.test(hint)) return b.closest('.note-btn-group, .btn-group') || b;
        }
        return null;
    }

    function buildGroup(editor) {
        var group = document.createElement('div');
        group.className = 'note-btn-group btn-group ' + GROUP_CLASS;
        EMOJIS.forEach(function (entry) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'note-btn btn btn-default btn-sm';
            button.title = 'Insert ' + entry.title;
            button.setAttribute('aria-label', 'Insert ' + entry.title);
            button.textContent = entry.emoji;
            // Pressing a button would take the cursor out of the text;
            // stopping the mousedown keeps it where it is.
            button.addEventListener('mousedown', function (event) { event.preventDefault(); });
            button.addEventListener('click', function (event) {
                event.preventDefault();
                insert(editor, entry.emoji);
            });
            group.appendChild(button);
        });
        return group;
    }

    // Idempotent: one group per toolbar, so the observer never feeds itself.
    function ensure() {
        document.querySelectorAll('.note-editor').forEach(function (editor) {
            var toolbar = editor.querySelector('.note-toolbar');
            if (!toolbar || toolbar.querySelector('.' + GROUP_CLASS)) return;
            var group = buildGroup(editor);
            var picker = findPickerGroup(toolbar);
            if (picker && picker.parentElement) picker.insertAdjacentElement('afterend', group);
            else toolbar.appendChild(group);
        });
    }

    var gate = D.createVisibilityGate(ensure, SCAN_DELAY_MS);

    // BOOT
    // The editor is created when you start a reply or note; only additions
    // are looked at, and ensure() is a few reads when nothing changed.
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
