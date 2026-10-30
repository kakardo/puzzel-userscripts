// @file_name = PCM_Quick_Email.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-30
// @created = 2026-10-30 11:27

// ==UserScript==
// @name         PCM Quick Email
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-30
// @description  Replaces PCM's Reply and Start Conversation buttons with one always-visible Email button in the Timeline header, next to Add Note, that opens a new email in one press (PCM's own buttons are hidden and pressed by the script; Forward stays). The button keeps one text and width, so the row does not jump; while it works it is dimmed and its tooltip says why. When PCM shows Reply it presses Reply; when PCM shows Start Conversation it presses its "help" option straight away, without opening the menu; when you are not assigned it first presses PCM's own Assign To Me, waits for PCM to show its buttons (at most 10 seconds) and then continues. The script only presses PCM's own controls, so the email opens exactly as by hand. If PCM does not show the buttons after assigning, the tooltip says so. Event-driven: one scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Quick_Email.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Quick_Email.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // Which Start Conversation option to use (its text, case-insensitive).
    // When none matches, the first email option is used.
    var PREFERRED_CHANNEL = 'help';
    var BUTTON_TEXT = '✉ Email';

    // INTERNAL SETTINGS
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.createVisibilityGate || !D.installNavigationHooks || !D.cleanText || !D.ensureStyleTag) {
        console.error('[PCM Quick Email] PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
        return;
    }

    // From the ticket page: Reply and every Start Conversation option are
    // a.reply-button with data-content="email" (Forward is a.forward-button
    // and is never used); they are only in the page while you are
    // assigned. PCM's own Assign To Me is button#assign-to-me.
    var EMAIL_LINK = 'a.reply-button[data-content="email"]';
    var ASSIGN_ID = 'assign-to-me';
    var BUTTON_ID = 'pcm-quick-email';
    var ASSIGN_MAX_WAIT_MS = 10000;
    var STYLE_ID = 'pcm-quick-email-style';
    var BUSY_CLASS = 'pcm-quick-email-busy';
    var SCAN_DELAY_MS = 150;
    var busy = false;

    // The Email button replaces PCM's own Reply and Start Conversation
    // buttons, which are hidden (they stay in the page, and the script
    // presses them). Forward stays. The button keeps one text and a fixed
    // minimum width, so nothing beside it moves; while it works it is
    // dimmed, and its status is in the tooltip.
    D.ensureStyleTag(STYLE_ID, [
        '#reply-buttons ' + EMAIL_LINK + ',',
        '.btn-group:has(> #start-conversation-dropdown) {',
        '    display: none !important;',
        '}',
        '#' + BUTTON_ID + ' {',
        '    min-width: 96px;',
        '    margin-left: 4px;',
        '}',
        '#' + BUTTON_ID + '.' + BUSY_CLASS + ' {',
        '    opacity: .6;',
        '    cursor: progress;',
        '}'
    ].join('\n'));

    // FINDING PCM'S EMAIL LINK
    // Reply first, then the preferred Start Conversation option, then any
    // email option. (Both are hidden by the style above, so they are found
    // by their text, not by being visible.)
    function findEmailLink() {
        var links = Array.prototype.slice.call(document.querySelectorAll(EMAIL_LINK));
        if (!links.length) return null;
        var reply = links.find(function (a) { return /^reply$/i.test(D.cleanText(a.textContent)); });
        if (reply) return reply;
        var wanted = PREFERRED_CHANNEL.toLowerCase();
        var preferred = links.find(function (a) { return D.cleanText(a.textContent).toLowerCase() === wanted; });
        return preferred || links[0];
    }

    // Waits for PCM to put an email link in the page after Assign To Me,
    // watching only for added nodes, bounded by ASSIGN_MAX_WAIT_MS.
    function whenEmailLink(callback) {
        var found = findEmailLink();
        if (found) {
            callback(found);
            return;
        }
        var done = false;
        var root = document.getElementById('content') || document.body;
        var observer = new MutationObserver(function () {
            var link = findEmailLink();
            if (link) finish(link);
        });
        var timer = window.setTimeout(function () { finish(null); }, ASSIGN_MAX_WAIT_MS);
        function finish(link) {
            if (done) return;
            done = true;
            observer.disconnect();
            window.clearTimeout(timer);
            callback(link);
        }
        observer.observe(root, { childList: true, subtree: true });
    }

    // OPENING
    var BASE_TITLE = 'Open a new email: Reply, or Start Conversation \u2192 ' + PREFERRED_CHANNEL +
        ' (assigns you first when you are not assigned)';

    function setStatus(button, working, message) {
        button.classList.toggle(BUSY_CLASS, !!working);
        button.title = message ? message + '. ' + BASE_TITLE : BASE_TITLE;
    }

    function openEmail(button) {
        if (busy) return;
        var link = findEmailLink();
        if (link) {
            link.click();
            return;
        }
        var assign = document.getElementById(ASSIGN_ID);
        if (!assign) {
            setStatus(button, false, 'No email option on this ticket');
            return;
        }
        busy = true;
        setStatus(button, true, 'Assigning you');
        assign.click();
        whenEmailLink(function (found) {
            busy = false;
            if (found) {
                setStatus(button, false, '');
                found.click();
            } else {
                setStatus(button, false, 'Could not assign you');
            }
        });
    }

    // THE BUTTON
    // In the row of PCM's Add Note button, in PCM's own button style, so it
    // is there whether or not you are assigned. It is only placed when it
    // is missing from that row: PCM redraws its buttons around it, and
    // moving it back next to Add Note every time made the row jump.
    function findAddNote() {
        var candidates = document.querySelectorAll('a.btn, button.btn');
        for (var i = 0; i < candidates.length; i += 1) {
            if (/^\+?\s*add note$/i.test(D.cleanText(candidates[i].textContent))) return candidates[i];
        }
        return null;
    }

    function ensure() {
        var addNote = findAddNote();
        var button = document.getElementById(BUTTON_ID);
        if (!addNote) return;
        if (button && button.isConnected && button.parentElement === addNote.parentElement) return;
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.id = BUTTON_ID;
            button.className = 'btn btn-primary-ruby header-btn';
            button.textContent = BUTTON_TEXT;
            button.title = BASE_TITLE;
            button.addEventListener('click', function (event) {
                event.preventDefault();
                openEmail(button);
            });
        }
        addNote.insertAdjacentElement('afterend', button);
    }

    var gate = D.createVisibilityGate(ensure, SCAN_DELAY_MS);

    // BOOT
    // PCM rebuilds the Timeline header when the ticket changes state
    // (assigned, first reply sent); only additions are looked at, and
    // ensure() is a few reads when nothing changed.
    function start() {
        ensure();
        var root = document.getElementById('content') || document.body;
        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i += 1) {
                if (mutations[i].addedNodes.length) {
                    gate.schedule();
                    return;
                }
            }
        }).observe(root, { childList: true, subtree: true });
    }

    D.installNavigationHooks(function () { gate.schedule(); });
    D.bootUntil(function () { return !!document.body; }, start);
})();
