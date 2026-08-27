// @file_name = PCM_Auto_Refresh.user.js
// @author = Kardo Rostam
// @version = 2.0_2026-08-27
// @created = 2026-02-19 11:08

// ==UserScript==
// @name         PCM Auto Refresh
// @namespace    http://tampermonkey.net/
// @version      2.0_2026-08-27
// @description  Auto-refresh PCM dashboard and ticket list with native-looking dt-button UI, dark mode palette, ring on right (top-aligned). Battery friendly: ring painting is skipped while the tab is hidden; the reload schedule keeps running so background refreshes (and the New Ticket Notifier) still work.
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ======== CONFIG ========
  const DEFAULT_INTERVAL_MS = 60000; // 60s default
  const STORAGE_KEYS = {
    enabled: 'pcmAutoRefreshEnabled',
    interval: 'pcmAutoRefreshIntervalMs'
  };
  const SHOW_NUMERIC_FROM_S = 3; // Show 3,2,1 in the final seconds
  const TICK_MS = 1000; // lighter than 100ms; second precision is enough here
  const FALLBACK_DELAY_MS = 2000;

  // ======== STATE ========
  let enabled = JSON.parse(localStorage.getItem(STORAGE_KEYS.enabled) ?? 'true');
  let intervalMs = parseInt(localStorage.getItem(STORAGE_KEYS.interval) || String(DEFAULT_INTERVAL_MS), 10);
  if (isNaN(intervalMs) || intervalMs < 1000) intervalMs = DEFAULT_INTERVAL_MS;

  let tickTimer = null;
  let startTs = null;
  let remainingMs = intervalMs;

  let buttonEl = null;
  let buttonSpanEl = null;
  let ringEl = null;
  let ringInnerEl = null;

  // ======== COLOR HELPERS (use Puzzel CSS variables with safe fallbacks) ========
  const rootStyle = getComputedStyle(document.documentElement);

  function cssVar(name, fallback) {
    const v = rootStyle.getPropertyValue(name).trim();
    return v || fallback;
  }

  const COLORS = {
    btnBG: cssVar('--pz-surface-3', '#232b3d'),
    btnText: cssVar('--pz-text', '#e6e9ef'),
    btnBorder: cssVar('--pz-border', 'rgba(255,255,255,0.10)'),
    ringTrack: cssVar('--pz-surface-3', '#232b3d'),
    ringBG: cssVar('--pz-surface', '#151923'),
    ringGreen: '#2ecc71',
    ringAmber: '#f1c40f',
    ringRed: '#e74c3c',
    ringEdge: cssVar('--pz-border-strong', 'rgba(255,255,255,0.16)')
  };

  // ======== DOM HELPERS ========
  function byText(root, selector, text) {
    const els = root.querySelectorAll(selector);
    const wanted = text.trim().toLowerCase();

    for (const el of els) {
      if (el.textContent && el.textContent.trim().toLowerCase() === wanted) {
        return el;
      }
    }
    return null;
  }

  function getBtnLabel() {
    return enabled ? `Auto-Refresh: ON (${Math.round(intervalMs / 1000)}s)` : 'Auto-Refresh: OFF';
  }

  function setRingProgress(fraction) {
    if (!ringEl) return;

    const deg = Math.max(0, Math.min(360, 360 * fraction));
    let color = COLORS.ringGreen;
    if (fraction > 0.66) color = COLORS.ringAmber;
    if (fraction > 0.9) color = COLORS.ringRed;

    ringEl.style.background = `conic-gradient(${color} ${deg}deg, ${COLORS.ringTrack} 0)`;
  }

  function stopCountdown() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function startCountdown() {
    stopCountdown();
    startTs = Date.now();
    remainingMs = intervalMs;

    tickTimer = setInterval(() => {
      const elapsed = Date.now() - startTs;
      remainingMs = Math.max(0, intervalMs - elapsed);

      if (remainingMs <= 0) {
        stopCountdown();
        location.reload();
        return;
      }

      // Hidden tab: keep the deadline math above (background refresh must keep
      // working for the New Ticket Notifier), but skip all ring/style updates.
      // Nothing is visible and style writes cost paint work on battery.
      if (document.hidden) return;

      const fraction = 1 - (remainingMs / intervalMs);
      setRingProgress(fraction);

      if (ringInnerEl) {
        const secLeft = Math.ceil(remainingMs / 1000);
        ringInnerEl.textContent = (secLeft > 0 && secLeft <= SHOW_NUMERIC_FROM_S) ? String(secLeft) : '';
      }
    }, TICK_MS);
  }

  function resetCountdown() {
    stopCountdown();
    setRingProgress(0);
    if (ringInnerEl) ringInnerEl.textContent = '';
    if (enabled) startCountdown();
  }

  function createControls() {
    // Create a real dt-button anchor like native buttons
    const a = document.createElement('a');
    a.id = 'pcm-auto-refresh-btn';
    a.className = 'dt-button';
    a.setAttribute('tabindex', '0');
    a.setAttribute('aria-controls', 'pcm-auto-refresh');
    a.setAttribute('title', 'Click to toggle. Shift+Click to set interval (ms).');

    const span = document.createElement('span');
    span.textContent = getBtnLabel();
    a.appendChild(span);

    // Minimal inline style only if the site CSS isn't loaded yet
    a.style.background = COLORS.btnBG;
    a.style.border = `1px solid ${COLORS.btnBorder}`;
    a.style.color = COLORS.btnText;
    a.style.borderRadius = '4px';
    a.style.padding = '3px 8px';
    a.style.fontSize = '12px';
    a.style.whiteSpace = 'nowrap';
    a.style.textDecoration = 'none';
    a.style.userSelect = 'none';
    a.style.display = 'inline-block';
    a.style.marginRight = '0.333em'; // match dt-button spacing

    a.addEventListener('click', (ev) => {
      ev.preventDefault();

      if (ev.shiftKey) {
        const val = prompt('Set refresh interval (ms):', String(intervalMs));
        if (val !== null) {
          const ms = parseInt(val, 10);
          if (!isNaN(ms) && ms >= 1000 && ms <= 3600000) {
            intervalMs = ms;
            localStorage.setItem(STORAGE_KEYS.interval, String(intervalMs));
            if (buttonSpanEl) buttonSpanEl.textContent = getBtnLabel();
            resetCountdown();
          } else {
            alert('Please enter a number between 1000 and 3600000 (1s – 60m).');
          }
        }
        return;
      }

      enabled = !enabled;
      localStorage.setItem(STORAGE_KEYS.enabled, JSON.stringify(enabled));

      if (buttonSpanEl) buttonSpanEl.textContent = getBtnLabel();

      if (enabled) {
        resetCountdown();
      } else {
        stopCountdown();
        setRingProgress(0);
        if (ringInnerEl) ringInnerEl.textContent = '';
      }
    });

    // The countdown ring as a sibling element, placed to the RIGHT
    const ring = document.createElement('div');
    ring.id = 'pcm-refresh-ring';
    ring.style.width = '26px';
    ring.style.height = '26px';
    ring.style.borderRadius = '50%';
    ring.style.display = 'inline-grid';
    ring.style.placeItems = 'center';

    // Top-align so it touches the top of the dt-buttons container
    ring.style.verticalAlign = 'top';
    ring.style.marginTop = '0px';
    ring.style.position = 'relative';
    ring.style.top = '0px';

    ring.style.marginLeft = '0.333em'; // match dt-button spacing
    ring.style.background = `conic-gradient(${COLORS.ringTrack} 0deg, ${COLORS.ringTrack} 360deg)`;
    ring.style.boxShadow = `inset 0 0 0 2px ${COLORS.ringEdge}`;

    const ringInner = document.createElement('div');
    ringInner.id = 'pcm-refresh-ring-inner';
    ringInner.style.width = '18px';
    ringInner.style.height = '18px';
    ringInner.style.borderRadius = '50%';
    ringInner.style.background = COLORS.ringBG;
    ringInner.style.color = COLORS.btnText;
    ringInner.style.fontSize = '11px';
    ringInner.style.lineHeight = '18px';
    ringInner.style.textAlign = 'center';
    ringInner.style.userSelect = 'none';
    ring.appendChild(ringInner);

    buttonEl = a;
    buttonSpanEl = span;
    ringEl = ring;
    ringInnerEl = ringInner;

    return { button: a, ring };
  }

  function placeUI() {
    if (document.getElementById('pcm-auto-refresh-btn') || document.getElementById('pcm-refresh-ring')) {
      return;
    }

    const path = location.pathname;
    let placed = false;
    let placementObserver = null;
    let fallbackTimer = null;

    const controls = createControls();

    function cleanupPlacementWatchers() {
      if (placementObserver) {
        placementObserver.disconnect();
        placementObserver = null;
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    }

    function finishPlacement() {
      placed = true;
      cleanupPlacementWatchers();
      if (enabled) startCountdown();
      return true;
    }

    function startObserving(tryPlaceFn) {
      const target = document.body || document.documentElement;
      placementObserver = new MutationObserver(() => {
        if (tryPlaceFn()) {
          finishPlacement();
        }
      });
      placementObserver.observe(target, { childList: true, subtree: true });
    }

    if (path === '/tickets') {
      const tryPlace = () => {
        const dtButtons = document.querySelector('.dt-buttons');
        if (!dtButtons) return false;

        const sortBtn = byText(dtButtons, 'a.dt-button span', 'Sort & Sub-Sort');
        if (sortBtn && sortBtn.parentElement) {
          sortBtn.parentElement.insertAdjacentElement('afterend', controls.button);
          controls.button.insertAdjacentElement('afterend', controls.ring);
        } else {
          dtButtons.appendChild(controls.button);
          dtButtons.appendChild(controls.ring);
        }
        return true;
      };

      if (tryPlace()) {
        finishPlacement();
      } else {
        startObserving(tryPlace);
      }
    } else if (path === '/') {
      const tryTop = () => {
        const topBars = document.querySelectorAll('header, .navbar, .top, .topbar, .header');
        if (topBars.length === 0) return false;

        const host = topBars[0];
        host.appendChild(controls.button);
        controls.button.insertAdjacentElement('afterend', controls.ring);
        controls.button.style.marginLeft = '12px';
        return true;
      };

      if (tryTop()) {
        finishPlacement();
      } else {
        startObserving(tryTop);
      }
    }

    fallbackTimer = setTimeout(() => {
      if (placed) return;

      cleanupPlacementWatchers();

      controls.button.style.position = 'fixed';
      controls.button.style.top = '8px';
      controls.button.style.right = '48px';
      controls.button.style.zIndex = '99999';

      controls.ring.style.position = 'fixed';
      controls.ring.style.top = '8px';
      controls.ring.style.right = '12px';
      controls.ring.style.zIndex = '99999';

      document.body.appendChild(controls.button);
      controls.button.insertAdjacentElement('afterend', controls.ring);

      finishPlacement();
    }, FALLBACK_DELAY_MS);
  }

  // On return to the tab: repaint the ring immediately (skipped while hidden)
  // and reload right away if the deadline passed during browser timer throttling.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !enabled || startTs === null) return;
    const elapsed = Date.now() - startTs;
    remainingMs = Math.max(0, intervalMs - elapsed);
    if (remainingMs <= 0) {
      stopCountdown();
      location.reload();
      return;
    }
    setRingProgress(1 - (remainingMs / intervalMs));
  });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    placeUI();
  } else {
    document.addEventListener('DOMContentLoaded', placeUI, { once: true });
  }
})();