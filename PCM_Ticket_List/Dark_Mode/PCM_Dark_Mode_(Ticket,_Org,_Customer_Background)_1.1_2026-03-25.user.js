// @file_name = PCM_Dark_Background_(Ticket_View_Customers_Organisations)_1.1_2026-03-25.user.js
// @author = Kardo Rostam
// @version = 1.1_2026-03-25
// @created = 2026-03-25 (v1.1)

// ==UserScript==
// @name         PCM Dark Mode (Ticket, Org, Customer Background)
// @namespace    https://puzzel.cm.puzzel.com/
// @version      1.1_2026-03-25
// @description  Paints only the page background black on ticket detail pages, customers, and organisations pages.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @match        https://puzzel.cm.puzzel.com/customers*
// @match        https://puzzel.cm.puzzel.com/organisations*
// @run-at       document-idle
// @grant        GM_addStyle
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