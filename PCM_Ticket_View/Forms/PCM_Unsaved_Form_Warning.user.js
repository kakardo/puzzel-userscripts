// @file_name = PCM_Unsaved_Form_Warning.user.js
// @author = Kardo Rostam
// @version = 1.9_2026-11-06
// @created = 2026-08-27 09:37

// ==UserScript==
// @name         PCM Unsaved Form Warning
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.9_2026-11-06
// @description  Snapshot-based unsaved change detection for the ticket Forms widget. Highlights every field whose value differs from the loaded state (including values typed by the Form Buttons autofill) and shows a warning text next to the Save button. When every unsaved field is a correction PCM Form Buttons made to a saved value (its orange ring), the warning reads "Corrected values, please save" in orange instead (needs lib 2.4; with an older lib the normal warning shows). Highlight colour/mode and warning texts are settings at the top. Since 1.5 the watcher engine lives in the shared library (createUnsavedWatcher), so this script only supplies the Forms zone configuration and styling; Save clicks clear this zone only.
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
})();
