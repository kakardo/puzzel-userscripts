// @file_name = PCC_Request_Alert.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-06
// @created = 2026-10-06 13:56

// ==UserScript==
// @name         PCC Request Alert
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-06
// @description  Alerts you when your status leaves Ready (a call or chat was offered or accepted), and optionally when a new chat request arrives (the + in "(0+)"). Ringtone with volume, built-in tones or your own sound, plus optional desktop notification, flashing tab title and screen flash. Settings in the code and under the main menu (the three lines, top left). Changing your status yourself does not trigger it. A bell (under the main menu icon, next to your status, or hidden) and a switch in the settings turn it on and off.
// @author       Kardo Rostam
// @match        https://app.puzzel.com/agent/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Agent_View/PCC_Request_Alert.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Agent_View/PCC_Request_Alert.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // Defaults. Anything changed in the menu (Main menu > Request alert
    // settings) is saved in this browser and wins over these values.
    // "Reset to defaults" in the menu goes back to what is written here.
    var DEFAULTS = {
        // Alerts on or off. The bell next to your status and the switch
        // in the menu both change this, and it stays that way after reload.
        enabled: true,
        bellPlace: 'burger',     // where the bell is: 'burger' (under the
                                 // main menu icon), 'status' (next to your
                                 // status) or 'hidden'

        // What starts an alert
        onLeaveReady: true,      // status goes from Ready to anything else
        onChatRequest: false,    // a + appears, e.g. "(0)" becomes "(0+)"

        // How you are alerted
        sound: true,             // ringtone
        desktop: false,          // Windows notification
        titleFlash: false,       // tab title flashes
        screenFlash: false,      // coloured border pulses around the page

        // Ringtone: 'phone', 'beeps', 'chime', 'alarm' or 'custom'
        tone: 'phone',
        customUrl: '',           // link to an audio file, used when tone is 'custom'
        volume: 70,              // 0 to 100

        // When it stops (whichever comes first)
        seconds: 30,             // 0 means no time limit
        stopOnActivity: true,    // a click or key press anywhere on the page
        stopWhenResolved: true,  // back to Ready, or the + goes away
        popup: true,             // a popup with a Stop button while it rings

        flashColor: '#ff3b30'
    };

    // Status names that count as Ready (add translations if your agent
    // app is in another language).
    var READY_NAMES = ['Ready'];

    // A status change within this many ms after you used the status menu
    // is treated as your own change and does not alert.
    var MANUAL_GRACE_MS = 10000;

    // INTERNAL SETTINGS
    var LOG = '[Request Alert]';
    var KEY = 'pcc-request-alert-settings';
    var FILE_KEY = 'pcc-request-alert-file';
    var MAX_FILE_BYTES = 1500000;
    var STYLE_ID = 'pcc-request-alert-style';
    var PANEL_ID = 'pcc-request-alert-panel';
    var FLASH_ID = 'pcc-request-alert-flash';
    var POPUP_ID = 'pcc-request-alert-popup';
    var MENU_MARK = 'data-pcc-request-alert';
    var TOGGLE_ID = 'pcc-request-alert-toggle';

    var TONES = {
        // Each tone: cycle length in seconds and notes [start, length, freqs, type]
        phone: { cycle: 2.0, notes: [[0, 0.4, [440, 480], 'sine'], [0.6, 0.4, [440, 480], 'sine']] },
        beeps: { cycle: 1.2, notes: [[0, 0.12, [880], 'square'], [0.2, 0.12, [880], 'square'], [0.4, 0.12, [880], 'square']] },
        chime: { cycle: 2.0, notes: [[0, 0.5, [660], 'sine'], [0.25, 0.5, [880], 'sine'], [0.5, 0.9, [1320], 'sine']] },
        alarm: { cycle: 1.0, notes: [[0, 0.25, [700], 'sawtooth'], [0.5, 0.25, [1000], 'sawtooth']] }
    };
    var TONE_NAMES = { phone: 'Phone ring', beeps: 'Beeps', chime: 'Chime', alarm: 'Alarm', custom: 'Own sound' };

    // SETTINGS STORE
    function loadSettings() {
        var saved = {};
        try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { saved = {}; }
        var s = {};
        Object.keys(DEFAULTS).forEach(function (k) {
            s[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : DEFAULTS[k];
        });
        return s;
    }

    var settings = loadSettings();

    function saveSettings() {
        var diff = {};
        Object.keys(DEFAULTS).forEach(function (k) {
            if (settings[k] !== DEFAULTS[k]) diff[k] = settings[k];
        });
        try { localStorage.setItem(KEY, JSON.stringify(diff)); } catch (e) { console.warn(LOG, 'could not save settings', e); }
    }

    function savedFile() {
        try { return localStorage.getItem(FILE_KEY) || ''; } catch (_) { return ''; }
    }

    // SOUND
    // Browsers only allow sound after the page has been clicked once
    // since it loaded. After that the page may play sound for as long as
    // it stays open. The audio engine is created on the first click or
    // key press and put to sleep straight away; it only runs while an
    // alert plays, so it does not use power the rest of the day.
    var audioCtx = null;
    var pageActivated = false;
    var suspendTimer = null;
    var master = null;
    var toneTimer = null;
    var customNode = null;
    var customCache = { src: '', buffer: null };
    var soundRun = 0; // bumps on every start and stop, so a late load is ignored

    function ctx() {
        if (!audioCtx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            audioCtx = new AC();
            master = audioCtx.createGain();
            master.connect(audioCtx.destination);
        }
        return audioCtx;
    }

    function gainFor(volume) {
        var v = Math.max(0, Math.min(100, Number(volume) || 0)) / 100;
        return v * v; // closer to how loudness is heard
    }

    function applyVolume() {
        if (master) master.gain.value = gainFor(settings.volume);
    }

    function soundAllowed() {
        var ua = navigator.userActivation;
        return pageActivated || !!(ua && ua.hasBeenActive);
    }

    function unlockAudio() {
        if (pageActivated) return;
        pageActivated = true;
        var c = ctx();
        if (c && !toneTimer && !customNode && c.state === 'running') c.suspend().catch(function () {});
        updateSoundNote();
    }

    function wakeAudio(c) {
        if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = null; }
        if (c.state !== 'running') c.resume().catch(function () {});
    }

    // Waits a moment so the last notes can finish, then sleeps.
    function sleepAudio() {
        if (suspendTimer) clearTimeout(suspendTimer);
        suspendTimer = setTimeout(function () {
            suspendTimer = null;
            if (audioCtx && !toneTimer && !customNode && audioCtx.state === 'running') {
                audioCtx.suspend().catch(function () {});
            }
        }, 1500);
    }

    function playCycle(tone) {
        var c = audioCtx;
        var t0 = c.currentTime + 0.02;
        tone.notes.forEach(function (n) {
            var start = t0 + n[0];
            var len = n[1];
            var env = c.createGain();
            env.gain.setValueAtTime(0, start);
            env.gain.linearRampToValueAtTime(0.3, start + 0.015);
            env.gain.setValueAtTime(0.3, start + len - 0.03);
            env.gain.linearRampToValueAtTime(0, start + len);
            env.connect(master);
            n[2].forEach(function (f) {
                var o = c.createOscillator();
                o.type = n[3];
                o.frequency.value = f;
                o.connect(env);
                o.start(start);
                o.stop(start + len + 0.01);
            });
        });
    }

    // Your own sound is decoded and played through the same audio path
    // as the built-in tones. The agent app does not allow audio players
    // to load saved files or links (its security policy), but this way
    // is not affected. A saved file is decoded from storage; a link is
    // downloaded, which works only if the site serving it allows that.
    function base64ToBuffer(dataUrl) {
        var bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
    }

    function loadCustom(src) {
        if (customCache.src === src && customCache.buffer) return Promise.resolve(customCache.buffer);
        var c = ctx();
        if (!c) return Promise.reject(new Error('no audio support'));
        var raw = src.indexOf('data:') === 0
            ? Promise.resolve(base64ToBuffer(src))
            : fetch(src).then(function (r) {
                if (!r.ok) throw new Error('download failed (' + r.status + ')');
                return r.arrayBuffer();
            });
        return raw.then(function (buf) {
            return new Promise(function (resolve, reject) { c.decodeAudioData(buf, resolve, reject); });
        }).then(function (buffer) {
            customCache = { src: src, buffer: buffer };
            return buffer;
        });
    }

    function playTone(tone) {
        playCycle(tone);
        toneTimer = setInterval(function () { playCycle(tone); }, tone.cycle * 1000);
    }

    function startSound() {
        stopSound();
        var run = soundRun;
        var c = ctx();
        if (!c) return;
        wakeAudio(c);
        applyVolume();
        var src = settings.tone === 'custom' ? (settings.customUrl || savedFile()) : '';
        if (!src) {
            playTone(TONES[settings.tone] || TONES.phone);
            return;
        }
        loadCustom(src).then(function (buffer) {
            if (run !== soundRun) return;
            customNode = c.createBufferSource();
            customNode.buffer = buffer;
            customNode.loop = true;
            customNode.connect(master);
            customNode.start();
        }, function (e) {
            if (run !== soundRun) return;
            // Never stay silent: fall back to the phone ring.
            console.warn(LOG, 'own sound could not be played, using the phone ring instead.', e);
            playTone(TONES.phone);
        });
    }

    function stopSound() {
        soundRun++;
        if (toneTimer) { clearInterval(toneTimer); toneTimer = null; }
        if (customNode) { try { customNode.stop(); } catch (_) {} customNode = null; }
        if (audioCtx) sleepAudio();
    }

    // VISUAL ALERTS
    var titleTimer = null;
    var titleBase = '';
    var titleAlt = '';
    var notification = null;

    function startTitle(text) {
        stopTitle();
        titleBase = document.title;
        titleAlt = '● ' + text;
        var on = false;
        titleTimer = setInterval(function () {
            on = !on;
            document.title = on ? titleAlt : titleBase;
        }, 900);
    }

    function stopTitle() {
        if (!titleTimer) return;
        clearInterval(titleTimer);
        titleTimer = null;
        if (document.title === titleAlt) document.title = titleBase;
    }

    function startFlash() {
        if (document.getElementById(FLASH_ID)) return;
        var d = document.createElement('div');
        d.id = FLASH_ID;
        d.style.setProperty('--pcc-ra-color', settings.flashColor);
        document.body.appendChild(d);
    }

    function stopFlash() {
        var d = document.getElementById(FLASH_ID);
        if (d) d.remove();
    }

    function startDesktop(text) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            notification = new Notification('Puzzel', { body: text, tag: 'pcc-request-alert', requireInteraction: true });
            notification.onclick = function () { window.focus(); stopAlert(); };
        } catch (e) { console.warn(LOG, 'notification failed', e); }
    }

    function stopDesktop() {
        if (notification) { try { notification.close(); } catch (_) {} notification = null; }
    }

    // ALERT
    var alerting = null; // { kind: 'status' | 'chat' | 'test' }
    var stopTimer = null;

    function startAlert(kind, text, seconds) {
        stopAlert();
        alerting = { kind: kind };
        if (settings.sound) startSound();
        if (settings.desktop) startDesktop(text);
        if (settings.titleFlash) startTitle(text);
        if (settings.screenFlash) startFlash();
        if (settings.popup) showPopup(text);
        if (seconds > 0) stopTimer = setTimeout(stopAlert, seconds * 1000);
        updateTestButton();
    }

    function stopAlert() {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        stopSound();
        stopTitle();
        stopFlash();
        stopDesktop();
        hidePopup();
        alerting = null;
        updateTestButton();
    }

    // POPUP
    // Shown at the top of the page while an alert runs. Stop ends this
    // alert, the other button also turns alerts off.
    function showPopup(text) {
        hidePopup();
        ensureStyle();
        var p = document.createElement('div');
        p.id = POPUP_ID;
        p.setAttribute('role', 'alertdialog');
        p.setAttribute('aria-label', 'Request alert');
        var title = document.createElement('div');
        title.className = 'pcc-ra-popup-title';
        title.textContent = text;
        var stop = document.createElement('button');
        stop.type = 'button';
        stop.textContent = 'Stop';
        stop.addEventListener('click', stopAlert);
        var off = document.createElement('button');
        off.type = 'button';
        off.className = 'pcc-ra-plain';
        off.textContent = 'Stop and turn alerts off';
        off.addEventListener('click', function () { setEnabled(false); });
        var row = document.createElement('div');
        row.className = 'pcc-ra-popup-buttons';
        row.appendChild(stop);
        row.appendChild(off);
        p.appendChild(title);
        p.appendChild(row);
        document.body.appendChild(p);
        stop.focus();
    }

    function hidePopup() {
        var p = document.getElementById(POPUP_ID);
        if (p) p.remove();
    }

    // STATUS WATCH
    // The status button text looks like "Ready (0)": a name, then the
    // number of chats, with a + when a chat request is waiting.
    var statusEl = null;
    var statusObserver = null;
    var last = null;
    var manualAt = 0;

    function findStatusEl() {
        return document.querySelector('aa-dropdown[data-auid^="status-menu"] span.status-text') ||
            document.querySelector('section.header span.status-text');
    }

    function parseStatus(text) {
        var t = (text || '').replace(/\s+/g, ' ').trim();
        var m = /^(.*?)\s*\((\d+)(\+?)\)$/.exec(t);
        var name = m ? m[1] : t;
        return {
            text: t,
            name: name,
            ready: READY_NAMES.some(function (r) { return r.toLowerCase() === name.toLowerCase(); }),
            request: !!(m && m[3])
        };
    }

    function onStatusChange() {
        if (!statusEl) return;
        var now = parseStatus(statusEl.textContent);
        var prev = last;
        if (prev && now.text === prev.text) return;
        last = now;
        if (!prev || !now.name || !settings.enabled) return;

        var mine = Date.now() - manualAt < MANUAL_GRACE_MS;
        if (settings.onLeaveReady && prev.ready && !now.ready && !mine) {
            startAlert('status', now.text, Number(settings.seconds) || 0);
        } else if (settings.onChatRequest && now.request && !prev.request) {
            startAlert('chat', 'Chat request ' + now.text, Number(settings.seconds) || 0);
        } else if (alerting && settings.stopWhenResolved &&
                   ((alerting.kind === 'status' && now.ready) || (alerting.kind === 'chat' && !now.request))) {
            stopAlert();
        }
    }

    function hookStatus() {
        var el = findStatusEl();
        if (!el || el === statusEl) return !!el;
        if (statusObserver) statusObserver.disconnect();
        statusEl = el;
        last = parseStatus(el.textContent);
        statusObserver = new MutationObserver(onStatusChange);
        statusObserver.observe(el, { childList: true, characterData: true, subtree: true });
        hookToggle();
        return true;
    }

    // ON AND OFF SWITCH
    // A bell right after the status button. Crossed out and grey when off.
    var BELL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>' +
        '<line class="pcc-ra-slash" x1="3" y1="3" x2="21" y2="21"/></svg>';

    function setEnabled(on) {
        settings.enabled = !!on;
        saveSettings();
        if (!on) stopAlert();
        updateToggle();
        updateMasterSwitch();
    }

    function updateToggle() {
        var on = !!settings.enabled;
        document.querySelectorAll('[data-pcc-ra-bell]').forEach(function (b) {
            b.classList.toggle('pcc-ra-on', on);
            b.classList.toggle('pcc-ra-off', !on);
            b.title = on ? 'Request alert is on. Click to turn it off.' : 'Request alert is off. Click to turn it on.';
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function onBellClick(e) {
        e.preventDefault();
        e.stopPropagation();
        setEnabled(!settings.enabled);
    }

    function hookToggle() {
        var b = document.getElementById(TOGGLE_ID);
        var place = settings.bellPlace;
        var statusBox = statusEl && statusEl.closest('aa-dropdown');
        var ok = place === 'burger' ? (menuRoot && b && b.parentNode === menuRoot)
            : place === 'status' ? (statusBox && b && b.previousElementSibling === statusBox)
            : !b;
        if (ok) { alignBell(); return; }
        if (b) b.remove();
        if (menuRoot && place !== 'burger') menuRoot.classList.remove('pcc-ra-bell-host');
        if (place === 'burger' ? !menuRoot : place === 'status' ? !(statusBox && statusBox.parentNode) : true) return;

        ensureStyle();
        if (!b) {
            b = document.createElement('button');
            b.id = TOGGLE_ID;
            b.type = 'button';
            b.setAttribute('data-pcc-ra-bell', '');
            b.setAttribute('aria-label', 'Request alert on or off');
            b.innerHTML = BELL;
            b.addEventListener('click', onBellClick);
        }
        b.classList.toggle('pcc-ra-under-burger', place === 'burger');
        if (place === 'burger') {
            // Outside the menu's own button, so clicking the bell does
            // not open the menu.
            menuRoot.classList.add('pcc-ra-bell-host');
            menuRoot.appendChild(b);
            alignBell();
        } else {
            b.removeAttribute('style');
            statusBox.parentNode.insertBefore(b, statusBox.nextSibling);
        }
        updateToggle();
    }

    // Under the stripes: the stripes move up and the bell goes below
    // them, so the pair together sits where the stripes were (centred in
    // the header). SPACING_PX is the distance between the two centres.
    // The bell is centred on the stripes icon, measured when placed, on
    // window resize and on the regular check.
    var SPACING_PX = 30;
    var BELL_BOX_PX = 28;

    function alignBell() {
        var b = document.getElementById(TOGGLE_ID);
        if (!b || settings.bellPlace !== 'burger' || !menuRoot) return;
        var icon = menuRoot.querySelector('a[data-aa-toggle] i.icon-main-menu') || menuRoot.querySelector('i.icon-main-menu');
        if (!icon) return;
        var ir = icon.getBoundingClientRect();
        if (!ir.width) return;
        var hr = menuRoot.getBoundingClientRect();
        var cx = ir.left + ir.width / 2 - hr.left;
        // The stripes are already moved up by half the spacing.
        var cy = ir.top + ir.height / 2 - hr.top + SPACING_PX / 2;
        var want = {
            left: Math.round(cx - BELL_BOX_PX / 2) + 'px',
            top: Math.round(cy + SPACING_PX / 2 - BELL_BOX_PX / 2) + 'px',
            width: BELL_BOX_PX + 'px',
            height: BELL_BOX_PX + 'px'
        };
        Object.keys(want).forEach(function (k) {
            if (b.style[k] !== want[k]) b.style[k] = want[k];
        });
    }

    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(alignBell, 200);
    });

    function placeBell() {
        hookToggle();
    }

    // ACTIVITY
    // Any click or key press: allows sound, stops a running alert, and
    // a click in the status menu marks the next status change as yours.
    function onActivity(e) {
        unlockAudio();
        var t = e.target;
        if (t && t.closest) {
            if (t.closest('aa-dropdown[data-auid^="status-menu"]')) manualAt = Date.now();
            if (t.closest('#' + PANEL_ID) || t.closest('#' + POPUP_ID)) return;
        }
        if (alerting && settings.stopOnActivity) stopAlert();
    }

    document.addEventListener('pointerdown', onActivity, true);
    document.addEventListener('keydown', onActivity, true);

    // MAIN MENU ENTRY
    var menuRoot = null;
    var menuObserver = null;

    function findMenuRoot() {
        var icon = document.querySelector('i.icon-main-menu');
        if (!icon) return null;
        return icon.closest('aa-dropdown') || icon.closest('div[ref="container"]');
    }

    function menuEntry(label, onClick) {
        var a = document.createElement('a');
        a.href = '#';
        a.className = 'dropdown-item';
        a.setAttribute('role', 'listitem');
        a.setAttribute('tabindex', '0');
        a.setAttribute(MENU_MARK, '');
        var text = document.createElement('div');
        text.className = 'dropdown-item-text';
        var title = document.createElement('div');
        title.className = 'title';
        title.textContent = label;
        text.appendChild(title);
        a.appendChild(text);
        a.addEventListener('click', onClick);
        return a;
    }

    function menuDivider() {
        var d = document.createElement('div');
        d.className = 'divider';
        d.setAttribute('role', 'none');
        d.setAttribute(MENU_MARK, '');
        return d;
    }

    function addMenuItem() {
        var list = menuRoot && menuRoot.querySelector('.options-content');
        if (!list || list.querySelector('[' + MENU_MARK + ']')) return;
        var items = list.querySelectorAll('a.dropdown-item');
        if (!items.length) return;

        var a = menuEntry('Request alert settings', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var close = list.querySelector('a.inside-icon');
            if (close) close.click();
            openPanel();
        });
        var after = items[items.length - 1];
        var divider = menuDivider();
        after.parentNode.insertBefore(divider, after.nextSibling);
        divider.parentNode.insertBefore(a, divider.nextSibling);
    }

    function hookMenu() {
        var root = findMenuRoot();
        if (!root || root === menuRoot) return !!root;
        if (menuObserver) menuObserver.disconnect();
        menuRoot = root;
        menuObserver = new MutationObserver(addMenuItem);
        menuObserver.observe(root, { childList: true, subtree: true });
        addMenuItem();
        hookToggle();
        return true;
    }

    // SETTINGS PANEL
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = [
            '#' + POPUP_ID + ' { position: fixed; top: 90px; left: 50%; transform: translateX(-50%); z-index: 2147483647;',
            '  background: #1b2147; color: #fff; border: 2px solid #ff3b30; border-radius: 10px;',
            '  box-shadow: 0 10px 40px rgba(0,0,0,.6); padding: 18px 22px; min-width: 320px; text-align: center; }',
            '#' + POPUP_ID + ' .pcc-ra-popup-title { font-size: 20px; font-weight: 700; margin-bottom: 14px; }',
            '#' + POPUP_ID + ' .pcc-ra-popup-buttons { display: flex; gap: 10px; justify-content: center; }',
            '#' + POPUP_ID + ' button { background: #ff3b30; color: #fff; border: 0; border-radius: 6px;',
            '  padding: 8px 22px; font-size: 15px; font-weight: 700; cursor: pointer; }',
            '#' + POPUP_ID + ' button.pcc-ra-plain { background: transparent; border: 1px solid #8a8fb3; font-weight: 400; }',
            '#' + FLASH_ID + ' { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;',
            '  border: 10px solid var(--pcc-ra-color); animation: pcc-ra-pulse 0.9s ease-in-out infinite alternate; }',
            '@keyframes pcc-ra-pulse { from { opacity: 0.15; } to { opacity: 1; } }',
            '#' + PANEL_ID + ' { position: fixed; top: 70px; left: 20px; z-index: 2147483647; width: 340px;',
            '  max-height: calc(100vh - 90px); overflow: auto; background: #1b2147; color: #fff;',
            '  border: 1px solid #6c5ce7; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.5);',
            '  font-size: 14px; line-height: 1.4; padding: 14px 16px; }',
            '#' + PANEL_ID + ' h3 { margin: 0 0 10px; font-size: 16px; }',
            '#' + PANEL_ID + ' h4 { margin: 12px 0 4px; font-size: 13px; color: #b9a8ff; text-transform: uppercase; }',
            '#' + PANEL_ID + ' label { display: flex; align-items: center; gap: 8px; margin: 4px 0; cursor: pointer; }',
            '#' + PANEL_ID + ' input[type=number], #' + PANEL_ID + ' input[type=text], #' + PANEL_ID + ' select {',
            '  background: #11163a; color: #fff; border: 1px solid #4b4f7a; border-radius: 4px; padding: 3px 6px; }',
            '#' + PANEL_ID + ' input[type=text] { width: 100%; }',
            '#' + PANEL_ID + ' input[type=range] { flex: 1; }',
            '#' + PANEL_ID + ' .pcc-ra-note { font-size: 12px; color: #c8c8e0; margin: 4px 0; }',
            '#' + PANEL_ID + ' .pcc-ra-warn { color: #ffb347; }',
            '#' + PANEL_ID + ' .pcc-ra-buttons { display: flex; gap: 8px; margin-top: 14px; }',
            '#' + PANEL_ID + ' button { background: #6c5ce7; color: #fff; border: 0; border-radius: 4px; padding: 5px 12px; cursor: pointer; }',
            '#' + PANEL_ID + ' button.pcc-ra-plain { background: transparent; border: 1px solid #6c5ce7; }',
            '#' + PANEL_ID + ' .pcc-ra-master { font-weight: 700; font-size: 15px; margin-bottom: 8px; }',
            '#' + PANEL_ID + ' .pcc-ra-switch { appearance: none; -webkit-appearance: none; position: relative; flex: none;',
            '  width: 40px; height: 22px; margin: 0; border-radius: 11px; background: #4b4f7a; cursor: pointer; transition: background .15s; }',
            '#' + PANEL_ID + ' .pcc-ra-switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;',
            '  border-radius: 50%; background: #fff; transition: left .15s; }',
            '#' + PANEL_ID + ' .pcc-ra-switch:checked { background: #00b050; }',
            '#' + PANEL_ID + ' .pcc-ra-switch:checked::after { left: 21px; }',
            '#' + TOGGLE_ID + ' { background: none; border: 0; padding: 4px; margin-left: 8px; cursor: pointer;',
            '  display: inline-flex; align-items: center; vertical-align: middle; border-radius: 4px; }',
            '#' + TOGGLE_ID + ':hover { background: rgba(255,255,255,.1); }',
            '.pcc-ra-bell-host { position: relative; }',
            '#' + TOGGLE_ID + '.pcc-ra-under-burger { position: absolute; margin: 0; padding: 0; z-index: 5; justify-content: center; }',
            '.pcc-ra-bell-host a[data-aa-toggle], .pcc-ra-bell-host a.inside-icon { position: relative; top: -' + (SPACING_PX / 2) + 'px; }',
            '[data-pcc-ra-bell].pcc-ra-on svg { color: #00b050; }',
            '[data-pcc-ra-bell].pcc-ra-off svg { color: #8a8fb3; }',
            '[data-pcc-ra-bell].pcc-ra-on .pcc-ra-slash { display: none; }'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    }

    function el(tag, props, children) {
        var e = document.createElement(tag);
        Object.keys(props || {}).forEach(function (k) {
            if (k === 'text') e.textContent = props[k];
            else if (k === 'className') e.className = props[k];
            else e.setAttribute(k, props[k]);
        });
        (children || []).forEach(function (c) { if (c) e.appendChild(c); });
        return e;
    }

    function check(key, label, onChange) {
        var box = el('input', { type: 'checkbox', 'data-key': key });
        box.checked = !!settings[key];
        box.addEventListener('change', function () {
            settings[key] = box.checked;
            saveSettings();
            if (onChange) onChange(box.checked);
        });
        return el('label', {}, [box, el('span', { text: label })]);
    }

    function masterSwitch() {
        var box = el('input', { type: 'checkbox', className: 'pcc-ra-switch', 'data-key': 'enabled' });
        box.checked = !!settings.enabled;
        box.addEventListener('change', function () { setEnabled(box.checked); });
        return el('label', { className: 'pcc-ra-master' }, [box, el('span', { className: 'pcc-ra-master-text' })]);
    }

    function bellPlaceSelect() {
        var sel = el('select', { 'data-key': 'bellPlace' });
        [['burger', 'Under the main menu icon'], ['status', 'Next to my status'], ['hidden', 'Hidden']].forEach(function (o) {
            var opt = el('option', { value: o[0], text: o[1] });
            if (settings.bellPlace === o[0]) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', function () {
            settings.bellPlace = sel.value;
            saveSettings();
            placeBell();
        });
        return sel;
    }

    function updateMasterSwitch() {
        var p = document.getElementById(PANEL_ID);
        if (!p) return;
        var on = !!settings.enabled;
        p.querySelector('input[data-key="enabled"]').checked = on;
        p.querySelector('.pcc-ra-master-text').textContent = on ? 'Alerts are on' : 'Alerts are off';
    }

    function updateSoundNote() {
        var note = document.querySelector('#' + PANEL_ID + ' .pcc-ra-sound');
        if (!note) return;
        var ok = soundAllowed();
        note.className = 'pcc-ra-note pcc-ra-sound' + (ok ? '' : ' pcc-ra-warn');
        note.textContent = ok
            ? 'Sound is allowed on this page.'
            : 'Sound only plays after you have clicked the page once since it loaded. After a reload, click anywhere before you leave.';
    }

    function updateTestButton() {
        var b = document.querySelector('#' + PANEL_ID + ' .pcc-ra-test');
        if (b) b.textContent = alerting ? 'Stop' : 'Test';
    }

    function updateToneFields() {
        var p = document.getElementById(PANEL_ID);
        if (!p) return;
        p.querySelector('.pcc-ra-custom').style.display = settings.tone === 'custom' ? '' : 'none';
        var f = p.querySelector('.pcc-ra-file-note');
        f.textContent = savedFile() ? 'A file is saved. Choosing a new one replaces it.' : 'No file saved.';
    }

    function openPanel() {
        ensureStyle();
        var old = document.getElementById(PANEL_ID);
        if (old) { old.remove(); return; }

        // Ringtone
        var tone = el('select');
        Object.keys(TONE_NAMES).forEach(function (k) {
            var o = el('option', { value: k, text: TONE_NAMES[k] });
            if (settings.tone === k) o.selected = true;
            tone.appendChild(o);
        });
        tone.addEventListener('change', function () {
            settings.tone = tone.value;
            saveSettings();
            updateToneFields();
        });

        var vol = el('input', { type: 'range', min: '0', max: '100', step: '5' });
        vol.value = settings.volume;
        var volText = el('span', { text: settings.volume + ' %' });
        vol.addEventListener('input', function () {
            settings.volume = Number(vol.value);
            volText.textContent = vol.value + ' %';
            applyVolume();
        });
        vol.addEventListener('change', saveSettings);

        var url = el('input', { type: 'text', placeholder: 'Link to an audio file (leave empty to use the file)' });
        url.value = settings.customUrl;
        url.addEventListener('change', function () {
            settings.customUrl = url.value.trim();
            saveSettings();
        });

        var file = el('input', { type: 'file', accept: 'audio/*' });
        file.addEventListener('change', function () {
            var f = file.files && file.files[0];
            if (!f) return;
            if (f.size > MAX_FILE_BYTES) {
                alert('The file is too big. Use a file under ' + Math.round(MAX_FILE_BYTES / 1000) + ' kB, or a link.');
                file.value = '';
                return;
            }
            var r = new FileReader();
            r.onload = function () {
                // Check that it is playable before saving it.
                loadCustom(r.result).then(function () {
                    try { localStorage.setItem(FILE_KEY, r.result); } catch (e) { alert('The file could not be saved: ' + e.message); }
                    updateToneFields();
                }, function () {
                    alert('This file could not be read as audio. Try an mp3 or wav file.');
                    file.value = '';
                });
            };
            r.readAsDataURL(f);
        });

        var custom = el('div', { className: 'pcc-ra-custom' }, [
            url,
            el('label', {}, [file]),
            el('div', { className: 'pcc-ra-note pcc-ra-file-note' })
        ]);

        // Duration
        var secs = el('input', { type: 'number', min: '0', max: '600', step: '5' });
        secs.value = settings.seconds;
        secs.style.width = '70px';
        secs.addEventListener('change', function () {
            settings.seconds = Math.max(0, Number(secs.value) || 0);
            secs.value = settings.seconds;
            saveSettings();
        });

        var test = el('button', { className: 'pcc-ra-test', text: 'Test' });
        test.addEventListener('click', function () {
            unlockAudio();
            if (alerting) stopAlert();
            else startAlert('test', 'Test alert', 5);
        });

        var reset = el('button', { className: 'pcc-ra-plain', text: 'Reset to defaults' });
        reset.addEventListener('click', function () {
            try { localStorage.removeItem(KEY); localStorage.removeItem(FILE_KEY); } catch (_) {}
            settings = loadSettings();
            stopAlert();
            document.getElementById(PANEL_ID).remove();
            openPanel();
        });

        var close = el('button', { className: 'pcc-ra-plain', text: 'Close' });
        close.addEventListener('click', function () {
            stopAlert();
            document.getElementById(PANEL_ID).remove();
        });

        var panel = el('div', { id: PANEL_ID }, [
            el('h3', { text: 'Request alert' }),
            masterSwitch(),
            el('label', {}, [el('span', { text: 'Bell' }), bellPlaceSelect()]),
            el('h4', { text: 'Alert me when' }),
            check('onLeaveReady', 'My status leaves Ready (call or chat)'),
            check('onChatRequest', 'A chat request arrives (the +)'),
            el('h4', { text: 'How' }),
            check('sound', 'Ringtone'),
            check('desktop', 'Desktop notification', function (on) {
                if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
                if (on && 'Notification' in window && Notification.permission === 'denied') {
                    alert('Notifications are blocked for this site. Allow them in the browser (padlock left of the address).');
                }
            }),
            check('titleFlash', 'Flashing tab title'),
            check('screenFlash', 'Screen flash'),
            el('h4', { text: 'Ringtone' }),
            el('label', {}, [tone]),
            custom,
            el('label', {}, [el('span', { text: 'Volume' }), vol, volText]),
            el('div', { className: 'pcc-ra-note pcc-ra-sound' }),
            el('h4', { text: 'Stop' }),
            el('label', {}, [el('span', { text: 'After' }), secs, el('span', { text: 'seconds (0 = no limit)' })]),
            check('stopOnActivity', 'When I click or press a key'),
            check('stopWhenResolved', 'When I am Ready again, or the + goes away'),
            check('popup', 'Show a popup with a Stop button'),
            el('div', { className: 'pcc-ra-buttons' }, [test, reset, close])
        ]);
        document.body.appendChild(panel);
        updateToneFields();
        updateSoundNote();
        updateMasterSwitch();
    }

    // BOOT
    // Looks for the status button and the main menu every second until
    // both are found (max 2 minutes), then checks every 15 seconds that
    // they are still the same elements (the app may rebuild its header).
    var tries = 0;
    var bootTimer = setInterval(function () {
        var ok = hookStatus() & hookMenu();
        if (ok || ++tries > 120) {
            clearInterval(bootTimer);
            if (!ok) console.warn(LOG, 'status button or main menu not found');
            // The status hook is checked also while the tab is hidden (a
            // call can come in then); the bell only when it is visible.
            setInterval(function () {
                if (!statusEl || !statusEl.isConnected) hookStatus();
                if (!menuRoot || !menuRoot.isConnected) hookMenu();
                if (!document.hidden) hookToggle();
            }, 15000);
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) hookToggle();
            });
        }
    }, 1000);
})();
