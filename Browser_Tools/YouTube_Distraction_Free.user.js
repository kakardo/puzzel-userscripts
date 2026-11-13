// @file_name = YouTube_Distraction_Free.user.js
// @author = Kardo Rostam
// @version = 1.3_2026-11-13
// @created = 2026-11-13 22:05
// @note = Replaces the "DF Tube (Distraction Free for YouTube)" and "Hide shorts for YouTube" browser extensions, with their main options as the settings at the top. That extension started up about twelve times on each page load; this script adds its rules once.
// @note = Measured on 2026-11-13 (load times, three reloads each): no real difference in page load between the extension and this script. About 1.4 s goes to YouTube's server answering and about 3 s to the browser working through YouTube's page code and every extension hooked into it, and neither of the two changes that. Kept for being simpler, adjustable and free of flashes.
// @note = run-at document-start on purpose: the hiding rules are in place before YouTube draws anything, so hidden parts never flash up while the page loads.

// ==UserScript==
// @name         YouTube Distraction Free
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.3_2026-11-13
// @description  Hides the distracting parts of YouTube, each one switched on or off in the settings at the top: the recommended videos next to (or under) the video, the suggested videos at the end of a video, the Trending entry in the menu, merchandise shelves and Shorts (shelves, single Shorts in lists, the channel tab, notifications and the menu entry) and YouTube Playables (games). Shows four videos per row on the home, subscriptions and channel pages (a setting; YouTube's own choice depends on the window width). Optionally it also hides the notification bell, the home feed, the subscriptions list in the menu, live chat, the playlist panel and comments. Also turns off "autoplay next video". Almost everything is plain CSS, added before YouTube draws the page, so nothing flashes up; the only code that runs is a short check of the autoplay switch after a video page loads. No observers, no polling.
// @author       Kardo Rostam
// @match        https://www.youtube.com/*
// @run-at       document-start
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/YouTube_Distraction_Free.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/YouTube_Distraction_Free.user.js
// ==/UserScript==

(() => {
  'use strict';

  // USER SETTINGS (true = hidden / turned off)
  const HIDE_SIDEBAR = true;          // recommended videos next to or under the video
  const HIDE_END_VIDEOS = true;       // suggested videos and cards at the end of a video
  const HIDE_TRENDING = true;         // Trending entry in the menu
  const HIDE_MERCH = true;            // merchandise and ticket shelves under a video
  const DISABLE_AUTOPLAY = true;      // "autoplay next video" switched off
  const HIDE_SHORTS = true;           // Shorts in home, subscriptions, search, channels, next to videos, notifications
  const HIDE_SHORTS_TAB = true;       // Shorts entry in the menu
  const HIDE_PLAYABLES = true;        // YouTube Playables (games): shelves and the menu entry
  const HIDE_BELL = false;            // notification bell
  const HIDE_HOME_FEED = false;       // the video grid on the home page
  const HIDE_SUBSCRIPTIONS = false;   // subscriptions list in the menu
  const HIDE_LIVE_CHAT = false;       // live chat next to live streams
  const HIDE_PLAYLIST_PANEL = false;  // playlist panel when watching a playlist
  const HIDE_COMMENTS = false;        // comments under the video

  // LAYOUT
  const VIDEOS_PER_ROW = 4;           // videos per row on home, subscriptions and channel pages (0 = YouTube's own)

  // INTERNAL SETTINGS
  // The autoplay switch only exists once the player is built: looked at a
  // few times after a page loads (YouTube remembers the choice, so later
  // looks find it off and do nothing).
  const AUTOPLAY_CHECKS_MS = [1000, 3000, 6000];

  const RULES = [
    // Only the recommendations: the playlist panel and live chat in the
    // same column stay unless hidden below.
    [HIDE_SIDEBAR, 'ytd-watch-flexy #related, ytd-watch-next-secondary-results-renderer'],
    [HIDE_END_VIDEOS, '.html5-endscreen, .ytp-endscreen-content, .ytp-ce-element, .ytp-fullscreen-grid, .ytp-autonav-endscreen-countdown-overlay'],
    [HIDE_TRENDING, 'ytd-guide-entry-renderer:has(a[href^="/feed/trending"]), ytd-mini-guide-entry-renderer:has(a[href^="/feed/trending"])'],
    [HIDE_MERCH, 'ytd-merch-shelf-renderer, ytd-ticket-shelf-renderer'],
    // Shorts shelves, single Shorts in lists (by their /shorts/ link), the
    // Shorts tab on channel pages and Shorts in the notifications.
    [HIDE_SHORTS, [
      'ytd-reel-shelf-renderer',
      'ytd-rich-shelf-renderer[is-shorts]',
      'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
      'grid-shelf-view-model:has(ytm-shorts-lockup-view-model)',
      'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
      'ytd-video-renderer:has(a[href^="/shorts/"])',
      'ytd-grid-video-renderer:has(a[href^="/shorts/"])',
      'ytd-compact-video-renderer:has(a[href^="/shorts/"])',
      'yt-lockup-view-model:has(a[href^="/shorts/"])',
      'yt-tab-shape[tab-title="Shorts"]',
      'ytd-notification-renderer:has(a[href^="/shorts/"])'
    ].join(', ')],
    // Playables are recognised by their /playables link, wherever they sit.
    [HIDE_PLAYABLES, [
      'ytd-rich-section-renderer:has(a[href^="/playables"])',
      'ytd-rich-shelf-renderer:has(a[href^="/playables"])',
      'ytd-rich-item-renderer:has(a[href^="/playables"])',
      'ytd-guide-entry-renderer:has(a[href^="/playables"])',
      'ytd-mini-guide-entry-renderer:has(a[href^="/playables"])'
    ].join(', ')],
    [HIDE_SHORTS_TAB, 'ytd-guide-entry-renderer:has(a[title="Shorts"]), ytd-mini-guide-entry-renderer[aria-label="Shorts"]'],
    [HIDE_BELL, 'ytd-notification-topbar-button-renderer'],
    [HIDE_HOME_FEED, 'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'],
    [HIDE_SUBSCRIPTIONS, 'ytd-guide-section-renderer:has(a[href="/feed/channels"])'],
    [HIDE_LIVE_CHAT, 'ytd-watch-flexy #chat-container, ytd-live-chat-frame'],
    [HIDE_PLAYLIST_PANEL, 'ytd-watch-flexy #playlist'],
    [HIDE_COMMENTS, 'ytd-watch-flexy #comments']
  ];

  // YouTube picks the number per row from the window width and writes it
  // into a CSS variable on the grid; a rule with !important wins over it.
  const layout = VIDEOS_PER_ROW > 0
    ? 'ytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: ' + VIDEOS_PER_ROW + ' !important; --ytd-rich-grid-posts-per-row: ' + VIDEOS_PER_ROW + ' !important; }'
    : '';
  const css = RULES.filter(([on]) => on).map(([, selector]) => selector + ' { display: none !important; }').concat(layout).join('\n');
  if (css) {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // AUTOPLAY
  // YouTube's own switch in the player is pressed when it is on, so the
  // choice is stored by YouTube as if you had clicked it yourself.
  function autoplayOff() {
    const on = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (!on) return;
    const button = on.closest('button') || on;
    button.click();
  }

  function checkAutoplaySoon() {
    if (!location.pathname.startsWith('/watch')) return;
    AUTOPLAY_CHECKS_MS.forEach((ms) => setTimeout(autoplayOff, ms));
  }

  if (DISABLE_AUTOPLAY) {
    // yt-navigate-finish: YouTube's own signal that a page (also one opened
    // inside YouTube, without a reload) is ready.
    document.addEventListener('yt-navigate-finish', checkAutoplaySoon);
  }
})();
