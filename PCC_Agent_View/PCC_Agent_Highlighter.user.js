// @file_name = PCC_Agent_Highlighter.user.js
// @author = Kardo Rostam
// @version = 6.3_2026-10-02
// @created = 2026-02-10 (v2.9)

// ==UserScript==
// @name         Puzzel Agent Highlighter
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      6.3_2026-10-02
// @description  Highlights Puzzel Agent rows and badges names. Battery friendly: pauses all processing while the tab is hidden and resyncs once on return.
// @author       Kardo Rostam
// @match        https://app.puzzel.com/agent*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Agent_View/PCC_Agent_Highlighter.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Agent_View/PCC_Agent_Highlighter.user.js
// ==/UserScript==

// ============================================================================
// CONFIGURABLE PERFORMANCE SETTINGS
// ============================================================================
const DEBOUNCE_DELAY_MS = 250;
const FALLBACK_TICK_MS = 5000;               // Lightweight tick
const FULL_SYNC_MIN_INTERVAL_MS = 30000;     // Force a full resync at most once per 30s
const REBIND_CHECK_THROTTLE_MS = 400;        // Prevent rebind storms on heavy DOM churn

(function () {
  'use strict';

  console.log('[Puzzel Highlighter] loading…');

  // ============================================================================
  // HIGHLIGHT TREE (Your rules here)
  // ============================================================================
  const HIGHLIGHT_TREE = [
    {
      color: "#8fbc8f",
      textColor: "#5B249E",
      status: ["Ready"]
    },
    {
      color: "#008000",
      textColor: "#fffafa",
      status: ["Ready"],
      profiles: ["Triaging Nordic", "Triaging Denmark", "Triaging Backup"]
    },
    {
      color: "#eee8aa",
      textColor: "#6227AB",
      status: ["Ready"],
      profiles: ["Transfer only"]
    },
    {
    color: "#f7c6d9",
    textColor: "#6b1238",
    status: ["Lunch"]
    }
  ];

  // ============================================================================
  // NAME BADGES (Your setup)
  // ============================================================================
  const NAME_BADGE_TREE = [
    { names: ["Kardo Rostam"],		emoji: 128023 }, // (U+1F417) BOAR
    { names: ["Hannes Hartman"],	emoji: 129442 }, // (U+1F40B) WHALE
    { names: ["Willy Vesanto"],		emoji: 128039 }, // (U+1F427) PENGUIN
    { names: ["Simon Batten"],		emoji: 129408 }, // (U+1F980) CRAB
    { names: ["Kim Federspiel"],	emoji: 129409 }, // (U+1F981) LION FACE
    { names: ["Nikolay Kazandzhiev"],	emoji: 129680 }, // (U+1FA90) RINGED PLANET
  ];

  // Column numbers in the Agents grid are read from the header texts, not
  // fixed: on narrow windows the grid adds an expand column first, which
  // shifts every aria-colindex by one (Status 2 -> 3, Profile 4 -> 5).
  // These are the wide-layout values, used only if a header is missing.
  const DEFAULT_COLS = { status: '2', profile: '4' };
  let colsCache = { grid: null, key: '', cols: DEFAULT_COLS };

  function gridCols() {
    const grid = AGENTS_GRID;
    if (!grid) return DEFAULT_COLS;
    const headers = [...grid.querySelectorAll('[role="columnheader"][aria-colindex]')];
    const key = headers.map(h => h.getAttribute('aria-colindex') + ':' + (h.textContent ?? '').trim().toLowerCase()).join('|');
    if (colsCache.grid === grid && colsCache.key === key) return colsCache.cols;
    const cols = { status: DEFAULT_COLS.status, profile: DEFAULT_COLS.profile };
    headers.forEach(h => {
      const t = (h.textContent ?? '').trim().toLowerCase();
      if (t === 'status') cols.status = h.getAttribute('aria-colindex');
      if (t === 'profile') cols.profile = h.getAttribute('aria-colindex');
    });
    colsCache = { grid: grid, key: key, cols: cols };
    return cols;
  }

  // ============================================================================
  // STYLE
  // ============================================================================
  const style = document.createElement('style');
  style.textContent = `
    .m365-highlight-row {
      border-radius: 4px;
      transition: background-color .15s ease, color .15s ease;
    }
    .m365-agent-name-inline {
      display: inline;
      white-space: nowrap;
    }
    .m365-name-badge {
      display: inline;
      margin-left: 4px;
      opacity: 0.95;
      white-space: nowrap;
      line-height: inherit;
      vertical-align: baseline;
    }
  `;
  document.head.appendChild(style);

  // ============================================================================
  // HELPERS
  // ============================================================================
  function safeLower(x) {
    return (x ?? '').toString().toLowerCase();
  }

  function normName(s) {
    return (s ?? '')
      .toString()
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function getNodeStatuses(node) {
    if (Array.isArray(node.status)) return node.status;
    if (Array.isArray(node.statuses)) return node.statuses;
    if (typeof node.status === 'string') return [node.status];
    return [];
  }

  // textContent is cheaper than innerText (doesn't trigger layout).
  function textOfCell(row, colIndex) {
    const el = row.querySelector(`[role="gridcell"][aria-colindex="${colIndex}"]`);
    return el ? ((el.textContent ?? '').trim()) : '';
  }

  // ============================================================================
  // MATCHING LOGIC (HIGHLIGHTS) - LAST MATCH WINS
  // ============================================================================
  function matchRule(statusText, profileText) {
    const s = safeLower(statusText).replace(/\s+/g, ' ').trim();
    const p = safeLower(profileText);

    let matched = null;
    for (const node of HIGHLIGHT_TREE) {
      const statuses = getNodeStatuses(node).map(safeLower);
      // Anchored prefix match: the cell text must equal the status or start
      // with it followed by a space, so "Ready 00:12" matches "Ready" while
      // "Not ready" cannot match it. Plain exact matching (v4.2) broke
      // highlighting because the real status cell carries extra text.
      if (!statuses.some(st => s === st || s.startsWith(st + ' '))) continue;

      if (!node.profiles || node.profiles.length === 0) {
        matched = node;
        continue;
      }

      const profiles = node.profiles.map(safeLower);
      if (profiles.some(pr => p.includes(pr))) matched = node;
    }

    return matched;
  }

  // ============================================================================
  // HIGHLIGHT APPLICATION (NO-FLICKER)
  // ============================================================================
  function ruleKey(rule) {
    if (!rule) return '';
    return `${rule.color}\n${rule.textColor}`;
  }

  function resetRowStyle(row) {
    if ((row.dataset.m365HighlightKey ?? '') === '') {
      return; // Already reset
    }
    row.classList.remove('m365-highlight-row');
    row.style.backgroundColor = '';
    row.style.color = '';
    row.dataset.m365HighlightKey = '';
  }

  function applyHighlightIfChanged(row, rule) {
    const nextKey = ruleKey(rule);
    const prevKey = row.dataset.m365HighlightKey ?? '';
    if (nextKey === prevKey) return;

    if (!rule) {
      resetRowStyle(row);
      return;
    }

    row.classList.add('m365-highlight-row');
    row.style.backgroundColor = rule.color;
    row.style.color = rule.textColor;
    row.dataset.m365HighlightKey = nextKey;
  }

  // ============================================================================
  // NAME BADGE LOGIC (NO-FLICKER)
  // ============================================================================
  function emojiFromSpec(spec) {
    if (typeof spec === 'number' && Number.isFinite(spec)) {
      try { return String.fromCodePoint(spec); } catch { return ''; }
    }
    const s = (spec ?? '').toString().trim();
    if (!s) return '';

    const m = s.match(/^&#(\d+);?$/);
    if (m) {
      const cp = Number(m[1]);
      if (!Number.isFinite(cp)) return '';
      try { return String.fromCodePoint(cp); } catch { return ''; }
    }

    return s;
  }

  function matchNameBadge(agentName) {
    const hay = normName(agentName);
    if (!hay) return null;

    let matched = null; // last match wins
    for (const rule of NAME_BADGE_TREE) {
      if (!rule?.names || !Array.isArray(rule.names) || rule.names.length === 0) continue;
      for (const rn of rule.names) {
        const needle = normName(rn);
        if (!needle) continue;
        if (hay.includes(needle)) matched = rule;
      }
    }

    return matched;
  }

  // The name is the row's only rowheader, whatever its column number.
  function getNameHeader(row) {
    return row.querySelector('[role="rowheader"]');
  }

  function textWithoutBadges(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll?.('.m365-name-badge').forEach(b => b.remove());
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function findNameWrapper(row) {
    const nameHeader = getNameHeader(row);
    if (!nameHeader) return null;

    // Prefer the old wrapper if it exists, but Puzzel has changed/removed it on some layouts.
    const oldWrapper = nameHeader.querySelector('.aa-grid-cell-wrapper');
    if (oldWrapper) return oldWrapper;

    // Reuse our own inline wrapper if a previous processing pass already created it.
    const ownWrapper = nameHeader.querySelector('.m365-agent-name-inline');
    if (ownWrapper) return ownWrapper;

    // Prefer the smallest descendant element that contains visible name text.
    // This prevents the badge from becoming a separate flex/grid item under the name.
    const candidates = [...nameHeader.querySelectorAll('*')]
      .filter(el => !el.classList?.contains('m365-name-badge'))
      .map(el => ({ el, txt: textWithoutBadges(el), kids: el.querySelectorAll('*').length }))
      .filter(x => x.txt && x.txt.length <= 100);

    // Descendant counts are cached above; recomputing them inside the
    // comparator made the sort O(n^2) DOM queries.
    candidates.sort((a, b) => (a.kids - b.kids) || (a.txt.length - b.txt.length));

    if (candidates[0]?.el) return candidates[0].el;

    // Last-resort fallback: Puzzel may render the name as a direct text node in the rowheader.
    // Wrap the existing name content so the emoji remains inline instead of dropping to its own row.
    const inline = document.createElement('span');
    inline.className = 'm365-agent-name-inline';

    const nodesToMove = [...nameHeader.childNodes]
      .filter(n => !(n.nodeType === Node.ELEMENT_NODE && n.classList?.contains('m365-name-badge')));

    if (nodesToMove.length === 0) return nameHeader;

    for (const node of nodesToMove) inline.appendChild(node);
    nameHeader.appendChild(inline);
    return inline;
  }

  function extractNameText(target) {
    return textWithoutBadges(target);
  }

  function setOrUpdateBadge(target, desiredEmoji) {
    const existing = target.querySelector('.m365-name-badge');

    if (!desiredEmoji) {
      if (existing) existing.remove();
      return;
    }

    const next = ` ${desiredEmoji}`;

    if (existing) {
      const current = (existing.textContent ?? '').toString();
      if (current !== next) existing.textContent = next;
      return;
    }

    const badge = document.createElement('span');
    badge.className = 'm365-name-badge';
    badge.textContent = next;
    badge.setAttribute('aria-hidden', 'true');
    target.appendChild(badge);
  }

  function applyNameBadgeToRow(row) {
    if (!NAME_BADGE_TREE || NAME_BADGE_TREE.length === 0) return;

    const nameHeader = getNameHeader(row);
    const target = findNameWrapper(row);
    if (!nameHeader || !target) return;

    // Remove badges left by older script versions if the target container changed.
    nameHeader.querySelectorAll('.m365-name-badge').forEach(badge => {
      if (!target.contains(badge)) badge.remove();
    });

    const agentName = extractNameText(target);
    const rule = matchNameBadge(agentName);
    const desiredEmoji = rule ? emojiFromSpec(rule.emoji) : '';
    setOrUpdateBadge(target, desiredEmoji);
  }

  // ============================================================================
  // AGENTS GRID DISCOVERY (SCOPED)
  // ============================================================================
  function isAgentsHeaderSet(headers) {
    const wanted = ['name', 'status', 'number', 'profile', 'group', 'time'];
    const got = headers
      .map(h => (h.textContent ?? '').trim().toLowerCase())
      .filter(Boolean);
    return wanted.every(w => got.includes(w));
  }

  function findAgentsGrid() {
    const grids = [...document.querySelectorAll('[role="grid"]')];
    for (const g of grids) {
      const headers = [...g.querySelectorAll('[role="columnheader"][aria-colindex]')];
      if (headers.length < 6) continue;
      if (!isAgentsHeaderSet(headers)) continue;
      // Do not depend on Puzzel internal CSS class names; headers already identify the Agents grid.
      if (!g.querySelector('[role="row"]')) continue;
      return g;
    }
    return null;
  }

  // ============================================================================
  // DIRTY ROW TRACKING + DEBOUNCE (SCOPED)
  // ============================================================================
  const dirtyRows = new Set();
  let debounceTimer = null;

  let AGENTS_GRID = null;
  let gridObserver = null;

  let forceFullScan = true;     // initial scan
  let lastFullScanAt = 0;

  // Rebind throttling
  let lastRebindCheckAt = 0;
  let rebindTimer = null;

  function shouldIgnoreMutationTarget(t) {
    // Ignore mutations caused by our own badge writes.
    // Note: characterData mutations have Text nodes as target.
    const el = (t && t.nodeType === Node.TEXT_NODE) ? t.parentElement : t;
    return !!(el && el.closest && el.closest('.m365-name-badge'));
  }

  function markDirtyFromMutation(mutation) {
    const target = mutation.target;
    if (!target || shouldIgnoreMutationTarget(target)) return;

    const el = (target.nodeType === Node.TEXT_NODE) ? target.parentElement : target;
    const row = el?.closest?.('[role="row"]');
    if (row) dirtyRows.add(row);

    // Rows added wholesale (the grid re-renders them, for example when the
    // window width switches layout) are reported on their container, not
    // on a row, so pick the new rows out of the added nodes.
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches('[role="row"]')) dirtyRows.add(node);
        else node.querySelectorAll?.('[role="row"]').forEach(r => dirtyRows.add(r));
      });
    }
  }

  function scheduleProcess() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processChanges, DEBOUNCE_DELAY_MS);
  }

  function processChanges() {
    if (!AGENTS_GRID) return;

    // Hidden tab: do nothing now, catch up with one full scan on return.
    if (document.hidden) {
      forceFullScan = true;
      dirtyRows.clear();
      return;
    }

    // If nothing changed and no forced scan, do nothing (big efficiency win)
    if (dirtyRows.size === 0 && !forceFullScan) return;

    const allRows = AGENTS_GRID.querySelectorAll('[role="row"]');
    const dirtyList = [...dirtyRows].filter(r => AGENTS_GRID.contains(r));
    const useFullScan = forceFullScan || dirtyList.length > allRows.length / 2;

    if (useFullScan) {
      allRows.forEach(processRow);
      lastFullScanAt = Date.now();
      forceFullScan = false;
    } else {
      dirtyList.forEach(processRow);
    }

    dirtyRows.clear();
  }

  // ============================================================================
  // ROW PROCESSING
  // ============================================================================
  function processRow(row) {
    const cols = gridCols();
    const status = textOfCell(row, cols.status);

    // If Status is temporarily unreadable (virtualization/update), reset to default.
    if (!status) {
      resetRowStyle(row);
      applyNameBadgeToRow(row);
      return;
    }

    const profile = textOfCell(row, cols.profile);
    const rule = matchRule(status, profile);
    applyHighlightIfChanged(row, rule);
    applyNameBadgeToRow(row);
  }

  // ============================================================================
  // GRID REBIND (SPA-SAFE)
  // ============================================================================
  function disconnectGridObserver() {
    if (gridObserver) {
      try { gridObserver.disconnect(); } catch { /* ignore */ }
      gridObserver = null;
    }
  }

  function attachObserversToAgentsGrid(grid) {
    // If same grid and still connected, keep.
    if (AGENTS_GRID === grid && AGENTS_GRID?.isConnected) {
      return;
    }

    disconnectGridObserver();

    AGENTS_GRID = grid;
    forceFullScan = true;
    lastFullScanAt = 0;
    dirtyRows.clear();

    console.log('[Puzzel Highlighter] Agents grid detected (scoped, rebind).');

    gridObserver = new MutationObserver(mutations => {
      // Hidden tab: skip per-mutation work entirely; one full scan on return.
      if (document.hidden) {
        forceFullScan = true;
        return;
      }
      for (const m of mutations) markDirtyFromMutation(m);
      scheduleProcess();
    });

    gridObserver.observe(AGENTS_GRID, {
      childList: true,
      subtree: true,
      characterData: true
      // attributes: false (kept for efficiency)
    });

    scheduleProcess();
  }

  function maybeRebindGrid(reason) {
    const now = Date.now();
    if (now - lastRebindCheckAt < REBIND_CHECK_THROTTLE_MS) {
      // Coalesce bursts, preserving the original reason
      clearTimeout(rebindTimer);
      rebindTimer = setTimeout(() => maybeRebindGrid(reason), REBIND_CHECK_THROTTLE_MS);
      return;
    }

    lastRebindCheckAt = now;

    // If the current grid is gone or replaced, re-find.
    if (!AGENTS_GRID || !AGENTS_GRID.isConnected) {
      const grid = findAgentsGrid();
      if (grid) attachObserversToAgentsGrid(grid);
      return;
    }

    // Routine shell mutations while the current grid is alive: skip the full
    // findAgentsGrid scan. The grid observer covers content changes, a replaced
    // grid is caught via the isConnected branch above, and nav/focus/visibility
    // reasons below still run the parallel-grid scan.
    if (reason === 'shell') {
      return;
    }

    // In some SPA transitions, a different grid is mounted in parallel; prefer the current page's grid.
    const grid = findAgentsGrid();
    if (grid && grid !== AGENTS_GRID) {
      attachObserversToAgentsGrid(grid);
      return;
    }

    // Grid is present; force a refresh after navigation/tab changes.
    if (reason) {
      forceFullScan = true;
      scheduleProcess();
    }
  }

  // ============================================================================
  // APP-SHELL OBSERVER (WATCH GRID MOUNT/UNMOUNT)
  // ============================================================================
  let shellObserver = null;
  function startShellObserver() {
    if (shellObserver) return;

    shellObserver = new MutationObserver(() => {
      // Hidden tab: skip; the visibilitychange handler rebinds on return.
      if (document.hidden) return;
      // Body changed: could be internal tab switch (Queue overview <-> My Log/Settings)
      maybeRebindGrid('shell');
    });

    shellObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ============================================================================
  // NAVIGATION HOOKS (SPA)
  // ============================================================================
  function hookHistoryEvents() {
    const fire = (type) => {
      try {
        window.dispatchEvent(new Event(type));
      } catch {
        // IE fallback not needed; ignore
      }
    };

    const wrap = (methodName) => {
      const original = history[methodName];
      if (!original) return;
      if (original.__m365Wrapped) return;

      const wrapped = function () {
        const ret = original.apply(this, arguments);
        fire('m365:navigation');
        return ret;
      };
      wrapped.__m365Wrapped = true;
      history[methodName] = wrapped;
    };

    wrap('pushState');
    wrap('replaceState');

    window.addEventListener('popstate', () => {
      fire('m365:navigation');
    }, true);

    window.addEventListener('hashchange', () => {
      fire('m365:navigation');
    }, true);

    window.addEventListener('m365:navigation', () => {
      // Any navigation/tab swap should trigger a rescan and possible rebind.
      forceFullScan = true;
      // allow DOM to settle before searching
      setTimeout(() => maybeRebindGrid('nav'), 150);
    }, true);
  }

  // ============================================================================
  // VISIBILITY/FOCUS + PERIODIC FULL SYNC
  // ============================================================================
  window.addEventListener('focus', () => {
    forceFullScan = true;
    maybeRebindGrid('focus');
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      forceFullScan = true;
      maybeRebindGrid('visible');
    }
  }, true);

  setInterval(() => {
    // Hidden tab: zero work; visibilitychange handles the catch-up on return.
    if (document.hidden) return;

    // If the grid was unmounted while in another internal tab, rebind when we can.
    if (!AGENTS_GRID || !AGENTS_GRID.isConnected) {
      maybeRebindGrid('tick-rebind');
      return;
    }

    const now = Date.now();
    if (now - lastFullScanAt >= FULL_SYNC_MIN_INTERVAL_MS) {
      forceFullScan = true;
    }
    scheduleProcess();
  }, FALLBACK_TICK_MS);

  // ============================================================================
  // BOOT
  // ============================================================================
  hookHistoryEvents();
  startShellObserver();
  maybeRebindGrid('boot');

})();

// ============================================================================
// SCHEDULED ROW
// One extra row in the agents grid during one week a year, following a
// working-day schedule. Its texts are packed in ROW_DATA below. The row is
// cloned from a real agent row, so the highlight rules and status icons
// above apply to it like to any agent.
// ============================================================================
(function () {
  'use strict';

  /******************************************************************
   * ROW DATA
   * The row's texts, packed (base64 of UTF-8 JSON) so they do not show
   * up as plain text in the file. Fields: name, emoji, number, profile,
   * group, week ("MM-DD", the row shows Monday to Sunday of the week
   * containing it), timeZone (IANA zone the schedule runs in), suffix
   * (appended to every status) and statuses { admin, ready, lunch,
   * pause, saturday, sunday }.
   *
   * Testing, from the console:
   *   localStorage.setItem('pcc-scheduled-agent-row-test', '1')    show now
   *   localStorage.removeItem('pcc-scheduled-agent-row-test')      remove
   * "1" shows the row right away with today's schedule; outside its
   * hours it shows Ready. A moment like '2026-11-09T13:30' (in the row's
   * time zone) can be used instead to see a specific status.
   ******************************************************************/
  const ROW_DATA = [
    'eyJuYW1lIjoiTmlrb2xheSBLYXphbmR6aGlldiIsImVtb2ppIjoi8J+qkCIsIm51',
    'bWJlciI6IjAwMzU5MTk5MzExMDkiLCJwcm9maWxlIjoiU3lzdGVtIEVuZ2luZWVy',
    'IiwiZ3JvdXAiOiJTdXBwb3J0IENDIEJHIiwid2VlayI6IjExLTA5IiwidGltZVpv',
    'bmUiOiJFdXJvcGUvU29maWEiLCJzdWZmaXgiOiIo4oieKSIsInN0YXR1c2VzIjp7',
    'ImFkbWluIjoiQWRtaW4iLCJyZWFkeSI6IlJlYWR5IiwibHVuY2giOiJMdW5jaCIs',
    'InBhdXNlIjoiUGF1c2UiLCJzYXR1cmRheSI6ItCf0L7QvNC90LjQvCDRgtC1Iiwi',
    'c3VuZGF5Ijoi0JLQtdGH0L3QsCDQv9Cw0LzQtdGCIn19'
  ].join('');
  const TEST_NOW_KEY = 'pcc-scheduled-agent-row-test';

  // Working-day schedule, minutes after midnight.
  const SCHEDULE = {
    adminFrom: 6 * 60,          // 06:00
    shiftFrom: 9 * 60,          // 09:00
    shiftTo: 17 * 60 + 30,      // 17:30
    lunchMinutes: 60,
    lunch: { min: 12 * 60, peak: 13 * 60, max: 15 * 60 },   // start window
    pause: { min: 0, peak: 60, max: 120 },                   // length after shift
    weekendFrom: 6 * 60,        // 06:00
    weekendTo: 24 * 60          // midnight
  };

  /******************************************************************
   * INTERNAL SETTINGS
   ******************************************************************/
  const ROW_FLAG = 'pccScheduledRow';
  const TICK_MS = 1000;
  const GRID_RECHECK_TICKS = 2;

  let unpacked;

  function readConfig() {
    if (unpacked === undefined) {
      try {
        const bytes = Uint8Array.from(atob(ROW_DATA), (ch) => ch.charCodeAt(0));
        unpacked = JSON.parse(new TextDecoder().decode(bytes));
      } catch (_) {
        unpacked = null;
      }
    }
    if (!unpacked) return null;
    let testNow = '';
    try { testNow = window.localStorage.getItem(TEST_NOW_KEY) || ''; } catch (_) { /* storage blocked */ }
    unpacked.testNow = testNow;
    return unpacked;
  }

  /******************************************************************
   * Time in the configured zone
   ******************************************************************/
  const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  let zoneFormat = null;
  let zoneFormatFor = '';

  // Wall clock in the zone: date parts, weekday (0 = Sunday) and seconds
  // after midnight. testNow replaces the clock for trying the schedule.
  function zoneNow(config) {
    if (config.testNow) {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(config.testNow);
      if (m) {
        const y = +m[1], mo = +m[2], d = +m[3];
        const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
        const secondsOfDay = +m[4] * 3600 + +m[5] * 60 + (Math.floor(Date.now() / 1000) % 60);
        return { y: y, mo: mo, d: d, weekday: weekday, seconds: secondsOfDay };
      }
    }
    if (!zoneFormat || zoneFormatFor !== config.timeZone) {
      zoneFormat = new Intl.DateTimeFormat('en-GB', {
        timeZone: config.timeZone, hourCycle: 'h23', weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      zoneFormatFor = config.timeZone;
    }
    const parts = {};
    zoneFormat.formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
    return {
      y: +parts.year, mo: +parts.month, d: +parts.day,
      weekday: WEEKDAYS[parts.weekday],
      seconds: +parts.hour * 3600 + +parts.minute * 60 + +parts.second
    };
  }

  // Day number for plain calendar arithmetic (no time zone involved).
  function dayNumber(y, mo, d) {
    return Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  }

  // Monday to Sunday week that contains config.week in the current year.
  function inConfiguredWeek(config, now) {
    const m = /^(\d{2})-(\d{2})$/.exec(config.week);
    if (!m) return false;
    const target = new Date(Date.UTC(now.y, +m[1] - 1, +m[2]));
    const monday = dayNumber(now.y, +m[1], +m[2]) - ((target.getUTCDay() + 6) % 7);
    const today = dayNumber(now.y, now.mo, now.d);
    return today >= monday && today <= monday + 6;
  }

  /******************************************************************
   * Seeded, triangular randomness
   * Same date + same salt = same number, so a day's lunch and pause
   * stay put across reloads and are identical for every viewer.
   ******************************************************************/
  function seededUnit(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // One mulberry32 step to spread the bits.
    let t = (h + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Inverse of the triangular distribution: most likely at peak, falling
  // off evenly towards min and max.
  function triangular(u, range) {
    const a = range.min, c = range.peak, b = range.max;
    const split = (c - a) / (b - a);
    return u < split
      ? a + Math.sqrt(u * (b - a) * (c - a))
      : b - Math.sqrt((1 - u) * (b - a) * (b - c));
  }

  function dayPlan(now) {
    const key = now.y + '-' + now.mo + '-' + now.d;
    return {
      lunchStart: Math.round(triangular(seededUnit(key + ':lunch'), SCHEDULE.lunch)),
      pauseLength: Math.round(triangular(seededUnit(key + ':pause'), SCHEDULE.pause))
    };
  }

  /******************************************************************
   * What the row shows right now
   * Returns { status, ready, sinceSeconds } or null (not shown).
   ******************************************************************/
  function currentState(config, now) {
    const forced = config.testNow === '1';
    if (!forced && !inConfiguredWeek(config, now)) return null;
    const state = scheduledState(config, now);
    if (state || !forced) return state;
    return { status: (config.statuses || {}).ready, ready: true, sinceSeconds: Math.max(0, now.seconds - 60) };
  }

  function scheduledState(config, now) {
    const s = config.statuses || {};
    const t = now.seconds;
    const at = (minutes) => minutes * 60;

    if (now.weekday === 6 || now.weekday === 0) {
      if (t < at(SCHEDULE.weekendFrom) || t >= at(SCHEDULE.weekendTo)) return null;
      return { status: now.weekday === 6 ? s.saturday : s.sunday, ready: false, sinceSeconds: at(SCHEDULE.weekendFrom) };
    }

    const plan = dayPlan(now);
    const lunchFrom = at(plan.lunchStart);
    const lunchTo = lunchFrom + at(SCHEDULE.lunchMinutes);
    const pauseTo = at(SCHEDULE.shiftTo + plan.pauseLength);

    if (t < at(SCHEDULE.adminFrom)) return null;
    if (t < at(SCHEDULE.shiftFrom)) return { status: s.admin, ready: false, sinceSeconds: at(SCHEDULE.adminFrom) };
    if (t < lunchFrom) return { status: s.ready, ready: true, sinceSeconds: at(SCHEDULE.shiftFrom) };
    if (t < lunchTo) return { status: s.lunch, ready: false, sinceSeconds: lunchFrom };
    if (t < at(SCHEDULE.shiftTo)) return { status: s.ready, ready: true, sinceSeconds: lunchTo };
    if (t < pauseTo) return { status: s.pause, ready: false, sinceSeconds: at(SCHEDULE.shiftTo) };
    return null;
  }

  // The status icon is a span whose class picks the picture: "online" is
  // the green check, "pause" the orange clock. Set from the row's own
  // state on every tick, so it never depends on which agent was copied.
  const ICON_CLASSES = ['online', 'pause'];

  function setStatusIcon(statusCell, ready) {
    const icon = statusCell && statusCell.querySelector('.new-status-icon');
    if (!icon) return;
    const wanted = ready ? 'online' : 'pause';
    Array.from(icon.classList).forEach((c) => {
      if (c !== wanted && c !== 'au-target' && c !== 'new-status-icon' &&
          (ICON_CLASSES.indexOf(c) !== -1 || /^[a-z-]+$/.test(c))) icon.classList.remove(c);
    });
    if (!icon.classList.contains(wanted)) icon.classList.add(wanted);
  }

  // Same format as the grid: 3s, 16m 37s, 1h 1m 44s.
  function formatDuration(totalSeconds) {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h) return h + 'h ' + m + 'm ' + s + 's';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }

  function parseDuration(text) {
    let total = 0;
    const re = /(\d+)\s*([hms])/g;
    let hit;
    while ((hit = re.exec(text || '')) !== null) {
      total += +hit[1] * (hit[2] === 'h' ? 3600 : hit[2] === 'm' ? 60 : 1);
    }
    return total;
  }

  /******************************************************************
   * The agents grid (same detection as the PCC Agent Highlighter)
   ******************************************************************/
  const WANTED_HEADERS = ['name', 'status', 'number', 'profile', 'group', 'time'];

  // The page can hold several agents grids (other queues, hidden tabs).
  // Only a visible one with agent rows is usable: that is the list on
  // screen, and it has rows to copy from.
  // Visibility is judged on the rows, not the grid element: the grid can
  // be a layout-less wrapper (display: contents) that reports no boxes
  // even while its rows are on screen.
  function usableGrid(g) {
    if (!g || !g.isConnected) return false;
    return shownRows(g).length > 0;
  }

  function findAgentsGrid() {
    for (const g of document.querySelectorAll('[role="grid"]')) {
      const got = Array.from(g.querySelectorAll('[role="columnheader"][aria-colindex]'))
        .map((h) => (h.textContent || '').trim().toLowerCase());
      if (WANTED_HEADERS.every((w) => got.indexOf(w) !== -1) && usableGrid(g)) return g;
    }
    return null;
  }

  function columnIndexes(grid) {
    const map = {};
    grid.querySelectorAll('[role="columnheader"][aria-colindex]').forEach((h) => {
      const key = (h.textContent || '').trim().toLowerCase();
      if (WANTED_HEADERS.indexOf(key) !== -1) map[key] = h.getAttribute('aria-colindex');
    });
    return map;
  }

  function agentRows(grid) {
    return Array.from(grid.querySelectorAll('[role="row"]')).filter((r) =>
      !r.dataset[ROW_FLAG] && r.querySelector('[role="rowheader"], [role="gridcell"]'));
  }

  // Only rows actually drawn on screen. The grid also holds rows that are
  // not (hidden or zero-height helper rows of the list component, kept in
  // a separate container at the top); using one of those as the model or
  // as the placement anchor put this row at the top with wrong cells, and
  // made it jump between there and its real place every second.
  function shownRows(grid) {
    return agentRows(grid).filter((r) => r.offsetHeight > 0 && r.querySelector('[role="rowheader"]'));
  }

  function cell(row, col) {
    return row.querySelector('[aria-colindex="' + col + '"]');
  }

  // Each agent row sits in its own aa-data-grid-row wrapper element; that
  // wrapper is what gets copied, placed and removed, never the inner row
  // on its own (that ended up inside another agent's wrapper).
  function unitOf(row) {
    const p = row.parentElement;
    return p && p.tagName.toLowerCase() === 'aa-data-grid-row' ? p : row;
  }

  // The grid changes layout with the window width (an expand column is
  // added on narrow windows). The header line identifies the layout; when
  // it changes, the row is rebuilt from a fresh copy in the new layout.
  function layoutKey(grid) {
    return Array.from(grid.querySelectorAll('[role="columnheader"][aria-colindex]'))
      .map((h) => h.getAttribute('aria-colindex') + ':' + (h.textContent || '').trim().toLowerCase()).join('|');
  }

  // The visible text of a cell sits in its last non-empty text node; the
  // status icon is a separate element, so replacing that node keeps it.
  function setCellText(target, value) {
    if (!target) return;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let last = null;
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.trim() && !(node.parentElement && node.parentElement.closest('.m365-name-badge'))) last = node;
    }
    if (last) {
      // Keep the cell's own leading space (the gap after the status icon).
      const next = (last.nodeValue.match(/^\s*/) || [''])[0] + value;
      if (last.nodeValue !== next) last.nodeValue = next;
    } else {
      target.appendChild(document.createTextNode(value));
    }
  }

  function statusText(row, cols) {
    const c = cell(row, cols.status);
    return c ? (c.textContent || '').trim() : '';
  }

  // A real row in the same kind of status supplies the icon: a Ready
  // agent for Ready, any other agent for the away statuses.
  function templateFor(rows, cols, ready) {
    const match = rows.find((r) => /^ready\b/i.test(statusText(r, cols)) === ready);
    return match || rows[0] || null;
  }

  /******************************************************************
   * Building and placing the row
   ******************************************************************/
  let ourRow = null;    // the inner role="row" element
  let ourUnit = null;   // its wrapper, the element that is placed in the grid
  let ourKind = null;   // 'ready' or 'away': which template it was cloned from
  let ourLayout = '';   // layoutKey() the row was built for

  function buildRow(grid, cols, config, state) {
    const rows = shownRows(grid);
    const template = templateFor(rows, cols, state.ready);
    if (!template) return null;

    const unit = unitOf(template).cloneNode(true);
    const row = unit.matches('[role="row"]') ? unit : unit.querySelector('[role="row"]');
    if (!row) return null;
    unit.dataset[ROW_FLAG] = '1';
    row.dataset[ROW_FLAG] = '1';
    row.removeAttribute('aria-selected');
    row.removeAttribute('tabindex');
    // The clone carries the template's Highlighter colour and badge;
    // clear them so the Highlighter evaluates this row on its own.
    row.classList.remove('m365-highlight-row');
    row.style.backgroundColor = '';
    row.style.color = '';
    delete row.dataset.m365HighlightKey;
    row.querySelectorAll('.m365-name-badge').forEach((b) => b.remove());

    const nameCell = cell(row, cols.name);
    setCellText(nameCell, config.name);
    if (config.emoji && nameCell) {
      const badge = document.createElement('span');
      badge.className = 'm365-name-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = ' ' + config.emoji;
      const target = nameCell.querySelector('.aa-grid-cell-wrapper') || nameCell;
      target.appendChild(badge);
    }
    setCellText(cell(row, cols.number), config.number || '');
    setCellText(cell(row, cols.profile), config.profile || '');
    setCellText(cell(row, cols.group), config.group || '');
    ourKind = state.ready ? 'ready' : 'away';
    ourLayout = layoutKey(grid);
    ourUnit = unit;
    return row;
  }

  // Keeps the grid's Time order: rows are compared by their Time value,
  // ascending or descending as the grid currently is.
  /******************************************************************
   * Following the grid's sort order
   * The app's own comparison is not visible (Number sorts as plain text,
   * Softphone first, then numbers highest first), so nothing is assumed.
   * Each column is scored against the rows on screen, with each way of
   * comparing and both directions, by counting neighbours that are out of
   * order. The best fit wins, Time first on a tie (the grid's default).
   * Header icons are not used: every header carries icons, sorted or
   * not, which made an unsorted column look sorted. Columns with a single
   * value on screen say nothing about the order and are skipped. The row
   * then goes where it breaks that order the least.
   ******************************************************************/
  const SORT_KEYS = ['time', 'name', 'status', 'number', 'profile', 'group'];

  // Reads the cell's text directly. Only a Name cell can hold the emoji
  // badge; its text is cut out instead of copying the cell to remove it.
  function cellValue(row, cols, key) {
    const c = cell(row, cols[key]);
    if (!c) return key === 'time' ? 0 : '';
    let text = c.textContent || '';
    const badge = key === 'name' ? c.querySelector('.m365-name-badge') : null;
    if (badge && badge.textContent) text = text.split(badge.textContent).join('');
    text = text.replace(/\s+/g, ' ').trim();
    return key === 'time' ? parseDuration(text) : normalise(key, text);
  }

  // Status is compared without its counter: "Lunch (0)" and "Lunch (∞)"
  // are the same status.
  function normalise(key, text) {
    return key === 'status' ? String(text).replace(/\s*\([^)]*\)\s*$/, '') : text;
  }

  const COMPARERS = {
    duration: (a, b) => a - b,
    natural: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }),
    plain: (a, b) => { const x = String(a).toLowerCase(), y = String(b).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  };

  function comparersFor(key) {
    return key === 'time' ? ['duration'] : ['plain', 'natural'];
  }

  function outOfOrder(values, compare, dir) {
    let bad = 0;
    for (let i = 1; i < values.length; i += 1) if (compare(values[i - 1], values[i]) * dir > 0) bad += 1;
    return bad;
  }

  // Every column is read once per check into this table and reused.
  function sortSpec(cols, rows, table) {
    const keys = SORT_KEYS.filter((k) => cols[k]);
    let best = null;
    keys.forEach((key) => {
      const values = table[key] || (table[key] = rows.map((r) => cellValue(r, cols, key)));
      if (new Set(values.map(String)).size < 2) return;
      comparersFor(key).forEach((name) => {
        [1, -1].forEach((dir) => {
          const bad = outOfOrder(values, COMPARERS[name], dir);
          if (!best || bad < best.bad) best = { key: key, compare: COMPARERS[name], dir: dir, bad: bad };
        });
      });
    });
    return best;
  }

  // The sort check only reruns when the list changes (other names, or
  // the same names in another order). In between, only the sorted column
  // (and Time, inside a group) is read, once per second.
  let sortCache = { sig: null, spec: null };

  function placeRow(grid, cols, unit, own) {
    const rows = shownRows(grid);
    if (!rows.length) return;
    const units = rows.map(unitOf);
    const table = { name: rows.map((r) => cellValue(r, cols, 'name')) };
    const sig = table.name.join('\u0001');
    if (sig !== sortCache.sig || !sortCache.spec) {
      sortCache = { sig: sig, spec: sortSpec(cols, rows, table) };
    }
    const spec = sortCache.spec;
    if (!spec) return;
    const values = table[spec.key] || (table[spec.key] = rows.map((r) => cellValue(r, cols, spec.key)));
    const mine = spec.key === 'time' ? own.time : normalise(spec.key, own[spec.key]);

    // Agents with the same value form a group (all on Lunch, say). The app
    // orders the groups in its own way (Ready first, then the rest A to Z),
    // so when such a group exists the row simply joins it, ordered by Time
    // inside it like the others.
    const group = [];
    if (spec.key !== 'time') {
      for (let k = 0; k < rows.length; k += 1) if (spec.compare(mine, values[k]) === 0) group.push(k);
    }
    if (group.length) {
      const allTimes = table.time || (table.time = rows.map((r) => cellValue(r, cols, 'time')));
      const times = group.map((k) => allTimes[k]);
      const ascending = times.length < 2 || times[0] <= times[times.length - 1];
      let at = group.find((k, n) => (ascending ? own.time <= times[n] : own.time >= times[n]));
      if (at !== undefined) {
        const before = units[at];
        if (unit.nextElementSibling !== before) before.parentElement.insertBefore(unit, before);
      } else {
        const last = units[group[group.length - 1]];
        if (last.nextElementSibling !== unit) last.insertAdjacentElement('afterend', unit);
      }
      return;
    }

    // Position i means "before row i" (rows.length = after the last).
    let bestIndex = rows.length;
    let bestCost = Infinity;
    for (let i = 0; i <= rows.length; i += 1) {
      let cost = 0;
      for (let k = 0; k < rows.length; k += 1) {
        const c = spec.compare(mine, values[k]) * spec.dir;
        if (k < i && c < 0) cost += 1;     // a row above that should be below
        if (k >= i && c > 0) cost += 1;    // a row below that should be above
      }
      if (cost < bestCost) { bestCost = cost; bestIndex = i; }
    }
    if (bestIndex < rows.length) {
      const before = units[bestIndex];
      if (unit.nextElementSibling !== before) before.parentElement.insertBefore(unit, before);
    } else {
      const last = units[units.length - 1];
      if (last.nextElementSibling !== unit) last.insertAdjacentElement('afterend', unit);
    }
  }

  // Narrow windows hide columns and change widths on the live rows only
  // (hidden cells, inline widths). Mirror a real row onto ours: the row's
  // sizing styles (not its colours, the Highlighter owns those) and each
  // cell's class, style and hidden state. Only differences are written.
  const ROW_SIZE_PROPS = ['gridTemplateColumns', 'width', 'minWidth', 'maxWidth', 'flex', 'display'];

  function syncLayout(grid) {
    const ref = shownRows(grid)[0];
    if (!ref || !ourRow) return;
    // Never removes the row. Cells are matched by column number, not by
    // position, so a model row with an extra element cannot shift them.
    ROW_SIZE_PROPS.forEach((p) => {
      if (ourRow.style[p] !== ref.style[p]) ourRow.style[p] = ref.style[p];
    });
    Array.from(ref.querySelectorAll(':scope > [aria-colindex]')).forEach((refCell) => {
      const mine = ourRow.querySelector(':scope > [aria-colindex="' + refCell.getAttribute('aria-colindex') + '"]');
      if (!mine) return;
      if (mine.className !== refCell.className) mine.className = refCell.className;
      const refStyle = refCell.getAttribute('style') || '';
      if ((mine.getAttribute('style') || '') !== refStyle) {
        if (refStyle) mine.setAttribute('style', refStyle); else mine.removeAttribute('style');
      }
      const refHidden = refCell.getAttribute('aria-hidden');
      if (mine.getAttribute('aria-hidden') !== refHidden) {
        if (refHidden === null) mine.removeAttribute('aria-hidden'); else mine.setAttribute('aria-hidden', refHidden);
      }
    });
  }

  function removeRow() {
    if (ourUnit && ourUnit.parentElement) ourUnit.remove();
    ourRow = null;
    ourUnit = null;
    ourKind = null;
    ourLayout = '';
  }

  /******************************************************************
   * Tick
   ******************************************************************/
  let grid = null;
  let gridObserver = null;
  let ticks = 0;

  function watchGrid(next) {
    if (gridObserver) gridObserver.disconnect();
    grid = next;
    if (!grid) return;
    // The app re-renders the list now and then and drops foreign rows;
    // put ours back on the next tick instead of waiting for the reorder.
    gridObserver = new MutationObserver(() => {
      if (ourUnit && !ourUnit.isConnected) window.setTimeout(tick, 0);
    });
    gridObserver.observe(grid, { childList: true, subtree: true });
  }

  // Test mode only: say once in the console why the row is or is not
  // shown, each time the reason changes. Silent otherwise.
  let lastReason = '';
  function report(config, reason) {
    if (!config || !config.testNow || reason === lastReason) return;
    lastReason = reason;
    console.info('[Puzzel Highlighter] extra row:', reason);
  }

  function gridSummary() {
    const grids = Array.from(document.querySelectorAll('[role="grid"]'));
    return grids.map((g) => {
      const heads = Array.from(g.querySelectorAll('[role="columnheader"]')).map((h) => (h.textContent || '').trim().toLowerCase());
      const rows = agentRows(g);
      return heads.length + ' headers [' + heads.join(',') + '] ' + rows.length + ' rows, ' +
        rows.filter((r) => r.getClientRects().length > 0).length + ' visible';
    }).join(' / ');
  }

  function tick() {
    if (document.hidden) return;
    const config = readConfig();
    if (!config) { removeRow(); return; }

    const now = zoneNow(config);
    const state = currentState(config, now);
    if (!state) { removeRow(); report(config, 'not scheduled now'); return; }

    ticks += 1;
    if (!usableGrid(grid)) {
      if (grid && ticks % GRID_RECHECK_TICKS !== 0) return;
      removeRow();
      watchGrid(findAgentsGrid());
      if (!grid) { report(config, 'no usable agents grid. Grids: ' + gridSummary()); return; }
    }
    const cols = columnIndexes(grid);
    if (!cols.name || !cols.status || !cols.time) { report(config, 'columns not found: ' + JSON.stringify(cols)); return; }

    // A change between ready and away needs the other kind of icon.
    const kind = state.ready ? 'ready' : 'away';
    if (ourRow && (ourKind !== kind || !grid.contains(ourUnit) || ourLayout !== layoutKey(grid))) removeRow();
    if (!ourRow) {
      ourRow = buildRow(grid, cols, config, state);
      if (!ourRow) { report(config, 'could not copy an agent row'); return; }
    }

    const elapsed = now.seconds - state.sinceSeconds;
    const statusCell = cell(ourRow, cols.status);
    setCellText(statusCell, (state.status || '') + (config.suffix ? ' ' + config.suffix : ''));
    setStatusIcon(statusCell, state.ready);
    setCellText(cell(ourRow, cols.time), formatDuration(elapsed));

    // Every tick: the app reorders its own rows whenever an agent changes
    // status, which left this row behind in the old spot until the next
    // check. placeRow only touches the DOM when the spot is wrong.
    const statusLabel = (state.status || '') + (config.suffix ? ' ' + config.suffix : '');
    placeRow(grid, cols, ourUnit, {
      time: elapsed, name: config.name || '', status: statusLabel,
      number: config.number || '', profile: config.profile || '', group: config.group || ''
    });
    if (!ourUnit.isConnected) { report(config, 'could not place the row in the list'); return; }
    syncLayout(grid);
    report(config, 'shown: ' + (state.status || ''));
  }

  // A failure is reported once in the console instead of silently on
  // every tick, so a problem on a live page can be seen and fixed.
  let reported = false;
  function safeTick() {
    try {
      tick();
    } catch (err) {
      if (!reported) {
        reported = true;
        console.warn('[Puzzel Highlighter] extra row:', err);
      }
    }
  }

  window.setInterval(safeTick, TICK_MS);
  safeTick();
})();
