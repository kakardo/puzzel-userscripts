// @file_name = PCM_PostIt_Quick_Text.user.js
// @author = Kardo Rostam
// @version = 1.1_2026-10-28
// @created = 2026-10-14 11:20

// ==UserScript==
// @name         PCM PostIt Quick Text
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-10-28
// @description  Adds a red button beside the "Post-It Note:" label in the Attributes widget that writes a text in the Post-It Note, INCIDENT unless you choose another. The arrow on its right turns the button into a small text box: type what the button should write and press Enter (Esc cancels, an empty box goes back to INCIDENT); the choice is remembered in this browser. One press writes the text: into an empty note as is, above existing text on its own first line, and not at all when the note already contains it. The text is set the way typing would, so PCM (and the unsaved changes warning) sees the change; you still press Save. A press made before PCM has finished preparing the form (the first moment after a ticket opens) is ignored and the button says Loading, since PCM would otherwise take the text as the saved one and keep Save grey. The button comes back by itself when PCM rebuilds the widget after a save. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_PostIt_Quick_Text.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_PostIt_Quick_Text.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // What the button writes until you choose another text with its arrow.
    var DEFAULT_TEXT = 'INCIDENT';
    var BUTTON_COLOUR = '#c62828';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.cleanText || !D.createVisibilityGate ||
        !D.installNavigationHooks || !D.setNativeFieldValue || !D.flashLabel) {
        console.error('[PCM PostIt Quick Text] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    var WRAP_ID = 'pcm-postit-quick-text';
    var STYLE_ID = 'pcm-postit-quick-text-style';
    var TEXT_KEY = 'pcm-postit-button-text';
    var LABEL_RE = /^post-?it note:?$/i;
    var SCAN_DELAY_MS = 150;

    // A split button: the text half writes, the arrow half edits. While
    // editing, both halves are swapped for one text box.
    D.ensureStyleTag(STYLE_ID, [
        '#' + WRAP_ID + ' {',
        '    display: inline-flex;',
        '    margin-left: 8px;',
        '    vertical-align: middle;',
        '}',
        '#' + WRAP_ID + ' button {',
        '    padding: 1px 9px;',
        '    border: 1px solid rgba(0,0,0,0.25);',
        '    background: ' + BUTTON_COLOUR + ';',
        '    color: #fff;',
        '    font-size: 11px;',
        '    font-weight: 700;',
        '    line-height: 1.5;',
        '    letter-spacing: .3px;',
        '    cursor: pointer;',
        '}',
        '#' + WRAP_ID + ' button:hover {',
        '    filter: brightness(1.12);',
        '}',
        '#' + WRAP_ID + ' .pcm-postit-write {',
        '    border-radius: 3px 0 0 3px;',
        '}',
        '#' + WRAP_ID + ' .pcm-postit-edit {',
        '    padding: 1px 6px;',
        '    border-left-color: rgba(255,255,255,0.45);',
        '    border-radius: 0 3px 3px 0;',
        '}',
        '#' + WRAP_ID + ' input {',
        '    width: 160px;',
        '    padding: 0 6px;',
        '    border: 1px solid ' + BUTTON_COLOUR + ';',
        '    border-radius: 3px;',
        '    font-size: 12px;',
        '    font-weight: 600;',
        '    line-height: 1.6;',
        '}'
    ].join('\n'));

    // THE TEXT
    function buttonText() {
        try {
            var stored = window.localStorage.getItem(TEXT_KEY);
            if (stored && stored.trim()) return stored.trim();
        } catch (_) {
            // Storage blocked: the default applies.
        }
        return DEFAULT_TEXT;
    }

    function saveButtonText(text) {
        try {
            if (text && text !== DEFAULT_TEXT) window.localStorage.setItem(TEXT_KEY, text);
            else window.localStorage.removeItem(TEXT_KEY);
        } catch (_) {
            // Storage blocked: the text holds until the page reloads.
        }
        sessionText = text || DEFAULT_TEXT;
    }

    var sessionText = buttonText();

    // FINDING THE POST-IT NOTE
    // The label is matched on its own text (not its children's), so the
    // button inside it does not stop a re-run from recognising it. The
    // textarea is the one the label points at, or the one in the same
    // section of the form.
    function ownText(el) {
        var value = '';
        el.childNodes.forEach(function (node) {
            if (node.nodeType === 3) value += node.nodeValue;
        });
        return D.cleanText(value);
    }

    function findParts() {
        var root = document.getElementById('ticket-attributes-form') ||
            document.querySelector('form.edit_ticket') || document;
        var labels = root.querySelectorAll('label');
        for (var i = 0; i < labels.length; i += 1) {
            var label = labels[i];
            if (!LABEL_RE.test(ownText(label))) continue;
            var forId = label.getAttribute('for');
            var area = (forId && document.getElementById(forId)) || null;
            if (!area || area.tagName !== 'TEXTAREA') {
                var section = label.closest('section, .form-group, [class*="col"]') || label.parentElement;
                area = section ? section.querySelector('textarea') : null;
            }
            if (area) return { label: label, area: area };
        }
        return null;
    }

    // WRITING
    // "Already there" is a plain case-insensitive search, so any text
    // works, including ones with punctuation.
    //
    // PCM decides whether Save is allowed with its "Are You Sure" form
    // plugin, which records every field's original value (jQuery data
    // 'ays-orig') shortly after the ticket opens. Text written before that
    // is recorded as the original: Save stays grey while the unsaved
    // warning shows. So a press waits for the record, and afterwards the
    // plugin is asked to re-check the form.
    function formReady(field) {
        var jq = window.jQuery;
        if (!jq || !field.form) return true;
        if (jq(field).data('ays-orig') !== undefined) return true;
        // No record: wait while the plugin is bound to the form (it is
        // about to record) or the page is still young; a form without
        // the plugin must not block the buttons for good.
        var events = jq._data ? jq._data(field.form, 'events') : null;
        if (events && events.checkform) return false;
        return window.performance.now() > 5000;
    }

    function writeText(button) {
        var parts = findParts();
        if (!parts) return;
        var text = sessionText;
        var area = parts.area;
        if (!formReady(area)) {
            D.flashLabel(button, 'Loading\u2026', 1000);
            return;
        }
        var current = area.value || '';
        if (current.toLowerCase().indexOf(text.toLowerCase()) >= 0) {
            D.flashLabel(button, 'Already there', 1200);
            return;
        }
        var next = current.trim() ? text + '\n' + current : text;
        D.setNativeFieldValue(area, next);
        var jq = window.jQuery;
        if (jq && area.form) jq(area.form).trigger('checkform.areYouSure');
        D.flashLabel(button, 'Added', 900);
    }

    // THE SPLIT BUTTON
    // Clicks inside the label are stopped, or the label would move focus
    // to the textarea (or, for Enter in the box, submit the form).
    function stop(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    function fillButtons(wrap) {
        wrap.textContent = '';
        var write = document.createElement('button');
        write.type = 'button';
        write.className = 'pcm-postit-write';
        write.textContent = sessionText;
        write.title = 'Write "' + sessionText + '" in the Post-It Note (then press Save)';
        write.addEventListener('click', function (event) {
            stop(event);
            writeText(write);
        });

        var edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'pcm-postit-edit';
        edit.textContent = '▸';
        edit.title = 'Choose what the button writes';
        edit.addEventListener('click', function (event) {
            stop(event);
            startEditing(wrap);
        });

        wrap.appendChild(write);
        wrap.appendChild(edit);
    }

    function startEditing(wrap) {
        wrap.textContent = '';
        var input = document.createElement('input');
        input.type = 'text';
        input.value = sessionText;
        input.placeholder = DEFAULT_TEXT;
        input.title = 'Enter saves, Esc cancels, empty goes back to ' + DEFAULT_TEXT;
        var finished = false;

        function finish(save) {
            if (finished) return;
            finished = true;
            if (save) saveButtonText(D.cleanText(input.value));
            fillButtons(wrap);
        }

        input.addEventListener('click', function (event) { event.stopPropagation(); });
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                stop(event);
                finish(true);
            } else if (event.key === 'Escape') {
                stop(event);
                finish(false);
            }
        });
        input.addEventListener('blur', function () { finish(true); });

        wrap.appendChild(input);
        input.focus();
        input.select();
    }

    // PLACING THE BUTTON
    // Idempotent: writes only when the button is missing or misplaced, so
    // the observer below never feeds itself (and an open text box is never
    // rebuilt under your cursor).
    function ensure() {
        var parts = findParts();
        var wrap = document.getElementById(WRAP_ID);
        if (!parts) return;
        if (wrap && wrap.parentElement === parts.label) return;
        if (!wrap) {
            wrap = document.createElement('span');
            wrap.id = WRAP_ID;
            fillButtons(wrap);
        }
        parts.label.appendChild(wrap);
    }

    var gate = D.createVisibilityGate(ensure, SCAN_DELAY_MS);

    // BOOT
    // PCM rebuilds the Attributes widget after a save; only additions are
    // looked at, and ensure() is a few reads when nothing changed.
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
