// @file_name = Puzzel_Styler_(Ticket_Field).user.js
// @author = Kardo Rostam
// @version = 3.6_2026-08-27
// @created = 2026-03-31 00:00

// ==UserScript==
// @name         Puzzel Styler (Ticket Field)
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      3.6_2026-08-27
// @description  Highlights Assigned-To and Status fields with safer refresh after programmatic updates and scroll return.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/DOM/PCM_DOM_Shared_Local.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Puzzel_Styler_(Ticket_Field).user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Puzzel_Styler_(Ticket_Field).user.js
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

    function resetStyledSelect(roleName, select) {
        if (!select) return;

        // The list highlight stays even when the field itself is unstyled;
        // that is exactly when the entry needs to be findable.
        styleTargetOptions(roleName, select);

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
            #ticket_status[data-pfs-styled="true"]:active {
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
            label.select.pfs-styled-wrap #ticket_status[data-pfs-styled="true"]:active {
                box-shadow: none !important;
            }
        `,
        fields: [
            { key: 'assigned', selector: '#user-select' },
            { key: 'status', selector: '#ticket_status' }
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
