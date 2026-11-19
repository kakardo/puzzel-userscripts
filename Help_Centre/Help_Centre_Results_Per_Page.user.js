// @file_name = Help_Centre_Results_Per_Page.user.js
// @author = Kardo Rostam
// @version = 1.5_2026-11-19
// @created = 2026-11-19 10:02
// @note = run-at document-start on purpose: the Help Centre's settings are fetched while the page loads, and fetch has to be wrapped before that to change the number of search results per page.

// ==UserScript==
// @name         Help Centre Results Per Page
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.5_2026-11-19
// @description  Shows more search results per page in the Puzzel Help Centre knowledge base: 20 instead of 5, with a "Results per page" dropdown next to the result count (5, 10, 20 or 25). The Help Centre reads the number from its own settings file when the page loads; the script changes that number in the file as it arrives, so the knowledge base itself shows the chosen number, with its own paging. On the results page the empty space is taken out (under the search box, around the breadcrumb and above the results) and "Search Results", the result count and the dropdown sit on one line. When a search reaches the server's limit of 25 results, a short note beside the count says so: "max reached, more may exist, refine your search". A "Tree view" button beside it shows all results of the search as a tree, grouped by the parts of their titles ("Puzzel ID - Migration - New URLs" goes under Puzzel ID, then Migration), each group folding open and shut; a group with a single article shows it as one line. "List view" goes back; the choice is remembered. The top of every Help Centre page is tightened too: a lower banner and less space around System Status and the ticket buttons. The choice is remembered in this browser; changing it reloads the results once. The knowledge base's server returns at most 25 results per search, so 25 is the highest choice. Event-driven: one fetch wrapper that only touches the settings file, and the dropdown is put back when the results are redrawn (one observer on the knowledge base area, only on the search results page).
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
    var TREE_KEY = 'kk-help-tree-view';
    var TREE_BTN_ID = 'kk-help-tree-btn';
    var TREE_ID = 'kk-help-tree';
    // Title parts are split at a hyphen, en dash or em dash with spaces
    // around it.
    var PART_SPLIT = /\s+[-\u2013\u2014]\s+/;
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
        'section:has(.knowledgebase) { padding-top: 8px !important; }',
        // The tree view
        '#kk-help-tree-btn { padding: 3px 10px; border: 1px solid #9ca3af; border-radius: 4px; background: #fff; color: #111827; font-size: 14px; cursor: pointer; }',
        '#kk-help-tree-btn:hover { background: #f3f4f6; }',
        // Easier to read: normal text size, dark article titles that turn
        // blue on hover, a faint guide line down each group, a light row
        // highlight under the pointer and a small dot before each article.
        '#kk-help-tree { margin: 0 0 16px; padding: 10px 14px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; font-size: 15px; line-height: 1.45; }',
        '#kk-help-tree ul { list-style: none; margin: 2px 0 6px 7px; padding-left: 14px; border-left: 2px solid #d1d5db; }',
        '#kk-help-tree > ul { margin: 0; padding-left: 0; border-left: 0; }',
        '#kk-help-tree li { margin: 0; }',
        '#kk-help-tree summary { cursor: pointer; padding: 3px 6px; border-radius: 4px; font-weight: 600; color: #111827; }',
        '#kk-help-tree summary:hover { background: #f3f4f6; }',
        '#kk-help-tree summary .kk-n { margin-left: 6px; padding: 0 6px; border-radius: 10px; background: #eef0fc; font-weight: 600; font-size: 12px; color: #3c46b8; }',
        '#kk-help-tree a { display: block; padding: 3px 6px 3px 18px; border-radius: 4px; color: #1f2937; text-decoration: none; position: relative; }',
        '#kk-help-tree a::before { content: ""; position: absolute; left: 7px; top: 50%; width: 5px; height: 5px; margin-top: -2px; border-radius: 50%; background: #9ca3af; }',
        '#kk-help-tree a:hover { background: #f3f4f6; color: #3c46b8; }',
        '#kk-help-tree a:hover::before { background: #3c46b8; }',
        // Top-level single articles: a thin line above the first, so they
        // read as their own block after the groups.
        '#kk-help-tree > ul > li:has(details) + li:not(:has(details)) { margin-top: 6px; padding-top: 6px; border-top: 1px solid #e5e7eb; }'
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

    // The articles of the latest search, as the knowledge base received them.
    var lastResults = [];

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
            if (/\/public-graphql\b/.test(url) && init && typeof init.body === 'string' && init.body.indexOf('SearchForArticles') !== -1) {
                result.then(function (response) {
                    return response.clone().json();
                }).then(function (data) {
                    lastResults = (data && data.data && data.data.searchArticles) || [];
                    schedule();
                }).catch(function () { /* the tree simply stays as it was */ });
                return result;
            }
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

    // TREE VIEW
    // Built from the latest search's articles (all of them, not only the
    // page shown), in the order the search ranked them: groups appear where
    // their first article did.
    function treeOn() {
        try { return window.localStorage.getItem(TREE_KEY) === '1'; } catch (_) { return false; }
    }

    function articleTitle(article) {
        var content = article && article.content;
        var list = Array.isArray(content) ? content : (content ? [content] : []);
        var pick = list.find(function (c) { return /^en/i.test(c.language || ''); }) || list[0];
        return pick && pick.question ? String(pick.question).trim() : '';
    }

    function buildTree(articles) {
        var root = { children: [] };
        articles.forEach(function (article) {
            var title = articleTitle(article);
            if (!title) return;
            var node = root;
            title.split(PART_SPLIT).forEach(function (part) {
                var child = node.children.find(function (c) { return c.name.toLowerCase() === part.toLowerCase(); });
                if (!child) {
                    child = { name: part, children: [], article: null };
                    node.children.push(child);
                }
                node = child;
            });
            node.article = { id: article.id, title: title };
        });
        return root;
    }

    function countArticles(node) {
        return (node.article ? 1 : 0) + node.children.reduce(function (n, c) { return n + countArticles(c); }, 0);
    }

    function articleLink(article, text) {
        var url = new URL(window.location.href);
        url.search = '?pzlRoute=article&pzlArticleId=' + encodeURIComponent(article.id);
        var a = document.createElement('a');
        a.href = url.toString();
        a.textContent = text;
        return a;
    }

    // A group with a single article is shown as that one line, its name
    // and the rest of the title together, instead of a group of one.
    // Within a level, groups come first, then single articles, each in
    // the order the search ranked them.
    function renderNodes(nodes, prefix) {
        var ul = document.createElement('ul');
        var groups = nodes.filter(function (n) { return countArticles(n) > 1; });
        var singles = nodes.filter(function (n) { return countArticles(n) <= 1; });
        groups.concat(singles).forEach(function (node) {
            var li = document.createElement('li');
            var label = prefix ? prefix + ' - ' + node.name : node.name;
            var total = countArticles(node);
            if (total === 1) {
                var only = node;
                var text = label;
                while (!only.article) {
                    only = only.children[0];
                    text += ' - ' + only.name;
                }
                li.appendChild(articleLink(only.article, prefix ? text.slice(prefix.length + 3) : text));
            } else {
                var details = document.createElement('details');
                details.open = true;
                var summary = document.createElement('summary');
                summary.appendChild(document.createTextNode(node.name));
                var n = document.createElement('span');
                n.className = 'kk-n';
                n.textContent = '(' + total + ')';
                summary.appendChild(n);
                details.appendChild(summary);
                if (node.article) {
                    var own = document.createElement('ul');
                    var ownLi = document.createElement('li');
                    ownLi.appendChild(articleLink(node.article, node.name));
                    own.appendChild(ownLi);
                    details.appendChild(own);
                }
                details.appendChild(renderNodes(node.children, ''));
                li.appendChild(details);
            }
            ul.appendChild(li);
        });
        return ul;
    }

    // The knowledge base's own list and paging, which the tree replaces
    // while it is on: everything after the results heading in its block.
    function listParts(header) {
        var parts = [];
        for (var el = header.nextElementSibling; el; el = el.nextElementSibling) {
            if (el.id !== TREE_ID) parts.push(el);
        }
        return parts;
    }

    var shownFor = null;

    function updateTree(header) {
        var button = document.getElementById(TREE_BTN_ID);
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.id = TREE_BTN_ID;
            button.addEventListener('click', function () {
                try { window.localStorage.setItem(TREE_KEY, treeOn() ? '0' : '1'); } catch (_) { /* storage blocked */ }
                shownFor = null;
                schedule();
            });
        }
        if (button.parentNode !== header) header.appendChild(button);
        var on = treeOn() && lastResults.length > 0;
        var text = on ? 'List view' : 'Tree view';
        if (button.textContent !== text) button.textContent = text;
        button.title = on ? 'Show the results as the usual list' : 'Show all results of this search as a tree, grouped by title';

        var tree = document.getElementById(TREE_ID);
        listParts(header).forEach(function (el) {
            var want = on ? 'none' : '';
            if (el.style.display !== want) el.style.display = want;
        });
        if (!on) {
            if (tree) tree.remove();
            shownFor = null;
            return;
        }
        if (tree && shownFor === lastResults && tree.previousElementSibling === header) return;
        if (tree) tree.remove();
        tree = document.createElement('div');
        tree.id = TREE_ID;
        tree.appendChild(renderNodes(buildTree(lastResults).children, ''));
        header.parentNode.insertBefore(tree, header.nextSibling);
        shownFor = lastResults;
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
        if (!(existing && existing.previousSibling === after)) {
            if (existing) existing.remove();
            count.parentNode.insertBefore(makeSelect(), after.nextSibling);
        }
        updateTree(count.parentNode);
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
