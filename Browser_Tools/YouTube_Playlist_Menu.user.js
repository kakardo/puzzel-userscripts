// @file_name = YouTube_Playlist_Menu.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-11-05
// @created = 2026-11-05 11:53

// ==UserScript==
// @name         YouTube Playlist Menu
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-11-05
// @description  Makes YouTube's "Save to..." playlist menu usable with many playlists. Compact rows (no thumbnail or Private/Public line), so about three times as many playlists fit; a filter box at the top that shows only the playlists whose name contains what you type (Enter toggles the first one shown, Escape clears); and a star on every playlist: starred favourites stay at the top. Favourites are kept in Tampermonkey's own storage. Only YouTube's own toggle is used to save, so saving works exactly as before. Event-driven: one MutationObserver on YouTube's popup container (where the menu lives), no polling.
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
  const STAR_COLOUR = '#ffcc00';
  const FILTER_PLACEHOLDER = 'Filter playlists';

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
  const FAVOURITES_KEY = 'ytPlaylistFavourites';
  const SCAN_DELAY_MS = 80;
  const BOOT_TRIES = 40;
  const BOOT_INTERVAL_MS = 500;

  const style = document.createElement('style');
  style.textContent = [
    // The list becomes a flex column, so favourites can be put first with
    // CSS order without moving YouTube's own elements.
    '.' + SHEET_CLASS + ' yt-list-view-model { display: flex !important; flex-direction: column !important; }',
    '.' + SHEET_CLASS + ' ' + ROW + ' { position: relative; }',
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
    '.' + STAR_CLASS + '.kk-on { color: ' + STAR_COLOUR + '; }'
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
          if (toggle) toggle.click();
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
    // Freshly opened: empty filter, cursor in it.
    if (open && !wasOpen && filter) {
      if (filter.value) filter.value = '';
      filter.focus({ preventScroll: true });
    }
    wasOpen = open;
    decorateRows(sheet);
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
