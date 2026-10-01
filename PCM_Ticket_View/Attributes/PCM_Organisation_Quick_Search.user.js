// @file_name = PCM_Organisation_Quick_Search.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-01
// @created = 2026-10-01 10:27
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples).

// ==UserScript==
// @name         PCM Organisation Quick Search
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-01
// @description  Adds one-click search buttons under Attributes > Organisation. A button opens the Organisation dropdown and types its text into the search box: the Customer ID found by the PCM Ticket Info Extractor, the Customer ID the customer entered in Forms (shown only when it differs), and fixed search strings from the SEARCH_BUTTONS config. When the search returns exactly one organisation it is picked automatically; otherwise the dropdown stays open with the results. Event-driven via a scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Organisation_Quick_Search.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Organisation_Quick_Search.user.js
// ==/UserScript==

(function () {
  'use strict';

  /******************************************************************
   * USER SETTINGS
   * Fixed search buttons. "label" is the text in the bubble, "search"
   * is what gets typed into the Organisation search box, "color" its
   * fill.
   ******************************************************************/
  const SEARCH_BUTTONS = [
    { label: 'Internal', search: 'Puzzel Internal', color: '#455a64' }
  ];

  // Colours of the dynamic buttons. Blue matches the CustomerId colour
  // used by PCM Form Buttons.
  const FOUND_ID_COLOR = '#1e5bd8'; // ID found by the Ticket Info Extractor
  const FORM_ID_COLOR = '#e65100';  // ID the customer entered in Forms

  // At most this many found IDs get their own button (tickets can carry
  // several CI organisation rows).
  const MAX_FOUND_IDS = 3;

  // Pick the organisation automatically when the search returns exactly
  // one result. Set to false to always leave the choice to you.
  const AUTO_PICK_SINGLE = true;

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const D = window.PCM_DOM;
  if (!D || !D.bootUntil || !D.ensureStyleTag || !D.cleanText || !D.installNavigationHooks ||
      !D.createVisibilityGate || !D.createFieldFinder || !D.flashLabel) {
    console.error('PCM Organisation Quick Search: PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
    return;
  }

  const WRAP_ID = 'pcm-org-quick-search';
  const STYLE_ID = 'pcm-org-quick-search-style';
  const DYNAMIC_CLASS = 'pcm-org-dynamic';
  const SCAN_DELAY_MS = 150;

  // Results are judged only after the list has been quiet this long, so
  // a half-loaded ajax list is never mistaken for a single match.
  const RESULTS_QUIET_MS = 400;
  const RESULTS_GRACE_MS = 1500;
  const RESULTS_TIMEOUT_MS = 8000;
  const SEARCH_RETRIES = 2;

  D.ensureStyleTag(STYLE_ID, `
    #${WRAP_ID} {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 5px;
    }

    #${WRAP_ID} .pcm-org-btn {
      appearance: none;
      border: 1px solid rgba(0,0,0,0.25);
      color: #ffffff;
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.5;
      cursor: pointer;
      opacity: 0.8;
      white-space: nowrap;
    }

    #${WRAP_ID} .pcm-org-btn:hover {
      opacity: 1;
    }

    #${WRAP_ID} .pcm-org-btn:disabled {
      opacity: 0.4;
      cursor: progress;
    }
  `);

  /******************************************************************
   * Locating the Organisation dropdown
   ******************************************************************/
  function attributesForm() {
    return D.query('#ticket-attributes-form') || D.query('form.edit_ticket');
  }

  function hasSelect2(select) {
    const sibling = select.nextElementSibling;
    return !!(sibling && (sibling.classList.contains('select2') ||
      sibling.classList.contains('select2-container')));
  }

  function organisationSelect() {
    const form = attributesForm();
    if (!form) return null;

    const label = D.queryAll('label', form).find((el) =>
      /^organisation\s*:?$/i.test(D.cleanText(el.textContent))
    );

    // Walk up from the label and take the first select2-backed select
    // that follows it: in this layout that is the box under the label.
    let scope = label;
    for (let i = 0; i < 4 && scope; i += 1) {
      scope = scope.parentElement;
      if (!scope || scope === form.parentElement) break;
      const found = D.queryAll('select', scope).find((el) =>
        hasSelect2(el) && (label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
      if (found) return found;
    }

    return D.query('select[id*="organisation" i], select[name*="organisation" i]', form);
  }

  /******************************************************************
   * Values for the dynamic buttons
   ******************************************************************/
  function foundIds() {
    const info = window.PCM_TICKET_INFO || {};
    const root = document.getElementById('pcm-ticket-info');
    let ids = Array.isArray(info.customerIds) ? info.customerIds : [];
    if (!ids.length && root && root.dataset.customerIds) ids = root.dataset.customerIds.split('|');
    if (!ids.length && info.customerId) ids = [info.customerId];
    const seen = new Set();
    return ids.map(D.cleanText).filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, MAX_FOUND_IDS);
  }

  const fieldFinder = D.createFieldFinder({ excludeSelector: `#${WRAP_ID}` });

  function formCustomerId() {
    const field = fieldFinder.field('Customer ID');
    return field ? D.cleanText(field.value) : '';
  }

  function dynamicEntries() {
    const ids = foundIds();
    const entries = ids.map((id) => ({
      label: 'ID ' + id,
      search: id,
      color: FOUND_ID_COLOR,
      title: 'Search Organisation for the Customer ID found on the ticket (' + id + ')'
    }));
    const typed = formCustomerId();
    if (typed && ids.indexOf(typed) === -1) {
      entries.push({
        label: 'Form ' + typed,
        search: typed,
        color: FORM_ID_COLOR,
        title: 'Search Organisation for the Customer ID entered in Forms (' + typed + ')'
      });
    }
    return entries;
  }

  /******************************************************************
   * Driving select2 (v4 markup first, v3 as a fallback)
   ******************************************************************/
  function openSearchField() {
    return D.query('.select2-container--open .select2-search__field') ||
      D.query('.select2-drop-active input.select2-input') ||
      D.query('#select2-drop input.select2-input');
  }

  function resultsList() {
    return D.query('.select2-container--open .select2-results__options') ||
      D.query('.select2-drop-active .select2-results') ||
      D.query('#select2-drop .select2-results');
  }

  function isLoading(list, search) {
    if (D.query('.loading-results, .select2-searching', list)) return true;
    return !!(search && search.classList.contains('select2-active'));
  }

  function selectableResults(list) {
    return D.queryAll(
      '.select2-results__option:not(.loading-results):not(.select2-results__message):not([aria-disabled="true"]), ' +
      'li.select2-result-selectable',
      list
    ).filter((el) => !el.querySelector('.select2-results__option, li.select2-result-selectable'));
  }

  function pressEnter(search, jq) {
    jq(search).trigger(jq.Event('keydown', { which: 13, keyCode: 13, key: 'Enter' }));
  }

  // Resolves once the result list is no longer loading and has been
  // quiet for RESULTS_QUIET_MS. With requireChange, an untouched list is
  // only accepted after RESULTS_GRACE_MS (select2 can keep the list as
  // is for a repeated term). Resolves false on timeout or when the
  // dropdown was closed or reopened meanwhile.
  function waitForSettled(list, search, requireChange) {
    return new Promise((resolve) => {
      let quietTimer = 0;
      let changed = false;
      const startedAt = Date.now();
      const observer = new MutationObserver(() => {
        changed = true;
        arm();
      });
      const giveUp = window.setTimeout(() => finish(false), RESULTS_TIMEOUT_MS);

      function finish(ok) {
        observer.disconnect();
        window.clearTimeout(quietTimer);
        window.clearTimeout(giveUp);
        resolve(ok);
      }

      function evaluate() {
        if (!search.isConnected || openSearchField() !== search) return finish(false);
        const waited = Date.now() - startedAt > RESULTS_GRACE_MS;
        if ((requireChange && !changed && !waited) || isLoading(list, search)) return arm();
        finish(true);
      }

      function arm() {
        window.clearTimeout(quietTimer);
        quietTimer = window.setTimeout(evaluate, RESULTS_QUIET_MS);
      }

      observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      arm();
    });
  }

  function typeTerm(search, term, jq) {
    search.focus();
    search.value = term;
    // Native input reaches both select2 versions; keyup-change is the
    // extra cue select2 v3 listens for.
    search.dispatchEvent(new Event('input', { bubbles: true }));
    jq(search).trigger('keyup').trigger('keyup-change');
  }

  // A list that belongs to the term has at least one result containing
  // it. Used to spot a late unfiltered response that overwrote ours.
  function resultsMatch(list, term) {
    const wanted = D.cleanText(term).toLowerCase();
    return selectableResults(list).some((el) =>
      D.cleanText(el.textContent).toLowerCase().indexOf(wanted) !== -1
    );
  }

  let activeRun = 0;

  async function runSearch(term, btn) {
    const select = organisationSelect();
    const jq = window.jQuery || window.$;
    if (!select || !jq || !jq.fn || !jq.fn.select2) {
      console.error('PCM Organisation Quick Search: Organisation dropdown or select2 not found.');
      D.flashLabel(btn, 'Not found');
      return;
    }

    const run = ++activeRun;
    jq(select).select2('open');
    const search = openSearchField();
    const list = resultsList();
    if (!search || !list) {
      console.error('PCM Organisation Quick Search: select2 search box not found after opening.');
      D.flashLabel(btn, 'No search box');
      return;
    }

    // Opening starts an unfiltered load of its own. Typing before it has
    // answered lets that late response overwrite the searched list, so
    // wait for it first.
    await waitForSettled(list, search, false);
    if (run !== activeRun) return;

    for (let attempt = 0; attempt <= SEARCH_RETRIES; attempt += 1) {
      typeTerm(search, term, jq);
      if (!(await waitForSettled(list, search, true)) || run !== activeRun) return;
      if (resultsMatch(list, term)) break;
      // Still no matching row: either a stale list or a real no-match.
      // Retyping is harmless in both cases.
    }

    if (AUTO_PICK_SINGLE && selectableResults(list).length === 1 && resultsMatch(list, term)) {
      pressEnter(search, jq);
    }
  }

  /******************************************************************
   * Buttons
   ******************************************************************/
  function makeButton(entry, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pcm-org-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = entry.label;
    btn.title = entry.title || 'Search Organisation for "' + entry.search + '"';
    btn.style.backgroundColor = entry.color;
    btn.dataset.search = entry.search;
    btn.addEventListener('click', (event) => {
      // Also stops a surrounding label from toggling the dropdown.
      event.preventDefault();
      event.stopPropagation();
      runSearch(btn.dataset.search, btn);
    });
    return btn;
  }

  function signature(entries) {
    return entries.map((e) => e.label).join('|');
  }

  // Dynamic buttons are rebuilt only when their values change, so the
  // observer-driven refresh is a few reads and a string compare.
  function refreshDynamic(wrap) {
    const entries = dynamicEntries();
    const next = signature(entries);
    if (wrap.dataset.dynamic === next) return;
    wrap.dataset.dynamic = next;

    D.queryAll('.' + DYNAMIC_CLASS, wrap).forEach((el) => el.remove());
    const first = wrap.firstChild;
    entries.forEach((entry) => {
      wrap.insertBefore(makeButton(entry, DYNAMIC_CLASS), first);
    });
  }

  function ensure() {
    const select = organisationSelect();
    if (!select) return false;

    let wrap = document.getElementById(WRAP_ID);
    if (wrap && !wrap.isConnected) wrap = null;

    if (!wrap) {
      const host = select.nextElementSibling && hasSelect2(select)
        ? select.nextElementSibling
        : select;
      const anchor = host.closest('label.select') || host;
      if (!anchor.parentElement) return false;

      wrap = document.createElement('div');
      wrap.id = WRAP_ID;
      SEARCH_BUTTONS.forEach((entry) => {
        if (entry.search) wrap.appendChild(makeButton(entry));
      });
      anchor.insertAdjacentElement('afterend', wrap);
    }

    refreshDynamic(wrap);
    return true;
  }

  /******************************************************************
   * Boot and refresh
   ******************************************************************/
  const gate = D.createVisibilityGate(ensure, SCAN_DELAY_MS);

  function start() {
    // The Attributes widget and the Forms fields are re-rendered by
    // PCM, so watch for insertions; the callback only schedules the
    // gated ensure, which skips while the tab is hidden.
    const root = document.getElementById('content') || document.body;
    const observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i += 1) {
        if (mutations[i].addedNodes.length) {
          gate.schedule();
          return;
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    gate.schedule(0);

    // New extractor results, and the agent or Form Buttons editing the
    // Forms Customer ID.
    document.addEventListener('pcm-ticket-info-ready', () => gate.schedule(), false);
    document.addEventListener('input', () => gate.schedule(), true);
    document.addEventListener('change', () => gate.schedule(), true);
  }

  D.installNavigationHooks(function () {
    D.bootUntil(ensure, function () {}, { BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 250 });
  });
  D.bootUntil(function () {
    return !!document.body;
  }, start);
})();
