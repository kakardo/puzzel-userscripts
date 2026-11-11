// @file_name = YouTube_Playlist_Menu.user.js
// @author = Kardo Rostam
// @version = 1.4_2026-11-11
// @created = 2026-11-05 11:53

// ==UserScript==
// @name         YouTube Playlist Menu
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.4_2026-11-11
// @description  Makes YouTube's "Save to..." playlist menu usable with many playlists. Compact rows (no thumbnail or Private/Public line), so about three times as many playlists fit; a filter box at the top that shows only the playlists whose name contains what you type (Enter toggles the first one shown, Escape clears); and a star on every playlist: starred favourites stay at the top. The menu reaches from the top of the window to the bottom, so many more playlists show at once, and it stays open after you save to a playlist (YouTube closes it after every toggle, so it is opened again at once with the same button, keeping the filter and scroll position), so a video can go into several playlists in one go. Favourites are kept in Tampermonkey's own storage. Only YouTube's own toggle is used to save, so saving works exactly as before. A Save button with text sits right after Share under the video, also when YouTube has hidden its own Save button for lack of room; it opens the same menu. YouTube's own Save icon is hidden, so there is only one. Event-driven: one MutationObserver on YouTube's popup container (where the menu lives), no polling.
// @author       Kardo Rostam
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/YouTube_Playlist_Menu.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/YouTube_Playlist_Menu.user.js
// ==/UserScript==

(() => {
  'use strict';

  // USER SETTINGS
  const COMPACT = true;            // hide thumbnails and the Private/Public line
  const FULL_HEIGHT = true;        // menu from the top of the window to the bottom
  const STAY_OPEN = true;          // open the menu again after saving to a playlist
  const EDGE_PX = 8;               // gap to the window edges in full height
  const STAR_COLOUR = '#ffcc00';
  const FILTER_PLACEHOLDER = 'Filter playlists';
  const SAVE_BUTTON = true;        // a Save button with text right after Share
  const HIDE_NATIVE_SAVE = true;  // hide YouTube's own Save icon (ours replaces it)
  const SAVE_TEXT = /^sv\b/i.test(document.documentElement.lang || '') ? 'Spara' : 'Save';

  // INTERNAL SETTINGS
  // From YouTube (2026 "sheet" menu): the menu is a yt-sheet-view-model in
  // ytd-popup-container; each playlist is a toggleable-list-item-view-model
  // inside a yt-list-view-model, with its name in .ytListItemViewModelTitle,
  // its toggle in button.ytListItemViewModelButtonOrAnchor (aria-pressed)
  // and the list scrolling in .ytContextualSheetLayoutContentContainer.
  const ROW = 'toggleable-list-item-view-model';
  const TITLE = '.ytListItemViewModelTitle';
  const TOGGLE = 'button.ytListItemViewModelButtonOrAnchor';
  const SHEET_CLASS = 'kk-ytpl';
  const FILTER_CLASS = 'kk-ytpl-filter';
  const STAR_CLASS = 'kk-ytpl-star';
  const SAVE_CLASS = 'kk-ytpl-save';
  const SAVE_LABEL = /^(spara i spellista|save to playlist|spara|save)$/i;
  const SAVE_ITEM = /^(spara|save)\b/i;
  const FAVOURITES_KEY = 'ytPlaylistFavourites';
  const SCAN_DELAY_MS = 80;
  const BOOT_TRIES = 40;
  const BOOT_INTERVAL_MS = 500;
  const REOPEN_WINDOW_MS = 1500;   // a close this soon after a toggle is YouTube's

  const style = document.createElement('style');
  style.textContent = [
    // The list becomes a flex column, so favourites can be put first with
    // CSS order without moving YouTube's own elements.
    '.' + SHEET_CLASS + ' yt-list-view-model { display: flex !important; flex-direction: column !important; }',
    '.' + SHEET_CLASS + ' ' + ROW + ' { position: relative; }',
    // Full height: the dropdown is pinned from top to bottom (its inline
    // top and size are YouTube's, so !important) and only the list scrolls.
    FULL_HEIGHT ? [
      'tp-yt-iron-dropdown:has(.' + SHEET_CLASS + ') {',
      '  top: ' + EDGE_PX + 'px !important; bottom: ' + EDGE_PX + 'px !important;',
      '  height: calc(100vh - ' + (EDGE_PX * 2) + 'px) !important; max-height: calc(100vh - ' + (EDGE_PX * 2) + 'px) !important;',
      '}',
      'tp-yt-iron-dropdown:has(.' + SHEET_CLASS + ') #contentWrapper,',
      '.' + SHEET_CLASS + ',',
      '.' + SHEET_CLASS + ' yt-contextual-sheet-layout {',
      '  height: 100% !important; max-height: none !important; display: flex !important; flex-direction: column !important;',
      '}',
      '.' + SHEET_CLASS + ' .ytContextualSheetLayoutContentContainer {',
      '  flex: 1 1 auto !important; min-height: 0 !important; max-height: none !important; overflow-y: auto !important;',
      '}'
    ].join('\n') : '',
    COMPACT ? [
      '.' + SHEET_CLASS + ' .ytListItemViewModelLeading,',
      '.' + SHEET_CLASS + ' .ytListItemViewModelSubtitleContainer { display: none !important; }',
      '.' + SHEET_CLASS + ' .ytListItemViewModelContainer { min-height: 0 !important; padding-top: 3px !important; padding-bottom: 3px !important; }'
    ].join('\n') : '',
    '.' + FILTER_CLASS + ' {',
    '  box-sizing: border-box; width: calc(100% - 24px); margin: 4px 12px 8px; padding: 7px 10px;',
    '  border: 1px solid rgba(255,255,255,.2); border-radius: 8px;',
    '  background: rgba(255,255,255,.08); color: inherit; font: inherit; font-size: 14px; outline: none;',
    '}',
    '.' + FILTER_CLASS + ':focus { border-color: rgba(255,255,255,.5); }',
    '.' + STAR_CLASS + ' {',
    '  position: absolute; top: 50%; right: 52px; transform: translateY(-50%); z-index: 2;',
    '  border: 0; background: none; padding: 2px 4px; cursor: pointer;',
    '  font-size: 17px; line-height: 1; color: rgba(255,255,255,.35);',
    '}',
    '.' + STAR_CLASS + ':hover { color: ' + STAR_COLOUR + '; }',
    '.' + STAR_CLASS + '.kk-on { color: ' + STAR_COLOUR + '; }',
    // Same look as YouTube's own pill buttons, in light and dark theme.
    '.' + SAVE_CLASS + ' {',
    '  display: inline-flex; align-items: center; gap: 6px; flex: none; height: 36px; margin-left: 8px; padding: 0 16px 0 12px;',
    '  border: 0; border-radius: 18px; cursor: pointer; white-space: nowrap;',
    '  background: var(--yt-spec-badge-chip-background, rgba(255,255,255,.1)); color: var(--yt-spec-text-primary, #f1f1f1);',
    '  font-family: Roboto, Arial, sans-serif; font-size: 14px; font-weight: 500; line-height: 36px;',
    '}',
    '.' + SAVE_CLASS + ':hover { background: var(--yt-spec-button-chip-background-hover, rgba(255,255,255,.2)); }',
    '.' + SAVE_CLASS + ' svg { width: 24px; height: 24px; fill: currentColor; }',
    // YouTube's own Save icon is squeezed to nothing instead of removed:
    // our button presses it, and the menu opens next to where it sits.
    HIDE_NATIVE_SAVE ? [
      'ytd-watch-metadata #actions yt-button-view-model:has(button[aria-label="Spara i spellista" i]),',
      'ytd-watch-metadata #actions yt-button-view-model:has(button[aria-label="Save to playlist" i]) {',
      '  width: 0 !important; min-width: 0 !important; margin: 0 !important; padding: 0 !important;',
      '  overflow: hidden !important; opacity: 0 !important; pointer-events: none !important;',
      '}'
    ].join('\n') : ''
  ].join('\n');
  (document.head || document.documentElement).appendChild(style);

  // FAVOURITES (playlist names, in Tampermonkey storage)
  function favourites() {
    try {
      const list = GM_getValue(FAVOURITES_KEY, []);
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function setFavourite(name, on) {
    const list = favourites().filter((item) => item !== name);
    if (on) list.push(name);
    try { GM_setValue(FAVOURITES_KEY, list); } catch (_) { /* storage blocked */ }
  }

  function rowName(row) {
    const title = row.querySelector(TITLE);
    return title ? title.textContent.trim() : '';
  }

  // ROWS: star, order and filter. Only written when something differs.
  function decorateRows(sheet) {
    const favs = favourites();
    const filter = sheet.querySelector('.' + FILTER_CLASS);
    const wanted = filter ? filter.value.trim().toLowerCase() : '';
    sheet.querySelectorAll(ROW).forEach((row) => {
      const name = rowName(row);
      const fav = favs.indexOf(name) !== -1;
      let star = row.querySelector(':scope > .' + STAR_CLASS);
      if (!star) {
        star = document.createElement('button');
        star.type = 'button';
        star.className = STAR_CLASS;
        // The star must never reach YouTube's toggle under it.
        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((type) => {
          star.addEventListener(type, (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (type !== 'click') return;
            const current = rowName(row);
            setFavourite(current, favourites().indexOf(current) === -1);
            decorateRows(sheet);
          });
        });
        row.appendChild(star);
      }
      const text = fav ? '★' : '☆';
      if (star.textContent !== text) star.textContent = text;
      star.classList.toggle('kk-on', fav);
      star.title = fav ? 'Remove from favourites' : 'Keep at the top as a favourite';
      const order = fav ? '-1' : '';
      if (row.style.order !== order) row.style.order = order;
      const display = !wanted || name.toLowerCase().indexOf(wanted) !== -1 ? '' : 'none';
      if (row.style.display !== display) row.style.display = display;
    });
  }

  function firstShownRow(sheet) {
    const rows = Array.from(sheet.querySelectorAll(ROW)).filter((row) => row.style.display !== 'none');
    rows.sort((a, b) => (Number(a.style.order) || 0) - (Number(b.style.order) || 0));
    return rows[0] || null;
  }

  function ensureFilter(sheet) {
    let filter = sheet.querySelector('.' + FILTER_CLASS);
    if (filter) return filter;
    const list = sheet.querySelector('yt-list-view-model');
    if (!list || !list.parentElement) return null;
    filter = document.createElement('input');
    filter.type = 'text';
    filter.className = FILTER_CLASS;
    filter.placeholder = FILTER_PLACEHOLDER;
    filter.autocomplete = 'off';
    filter.addEventListener('input', () => decorateRows(sheet));
    // Typing here must not reach YouTube's keyboard shortcuts (k, f, m ...).
    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      filter.addEventListener(type, (event) => {
        event.stopPropagation();
        if (type !== 'keydown') return;
        if (event.key === 'Escape' && filter.value) {
          event.preventDefault();
          filter.value = '';
          decorateRows(sheet);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          const row = firstShownRow(sheet);
          const toggle = row && row.querySelector(TOGGLE);
          if (toggle) {
            toggledAt = Date.now();
            toggle.click();
          }
        }
      });
    });
    list.parentElement.insertBefore(filter, list);
    return filter;
  }

  // The playlist menu is the sheet that holds playlist rows (YouTube uses
  // the same sheet for other menus).
  function playlistSheet() {
    const row = document.querySelector('ytd-popup-container yt-sheet-view-model ' + ROW);
    return row ? row.closest('yt-sheet-view-model') : null;
  }

  let wasOpen = false;

  // STAYING OPEN
  // The button that opened the menu is remembered (the last press outside
  // the menu). A toggle in the menu marks the time; when YouTube closes
  // the menu right after it, the same button is pressed again and the
  // filter text and scroll position are put back once it is open.
  let trigger = null;
  let toggledAt = 0;
  let restore = null;

  // A press anywhere on a playlist row is a toggle (YouTube's handler
  // covers the whole row, not only its inner button), except the star.
  function isToggle(target) {
    return !!(target.closest('.' + SHEET_CLASS + ' ' + ROW) && !target.closest('.' + STAR_CLASS));
  }

  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('ytd-popup-container')) {
      if (isToggle(event.target)) toggledAt = Date.now();
      return;
    }
    const button = event.target.closest('button, [role="button"], tp-yt-paper-item, ytd-menu-service-item-renderer');
    if (button) trigger = button;
  }, true);

  // Enter or Space on a focused playlist row toggles it too.
  document.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && isToggle(event.target)) toggledAt = Date.now();
  }, true);

  // The Save button under the video, for when the remembered one is gone
  // (it was an entry in a menu that has closed).
  function saveButton() {
    return Array.from(document.querySelectorAll('ytd-watch-metadata button[aria-label], #actions button[aria-label]'))
      .find((b) => /save|spara|playlist|spellista/i.test(b.getAttribute('aria-label') || '')) || null;
  }

  function reopen(sheet) {
    const filter = sheet.querySelector('.' + FILTER_CLASS);
    const scroller = sheet.querySelector('.ytContextualSheetLayoutContentContainer');
    restore = { filter: filter ? filter.value : '', scroll: scroller ? scroller.scrollTop : 0 };
    const button = trigger && trigger.isConnected ? trigger : saveButton();
    if (button) button.click();
    else restore = null;
  }

  function scan() {
    const sheet = playlistSheet();
    if (!sheet) {
      wasOpen = false;
      return;
    }
    if (!sheet.classList.contains(SHEET_CLASS)) sheet.classList.add(SHEET_CLASS);
    const filter = ensureFilter(sheet);
    const dropdown = sheet.closest('tp-yt-iron-dropdown');
    const open = !!(dropdown && dropdown.style.display !== 'none' && sheet.getClientRects().length);
    // Freshly opened: empty filter, cursor in it; opened again after a
    // toggle: the filter and scroll position as they were.
    if (open && !wasOpen && filter) {
      const back = restore;
      restore = null;
      filter.value = back ? back.filter : '';
      filter.focus({ preventScroll: true });
      if (back) {
        const scroller = sheet.querySelector('.ytContextualSheetLayoutContentContainer');
        if (scroller) requestAnimationFrame(() => { scroller.scrollTop = back.scroll; });
      }
    }
    // Closed by YouTube right after a toggle: open it again.
    if (STAY_OPEN && !open && wasOpen && Date.now() - toggledAt < REOPEN_WINDOW_MS) {
      toggledAt = 0;
      reopen(sheet);
    }
    wasOpen = open;
    decorateRows(sheet);
  }

  // SAVE BUTTON
  // Pressing it presses YouTube's own Save button, which is still on the
  // page when YouTube hides it for lack of room. Without it, the three
  // dots menu is opened and its Save entry chosen.
  function nativeSave() {
    return Array.from(document.querySelectorAll('ytd-watch-metadata #actions button[aria-label]'))
      .find((b) => !b.classList.contains(SAVE_CLASS) && SAVE_LABEL.test((b.getAttribute('aria-label') || '').trim())) || null;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function openSave() {
    const native = nativeSave();
    if (native) {
      native.click();
      return;
    }
    const more = Array.from(document.querySelectorAll('ytd-watch-metadata #actions ytd-menu-renderer button'))
      .filter((b) => !b.classList.contains(SAVE_CLASS)).pop();
    if (!more) return;
    more.click();
    // Only while the menu opens after a press: ten looks at most.
    for (let i = 0; i < 10; i += 1) {
      await wait(100);
      const item = Array.from(document.querySelectorAll('ytd-popup-container [role="menuitem"]'))
        .find((e) => e.getClientRects().length && SAVE_ITEM.test(e.textContent.trim()));
      if (item) {
        item.click();
        return;
      }
    }
  }

  // Built with DOM calls: YouTube blocks innerHTML (Trusted Types).
  function makeSaveButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = SAVE_CLASS;
    button.setAttribute('aria-label', SAVE_TEXT);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z');
    svg.appendChild(path);
    button.appendChild(svg);
    button.appendChild(document.createTextNode(SAVE_TEXT));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSave();
    });
    return button;
  }

  let saveRenderer = null;
  let saveObserver = null;

  // Right after the like and share buttons. YouTube redraws that row now
  // and then; the row is watched (its own children only) to put it back.
  function placeSaveButton() {
    const renderer = document.querySelector('ytd-watch-metadata #actions ytd-menu-renderer');
    const top = renderer && renderer.querySelector(':scope > #top-level-buttons-computed');
    if (!top) return;
    let button = renderer.querySelector(':scope > .' + SAVE_CLASS);
    if (!button || button.previousElementSibling !== top) {
      button = button || makeSaveButton();
      top.insertAdjacentElement('afterend', button);
    }
    if (renderer !== saveRenderer) {
      if (saveObserver) saveObserver.disconnect();
      saveRenderer = renderer;
      saveObserver = new MutationObserver(() => requestAnimationFrame(placeSaveButton));
      saveObserver.observe(renderer, { childList: true });
    }
  }

  // A new video is drawn a moment after navigating; a few looks cover it.
  function placeSaveButtonSoon() {
    [0, 500, 1500, 3000].forEach((ms) => setTimeout(placeSaveButton, ms));
  }

  if (SAVE_BUTTON) {
    document.addEventListener('yt-navigate-finish', placeSaveButtonSoon);
    placeSaveButtonSoon();
  }

  let timer = 0;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, SCAN_DELAY_MS);
  }

  // BOOT
  // Only YouTube's popup container is watched: the menu is built there and
  // shown or hidden through its dropdown's style.
  function start(container) {
    new MutationObserver(schedule).observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style']
    });
    schedule();
  }

  let tries = 0;
  (function boot() {
    const container = document.querySelector('ytd-popup-container');
    if (container) {
      start(container);
      return;
    }
    tries += 1;
    if (tries < BOOT_TRIES) setTimeout(boot, BOOT_INTERVAL_MS);
  })();
})();
