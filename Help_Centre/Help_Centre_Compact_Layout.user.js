// ==UserScript==
// @name         Help Centre Compact Layout
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-11-27
// @description  Takes the empty space out of the Puzzel Help Centre (www.puzzel.com/help). On every page: a lower banner (its illustration in a smaller box), less space around System Status and the ticket buttons, and less space under the knowledge base's search field and around its breadcrumb. On the search results page "Search Results", the result count and any controls other scripts add there sit on one line; on an article there is less space around its title. The page's own sections are found by their names or what they hold, and the knowledge base's parts by what they hold (the search field, the breadcrumb with Home, the headings), not by its generated class names, which change with its releases; a part that is not found keeps its normal spacing. Event-driven: one stylesheet added before the page is drawn, and one observer on the knowledge base area.
// @author       Kardo Rostam
// @match        https://www.puzzel.com/help*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Help_Centre/Help_Centre_Compact_Layout.user.js
// ==/UserScript==

// @created = 2026-11-19 16:05
// @note = run-at document-start on purpose: the page's spacing rules are in place before it is drawn, so nothing jumps.
// @note = Split off from Help Centre Results Per Page, where the compact layout was added in 1.1 to 1.6.

(function () {
    'use strict';

    var LOG = '[Help Centre Compact Layout]';
    // The page's own building blocks: the banner, the status line, the
    // ticket buttons and the knowledge base's section.
    var CSS = [
        'section.c-hero-with-image-and-content { padding-top: 24px !important; padding-bottom: 24px !important; }',
        // The illustration's box keeps a square shape of its own, so the box
        // itself gets a fixed lower height and the picture fits inside it.
        'section.c-hero-with-image-and-content [class*="__image-container"] { margin-bottom: 0 !important; height: 200px !important; min-height: 0 !important; aspect-ratio: auto !important; padding-top: 0 !important; }',
        'section.c-hero-with-image-and-content [class*="__image-container"] picture, section.c-hero-with-image-and-content [class*="__image-container"] img { height: 100% !important; width: 100% !important; object-fit: contain !important; }',
        'section.c-hero-with-image-and-content [class*="__title"] { margin-bottom: 12px !important; }',
        'section:has(.statusio-badge) { padding-top: 20px !important; padding-bottom: 0 !important; }',
        'section:has(.statusio-badge) .statusio-badge { margin-bottom: 8px !important; }',
        'section:has(.c-text-block__button-container) { padding-top: 8px !important; padding-bottom: 12px !important; }',
        'section:has(.knowledgebase) { padding-top: 8px !important; }'
    ].join('\n');

    // In place from the start, before the page is drawn.
    (function addStyle() {
        var style = document.createElement('style');
        style.id = 'kk-help-compact-style';
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    })();

    // THE KNOWLEDGE BASE
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

    function setStyle(el, prop, value) {
        if (el && el.style[prop] !== value) el.style[prop] = value;
    }

    // On every knowledge base page: less space under the search field and
    // around the breadcrumb.
    function compactTop() {
        var area = document.querySelector('.knowledgebase');
        if (!area) return null;
        var input = area.querySelector('input');
        if (input && input.parentElement) setStyle(input.parentElement, 'marginBottom', '12px');
        var home = Array.prototype.find.call(area.querySelectorAll('nav button'), function (b) { return b.textContent.trim() === 'Home'; });
        var crumbs = home && home.closest('nav');
        if (crumbs) {
            setStyle(crumbs, 'paddingTop', '0');
            setStyle(crumbs, 'paddingBottom', '0');
        }
        return crumbs;
    }

    // An article: its title is the heading that repeats the breadcrumb's
    // last part. The space above and below it and above the text shrinks.
    function compactArticle(crumbs) {
        if (!/[?&]pzlRoute=article\b/.test(window.location.search) || !crumbs) return;
        var parts = crumbs.querySelectorAll('span span, span button');
        var last = parts.length ? parts[parts.length - 1].textContent.trim() : '';
        var area = document.querySelector('.knowledgebase');
        var title = last && Array.prototype.find.call(area.querySelectorAll('h1, h2'), function (h) { return h.textContent.trim() === last; });
        if (!title) return;
        setStyle(title, 'marginTop', '4px');
        setStyle(title, 'marginBottom', '8px');
        var header = title.closest('header');
        if (!header) return;
        setStyle(header, 'marginBottom', '8px');
        Array.prototype.forEach.call(header.querySelectorAll('h1 ~ div'), function (el) { setStyle(el, 'marginTop', '4px'); });
        if (header.parentElement) setStyle(header.parentElement, 'paddingTop', '0');
        if (header.nextElementSibling) setStyle(header.nextElementSibling, 'paddingTop', '8px');
    }

    function compact(count) {
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

    function update() {
        compactArticle(compactTop());
        if (!/[?&]pzlRoute=searchResults?\b/.test(window.location.search)) return;
        var count = countElement();
        if (count) compact(count);
    }

    // The knowledge base draws itself after the page has loaded and redraws
    // on every search or page change, so its area is watched (one
    // observer, batched per frame). Until that area exists, the page body
    // is watched only to find it.
    var frame = 0;
    function schedule() {
        if (frame) return;
        frame = window.requestAnimationFrame(function () {
            frame = 0;
            try { update(); } catch (err) { console.warn(LOG, err); }
        });
    }

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
