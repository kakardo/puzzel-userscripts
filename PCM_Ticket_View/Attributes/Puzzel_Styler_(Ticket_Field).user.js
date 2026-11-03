// @file_name = Puzzel_Styler_(Ticket_Field).user.js
// @author = Kardo Rostam
// @version = 4.4_2026-11-03
// @created = 2026-03-31 00:00

// ==UserScript==
// @name         Puzzel Styler (Ticket Field)
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      4.4_2026-11-03
// @description  Highlights Assigned-To, Status and Priority fields with safer refresh after programmatic updates and scroll return. Priority uses the same colours as the priority badges in the tickets list (Junk grey, Lowest light blue, Low blue, Normal green, High orange, Highest red), for the field and for each entry in its open list. A click on Priority opens the script's own list in the same style as the Priority search in the tickets list (rounded colour blocks, the current one faded, a white ring under the mouse); a pick sets the field like a pick by hand, and the keyboard keeps the browser's own behaviour.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/Puzzel_Styler_(Ticket_Field).user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/Puzzel_Styler_(Ticket_Field).user.js
// ==/UserScript==

(function() {
    'use strict';

    const TARGET_NAME = 'Kardo Rostam';
    const VIEWPORT_REFRESH_DEBOUNCE_MS = 90;

    const STATUS_STYLES = {
        open:     { key: 'open',     fill: '#6A8CFF', edge: '#536dcc', text: '#ffffff', bold: true, role: 'status' },
        pending:  { key: 'pending',  fill: '#4AA84E', edge: '#3a833d', text: '#ffffff', bold: true, role: 'status' },
        on_hold:  { key: 'on_hold',  fill: '#C44EDB', edge: '#993dad', text: '#ffffff', bold: true, role: 'status' },
        resolved: { key: 'resolved', fill: '#D57A1F', edge: '#a66018', text: '#ffffff', bold: true, role: 'status' },
        closed:   { key: 'closed',   fill: '#2E3A47', edge: '#242d37', text: '#ffffff', bold: true, role: 'status' },
        error:    { key: 'error',    fill: '#E04343', edge: '#b03535', text: '#ffffff', bold: true, role: 'status' }
    };

    // PCM's own priority badge colours from the tickets list
    // (label-priority-*), with a darker ring.
    const PRIORITY_STYLES = {
        junk:    { key: 'junk',    fill: '#9ea3b1', edge: '#7e828e', text: '#ffffff', bold: true, role: 'priority' },
        lowest:  { key: 'lowest',  fill: '#b6c1f8', edge: '#919ac6', text: '#ffffff', bold: true, role: 'priority' },
        low:     { key: 'low',     fill: '#879af4', edge: '#6c7bc3', text: '#ffffff', bold: true, role: 'priority' },
        normal:  { key: 'normal',  fill: '#85d263', edge: '#6aa84f', text: '#ffffff', bold: true, role: 'priority' },
        high:    { key: 'high',    fill: '#ff9900', edge: '#cc7a00', text: '#ffffff', bold: true, role: 'priority' },
        highest: { key: 'highest', fill: '#f73633', edge: '#c62b29', text: '#ffffff', bold: true, role: 'priority' }
    };

    // The Priority dropdown of the Attributes form, by the names PCM uses
    // for its ticket fields (the Status one is #ticket_status).
    const PRIORITY_SELECTOR = '#ticket_priority, #ticket_priority_id, select[name="ticket[priority]"], select[name="ticket[priority_id]"]';

    function styledWrapper(select) {
        return select && select.closest ? select.closest('label.select') : null;
    }

    // Make TARGET_NAME easy to find in the open Assigned To list: the
    // matching option gets the yellow treatment whether or not it is the
    // current assignee. Runs on every runtime update, so rebuilt option
    // lists stay covered.
    function styleTargetOptions(roleName, select) {
        if (roleName !== 'assigned' || !select || !select.options) return;

        for (const option of select.options) {
            const matches = (option.textContent || '').includes(TARGET_NAME);
            option.style.backgroundColor = matches ? '#ffef96' : '';
            option.style.fontWeight = matches ? '700' : '';
        }
    }

    // The open Priority list would otherwise take the field's own colour
    // for every entry; each entry gets its own priority colour instead.
    // Written only when an entry's colour differs.
    function stylePriorityOptions(roleName, select) {
        if (roleName !== 'priority' || !select || !select.options) return;

        for (const option of select.options) {
            const style = PRIORITY_STYLES[normalizeStatusKey(option.textContent)];
            const fill = style ? style.fill : '';
            const text = style ? style.text : '';
            if (option.dataset.pfsFill === fill) continue;
            option.dataset.pfsFill = fill;
            option.style.backgroundColor = fill;
            option.style.color = text;
            option.style.fontWeight = style ? '700' : '';
        }
    }

    function resetStyledSelect(roleName, select) {
        if (!select) return;

        // The list highlight stays even when the field itself is unstyled;
        // that is exactly when the entry needs to be findable.
        styleTargetOptions(roleName, select);
        stylePriorityOptions(roleName, select);

        const wrap = styledWrapper(select);
        if (wrap) {
            wrap.classList.remove('pfs-styled-wrap');
            wrap.style.removeProperty('--pfs-edge-color');
        }

        select.removeAttribute('data-pfs-styled');
        select.removeAttribute('data-pfs-role');
        select.style.removeProperty('--pfs-edge-color');
        select.style.background = '';
        select.style.backgroundColor = '';
        select.style.border = '';
        select.style.borderRadius = '';
        select.style.boxSizing = '';
        select.style.backgroundClip = '';
        select.style.color = '';
        select.style.fontWeight = '';
        select.style.appearance = '';
        select.style.webkitAppearance = '';
        select.style.MozAppearance = '';
        select.style.outline = '';
        select.style.outlineOffset = '';
        select.style.boxShadow = '';

        if (roleName === 'assigned') {
            delete select.dataset.pfsAssignedState;
        }
        if (roleName === 'status') {
            delete select.dataset.pfsStatusValue;
        }
    }

    function applyStableNativeStyle(roleName, select, state) {
        if (!select || !state) return;

        styleTargetOptions(roleName, select);
        stylePriorityOptions(roleName, select);

        // SmartAdmin's label.select wrapper paints its arrow element over the
        // select's right edge, cutting the ring. The ring is drawn on the
        // wrapper via ::after instead, above the arrow (see cssText below).
        const wrap = styledWrapper(select);
        if (wrap) {
            wrap.classList.add('pfs-styled-wrap');
            wrap.style.setProperty('--pfs-edge-color', state.edge);
        }

        select.setAttribute('data-pfs-styled', 'true');
        select.setAttribute('data-pfs-role', state.role || roleName);
        select.style.setProperty('--pfs-edge-color', state.edge);
        select.style.boxSizing = 'border-box';
        select.style.border = '1px solid transparent';
        select.style.borderRadius = '0';
        select.style.backgroundClip = 'padding-box';
        select.style.backgroundColor = state.fill;
        select.style.color = state.text;
        select.style.fontWeight = state.bold ? 'bold' : '';
        select.style.appearance = '';
        select.style.webkitAppearance = '';
        select.style.MozAppearance = '';
        select.style.outline = 'none';
        select.style.boxShadow = '0 0 0 2px ' + state.edge;

        if (roleName === 'assigned') {
            select.dataset.pfsAssignedState = state.key;
        }
        if (roleName === 'status') {
            select.dataset.pfsStatusValue = state.key;
        }
    }

    function getSelectedOptionText(select) {
        if (!select || !select.options || select.selectedIndex < 0) return '';

        const option = select.options[select.selectedIndex];
        return option ? option.textContent.trim() : '';
    }

    function normalizeStatusKey(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_');
    }

    function getFieldState(roleName, select) {
        if (!select) return null;

        if (roleName === 'assigned') {
            const selectedText = getSelectedOptionText(select);

            if (!selectedText.includes(TARGET_NAME)) return null;

            return {
                key: 'match',
                fill: '#ffef96',
                edge: '#ff9800',
                text: '#333333',
                bold: true,
                role: 'assigned'
            };
        }

        if (roleName === 'status') {
            const valueKey = normalizeStatusKey(select.value);
            const textKey = normalizeStatusKey(getSelectedOptionText(select));
            const stateKey = STATUS_STYLES[valueKey] ? valueKey : textKey;

            return STATUS_STYLES[stateKey] || null;
        }

        if (roleName === 'priority') {
            return PRIORITY_STYLES[normalizeStatusKey(getSelectedOptionText(select))] || null;
        }

        return null;
    }

    if (!window.PCM_DOM || typeof window.PCM_DOM.createFieldRuntime !== 'function') {
        console.error('PCM_DOM shared runtime is not loaded.');
        return;
    }

    const runtime = window.PCM_DOM.createFieldRuntime({
        styleId: 'pfs-ticket-field-style',
        cssText: `
            #user-select[data-pfs-styled="true"],
            #user-select[data-pfs-styled="true"]:hover,
            #user-select[data-pfs-styled="true"]:focus,
            #user-select[data-pfs-styled="true"]:active,
            #ticket_status[data-pfs-styled="true"],
            #ticket_status[data-pfs-styled="true"]:hover,
            #ticket_status[data-pfs-styled="true"]:focus,
            #ticket_status[data-pfs-styled="true"]:active,
            select[data-pfs-role="priority"][data-pfs-styled="true"],
            select[data-pfs-role="priority"][data-pfs-styled="true"]:hover,
            select[data-pfs-role="priority"][data-pfs-styled="true"]:focus,
            select[data-pfs-role="priority"][data-pfs-styled="true"]:active {
                outline: none !important;
                border-radius: 0 !important;
                box-shadow: 0 0 0 2px var(--pfs-edge-color) !important;
            }

            /* Wrapped selects: the ring moves to an overlay on the SmartAdmin
               wrapper so it paints ABOVE the arrow element, which otherwise
               covers the ring's right edge. pointer-events keeps it clickable. */
            label.select.pfs-styled-wrap {
                position: relative;
            }

            label.select.pfs-styled-wrap::after {
                content: '';
                position: absolute;
                top: 0;
                right: 0;
                bottom: 0;
                left: 0;
                pointer-events: none;
                z-index: 2;
                box-shadow: inset 0 0 0 2px var(--pfs-edge-color);
            }

            label.select.pfs-styled-wrap #user-select[data-pfs-styled="true"],
            label.select.pfs-styled-wrap #user-select[data-pfs-styled="true"]:hover,
            label.select.pfs-styled-wrap #user-select[data-pfs-styled="true"]:focus,
            label.select.pfs-styled-wrap #user-select[data-pfs-styled="true"]:active,
            label.select.pfs-styled-wrap #ticket_status[data-pfs-styled="true"],
            label.select.pfs-styled-wrap #ticket_status[data-pfs-styled="true"]:hover,
            label.select.pfs-styled-wrap #ticket_status[data-pfs-styled="true"]:focus,
            label.select.pfs-styled-wrap #ticket_status[data-pfs-styled="true"]:active,
            label.select.pfs-styled-wrap select[data-pfs-role="priority"][data-pfs-styled="true"],
            label.select.pfs-styled-wrap select[data-pfs-role="priority"][data-pfs-styled="true"]:hover,
            label.select.pfs-styled-wrap select[data-pfs-role="priority"][data-pfs-styled="true"]:focus,
            label.select.pfs-styled-wrap select[data-pfs-role="priority"][data-pfs-styled="true"]:active {
                box-shadow: none !important;
            }

            /* The script's own Priority list (see PRIORITY LIST below), in
               the same style as the Priority search in the tickets list. */
            #pfs-priority-list {
                position: fixed;
                z-index: 3000;
                box-sizing: border-box;
                padding: 3px 0;
                border: 1px solid rgba(0,0,0,.2);
                border-radius: 4px;
                background: #ffffff;
                box-shadow: 0 8px 20px rgba(0,0,0,.25);
                font-size: 13px;
            }
            #pfs-priority-list .pfs-prio-item {
                margin: 2px 4px;
                padding: 5px 10px;
                border-radius: 4px;
                color: #ffffff;
                font-weight: 700;
                text-shadow: 0 1px 1px rgba(0,0,0,.35);
                cursor: pointer;
                user-select: none;
            }
            #pfs-priority-list .pfs-prio-item:hover {
                filter: brightness(1.08);
                box-shadow: inset 0 0 0 2px rgba(255,255,255,.9);
            }
            #pfs-priority-list .pfs-prio-item.pfs-current {
                opacity: .4;
            }
        `,
        fields: [
            { key: 'assigned', selector: '#user-select' },
            { key: 'status', selector: '#ticket_status' },
            { key: 'priority', selector: PRIORITY_SELECTOR }
        ],
        getState: function(roleName, select) {
            return getFieldState(roleName, select);
        },
        applyState: function(roleName, select, state) {
            applyStableNativeStyle(roleName, select, state);
        },
        resetState: function(roleName, select) {
            resetStyledSelect(roleName, select);
        }
    });

    // PRIORITY LIST
    // The browser's own dropdown cannot show rounded entries, fade the
    // current one or ring the one under the mouse, so a press on the
    // Priority field opens the script's own list instead. A pick sets the
    // field the way picking by hand does (one change event, then PCM is
    // asked to re-check the form), so PCM and the unsaved warning see it.
    // The keyboard keeps the browser's own behaviour. Before PCM has
    // finished preparing the form (the first moment after a ticket
    // opens) the browser's own list is used, since a change made then is
    // recorded by PCM as the saved value. Listeners for closing the list
    // exist only while it is open.
    const LIST_ID = 'pfs-priority-list';

    function prioritySelectFrom(target) {
        const select = target && target.closest ? target.closest('select') : null;
        return select && select.matches(PRIORITY_SELECTOR) ? select : null;
    }

    function formReady(select) {
        const D = window.PCM_DOM;
        return !D || typeof D.formReady !== 'function' || D.formReady(select);
    }

    function closeList() {
        const list = document.getElementById(LIST_ID);
        if (list) list.remove();
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onListKey, true);
        window.removeEventListener('scroll', closeList, true);
        window.removeEventListener('resize', closeList, true);
    }

    function onOutside(event) {
        const list = document.getElementById(LIST_ID);
        if (list && !list.contains(event.target) && !prioritySelectFrom(event.target)) closeList();
    }

    function onListKey(event) {
        if (event.key === 'Escape' || event.key === 'Tab') closeList();
    }

    function pick(select, value) {
        closeList();
        if (select.value === value) return;
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const D = window.PCM_DOM;
        if (D && typeof D.recheckForm === 'function') D.recheckForm(select);
    }

    function openList(select) {
        closeList();
        const box = select.getBoundingClientRect();
        const list = document.createElement('div');
        list.id = LIST_ID;
        list.style.left = Math.round(box.left) + 'px';
        list.style.top = Math.round(box.bottom + 2) + 'px';
        list.style.minWidth = Math.round(box.width) + 'px';

        for (const option of select.options) {
            if (option.disabled) continue;
            const style = PRIORITY_STYLES[normalizeStatusKey(option.textContent)];
            const item = document.createElement('div');
            item.className = 'pfs-prio-item' + (option.value === select.value ? ' pfs-current' : '');
            item.textContent = option.textContent.trim();
            item.style.backgroundColor = style ? style.fill : '#9ea3b1';
            item.addEventListener('mousedown', function (event) { event.preventDefault(); });
            item.addEventListener('click', function () { pick(select, option.value); });
            list.appendChild(item);
        }

        document.body.appendChild(list);

        // Opens upwards when there is no room below.
        const height = list.getBoundingClientRect().height;
        if (box.bottom + 2 + height > window.innerHeight && box.top - 2 - height > 0) {
            list.style.top = Math.round(box.top - 2 - height) + 'px';
        }

        document.addEventListener('mousedown', onOutside, true);
        document.addEventListener('keydown', onListKey, true);
        window.addEventListener('scroll', closeList, true);
        window.addEventListener('resize', closeList, true);
    }

    document.addEventListener('mousedown', function (event) {
        if (event.button !== 0) return;
        const select = prioritySelectFrom(event.target);
        if (!select || select.disabled || !formReady(select)) return;
        event.preventDefault();
        select.focus();
        if (document.getElementById(LIST_ID)) closeList();
        else openList(select);
    }, true);

    let viewportRefreshTimer = 0;

    function clearViewportRefreshTimer() {
        if (viewportRefreshTimer) {
            clearTimeout(viewportRefreshTimer);
            viewportRefreshTimer = 0;
        }
    }

    function queueViewportRefresh() {
        if (document.hidden) return;

        clearViewportRefreshTimer();
        viewportRefreshTimer = window.setTimeout(function() {
            viewportRefreshTimer = 0;
            runtime.queueRefresh(0);
        }, VIEWPORT_REFRESH_DEBOUNCE_MS);
    }

    window.addEventListener('scroll', queueViewportRefresh, { passive: true });
    window.addEventListener('resize', queueViewportRefresh, { passive: true });
    window.addEventListener('pageshow', queueViewportRefresh, false);
    window.addEventListener('focus', queueViewportRefresh, false);

    runtime.start();
})();
