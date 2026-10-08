// @file_name = PCM_No_Autoscroll.user.js
// @author = Kardo Rostam
// @version = 2.0_2026-10-08
// @created = 2026-02-06 (v1.0)
// @note = Continues PCM Ticket Anti-Autoscroll (1.0), which hid the Timeline and pulled the page up every frame while loading. From 2.0 the jump itself is stopped instead.
// @note = run-at document-start on purpose: the guard has to be in place before PCM's own code runs, or the jump has already happened.

// ==UserScript==
// @name         PCM No Autoscroll
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.0_2026-10-08
// @description  Stops a ticket from jumping down to the Timeline when it opens; the page stays at the top. While the ticket loads, page scrolls started by code are ignored and a field that takes focus does not pull the page along. A jump that still happens (for example from the browser itself) is undone once. Ends at your first scroll, click or key press, or 20 seconds after opening, so normal scrolling is never affected. Links to a specific note (an address with #) still go to that note. Set localStorage 'pcm-no-autoscroll-debug' to '1' to log in the console what was stopped and where it came from.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_No_Autoscroll.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_No_Autoscroll.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // How long after opening the guard stays on, at most. Your first
    // scroll, click or key press ends it earlier.
    var GUARD_MAX_MS = 20000;

    // INTERNAL SETTINGS
    var LOG = '[PCM No Autoscroll]';
    var DEBUG_KEY = 'pcm-no-autoscroll-debug';

    if (!/^\/tickets\/\d+/.test(window.location.pathname)) return;
    // An address with # points at a note on purpose: let the browser go there.
    if (window.location.hash) return;

    var debug = false;
    try { debug = localStorage.getItem(DEBUG_KEY) === '1'; } catch (_) {}

    function report(what, detail) {
        if (!debug) return;
        var stack = (new Error().stack || '').split('\n').slice(3, 7).map(function (s) { return s.trim(); }).join(' | ');
        console.log(LOG, 'stopped', what, detail || '', '\n  from:', stack);
    }

    // The browser would otherwise put the page back where it was last time.
    try { history.scrollRestoration = 'manual'; } catch (_) {}

    // GUARD
    // Only scrolls of the page itself are stopped: the window, html/body,
    // and any container that fills most of the screen. Scrolling inside
    // small boxes (lists, editors) is left alone.
    function isPageScroller(el) {
        if (!el || el.nodeType !== 1) return false;
        if (el === document.documentElement || el === document.body || el === document.scrollingElement) return true;
        return el.clientHeight >= window.innerHeight * 0.6 && el.scrollHeight > el.clientHeight;
    }

    var guarding = true;
    var restores = [];

    function wrap(owner, name, makeReplacement) {
        var original = owner[name];
        if (typeof original !== 'function') return;
        owner[name] = makeReplacement(original);
        restores.push(function () { owner[name] = original; });
    }

    function downwards(args) {
        var a = args[0];
        if (a && typeof a === 'object') return (a.top || 0) > 0;
        return (args[1] || 0) > 0;
    }

    // scrollIntoView: the usual way to jump to a section.
    wrap(Element.prototype, 'scrollIntoView', function (original) {
        return function () {
            if (guarding) { report('scrollIntoView', this.id || this.className); return; }
            return original.apply(this, arguments);
        };
    });

    // window.scrollTo / scroll / scrollBy, and the same on elements.
    ['scrollTo', 'scroll', 'scrollBy'].forEach(function (name) {
        wrap(window, name, function (original) {
            return function () {
                if (guarding && downwards(arguments)) { report('window.' + name); return; }
                return original.apply(this, arguments);
            };
        });
        wrap(Element.prototype, name, function (original) {
            return function () {
                if (guarding && downwards(arguments) && isPageScroller(this)) { report('element.' + name); return; }
                return original.apply(this, arguments);
            };
        });
    });

    // scrollTop = ... (also what animated jQuery scrolls use).
    var scrollTopDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (scrollTopDesc && scrollTopDesc.set) {
        Object.defineProperty(Element.prototype, 'scrollTop', {
            configurable: true,
            enumerable: scrollTopDesc.enumerable,
            get: scrollTopDesc.get,
            set: function (value) {
                if (guarding && value > 0 && isPageScroller(this)) { report('scrollTop', value); return; }
                scrollTopDesc.set.call(this, value);
            }
        });
        restores.push(function () { Object.defineProperty(Element.prototype, 'scrollTop', scrollTopDesc); });
    }

    // focus(): the field still gets the cursor, but the page stays put.
    wrap(HTMLElement.prototype, 'focus', function (original) {
        return function (options) {
            if (!guarding) return original.apply(this, arguments);
            var opts = Object.assign({}, options || {}, { preventScroll: true });
            return original.call(this, opts);
        };
    });

    // Fallback for jumps that do not go through code above (a field with
    // autofocus, the browser's own restore): put the page back at the top.
    var originalScrollTo = window.scrollTo;
    function onScroll(event) {
        if (!guarding) return;
        var target = event.target === document ? document.scrollingElement : event.target;
        if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
            if (window.scrollY > 0) {
                report('jump without code', Math.round(window.scrollY));
                originalScrollTo.call(window, 0, 0);
            }
        } else if (isPageScroller(target) && target.scrollTop > 0) {
            report('jump in container', target.id || target.className);
            if (scrollTopDesc && scrollTopDesc.set) scrollTopDesc.set.call(target, 0);
        }
    }
    window.addEventListener('scroll', onScroll, true);

    // END
    // Your first own scroll, click or key press ends the guard, as does
    // the time limit. Everything is put back as it was.
    var INTENT_EVENTS = ['wheel', 'mousedown', 'keydown', 'touchstart'];
    var endTimer = 0;

    function endGuard() {
        if (!guarding) return;
        guarding = false;
        window.clearTimeout(endTimer);
        window.removeEventListener('scroll', onScroll, true);
        INTENT_EVENTS.forEach(function (type) { window.removeEventListener(type, onIntent, true); });
        restores.forEach(function (restore) { restore(); });
        restores = [];
        if (debug) console.log(LOG, 'guard ended');
    }

    function onIntent(event) {
        if (event.isTrusted) endGuard();
    }

    INTENT_EVENTS.forEach(function (type) { window.addEventListener(type, onIntent, { capture: true, passive: true }); });
    endTimer = window.setTimeout(endGuard, GUARD_MAX_MS);
})();
