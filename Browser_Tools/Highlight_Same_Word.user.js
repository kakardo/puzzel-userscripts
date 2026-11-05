// @file_name = Highlight_Same_Word.user.js
// @author = Kardo Rostam
// @version = 1.4_2026-11-05
// @created = 2026-11-04 (v1.1)

// ==UserScript==
// @name         Highlight Same Word
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.4_2026-11-05
// @description  Highlights every other place the selected word or phrase appears on the page, on any website. Select text with the mouse (or Shift and the arrow keys) and every match lights up; click elsewhere or press Escape to clear. Whole words by default; when a selected part of a word has no whole-word match, it is found inside words instead. Case-insensitive, at most 1000 hits. A thin strip along the right edge, next to the scroll bar, marks where the matches are on the whole page. Uses the browser's CSS Custom Highlight API, so the page itself is never changed. Light: runs only when you finish a selection, reads nothing else and sends nothing anywhere.
// @author       Kardo Rostam
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/Highlight_Same_Word.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/Browser_Tools/Highlight_Same_Word.user.js
// ==/UserScript==

(() => {
  'use strict';

  // USER SETTINGS
  const MIN_LEN = 2;             // shortest selection that is searched
  const MAX_LEN = 100;           // longest selection that is searched
  const MAX_HITS = 1000;         // stop after this many matches
  const CASE_SENSITIVE = false;
  const WHOLE_WORD = true;       // whole words first, part of words when none match
  const COLOUR = '#ff1493';
  const TEXT_COLOUR = '#ffffff';
  const MARKERS = true;          // marks beside the scroll bar
  const MARKER_WIDTH = 6;        // px
  const MARKER_HEIGHT = 3;       // px

  // INTERNAL SETTINGS
  // The CSS Custom Highlight API paints ranges without touching the page;
  // browsers without it are left alone.
  if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
  const NAME = 'kk-same-word';
  const DEBOUNCE_MS = 60;
  const STRIP_ID = 'kk-same-word-marks';

  const style = document.createElement('style');
  style.textContent = `::highlight(${NAME}){background-color:${COLOUR};color:${TEXT_COLOUR};}`;
  (document.head || document.documentElement).appendChild(style);

  const hl = new Highlight();
  CSS.highlights.set(NAME, hl);

  let last = '';
  let timer = 0;

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const clear = () => {
    if (hl.size) hl.clear();
    last = '';
    clearMarks();
  };

  // SCROLL BAR MARKS
  // One canvas fixed along the right edge of the window (next to the
  // scroll bar, clicks pass through it). Each match is marked at its place
  // on the whole page, so scrolling needs no work; matches on the same
  // pixel row share a mark. Positions are measured once per selection and
  // again only when the window or the page changes size, and only while
  // matches are shown. Hidden matches (no box on screen) get no mark.
  let strip = null;
  let resizeObserver = null;
  let redrawFrame = 0;

  function clearMarks() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    window.removeEventListener('resize', scheduleRedraw);
    cancelAnimationFrame(redrawFrame);
    if (strip) {
      strip.remove();
      strip = null;
    }
  }

  function scheduleRedraw() {
    cancelAnimationFrame(redrawFrame);
    redrawFrame = requestAnimationFrame(drawMarks);
  }

  function drawMarks() {
    if (!MARKERS || !hl.size) return;
    const root = document.documentElement;
    const pageHeight = Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0);
    const viewHeight = root.clientHeight || window.innerHeight;
    // No scroll bar, no strip.
    if (pageHeight <= viewHeight + 1) {
      if (strip) strip.style.display = 'none';
      return;
    }
    if (!strip) {
      strip = document.createElement('canvas');
      strip.id = STRIP_ID;
      strip.style.cssText = 'position:fixed;top:0;right:0;width:' + MARKER_WIDTH + 'px;height:100%;' +
        'z-index:2147483647;pointer-events:none;';
      document.documentElement.appendChild(strip);
    }
    strip.style.display = '';
    const ratio = window.devicePixelRatio || 1;
    strip.width = Math.round(MARKER_WIDTH * ratio);
    strip.height = Math.round(viewHeight * ratio);
    const ctx = strip.getContext('2d');
    ctx.clearRect(0, 0, strip.width, strip.height);
    ctx.fillStyle = COLOUR;
    const markHeight = Math.max(1, Math.round(MARKER_HEIGHT * ratio));
    const scale = strip.height / pageHeight;
    const scrollTop = window.scrollY || root.scrollTop || 0;
    const drawn = new Set();
    hl.forEach((range) => {
      const box = range.getBoundingClientRect();
      if (!box.width && !box.height) return;
      const y = Math.min(strip.height - markHeight, Math.round((box.top + scrollTop) * scale));
      if (drawn.has(y)) return;
      drawn.add(y);
      ctx.fillRect(0, y, strip.width, markHeight);
    });
  }

  function showMarks() {
    if (!MARKERS) return;
    drawMarks();
    if (!resizeObserver && window.ResizeObserver && document.body) {
      resizeObserver = new ResizeObserver(scheduleRedraw);
      resizeObserver.observe(document.body);
    }
    window.addEventListener('resize', scheduleRedraw, { passive: true });
  }

  const filter = {
    acceptNode(node) {
      const p = node.parentNode;
      return p && !SKIP.has(p.nodeName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  };

  // One pass over the page's text, adding a range per match; returns the
  // number of matches, bounded by MAX_HITS.
  const highlightAll = (re, minLength) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, filter);
    let count = 0;
    let node;

    outer: while ((node = walker.nextNode())) {
      const value = node.nodeValue;
      if (value.length < minLength) continue;

      re.lastIndex = 0;
      let m;
      while ((m = re.exec(value))) {
        const r = new Range();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        hl.add(r);
        if (++count >= MAX_HITS) break outer;
      }
    }
    return count;
  };

  const run = () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';

    if (text.length < MIN_LEN || text.length > MAX_LEN) {
      clear();
      return;
    }
    if (text === last) return;

    last = text;
    hl.clear();
    clearMarks();

    const body = text.split(/\s+/).map(escape).join('\\s+');
    const flags = CASE_SENSITIVE ? 'gu' : 'giu';

    // Whole words first. Only when that finds nothing (a part of a word
    // was selected) is the page walked a second time, inside words.
    if (!(WHOLE_WORD && highlightAll(new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, flags), text.length))) {
      highlightAll(new RegExp(body, flags), text.length);
    }
    if (hl.size) showMarks();
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  };

  // Only a finished selection starts a search: a mouse release, or Shift
  // released after selecting with the keyboard. Escape clears.
  document.addEventListener('mouseup', schedule, { passive: true });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') {
      clear();
      return;
    }
    if (e.shiftKey || e.key === 'Shift') schedule();
  }, { passive: true });
})();
