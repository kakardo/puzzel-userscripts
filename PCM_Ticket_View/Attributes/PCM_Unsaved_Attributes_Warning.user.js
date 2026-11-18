// @file_name = PCM_Unsaved_Attributes_Warning.user.js
// @author = Kardo Rostam
// @version = 1.7_2026-11-18
// @created = 2026-09-04 15:43

// ==UserScript==
// @name         PCM Unsaved Attributes Warning
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.7_2026-11-18
// @description  Snapshot-based unsaved change detection for the ticket Attributes widget, built on the shared library's createUnsavedWatcher engine (lib 2.0). Highlights changed fields and dropdowns (including the Chosen-based Team select, where the ring lands on the visible container) and shows a warning next to the Attributes Save button. Saving in Attributes clears only this widget's warning. Colour, mode, and text are settings at the top. Since 1.3, SELF_SAVING_BUTTONS treats a real click on a header control that persists an Attributes value by itself (Assign To Me) as a save: the baseline is rebased once the new value lands, so the field is not left marked unsaved. Since 1.5, a save pressed by PCM Assign Buttons or PCM Team Quick Select (announced with the pcm-attributes-save event) also counts as a save. Since 1.7 it also catches a failed Attributes load: when PCM's server answers the request for the new team's Assigned To or Categories list with an error, PCM can leave its loading overlay up for good; the overlay is then taken away and a short note with "Try again" asks PCM for that list once more (or offers a page reload when the field cannot be found). Event-driven via jQuery's ajaxComplete, only acting on a failed request.
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
   * SELF-SAVING BUTTONS
   * Controls that live OUTSIDE the Attributes widget but persist an
   * Attributes value on the server by themselves. "Assign To Me" in the
   * ticket header is one: it writes Assigned To server-side, so the new
   * value IS the saved state and nothing needs saving. Without this the
   * watcher only sees the value drift from its baseline and marks the
   * field unsaved.
   *   text  - matched against the button's visible text
   *   field - the field the button writes, watched to know when the
   *           server round trip has landed
   ******************************************************************/
  const SELF_SAVING_BUTTONS = [
    { text: /assign to me/i, field: '#user-select' }
  ];
  const SELF_SAVE_SETTLE_MS = 400;         // quiet period after the new value lands
  const SELF_SAVE_POLL_MS = 150;           // how often to check for it
  const SELF_SAVE_MAX_WAIT_MS = 8000;      // give up if the value never changes

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
  // must also land on Chosen and select2 containers (divs), not only
  // label wrappers. The ring uses ::before, NOT ::after: the Styler
  // already draws its ring with ::after on the same Status wrapper, and
  // an element only has one of each pseudo, so ::after would collide.
  D.ensureStyleTag(STYLE_ID, `
    input.${FIELD_CLASS},
    textarea.${FIELD_CLASS},
    select.${FIELD_CLASS} {
      ${fieldRules}
    }

    .${FIELD_CLASS}-wrap {
      position: relative;
    }

    .${FIELD_CLASS}-wrap::before {
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
    useWrapRing: HIGHLIGHT_MODE === 'border' || HIGHLIGHT_MODE === 'both',
    // lib 2.6: when PCM's form check took an unsaved value as the original
    // (it records them again after sending an email), Save is made
    // possible again by giving it the saved value back.
    repairFormCheck: true
  });

  // A trusted click on a self-saving button is a save, not an edit. The
  // write is a server round trip, so the baseline is rebased only once
  // the new value has actually landed in the field: rebasing on the
  // click itself would capture the OLD value and leave the field marked
  // unsaved for exactly as long as before.
  function watchSelfSavingButton(entry) {
    const field = D.query(entry.field);
    if (!field) return;

    const before = field.value;
    const startedAt = Date.now();

    (function pollForValue() {
      if (Date.now() - startedAt > SELF_SAVE_MAX_WAIT_MS) return;

      const current = D.query(entry.field);
      if (!current || current.value === before) {
        window.setTimeout(pollForValue, SELF_SAVE_POLL_MS);
        return;
      }

      window.setTimeout(function () {
        watcher.rebase();
      }, SELF_SAVE_SETTLE_MS);
    })();
  }

  function installSelfSavingButtons() {
    document.addEventListener('click', function (event) {
      // Only real clicks: a programmatic click must never rebase, or a
      // script could silently clear a genuine unsaved warning.
      if (!event.isTrusted) return;

      const target = event.target;
      if (!target || !target.closest) return;

      const btn = target.closest('button, input[type="submit"], a.btn, a');
      if (!btn) return;

      const label = D.cleanText(btn.textContent || btn.value || '');
      if (!label) return;

      const entry = SELF_SAVING_BUTTONS.find(function (candidate) {
        return candidate.text.test(label);
      });
      if (entry) watchSelfSavingButton(entry);
    }, true);
  }

  // SAVES PRESSED BY OTHER SCRIPTS
  // PCM Assign Buttons and PCM Team Quick Select press Save themselves.
  // Their click is not a real one, so the rule above ignores it; instead
  // they announce the save with this event just before pressing Save,
  // and the warning takes the current values as saved, the same as for
  // a real click on Save.
  const SAVE_EVENT = 'pcm-attributes-save';

  function installScriptSaves() {
    document.addEventListener(SAVE_EVENT, function () {
      watcher.rebase();
    });
  }

  watcher.start();
  installSelfSavingButtons();
  installScriptSaves();

  // FAILED LOADS
  // The same safety net as in PCM Unsaved Form Warning, for this widget:
  // changing the team makes PCM load that team's Assigned To and
  // Categories lists under a white loading overlay, which PCM only removes
  // when the answer is good. After a failed request the overlay is hidden
  // and a note offers to load it again by choosing the same team once
  // more, which makes PCM ask again.
  const FAIL_ID = 'pcm-attributes-load-failed';
  const LOAD_URL = /\/assignable_(users|categories)\b/;
  const FAIL_CHECK_MS = 400;

  D.ensureStyleTag('pcm-attributes-load-failed-style', `
    #${FAIL_ID} {
      margin: 6px 0 10px; padding: 7px 10px; border: 1px solid #e0b4b4; border-radius: 4px;
      background: #fff6f6; color: #9f3a38; font-size: 13px;
    }
    #${FAIL_ID} a { margin-left: 6px; font-weight: 600; cursor: pointer; }
  `);

  function attributesWidget() {
    const form = findForm();
    return form ? (form.closest('.jarviswidget') || form.parentElement) : null;
  }

  function stuckOverlays(widget) {
    return D.queryAll('.white_overlay', widget).filter((el) => el.getClientRects().length && el.querySelector('.pcm-loader'));
  }

  // The field the failed list belongs to: the select whose value is the
  // request's team_id (the Team dropdown).
  function sourceField(url) {
    let teamId = '';
    try { teamId = new URL(url, window.location.origin).searchParams.get('team_id') || ''; } catch (_) { teamId = ''; }
    const form = findForm();
    if (!teamId || !form) return null;
    return D.queryAll('select', form).find((select) => select.value === teamId) || null;
  }

  function clearNote() {
    const note = document.getElementById(FAIL_ID);
    if (note) note.remove();
  }

  function showNote(status, field) {
    clearNote();
    const form = findForm();
    if (!form) return;
    const note = document.createElement('div');
    note.id = FAIL_ID;
    note.textContent = 'Part of Attributes could not be loaded' + (status ? ' (server error ' + status + ')' : '') + '.';
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

  function onLoad(event, xhr, settings) {
    if (!settings || !LOAD_URL.test(settings.url || '')) return;
    if (xhr.status >= 200 && xhr.status < 400) {
      clearNote();
      return;
    }
    if (xhr.statusText === 'abort') return;
    window.setTimeout(() => {
      const widget = attributesWidget();
      if (!widget) return;
      const stuck = stuckOverlays(widget);
      if (!stuck.length) return;
      stuck.forEach((overlay) => { overlay.style.display = 'none'; });
      console.warn('[PCM Unsaved Attributes Warning] an Attributes request failed (%s), the loading overlay was taken away.', xhr.status, settings.url);
      showNote(xhr.status, sourceField(settings.url));
    }, FAIL_CHECK_MS);
  }

  if (window.jQuery) window.jQuery(document).on('ajaxComplete', onLoad);
})();
