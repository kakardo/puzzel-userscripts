// @file_name = Help_Centre_Results_Per_Page.user.js
// @author = Kardo Rostam
// @version = 1.3_2026-11-19
// @created = 2026-11-19 10:02
// @note = run-at document-start on purpose: the Help Centre's settings are fetched while the page loads, and fetch has to be wrapped before that to change the number of search results per page.

// ==UserScript==
// @name         Help Centre Results Per Page
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.3_2026-11-19
// @description  Shows more search results per page in the Puzzel Help Centre knowledge base: 20 instead of 5, with a "Results per page" dropdown next to the result count (5, 10, 20 or 25). The Help Centre reads the number from its own settings file when the page loads; the script changes that number in the file as it arrives, so the knowledge base itself shows the chosen number, with its own paging. On the results page the empty space is taken out (under the search box, around the breadcrumb and above the results) and "Search Results", the result count and the dropdown sit on one line. When a search reaches the server's limit of 25 results, a short note beside the count says so: "max reached, more may exist, refine your search". The top of every Help Centre page is tightened too: a lower banner and less space around System Status and the ticket buttons. The choice is remembered in this browser; changing it reloads the results once. The knowledge base's server returns at most 25 results per search, so 25 is the highest choice. Event-driven: one fetch wrapper that only touches the settings file, and the dropdown is put back when the results are redrawn (one observer on the knowledge base area, only on the search results page).
// @author       Kardo Rostam
// @match        https://www.puzzel.com/help*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Help_Centre/Help_Centre_Results_Per_Page.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Help_Centre/Help_Centre_Results_Per_Page.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    var DEFAULT_PER_PAGE = 20;
    // The dropdown's choices. The server sends at most 25 results per
    // search, so a higher number would change nothing.
    var CHOICES = [5, 10, 20, 25];

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var STORE_KEY = 'kk-help-results-per-page';
    var SELECT_ID = 'kk-help-per-page';
    // The knowledge base's settings ("interactions") files on Puzzel's CDN.
    var SETTINGS_URL = /^https:\/\/app-cdn\.puzzel\.com\/public\/config\/.+\/interactions\/[^/]+\.json/;
    var LOG = '[Help Centre Results Per Page]';
    var SERVER_MAX = 25;
    var CAP_ID = 'kk-help-cap';
    var CAP_TEXT = 'max reached, more may exist, refine your search';
    // Tighter top of the page. These are the Help Centre page's own
    // building blocks (the banner, the status line, the ticket buttons and
    // the knowledge base's section); found by what they hold where
    // possible, so a renamed section simply keeps its normal spacing.
    var TOP_CSS = [
        'section.c-hero-with-image-and-content { padding-top: 24px !important; padding-bottom: 24px !important; }',
        'section.c-hero-with-image-and-content [class*="__image-container"] { margin-bottom: 0 !important; }',
        'section.c-hero-with-image-and-content [class*="__image-container"] img { max-height: 220px !important; width: auto !important; object-fit: contain; }',
        'section:has(.statusio-badge) { padding-top: 20px !important; padding-bottom: 0 !important; }',
        'section:has(.statusio-badge) .statusio-badge { margin-bottom: 8px !important; }',
        'section:has(.c-text-block__button-container) { padding-top: 8px !important; padding-bottom: 12px !important; }',
        'section:has(.knowledgebase) { padding-top: 8px !important; }'
    ].join('\n');

    function chosen() {
        var value = 0;
        try { value = parseInt(window.localStorage.getItem(STORE_KEY), 10); } catch (_) { value = 0; }
        return CHOICES.indexOf(value) !== -1 ? value : DEFAULT_PER_PAGE;
    }

    // Every "resultsPerPage" in the settings gets the chosen number;
    // true when there was one.
    function setPerPage(node, perPage) {
        var found = false;
        if (!node || typeof node !== 'object') return false;
        Object.keys(node).forEach(function (key) {
            if (key === 'resultsPerPage' && typeof node[key] === 'number') {
                node[key] = perPage;
                found = true;
            } else if (node[key] && typeof node[key] === 'object') {
                found = setPerPage(node[key], perPage) || found;
            }
        });
        return found;
    }

    // The top of the page is tightened from the start, before it is drawn.
    (function addTopStyle() {
        var style = document.createElement('style');
        style.id = 'kk-help-compact-top';
        style.textContent = TOP_CSS;
        (document.head || document.documentElement).appendChild(style);
    })();

    // THE SETTINGS FILE
    // Only that file is touched: its answer is read, the number changed and
    // a new answer with the same status and headers handed on. Anything
    // else, or a file that cannot be read, passes through as it came.
    var originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = function (input, init) {
            var url = '';
            try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) { url = ''; }
            var result = originalFetch.apply(this, arguments);
            if (!SETTINGS_URL.test(url)) return result;
            return result.then(function (response) {
                if (!response.ok) return response;
                return response.clone().json().then(function (data) {
                    if (!setPerPage(data, chosen())) return response;
                    return new Response(JSON.stringify(data), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }, function () { return response; });
            });
        };
    }

    // THE DROPDOWN
    // Next to "25 results" on the search results page. A new choice is
    // remembered and the page reloaded (back to page 1), since the
    // knowledge base only reads its settings while the page loads.
    function countElement() {
        var area = document.querySelector('.knowledgebase');
        if (!area) return null;
        var all = area.querySelectorAll('*');
        for (var i = 0; i < all.length; i += 1) {
            var el = all[i];
            if (el.children.length === 0 && /^\s*\d+\s+results?\s*$/i.test(el.textContent)) return el;
        }
        return null;
    }

    function makeSelect() {
        var label = document.createElement('label');
        label.id = SELECT_ID;
        label.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-size:14px;font-weight:normal;color:#4b5563;';
        label.appendChild(document.createTextNode('Results per page'));
        var select = document.createElement('select');
        select.style.cssText = 'padding:3px 6px;border:1px solid #9ca3af;border-radius:4px;background:#fff;color:#111827;font-size:14px;';
        var current = chosen();
        CHOICES.forEach(function (n) {
            var option = document.createElement('option');
            option.value = String(n);
            option.textContent = String(n);
            if (n === current) option.selected = true;
            select.appendChild(option);
        });
        select.addEventListener('change', function () {
            try { window.localStorage.setItem(STORE_KEY, select.value); } catch (_) { /* storage blocked */ }
            var url = new URL(window.location.href);
            url.searchParams.delete('pzlSearchPage');
            window.location.assign(url.toString());
        });
        label.appendChild(select);
        return label;
    }

    // COMPACT RESULTS PAGE
    // The knowledge base leaves a lot of space on its results page. The
    // parts are found by what they hold (the search field, the breadcrumb
    // with Home, the "Search Results" heading), not by the knowledge
    // base's generated class names, which change with its releases. Only
    // values that differ are written.
    function setStyle(el, prop, value) {
        if (el && el.style[prop] !== value) el.style[prop] = value;
    }

    function compact(count) {
        var area = document.querySelector('.knowledgebase');
        if (!area) return;
        var input = area.querySelector('input');
        if (input && input.parentElement) setStyle(input.parentElement, 'marginBottom', '12px');
        var home = Array.prototype.find.call(area.querySelectorAll('nav button'), function (b) { return b.textContent.trim() === 'Home'; });
        var crumbs = home && home.closest('nav');
        if (crumbs) {
            setStyle(crumbs, 'paddingTop', '0');
            setStyle(crumbs, 'paddingBottom', '0');
        }
        // "Search Results", the count and the dropdown on one line, the
        // dropdown to the right.
        var header = count.parentElement;
        var heading = header && header.querySelector('h1, h2, h3');
        if (!header || !heading) return;
        setStyle(header, 'display', 'flex');
        setStyle(header, 'flexWrap', 'wrap');
        setStyle(header, 'alignItems', 'baseline');
        setStyle(header, 'columnGap', '16px');
        setStyle(header, 'rowGap', '4px');
        setStyle(header, 'marginBottom', '16px');
        setStyle(heading, 'margin', '0');
        if (header.parentElement) setStyle(header.parentElement, 'paddingTop', '0');
    }

    function placeSelect() {
        if (!/[?&]pzlRoute=searchResults?\b/.test(window.location.search)) return;
        var count = countElement();
        if (!count) return;
        compact(count);
        // Count, then the note (only at the limit), then the dropdown.
        var cap = document.getElementById(CAP_ID);
        var atLimit = parseInt(count.textContent, 10) >= SERVER_MAX;
        if (atLimit && !cap) {
            cap = document.createElement('span');
            cap.id = CAP_ID;
            cap.style.cssText = 'font-size:13px;font-weight:normal;color:#6b7280;font-style:italic;';
            cap.textContent = CAP_TEXT;
            cap.title = 'The Help Centre returns at most ' + SERVER_MAX + ' results per search, so there may be more articles that match.';
        }
        if (!atLimit && cap) {
            cap.remove();
            cap = null;
        }
        var after = count;
        if (cap && after.nextSibling !== cap) count.parentNode.insertBefore(cap, after.nextSibling);
        if (cap) after = cap;
        var existing = document.getElementById(SELECT_ID);
        if (existing && existing.previousSibling === after) return;
        if (existing) existing.remove();
        count.parentNode.insertBefore(makeSelect(), after.nextSibling);
    }

    // The knowledge base draws itself after the page has loaded and redraws
    // its results on every search or page change, so its area is watched
    // (one observer, batched per frame) to keep the dropdown in place.
    var frame = 0;
    function schedule() {
        if (frame) return;
        frame = window.requestAnimationFrame(function () {
            frame = 0;
            try { placeSelect(); } catch (err) { console.warn(LOG, err); }
        });
    }

    // Until the knowledge base area exists, the page body is watched only
    // to find it; then the watch moves to that area alone.
    function watch() {
        var area = document.querySelector('.knowledgebase');
        if (area) {
            new MutationObserver(schedule).observe(area, { childList: true, subtree: true });
            schedule();
            return;
        }
        var finder = new MutationObserver(function () {
            if (!document.querySelector('.knowledgebase')) return;
            finder.disconnect();
            watch();
        });
        finder.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
    else watch();
})();
