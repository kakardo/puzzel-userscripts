// @file_name = PCM_Dark_Mode_(Ticket,_Org,_Customer_Background).user.js
// @author = Kardo Rostam
// @version = 1.3_2026-08-27
// @created = 2026-03-25 (v1.1)

// ==UserScript==
// @name         PCM Dark Mode (Ticket, Org, Customer Background)
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.3_2026-08-27
// @description  Paints only the page background black on ticket detail pages, customers, and organisations pages.
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

  GM_addStyle(`
    html,
    body,
    #main,
    #content,
    .page-content,
    section#widget-grid,
    .page-footer,
    footer {
      background: #000000 !important;
      background-image: none !important;
    }

    body::before,
    body::after,
    #main::before,
    #main::after,
    #content::before,
    #content::after {
      background: transparent !important;
      background-image: none !important;
    }

    /* Keep actual modules/panels untouched so information is never covered */
    .jarviswidget,
    .jarviswidget > div,
    .widget-body,
    .widget-body-color,
    .panel,
    .panel-body,
    .panel-content,
    .panel-container,
    .panel-grid,
    .module,
    .module-content,
    .smart-form,
    .tab-content,
    .form-horizontal,
    .form-group,
    .row,
    .col,
    [class*="col-"] {
      background-image: initial !important;
    }
  `);
})();