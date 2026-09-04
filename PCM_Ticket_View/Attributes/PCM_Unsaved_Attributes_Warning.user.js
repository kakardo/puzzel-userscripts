// @file_name = PCM_Unsaved_Attributes_Warning.user.js
// @author = Kardo Rostam
// @version = 1.1_2026-09-04
// @created = 2026-09-04 15:43

// ==UserScript==
// @name         PCM Unsaved Attributes Warning
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-09-04
// @description  Snapshot-based unsaved change detection for the ticket Attributes widget, built on the shared library's createUnsavedWatcher engine (lib 2.0). Highlights changed fields and dropdowns (including the Chosen-based Team select, where the ring lands on the visible container) and shows a warning next to the Attributes Save button. Saving in Attributes clears only this widget's warning. Colour, mode, and text are settings at the top.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Unsaved_Attributes_Warning.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Unsaved_Attributes_Warning.user.js
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
    console.error('PCM Unsaved Attributes Warning: PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
    return;
  }

  const WARNING_ID = 'pcm-unsaved-attr-warning';
  const FIELD_CLASS = 'pcm-unsaved-attr-field';
  const STYLE_ID = 'pcm-unsaved-attr-warning-style';

  const fieldCss = {
    border: `border-color: ${HIGHLIGHT_COLOR} !important; box-shadow: inset 0 0 0 ${HIGHLIGHT_BORDER_WIDTH_PX}px ${HIGHLIGHT_COLOR} !important;`,
    text: `color: ${HIGHLIGHT_COLOR} !important;`
  };
  const fieldRules = HIGHLIGHT_MODE === 'both'
    ? fieldCss.border + fieldCss.text
    : (fieldCss[HIGHLIGHT_MODE] || fieldCss.border);

  // The -wrap selectors are tagless on purpose: in this widget the ring
  // must also land on Chosen containers (divs), not only label wrappers.
  D.ensureStyleTag(STYLE_ID, `
    input.${FIELD_CLASS},
    textarea.${FIELD_CLASS},
    select.${FIELD_CLASS} {
      ${fieldRules}
    }

    .${FIELD_CLASS}-wrap {
      position: relative;
    }

    .${FIELD_CLASS}-wrap::after {
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

    .${FIELD_CLASS}-wrap .${FIELD_CLASS} {
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
    return D.query('#ticket-attributes-form') || D.query('form.edit_ticket');
  }

  // Ring target, probed per widget type: Team and Tags are Chosen,
  // Organisation and the categories are select2, both render a visible
  // container as the select's next sibling, which is where the ring
  // belongs. Plain selects fall back to their SmartAdmin wrapper.
  function getWrapper(field) {
    const sibling = field.nextElementSibling;
    if (sibling && (sibling.classList.contains('chosen-container') ||
        sibling.classList.contains('select2') ||
        sibling.classList.contains('select2-container'))) {
      return sibling;
    }
    const label = field.closest('label.select, label.input, label.textarea');
    if (label) return label;
    if (field.parentElement && field.parentElement.classList.contains('select')) {
      return field.parentElement;
    }
    return null;
  }

  const watcher = D.createUnsavedWatcher({
    findRoot: findForm,
    warningId: WARNING_ID,
    fieldClass: FIELD_CLASS,
    warningText: WARNING_TEXT,
    warnOnLeave: WARN_ON_LEAVE,
    getWrapper: getWrapper,
    useWrapRing: HIGHLIGHT_MODE === 'border' || HIGHLIGHT_MODE === 'both'
  });

  watcher.start();
})();
