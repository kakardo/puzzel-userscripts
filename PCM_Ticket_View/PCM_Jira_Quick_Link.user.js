// @file_name = PCM_Jira_Quick_Link.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-15
// @created = 2026-10-15 14:57

// ==UserScript==
// @name         PCM Jira Quick Link
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-15
// @description  Adds a split button right of Link Issue in the Jira widget. The key half fills the field with your saved Jira key, lets PCM know it was typed (PCM enables Link Issue on a key press), waits until PCM has finished its own requests and presses Link Issue; it checks that PCM really sent the link and otherwise tries once more, then says "Press Link Issue", so one press links the ticket. The arrow on its right turns the button into a small text box: type the key and press Enter (Esc cancels); the key is remembered in this browser. With no key saved yet the button reads "Set key" and opens the text box. When another issue is linked, one press replaces it: PCM's own unlink is pressed first, and the new key is linked once PCM has finished unlinking (nothing more happens if the unlink fails). When the saved key is the one already linked, nothing is done. The button only shows while the key field is there and comes back by itself when PCM reloads the widget. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Jira_Quick_Link.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Jira_Quick_Link.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    var BUTTON_COLOUR = '#0052cc';   // Jira blue
    var EMPTY_LABEL = 'Set key';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.cleanText || !D.createVisibilityGate ||
        !D.installNavigationHooks || !D.setNativeFieldValue || !D.flashLabel) {
        console.error('[PCM Jira Quick Link] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    // From the Jira widget: the key field and PCM's own Link Issue button.
    var FIELD_ID = 'jira_issue_key';
    var LINK_ID = 'link-jira-issue';
    var WRAP_ID = 'pcm-jira-quick-link';
    var STYLE_ID = 'pcm-jira-quick-link-style';
    var KEY_STORE = 'pcm-jira-quick-key';
    var SCAN_DELAY_MS = 150;

    D.ensureStyleTag(STYLE_ID, [
        // Inside PCM's button cell, right of Link Issue; its height is set
        // to Link Issue's when placed (see ensure).
        '#' + WRAP_ID + ' {',
        '    display: inline-flex;',
        '    align-items: stretch;',
        '    margin-left: 4px;',
        '    vertical-align: top;',
        '}',
        '#' + WRAP_ID + ' button {',
        '    padding: 0 12px;',
        '    border: 1px solid rgba(0,0,0,0.25);',
        '    background: ' + BUTTON_COLOUR + ';',
        '    color: #fff;',
        '    font-size: 12px;',
        '    font-weight: 700;',
        '    line-height: 1.5;',
        '    letter-spacing: .3px;',
        '    cursor: pointer;',
        '}',
        '#' + WRAP_ID + ' button:hover {',
        '    filter: brightness(1.12);',
        '}',
        '#' + WRAP_ID + ' .pcm-jira-use {',
        '    border-radius: 3px 0 0 3px;',
        '}',
        '#' + WRAP_ID + ' .pcm-jira-edit {',
        '    padding: 0 8px;',
        '    border-left-color: rgba(255,255,255,0.45);',
        '    border-radius: 0 3px 3px 0;',
        '}',
        '#' + WRAP_ID + ' input {',
        '    width: 150px;',
        '    padding: 0 6px;',
        '    border: 1px solid ' + BUTTON_COLOUR + ';',
        '    border-radius: 3px;',
        '    font-size: 12px;',
        '    font-weight: 600;',
        '    line-height: 1.7;',
        '    text-transform: uppercase;',
        '}'
    ].join('\n'));

    // THE KEY
    function readKey() {
        try {
            return (window.localStorage.getItem(KEY_STORE) || '').trim();
        } catch (_) {
            return '';
        }
    }

    function saveKey(key) {
        savedKey = key;
        try {
            if (key) window.localStorage.setItem(KEY_STORE, key);
            else window.localStorage.removeItem(KEY_STORE);
        } catch (_) {
            // Storage blocked: the key holds until the page reloads.
        }
    }

    var savedKey = readKey();

    // LINKING
    // The key is typed into PCM's own field the way typing would, then
    // PCM's own Link Issue button is pressed, so PCM does the lookup and
    // the linking exactly as by hand.
    // PCM switches Link Issue on from a keyup on the field, so a keyup is
    // sent too (jQuery's own trigger reaches its handler for certain).
    //
    // While an issue is linked PCM keeps the field (showing that issue's
    // key) and Link Issue off. Replacing it repeats what unlinking by hand
    // does: PCM's unlink link (#unlink-jira-issue) sends DELETE
    // /jira/issues/<id> without asking, and when that answers PCM switches
    // the field and Link Issue back on. Only then is the new key linked.
    // If the unlink fails or does not finish in time, nothing more is done.
    var UNLINK_ID = 'unlink-jira-issue';
    var UNLINK_MAX_WAIT_MS = 10000;
    var busy = false;

    function linkedKey() {
        var field = document.getElementById(FIELD_ID);
        return field && field.disabled ? D.cleanText(field.value).toUpperCase() : '';
    }

    // The button's own text shows progress; a final message stays for a
    // moment and the key comes back.
    var statusTimer = 0;

    function showStatus(button, text, holdMs) {
        window.clearTimeout(statusTimer);
        button.textContent = text;
        if (holdMs) {
            statusTimer = window.setTimeout(function () { button.textContent = savedKey || EMPTY_LABEL; }, holdMs);
        }
    }

    function linkNow(button) {
        busy = true;
        showStatus(button, 'Linking…');
        // A press made while PCM is still busy (for example finishing an
        // unlink) is dropped by PCM without a request, so first wait until
        // PCM has no request running and has been quiet for a moment.
        whenIdle(function () {
            var field = document.getElementById(FIELD_ID);
            var link = document.getElementById(LINK_ID);
            if (!field || !link || field.disabled) {
                busy = false;
                showStatus(button, 'Not ready', 2000);
                return;
            }
            D.setNativeFieldValue(field, savedKey);
            var jq = window.jQuery;
            if (jq) jq(field).trigger('keyup');
            else field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            whenEnabled(link, function (ok) {
                if (!ok) {
                    busy = false;
                    showStatus(button, 'Not accepted', 2000);
                    return;
                }
                pressAndCheck(link, button, PRESS_TRIES);
            });
        });
    }

    // IDLE AND CHECKED PRESS
    // Idle: jQuery.active is 0 and stays 0 for IDLE_QUIET_MS (a real signal
    // that PCM's follow-up requests are done, not a fixed sleep). Bounded by
    // IDLE_MAX_WAIT_MS; after that the press is tried anyway.
    var IDLE_QUIET_MS = 400;
    var IDLE_MAX_WAIT_MS = 6000;
    // After a press, PCM's link request (POST /jira/issues) must go out
    // within PRESS_CHECK_MS, or the press is tried once more.
    var PRESS_TRIES = 2;
    var PRESS_CHECK_MS = 1200;

    function whenIdle(callback) {
        var jq = window.jQuery;
        var startedAt = Date.now();
        (function check() {
            var active = jq ? jq.active : 0;
            if (active === 0 || Date.now() - startedAt > IDLE_MAX_WAIT_MS) {
                window.setTimeout(function () {
                    var stillActive = jq ? jq.active : 0;
                    if (stillActive && Date.now() - startedAt <= IDLE_MAX_WAIT_MS) {
                        check();
                        return;
                    }
                    callback();
                }, IDLE_QUIET_MS);
                return;
            }
            jq(document).one('ajaxStop', check);
        })();
    }

    function pressAndCheck(link, button, triesLeft) {
        var jq = window.jQuery;
        var sent = false;

        function onSend(event, xhr, settings) {
            if (!settings || String(settings.type).toUpperCase() !== 'POST') return;
            if (/\/jira\/issues(\?|$)/.test(settings.url || '')) sent = true;
        }

        if (jq) jq(document).on('ajaxSend', onSend);
        link.click();
        window.setTimeout(function () {
            if (jq) jq(document).off('ajaxSend', onSend);
            if (sent || !jq) {
                busy = false;
                showStatus(button, 'Linked', 1500);
                return;
            }
            var again = document.getElementById(LINK_ID);
            if (triesLeft > 1 && again && !again.disabled) {
                pressAndCheck(again, button, triesLeft - 1);
                return;
            }
            busy = false;
            showStatus(button, 'Press Link Issue', 4000);
        }, PRESS_CHECK_MS);
    }

    // PCM switches Link Issue on a moment after the keyup, not at once, so
    // the press waits for its disabled attribute to go. Watched with an
    // observer on that one button, bounded by LINK_MAX_WAIT_MS.
    var LINK_MAX_WAIT_MS = 3000;

    function whenEnabled(link, callback) {
        if (!link.disabled) {
            callback(true);
            return;
        }
        var settled = false;
        var observer = new MutationObserver(function () {
            if (!link.disabled) settle(true);
        });
        var timer = window.setTimeout(function () { settle(false); }, LINK_MAX_WAIT_MS);

        function settle(ok) {
            if (settled) return;
            settled = true;
            observer.disconnect();
            window.clearTimeout(timer);
            callback(ok);
        }

        observer.observe(link, { attributes: true, attributeFilter: ['disabled', 'class'] });
    }

    function unlinkThen(button, next) {
        var jq = window.jQuery;
        var unlink = document.getElementById(UNLINK_ID);
        if (!jq || !unlink) {
            showStatus(button, 'Unlink failed', 2000);
            return;
        }
        busy = true;
        var done = false;
        var timer = 0;

        function finish(ok) {
            if (done) return;
            done = true;
            busy = false;
            window.clearTimeout(timer);
            jq(document).off('ajaxComplete', onComplete);
            if (!ok) {
                showStatus(button, 'Unlink failed', 2000);
                return;
            }
            next(button);
        }

        function onComplete(event, xhr, settings) {
            if (!settings || String(settings.type).toUpperCase() !== 'DELETE') return;
            if (!/\/jira\/issues\//.test(settings.url || '')) return;
            finish(!!xhr && xhr.status >= 200 && xhr.status < 300);
        }

        jq(document).on('ajaxComplete', onComplete);
        timer = window.setTimeout(function () { finish(false); }, UNLINK_MAX_WAIT_MS);
        showStatus(button, 'Replacing…');
        unlink.click();
    }

    function linkIssue(button) {
        if (busy) return;
        var current = linkedKey();
        if (!current) {
            linkNow(button);
            return;
        }
        if (current === savedKey) {
            showStatus(button, 'Already linked', 1500);
            return;
        }
        unlinkThen(button, linkNow);
    }

    function updateLockState(wrap) {
        var use = wrap.querySelector('.pcm-jira-use');
        if (!use) return;
        var current = linkedKey();
        var title = !savedKey ? 'Choose the Jira key this button links'
            : current === savedKey ? savedKey + ' is already linked'
            : current ? 'Replace ' + current + ' with ' + savedKey
            : 'Link ' + savedKey + ' to this ticket';
        if (use.title !== title) use.title = title;
    }

    // THE SPLIT BUTTON
    function stop(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    function fillButtons(wrap) {
        wrap.textContent = '';
        var use = document.createElement('button');
        use.type = 'button';
        use.className = 'pcm-jira-use';
        use.textContent = savedKey || EMPTY_LABEL;
        use.addEventListener('click', function (event) {
            stop(event);
            if (savedKey) linkIssue(use);
            else startEditing(wrap);
        });

        var edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'pcm-jira-edit';
        edit.textContent = '▸';
        edit.title = 'Choose the Jira key this button links';
        edit.addEventListener('click', function (event) {
            stop(event);
            startEditing(wrap);
        });

        wrap.appendChild(use);
        wrap.appendChild(edit);
        updateLockState(wrap);
    }

    function startEditing(wrap) {
        wrap.textContent = '';
        var input = document.createElement('input');
        input.type = 'text';
        input.value = savedKey;
        input.placeholder = 'e.g. INC-27';
        input.title = 'Enter saves, Esc cancels, empty clears the key';
        var finished = false;

        function finish(save) {
            if (finished) return;
            finished = true;
            if (save) saveKey(D.cleanText(input.value).toUpperCase());
            fillButtons(wrap);
        }

        input.addEventListener('click', function (event) { event.stopPropagation(); });
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                stop(event);
                finish(true);
            } else if (event.key === 'Escape') {
                stop(event);
                finish(false);
            }
        });
        input.addEventListener('blur', function () { finish(true); });

        wrap.appendChild(input);
        input.focus();
        input.select();
    }

    // PLACING THE BUTTON
    // In PCM's button cell (div.input-group-btn), right after Link Issue
    // and as tall as it, so the field row and Create Issue below keep
    // their places. Removed while the field is gone. Idempotent, so the
    // observer below never feeds itself and an open text box is never
    // rebuilt. The tooltip is refreshed here and on hover, since PCM
    // switches the field off and on without adding or removing nodes.
    function ensure() {
        var field = document.getElementById(FIELD_ID);
        var link = document.getElementById(LINK_ID);
        var wrap = document.getElementById(WRAP_ID);
        if (!field || !link || !link.parentElement) {
            if (wrap) wrap.remove();
            return;
        }
        if (!wrap) {
            wrap = document.createElement('span');
            wrap.id = WRAP_ID;
            wrap.addEventListener('mouseenter', function () { updateLockState(wrap); });
            fillButtons(wrap);
        }
        if (wrap.previousElementSibling !== link) link.insertAdjacentElement('afterend', wrap);
        var height = link.offsetHeight;
        if (height && wrap.style.height !== height + 'px') wrap.style.height = height + 'px';
        updateLockState(wrap);
    }

    var gate = D.createVisibilityGate(ensure, SCAN_DELAY_MS);

    // BOOT
    // The Jira widget loads after the page and reloads on refresh; only
    // additions are looked at, and ensure() is a few reads when nothing
    // changed.
    function start() {
        ensure();
        var root = document.getElementById('content') || document.body;
        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i += 1) {
                if (mutations[i].addedNodes.length || mutations[i].removedNodes.length) {
                    gate.schedule();
                    return;
                }
            }
        }).observe(root, { childList: true, subtree: true });
    }

    D.installNavigationHooks(function () { gate.schedule(); });
    D.bootUntil(function () { return !!document.body; }, start);
})();
