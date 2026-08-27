// @file_name = PCC_Agent_Highlighter.user.js
// @author = Kardo Rostam
// @version = 4.2_2026-08-27
// @created = 2026-02-10 (v2.9)
// ==UserScript==
// @name         Puzzel Agent Highlighter
// @namespace    http://tampermonkey.net/
// @version      4.2_2026-08-27
// @description  Highlights Puzzel Agent rows and badges names. Battery friendly: pauses all processing while the tab is hidden and resyncs once on return.
// @match        https://app.puzzel.com/agent*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
/*
v4.2 (2026-08-27)
------------------
Energy efficiency pass (battery laptops; tab is often hidden or the window covered):
- All mutation processing is skipped while the tab is hidden; one full resync runs on return
  (visibilitychange/focus hooks already existed and now carry the whole catch-up).
- The 5s fallback tick exits immediately when hidden.
- Removed the 200ms waitForAgentsGrid polling loop; boot scan + shell observer handle discovery.
- Routine shell mutations no longer trigger a full findAgentsGrid scan while the current grid
  is alive; nav/focus/visibility events still do, and a replaced grid is caught via isConnected.
- Status matching is now EXACT (a hypothetical "Not ready" no longer matches the "Ready" rule).
  Profile matching stays substring-based.
- findNameWrapper caches descendant counts instead of recomputing them in the sort comparator.
- Dropped the stale v4.0 from @name and the console log line.

v4.0 (2026-05-27)
------------------
Bugfix: Puzzel changed/removed the old .aa-grid-cell-wrapper element.
- Agent grid detection no longer depends on .aa-grid-cell-wrapper.
- Name badges are appended to an inner/inline name container instead of the full rowheader cell.
- Fallback creates a small inline name wrapper if Puzzel renders the name directly in the rowheader.
- Removes stray old badge elements in the name cell before writing the current badge.

v3.8 (2026-02-26)
----------------
Bugfix: internal tab switching (e.g., Queue overview <-> My Log / Settings) could replace/unmount the Agents grid.
In v3.7 the MutationObserver was attached only to the first detected grid; when the grid got replaced, updates stopped and stale highlights could remain.

What changed:
1) Grid rebind (SPA-safe)
   - Detects when the active Agents grid is replaced (isConnected=false or different node).
   - Disconnects the old observer and re-attaches to the new grid automatically.
2) App-shell observer
   - Lightweight observer on document.body watches for grid mount/unmount and triggers rebind.
3) Navigation hooks
   - Hooks history.pushState/replaceState + listens to popstate/hashchange to force a rescan.

Keeps:
- Debounced processing, dirty-row tracking, throttled periodic full sync.
- Page-visible-only full sync.
- Name badges (ignores self-badge mutations).

Badges:
- Uses your NAME_BADGE_TREE:
  Kardo=128023, Hannes=129442, Willy=128039, Simon=128030.
*/

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
    { names: ["Kardo Rostam"],		emoji: 128023 }, // (U+1F417) Boar
    { names: ["Hannes Hartman"],	emoji: 129442 }, // (U+1F40B) Whale
    { names: ["Willy Vesanto"],		emoji: 128039 }, // (U+1F427) Penguin
    { names: ["Simon Batten"],		emoji: 128030 }, // (U+1F41E) Lady Bug
    { names: ["Kim Federspiel"],	emoji: 129409 }, // (U+1F981) LION FACE
  ];

  // Column indexes for the Agents grid
  const NAME_COL = 1;     // Name is a ROWHEADER in this grid
  const STATUS_COL = 2;   // Status is a GRIDCELL
  const PROFILE_COL = 4;  // Profile is a GRIDCELL

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
  // MATCHING LOGIC (HIGHLIGHTS) — LAST MATCH WINS
  // ============================================================================
  function matchRule(statusText, profileText) {
    const s = safeLower(statusText);
    const p = safeLower(profileText);

    let matched = null;
    for (const node of HIGHLIGHT_TREE) {
      const statuses = getNodeStatuses(node).map(safeLower);
      // Exact match: substring matching would let "Not ready" match "Ready".
      if (!statuses.some(st => s === st)) continue;

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

  function getNameHeader(row) {
    return row.querySelector(`[role="rowheader"][aria-colindex="${NAME_COL}"]`);
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
    const status = textOfCell(row, STATUS_COL);

    // If Status is temporarily unreadable (virtualization/update), reset to default.
    if (!status) {
      resetRowStyle(row);
      applyNameBadgeToRow(row);
      return;
    }

    const profile = textOfCell(row, PROFILE_COL);
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
