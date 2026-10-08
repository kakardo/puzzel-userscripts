// @file_name = PCM_Ticket_Info_Extractor.user.js
// @author = Kardo Rostam
// @version = 7.2_2026-10-08
// @created = 2026-03-20 (v1.0)

// ==UserScript==
// @name         PCM Ticket Info Extractor
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      7.2_2026-10-08
// @description  Present CustomerID, Customer Name, Company Name and Partner side by side on one compact line (wrapping on narrow screens). The ticket's own organisation in the Organisation Information widget (AccountNumber, Partner and name) is used first, Customer Intelligence organisations second. Read the currently available CI organisation rows once on load without turning pagination pages. Retry after opening CI Organisations so multi-row tickets can load their rows. Expose machine-friendly hooks for other scripts. Reads again when PCM Show Organisation Info signals that the Organisation Information module was added or changed after an Attributes save (event pcm-organisation-info-refreshed), and announces the new values the same way, so the scripts that use them update without a reload. The panel is put back automatically when PCM rebuilds the ticket header after an Attributes save.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Ticket_Info_Extractor.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Ticket_Info_Extractor.user.js
// ==/UserScript==

(function() {
  'use strict';

  /*
    Other scripts can read the extracted values in any of these ways:

    1) Global object
       const info = window.PCM_TICKET_INFO || {};
       console.log(info.customerId);        // first / primary ID
       console.log(info.customerIds);       // IDs as array from the currently available CI organisation rows
       console.log(info.customerIdsText);   // all IDs joined with " / "
       console.log(info.customerName);
       console.log(info.companyName);
       console.log(info.partner);           // Partner attribute of the chosen organisation row
       console.log(info.partners);          // Partner values from all available rows, as array

    2) Wrapper dataset
       const root = document.getElementById('pcm-ticket-info');
       console.log(root?.dataset.customerId);       // first / primary ID
       console.log(root?.dataset.customerIds);      // pipe-separated, split('|') from the currently available CI organisation rows
       console.log(root?.dataset.customerIdsText);  // display text with " / "
       console.log(root?.dataset.customerName);
       console.log(root?.dataset.companyName);
       console.log(root?.dataset.partner);

    3) Fixed value elements
       console.log(document.getElementById('pcm-ticket-customer-id')?.textContent?.trim() || '');
       console.log(document.getElementById('pcm-ticket-customer-name')?.textContent?.trim() || '');
       console.log(document.getElementById('pcm-ticket-company-name')?.textContent?.trim() || '');
       console.log(document.getElementById('pcm-ticket-partner')?.textContent?.trim() || '');

    4) Ready event
       document.addEventListener('pcm-ticket-info-ready', function(event) {
         console.log(event.detail.customerId);
         console.log(event.detail.customerIds);
         console.log(event.detail.customerIdsText);
         console.log(event.detail.customerName);
         console.log(event.detail.companyName);
         console.log(event.detail.partner);
       });
  */

  const PANEL_ID = 'puzzel-top-info';
  const ROOT_ID = 'pcm-ticket-info';
  const STYLE_ID = 'pcm-ticket-info-style';
  const CUSTOMER_ID_ID = 'pcm-ticket-customer-id';
  const CUSTOMER_NAME_ID = 'pcm-ticket-customer-name';
  const COMPANY_NAME_ID = 'pcm-ticket-company-name';
  const PARTNER_ID = 'pcm-ticket-partner';
  const BLOCKED_NAME_VALUES = new Set(['customer intelligence', 'customer tickets', 'customer attributes', 'organisations', 'remove']);
  const REQUIRE_ERROR = 'PCM Ticket Info Extractor: PCM_DOM shared helpers are missing. Load PCM_Shared_Library.user.js first.';

  // Shared helpers from PCM_DOM (single source of truth since lib 1.8).
  // Lazy arrows: the guard further down verifies PCM_DOM before any use.
  const clean = (value) => window.PCM_DOM.cleanText(value);
  const text = (el) => window.PCM_DOM.text(el);
  const visible = (el) => window.PCM_DOM.visible(el);
  const unique = (values) => window.PCM_DOM.uniqueTexts(values);
  const wait = (ms) => window.PCM_DOM.wait(ms);
  const escapeRegExp = (value) => window.PCM_DOM.escapeRegExp(value);


  function ciWidget() {
    for (const el of document.querySelectorAll('.jarviswidget header strong, header h2 strong, h2 strong')) {
      if (text(el).toLowerCase() === 'customer intelligence') return el.closest('.jarviswidget') || null;
    }
    return null;
  }

  /******************************************************************
   * Organisation Information widget (#wid-organisation)
   * The ticket's own organisation, with an Attribute / Value table
   * (AccountNumber, Partner, ...). When present it is the authoritative
   * source: Customer Intelligence lists the customer's organisations,
   * which may be several or none.
   ******************************************************************/
  const ORG_WIDGET_ID = 'wid-organisation';
  const ORG_ID_KEYS = ['accountnumber', 'account number', 'customerid', 'customer id', 'companyid', 'company id'];

  function orgWidget() {
    return document.getElementById(ORG_WIDGET_ID);
  }

  function orgAttributes(widget) {
    const attrs = {};
    widget.querySelectorAll('tr').forEach((tr) => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 2) return;
      const key = clean(cells[0].textContent).toLowerCase();
      if (key && !(key in attrs)) attrs[key] = clean(cells[1].textContent);
    });
    return attrs;
  }

  // The widget is loadable: its table can arrive after the page. Waits
  // for the first attribute row with an observer, bounded by a timeout,
  // so a ticket without an organisation finishes quickly.
  function waitForOrgAttributes(widget, timeoutMs) {
    const now = orgAttributes(widget);
    if (Object.keys(now).length) return Promise.resolve(now);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const attrs = orgAttributes(widget);
        if (!Object.keys(attrs).length) return;
        window.clearTimeout(timer);
        observer.disconnect();
        resolve(attrs);
      });
      const timer = window.setTimeout(() => {
        observer.disconnect();
        resolve(orgAttributes(widget));
      }, timeoutMs);
      observer.observe(widget, { childList: true, subtree: true });
    });
  }

  async function collectOrgInfo() {
    const widget = orgWidget();
    if (!widget) return null;
    const attrs = await waitForOrgAttributes(widget, 2000);
    const title = clean(text(widget.querySelector('#organisation-name')));
    const key = ORG_ID_KEYS.find((name) => attrs[name]);
    const id = key ? (attrs[key].match(/[A-Za-z0-9-]+/) || [''])[0] : ((title.match(/^([A-Za-z0-9-]{3,})\b/) || [])[1] || '');
    if (!id && !title) return null;
    return {
      id: id,
      nameRaw: title,
      name: normalizeCompanyName(title, id),
      partner: attrs.partner || ''
    };
  }

  function extractCustomerName(box) {
    const body = box?.querySelector('.jarviswidget-editbox, .widget-body, .panel-body') || box;
    if (!body) return '';

    const direct = body.querySelector('#cip-customer-name, h1[id^="cip-customer-name"], h1');
    const directValue = text(direct);
    if (visible(direct) && directValue && !BLOCKED_NAME_VALUES.has(directValue.toLowerCase())) {
      return directValue;
    }

    const candidates = [];
    for (const node of body.querySelectorAll('a, h1, h2, h3, h4, strong, span')) {
      const value = text(node);
      if (!visible(node) || !value || node.closest('#organisations')) continue;
      if (BLOCKED_NAME_VALUES.has(value.toLowerCase())) continue;
      if (value.length > 120) continue;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) continue;
      if (/customer\s+tickets|customer\s+attributes|organisations/i.test(value)) continue;
      if (/^customer intelligence\b/i.test(value)) continue;
      if (node.querySelector('a, h1, h2, h3, h4, strong, span')) continue;
      candidates.push(value);
    }

    return unique(candidates)[0] || '';
  }

  function extractCustomerEmail(box) {
    const body = box?.querySelector('.jarviswidget-editbox, .widget-body, .panel-body') || box;
    if (!body) return '';

    const emails = [];
    for (const node of body.querySelectorAll('a, span, div, p')) {
      const value = text(node);
      if (!visible(node) || !value || node.closest('#organisations')) continue;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) continue;
      emails.push(value);
    }

    return unique(emails)[0] || '';
  }

  // The ID label in Customer Intelligence: CustomerID on older
  // organisations, AccountNumber on newer ones. Both are read; the value
  // is still published as customerId so every consumer keeps working.
  function extractIds() {
    const values = [];
    const inlineRx = /\b(?:customer\s*id|customerid|company\s*id|companyid|account\s*number|accountnumber)\b\s*[:\-]?\s*([A-Za-z0-9-]+)/ig;
    const keyOnlyRx = /^(?:customer\s*id|customerid|company\s*id|companyid|account\s*number|accountnumber)$/i;

    for (const raw of arguments) {
      const chunk = String(raw || '');
      let hit;
      inlineRx.lastIndex = 0;
      while ((hit = inlineRx.exec(chunk)) !== null) values.push(hit[1]);

      const lines = chunk.split(/\n+/).map(clean).filter(Boolean);
      for (let i = 0; i < lines.length; i += 1) {
        if (!keyOnlyRx.test(lines[i])) continue;
        for (let j = i + 1; j < lines.length; j += 1) {
          if (keyOnlyRx.test(lines[j])) continue;
          const token = (lines[j].match(/[A-Za-z0-9-]+/) || [])[0] || '';
          if (token) values.push(token);
          break;
        }
      }
    }

    return unique(values);
  }

  function organisationsAccordion(box) {
    return box?.querySelector('#organisations-accordion') || null;
  }

  function organisationsPane(box) {
    const accordion = organisationsAccordion(box);
    if (!accordion) return box?.querySelector('#organisations') || null;

    const link = accordion.querySelector('.panel-title a[href="#organisations"], a[href="#organisations"]');
    const href = link?.getAttribute('href') || '';
    const paneFromHref = href && href.startsWith('#') ? box?.querySelector(href) : null;
    return paneFromHref || accordion.querySelector('.panel-collapse, .collapse') || box?.querySelector('#organisations') || null;
  }

  function extractOrganisationRows(box) {
    const root = organisationsPane(box);
    if (!root) return [];

    const rows = [];

    for (const tr of root.querySelectorAll('tr')) {
      const cells = Array.from(tr.querySelectorAll('td, th')).map(text).filter(Boolean);
      if (!cells.length) continue;
      if (cells.join(' | ').toLowerCase() === 'organisation | description | attributes') continue;

      const joined = (cells[1] || '') + ' ' + (cells[2] || '');
      let score = 0;
      if (cells[0]) score += 2;
      if (cells.length >= 3) score += 1;
      if (/\b(?:customer\s*id|customerid|company\s*id|companyid|account\s*number|accountnumber)\b/i.test(joined)) score += 4;
      if (/^organisation$/i.test(cells[0] || '')) score -= 10;
      if (/^description$/i.test(cells[1] || '')) score -= 10;
      if (/^attributes$/i.test(cells[2] || '')) score -= 10;
      if (score > 0) rows.push(cells);
    }

    return rows;
  }

  function findOrganisationsToggle(box) {
    const accordion = organisationsAccordion(box);
    if (!accordion) return null;
    return accordion.querySelector('.panel-title a[href="#organisations"], a[href="#organisations"]') || null;
  }






  async function clickControl(el, delay) {
    if (!el) return;
    el.click();
    await wait(typeof delay === 'number' ? delay : 500);
  }

  // Observer-based row waiting: resolves the moment rows render instead of
  // sleeping through fixed 500ms/180ms waits. Bounded by a timeout so a
  // ticket without organisation rows still finishes quickly.
  function waitForOrganisationRows(box, timeoutMs) {
    const existing = extractOrganisationRows(box);
    if (existing.length) return Promise.resolve(existing);

    const pane = organisationsPane(box);
    if (!pane) return Promise.resolve(existing);

    return new Promise((resolve) => {
      let timer = 0;

      const finish = (rows) => {
        window.clearTimeout(timer);
        observer.disconnect();
        resolve(rows);
      };

      const observer = new MutationObserver(() => {
        const rows = extractOrganisationRows(box);
        if (rows.length) finish(rows);
      });

      observer.observe(pane, { childList: true, subtree: true });

      timer = window.setTimeout(() => {
        observer.disconnect();
        resolve(extractOrganisationRows(box));
      }, typeof timeoutMs === 'number' ? timeoutMs : 1500);
    });
  }

  async function ensureOrganisationRows(box) {
    const pane = organisationsPane(box);
    const toggle = findOrganisationsToggle(box);
    const wasOpen = visible(pane);
    let openedByScript = false;

    if (!wasOpen && toggle) {
      // No fixed post-click wait: the observer below picks up the rows as
      // soon as the accordion renders them.
      toggle.click();
      openedByScript = true;
    }

    const rows = await waitForOrganisationRows(box, wasOpen ? 400 : 1500);

    if (openedByScript && toggle && visible(organisationsPane(box))) {
      await clickControl(toggle, 120);
    }

    return {
      initialRows: rows,
      allRows: rows
    };
  }

  function normalizeCompanyName(rawCompanyName, customerId) {
    const value = clean(rawCompanyName);
    const id = clean(customerId);
    if (!value || !id) return value;

    const escapedId = escapeRegExp(id);
    const match = value.match(new RegExp('^' + escapedId + '\\s*(?:[-\\u2013\\u2014:]\\s*)?(.*)$', 'i'));
    return match && clean(match[1]) ? clean(match[1]) : value;
  }

  // Partner attribute, e.g. "Country: Norway Partner: Example AccountNumber:
  // 12345" in the Attributes column. The cell text is one line, so the
  // value runs until the next "Key:" (one capitalised word followed by a
  // colon, or one of the known two-word keys) or the end of the cell, so
  // partner names of several words stay whole.
  function rowPartner(row) {
    if (!Array.isArray(row)) return '';
    const source = (row[2] || '') + ' ' + (row[1] || '');
    const match = source.match(/\bPartner\s*:\s*(.+?)(?=\s+(?:Account\s+Number|Customer\s+ID|Company\s+ID|[A-Z][A-Za-z]*)\s*:|$)/);
    return match ? clean(match[1]) : '';
  }

  function rowCustomerIds(row) {
    if (!Array.isArray(row) || row.length === 0) return [];

    const ids = extractIds(row[1] || '', row[2] || '');
    if (ids.length) return ids;

    const fallbackId = (clean(row[0] || '').match(/^([A-Za-z0-9-]{3,})\b/) || [])[1] || '';
    return fallbackId ? [fallbackId] : [];
  }

  async function collectInfo() {
    const box = ciWidget();
    const info = {
      source: 'ci',
      customerId: '',
      customerIds: [],
      customerIdsText: '',
      customerName: '',
      companyName: '',
      customerIdRaw: '',
      companyNameRaw: '',
      partner: '',
      partners: []
    };
    const org = await collectOrgInfo();
    if (box) {
      info.customerName = extractCustomerName(box) || extractCustomerEmail(box);
      await collectCiOrganisations(box, info);
    }
    if (org) mergeOrgInfo(info, org);
    return info;
  }

  // The ticket's organisation goes first: its ID becomes the primary ID
  // (CI IDs stay listed after it), and its name and partner win.
  function mergeOrgInfo(info, org) {
    if (org.id) {
      info.customerIds = unique([org.id].concat(info.customerIds || []));
      info.customerId = org.id;
      info.customerIdRaw = org.id;
      info.customerIdsText = info.customerIds.join(' / ');
    }
    if (org.name) {
      info.companyNameRaw = org.nameRaw;
      info.companyName = org.name;
    }
    if (org.partner) {
      info.partner = org.partner;
      info.partners = unique([org.partner].concat(info.partners || []));
    }
  }

  async function collectCiOrganisations(box, info) {
    const rowsResult = await ensureOrganisationRows(box);
    const initialRows = rowsResult.initialRows || [];
    const allRows = rowsResult.allRows || [];
    if (!allRows.length) return;

    const allIds = unique(allRows.flatMap(rowCustomerIds));
    const chosenRow = initialRows.find((row) => rowCustomerIds(row).length > 0) || allRows.find((row) => rowCustomerIds(row).length > 0) || initialRows[0] || allRows[0];
    const primaryId = allIds[0] || '';

    info.customerIdRaw = primaryId;
    info.customerId = primaryId;
    info.customerIds = allIds;
    info.customerIdsText = allIds.join(' / ');
    info.companyNameRaw = clean(chosenRow[0] || '');
    info.companyName = normalizeCompanyName(info.companyNameRaw, primaryId);
    info.partners = unique(allRows.map(rowPartner).filter(Boolean));
    info.partner = rowPartner(chosenRow) || info.partners[0] || '';
  }

  function publish(info) {
    const customerIds = unique(info.customerIds || []);
    const customerIdsText = clean(info.customerIdsText) || customerIds.join(' / ');

    const payload = {
      source: 'ci',
      customerId: clean(info.customerId),
      customerIds: customerIds,
      customerIdsText: customerIdsText,
      customerName: clean(info.customerName),
      companyName: clean(info.companyName),
      customerIdRaw: clean(info.customerIdRaw),
      companyNameRaw: clean(info.companyNameRaw),
      partner: clean(info.partner),
      partners: unique(info.partners || []),
      found: !!(customerIdsText || info.customerName || info.companyName)
    };

    window.PCM_TICKET_INFO = payload;
    document.dispatchEvent(new CustomEvent('pcm-ticket-info-ready', { detail: payload }));
    return payload;
  }

  // One "Label: value" pair. The pairs sit side by side and wrap, so the
  // panel is one line on a normal screen instead of one row per value.
  // The value keeps its fixed id, which other scripts read. An empty item
  // is hidden to save space, but stays in the DOM for those scripts.
  function appendItem(root, labelText, valueId, valueText) {
    const item = document.createElement('span');
    item.className = 'pcm-ti-item';
    if (!clean(valueText)) item.hidden = true;

    const label = document.createElement('strong');
    label.textContent = labelText;

    const value = document.createElement('span');
    value.id = valueId;
    value.dataset.source = 'ci';
    value.textContent = valueText;

    item.append(label, ' ', value);
    root.appendChild(item);
  }

  // The last published values, so the panel can be put back without
  // reading the ticket again (see keepPanel below).
  let lastPayload = null;

  function render(info) {
    const payload = publish(info);
    lastPayload = payload;
    return buildPanel(payload);
  }

  function buildPanel(payload) {
    const panel = document.createElement('div');
    const root = document.createElement('div');

    panel.id = PANEL_ID;
    root.id = ROOT_ID;
    root.dataset.source = payload.source;
    root.dataset.customerId = payload.customerId;
    root.dataset.customerIds = payload.customerIds.join('|');
    root.dataset.customerIdsText = payload.customerIdsText;
    root.dataset.customerName = payload.customerName;
    root.dataset.companyName = payload.companyName;
    root.dataset.customerIdRaw = payload.customerIdRaw;
    root.dataset.companyNameRaw = payload.companyNameRaw;
    root.dataset.partner = payload.partner;

    appendItem(root, 'CustomerID:', CUSTOMER_ID_ID, payload.customerIdsText || payload.customerId);
    appendItem(root, 'Customer Name:', CUSTOMER_NAME_ID, payload.customerName);
    appendItem(root, 'Company Name:', COMPANY_NAME_ID, payload.companyName);
    appendItem(root, 'Partner:', PARTNER_ID, payload.partners.join(' / ') || payload.partner);
    panel.appendChild(root);
    return panel;
  }

  async function insert() {
    const host = document.querySelector('div.ticket-description.well');
    if (!host) return false;
    const info = await collectInfo();
    document.getElementById(PANEL_ID)?.remove();
    host.appendChild(render(info));
    return true;
  }

  if (!window.PCM_DOM?.bootUntil || !window.PCM_DOM?.ensureStyleTag || !window.PCM_DOM?.cleanText) {
    console.error(REQUIRE_ERROR + ' (lib 1.8 or newer required)');
    return;
  }

  window.PCM_DOM.ensureStyleTag(STYLE_ID, [
    '#' + PANEL_ID + '{margin:4px 0 8px;border:1px solid #cfd6e4;border-radius:6px;background:#fff;padding:5px 10px;font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}',
    '#' + ROOT_ID + '{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:22px;row-gap:2px;}',
    '#' + ROOT_ID + ' .pcm-ti-item{min-width:0;}',
    '#' + ROOT_ID + ' .pcm-ti-item[hidden]{display:none;}',
    '#' + CUSTOMER_ID_ID + ',#' + CUSTOMER_NAME_ID + ',#' + COMPANY_NAME_ID + ',#' + PARTNER_ID + '{word-break:break-word;}'
  ].join(''));

  const config = window.PCM_DOM.mergeConfig ? window.PCM_DOM.mergeConfig({ BOOT_MAX_TRIES: 15, BOOT_INTERVAL_MS: 400 }) : { BOOT_MAX_TRIES: 15, BOOT_INTERVAL_MS: 400 };
  window.PCM_DOM.bootUntil(function() {
    return !!document.querySelector('div.ticket-description.well') && !!(ciWidget() || orgWidget());
  }, function() {
    insert().then(watchHeaderBox);
  }, config);

  // An Attributes save (PATCH /tickets/<number>) makes PCM rebuild the
  // ticket header box from the server's answer, which wipes the panel
  // inside it. The values have not changed, so the panel is put back from
  // the last published values, without reading the ticket again and
  // without a new ready event. Runs only when such a save finishes
  // (jQuery's ajaxComplete): nothing runs between saves. Checked right
  // away and once more shortly after, in case PCM draws the box a moment
  // later; it only writes when the panel is missing.
  function keepPanel() {
    if (!lastPayload || document.getElementById(PANEL_ID)) return;
    const host = document.querySelector('div.ticket-description.well');
    if (host) host.appendChild(buildPanel(lastPayload));
  }

  function watchHeaderBox() {
    const jq = window.jQuery;
    const ticket = (window.location.pathname.match(/^\/tickets\/(\d+)/) || [])[1];
    if (!jq || !ticket) return;
    const saveUrl = new RegExp('^(https://[^/]+)?/tickets/' + ticket + '(\\?|$)');
    jq(document).on('ajaxComplete', (event, xhr, settings) => {
      if (!settings || String(settings.type || settings.method).toUpperCase() !== 'PATCH') return;
      if (!saveUrl.test(settings.url || '')) return;
      window.setTimeout(keepPanel, 0);
      window.setTimeout(keepPanel, 500);
    });
  }

  // Wake-up from PCM Show Organisation Info: the organisation was saved
  // after the page loaded, so read again. publish() then sends the usual
  // ready event and the scripts that listen to it update themselves.
  // A read already running is followed by one more, never several.
  let rereading = null;
  let rereadAgain = false;
  document.addEventListener('pcm-organisation-info-refreshed', function() {
    if (rereading) {
      rereadAgain = true;
      return;
    }
    rereading = insert().catch(function(err) {
      console.warn('[PCM Ticket Info Extractor] reading again failed', err);
    }).then(function() {
      rereading = null;
      if (rereadAgain) {
        rereadAgain = false;
        document.dispatchEvent(new CustomEvent('pcm-organisation-info-refreshed'));
      }
    });
  }, false);
})();
