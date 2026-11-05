// @file_name = PCM_Customer_ID_Reminder.user.js
// @author = Kardo Rostam
// @version = 1.5_2026-11-05
// @created = 2026-11-02 11:05
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). The customer's email is read from the page at runtime (only to ask PCM for the ticket count), never written here.

// ==UserScript==
// @name         PCM Customer ID Reminder
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.5_2026-11-05
// @description  Reminds you to add the customer ID to a customer's profile. When the profile has an ID, PCM shows an Organisations section in Customer Intelligence; when that section is missing, the script counts the customer's tickets (the same list PCM loads when you open Customer Tickets, fetched once in the background with room for 500 tickets and only read, never run; the request is shared with PCM Customer Ticket Count and PCM Customer Top List) and, at 5 or more tickets, shows a red "(Reminder: add customer ID)" after the customer's name; its tooltip gives the number of tickets. Nothing is fetched when the ID is there. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Customer_ID_Reminder.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Customer_ID_Reminder.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // The marker shows from this many tickets (the current one included).
    var MIN_TICKETS = 5;
    var MARK_TEXT = '(Reminder: add customer ID)';
    var MARK_COLOUR = '#c62828';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.createVisibilityGate || !D.installNavigationHooks || !D.ensureStyleTag) {
        console.error('[PCM Customer ID Reminder] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    // From the ticket page: Customer Intelligence is #wid-customer-intelligence;
    // the Organisations section (toggle href="#organisations") only exists
    // when the profile has an ID; the Customer Tickets section (toggle
    // href="#related-tickets") loads its list from /customers/tickets_table
    // by the customer's email when opened, answered as JavaScript with one
    // row per ticket carrying data-ticket-ref="<number>". The name is
    // h1#cip-customer-name and the email span#cip-customer-email.
    var CI_ID = 'wid-customer-intelligence';
    var NAME_ID = 'cip-customer-name';
    var EMAIL_ID = 'cip-customer-email';
    var MARK_ID = 'pcm-customer-id-reminder';
    var STYLE_ID = 'pcm-customer-id-reminder-style';
    var PER_PAGE = 500;
    var SHARED_KEY = 'pcmCustomerTicketLists';
    var SCAN_DELAY_MS = 300;

    D.ensureStyleTag(STYLE_ID, [
        '#' + MARK_ID + ' {',
        '    margin-left: 6px;',
        '    color: ' + MARK_COLOUR + ';',
        '    font-size: 60%;',
        '    font-weight: 700;',
        '    white-space: nowrap;',
        '    vertical-align: middle;',
        '    cursor: help;',
        '}'
    ].join('\n'));

    // READING THE PAGE
    function ciWidget() {
        return document.getElementById(CI_ID);
    }

    function hasOrganisations(ci) {
        return !!ci.querySelector('a[href="#organisations"]');
    }

    // The Customer Tickets toggle is the sign Customer Intelligence has
    // finished drawing; without it, it is too early to say "missing".
    function ciReady(ci) {
        return !!ci.querySelector('a[href="#related-tickets"]');
    }

    var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

    function customerEmail(ci) {
        var span = ci.querySelector('#' + EMAIL_ID);
        var match = span && span.textContent.match(EMAIL_RE);
        return match ? match[0] : '';
    }

    // COUNTING TICKETS
    // One request per customer per page view, kept on the page as the
    // answer's text so PCM Customer Ticket Count and PCM Customer Top List
    // reuse it (same key, same request). The text is only read: the
    // different ticket numbers in it are counted.
    function ticketList(email) {
        var shared = window[SHARED_KEY] = window[SHARED_KEY] || {};
        if (shared[email]) return shared[email];
        var url = '/customers/tickets_table?search%5Bcustomer_email%5D=' + encodeURIComponent(email) +
            '&per_page=' + PER_PAGE + '&page=1';
        shared[email] = fetch(url, {
            credentials: 'same-origin',
            headers: { 'Accept': 'text/javascript', 'X-Requested-With': 'XMLHttpRequest' }
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
        }).catch(function () {
            delete shared[email];
            return '';
        });
        return shared[email];
    }

    function countTickets(email) {
        return ticketList(email).then(function (text) {
            if (!text) return -1;
            var seen = {};
            var re = /data-ticket-ref=\\?["'](\d+)/g;
            var match;
            while ((match = re.exec(text))) seen[match[1]] = true;
            return Object.keys(seen).length;
        });
    }

    // THE MARKER
    // Last in the name heading, after PCM's name link. Written only when
    // missing, misplaced or its tooltip changes.
    function showMark(ci, count) {
        var name = ci.querySelector('#' + NAME_ID);
        if (!name) return;
        var mark = document.getElementById(MARK_ID);
        if (!mark) {
            mark = document.createElement('span');
            mark.id = MARK_ID;
            mark.textContent = MARK_TEXT;
        }
        if (mark.parentElement !== name || mark !== name.lastElementChild) name.appendChild(mark);
        var shown = count >= PER_PAGE ? PER_PAGE + '+' : String(count);
        var title = 'This customer has ' + shown + ' tickets: add the customer ID to their profile.';
        if (mark.title !== title) mark.title = title;
    }

    function removeMark() {
        var mark = document.getElementById(MARK_ID);
        if (mark) mark.remove();
    }

    var checking = '';

    function check() {
        var ci = ciWidget();
        if (!ci || !ciReady(ci)) return;
        if (hasOrganisations(ci)) {
            removeMark();
            return;
        }
        var email = customerEmail(ci);
        if (!email || checking === email) return;
        checking = email;
        countTickets(email).then(function (count) {
            checking = '';
            var now = ciWidget();
            if (count < 0 || !now || hasOrganisations(now) || customerEmail(now) !== email) return;
            if (count >= MIN_TICKETS) showMark(now, count);
            else removeMark();
        });
    }

    var gate = D.createVisibilityGate(check, SCAN_DELAY_MS);

    // BOOT
    // Customer Intelligence is drawn after the page and redrawn when the
    // ticket's customer or organisation changes; only additions are looked
    // at, and check() is a few reads when the answer is already known.
    function start() {
        check();
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
