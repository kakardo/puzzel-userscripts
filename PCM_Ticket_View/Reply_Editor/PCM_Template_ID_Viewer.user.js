// @file_name = PCM_Template_ID_Viewer.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-09-01
// @created = 2026-09-01 11:32

// ==UserScript==
// @name         PCM Template ID Viewer
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-09-01
// @description  Shows the numeric template id of the currently selected entry in PCM's Insert Template modal, next to the dropdown. Click the badge to copy the id (ready for PCM_TEMPLATE_BUTTONS in PCM Mail Templates). Purely event-driven via Bootstrap's shown.bs.modal and the select's change event: zero cost while no modal is open, no observers, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Template_ID_Viewer.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Template_ID_Viewer.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var BADGE_ID = 'pcm-template-id-badge';
    var STYLE_ID = 'pcm-template-id-style';
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 250;

    var CSS = [
        '#' + BADGE_ID + ' {',
        '    display: inline-block;',
        '    margin: 6px 0 0 2px;',
        '    padding: 2px 8px;',
        '    font-family: monospace;',
        '    font-size: 12px;',
        '    color: #234;',
        '    background: #e8eef7;',
        '    border: 1px solid #c3d0e4;',
        '    border-radius: 3px;',
        '    cursor: pointer;',
        '    user-select: none;',
        '}'
    ].join('\n');

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function copyText(value) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).catch(function () { copyFallback(value); });
            return;
        }
        copyFallback(value);
    }

    function copyFallback(value) {
        var area = document.createElement('textarea');
        area.value = value;
        area.style.cssText = 'position:fixed; left:-9999px;';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }

    function updateBadge(select) {
        // The badge lives inside the modal and is removed with it on
        // close, so recreate on demand.
        var badge = document.getElementById(BADGE_ID);
        if (!badge) {
            badge = document.createElement('span');
            badge.id = BADGE_ID;
            badge.title = 'PCM template id of the selected template. Click to copy.';
            badge.addEventListener('click', function () {
                var value = badge.dataset.value || '';
                if (!value) return;
                copyText(value);
                var original = badge.textContent;
                badge.textContent = 'Copied!';
                window.setTimeout(function () { badge.textContent = original; }, 1200);
            });
            select.parentNode.insertBefore(badge, select.nextSibling);
        }
        var value = select.value || '';
        badge.dataset.value = value;
        badge.textContent = 'ID: ' + (value || '?');
    }

    var SELECT_SELECTOR = 'select[name="template_id"], select#template_id';

    function onModalShown(event) {
        var modal = event.target;
        var select = modal.querySelector(SELECT_SELECTOR);
        if (!select) return; // some other modal
        ensureStyle();
        updateBadge(select);
    }

    // Bounded boot: only jQuery with Bootstrap's modal plugin is needed,
    // then everything is driven by events. The change handler must be
    // jQuery-delegated, not addEventListener: PCM updates this select
    // programmatically via jQuery's .trigger('change'), which runs
    // jQuery-bound handlers only, so a native listener never fired.
    // Delegation also catches native changes and survives the modal
    // being rebuilt on every open.
    var tries = 0;
    function start() {
        var jq = window.jQuery;
        if (!jq || !jq.fn || !jq.fn.modal) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) window.setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        jq(document).on('shown.bs.modal', onModalShown);
        jq(document).on('change', SELECT_SELECTOR, function () {
            updateBadge(this);
        });
    }

    start();
})();
