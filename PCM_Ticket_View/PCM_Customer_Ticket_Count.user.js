// @file_name = PCM_Customer_Ticket_Count.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-11-02
// @created = 2026-11-02 11:51
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). The customer's email is read from the page at runtime (only to ask PCM for the ticket list), never written here.

// ==UserScript==
// @name         PCM Customer Ticket Count
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-11-02
// @description  Shows how many tickets the customer has in the Customer Tickets heading of Customer Intelligence, as a bold coloured "(110)", without opening the section. The number comes from the same list PCM loads when you open Customer Tickets, fetched once per customer in the background with room for 500 tickets and only read, never run (500 or more shows as "500+"). The request is shared with PCM Customer ID Reminder, so the two scripts never ask twice. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Customer_Ticket_Count.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Customer_Ticket_Count.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    var COUNT_COLOUR = '#1e5bd8';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.createVisibilityGate || !D.installNavigationHooks || !D.ensureStyleTag) {
        console.error('[PCM Customer Ticket Count] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    // From the ticket page: Customer Intelligence is #wid-customer-intelligence,
    // its Customer Tickets heading is the toggle a[href="#related-tickets"] and
    // the customer's email is span#cip-customer-email. The list is loaded from
    // /customers/tickets_table by email, answered as JavaScript with one row
    // per ticket carrying data-ticket-ref="<number>"; PCM honours per_page, and
    // the answer holds no total, so the rows are counted.
    var CI_ID = 'wid-customer-intelligence';
    var EMAIL_ID = 'cip-customer-email';
    var TOGGLE = 'a[href="#related-tickets"]';
    var COUNT_ID = 'pcm-customer-ticket-count';
    var STYLE_ID = 'pcm-customer-ticket-count-style';
    var PER_PAGE = 500;
    var SHARED_KEY = 'pcmCustomerTicketCounts';
    var SCAN_DELAY_MS = 300;
    var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

    D.ensureStyleTag(STYLE_ID, [
        '#' + COUNT_ID + ' {',
        '    margin-left: 4px;',
        '    color: ' + COUNT_COLOUR + ';',
        '    font-weight: 700;',
        '}'
    ].join('\n'));

    function customerEmail(ci) {
        var span = ci.querySelector('#' + EMAIL_ID);
        var match = span && span.textContent.match(EMAIL_RE);
        return match ? match[0] : '';
    }

    // COUNTING TICKETS
    // One request per customer per page view, kept on the page so PCM
    // Customer ID Reminder reuses it (same key, same request).
    function countTickets(email) {
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
        }).then(function (text) {
            var seen = {};
            var re = /data-ticket-ref=\\?["'](\d+)/g;
            var match;
            while ((match = re.exec(text))) seen[match[1]] = true;
            return Object.keys(seen).length;
        }, function () {
            delete shared[email];
            return -1;
        });
        return shared[email];
    }

    // THE NUMBER
    // Right after the "Customer Tickets" text inside PCM's toggle, so it sits
    // in the heading and the arrow stays where it is. Written only when
    // missing, misplaced or changed.
    function headingText(toggle) {
        var walker = document.createTreeWalker(toggle, NodeFilter.SHOW_TEXT);
        var node;
        while ((node = walker.nextNode())) {
            if (/customer tickets/i.test(node.nodeValue)) return node;
        }
        return null;
    }

    function showCount(toggle, count) {
        var text = '(' + (count >= PER_PAGE ? PER_PAGE + '+' : count) + ')';
        var span = document.getElementById(COUNT_ID);
        if (!span) {
            span = document.createElement('span');
            span.id = COUNT_ID;
        }
        var anchor = headingText(toggle);
        if (anchor) {
            if (span.previousSibling !== anchor) anchor.parentNode.insertBefore(span, anchor.nextSibling);
        } else if (span.parentElement !== toggle) {
            toggle.appendChild(span);
        }
        if (span.textContent !== text) span.textContent = text;
    }

    var shownFor = '';
    var checking = '';

    function check() {
        var ci = document.getElementById(CI_ID);
        var toggle = ci && ci.querySelector(TOGGLE);
        if (!toggle) return;
        var email = customerEmail(ci);
        if (!email || checking === email) return;
        var span = document.getElementById(COUNT_ID);
        if (shownFor === email && span && toggle.contains(span)) return;
        checking = email;
        countTickets(email).then(function (count) {
            checking = '';
            var nowCi = document.getElementById(CI_ID);
            var nowToggle = nowCi && nowCi.querySelector(TOGGLE);
            if (count < 0 || !nowToggle || customerEmail(nowCi) !== email) return;
            shownFor = email;
            showCount(nowToggle, count);
        });
    }

    var gate = D.createVisibilityGate(check, SCAN_DELAY_MS);

    // BOOT
    // Customer Intelligence is drawn after the page and redrawn when the
    // ticket's customer changes; only additions are looked at, and check()
    // is a few reads once the number is in place.
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
