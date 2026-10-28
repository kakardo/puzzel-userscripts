// @file_name = PCM_Assign_Buttons.user.js
// @author = Kardo Rostam
// @version = 1.1_2026-10-28
// @created = 2026-10-14 11:25

// ==UserScript==
// @name         PCM Assign Buttons
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-10-28
// @description  Adds two buttons beside the "Assigned To:" label in the Attributes widget: Me selects you in the Assigned To list, Unassign selects the empty entry. You are recognised from your profile picture in the top bar (its address holds your user id), so no id is written in the script. Each button is greyed out when it would change nothing: Me while you are not in the selected team's list or already assigned, Unassign while nobody is assigned; the tooltip says why. The choice is made the way picking it by hand would, so PCM (and the unsaved changes warning) sees it; you still press Save. The buttons come back by themselves when PCM rebuilds the widget. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Assign_Buttons.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Assign_Buttons.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    var ME_LABEL = 'Me';
    var ME_COLOUR = '#1e5bd8';
    var BLANK_LABEL = 'Unassign';
    var BLANK_COLOUR = '#607080';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.cleanText || !D.createVisibilityGate ||
        !D.installNavigationHooks) {
        console.error('[PCM Assign Buttons] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    var SELECT_ID = 'user-select';
    var WRAP_ID = 'pcm-assign-buttons';
    var STYLE_ID = 'pcm-assign-buttons-style';
    var LABEL_RE = /^assigned to:?/i;
    var SCAN_DELAY_MS = 150;

    D.ensureStyleTag(STYLE_ID, [
        '#' + WRAP_ID + ' {',
        '    display: inline-flex;',
        '    gap: 4px;',
        '    margin-left: 8px;',
        '    vertical-align: middle;',
        '}',
        '#' + WRAP_ID + ' button {',
        '    padding: 1px 9px;',
        '    border: 1px solid rgba(0,0,0,0.25);',
        '    border-radius: 3px;',
        '    color: #fff;',
        '    font-size: 11px;',
        '    font-weight: 700;',
        '    line-height: 1.5;',
        '    cursor: pointer;',
        '}',
        '#' + WRAP_ID + ' button:hover {',
        '    filter: brightness(1.12);',
        '}',
        '#' + WRAP_ID + ' button:disabled {',
        '    opacity: .35;',
        '    cursor: default;',
        '    filter: none;',
        '}'
    ].join('\n'));

    // WHO AM I
    // The profile picture in the top bar loads from /users/<id>/avatar.
    function myUserId() {
        var img = document.querySelector('#user-link img.avatar-thumb') ||
            document.querySelector('img.avatar-thumb');
        var match = img && (img.getAttribute('src') || '').match(/\/users\/(\d+)\/avatar/);
        return match ? match[1] : '';
    }

    // FINDING THE FIELD
    function ownText(el) {
        var value = '';
        el.childNodes.forEach(function (node) {
            if (node.nodeType === 3) value += node.nodeValue;
        });
        return D.cleanText(value);
    }

    function findParts() {
        var select = document.getElementById(SELECT_ID);
        if (!select) return null;
        var section = select.closest('section, .form-group, [class*="col"]') || select.parentElement;
        var label = null;
        var labels = section ? section.querySelectorAll('label') : [];
        for (var i = 0; i < labels.length; i += 1) {
            if (LABEL_RE.test(ownText(labels[i]))) {
                label = labels[i];
                break;
            }
        }
        return label ? { select: select, label: label } : null;
    }

    function optionByValue(select, value) {
        for (var i = 0; i < select.options.length; i += 1) {
            if (select.options[i].value === value) return select.options[i];
        }
        return null;
    }

    // CHOOSING
    // One native change event: jQuery, Chosen and select2 handlers all
    // listen through addEventListener, so they see it too, and nothing
    // runs twice. Chosen redraws only on its own event.
    function choose(value) {
        var parts = findParts();
        if (!parts || !optionByValue(parts.select, value)) return;
        var select = parts.select;
        if (select.value === value) return;
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        var jq = window.jQuery;
        if (jq) jq(select).trigger('chosen:updated');
        updateStates();
    }

    function updateStates() {
        var parts = findParts();
        var wrap = document.getElementById(WRAP_ID);
        if (!parts || !wrap) return;
        var me = myUserId();
        var meButton = wrap.querySelector('[data-role="me"]');
        var blankButton = wrap.querySelector('[data-role="blank"]');

        // Each button is greyed out when pressing it would change nothing:
        // Me when you are not in the list or already chosen, Unassign when
        // nobody is chosen. The tooltip says which.
        var current = parts.select.value;
        var meListed = !!(me && optionByValue(parts.select, me));
        var meAvailable = meListed && current !== me;
        if (meButton.disabled === meAvailable) meButton.disabled = !meAvailable;
        var meTitle = !me ? 'Could not find who you are (no profile picture in the top bar)'
            : !meListed ? 'You are not in the Assigned To list of the selected team'
            : !meAvailable ? 'Already assigned to you'
            : 'Assign the ticket to you (then press Save)';
        if (meButton.title !== meTitle) meButton.title = meTitle;

        var blankListed = !!optionByValue(parts.select, '');
        var blankAvailable = blankListed && current !== '';
        if (blankButton.disabled === blankAvailable) blankButton.disabled = !blankAvailable;
        var blankTitle = !blankListed ? 'No empty choice in the Assigned To list'
            : !blankAvailable ? 'Already unassigned'
            : 'Clear Assigned To (then press Save)';
        if (blankButton.title !== blankTitle) blankButton.title = blankTitle;
    }

    // PLACING THE BUTTONS
    function makeButton(role, text, colour, onClick) {
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-role', role);
        button.textContent = text;
        button.style.backgroundColor = colour;
        button.addEventListener('click', function (event) {
            // Also keeps the label from opening the dropdown.
            event.preventDefault();
            event.stopPropagation();
            onClick();
        });
        return button;
    }

    var watchedSelect = null;

    // Idempotent: writes only when the buttons are missing or misplaced,
    // so the observer below never feeds itself.
    function ensure() {
        var parts = findParts();
        if (!parts) return;
        var wrap = document.getElementById(WRAP_ID);
        if (!wrap) {
            wrap = document.createElement('span');
            wrap.id = WRAP_ID;
            wrap.appendChild(makeButton('me', ME_LABEL, ME_COLOUR, function () { choose(myUserId()); }));
            var blank = makeButton('blank', BLANK_LABEL, BLANK_COLOUR, function () { choose(''); });
            wrap.appendChild(blank);
        }
        if (wrap.parentElement !== parts.label) parts.label.appendChild(wrap);

        // A team change refills the list, so Me can become (un)available.
        if (watchedSelect !== parts.select) {
            watchedSelect = parts.select;
            parts.select.addEventListener('change', updateStates);
        }
        updateStates();
    }

    var gate = D.createVisibilityGate(ensure, SCAN_DELAY_MS);

    // BOOT
    // PCM rebuilds the Attributes widget after a save and refills the
    // Assigned To list after a team change; only additions are looked at.
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
