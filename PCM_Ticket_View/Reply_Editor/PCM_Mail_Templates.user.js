// @file_name = PCM_Mail_Templates.user.js
// @author = Kardo Rostam
// @version = 2.2_2026-10-07
// @created = 2026-09-01 10:04
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples).

// ==UserScript==
// @name         PCM Mail Templates
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      2.2_2026-10-07
// @description  Adds a row of template buttons and small dropdown menus above the Summernote reply editor. Pressing one appends the template to the end of the mail body. Templates live in one TEMPLATES list at the top, shown in its order, so own templates and PCM templates can be mixed; each entry can have a colour, and entries can be grouped into dropdown menus. Own templates support {firstName}, {fullName}, {customer}, {partner} (read from the PCM Ticket Info Extractor outputs when present, names fall back to the To address) and {ticket} placeholders; {name} still works as {firstName}. Unresolved names are dropped, other unresolved placeholders stay visible so they are easy to spot. Entries with a templateId are one-press shortcuts to PCM's own Insert Template entries, fetched by template id from the same /templates/{id}/use endpoint the modal calls, so variables are filled server-side and the text stays maintained in PCM. The editor and the bar are marked translate="no" so page translation never rewrites the mail while typing. Event-driven via a scoped MutationObserver behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Mail_Templates.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Mail_Templates.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     * TEMPLATES is one list, shown left to right in this order, so own
     * templates and PCM's templates can be mixed freely. Each entry is:
     *   { label, text, color }        own template, appended as text
     *   { label, templateId, color }  PCM's own Insert Template entry,
     *                                 fetched by its id (option value in
     *                                 the Insert Template dropdown), so PCM
     *                                 fills its own variables
     *   { label, color, items: [...] } a dropdown menu; items are entries
     *                                 of either kind above
     * color is the button fill (white text); leave it out for PCM's plain
     * grey button. Give related templates the same colour.
     *
     * Placeholders inside `text`:
     *   {firstName} the customer's first name from the ticket
     *   {fullName}  the customer's full name from the ticket
     *   {customer}  the customer company (the ticket's organisation)
     *   {partner}   the partner that manages the customer (the
     *               organisation's Partner attribute)
     *   {ticket}    the ticket number, taken from the page URL or the
     *               [123456] tag in the reply subject
     *   {name}      older name for {firstName}, still works
     * Names, customer and partner are read from the PCM Ticket Info
     * Extractor outputs (window.PCM_TICKET_INFO or its published DOM
     * elements). Without the Extractor, the names are guessed from the
     * To address; customer and partner need the Extractor.
     * If a name cannot be resolved, the placeholder AND any spaces just
     * before it are removed, so 'Hello {firstName},' cleanly becomes
     * 'Hello,'. An unresolved {customer}, {partner} or {ticket} stays
     * visible so you notice it before sending.
     *
     * Every newline in `text` is a new line in the mail; empty lines
     * become empty paragraphs (same as pressing Enter in the editor).
     * End a template with \n to leave a blank line to write on.
     ******************************************************************/
    // One colour per family of related templates.
    var COLORS = {
        hello: '#3f6fd6',     // greetings
        account: '#0b7285',   // asking for the account number
        handover: '#7b2cbf',  // incident handover and assigning
        evidence: '#e65100',  // asking for call examples and logs
        closing: '#2f7d2f'    // follow-up, no-reply and partner replies
    };

    var TEMPLATES = [
        {
            label: 'Hello (EN)', color: COLORS.hello,
            text: 'Hello {firstName},\n\nThank you for contacting Puzzel support.\n\n'
        },
        {
            label: 'Hej (SE)', color: COLORS.hello,
            text: 'Hej {firstName},\n\nTack för att du kontaktar Puzzel support.\n\n'
        },
        {
            label: 'AccNr[ENG]', color: COLORS.account,
            text: 'Hello {firstName},\n\nThank you for contacting Puzzel support.\n\n' +
            'Before we begin, could I get your Customer ID?\nWe are going to need it to find the correct solution.\n\n' +
            'Thank you in advance!'
        },
        {
            label: 'IF', color: COLORS.handover,
            text: 'Hello,\n\nThank you for contacting Puzzel Customer Care.\n\n' +
            'I have reviewed your ticket and identified that this incident will require further investigation by our ' +
            'second line engineers.\n\nWe will contact you as soon as we have an update.'
        },
        { label: 'Assign', templateId: 37718, color: COLORS.handover },
        {
            label: 'CallEx', color: COLORS.evidence,
            text: 'Hello {firstName},\n\nThank you for contacting Puzzel support.\n\n' +
            'To help you with the below, we need a call example: the caller\'s number plus the date and time of ' +
            'the call.\nIf you can find the call in the archive in Puzzel Admin, that\'s even better: expand the call ' +
            'details and send us the "Call ID" and "Session ID". That lets us look up the right log files quickly.\n\n' +
            'See how to here:\nhttps://www.puzzel.com/help?pzlRoute=article&pzlArticleId=498'
        },
        {
            label: 'Logs', color: COLORS.evidence,
            text: 'Hello {firstName},\n\nThank you for contacting Puzzel support.\n\n' +
            'To help us investigate this issue, please provide browser console logs from a browser where the issue occurs.\n' +
            'These logs can provide valuable information for our investigation.\n\n' +
            'Instructions for capturing console logs:\nhttps://www.puzzel.com/help?pzlRoute=article&pzlArticleId=253903\n\n' +
            'Once we have the console logs, we will continue our investigation.\n\nHave a great day!'
        },
        // A dropdown: own templates and PCM templates mixed, in the order
        // they are used (check in, close without reply, hand to partner).
        { label: 'FollowUp', color: COLORS.closing, items: [
            { label: 'CheckIn', text: 'Hello {firstName},\n\nJust checking in.\n\n' },
            { label: 'NoReplyENG', templateId: 8495 },
            { label: 'NoReplySWE', templateId: 8448 },
            {
                label: 'PartnerENG',
                text: 'Hello {firstName},\n\nThank you for contacting Puzzel Support.\n\n' +
                'Your Puzzel services are managed by {partner}, so all support requests need to go through ' +
                '{partner} support. They can then raise the case with us on your behalf if needed.\n\n' +
                'We are sorry that we cannot help you directly with this request. We understand that you may have ' +
                'contacted Puzzel Support directly in the past, and we appreciate your understanding.'
            }
        ] }
    ];

    // Email domains that are never the customer (skipped when the
    // fallback resolves the names from the reply block, so the From line
    // does not win).
    var IGNORE_EMAIL_DOMAINS = ['puzzel.com'];

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var BAR_CLASS = 'pcm-mail-templates';
    var STYLE_ID = 'pcm-mail-templates-style';
    var DONE_FLAG = 'pcmMailTemplates';
    var OBSERVER_DELAY_MS = 150;

    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate || !D.editorAppendHtml || !D.flashLabel) {
        console.error('[PCM Mail Templates] PCM_DOM shared library missing or stale (lib 2.0 or newer required), aborting.');
        return;
    }

    var CSS = [
        '.' + BAR_CLASS + ' {',
        '    display: flex;',
        '    flex-wrap: wrap;',
        '    align-items: center;',
        '    gap: 4px;',
        '    margin: 6px 0 4px 0;',
        '}',
        '.' + BAR_CLASS + ' .pcm-tpl-btn {',
        '    font-size: 12px;',
        '    padding: 3px 10px;',
        '}',
        '.' + BAR_CLASS + ' .pcm-tpl-colored,',
        '.' + BAR_CLASS + ' .pcm-tpl-colored:hover,',
        '.' + BAR_CLASS + ' .pcm-tpl-colored:focus {',
        '    color: #fff !important;',
        '    font-weight: 600;',
        '}',
        '.' + BAR_CLASS + ' .pcm-tpl-colored:hover {',
        '    filter: brightness(1.12);',
        '}',
        '.' + BAR_CLASS + ' select.pcm-tpl-colored option {',
        '    color: #333;',
        '    background: #fff;',
        '}',
        '.' + BAR_CLASS + ' select.pcm-tpl-select {',
        '    font-size: 12px;',
        '    padding: 2px 4px;',
        '    height: 26px;',
        '    max-width: 160px;',
        '    border: 1px solid #ccc;',
        '    border-radius: 3px;',
        '    background: #fff;',
        '    cursor: pointer;',
        '}'
    ].join('\n');

    var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

    // The reply block: the container that holds From/To and the editor.
    function replyBlock(editorContainer) {
        return editorContainer.closest('form') ||
            editorContainer.closest('.timeline-item, .panel, .jarviswidget') ||
            editorContainer.parentElement ||
            document.body;
    }

    function ticketNumber(block) {
        var m = window.location.pathname.match(/\/tickets\/(\d+)/);
        if (m) return m[1];
        m = (block.textContent || '').match(/\[(\d{4,})\]/);
        return m ? m[1] : null;
    }

    // First email address in the reply block that is outside the mail
    // body and not on an ignored domain. DOM order means the To field
    // wins over addresses quoted in the body.
    function recipientEmail(block, editable) {
        var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        var node;
        while ((node = walker.nextNode())) {
            if (editable && editable.contains(node)) continue;
            var m = node.nodeValue.match(EMAIL_RE);
            if (!m) continue;
            var domain = m[0].split('@')[1].toLowerCase();
            var ignored = IGNORE_EMAIL_DOMAINS.some(function (d) {
                return domain === d.toLowerCase();
            });
            if (!ignored) return m[0];
        }
        return null;
    }

    function capitalise(word) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }

    // 'first.last@example.com' gives 'First Last'.
    function nameFromEmail(email) {
        var parts = email.split('@')[0].split(/[._-]/).map(function (p) {
            return p.replace(/\d+/g, '');
        }).filter(Boolean);
        return parts.length ? parts.map(capitalise).join(' ') : null;
    }

    // Values published by the PCM Ticket Info Extractor. Soft
    // dependency: read when they exist, never required. Tries the global
    // object, then the wrapper dataset, then the fixed value element.
    function ticketInfo(key, elementId) {
        var info = window.PCM_TICKET_INFO || {};
        var value = D.cleanText(info[key] || '');
        if (!value) {
            var root = document.getElementById('pcm-ticket-info');
            value = root ? D.cleanText(root.dataset[key] || '') : '';
        }
        if (!value) {
            var el = document.getElementById(elementId);
            value = el ? D.cleanText(el.textContent) : '';
        }
        return value || null;
    }

    function resolvePlaceholders(text, container) {
        var block = replyBlock(container);
        var editable = container.querySelector('.note-editable');

        var fullName = ticketInfo('customerName', 'pcm-ticket-customer-name');
        if (!fullName) {
            var email = recipientEmail(block, editable);
            fullName = email ? nameFromEmail(email) : null;
        }
        var values = {
            firstName: fullName ? fullName.split(' ')[0] : null,
            fullName: fullName,
            customer: ticketInfo('companyName', 'pcm-ticket-company-name'),
            partner: ticketInfo('partner', 'pcm-ticket-partner'),
            ticket: ticketNumber(block)
        };
        values.name = values.firstName;

        // Names that are not found are dropped with the spaces before
        // them, so 'Hello {firstName},' becomes 'Hello,' with no gap.
        // Other unresolved placeholders stay visible.
        var DROP_IF_MISSING = { firstName: true, fullName: true, name: true };
        return text.replace(/([ \t]*)\{(firstName|fullName|name|customer|partner|ticket)\}/g, function (match, space, key) {
            if (values[key]) return space + values[key];
            return DROP_IF_MISSING[key] ? '' : match;
        });
    }

    // Text-to-HTML, emptiness, and the Summernote append path live in
    // the shared library since lib 2.0.
    function insertTemplate(container, templateText) {
        D.editorAppendHtml(container, D.editorTextToHtml(resolvePlaceholders(templateText, container)));
    }

    // PCM template shortcut: replicates the Insert Template modal's own
    // request. The reply form carries both required ids as data
    // attributes (data-ticket-id, data-email-id); the response is JSON
    // with the server-rendered body in template.body.
    function insertPcmTemplate(container, templateId, btn) {
        var form = container.closest('form.draft-email-form') || container.closest('form');
        var ticketId = form ? form.dataset.ticketId : '';
        var draftId = form ? form.dataset.emailId : '';
        var token = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
        if (!ticketId || !draftId) {
            console.error('[PCM Mail Templates] draft form ids not found, cannot fetch PCM template.');
            D.flashLabel(btn, 'No draft ids');
            return;
        }

        btn.disabled = true;
        fetch('/templates/' + templateId + '/use', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-CSRF-Token': token,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json'
            },
            body: 'draft_type=email' +
                '&draft_id=' + encodeURIComponent(draftId) +
                '&ticket_id=' + encodeURIComponent(ticketId)
        }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }).then(function (data) {
            var body = data && data.template && data.template.body;
            if (!body) throw new Error('empty template body');
            D.editorAppendHtml(container, body);
        }).catch(function (err) {
            console.error('[PCM Mail Templates] PCM template fetch failed:', err);
            D.flashLabel(btn, 'Failed');
        }).finally(function () {
            btn.disabled = false;
        });
    }

    // One click handler for both kinds of template: own text, or PCM's
    // template fetched by id.
    function runEntry(entry, container, btn) {
        if (entry.templateId) insertPcmTemplate(container, entry.templateId, btn);
        else if (entry.text) insertTemplate(container, entry.text);
    }

    function applyColor(el, color) {
        if (!color) return;
        el.classList.add('pcm-tpl-colored');
        el.style.backgroundColor = color;
        el.style.borderColor = color;
    }

    function makeButton(entry, container) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-default btn-xs pcm-tpl-btn';
        btn.textContent = entry.label;
        btn.title = entry.templateId
            ? 'Append the PCM template "' + entry.label + '" to the mail body'
            : 'Append the "' + entry.label + '" template to the mail body';
        applyColor(btn, entry.color);
        btn.addEventListener('click', function () {
            runEntry(entry, container, btn);
        });
        return btn;
    }

    function makeDropdown(entry, container) {
        var select = document.createElement('select');
        select.className = 'pcm-tpl-select';
        select.title = 'Append a "' + entry.label + '" template to the mail body';
        applyColor(select, entry.color);

        var head = document.createElement('option');
        head.textContent = entry.label + '...';
        head.value = '';
        select.appendChild(head);

        entry.items.forEach(function (item, index) {
            var option = document.createElement('option');
            option.textContent = item.label;
            option.value = String(index);
            select.appendChild(option);
        });

        select.addEventListener('change', function () {
            var item = entry.items[Number(select.value)];
            select.selectedIndex = 0;
            if (item) runEntry(item, container, select);
        });
        return select;
    }

    function buildBar(container) {
        var bar = document.createElement('div');
        bar.className = BAR_CLASS;
        blockTranslation(bar);
        TEMPLATES.forEach(function (entry) {
            if (Array.isArray(entry.items) && entry.items.length) {
                bar.appendChild(makeDropdown(entry, container));
            } else if (entry.text || entry.templateId) {
                bar.appendChild(makeButton(entry, container));
            }
        });
        container.parentNode.insertBefore(bar, container);
    }

    // Page translation (Chrome/Edge) rewrites text nodes as they change.
    // Inside the editor that means every keystroke is re-translated and
    // the caret is thrown back to the start of the line, and inserted
    // templates show up in the wrong language. translate="no" plus the
    // notranslate class keep the editor and the bar out of it, so the
    // rest of the ticket can still be translated.
    function blockTranslation(el) {
        if (!el || el.getAttribute('translate') === 'no') return;
        el.setAttribute('translate', 'no');
        el.classList.add('notranslate');
    }

    // Idempotent: flags each editor container so re-renders that keep
    // the node are free, and containers replaced by PCM get a new bar.
    function scan() {
        var editors = document.querySelectorAll('.note-editor');
        for (var i = 0; i < editors.length; i++) {
            var container = editors[i];
            blockTranslation(container);
            if (container.dataset[DONE_FLAG]) continue;
            container.dataset[DONE_FLAG] = '1';
            buildBar(container);
        }
    }

    var gate = D.createVisibilityGate(scan, OBSERVER_DELAY_MS);

    function start() {
        D.ensureStyleTag(STYLE_ID, CSS);
        scan();

        // Reply editors are created on demand (Reply, Forward, Note),
        // so watch for insertions. Root is the main content region when
        // present; the callback only schedules the gated scan, and the
        // gate skips entirely while the tab is hidden.
        var root = document.getElementById('content') || document.body;
        var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].addedNodes.length) {
                    gate.schedule();
                    return;
                }
            }
        });
        observer.observe(root, { childList: true, subtree: true });
    }

    D.bootUntil(function () {
        return !!document.body;
    }, start);
})();
