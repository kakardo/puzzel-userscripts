// @file_name = PCM_Merge_By_Number.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-07
// @created = 2026-10-07 09:19

// ==UserScript==
// @name         PCM Merge By Number
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-07
// @description  Adds a "merge into ticket number" field to PCM's Merge Tickets window, for when the search list does not show the ticket you want. Type the number and press Use: the ticket is looked up to confirm it exists and its title is shown, then it is put in the window exactly as if you had picked it from the list. You still press PCM's own Merge button, so the merge goes through PCM's normal request and checks. Optional (a tick box in the window, off by default): when you type a number in PCM's own search field and the ticket is not in its list, the script looks it up and tells you to use its field instead. Event-driven via Bootstrap's shown.bs.modal: zero cost while the window is closed, no observers, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Merge_By_Number.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Merge_By_Number.user.js
// ==/UserScript==

(function () {
    'use strict';

    // INTERNAL SETTINGS
    // The Merge Tickets form: hidden "id" is this ticket, hidden
    // "main_ticket_id" is the ticket to merge into, which PCM's search
    // list normally fills. The form posts to /merged_tickets.
    var LOG = '[PCM Merge By Number]';
    var FORM_SELECTOR = 'form#merged-tickets-form, form[action="/merged_tickets"]';
    var ROW_ID = 'pcm-merge-by-number';
    var STYLE_ID = 'pcm-merge-by-number-style';
    var AUTO_KEY = 'pcm-merge-by-number-auto';
    var TYPING_PAUSE_MS = 700;
    var LOAD_WAIT_MAX_MS = 5000;
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 500;

    var CSS = [
        '#' + ROW_ID + ' { margin-top: 10px; }',
        '#' + ROW_ID + ' .pcm-mbn-line { display: flex; gap: 6px; align-items: center; }',
        '#' + ROW_ID + ' input { width: 140px; height: 30px; padding: 4px 8px; border: 1px solid #bdbdbd; }',
        '#' + ROW_ID + ' .pcm-mbn-msg { margin-top: 6px; font-size: 12px; }',
        '#' + ROW_ID + ' .pcm-mbn-auto { display: flex; gap: 6px; align-items: center; margin-top: 6px; font-weight: normal; cursor: pointer; }',
        '#' + ROW_ID + ' .pcm-mbn-auto input { width: auto; height: auto; margin: 0; }',
        '#' + ROW_ID + ' .pcm-mbn-warn { color: #b26a00; }',
        '#' + ROW_ID + ' .pcm-mbn-ok { color: #2f7d2f; }',
        '#' + ROW_ID + ' .pcm-mbn-err { color: #c62828; }'
    ].join('\n');

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    // kind: true (ok), false (error) or 'warn'
    function setMessage(row, text, kind) {
        var msg = row.querySelector('.pcm-mbn-msg');
        msg.className = 'pcm-mbn-msg ' + (kind === 'warn' ? 'pcm-mbn-warn' : kind ? 'pcm-mbn-ok' : 'pcm-mbn-err');
        msg.textContent = text;
    }

    function autoOn() {
        try { return localStorage.getItem(AUTO_KEY) === '1'; } catch (_) { return false; }
    }

    function setAuto(on) {
        try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (_) {}
    }

    // Opens the ticket page in the background to make sure it exists and
    // you have access, and reads its title so you can see it is the
    // right one. A missing ticket or no access ends somewhere else than
    // /tickets/<number>.
    function lookUp(number) {
        return fetch('/tickets/' + number, { credentials: 'same-origin' }).then(function (response) {
            var landed = new URL(response.url, window.location.href).pathname;
            if (!response.ok || landed.replace(/\/$/, '') !== '/tickets/' + number) {
                throw new Error('not found or no access');
            }
            return response.text();
        }).then(function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            return (doc.title || '').replace(/\s+/g, ' ').trim();
        });
    }

    function useNumber(form, row) {
        var input = row.querySelector('input');
        var button = row.querySelector('button');
        var number = (input.value || '').replace(/\D/g, '');
        var own = (form.querySelector('input[name="id"]') || {}).value || '';

        if (!number) { setMessage(row, 'Type a ticket number.', false); return; }
        if (number === own) { setMessage(row, 'That is this ticket. Type the ticket to merge into.', false); return; }

        button.disabled = true;
        setMessage(row, 'Looking up ticket ' + number + '...', true);
        lookUp(number).then(function (title) {
            var target = form.querySelector('input[name="main_ticket_id"]');
            var box = form.querySelector('#main_tickets_search_box, input[name="main_tickets_search_box"]');
            if (!target) throw new Error('merge form field missing');

            target.value = number;
            if (box) {
                box.value = number + (title ? ' - ' + title : '');
                box.disabled = true;
            }
            var submit = form.querySelector('input[type="submit"][name="commit"], input[type="submit"], button[type="submit"]');
            if (submit) submit.disabled = false;

            setMessage(row, 'Ticket ' + number + ' is selected' + (title ? ': ' + title : '') +
                '. Check it, then press Merge.', true);
        }).catch(function (err) {
            console.warn(LOG, err);
            setMessage(row, 'Ticket ' + number + ' was not found, or you do not have access to it.', false);
        }).finally(function () {
            button.disabled = false;
        });
    }

    // AUTOMATIC LOOKUP (off by default, ticked in the window)
    // When you type a ticket number in PCM's own search field, the script
    // waits for PCM's list, checks whether the ticket is in it, and if not
    // looks it up itself and tells you, so you know to use the field below.
    // PCM leaves tickets out of its list when it will not merge into them
    // (for example a ticket without an initial channel), so a ticket that
    // is only found this way may still be refused when you press Merge.
    function waitForPcmList(done) {
        var started = Date.now();
        (function check() {
            var jq = window.jQuery;
            var busy = jq && jq.active > 0;
            if (busy && Date.now() - started < LOAD_WAIT_MAX_MS) {
                window.setTimeout(check, 200);
                return;
            }
            window.setTimeout(done, 300); // short quiet window for the list to draw
        })();
    }

    function pcmListHas(form, number) {
        var refs = form.querySelectorAll('#main-tickets-search-table .main-ticket-ref');
        for (var i = 0; i < refs.length; i++) {
            var ref = refs[i].getAttribute('data-title') || refs[i].textContent || '';
            if (ref.trim() === number) return true;
        }
        return false;
    }

    function autoLookUp(form, row, number) {
        var own = (form.querySelector('input[name="id"]') || {}).value || '';
        if (number === own) return;
        waitForPcmList(function () {
            var box = form.querySelector('#main_tickets_search_box, input[name="main_tickets_search_box"]');
            var current = box ? (box.value || '').replace(/\D/g, '') : '';
            if (current !== number) return; // you kept typing
            if (pcmListHas(form, number)) {
                setMessage(row, 'Ticket ' + number + ' is in the list above. Pick it there.', true);
                return;
            }
            setMessage(row, 'Ticket ' + number + ' is not in the list above. Looking it up...', 'warn');
            lookUp(number).then(function (title) {
                row.querySelector('.pcm-mbn-line input').value = number;
                setMessage(row, 'Ticket ' + number + ' is not in PCM\'s list, but it exists' + (title ? ': ' + title : '') +
                    '. Press Use to select it. PCM may still refuse the merge (for example when the ticket has no ' +
                    'initial channel); if so, merge the other way: open ticket ' + number + ' and merge it into this one.', 'warn');
            }, function () {
                setMessage(row, 'Ticket ' + number + ' was not found, or you do not have access to it.', false);
            });
        });
    }

    function hookAuto(form, row) {
        var box = form.querySelector('#main_tickets_search_box, input[name="main_tickets_search_box"]');
        if (!box) return;
        var timer = null;
        box.addEventListener('input', function () {
            if (timer) window.clearTimeout(timer);
            if (!autoOn()) return;
            var number = (box.value || '').trim();
            if (!/^\d{3,}$/.test(number)) return;
            timer = window.setTimeout(function () { autoLookUp(form, row, number); }, TYPING_PAUSE_MS);
        });
    }

    function addRow(form) {
        if (form.querySelector('#' + ROW_ID)) return;
        var anchor = form.querySelector('.well') || form.querySelector('.modal-body');
        if (!anchor) return;
        ensureStyle();

        var row = document.createElement('div');
        row.id = ROW_ID;

        var label = document.createElement('label');
        label.className = 'label';
        label.textContent = 'Not in the list? Type the ticket number:';

        var line = document.createElement('div');
        line.className = 'pcm-mbn-line';
        var input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.placeholder = 'Ticket number';
        input.autocomplete = 'off';
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-default btn-sm';
        button.textContent = 'Use';
        line.appendChild(input);
        line.appendChild(button);

        var msg = document.createElement('div');
        msg.className = 'pcm-mbn-msg';

        var auto = document.createElement('label');
        auto.className = 'pcm-mbn-auto';
        var tick = document.createElement('input');
        tick.type = 'checkbox';
        tick.checked = autoOn();
        tick.addEventListener('change', function () { setAuto(tick.checked); });
        auto.appendChild(tick);
        auto.appendChild(document.createTextNode('Look up automatically when I type a number in the search field above'));

        row.appendChild(label);
        row.appendChild(line);
        row.appendChild(msg);
        row.appendChild(auto);
        anchor.appendChild(row);
        hookAuto(form, row);

        button.addEventListener('click', function () { useNumber(form, row); });
        // Enter would submit PCM's form (and merge) with whatever is
        // selected, so it runs Use instead.
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                useNumber(form, row);
            }
        });
    }

    function onModalShown(event) {
        var form = event.target.querySelector(FORM_SELECTOR);
        if (form) addRow(form); // otherwise some other window
    }

    // Bounded boot: waits for jQuery with Bootstrap's modal plugin, then
    // everything runs on the window's shown event.
    var tries = 0;
    function start() {
        var jq = window.jQuery;
        if (!jq || !jq.fn || !jq.fn.modal) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) window.setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        jq(document).on('shown.bs.modal', onModalShown);
    }

    start();
})();
