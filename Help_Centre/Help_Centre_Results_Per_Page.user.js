// @file_name = Help_Centre_Results_Per_Page.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-11-19
// @created = 2026-11-19 10:02
// @note = run-at document-start on purpose: the Help Centre's settings are fetched while the page loads, and fetch has to be wrapped before that to change the number of search results per page.

// ==UserScript==
// @name         Help Centre Results Per Page
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-11-19
// @description  Shows more search results per page in the Puzzel Help Centre knowledge base: 20 instead of 5, with a "Results per page" dropdown next to the result count (5, 10, 20 or 25). The Help Centre reads the number from its own settings file when the page loads; the script changes that number in the file as it arrives, so the knowledge base itself shows the chosen number, with its own paging. The choice is remembered in this browser; changing it reloads the results once. The knowledge base's server returns at most 25 results per search, so 25 is the highest choice. Event-driven: one fetch wrapper that only touches the settings file, and the dropdown is put back when the results are redrawn (one observer on the knowledge base area, only on the search results page).
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
        label.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:16px;font-size:14px;font-weight:normal;color:#4b5563;';
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

    function placeSelect() {
        if (!/[?&]pzlRoute=searchResults?\b/.test(window.location.search)) return;
        var count = countElement();
        if (!count) return;
        var existing = document.getElementById(SELECT_ID);
        if (existing && existing.previousSibling === count) return;
        if (existing) existing.remove();
        count.parentNode.insertBefore(makeSelect(), count.nextSibling);
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
