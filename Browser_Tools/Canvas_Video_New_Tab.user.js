// @file_name = Canvas_Video_New_Tab.user.js
// @author = Kardo Rostam
// @version = 1.2_2026-11-09
// @created = 2026-11-09 10:29

// ==UserScript==
// @name         Canvas Video New Tab
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.2_2026-11-09
// @description  Adds a small "Open video in new tab" text button under every video embedded in a Canvas page (videos from an external tool such as Kaltura, shown in a frame). The button opens the frame's own address, which shows only the video player, in a new tab in your logged-in session, so the video gets the whole window. There (Kaltura's page, play.canvas.du.se) the tab switches to the video file itself (the MP4 the player has), which the browser plays filling the tab; when the player has no file, the player is sized to the window instead (16:9, centred). Opened any other way, or inside Canvas's frame, Kaltura's page is left as it is. Nothing is fetched; the button is a plain link. Event-driven: a scan when the page is ready and one MutationObserver on the page content (Canvas can add content later), debounced, no polling.
// @author       Kardo Rostam
// @match        https://canvas.du.se/*
// @match        https://*.instructure.com/*
// @match        https://play.canvas.du.se/*
// @match        https://*.kaf.kaltura.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/Canvas_Video_New_Tab.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/Canvas_Video_New_Tab.user.js
// ==/UserScript==

(() => {
  'use strict';

  // USER SETTINGS
  const BUTTON_TEXT = 'Open video in new tab ↗';
  const VIDEO_RATIO = 16 / 9;      // shape the player keeps in its own tab

  // The tab the button opens is named, so Kaltura's page can tell it was
  // opened as a "video only" tab (a window keeps its name across sites).
  const TAB_NAME = 'kkCanvasVideoOnly';
  const SOURCE_TRIES = 30;          // up to 30 x 300 ms for the player
  const SOURCE_INTERVAL_MS = 300;

  // KALTURA'S PAGE (the video in its own tab)
  // Opened from the button, the tab switches to the video file itself
  // (the MP4 address the player has, with its access key): the browser
  // plays a file on its own, filling the tab and following the window.
  // Without a file (streaming only) or on any error the page stays, with
  // the player sized to the window by CSS as a fallback. Opened any other
  // way, or inside Canvas's frame, the page is left as it is.
  if (/\/browseandembed\//.test(location.pathname) || document.getElementById('kplayer')) {
    if (window.top !== window) return;

    // Fallback: the player as large as the window allows, centred. The
    // ids are doubled for weight over the page's own fixed size.
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

    if (window.name.indexOf(TAB_NAME) !== 0) return;

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

    let tries = 0;
    (function waitForSource() {
      const url = fileUrl();
      if (url) {
        window.name = '';
        location.replace(url);
        return;
      }
      tries += 1;
      if (tries < SOURCE_TRIES) setTimeout(waitForSource, SOURCE_INTERVAL_MS);
      else window.name = '';
    })();
    return;
  }

  // INTERNAL SETTINGS
  // From Canvas: a video added with an external tool (Kaltura and the
  // like) is an iframe whose src is
  //   /courses/<id>/external_tools/retrieve?display=borderless&...
  // and which allows encrypted-media; opened on its own, that address
  // shows only the player. Other external tools (quizzes, forms) do not
  // ask for encrypted-media and get no button.
  const VIDEO_FRAME = 'iframe[src*="/external_tools/retrieve"][allow*="encrypted-media"]';
  const LINK_CLASS = 'kk-canvas-video-tab';
  const DONE_FLAG = 'kkVideoTab';
  const SCAN_DELAY_MS = 200;

  const style = document.createElement('style');
  style.textContent = [
    '.' + LINK_CLASS + ' {',
    '  display: inline-block; margin: 4px 0 10px; padding: 3px 10px;',
    '  border: 1px solid currentColor; border-radius: 4px;',
    '  font-size: 13px; line-height: 1.4; text-decoration: none !important;',
    '}',
    '.' + LINK_CLASS + ':hover { background: rgba(0,0,0,.05); }'
  ].join('\n');
  (document.head || document.documentElement).appendChild(style);

  // One link in a small block of its own right after each video frame.
  // Placed once per frame; a frame whose address changes gets its link
  // updated.
  function scan() {
    document.querySelectorAll(VIDEO_FRAME).forEach((frame) => {
      const src = frame.src;
      if (!src || src === 'about:blank') return;
      const box = frame.nextElementSibling && frame.nextElementSibling.classList.contains(LINK_CLASS + '-box')
        ? frame.nextElementSibling
        : null;
      let link = box && box.firstElementChild;
      if (!link) {
        if (frame.dataset[DONE_FLAG]) return;
        frame.dataset[DONE_FLAG] = '1';
        const wrap = document.createElement('span');
        wrap.className = LINK_CLASS + '-box';
        wrap.style.display = 'block';
        link = document.createElement('a');
        link.className = LINK_CLASS;
        link.target = TAB_NAME;
        // A name of its own per click, so a second video gets its own tab;
        // no "noopener", which drops the name in some browsers.
        link.addEventListener('click', () => { link.target = TAB_NAME + '-' + Date.now(); });
        link.textContent = BUTTON_TEXT;
        link.title = 'Open only the video player in a new tab';
        wrap.appendChild(link);
        frame.insertAdjacentElement('afterend', wrap);
      }
      if (link.href !== src) link.href = src;
    });
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, SCAN_DELAY_MS);
  }

  // BOOT
  scan();
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
