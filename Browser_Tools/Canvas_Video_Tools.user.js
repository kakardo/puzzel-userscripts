// @file_name = Canvas_Video_Tools.user.js
// @author = Kardo Rostam
// @version = 2.0_2026-11-09
// @created = 2026-11-09 10:29
// @note = Named Canvas_Video_New_Tab until 1.2; renamed in 1.3 when the download button was added.
// @note = run-at document-start on purpose: a tab opened by the buttons is dark as early as possible while it passes through Canvas's and Kaltura's pages.
// @note = Runs in frames on purpose: inside the video player embedded in a Canvas page, it reports the video file's address to that Canvas page (postMessage, to Canvas's own origin only), so the buttons can open or download the file directly.

// ==UserScript==
// @name         Canvas Video Tools
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.0_2026-11-09
// @description  Adds two small text buttons under every video embedded in a Canvas page (videos from an external tool such as Kaltura, shown in a frame): "Open video in new tab" (soft blue, at the video's left edge) and "Download video" (soft yellow, at its right edge), right under the picture. Both open the frame's own address in your logged-in session; on Kaltura's page (play.canvas.du.se) the script then takes the video file (the MP4 the player has). Open: the tab switches to the file, which the browser plays filling the tab (the video is scaled to the window, also when the file is small); when the player has no file, the player is sized to the window instead (16:9, centred). Download: the file is downloaded and the extra tab closes again. The video player embedded in the Canvas page reports its file address to the page, so the buttons open or download the file directly, without passing through Canvas's and Kaltura's pages; a file address is also remembered for 6 hours (Tampermonkey storage). Only when no address is known yet does a button's tab go through those pages, kept dark on the way. Opened any other way, or inside Canvas's frame, Kaltura's page is left as it is. No polling on Canvas: a scan when the page is ready and one debounced MutationObserver on the page content.
// @author       Kardo Rostam
// @match        https://canvas.du.se/*
// @match        https://*.instructure.com/*
// @match        https://play.canvas.du.se/*
// @match        https://*.kaf.kaltura.com/*
// @match        https://*.kaltura.nordu.net/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/Canvas_Video_Tools.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/Canvas_Video_Tools.user.js
// ==/UserScript==

(() => {
  'use strict';

  // USER SETTINGS
  const OPEN_TEXT = 'Open video in new tab ↗';
  const DOWNLOAD_TEXT = 'Download video ⬇';
  const VIDEO_RATIO = 16 / 9;      // shape the player keeps in its own tab
  // Soft pastel pills: [background, border, text].
  const OPEN_COLOURS = ['#e3f0ff', '#b7d4f7', '#1f4f8f'];      // sky blue
  const DOWNLOAD_COLOURS = ['#fff3cf', '#f0d88a', '#6b5310'];  // butter yellow
  const GAP_BELOW_VIDEO = 6;       // px between the picture and the buttons
  const GAP_BEFORE_NEXT = 22;      // px between the buttons and the next video's picture
  const REMEMBER_HOURS = 6;        // the file address carries an access key that expires

  // INTERNAL SETTINGS
  // The tabs the buttons open are named "<kind>-<time>|<video key>", so the
  // pages they pass through can tell what they were opened for (a window
  // keeps its name across sites), and Kaltura's page knows which video's
  // file address to remember.
  const OPEN_TAB = 'kkCanvasVideoOnly';
  const DOWNLOAD_TAB = 'kkCanvasVideoDownload';
  const CACHE_KEY = 'kkCanvasVideoFiles';
  const SOURCE_TRIES = 30;          // up to 30 x 300 ms for Kaltura's player to exist
  const SOURCE_INTERVAL_MS = 300;
  const CLOSE_AFTER_MS = 4000;      // a download tab, once the download has started
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // THE VIDEO FILE IN ITS OWN TAB
  // A browser shows a video file at its own resolution, never larger, so
  // a small video stayed small. Here it fills the window instead, keeping
  // its shape, centred on black.
  if (/^video\//.test(document.contentType || '')) {
    const sheet = document.createElement('style');
    sheet.textContent = [
      'html, body { margin: 0 !important; width: 100% !important; height: 100% !important; background: #000 !important; }',
      'video { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;',
      '  max-width: none !important; max-height: none !important; margin: 0 !important; object-fit: contain !important; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(sheet);
    return;
  }

  const tabName = String(window.name || '');
  const forOpen = tabName.indexOf(OPEN_TAB) === 0;
  const forDownload = tabName.indexOf(DOWNLOAD_TAB) === 0;
  const videoKey = tabName.indexOf('|') !== -1 ? tabName.slice(tabName.indexOf('|') + 1) : '';

  const addStyle = (css) => {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  };

  // REMEMBERED FILE ADDRESSES (video key -> { url, t })
  const cache = () => {
    try {
      const all = GM_getValue(CACHE_KEY, {});
      return all && typeof all === 'object' ? all : {};
    } catch (_) {
      return {};
    }
  };

  const remembered = (key) => {
    const entry = key && cache()[key];
    return entry && Date.now() - entry.t < REMEMBER_HOURS * 3600000 ? entry.url : '';
  };

  const remember = (key, url) => {
    if (!key) return;
    const all = cache();
    const limit = Date.now() - REMEMBER_HOURS * 3600000;
    Object.keys(all).forEach((k) => { if (!all[k] || all[k].t < limit) delete all[k]; });
    all[key] = { url: url, t: Date.now() };
    try { GM_setValue(CACHE_KEY, all); } catch (_) { /* remembering is a courtesy */ }
  };

  // Kaltura's own "save as" form of a file address, when it has one.
  const downloadForm = (url) => (/\/format\/url\//.test(url) ? url.replace('/format/url/', '/format/download/') : '');

  // A BUTTON'S TAB ON ITS WAY: dark from the first moment, on Canvas's
  // launch page and on Kaltura's page alike, until the file shows.
  let darkStyle = null;
  if ((forOpen || forDownload) && window.top === window) {
    darkStyle = addStyle('html { background: #111 !important; } body { visibility: hidden !important; }');
  }

  // The first player's progressive (MP4) source, from Kaltura's player.
  const currentPlayer = () => {
    try {
      const kp = PAGE.KalturaPlayer;
      const players = kp && typeof kp.getPlayers === 'function' ? kp.getPlayers() : null;
      return (players && Object.values(players)[0]) || null;
    } catch (_) {
      return null;
    }
  };

  const fileUrl = () => {
    try {
      const player = currentPlayer();
      const sources = player && (player.sources || (player.config && player.config.sources));
      const progressive = sources && sources.progressive;
      const mp4 = progressive && Array.from(progressive).find((s) => s && s.url && /mp4/i.test(s.mimetype || s.url));
      return mp4 ? String(mp4.url) : '';
    } catch (_) {
      return '';
    }
  };

  // Waits for the file address: short checks only until Kaltura's player
  // exists, then one look; if the address is not known yet, the player's
  // own "media chosen / loaded" announcements trigger the next looks.
  // Stops at the first address, or after FILE_WAIT_MS.
  const PLAYER_EVENTS = ['sourceselected', 'changesourceended', 'loadedmetadata'];
  const FILE_WAIT_MS = 15000;

  const whenFile = (onFound, onGiveUp) => {
    let done = false;
    let player = null;
    let tries = 0;
    const check = () => {
      if (done) return;
      const url = fileUrl();
      if (!url) return;
      finish();
      onFound(url);
    };
    const finish = () => {
      done = true;
      clearTimeout(giveUp);
      if (player && typeof player.removeEventListener === 'function') {
        PLAYER_EVENTS.forEach((name) => { try { player.removeEventListener(name, check); } catch (_) { /* gone */ } });
      }
    };
    const giveUp = setTimeout(() => {
      if (done) return;
      finish();
      if (onGiveUp) onGiveUp();
    }, FILE_WAIT_MS);
    (function waitForPlayer() {
      if (done) return;
      player = currentPlayer();
      if (player) {
        check();
        if (!done && typeof player.addEventListener === 'function') {
          PLAYER_EVENTS.forEach((name) => { try { player.addEventListener(name, check); } catch (_) { /* old player */ } });
        }
        return;
      }
      tries += 1;
      if (tries < SOURCE_TRIES) setTimeout(waitForPlayer, SOURCE_INTERVAL_MS);
    })();
  };

  // Canvas's own address (the page the embedded player reports to).
  const CANVAS_ORIGIN_RE = /^https:\/\/(canvas\.du\.se|[a-z0-9-]+\.instructure\.com)$/;
  const KALTURA_ORIGIN_RE = /^https:\/\/(play\.canvas\.du\.se|[a-z0-9-]+\.kaf\.kaltura\.com)$/;
  const MESSAGE_KEY = 'kkCanvasVideoFile';

  // KALTURA'S PAGE
  const onKaltura = /\/browseandembed\//.test(location.pathname) || location.hostname.indexOf('play.') === 0 ||
    /kaf\.kaltura\.com$/.test(location.hostname);
  if (onKaltura) {
    // Embedded in a Canvas page: report the file address to that page
    // (only to Canvas's own origin, taken from the referrer), once.
    if (window.top !== window) {
      let origin = '';
      try { origin = document.referrer ? new URL(document.referrer).origin : ''; } catch (_) { origin = ''; }
      if (!CANVAS_ORIGIN_RE.test(origin)) return;
      whenFile((url) => {
        const message = {};
        message[MESSAGE_KEY] = url;
        try { window.parent.postMessage(message, origin); } catch (_) { /* nothing to do */ }
      });
      return;
    }

    // Fallback for the open button: the player as large as the window
    // allows, centred. The ids are doubled for weight over the page's own
    // fixed size.
    addStyle([
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
    ].join('\n'));

    if (!forOpen && !forDownload) return;

    const fileName = () => {
      const title = (document.title || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      return (title || 'video').slice(0, 120) + '.mp4';
    };

    // The page shows again (no file, or saving by hand is needed).
    const showPage = () => {
      if (darkStyle) darkStyle.remove();
      darkStyle = null;
    };

    // Download: Kaltura's "save as" form of the address when it has one;
    // otherwise the file is fetched and saved. If both fail, the tab shows
    // the video instead, so it can still be saved by hand.
    const download = (url) => {
      const close = () => setTimeout(() => window.close(), CLOSE_AFTER_MS);
      const direct = downloadForm(url);
      if (direct) {
        location.replace(direct);
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

    whenFile((url) => {
      remember(videoKey, url);
      window.name = '';
      if (forDownload) download(url);
      else location.replace(url);
    }, () => {
      window.name = '';
      showPage();
    });
    return;
  }

  // CANVAS
  // Canvas's own launch page in a button's tab is only passed through
  // (kept dark above), and Canvas pages inside frames get no buttons.
  if (forOpen || forDownload || window.top !== window) return;

  // From Canvas: a video added with an external tool (Kaltura and the
  // like) is an iframe whose src is
  //   /courses/<id>/external_tools/retrieve?display=borderless&resource_link_lookup_uuid=<key>
  // and which allows encrypted-media; opened on its own, that address
  // shows only the player. Other external tools (quizzes, forms) do not
  // ask for encrypted-media and get no buttons.
  const VIDEO_FRAME = 'iframe[src*="/external_tools/retrieve"][allow*="encrypted-media"]';
  const LINK_CLASS = 'kk-canvas-video-tab';
  const BOX_CLASS = LINK_CLASS + '-box';
  const DONE_FLAG = 'kkVideoTab';
  const SCAN_DELAY_MS = 200;

  // File addresses reported by the embedded players: a message from
  // Kaltura's origin is matched to the video frame it came from.
  window.addEventListener('message', (event) => {
    const url = event.data && event.data[MESSAGE_KEY];
    if (typeof url !== 'string' || !KALTURA_ORIGIN_RE.test(event.origin)) return;
    const frame = Array.from(document.querySelectorAll(VIDEO_FRAME)).find((f) => f.contentWindow === event.source);
    if (frame) remember(keyOf(frame.src), url);
  });

  const keyOf = (src) => {
    const match = String(src).match(/resource_link_lookup_uuid=([^&#]+)/);
    return match ? match[1] : String(src);
  };

  // Each click gets a tab name of its own (a second video gets its own
  // tab), carrying the video's key. A remembered file address is opened
  // straight away; otherwise the tab goes through Canvas and Kaltura.
  // Download always opens its tab by script, so that tab may close itself.
  function makeLink(text, title, kindTab, kind) {
    const link = document.createElement('a');
    link.className = LINK_CLASS + ' ' + kind;
    link.textContent = text;
    link.title = title;
    link.target = kindTab;
    link.addEventListener('click', (event) => {
      const key = keyOf(link.href);
      const name = kindTab + '-' + Date.now() + '|' + key;
      const file = remembered(key);
      if (kindTab === OPEN_TAB) {
        if (file) {
          event.preventDefault();
          window.open(file, name);
        } else {
          link.target = name;
        }
        return;
      }
      event.preventDefault();
      const direct = file && downloadForm(file);
      if (direct) {
        const tab = window.open(direct, name);
        if (tab) setTimeout(() => { try { tab.close(); } catch (_) { /* already closed */ } }, CLOSE_AFTER_MS);
      } else {
        window.open(link.href, name);
      }
    });
    return link;
  }

  // One small row of buttons right after each video frame, as wide as the
  // video and right under its picture (the frame is taller than the 16:9
  // picture Kaltura centres in it, so the row moves up by the empty strip).
  function scan() {
    const frames = Array.from(document.querySelectorAll(VIDEO_FRAME));
    // The empty strip above and below the 16:9 picture Kaltura centres in
    // a frame that is taller than the picture.
    const stripOf = (f) => {
      const r = f.getBoundingClientRect();
      return Math.max(0, Math.round((r.height - r.width / VIDEO_RATIO) / 2));
    };
    frames.forEach((frame, index) => {
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
        box.appendChild(makeLink(OPEN_TEXT, 'Open only the video in a new tab', OPEN_TAB, 'kk-open'));
        box.appendChild(makeLink(DOWNLOAD_TEXT, 'Download the video file', DOWNLOAD_TAB, 'kk-download'));
        frame.insertAdjacentElement('afterend', box);
      }
      box.querySelectorAll('a').forEach((link) => {
        if (link.href !== src) link.href = src;
      });
      const rect = frame.getBoundingClientRect();
      const width = Math.round(rect.width);
      if (width && box.style.width !== width + 'px') box.style.width = width + 'px';
      const top = (GAP_BELOW_VIDEO - stripOf(frame)) + 'px';
      if (width && box.style.marginTop !== top) box.style.marginTop = top;
      // The next video's strip above its picture is taken off the space
      // below this row, so every gap between videos looks the same.
      const next = frames[index + 1];
      const bottom = (GAP_BEFORE_NEXT - (next ? stripOf(next) : 0)) + 'px';
      if (width && box.style.marginBottom !== bottom) box.style.marginBottom = bottom;
    });
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, SCAN_DELAY_MS);
  }

  function start() {
    addStyle([
      '.' + BOX_CLASS + ' { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; max-width: 100%; margin: 0 0 22px; position: relative; }',
      '.' + LINK_CLASS + ' {',
      '  display: inline-block; padding: 4px 14px; border-radius: 999px;',
      '  font-size: 13px; font-weight: 600; line-height: 1.4; text-decoration: none !important; cursor: pointer;',
      '  transition: filter .15s ease;',
      '}',
      '.' + LINK_CLASS + '.kk-open { background: ' + OPEN_COLOURS[0] + '; border: 1px solid ' + OPEN_COLOURS[1] + '; color: ' + OPEN_COLOURS[2] + ' !important; }',
      '.' + LINK_CLASS + '.kk-download { background: ' + DOWNLOAD_COLOURS[0] + '; border: 1px solid ' + DOWNLOAD_COLOURS[1] + '; color: ' + DOWNLOAD_COLOURS[2] + ' !important; }',
      '.' + LINK_CLASS + ':hover { filter: brightness(.96); }'
    ].join('\n'));
    scan();
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
  }

  // BOOT (document-start: Canvas's content is not there yet)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
