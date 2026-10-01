// @file_name = POS_Access_Log_Filter.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-01
// @created = 2026-10-01 15:38

// ==UserScript==
// @name         POS Access Log Filter
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-01
// @description  Adds a filter box with a Search button above the Access log table in Puzzel Organisation Settings. Type a full or partial Puzzel Id and press Enter or Search, and only the matching rows stay visible; separate several terms with commas to show rows matching any of them. Matches are case-insensitive, a counter shows how many rows match, and Escape clears the filter. The page's own Filters and table are never modified, rows are only hidden. Standalone: a bounded boot finds the table, and a MutationObserver on its body (rows only) re-applies the filter when the page reloads the list, no polling.
// @author       Kardo Rostam
// @match        https://app.puzzel.com/settings/Id/AccessLog*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Organisation_Settings/POS_Access_Log_Filter.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Organisation_Settings/POS_Access_Log_Filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    var PLACEHOLDER = 'Puzzel Id, full or part (comma separates several), then Enter';
    var COLUMN_TITLE = 'Puzzel Id';

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var WRAP_ID = 'pcc-alf-wrap';
    var INPUT_ID = 'pcc-alf-input';
    var COUNT_ID = 'pcc-alf-count';
    var BUTTON_ID = 'pcc-alf-button';
    var STYLE_ID = 'pcc-alf-style';
    var HIDDEN_CLASS = 'pcc-alf-hidden';
    var TABLE_SELECTOR = '.access-log table.table, table.table';
    var DATA_ROW_CLASS = 'outline';
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 250;

    var CSS = [
        '#' + WRAP_ID + ' {',
        '    display: flex;',
        '    align-items: center;',
        '    gap: 12px;',
        '    margin: 0 0 12px 0;',
        '}',
        '#' + INPUT_ID + ' {',
        '    flex: 1 1 auto;',
        '    max-width: 520px;',
        '    box-sizing: border-box;',
        '    padding: 8px 12px;',
        '    font-size: 14px;',
        '    border: 1px solid #c4c4cf;',
        '    border-radius: 6px;',
        '}',
        '#' + INPUT_ID + ':focus {',
        '    outline: none;',
        '    border-color: #7d5bd0;',
        '}',
        '#' + INPUT_ID + '.pcc-alf-nomatch {',
        '    border-color: #c0392b;',
        '    box-shadow: 0 0 0 1px #c0392b;',
        '}',
        '#' + BUTTON_ID + ' {',
        '    padding: 8px 20px;',
        '    font-size: 14px;',
        '    font-weight: 600;',
        '    color: #fff;',
        '    background: #5c2d82;',
        '    border: 0;',
        '    border-radius: 6px;',
        '    cursor: pointer;',
        '}',
        '#' + BUTTON_ID + ':hover {',
        '    background: #4a2269;',
        '}',
        '#' + COUNT_ID + ' {',
        '    font-size: 13px;',
        '    color: #555;',
        '    white-space: nowrap;',
        '}',
        'tr.' + HIDDEN_CLASS + ' {',
        '    display: none !important;',
        '}'
    ].join('\n');

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function clean(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    // Column of the Puzzel Id, found by header text so a reordered
    // table still works. Falls back to the first column.
    function idColumnIndex(table) {
        var wanted = COLUMN_TITLE.toLowerCase();
        var head = table.tHead ? table.tHead.rows[0] : null;
        if (!head) return 0;
        for (var i = 0; i < head.cells.length; i++) {
            if (clean(head.cells[i].textContent).toLowerCase().indexOf(wanted) === 0) return i;
        }
        return 0;
    }

    // Rows grouped per log entry: a data row (class "outline") plus any
    // rows that follow it before the next data row (details, spacers),
    // so an entry is always shown or hidden as a whole.
    function entries(table) {
        var list = [];
        var current = null;
        Array.prototype.forEach.call(table.tBodies, function (body) {
            Array.prototype.forEach.call(body.rows, function (row) {
                var isData = row.classList.contains(DATA_ROW_CLASS) || !current;
                if (isData) {
                    current = { main: row, rows: [row] };
                    list.push(current);
                } else {
                    current.rows.push(row);
                }
            });
        });
        return list;
    }

    function terms(value) {
        return value.split(',').map(function (part) {
            return clean(part).toLowerCase();
        }).filter(Boolean);
    }

    function setHidden(row, hidden) {
        if (row.classList.contains(HIDDEN_CLASS) !== hidden) row.classList.toggle(HIDDEN_CLASS, hidden);
    }

    function enhance(table) {
        if (document.getElementById(WRAP_ID)) return;
        ensureStyle();

        var wrap = document.createElement('div');
        wrap.id = WRAP_ID;

        var input = document.createElement('input');
        input.id = INPUT_ID;
        input.type = 'text';
        input.placeholder = PLACEHOLDER;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.title = 'Press Enter or Search: only rows whose Puzzel Id contains the text stay visible. Commas separate several terms. Escape, or searching with an empty box, shows all rows again.';

        var button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = 'Search';

        var count = document.createElement('span');
        count.id = COUNT_ID;

        wrap.appendChild(input);
        wrap.appendChild(button);
        wrap.appendChild(count);
        table.parentNode.insertBefore(wrap, table);

        // The filter that is currently applied. The table is only touched
        // on Search, Enter or Escape, never per keystroke: hiding and
        // showing hundreds of rows on every key press was what made it slow.
        var active = [];

        function apply() {
            active = terms(input.value);
            render();
        }

        function render() {
            var wanted = active;
            var column = idColumnIndex(table);
            var all = entries(table);
            var shown = 0;

            all.forEach(function (entry) {
                var cell = entry.main.cells[column];
                var id = clean(cell ? cell.textContent : '').toLowerCase();
                var match = !wanted.length || wanted.some(function (term) {
                    return id.indexOf(term) !== -1;
                });
                if (match) shown += 1;
                entry.rows.forEach(function (row) {
                    setHidden(row, !match);
                });
            });

            count.textContent = wanted.length ? shown + ' of ' + all.length + ' rows' : '';
            input.classList.toggle('pcc-alf-nomatch', wanted.length > 0 && shown === 0);
        }

        button.addEventListener('click', function (event) {
            event.preventDefault();
            apply();
        });
        input.addEventListener('input', function () {
            input.classList.remove('pcc-alf-nomatch');
        });
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                input.value = '';
                apply();
            } else if (event.key === 'Enter') {
                // The table sits in a form: never submit it from here.
                event.preventDefault();
                apply();
            }
        });

        // The list can be reloaded in place (Filters, sorting). Only row
        // additions and removals matter; hiding rows changes classes,
        // which this observer does not listen to, so it never feeds itself.
        Array.prototype.forEach.call(table.tBodies, function (body) {
            new MutationObserver(function () {
                if (active.length) render();
            }).observe(body, { childList: true });
        });

        input.focus();
    }

    // Server-rendered page: the table exists at load, so a bounded boot
    // is all the machinery needed to find it.
    var tries = 0;
    function start() {
        var table = document.querySelector(TABLE_SELECTOR);
        if (!table || !table.tBodies.length) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) window.setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        enhance(table);
    }

    start();
})();
