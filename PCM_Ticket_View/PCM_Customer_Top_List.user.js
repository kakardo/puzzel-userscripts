// @file_name = PCM_Customer_Top_List.user.js
// @author = Kardo Rostam
// @version = 2.0_2026-11-04
// @created = 2026-11-02 12:03
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). Customer names, emails, companies, account ids and ticket counts are read from the page at runtime and kept only in this browser's Tampermonkey storage, never written here.
// @note = run-at document-start on purpose: the button is added the moment Help is in the page. Tampermonkey can still start the script just after the first paint, so the button fades in instead of popping up.

// ==UserScript==
// @name         PCM Customer Top List
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.0_2026-11-04
// @description  Adds a "Top" button to PCM's top bar, right of Help and in the same style, placed as early as possible while the page loads and faded in, so it does not pop up. It opens two lists of the customers with the most tickets: the last 30 days (with that share of their all-time total in per cent) and all time, split into steps by ticket count (1000+, 500+, 200+, 100+, 50+, 20+, Under 20; SCALE at the top), each step under a heading in its own colour from red to blue. The lists are built as you work: when you open a ticket, the customer's ticket list (the same list PCM loads for Customer Tickets, shared with PCM Customer Ticket Count and PCM Customer ID Reminder, so no extra request when they are installed) is read once, and the customer's name, total and the ticket times of the last 30 days are saved in Tampermonkey's own storage in this browser (so clearing the browser cache or site data keeps them), one entry per customer by the profile id from the name link (customers without one, or with fewer than 5 tickets, are not saved); each name links to the profile, with the account id and company after it on the same line (from PCM Ticket Info Extractor or the ticket's Organisation, split from names like "123 Name", "Name 123", "123 - Name" or "Name (123)"). Customers with 500 tickets or more show the full total that PCM Customer Ticket Count counts once a week, when it has one. So the lists show the customers you have opened, not everyone. No polling: the button does nothing until pressed, and the ticket page is watched by one scoped MutationObserver behind the shared visibility gate.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/*
// @run-at       document-start
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Customer_Top_List.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Customer_Top_List.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    var TOP = 50;
    var RECENT_DAYS = 30;
    // Customers with fewer tickets than this (all time) are not saved.
    var MIN_TICKETS = 5;
    // The lists are split into steps by ticket count, highest first; each
    // step with customers gets a heading ("500+"), the rest "Under 20".
    var SCALE = [1000, 500, 200, 100, 50, 20];
    // Heading colours per step, hot to cool; BAND_COLOURS[0] is "Under".
    var BAND_COLOURS = { 1000: '#d32f2f', 500: '#ef6c00', 200: '#f9a825', 100: '#2e7d32', 50: '#00838f', 20: '#1e5bd8', 0: '#78808f' };
    var BUTTON_TEXT = 'Top';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.createVisibilityGate || !D.installNavigationHooks ||
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
    var BIG_KEY = 'pcmCustomerBigCounts';
    var CI_ID = 'wid-customer-intelligence';
    var NAME_ID = 'cip-customer-name';
    var EMAIL_ID = 'cip-customer-email';
    var PER_PAGE = 500;
    var MAX_CUSTOMERS = 3000;
    var SCAN_DELAY_MS = 400;
    var DAY_MS = 86400000;
    var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    var TICKET_PAGE_RE = /^\/tickets\/\d+/;

    // At document-start there may be no <head> yet (the shared
    // ensureStyleTag needs one), so the style goes to <html> if needed.
    function addStyle(id, css) {
        if (document.getElementById(id)) return;
        var style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    addStyle(STYLE_ID, [
        '#' + BUTTON_ID + ' svg { fill: currentColor; }',
        '@keyframes pcm-top-customers-in { from { opacity: 0; } to { opacity: 1; } }',
        '#' + BUTTON_ID + ' { animation: pcm-top-customers-in .2s ease-out; }',
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
        // Step headings: a tinted strip with a coloured left edge and bold
        // text in the step's colour (the colour comes inline per step).
        '#' + PANEL_ID + ' tr.pcm-tl-band td {',
        '    padding: 5px 10px !important; border-left: 5px solid var(--pz-band);',
        '    background: color-mix(in srgb, var(--pz-band) 14%, #fff) !important;',
        '    color: var(--pz-band); font-size: 12px; font-weight: 800; letter-spacing: .5px;',
        '}',
        '#' + PANEL_ID + ' tr.pcm-tl-band + tr td { padding-top: 5px; }',
        '#' + PANEL_ID + ' tr:not(:first-child).pcm-tl-band td { border-top: 6px solid #fff; }',
        '#' + PANEL_ID + ' td.pcm-tl-name { width: 100%; max-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
        '#' + PANEL_ID + ' .pcm-tl-org { margin-left: 6px; color: #8a8f99; font-size: 11px; }',
        '#' + PANEL_ID + ' td.pcm-tl-share { width: 1%; padding-left: 0; text-align: right; color: #888; font-size: 11px; white-space: nowrap; }',
        '#' + PANEL_ID + ' .pcm-tl-empty { padding: 16px 10px; color: #777; }',
        '#' + PANEL_ID + ' .pcm-tl-foot {',
        '    padding: 6px 10px; border-top: 1px solid #ddd;',
        '    color: #777; font-size: 11px;',
        '}'
    ].join('\n'));

    // STORAGE
    // { customers: { profile id: { n: name, e: email, c: company, a: account id,
    //                              t: total, r: [ticket times, last 30 days], s: saved } } }
    // The email (lower case) links an entry to the full count PCM Customer
    // Ticket Count keeps for customers with 500 tickets or more.
    // Only customers with a profile id are kept, so one customer is always
    // one entry; anything else (entries without an id) is dropped on load.
    //
    // Kept in Tampermonkey's own storage (GM_getValue/GM_setValue), which
    // belongs to the extension: clearing the browser cache or the site's
    // data does not touch it. The list used to live in the page's
    // localStorage; what is still there is moved over once.
    function readStore() {
        var data = null;
        try { data = GM_getValue(STORE_KEY, null); } catch (_) { data = null; }
        if (data && data.customers) return data;
        var old = D.readJson(STORE_KEY, null);
        if (old && old.customers) {
            writeStore(old);
            try { window.localStorage.removeItem(STORE_KEY); } catch (_) { /* ignore */ }
            return old;
        }
        return null;
    }

    function writeStore(data) {
        try {
            GM_setValue(STORE_KEY, data);
        } catch (err) {
            console.warn('[PCM Customer Top List] could not save the list', err);
        }
    }

    function load() {
        var data = readStore();
        var customers = {};
        if (data && data.customers) {
            Object.keys(data.customers).forEach(function (key) {
                var c = data.customers[key];
                if (/^\d+$/.test(key) && c && (c.t || 0) >= MIN_TICKETS) customers[key] = c;
            });
        }
        return { customers: customers };
    }

    function save(id, name, email, org, total, times) {
        var data = load();
        var now = Date.now();
        var since = now - RECENT_DAYS * DAY_MS;
        if (total < MIN_TICKETS) {
            if (data.customers[id]) {
                delete data.customers[id];
                writeStore(data);
            }
            return;
        }
        // A ticket without a company keeps the one saved before.
        var before = data.customers[id] || {};
        data.customers[id] = {
            n: name,
            e: email,
            c: org.company || before.c || '',
            a: org.account || before.a || '',
            t: total,
            r: times.filter(function (ts) { return ts >= since; }),
            s: now
        };
        var keys = Object.keys(data.customers);
        if (keys.length > MAX_CUSTOMERS) {
            keys.sort(function (a, b) { return data.customers[a].s - data.customers[b].s; });
            keys.slice(0, keys.length - MAX_CUSTOMERS).forEach(function (key) { delete data.customers[key]; });
        }
        writeStore(data);
    }

    // READING THE TICKET LIST
    // One request per customer per page view, shared with PCM Customer
    // Ticket Count and PCM Customer ID Reminder (same key, same request).
    // The shared object lives on the page's own window (unsafeWindow: this
    // script has grants, so its own window is Tampermonkey's sandbox).
    var PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    function ticketList(email) {
        var shared = PAGE[SHARED_KEY] = PAGE[SHARED_KEY] || {};
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

    // COMPANY AND ACCOUNT ID
    // Organisation names come as "123 NAME", "123 - Name", "Name 123" or
    // "Name (123)"; the number (3 digits or more) is the account id and the
    // rest the company. Without a number the whole text is the company.
    var ORG_PATTERNS = [
        /^\s*\(?(\d{3,})\)?(?:\s*[-\u2013\u2014:|,.]\s*|\s+)(.*\S)\s*$/,   // 123 Name, 123 - Name, (123) Name
        /^\s*(.*?\S)\s*\((\d{3,})\)\s*$/,                            // Name (123)
        /^\s*(.*?\S)(?:\s*[-\u2013\u2014:|,]\s*|\s+)(\d{3,})\s*$/           // Name 123, Name - 123
    ];

    function splitOrganisation(text) {
        var value = D.cleanText ? D.cleanText(text || '') : String(text || '').trim();
        if (!value) return { company: '', account: '' };
        var m = value.match(ORG_PATTERNS[0]);
        if (m) return { company: m[2], account: m[1] };
        m = value.match(ORG_PATTERNS[1]) || value.match(ORG_PATTERNS[2]);
        if (m) return { company: m[1], account: m[2] };
        return { company: value, account: '' };
    }

    // The ticket's company and account id: from PCM Ticket Info Extractor
    // when it is installed (its company name is split too, in case it
    // carries the number), otherwise from the Organisation field in
    // Attributes.
    function ticketOrganisation() {
        var info = PAGE.PCM_TICKET_INFO || {};
        var root = document.getElementById('pcm-ticket-info');
        var company = info.companyName || (root && root.dataset.companyName) || '';
        var account = info.customerId || (root && root.dataset.customerId) || '';
        if (!company) {
            var form = document.getElementById('ticket-attributes-form') || document.querySelector('form.edit_ticket');
            var label = form && Array.prototype.find.call(form.querySelectorAll('label'), function (el) {
                return /^\s*organisation:?\s*$/i.test(el.textContent || '');
            });
            var section = label && (label.closest('section, .form-group, [class*="col"]') || label.parentElement);
            var select = section && section.querySelector('select');
            var option = select && select.options[select.selectedIndex];
            company = option ? option.textContent : '';
        }
        var parts = splitOrganisation(company);
        return {
            company: parts.company,
            account: String(account || parts.account || '').trim()
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
            save(id, name || 'Customer ' + id, email.toLowerCase(), ticketOrganisation(), result.total, result.times);
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
        var big = D.readJson(BIG_KEY, {}) || {};
        var since = Date.now() - RECENT_DAYS * DAY_MS;
        var all = Object.keys(customers).map(function (id) {
            var c = customers[id];
            var full = c.e && big[c.e];
            var useFull = !!(full && full.n > (c.t || 0));
            return {
                id: id,
                name: c.n || 'Customer ' + id,
                company: c.c || '',
                account: c.a || '',
                total: useFull ? full.n : (c.t || 0),
                capped: useFull ? !!full.c : (c.t || 0) >= PER_PAGE,
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

    // The highest step the count reaches, or 0 below the lowest step.
    function bandFor(count) {
        for (var i = 0; i < SCALE.length; i += 1) {
            if (count >= SCALE[i]) return SCALE[i];
        }
        return 0;
    }

    function rowsHtml(items, key) {
        if (!items.length) {
            return '<div class="pcm-tl-empty">No customers yet. The list fills as you open tickets.</div>';
        }
        var columns = key === 'recent' ? 4 : 3;
        var band = null;
        return '<table>' + items.map(function (c, i) {
            // A heading row each time the count drops into the next step.
            var step = bandFor(c[key]);
            var heading = '';
            if (step !== band) {
                band = step;
                heading = '<tr class="pcm-tl-band" style="--pz-band:' + (BAND_COLOURS[step] || BAND_COLOURS[0]) + '">' +
                    '<td colspan="' + columns + '">' +
                    (step ? Number(step).toLocaleString('en-GB') + '+' : 'Under ' + SCALE[SCALE.length - 1]) +
                    '</td></tr>';
            }
            var count = Number(c[key]).toLocaleString('en-GB') + (key === 'total' && c.capped ? '+' : '');
            var name = '<a href="/customers/' + c.id + '/edit" target="_blank" title="Open the customer\'s profile">' +
                D.escapeHtml(c.name) + '</a>';
            // Account id and company on the same line, after the name, in
            // grey; a long line is cut with an ellipsis (full text in the
            // tooltip), so no row gets taller.
            var orgText = [c.account, c.company].filter(Boolean).join(' ');
            if (orgText) name += '<span class="pcm-tl-org">' + D.escapeHtml(orgText) + '</span>';
            var cellTitle = D.escapeHtml(c.name + (orgText ? ', ' + orgText : ''));
            // Last 30 days: the share of the customer's all-time total.
            var share = '';
            if (key === 'recent' && c.total > 0) {
                var percent = c.recent / c.total * 100;
                var shown = percent >= 1 ? Math.round(percent) + '%' : '<1%';
                share = '<td class="pcm-tl-share" title="Share of all ' + Number(c.total).toLocaleString('en-GB') +
                    (c.capped ? '+' : '') + ' tickets">' + shown + '</td>';
            }
            return heading + '<tr><td class="pcm-tl-rank">' + (i + 1) + '</td><td class="pcm-tl-name" title="' + cellTitle + '">' + name +
                '</td><td class="pcm-tl-count">' + count + '</td>' + share + '</tr>';
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
            ' with ' + MIN_TICKETS + ' or more tickets you have opened in this browser</span></div>';
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

    // The icon copies the size of Help's icon. While the page loads PCM's
    // stylesheet may not be applied yet, so it is synced again when the
    // page is ready and loaded; it only writes when a value differs.
    var ICON_PROPS = ['display', 'width', 'height', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'verticalAlign'];

    function syncIcon() {
        var help = document.querySelector(HELP);
        var icon = help && help.querySelector('a > i');
        var svg = document.querySelector('#' + BUTTON_ID + ' svg');
        if (!svg) return;
        var wanted = {};
        if (icon) {
            var css = window.getComputedStyle(icon);
            ICON_PROPS.forEach(function (prop) { wanted[prop] = css[prop]; });
            if (wanted.display === 'inline') wanted.display = 'inline-block';
        }
        if (!parseFloat(wanted.width)) {
            wanted.width = '24px';
            wanted.height = '24px';
        }
        Object.keys(wanted).forEach(function (prop) {
            if (svg.style[prop] !== wanted[prop]) svg.style[prop] = wanted[prop];
        });
    }

    // Placed as soon as Help and its icon are in the page.
    function ensureButton() {
        if (document.getElementById(BUTTON_ID)) return true;
        var help = document.querySelector(HELP);
        if (!help || !help.parentNode || !help.querySelector('a > i')) return false;
        var li = document.createElement('li');
        li.className = help.className;
        li.id = BUTTON_ID;
        var link = document.createElement('a');
        link.href = '#';
        link.title = 'Customers with the most tickets (from the customers you have opened)';
        link.innerHTML = TROPHY + ' <span class="menu-item-parent">' + D.escapeHtml(BUTTON_TEXT) + '</span>';
        link.addEventListener('click', function (event) {
            event.preventDefault();
            if (document.getElementById(PANEL_ID)) closePanel();
            else openPanel(li);
        });
        li.appendChild(link);
        help.parentNode.insertBefore(li, help.nextSibling);
        syncIcon();
        return true;
    }

    // BOOT
    // While the page is being parsed, every batch of new nodes is checked
    // for Help (one id lookup); the watcher stops once the button is in or
    // the page is parsed, whichever comes first.
    if (!ensureButton()) {
        var early = new MutationObserver(function () {
            if (ensureButton()) early.disconnect();
        });
        early.observe(document.documentElement, { childList: true, subtree: true });
        document.addEventListener('DOMContentLoaded', function () {
            early.disconnect();
            ensureButton();
        }, { once: true });
    }

    function whenReady(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
        else fn();
    }

    whenReady(function () {
        syncIcon();
        collect();
    });
    window.addEventListener('load', syncIcon, { once: true });

    D.installNavigationHooks(function () {
        ensureButton();
        gate.schedule();
    });
})();
