// @file_name = Geckoboard_Full_Numbers.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-13
// @created = 2026-10-13 14:05

// ==UserScript==
// @name         Geckoboard Full Numbers
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-13
// @description  Shows numbers in Geckoboard table widgets in full instead of cut off with an ellipsis ("1,6..." becomes "1,623"). The number cells are right-aligned and have room to their left that Geckoboard does not use, so a number that does not fit now extends into that space instead of being shortened. Left-aligned cells (names) keep their normal shortening, and Geckoboard's own column widths are left as they are. The shared page only frames the dashboard, which loads from app.geckoboard.com, so the script runs there too. Pure CSS: no observers, no polling, works for every table on the dashboard including ones that load or refresh later.
// @author       Kardo Rostam
// @match        https://share.geckoboard.com/dashboards/*
// @match        https://app.geckoboard.com/v5/dashboards/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Geckoboard/Geckoboard_Full_Numbers.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Geckoboard/Geckoboard_Full_Numbers.user.js
// ==/UserScript==

(function () {
    'use strict';

    // INTERNAL SETTINGS
    // A table cell is td > div.mixedCell---x > div.content---x, where the
    // content box is absolutely positioned, full width, nowrap, overflow
    // hidden and text-overflow: ellipsis. A spacer beside it takes part of
    // the cell, so a four-digit number no longer fits and is drawn as
    // "1,6...". The class names end in a build hash (---b16c7) that can
    // change when Geckoboard deploys, so only the stable start of each
    // name is matched.
    //
    // For right-aligned content the overflow is made visible and the box
    // becomes a flex row aligned to its end: content that is too wide then
    // grows to the LEFT, into the empty part of the cell, instead of being
    // cut on the right. The number itself is split over several spans
    // (digits, separator, digits), which stay on one line as flex items.
    var STYLE_ID = 'geckoboard-full-numbers-style';

    if (document.getElementById(STYLE_ID)) return;

    var content = '[class*="content---"][class*="rightAligned---"]';

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
        content + ' {',
        '    display: flex !important;',
        '    justify-content: flex-end !important;',
        '    overflow: visible !important;',
        '    text-overflow: clip !important;',
        '}',
        // The cell and its wrapper must not clip the number either.
        'td:has(> [class*="mixedCell---"] > ' + content + '),',
        'th:has(> [class*="mixedCell---"] > ' + content + '),',
        '[class*="mixedCell---"]:has(> ' + content + ') {',
        '    overflow: visible !important;',
        '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
})();
