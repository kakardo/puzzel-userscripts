// @file_name = YouTube_Playlist_Menu.user.js
// @author = Kardo Rostam
// @version = 2.7_2026-11-13
// @created = 2026-11-05 11:53

// ==UserScript==
// @name         YouTube Playlist Menu
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.7_2026-11-13
// @description  Makes YouTube's "Save to..." playlist menu usable with many playlists. Compact rows (no thumbnail or Private/Public line), so about three times as many playlists fit; a filter box at the top that shows only the playlists whose name contains what you type (Enter toggles the first one shown, Escape clears); and a star on every playlist: starred favourites stay at the top. A click on a playlist saves or removes the video without reloading the menu: a saved playlist is shown boxed in like a pressed button (YouTube's bookmark icons are hidden, the star sits before the name), and the menu stays open without reloading. While YouTube is still saving, the row shows a small spinner; the box only appears or goes once YouTube has confirmed. Closing the tab while saving asks first. The menu reaches from the top of the window to the bottom, so many more playlists show at once, and it stays open after you save to a playlist (YouTube closes it after every toggle; it is kept on screen and reloaded in place once the save is done, so the new tick shows without a blink; should it close anyway, it is opened again once YouTube has finished saving, keeping the filter and scroll position), so a video can go into several playlists in one go. The playlists are shown in two columns, with a space and a line after every three rows to keep a long list easy to scan. The label at the start of a playlist name (the part before " - ", such as "GAME" in "GAME - Chess") gets its own colour, the same for every playlist with that label. Favourites are kept in Tampermonkey's own storage. Only YouTube's own toggle is used to save, so saving works exactly as before. A Save button with text sits right after Share under the video, also when YouTube has hidden its own Save button for lack of room; it opens the same menu. YouTube's own Save icon is hidden, so there is only one. Event-driven: one MutationObserver on YouTube's popup container (where the menu lives), no polling.
// @author       Kardo Rostam
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
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
  const OWN_TOGGLE = true;         // our own saved box and instant save/remove (false = YouTube's icons)
  const SAVED_COLOUR = '#3ea6ff';  // box around a playlist the video is in
  const COLUMNS = 2;               // playlists side by side (1 = YouTube's single list)
  const COLUMN_WIDTH_PX = 280;     // width of each column
  const GROUP_ROWS = 3;            // a space after this many rows (0 = none)
  const GROUP_GAP_PX = 16;         // size of that space
  const LABEL_COLOURS = true;      // colour the label before " - " in each name
  const LABEL_HUES = {};           // fixed hues (0-359) per label, e.g. { GAME: 120 }; others are spread evenly
  const GROUP_LINE = 'rgba(170, 170, 170, .55)';  // line in the middle of the space ('' = none)
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
  // The styles match the playlist menu by its content, not by a class the
  // script adds: they apply from the very first frame, before the script
  // has even seen the menu, so YouTube's own layout never shows.
  const SHEET = 'yt-sheet-view-model:has(toggleable-list-item-view-model)';
  const FILTER_CLASS = 'kk-ytpl-filter';
  const STAR_CLASS = 'kk-ytpl-star';
  const GAP_CLASS = 'kk-ytpl-gap';
  const LABEL_CLASS = 'kk-ytpl-label';
  const SAVED_CLASS = 'kk-ytpl-saved';
  const BUSY_CLASS = 'kk-ytpl-busy';
  const FAILED_CLASS = 'kk-ytpl-failed';
  const EDIT_URL = '/youtubei/v1/browse/edit_playlist?prettyPrint=false';
  const LABEL_SEPARATOR = ' - ';
  const LABEL_MAX_LENGTH = 24;     // longer first parts are a name, not a label
  const SAVE_CLASS = 'kk-ytpl-save';
  const SAVE_LABEL = /^(spara i spellista|save to playlist|spara|save)$/i;
  const SAVE_ITEM = /^(spara|save)\b/i;
  const QUIET_CLASS = 'kk-ytpl-quiet';
  const QUIET_MAX_MS = 3000;       // give up on the three dots route after this
  const FAVOURITES_KEY = 'ytPlaylistFavourites';
  const SCAN_DELAY_MS = 80;
  const BOOT_TRIES = 40;
  const BOOT_INTERVAL_MS = 500;
  const REOPEN_WINDOW_MS = 1500;   // a close this soon after a toggle is YouTube's
  const KEEP_OPEN_MS = 1000;       // a close this soon after a toggle is YouTube's own
  const HOLD_MAX_MS = 4000;        // the menu is kept on screen this long at most
  const SAVE_WAIT_MAX_MS = 3000;   // reopen after this even if the save is not seen
  const HOLD_CLASS = 'kk-ytpl-hold';
  const SCROLL_WAIT_MS = 2000;     // how long the scroll position waits for the rows

  const style = document.createElement('style');
  style.textContent = [
    // The list becomes a flex column, so favourites can be put first with
    // CSS order without moving YouTube's own elements.
    // In columns it becomes a grid instead; CSS order works the same there.
    COLUMNS > 1
      ? SHEET + ' yt-list-view-model { display: grid !important; grid-template-columns: repeat(' + COLUMNS + ', minmax(0, 1fr)) !important; column-gap: 4px; align-content: start; }'
      : SHEET + ' yt-list-view-model { display: flex !important; flex-direction: column !important; }',
    // Wider menu for the columns; the sheet's own width limits are lifted.
    COLUMNS > 1 ? [
      'tp-yt-iron-dropdown:has(' + ROW + ') {',
      '  width: ' + (COLUMNS * COLUMN_WIDTH_PX + 24) + 'px !important; max-width: calc(100vw - ' + (EDGE_PX * 2) + 'px) !important;',
      '}',
      'tp-yt-iron-dropdown:has(' + ROW + ') #contentWrapper,',
      SHEET + ',',
      SHEET + ' yt-contextual-sheet-layout,',
      SHEET + ' .ytContextualSheetLayoutContentContainer { width: 100% !important; max-width: none !important; }',
      SHEET + ' ' + ROW + ' { min-width: 0; }'
    ].join('\n') : '',
    SHEET + ' ' + ROW + '.' + GAP_CLASS + ' { margin-bottom: ' + GROUP_GAP_PX + 'px !important; }',
    // Label colours: darker on the light theme, lighter on the dark one.
    '.' + LABEL_CLASS + ' { color: hsl(var(--kk-hue) 70% 36%); font-weight: 600; }',
    'html[dark] .' + LABEL_CLASS + ' { color: hsl(var(--kk-hue) 80% 68%); }',
    // The line runs across both columns (it reaches over the column gap).
    GROUP_LINE ? SHEET + ' ' + ROW + '.' + GAP_CLASS + '::after { content: ""; position: absolute; left: -2px; right: -2px; height: 2px; border-radius: 1px; background: ' + GROUP_LINE + '; bottom: ' + (-Math.round(GROUP_GAP_PX / 2) - 1) + 'px; pointer-events: none; }' : '',
    SHEET + ' ' + ROW + ' { position: relative; }',
    // Full height: the dropdown is pinned from top to bottom (its inline
    // top and size are YouTube's, so !important) and only the list scrolls.
    FULL_HEIGHT ? [
      'tp-yt-iron-dropdown:has(' + ROW + ') {',
      '  top: ' + EDGE_PX + 'px !important; bottom: ' + EDGE_PX + 'px !important;',
      '  height: calc(100vh - ' + (EDGE_PX * 2) + 'px) !important; max-height: calc(100vh - ' + (EDGE_PX * 2) + 'px) !important;',
      '}',
      'tp-yt-iron-dropdown:has(' + ROW + ') #contentWrapper,',
      SHEET + ',',
      SHEET + ' yt-contextual-sheet-layout {',
      '  height: 100% !important; max-height: none !important; display: flex !important; flex-direction: column !important;',
      '}',
      SHEET + ' .ytContextualSheetLayoutContentContainer {',
      '  flex: 1 1 auto !important; min-height: 0 !important; max-height: none !important; overflow-y: auto !important;',
      '}'
    ].join('\n') : '',
    COMPACT ? [
      SHEET + ' .ytListItemViewModelLeading,',
      SHEET + ' .ytListItemViewModelSubtitleContainer { display: none !important; }',
      SHEET + ' .ytListItemViewModelContainer { min-height: 0 !important; padding-top: 3px !important; padding-bottom: 3px !important; }'
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
    // Own toggle: star before the name, YouTube's bookmark icons hidden,
    // a saved playlist boxed in like a pressed button.
    OWN_TOGGLE ? [
      SHEET + ' .ytListItemViewModelContainer { padding-left: 36px !important; }',
      SHEET + ' .' + STAR_CLASS + ' { left: 8px; right: auto; }',
      SHEET + ' ' + ROW + ' svg, ' + SHEET + ' ' + ROW + ' yt-icon, ' + SHEET + ' ' + ROW + ' yt-icon-shape { display: none !important; }',
      SHEET + ' ' + ROW + ' { border-radius: 10px; transition: box-shadow .12s, background-color .12s; }',
      SHEET + ' ' + ROW + '.' + SAVED_CLASS + ' { box-shadow: inset 0 0 0 2px ' + SAVED_COLOUR + '; background-color: color-mix(in srgb, ' + SAVED_COLOUR + ' 16%, transparent); }',
      // Still saving: a spinner at the right end of the row. The box itself
      // only changes once YouTube has confirmed.
      SHEET + ' ' + ROW + '.' + BUSY_CLASS + '::before {',
      '  content: ""; position: absolute; right: 12px; top: 50%; width: 14px; height: 14px; margin-top: -9px; z-index: 2;',
      '  border: 2px solid ' + SAVED_COLOUR + '; border-right-color: transparent; border-radius: 50%;',
      '  animation: kk-ytpl-spin .7s linear infinite; pointer-events: none;',
      '}',
      '@keyframes kk-ytpl-spin { to { transform: rotate(360deg); } }',
      SHEET + ' ' + ROW + '.' + FAILED_CLASS + ' { box-shadow: inset 0 0 0 2px #e53935; }'
    ].join('\n') : '',
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
    // Kept on screen while YouTube closes and reloads the menu after a
    // save; not clickable until the fresh rows are in.
    'tp-yt-iron-dropdown.' + HOLD_CLASS + ' { display: block !important; opacity: 1 !important; visibility: visible !important; pointer-events: none !important; }',
    // While the Save button goes through the three dots menu, that menu is
    // opened invisibly, so only the playlist menu is seen. Every dropdown
    // without a sheet counts: on the first press after loading the page the
    // menu is shown empty before its entries are added.
    'html.' + QUIET_CLASS + ' ytd-popup-container tp-yt-iron-dropdown:not(:has(yt-sheet-view-model)) { opacity: 0 !important; pointer-events: none !important; }',
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

  // LABELS
  // The first part of a name, before " - ", in its own colour. Each label
  // found in the menu gets a hue of its own: spread evenly around the
  // colour wheel in A to Z order, so no two labels share a colour.
  function labelOf(name) {
    const at = name.indexOf(LABEL_SEPARATOR);
    if (at <= 0) return '';
    const label = name.slice(0, at).trim();
    return label.length <= LABEL_MAX_LENGTH ? label : '';
  }

  function labelHues(sheet) {
    const labels = Array.from(new Set(Array.from(sheet.querySelectorAll(ROW))
      .map((row) => labelOf(rowName(row)).toUpperCase()).filter(Boolean)))
      .filter((label) => LABEL_HUES[label] === undefined)
      .sort();
    const hues = {};
    labels.forEach((label, i) => { hues[label] = Math.round(i * 360 / labels.length); });
    Object.keys(LABEL_HUES).forEach((label) => { hues[label.toUpperCase()] = LABEL_HUES[label]; });
    return hues;
  }

  // The label's text is moved into a span of its own inside YouTube's
  // title; the name as a whole reads the same, so filtering and
  // favourites are unaffected. Only done when it is not already in place.
  function colourLabel(row, hues) {
    const title = row.querySelector(TITLE);
    if (!title) return;
    const label = labelOf(rowName(row));
    const current = title.querySelector('.' + LABEL_CLASS);
    if (!label) {
      if (current) current.replaceWith(document.createTextNode(current.textContent));
      return;
    }
    const hue = String(hues[label.toUpperCase()]);
    if (current && current.textContent === label) {
      if (current.style.getPropertyValue('--kk-hue') !== hue) current.style.setProperty('--kk-hue', hue);
      return;
    }
    if (current) current.replaceWith(document.createTextNode(current.textContent));
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.nodeValue.indexOf(label);
      if (at === -1) continue;
      const rest = node.splitText(at);
      rest.splitText(label.length);
      const span = document.createElement('span');
      span.className = LABEL_CLASS;
      span.style.setProperty('--kk-hue', hue);
      rest.replaceWith(span);
      span.appendChild(rest);
      return;
    }
  }

  // ROWS: star, order and filter. Only written when something differs.
  function decorateRows(sheet) {
    const hues = LABEL_COLOURS ? labelHues(sheet) : null;
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
      if (hues) colourLabel(row, hues);
      if (OWN_TOGGLE) {
        const saved = isSaved(row);
        if (row.classList.contains(SAVED_CLASS) !== saved) row.classList.toggle(SAVED_CLASS, saved);
      }
    });
    markGroups(sheet);
  }

  // A space under every GROUP_ROWS-th line of the menu, counted over the
  // rows as shown (favourites first, filtered rows left out).
  function markGroups(sheet) {
    const cols = Math.max(1, COLUMNS);
    shownRows(sheet).forEach((row, i) => {
      const line = Math.floor(i / cols);
      row.classList.toggle(GAP_CLASS, GROUP_ROWS > 0 && line % GROUP_ROWS === GROUP_ROWS - 1);
    });
  }

  function shownRows(sheet) {
    const rows = Array.from(sheet.querySelectorAll(ROW)).filter((row) => row.style.display !== 'none');
    rows.sort((a, b) => (Number(a.style.order) || 0) - (Number(b.style.order) || 0));
    return rows;
  }

  function firstShownRow(sheet) {
    return shownRows(sheet)[0] || null;
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

  // SAVES IN PROGRESS
  // YouTube closes the menu as soon as a playlist is toggled, before the
  // save itself is done. Opened again at once, the menu was loaded with
  // the old state (the video not shown as saved). YouTube's save requests
  // are counted here, so the menu is only opened again once they are done.
  const SAVE_URL = /\/youtubei\/v1\/browse\/edit_playlist/;
  let savesRunning = 0;
  let lastSaveDone = 0;

  // The page itself (outside the script's sandbox), where YouTube lives.
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let pageFetch = null;

  function toPageObject(obj) {
    return typeof cloneInto === 'function' ? cloneInto(obj, page) : obj;
  }

  // OWN TOGGLE
  // YouTube only shows a new tick after reloading the whole menu, which is
  // slow. Instead the script keeps the saved state itself, shows it as a
  // box around the playlist and sends the same save or remove request
  // YouTube would, without reloading the menu. The request is taken from
  // the row itself: each row carries both of YouTube's versions, "not
  // saved" with the add action and "saved" with the remove action. The
  // box changes once YouTube has confirmed; until then a spinner shows. The
  // sign-in headers are copied from YouTube's own requests (opening the
  // menu makes one). Without them, or without a row's data, the click is
  // left to YouTube as before. A failed request leaves the state as it
  // was and flashes the row red.
  let ytHeaders = null;
  const overrides = new Map();     // videoId|playlistId -> saved, this page only

  function readHeaders(h) {
    const out = {};
    if (!h) return out;
    if (typeof h.forEach === 'function' && typeof h.get === 'function') h.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
    else Object.keys(h).forEach((k) => { out[k.toLowerCase()] = String(h[k]); });
    return out;
  }

  function keepHeaders(init, input) {
    try {
      let h = readHeaders(init && init.headers);
      if (!h.authorization && input && typeof input === 'object' && input.headers) h = readHeaders(input.headers);
      if (!h.authorization) return;
      ['content-length', 'content-encoding', 'content-type', 'host', 'cookie'].forEach((k) => { delete h[k]; });
      ytHeaders = h;
    } catch (_) { /* unreadable: the next request may do */ }
  }

  function rowData(row) {
    const target = row.wrappedJSObject || row;
    return target.data || null;
  }

  // The playlist edit (playlist id and actions) behind one of the row's
  // two versions, found wherever YouTube nests it.
  function editFor(row, saved) {
    const data = rowData(row);
    if (!data) return null;
    let item;
    try { item = JSON.parse(page.JSON.stringify(saved ? data.toggledListItem : data.defaultListItem) || 'null'); } catch (_) { return null; }
    let found = null;
    (function walk(node, depth) {
      if (found || !node || typeof node !== 'object' || depth > 12) return;
      if (node.playlistEditEndpoint && node.playlistEditEndpoint.playlistId) {
        found = node.playlistEditEndpoint;
        return;
      }
      Object.keys(node).forEach((k) => walk(node[k], depth + 1));
    })(item, 0);
    return found && Array.isArray(found.actions) ? { playlistId: found.playlistId, actions: found.actions } : null;
  }

  function overrideKey(row) {
    const video = new URLSearchParams(location.search).get('v') || '';
    const edit = editFor(row, false) || editFor(row, true);
    return edit ? video + '|' + edit.playlistId : '';
  }

  // Read once per freshly loaded row: YouTube's own state, unless a save
  // or remove was made from here since (the server agrees by then).
  function isSaved(row) {
    if (row.dataset.kkSaved === undefined) {
      const key = overrideKey(row);
      const data = rowData(row);
      const saved = key && overrides.has(key) ? overrides.get(key) : !!(data && data.initialState && data.initialState.isToggled);
      row.dataset.kkSaved = saved ? '1' : '0';
    }
    return row.dataset.kkSaved === '1';
  }

  function setSaved(row, saved) {
    row.dataset.kkSaved = saved ? '1' : '0';
    row.classList.toggle(SAVED_CLASS, saved);
    const key = overrideKey(row);
    if (key) overrides.set(key, saved);
  }

  function sendEdit(edit) {
    const ytcfg = page.ytcfg;
    const context = ytcfg && typeof ytcfg.get === 'function' ? ytcfg.get('INNERTUBE_CONTEXT') : null;
    if (!context) return Promise.resolve(false);
    const body = '{"context":' + page.JSON.stringify(context) + ',"playlistId":' + JSON.stringify(edit.playlistId) +
      ',"actions":' + JSON.stringify(edit.actions) + '}';
    const headers = Object.assign({}, ytHeaders, { 'content-type': 'application/json' });
    // Started inside the chain, so even an error at the start ends as a
    // failure (spinner gone, state put back) instead of hanging.
    return Promise.resolve()
      .then(() => pageFetch.call(page, EDIT_URL, toPageObject({ method: 'POST', credentials: 'include', headers: headers, body: body })))
      .then((res) => res.json())
      .then((json) => !!json && json.status === 'STATUS_SUCCEEDED', () => false);
  }

  // Closing the tab while a save is still on its way could lose it: the
  // browser asks first, only then.
  let busyCount = 0;
  window.addEventListener('beforeunload', (event) => {
    if (busyCount <= 0) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Seen before anything of YouTube's (window, capture phase), so YouTube
  // neither saves nor closes the menu for a click handled here.
  window.addEventListener('click', (event) => {
    if (!OWN_TOGGLE || !isToggle(event.target) || !ytHeaders || !pageFetch) return;
    const row = event.target.closest(ROW);
    if (!row) return;
    const saved = isSaved(row);
    const edit = editFor(row, saved);
    if (!edit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    toggledAt = 0;
    if (row.classList.contains(BUSY_CLASS)) return;
    row.classList.add(BUSY_CLASS);
    busyCount += 1;
    sendEdit(edit).then((ok) => {
      busyCount -= 1;
      row.classList.remove(BUSY_CLASS);
      if (ok) {
        setSaved(row, !saved);
        return;
      }
      row.classList.add(FAILED_CLASS);
      setTimeout(() => row.classList.remove(FAILED_CLASS), 1500);
    });
  }, true);

  (function watchSaves() {
    const original = page.fetch;
    if (typeof original !== 'function') return;
    pageFetch = original;
    const wrapped = function (input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) { /* unreadable */ }
      if (/\/youtubei\/v1\//.test(url)) keepHeaders(init, input);
      const result = original.apply(this, arguments);
      if (SAVE_URL.test(url)) {
        savesRunning += 1;
        const end = () => {
          savesRunning = Math.max(0, savesRunning - 1);
          lastSaveDone = Date.now();
        };
        result.then(end, end);
      }
      return result;
    };
    try {
      // Firefox keeps the page and the script apart; exportFunction hands
      // the wrapper over to the page.
      page.fetch = toPage(wrapped, page);
    } catch (_) { /* the page refused: the time limit below still applies */ }
  })();

  // Done once no save is running and one has finished after the toggle,
  // or after SAVE_WAIT_MAX_MS at most. Only runs after a toggle.
  function afterSave(since, then) {
    const until = Date.now() + SAVE_WAIT_MAX_MS;
    (function check() {
      const saved = savesRunning === 0 && lastSaveDone >= since;
      if (saved || Date.now() > until) then(saved);
      else setTimeout(check, 50);
    })();
  }

  // KEEPING THE MENU ON SCREEN
  // After a toggle YouTube closes the menu by calling close() on its
  // dropdown, and only a fresh menu shows the new tick (a row cannot be
  // updated in place). So that close() is let through, but the dropdown
  // is held on screen first (HOLD_CLASS): the menu does not blink while
  // it is opened again and reloaded, and the new rows replace the old in
  // place. A click outside or Escape uses cancel(), not close(), so those
  // close it as usual.
  function toPage(fn, scope) {
    return typeof exportFunction === 'function' ? exportFunction(fn, scope) : fn;
  }

  let holdTimer = 0;

  function hold(dropdown) {
    dropdown.classList.add(HOLD_CLASS);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => release(dropdown), HOLD_MAX_MS);
  }

  function release(dropdown) {
    clearTimeout(holdTimer);
    if (dropdown && dropdown.classList.contains(HOLD_CLASS)) dropdown.classList.remove(HOLD_CLASS);
  }

  function guardClose(dropdown) {
    if (!STAY_OPEN || dropdown.dataset.kkGuard) return;
    const target = dropdown.wrappedJSObject || dropdown;
    const original = target.close;
    if (typeof original !== 'function') return;
    try {
      target.close = toPage(function () {
        if (Date.now() - toggledAt < KEEP_OPEN_MS) hold(dropdown);
        return original.apply(this, arguments);
      }, target);
      dropdown.dataset.kkGuard = '1';
    } catch (_) { /* refused: the reopen below still covers it */ }
  }

  // The scroll position is read while the menu is open: once YouTube has
  // hidden it, the list reports 0, which sent the reopened menu to the top.
  let lastScroll = 0;

  function watchScroll(sheet) {
    const scroller = sheet.querySelector('.ytContextualSheetLayoutContentContainer');
    if (!scroller || scroller.dataset.kkScroll) return;
    scroller.dataset.kkScroll = '1';
    scroller.addEventListener('scroll', () => { lastScroll = scroller.scrollTop; }, { passive: true });
    // Your own scrolling ends the putting back at once.
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((type) => {
      scroller.addEventListener(type, () => { pendingScroll = null; }, { passive: true });
    });
  }

  function reopen(sheet, since) {
    const filter = sheet.querySelector('.' + FILTER_CLASS);
    restore = { filter: filter ? filter.value : '', scroll: lastScroll };
    pendingScroll = lastScroll ? { value: lastScroll, until: Date.now() + SAVE_WAIT_MAX_MS + SCROLL_WAIT_MS } : null;
    afterSave(since, () => {
      const button = trigger && trigger.isConnected ? trigger : saveButton();
      if (button) button.click();
      else restore = null;
    });
  }

  // Put back once the rows are there to scroll to (they arrive a moment
  // after the menu opens), or after SCROLL_WAIT_MS at most.
  let pendingScroll = null;

  function applyScroll(sheet) {
    if (!pendingScroll) return;
    // Not while the old menu is only held on screen: the reloaded rows
    // would start at the top again.
    const dropdown = sheet.closest('tp-yt-iron-dropdown');
    if (!dropdown || dropdown.style.display === 'none') return;
    const scroller = sheet.querySelector('.ytContextualSheetLayoutContentContainer');
    if (!scroller) return;
    // Kept up until the time is out: YouTube may swap in the fresh rows
    // after the menu is open again, which starts the list at the top.
    if (Date.now() > pendingScroll.until) {
      pendingScroll = null;
      return;
    }
    if (Math.abs(scroller.scrollTop - pendingScroll.value) > 1) scroller.scrollTop = pendingScroll.value;
  }

  function scan() {
    const sheet = playlistSheet();
    if (!sheet) {
      releaseDropdown();
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
      // A freshly loaded menu: every row's state is read again.
      sheet.querySelectorAll(ROW).forEach((row) => row.removeAttribute('data-kk-saved'));
      if (!back) {
        lastScroll = 0;
        pendingScroll = null;
      }
    }
    // Closed by YouTube right after a toggle: open it again.
    if (STAY_OPEN && !open && wasOpen && Date.now() - toggledAt < REOPEN_WINDOW_MS) {
      const since = toggledAt;
      toggledAt = 0;
      reopen(sheet, since);
    }
    wasOpen = open;
    decorateRows(sheet);
    if (open) {
      guardClose(dropdown);
      watchScroll(sheet);
      applyScroll(sheet);
      if (sheet.querySelector(ROW)) release(dropdown);
    }
    if (open && COLUMNS > 1) keepInside(dropdown);
    else releaseDropdown();
  }

  // YouTube places the menu for its own, narrower width; the wider menu
  // is moved left (by its margin, which YouTube leaves alone) when it
  // would reach past the right edge of the window.
  let shifted = null;

  // YouTube reuses the dropdown for other menus: the shift goes once the
  // playlist menu is closed.
  function releaseDropdown() {
    if (shifted && shifted.style.marginLeft) shifted.style.marginLeft = '';
    shifted = null;
  }

  function keepInside(dropdown) {
    if (shifted && shifted !== dropdown) releaseDropdown();
    shifted = dropdown;
    const current = parseFloat(dropdown.style.marginLeft) || 0;
    const box = dropdown.getBoundingClientRect();
    const left = box.left - current;
    const right = box.right - current;
    let shift = Math.min(0, window.innerWidth - EDGE_PX - right);
    shift = Math.max(shift, EDGE_PX - left);
    const next = shift ? shift + 'px' : '';
    if (dropdown.style.marginLeft !== next) dropdown.style.marginLeft = next;
  }

  // SAVE BUTTON
  // Pressing it presses YouTube's own Save button, which is still on the
  // page when YouTube hides it for lack of room. Without it, the three
  // dots menu is opened and its Save entry chosen.
  function nativeSave() {
    return Array.from(document.querySelectorAll('ytd-watch-metadata #actions button[aria-label]'))
      .find((b) => !b.classList.contains(SAVE_CLASS) && SAVE_LABEL.test((b.getAttribute('aria-label') || '').trim())) || null;
  }

  // The three dots route: its Save entry is pressed the moment YouTube
  // puts it in the menu (watched, not polled), with the menu invisible.
  function saveThroughMenu() {
    const more = Array.from(document.querySelectorAll('ytd-watch-metadata #actions ytd-menu-renderer button'))
      .filter((b) => !b.classList.contains(SAVE_CLASS)).pop();
    const container = document.querySelector('ytd-popup-container');
    if (!more || !container) return;
    const root = document.documentElement;
    let observer = null;
    let timer = 0;
    let pressed = false;
    const done = () => {
      if (observer) observer.disconnect();
      clearTimeout(timer);
      root.classList.remove(QUIET_CLASS);
    };
    // After the press, invisible until the playlist menu is there (the
    // three dots menu is closed by then), or QUIET_MAX_MS at most.
    const step = () => {
      if (pressed) {
        const sheet = playlistSheet();
        if (sheet && sheet.getClientRects().length) done();
        return;
      }
      const item = Array.from(container.querySelectorAll('[role="menuitem"]'))
        .find((e) => e.getClientRects().length && SAVE_ITEM.test(e.textContent.trim()));
      if (!item) return;
      pressed = true;
      item.click();
    };
    root.classList.add(QUIET_CLASS);
    observer = new MutationObserver(step);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    timer = setTimeout(done, QUIET_MAX_MS);
    more.click();
  }

  function openSave() {
    const native = nativeSave();
    if (native) native.click();
    else saveThroughMenu();
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
    // The scroll position is put back at once (before the page is drawn),
    // so a reloaded menu does not show its top first.
    // A menu with rows not dressed yet (no star) is handled at once, before
    // the page is drawn; everything else waits for the short delay.
    new MutationObserver(() => {
      const sheet = playlistSheet();
      if (sheet && sheet.querySelector(ROW + ':not(:has(> .' + STAR_CLASS + '))')) {
        clearTimeout(timer);
        scan();
        return;
      }
      if (pendingScroll && sheet) applyScroll(sheet);
      schedule();
    }).observe(container, {
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
