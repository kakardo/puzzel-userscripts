// @file_name = Page_Load_Times.js
// @author = Kardo Rostam
// @version = 1.0_2026-11-13
// @created = 2026-11-13 21:52

// Shows how long the current page took to load, from the browser's own
// timing data. Works on any website. Not a userscript: paste it into the
// console when needed.
//
// How to use:
//   1. Reload the page and wait until everything has loaded.
//   2. Press F12, open the Console tab, paste this and press Enter.
//      (Firefox may first ask you to type "allow pasting".)
//   3. To compare (for example with Tampermonkey on and off), run it after
//      three reloads in each setup: single runs vary a lot.
//
// What the lines mean:
//   First response   the server started sending the page
//   First drawn      the first text or image was drawn
//   Page ready       the page's own code can run (DOMContentLoaded);
//                    userscripts at document-idle start around here
//   Everything loaded  images, scripts and styles of the first load are in
//   Largest drawn    the biggest piece of content was drawn (not in every
//                    browser)
//   Requests, data   files fetched so far and their size over the network
//
// It only reads timing data the browser already keeps; it changes nothing.

(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  if (!nav) return console.warn('No timing data for this page.');
  const fmt = (ms) => (ms > 0 ? (ms / 1000).toFixed(2) + ' s' : 'n/a');
  const paint = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
  const resources = performance.getEntriesByType('resource');
  const bytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), nav.transferSize || 0);

  const report = (largest) => console.log([
    'First response:     ' + fmt(nav.responseStart),
    'First drawn:        ' + fmt(paint ? paint.startTime : 0),
    'Page ready:         ' + fmt(nav.domContentLoadedEventEnd),
    'Everything loaded:  ' + fmt(nav.loadEventEnd),
    'Largest drawn:      ' + fmt(largest),
    'Requests, data:     ' + resources.length + ', ' + (bytes / 1048576).toFixed(1) + ' MB'
  ].join('\n'));

  // The largest drawn content is only handed out through an observer.
  let done = false;
  try {
    new PerformanceObserver((list) => {
      if (done) return;
      done = true;
      const entries = list.getEntries();
      report(entries.length ? entries[entries.length - 1].startTime : 0);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) { /* not supported in this browser */ }
  setTimeout(() => { if (!done) { done = true; report(0); } }, 300);
})();
