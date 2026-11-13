// @file_name = YouTube_Rename_Playlists.js
// @author = Kardo Rostam
// @version = 1.0_2026-11-13
// @created = 2026-11-13 17:12

// Renames many of your own YouTube playlists in one go, from the browser
// console. Not a userscript: paste it into the console when needed.
//
// How to use:
//   1. Open https://www.youtube.com/feed/playlists and scroll to the
//      bottom, so every playlist is loaded on the page.
//   2. Fill in RENAME below: current name on the left, new name on the
//      right, exactly as YouTube shows them.
//   3. Paste the whole command into the console (F12) with DRY_RUN = true.
//      It only prints the plan: what it will rename and which names it
//      could not find. Nothing changes.
//   4. Set DRY_RUN = false (and LIMIT = 1 for a first test), paste again,
//      and click the bell (notifications) at the top of YouTube when asked.
//   5. When the test looks right on YouTube, set LIMIT = 0 to do the rest.
//
// How it works: playlists are matched by their current name on the page.
// To sign the requests, it listens while YouTube makes one of its own
// requests (the bell) and copies YouTube's own sign-in headers, then uses
// them for the renames, one every 1.5 seconds. The headers are only kept
// inside this one run. It uses YouTube's internal web call (the one its
// own "edit title" uses), not an official API, so it may stop working
// when YouTube changes it.
//
// Running it again is safe: playlists that already have their new name
// are reported as not found and skipped. Playlists saved from other
// channels cannot be renamed; YouTube refuses them.

(async () => {
  const DRY_RUN = true;   // true = only show the plan
  const LIMIT = 0;        // 0 = all, 1 = only the first (for a test)
  const DELAY_MS = 1500;  // pause between renames
  const WAIT_SECONDS = 60; // how long to wait for the bell click

  // 'Current name': 'New name'
  const RENAME = {
    'Old playlist name': 'CATEGORY - New playlist name',
    'Another old name': 'CATEGORY - Another new name'
  };

  // Playlists on the page: id and every text its links carry (title,
  // label, link text), so a name matches whichever one holds it.
  const texts = new Map();
  document.querySelectorAll('a[href*="list="]').forEach((a) => {
    const id = new URL(a.href, location.origin).searchParams.get('list');
    if (!id) return;
    const set = texts.get(id) || new Set();
    [a.getAttribute('title'), a.getAttribute('aria-label'), a.textContent].forEach((t) => {
      t = (t || '').replace(/\s+/g, ' ').trim();
      if (t) set.add(t);
    });
    texts.set(id, set);
  });

  const plan = [];
  const missing = [];
  Object.entries(RENAME).forEach(([from, to]) => {
    const hit = [...texts].find(([, set]) => set.has(from));
    if (hit) plan.push({ id: hit[0], from: from, to: to });
    else missing.push(from);
  });
  console.log('WILL RENAME (' + plan.length + '):\n' + plan.map((p) => p.from + '  ->  ' + p.to).join('\n'));
  if (missing.length) console.log('NOT FOUND ON PAGE (scroll down, check the spelling, or already renamed):\n' + missing.join('\n'));
  if (DRY_RUN) return console.log('Test mode: nothing changed. Set DRY_RUN = false to rename.');
  if (!plan.length) return console.log('Nothing to rename.');

  // Copy the sign-in headers from YouTube's own next request.
  const origFetch = window.fetch;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  let captured = null;
  const keep = (h) => { if (!captured && h.authorization) captured = h; };
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input.url;
      if (/\/youtubei\/v1\//.test(url)) {
        keep(Object.fromEntries(new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined)).entries()));
      }
    } catch (_) { /* not a request we can read */ }
    return origFetch.apply(this, arguments);
  };
  XMLHttpRequest.prototype.open = function (method, url) {
    this.kkYoutubei = /\/youtubei\/v1\//.test(url);
    this.kkHeaders = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    if (this.kkYoutubei) {
      this.kkHeaders[key.toLowerCase()] = value;
      keep(this.kkHeaders);
    }
    return origSet.apply(this, arguments);
  };
  console.log('Now click the bell (notifications) at the top of YouTube. Waiting up to ' + WAIT_SECONDS + ' seconds...');
  for (let i = 0; i < WAIT_SECONDS * 2 && !captured; i += 1) await new Promise((r) => setTimeout(r, 500));
  window.fetch = origFetch;
  XMLHttpRequest.prototype.open = origOpen;
  XMLHttpRequest.prototype.setRequestHeader = origSet;
  if (!captured) return console.warn('No YouTube request seen. Run it again and click the bell.');

  const headers = {};
  Object.entries(captured).forEach(([k, v]) => {
    if (!/^(content-length|content-encoding|host|cookie)$/.test(k)) headers[k] = v;
  });
  headers['content-type'] = 'application/json';

  let ok = 0;
  let failed = 0;
  for (const p of (LIMIT ? plan.slice(0, LIMIT) : plan)) {
    const res = await origFetch('/youtubei/v1/browse/edit_playlist?prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify({
        context: ytcfg.get('INNERTUBE_CONTEXT'),
        playlistId: p.id,
        actions: [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: p.to }]
      })
    });
    const json = await res.json().catch(() => ({}));
    const done = json.status === 'STATUS_SUCCEEDED';
    if (done) ok += 1; else failed += 1;
    console.log((done ? 'OK      ' : 'FAILED ' + res.status + ' ') + p.from + '  ->  ' + p.to +
      (done || !json.error ? '' : ' (' + json.error.message + ')'));
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log('Done: ' + ok + ' renamed, ' + failed + ' failed. Reload the page to see the new names.');
})();
