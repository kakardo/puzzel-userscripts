// @file_name = PCM_Unsaved_Form_Warning.user.js
// @author = Kardo Rostam
// @version = 1.5_2026-09-03
// @created = 2026-08-27 09:37

// ==UserScript==
// @name         PCM Unsaved Form Warning
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.5_2026-09-03
// @description  Snapshot-based unsaved change detection for the ticket Forms widget. Highlights every field whose value differs from the loaded state (including values typed by the Form Buttons autofill) and shows a warning text next to the Save button. Highlight colour/mode and warning text are settings at the top. Since 1.5 the watcher engine lives in the shared library (createUnsavedWatcher), so this script only supplies the Forms zone configuration and styling; Save clicks clear this zone only.
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
    useWrapRing: HIGHLIGHT_MODE === 'border' || HIGHLIGHT_MODE === 'both'
  });

  watcher.start();
})();
