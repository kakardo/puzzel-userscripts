// @file_name = PCM_No_Access_Redirection_Button.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-01
// @created = 2026-10-01 14:01

// ==UserScript==
// @name         PCM No Access Redirection Button
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-01
// @description  Adds a large "Go to ticket list" button to PCM's "Ticket reassigned" message, shown after a ticket is sent to a team you cannot access. PCM's Confirm button is hidden and replaced by a "Press here to stay in this ticket" link under the message. The button drops PCM's leave-page prompt and opens the tickets list directly, so there is no Confirm, no "Leave site?" question and no second click. Event-driven: one MutationObserver on the direct children of body, where PCM adds its message boxes, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_No_Access_Redirection_Button.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_No_Access_Redirection_Button.user.js
// ==/UserScript==

(function () {
  'use strict';

  /******************************************************************
   * USER SETTINGS
   ******************************************************************/
  const BUTTON_LABEL = 'Go to ticket list';
  // PCM's own Confirm button is hidden and replaced by this link under
  // the message, so the big button is the only thing to hit.
  const STAY_LINK_TEXT = 'Press here to stay in this ticket';
  const TARGET_URL = 'https://puzzel.cm.puzzel.com/tickets';

  // Message box titles that get the button (case-insensitive).
  const TITLE_PATTERNS = [/ticket reassigned/i];

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const D = window.PCM_DOM;
  if (!D || !D.bootUntil || !D.ensureStyleTag || !D.cleanText) {
    console.error('PCM No Access Redirection Button: PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
    return;
  }

  const BOX_SELECTOR = '.divMessageBox';
  const TITLE_SELECTOR = '.MsgTitle';
  const BUTTONS_SELECTOR = '.MessageBoxButtonSection';
  const BUTTON_CLASS = 'pcm-reassigned-exit';
  const STAY_CLASS = 'pcm-reassigned-stay';
  const HIDDEN_CLASS = 'pcm-reassigned-hidden';
  const BOX_CLASS = 'pcm-reassigned-box';
  const STYLE_ID = 'pcm-reassigned-exit-style';

  D.ensureStyleTag(STYLE_ID, `
    /* Only this message box: its content is centred on the screen, and
       the dark band grows to fit the button and the link instead of
       keeping PCM's fixed height (which cut the link off below it). */
    .${BOX_CLASS} .MessageBoxMiddle {
      text-align: center;
    }
    .${BOX_CLASS} .MessageBoxContainer {
      height: auto !important;
      min-height: 0 !important;
      padding-bottom: 28px !important;
    }

    /* Sits in the message column under the text, not in PCM's
       right-floated button row, so it lines up with the message. */
    .${BUTTON_CLASS} {
      display: block;
      float: none !important;
      width: 100%;
      max-width: 420px;
      margin: 20px auto 0 auto !important;
      padding: 16px 32px !important;
      font-size: 19px !important;
      font-weight: 700 !important;
    }
    .${HIDDEN_CLASS} {
      display: none !important;
    }
    .${STAY_CLASS} {
      display: block;
      margin-top: 12px;
      font-size: 13px;
    }
    .${STAY_CLASS} a {
      color: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  `);

  // PCM registers its "Leave site?" prompt as a jQuery beforeunload
  // handler on window. Removing it (and any plain onbeforeunload) right
  // before navigating is what makes the jump prompt-free. The page can
  // carry more than one jQuery copy, so all of them are cleared.
  function dropLeavePrompt() {
    [window.jQuery, window.$].forEach((jq) => {
      if (jq && typeof jq === 'function' && jq.fn && jq.fn.off) jq(window).off('beforeunload');
    });
    window.onbeforeunload = null;
  }

  function goToList(event) {
    event.preventDefault();
    event.stopPropagation();
    dropLeavePrompt();
    window.location.assign(TARGET_URL);
  }

  function isReassignedBox(box) {
    const title = box.querySelector(TITLE_SELECTOR);
    const text = D.cleanText(title ? title.textContent : '');
    return TITLE_PATTERNS.some((pattern) => pattern.test(text));
  }

  function addButton(box) {
    if (!isReassignedBox(box)) return;
    const section = box.querySelector(BUTTONS_SELECTOR);
    if (!section || box.querySelector('.' + BUTTON_CLASS)) return;

    // Same classes as PCM's own Confirm button, so it matches the box.
    const confirm = section.querySelector('button:not(.' + BUTTON_CLASS + ')');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = (confirm ? confirm.className : 'btn btn-default btn-sm') + ' ' + BUTTON_CLASS;
    btn.removeAttribute('id');
    btn.textContent = BUTTON_LABEL;
    btn.title = 'Open the tickets list without the leave-page question';
    btn.addEventListener('click', goToList);

    // Order under the message: text, big button, stay link.
    box.classList.add(BOX_CLASS);
    insertUnderMessage(box, section, btn);

    // Confirm stays in the DOM, only hidden: the link below clicks it, so
    // PCM still runs its own close handling when you choose to stay.
    if (confirm) {
      confirm.classList.add(HIDDEN_CLASS);
      addStayLink(btn, confirm);
    }
    btn.focus();
  }

  // After the last text block next to the title, falling back to just
  // above PCM's button row.
  function insertUnderMessage(box, section, el) {
    const title = box.querySelector(TITLE_SELECTOR);
    const middle = title ? title.parentElement : section.parentElement;
    const blocks = middle ? Array.from(middle.children).filter((child) => child !== section && !child.querySelector('button')) : [];
    const anchor = blocks.length ? blocks[blocks.length - 1] : null;
    if (anchor) anchor.insertAdjacentElement('afterend', el);
    else section.insertAdjacentElement('beforebegin', el);
  }

  function addStayLink(btn, confirm) {
    const line = document.createElement('span');
    line.className = STAY_CLASS;
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = STAY_LINK_TEXT;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      confirm.click();
    });
    line.appendChild(link);
    btn.insertAdjacentElement('afterend', line);
  }

  function scan() {
    document.querySelectorAll(BOX_SELECTOR).forEach(addButton);
  }

  function start() {
    scan();
    // Message boxes are added as direct children of body, so watching
    // only that level is enough and costs nothing while you work.
    new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i += 1) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j += 1) {
          const node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.matches(BOX_SELECTOR)) addButton(node);
          else if (node.querySelector) node.querySelectorAll(BOX_SELECTOR).forEach(addButton);
        }
      }
    }).observe(document.body, { childList: true });
  }

  D.bootUntil(function () {
    return !!document.body;
  }, start);
})();
