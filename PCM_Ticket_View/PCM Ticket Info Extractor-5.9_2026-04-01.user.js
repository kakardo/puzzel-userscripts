// @file_name = PCM_Ticket_Info_Extractor_5.9_2026-04-01.txt
// @author = Kardo Rostam
// @version = 5.9_2026-04-01
// @created = 2026-03-20 (v1.0)

// ==UserScript==
// @name PCM Ticket Info Extractor
// @namespace http://tampermonkey.net/
// @version 5.9_2026-04-01
// @description Present CustomerID, Customer Name, and Company Name on single rows. Use Customer Intelligence only. Read the currently available CI organisation rows once on load without turning pagination pages. Retry after opening CI Organisations so multi-row tickets can load their rows. Expose machine-friendly hooks for other scripts.
// @author Kardo Rostam
// @match https://puzzel.cm.puzzel.com/tickets/*
// @require https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/DOM/PCM_DOM_Shared_Local_1.6_2026-04-16.user.js
// @downloadURL https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM/PCM%20Ticket%20Info%20Extractor-5.9_2026-04-01.user.js
// @updateURL https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM/PCM%20Ticket%20Info%20Extractor-5.9_2026-04-01.user.js
// @grant none
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

    2) Wrapper dataset
       const root = document.getElementById('pcm-ticket-info');
       console.log(root?.dataset.customerId);       // first / primary ID
       console.log(root?.dataset.customerIds);      // pipe-separated, split('|') from the currently available CI organisation rows
       console.log(root?.dataset.customerIdsText);  // display text with " / "
       console.log(root?.dataset.customerName);
       console.log(root?.dataset.companyName);

    3) Fixed value elements
       console.log(document.getElementById('pcm-ticket-customer-id')?.textContent?.trim() || '');
       console.log(document.getElementById('pcm-ticket-customer-name')?.textContent?.trim() || '');
       console.log(document.getElementById('pcm-ticket-company-name')?.textContent?.trim() || '');

    4) Ready event
       document.addEventListener('pcm-ticket-info-ready', function(event) {
         console.log(event.detail.customerId);
         console.log(event.detail.customerIds);
         console.log(event.detail.customerIdsText);
         console.log(event.detail.customerName);
         console.log(event.detail.companyName);
       });
  */

  const PANEL_ID = 'puzzel-top-info';
  const ROOT_ID = 'pcm-ticket-info';
  const STYLE_ID = 'pcm-ticket-info-style';
  const CUSTOMER_ID_ID = 'pcm-ticket-customer-id';
  const CUSTOMER_NAME_ID = 'pcm-ticket-customer-name';
  const COMPANY_NAME_ID = 'pcm-ticket-company-name';
  const BLOCKED_NAME_VALUES = new Set(['customer intelligence', 'customer tickets', 'customer attributes', 'organisations', 'remove']);
  const REQUIRE_ERROR = 'PCM Ticket Info Extractor: PCM_DOM shared helpers are missing. Load PCM_DOM_Shared_Local.user.js first.';

  const clean = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const text = (el) => clean(el && (el.textContent || el.innerText || ''));
  const visible = (el) => !!el && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  const unique = (values) => [...new Map((values || []).map((v) => [clean(v).toLowerCase(), clean(v)])).values()].filter(Boolean);
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


  function ciWidget() {
    for (const el of document.querySelectorAll('.jarviswidget header strong, header h2 strong, h2 strong')) {
      if (text(el).toLowerCase() === 'customer intelligence') return el.closest('.jarviswidget') || null;
    }
    return null;
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

  function extractIds() {
    const values = [];
    const inlineRx = /\b(?:customer\s*id|customerid|company\s*id|companyid)\b\s*[:\-]?\s*([A-Za-z0-9-]+)/ig;
    const keyOnlyRx = /^(?:customer\s*id|customerid|company\s*id|companyid)$/i;

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
      if (/\b(?:customer\s*id|customerid|company\s*id|companyid)\b/i.test(joined)) score += 4;
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

  async function waitForOrganisationRows(box, attempts, delay) {
    let rows = [];

    for (let i = 0; i < attempts; i += 1) {
      rows = extractOrganisationRows(box);
      if (rows.length) return rows;
      if (i < attempts - 1) {
        await wait(typeof delay === 'number' ? delay : 180);
      }
    }

    return rows;
  }

  async function ensureOrganisationRows(box) {
    const pane = organisationsPane(box);
    const toggle = findOrganisationsToggle(box);
    const wasOpen = visible(pane);
    let openedByScript = false;

    if (!wasOpen && toggle) {
      await clickControl(toggle, 500);
      openedByScript = true;
    }

    const rows = await waitForOrganisationRows(box, wasOpen ? 2 : 8, 180);

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
    const match = value.match(new RegExp('^' + escapedId + '\\s*(?:[-–—:]\\s*)?(.*)$', 'i'));
    return match && clean(match[1]) ? clean(match[1]) : value;
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
      companyNameRaw: ''
    };
    if (!box) return info;

    info.customerName = extractCustomerName(box) || extractCustomerEmail(box);

    const rowsResult = await ensureOrganisationRows(box);
    const initialRows = rowsResult.initialRows || [];
    const allRows = rowsResult.allRows || [];
    if (!allRows.length) return info;

    const allIds = unique(allRows.flatMap(rowCustomerIds));
    const chosenRow = initialRows.find((row) => rowCustomerIds(row).length > 0) || allRows.find((row) => rowCustomerIds(row).length > 0) || initialRows[0] || allRows[0];
    const primaryId = allIds[0] || '';

    info.customerIdRaw = primaryId;
    info.customerId = primaryId;
    info.customerIds = allIds;
    info.customerIdsText = allIds.join(' / ');
    info.companyNameRaw = clean(chosenRow[0] || '');
    info.companyName = normalizeCompanyName(info.companyNameRaw, primaryId);
    return info;
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
      found: !!(customerIdsText || info.customerName || info.companyName)
    };

    window.PCM_TICKET_INFO = payload;
    document.dispatchEvent(new CustomEvent('pcm-ticket-info-ready', { detail: payload }));
    return payload;
  }

  function appendRow(root, labelText, valueId, valueText) {
    const label = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = labelText;
    label.appendChild(strong);

    const value = document.createElement('div');
    value.id = valueId;
    value.dataset.source = 'ci';
    value.textContent = valueText;

    root.append(label, value);
  }

  function render(info) {
    const payload = publish(info);
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

    appendRow(root, 'CustomerID:', CUSTOMER_ID_ID, payload.customerIdsText || payload.customerId);
    appendRow(root, 'Customer Name:', CUSTOMER_NAME_ID, payload.customerName);
    appendRow(root, 'Company Name:', COMPANY_NAME_ID, payload.companyName);
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

  if (!window.PCM_DOM?.bootUntil || !window.PCM_DOM?.ensureStyleTag) {
    console.error(REQUIRE_ERROR);
    return;
  }

  window.PCM_DOM.ensureStyleTag(STYLE_ID, [
    '#' + PANEL_ID + '{margin:6px 0 10px;border:1px solid #cfd6e4;border-radius:6px;background:#fff;padding:10px 12px;font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}',
    '#' + ROOT_ID + '{display:grid;grid-template-columns:max-content 1fr;column-gap:12px;row-gap:6px;align-items:start;}',
    '#' + ROOT_ID + ' > div{min-width:0;}',
    '#' + CUSTOMER_ID_ID + ',#' + CUSTOMER_NAME_ID + ',#' + COMPANY_NAME_ID + '{word-break:break-word;}'
  ].join(''));

  const config = window.PCM_DOM.mergeConfig ? window.PCM_DOM.mergeConfig({ BOOT_MAX_TRIES: 15, BOOT_INTERVAL_MS: 400 }) : { BOOT_MAX_TRIES: 15, BOOT_INTERVAL_MS: 400 };
  window.PCM_DOM.bootUntil(function() {
    return !!document.querySelector('div.ticket-description.well') && !!ciWidget();
  }, function() {
    insert();
  }, config);
})();
