// @file_name = PCM_Dark_Mode_(Ticket_List)_5.5_2026-03-26.user.js
// @author = Kardo Rostam
// @version = 5.5_2026-03-26
// @created = 2026-03-26 (v5.5)

// ==UserScript==
// @name         PCM Dark Mode (Ticket List)
// @namespace    https://puzzel.cm.puzzel.com/
// @version      5.5_2026-03-26
// @description  Dark mode for Puzzel Tickets using stable blue stripes plus CSS-based SLA alert row colors.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @match        https://puzzel.cm.puzzel.com/tickets?*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  /******************************************************************
   * USER SETTINGS
   ******************************************************************/
  const PAGE_CANVAS_BG_HEX = '#121826';
  const PAGE_FOOTER_BG_HEX = '#0f141c';

  const ICON_LIGHT = "\u{1F31E}";
  const ICON_DARK  = "\u{1F31A}";

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const STORAGE_KEY  = 'pzTicketsDarkModeOn';
  const SCOPE_CLASS  = 'pz-dark-scope-root';
  const BTN_ID       = 'pz-darkmode-toggle';
  const WIDGET_ID    = 'wid-tickets-index';
  const PAGE_BG_ATTR = 'data-pz-tickets-pagebg';

  const FIND_ROOT_TITLE_TEXT    = 'Tickets list';
  const TABLE_WRAPPER_SELECTOR  = '#DataTables_Table_0_wrapper, .dataTables_wrapper';
  const FIND_ROOT_MAX_PARENTS   = 12;

  const BOOT_MAX_TRIES          = 30;
  const BOOT_INTERVAL_MS        = 500;

  const APPLY_DEBOUNCE_MS       = 80;
  const OBSERVER_APPLY_DELAY_MS = 120;

  const ROUTE_RETRY_MAX         = 12;
  const ROUTE_RETRY_INTERVAL_MS = 250;
  const ROUTE_RETRY_INITIAL_MS  = 80;

  const isOn  = () => GM_getValue(STORAGE_KEY, true);
  const setOn = (v) => GM_setValue(STORAGE_KEY, !!v);

  let cachedRoot = null;
  let applyTimer = null;
  let routeRetryTimer = null;

  function normalizeHex(hex, fallback) {
    if (typeof hex !== 'string') return fallback;
    const h = hex.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h)) return h;
    return fallback;
  }

  const PAGE_BG   = normalizeHex(PAGE_CANVAS_BG_HEX, '#121826');
  const FOOTER_BG = normalizeHex(PAGE_FOOTER_BG_HEX, '#0f141c');

  function findRoot() {
    const widget = document.getElementById(WIDGET_ID);
    if (widget) return widget;

    const title = document.evaluate(
      `//*[normalize-space(text())='${FIND_ROOT_TITLE_TEXT}']`,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;

    if (!title) return null;

    let el = title;
    for (let i = 0; i < FIND_ROOT_MAX_PARENTS && el; i++) {
      el = el.parentElement;
      if (!el) break;
      if (el.querySelector(TABLE_WRAPPER_SELECTOR) || el.querySelector('table')) {
        return el;
      }
    }

    return title.parentElement;
  }

  function applyScope(root) {
    document.querySelectorAll('.' + SCOPE_CLASS).forEach(x => x.classList.remove(SCOPE_CLASS));
    root.classList.add(SCOPE_CLASS);
  }

  function updateButtonLabel() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    const on = isOn();
    btn.textContent = on ? ICON_DARK : ICON_LIGHT;
    btn.setAttribute('aria-label', on ? 'Dark mode on. Click to turn off.' : 'Dark mode off. Click to turn on.');
    btn.title = on ? 'Dark mode is ON (click to turn off)' : 'Dark mode is OFF (click to turn on)';
  }

  function ensureButton() {
    if (document.getElementById(BTN_ID)) return;

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';

    btn.addEventListener('click', () => {
      setOn(!isOn());
      apply();
    });

    document.body.appendChild(btn);
    updateButtonLabel();
  }

  function applyPageCanvas(on) {
    if (on) document.documentElement.setAttribute(PAGE_BG_ATTR, 'on');
    else document.documentElement.removeAttribute(PAGE_BG_ATTR);
  }

  function apply() {
    const on = isOn();
    applyPageCanvas(on);
    updateButtonLabel();

    const root = findRoot();
    if (!root) {
      cachedRoot = null;
      return;
    }

    cachedRoot = root;
    applyScope(root);

    const jw = (root && root.closest)
      ? (root.closest('.jarviswidget') || (root.classList && root.classList.contains('jarviswidget') ? root : null))
      : null;

    root.setAttribute('data-pz-dark', on ? 'on' : 'off');
    if (jw && jw !== root) jw.setAttribute('data-pz-dark', on ? 'on' : 'off');
  }

  function registerMenu() {
    GM_registerMenuCommand('Dark mode: ON',  () => { setOn(true); apply(); });
    GM_registerMenuCommand('Dark mode: OFF', () => { setOn(false); apply(); });
  }

  function scheduleApply(delay = APPLY_DEBOUNCE_MS) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      applyTimer = null;
      apply();
    }, delay);
  }

  function dispatchRouteChange() {
    window.dispatchEvent(new Event('pz-dark-routechange'));
  }

  function installRouteHooks() {
    const wrap = (name) => {
      const original = history[name];
      if (typeof original !== 'function') return;
      history[name] = function (...args) {
        const result = original.apply(this, args);
        dispatchRouteChange();
        return result;
      };
    };

    wrap('pushState');
    wrap('replaceState');

    window.addEventListener('popstate', dispatchRouteChange, true);
    window.addEventListener('hashchange', dispatchRouteChange, true);
    window.addEventListener('pz-dark-routechange', () => {
      cachedRoot = null;
      clearTimeout(routeRetryTimer);

      let tries = 0;
      const tick = () => {
        apply();
        if (!cachedRoot && tries < ROUTE_RETRY_MAX) {
          tries += 1;
          routeRetryTimer = setTimeout(tick, ROUTE_RETRY_INTERVAL_MS);
        }
      };

      routeRetryTimer = setTimeout(tick, ROUTE_RETRY_INITIAL_MS);
    }, true);
  }

  GM_addStyle(`
    html[${PAGE_BG_ATTR}="on"]{
      --pz-page-bg:${PAGE_BG};
      --pz-page-footer-bg:${FOOTER_BG};
    }

    html[${PAGE_BG_ATTR}="on"],
    html[${PAGE_BG_ATTR}="on"] body{
      background-color:var(--pz-page-bg) !important;
      background-image:none !important;
    }

    html[${PAGE_BG_ATTR}="on"] #main,
    html[${PAGE_BG_ATTR}="on"] #content,
    html[${PAGE_BG_ATTR}="on"] section#widget-grid,
    html[${PAGE_BG_ATTR}="on"] .page-content,
    html[${PAGE_BG_ATTR}="on"] .content,
    html[${PAGE_BG_ATTR}="on"] .content-wrapper,
    html[${PAGE_BG_ATTR}="on"] .container,
    html[${PAGE_BG_ATTR}="on"] .container-fluid,
    html[${PAGE_BG_ATTR}="on"] .wrapper,
    html[${PAGE_BG_ATTR}="on"] .main{
      background-color:transparent !important;
      background-image:none !important;
    }

    html[${PAGE_BG_ATTR}="on"] #content > .row,
    html[${PAGE_BG_ATTR}="on"] #content .row{
      background-color:transparent !important;
      background-image:none !important;
    }

    html[${PAGE_BG_ATTR}="on"] .page-footer,
    html[${PAGE_BG_ATTR}="on"] footer{
      background-color:var(--pz-page-footer-bg) !important;
      border-top:1px solid rgba(255,255,255,.08) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"]{
      --pz-bg:#0f1115;
      --pz-surface:#151923;
      --pz-surface-2:#1b2130;
      --pz-surface-3:#232b3d;

      --pz-text:#e6e9ef;
      --pz-text-muted:#a9b2c3;
      --pz-text-faint:#7f8aa0;

      --pz-border:rgba(255,255,255,.10);
      --pz-border-strong:rgba(255,255,255,.16);

      --pz-link:#84c5ff;
      --pz-link-hover:#b4ddff;

      --pz-hover:rgba(132,197,255,.10);
      --pz-selected:rgba(132,197,255,.18);
      --pz-focus:rgba(132,197,255,.35);

      --pz-zebra-odd:#121723;
      --pz-zebra-even:#0b1224;

      --pz-alert-yellow:#4a4318;
      --pz-alert-orange:#4a3416;
      --pz-alert-red:#4a232b;
      --pz-alert-deepred:#34141a;

      --pz-alert-yellow-edge:#8a7a1e;
      --pz-alert-orange-edge:#a85f1a;
      --pz-alert-red-edge:#b14a5a;
      --pz-alert-deepred-edge:#8e2434;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"]{
      background:transparent !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"]#${WIDGET_ID},
    .${SCOPE_CLASS}[data-pz-dark="on"] .jarviswidget,
    .${SCOPE_CLASS}[data-pz-dark="on"] .widget-body,
    .${SCOPE_CLASS}[data-pz-dark="on"] .ticket-results{
      background:var(--pz-bg) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] header,
    .${SCOPE_CLASS}[data-pz-dark="on"] .widget-toolbar,
    .${SCOPE_CLASS}[data-pz-dark="on"] .jarviswidget-ctrls{
      background:var(--pz-surface) !important;
      border-color:var(--pz-border) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] a,
    .${SCOPE_CLASS}[data-pz-dark="on"] a:visited{
      color:var(--pz-link) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] a:hover{
      color:var(--pz-link-hover) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper{
      background:var(--pz-bg) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper > .top,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper > .bottom{
      background:var(--pz-bg) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .dataTables_length,
    .${SCOPE_CLASS}[data-pz-dark="on"] .dataTables_info{
      color:var(--pz-text-muted) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper .dataTables_scroll,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper .dataTables_scrollHead,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper .dataTables_scrollHeadInner,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper .dataTables_scrollBody{
      background:var(--pz-surface) !important;
      border-color:var(--pz-border) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] table{
      background:var(--pz-surface) !important;
      color:var(--pz-text) !important;
      border-collapse:collapse;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] thead,
    .${SCOPE_CLASS}[data-pz-dark="on"] th{
      background:var(--pz-surface-2) !important;
      color:var(--pz-text) !important;
      border-bottom:1px solid var(--pz-border-strong) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] td,
    .${SCOPE_CLASS}[data-pz-dark="on"] th{
      border-color:var(--pz-border) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.odd > td{
      background:var(--pz-zebra-odd) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.even > td{
      background:var(--pz-zebra-even) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr:nth-child(2n+1):not(.sla-limit70):not(.sla-limit50):not(.sla-overdue) > td{
      background:var(--pz-zebra-odd) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr:nth-child(2n):not(.sla-limit70):not(.sla-limit50):not(.sla-overdue) > td{
      background:var(--pz-zebra-even) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit70 > td{
      background:var(--pz-alert-yellow) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit50 > td{
      background:var(--pz-alert-orange) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-overdue > td{
      background:var(--pz-alert-red) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit90 > td,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit95 > td,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit100 > td,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-critical > td,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-breach > td,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-danger > td{
      background:var(--pz-alert-deepred) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit70 > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-yellow-edge) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit50 > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-orange-edge) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-overdue > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-red-edge) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit90 > td:first-child,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit95 > td:first-child,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit100 > td:first-child,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-critical > td:first-child,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-breach > td:first-child,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-danger > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-deepred-edge) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr:hover > td{
      filter:brightness(1.04);
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .pagination{
      background:transparent !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .pagination > li > a,
    .${SCOPE_CLASS}[data-pz-dark="on"] .pagination > li > span{
      background:var(--pz-surface-3) !important;
      border:1px solid var(--pz-border) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .pagination > li > a:hover{
      background:var(--pz-surface-2) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .pagination > .active > a{
      background:var(--pz-selected) !important;
      border-color:var(--pz-link) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .dataTables_scrollBody{
      scrollbar-color:#2a3650 var(--pz-surface);
      scrollbar-width:thin;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .dataTables_scrollBody::-webkit-scrollbar{
      height:12px;
      width:12px;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .dataTables_scrollBody::-webkit-scrollbar-track{
      background:var(--pz-surface);
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .dataTables_scrollBody::-webkit-scrollbar-thumb{
      background:#2a3650;
      border:3px solid var(--pz-surface);
      border-radius:10px;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .dataTables_scrollBody::-webkit-scrollbar-thumb:hover{
      background:#344563;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_length select.form-control,
    .${SCOPE_CLASS}[data-pz-dark="on"] .dataTables_length select.form-control{
      background:var(--pz-surface-2) !important;
      border:1px solid var(--pz-border) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .dt-buttons .dt-button,
    .${SCOPE_CLASS}[data-pz-dark="on"] .dt-buttons a.dt-button{
      background:var(--pz-surface-3) !important;
      border:1px solid var(--pz-border) !important;
      color:var(--pz-text) !important;
      border-radius:4px !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] .dt-buttons .dt-button:hover,
    .${SCOPE_CLASS}[data-pz-dark="on"] .dt-buttons a.dt-button:hover{
      background:var(--pz-surface-2) !important;
      border-color:var(--pz-border-strong) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] #bulk-select-button,
    .${SCOPE_CLASS}[data-pz-dark="on"] #clear-selection-button{
      background:var(--pz-surface-3) !important;
      border:1px solid var(--pz-border) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] #bulk-select-button:hover,
    .${SCOPE_CLASS}[data-pz-dark="on"] #clear-selection-button:hover{
      background:var(--pz-surface-2) !important;
      border-color:var(--pz-border-strong) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] #tickets-table .btn,
    .${SCOPE_CLASS}[data-pz-dark="on"] #tickets-table .btn-default,
    .${SCOPE_CLASS}[data-pz-dark="on"] #tickets-table .btn-sm{
      background:var(--pz-surface-3) !important;
      border-color:var(--pz-border) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] #tickets-table .btn:hover{
      background:var(--pz-surface-2) !important;
      border-color:var(--pz-border-strong) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"]{
      --pz-module-border:var(--pz-border);
    }

    .${SCOPE_CLASS}[data-pz-dark="on"].jarviswidget,
    .${SCOPE_CLASS}[data-pz-dark="on"] .jarviswidget{
      border:1px solid var(--pz-module-border) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] header#tickets-table,
    .${SCOPE_CLASS}[data-pz-dark="on"] .jarviswidget > header{
      background:var(--pz-bg) !important;
      background-image:none !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] header#tickets-table h2,
    .${SCOPE_CLASS}[data-pz-dark="on"] header#tickets-table h2 *,
    .${SCOPE_CLASS}[data-pz-dark="on"] header#tickets-table .widget-icon,
    .${SCOPE_CLASS}[data-pz-dark="on"] header#tickets-table .widget-icon *{
      color:var(--pz-text) !important;
      opacity:1 !important;
      filter:none !important;
      text-shadow:none !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] header#tickets-table + div,
    .${SCOPE_CLASS}[data-pz-dark="on"] #easy-ticket-preview,
    .${SCOPE_CLASS}[data-pz-dark="on"] .widget-body,
    .${SCOPE_CLASS}[data-pz-dark="on"] .ticket-results,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper .dataTables_scroll,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper .dataTables_scrollHead,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper .dataTables_scrollHeadInner,
    .${SCOPE_CLASS}[data-pz-dark="on"] #DataTables_Table_0_wrapper .dataTables_scrollBody{
      border-left:0 !important;
      border-right:0 !important;
    }

    #${BTN_ID}{
      position:fixed;
      right:16px;
      bottom:16px;
      z-index:2147483647;
      width:40px;
      height:40px;
      padding:0 0 2px 0;
      border-radius:999px;
      border:1px solid rgba(0,0,0,.15);
      background:#ffffff;
      color:#111;
      font:700 27px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      cursor:pointer;
      user-select:none;
      box-shadow:0 8px 22px rgba(0,0,0,.20);
      opacity:.94;
    }

    #${BTN_ID}:hover{ opacity:1; }
    #${BTN_ID}:active{ transform:translateY(1px); }

    @media print{
      #${BTN_ID}{ display:none !important; }
    }
  `);

  function tickBoot() {
    if (!document.body) return false;
    ensureButton();
    apply();
    return true;
  }

  registerMenu();
  installRouteHooks();

  const MAX_TRIES = BOOT_MAX_TRIES;
  const INTERVAL = BOOT_INTERVAL_MS;
  let tries = 0;

  (function boot() {
    if (tickBoot()) {
      tries++;
      if (tries >= MAX_TRIES) return;
      if (!cachedRoot || !document.contains(cachedRoot)) {
        setTimeout(boot, INTERVAL);
      }
    } else {
      setTimeout(boot, INTERVAL);
    }
  })();

  const domObserver = new MutationObserver(() => {
    scheduleApply(OBSERVER_APPLY_DELAY_MS);
  });

  const startDomObserver = () => {
    const root = findRoot();
    const tableWrap = root && root.querySelector ? root.querySelector(TABLE_WRAPPER_SELECTOR) : null;
    if (tableWrap) {
      domObserver.observe(tableWrap, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    } else if (document.body) {
      domObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  };

  startDomObserver();
})();