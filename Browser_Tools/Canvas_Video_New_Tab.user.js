// @file_name = Canvas_Video_New_Tab.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-11-09
// @created = 2026-11-09 10:29

// ==UserScript==
// @name         Canvas Video New Tab
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-11-09
// @description  Adds a small "Open video in new tab" text button under every video embedded in a Canvas page (videos from an external tool such as Kaltura, shown in a frame). The button opens the frame's own address, which shows only the video player, in a new tab in your logged-in session, so the video gets the whole window. Nothing is fetched; the button is a plain link. Event-driven: a scan when the page is ready and one MutationObserver on the page content (Canvas can add content later), debounced, no polling.
// @author       Kardo Rostam
// @match        https://canvas.du.se/*
// @match        https://*.instructure.com/*
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
        link.target = '_blank';
        link.rel = 'noopener';
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
