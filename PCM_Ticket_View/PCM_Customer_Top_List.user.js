// @file_name = PCM_Customer_Top_List.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-11-02
// @created = 2026-11-02 12:03
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). Customer names, emails and ticket counts are read from the page at runtime and kept only in this browser's localStorage, never written here.

// ==UserScript==
// @name         PCM Customer Top List
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-11-02
// @description  Adds a "Top 50" button to PCM's top bar, right of Help and in the same style, that opens two lists of the customers with the most tickets: the last 30 days and all time. The lists are built as you work: when you open a ticket, the customer's ticket list (the same list PCM loads for Customer Tickets, shared with PCM Customer Ticket Count and PCM Customer ID Reminder, so no extra request when they are installed) is read once, and the customer's name, total and the ticket times of the last 30 days are saved in this browser only, one entry per customer by the profile id from the name link (customers without one are not saved); each name links to the profile. So the lists show the customers you have opened, not everyone. No polling: the button does nothing until pressed, and the ticket page is watched by one scoped MutationObserver behind the shared visibility gate.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Customer_Top_List.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Customer_Top_List.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    var TOP = 50;
    var RECENT_DAYS = 30;
    var BUTTON_TEXT = 'Top 50';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.createVisibilityGate || !D.installNavigationHooks || !D.ensureStyleTag ||
        !D.readJson || !D.writeJson || !D.escapeHtml) {
        console.error('[PCM Customer Top List] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    // From PCM: the top bar items are li.navbar-link in one ul, Help is
    // li#menu-help (an <a> with an icon <i> and span.menu-item-parent).
    // On a ticket, Customer Intelligence is #wid-customer-intelligence with
    // the name in h1#cip-customer-name and the email in span#cip-customer-email.
    // The ticket list from /customers/tickets_table is JavaScript with one row
    // per ticket: data-ticket-ref="<number>" and a relative time ("2 hours ago").
    var HELP = 'li#menu-help';
    var BUTTON_ID = 'pcm-top-customers';
    var PANEL_ID = 'pcm-top-customers-panel';
    var STYLE_ID = 'pcm-top-customers-style';
    var STORE_KEY = 'pcmCustomerTopList';
    var SHARED_KEY = 'pcmCustomerTicketLists';
    var CI_ID = 'wid-customer-intelligence';
    var NAME_ID = 'cip-customer-name';
    var EMAIL_ID = 'cip-customer-email';
    var PER_PAGE = 500;
    var MAX_CUSTOMERS = 3000;
    var SCAN_DELAY_MS = 400;
    var DAY_MS = 86400000;
    var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    var TICKET_PAGE_RE = /^\/tickets\/\d+/;

    D.ensureStyleTag(STYLE_ID, [
        '#' + BUTTON_ID + ' svg { fill: currentColor; }',
        '#' + PANEL_ID + ' {',
        '    position: fixed;',
        '    z-index: 2000;',
        '    width: 380px;',
        '    max-width: calc(100vw - 16px);',
        '    max-height: 70vh;',
        '    display: flex;',
        '    flex-direction: column;',
        '    background: #fff;',
        '    color: #333;',
        '    border-radius: 4px;',
        '    box-shadow: 0 6px 24px rgba(0,0,0,0.25);',
        '    font-size: 13px;',
        '}',
        '#' + PANEL_ID + ' .pcm-tl-tabs { display: flex; border-bottom: 1px solid #ddd; }',
        '#' + PANEL_ID + ' .pcm-tl-tabs button {',
        '    flex: 1; padding: 8px; border: 0; background: none;',
        '    font-weight: 700; color: #777; cursor: pointer;',
        '    border-bottom: 3px solid transparent;',
        '}',
        '#' + PANEL_ID + ' .pcm-tl-tabs button.pcm-tl-on { color: #1e5bd8; border-bottom-color: #1e5bd8; }',
        '#' + PANEL_ID + ' .pcm-tl-body { overflow-y: auto; padding: 4px 0; }',
        '#' + PANEL_ID + ' table { width: 100%; border-collapse: collapse; }',
        '#' + PANEL_ID + ' td { padding: 3px 10px; vertical-align: top; }',
        '#' + PANEL_ID + ' tr:nth-child(even) td { background: #f5f7fa; }',
        '#' + PANEL_ID + ' td.pcm-tl-rank { width: 1%; color: #999; text-align: right; }',
        '#' + PANEL_ID + ' td.pcm-tl-count { width: 1%; text-align: right; font-weight: 700; color: #1e5bd8; }',
        '#' + PANEL_ID + ' .pcm-tl-empty { padding: 16px 10px; color: #777; }',
        '#' + PANEL_ID + ' .pcm-tl-foot {',
        '    padding: 6px 10px; border-top: 1px solid #ddd;',
        '    color: #777; font-size: 11px;',
        '}'
    ].join('\n'));

    // STORAGE
    // { customers: { profile id: { n: name, t: total, r: [ticket times, last 30 days], s: saved } } }
    // Only customers with a profile id are kept, so one customer is always
    // one entry; anything else (entries without an id) is dropped on load.
    function load() {
        var data = D.readJson(STORE_KEY, null);
        var customers = {};
        if (data && data.customers) {
            Object.keys(data.customers).forEach(function (key) {
                if (/^\d+$/.test(key)) customers[key] = data.customers[key];
            });
        }
        return { customers: customers };
    }

    function save(id, name, total, times) {
        var data = load();
        var now = Date.now();
        var since = now - RECENT_DAYS * DAY_MS;
        data.customers[id] = {
            n: name,
            t: total,
            r: times.filter(function (ts) { return ts >= since; }),
            s: now
        };
        var keys = Object.keys(data.customers);
        if (keys.length > MAX_CUSTOMERS) {
            keys.sort(function (a, b) { return data.customers[a].s - data.customers[b].s; });
            keys.slice(0, keys.length - MAX_CUSTOMERS).forEach(function (key) { delete data.customers[key]; });
        }
        D.writeJson(STORE_KEY, data);
    }

    // READING THE TICKET LIST
    // One request per customer per page view, shared with PCM Customer
    // Ticket Count and PCM Customer ID Reminder (same key, same request).
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

    // "less than a minute ago", "2 hours ago", "about 1 month ago": the
    // number and unit give the ticket's age, which is turned into a time.
    var AGE_RE = /(less than a minute|half a minute|(\d+|an?)\s+(minute|hour|day|month|year)s?)\s+ago/i;
    var UNIT_MS = { minute: 60000, hour: 3600000, day: DAY_MS, month: 30 * DAY_MS, year: 365 * DAY_MS };

    function ageMs(match) {
        if (!match[3]) return 0;
        var amount = /^\d+$/.test(match[2]) ? parseInt(match[2], 10) : 1;
        return amount * UNIT_MS[match[3].toLowerCase()];
    }

    function readTickets(text) {
        var ages = {};
        var refs = [];
        var re = /data-ticket-ref=\\?["'](\d+)/g;
        var match;
        while ((match = re.exec(text))) refs.push({ ref: match[1], at: re.lastIndex });
        refs.forEach(function (item, i) {
            var end = i + 1 < refs.length ? refs[i + 1].at : text.length;
            var age = text.slice(item.at, end).match(AGE_RE);
            if (!(item.ref in ages)) ages[item.ref] = null;
            if (age && ages[item.ref] === null) ages[item.ref] = ageMs(age);
        });
        var now = Date.now();
        var keys = Object.keys(ages);
        return {
            total: keys.length,
            times: keys.filter(function (k) { return ages[k] !== null; })
                .map(function (k) { return now - ages[k]; })
        };
    }

    // COLLECTING ON A TICKET
    function customerName(ci) {
        var heading = ci.querySelector('#' + NAME_ID);
        if (!heading) return '';
        var link = heading.querySelector('a');
        return D.cleanText ? D.cleanText((link || heading).textContent) : (link || heading).textContent.trim();
    }

    // The name links to the customer's profile, /customers/<id>/edit; that
    // id is the customer's unique key. Without it, nothing is saved.
    function customerId(ci) {
        var link = ci.querySelector('#' + NAME_ID + ' a[href]');
        var match = link && (link.getAttribute('href') || '').match(/\/customers\/(\d+)/);
        return match ? match[1] : '';
    }

    function customerEmail(ci) {
        var span = ci.querySelector('#' + EMAIL_ID);
        var match = span && span.textContent.match(EMAIL_RE);
        return match ? match[0] : '';
    }

    var savedFor = '';
    var checking = '';
    var observer = null;

    function collect() {
        if (!TICKET_PAGE_RE.test(location.pathname)) return;
        watchTicket();
        var ci = document.getElementById(CI_ID);
        if (!ci) return;
        var email = customerEmail(ci);
        var name = customerName(ci);
        var id = customerId(ci);
        if (!id || !email || savedFor === id || checking === id) return;
        checking = id;
        // The request is made by email (the page's own spelling is the
        // shared request's key); the entry is saved under the profile id.
        ticketList(email).then(function (text) {
            checking = '';
            if (!text) return;
            var result = readTickets(text);
            save(id, name || 'Customer ' + id, result.total, result.times);
            savedFor = id;
        });
    }

    var gate = D.createVisibilityGate(collect, SCAN_DELAY_MS);

    function watchTicket() {
        if (observer) return;
        var root = document.getElementById('content') || document.body;
        observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i += 1) {
                if (mutations[i].addedNodes.length) {
                    gate.schedule();
                    return;
                }
            }
        });
        observer.observe(root, { childList: true, subtree: true });
    }

    // THE LISTS
    function lists() {
        var customers = load().customers;
        var since = Date.now() - RECENT_DAYS * DAY_MS;
        var all = Object.keys(customers).map(function (id) {
            var c = customers[id];
            return {
                id: id,
                name: c.n || 'Customer ' + id,
                total: c.t || 0,
                recent: (c.r || []).filter(function (ts) { return ts >= since; }).length
            };
        });
        function top(key) {
            return all.filter(function (c) { return c[key] > 0; })
                .sort(function (a, b) { return b[key] - a[key] || a.name.localeCompare(b.name); })
                .slice(0, TOP);
        }
        return { recent: top('recent'), total: top('total'), known: all.length };
    }

    function rowsHtml(items, key) {
        if (!items.length) {
            return '<div class="pcm-tl-empty">No customers yet. The list fills as you open tickets.</div>';
        }
        return '<table>' + items.map(function (c, i) {
            var count = key === 'total' && c.total >= PER_PAGE ? PER_PAGE + '+' : String(c[key]);
            var name = '<a href="/customers/' + c.id + '/edit" target="_blank" title="Open the customer\'s profile">' +
                D.escapeHtml(c.name) + '</a>';
            return '<tr><td class="pcm-tl-rank">' + (i + 1) + '</td><td>' + name +
                '</td><td class="pcm-tl-count">' + count + '</td></tr>';
        }).join('') + '</table>';
    }

    var tab = 'recent';

    function render(panel) {
        var data = lists();
        panel.innerHTML =
            '<div class="pcm-tl-tabs">' +
            '<button type="button" data-tab="recent"' + (tab === 'recent' ? ' class="pcm-tl-on"' : '') +
            '>Last ' + RECENT_DAYS + ' days</button>' +
            '<button type="button" data-tab="total"' + (tab === 'total' ? ' class="pcm-tl-on"' : '') +
            '>All time</button></div>' +
            '<div class="pcm-tl-body">' + rowsHtml(data[tab], tab) + '</div>' +
            '<div class="pcm-tl-foot"><span>From the ' + data.known + (data.known === 1 ? ' customer' : ' customers') +
            ' you have opened in this browser</span></div>';
    }

    function closePanel() {
        var panel = document.getElementById(PANEL_ID);
        if (panel) panel.remove();
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onKey, true);
    }

    function onOutside(event) {
        var panel = document.getElementById(PANEL_ID);
        var button = document.getElementById(BUTTON_ID);
        if (panel && !panel.contains(event.target) && !(button && button.contains(event.target))) closePanel();
    }

    function onKey(event) {
        if (event.key === 'Escape') closePanel();
    }

    function openPanel(button) {
        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        var box = button.getBoundingClientRect();
        panel.style.top = Math.round(box.bottom + 4) + 'px';
        panel.style.right = Math.max(8, Math.round(window.innerWidth - box.right)) + 'px';
        panel.addEventListener('click', function (event) {
            var target = event.target.closest('button');
            if (!target) return;
            if (target.dataset.tab) {
                tab = target.dataset.tab;
                render(panel);
            }
        });
        render(panel);
        document.body.appendChild(panel);
        document.addEventListener('mousedown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
    }

    // THE BUTTON
    // A copy of Help's structure (li.navbar-link > a > icon + span), so
    // PCM's own top bar style applies; the icon takes the size of Help's.
    var TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M18 2H6v2H2v3a5 5 0 0 0 4.6 5A6 6 0 0 0 11 15.9V19H7v3h10v-3h-4v-3.1A6 6 0 0 0 17.4 12 5 5 0 0 0 22 7V4h-4V2zM4 7V6h2v3.8A3 3 0 0 1 4 7zm16 0a3 3 0 0 1-2 2.8V6h2v1z"/></svg>';

    function ensureButton() {
        if (document.getElementById(BUTTON_ID)) return true;
        var help = document.querySelector(HELP);
        if (!help || !help.parentNode) return false;
        var li = document.createElement('li');
        li.className = help.className;
        li.id = BUTTON_ID;
        var link = document.createElement('a');
        link.href = '#';
        link.title = 'Customers with the most tickets (from the customers you have opened)';
        link.innerHTML = TROPHY + ' <span class="menu-item-parent">' + D.escapeHtml(BUTTON_TEXT) + '</span>';
        var icon = help.querySelector('a > i');
        var svg = link.querySelector('svg');
        if (icon) {
            var css = window.getComputedStyle(icon);
            ['display', 'width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'verticalAlign']
                .forEach(function (prop) { svg.style[prop] = css[prop]; });
            if (css.display === 'inline') svg.style.display = 'inline-block';
            if (!parseFloat(css.width)) svg.style.width = svg.style.height = '24px';
        } else {
            svg.style.width = svg.style.height = '24px';
        }
        link.addEventListener('click', function (event) {
            event.preventDefault();
            if (document.getElementById(PANEL_ID)) closePanel();
            else openPanel(li);
        });
        li.appendChild(link);
        help.parentNode.insertBefore(li, help.nextSibling);
        return true;
    }

    // BOOT
    D.installNavigationHooks(function () {
        ensureButton();
        gate.schedule();
    });
    D.bootUntil(function () { return !!document.querySelector(HELP); }, function () {
        ensureButton();
        collect();
    });
})();
