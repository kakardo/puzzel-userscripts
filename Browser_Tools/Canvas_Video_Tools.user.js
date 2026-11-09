// @file_name = Canvas_Video_Tools.user.js
// @author = Kardo Rostam
// @version = 1.4_2026-11-09
// @created = 2026-11-09 10:29
// @note = Named Canvas_Video_New_Tab until 1.2; renamed in 1.3 when the download button was added.

// ==UserScript==
// @name         Canvas Video Tools
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.4_2026-11-09
// @description  Adds two small text buttons under every video embedded in a Canvas page (videos from an external tool such as Kaltura, shown in a frame): "Open video in new tab" (blue, at the video's left edge) and "Download video" (yellow, at its right edge). Both open the frame's own address in your logged-in session; on Kaltura's page (play.canvas.du.se) the script then takes the video file (the MP4 the player has). Open: the tab switches to the file, which the browser plays filling the tab; when the player has no file, the player is sized to the window instead (16:9, centred). Download: the file is downloaded and the extra tab closes again. Opened any other way, or inside Canvas's frame, Kaltura's page is left as it is. No polling on Canvas: a scan when the page is ready and one debounced MutationObserver on the page content.
// @author       Kardo Rostam
// @match        https://canvas.du.se/*
// @match        https://*.instructure.com/*
// @match        https://play.canvas.du.se/*
// @match        https://*.kaf.kaltura.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/Canvas_Video_Tools.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/Canvas_Video_Tools.user.js
// ==/UserScript==

(() => {
  'use strict';

  // USER SETTINGS
  const OPEN_TEXT = 'Open video in new tab ↗';
  const DOWNLOAD_TEXT = 'Download video ⬇';
  const VIDEO_RATIO = 16 / 9;      // shape the player keeps in its own tab
  const OPEN_COLOUR = '#1e5bd8';   // blue, white text
  const DOWNLOAD_COLOUR = '#f5c518'; // yellow, dark text

  // The tabs the buttons open are named, so Kaltura's page can tell what
  // they were opened for (a window keeps its name across sites).
  const OPEN_TAB = 'kkCanvasVideoOnly';
  const DOWNLOAD_TAB = 'kkCanvasVideoDownload';
  const SOURCE_TRIES = 30;          // up to 30 x 300 ms for the player
  const SOURCE_INTERVAL_MS = 300;
  const CLOSE_AFTER_MS = 4000;      // the download tab, once the download has started

  // KALTURA'S PAGE
  if (/\/browseandembed\//.test(location.pathname) || document.getElementById('kplayer')) {
    if (window.top !== window) return;

    // Fallback for the open button: the player as large as the window
    // allows, centred. The ids are doubled for weight over the page's own
    // fixed size.
    const fit = document.createElement('style');
    fit.textContent = [
      'html, body, #contentWrap, #wrap, #content, #entryMedia, #mediaContainer, #wrapper, #player {',
      '  width: 100% !important; height: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important;',
      '}',
      'html body #player#player { position: relative !important; }',
      'html body #player#player #kplayer#kplayer {',
      '  position: absolute !important; inset: 0 !important; margin: auto !important; max-width: none !important; max-height: none !important;',
      '  width: min(100vw, calc(100vh * ' + VIDEO_RATIO + ')) !important;',
      '  height: min(100vh, calc(100vw / ' + VIDEO_RATIO + ')) !important;',
      '}',
      'html body #kplayer#kplayer .kaltura-player-container,',
      'html body #kplayer#kplayer .playkit-player { width: 100% !important; height: 100% !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(fit);

    const forOpen = window.name.indexOf(OPEN_TAB) === 0;
    const forDownload = window.name.indexOf(DOWNLOAD_TAB) === 0;
    if (!forOpen && !forDownload) return;

    // The first player's progressive (MP4) source, from Kaltura's player.
    const fileUrl = () => {
      try {
        const kp = window.KalturaPlayer;
        const players = kp && typeof kp.getPlayers === 'function' ? kp.getPlayers() : null;
        const player = players && Object.values(players)[0];
        const sources = player && (player.sources || (player.config && player.config.sources));
        const progressive = sources && sources.progressive;
        const mp4 = progressive && progressive.find((s) => s && s.url && /mp4/i.test(s.mimetype || s.url));
        return mp4 ? mp4.url : '';
      } catch (_) {
        return '';
      }
    };

    // A file name from the page title, safe for every system.
    const fileName = () => {
      const title = (document.title || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      return (title || 'video').slice(0, 120) + '.mp4';
    };

    // Download: Kaltura's own download form of the address (it answers
    // "save as") when the address has the usual /format/url/ part;
    // otherwise the file is fetched and saved. If both fail, the tab
    // shows the video instead, so it can still be saved by hand.
    const download = (url) => {
      const close = () => setTimeout(() => window.close(), CLOSE_AFTER_MS);
      if (/\/format\/url\//.test(url)) {
        location.replace(url.replace('/format/url/', '/format/download/'));
        close();
        return;
      }
      fetch(url).then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.blob();
      }).then((blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName();
        document.body.appendChild(link);
        link.click();
        close();
      }).catch(() => {
        location.replace(url);
      });
    };

    let tries = 0;
    (function waitForSource() {
      const url = fileUrl();
      if (url) {
        window.name = '';
        if (forDownload) download(url);
        else location.replace(url);
        return;
      }
      tries += 1;
      if (tries < SOURCE_TRIES) setTimeout(waitForSource, SOURCE_INTERVAL_MS);
      else window.name = '';
    })();
    return;
  }

  // CANVAS
  // From Canvas: a video added with an external tool (Kaltura and the
  // like) is an iframe whose src is
  //   /courses/<id>/external_tools/retrieve?display=borderless&...
  // and which allows encrypted-media; opened on its own, that address
  // shows only the player. Other external tools (quizzes, forms) do not
  // ask for encrypted-media and get no buttons.
  const VIDEO_FRAME = 'iframe[src*="/external_tools/retrieve"][allow*="encrypted-media"]';
  const LINK_CLASS = 'kk-canvas-video-tab';
  const BOX_CLASS = LINK_CLASS + '-box';
  const DONE_FLAG = 'kkVideoTab';
  const SCAN_DELAY_MS = 200;

  const style = document.createElement('style');
  style.textContent = [
    // As wide as the video (set per frame below): open at the left edge,
    // download at the right edge.
    '.' + BOX_CLASS + ' { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; max-width: 100%; margin: 4px 0 10px; }',
    '.' + LINK_CLASS + ' {',
    '  display: inline-block; padding: 3px 10px; border-radius: 4px;',
    '  font-size: 13px; font-weight: 600; line-height: 1.4; text-decoration: none !important; cursor: pointer;',
    '}',
    '.' + LINK_CLASS + '.kk-open { background: ' + OPEN_COLOUR + '; border: 1px solid ' + OPEN_COLOUR + '; color: #fff !important; }',
    '.' + LINK_CLASS + '.kk-download { background: ' + DOWNLOAD_COLOUR + '; border: 1px solid ' + DOWNLOAD_COLOUR + '; color: #222 !important; }',
    '.' + LINK_CLASS + ':hover { filter: brightness(1.08); }'
  ].join('\n');
  (document.head || document.documentElement).appendChild(style);

  // Each click gets a tab name of its own (a second video gets its own
  // tab). Open is a plain link (no "noopener", which drops the name in
  // some browsers); download opens its tab by script, so that tab may
  // close itself once the download has started.
  function makeLink(text, title, tabName, byScript, kind) {
    const link = document.createElement('a');
    link.className = LINK_CLASS + ' ' + kind;
    link.textContent = text;
    link.title = title;
    link.target = tabName;
    link.addEventListener('click', (event) => {
      const name = tabName + '-' + Date.now();
      if (byScript) {
        event.preventDefault();
        window.open(link.href, name);
      } else {
        link.target = name;
      }
    });
    return link;
  }

  // One small row of buttons right after each video frame. Placed once per
  // frame; a frame whose address changes gets its buttons updated.
  function scan() {
    document.querySelectorAll(VIDEO_FRAME).forEach((frame) => {
      const src = frame.src;
      if (!src || src === 'about:blank') return;
      let box = frame.nextElementSibling && frame.nextElementSibling.classList.contains(BOX_CLASS)
        ? frame.nextElementSibling
        : null;
      if (!box) {
        if (frame.dataset[DONE_FLAG]) return;
        frame.dataset[DONE_FLAG] = '1';
        box = document.createElement('span');
        box.className = BOX_CLASS;
        box.appendChild(makeLink(OPEN_TEXT, 'Open only the video in a new tab', OPEN_TAB, false, 'kk-open'));
        box.appendChild(makeLink(DOWNLOAD_TEXT, 'Download the video file', DOWNLOAD_TAB, true, 'kk-download'));
        frame.insertAdjacentElement('afterend', box);
      }
      box.querySelectorAll('a').forEach((link) => {
        if (link.href !== src) link.href = src;
      });
      // The row is as wide as the video.
      const width = Math.round(frame.getBoundingClientRect().width);
      if (width && box.style.width !== width + 'px') box.style.width = width + 'px';
    });
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, SCAN_DELAY_MS);
  }

  // BOOT
  scan();
  // The video's width can change with the window (narrow screens).
  window.addEventListener('resize', schedule, { passive: true });
  const root = document.getElementById('content') || document.body;
  new MutationObserver((mutations) => {
    for (let i = 0; i < mutations.length; i += 1) {
      if (mutations[i].addedNodes.length) {
        schedule();
        return;
      }
    }
  }).observe(root, { childList: true, subtree: true });
})();
