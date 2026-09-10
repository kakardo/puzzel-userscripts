// @file_name = PCM_Incident_Button.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-09-09
// @created = 2026-09-09 13:20
// @note = Fields are located by the OPTION they must receive, not by their label. The Forms widget reuses the same label text on several fields (probing the live Incident form returned 'Customer ID' for five different selects), so label lookup cannot tell them apart. Field ids are index-based (attributes_2, attributes_3) and would break if Puzzel reorders the form, so they are not used either.

// ==UserScript==
// @name         PCM Incident Button
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-09-09
// @description  One button that sets the Forms widget to a platform-incident preset: Form = Incident, then Puzzel Service, Contact Centre Product Area, Ticket caused by, Impact and Urgency. Fills in order and waits for each re-render, because selecting the Form rebuilds the field set and the Product Area list is a child of Puzzel Service. Customer ID and Customer Ref are deliberately left alone, PCM Form Buttons owns those. Each field is found by the option it must receive, with dash variants normalised, so the preset survives label duplication, field reordering, and an en dash in the option text. Anything not found or ambiguous is reported and skipped, never guessed at.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Forms/PCM_Incident_Button.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Forms/PCM_Incident_Button.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     * The preset, applied top to bottom. Order matters: 'Form' rebuilds
     * the whole field set, and 'Contact Centre Product Area' only gets
     * its options once 'Puzzel Service' is set, so each step waits for
     * the one before it.
     *
     * label is only used in console messages and on the button.
     * value must equal the option's visible text. Case is ignored and
     * dash variants are treated as equal, so a plain hyphen here still
     * matches an en dash in PCM.
     ******************************************************************/
    var PRESET = [
        { label: 'Form', value: 'Incident' },
        { label: 'Puzzel Service', value: 'Contact Centre' },
        { label: 'Contact Centre Product Area', value: 'Platform Outage' },
        { label: 'Ticket caused by', value: 'Puzzel Error - Platform Incident' },
        { label: 'Impact', value: 'The fault affects all Users' },
        { label: 'Urgency', value: 'Application is unavailable or blocking communication' }
    ];

    var BUTTON_LABEL = 'Incident';
    var BUTTON_TITLE = 'Set the Change form to the platform-incident preset';

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var BAR_ID = 'pcm-incident-bar';
    var BTN_ID = 'pcm-incident-btn';
    var STYLE_ID = 'pcm-incident-button-style';

    // Each step retries until its select exists AND carries the option
    // it needs, which is how the script waits out a re-render without
    // polling in the idle case: the retries only run during a press.
    var STEP_INTERVAL_MS = 120;
    var STEP_MAX_TRIES = 25;

    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.query || !D.queryAll ||
        !D.cleanText || !D.setNativeFieldValue || !D.flashLabel || !D.installNavigationHooks) {
        console.error('[PCM Incident Button] PCM_DOM shared library missing or stale (lib 2.0 or newer required), aborting.');
        return;
    }

    D.ensureStyleTag(STYLE_ID, [
        '#' + BAR_ID + ' {',
        '    display: flex;',
        '    flex-wrap: wrap;',
        '    gap: 6px;',
        '    align-items: center;',
        '    margin: 0 0 12px 0;',
        '}',
        '#' + BTN_ID + ' {',
        '    font-size: 12px;',
        '    padding: 3px 12px;',
        '    font-weight: 700;',
        '    background: #f6d9d9;',
        '    border-color: #d08a8a;',
        '    color: #6b1d1d;',
        '}',
        '#' + BTN_ID + ':hover {',
        '    background: #f0c4c4;',
        '    border-color: #c06a6a;',
        '}'
    ].join('\n'));

    /******************************************************************
     * Matching
     ******************************************************************/
    // PCM's option text mixes plain hyphens with en dashes, and the repo
    // rules ban en and em dashes from source, so both sides of every
    // comparison are folded to a plain hyphen. Without this, a preset
    // written with a hyphen silently fails to match.
    function norm(value) {
        return D.cleanText(String(value || ''))
            .replace(/[‐-―−]/g, '-')
            .replace(/\s*-\s*/g, ' - ')
            .toLowerCase();
    }

    function formRoot() {
        return D.query('#ticket-forms-form') ||
            D.query('form.ticket-forms-form') ||
            (D.query('#form-fields-wrapper') ? D.query('#form-fields-wrapper').closest('form') : null);
    }

    // Finds the select that offers this exact option. Returns the match,
    // null if nothing offers it yet (still rendering), or 'ambiguous' if
    // more than one select does. Ambiguity is never resolved by picking
    // one: a wrong field written silently is worse than a reported skip.
    function findTarget(root, wanted) {
        var target = norm(wanted);
        var found = [];

        D.queryAll('select', root).forEach(function (select) {
            for (var i = 0; i < select.options.length; i++) {
                if (norm(select.options[i].textContent) === target) {
                    found.push({ select: select, option: select.options[i] });
                    return;
                }
            }
        });

        if (!found.length) return null;
        if (found.length > 1) return 'ambiguous';
        return found[0];
    }

    function alreadySet(match) {
        return match.select.value === match.option.value;
    }

    /******************************************************************
     * Applying the preset
     ******************************************************************/
    // Sequential on purpose. Firing all six at once would race the
    // re-render that each change triggers, and the later fields would be
    // written into a field set that is about to be replaced.
    function runPreset(btn) {
        var report = { set: 0, skipped: [], missing: [], ambiguous: [] };
        var index = 0;
        var tries = 0;

        function finish() {
            var problems = report.missing.length + report.ambiguous.length;

            report.missing.forEach(function (label) {
                console.warn('[PCM Incident Button] %o: no field offers its value, skipped. The form may have changed.', label);
            });
            report.ambiguous.forEach(function (label) {
                console.warn('[PCM Incident Button] %o: more than one field offers its value, skipped rather than guessed.', label);
            });
            if (report.skipped.length) {
                console.info('[PCM Incident Button] already correct, left alone: %s', report.skipped.join(', '));
            }

            if (problems) {
                D.flashLabel(btn, 'Check ' + problems + ' field(s)', 2500);
            } else {
                D.flashLabel(btn, 'Incident set');
            }
        }

        function step() {
            if (index >= PRESET.length) {
                finish();
                return;
            }

            var entry = PRESET[index];
            var root = formRoot();
            var match = root ? findTarget(root, entry.value) : null;

            if (match === 'ambiguous') {
                report.ambiguous.push(entry.label);
                index += 1;
                tries = 0;
                window.setTimeout(step, 0);
                return;
            }

            if (!match) {
                // Not there yet: the previous change is still rendering.
                tries += 1;
                if (tries >= STEP_MAX_TRIES) {
                    report.missing.push(entry.label);
                    index += 1;
                    tries = 0;
                    window.setTimeout(step, 0);
                    return;
                }
                window.setTimeout(step, STEP_INTERVAL_MS);
                return;
            }

            if (alreadySet(match)) {
                report.skipped.push(entry.label);
            } else if (D.setNativeFieldValue(match.select, match.option.value)) {
                report.set += 1;
            } else {
                report.missing.push(entry.label);
            }

            index += 1;
            tries = 0;
            // A gap before the next field so the app can rebuild. Steps
            // that need longer are covered by their own retries.
            window.setTimeout(step, STEP_INTERVAL_MS);
        }

        step();
    }

    /******************************************************************
     * Button placement
     ******************************************************************/
    // Same anchor PCM Form Buttons uses: the block holding the 'Form:'
    // label. Our bar is inserted before it with its own id, so the two
    // scripts stack instead of fighting over one container.
    function formBlock() {
        var label = D.queryAll('label, div, span, strong, b').find(function (el) {
            var value = D.cleanText(D.text ? D.text(el) : el.textContent);
            return value === 'Form' || value === 'Form:';
        });
        if (!label) return null;

        var block = label.closest('.form-group, .field, .control-group, [class*="field"], [class*="group"], [class*="col"]');
        return block || label.parentElement || null;
    }

    function ensureButton() {
        var block = formBlock();
        if (!block || !block.parentElement) return false;

        var existing = document.getElementById(BAR_ID);
        if (existing && existing.isConnected) return true;
        if (existing) existing.remove();

        var bar = document.createElement('div');
        bar.id = BAR_ID;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.id = BTN_ID;
        btn.className = 'btn btn-default btn-xs';
        btn.textContent = BUTTON_LABEL;
        btn.title = BUTTON_TITLE;
        btn.addEventListener('click', function (event) {
            // The bar sits inside the form, so a bare click would submit.
            event.preventDefault();
            event.stopPropagation();
            runPreset(btn);
        });

        bar.appendChild(btn);
        block.parentElement.insertBefore(bar, block);
        return true;
    }

    /******************************************************************
     * Boot
     ******************************************************************/
    function onRouteChange() {
        D.bootUntil(function () {
            return !!formBlock();
        }, ensureButton, { BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 250 });
    }

    D.bootUntil(function () {
        return !!(document.body && formBlock());
    }, function () {
        ensureButton();
        D.installNavigationHooks(onRouteChange);
    }, { BOOT_MAX_TRIES: 60, BOOT_INTERVAL_MS: 250 });
})();
