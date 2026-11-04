// @file_name = PCM_Dark_Mode_(Ticket,_Org,_Customer_Background).user.js
// @author = Kardo Rostam
// @version = 1.4_2026-11-04
// @created = 2026-03-25 (v1.1)

// ==UserScript==
// @name         PCM Dark Mode (Ticket, Org, Customer Background)
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.4_2026-11-04
// @description  Paints only the page background black on ticket detail pages, customers, and organisations pages. Follows the dark mode toggle of PCM Dark Mode (Ticket List), which is shown on these pages too: switched off, the pages stay light. Without that script the background is always dark.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @match        https://puzzel.cm.puzzel.com/customers*
// @match        https://puzzel.cm.puzzel.com/organisations*
// @run-at       document-idle
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/Dark_Mode/PCM_Dark_Mode_(Ticket,_Org,_Customer_Background).user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/Dark_Mode/PCM_Dark_Mode_(Ticket,_Org,_Customer_Background).user.js
// ==/UserScript==

(() => {
  'use strict';

  // Follows the dark mode toggle of PCM Dark Mode (Ticket List): it marks
  // the page data-pz-dark-mode="on" or "off" on every PCM page. The
  // background is dark unless the mark says off, so without that script
  // installed it stays dark as before.
  const ON = 'html:not([data-pz-dark-mode="off"])';

  GM_addStyle(`
    ${ON},
    ${ON} body,
    ${ON} #main,
    ${ON} #content,
    ${ON} .page-content,
    ${ON} section#widget-grid,
    ${ON} .page-footer,
    ${ON} footer {
      background: #000000 !important;
      background-image: none !important;
    }
    ${ON} body::before,
    ${ON} body::after,
    ${ON} #main::before,
    ${ON} #main::after,
    ${ON} #content::before,
    ${ON} #content::after {
      background: transparent !important;
      background-image: none !important;
    }

    /* Keep actual modules/panels untouched so information is never covered */
    ${ON} .jarviswidget,
    ${ON} .jarviswidget > div,
    ${ON} .widget-body,
    ${ON} .widget-body-color,
    ${ON} .panel,
    ${ON} .panel-body,
    ${ON} .panel-content,
    ${ON} .panel-container,
    ${ON} .panel-grid,
    ${ON} .module,
    ${ON} .module-content,
    ${ON} .smart-form,
    ${ON} .tab-content,
    ${ON} .form-horizontal,
    ${ON} .form-group,
    ${ON} .row,
    ${ON} .col,
    ${ON} [class*="col-"] {
      background-image: initial !important;
    }
  `);
})();