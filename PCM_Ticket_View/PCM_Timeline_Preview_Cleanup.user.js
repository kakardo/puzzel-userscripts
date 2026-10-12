// @file_name = PCM_Timeline_Preview_Cleanup.user.js
// @author = Kardo Rostam
// @version = 1.1_2026-10-12
// @created = 2026-10-12 12:34
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). User names and ids are read from the page at runtime and kept in localStorage, never written here.

// ==UserScript==
// @name         PCM Timeline Preview Cleanup
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-10-12
// @description  Makes the Timeline Preview window (opened by clicking an older ticket in Customer Intelligence) easier to read. Hides the "Rules applied" entries, which fill most of the window with rule lists; which entry types are hidden is a list at the top. Entries in the same minute by the same person, or all via API, are merged into one row with the person named once, and "Tag ... added" lines in it are joined into one "Tags added: ..." line. System events are shown as slim boxed rows with a small grey dot instead of the big pink icon, so mails and notes stand out and every event has a clear edge, and status changes are shown as PCM's coloured status labels (OPEN → RESOLVED). Mails all start collapsed, also the newest one PCM opens on load. Puts an avatar in front of every entry done by a person ("... by First Last"): a coloured circle with their initials, replaced by their profile picture once the script has learned who they are. PCM has no full user list, so names and user ids are learned from the Assigned To lists as they load (team changes included) and remembered in localStorage; pictures appear for more people the more teams you visit. Only the preview window is affected. Event-driven via jQuery's ajaxComplete and the modal's shown event: no observers, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Timeline_Preview_Cleanup.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Timeline_Preview_Cleanup.user.js
// ==/UserScript==

(function () {
    'use strict';

    // USER SETTINGS
    // Entry types hidden in the preview window. Each name is the part after
    // "timeline-event-" in the entry's icon class. Known types:
    //   'rules-applied'      Rules applied: G40*, ...
    //   'status-changed'     Status changed from ... to ...
    //   'net-promoter-sent'  Net Promoter Sent
    //   'message-sent'       Message sent by ...
    // Mails, notes and other boxes have no such class and always show.
    var HIDDEN_EVENTS = ['rules-applied'];

    // Avatars in front of entries done by a person. false turns them off.
    var SHOW_AVATARS = true;
    var AVATAR_SIZE_PX = 20;

    // System events (status, team, tags, forms, Net Promoter) as slim rows
    // with a small grey dot instead of the big pink icon, so mails and
    // notes stand out. false keeps PCM's own look.
    var COMPACT_EVENTS = true;

    // With COMPACT_EVENTS: each event row gets a light box with a thin
    // border, so every event has a clear edge. false leaves them open.
    var BOX_EVENTS = true;

    // "Status changed from open to resolved" shown as PCM's coloured
    // status labels: Status OPEN → RESOLVED. false keeps the plain text.
    var STATUS_CHIPS = true;

    // PCM opens the newest mail when the preview loads. true closes it, so
    // every mail starts collapsed; mails you open yourself stay open.
    var COLLAPSE_MAILS = true;

    // Entries in the same minute by the same person (or all via API) become
    // one row, with "Tag ... added" lines joined into one. false turns it off.
    var MERGE_SAME_MINUTE = true;

    // INTERNAL SETTINGS
    var STYLE_ID = 'pcm-timeline-preview-cleanup-style';
    var MODAL_ID = 'ticket-preview';
    var DONE_ATTR = 'data-pcm-preview-done';
    // Name (lower case) to user id, learned from the Assigned To lists.
    var USERS_KEY = 'pcm-timeline-preview-users';
    // Selects whose options are users: value is the user id, text the name.
    var USER_SELECTS = '#user-select, #create-child-ticket-user';
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 250;

    if (document.getElementById(STYLE_ID)) return;

    // STYLE
    // The preview is a Bootstrap modal, #ticket-preview, that PCM fills when
    // a ticket is clicked. Each entry is an li whose first child is the
    // icon carrying the event class, so :has() hides the whole entry,
    // including entries added later, without any script running.
    var css = [];
    if (COMPACT_EVENTS) {
        // Event entries are the li's whose icon carries a timeline-event-
        // class; mails and notes have none and keep PCM's look. The icon
        // is PCM's 35px box (absolute, top 10px plus margin 9px), scaled
        // around its centre, so horizontally it stays on the timeline line.
        // Vertically, dot, first text line and first time line all centre
        // on the first text line: the description loses PCM's 11px top
        // padding and the box moves up to top -6px (35px box, centre at
        // 11.5px). A boxed row pushes the text down by the box's border
        // and padding (BOX_INSET), so dot and time move down by the same.
        var BOX_INSET = BOX_EVENTS ? 6 : 0;
        var eventLi = '#' + MODAL_ID + ' .smart-timeline-list li:has(> .smart-timeline-icon[class*="timeline-event-"])';
        // flow-root: the time is a left float two lines high, taller than
        // a one-line row. Without it the float hangs into the next row
        // and pushes that row's time and dot sideways.
        css.push(
            eventLi + ' {',
            '    display: flow-root !important;',
            '    padding-top: ' + (BOX_EVENTS ? 3 : 2) + 'px !important;',
            '    padding-bottom: ' + (BOX_EVENTS ? 3 : 2) + 'px !important;',
            '    margin-top: 0 !important;',
            '    margin-bottom: 0 !important;',
            '    min-height: 0 !important;',
            '}',
            eventLi + ' > .smart-timeline-icon {',
            '    top: ' + (-6 + BOX_INSET + (BOX_EVENTS ? 1 : 0)) + 'px !important;',
            '    margin-top: 0 !important;',
            '    background: #b8bec6 !important;',
            '    transform: scale(.35);',
            '    box-shadow: none !important;',
            '}',
            eventLi + ' > .smart-timeline-icon > * {',
            '    visibility: hidden;',
            '}',
            eventLi + ' > .smart-timeline-time {',
            // The time's lines are shorter than the text's, so it starts
            // 2px lower in a box to centre on the same height.
            '    padding-top: ' + (BOX_EVENTS ? BOX_INSET + 2 : 0) + 'px !important;',
            '    font-size: 11px;',
            '    line-height: 1.25;',
            '    color: #999;',
            '}',
            eventLi + ' > .smart-timeline-content {',
            '    padding-top: 0 !important;',
            '    padding-bottom: 0 !important;',
            '}',
            eventLi + ' p.event-description {',
            '    margin: 0 !important;',
            '    padding-top: 0 !important;',
            '    font-size: 12.5px;',
            '    line-height: 1.45;',
            '    color: #555;',
            '}',
            eventLi + ' p.event-description strong {',
            '    font-weight: 600;',
            '}'
        );
        if (BOX_EVENTS) {
            // Same family as PCM's mail panels (light grey, thin border),
            // a shade lighter so mails still stand out. 1px border plus
            // 5px padding is the BOX_INSET above.
            css.push(
                eventLi + ' > .smart-timeline-content {',
                '    padding: 5px 10px !important;',
                '    border: 1px solid #e1e4e8;',
                '    border-radius: 4px;',
                '    background: #fafbfc;',
                '}'
            );
        }
    }
    css.push(
        '.pcm-tp-status {',
        '    display: inline-block;',
        '    margin: 0 2px;',
        '    padding: 1px 6px 2px;',
        '    font-size: 10.5px;',
        '    line-height: 1.3;',
        '    vertical-align: 1px;',
        '}',
        '#' + MODAL_ID + ' p.event-description.pcm-tp-flex {',
        '    display: flex;',
        '    align-items: flex-start;',
        '}',
        '.pcm-tp-body {',
        '    flex: 1;',
        '    min-width: 0;',
        '}',
        '.pcm-tp-line + .pcm-tp-line {',
        '    margin-top: 4px;',
        '}',
        '.pcm-tp-by {',
        '    margin-top: 4px;',
        '    font-size: 90%;',
        '    color: #888;',
        '}',
        '.pcm-tp-avatar {',
        '    position: relative;',
        '    flex: none;',
        '    display: inline-block;',
        '    width: ' + AVATAR_SIZE_PX + 'px;',
        '    height: ' + AVATAR_SIZE_PX + 'px;',
        '    margin-top: -2px;',
        '    margin-right: 8px;',
        '    border-radius: 50%;',
        '    overflow: hidden;',
        '    vertical-align: middle;',
        '    color: #fff;',
        '    font-size: ' + Math.round(AVATAR_SIZE_PX * 0.42) + 'px;',
        '    font-weight: 700;',
        '    line-height: ' + AVATAR_SIZE_PX + 'px;',
        '    text-align: center;',
        '    letter-spacing: 0;',
        '    font-style: normal;',
        '}',
        '.pcm-tp-avatar img {',
        '    position: absolute;',
        '    inset: 0;',
        '    width: 100%;',
        '    height: 100%;',
        '    object-fit: cover;',
        '}'
    );

    // Hiding comes last and is at least as specific as the compact row
    // rule above (whose display: flow-root would otherwise win), so hidden
    // and merged-away entries always stay hidden.
    var hideSelectors = HIDDEN_EVENTS.map(function (name) {
        return '#' + MODAL_ID + ' .smart-timeline-list li:has(> .smart-timeline-icon.timeline-event-' + name + ')';
    });
    hideSelectors.push('#' + MODAL_ID + ' .smart-timeline-list li.pcm-tp-merged:has(> .smart-timeline-icon)');
    css.push(
        hideSelectors.join(',\n') + ' {',
        '    display: none !important;',
        '}'
    );

    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css.join('\n');
    (document.head || document.documentElement).appendChild(style);

    if (!SHOW_AVATARS && !MERGE_SAME_MINUTE && !STATUS_CHIPS && !COLLAPSE_MAILS) return;

    // LEARNING USERS
    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function nameKey(name) {
        return cleanText(name).toLowerCase();
    }

    function readUsers() {
        try {
            var parsed = JSON.parse(window.localStorage.getItem(USERS_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    var users = readUsers();

    // Cheap: a handful of options. Writes only when something is new.
    function learnUsers() {
        var changed = false;
        document.querySelectorAll(USER_SELECTS).forEach(function (select) {
            Array.prototype.forEach.call(select.options, function (option) {
                if (!/^\d+$/.test(option.value)) return;
                var key = nameKey(option.text);
                if (!key || users[key] === option.value) return;
                users[key] = option.value;
                changed = true;
            });
        });
        if (!changed) return;
        try {
            window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
        } catch (_) {
            // Storage unavailable: the names still work for this page.
        }
    }

    // AVATARS
    function initials(name) {
        var words = cleanText(name).split(' ').filter(Boolean);
        if (!words.length) return '?';
        var first = words[0].charAt(0);
        var last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
        return (first + last).toUpperCase();
    }

    // Same name, same colour, every time.
    function colourFor(name) {
        var hash = 0;
        var key = nameKey(name);
        for (var i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
        return 'hsl(' + (Math.abs(hash) % 360) + ', 55%, 42%)';
    }

    function buildAvatar(name) {
        var avatar = document.createElement('span');
        avatar.className = 'pcm-tp-avatar';
        avatar.title = name;
        avatar.textContent = initials(name);
        avatar.style.background = colourFor(name);

        var id = users[nameKey(name)];
        if (id) {
            var img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            // A user without a picture, or an id that no longer exists,
            // answers with an error; the initials underneath then show.
            img.addEventListener('error', function () { img.remove(); });
            img.src = '/users/' + encodeURIComponent(id) + '/avatar?style=thumb';
            avatar.appendChild(img);
        }
        return avatar;
    }

    // The person is whatever follows the last " by " in the entry's text:
    // "Message sent by First Last", "Status changed from a to b by First
    // Last". Entries done "via API" have no person and get no avatar.
    function actorName(text) {
        var at = text.lastIndexOf(' by ');
        if (at < 0) return '';
        var name = cleanText(text.slice(at + 4));
        if (!/^[^\d"@:<>]{2,60}$/.test(name)) return '';
        if (name.split(' ').length > 5) return '';
        return name;
    }

    // Who did it: a person's name, 'api' for "via API", or '' when the
    // entry names nobody (Autoreply sent, Net Promoter Sent).
    function actorOf(text) {
        var name = actorName(text);
        if (name) return { key: 'name:' + nameKey(name), name: name, suffix: new RegExp('\\s*\\bby\\s+' + escapeRegExp(name) + '\\s*$') };
        if (/\bvia API\s*$/.test(text)) return { key: 'api', name: '', suffix: /\s*\bvia API\s*$/ };
        return { key: 'none', name: '', suffix: null };
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // GROUPING
    // A plain event entry: an event icon plus one description line. Mails,
    // notes and other boxes are not, and they end a group.
    function eventParts(li) {
        var icon = li.querySelector(':scope > .smart-timeline-icon');
        if (!icon || !/\btimeline-event-/.test(icon.className)) return null;
        var description = li.querySelector(':scope > .smart-timeline-content > p.event-description');
        if (!description) return null;
        var time = li.querySelector(':scope > .smart-timeline-time');
        return { icon: icon, description: description, time: cleanText(time ? time.textContent : '') };
    }

    function isHiddenEvent(icon) {
        return HIDDEN_EVENTS.some(function (name) {
            return icon.classList.contains('timeline-event-' + name);
        });
    }

    // Removes the "by First Last" or "via API" ending from the last text
    // in a line, so a merged row says it once.
    function stripSuffix(line, suffix) {
        var walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        var last = null;
        var node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue.trim()) last = node;
        }
        if (last && suffix.test(last.nodeValue)) last.nodeValue = last.nodeValue.replace(suffix, '');
    }

    function makeLine(description, actor, strip) {
        var line = document.createElement('div');
        line.className = 'pcm-tp-line';
        while (description.firstChild) line.appendChild(description.firstChild);
        if (strip && actor.suffix) stripSuffix(line, actor.suffix);
        if (STATUS_CHIPS) statusChips(line);
        return line;
    }

    // STATUS CHIPS
    // Uses PCM's own status label classes (label-open, label-closed, ...),
    // with label-default underneath for a status PCM has no colour for.
    function statusChip(status) {
        var chip = document.createElement('span');
        var slug = cleanText(status).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        chip.className = 'label label-default uppercase ticket-status label-' + slug + ' pcm-tp-status';
        chip.textContent = cleanText(status);
        return chip;
    }

    var STATUS_RE = /Status changed from (.+?) to (.+?)(?=\s+by\s|\s+via API|\s*$)/;

    function statusChips(line) {
        var walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        var node;
        while ((node = walker.nextNode())) {
            var match = node.nodeValue.match(STATUS_RE);
            if (!match) continue;
            var before = node.nodeValue.slice(0, match.index);
            var after = node.nodeValue.slice(match.index + match[0].length);
            var fragment = document.createDocumentFragment();
            fragment.appendChild(document.createTextNode(before + 'Status '));
            fragment.appendChild(statusChip(match[1]));
            fragment.appendChild(document.createTextNode(' → '));
            fragment.appendChild(statusChip(match[2]));
            fragment.appendChild(document.createTextNode(after));
            node.parentNode.replaceChild(fragment, node);
            return;
        }
    }

    // "Tag A added", "Tag B added" become "Tags added: A, B" at the place
    // of the first one. Same for removed.
    function mergeTagLines(lines) {
        var merged = {};
        var result = [];
        lines.forEach(function (line) {
            var match = cleanText(line.textContent).match(/^Tag (.+) (added|removed)$/);
            if (!match) {
                result.push(line);
                return;
            }
            var verb = match[2];
            if (!merged[verb]) {
                merged[verb] = { line: line, names: [] };
                result.push(line);
            }
            merged[verb].names.push(match[1]);
        });
        Object.keys(merged).forEach(function (verb) {
            var entry = merged[verb];
            var label = entry.names.length > 1 ? 'Tags ' + verb + ': ' : 'Tag ' + verb + ': ';
            entry.line.textContent = '';
            var strong = document.createElement('strong');
            strong.textContent = label + entry.names.join(', ');
            entry.line.appendChild(strong);
        });
        return result;
    }

    function renderGroup(group) {
        var first = group[0];
        var actor = first.actor;
        var merging = group.length > 1;

        var body = document.createElement('div');
        body.className = 'pcm-tp-body';
        var lines = group.map(function (member) {
            return makeLine(member.parts.description, actor, merging);
        });
        if (merging) lines = mergeTagLines(lines);
        lines.forEach(function (line) { body.appendChild(line); });

        if (merging && actor.key !== 'none') {
            var by = document.createElement('div');
            by.className = 'pcm-tp-by';
            by.textContent = actor.name ? 'by ' + actor.name : 'via API';
            body.appendChild(by);
        }

        var description = first.parts.description;
        description.classList.add('pcm-tp-flex');
        if (SHOW_AVATARS && actor.name) description.appendChild(buildAvatar(actor.name));
        description.appendChild(body);

        for (var i = 1; i < group.length; i += 1) group[i].li.classList.add('pcm-tp-merged');
    }

    // MAILS
    // Runs once per entry (the entry is marked as seen), so only the mail
    // PCM opened on load is closed. Bootstrap's collapse is open when the
    // body has .in; its toggle link shows the state with .collapsed.
    function collapseMails(li) {
        li.querySelectorAll('.panel-collapse.email-body.in').forEach(function (body) {
            body.classList.remove('in');
            var toggle = li.querySelector('a[href="#' + body.id + '"], [data-target="#' + body.id + '"]') ||
                li.querySelector('.panel-heading .panel-title a');
            if (toggle) {
                toggle.classList.add('collapsed');
                toggle.setAttribute('aria-expanded', 'false');
            }
            body.setAttribute('aria-expanded', 'false');
        });
    }

    // One pass over the entries not seen yet. Consecutive event entries
    // with the same time and the same actor form one group; entries hidden
    // by HIDDEN_EVENTS are skipped over, anything else ends the group.
    function decoratePreview() {
        var modal = document.getElementById(MODAL_ID);
        if (!modal) return;
        var groups = [];
        var current = null;
        modal.querySelectorAll('.smart-timeline-list li:not([' + DONE_ATTR + '])').forEach(function (li) {
            li.setAttribute(DONE_ATTR, '1');
            var parts = eventParts(li);
            if (!parts) {
                current = null;
                if (COLLAPSE_MAILS) collapseMails(li);
                return;
            }
            if (isHiddenEvent(parts.icon)) return;
            var actor = actorOf(cleanText(parts.description.textContent));
            var key = parts.time + '|' + actor.key;
            if (!MERGE_SAME_MINUTE || !current || current.key !== key) {
                current = { key: key, members: [] };
                groups.push(current);
            }
            current.members.push({ li: li, parts: parts, actor: actor });
        });
        groups.forEach(function (group) { renderGroup(group.members); });
    }

    function onAjaxComplete() {
        learnUsers();
        decoratePreview();
    }

    // BOOT
    // Bounded: waits for jQuery, then runs on its events only. The
    // preview's content and the Assigned To list after a team change both
    // arrive by ajax, so ajaxComplete covers both.
    var tries = 0;
    function start() {
        var jq = window.jQuery;
        if (!jq) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) window.setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        learnUsers();
        jq(document).on('ajaxComplete', onAjaxComplete);
        jq(document).on('shown.bs.modal', function (event) {
            if (event.target && event.target.id === MODAL_ID) decoratePreview();
        });
    }

    start();
})();
