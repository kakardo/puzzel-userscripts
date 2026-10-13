// @file_name = Geckoboard_Keep_Last_Data.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-13
// @created = 2026-10-13 14:08
// @note = run-at document-start on purpose: fetch has to be wrapped before Geckoboard's own code takes its reference to it, or its data requests go past the wrapper.

// ==UserScript==
// @name         Geckoboard Keep Last Data
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-13
// @description  Stops a Geckoboard widget from switching to "Failed to load widget data" when one data refresh fails. Geckoboard's data server sometimes answers a widget's refresh with a server error (for example 520). The request is then tried again after 1 and 3 seconds; if it still fails, the widget gets the last data that did load, so it keeps showing numbers. A widget whose data request has never succeeded keeps what it already shows (its first data comes with the page and the live connection): the failed request is left unanswered instead of handing Geckoboard the error. Either way a small note in the bottom-left corner says which widgets could not refresh and since when. The last good data is kept for the browser tab (sessionStorage), so a reload during an outage still has something to show. The shared page only frames the dashboard, which loads from app.geckoboard.com and makes the data requests there, so the script runs in that frame. Only GET requests to Geckoboard's widget data addresses are touched. No observers, no polling: work happens only when Geckoboard itself asks for data.
// @author       Kardo Rostam
// @match        https://share.geckoboard.com/dashboards/*
// @match        https://app.geckoboard.com/v5/dashboards/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Geckoboard/Geckoboard_Keep_Last_Data.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Geckoboard/Geckoboard_Keep_Last_Data.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // Waits before each new try after a server error, in milliseconds.
    // Two entries means up to two extra tries.
    var RETRY_DELAYS_MS = [1000, 3000];

    // Show the note while a widget shows saved data or could not refresh.
    var SHOW_NOTE = true;

    // When a request still fails and no good data was ever saved for that
    // widget, leave the request unanswered so the widget keeps what it
    // already shows (its first data comes from the page and the live
    // connection). false hands Geckoboard the error instead.
    var HOLD_WHEN_NOTHING_SAVED = true;

    // INTERNAL SETTINGS
    var LOG = '[Geckoboard Keep Last Data]';
    var DATA_HOST = 'data.geckoboard.com';
    var DATA_PATH_RE = /^\/instruments\//;
    var STORE_KEY = 'geckoboard-keep-last-data';
    var MAX_BODY_CHARS = 500000;   // one widget's data; larger answers are not kept
    var NOTE_ID = 'geckoboard-keep-last-data-note';

    var originalFetch = window.fetch;
    if (typeof originalFetch !== 'function') return;

    // SAVED DATA
    // One entry per request address, plus one per widget (the address
    // without its query) as a fallback when the query differs between
    // loads. sessionStorage: survives a reload in the same tab, gone when
    // the tab closes.
    function readStore() {
        try {
            var parsed = JSON.parse(window.sessionStorage.getItem(STORE_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    var store = readStore();

    function writeStore() {
        try {
            window.sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
        } catch (_) {
            // Storage full or blocked: the saved data still works in memory.
        }
    }

    function keysOf(url) {
        return [url.href, url.origin + url.pathname];
    }

    function remember(url, response) {
        var type = response.headers.get('content-type') || 'application/json';
        response.text().then(function (body) {
            if (body.length > MAX_BODY_CHARS) return;
            var entry = { body: body, type: type, at: Date.now() };
            keysOf(url).forEach(function (key) { store[key] = entry; });
            writeStore();
        }, function () { /* unreadable answer: nothing to keep */ });
    }

    function recall(url) {
        var keys = keysOf(url);
        for (var i = 0; i < keys.length; i += 1) {
            if (store[keys[i]]) return store[keys[i]];
        }
        return null;
    }

    // NOTE
    // Which widgets (by address without query) show saved data, and since
    // when their data was last fresh.
    var stale = {};

    function timeText(ms) {
        var d = new Date(ms);
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    function renderNote() {
        if (!SHOW_NOTE || !document.body) return;
        var keys = Object.keys(stale);
        var note = document.getElementById(NOTE_ID);
        if (!keys.length) {
            if (note) note.remove();
            return;
        }
        if (!note) {
            note = document.createElement('div');
            note.id = NOTE_ID;
            note.style.cssText = [
                'position:fixed', 'left:12px', 'bottom:12px', 'z-index:2147483647',
                'padding:6px 12px', 'border-radius:6px', 'background:#8a5a00',
                'color:#fff', 'font:600 13px/1.3 sans-serif', 'opacity:.92',
                'pointer-events:none'
            ].join(';');
            document.body.appendChild(note);
        }
        var saved = keys.filter(function (key) { return !held[key]; });
        var parts = [];
        if (saved.length) {
            var oldest = Math.min.apply(null, saved.map(function (key) { return stale[key]; }));
            parts.push((saved.length === 1 ? '1 widget shows' : saved.length + ' widgets show') +
                ' saved data from ' + timeText(oldest) + '.');
        }
        var heldCount = keys.length - saved.length;
        if (heldCount) {
            parts.push((heldCount === 1 ? '1 widget' : heldCount + ' widgets') +
                ' could not refresh since ' + timeText(Math.min.apply(null, keys.filter(function (key) { return held[key]; }).map(function (key) { return stale[key]; }))) +
                ' and keep' + (heldCount === 1 ? 's' : '') + ' what was shown.');
        }
        var text = 'Geckoboard could not load fresh data: ' + parts.join(' ');
        if (note.textContent !== text) note.textContent = text;
    }

    // held: no saved data existed, so the failed request was left
    // unanswered and the widget kept what it showed (see fallBack).
    var held = {};

    function markStale(url, at, isHeld) {
        var key = url.origin + url.pathname;
        stale[key] = at;
        if (isHeld) held[key] = true; else delete held[key];
        renderNote();
    }

    function clearStale(url) {
        var key = url.origin + url.pathname;
        if (!stale[key]) return;
        delete stale[key];
        delete held[key];
        renderNote();
    }

    if (SHOW_NOTE) {
        document.addEventListener('DOMContentLoaded', renderNote, { once: true });
    }

    // THE WRAPPER
    function dataUrl(input) {
        var raw = typeof input === 'string' ? input : (input && input.url) || String(input);
        var url;
        try {
            url = new URL(raw, window.location.href);
        } catch (_) {
            return null;
        }
        return url.hostname === DATA_HOST && DATA_PATH_RE.test(url.pathname) ? url : null;
    }

    function isGet(input, init) {
        var method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
        return String(method).toUpperCase() === 'GET';
    }

    function wait(ms) {
        return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
    }

    window.fetch = function (input, init) {
        var url = dataUrl(input);
        if (!url || !isGet(input, init)) return originalFetch.apply(this, arguments);

        var self = this;
        var args = arguments;

        function attempt(tryIndex) {
            return originalFetch.apply(self, args).then(function (response) {
                if (response.ok) {
                    remember(url, response.clone());
                    clearStale(url);
                    return response;
                }
                if (response.status >= 500) return fallBack(tryIndex, response, null);
                return response;
            }, function (error) {
                // A request Geckoboard cancelled itself is not an outage.
                if (error && error.name === 'AbortError') throw error;
                return fallBack(tryIndex, null, error);
            });
        }

        function fallBack(tryIndex, response, error) {
            if (tryIndex < RETRY_DELAYS_MS.length) {
                return wait(RETRY_DELAYS_MS[tryIndex]).then(function () { return attempt(tryIndex + 1); });
            }
            var saved = recall(url);
            if (saved) {
                console.warn(LOG, 'data request failed (' + (response ? response.status : error) + '), showing data from ' + timeText(saved.at));
                markStale(url, saved.at, false);
                return new Response(saved.body, { status: 200, headers: { 'Content-Type': saved.type } });
            }
            if (!HOLD_WHEN_NOTHING_SAVED) {
                if (response) return response;
                throw error;
            }
            // Nothing saved: the widget's first data (from the page itself
            // and the live connection) is already on screen, and answering
            // with the error would replace it with "Failed to load widget
            // data". The request is left unanswered instead, so the widget
            // keeps what it shows and live updates still arrive. Only a
            // cancel from Geckoboard itself ends it.
            console.warn(LOG, 'data request failed (' + (response ? response.status : error) + ') and nothing is saved yet; keeping what the widget shows');
            markStale(url, Date.now(), true);
            return holdOpen(init && init.signal || (input && typeof input === 'object' && input.signal));
        }

        function holdOpen(signal) {
            return new Promise(function (resolve, reject) {
                if (!signal) return;
                var abort = function () {
                    var e = new Error('The request was cancelled');
                    e.name = 'AbortError';
                    reject(e);
                };
                if (signal.aborted) abort();
                else signal.addEventListener('abort', abort, { once: true });
            });
        }

        return attempt(0);
    };
})();
