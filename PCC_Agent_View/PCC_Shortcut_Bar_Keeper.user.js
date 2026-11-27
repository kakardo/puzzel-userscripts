// ==UserScript==
// @name         PCC Shortcut Bar Keeper
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-11-27
// @description  Keeps the shortcut bar at the top of the agent application (and the PCC Request Alert settings and sound) when the browser cache or site data is cleared. These are the only ones kept in the browser's site storage, which a clear wipes; the application's own settings (softphone, ringtone and the rest) are saved on Puzzel's server and survive a clear by themselves. A copy of only these (never sign-in data) is kept in Tampermonkey's own storage, which survives a clear, and updated when you leave or switch away from the page. After a clear, once you are signed in again, the missing settings are put back and the page reloads once so the application picks them up. Settings are kept per agent account, so another account in the same browser never gets yours. No polling: a check when the page opens and a few bounded checks while you sign in.
// @author       Kardo Rostam
// @match        https://app.puzzel.com/agent*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Agent_View/PCC_Shortcut_Bar_Keeper.user.js
// ==/UserScript==

// @created = 2026-11-18 09:12
// @note = run-at document-start on purpose: settings are put back before the agent application reads them, so a restore often needs no reload.

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    // The application's own keys start with "puzzel_agent(<version>).<account>:".
    // These endings are kept (the part after the colon).
    // Only what was checked to be stored in the browser: changing the
    // application's settings (softphone and the rest) sends them to
    // Puzzel's server and changes nothing here.
    var KEEP_APP = [
        /^shortcuts_order$/                // the shortcut bar
    ];
    // Keys without that start that are kept as they are.
    var KEEP_PLAIN = [
        'pcc-request-alert-settings',      // PCC Request Alert's settings
        'pcc-request-alert-file'           // and its own sound
    ];

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var STORE_KEY = 'pccShortcutBarKeeper';
    var RELOADED_KEY = 'pcc-shortcut-bar-keeper-reloaded';
    var APP_KEY_RE = /^puzzel_agent\([^)]*\)\.(\d+):(.+)$/;
    // Sign-in data is never copied, whatever a pattern above says.
    var NEVER_RE = /token|claims|msal|auth|azure|oneidentity|config/i;
    // While you sign in after a clear, the application writes its keys a
    // little later; checked again at these moments, then never.
    var RETRY_MS = [1500, 4000, 10000, 20000];
    var LOG = '[PCC Shortcut Bar Keeper]';

    function readStore() {
        var data = null;
        try { data = GM_getValue(STORE_KEY, null); } catch (_) { data = null; }
        return data && typeof data === 'object' ? data : { accounts: {}, plain: {} };
    }

    function writeStore(data) {
        try { GM_setValue(STORE_KEY, data); } catch (_) { /* storage blocked */ }
    }

    function keptApp(rest) {
        return !NEVER_RE.test(rest) && KEEP_APP.some(function (re) { return re.test(rest); });
    }

    // The application's key start for the signed-in account, from any key
    // it has written ("puzzel_agent(0.11.0).123456:"), or null.
    function appPrefix() {
        for (var i = 0; i < localStorage.length; i += 1) {
            var match = (localStorage.key(i) || '').match(APP_KEY_RE);
            if (match) return { prefix: localStorage.key(i).slice(0, localStorage.key(i).length - match[2].length), account: match[1] };
        }
        return null;
    }

    // BACKUP
    // Merged into the copy, never thinned: a setting that is missing right
    // now (a clear before the restore ran) never removes the kept one.
    function backup() {
        var data = readStore();
        var before = JSON.stringify(data);
        for (var i = 0; i < localStorage.length; i += 1) {
            var key = localStorage.key(i) || '';
            var value = localStorage.getItem(key);
            if (value === null) continue;
            var match = key.match(APP_KEY_RE);
            if (match && keptApp(match[2])) {
                data.accounts[match[1]] = data.accounts[match[1]] || {};
                data.accounts[match[1]][match[2]] = value;
            } else if (KEEP_PLAIN.indexOf(key) !== -1 && !NEVER_RE.test(key)) {
                data.plain[key] = value;
            }
        }
        if (JSON.stringify(data) !== before) writeStore(data);
    }

    // RESTORE
    // Missing settings are written back. Settings of the application only
    // count once it has shown which account is signed in; the page then
    // reloads once (per tab session) so the application reads them.
    function restore() {
        var data = readStore();
        var put = 0;
        Object.keys(data.plain || {}).forEach(function (key) {
            if (localStorage.getItem(key) === null) {
                localStorage.setItem(key, data.plain[key]);
                put += 1;
            }
        });
        var current = appPrefix();
        var appPut = 0;
        var mine = current && data.accounts && data.accounts[current.account];
        if (mine) {
            Object.keys(mine).forEach(function (rest) {
                if (!keptApp(rest)) return;
                var key = current.prefix + rest;
                if (localStorage.getItem(key) === null) {
                    localStorage.setItem(key, mine[rest]);
                    appPut += 1;
                }
            });
        }
        if (put + appPut) console.info(LOG, 'put back ' + (put + appPut) + ' setting(s) after a cleared cache.');
        return { app: appPut, plain: put, signedIn: !!current };
    }

    function reloadOnce() {
        try {
            if (sessionStorage.getItem(RELOADED_KEY)) return;
            sessionStorage.setItem(RELOADED_KEY, '1');
        } catch (_) { return; }
        window.location.reload();
    }

    // BOOT
    try {
        var first = restore();
        // Before the application has started nothing needs a reload: it
        // reads the settings put back just now. Signed out (after a clear),
        // the account shows up later, so it is checked again then.
        if (!first.signedIn) {
            RETRY_MS.forEach(function (ms) {
                window.setTimeout(function () {
                    var later = restore();
                    if (later.app) reloadOnce();
                }, ms);
            });
        }
    } catch (err) {
        console.warn(LOG, 'restore failed', err);
    }

    // Kept up to date when you leave or switch away from the page, and
    // once shortly after it has opened.
    function safeBackup() {
        try { backup(); } catch (err) { console.warn(LOG, 'backup failed', err); }
    }
    window.addEventListener('pagehide', safeBackup);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') safeBackup();
    });
    window.setTimeout(safeBackup, 15000);
})();
