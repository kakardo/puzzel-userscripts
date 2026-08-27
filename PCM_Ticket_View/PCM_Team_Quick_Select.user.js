// @file_name = PCM_Team_Quick_Select.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-08-27
// @created = 2026-08-27 12:59

// ==UserScript==
// @name         PCM Team Quick Select
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-08-27
// @description  Adds one-click buttons under the Team dropdown that select a configured team in the Chosen widget. Teams are a config array at the top. The button for the currently selected team is marked active.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/DOM/PCM_DOM_Shared_Local.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Team_Quick_Select.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Team_Quick_Select.user.js
// ==/UserScript==

(function () {
  'use strict';

  /******************************************************************
   * USER SETTINGS
   * One bubble per entry. "team" is matched against the option text in
   * the Team dropdown (case-insensitive, exact after trimming), "label"
   * is the short text shown in the bubble, "color" its fill.
   ******************************************************************/
  const TEAM_BUTTONS = [
    { label: 'Admin',   team: 'Admin Support',           color: '#3f6fd6' },
    { label: 'Agent',   team: 'Agent Support',           color: '#b8860b' },
    { label: 'Case',    team: 'Case Management Support', color: '#7b2cbf' },
    { label: 'Spam',    team: 'Spam/Virus Quarantine',   color: '#d32f2f' },
    { label: 'Triage',  team: 'Triage Support',          color: '#2f7d2f' },
    { label: 'Virtual', team: 'Virtual Agents Support',  color: '#0b7285' }
  ];

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const D = window.PCM_DOM;
  if (!D || !D.bootUntil || !D.ensureStyleTag || !D.cleanText) {
    console.error('PCM Team Quick Select: PCM_DOM shared helpers are missing (lib 1.8 or newer required).');
    return;
  }

  const SELECT_ID = 'team-select';
  const WRAP_ID = 'pcm-team-quick-select';
  const STYLE_ID = 'pcm-team-quick-select-style';
  const ACTIVE_CLASS = 'pcm-team-active';

  D.ensureStyleTag(STYLE_ID, `
    #${WRAP_ID} {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-left: 8px;
      vertical-align: middle;
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
        btn.title = 'Set Team to ' + entry.team;
        btn.addEventListener('click', (event) => {
          // preventDefault also stops the surrounding label from toggling
          // the select widget.
          event.preventDefault();
          event.stopPropagation();
          selectTeam(entry.team);
        });
      }

      wrap.appendChild(btn);
    });

    // Preferred spot: inline to the RIGHT of the "Team:" label text, made
    // inline-flex so the pills sit on the same line and wrap without
    // disturbing the column layout. Fallback: below the dropdown.
    const teamLabel = getTeamLabel(select);
    if (teamLabel) {
      teamLabel.style.display = 'inline-flex';
      teamLabel.style.alignItems = 'center';
      teamLabel.style.flexWrap = 'wrap';
      teamLabel.appendChild(wrap);
    } else {
      const host = select.closest('label.select') || select.parentElement;
      if (!host || !host.parentElement) return false;
      host.insertAdjacentElement('afterend', wrap);
    }

    // Keep the active mark in sync when the team is changed by hand.
    const jq = window.jQuery || window.$;
    if (jq) jq(select).on('change', updateActiveStates);
    select.addEventListener('change', updateActiveStates);

    updateActiveStates();
    return true;
  }

  function installRouteHooks() {
    const onRouteChange = () => {
      D.bootUntil(buildButtons, function () {}, { BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 250 });
    };

    const wrapHistoryMethod = (methodName) => {
      const original = history[methodName];
      if (typeof original !== 'function') return;
      history[methodName] = function () {
        const result = original.apply(this, arguments);
        window.dispatchEvent(new Event('pcm-team-quick-route-change'));
        return result;
      };
    };

    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');
    window.addEventListener('popstate', onRouteChange, true);
    window.addEventListener('hashchange', onRouteChange, true);
    window.addEventListener('pcm-team-quick-route-change', onRouteChange, true);
  }

  installRouteHooks();
  D.bootUntil(buildButtons, function () {}, { BOOT_MAX_TRIES: 60, BOOT_INTERVAL_MS: 250 });
})();
