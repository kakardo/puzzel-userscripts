// @file_name = PCM_Bulk_Update_Presets.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-27
// @created = 2026-10-27 14:04

// ==UserScript==
// @name         PCM Bulk Update Presets
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-27
// @description  Adds preset buttons to the "Updating Ticket(s)" window of the ticket list. One press fills in Team, Status and Priority from the preset, for example Spam: Team Spam/Virus Quarantine, Status Closed, Priority Junk. The fields are chosen the way picking them by hand would, so PCM refills Assigned To for the new team as usual. Nothing is saved until you press Update yourself. Presets are a list at the top. Standalone, event-driven via shown.bs.modal: no observers, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @match        https://puzzel.cm.puzzel.com/tickets?*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Bulk_Update_Presets.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Bulk_Update_Presets.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // One button per preset. team, status and priority are matched
    // against the option text in the window's dropdowns (case-insensitive,
    // exact after trimming). Leave a field out to keep it unchanged.
    var PRESETS = [
        { label: 'Spam', color: '#d32f2f', team: 'Spam/Virus Quarantine', status: 'Closed', priority: 'Junk' }
    ];

    // INTERNAL SETTINGS
    // From the window (div#bulk-ticket-attributes): plain selects.
    var MODAL_ID = 'bulk-ticket-attributes';
    var FIELDS = [
        { key: 'team', id: 'bulk-team-select' },
        { key: 'status', id: 'bulk-status-select' },
        { key: 'priority', id: 'bulk-priority-select' }
    ];
    var BAR_ID = 'pcm-bulk-presets';
    var STYLE_ID = 'pcm-bulk-presets-style';
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 250;

    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
        '#' + BAR_ID + ' {',
        '    display: flex;',
        '    flex-wrap: wrap;',
        '    align-items: center;',
        '    gap: 6px;',
        '    margin-top: 10px;',
        '}',
        '#' + BAR_ID + ' .pcm-bulk-label {',
        '    font-size: 12px;',
        '    color: #777;',
        '}',
        '#' + BAR_ID + ' button {',
        '    padding: 3px 12px;',
        '    border: 1px solid rgba(0,0,0,0.25);',
        '    border-radius: 3px;',
        '    color: #fff;',
        '    font-size: 12px;',
        '    font-weight: 700;',
        '    cursor: pointer;',
        '}',
        '#' + BAR_ID + ' button:hover {',
        '    filter: brightness(1.12);',
        '}',
        '#' + BAR_ID + ' .pcm-bulk-note {',
        '    font-size: 12px;',
        '    font-weight: 600;',
        '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);

    // FILLING IN
    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // One native change event per field: PCM's jQuery handlers listen
    // through addEventListener, so the team change refills Assigned To
    // exactly as a pick by hand does.
    function choose(select, text) {
        var wanted = cleanText(text);
        var option = Array.prototype.find.call(select.options, function (opt) {
            return cleanText(opt.textContent) === wanted;
        });
        if (!option) return false;
        if (select.value !== option.value) {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    }

    function apply(preset, note) {
        var missing = [];
        FIELDS.forEach(function (field) {
            if (!preset[field.key]) return;
            var select = document.getElementById(field.id);
            if (!select || !choose(select, preset[field.key])) missing.push(preset[field.key]);
        });
        note.style.color = missing.length ? '#c62828' : '#2f7d2f';
        note.textContent = missing.length
            ? 'Not found: ' + missing.join(', ')
            : preset.label + ' filled in, press Update to save';
    }

    // THE BAR
    // Under the window's note, above the fields. Built once; the window
    // itself stays in the page between openings.
    function ensureBar() {
        var modal = document.getElementById(MODAL_ID);
        if (!modal) return false;
        if (document.getElementById(BAR_ID)) return true;
        var header = modal.querySelector('.modal-header');
        if (!header) return false;

        var bar = document.createElement('div');
        bar.id = BAR_ID;
        var label = document.createElement('span');
        label.className = 'pcm-bulk-label';
        label.textContent = 'Presets:';
        bar.appendChild(label);

        var note = document.createElement('span');
        note.className = 'pcm-bulk-note';

        PRESETS.forEach(function (preset) {
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = preset.label;
            button.style.backgroundColor = preset.color || '#607080';
            button.title = FIELDS.filter(function (f) { return preset[f.key]; })
                .map(function (f) { return f.key.charAt(0).toUpperCase() + f.key.slice(1) + ': ' + preset[f.key]; })
                .join(', ') + ' (then press Update)';
            button.addEventListener('click', function (event) {
                event.preventDefault();
                apply(preset, note);
            });
            bar.appendChild(button);
        });
        bar.appendChild(note);
        header.appendChild(bar);
        return true;
    }

    // BOOT
    // Bounded wait for jQuery, then the bar is (re)checked each time the
    // window opens; the note from last time is cleared.
    var tries = 0;
    function start() {
        var jq = window.jQuery;
        if (!jq) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) window.setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        ensureBar();
        jq(document).on('shown.bs.modal', function (event) {
            if (!event.target || event.target.id !== MODAL_ID) return;
            ensureBar();
            var note = document.querySelector('#' + BAR_ID + ' .pcm-bulk-note');
            if (note) note.textContent = '';
        });
    }

    start();
})();
