// @file_name = PCM_Change_Completed_Now.user.js
// @author = Kardo Rostam
// @version = 1.3_2026-09-04
// @created = 2026-09-02 13:43

// ==UserScript==
// @name         PCM Change Completed Now
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.3_2026-09-04
// @description  Adds a small Now button beside the Change Completed label in the Forms widget (rendered when Form is Change). Pressing it fills the field with the current date and time in the agent's local time with the timezone visible (2026-09-02 15:47 BST), or in GMT for everyone via the TIMESTAMP_MODE setting. Field and label texts are settings at the top. Event-driven: a widget-scoped MutationObserver behind the shared visibility gate re-adds the button after re-renders, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Forms/PCM_Change_Completed_Now.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Forms/PCM_Change_Completed_Now.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    // Exact label text of the field to fill (a trailing colon also matches).
    var LABEL_TEXT = 'Change Completed';

    // Text on the injected button.
    var BUTTON_TEXT = 'Now';

    // 'local' fills the agent's own clock time with the timezone name
    // visible, e.g. '2026-09-02 15:47 BST' in the UK summer or
    // '2026-09-02 16:47 CEST' in Oslo at the same moment. Readable at a
    // glance, and the zone makes it unambiguous across offices.
    // 'gmt' fills the same instant for everyone, e.g.
    // '2026-09-02 14:47 GMT', for entries that must sort and compare
    // identically no matter who pressed the button.
    var TIMESTAMP_MODE = 'local';

    // Overwrite an existing value when pressed. The button is an explicit
    // action, so overwriting is the useful default.
    var OVERWRITE_EXISTING = true;

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var BUTTON_ID = 'pcm-change-completed-now';
    var STYLE_ID = 'pcm-change-completed-now-style';
    var OBSERVER_DELAY_MS = 150;

    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate || !D.createFieldFinder || !D.setNativeFieldValue) {
        console.error('[PCM Change Completed Now] PCM_DOM shared library missing or stale (lib 2.0 or newer required), aborting.');
        return;
    }

    var CSS = [
        '#' + BUTTON_ID + ' {',
        '    display: inline-block;',
        '    margin-left: 8px;',
        '    padding: 1px 8px;',
        '    font-size: 12px;',
        '    line-height: 18px;',
        '    border: 1px solid #bcc7d8;',
        '    border-radius: 4px;',
        '    background: #eef3f8;',
        '    color: #22364d;',
        '    cursor: pointer;',
        '    vertical-align: baseline;',
        '}',
        '#' + BUTTON_ID + ':hover {',
        '    background: #e8f1ff;',
        '    border-color: #94add1;',
        '}'
    ].join('\n');

    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    // The timezone is always part of the value: a bare local time would
    // be ambiguous the moment another office reads the ticket.
    function localZoneName(d) {
        try {
            var parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d);
            var tz = (parts.find(function (p) { return p.type === 'timeZoneName'; }) || {}).value;
            if (tz) return tz;
        } catch (_) { /* fall through to the numeric offset */ }
        var offset = -d.getTimezoneOffset();
        var sign = offset < 0 ? '-' : '+';
        var abs = Math.abs(offset);
        return 'GMT' + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
    }

    function timestamp() {
        var d = new Date();
        if (TIMESTAMP_MODE === 'gmt') {
            return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
                ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' GMT';
        }
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + localZoneName(d);
    }

    // Shared label-based lookup (lib 2.0). parts() also returns the
    // label element, which is where the button is injected.
    var fieldFinder = D.createFieldFinder({ fieldSelector: 'input, textarea' });

    function findParts() {
        return fieldFinder.parts(LABEL_TEXT);
    }

    function fillField(field) {
        if (!OVERWRITE_EXISTING && D.cleanText(field.value)) return;
        D.setNativeFieldValue(field, timestamp());
    }

    function ensureButton() {
        if (document.getElementById(BUTTON_ID)) return;
        var parts = findParts();
        if (!parts) return; // not the Change form right now

        var btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.textContent = BUTTON_TEXT;
        btn.title = 'Fill ' + LABEL_TEXT + ' with the current date and time';
        btn.addEventListener('click', function (event) {
            event.preventDefault();
            var current = findParts(); // re-resolve: the field may have been re-rendered
            if (current) fillField(current.field);
        });
        parts.label.insertAdjacentElement('afterend', btn);
    }

    var observer = null;
    var observerRoot = null;

    // Root on the Forms widget: it survives fieldset swaps and contains
    // the wrapper wherever PCM renders it. Re-armed from the gate run in
    // case the widget itself was replaced.
    function ensureObserver() {
        if (observerRoot && !observerRoot.isConnected) observerRoot = null;
        var wrapper = document.getElementById('form-fields-wrapper');
        var root = wrapper && (wrapper.closest('.jarviswidget') || wrapper.closest('section') ||
            wrapper.closest('form') || wrapper.parentElement);
        if (!root || !root.isConnected || observerRoot === root) return;

        if (!observer) {
            observer = new MutationObserver(function () {
                gate.schedule();
            });
        }
        observer.disconnect();
        observer.observe(root, { childList: true, subtree: true });
        observerRoot = root;
    }

    function run() {
        ensureObserver();
        ensureButton();
    }

    // One gate drives both: re-arm the observer and (re)inject the
    // button. Scheduled on boot, on navigation, and on every widget
    // mutation; skipped entirely while the tab is hidden.
    var gate = D.createVisibilityGate(run, OBSERVER_DELAY_MS);

    function start() {
        D.ensureStyleTag(STYLE_ID, CSS);
        D.installNavigationHooks(function () {
            gate.schedule();
        });
        run();
    }

    D.bootUntil(function () {
        return !!document.getElementById('form-fields-wrapper') || !!document.body;
    }, start);
})();
