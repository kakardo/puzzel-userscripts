// @file_name = PCM_Customer_Ticket_Count.user.js
// @author = Kardo Rostam
// @version = 1.2_2026-11-02
// @created = 2026-11-02 11:51
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). The customer's email is read from the page at runtime (only to ask PCM for the ticket list), never written here.

// ==UserScript==
// @name         PCM Customer Ticket Count
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.2_2026-11-02
// @description  Shows how many tickets the customer has in the Customer Tickets heading of Customer Intelligence, as a bold coloured "(110)", without opening the section. The number comes from the same list PCM loads when you open Customer Tickets, fetched once per customer in the background with room for 500 tickets and only read, never run. The request is shared with PCM Customer ID Reminder and PCM Customer Top List, so they never ask twice. Customers with 500 or more tickets are counted in full in the background (5,000 per request, at most 20,000), once a week: the total is kept in this browser for 7 days, the tooltip says when it was counted, and a click on the number counts again now. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
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
    var SHARED_KEY = 'pcmCustomerTicketLists';
    // Customers with PER_PAGE tickets or more are counted in full: pages of
    // BIG_PAGE tickets (PCM answers up to 5000 per request, about 1.9 MB and
    // 7 seconds), at most BIG_MAX_PAGES, one after another. The total is
    // kept in this browser for a week (shared with PCM Customer Top List).
    var BIG_KEY = 'pcmCustomerBigCounts';
    var BIG_PAGE = 5000;
    var BIG_MAX_PAGES = 4;
    var BIG_MAX_AGE_MS = 7 * 86400000;
    var SCAN_DELAY_MS = 300;
    var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

    D.ensureStyleTag(STYLE_ID, [
        '#' + COUNT_ID + ' {',
        '    margin-left: 4px;',
        '    color: ' + COUNT_COLOUR + ';',
        '    font-weight: 700;',
        '}',
        '#' + COUNT_ID + '[data-big] {',
        '    cursor: pointer;',
        '}',
        '#' + COUNT_ID + '[data-big]:hover {',
        '    text-decoration: underline;',
        '}'
    ].join('\n'));

    function customerEmail(ci) {
        var span = ci.querySelector('#' + EMAIL_ID);
        var match = span && span.textContent.match(EMAIL_RE);
        return match ? match[0] : '';
    }

    // COUNTING TICKETS
    // One request per customer per page view, kept on the page as the
    // answer's text so PCM Customer ID Reminder and PCM Customer Top List
    // reuse it (same key, same request); each reads what it needs.
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

    function collectRefs(text, seen) {
        var re = /data-ticket-ref=\\?["'](\d+)/g;
        var match;
        var found = 0;
        while ((match = re.exec(text))) {
            if (!seen[match[1]]) {
                seen[match[1]] = true;
                found += 1;
            }
        }
        return found;
    }

    function countTickets(email) {
        return ticketList(email).then(function (text) {
            return text ? collectRefs(text, {}) : -1;
        });
    }

    // FULL COUNT (500 or more)
    function readBig(email) {
        var all = D.readJson(BIG_KEY, {}) || {};
        return all[email.toLowerCase()] || null;
    }

    function writeBig(email, entry) {
        var all = D.readJson(BIG_KEY, {}) || {};
        var now = Date.now();
        Object.keys(all).forEach(function (key) {
            if (!all[key] || now - all[key].at > 4 * BIG_MAX_AGE_MS) delete all[key];
        });
        all[email.toLowerCase()] = entry;
        D.writeJson(BIG_KEY, all);
    }

    var fullRuns = {};

    // Pages are fetched one after another until one comes back short or
    // BIG_MAX_PAGES is reached; resolves to { n, c (capped), at } or null.
    function fullCount(email) {
        if (fullRuns[email]) return fullRuns[email];
        var seen = {};
        var total = 0;
        function page(number) {
            var url = '/customers/tickets_table?search%5Bcustomer_email%5D=' + encodeURIComponent(email) +
                '&per_page=' + BIG_PAGE + '&page=' + number;
            return fetch(url, {
                credentials: 'same-origin',
                headers: { 'Accept': 'text/javascript', 'X-Requested-With': 'XMLHttpRequest' }
            }).then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            }).then(function (text) {
                var found = collectRefs(text, seen);
                total += found;
                if (found < BIG_PAGE) return { n: total, c: false, at: Date.now() };
                if (number >= BIG_MAX_PAGES) return { n: total, c: true, at: Date.now() };
                return page(number + 1);
            });
        }
        fullRuns[email] = page(1).then(function (entry) {
            writeBig(email, entry);
            delete fullRuns[email];
            return entry;
        }, function () {
            delete fullRuns[email];
            return null;
        });
        return fullRuns[email];
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

    function format(n) {
        return Number(n).toLocaleString('en-GB');
    }

    function ago(at) {
        var days = Math.floor((Date.now() - at) / 86400000);
        if (days <= 0) return 'today';
        return days === 1 ? 'yesterday' : days + ' days ago';
    }

    // big: null for a normal count; otherwise { email, entry, failed } where
    // entry is the full count ({ n, c, at }), or null while it is running
    // or when it failed with nothing saved.
    function showCount(toggle, count, big) {
        var text;
        var title = '';
        if (!big) {
            text = '(' + format(count) + ')';
        } else if (!big.entry && big.failed) {
            text = '(' + format(PER_PAGE) + '+)';
            title = 'Could not count all tickets. Click to try again.';
        } else if (!big.entry) {
            text = '(' + format(PER_PAGE) + '+…)';
            title = 'Counting all tickets…';
        } else {
            text = '(' + format(big.entry.n) + (big.entry.c ? '+' : '') + ')';
            title = 'Counted ' + ago(big.entry.at) + ' (counted again once a week). Click to count again now.';
        }
        var span = document.getElementById(COUNT_ID);
        if (!span) {
            span = document.createElement('span');
            span.id = COUNT_ID;
            span.addEventListener('click', onCountClick);
        }
        var anchor = headingText(toggle);
        if (anchor) {
            if (span.previousSibling !== anchor) anchor.parentNode.insertBefore(span, anchor.nextSibling);
        } else if (span.parentElement !== toggle) {
            toggle.appendChild(span);
        }
        if (span.textContent !== text) span.textContent = text;
        if (span.title !== title) span.title = title;
        if (big) {
            if (span.dataset.big !== big.email) span.dataset.big = big.email;
        } else if (span.hasAttribute('data-big')) {
            span.removeAttribute('data-big');
        }
    }

    function currentToggle(email) {
        var ci = document.getElementById(CI_ID);
        var toggle = ci && ci.querySelector(TOGGLE);
        return toggle && customerEmail(ci) === email ? toggle : null;
    }

    function runFull(email) {
        var toggle = currentToggle(email);
        if (toggle) showCount(toggle, 0, { email: email, entry: null });
        fullCount(email).then(function (entry) {
            var now = currentToggle(email);
            if (!now) return;
            showCount(now, 0, { email: email, entry: entry || readBig(email), failed: !entry });
        });
    }

    // A click on a full count counts again now. The number sits inside
    // PCM's toggle, so the click must not open or close the section.
    function onCountClick(event) {
        var email = this.dataset.big;
        if (!email) return;
        event.preventDefault();
        event.stopPropagation();
        if (!fullRuns[email]) runFull(email);
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
            var nowToggle = currentToggle(email);
            if (count < 0 || !nowToggle) return;
            shownFor = email;
            if (count < PER_PAGE) {
                showCount(nowToggle, count, null);
                return;
            }
            var saved = readBig(email);
            if (fullRuns[email]) showCount(nowToggle, 0, { email: email, entry: null });
            else if (saved && Date.now() - saved.at < BIG_MAX_AGE_MS) showCount(nowToggle, 0, { email: email, entry: saved });
            else runFull(email);
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
