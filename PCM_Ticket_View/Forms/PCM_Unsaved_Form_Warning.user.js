// @file_name = PCM_Unsaved_Form_Warning.user.js
// @author = Kardo Rostam
// @version = 2.0_2026-11-16
// @created = 2026-08-27 09:37

// ==UserScript==
// @name         PCM Unsaved Form Warning
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.0_2026-11-16
// @description  Snapshot-based unsaved change detection for the ticket Forms widget. Highlights every field whose value differs from the loaded state (including values typed by the Form Buttons autofill) and shows a warning text next to the Save button. When every unsaved field is a correction PCM Form Buttons made to a saved value (its orange ring), the warning reads "Corrected values, please save" in orange instead (needs lib 2.4; with an older lib the normal warning shows). Highlight colour/mode and warning texts are settings at the top. Since 1.5 the watcher engine lives in the shared library (createUnsavedWatcher), so this script only supplies the Forms zone configuration and styling; Save clicks clear this zone only. Since 2.0 it also catches a failed Forms load: when PCM's server answers a request for (part of) the form with an error (seen as a 502 for the fields under Puzzel Service), PCM leaves its loading overlay up for good; the overlay is then taken away and a short note with "Try again" asks PCM for that part once more (or offers a page reload when the field cannot be found). Event-driven via jQuery's ajaxComplete, only acting on a failed form request.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Forms/PCM_Unsaved_Form_Warning.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Forms/PCM_Unsaved_Form_Warning.user.js
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
  // When EVERY unsaved field is a correction PCM Form Buttons made to a
  // saved value (its orange ring, e.g. a capital first letter in Customer
  // Ref), the warning says so in orange instead. Any other change shows
  // the normal text and colour.
  const CORRECTION_TEXT = 'Corrected values, please save';
  const CORRECTION_COLOR = '#f08c00';
  const WARN_ON_LEAVE = false;             // browser prompt when leaving with unsaved values

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const D = window.PCM_DOM;
  if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createUnsavedWatcher) {
    console.error('PCM Unsaved Form Warning: PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
    return;
  }

  const WARNING_ID = 'pcm-unsaved-warning';
  const FIELD_CLASS = 'pcm-unsaved-field';
  const STYLE_ID = 'pcm-unsaved-warning-style';
  const CORRECTION_CLASS = 'pcm-unsaved-corrections';
  const CORRECTED_FIELD_CLASS = 'kardo-field-capitalised';   // set by PCM Form Buttons

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

    #${WARNING_ID}.${CORRECTION_CLASS} {
      color: ${CORRECTION_COLOR};
    }
  `);

  // Only orange corrections unsaved: the correction text and colour.
  // Written only when it differs, so nothing is touched on every check.
  function decorateWarning(result) {
    const warning = result.warning;
    if (!warning) return;
    const onlyCorrections = result.dirty && result.changed.every((field) =>
      field.classList.contains(CORRECTED_FIELD_CLASS));
    const text = onlyCorrections ? CORRECTION_TEXT : WARNING_TEXT;
    if (warning.textContent !== text) warning.textContent = text;
    if (warning.classList.contains(CORRECTION_CLASS) !== onlyCorrections) {
      warning.classList.toggle(CORRECTION_CLASS, onlyCorrections);
    }
  }

  function findForm() {
    return D.query('#ticket-forms-form') ||
      D.query('form.ticket-forms-form') ||
      (D.query('#form-fields-wrapper') ? D.query('#form-fields-wrapper').closest('form') : null);
  }

  // All behaviour (label-keyed baseline, re-render handling, per-zone
  // save clearing, visibility gating) lives in the shared engine.
  const watcher = D.createUnsavedWatcher({
    findRoot: findForm,
    warningId: WARNING_ID,
    fieldClass: FIELD_CLASS,
    warningText: WARNING_TEXT,
    warnOnLeave: WARN_ON_LEAVE,
    useWrapRing: HIGHLIGHT_MODE === 'border' || HIGHLIGHT_MODE === 'both',
    onEvaluate: decorateWarning,  // lib 2.4; an older lib simply skips it
    // lib 2.6: when PCM's form check took an unsaved value as the original
    // (it records them again after sending an email), Save is made
    // possible again by giving it the saved value back.
    repairFormCheck: true
  });

  watcher.start();

  // FAILED FORM LOADS
  // PCM shows a white overlay with a spinner while it loads (part of) the
  // form, and only removes it when the answer is good. A server error left
  // it up for good, so the form looked like it was loading forever. After
  // a failed request for the form, the overlay is hidden and a note offers
  // to load that part again: the field whose choice it belongs to is
  // changed to the same value once more, which makes PCM ask again.
  const FAIL_ID = 'pcm-forms-load-failed';
  const FORM_LOAD_URL = /\/(form_fields|assignable_forms)\b/;
  const FAIL_CHECK_MS = 400;

  D.ensureStyleTag('pcm-forms-load-failed-style', `
    #${FAIL_ID} {
      margin: 6px 0 10px; padding: 7px 10px; border: 1px solid #e0b4b4; border-radius: 4px;
      background: #fff6f6; color: #9f3a38; font-size: 13px;
    }
    #${FAIL_ID} a { margin-left: 6px; font-weight: 600; cursor: pointer; }
  `);

  function formsWidget() {
    const form = findForm();
    return form ? (form.closest('.jarviswidget') || form.parentElement) : null;
  }

  function stuckOverlays(widget) {
    return D.queryAll('.white_overlay', widget).filter((el) => el.getClientRects().length && el.querySelector('.pcm-loader'));
  }

  // The field that asked for the failed part: a select whose chosen option
  // carries the id at the end of the request's path (the form for
  // form_fields/28, the chosen Puzzel Service for nested_fields/1416719).
  function sourceField(url) {
    const match = String(url).split('?')[0].match(/\/(\d+)\/?$/);
    const form = findForm();
    if (!match || !form) return null;
    return D.queryAll('select', form).find((select) => select.value === match[1]) || null;
  }

  function clearNote() {
    const note = document.getElementById(FAIL_ID);
    if (note) note.remove();
  }

  function showNote(widget, status, field) {
    clearNote();
    const form = findForm();
    if (!form) return;
    const note = document.createElement('div');
    note.id = FAIL_ID;
    note.textContent = 'Part of the form could not be loaded' + (status ? ' (server error ' + status + ')' : '') + '.';
    const link = document.createElement('a');
    link.textContent = field ? 'Try again' : 'Reload the page';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      clearNote();
      if (!field || !field.isConnected) {
        window.location.reload();
        return;
      }
      const jq = window.jQuery;
      if (jq) jq(field).trigger('change');
      else field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    note.appendChild(link);
    form.insertBefore(note, form.firstChild);
  }

  function onFormLoad(event, xhr, settings) {
    if (!settings || !FORM_LOAD_URL.test(settings.url || '')) return;
    if (xhr.status >= 200 && xhr.status < 400) {
      clearNote();
      return;
    }
    if (xhr.statusText === 'abort') return;
    // A moment for PCM's own error handling, if any; only an overlay that
    // is still up afterwards is taken away.
    window.setTimeout(() => {
      const widget = formsWidget();
      if (!widget) return;
      const stuck = stuckOverlays(widget);
      if (!stuck.length) return;
      stuck.forEach((overlay) => { overlay.style.display = 'none'; });
      console.warn('[PCM Unsaved Form Warning] a Forms request failed (%s), the loading overlay was taken away.', xhr.status, settings.url);
      showNote(widget, xhr.status, sourceField(settings.url));
    }, FAIL_CHECK_MS);
  }

  if (window.jQuery) window.jQuery(document).on('ajaxComplete', onFormLoad);
})();
