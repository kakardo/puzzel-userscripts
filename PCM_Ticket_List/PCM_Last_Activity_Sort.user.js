// @file_name = PCM_Last_Activity_Sort.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-01
// @created = 2026-10-01 11:13

// ==UserScript==
// @name         PCM Last Activity Sort
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-01
// @description  Makes the Last Activity column in the tickets list sortable. The server already sorts by it (the column carries the last_activity sort name), PCM only marks it as not orderable, so this re-enables ordering on the DataTables column: click the header to sort the whole list, shift-click to add it as a sub-sort. PCM drops such a sort on reload, so a sort that includes an unlocked column is remembered in localStorage and put back after the table has loaded. More columns can be listed in UNLOCK_COLUMNS. Event-driven: reapplies on DataTables re-init, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @match        https://puzzel.cm.puzzel.com/tickets?*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Last_Activity_Sort.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Last_Activity_Sort.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     * Columns to make sortable, by exact header text. Only columns that
     * carry a server-side sort name are unlocked: without one the server
     * has nothing to sort by. Test a new entry once before relying on it,
     * since the server decides whether the name is really sortable.
     ******************************************************************/
    var UNLOCK_COLUMNS = ['Last Activity'];

    // Direction of the first click on an unlocked header. Newest first
    // is the useful default for activity times.
    var FIRST_DIRECTION = 'desc';

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 250;
    var DONE_FLAG = 'pcmSortUnlocked';
    var STORAGE_KEY = 'pcm-last-activity-sort-order';

    // The page can carry more than one jQuery copy; DataTables is
    // registered on only one of them.
    function dataTablesJq() {
        var candidates = [window.jQuery, window.$];
        for (var i = 0; i < candidates.length; i++) {
            var jq = candidates[i];
            if (jq && jq.fn && jq.fn.dataTable && (jq.fn.dataTable.settings || []).length) return jq;
        }
        return null;
    }

    function headerText(column) {
        var html = column.sTitle || (column.nTh ? column.nTh.textContent : '') || '';
        return String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function wanted(column) {
        var title = headerText(column);
        return UNLOCK_COLUMNS.some(function (name) {
            return name.trim().toLowerCase() === title;
        });
    }

    // Fallback click handler for when DataTables' own listener cannot be
    // attached: plain click sorts by this column alone, shift-click adds
    // or flips it as a sub-sort, like the native headers.
    function attachOwnListener(jq, settings, th, index) {
        var api = new jq.fn.dataTable.Api(settings);
        jq(th).on('click.pcmSortUnlock', function (event) {
            var order = api.order().slice();
            var pos = -1;
            for (var i = 0; i < order.length; i++) {
                if (order[i][0] === index) pos = i;
            }
            var current = pos === -1 ? null : order[pos][1];
            var next = current === null ? FIRST_DIRECTION : (current === 'asc' ? 'desc' : 'asc');

            if (event.shiftKey) {
                if (pos === -1) order.push([index, next]);
                else order[pos] = [index, next];
            } else {
                order = [[index, next]];
            }
            api.order(order).draw();
        });
    }

    function unlockColumn(jq, settings, column, index) {
        var th = column.nTh;
        if (!th || th.dataset[DONE_FLAG]) return false;
        if (!column.sName) {
            console.warn('PCM Last Activity Sort: "' + headerText(column) + '" has no server sort name, left as is.');
            return false;
        }

        var classes = settings.oClasses || {};
        column.bSortable = true;
        column.asSorting = FIRST_DIRECTION === 'asc' ? ['asc', 'desc'] : ['desc', 'asc'];
        // The header renderer repaints this class on every order event,
        // so setting it once keeps the sort arrows right.
        column.sSortingClass = classes.sSortable || 'sorting';

        if (classes.sSortableNone) th.classList.remove(classes.sSortableNone);
        th.classList.add(column.sSortingClass);
        th.style.cursor = 'pointer';
        th.setAttribute('tabindex', settings.iTabIndex != null ? settings.iTabIndex : 0);

        var internal = jq.fn.dataTable.ext && jq.fn.dataTable.ext.internal;
        if (internal && typeof internal._fnSortAttachListener === 'function') {
            internal._fnSortAttachListener(settings, th, index);
        } else {
            attachOwnListener(jq, settings, th, index);
        }

        th.dataset[DONE_FLAG] = '1';
        return true;
    }

    /******************************************************************
     * Remembering the sort across reloads
     * PCM restores its own saved sort on load, but drops columns it
     * considers unsortable. So whenever the sort includes an unlocked
     * column it is stored here, by server sort name rather than index,
     * and put back after the table has initialised. Sorting by other
     * columns only (or Reset Column Sorting) clears it again.
     ******************************************************************/
    function readSaved() {
        try {
            var value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
            return Array.isArray(value) ? value : null;
        } catch (_) {
            return null;
        }
    }

    function writeSaved(value) {
        try {
            if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
            else window.localStorage.removeItem(STORAGE_KEY);
        } catch (_) {
            // Storage blocked: the sort still works, it just is not remembered.
        }
    }

    function orderToSaved(settings, order) {
        var columns = settings.aoColumns || [];
        var touchesUnlocked = order.some(function (entry) {
            var column = columns[entry[0]];
            return column && column.nTh && column.nTh.dataset[DONE_FLAG];
        });
        if (!touchesUnlocked) return null;
        return order.map(function (entry) {
            var column = columns[entry[0]];
            return column && column.sName ? { name: column.sName, dir: entry[1] } : null;
        }).filter(Boolean);
    }

    function savedToOrder(settings, saved) {
        var columns = settings.aoColumns || [];
        var order = [];
        saved.forEach(function (entry) {
            for (var i = 0; i < columns.length; i++) {
                if (columns[i].sName === entry.name && columns[i].bSortable &&
                    (entry.dir === 'asc' || entry.dir === 'desc')) {
                    order.push([i, entry.dir]);
                    return;
                }
            }
        });
        return order;
    }

    function sameOrder(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    var tracked = new WeakSet();

    function restoreAndTrack(jq, settings) {
        // Keyed on the settings object: a re-initialised table keeps its
        // node but gets new settings, which must be tracked again.
        if (tracked.has(settings)) return;
        tracked.add(settings);
        var api = new jq.fn.dataTable.Api(settings);

        var saved = readSaved();
        var wantedOrder = saved ? savedToOrder(settings, saved) : [];
        var current = api.order().map(function (entry) { return [entry[0], entry[1]]; });
        if (wantedOrder.length && !sameOrder(wantedOrder, current)) {
            api.order(wantedOrder).draw();
        }

        // Tracking starts only now, so PCM's own initial order cannot
        // wipe the saved sort before it has been put back.
        jq(settings.nTable).on('order.dt', function () {
            writeSaved(orderToSaved(settings, api.order()));
        });
    }

    // Restoring before init completes would be overwritten by PCM's
    // own state restore, so wait for it when it is still running. The
    // init event fires inside the first ajax callback, where a draw is
    // rendered locally without asking the server, hence the deferral.
    function whenInitialised(jq, settings, fn) {
        if (settings._bInitComplete) fn();
        else jq(settings.nTable).one('init.dt', function () { setTimeout(fn, 0); });
    }

    function apply() {
        var jq = dataTablesJq();
        if (!jq) return false;

        jq.fn.dataTable.settings.forEach(function (settings) {
            // Server-side tables only: there the server does the sorting
            // for every ticket, which is the whole point.
            if (!settings.oFeatures || !settings.oFeatures.bServerSide) return;
            var unlocked = false;
            (settings.aoColumns || []).forEach(function (column, index) {
                if (wanted(column)) {
                    unlockColumn(jq, settings, column, index);
                    unlocked = unlocked || !!(column.nTh && column.nTh.dataset[DONE_FLAG]);
                }
            });
            if (unlocked) {
                whenInitialised(jq, settings, function () {
                    restoreAndTrack(jq, settings);
                });
            }
        });
        return true;
    }

    var hooked = false;
    function hookReinit(jq) {
        if (hooked) return;
        hooked = true;
        // A re-initialised table gets fresh column settings and header
        // cells, so unlock again. The Auto Refresh soft reload keeps the
        // instance alive and needs nothing.
        jq(document).on('init.dt', function () {
            setTimeout(apply, 0);
        });
    }

    // Bounded boot: full page loads restart the script, so there is
    // nothing to poll for once the table exists (or was never going to).
    var tries = 0;
    function start() {
        var jq = dataTablesJq();
        if (!jq) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        hookReinit(jq);
        apply();
    }

    start();
})();
