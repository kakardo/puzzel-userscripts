// @file_name = PCM_Reply_Editor_Autosize.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-08
// @created = 2026-10-08 16:37

// ==UserScript==
// @name         PCM Reply Editor Autosize
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-08
// @description  Lets the reply editor (where you write mails and notes) grow with its text instead of staying 10 rows high and scrolling. It starts at 10 rows, grows as you type, and only scrolls once the text is longer than 100 rows. Both limits are settings at the top. Pure CSS on the editor's own text area: no observers, no polling, nothing runs while you type.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Reply_Editor_Autosize.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Reply_Editor_Autosize.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // Height of the editor in rows of text: never smaller than MIN_ROWS,
    // grows with the text up to MAX_ROWS, then scrolls.
    var MIN_ROWS = 10;
    var MAX_ROWS = 100;

    // INTERNAL SETTINGS
    // The editor's text area is Summernote's .note-editable, which PCM
    // gives a fixed height inline. !important overrides that. "lh" is one
    // line of the editor's own text, so the limits follow its font size.
    var STYLE_ID = 'pcm-reply-editor-autosize-style';

    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
        '.note-editor .note-editing-area .note-editable {',
        '    height: auto !important;',
        '    min-height: ' + MIN_ROWS + 'lh !important;',
        '    max-height: ' + MAX_ROWS + 'lh !important;',
        '    overflow-y: auto !important;',
        '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
})();
