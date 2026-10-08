// @file_name = PCM_Show_Organisation_Info.user.js
// @author = Kardo Rostam
// @version = 1.1_2026-10-08
// @created = 2026-10-08 08:45

// ==UserScript==
// @name         PCM Show Organisation Info
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.1_2026-10-08
// @description  Shows the Organisation Information module right after you save an organisation in Attributes, without reloading the page. PCM only builds that module when the page loads, so on a ticket that had no organisation it stayed missing until a reload. After an Attributes save that changed the organisation, the script loads the ticket page once in the background and puts its Organisation Information module in place (or updates it, or removes it when the organisation was cleared). Event-driven via jQuery's ajaxComplete: no observers, no polling, one background request per organisation change. Afterwards it signals the PCM Ticket Info Extractor (event pcm-organisation-info-refreshed) to read the ticket again, so the scripts that use its values update too.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Show_Organisation_Info.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Attributes/PCM_Show_Organisation_Info.user.js
// ==/UserScript==

(function () {
    'use strict';

    // INTERNAL SETTINGS
    // Attributes Save sends PATCH /tickets/<number> (jQuery ajax) and PCM
    // updates parts of the page from the JSON answer, but never the
    // Organisation Information module (#wid-organisation).
    var LOG = '[PCM Show Organisation Info]';
    var WIDGET_ID = 'wid-organisation';
    var FORM_SELECTOR = '#ticket-attributes-form';
    var ORG_FIELD_SELECTOR = 'select[name*="organisation"], input[name*="organisation"]';
    var FALLBACK_BEFORE_ID = 'wid-customer-intelligence';
    var BOOT_MAX_TRIES = 40;
    var BOOT_INTERVAL_MS = 500;

    var ticketMatch = window.location.pathname.match(/^\/tickets\/(\d+)/);
    if (!ticketMatch) return;
    var TICKET = ticketMatch[1];
    var SAVE_URL_RE = new RegExp('^(https://[^/]+)?/tickets/' + TICKET + '(\\?|$)');

    // The organisation value at the last page load or refresh. Only a
    // save that changes it triggers a refresh.
    var syncedOrg = null;
    var busy = false;

    function currentOrg() {
        var form = document.querySelector(FORM_SELECTOR);
        var field = form && form.querySelector(ORG_FIELD_SELECTOR);
        return field ? (field.value || '') : null;
    }

    // Where the module goes: before the same widget that follows it on a
    // fresh page load, else before Customer Intelligence.
    function placeWidget(fresh, freshDoc) {
        var live = document.getElementById(WIDGET_ID);
        if (live) {
            live.replaceWith(fresh);
            return true;
        }
        var anchor = null;
        var next = freshDoc.getElementById(WIDGET_ID).nextElementSibling;
        while (next && !anchor) {
            if (next.id) anchor = document.getElementById(next.id);
            next = next.nextElementSibling;
        }
        anchor = anchor || document.getElementById(FALLBACK_BEFORE_ID);
        if (!anchor || !anchor.parentNode) return false;
        anchor.parentNode.insertBefore(fresh, anchor);
        return true;
    }

    // On page load PCM's widget code marks each module's header and content
    // (role="heading" / role="content"), and its stylesheet sizes the
    // content by that mark. A module taken from the background page has
    // not been through that code, so without the marks its content got
    // an extra empty line on top.
    function matchPcmLayout(widget) {
        var header = widget.querySelector(':scope > header');
        var content = widget.querySelector(':scope > div');
        if (header && !header.getAttribute('role')) header.setAttribute('role', 'heading');
        if (content && !content.getAttribute('role')) content.setAttribute('role', 'content');
    }

    function refreshWidget() {
        if (busy) return;
        busy = true;
        fetch('/tickets/' + TICKET, { credentials: 'same-origin' }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
        }).then(function (html) {
            var freshDoc = new DOMParser().parseFromString(html, 'text/html');
            var widget = freshDoc.getElementById(WIDGET_ID);
            if (!widget) {
                // Organisation cleared: the module is gone after a reload too.
                var live = document.getElementById(WIDGET_ID);
                if (live) live.remove();
            } else {
                var fresh = document.importNode(widget, true);
                matchPcmLayout(fresh);
                if (!placeWidget(fresh, freshDoc)) console.warn(LOG, 'no place found for the module');
            }
            // Wake-up for the PCM Ticket Info Extractor, which reads the
            // ticket again and announces the new values to the scripts
            // that use them (Partner Highlight, Form Buttons and others).
            document.dispatchEvent(new CustomEvent('pcm-organisation-info-refreshed'));
        }).catch(function (err) {
            console.warn(LOG, 'refresh failed, reload the page to see the module', err);
        }).then(function () {
            busy = false;
        });
    }

    function onAjaxComplete(event, xhr, settings) {
        if (!settings || String(settings.type || settings.method).toUpperCase() !== 'PATCH') return;
        if (!SAVE_URL_RE.test(settings.url || '') || xhr.status < 200 || xhr.status >= 300) return;
        var org = currentOrg();
        var missing = !document.getElementById(WIDGET_ID);
        // Unknown field (null): refresh only when the module is missing.
        if (org === null ? !missing : org === syncedOrg) return;
        syncedOrg = org;
        refreshWidget();
    }

    // Bounded boot: waits for jQuery, then runs on its ajax events only.
    var tries = 0;
    function start() {
        var jq = window.jQuery;
        if (!jq) {
            tries += 1;
            if (tries < BOOT_MAX_TRIES) window.setTimeout(start, BOOT_INTERVAL_MS);
            return;
        }
        syncedOrg = currentOrg();
        jq(document).on('ajaxComplete', onAjaxComplete);
    }

    start();
})();
