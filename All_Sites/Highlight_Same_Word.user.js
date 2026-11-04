// @file_name = Highlight_Same_Word.user.js
// @author = Kardo Rostam
// @version = 1.1_2026-11-04
// @created = 2026-11-04 (v1.1)

// ==UserScript==
// @name         Highlight Same Word
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-11-04
// @description  Highlights every other place the selected word or phrase appears on the page, on any website. Select text with the mouse (or Shift and the arrow keys) and every match lights up; click elsewhere or press Escape to clear. Whole words by default; when a selected part of a word has no whole-word match, it is found inside words instead. Case-insensitive, at most 1000 hits. Uses the browser's CSS Custom Highlight API, so the page itself is never changed. Light: runs only when you finish a selection, reads nothing else and sends nothing anywhere.
// @author       Kardo Rostam
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/All_Sites/Highlight_Same_Word.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/All_Sites/Highlight_Same_Word.user.js
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

  // INTERNAL SETTINGS
  // The CSS Custom Highlight API paints ranges without touching the page;
  // browsers without it are left alone.
  if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
  const NAME = 'kk-same-word';
  const DEBOUNCE_MS = 60;

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
  };

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

    const body = text.split(/\s+/).map(escape).join('\\s+');
    const flags = CASE_SENSITIVE ? 'gu' : 'giu';

    // Whole words first. Only when that finds nothing (a part of a word
    // was selected) is the page walked a second time, inside words.
    if (WHOLE_WORD && highlightAll(new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, flags), text.length)) return;
    highlightAll(new RegExp(body, flags), text.length);
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
