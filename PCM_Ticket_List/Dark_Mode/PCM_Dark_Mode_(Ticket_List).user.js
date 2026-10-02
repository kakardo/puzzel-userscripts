// @file_name = PCM_Dark_Mode_(Ticket_List).user.js
// @author = Kardo Rostam
// @version = 7.0_2026-10-02
// @created = 2026-03-26 (v5.5)

// ==UserScript==
// @name         PCM Dark Mode (Ticket List)
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      7.0_2026-10-02
// @description  Dark mode for Puzzel Tickets using stable blue stripes plus CSS-based SLA alert row colors. Battery friendly: applies are skipped while the tab is hidden (one catch-up on return) and the observer rescopes from body to the table wrapper once DataTables renders. The on/off toggle sits in the top bar left of the profile picture (BUTTON_PLACEMENT), falling back to the bottom-right corner when the top bar is not found.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @match        https://puzzel.cm.puzzel.com/tickets?*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/Dark_Mode/PCM_Dark_Mode_(Ticket_List).user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/Dark_Mode/PCM_Dark_Mode_(Ticket_List).user.js
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

  // Where the toggle sits.
  //   'header' - in the top bar, left of the profile picture (default)
  //   'corner' - floating in the bottom-right corner
  // If the top bar cannot be found the corner is used, so the toggle is
  // never lost.
  const BUTTON_PLACEMENT = 'header';

  // Length of the cross-fade when the toggle is pressed. Page loads stay
  // instant: the fade only runs on a switch. Set 0 to switch instantly.
  const THEME_FADE_MS = 350;

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const STORAGE_KEY  = 'pzTicketsDarkModeOn';
  const SCOPE_CLASS  = 'pz-dark-scope-root';
  const BTN_ID       = 'pz-darkmode-toggle';
  const DOCKED_CLASS = 'pz-darkmode-docked';
  const FADE_CLASS   = 'pz-theme-fading';
  const OVERDUE_TIME_CLASS = 'pz-overdue-time';
  const OVERDUE_TIME_COLUMNS = ['Response Target', 'Resolve Target'];
  // The profile picture's own top bar item. The toggle goes right in
  // front of it, after the bell, as one more floated .navbar-item.
  const HEADER_ANCHOR_SELECTOR = '#one-agent-menu-lg .navbar-avatar > .dropdown.navbar-item, .navbar-avatar > .dropdown.navbar-item';
  const HEADER_ICON_SELECTOR   = '#logo-group svg, #logo-group i';
  const HEADER_ICON_FALLBACK_COLOR = '#c4bab6';
  // Space between the toggle and the bell, and between the toggle and
  // the profile picture.
  const TOP_BAR_GAP = 12;
  // Empty edge inside the toggle's 24px box around the 22px icon.
  const TOGGLE_INSET = 2;

  // Line icons for the top bar, drawn in the bell's colour so the toggle
  // blends in. The corner button keeps the emoji above.
  const SVG_OPEN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  const SVG_MOON = SVG_OPEN + '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  const SVG_SUN  = SVG_OPEN + '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.6 4.6l1.8 1.8' +
    'M17.6 17.6l1.8 1.8M1.5 12H4M20 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></svg>';
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
  let observedWrapper = null;
  let observingBody = false;

  // Created up here because apply() (via startDomObserver) can run during
  // boot, before the bottom of the IIFE is reached. scheduleApply is a
  // hoisted function declaration, so referencing it here is safe.
  const domObserver = new MutationObserver(() => {
    scheduleApply(OBSERVER_APPLY_DELAY_MS);
  });

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
    const docked = btn.classList.contains(DOCKED_CLASS);
    // Rewritten only when something changed: an unconditional write is a
    // DOM mutation on every apply, which the body observer would hear.
    const state = (docked ? 'svg-' : 'emoji-') + (on ? 'on' : 'off');
    if (btn.dataset.pzIcon !== state) {
      btn.dataset.pzIcon = state;
      if (docked) btn.innerHTML = on ? SVG_MOON : SVG_SUN;
      else btn.textContent = on ? ICON_DARK : ICON_LIGHT;
    }
    btn.setAttribute('aria-label', on ? 'Dark mode on. Click to turn off.' : 'Dark mode off. Click to turn on.');
    btn.title = on ? 'Dark mode is ON (click to turn off)' : 'Dark mode is OFF (click to turn on)';
  }

  // PCM positions the bell and the picture with rules of their own
  // (the bell icon is wider than its box and spills to the right), so
  // the toggle is placed by measuring the drawn bell (drawnRect) instead
  // of trusting .navbar-item spacing:
  //   - vertical: its centre on the bell icon's centre
  //   - horizontal: TOP_BAR_GAP px after the bell icon, and the same gap
  //     before the picture (margin-right pulls or pushes the picture)
  // Every write is guarded by a 1px tolerance, so repeated applies are
  // free once it is in place.
  function setPx(btn, prop, value) {
    const next = Math.round(value) + 'px';
    if (btn.style[prop] !== next) btn.style[prop] = next;
  }

  // The drawn part of an icon, not its box. An svg's box includes empty
  // padding that differs per icon (the bell has more than the sun), so
  // gaps measured box to box look uneven. The shapes inside report their
  // tight outline, and their union is what the eye sees.
  function drawnRect(el) {
    const svg = el && (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg'));
    if (svg) {
      let box = null;
      svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse').forEach((shape) => {
        const r = shape.getBoundingClientRect();
        if (!r.width && !r.height) return;
        box = box
          ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top),
              right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
          : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      if (box) return { left: box.left, top: box.top, right: box.right, height: box.bottom - box.top };
    }
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, height: r.height };
  }

  function alignInBar(btn, icon, picture) {
    if (!icon || !icon.getClientRects().length) return;
    const bell = drawnRect(icon);

    // The toggle itself is measured by its fixed 24px box, NOT by the
    // drawn icon: sun and moon have different shapes, and spacing them by
    // their drawing changed the row width on every click, which shifted
    // all the buttons to the left of it. TOGGLE_INSET is the empty edge
    // inside the box, so the visible gap still comes out at TOP_BAR_GAP.
    const box = () => {
      const r = btn.getBoundingClientRect();
      return { left: r.left + TOGGLE_INSET, top: r.top, right: r.right - TOGGLE_INSET, height: r.height };
    };
    let own = box();
    const top = parseFloat(btn.style.marginTop) || 0;
    const dy = (bell.top + bell.height / 2) - (own.top + own.height / 2);
    if (Math.abs(dy) > 1) setPx(btn, 'marginTop', top + dy);

    const left = parseFloat(btn.style.marginLeft) || 0;
    const dx = (bell.right + TOP_BAR_GAP) - own.left;
    if (Math.abs(dx) > 1) setPx(btn, 'marginLeft', left + dx);

    if (!picture || !picture.getClientRects().length) return;
    own = box();
    const right = parseFloat(btn.style.marginRight) || 0;
    const gap = picture.getBoundingClientRect().left - own.right;
    if (Math.abs(gap - TOP_BAR_GAP) > 1) setPx(btn, 'marginRight', right + (TOP_BAR_GAP - gap));
  }

  // Moves the toggle in front of the profile picture when wanted and
  // possible, otherwise back to the floating corner spot. Only touches
  // the DOM when the toggle is not already where it belongs.
  function placeButton(btn) {
    // The first visible match: the top bar has a large-screen copy that
    // is hidden on narrow windows, where the corner spot is used instead.
    const anchor = BUTTON_PLACEMENT === 'header'
      ? Array.from(document.querySelectorAll(HEADER_ANCHOR_SELECTOR)).find((el) => el.getClientRects().length)
      : null;
    if (anchor && anchor.parentElement) {
      if (btn.nextElementSibling !== anchor) anchor.parentElement.insertBefore(btn, anchor);
      // navbar-item gives it the same float and spacing as the bell and
      // the picture; the colour is read from the bell itself.
      btn.classList.add(DOCKED_CLASS, 'navbar-item');
      const icon = document.querySelector(HEADER_ICON_SELECTOR);
      const color = icon ? getComputedStyle(icon).color : HEADER_ICON_FALLBACK_COLOR;
      if (btn.style.color !== color) btn.style.color = color;
      updateButtonLabel();
      alignInBar(btn, icon, anchor.querySelector('.avatar-thumb') || anchor);
      return;
    }
    btn.classList.remove(DOCKED_CLASS, 'navbar-item');
    btn.style.color = '';
    btn.style.marginTop = '';
    btn.style.marginLeft = '';
    btn.style.marginRight = '';
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    updateButtonLabel();
  }

  function ensureButton() {
    const existing = document.getElementById(BTN_ID);
    if (existing) {
      placeButton(existing);
      return;
    }

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';

    btn.addEventListener('click', () => {
      switchTheme(!isOn());
    });

    placeButton(btn);
    updateButtonLabel();
  }

  function applyPageCanvas(on) {
    if (on) document.documentElement.setAttribute(PAGE_BG_ATTR, 'on');
    else document.documentElement.removeAttribute(PAGE_BG_ATTR);
  }

  function apply() {
    const on = isOn();
    applyPageCanvas(on);
    // Cheap when already placed; covers a top bar that renders late.
    ensureButton();
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

    markOverdueTimes(root, on);

    // Rescope the observer to the table wrapper as soon as it exists;
    // cheap no-op once already scoped.
    startDomObserver();
  }

  // Overdue rows: the target times that have passed ("... ago") get red
  // text, so the reason for the outline is visible at a glance. Only the
  // two target columns are checked, found by header text so hidden or
  // moved columns do not matter. Classes are only written when they
  // change, because the table observer listens to class changes.
  function setClass(el, name, wanted) {
    if (el.classList.contains(name) !== wanted) el.classList.toggle(name, wanted);
  }

  function markOverdueTimes(root, on) {
    const head = root.querySelector('.dataTables_scrollHead thead tr') || root.querySelector('thead tr');
    if (!head) return;
    const targets = [];
    Array.from(head.cells).forEach((th, index) => {
      if (OVERDUE_TIME_COLUMNS.indexOf(th.textContent.replace(/\s+/g, ' ').trim()) !== -1) targets.push(index);
    });
    if (!targets.length) return;

    root.querySelectorAll('tbody tr').forEach((tr) => {
      const overdue = on && tr.classList.contains('sla-overdue');
      targets.forEach((index) => {
        const cell = tr.cells[index];
        if (cell) setClass(cell, OVERDUE_TIME_CLASS, overdue && /\bago\b/i.test(cell.textContent));
      });
    });
  }

  // A switch cross-fades colours: FADE_CLASS turns on colour transitions
  // for the whole page (so every dark mode script's styles fade, not only
  // this one's), the theme flips, and the class is removed again once the
  // fade is done. The Attributes script follows a beat later through its
  // own debounced observer, so the class stays on long enough to cover it.
  // Never active on load, and skipped for users who prefer reduced motion.
  let fadeTimer = 0;

  function switchTheme(on) {
    const root = document.documentElement;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (THEME_FADE_MS > 0 && !reduce) {
      root.classList.add(FADE_CLASS);
      void root.offsetWidth; // commit the transition rules before the colours change
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => root.classList.remove(FADE_CLASS), THEME_FADE_MS + 600);
    }
    setOn(on);
    apply();
  }

  function registerMenu() {
    GM_registerMenuCommand('Dark mode: ON',  () => switchTheme(true));
    GM_registerMenuCommand('Dark mode: OFF', () => switchTheme(false));
  }

  let pendingApply = false;

  function scheduleApply(delay = APPLY_DEBOUNCE_MS) {
    // Hidden tab: skip all styling work now, catch up once on return.
    if (document.hidden) {
      pendingApply = true;
      return;
    }
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      applyTimer = null;
      apply();
    }, delay);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingApply) {
      pendingApply = false;
      scheduleApply();
    }
  });

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
      --pz-alert-red:#4a1a22;
      --pz-alert-rose:#4d2438;
      --pz-alert-deepred:#34141a;

      --pz-alert-yellow-edge:#8a7a1e;
      --pz-alert-orange-edge:#a85f1a;
      --pz-alert-red-edge:#e04a5a;
      --pz-alert-red-row-text:#f2a7ae;
      --pz-alert-red-text:#ff6b78;
      --pz-alert-rose-edge:#c25a7a;
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

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr:nth-child(2n+1):not([class*="sla-"]) > td{
      background:var(--pz-zebra-odd) !important;
      color:var(--pz-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr:nth-child(2n):not([class*="sla-"]) > td{
      background:var(--pz-zebra-even) !important;
      color:var(--pz-text) !important;
    }

    /* Any SLA class without a colour of its own below (PCM adds new
       limits from time to time) still gets a visible tint instead of
       falling back to the plain stripe. */
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr[class*="sla-limit"] > td{
      background:var(--pz-alert-orange) !important;
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

    /* Light red in PCM's own colours: the last step before overdue. */
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit20 > td{
      background:var(--pz-alert-rose) !important;
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

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr[class*="sla-limit"] > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-orange-edge) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit70 > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-yellow-edge) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit50 > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-orange-edge) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-limit20 > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-rose-edge) !important;
    }

    /* Overdue: the same 3px left edge as the other steps, and red text
       across the row instead of an outline. Links (ticket number,
       subject) turn red too; status and priority badges keep their own
       colours. Target times that have passed are a stronger red. */
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-overdue > td:first-child{
      box-shadow:inset 3px 0 0 var(--pz-alert-red-edge) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-overdue > td,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-overdue > td a,
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-overdue > td span:not(.label):not(.badge){
      color:var(--pz-alert-red-row-text) !important;
    }

    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-overdue > td.${OVERDUE_TIME_CLASS},
    .${SCOPE_CLASS}[data-pz-dark="on"] tbody tr.sla-overdue > td.${OVERDUE_TIME_CLASS} *{
      color:var(--pz-alert-red-text) !important;
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

    /* In the top bar: part of the row, no floating shadow. */
    /* In the top bar: a plain floated icon like the bell, no button
       chrome. Hover brightens it the way the other icons react. */
    #${BTN_ID}.${DOCKED_CLASS}{
      position:relative;
      float:left;
      width:24px;
      height:24px;
      padding:0;
      border:0;
      border-radius:0;
      background:transparent;
      box-shadow:none;
      opacity:.9;
    }
    #${BTN_ID}.${DOCKED_CLASS}:hover{ opacity:1; filter:brightness(1.35); }
    #${BTN_ID}.${DOCKED_CLASS} svg{ display:block; }

    #${BTN_ID}:hover{ opacity:1; }
    #${BTN_ID}:active{ transform:translateY(1px); }

    /* Cross-fade, only while a switch is running (see switchTheme). */
    html.${FADE_CLASS},
    html.${FADE_CLASS} body,
    html.${FADE_CLASS} body *,
    html.${FADE_CLASS} body *::before,
    html.${FADE_CLASS} body *::after{
      transition:background-color ${THEME_FADE_MS}ms ease, color ${THEME_FADE_MS}ms ease,
        border-color ${THEME_FADE_MS}ms ease, box-shadow ${THEME_FADE_MS}ms ease,
        fill ${THEME_FADE_MS}ms ease, stroke ${THEME_FADE_MS}ms ease !important;
    }

    /* The ticket table switches instantly, outside the fade. Chrome does
       not repaint table cells whose background is mid-transition: after a
       dark to light switch the rows stayed dark (with dimmed text) until
       hovered or until the tab was switched. Instant rows avoid that, and
       hundreds of cells no longer animate, which also makes the fade
       cheaper. */
    html.${FADE_CLASS} body .dataTables_wrapper table,
    html.${FADE_CLASS} body .dataTables_wrapper table *,
    html.${FADE_CLASS} body .dataTables_wrapper table *::before,
    html.${FADE_CLASS} body .dataTables_wrapper table *::after{
      transition:none !important;
    }

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

  // Function declaration (hoisted) because apply() calls this during boot,
  // before this point in the file is reached. Its state lives at the top of
  // the IIFE with the other state variables for the same reason.
  function startDomObserver() {
    const root = cachedRoot || findRoot();
    const tableWrap = root && root.querySelector ? root.querySelector(TABLE_WRAPPER_SELECTOR) : null;

    if (tableWrap && tableWrap.isConnected) {
      if (observedWrapper === tableWrap) return;
      // Upgrade from the body-wide fallback to the scoped wrapper observer.
      // Scoped observation is far cheaper: body subtree fires on every page
      // mutation, the wrapper only on table redraws.
      domObserver.disconnect();
      observedWrapper = tableWrap;
      observingBody = false;
      domObserver.observe(tableWrap, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
      return;
    }

    if (observedWrapper && !observedWrapper.isConnected) observedWrapper = null;
    if (!observingBody && !observedWrapper && document.body) {
      domObserver.disconnect();
      observingBody = true;
      domObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  startDomObserver();
})();