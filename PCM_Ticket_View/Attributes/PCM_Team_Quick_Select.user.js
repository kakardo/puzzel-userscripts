// @file_name = PCM_Team_Quick_Select.user.js
// @author = Kardo Rostam
// @version = 2.2_2026-10-29
// @created = 2026-08-27 12:59

// ==UserScript==
// @name         PCM Team Quick Select
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.2_2026-10-29
// @description  Adds one-click buttons that select a configured team in the Chosen widget. Teams are a config array at the top, and BUTTON_PLACEMENT puts the row below the dropdown (default) or inline beside the Team: label. The button for the currently selected team is marked active. A bubble can also set a Status at the same press: Spam sets Status to Resolved. A bubble can also clear Assigned To once PCM has reloaded it for the new team: Agent does. A press made before PCM has finished preparing the form (the first moment after a ticket opens) is ignored and the bubble says Loading, since PCM would otherwise take the new team as the saved one and keep Save grey; after each change PCM is asked to re-check the form.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Team_Quick_Select.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Team_Quick_Select.user.js
// ==/UserScript==

(function () {
  'use strict';

  // USER SETTINGS
  // One bubble per entry. "team" is matched against the option text in
  // the Team dropdown (case-insensitive, exact after trimming), "label"
  // is the short text shown in the bubble, "color" its fill. An optional
  // "status" is set in the Status dropdown at the same press (matched the
  // same way), for teams that always go with one status. "unassign: true"
  // also clears Assigned To, for teams whose queue takes the ticket over.
  const TEAM_BUTTONS = [
    { label: 'Admin',   team: 'Admin Support',                       color: '#1e5bd8' }, // blue
    { label: 'Agent',   team: 'Agent Support',                       color: '#e65100', unassign: true }, // orange
    { label: 'Case',    team: 'Case Management Support',             color: '#7b2cbf' }, // purple
    { label: 'CHG',     team: 'Change Team',                         color: '#455a64' }, // slate grey
    { label: 'CI',      team: 'Conversational Intelligence Support', color: '#6d4c41' }, // brown
    { label: 'PSI',     team: 'Sales Intelligence Support',          color: '#b5179e' }, // magenta
    { label: 'Spam',    team: 'Spam/Virus Quarantine',               color: '#d32f2f', status: 'Resolved' }, // red
    { label: 'Triage',  team: 'Triage Support',                      color: '#2f7d2f' }, // green
    { label: 'Virtual', team: 'Virtual Agents Support',              color: '#00838f' }, // teal
    { label: 'WFM',     team: 'WFM Support',                         color: '#9e7c00' }  // dark gold
  ];

  // Where the bubbles sit relative to the Team dropdown.
  //   'below'  - on their own row under the dropdown (default)
  //   'inline' - to the right of the "Team:" label text, above the
  //              dropdown
  // If the preferred spot cannot be found the other one is used, so a
  // layout change in PCM can never leave the bubbles unplaced.
  const BUTTON_PLACEMENT = 'below';

  // INTERNAL SETTINGS
  const D = window.PCM_DOM;
  if (!D || !D.bootUntil || !D.ensureStyleTag || !D.cleanText || !D.installNavigationHooks ||
      !D.setNativeFieldValue || !D.formReady || !D.recheckForm) {
    console.error('PCM Team Quick Select: PCM_DOM shared helpers are missing (lib 2.3 or newer required).');
    return;
  }

  const SELECT_ID = 'team-select';
  const WRAP_ID = 'pcm-team-quick-select';
  const STYLE_ID = 'pcm-team-quick-select-style';
  const ACTIVE_CLASS = 'pcm-team-active';
  const BELOW_CLASS = 'pcm-team-below';

  D.ensureStyleTag(STYLE_ID, `
    #${WRAP_ID} {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-left: 8px;
      vertical-align: middle;
    }

    /* Own row under the dropdown: no inline left margin, small top gap. */
    #${WRAP_ID}.${BELOW_CLASS} {
      display: flex;
      margin-left: 0;
      margin-top: 5px;
    }

    #${WRAP_ID} .pcm-team-btn {
      appearance: none;
      border: 1px solid rgba(0,0,0,0.25);
      color: #ffffff;
      border-radius: 999px;
      padding: 1px 8px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.5;
      cursor: pointer;
      opacity: 0.55;
      white-space: nowrap;
    }

    #${WRAP_ID} .pcm-team-btn:hover {
      opacity: 0.85;
    }

    /* The current team: full strength and RECTANGULAR, while the rest
       stay faded pills, so the active one reads at a glance by shape. */
    #${WRAP_ID} .pcm-team-btn.${ACTIVE_CLASS} {
      opacity: 1;
      border-radius: 3px;
    }

    #${WRAP_ID} .pcm-team-btn:disabled {
      opacity: 0.25;
      cursor: default;
    }
  `);

  function getSelect() {
    return document.getElementById(SELECT_ID);
  }

  function findOption(select, teamName) {
    const wanted = D.cleanText(teamName).toLowerCase();
    return [...select.options].find(
      (option) => D.cleanText(option.textContent).toLowerCase() === wanted
    ) || null;
  }

  function selectedTeamText(select) {
    const option = select.options[select.selectedIndex];
    return option ? D.cleanText(option.textContent).toLowerCase() : '';
  }

  // PCM decides whether Save is allowed with its "Are You Sure" form
  // plugin, which records every field's original value (jQuery data
  // 'ays-orig') shortly after the ticket opens. A change made before that
  // is recorded as the original: Save stays grey while the unsaved warning
  // shows. So a press waits for the record, and afterwards the plugin is
  // asked to re-check the form.
  // Shared since lib 2.3: the same check for every script that writes
  // Attributes or Forms fields.
  function formReady(field) {
    return D.formReady(field);
  }

  function recheckForm(field) {
    D.recheckForm(field);
  }

  function flash(btn, text) {
    if (!btn || btn.dataset.pcmFlash) return;
    btn.dataset.pcmFlash = '1';
    const original = btn.textContent;
    btn.textContent = text;
    window.setTimeout(() => {
      btn.textContent = original;
      delete btn.dataset.pcmFlash;
    }, 1000);
  }

  function selectTeam(teamName) {
    const select = getSelect();
    if (!select) return;

    const option = findOption(select, teamName);
    if (!option) return;

    select.value = option.value;

    // Chosen redraws from the native select on this event; the change
    // events make the app itself react to the new value.
    const jq = window.jQuery || window.$;
    if (jq) {
      jq(select).trigger('chosen:updated').trigger('change');
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));

    updateActiveStates();
  }

  // The Status dropdown of the Attributes form: by id when PCM uses the
  // same naming as the Team and Assigned To dropdowns, otherwise the
  // select under the "Status:" label.
  function getStatusSelect() {
    const byId = document.getElementById('status-select');
    if (byId && byId.tagName === 'SELECT') return byId;
    const form = D.query('#ticket-attributes-form') || D.query('form.edit_ticket') || document;
    const label = D.queryAll('label', form).find((el) =>
      D.cleanText(el.textContent).toLowerCase().startsWith('status:')
    );
    const section = label && (label.closest('section, .form-group, [class*="col"]') || label.parentElement);
    return section ? section.querySelector('select') : null;
  }

  // One native change event: PCM and the Styler listen through
  // addEventListener (jQuery included), so the status colour and the
  // unsaved warning follow as with a pick by hand.
  // Clears Assigned To once PCM has refilled it for the new team. A team
  // change makes PCM reload the Assigned To list; clearing it before that
  // reload could be undone by it. So the list is watched (an observer on
  // its own parent, nothing else) and cleared right after it changes, or
  // after UNASSIGN_MAX_WAIT_MS if it never does. When the team did not
  // change there is no reload, and it is cleared at once.
  const UNASSIGN_MAX_WAIT_MS = 3000;

  function clearAssignee() {
    const select = document.getElementById('user-select');
    if (!select || select.value === '') return;
    if (![...select.options].some((option) => option.value === '')) return;
    D.setNativeFieldValue(select, '');
  }

  function unassignAfterRefill(teamChanged) {
    const select = document.getElementById('user-select');
    if (!select) return;
    if (!teamChanged) {
      clearAssignee();
      return;
    }
    const root = select.parentElement || select;
    let done = false;
    let timer = 0;
    const observer = new MutationObserver(() => {
      // Let PCM finish setting the refilled list's own selection first.
      window.setTimeout(finish, 50);
    });
    function finish() {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      clearAssignee();
    }
    observer.observe(root, { childList: true, subtree: true });
    timer = window.setTimeout(finish, UNASSIGN_MAX_WAIT_MS);
  }

  function selectStatus(statusName) {
    const select = getStatusSelect();
    if (!select) return;
    const option = findOption(select, statusName);
    if (!option || select.value === option.value) return;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function updateActiveStates() {
    const select = getSelect();
    const wrap = document.getElementById(WRAP_ID);
    if (!select || !wrap) return;

    const current = selectedTeamText(select);
    D.queryAll('.pcm-team-btn', wrap).forEach((btn) => {
      btn.classList.toggle(ACTIVE_CLASS, !btn.disabled && D.cleanText(btn.dataset.team).toLowerCase() === current);
    });
  }

  function getTeamLabel(select) {
    const section = select.closest('section, .form-group, [class*="col"]');
    if (!section) return null;

    // startsWith, not equality: once the bubbles live inside the label its
    // textContent grows, and re-runs must still recognise it.
    return D.queryAll('label.label, label', section).find((el) =>
      D.cleanText(el.textContent).toLowerCase().startsWith('team:')
    ) || null;
  }

  // Inline: to the RIGHT of the "Team:" label text. The label is made
  // inline-flex so the pills sit on the same line and wrap without
  // disturbing the column layout.
  function placeInline(select, wrap) {
    const teamLabel = getTeamLabel(select);
    if (!teamLabel) return false;

    teamLabel.style.display = 'inline-flex';
    teamLabel.style.alignItems = 'center';
    teamLabel.style.flexWrap = 'wrap';
    teamLabel.appendChild(wrap);
    wrap.classList.remove(BELOW_CLASS);
    return true;
  }

  // Below: its own row under the dropdown. The class drops the inline
  // left margin and adds the top gap.
  function placeBelow(select, wrap) {
    const host = select.closest('label.select') || select.parentElement;
    if (!host || !host.parentElement) return false;

    host.insertAdjacentElement('afterend', wrap);
    wrap.classList.add(BELOW_CLASS);
    return true;
  }

  function buildButtons() {
    const select = getSelect();
    if (!select) return false;

    const existing = document.getElementById(WRAP_ID);
    if (existing && existing.isConnected) return true;
    if (existing) existing.remove();

    const wrap = document.createElement('span');
    wrap.id = WRAP_ID;

    TEAM_BUTTONS.forEach((entry) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pcm-team-btn';
      btn.textContent = entry.label;
      btn.dataset.team = entry.team;
      btn.style.backgroundColor = entry.color;

      const option = findOption(select, entry.team);
      if (!option) {
        btn.disabled = true;
        btn.title = 'No option named "' + entry.team + '" in the Team list';
      } else {
        btn.title = 'Set Team to ' + entry.team + (entry.status ? ' and Status to ' + entry.status : '') + (entry.unassign ? ' and clear Assigned To' : '');
        btn.addEventListener('click', (event) => {
          // preventDefault also stops the surrounding label from toggling
          // the select widget.
          event.preventDefault();
          event.stopPropagation();
          if (!formReady(getSelect())) {
            flash(btn, 'Loading\u2026');
            return;
          }
          const teamBefore = selectedTeamText(getSelect());
          selectTeam(entry.team);
          if (entry.status) selectStatus(entry.status);
          if (entry.unassign) unassignAfterRefill(selectedTeamText(getSelect()) !== teamBefore);
          recheckForm(getSelect());
        });
      }

      wrap.appendChild(btn);
    });

    // BUTTON_PLACEMENT decides which spot is tried first. Whichever one
    // is chosen, the other stays available as a fallback so a layout
    // change in PCM cannot leave the bubbles unplaced.
    const placeFirst = BUTTON_PLACEMENT === 'inline' ? placeInline : placeBelow;
    const placeSecond = BUTTON_PLACEMENT === 'inline' ? placeBelow : placeInline;
    if (!placeFirst(select, wrap) && !placeSecond(select, wrap)) return false;

    // Keep the active mark in sync when the team is changed by hand.
    const jq = window.jQuery || window.$;
    if (jq) jq(select).on('change', updateActiveStates);
    select.addEventListener('change', updateActiveStates);

    updateActiveStates();
    return true;
  }

  D.installNavigationHooks(function () {
    D.bootUntil(buildButtons, function () {}, { BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 250 });
  });
  D.bootUntil(buildButtons, function () {}, { BOOT_MAX_TRIES: 60, BOOT_INTERVAL_MS: 250 });
})();
