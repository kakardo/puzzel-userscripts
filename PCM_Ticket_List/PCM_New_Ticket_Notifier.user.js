// @file_name = PCM_New_Ticket_Notifier.user.js
// @author = Kardo Rostam
// @version = 2.4_2026-09-04
// @created = 2026-04-24 (v1.0)

// ==UserScript==
// @name         PCM New Ticket Notifier
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.4_2026-09-04
// @description  Shows persistent alerts with priority and title when new tickets appear in the PCM ticket list. Alerting keeps working in hidden tabs; the 15s background timer is a cheap watchdog instead of a full rescan.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets
// @match        https://puzzel.cm.puzzel.com/tickets?*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_New_Ticket_Notifier.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_List/PCM_New_Ticket_Notifier.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ======== USER SETTINGS ========
    const SOUND_ENABLED = true;
    const VISUAL_TOASTER_ENABLED = true;

    const D = window.PCM_DOM;

    if (!D || !D.uniqueElements || !D.readJson || !D.writeJson) {
        console.warn('[PCM New Ticket Notifier] PCM_DOM shared file (1.8 or newer) was not loaded.');
        return;
    }

    const SCRIPT = {
        name: 'PCM New Ticket Notifier',
        version: '2.4_2026-09-04'
    };

    const CONFIG = {
        STORAGE_KEY_SNAPSHOT: 'pcmNewTicketNotifierLastSnapshot',
        STORAGE_KEY_PENDING: 'pcmNewTicketNotifierPendingTickets',
        STORAGE_KEY_LAST_SEEN: 'pcmNewTicketNotifierLastSeenAt',
        STYLE_ID: 'pcm-new-ticket-notifier-style',
        TOAST_HOST_ID: 'pcm-new-ticket-toast-host',
        BADGE_ID: 'pcm-new-ticket-pending-badge',
        TOAST_MS: 12000,
        APPLY_DELAY_MS: 450,
        STARTUP_SECOND_CHECK_MS: 1800,
        BACKGROUND_CHECK_MS: 15000,
        MAX_STORED_TICKETS: 150,
        MAX_PENDING_TICKETS: 50,
        MAX_TOAST_TICKETS: 6,
        DEFAULT_PRIORITY_LABEL: 'Priority unknown',
        ENABLE_BROWSER_NOTIFICATION_IF_ALREADY_ALLOWED: true,
        REQUEST_BROWSER_NOTIFICATION_ON_FIRST_INTERACTION: true,
        SOUND_VOLUME: 0.045,
        SOUND_FREQUENCY_A: 880,
        SOUND_FREQUENCY_B: 1175,
        SOUND_DURATION_MS: 180,
        DEBUG_LOGS: false
    };

    const CSS = `
#pcm-new-ticket-toast-host {
    position: fixed;
    top: 14px;
    right: 14px;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
}

.pcm-new-ticket-toast {
    min-width: 280px;
    max-width: 440px;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(46, 204, 113, 0.45);
    background: rgba(18, 24, 33, 0.97);
    color: #e6e9ef;
    box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35);
    font-family: Arial, sans-serif;
    font-size: 12px;
    line-height: 1.35;
    pointer-events: auto;
    cursor: pointer;
}

.pcm-new-ticket-toast-title {
    font-weight: 700;
    color: #2ecc71;
    margin-bottom: 5px;
}

.pcm-new-ticket-toast-body {
    color: #e6e9ef;
    white-space: pre-line;
}

.pcm-new-ticket-toast-small {
    margin-top: 5px;
    color: #aeb6c2;
    font-size: 11px;
}

.pcm-new-ticket-toast-persistent {
    border-color: rgba(241, 196, 15, 0.65);
}

.pcm-new-ticket-toast-persistent .pcm-new-ticket-toast-title {
    color: #f1c40f;
}

#pcm-new-ticket-pending-badge {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 999999;
    min-width: 34px;
    height: 34px;
    padding: 0 10px;
    border: 1px solid rgba(241, 196, 15, 0.65);
    border-radius: 999px;
    background: rgba(18, 24, 33, 0.97);
    color: #f1c40f;
    box-shadow: 0 8px 26px rgba(0, 0, 0, 0.35);
    font-family: Arial, sans-serif;
    font-size: 13px;
    font-weight: 700;
    line-height: 34px;
    text-align: center;
    cursor: pointer;
}
`;

    let observer = null;
    let observerRoot = null;
    let applyTimer = 0;
    let backgroundTimer = 0;
    let audioContext = null;
    let started = false;
    let lastDebugState = '';

    function log(message, data) {
        if (!CONFIG.DEBUG_LOGS) return;
        console.log(`[${SCRIPT.name}] ${message}`, data || '');
    }

    function warn(message, data) {
        console.warn(`[${SCRIPT.name}] ${message}`, data || '');
    }

    // Shared helpers from PCM_DOM (single source of truth since lib 1.8)
    const readJson = D.readJson;
    const writeJson = D.writeJson;

    function clean(value) {
        return D.text(value || '');
    }

    function getToastHost() {
        let host = D.query('#' + CONFIG.TOAST_HOST_ID);

        if (!host) {
            host = document.createElement('div');
            host.id = CONFIG.TOAST_HOST_ID;
            document.body.appendChild(host);
        }

        return host;
    }

    function showToast(title, body, smallText, options) {
        if (!VISUAL_TOASTER_ENABLED) return;

        const opts = options || {};
        const host = getToastHost();

        const toast = document.createElement('div');
        toast.className = 'pcm-new-ticket-toast' + (opts.persistent ? ' pcm-new-ticket-toast-persistent' : '');

        const titleEl = document.createElement('div');
        titleEl.className = 'pcm-new-ticket-toast-title';
        titleEl.textContent = title;

        const bodyEl = document.createElement('div');
        bodyEl.className = 'pcm-new-ticket-toast-body';
        bodyEl.textContent = body;

        toast.appendChild(titleEl);
        toast.appendChild(bodyEl);

        if (smallText) {
            const smallEl = document.createElement('div');
            smallEl.className = 'pcm-new-ticket-toast-small';
            smallEl.textContent = smallText;
            toast.appendChild(smallEl);
        }

        toast.addEventListener('click', function() {
            if (opts.clearPendingOnClick) {
                clearPendingTickets();
            }
            toast.remove();
        });

        host.appendChild(toast);

        if (!opts.persistent) {
            window.setTimeout(function() {
                toast.remove();
            }, CONFIG.TOAST_MS);
        }
    }

    function maybeRequestBrowserNotificationPermission() {
        if (!CONFIG.REQUEST_BROWSER_NOTIFICATION_ON_FIRST_INTERACTION) return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'default') return;

        try {
            Notification.requestPermission().catch(function() {});
        } catch (_) {
            // Notification permission is optional.
        }
    }

    function showBrowserNotification(title, body) {
        if (!CONFIG.ENABLE_BROWSER_NOTIFICATION_IF_ALREADY_ALLOWED) return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;

        try {
            new Notification(title, { body: body });
        } catch (_) {
            // Browser notifications are optional. Toast is the main notifier.
        }
    }

    function getAudioContext() {
        if (!SOUND_ENABLED) return null;

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return null;

        if (!audioContext) {
            audioContext = new AudioContextCtor();
        }

        return audioContext;
    }

    function primeAudio() {
        const ctx = getAudioContext();
        if (!ctx) return;

        if (ctx.state === 'suspended') {
            ctx.resume().catch(function() {});
        }
    }

    function playBeep() {
        if (!SOUND_ENABLED) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        const startSound = function() {
            const now = ctx.currentTime;
            const duration = CONFIG.SOUND_DURATION_MS / 1000;

            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(CONFIG.SOUND_VOLUME, now + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            gain.connect(ctx.destination);

            const oscA = ctx.createOscillator();
            oscA.type = 'sine';
            oscA.frequency.setValueAtTime(CONFIG.SOUND_FREQUENCY_A, now);
            oscA.connect(gain);
            oscA.start(now);
            oscA.stop(now + duration);

            const oscB = ctx.createOscillator();
            oscB.type = 'sine';
            oscB.frequency.setValueAtTime(CONFIG.SOUND_FREQUENCY_B, now + 0.08);
            oscB.connect(gain);
            oscB.start(now + 0.08);
            oscB.stop(now + duration);
        };

        const resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();

        resumePromise
            .then(startSound)
            .catch(function() {
                warn('Sound was blocked until page interaction.');
            });
    }

    function setupFirstInteractionUnlocks() {
        const unlock = function() {
            primeAudio();
            maybeRequestBrowserNotificationPermission();
        };

        window.addEventListener('click', unlock, { once: true, passive: true });
        window.addEventListener('keydown', unlock, { once: true, passive: true });
        window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    }

    const uniqueElements = D.uniqueElements;

    function getTicketTables() {
        return uniqueElements([
            D.query('#ticketsTable'),
            D.query('table.dataTable'),
            D.query('.dataTables_wrapper table'),
            D.query('.dataTables_scrollBody table')
        ].concat(D.queryAll('table'))).filter(Boolean);
    }

    function getMainTicketTable() {
        const tables = getTicketTables();
        return tables[0] || null;
    }

    function getDataTablesRows(table) {
        const jq = window.jQuery || window.$;
        if (!jq || !jq.fn || !jq.fn.dataTable || !jq.fn.dataTable.isDataTable) return [];

        try {
            if (!jq.fn.dataTable.isDataTable(table)) return [];
            const api = jq(table).DataTable();
            return Array.from(api.rows({ search: 'applied' }).nodes().toArray());
        } catch (_) {
            return [];
        }
    }

    function rowToRowData(row, index) {
        const cells = D.queryAll('td, th', row).map(function(cell) {
            return clean(cell);
        }).filter(Boolean);

        return {
            index: index,
            element: row,
            visible: D.visible(row),
            cells: cells
        };
    }

    function collectRowData() {
        const rows = [];

        getTicketTables().forEach(function(table) {
            const dataTableRows = getDataTablesRows(table);
            const domRows = D.readTableRows(table, 'tbody tr').map(function(rowData) {
                return rowData.element;
            });

            rows.push.apply(rows, dataTableRows);
            rows.push.apply(rows, domRows);
        });

        D.queryAll('.dataTables_scrollBody tbody tr, table tbody tr').forEach(function(row) {
            rows.push(row);
        });

        return uniqueElements(rows).map(rowToRowData);
    }

    function isTicketRow(rowData) {
        if (!rowData || !rowData.cells || rowData.cells.length < 2) return false;

        const rowText = rowData.cells.join(' ').toLowerCase();
        if (!rowText) return false;
        if (rowText.includes('no data available')) return false;
        if (rowText.includes('loading')) return false;
        if (rowText.includes('processing')) return false;

        return true;
    }

    function getTableHeaders(table) {
        if (!table) return [];

        return D.queryAll('thead th', table).map(function(header) {
            return clean(header);
        });
    }

    function getRowCells(row) {
        return D.queryAll('td, th', row);
    }

    function getRowHeaders(row) {
        const table = row && row.closest ? row.closest('table') : getMainTicketTable();
        return getTableHeaders(table || getMainTicketTable());
    }

    function getCellTextByHeader(rowData, headers, patterns) {
        if (!headers || !headers.length) return '';

        const max = Math.min(headers.length, rowData.cells.length);

        for (let index = 0; index < max; index += 1) {
            const headerText = clean(headers[index]).toLowerCase();
            const matched = patterns.some(function(pattern) {
                return pattern.test(headerText);
            });

            if (matched) {
                return clean(rowData.cells[index]);
            }
        }

        return '';
    }

    function getCellElementByHeader(row, headers, patterns) {
        if (!headers || !headers.length) return null;

        const cells = getRowCells(row);
        const max = Math.min(headers.length, cells.length);

        for (let index = 0; index < max; index += 1) {
            const headerText = clean(headers[index]).toLowerCase();
            const matched = patterns.some(function(pattern) {
                return pattern.test(headerText);
            });

            if (matched) {
                return cells[index] || null;
            }
        }

        return null;
    }

    function getElementSearchText(element) {
        if (!element) return '';

        return [
            clean(element),
            element.getAttribute('title') || '',
            element.getAttribute('aria-label') || '',
            element.getAttribute('data-original-title') || '',
            element.className || ''
        ].join(' ');
    }

    function normalizePriority(value) {
        const source = clean(value).toLowerCase();
        if (!source) return '';

        if (/\b(critical|urgent|highest|blocker|akutt|haster)\b/.test(source)) return 'Critical';
        if (/\b(high|important|hoy|priority-high|prio-high)\b/.test(source)) return 'High';
        if (/\b(medium|normal|middels|priority-normal|prio-normal)\b/.test(source)) return 'Normal';
        if (/\b(low|lav|priority-low|prio-low)\b/.test(source)) return 'Low';

        return '';
    }

    function getTicketPriority(row, rowData, headers) {
        const headerText = getCellTextByHeader(rowData, headers, [/\bpriority\b/i, /\bprio\b/i]);
        const headerPriority = normalizePriority(headerText);
        if (headerPriority) return headerPriority;

        const headerElement = getCellElementByHeader(row, headers, [/\bpriority\b/i, /\bprio\b/i]);
        const elementPriority = normalizePriority(getElementSearchText(headerElement));
        if (elementPriority) return elementPriority;

        const cells = getRowCells(row);
        for (const cell of cells.slice(0, 10)) {
            const priority = normalizePriority(getElementSearchText(cell));
            if (priority) return priority;
        }

        return CONFIG.DEFAULT_PRIORITY_LABEL;
    }

    function getStrongIdFromLink(row) {
        const links = D.queryAll('a[href]', row);

        for (const link of links) {
            const href = String(link.getAttribute('href') || '');
            const textValue = clean(link);

            const pathMatch = href.match(/(?:ticket|tickets)[^0-9]{0,40}(\d{3,})/i);
            if (pathMatch && pathMatch[1]) return pathMatch[1];

            const queryMatch = href.match(/[?&](?:ticketId|ticket|ticketNumber|id)=(\d{3,})/i);
            if (queryMatch && queryMatch[1]) return queryMatch[1];

            if (/^#?\d{5,}$/.test(textValue)) {
                return textValue.replace(/\D/g, '');
            }
        }

        return '';
    }

    function getStrongIdFromAttributes(row) {
        const attrs = [
            'data-ticket-id',
            'data-ticketid',
            'data-ticket-number',
            'data-ticketnumber',
            'data-case-id',
            'data-id',
            'id'
        ];

        const nodes = [row].concat(D.queryAll('*', row));

        for (const node of nodes) {
            for (const attr of attrs) {
                const value = String(node.getAttribute(attr) || '').trim();
                const match = value.match(/\d{3,}/);
                if (match) return match[0];
            }
        }

        return '';
    }

    function getStrongIdFromHeader(rowData, headers) {
        const value = getCellTextByHeader(rowData, headers, [
            /\bticket\b/i,
            /\bticket id\b/i,
            /\bticket number\b/i,
            /\bcase\b/i,
            /^\bid\b/i,
            /\bnumber\b/i
        ]);

        const match = clean(value).match(/\d{3,}/);
        return match ? match[0] : '';
    }

    function getStrongIdFromCells(rowData) {
        for (const cellText of rowData.cells.slice(0, 6)) {
            const cleaned = clean(cellText);
            const labelled = cleaned.match(/(?:ticket|case|id|nr|number)\D{0,12}(\d{3,})/i);
            if (labelled && labelled[1]) return labelled[1];

            if (/^#?\d{5,}$/.test(cleaned)) {
                return cleaned.replace(/\D/g, '');
            }
        }

        return '';
    }

    function normalizeForSignature(value) {
        return clean(value)
            .toLowerCase()
            .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '')
            .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function makeWeakSignature(rowData, priority, title) {
        const parts = [
            priority,
            title,
            rowData.cells.slice(0, 6).join(' | ')
        ].map(normalizeForSignature).filter(Boolean);

        return parts.join(' || ');
    }

    function getTicketIdentity(row, rowData, headers, priority, title) {
        const strongId =
            getStrongIdFromLink(row) ||
            getStrongIdFromAttributes(row) ||
            getStrongIdFromHeader(rowData, headers) ||
            getStrongIdFromCells(rowData);

        if (strongId) {
            return {
                id: strongId,
                key: 'id:' + strongId,
                strongId: true,
                signature: makeWeakSignature(rowData, priority, title)
            };
        }

        const signature = makeWeakSignature(rowData, priority, title);

        return {
            id: signature,
            key: 'sig:' + signature,
            strongId: false,
            signature: signature
        };
    }

    function getTitleFromLinks(row, ticketId) {
        const links = D.queryAll('a[href]', row);
        const candidates = links
            .map(function(link) {
                return clean(link);
            })
            .filter(function(value) {
                const cleaned = clean(value);
                if (!cleaned || cleaned.length < 3) return false;
                if (ticketId && cleaned === ticketId) return false;
                if (/^#?\d+$/.test(cleaned)) return false;
                if (/^(open|edit|view|show|delete|remove)$/i.test(cleaned)) return false;
                return true;
            });

        candidates.sort(function(a, b) {
            return b.length - a.length;
        });

        return candidates[0] || '';
    }

    function getTitleFromCells(rowData, ticketId, priority) {
        const blocked = new Set([
            clean(ticketId).toLowerCase(),
            clean(priority).toLowerCase(),
            CONFIG.DEFAULT_PRIORITY_LABEL.toLowerCase()
        ]);

        const candidates = rowData.cells
            .map(function(value) {
                return clean(value);
            })
            .filter(function(value) {
                const lower = value.toLowerCase();
                if (!value || value.length < 4) return false;
                if (blocked.has(lower)) return false;
                if (/^#?\d+$/.test(value)) return false;
                if (/^(low|normal|medium|high|critical|urgent)$/i.test(value)) return false;
                if (/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
                return true;
            });

        candidates.sort(function(a, b) {
            return b.length - a.length;
        });

        return candidates[0] || '';
    }

    function getTicketTitle(row, rowData, headers, ticketId, priority) {
        const headerTitle = getCellTextByHeader(rowData, headers, [
            /\btitle\b/i,
            /\bsubject\b/i,
            /\bsummary\b/i,
            /\bdescription\b/i,
            /\berrend\b/i
        ]);

        if (headerTitle) return headerTitle;

        return (
            getTitleFromLinks(row, ticketId) ||
            getTitleFromCells(rowData, ticketId, priority) ||
            (ticketId ? 'Ticket ' + ticketId : 'Untitled ticket')
        );
    }

    function formatTicketLabelParts(priority, title, ticketId) {
        const safePriority = clean(priority) || CONFIG.DEFAULT_PRIORITY_LABEL;
        const safeTitle = clean(title) || (ticketId ? 'Ticket ' + ticketId : 'Untitled ticket');
        return safePriority + ' ' + String.fromCharCode(8212) + ' ' + safeTitle;
    }

    function readCurrentTickets() {
        const rows = collectRowData().filter(isTicketRow);

        return rows.map(function(rowData) {
            const row = rowData.element;
            const headers = getRowHeaders(row);
            const priority = getTicketPriority(row, rowData, headers);
            const temporaryId = getStrongIdFromLink(row) || getStrongIdFromAttributes(row) || getStrongIdFromHeader(rowData, headers) || getStrongIdFromCells(rowData);
            const title = getTicketTitle(row, rowData, headers, temporaryId, priority);
            const identity = getTicketIdentity(row, rowData, headers, priority, title);
            const label = formatTicketLabelParts(priority, title, identity.strongId ? identity.id : '');

            return {
                id: identity.id,
                key: identity.key,
                strongId: identity.strongId,
                signature: identity.signature,
                priority: priority,
                title: title,
                label: label,
                visible: rowData.visible
            };
        }).filter(function(ticket) {
            return !!ticket.key;
        });
    }

    function ticketUniqueKey(ticket) {
        return (ticket && ticket.key) || (ticket && ticket.id) || '';
    }

    function uniqueTickets(tickets) {
        const seen = new Set();
        const result = [];

        (tickets || []).forEach(function(ticket) {
            const key = ticketUniqueKey(ticket);
            if (!key || seen.has(key)) return;
            seen.add(key);
            result.push(ticket);
        });

        return result;
    }

    function saveSnapshot(tickets) {
        const trimmed = uniqueTickets(tickets).slice(0, CONFIG.MAX_STORED_TICKETS);
        writeJson(CONFIG.STORAGE_KEY_SNAPSHOT, {
            savedAt: new Date().toISOString(),
            tickets: trimmed
        });
    }

    function readPendingTickets() {
        const pending = readJson(CONFIG.STORAGE_KEY_PENDING, []);
        return Array.isArray(pending) ? uniqueTickets(pending) : [];
    }

    function savePendingTickets(tickets) {
        const trimmed = uniqueTickets(tickets).slice(0, CONFIG.MAX_PENDING_TICKETS);
        writeJson(CONFIG.STORAGE_KEY_PENDING, trimmed);
        updatePendingBadge(trimmed);
    }

    function clearPendingTickets() {
        savePendingTickets([]);
    }

    function addPendingTickets(tickets) {
        const pending = readPendingTickets();
        savePendingTickets(tickets.concat(pending));
    }

    function formatTicketBody(tickets) {
        return tickets
            .slice(0, CONFIG.MAX_TOAST_TICKETS)
            .map(function(ticket) {
                return ticket.label || ticket.id || ticket.key;
            })
            .join('\n');
    }

    function updatePendingBadge(tickets) {
        const pendingTickets = Array.isArray(tickets) ? tickets : readPendingTickets();
        let badge = D.query('#' + CONFIG.BADGE_ID);

        if (!pendingTickets.length) {
            if (badge) badge.remove();
            return;
        }

        if (!badge) {
            badge = document.createElement('div');
            badge.id = CONFIG.BADGE_ID;
            badge.title = 'New tickets detected. Click to show and clear.';
            badge.addEventListener('click', function() {
                showPendingTickets(true);
            });
            document.body.appendChild(badge);
        }

        badge.textContent = String(pendingTickets.length);
    }

    function showPendingTickets(clearAfterShowing) {
        const pendingTickets = readPendingTickets();
        if (!pendingTickets.length) return;

        const count = pendingTickets.length;
        const title = count === 1 ? 'Pending new ticket' : `${count} pending new tickets`;
        const body = formatTicketBody(pendingTickets);
        const smallText = count > CONFIG.MAX_TOAST_TICKETS
            ? `Showing ${CONFIG.MAX_TOAST_TICKETS} of ${count}. Click toast to clear.`
            : 'Click toast to clear.';

        showToast(title, body, smallText, {
            persistent: true,
            clearPendingOnClick: true
        });

        if (clearAfterShowing) {
            clearPendingTickets();
        }
    }

    function notifyUser(title, body, smallText, options) {
        const opts = options || {};

        playBeep();
        showBrowserNotification(title, body);
        showToast(title, body, smallText, {
            persistent: !!opts.persistentToast,
            clearPendingOnClick: !!opts.clearPendingOnClick
        });
    }

    function alertNewTickets(newTickets) {
        writeJson(CONFIG.STORAGE_KEY_LAST_SEEN, new Date().toISOString());

        const count = newTickets.length;
        const title = count === 1 ? 'New ticket loaded' : `${count} new tickets loaded`;
        const body = formatTicketBody(newTickets);
        const smallText = count > CONFIG.MAX_TOAST_TICKETS
            ? `Showing ${CONFIG.MAX_TOAST_TICKETS} of ${count}. Click toast to close.`
            : 'Click toast to close.';

        addPendingTickets(newTickets);
        notifyUser(title, body, smallText, {
            persistentToast: document.hidden,
            clearPendingOnClick: false
        });

        log('New tickets detected.', newTickets);
    }

    function getNewTickets(currentTickets, previousTickets) {
        const previousIds = new Set();
        const previousKeys = new Set();
        const previousSignatures = new Set();

        (previousTickets || []).forEach(function(ticket) {
            if (!ticket) return;
            if (ticket.strongId && ticket.id) previousIds.add(ticket.id);
            if (ticket.key) previousKeys.add(ticket.key);
            if (ticket.signature) previousSignatures.add(ticket.signature);
        });

        return currentTickets.filter(function(ticket) {
            if (ticket.strongId && ticket.id) {
                return !previousIds.has(ticket.id) && !previousKeys.has(ticket.key);
            }

            return !previousKeys.has(ticket.key) && !previousSignatures.has(ticket.signature);
        });
    }

    function debugState(label, currentTickets, previousSnapshot, newTickets) {
        const snapshotCount = previousSnapshot && Array.isArray(previousSnapshot.tickets)
            ? previousSnapshot.tickets.length
            : 0;

        const state = [label, currentTickets.length, snapshotCount, newTickets.length].join('|');
        if (state === lastDebugState) return;
        lastDebugState = state;

        log(label, {
            currentTickets: currentTickets.length,
            previousSnapshotTickets: snapshotCount,
            newTickets: newTickets.length,
            sampleCurrent: currentTickets.slice(0, 3),
            previousSavedAt: previousSnapshot && previousSnapshot.savedAt
        });
    }

    function checkTickets() {
        applyTimer = 0;

        const currentTickets = uniqueTickets(readCurrentTickets());
        if (!currentTickets.length) {
            debugState('No readable ticket rows yet.', [], readJson(CONFIG.STORAGE_KEY_SNAPSHOT, null), []);
            return;
        }

        const previousSnapshot = readJson(CONFIG.STORAGE_KEY_SNAPSHOT, null);

        if (!previousSnapshot || !Array.isArray(previousSnapshot.tickets)) {
            saveSnapshot(currentTickets);
            debugState('Initial ticket snapshot saved.', currentTickets, previousSnapshot, []);
            return;
        }

        const newTickets = getNewTickets(currentTickets, previousSnapshot.tickets);

        saveSnapshot(currentTickets);
        debugState('Ticket check finished.', currentTickets, previousSnapshot, newTickets);

        if (newTickets.length) {
            alertNewTickets(newTickets);
        }
    }

    function queueCheck(delayMs) {
        applyTimer = D.clearTimer(applyTimer);
        applyTimer = window.setTimeout(checkTickets, typeof delayMs === 'number' ? delayMs : CONFIG.APPLY_DELAY_MS);
    }

    function stopObserver() {
        if (observer) {
            observer.disconnect();
        }

        observerRoot = null;
    }

    function startObserver() {
        const table = getMainTicketTable();
        const wrapper = D.query('.dataTables_wrapper') || (table && table.closest('.dataTables_wrapper')) || table;
        const root = wrapper || document.body || document.documentElement;

        if (!root || observerRoot === root) return;

        stopObserver();

        observer = new MutationObserver(function() {
            queueCheck(CONFIG.APPLY_DELAY_MS);
        });

        observer.observe(root, {
            childList: true,
            subtree: true
        });

        observerRoot = root;
        log('Observer started.', root);
    }

    function startBackgroundChecker() {
        backgroundTimer = D.clearTimer(backgroundTimer);
        backgroundTimer = window.setInterval(function() {
            // Cheap watchdog: content changes are already caught by the
            // observer, so only rebuild and rescan when the observed root was
            // actually detached (e.g. DataTables replaced the wrapper). The
            // previous full rescan every 15s was redundant work, visible or
            // hidden. Alerting still works in hidden tabs: the observer fires
            // there too, and browser timer throttling only delays this
            // watchdog, not detection.
            if (observerRoot && observerRoot.isConnected) return;
            startObserver();
            queueCheck(CONFIG.APPLY_DELAY_MS);
        }, CONFIG.BACKGROUND_CHECK_MS);
    }

    function onVisibilityOrFocusChange() {
        startObserver();
        queueCheck(CONFIG.APPLY_DELAY_MS);

        if (!document.hidden) {
            updatePendingBadge();
            showPendingTickets(false);
        }
    }

    function testNotification() {
        const testId = 'test-' + Date.now();
        const testTicket = {
            id: testId,
            key: 'id:' + testId,
            strongId: true,
            signature: 'test-' + testId,
            priority: 'High',
            title: 'Test ticket notification',
            label: formatTicketLabelParts('High', 'Test ticket notification', testId)
        };

        addPendingTickets([testTicket]);

        notifyUser('Test ticket notification', formatTicketBody([testTicket]), 'Click toast to close.', {
            persistentToast: false,
            clearPendingOnClick: false
        });
    }

    function resetSnapshot() {
        localStorage.removeItem(CONFIG.STORAGE_KEY_SNAPSHOT);
        clearPendingTickets();
        queueCheck(50);
        log('Snapshot reset. The next detected list becomes the new baseline.');
    }

    function status() {
        const currentTickets = uniqueTickets(readCurrentTickets());
        const previousSnapshot = readJson(CONFIG.STORAGE_KEY_SNAPSHOT, null);
        const previousTickets = previousSnapshot && Array.isArray(previousSnapshot.tickets) ? previousSnapshot.tickets : [];
        const newTickets = previousTickets.length ? getNewTickets(currentTickets, previousTickets) : [];

        return {
            version: SCRIPT.version,
            loaded: true,
            documentHidden: document.hidden,
            soundEnabled: SOUND_ENABLED,
            visualToasterEnabled: VISUAL_TOASTER_ENABLED,
            tableCount: getTicketTables().length,
            rowCount: collectRowData().filter(isTicketRow).length,
            currentTicketCount: currentTickets.length,
            snapshotTicketCount: previousTickets.length,
            pendingTicketCount: readPendingTickets().length,
            wouldNotifyCountNow: newTickets.length,
            currentTickets: currentTickets.slice(0, 10),
            wouldNotifyNow: newTickets.slice(0, 10),
            snapshotSavedAt: previousSnapshot && previousSnapshot.savedAt
        };
    }

    function exposeDebugApi() {
        window.PCM_NewTicketNotifier = {
            version: SCRIPT.version,
            test: testNotification,
            check: checkTickets,
            status: status,
            resetSnapshot: resetSnapshot,
            clearPending: clearPendingTickets,
            readCurrentTickets: readCurrentTickets,
            readPendingTickets: readPendingTickets
        };
    }

    function readyTest() {
        return !!(document.body && getMainTicketTable());
    }

    function start() {
        if (started) return;
        started = true;

        D.ensureStyleTag(CONFIG.STYLE_ID, CSS);

        exposeDebugApi();
        setupFirstInteractionUnlocks();
        updatePendingBadge();
        startObserver();
        startBackgroundChecker();
        queueCheck(50);
        window.setTimeout(function() {
            queueCheck(50);
        }, CONFIG.STARTUP_SECOND_CHECK_MS);

        if (!document.hidden) {
            showPendingTickets(false);
        }

        document.addEventListener('visibilitychange', onVisibilityOrFocusChange, false);
        window.addEventListener('focus', onVisibilityOrFocusChange, false);

        log('Started.', {
            soundEnabled: SOUND_ENABLED,
            visualToasterEnabled: VISUAL_TOASTER_ENABLED
        });
    }

    D.bootUntil(readyTest, start, {
        BOOT_MAX_TRIES: 60,
        BOOT_INTERVAL_MS: 250
    });
})();
