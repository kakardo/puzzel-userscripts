// @file_name = PCM_Hide_Columns.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-08-28
// @created = 2026-08-28 08:30

// ==UserScript==
// @name         PCM Hide Columns
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-08-28
// @description  Adds a Hide Columns button beside Reset Column Sorting with a checkbox panel per column. Hidden columns persist in localStorage; FORCE_HIDDEN at the top overrides both and shows as locked in the panel. Event-driven: reapplies on DataTables re-init, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @match        https://puzzel.cm.puzzel.com/tickets?*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Hide_Columns.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Hide_Columns.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     * Columns hidden by config. These override the menu and localStorage
     * and show as locked entries in the panel. Use the exact header text.
     * The two unnamed columns are 'Details' (green plus) and 'Select'
     * (grey circle).
     * Example: var FORCE_HIDDEN = ['Tags', 'Issue Key'];
     ******************************************************************/
    var FORCE_HIDDEN = [];

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var STORAGE_KEY = 'pcm-hidden-columns';
    var BUTTON_ID = 'pcm-hide-columns-btn';
    var PANEL_ID = 'pcm-hide-columns-panel';
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 500;

    function getApi() {
        var $ = window.jQuery;
        if (!$ || !$.fn || !$.fn.dataTable) return null;
        var nodes = $.fn.dataTable.tables();
        if (!nodes || !nodes.length) return null;
        var node = null;
        for (var i = 0; i < nodes.length; i++) {
            if ((nodes[i].className || '').indexOf('tickets-datatable') !== -1) { node = nodes[i]; break; }
        }
        if (!node) node = nodes[0];
        return $(node).DataTable();
    }

    function columnLabel(api, idx) {
        var header = api.column(idx).header();
        var text = header ? header.textContent.trim() : '';
        if (text) return text;
        var cls = header ? header.className : '';
        if (cls.indexOf('details-control') !== -1) return 'Details';
        if (cls.indexOf('select-control') !== -1) return 'Select';
        return 'Column ' + idx;
    }

    function loadStored() {
        try {
            var v = JSON.parse(localStorage.getItem(STORAGE_KEY));
            return Array.isArray(v) ? v : [];
        } catch (e) {
            return [];
        }
    }

    function saveStored(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    // Map of label -> 'forced' or 'user'. FORCE_HIDDEN wins over localStorage.
    function hiddenSet() {
        var set = {};
        loadStored().forEach(function (n) { set[n] = 'user'; });
        FORCE_HIDDEN.forEach(function (n) { set[n] = 'forced'; });
        return set;
    }

    function applyVisibility() {
        var api = getApi();
        if (!api) return;
        var set = hiddenSet();
        var changed = false;
        api.columns().every(function (idx) {
            var label = columnLabel(api, idx);
            var shouldBeVisible = !set[label];
            if (this.visible() !== shouldBeVisible) {
                this.visible(shouldBeVisible, false);
                changed = true;
            }
        });
        if (changed) {
            api.columns.adjust().draw(false);
        }
    }

    function removePanel() {
        var p = document.getElementById(PANEL_ID);
        if (p) p.parentNode.removeChild(p);
        document.removeEventListener('mousedown', outsideClose);
    }

    function outsideClose(e) {
        var panel = document.getElementById(PANEL_ID);
        var btn = document.getElementById(BUTTON_ID);
        if (!panel) return;
        if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
        removePanel();
    }

    function buildPanel(btn) {
        var api = getApi();
        if (!api) return;
        var set = hiddenSet();

        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = 'position:absolute; z-index:99999; background:rgb(35,43,61);' +
            ' border:1px solid rgba(255,255,255,0.15); border-radius:4px; padding:8px 10px;' +
            ' color:rgb(230,233,239); font-size:12px; max-height:420px; overflow-y:auto;' +
            ' box-shadow:0 4px 12px rgba(0,0,0,0.4); min-width:220px;';

        api.columns().indexes().each(function (idx) {
            var label = columnLabel(api, idx);
            var row = document.createElement('label');
            row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:3px 0;' +
                ' cursor:pointer; white-space:nowrap; user-select:none;';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !set[label];
            if (set[label] === 'forced') {
                cb.disabled = true;
                row.style.opacity = '0.5';
                row.style.cursor = 'default';
                row.title = 'Hidden by script config, edit FORCE_HIDDEN to change';
            }

            cb.addEventListener('change', function () {
                var stored = loadStored();
                var pos = stored.indexOf(label);
                if (cb.checked && pos !== -1) stored.splice(pos, 1);
                if (!cb.checked && pos === -1) stored.push(label);
                saveStored(stored);
                applyVisibility();
            });

            var span = document.createElement('span');
            span.textContent = label + (set[label] === 'forced' ? ' (script)' : '');

            row.appendChild(cb);
            row.appendChild(span);
            panel.appendChild(row);
        });

        document.body.appendChild(panel);
        var rect = btn.getBoundingClientRect();
        panel.style.left = (rect.left + window.scrollX) + 'px';
        panel.style.top = (rect.bottom + window.scrollY + 4) + 'px';

        setTimeout(function () {
            document.addEventListener('mousedown', outsideClose);
        }, 0);
    }

    function togglePanel(btn) {
        if (document.getElementById(PANEL_ID)) {
            removePanel();
        } else {
            buildPanel(btn);
        }
    }

    function ensureButton() {
        if (document.getElementById(BUTTON_ID)) return;

        var anchors = document.querySelectorAll('div.dt-buttons a.dt-button');
        var resetBtn = null;
        for (var i = 0; i < anchors.length; i++) {
            if ((anchors[i].textContent || '').indexOf('Reset Column Sorting') !== -1) {
                resetBtn = anchors[i];
                break;
            }
        }
        if (!resetBtn) return;

        var btn = document.createElement('a');
        btn.id = BUTTON_ID;
        btn.className = 'dt-button';
        btn.tabIndex = 0;
        btn.title = 'Show or hide columns in the tickets list';
        var span = document.createElement('span');
        span.textContent = 'Hide Columns';
        btn.appendChild(span);
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            togglePanel(btn);
        });

        resetBtn.parentNode.insertBefore(btn, resetBtn);
    }

    function hookReinit() {
        var $ = window.jQuery;
        if (!$ || !$.fn || !$.fn.dataTable) return;
        // Event-driven reapply: fires when the table is reinitialised. The
        // Auto Refresh soft reload keeps the DataTable instance alive, so
        // no polling is needed between refresh cycles.
        $(document).on('init.dt', function () {
            setTimeout(function () {
                applyVisibility();
                ensureButton();
            }, 100);
        });
    }

    // Bounded boot: full page loads restart the script, so there is nothing
    // to poll for once the table exists (or was never going to exist).
    var tries = 0;
    function start() {
        var api = getApi();
        if (!api) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        hookReinit();
        applyVisibility();
        ensureButton();
    }

    start();
})();
