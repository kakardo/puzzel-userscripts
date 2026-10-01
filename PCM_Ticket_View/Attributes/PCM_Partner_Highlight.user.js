// @file_name = PCM_Partner_Highlight.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-10-01
// @created = 2026-10-01 15:08
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). The partner name is read from the page at runtime, never written here.

// ==UserScript==
// @name         PCM Partner Highlight
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-10-01
// @description  Shows the ticket's partner in large coloured letters next to the "Attributes" heading in the Attributes widget, so a partner ticket is impossible to miss. The partner is read from the PCM Ticket Info Extractor outputs (Partner attribute of the Customer Intelligence organisation); nothing is shown when the ticket has no partner. Event-driven: listens for the extractor's ready event and re-places the badge when PCM re-renders the widget, through a scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Partner_Highlight.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Partner_Highlight.user.js
// ==/UserScript==

(function () {
  'use strict';

  /******************************************************************
   * USER SETTINGS
   ******************************************************************/
  const LABEL_PREFIX = 'Partner: ';
  // Same purple as the PCM Name Field Placeholder link, so script-added
  // "pay attention" markers share one colour.
  const BADGE_BACKGROUND = '#7A1CAC';
  const BADGE_TEXT = '#ffffff';
  const BADGE_FONT_SIZE_PX = 22;

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const D = window.PCM_DOM;
  if (!D || !D.bootUntil || !D.ensureStyleTag || !D.cleanText || !D.createVisibilityGate ||
      !D.installNavigationHooks || !D.queryAll) {
    console.error('PCM Partner Highlight: PCM_DOM shared helpers are missing (lib 2.0 or newer required).');
    return;
  }

  const BADGE_ID = 'pcm-partner-highlight';
  const STYLE_ID = 'pcm-partner-highlight-style';
  const HEADING_TEXT = 'attributes';
  const SCAN_DELAY_MS = 150;

  D.ensureStyleTag(STYLE_ID, `
    #${BADGE_ID} {
      display: inline-block;
      margin-left: 18px;
      padding: 3px 14px;
      border-radius: 6px;
      background: ${BADGE_BACKGROUND};
      color: ${BADGE_TEXT};
      font-size: ${BADGE_FONT_SIZE_PX}px;
      font-weight: 700;
      line-height: 1.3;
      letter-spacing: .3px;
      vertical-align: middle;
      white-space: nowrap;
    }
  `);

  /******************************************************************
   * Finding the heading
   * The widget title bar also says "Attributes"; the target is the
   * section heading inside the widget body, so anything inside the
   * jarviswidget <header> is skipped.
   ******************************************************************/
  function attributesRoot() {
    const form = D.query('#ticket-attributes-form') || D.query('form.edit_ticket');
    return (form && (form.closest('.jarviswidget') || form)) ||
      (D.findWidgetByTitle ? D.findWidgetByTitle('Attributes') : null);
  }

  function ownText(el) {
    let value = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === 3) value += node.nodeValue;
    });
    return D.cleanText(value).toLowerCase();
  }

  function findHeading() {
    const root = attributesRoot();
    if (!root) return null;
    return D.queryAll('legend, h1, h2, h3, h4, h5, h6, header, strong, span, div, p', root).find((el) =>
      !el.closest('.jarviswidget > header') &&
      el.id !== BADGE_ID &&
      ownText(el) === HEADING_TEXT
    ) || null;
  }

  /******************************************************************
   * Partner value (soft dependency on the Ticket Info Extractor)
   ******************************************************************/
  function partnerText() {
    const info = window.PCM_TICKET_INFO || {};
    if (Array.isArray(info.partners) && info.partners.length) return info.partners.map(D.cleanText).filter(Boolean).join(' / ');
    if (info.partner) return D.cleanText(info.partner);
    const root = document.getElementById('pcm-ticket-info');
    return root ? D.cleanText(root.dataset.partner || '') : '';
  }

  // Idempotent: writes only when the badge is missing, misplaced or
  // shows another value, so the observer below never feeds itself.
  function ensure() {
    const partner = partnerText();
    let badge = document.getElementById(BADGE_ID);

    if (!partner) {
      if (badge) badge.remove();
      return;
    }

    const heading = findHeading();
    if (!heading) return;

    if (!badge) {
      badge = document.createElement('span');
      badge.id = BADGE_ID;
      badge.title = 'This ticket belongs to a partner organisation';
    }
    const label = LABEL_PREFIX + partner;
    if (badge.textContent !== label) badge.textContent = label;
    if (badge.parentElement !== heading) heading.appendChild(badge);
  }

  const gate = D.createVisibilityGate(ensure, SCAN_DELAY_MS);

  function start() {
    ensure();
    document.addEventListener('pcm-ticket-info-ready', () => gate.schedule(0), false);

    // PCM re-renders the Attributes widget after saves; watch it and put
    // the badge back. Rooted on the main content area, only additions
    // count, and the gated ensure is a few reads when nothing changed.
    const root = document.getElementById('content') || document.body;
    new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i += 1) {
        if (mutations[i].addedNodes.length) {
          gate.schedule();
          return;
        }
      }
    }).observe(root, { childList: true, subtree: true });
  }

  D.installNavigationHooks(() => gate.schedule());
  D.bootUntil(function () {
    return !!document.body;
  }, start);
})();
