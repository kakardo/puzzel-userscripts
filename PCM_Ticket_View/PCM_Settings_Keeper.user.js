// ==UserScript==
// @name         PCM Settings Keeper
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-11-27
// @description  Keeps your PCM settings when the browser cache or site data is cleared. PCM keeps them in the browser's site storage, which a clear wipes: the widget layout on each page (order, collapsed or not, colours), the ticket list's page length and sorting (also on customer and organisation pages) and its auto-submit choice, plus the settings of PCM Jira Quick Link, PCM PostIt Quick Text, PCM Last Activity Sort, PCM Auto Refresh and the user pictures learned by PCM Timeline Preview Cleanup. A copy of only these is kept in Tampermonkey's own storage, which survives a clear, and updated when you leave or switch away from a page. After a clear, the missing ones are put back before PCM reads them, so they apply at once. Not kept: selected tickets, short-lived counts, and the settings of PCM Hide Columns and PCM Compact View, which keep their own copy. No polling: one check when a page opens.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Settings_Keeper.user.js
// ==/UserScript==

// @created = 2026-11-18 13:05
// @note = run-at document-start on purpose: settings are put back before PCM's own code reads them, so they apply on that same page load without a reload.

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    // Kept by exact name.
    var KEEP = [
        // PCM's own
        'page_length',                          // tickets per page in the list
        'autosubmit',                           // the list's auto-submit choice
        'tickets_order_key',                    // ticket list sorting
        'tickets_order_direction',
        'tickets_sort_options_changed',
        'customer_tickets_order_key',           // sorting on a customer's tickets
        'customer_tickets_order_direction',
        'organisation_tickets_order_key',       // sorting on an organisation's tickets
        'organisation_tickets_order_direction',
        // the userscripts' own
        'pcm-jira-quick-key',                   // PCM Jira Quick Link
        'pcm-postit-button-text',               // PCM PostIt Quick Text
        'pcm-last-activity-sort-order',         // PCM Last Activity Sort
        'pcmAutoRefreshEnabled',                // PCM Auto Refresh
        'pcm-timeline-preview-users'            // PCM Timeline Preview Cleanup
    ];
    // Kept by the start of the name: PCM's widget layout per page.
    var KEEP_START = [
        'jarvisWidgets_position_',
        'jarvisWidgets_settings_'
    ];

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var STORE_KEY = 'pcmSettingsKeeper';
    var LOG = '[PCM Settings Keeper]';

    function kept(key) {
        return KEEP.indexOf(key) !== -1 || KEEP_START.some(function (start) { return key.indexOf(start) === 0; });
    }

    function readStore() {
        var data = null;
        try { data = GM_getValue(STORE_KEY, null); } catch (_) { data = null; }
        return data && typeof data === 'object' ? data : {};
    }

    // BACKUP
    // Merged into the copy, never thinned: a setting missing right now
    // (a clear before the restore ran) never removes the kept one.
    function backup() {
        var data = readStore();
        var before = JSON.stringify(data);
        for (var i = 0; i < localStorage.length; i += 1) {
            var key = localStorage.key(i) || '';
            if (!kept(key)) continue;
            var value = localStorage.getItem(key);
            if (value !== null) data[key] = value;
        }
        if (JSON.stringify(data) !== before) {
            try { GM_setValue(STORE_KEY, data); } catch (_) { /* storage blocked */ }
        }
    }

    // RESTORE
    // Only missing settings are written back; one you changed since is
    // never overwritten.
    function restore() {
        var data = readStore();
        var put = 0;
        Object.keys(data).forEach(function (key) {
            if (!kept(key) || localStorage.getItem(key) !== null) return;
            localStorage.setItem(key, data[key]);
            put += 1;
        });
        if (put) console.info(LOG, 'put back ' + put + ' setting(s) after a cleared cache.');
    }

    function safely(fn, what) {
        try { fn(); } catch (err) { console.warn(LOG, what + ' failed', err); }
    }

    // BOOT
    safely(restore, 'restore');
    window.addEventListener('pagehide', function () { safely(backup, 'backup'); });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') safely(backup, 'backup');
    });
    window.setTimeout(function () { safely(backup, 'backup'); }, 15000);
})();
