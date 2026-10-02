// @file_name = PCM_Selected_Row_Highlight.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-02
// @created = 2026-10-02 09:18
// @note = Light by default and fully working on its own. In dark mode it switches to its dark colours through the mark PCM Dark Mode (Ticket List) puts on the page root (data-pz-tickets-pagebg="on"); without that script it simply stays light.

// ==UserScript==
// @name         PCM Selected Row Highlight
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-02
// @description  Makes selected rows in the tickets list (the round checkbox) easy to see in light and dark mode: a coloured band on the left edge, a tint over the whole row, and bold text in the highlight colour. The tint is laid over the row's own colour, so SLA colours (yellow, orange, red) still show through on a selected row. Pure CSS on the class DataTables already sets on selected rows, no observers, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @match        https://puzzel.cm.puzzel.com/tickets?*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Selected_Row_Highlight.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Selected_Row_Highlight.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     * BAND is the solid edge on the left of a selected row, TINT the
     * see-through colour laid over the row, TEXT the colour of the row's
     * text and links. One set per mode. Status and priority badges keep
     * their own colours.
     ******************************************************************/
    var LIGHT = { band: '#3f6fd6', tint: 'rgba(63, 111, 214, 0.18)', text: '#16357a' };
    var DARK = { band: '#6ea0ff', tint: 'rgba(110, 160, 255, 0.22)', text: '#d6e4ff' };
    var BAND_WIDTH_PX = 5;
    var TEXT_BOLD = true;

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var STYLE_ID = 'pcm-selected-row-style';

    // The widget id gives these rules more weight than the dark mode
    // script's row colours, so the tint and band always win. The tint is a
    // background-image (a flat gradient) on top of whatever background
    // colour the row has, which is why SLA colours stay visible under it.
    var ROW = '#wid-tickets-index .dataTables_wrapper tbody tr.selected';
    var DARK_ROOT = 'html[data-pz-tickets-pagebg="on"] ';

    function rules(prefix, palette) {
        return [
            prefix + ROW + ' > td {',
            '    background-image: linear-gradient(' + palette.tint + ', ' + palette.tint + ') !important;',
            '}',
            prefix + ROW + ' > td,',
            prefix + ROW + ' > td a,',
            prefix + ROW + ' > td span:not(.label):not(.badge) {',
            '    color: ' + palette.text + ' !important;',
            TEXT_BOLD ? '    font-weight: 700 !important;' : '',
            '}',
            prefix + ROW + ' > td:first-child {',
            '    box-shadow: inset ' + BAND_WIDTH_PX + 'px 0 0 ' + palette.band + ' !important;',
            '}'
        ].join('\n');
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = rules('', LIGHT) + '\n' + rules(DARK_ROOT, DARK);
        (document.head || document.documentElement).appendChild(style);
    }

    ensureStyle();
})();
