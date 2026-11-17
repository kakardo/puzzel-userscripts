// @file_name = PCM_Team_Quick_Select.user.js
// @author = Kardo Rostam
// @version = 3.8_2026-11-17
// @created = 2026-08-27 12:59

// ==UserScript==
// @name         PCM Team Quick Select
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      3.8_2026-11-17
// @description  Adds one-click buttons that select a configured team in the Chosen widget. Teams are a config array at the top, and BUTTON_PLACEMENT puts the row below the dropdown (default) or inline beside the Team: label. The button for the currently selected team is marked active. A bubble can also set a Status at the same press, and the Puzzel Service in the Forms widget for teams that belong to one service (set once PCM has finished reloading the Forms widget for the new team, and again if a reload in the next 8 seconds puts the old one back; the Forms widget's fields are hidden meanwhile behind a short "Updating Puzzel Service" note at a fixed height, and fade back in once, so its reloads never show; left as an unsaved change, so PCM Unsaved Form Warning rings it red until you save. When the ticket's form has no Puzzel Service field yet, the service is remembered and set as soon as you pick a Form that has the field, as long as the team is still the same and the field is still Unassigned). A bubble can also clear Assigned To: at once, and again whenever PCM's reload for the new team puts a name back during the next 8 seconds (a pick by hand or Save ends that): Agent does. A team change is reported to PCM once. A press made before PCM has finished preparing the form (the first moment after a ticket opens) is ignored and the bubble says Loading, since PCM would otherwise take the new team as the saved one and keep Save grey; after each change PCM is asked to re-check the form. You still press Save. With SAVE_RIGHT_AWAY at the top turned on (off by default), PCM's Save in Attributes is pressed right away instead, once PCM has reloaded Assigned To for the new team (no requests running; at most 8 seconds); this saves every change in the Attributes form, and PCM Unsaved Attributes Warning is told so.
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
  // An optional "service" is set as Puzzel Service in the Forms widget
  // (matched case-insensitively, spaces ignored, so "Botstudio" also finds
  // "Bot Studio").
  const TEAM_BUTTONS = [
    { label: 'Admin',   team: 'Admin Support',                       color: '#1e5bd8', service: 'Contact Centre' }, // blue
    { label: 'Agent',   team: 'Agent Support',                       color: '#e65100', service: 'Contact Centre', unassign: true }, // orange
    { label: 'Case',    team: 'Case Management Support',             color: '#7b2cbf', service: 'Case Management' }, // purple
    { label: 'CHG',     team: 'Change Team',                         color: '#455a64', service: 'Contact Centre' }, // slate grey
    { label: 'CI',      team: 'Conversational Intelligence Support', color: '#6d4c41', service: 'Conversational Intelligence' }, // brown
    { label: 'PSI',     team: 'Sales Intelligence Support',          color: '#b5179e', service: 'Sales Intelligence' }, // magenta
    { label: 'Spam',    team: 'Spam/Virus Quarantine',               color: '#d32f2f',
      triage: [{ status: 'Resolved' }, { status: 'Resolved', priority: 'Junk' }] }, // red
    { label: 'Triage',  team: 'Triage Support',                      color: '#2f7d2f', service: 'Contact Centre' }, // green
    { label: 'Virtual', team: 'Virtual Agents Support',              color: '#00838f', service: 'Botstudio' }, // teal
    { label: 'WFM',     team: 'WFM Support',                         color: '#9e7c00', service: 'WFM' }  // dark gold
  ];

  // Where the bubbles sit relative to the Team dropdown.
  //   'below'  - on their own row under the dropdown (default)
  //   'inline' - to the right of the "Team:" label text, above the
  //              dropdown
  // If the preferred spot cannot be found the other one is used, so a
  // layout change in PCM can never leave the bubbles unplaced.
  const BUTTON_PLACEMENT = 'below';

  // true: a press also presses PCM's Save in Attributes (which saves every
  // change in that form) once PCM has reloaded Assigned To for the new
  // team. false (default): you press Save yourself.
  const SAVE_RIGHT_AWAY = false;

  const TRIAGING_ADDITION = false;

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

    /* Forms widget while the Puzzel Service is being put in place: the
       fields are hidden behind a short note (the height is held by the
       script), so PCM's reloads never show; they fade back in once. */
    .pcm-team-service-busy .widget-body { position: relative; pointer-events: none !important; }
    .pcm-team-service-busy .widget-body > * { opacity: 0 !important; }
    .pcm-team-service-busy .widget-body::after {
      content: 'Updating Puzzel Service\\2026';
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      color: #8a8a8a; font-size: 13px; font-style: italic;
    }
    .pcm-team-service-fade .widget-body > * { transition: opacity 0.25s ease; }
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

    // Chosen redraws from the native select on its own event. Then ONE
    // native change: PCM's jQuery handlers hear it too. A jQuery change on
    // top made PCM run its team-change work twice (two Assigned To
    // requests per press, the second undoing an unassign).
    const jq = window.jQuery || window.$;
    if (jq) jq(select).trigger('chosen:updated');
    select.dispatchEvent(new Event('change', { bubbles: true }));

    updateActiveStates();
  }

  // The Status dropdown of the Attributes form: by id when PCM uses the
  // same naming as the Team and Assigned To dropdowns, otherwise the
  // select under the "Status:" label.
  // The same lookup serves the Priority dropdown.
  function getFieldSelect(id, labelText) {
    const byId = document.getElementById(id);
    if (byId && byId.tagName === 'SELECT') return byId;
    const form = D.query('#ticket-attributes-form') || D.query('form.edit_ticket') || document;
    const label = D.queryAll('label', form).find((el) =>
      D.cleanText(el.textContent).toLowerCase().startsWith(labelText)
    );
    const section = label && (label.closest('section, .form-group, [class*="col"]') || label.parentElement);
    return section ? section.querySelector('select') : null;
  }

  function getStatusSelect() {
    return getFieldSelect('status-select', 'status:');
  }

  function getPrioritySelect() {
    return getFieldSelect('priority-select', 'priority:');
  }

  // One native change event: PCM and the Styler listen through
  // addEventListener (jQuery included), so the status colour and the
  // unsaved warning follow as with a pick by hand.
  // Clears Assigned To at once, then guards it: a team change makes PCM
  // fetch the new team's Assigned To list, sometimes more than once, and
  // every answer rebuilds the list with the current person selected again.
  // For UNASSIGN_GUARD_MS after the press, each such answer is followed by
  // another clear. A pick by hand in Assigned To ends the guard at once,
  // so your own choice is never overridden. Event-driven (an observer on
  // the field and jQuery's ajaxComplete); nothing is left listening.
  const UNASSIGN_GUARD_MS = 8000;

  function clearAssignee() {
    const select = document.getElementById('user-select');
    if (!select || select.value === '') return false;
    if (![...select.options].some((option) => option.value === '')) return false;
    D.setNativeFieldValue(select, '');
    return true;
  }

  // No flash: the clear runs before the browser paints the rebuilt list.
  // A MutationObserver on the Assigned To field reacts in the same task
  // as PCM's rebuild (its callback runs before the next paint), and
  // ajaxComplete clears synchronously as a backstop. A clear only changes
  // the value, not the options, so it never wakes the observer itself.
  function unassignAndGuard() {
    clearAssignee();
    const jq = window.jQuery;
    const select = document.getElementById('user-select');
    const root = select && (select.parentElement || select);
    let stopped = false;
    const observer = root ? new MutationObserver(() => { if (!stopped) clearAssignee(); }) : null;
    const onAjax = (event, xhr, settings) => {
      if (stopped || !settings || !/assignable_users/.test(settings.url || '')) return;
      clearAssignee();
    };
    const onHandPick = (event) => {
      if (event.isTrusted && event.target && event.target.id === 'user-select') stop();
    };
    // Saving ends the guard: the cleared value is what gets saved, and a
    // clear after the save would show the freshly saved Assigned To as
    // unsaved again once PCM redraws the form.
    const form = select && select.form;
    const onSave = (event) => {
      const target = event.target;
      if (target === form || (target && target.closest && form && target.closest('button[type="submit"], input[type="submit"]') &&
          (form.contains(target) || target.getAttribute('form') === form.id))) stop();
    };
    function stop() {
      if (stopped) return;
      stopped = true;
      if (observer) observer.disconnect();
      if (jq) jq(document).off('ajaxComplete', onAjax);
      document.removeEventListener('change', onHandPick, true);
      document.removeEventListener('click', onSave, true);
      document.removeEventListener('submit', onSave, true);
    }
    if (observer) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected'] });
    if (jq) jq(document).on('ajaxComplete', onAjax);
    document.addEventListener('change', onHandPick, true);
    document.addEventListener('click', onSave, true);
    document.addEventListener('submit', onSave, true);
    window.setTimeout(stop, UNASSIGN_GUARD_MS);
  }

  // SAVING
  // A team change makes PCM fetch the new team's Assigned To list, so
  // PCM's Save is pressed once PCM has had no requests running for
  // SAVE_QUIET_MS, at the latest after SAVE_MAX_WAIT_MS. For a bubble that
  // clears Assigned To, it is cleared once more just before saving.
  // Event-driven via jQuery's ajaxSend and ajaxStop; nothing is left
  // listening afterwards. Save is only pressed when PCM allows it (not
  // greyed out), so an unchanged form is never sent.
  const SAVE_QUIET_MS = 300;
  const SAVE_MAX_WAIT_MS = 8000;

  function findSaveButton(form) {
    let button = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!button && form.id) button = document.querySelector('[type="submit"][form="' + form.id + '"]');
    return button;
  }

  function saveWhenQuiet(beforeSave) {
    const jq = window.jQuery;
    let done = false;
    let quietTimer = 0;
    let capTimer = 0;
    const onSend = () => window.clearTimeout(quietTimer);
    const onStop = () => arm();
    function finish() {
      if (done) return;
      done = true;
      window.clearTimeout(quietTimer);
      window.clearTimeout(capTimer);
      if (jq) jq(document).off('ajaxSend', onSend).off('ajaxStop', onStop);
      if (beforeSave) beforeSave();
      // Looked up again: PCM may have rebuilt the form.
      const select = getSelect();
      const form = select && select.form;
      if (!form) return;
      recheckForm(select);
      const button = findSaveButton(form);
      if (!button) {
        console.warn('PCM Team Quick Select: could not find the Attributes Save button.');
        return;
      }
      if (button.disabled) return;
      // Tells PCM Unsaved Attributes Warning that this is a save, so it
      // does not keep showing the saved values as unsaved.
      document.dispatchEvent(new CustomEvent('pcm-attributes-save'));
      button.click();
    }
    function arm() {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => {
        if (!jq || !jq.active) finish();
      }, SAVE_QUIET_MS);
    }
    if (jq) jq(document).on('ajaxSend', onSend).on('ajaxStop', onStop);
    capTimer = window.setTimeout(finish, SAVE_MAX_WAIT_MS);
    arm();
  }

  function setSelect(select, name) {
    if (!select) return;
    const option = findOption(select, name);
    if (!option || select.value === option.value) return;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectStatus(statusName) {
    setSelect(getStatusSelect(), statusName);
  }

  function selectedText(select) {
    return select ? selectedTeamText(select) : '';
  }

  // PUZZEL SERVICE (Forms widget)
  // The Puzzel Service select is the one in the Forms widget whose block is
  // labelled "Puzzel Service". Options are compared without spaces and
  // case; an exact match wins, otherwise a single option that starts with
  // the wanted name (or the other way round), never a guess between two.
  // Written like a pick by hand (native setter and change event), so PCM
  // loads the matching Product Area list and PCM Unsaved Form Warning
  // marks the field until Save.
  function squash(value) {
    return D.cleanText(String(value || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function getServiceSelect() {
    const root = D.query('#ticket-forms-form') || D.query('form.ticket-forms-form') ||
      (D.query('#form-fields-wrapper') ? D.query('#form-fields-wrapper').closest('form') : null);
    if (!root) return null;
    return D.queryAll('select', root).find((select) => {
      const block = select.closest('section, .form-group, [class*="col"]') || select.parentElement;
      const label = block && block.querySelector('label');
      return !!label && squash(label.textContent).startsWith('puzzelservice');
    }) || null;
  }

  function findServiceOption(select, name) {
    const wanted = squash(name);
    const options = [...select.options].filter((option) => option.value !== '');
    const exact = options.filter((option) => squash(option.textContent) === wanted);
    if (exact.length === 1) return exact[0];
    const close = options.filter((option) => {
      const text = squash(option.textContent);
      return text && (text.startsWith(wanted) || wanted.startsWith(text));
    });
    return close.length === 1 ? close[0] : null;
  }

  // A team change makes PCM reload the Forms widget, which put back the
  // old service right after it was set. So the service is set once PCM's
  // requests have gone quiet, after the reloaded form has been recorded
  // (formReady, or the change would count as the saved value), and set
  // again whenever another reload within SERVICE_GUARD_MS puts the old one
  // back. A pick by hand in Puzzel Service, or Save, ends that at once.
  // Event-driven (jQuery ajaxSend/ajaxStop); nothing is left listening.
  const SERVICE_GUARD_MS = 8000;
  const SERVICE_QUIET_MS = 120;
  const SERVICE_READY_POLL_MS = 60;
  const SERVICE_FADE_MS = 300;
  // After a team change PCM loads, in a chain: Assigned To, Categories,
  // then the team's forms and the form itself. The service waits for that
  // last part (or this long, when a team change brings no form reload),
  // instead of being set in the short gap after Categories and thrown
  // away by the form reload.
  const SERVICE_FORM_WAIT_MS = 2000;
  const FORM_RELOAD_URL = /\/(assignable_forms|form_fields)\b/;
  let stopServiceGuard = null;

  // A service whose field was not there at the press (no Form picked yet)
  // waits here, for this ticket and team. When PCM then loads a form (you
  // pick one) and the field shows Unassigned while the team is unchanged,
  // the service is set the same way as at a press. Your own choice of a
  // service is never overwritten: only an Unassigned field is filled.
  let pendingService = null;

  function serviceUnassigned(select) {
    const option = select.options[select.selectedIndex];
    return !select.value || !option || squash(option.textContent) === 'unassigned';
  }

  function onFormLoaded(event, xhr, settings) {
    if (!pendingService || !settings || !FORM_RELOAD_URL.test(settings.url || '')) return;
    if (pendingService.ticket !== location.pathname ||
        selectedTeamText(getSelect()) !== D.cleanText(pendingService.team).toLowerCase()) {
      pendingService = null;
      return;
    }
    const select = getServiceSelect();
    if (!select || !serviceUnassigned(select)) return;
    const service = pendingService.service;
    pendingService = null;
    serviceGuard(service);
  }

  if (window.jQuery) window.jQuery(document).on('ajaxComplete', onFormLoaded);

  function serviceGuard(name) {
    if (stopServiceGuard) stopServiceGuard();
    const jq = window.jQuery;
    const until = Date.now() + SERVICE_GUARD_MS;
    let stopped = false;
    let timer = 0;
    let reported = false;

    // Dimmed from the press until the service is in place and PCM's
    // requests are quiet again (or the guard ends).
    const first = getServiceSelect();
    const widget = first && (first.closest('.jarviswidget') || (first.form && first.form.parentElement));
    const BUSY = 'pcm-team-service-busy';
    const FADE = 'pcm-team-service-fade';
    const body = widget && widget.querySelector('.widget-body');
    function hold() {
      if (!widget) return;
      // The height stays as it is, so the page below does not jump while
      // PCM empties and refills the form.
      if (body) body.style.minHeight = body.offsetHeight + 'px';
      widget.classList.remove(FADE);
      widget.classList.add(BUSY);
    }
    function release() {
      if (!widget || !widget.classList.contains(BUSY)) return;
      widget.classList.add(FADE);
      widget.classList.remove(BUSY);
      if (body) body.style.minHeight = '';
      window.setTimeout(() => widget.classList.remove(FADE), SERVICE_FADE_MS);
    }

    function attempt() {
      if (stopped) return;
      const select = getServiceSelect();
      if (!select) return release();
      const option = findServiceOption(select, name);
      if (!option) {
        if (!reported) console.info('[PCM Team Quick Select] no single Puzzel Service option matches %o, left alone.', name);
        reported = true;
        return release();
      }
      if (select.value === option.value) {
        if (!jq || !jq.active) release();
        return;
      }
      if (!D.formReady(select)) {
        if (Date.now() < until) timer = window.setTimeout(attempt, SERVICE_READY_POLL_MS);
        return;
      }
      pendingService = null;
      D.setNativeFieldValue(select, option.value);
      // Released after the Product Area reload this starts (or at once
      // when there is none).
      soon();
    }
    const formWaitEnds = Date.now() + SERVICE_FORM_WAIT_MS;
    let formReloaded = false;
    function soon() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (jq && jq.active) return;
        if (!formReloaded && Date.now() < formWaitEnds) {
          timer = window.setTimeout(soon, formWaitEnds - Date.now());
          return;
        }
        attempt();
      }, SERVICE_QUIET_MS);
    }
    const onSend = () => window.clearTimeout(timer);
    const onComplete = (event, xhr, settings) => {
      if (settings && FORM_RELOAD_URL.test(settings.url || '')) formReloaded = true;
    };
    const onHandPick = (event) => {
      const select = getServiceSelect();
      if (event.isTrusted && select && event.target === select) stop();
    };
    const onSave = (event) => {
      const select = getServiceSelect();
      const form = select && select.form;
      const target = event.target;
      if (!form || !target) return;
      if (target === form || (target.closest && target.closest('button[type="submit"], input[type="submit"]') && form.contains(target))) stop();
    };
    // A reload that does not go through jQuery still shows as the Forms
    // widget being redrawn.
    const observer = widget ? new MutationObserver(soon) : null;
    function stop() {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timer);
      if (observer) observer.disconnect();
      release();
      if (jq) jq(document).off('ajaxSend', onSend).off('ajaxComplete', onComplete).off('ajaxStop', soon);
      document.removeEventListener('change', onHandPick, true);
      document.removeEventListener('click', onSave, true);
      document.removeEventListener('submit', onSave, true);
      if (stopServiceGuard === stop) stopServiceGuard = null;
    }
    stopServiceGuard = stop;
    if (widget && first && findServiceOption(first, name) && first.value !== findServiceOption(first, name).value) hold();
    if (observer) observer.observe(widget, { childList: true, subtree: true });
    if (jq) jq(document).on('ajaxSend', onSend).on('ajaxComplete', onComplete).on('ajaxStop', soon);
    document.addEventListener('change', onHandPick, true);
    document.addEventListener('click', onSave, true);
    document.addEventListener('submit', onSave, true);
    window.setTimeout(stop, SERVICE_GUARD_MS);
    soon();
  }

  // TRIAGING ADDITION
  // Kept in sessionStorage (this tab), so it survives a reload.
  const PRIORITY_KEY = 'pcm-team-quick-select-priority:';

  function rememberedPriority(ticket) {
    try { return window.sessionStorage.getItem(PRIORITY_KEY + ticket) || ''; } catch (_) { return ''; }
  }

  function rememberPriority(ticket, value) {
    try {
      if (value) window.sessionStorage.setItem(PRIORITY_KEY + ticket, value);
      else window.sessionStorage.removeItem(PRIORITY_KEY + ticket);
    } catch (_) { /* storage blocked */ }
  }

  function matchesStep(step) {
    if (step.status && selectedText(getStatusSelect()) !== D.cleanText(step.status).toLowerCase()) return false;
    if (step.priority && selectedText(getPrioritySelect()) !== D.cleanText(step.priority).toLowerCase()) return false;
    return true;
  }

  // The step the ticket is in: of the steps that match, the one that sets
  // the most fields.
  function nextStep(entry, wasInTeam) {
    if (!wasInTeam) return entry.triage[0];
    let at = -1;
    let best = -1;
    entry.triage.forEach((step, i) => {
      const fields = (step.status ? 1 : 0) + (step.priority ? 1 : 0);
      if (matchesStep(step) && fields >= best) { at = i; best = fields; }
    });
    return entry.triage[at === -1 ? 0 : (at + 1) % entry.triage.length];
  }

  function applyStep(step) {
    const priority = getPrioritySelect();
    const ticket = location.pathname;
    if (step.priority) {
      if (priority && selectedText(priority) !== D.cleanText(step.priority).toLowerCase()) {
        const option = priority.options[priority.selectedIndex];
        rememberPriority(ticket, option ? option.textContent : '');
      }
      setSelect(priority, step.priority);
    } else if (rememberedPriority(ticket)) {
      setSelect(priority, rememberedPriority(ticket));
      rememberPriority(ticket, '');
    }
    if (step.status) selectStatus(step.status);
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
        const cycles = TRIAGING_ADDITION && Array.isArray(entry.triage) && entry.triage.length;
        btn.title = 'Set Team to ' + entry.team + (entry.status ? ' and Status to ' + entry.status : '') +
          (entry.service ? ' and Puzzel Service to ' + entry.service : '') +
          (entry.unassign ? ' and clear Assigned To' : '') + (SAVE_RIGHT_AWAY ? ', then save' : '');
        btn.addEventListener('click', (event) => {
          // preventDefault also stops the surrounding label from toggling
          // the select widget.
          event.preventDefault();
          event.stopPropagation();
          if (!formReady(getSelect())) {
            flash(btn, 'Loading\u2026');
            return;
          }
          const wasInTeam = selectedTeamText(getSelect()) === D.cleanText(entry.team).toLowerCase();
          selectTeam(entry.team);
          if (entry.status) selectStatus(entry.status);
          if (cycles) applyStep(nextStep(entry, wasInTeam));
          pendingService = entry.service ? { ticket: location.pathname, team: entry.team, service: entry.service } : null;
          if (entry.service) serviceGuard(entry.service);
          if (entry.unassign) unassignAndGuard();
          recheckForm(getSelect());
          if (SAVE_RIGHT_AWAY) saveWhenQuiet(entry.unassign ? clearAssignee : null);
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
