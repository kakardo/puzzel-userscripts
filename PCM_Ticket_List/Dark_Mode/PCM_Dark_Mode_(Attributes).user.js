// @file_name = PCM_Dark_Mode_(Attributes).user.js
// @author = Kardo Rostam
// @version = 5.3_2026-09-04
// @created = 2026-03-27 (v4.5)

// ==UserScript==
// @name         PCM Dark Mode (Attributes)
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      5.3_2026-09-04
// @description  Uses the shared PCM_DOM library for boot/retry and style injection. Battery friendly: applies are skipped while the tab is hidden (one catch-up on return) and the document-wide XPath search only runs when the cheap ID lookup fails. Keeps the working Attributes behavior.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/Dark_Mode/PCM_Dark_Mode_(Attributes).user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/Dark_Mode/PCM_Dark_Mode_(Attributes).user.js
// ==/UserScript==

(() => {
  'use strict';

  const REQUIRE_ERROR = 'PCM Dark Mode (Attributes): PCM_DOM shared helpers are missing. Load PCM_Shared_Library.user.js first.';

  if (!window.PCM_DOM?.bootUntil || !window.PCM_DOM?.ensureStyleTag || !window.PCM_DOM?.createVisibilityGate) {
    console.error(REQUIRE_ERROR + ' (lib 1.8 or newer required)');
    return;
  }

  const STORAGE_KEY = 'pzTicketsDarkModeOn';

  const STYLE_ID = 'pz-ta-dark-style';
  const SCOPE_CLASS = 'pz-ta-dark-scope';
  const SCOPE_ATTR  = 'data-pz-ta-dark';
  const GLOBAL_ATTR = 'data-pz-ta-global-dark';

  const TICKETS_WIDGET_ID = 'wid-tickets-index';
  const TICKETS_TABLE_ID  = 'tickets-table';

  const STATUS_SELECT_ID = 'ticket_search_status_id';

  const STATUS_CLASSES = [
    'pz-status-open',
    'pz-status-pending',
    'pz-status-onhold',
    'pz-status-resolved',
    'pz-status-closed',
    'pz-status-error',
    'pz-status-generic'
  ];

  const APPLY_DEBOUNCE_MS = 80;
  const OBSERVER_APPLY_DELAY_MS = 120;

  let ticketsWidgetObserver = null;
  let ticketsWidgetTarget = null;
  let statusObserver = null;
  let statusObservedNode = null;
  let domObserver = null;

  function isDark() {
    const w = document.getElementById(TICKETS_WIDGET_ID);
    if (w && w.getAttribute('data-pz-dark') === 'on') return true;
    if (w && w.closest) {
      const jw = w.closest('.jarviswidget');
      if (jw && jw.getAttribute('data-pz-dark') === 'on') return true;
    }
    const tbl = document.getElementById(TICKETS_TABLE_ID);
    if (tbl && tbl.closest) {
      const jw = tbl.closest('.jarviswidget');
      if (jw && jw.getAttribute('data-pz-dark') === 'on') return true;
    }
    try { return !!GM_getValue(STORAGE_KEY, true); } catch (_) { return true; }
  }

  function findRoot() {
    const tabPane = document.getElementById('ticket-attributes-tab');
    // Lazy XPath: the document-wide text search is expensive and only needed
    // when the cheap getElementById lookup fails.
    const heading = tabPane ? null : document.evaluate(
      "//*[normalize-space(text())='Search by Ticket Attributes']",
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;

    const start = tabPane || heading;
    if (!start) return null;

    const bad = '#DataTables_Table_0_wrapper, .dataTables_wrapper, #tickets-table';

    if (start.closest) {
      const jw = start.closest('.jarviswidget');
      if (jw) {
        const hasBad = !!jw.querySelector(bad);
        const hasAttrs = !!jw.querySelector('#ticket-attributes-tab, a[href="#ticket-attributes-tab"], [data-target="#ticket-attributes-tab"]');
        if (hasAttrs && !hasBad) return jw;
      }
    }

    let el = start.nodeType === 1 ? start : start.parentElement;
    for (let i = 0; i < 18 && el; i++) {
      const hasBad = !!(el.querySelector && el.querySelector(bad));
      const hasAttrs = !!(el.querySelector && el.querySelector('#ticket-attributes-tab, a[href="#ticket-attributes-tab"], [data-target="#ticket-attributes-tab"]'));
      const hasControls = !!(el.querySelector && el.querySelector('input, select, textarea, .form-control, .chosen-container, .select2-container, .input-group'));
      if (hasAttrs && hasControls && !hasBad) return el;
      el = el.parentElement;
    }

    return tabPane || start.parentElement || null;
  }

  function normalizeStatusLabel(s) {
    return (s || '').trim().toLowerCase();
  }

  function statusClassFor(label) {
    const t = normalizeStatusLabel(label);
    if (t === 'open') return 'pz-status-open';
    if (t === 'pending') return 'pz-status-pending';
    if (t === 'on hold' || t === 'onhold') return 'pz-status-onhold';
    if (t === 'resolved') return 'pz-status-resolved';
    if (t === 'closed') return 'pz-status-closed';
    if (t === 'error') return 'pz-status-error';
    return 'pz-status-generic';
  }

  function setStatusClass(el, cls) {
    const current = STATUS_CLASSES.find(name => el.classList.contains(name));
    if (current === cls) return;
    if (current) el.classList.remove(current);
    if (!el.classList.contains(cls)) el.classList.add(cls);
  }

  function colorizeStatusChosen() {
    const chosen = document.getElementById(STATUS_SELECT_ID + '_chosen');
    if (!chosen) return;

    chosen.querySelectorAll('li.search-choice').forEach(li => {
      const span = li.querySelector('span');
      setStatusClass(li, statusClassFor(span ? span.textContent : ''));
    });

    chosen.querySelectorAll('.chosen-results li').forEach(li => {
      setStatusClass(li, statusClassFor(li.textContent || ''));
    });
  }

  // Shared battery pattern from PCM_DOM 1.8: debounced apply that skips work
  // while the tab is hidden and catches up once on return.
  const applyGate = window.PCM_DOM.createVisibilityGate(() => apply(), APPLY_DEBOUNCE_MS);

  function scheduleApply(delay = APPLY_DEBOUNCE_MS) {
    applyGate.schedule(delay);
  }

  function observeStatusChosen() {
    const chosen = document.getElementById(STATUS_SELECT_ID + '_chosen');
    if (!chosen) return null;
    if (statusObserver && statusObservedNode === chosen) return statusObserver;

    if (statusObserver) statusObserver.disconnect();

    statusObservedNode = chosen;
    statusObserver = new MutationObserver(() => setTimeout(colorizeStatusChosen, 0));
    statusObserver.observe(chosen, { childList: true, subtree: true });
    return statusObserver;
  }

  function apply() {
    const on = isDark();
    const root = findRoot();
    if (!root) return;

    document.querySelectorAll('.' + SCOPE_CLASS).forEach(n => {
      if (n !== root) {
        n.classList.remove(SCOPE_CLASS);
        n.removeAttribute(SCOPE_ATTR);
      }
    });

    root.classList.add(SCOPE_CLASS);
    root.setAttribute(SCOPE_ATTR, on ? 'on' : 'off');

    if (on) {
      document.documentElement.setAttribute(GLOBAL_ATTR, 'on');
      observeStatusChosen();
      setTimeout(colorizeStatusChosen, 0);
    } else {
      document.documentElement.removeAttribute(GLOBAL_ATTR);
    }

    observeTicketsWidget();
  }

  function observeTicketsWidget() {
    const w = document.getElementById(TICKETS_WIDGET_ID);
    const target = (w && w.closest) ? (w.closest('.jarviswidget') || w) : w;
    if (!target) return null;
    if (ticketsWidgetObserver && ticketsWidgetTarget === target) return ticketsWidgetObserver;

    if (ticketsWidgetObserver) ticketsWidgetObserver.disconnect();

    ticketsWidgetTarget = target;
    ticketsWidgetObserver = new MutationObserver(() => scheduleApply());
    ticketsWidgetObserver.observe(target, { attributes: true, attributeFilter: ['data-pz-dark'] });
    return ticketsWidgetObserver;
  }

  window.PCM_DOM.ensureStyleTag(STYLE_ID, `
    /* ============================================================
       v4.1 - FIELD BOXES UNIFIED (SAFE FAILSAFE BASE)
       Purpose: Make all boxes look like the "good" green ones.
       ============================================================ */

    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"],
    html[${GLOBAL_ATTR}="on"] {
      --pz-bg: #0f1115;
      --pz-surface: #151923;
      --pz-surface-2: #1b2130;
      --pz-surface-3: #232b3d;
      --pz-input: #111827;
      --pz-text: #e6e9ef;
      --pz-text-muted: rgba(230,233,239,0.86);
      --pz-text-faint: rgba(230,233,239,0.62);
      --pz-border: rgba(255,255,255,.10);
      --pz-border-strong: rgba(255,255,255,.18);
      --pz-hover: rgba(63,111,214,.28);
      --pz-selected: rgba(63,111,214,.22);
      --pz-focus: rgba(132,197,255,.35);

      /* Canonical box style (matches the green-marked boxes) */
      --pz-box-bg: var(--pz-input);
      --pz-box-border: var(--pz-border);
      --pz-box-radius: 2px;

      /* Status colors */
      --pz-st-open: #3f6fd6;
      --pz-st-pending: #2f7d2f;
      --pz-st-onhold: #7b2cbf;
      --pz-st-resolved: #f59e0b;
      --pz-st-closed: #4b5563;
      --pz-st-error: #d32f2f;

      /* Button colors (as per v3.5) */
      --pz-btn-primary: #3276b1;
      --pz-btn-success: #739e73;
      --pz-btn-danger:  #a90329;
      --pz-btn-warning: #c79121;
      --pz-btn-info:    #57889c;
    }

    /* --- v3.5 FAILSAFE: force ticket-attributes-tab dark --- */
    html[${GLOBAL_ATTR}="on"] #ticket-attributes-tab,
    html[${GLOBAL_ATTR}="on"] #ticket-attributes-tab *:not(input):not(select):not(textarea) {
      background-color: transparent;
    }
    html[${GLOBAL_ATTR}="on"] #ticket-attributes-tab {
      background: var(--pz-bg) !important;
      color: var(--pz-text) !important;
    }

    /* Keep module canvas dark */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"],
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .widget-body,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .tab-content,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .tab-pane,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .panel,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .panel-body,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .well,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] fieldset,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] legend,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form header,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form fieldset,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form section,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form .row {
      background: var(--pz-bg) !important;
      background-image: none !important;
      color: var(--pz-text) !important;
      border-color: var(--pz-border) !important;
    }

    /* Labels: crisp (no blur) */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] label,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .control-label,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] label.label,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form .label,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form .label strong {
      color: var(--pz-text-muted) !important;
      font-weight: 700 !important;
      text-shadow: none !important;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }


 /* ===================== BANNER / TABS DARK (PATCH) ===================== */
 /* Tabs row (Ticket Attributes / Categories / Forms) */
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .nav-tabs,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] ul.nav-tabs,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .nav.nav-tabs {
  background: var(--pz-surface) !important;
  border-bottom: 1px solid var(--pz-border) !important;
 }

 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .nav-tabs > li > a {
  background: var(--pz-surface-2) !important;
  color: var(--pz-text-muted) !important;
  border: 1px solid var(--pz-border) !important;
  border-bottom-color: transparent !important;
 }

 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .nav-tabs > li > a:hover {
  background: var(--pz-surface-3) !important;
  color: var(--pz-text) !important;
 }

 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .nav-tabs > li.active > a,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .nav-tabs > li.active > a:hover,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .nav-tabs > li.active > a:focus {
  background: var(--pz-bg) !important;
  color: var(--pz-text) !important;
  border-color: var(--pz-border) !important;
  border-bottom-color: var(--pz-bg) !important;
 }

 /* JarvisWidget header strip above the form (often renders white) */
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] > header,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .jarviswidget > header {
  background: var(--pz-surface-2) !important;
  color: var(--pz-text) !important;
  border-color: var(--pz-border) !important;
  background-image: none !important;
 }

 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] > header h2,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] > header .widget-icon,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .jarviswidget > header h2,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .jarviswidget > header .widget-icon {
  color: var(--pz-text) !important;
 }

 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] > header .widget-toolbar,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] > header .widget-toolbar *,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .jarviswidget > header .widget-toolbar,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .jarviswidget > header .widget-toolbar * {
  color: var(--pz-text-muted) !important;
 }

 /* The narrow action strip inside the attributes module (e.g., Save Searches row) */
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form header,
 .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .smart-form .tab-content > .tab-pane > .row:first-child {
  background: var(--pz-bg) !important;
  background-image: none !important;
 }

/* ===================== FIELD BOX UNIFY (THE ASK) ===================== */

    /* Plain inputs/selects */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] input,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] select,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] textarea,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .form-control {
      background: var(--pz-box-bg) !important;
      border: 1px solid var(--pz-box-border) !important;
      border-radius: var(--pz-box-radius) !important;
      color: var(--pz-text) !important;
      box-shadow: none !important;
      font-weight: 400 !important;
    }

    /* SmartAdmin wrappers */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] label.select,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] label.select.select-multiple,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] label.input,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] label.textarea {
      background: var(--pz-box-bg) !important;
      border: 1px solid var(--pz-box-border) !important;
      border-radius: var(--pz-box-radius) !important;
      box-shadow: none !important;
    }

    /* Input groups (fix odd borders like the red-marked boxes) */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .input-group .form-control {
      border-right: 0 !important;
      border-radius: var(--pz-box-radius) 0 0 var(--pz-box-radius) !important;
    }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .input-group-addon {
      background: var(--pz-surface-3) !important;
      border: 1px solid var(--pz-box-border) !important;
      border-left: 1px solid var(--pz-box-border) !important;
      color: var(--pz-text) !important;
      border-radius: 0 var(--pz-box-radius) var(--pz-box-radius) 0 !important;
    }

    /* Focus: do NOT change border to blue anywhere */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] input:focus,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] select:focus,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] textarea:focus,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .form-control:focus {
      border-color: var(--pz-box-border) !important;
      box-shadow: none !important;
      outline: none !important;
    }

    /* Chosen: single + multi boxes match */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container-single .chosen-single,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container-multi .chosen-choices {
      background: var(--pz-box-bg) !important;
      border: 1px solid var(--pz-box-border) !important;
      border-radius: var(--pz-box-radius) !important;
      box-shadow: none !important;
      color: var(--pz-text) !important;
    }

    /* Remove blue border/glow when chosen opens */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container-active,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-with-drop,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container-active .chosen-single,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-with-drop .chosen-single,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container-active .chosen-choices,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-with-drop .chosen-choices {
      border-color: var(--pz-box-border) !important;
      box-shadow: none !important;
      outline: none !important;
    }

    /* Chosen dropdown menu colors unified */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container .chosen-drop {
      background: var(--pz-surface) !important;
      border: 1px solid var(--pz-box-border) !important;
      color: var(--pz-text) !important;
      box-shadow: 0 10px 25px rgba(0,0,0,.35) !important;
    }

    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container .chosen-results li {
      background: transparent !important;
      color: var(--pz-text) !important;
      font-weight: 400 !important;
      text-transform: none !important;
      letter-spacing: 0 !important;
    }

    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container .chosen-results li.highlighted {
      background: var(--pz-hover) !important;
      color: var(--pz-text) !important;
    }

    /* Selected items (non-status): match others */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .chosen-container:not(#${STATUS_SELECT_ID}_chosen) .chosen-results li.result-selected {
      background: var(--pz-selected) !important;
      border-left: 4px solid rgba(230,233,239,0.55);
    }

    /* Select2 (if present) */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .select2-container .select2-selection,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .select2-container--default .select2-selection--single,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .select2-container--default .select2-selection--multiple {
      background: var(--pz-box-bg) !important;
      border: 1px solid var(--pz-box-border) !important;
      border-radius: var(--pz-box-radius) !important;
      color: var(--pz-text) !important;
      box-shadow: none !important;
    }

    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .select2-dropdown {
      background: var(--pz-surface) !important;
      border: 1px solid var(--pz-box-border) !important;
      color: var(--pz-text) !important;
    }

    /* ===================== STATUS BOX (keep working) ===================== */

    /* Status chips colored */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice {
      position: relative !important;
      padding: 2px 20px 2px 8px !important;
      border-radius: 4px !important;
      margin: 2px 4px 2px 0 !important;
      font-weight: 700 !important;
      letter-spacing: .2px !important;
      text-transform: uppercase !important;
      border: 1px solid rgba(255,255,255,.12) !important;
    }

    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice.pz-status-open    { background: var(--pz-st-open) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice.pz-status-pending { background: var(--pz-st-pending) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice.pz-status-onhold  { background: var(--pz-st-onhold) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice.pz-status-resolved{ background: var(--pz-st-resolved) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice.pz-status-closed  { background: var(--pz-st-closed) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice.pz-status-error   { background: var(--pz-st-error) !important; color:#fff !important; }

    /* X as text */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice .search-choice-close {
      position: absolute !important;
      right: 5px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      width: 14px !important;
      height: 14px !important;
      line-height: 14px !important;
      background: none !important;
      opacity: 1 !important;
    }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-choices li.search-choice .search-choice-close::before {
      content: "×";
      display: inline-block;
      width: 14px;
      height: 14px;
      line-height: 14px;
      text-align: center;
      font-weight: 900;
      font-size: 14px;
      color: rgba(255,255,255,0.95);
    }

    /* Status dropdown: consistent typography + color coding */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-results li {
      color: #fff !important;
      font-weight: 400 !important;
      text-transform: none !important;
    }

    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-results li {
      border-left: 6px solid transparent;
      padding-left: 10px;
      border-radius: 4px;
    }

    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-results li.pz-status-open    { border-left-color: var(--pz-st-open);    background: rgba(63,111,214,0.22) !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-results li.pz-status-pending { border-left-color: var(--pz-st-pending); background: rgba(47,125,47,0.22) !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-results li.pz-status-onhold  { border-left-color: var(--pz-st-onhold);  background: rgba(123,44,191,0.22) !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-results li.pz-status-resolved{ border-left-color: var(--pz-st-resolved);background: rgba(245,158,11,0.22) !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-results li.pz-status-closed  { border-left-color: var(--pz-st-closed);  background: rgba(75,85,99,0.22) !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen .chosen-results li.pz-status-error   { border-left-color: var(--pz-st-error);   background: rgba(211,47,47,0.22) !important; }

    /* Status control: no blue border when expanded */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen.chosen-container-active,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen.chosen-with-drop,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen.chosen-container-active .chosen-choices,
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] #${STATUS_SELECT_ID}_chosen.chosen-with-drop .chosen-choices {
      border-color: var(--pz-box-border) !important;
      box-shadow: none !important;
      outline: none !important;
    }

    /* Buttons inside module: restore intended colors, do not touch top bar */
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .btn.btn-primary { background-color: var(--pz-btn-primary) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .btn.btn-success { background-color: var(--pz-btn-success) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .btn.btn-danger  { background-color: var(--pz-btn-danger) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .btn.btn-warning { background-color: var(--pz-btn-warning) !important; color:#fff !important; }
    .${SCOPE_CLASS}[${SCOPE_ATTR}="on"] .btn.btn-info    { background-color: var(--pz-btn-info) !important; color:#fff !important; }

    /* Dropdown/date widgets appended to body (time period, etc.) */
    html[${GLOBAL_ATTR}="on"] .datepicker,
    html[${GLOBAL_ATTR}="on"] .datepicker-dropdown,
    html[${GLOBAL_ATTR}="on"] .bootstrap-datetimepicker-widget,
    html[${GLOBAL_ATTR}="on"] .daterangepicker,
    html[${GLOBAL_ATTR}="on"] .dropdown-menu {
      background: var(--pz-surface) !important;
      color: var(--pz-text) !important;
      border: 1px solid var(--pz-border) !important;
      box-shadow: 0 10px 25px rgba(0,0,0,.45) !important;
    }
  `);

  function startDomObserver() {
    if (domObserver || !document.body) return;
    domObserver = new MutationObserver(() => scheduleApply(OBSERVER_APPLY_DELAY_MS));
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  const bootConfig = window.PCM_DOM.mergeConfig
    ? window.PCM_DOM.mergeConfig({ BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 400 })
    : { BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 400 };

  window.PCM_DOM.bootUntil(function() {
    return !!document.body && !!findRoot();
  }, function() {
    apply();
    startDomObserver();
  }, bootConfig);
})();
