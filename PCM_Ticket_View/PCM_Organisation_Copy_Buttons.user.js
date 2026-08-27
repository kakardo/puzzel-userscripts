// @file_name = PCM_Organisation_Copy_Buttons.user.js
// @author = Kardo Rostam
// @version = 2.9_2026-08-27
// @created = 2026-03-23 15:48
// @dependency = PCM Ticket Info Extractor
// @note = Converted from .txt to a standard installable userscript in v2.3.
// @note = Reads customer data only from the extractor outputs published by the PCM Ticket Info Extractor script.

// ==UserScript==
// @name         PCM Organisation Copy Buttons
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.9_2026-08-27
// @description  Adds a primary CustomerId copy button beside Attributes > Organisation in Puzzel Ticketing and adds a Forms row above Form: with CustomerId / Name from the PCM Ticket Info Extractor outputs. Autofills empty Customer ID and Customer Ref form fields, and colour-codes buttons and fields (blue = CustomerId, yellow = Name). Unsaved-change marking lives in PCM Unsaved Form Warning. Uses the shared PCM DOM library. Optimized as a bounded retry injector per ticket route.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/DOM/PCM_DOM_Shared_Local.user.js
// @grant        GM_setClipboard
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Organisation_Copy_Buttons.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Organisation_Copy_Buttons.user.js
// ==/UserScript==

(function () {
  'use strict';

  const D = window.PCM_DOM;
  if (!D || !D.createVisibilityGate) {
    console.warn('PCM Organisation Copy Buttons: PCM_DOM (1.8 or newer) is missing.');
    return;
  }

  const SCRIPT_NAME = 'PCM Organisation Copy Buttons';
  const SCRIPT_VERSION = '2.9_2026-08-27';
  const REQUIRED_SCRIPT_NAME = 'PCM Ticket Info Extractor';

  const ATTRIBUTES_INJECT_ID = 'kardo-attributes-org-copy';
  const FORMS_INJECT_ID = 'kardo-forms-customer-copy';
  const STYLE_ID = 'kardo-attributes-org-copy-style';

  const BOOT_CONFIG = {
    BOOT_MAX_TRIES: 40,
    BOOT_INTERVAL_MS: 200
  };

  const ROUTE_RETRY_INTERVAL_MS = 250;
  const ROUTE_MAX_RETRIES = 28;

  const CSS_TEXT = `
    #${ATTRIBUTES_INJECT_ID},
    #${FORMS_INJECT_ID} {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      vertical-align: middle;
      white-space: nowrap;
    }

    #${ATTRIBUTES_INJECT_ID} {
      margin-left: 10px;
    }

    #${FORMS_INJECT_ID} {
      width: 100%;
      margin: 0 0 16px 0;
      flex-wrap: wrap;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-btn,
    #${FORMS_INJECT_ID} .kardo-copy-btn {
      appearance: none;
      border: 1px solid #bcc7d8;
      background-color: #eef3f8;
      color: #22364d;
      border-radius: 7px;
      padding: 0 12px;
      width: auto;
      min-width: 0;
      height: 32px;
      font-size: 15px;
      line-height: 30px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
      transition: none;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-btn:hover,
    #${FORMS_INJECT_ID} .kardo-copy-btn:hover {
      border-color: #94add1;
      background-color: #e8f1ff;
    }

    /* Colour coding: blue = CustomerId, yellow = Customer Name.
       The matching form fields get the same colours below. */
    #${ATTRIBUTES_INJECT_ID} .kardo-copy-btn.kardo-kind-id,
    #${FORMS_INJECT_ID} .kardo-copy-btn.kardo-kind-id {
      background-color: #dbe9ff;
      border-color: #7fa8e0;
      color: #16365c;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-btn.kardo-kind-id:hover,
    #${FORMS_INJECT_ID} .kardo-copy-btn.kardo-kind-id:hover {
      background-color: #cfe2ff;
      border-color: #5c8fd6;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-btn.kardo-kind-name,
    #${FORMS_INJECT_ID} .kardo-copy-btn.kardo-kind-name {
      background-color: #fff3c4;
      border-color: #e0c76a;
      color: #5c4a16;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-btn.kardo-kind-name:hover,
    #${FORMS_INJECT_ID} .kardo-copy-btn.kardo-kind-name:hover {
      background-color: #ffeda8;
      border-color: #d1b449;
    }

    input.kardo-field-id,
    textarea.kardo-field-id {
      background-color: #dbe9ff !important;
      border-color: #7fa8e0 !important;
    }

    input.kardo-field-name,
    textarea.kardo-field-name {
      background-color: #fff3c4 !important;
      border-color: #e0c76a !important;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-btn.kardo-copied,
    #${FORMS_INJECT_ID} .kardo-copy-btn.kardo-copied {
      background-color: #bfe8bf;
      border-color: #7fc97f;
      color: #22364d;
    }

    #${ATTRIBUTES_INJECT_ID}.kardo-fading .kardo-copy-btn,
    #${FORMS_INJECT_ID}.kardo-fading .kardo-copy-btn {
      transition:
        background-color 3s ease,
        border-color 3s ease,
        color 3s ease,
        box-shadow 3s ease;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-sep,
    #${FORMS_INJECT_ID} .kardo-copy-sep {
      font-size: 19px;
      line-height: 1;
      color: #59697c;
      font-weight: 600;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-status,
    #${FORMS_INJECT_ID} .kardo-copy-status {
      color: #1f6f2a;
      font-size: 15px;
      line-height: 1;
      font-weight: 700;
      white-space: nowrap;
      opacity: 0;
      transition: none;
    }

    #${ATTRIBUTES_INJECT_ID} .kardo-copy-status.kardo-visible,
    #${FORMS_INJECT_ID} .kardo-copy-status.kardo-visible {
      opacity: 1;
    }

    /* Shown inside a button when the matching form field holds a DIFFERENT
       value than the button (or is empty). */
    #${FORMS_INJECT_ID} .kardo-mismatch {
      display: none;
      color: #d9480f;
      font-weight: 700;
      font-size: 13px;
      margin-left: 6px;
    }

    #${FORMS_INJECT_ID} .kardo-mismatch.kardo-visible {
      display: inline;
    }

    #${ATTRIBUTES_INJECT_ID}.kardo-fading .kardo-copy-status,
    #${FORMS_INJECT_ID}.kardo-fading .kardo-copy-status {
      transition:
        opacity 3s ease,
        color 3s ease;
    }
  `;

  const q = (selector, root) => D.query(selector, root);
  const qa = (selector, root) => D.queryAll(selector, root);
  const text = (node) => D.text(node);
  const visible = (node) => D.visible(node);
  const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  const state = {
    routeKey: '',
    completedRouteKey: '',
    retryTimer: 0,
    routeHooksInstalled: false,
    retries: 0,
    done: {
      attributes: false,
      forms: false,
      autofill: false
    },
    cache: {
      extractorRoot: null,
      attributesContainer: null,
      organisationLabel: null,
      formBlock: null,
      formParent: null
    }
  };

  function isConnected(node) {
    return !!(node && node.isConnected);
  }

  function dedupe(values) {
    const seen = new Set();
    return (values || []).filter((value) => {
      const key = clean(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getRouteKey() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  function addStyle() {
    D.ensureStyleTag(STYLE_ID, CSS_TEXT);
  }

  function cleanupInjectedUi() {
    const attributesUi = q(`#${ATTRIBUTES_INJECT_ID}`);
    if (attributesUi) attributesUi.remove();

    const formsUi = q(`#${FORMS_INJECT_ID}`);
    if (formsUi) formsUi.remove();
  }

  function clearAttributesCache() {
    state.cache.attributesContainer = null;
    state.cache.organisationLabel = null;
  }

  function clearFormsCache() {
    state.cache.formBlock = null;
    state.cache.formParent = null;
  }

  function clearAllCaches() {
    state.cache.extractorRoot = null;
    clearAttributesCache();
    clearFormsCache();
  }

  function stopRetryTimer() {
    state.retryTimer = D.clearTimer(state.retryTimer);
  }

  function resetForRoute(routeKey) {
    stopRetryTimer();
    state.routeKey = routeKey;
    state.completedRouteKey = '';
    state.retries = 0;
    state.done.attributes = false;
    state.done.forms = false;
    state.done.autofill = false;
    stopFormsObserver();
    clearAllCaches();
    cleanupInjectedUi();
  }

  function getExtractorRoot() {
    if (isConnected(state.cache.extractorRoot)) return state.cache.extractorRoot;
    state.cache.extractorRoot = q('#pcm-ticket-info');
    return state.cache.extractorRoot;
  }

  function readTicketInfo() {
    const info = window.PCM_TICKET_INFO || {};
    const root = getExtractorRoot();

    const customerIds = dedupe(
      Array.isArray(info.customerIds)
        ? info.customerIds
        : clean(root?.dataset.customerIds || '').split('|')
    );

    const elementCustomerId = customerIds.length ? '' : clean(q('#pcm-ticket-customer-id')?.textContent || '');
    const elementCustomerName = clean(q('#pcm-ticket-customer-name')?.textContent || '');
    const elementCompanyName = clean(q('#pcm-ticket-company-name')?.textContent || '');

    const customerId = clean(
      info.customerId ||
      root?.dataset.customerId ||
      customerIds[0] ||
      elementCustomerId
    );

    const finalIds = dedupe(customerIds.length ? customerIds : [customerId]);

    return {
      customerId: clean(customerId || finalIds[0]),
      customerIds: finalIds,
      customerIdsText: clean(
        info.customerIdsText ||
        root?.dataset.customerIdsText ||
        finalIds.join(' / ')
      ),
      customerName: clean(
        info.customerName ||
        root?.dataset.customerName ||
        elementCustomerName
      ),
      companyName: clean(
        info.companyName ||
        root?.dataset.companyName ||
        elementCompanyName
      )
    };
  }

  function hasUsableTicketInfo(info) {
    return !!(
      (info && info.customerIds && info.customerIds.length) ||
      (info && info.customerId) ||
      (info && info.customerName)
    );
  }

  function findWidget(titleValue) {
    const wanted = clean(titleValue).toLowerCase();
    if (!wanted) return null;

    for (const el of qa('.jarviswidget header strong, header h2 strong, h2 strong')) {
      if (clean(text(el)).toLowerCase() !== wanted) continue;
      return el.closest('.jarviswidget') || el.closest('section') || el.closest('div') || null;
    }

    return null;
  }

  function findScoredContainer(rules, minScore) {
    const all = qa('div, section, form, .panel, .box, .well, .widget, .card').filter(visible);

    let best = null;
    for (const el of all) {
      const value = clean(el.innerText || el.textContent || '');
      let score = 0;

      for (const rule of rules) {
        if (rule.test.test(value)) score += rule.weight;
      }

      if (score < minScore) continue;
      if (!best || score > best.score || (score === best.score && value.length < best.value.length)) {
        best = { el, value, score };
      }
    }

    return best ? best.el : null;
  }

  function getAttributesContainer() {
    if (isConnected(state.cache.attributesContainer)) return state.cache.attributesContainer;

    const widget = findWidget('Attributes');
    state.cache.attributesContainer = widget
      ? (D.findWidgetBody(widget) || widget)
      : findScoredContainer([
          { test: /\bAttributes\b/i, weight: 3 },
          { test: /\bOrganisation\s*:/i, weight: 3 },
          { test: /\bTeam\b/i, weight: 2 },
          { test: /\bPriority\b/i, weight: 2 },
          { test: /\bStatus\b/i, weight: 2 }
        ], 8);

    return state.cache.attributesContainer;
  }

  function getOrganisationLabel() {
    if (isConnected(state.cache.organisationLabel)) return state.cache.organisationLabel;

    const container = getAttributesContainer();
    if (!container) {
      state.cache.organisationLabel = null;
      return null;
    }

    const direct = qa('label, span, div, strong, td, th', container)
      .filter(visible)
      .find((el) => {
        const value = clean(text(el));
        return value === 'Organisation' || value === 'Organisation:';
      });

    if (direct) {
      state.cache.organisationLabel = direct;
      return direct;
    }

    const fallback = qa('*', container)
      .filter(visible)
      .find((el) => /^Organisation\s*:?$/i.test(clean(text(el))));

    state.cache.organisationLabel = fallback || null;
    return state.cache.organisationLabel;
  }

  function getFormBlock() {
    if (isConnected(state.cache.formBlock) && isConnected(state.cache.formParent)) {
      return state.cache.formBlock;
    }

    const label = qa('label, div, span, strong, b').find((el) => {
      const value = clean(text(el));
      return value === 'Form' || value === 'Form:';
    });

    if (!label) {
      state.cache.formBlock = null;
      state.cache.formParent = null;
      return null;
    }

    let block = label.closest('.form-group, .field, .control-group, [class*="field"], [class*="group"], [class*="col"]');
    if (!block) {
      let parent = label.parentElement;
      while (parent && parent !== document.body) {
        if (q('input, select, textarea', parent)) {
          block = parent;
          break;
        }
        parent = parent.parentElement;
      }
    }

    state.cache.formBlock = block || label.parentElement || null;
    state.cache.formParent = state.cache.formBlock ? state.cache.formBlock.parentElement : null;
    return state.cache.formBlock;
  }

  function copyFallback(value) {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  function copyToClipboard(value) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(value);
        return Promise.resolve();
      }
    } catch (_) {}

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).catch(() => copyFallback(value));
    }

    copyFallback(value);
    return Promise.resolve();
  }

  function resetVisuals(wrap) {
    wrap.classList.remove('kardo-fading');
    qa('.kardo-copy-btn', wrap).forEach((btn) => btn.classList.remove('kardo-copied'));
    const status = q('.kardo-copy-status', wrap);
    if (status) status.classList.remove('kardo-visible');
  }

  function showCopiedState(wrap, activeBtn) {
    wrap._holdTimer = D.clearTimer(wrap._holdTimer);
    resetVisuals(wrap);

    const status = q('.kardo-copy-status', wrap);
    if (!status) return;

    activeBtn.classList.add('kardo-copied');
    status.classList.add('kardo-visible');

    wrap._holdTimer = window.setTimeout(() => {
      wrap._holdTimer = 0;
      wrap.classList.add('kardo-fading');
      void wrap.offsetWidth;
      activeBtn.classList.remove('kardo-copied');
      status.classList.remove('kardo-visible');
    }, 1000);
  }

  function dedupeEntries(entries) {
    const seen = new Set();
    return (entries || []).filter((entry) => {
      const key = clean(entry && entry.value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function buildCopyUi(containerId, entries) {
    const wrap = document.createElement('span');
    wrap.id = containerId;
    wrap.dataset.version = SCRIPT_VERSION;
    wrap.dataset.values = entries.map((entry) => entry.value).join('\n');

    entries.forEach((entry, index) => {
      const value = entry.value;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kardo-copy-btn kardo-kind-' + (entry.kind || 'id');
      btn.title = `Copy ${value}`;

      const labelSpan = document.createElement('span');
      labelSpan.textContent = value;
      btn.appendChild(labelSpan);

      const mismatch = document.createElement('span');
      mismatch.className = 'kardo-mismatch';
      mismatch.textContent = '(differs)';
      btn.appendChild(mismatch);
      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await copyToClipboard(value);
        showCopiedState(wrap, btn);
      });
      wrap.appendChild(btn);

      if (index < entries.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'kardo-copy-sep';
        sep.textContent = '/';
        wrap.appendChild(sep);
      }
    });

    const status = document.createElement('span');
    status.className = 'kardo-copy-status';
    status.textContent = 'Copied!';
    wrap.appendChild(status);

    return wrap;
  }

  function ensureAttributesButtons(info) {
    const entries = dedupeEntries([{ value: info.customerId, kind: 'id' }]);
    if (!entries.length) return false;

    const label = getOrganisationLabel();
    if (!label) return false;

    const key = entries.map((entry) => entry.value).join('\n');
    const existing = q(`#${ATTRIBUTES_INJECT_ID}`);
    if (existing && existing.isConnected) {
      if (existing.parentElement === label && existing.dataset.values === key) return true;
      existing.remove();
    }

    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.whiteSpace = 'nowrap';
    label.style.gap = '0';
    label.appendChild(buildCopyUi(ATTRIBUTES_INJECT_ID, entries));
    return true;
  }

  function ensureFormsButtons(info) {
    const entries = dedupeEntries([
      { value: info.customerId, kind: 'id' },
      { value: info.customerName, kind: 'name' }
    ]);
    const formBlock = getFormBlock();
    const formParent = state.cache.formParent;

    if (!entries.length || !formBlock || !formParent) return false;

    const key = entries.map((entry) => entry.value).join('\n');
    const existing = q(`#${FORMS_INJECT_ID}`);
    if (existing && existing.isConnected) {
      if (existing.parentElement === formParent && existing.nextSibling === formBlock && existing.dataset.values === key) return true;
      existing.remove();
    }

    formParent.insertBefore(buildCopyUi(FORMS_INJECT_ID, entries), formBlock);
    return true;
  }

  function findFormField(labelText) {
    const wanted = clean(labelText).toLowerCase();

    const label = qa('label, legend, div, span, strong, b, p, h1, h2, h3, h4, h5, h6, td, th')
      .filter((el) => !el.closest(`#${FORMS_INJECT_ID}`) && !el.closest(`#${ATTRIBUTES_INJECT_ID}`))
      .filter(visible)
      .find((el) => {
        const value = clean(text(el)).toLowerCase();
        return value === wanted || value === wanted + ':';
      });
    if (!label) return null;

    const forId = label.getAttribute ? label.getAttribute('for') : '';
    if (forId) {
      const direct = document.getElementById(forId);
      if (direct) return direct;
    }

    // Walk up from the label and prefer the first field that FOLLOWS it in
    // document order: in a vertical form that is the box under the label,
    // not an earlier field that happens to share an ancestor.
    const isCandidate = (el) =>
      el.type !== 'hidden' &&
      !el.disabled &&
      !el.closest(`#${FORMS_INJECT_ID}`) &&
      !el.closest(`#${ATTRIBUTES_INJECT_ID}`);

    let scope = label;
    for (let i = 0; i < 6 && scope; i += 1) {
      scope = scope.parentElement;
      if (!scope || scope === document.body) break;

      const fields = qa('input, textarea, select', scope).filter(isCandidate);
      if (!fields.length) continue;

      const following = fields.find((el) =>
        label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      return following || fields[0];
    }

    return null;
  }

  function setFieldValueIfEmpty(input, value) {
    if (!input || !clean(value)) return false;
    if (clean(input.value)) return false; // never overwrite anything the agent typed

    // Use the native setter so framework-bound inputs register the change too.
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function ensureFormAutofill(info) {
    const idField = findFormField('Customer ID');
    const refField = findFormField('Customer Ref');
    if (!idField && !refField) return false;

    if (idField) {
      idField.classList.add('kardo-field-id');
      setFieldValueIfEmpty(idField, info.customerId);
    }

    if (refField) {
      refField.classList.add('kardo-field-name');
      setFieldValueIfEmpty(refField, info.customerName);
    }

    // Only done when both fields were found; retries keep looking for a
    // late-rendered one, bounded by ROUTE_MAX_RETRIES as usual.
    return !!(idField && refField);
  }

  // Shows "(differs)" inside a Forms copy button whenever the matching form
  // field holds a different value than the button, or is empty. Exact
  // comparison for the ID, case-insensitive for the name.
  function updateMismatchIndicators() {
    const info = readTicketInfo();

    const pairs = [
      { kind: 'id', label: 'Customer ID', value: info.customerId, exact: true },
      { kind: 'name', label: 'Customer Ref', value: info.customerName, exact: false }
    ];

    for (const pair of pairs) {
      const buttons = qa(`#${FORMS_INJECT_ID} .kardo-copy-btn.kardo-kind-${pair.kind}`);
      if (!buttons.length) continue;

      let mismatch = false;
      const target = clean(pair.value);
      if (target) {
        const field = findFormField(pair.label);
        if (field) {
          const current = clean(field.value);
          mismatch = pair.exact
            ? current !== target
            : current.toLowerCase() !== target.toLowerCase();
        }
      }

      buttons.forEach((btn) => {
        const tag = q('.kardo-mismatch', btn);
        if (tag) tag.classList.toggle('kardo-visible', mismatch);
      });
    }
  }

  const mismatchGate = D.createVisibilityGate(updateMismatchIndicators, 150);

  // Puzzel re-renders #form-fields-wrapper when the form answers arrive from
  // the server, replacing the inputs and wiping our colours and autofill.
  // A scoped observer on the form's fieldset reapplies after each re-render.
  // Capped per route so it can never fight the app in a loop.
  const REAPPLY_DEBOUNCE_MS = 150;
  const REAPPLY_MAX_PER_ROUTE = 15;

  let formsObserver = null;
  let formsObserverRoot = null;
  let reapplyTimer = 0;
  let reapplyCount = 0;

  function stopFormsObserver() {
    if (formsObserver) formsObserver.disconnect();
    formsObserverRoot = null;
    reapplyTimer = D.clearTimer(reapplyTimer);
    reapplyCount = 0;
  }

  function scheduleReapply() {
    if (reapplyCount >= REAPPLY_MAX_PER_ROUTE) return;
    reapplyTimer = D.clearTimer(reapplyTimer);
    reapplyTimer = window.setTimeout(() => {
      reapplyTimer = 0;
      reapplyAfterRerender();
    }, REAPPLY_DEBOUNCE_MS);
  }

  function reapplyAfterRerender() {
    reapplyCount += 1;

    const info = readTicketInfo();
    if (!hasUsableTicketInfo(info)) return;

    const formsUi = q(`#${FORMS_INJECT_ID}`);
    if (!formsUi || !formsUi.isConnected) {
      clearFormsCache();
      state.done.forms = ensureFormsButtons(info) || state.done.forms;
    }

    const attributesUi = q(`#${ATTRIBUTES_INJECT_ID}`);
    if (!attributesUi || !attributesUi.isConnected) {
      clearAttributesCache();
      state.done.attributes = ensureAttributesButtons(info) || state.done.attributes;
    }

    ensureFormAutofill(info);
    ensureFormsObserver();
    mismatchGate.schedule();
  }

  function ensureFormsObserver() {
    const wrapper = q('#form-fields-wrapper');
    const root = (wrapper && (wrapper.closest('fieldset') || wrapper.parentElement)) || state.cache.formParent;
    if (!root || !root.isConnected || formsObserverRoot === root) return;

    if (!formsObserver) {
      formsObserver = new MutationObserver(scheduleReapply);
    }

    formsObserver.disconnect();
    formsObserver.observe(root, { childList: true, subtree: true });
    formsObserverRoot = root;
  }

  function routeIsCurrent(routeKey) {
    return routeKey === getRouteKey();
  }

  function markRouteComplete(routeKey) {
    state.completedRouteKey = routeKey;
    stopRetryTimer();
  }

  function scheduleRetry(delayMs) {
    const routeKey = getRouteKey();
    if (state.completedRouteKey === routeKey) return;

    stopRetryTimer();
    state.retryTimer = window.setTimeout(() => {
      state.retryTimer = 0;
      runRouteAttempt(routeKey);
    }, typeof delayMs === 'number' ? delayMs : ROUTE_RETRY_INTERVAL_MS);
  }

  function runRouteAttempt(routeKey) {
    if (!routeIsCurrent(routeKey)) return;
    if (state.completedRouteKey === routeKey) return;

    addStyle();
    state.retries += 1;

    const info = readTicketInfo();
    if (hasUsableTicketInfo(info)) {
      if (!state.done.attributes) {
        state.done.attributes = ensureAttributesButtons(info) || state.done.attributes;
        if (!state.done.attributes) clearAttributesCache();
      }

      if (!state.done.forms) {
        state.done.forms = ensureFormsButtons(info) || state.done.forms;
        if (!state.done.forms) clearFormsCache();
      }

      if (!state.done.autofill) {
        state.done.autofill = ensureFormAutofill(info) || state.done.autofill;
      }

      if (state.done.forms || state.done.autofill) {
        ensureFormsObserver();
      }

      mismatchGate.schedule();
    } else {
      clearAllCaches();
    }

    if (state.done.attributes && state.done.forms && state.done.autofill) {
      markRouteComplete(routeKey);
      return;
    }

    if (state.retries >= ROUTE_MAX_RETRIES) {
      markRouteComplete(routeKey);
      return;
    }

    scheduleRetry(ROUTE_RETRY_INTERVAL_MS);
  }

  function handlePotentialRouteChange() {
    const nextRouteKey = getRouteKey();
    if (nextRouteKey === state.routeKey && state.completedRouteKey === nextRouteKey) return;
    resetForRoute(nextRouteKey);
    scheduleRetry(0);
  }

  function installRouteHooks() {
    if (state.routeHooksInstalled) return;
    state.routeHooksInstalled = true;

    const wrapHistoryMethod = (methodName) => {
      const original = history[methodName];
      if (typeof original !== 'function') return;

      history[methodName] = function () {
        const result = original.apply(this, arguments);
        window.dispatchEvent(new Event('pcm-org-copy-route-change'));
        return result;
      };
    };

    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');

    window.addEventListener('hashchange', handlePotentialRouteChange, true);
    window.addEventListener('popstate', handlePotentialRouteChange, true);
    window.addEventListener('pcm-org-copy-route-change', handlePotentialRouteChange, true);
  }

  function init() {
    addStyle();
    state.routeKey = getRouteKey();
    installRouteHooks();

    // Typing in the fields must update the "(differs)" tags live.
    const onFieldEvent = (event) => {
      const target = event.target;
      if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT')) return;
      mismatchGate.schedule();
    };
    document.addEventListener('input', onFieldEvent, true);
    document.addEventListener('change', onFieldEvent, true);

    document.addEventListener('pcm-ticket-info-ready', () => {
      if (state.completedRouteKey === getRouteKey() && state.done.attributes && state.done.forms && state.done.autofill) return;
      clearAllCaches();
      scheduleRetry(0);
    }, false);

    scheduleRetry(0);

    console.info(`${SCRIPT_NAME} ${SCRIPT_VERSION} loaded. ${REQUIRED_SCRIPT_NAME} is required for this script to activate.`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      D.bootUntil(() => !!document.body, init, BOOT_CONFIG);
    }, { once: true });
  } else {
    D.bootUntil(() => !!document.body, init, BOOT_CONFIG);
  }
})();
