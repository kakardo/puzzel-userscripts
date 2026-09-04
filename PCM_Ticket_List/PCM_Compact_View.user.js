// @file_name = PCM_Compact_View.user.js
// @author = Kardo Rostam
// @version = 1.3_2026-09-03
// @created = 2026-08-28 09:04

// ==UserScript==
// @name         PCM Compact View
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.3_2026-09-03
// @description  Compact settings menu for the tickets list, left of Hide Columns. Tightens cell padding and status badges, releases column widths so empty columns collapse, clamps Subject to a configurable MAX line count, and shortens times: minutes to m, hours to h, days to d. All settings live in the menu and persist in localStorage; reapplies on every DataTables draw.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/
// @match        https://puzzel.cm.puzzel.com/tickets
// @match        https://puzzel.cm.puzzel.com/tickets?*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Compact_View.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_Compact_View.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS (defaults; the button menu overrides and persists)
     ******************************************************************/
    var SUBJECT_MAX_ROWS_DEFAULT = 3;    // MAX subject lines; shorter subjects use fewer
    var ROW_PADDING_DEFAULT = 6;         // vertical cell padding in px (space between tickets)
    var BADGE_PADDING_DEFAULT = 1;       // OWN vertical padding for Assigned/Status/Priority cells
    var AVATAR_ROWS_DEFAULT = 2;         // portrait height in text-row heights (settings menu)
    var ROUND_AVATARS_DEFAULT = true;    // round the assigned avatar instead of square
    var STATUS_IN_SUBJECT_DEFAULT = true; // mirror Status as a mini pill while the Status column is hidden
    var PILL_PLACEMENT_DEFAULT = 'subject'; // 'subject' | 'select' | 'both'
	
    // Headers whose cells get time shortening (minutes to m, hours to h, days to d)
    var TIME_COLUMNS = ['Response Target', 'Resolve Target', 'Last Inbound Activity', 'Last Activity', 'Date Created'];
    var SUBJECT_COLUMN = 'Subject';
	
    // Columns squeezed to content width in compact mode (sync-safe: done
    // through the DataTables column config, not CSS on the header table).
    var SQUEEZE_COLUMNS = TIME_COLUMNS.concat(['Status', 'Priority']);
    // Columns whose cells use their OWN vertical padding so badges and
    // avatars can occupy the row height without inflating it.
    var TIGHT_COLUMNS = ['Assigned', 'Status', 'Priority'];

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate || !D.cleanText) {
        console.error('PCM Compact View: PCM_DOM shared helpers are missing (lib 1.9 or newer required).');
        return;
    }

    var ON_KEY = 'pcm-compact-view-on';
    var LINES_KEY = 'pcm-compact-subject-lines';
    var PAD_KEY = 'pcm-compact-row-padding';
    var BADGE_PAD_KEY = 'pcm-compact-badge-padding';
    var ROUND_KEY = 'pcm-compact-round-avatars';
    var AVATAR_ROWS_KEY = 'pcm-compact-avatar-rows';
    var STATUS_IN_SUBJECT_KEY = 'pcm-compact-status-in-subject';
    var STATUS_OWNED_KEY = 'pcm-compact-status-hidden-by-me';
    var PILL_PLACEMENT_KEY = 'pcm-compact-pill-placement';
    // Soft protocol: same storage list PCM_Hide_Columns reads, so both
    // scripts agree on hidden columns without depending on each other.
    var HIDDEN_COLUMNS_LIST_KEY = 'pcm-hidden-columns';
    var MINI_STATUS_CLASS = 'pcm-mini-status';
    var ROUND_CLASS = 'pcm-round-avatars';
    var TIGHT_CELL_CLASS = 'pcm-tight-cell';
    var BUTTON_ID = 'pcm-compact-view-btn';
    var PANEL_ID = 'pcm-compact-view-panel';
    var ROOT_CLASS = 'pcm-compact-on';
    var SUBJECT_CELL_CLASS = 'pcm-subject-cell';
    var STYLE_ID = 'pcm-compact-view-style';

    D.ensureStyleTag(STYLE_ID, [
        // Tight cells: adjustable padding, tighter lines. The table stops
        // being forced wide so empty columns collapse. NOTE: never override
        // th widths here; DataTables synchronises the separate header table
        // with the body via inline th widths, and overriding them desyncs
        // the two (header squeezed, body wide).
        'html.' + ROOT_CLASS + ' .dataTables_wrapper table.dataTable { width:auto !important; min-width:0 !important; }',
        'html.' + ROOT_CLASS + ' .dataTables_wrapper table.dataTable td,',
        'html.' + ROOT_CLASS + ' .dataTables_wrapper table.dataTable th {',
        '  padding: var(--pcm-pad-v, ' + ROW_PADDING_DEFAULT + 'px) 6px !important;',
        '  line-height: 1.25 !important;',
        '}',
        // Status and priority badges: tight around their text.
        'html.' + ROOT_CLASS + ' .dataTables_wrapper table.dataTable td .label,',
        'html.' + ROOT_CLASS + ' .dataTables_wrapper table.dataTable td .badge {',
        '  padding: 2px 6px !important;',
        '  font-size: 11px !important;',
        '  line-height: 1.2 !important;',
        '}',
        // Subject clamped to a MAXIMUM number of text rows.
        'html.' + ROOT_CLASS + ' td.' + SUBJECT_CELL_CLASS + ' { vertical-align: top; }',
        'html.' + ROOT_CLASS + ' td.' + SUBJECT_CELL_CLASS + ' > a {',
        '  display: -webkit-box;',
        '  -webkit-line-clamp: var(--pcm-subject-lines, ' + SUBJECT_MAX_ROWS_DEFAULT + ');',
        '  -webkit-box-orient: vertical;',
        '  overflow: hidden;',
        '}',
        // Shortened times: one line, centred.
        'html.' + ROOT_CLASS + ' td[data-pcm-orig] { white-space: nowrap; text-align: center; }',
        // The avatar fills the height its cell has (the row height set by the
        // Subject clamp, minus the badge cell padding), computed from the same
        // variables so all settings stay consistent. Square, kept in aspect.
        'html.' + ROOT_CLASS + ' .dataTables_wrapper table.dataTable td .avatar-container img {',
        '  height: calc(var(--pcm-avatar-rows, ' + AVATAR_ROWS_DEFAULT + ') * 1.25em) !important;',
        '  width: auto !important;',
        '  aspect-ratio: 1 / 1;',
        '  object-fit: cover !important;',
        '}',
        // The online-status dot covers the whole shrunken avatar, so it is
        // hidden in compact mode (static CSS, zero runtime cost).
        'html.' + ROOT_CLASS + ' .dataTables_wrapper table.dataTable td .avatar-container .work-status-badge {',
        '  display: none !important;',
        '}',
        // Assigned/Status/Priority: own vertical padding, so their content
        // fills the row height set by the Subject instead of adding to it.
        'html.' + ROOT_CLASS + ' .dataTables_wrapper table.dataTable td.' + TIGHT_CELL_CLASS + ' {',
        '  padding-top: var(--pcm-pad-badge, ' + BADGE_PADDING_DEFAULT + 'px) !important;',
        '  padding-bottom: var(--pcm-pad-badge, ' + BADGE_PADDING_DEFAULT + 'px) !important;',
        '  vertical-align: middle;',
        '}',
        // Avatar shape (settings menu). PCM itself rounds avatars, so the
        // square state must actively override that, not just do nothing.
        'html.' + ROOT_CLASS + '.' + ROUND_CLASS + ' .dataTables_wrapper table.dataTable td .avatar-container img {',
        '  border-radius: 50% !important;',
        '}',
        'html.' + ROOT_CLASS + ':not(.' + ROUND_CLASS + ') .dataTables_wrapper table.dataTable td .avatar-container img {',
        '  border-radius: 3px !important;',
        '}',
        // Mini status pill mirrored into the Subject link while the real
        // Status column is hidden: keeps Puzzel colour classes, downsized.
        'html.' + ROOT_CLASS + ' .' + MINI_STATUS_CLASS + ' {',
        '  font-size: 10px !important;',
        '  padding: 1px 5px !important;',
        '  line-height: 1.3 !important;',
        '  margin-right: 6px !important;',
        '  vertical-align: baseline !important;',
        '  display: inline-block;',
        '}',
        // Pill placed in the Select column: centred block under the circle.
        'html.' + ROOT_CLASS + ' .' + MINI_STATUS_CLASS + '.pcm-pill-block {',
        '  display: block;',
        '  margin: 3px auto 0 !important;',
        '  width: max-content;',
        '}',
        // Settings menu, styled like the Hide Columns panel.
        '#' + PANEL_ID + ' {',
        '  position:absolute; z-index:99999; background:rgb(35,43,61);',
        '  border:1px solid rgba(255,255,255,0.15); border-radius:4px; padding:10px 12px;',
        '  color:rgb(230,233,239); font-size:12px; box-shadow:0 4px 12px rgba(0,0,0,0.4);',
        '  min-width:230px; display:flex; flex-direction:column; gap:8px;',
        '}',
        '#' + PANEL_ID + ' label { display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer; user-select:none; white-space:nowrap; }',
        '#' + PANEL_ID + ' input[type="number"] { width:56px; background:rgba(255,255,255,0.08); color:inherit; border:1px solid rgba(255,255,255,0.25); border-radius:3px; padding:2px 4px; }'
    ].join('\n'));

    function isOn() {
        return localStorage.getItem(ON_KEY) !== 'off';
    }

    function setOn(value) {
        localStorage.setItem(ON_KEY, value ? 'on' : 'off');
    }

    function storedInt(key, fallback, min, max) {
        var value = parseInt(localStorage.getItem(key) || '', 10);
        return (!isNaN(value) && value >= min && value <= max) ? value : fallback;
    }

    function subjectLines() {
        return storedInt(LINES_KEY, SUBJECT_MAX_ROWS_DEFAULT, 1, 10);
    }

    function rowPadding() {
        return storedInt(PAD_KEY, ROW_PADDING_DEFAULT, 0, 16);
    }

    function badgePadding() {
        return storedInt(BADGE_PAD_KEY, BADGE_PADDING_DEFAULT, 0, 16);
    }

    function roundAvatars() {
        var stored = localStorage.getItem(ROUND_KEY);
        return stored === null ? ROUND_AVATARS_DEFAULT : stored === 'on';
    }

    function avatarRows() {
        return storedInt(AVATAR_ROWS_KEY, AVATAR_ROWS_DEFAULT, 1, 10);
    }

    function statusInSubject() {
        var stored = localStorage.getItem(STATUS_IN_SUBJECT_KEY);
        return stored === null ? STATUS_IN_SUBJECT_DEFAULT : stored === 'on';
    }

    function pillPlacement() {
        var stored = localStorage.getItem(PILL_PLACEMENT_KEY);
        return (stored === 'subject' || stored === 'select' || stored === 'both') ? stored : PILL_PLACEMENT_DEFAULT;
    }

    function getApi() {
        var $ = window.jQuery;
        if (!$ || !$.fn || !$.fn.dataTable) return null;
        var nodes = $.fn.dataTable.tables();
        if (!nodes || !nodes.length) return null;
        var node = null;
        for (var i = 0; i < nodes.length; i++) {
            if ((nodes[i].className || '').indexOf('tickets-datatable') !== -1) { node = nodes[i]; break; }
        }
        if (!node) node = nodes[0];
        return $(node).DataTable();
    }

    // Visible-cell index per header text: tbody cells only exist for visible
    // columns, so positions are counted among visible headers.
    function visibleIndexes(api) {
        var subject = -1;
        var times = [];
        var tights = [];
        var visPos = 0;

        var squeezes = [];
        var selectCol = -1;

        api.columns().every(function () {
            if (!this.visible()) return;
            var header = this.header();
            var label = D.cleanText(header ? header.textContent : '');
            if (label === SUBJECT_COLUMN) subject = visPos;
            if (TIME_COLUMNS.indexOf(label) !== -1) times.push(visPos);
            if (TIGHT_COLUMNS.indexOf(label) !== -1) tights.push(visPos);
            if (SQUEEZE_COLUMNS.indexOf(label) !== -1) squeezes.push(visPos);
            if (header && (header.className || '').indexOf('select-control') !== -1) selectCol = visPos;
            visPos += 1;
        });

        return { subject: subject, times: times, tights: tights, squeezes: squeezes, selectCol: selectCol };
    }

    function shorten(value) {
        return value
            .replace(/(\d+)\s*seconds?/gi, '$1s')
            .replace(/(\d+)\s*minutes?/gi, '$1m')
            .replace(/(\d+)\s*hours?/gi, '$1h')
            .replace(/(\d+)\s*days?/gi, '$1d')
            .replace(/(\d+)\s*weeks?/gi, '$1w')
            .replace(/(\d+)\s*months?/gi, '$1mo');
    }

    // Squeeze or restore column widths through the DataTables column config.
    // This is the only sync-safe way: DataTables re-applies these widths to
    // BOTH the split header table and the body on columns.adjust(), so they
    // can never drift apart like CSS th overrides did.
    var origWidths = {};

    function setColumnWidths(api, squeeze) {
        var settings = api.settings()[0];
        if (!settings || !settings.aoColumns) return;

        api.columns().every(function () {
            try {
                var realIdx = this.index();
                var header = this.header();
                var label = D.cleanText(header ? header.textContent : '');
                var col = settings.aoColumns[realIdx];
                if (!col || SQUEEZE_COLUMNS.indexOf(label) === -1) return;

                if (squeeze) {
                    if (!(realIdx in origWidths)) {
                        origWidths[realIdx] = { w: col.sWidth || null, o: col.sWidthOrig || null };
                    }
                    col.sWidth = '1%';
                    col.sWidthOrig = '1%';
                } else if (realIdx in origWidths) {
                    col.sWidth = origWidths[realIdx].w;
                    col.sWidthOrig = origWidths[realIdx].o;
                    delete origWidths[realIdx];
                }
            } catch (e) { /* never break the table over width tuning */ }
        });
    }

    // NOTE: an earlier revision manually overrode the squeezed columns'
    // widths after adjust. DataTables re-measured against the tampered
    // widths every draw, ratcheting the table narrower and desyncing the
    // header. Column widths belong to DataTables' engine alone; the sWidth
    // config nudge above is the only safe influence.
    function findRealColumnIndex(api, title) {
        var found = -1;
        api.columns().every(function () {
            if (found !== -1) return;
            var header = this.header();
            if (D.cleanText(header ? header.textContent : '') === title) found = this.index();
        });
        return found;
    }

    var parseHost = document.createElement('div'); // reused, never attached

    function setSharedHiddenListEntry(add) {
        try {
            var raw = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_LIST_KEY));
            var list = Array.isArray(raw) ? raw : [];
            var pos = list.indexOf('Status');
            if (add && pos === -1) list.push('Status');
            if (!add && pos !== -1) list.splice(pos, 1);
            localStorage.setItem(HIDDEN_COLUMNS_LIST_KEY, JSON.stringify(list));
        } catch (e) { /* the shared list is a courtesy, never critical */ }
    }

    // The mirror manages the hiding itself: no manual step, no dependency on
    // the Hide Columns script. Ownership rule: only a hide performed by THIS
    // feature is undone when it is turned off, so a Status column the user
    // hid deliberately beforehand stays hidden.
    function ensureStatusVisibility(api, realIdx, wantHidden) {
        if (realIdx === -1) return;
        var column = api.column(realIdx);

        if (wantHidden) {
            if (column.visible()) {
                localStorage.setItem(STATUS_OWNED_KEY, 'on');
                setSharedHiddenListEntry(true);
                column.visible(false);
            }
        } else if (localStorage.getItem(STATUS_OWNED_KEY) === 'on') {
            localStorage.removeItem(STATUS_OWNED_KEY);
            setSharedHiddenListEntry(false);
            if (!column.visible()) column.visible(true);
        }
    }

    function removeMiniStatuses() {
        var pills = document.querySelectorAll('.' + MINI_STATUS_CLASS);
        for (var i = 0; i < pills.length; i++) pills[i].remove();
    }

    // Your idea made safe: instead of forcing the Status COLUMN narrow (a
    // fight DataTables always wins), the column is hidden via Hide Columns
    // and its live data is mirrored as a mini pill inside the Subject link.
    // Hidden columns keep their data in the DataTables model, so the pill
    // stays correct through refreshes. Active only while Status is hidden,
    // so it can never show twice.
    function mirrorStatusIntoSubject(api, idx) {
        var realIdx = findRealColumnIndex(api, 'Status');
        var enabled = statusInSubject() && idx.subject >= 0 && realIdx !== -1;

        // Self-managed: hide the column when the mirror is on, restore an
        // owned hide when it is off.
        ensureStatusVisibility(api, realIdx, enabled);

        var active = enabled && !api.column(realIdx).visible();

        if (!active) {
            removeMiniStatuses();
            return;
        }

        var placement = pillPlacement();
        var useSubject = placement === 'subject' || placement === 'both';
        var useSelect = (placement === 'select' || placement === 'both') && idx.selectCol >= 0;

        var rows = api.table().body().rows;
        for (var r = 0; r < rows.length; r++) {
            var raw = String(api.cell(api.row(rows[r]).index(), realIdx).data() || '');

            if (useSubject) {
                var subjectCell = rows[r].cells[idx.subject];
                var anchor = subjectCell ? subjectCell.querySelector('a') : null;
                if (anchor) upsertPill(anchor, raw, false);
            }

            if (useSelect) {
                var selectCell = rows[r].cells[idx.selectCol];
                if (selectCell) upsertPill(selectCell, raw, true);
            }
        }
    }

    function upsertPill(container, raw, blockMode) {
        var existing = container.querySelector('.' + MINI_STATUS_CLASS);
        if (existing && existing.dataset.pcmRaw === raw) return; // write-on-change
        if (existing) existing.remove();
        if (!raw) return;

        var pill;
        if (raw.indexOf('<') !== -1) {
            // Server-rendered badge: clone it so Puzzel colour classes apply.
            parseHost.innerHTML = raw;
            var badge = parseHost.querySelector('.label, .badge, span');
            pill = badge ? badge.cloneNode(true) : document.createElement('span');
            if (!badge) pill.textContent = D.cleanText(parseHost.textContent);
            parseHost.textContent = '';
        } else {
            pill = document.createElement('span');
            pill.className = 'label';
            pill.textContent = D.cleanText(raw);
        }

        pill.classList.add(MINI_STATUS_CLASS);
        if (blockMode) pill.classList.add('pcm-pill-block');
        pill.dataset.pcmRaw = raw;

        if (blockMode) {
            container.appendChild(pill);
        } else {
            container.insertBefore(pill, container.firstChild);
        }
    }

    function eachBodyRow(api, fn) {
        var body = api.table().body();
        if (!body) return;
        var rows = body.rows;
        for (var i = 0; i < rows.length; i++) fn(rows[i]);
    }

    function applyCompact() {
        var api = getApi();
        if (!api) return;

        var rootStyle = document.documentElement.style;
        rootStyle.setProperty('--pcm-subject-lines', String(subjectLines()));
        rootStyle.setProperty('--pcm-pad-v', rowPadding() + 'px');
        rootStyle.setProperty('--pcm-pad-badge', badgePadding() + 'px');
        rootStyle.setProperty('--pcm-avatar-rows', String(avatarRows()));
        document.documentElement.classList.toggle(ROUND_CLASS, roundAvatars());

        var idx = visibleIndexes(api);
        setColumnWidths(api, true);

        eachBodyRow(api, function (row) {
            var cells = row.cells;

            if (idx.subject >= 0 && cells[idx.subject] && !cells[idx.subject].classList.contains(SUBJECT_CELL_CLASS)) {
                cells[idx.subject].classList.add(SUBJECT_CELL_CLASS);
            }

            for (var g = 0; g < idx.tights.length; g++) {
                var tightCell = cells[idx.tights[g]];
                if (tightCell && !tightCell.classList.contains(TIGHT_CELL_CLASS)) {
                    tightCell.classList.add(TIGHT_CELL_CLASS);
                }
            }

            for (var t = 0; t < idx.times.length; t++) {
                var cell = cells[idx.times[t]];
                if (!cell) continue;
                var current = cell.textContent;
                var short = shorten(current);
                if (short !== current) {
                    // Original kept for clean restore when compact is turned off.
                    if (!cell.dataset.pcmOrig) cell.dataset.pcmOrig = current;
                    cell.textContent = short;
                } else if (!cell.dataset.pcmOrig && /\d+[smhdw]/.test(current)) {
                    cell.dataset.pcmOrig = current; // already short (idempotent redraws)
                }
            }
        });

        mirrorStatusIntoSubject(api, idx);
        api.columns.adjust();
    }

    function restoreCells() {
        removeMiniStatuses();
        var apiForStatus = getApi();
        if (apiForStatus) {
            ensureStatusVisibility(apiForStatus, findRealColumnIndex(apiForStatus, 'Status'), false);
        }
        var cells = document.querySelectorAll('td[data-pcm-orig]');
        for (var i = 0; i < cells.length; i++) {
            cells[i].textContent = cells[i].dataset.pcmOrig;
            delete cells[i].dataset.pcmOrig;
        }
        var api = getApi();
        if (api) {
            setColumnWidths(api, false);
            api.columns.adjust();
        }
    }

    function updateButton() {
        var btn = document.getElementById(BUTTON_ID);
        if (!btn) return;
        var span = btn.querySelector('span');
        if (span) span.textContent = 'Compact: ' + (isOn() ? 'ON' : 'OFF');
    }

    function apply() {
        var on = isOn();
        document.documentElement.classList.toggle(ROOT_CLASS, on);
        if (on) {
            applyCompact();
        } else {
            restoreCells();
        }
        updateButton();
    }

    // Battery pattern: draw events in a hidden tab defer to one catch-up.
    var applyGate = D.createVisibilityGate(apply, 100);

    function removePanel() {
        var p = document.getElementById(PANEL_ID);
        if (p) p.parentNode.removeChild(p);
        document.removeEventListener('mousedown', outsideClose);
    }

    function outsideClose(e) {
        var panel = document.getElementById(PANEL_ID);
        var btn = document.getElementById(BUTTON_ID);
        if (!panel) return;
        if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
        removePanel();
    }

    function numberRow(labelText, value, min, max, onChange) {
        var row = document.createElement('label');

        var span = document.createElement('span');
        span.textContent = labelText;

        var input = document.createElement('input');
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.value = String(value);
        input.addEventListener('change', function () {
            var parsed = parseInt(input.value, 10);
            if (isNaN(parsed)) return;
            if (parsed < min) parsed = min;
            if (parsed > max) parsed = max;
            input.value = String(parsed);
            onChange(parsed);
            applyGate.schedule(0);
        });

        row.appendChild(span);
        row.appendChild(input);
        return row;
    }

    function buildPanel(btn) {
        var panel = document.createElement('div');
        panel.id = PANEL_ID;

        var toggleRow = document.createElement('label');
        var toggleText = document.createElement('span');
        toggleText.textContent = 'Compact mode';
        var toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = isOn();
        toggle.addEventListener('change', function () {
            setOn(toggle.checked);
            applyGate.schedule(0);
        });
        toggleRow.appendChild(toggleText);
        toggleRow.appendChild(toggle);
        panel.appendChild(toggleRow);

        panel.appendChild(numberRow('Subject max rows', subjectLines(), 1, 10, function (value) {
            localStorage.setItem(LINES_KEY, String(value));
        }));

        panel.appendChild(numberRow('Row spacing (px)', rowPadding(), 0, 16, function (value) {
            localStorage.setItem(PAD_KEY, String(value));
        }));

        panel.appendChild(numberRow('Badge cell spacing (px)', badgePadding(), 0, 16, function (value) {
            localStorage.setItem(BADGE_PAD_KEY, String(value));
        }));

        panel.appendChild(numberRow('Portrait height (rows)', avatarRows(), 1, 10, function (value) {
            localStorage.setItem(AVATAR_ROWS_KEY, String(value));
        }));

        var mirrorRow = document.createElement('label');
        var mirrorText = document.createElement('span');
        mirrorText.textContent = 'Status in Subject';
        var mirrorToggle = document.createElement('input');
        mirrorToggle.type = 'checkbox';
        mirrorToggle.checked = statusInSubject();
        mirrorToggle.addEventListener('change', function () {
            localStorage.setItem(STATUS_IN_SUBJECT_KEY, mirrorToggle.checked ? 'on' : 'off');
            applyGate.schedule(0);
        });
        mirrorRow.appendChild(mirrorText);
        mirrorRow.appendChild(mirrorToggle);
        panel.appendChild(mirrorRow);

        var placementRow = document.createElement('label');
        var placementText = document.createElement('span');
        placementText.textContent = 'Status pill placement';
        var placementSelect = document.createElement('select');
        [['subject', 'Subject'], ['select', 'Select'], ['both', 'Both']].forEach(function (entry) {
            var option = document.createElement('option');
            option.value = entry[0];
            option.textContent = entry[1];
            placementSelect.appendChild(option);
        });
        placementSelect.value = pillPlacement();
        placementSelect.style.cssText = 'background:rgba(255,255,255,0.08); color:inherit;' +
            ' border:1px solid rgba(255,255,255,0.25); border-radius:3px; padding:2px 4px;';
        placementSelect.addEventListener('change', function () {
            localStorage.setItem(PILL_PLACEMENT_KEY, placementSelect.value);
            removeMiniStatuses(); // placement moved: rebuild cleanly
            applyGate.schedule(0);
        });
        placementRow.appendChild(placementText);
        placementRow.appendChild(placementSelect);
        panel.appendChild(placementRow);

        var roundRow = document.createElement('label');
        var roundText = document.createElement('span');
        roundText.textContent = 'Round avatars';
        var roundToggle = document.createElement('input');
        roundToggle.type = 'checkbox';
        roundToggle.checked = roundAvatars();
        roundToggle.addEventListener('change', function () {
            localStorage.setItem(ROUND_KEY, roundToggle.checked ? 'on' : 'off');
            applyGate.schedule(0);
        });
        roundRow.appendChild(roundText);
        roundRow.appendChild(roundToggle);
        panel.appendChild(roundRow);

        document.body.appendChild(panel);
        var rect = btn.getBoundingClientRect();
        panel.style.left = (rect.left + window.scrollX) + 'px';
        panel.style.top = (rect.bottom + window.scrollY + 4) + 'px';

        setTimeout(function () {
            document.addEventListener('mousedown', outsideClose);
        }, 0);
    }

    function togglePanel(btn) {
        if (document.getElementById(PANEL_ID)) {
            removePanel();
        } else {
            buildPanel(btn);
        }
    }

    function ensureButton() {
        if (document.getElementById(BUTTON_ID)) return;

        var host = document.getElementById('pcm-hide-columns-btn');
        if (!host) {
            var anchors = document.querySelectorAll('div.dt-buttons a.dt-button');
            for (var i = 0; i < anchors.length; i++) {
                if ((anchors[i].textContent || '').indexOf('Reset Column Sorting') !== -1) {
                    host = anchors[i];
                    break;
                }
            }
        }
        if (!host) return;

        var btn = document.createElement('a');
        btn.id = BUTTON_ID;
        btn.className = 'dt-button';
        btn.tabIndex = 0;
        btn.title = 'Compact tickets list settings';
        var span = document.createElement('span');
        span.textContent = 'Compact: ' + (isOn() ? 'ON' : 'OFF');
        btn.appendChild(span);

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            togglePanel(btn);
        });

        host.parentNode.insertBefore(btn, host);
    }

    function hookRedraws() {
        var $ = window.jQuery;
        if (!$ || !$.fn || !$.fn.dataTable) return;
        // Event-driven: every redraw (auto refresh, sorting, paging) reapplies.
        $(document).on('draw.dt init.dt', function () {
            ensureButton();
            applyGate.schedule(100);
        });
    }

    D.bootUntil(function () {
        return !!getApi();
    }, function () {
        hookRedraws();
        ensureButton();
        applyGate.schedule(0);
    }, { BOOT_MAX_TRIES: 40, BOOT_INTERVAL_MS: 500 });
})();
