// @file_name = PCC_User_Group_Search.user.js
// @author = Kardo Rostam
// @version = 1.1_2026-09-08
// @created = 2026-09-08 08:24

// ==UserScript==
// @name         PCC User Group Search
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-09-08
// @description  Adds a search box above the User Group dropdown on the Puzzel Admin Add User and Edit User pages. Typing opens a panel listing EVERY matching group; click one or use arrow keys plus Enter to pick it (a change event fires so the page registers it). Escape closes and clears, no match shows a red edge, and the native dropdown itself is never modified. Standalone: the Admin console is server-rendered, so a bounded boot is all the machinery needed, no observers, no polling.
// @author       Kardo Rostam
// @match        https://app.puzzel.com/admin/UsersUsers/NewUser*
// @match        https://app.puzzel.com/admin/UsersUsers/EditUser/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Admin_View/PCC_User_Group_Search.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Admin_View/PCC_User_Group_Search.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    var SELECT_ID = 'User_SelectedUserGroupId';
    var PLACEHOLDER = 'Filter user groups...';
    var PANEL_MAX_HEIGHT_PX = 260;

    // true: the panel widens to fit the longest hit (capped below).
    // false: the panel stays as wide as the search box.
    var PANEL_FIT_TEXT = true;
    var PANEL_MAX_WIDTH_PX = 560;

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var INPUT_ID = 'pcc-ugs-filter';
    var PANEL_ID = 'pcc-ugs-panel';
    var STYLE_ID = 'pcc-ugs-style';
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 250;

    var CSS = [
        '#' + INPUT_ID + ' {',
        '    display: block;',
        '    width: 100%;',
        '    box-sizing: border-box;',
        '    margin: 0 0 4px 0;',
        '    padding: 6px 10px;',
        '    font-size: 14px;',
        '    border: 1px solid #c4c4cf;',
        '    border-radius: 6px;',
        '}',
        '#' + INPUT_ID + ':focus {',
        '    outline: none;',
        '    border-color: #7d5bd0;',
        '}',
        '#' + INPUT_ID + '.pcc-ugs-nomatch {',
        '    border-color: #c0392b;',
        '    box-shadow: 0 0 0 1px #c0392b;',
        '}',
        '.pcc-ugs-wrap {',
        '    position: relative;',
        '}',
        '#' + PANEL_ID + ' {',
        '    position: absolute;',
        '    left: 0;',
        PANEL_FIT_TEXT
            ? '    min-width: 100%; width: max-content; max-width: ' + PANEL_MAX_WIDTH_PX + 'px;'
            : '    right: 0;',
        '    z-index: 9999;',
        '    background: #fff;',
        '    border: 1px solid #c4c4cf;',
        '    border-radius: 6px;',
        '    box-shadow: 0 6px 16px rgba(0,0,0,0.15);',
        '    max-height: ' + PANEL_MAX_HEIGHT_PX + 'px;',
        '    overflow-y: auto;',
        '    font-size: 14px;',
        '}',
        '#' + PANEL_ID + ' .pcc-ugs-item {',
        '    padding: 6px 10px;',
        '    cursor: pointer;',
        '    white-space: nowrap;',
        '    overflow: hidden;',
        '    text-overflow: ellipsis;',
        '}',
        '#' + PANEL_ID + ' .pcc-ugs-item:hover,',
        '#' + PANEL_ID + ' .pcc-ugs-item.pcc-ugs-active {',
        '    background: #ede7fb;',
        '}',
        '#' + PANEL_ID + ' .pcc-ugs-mark {',
        '    background: #ffe9a8;',
        '    border-radius: 2px;',
        '    font-weight: 700;',
        '}'
    ].join('\n');

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function enhance(select) {
        if (document.getElementById(INPUT_ID)) return;
        ensureStyle();

        // Snapshot of the options; the native select is NEVER modified,
        // picking a hit only sets its value.
        var master = Array.prototype.slice.call(select.options).map(function (opt) {
            return { value: opt.value, text: opt.textContent.trim() };
        });

        var wrap = document.createElement('div');
        wrap.className = 'pcc-ugs-wrap';

        var input = document.createElement('input');
        input.id = INPUT_ID;
        input.type = 'text';
        input.placeholder = PLACEHOLDER;
        input.autocomplete = 'off';
        input.title = 'Type to list matching User Groups. Click a hit or use arrow keys and Enter. Escape clears.';

        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.display = 'none';

        wrap.appendChild(input);
        wrap.appendChild(panel);
        select.parentNode.insertBefore(wrap, select);

        var matches = [];
        var activeIndex = -1;
        var lastTerm = '';

        // The typed term is marked inside every hit at the position it
        // occurs. Built with text nodes and a span, never innerHTML.
        function renderItemText(item, entryText) {
            var lower = entryText.toLowerCase();
            var at = lastTerm ? lower.indexOf(lastTerm) : -1;
            if (at === -1) {
                item.textContent = entryText;
                return;
            }
            item.appendChild(document.createTextNode(entryText.slice(0, at)));
            var mark = document.createElement('span');
            mark.className = 'pcc-ugs-mark';
            mark.textContent = entryText.slice(at, at + lastTerm.length);
            item.appendChild(mark);
            item.appendChild(document.createTextNode(entryText.slice(at + lastTerm.length)));
        }

        function hidePanel() {
            panel.style.display = 'none';
            activeIndex = -1;
        }

        function pick(entry) {
            if (select.value !== entry.value) {
                select.value = entry.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            input.value = entry.text;
            input.classList.remove('pcc-ugs-nomatch');
            hidePanel();
        }

        function renderPanel() {
            while (panel.firstChild) panel.removeChild(panel.firstChild);
            matches.forEach(function (entry, index) {
                var item = document.createElement('div');
                item.className = 'pcc-ugs-item' + (index === activeIndex ? ' pcc-ugs-active' : '');
                renderItemText(item, entry.text);
                // mousedown, not click: it fires before the input loses
                // focus, so the panel is still open when the pick lands.
                item.addEventListener('mousedown', function (event) {
                    event.preventDefault();
                    pick(entry);
                });
                panel.appendChild(item);
            });
            panel.style.display = matches.length ? '' : 'none';
        }

        function applyFilter() {
            var term = input.value.trim().toLowerCase();
            lastTerm = term;
            if (!term) {
                input.classList.remove('pcc-ugs-nomatch');
                matches = [];
                hidePanel();
                renderPanel();
                return;
            }
            matches = master.filter(function (entry) {
                return entry.text.toLowerCase().indexOf(term) !== -1;
            });
            activeIndex = matches.length ? 0 : -1;
            input.classList.toggle('pcc-ugs-nomatch', !matches.length);
            renderPanel();
        }

        function moveActive(delta) {
            if (!matches.length) return;
            activeIndex = (activeIndex + delta + matches.length) % matches.length;
            renderPanel();
            var activeEl = panel.children[activeIndex];
            if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
        }

        input.addEventListener('input', applyFilter);
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                input.value = '';
                applyFilter();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveActive(1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveActive(-1);
            } else if (event.key === 'Enter') {
                event.preventDefault(); // never submit the user form from here
                if (activeIndex >= 0 && matches[activeIndex]) pick(matches[activeIndex]);
            }
        });
        input.addEventListener('blur', function () {
            // Delayed so a mousedown pick still lands first.
            window.setTimeout(hidePanel, 150);
        });
    }

    // Server-rendered page: the select exists at load, so a bounded boot
    // is the only machinery needed.
    var tries = 0;
    function start() {
        var select = document.getElementById(SELECT_ID);
        if (!select) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) window.setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        enhance(select);
    }

    start();
})();
