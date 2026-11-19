// @file_name = Help_Centre_Tree_View.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-11-19
// @created = 2026-11-19 16:02
// @note = run-at document-start on purpose: the knowledge base fetches its search answer while the page loads, and fetch has to be wrapped before that to read it.
// @note = Split off from Help Centre Results Per Page, where the tree view was added in 1.4.

// ==UserScript==
// @name         Help Centre Tree View
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-11-19
// @description  Adds a "Tree view" button to the search results of the Puzzel Help Centre knowledge base. It shows all results of the search (not only the page shown) as a tree, grouped by the parts of their titles ("Puzzel ID - Migration - New URLs" goes under Puzzel ID, then Migration), each group folding open and shut and showing how many articles it holds; a group with a single article shows it as one line, and within a level groups come first, then single articles, in the order the search ranked them. "List view" goes back; the choice is remembered in this browser. The results are read from the search answer the knowledge base already receives, so there are no extra requests. Event-driven: one fetch wrapper that only reads the search answer, and one observer on the knowledge base area.
// @author       Kardo Rostam
// @match        https://www.puzzel.com/help*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Help_Centre/Help_Centre_Tree_View.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Help_Centre/Help_Centre_Tree_View.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var TREE_KEY = 'kk-help-tree-view';
    var TREE_BTN_ID = 'kk-help-tree-btn';
    var TREE_ID = 'kk-help-tree';
    // Title parts are split at a hyphen, en dash or em dash with spaces
    // around it.
    var PART_SPLIT = /\s+[-\u2013\u2014]\s+/;
    var LOG = '[Help Centre Tree View]';
    var CSS = [
        '#kk-help-tree-btn { margin-left: auto; padding: 3px 10px; border: 1px solid #9ca3af; border-radius: 4px; background: #fff; color: #111827; font-size: 14px; cursor: pointer; }',
        '#kk-help-tree-btn:hover { background: #f3f4f6; }',
        // Right after the Results Per Page dropdown when that script runs.
        '#kk-help-per-page ~ #kk-help-tree-btn { margin-left: 8px; }',
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

    (function addStyle() {
        var style = document.createElement('style');
        style.id = 'kk-help-tree-style';
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    })();

    // THE SEARCH ANSWER
    // The articles of the latest search, read from the answer as it
    // arrives; the answer itself is handed on untouched.
    var lastResults = [];
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
            }
            return result;
        };
    }

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

    function update() {
        if (!/[?&]pzlRoute=searchResults?\b/.test(window.location.search)) return;
        var count = countElement();
        if (count) updateTree(count.parentNode);
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
