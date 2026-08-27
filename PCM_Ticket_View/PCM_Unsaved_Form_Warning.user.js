// @file_name = PCM_Unsaved_Form_Warning.user.js
// @author = Kardo Rostam
// @version = 1.2_2026-08-27
// @created = 2026-08-27 09:37

// ==UserScript==
// @name         PCM Unsaved Form Warning
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.2_2026-08-27
// @description  Snapshot-based unsaved change detection for the ticket Forms widget. Highlights every field whose value differs from the loaded state (including values typed by the Copy Buttons autofill) and shows a warning text next to the Save button. Highlight colour/mode and warning text are settings at the top.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/DOM/PCM_DOM_Shared_Local.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Unsaved_Form_Warning.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Unsaved_Form_Warning.user.js
// ==/UserScript==

(function () {
  'use strict';

  /******************************************************************
   * USER SETTINGS
   ******************************************************************/
  const HIGHLIGHT_COLOR = '#8b0000';       // colour for unsaved fields and the warning text
  const HIGHLIGHT_MODE = 'border';         // 'text' | 'border' | 'both'
  const HIGHLIGHT_BORDER_WIDTH_PX = 2;     // thickness of the unsaved border
  const WARNING_TEXT = 'Unsaved values exist';
  const WARN_ON_LEAVE = false;         // browser prompt when leaving with unsaved values

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const D = window.PCM_DOM;
  if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate) {
    console.error('PCM Unsaved Form Warning: PCM_DOM shared helpers are missing (lib 1.8 or newer required).');
    return;
  }

  const WARNING_ID = 'pcm-unsaved-warning';
  const FIELD_CLASS = 'pcm-unsaved-field';
  const STYLE_ID = 'pcm-unsaved-warning-style';
  const EVALUATE_DEBOUNCE_MS = 100;
  const REBASE_DEBOUNCE_MS = 60; // must stay below Copy Buttons' 150ms reapply
  // A re-render this soon after one of YOUR change events is a dependent
  // re-render (Form or Puzzel Service swapping fields), so the baseline is
  // kept and the change stays marked. Later swaps count as app refreshes.
  const USER_RERENDER_WINDOW_MS = 4000;

  const fieldCss = {
    border: `border-color: ${HIGHLIGHT_COLOR} !important; box-shadow: inset 0 0 0 ${HIGHLIGHT_BORDER_WIDTH_PX}px ${HIGHLIGHT_COLOR} !important;`,
    text: `color: ${HIGHLIGHT_COLOR} !important;`
  };
  const fieldRules = HIGHLIGHT_MODE === 'both'
    ? fieldCss.border + fieldCss.text
    : (fieldCss[HIGHLIGHT_MODE] || fieldCss.border);

  D.ensureStyleTag(STYLE_ID, `
    input.${FIELD_CLASS},
    textarea.${FIELD_CLASS},
    select.${FIELD_CLASS} {
      ${fieldRules}
    }

    /* SmartAdmin wraps selects/inputs in a label with an absolutely
       positioned arrow element that paints OVER the field's border. For
       wrapped fields the ring is drawn as an overlay on the wrapper
       instead, so it stays on top of the arrow without blocking clicks. */
    label.${FIELD_CLASS}-wrap {
      position: relative;
    }

    label.${FIELD_CLASS}-wrap::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      pointer-events: none;
      z-index: 2;
      box-shadow: inset 0 0 0 ${HIGHLIGHT_BORDER_WIDTH_PX}px ${HIGHLIGHT_COLOR};
    }

    label.${FIELD_CLASS}-wrap .${FIELD_CLASS} {
      box-shadow: none !important;
    }

    #${WARNING_ID} {
      display: none;
      color: ${HIGHLIGHT_COLOR};
      font-weight: 700;
      font-size: 14px;
      margin-right: 12px;
      vertical-align: middle;
      white-space: nowrap;
    }

    #${WARNING_ID}.pcm-visible {
      display: inline-block;
    }
  `);

  let baseline = new Map();
  let dirty = false;
  let fieldsObserver = null;
  let fieldsObserverRoot = null;
  // Any field change counts here, trusted keystrokes AND synthetic autofill
  // events: PCM re-renders as an echo of both, and neither echo may rebase
  // the baseline, or unsaved marks would vanish.
  let lastFieldChangeAt = 0;

  function findForm() {
    return D.query('#ticket-forms-form') ||
      D.query('form.ticket-forms-form') ||
      (D.query('#form-fields-wrapper') ? D.query('#form-fields-wrapper').closest('form') : null);
  }

  function getFields(form) {
    return D.queryAll('input:not([type="hidden"]), textarea, select', form)
      .filter((el) => !el.closest('.form-actions'));
  }

  function fieldValue(field) {
    if (field.type === 'checkbox' || field.type === 'radio') {
      return (field.checked ? '1:' : '0:') + String(field.value);
    }
    return String(field.value);
  }

  function hasMeaningfulValue(field) {
    if (field.type === 'checkbox' || field.type === 'radio') return field.checked;
    return D.cleanText(field.value) !== '';
  }

  function fieldLabel(field) {
    const section = field.closest('section, .form-group, .col-md-5, [class*="col"]');
    const label = section ? D.query('label.label, label', section) : null;
    return D.cleanText(label ? label.textContent : '') || field.name || field.id || 'field';
  }

  // Fields are keyed by their visible LABEL, not by DOM node or name, so the
  // baseline survives Form / Puzzel Service re-renders that rebuild the
  // inputs. Duplicate labels get an occurrence suffix.
  function keyedFields(form) {
    const counts = new Map();
    return getFields(form).map((field) => {
      const base = D.cleanText(fieldLabel(field)).toLowerCase().replace(/:$/, '');
      const occurrence = counts.get(base) || 0;
      counts.set(base, occurrence + 1);
      return { field, key: base + '#' + occurrence };
    });
  }

  function captureBaseline() {
    const form = findForm();
    baseline = new Map();
    if (!form) return;

    keyedFields(form).forEach(({ field, key }) => {
      baseline.set(key, fieldValue(field));
    });
  }

  function ensureWarningElement() {
    let el = D.query('#' + WARNING_ID);
    if (el && el.isConnected) return el;

    const form = findForm();
    const actions = form ? D.query('.form-actions', form) : D.query('.form-actions');
    if (!actions) return null;

    const saveButton = D.query('button[type="submit"], input[type="submit"], button', actions);

    el = document.createElement('span');
    el.id = WARNING_ID;
    el.textContent = WARNING_TEXT;

    if (saveButton) {
      actions.insertBefore(el, saveButton);
    } else {
      actions.appendChild(el);
    }

    return el;
  }

  function evaluate() {
    const form = findForm();
    if (!form) return;

    const changed = [];
    keyedFields(form).forEach(({ field, key }) => {
      // Known label: changed when the value differs from the loaded state.
      // Unknown label (field appeared via a Form / Puzzel Service change):
      // unsaved as soon as it carries any value.
      const isChanged = baseline.has(key)
        ? baseline.get(key) !== fieldValue(field)
        : hasMeaningfulValue(field);

      field.classList.toggle(FIELD_CLASS, isChanged);

      // Ring on the SmartAdmin wrapper too, drawn above the arrow overlay.
      const wrap = field.closest('label.select, label.input, label.textarea');
      const useWrapRing = HIGHLIGHT_MODE === 'border' || HIGHLIGHT_MODE === 'both';
      if (wrap) wrap.classList.toggle(FIELD_CLASS + '-wrap', isChanged && useWrapRing);

      if (isChanged) changed.push(field);
    });

    dirty = changed.length > 0;

    const warning = ensureWarningElement();
    if (warning) {
      warning.classList.toggle('pcm-visible', dirty);
      warning.title = dirty
        ? 'Changed: ' + changed.map(fieldLabel).join(', ')
        : '';
    }
  }

  const evaluateGate = D.createVisibilityGate(evaluate, EVALUATE_DEBOUNCE_MS);

  function rebase() {
    captureBaseline();
    evaluate();
    ensureFieldsObserver();
  }

  const rebaseGate = D.createVisibilityGate(rebase, REBASE_DEBOUNCE_MS);

  function mutationTouchesFields(mutations) {
    for (const mutation of mutations) {
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      for (const node of nodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('input, textarea, select')) return true;
        if (node.querySelector && node.querySelector('input, textarea, select')) return true;
      }
    }
    return false;
  }

  function ensureFieldsObserver() {
    // Root on the FORM element: it survives the fieldset swaps that Form /
    // Puzzel Service changes cause. A detached root re-arms on next call.
    if (fieldsObserverRoot && !fieldsObserverRoot.isConnected) fieldsObserverRoot = null;

    const root = findForm() || D.query('#form-fields-wrapper');
    if (!root || !root.isConnected || fieldsObserverRoot === root) return;

    if (!fieldsObserver) {
      fieldsObserver = new MutationObserver((mutations) => {
        if (!mutationTouchesFields(mutations)) return;

        // Field swap caused by a recent change (your Form / Puzzel Service
        // cascades, or the app echoing an autofill): keep the baseline so
        // those changes stay marked, and re-evaluate the new fields against
        // it. Field swap with no recent change at all is an app refresh
        // (initial answers load): rebase.
        if (Date.now() - lastFieldChangeAt < USER_RERENDER_WINDOW_MS) {
          evaluateGate.schedule();
        } else {
          rebaseGate.schedule();
        }
      });
    }

    fieldsObserver.disconnect();
    fieldsObserver.observe(root, { childList: true, subtree: true });
    fieldsObserverRoot = root;
  }

  function isSaveClick(event) {
    if (!event.isTrusted) return false;
    const btn = event.target && event.target.closest
      ? event.target.closest('button, input[type="submit"], a.btn')
      : null;
    if (!btn) return false;
    return /\bsave\b/i.test(D.cleanText(btn.textContent || btn.value || ''));
  }

  function installListeners() {
    const onFieldEvent = (event) => {
      const form = findForm();
      if (!form || !form.contains(event.target)) return;
      lastFieldChangeAt = Date.now();
      // Re-arm the re-render observer if the app replaced its root.
      ensureFieldsObserver();
      evaluateGate.schedule();
    };

    document.addEventListener('input', onFieldEvent, true);
    document.addEventListener('change', onFieldEvent, true);

    document.addEventListener('click', (event) => {
      if (!isSaveClick(event)) return;
      // Saving stores the current values: they become the new baseline.
      rebaseGate.cancel();
      rebase();
    }, true);

    if (WARN_ON_LEAVE) {
      window.addEventListener('beforeunload', (event) => {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = '';
      });
    }
  }

  function installRouteHooks() {
    const onRouteChange = () => {
      // New ticket: fresh baseline once the new form exists.
      dirty = false;
      D.bootUntil(() => !!findForm(), rebase, { BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 250 });
    };

    const wrapHistoryMethod = (methodName) => {
      const original = history[methodName];
      if (typeof original !== 'function') return;
      history[methodName] = function () {
        const result = original.apply(this, arguments);
        window.dispatchEvent(new Event('pcm-unsaved-route-change'));
        return result;
      };
    };

    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');
    window.addEventListener('popstate', onRouteChange, true);
    window.addEventListener('hashchange', onRouteChange, true);
    window.addEventListener('pcm-unsaved-route-change', onRouteChange, true);
  }

  function start() {
    installListeners();
    installRouteHooks();
    rebase();
  }

  D.bootUntil(() => !!(document.body && findForm()), start, {
    BOOT_MAX_TRIES: 60,
    BOOT_INTERVAL_MS: 250
  });
})();
