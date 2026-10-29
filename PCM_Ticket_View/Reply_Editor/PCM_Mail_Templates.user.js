// @file_name = PCM_Mail_Templates.user.js
// @author = Kardo Rostam
// @version = 3.5_2026-10-29
// @created = 2026-09-01 10:04
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples).

// ==UserScript==
// @name         PCM Mail Templates
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      3.5_2026-10-29
// @description  Adds a row of template buttons and small dropdown menus above the Summernote reply editor. Pressing one appends the template to the end of the mail body. Templates live in one TEMPLATES list at the top, shown in its order, so own templates and PCM templates can be mixed; each entry can have a colour, and entries can be grouped into dropdown menus. Own templates support {firstName}, {fullName}, {customer}, {partner} (read from the PCM Ticket Info Extractor outputs when present, names fall back to the To address) {ticket}, {priorityFrom} (the priority when the ticket was opened) and {priority:Name} placeholders; a Priority menu writes "Priority change: <priority when the ticket was opened> to <chosen>" with both priorities as small labels in PCM's own priority colours; {name} still works as {firstName}. A template or dropdown can set fontSize for its text. Lines starting with 1., 2. ... or - become real numbered or bullet lists (a line directly under an item stays in that item). Unresolved names are dropped, other unresolved placeholders stay visible so they are easy to spot. Entries with a templateId are one-press shortcuts to PCM's own Insert Template entries, fetched by template id from the same /templates/{id}/use endpoint the modal calls, so variables are filled server-side and the text stays maintained in PCM. The editor and the bar are marked translate="no" so page translation never rewrites the mail while typing. Event-driven via a scoped MutationObserver behind the shared visibility gate, no polling.
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
     * Own templates and dropdowns can also have fontSize (in px, as in
     * the editor's size menu): the inserted text gets that size. Set on a
     * dropdown it applies to all its entries, unless an entry has its own.
     * Left out, the text keeps the editor's normal size.
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
     *   {priorityFrom} the priority the ticket had when it was opened,
     *               as a coloured label with its level: "Highest (P1)"
     *   {priority:Name} that priority as the same coloured label
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
        password: '#ad1457',  // locked accounts and password resets
        handover: '#7b2cbf',  // incident handover and assigning
        evidence: '#e65100',  // asking for call examples and logs
        closing: '#2f7d2f',   // follow-up, no-reply and partner replies
        priority: '#3949ab'   // priority change notes
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
        // A dropdown: account locked after failed logins, reset the
        // password. "you" writes to the user, "they" to someone writing on
        // the user's behalf (an admin or partner).
        { label: 'Password', color: COLORS.password, items: [
            {
                label: 'Reset (you)',
                text: 'Hello {firstName},\n\nThank you for contacting Puzzel Support.\n\n' +
                'It appears that you are unable to log in because your account has been temporarily locked after ' +
                'multiple failed login attempts.\n\n' +
                'Please reset your password by following the instructions in the guide below:\n' +
                'https://www.puzzel.com/help?pzlRoute=article&pzlArticleId=1196\n\n' +
                'Once you have completed the password reset, please try logging in again.\n\n' +
                'If you do not receive the password reset email, please check your spam/junk folder. If the issue ' +
                'persists, feel free to reply to this email and we\'ll be happy to assist further.\n\n' +
                'Have a great day!'
            },
            {
                label: 'Reset (they)',
                text: 'Hello {firstName},\n\nThank you for contacting Puzzel Support.\n\n' +
                'It appears that they are unable to log in because their account has been temporarily locked after ' +
                'multiple failed login attempts.\n\n' +
                'They can reset their password by following the instructions in the guide below:\n' +
                'https://www.puzzel.com/help?pzlRoute=article&pzlArticleId=1196\n\n' +
                'Once they have completed the password reset, ask them to try logging in again.\n\n' +
                'If they do not receive the password reset email, please ask them to check their spam/junk folder. ' +
                'If the issue persists, feel free to reply to this email and we\'ll be happy to assist further.\n\n' +
                'Have a great day!'
            },
            {
                label: 'Reset (SE)',
                text: 'Hej {firstName},\n\nTack för att du kontaktar Puzzel Support.\n\n' +
                'Det verkar som att du inte kan logga in eftersom kontot har låsts efter flera misslyckade ' +
                'inloggningsförsök.\n\n' +
                'Vänligen återställ ditt lösenord genom att följa instruktionerna i guiden nedan:\n' +
                'https://www.puzzel.com/help?pzlRoute=article&pzlArticleId=1196\n\n' +
                'När du har återställt ditt lösenord kan du försöka logga in igen.\n\n' +
                'Om du inte får e-postmeddelandet för lösenordsåterställning, vänligen kontrollera din ' +
                'skräppost-/spam-mapp. Om problemet kvarstår är du välkommen att svara på detta e-postmeddelande ' +
                'så hjälper vi dig vidare.\n\n' +
                'Ha en fortsatt fin dag!'
            }
        ] },
        {
            label: 'IF', color: COLORS.handover,
            text: 'Hello,\n\nThank you for contacting Puzzel Customer Care.\n\n' +
            'I have reviewed your ticket and identified that this incident will require further investigation by our ' +
            'second line engineers.\n\nWe will contact you as soon as we have an update.'
        },
        { label: 'Assign', templateId: 37718, color: COLORS.handover },
        // A dropdown: asking for evidence (a call example, console logs,
        // both, or softphone checks plus logs).
        { label: 'Evidence', color: COLORS.evidence, items: [
            {
                label: 'CallEx',
                text: 'Hello {firstName},\n\nThank you for contacting Puzzel support.\n\n' +
                'To help you with the below, we need a call example: the caller\'s number plus the date and time of ' +
                'the call.\nIf you can find the call in the archive in Puzzel Admin, that\'s even better: expand the call ' +
                'details and send us the "Call ID" and "Session ID". That lets us look up the right log files quickly.\n\n' +
                'See how to here:\nhttps://www.puzzel.com/help?pzlRoute=article&pzlArticleId=498'
            },
            {
                label: 'Logs',
                text: 'Hello {firstName},\n\nThank you for contacting Puzzel support.\n\n' +
                'To help us investigate this issue, please provide browser console logs from a browser where the issue occurs.\n' +
                'These logs can provide valuable information for our investigation.\n\n' +
                'Instructions for capturing console logs:\nhttps://www.puzzel.com/help?pzlRoute=article&pzlArticleId=253903\n\n' +
                'Once we have the console logs, we will continue our investigation.\n\nHave a great day!'
            },
            {
                label: 'CallEx + Logs',
                text: 'Hello {firstName},\n\nThank you for contacting Puzzel Support.\n\n' +
                'To help you investigate this issue, we need:\n' +
                '- A call example, including the caller\'s number and the date and time of the call.\n' +
                '- If possible, locate the call in the archive in Puzzel Admin, expand the call details, and send us ' +
                'the "Call ID" and "Session ID". This allows us to quickly identify the correct log files for analysis.\n' +
                'https://www.puzzel.com/help?pzlRoute=article&pzlArticleId=498\n\n' +
                'In addition, please capture and send browser console logs from a browser where the issue occurs. ' +
                'These logs can provide valuable information for our investigation.\n' +
                'https://www.puzzel.com/help?pzlRoute=article&pzlArticleId=253903\n\n' +
                'Once we have the call example and the console logs, we will continue our investigation.\n\n' +
                'Have a great day!'
            },
            {
                label: 'Softphone + Logs',
                text: 'Hello {firstName},\n\nThank you for contacting Puzzel Support.\n\n' +
                'We have no known issues affecting Contact Centre at the moment, so the problem is most likely ' +
                'local to your setup.\n\n' +
                'Please start by working through our softphone troubleshooting guide:\n' +
                'https://www.puzzel.com/help?pzlRoute=article&pzlArticleId=9355\n\n' +
                'If the issue persists, we will need your browser console logs to investigate further. ' +
                'To capture them:\n\n' +
                '1. Follow the first steps in this guide to enable log preservation:\n' +
                'https://www.puzzel.com/help?pzlRoute=article&pzlArticleId=253903\n' +
                '2. Reproduce the problem.\n' +
                '3. Save the logs and attach them in your reply.\n\n' +
                'Please also include the approximate time the issue occurred and your user ID, as this helps us ' +
                'match the logs to our system records.'
            }
        ] },
        // A dropdown: a note line for a priority change. {priorityFrom} is
        // the priority the ticket had when it was opened; {priority:name}
        // writes that priority. Both come out as small labels in PCM's own
        // priority colours, as in "Highest (P1)".
        { label: 'Priority', color: COLORS.priority, fontSize: 18, items: [
            { label: 'Highest (P1)', text: 'Priority change: {priorityFrom} to {priority:Highest}' },
            { label: 'High (P2)', text: 'Priority change: {priorityFrom} to {priority:High}' },
            { label: 'Normal (P3)', text: 'Priority change: {priorityFrom} to {priority:Normal}' },
            { label: 'Low (P4)', text: 'Priority change: {priorityFrom} to {priority:Low}' },
            { label: 'Lowest (P5)', text: 'Priority change: {priorityFrom} to {priority:Lowest}' },
            { label: 'Junk (P6)', text: 'Priority change: {priorityFrom} to {priority:Junk}' }
        ] },
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

    // PRIORITY
    // "From" is the priority the ticket had when it was OPENED, remembered
    // per ticket for as long as the page stays open: changing and even
    // saving the priority before writing the note keeps the right "from".
    // It is read from the option PCM rendered as selected (the saved
    // value, not an unsaved choice in the dropdown). It is captured once,
    // when the ticket opens, and nothing changes it afterwards: not a save,
    // not a priority note.
    var PRIORITY_LEVELS = { highest: 'P1', high: 'P2', normal: 'P3', low: 'P4', lowest: 'P5', junk: 'P6' };

    function prioritySelect() {
        var byId = document.getElementById('priority-select');
        if (byId && byId.tagName === 'SELECT') return byId;
        var form = document.getElementById('ticket-attributes-form') || document.querySelector('form.edit_ticket');
        if (!form) return null;
        var labels = form.querySelectorAll('label');
        for (var i = 0; i < labels.length; i += 1) {
            if (!/^\s*priority:?/i.test(labels[i].textContent || '')) continue;
            var section = labels[i].closest('section, .form-group, [class*="col"]') || labels[i].parentElement;
            var select = section && section.querySelector('select');
            if (select) return select;
        }
        return null;
    }

    function savedPriorityName() {
        var select = prioritySelect();
        if (!select) return null;
        var option = Array.prototype.find.call(select.options, function (o) { return o.defaultSelected; }) ||
            select.options[select.selectedIndex];
        var name = option ? option.textContent.replace(/\s+/g, ' ').trim() : '';
        return name || null;
    }

    var priorityAtOpen = {};   // ticket number -> priority name

    function ticketKey() {
        var match = window.location.pathname.match(/\/tickets\/(\d+)/);
        return match ? match[1] : '';
    }

    // Runs with every scan, so it catches the Attributes form as soon as
    // it is there; once a ticket has a value it is never overwritten here.
    function capturePriority() {
        var key = ticketKey();
        if (!key || priorityAtOpen[key]) return;
        var name = savedPriorityName();
        if (name) priorityAtOpen[key] = name;
    }

    function priorityFromName() {
        capturePriority();
        return priorityAtOpen[ticketKey()] || savedPriorityName();
    }

    // Priorities travel through the text as markers and become coloured
    // labels after the text has been turned into HTML (see insertTemplate).
    var PRIO_MARK_RE = /\u0001P:([^\u0002]+)\u0002/g;

    function priorityMarker(name) {
        return name ? '\u0001P:' + name + '\u0002' : null;
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
            ticket: ticketNumber(block),
            priorityFrom: /\{priorityFrom\}/.test(text) ? priorityMarker(priorityFromName()) : null
        };
        values.name = values.firstName;

        // Names that are not found are dropped with the spaces before
        // them, so 'Hello {firstName},' becomes 'Hello,' with no gap.
        // Other unresolved placeholders stay visible.
        var DROP_IF_MISSING = { firstName: true, fullName: true, name: true };
        text = text.replace(/\{priority:([^}]+)\}/g, function (match, name) {
            return priorityMarker(name.trim()) || match;
        });
        return text.replace(/([ \t]*)\{(firstName|fullName|name|customer|partner|ticket|priorityFrom)\}/g, function (match, space, key) {
            if (values[key]) return space + values[key];
            return DROP_IF_MISSING[key] ? '' : match;
        });
    }

    // Emptiness and the Summernote append path live in the shared library
    // since lib 2.0; plain lines go through its text-to-HTML.
    //
    // LISTS: lines starting with "1.", "2." ... become a numbered list and
    // lines starting with "- " a bullet list, as real list markup so the
    // mail shows proper lists. A line directly under a list item (no blank
    // line in between, not itself an item) continues that item on a new
    // line, so a link under a step stays inside the step. Any other line
    // ends the list. A list brings its own space above and below, so empty
    // lines right before and after it are dropped; kept, they doubled the
    // gap on both sides.
    var LIST_ITEM_RE = { ol: /^\s*\d+[.)]\s+(.*)$/, ul: /^\s*-\s+(.*)$/ };

    function listKind(line) {
        if (LIST_ITEM_RE.ol.test(line)) return 'ol';
        if (LIST_ITEM_RE.ul.test(line)) return 'ul';
        return '';
    }

    function textToHtml(text) {
        var esc = D.escapeHtml || function (v) {
            return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };
        var lines = String(text).split('\n');
        var html = '';
        var plain = [];
        var i = 0;

        function flushPlain() {
            if (plain.length) html += D.editorTextToHtml(plain.join('\n'));
            plain = [];
        }

        while (i < lines.length) {
            var kind = listKind(lines[i]);
            if (!kind) {
                plain.push(lines[i]);
                i += 1;
                continue;
            }
            while (plain.length && !plain[plain.length - 1].trim()) plain.pop();
            flushPlain();
            var items = [];
            while (i < lines.length && listKind(lines[i]) === kind) {
                var parts = [lines[i].match(LIST_ITEM_RE[kind])[1]];
                i += 1;
                while (i < lines.length && lines[i].trim() && !listKind(lines[i])) {
                    parts.push(lines[i].trim());
                    i += 1;
                }
                items.push('<li>' + parts.map(esc).join('<br>') + '</li>');
            }
            html += '<' + kind + '>' + items.join('') + '</' + kind + '>';
            while (i < lines.length && !lines[i].trim()) i += 1;
        }
        flushPlain();
        return html;
    }

    // A priority as a small label in PCM's own colour for it, written with
    // inline styles so it keeps its colour in the saved note and the mail.
    // Without a known colour it is plain bold text.
    function priorityLabelHtml(name) {
        var level = PRIORITY_LEVELS[name.toLowerCase()];
        var text = (D.escapeHtml || String)(level ? name + ' (' + level + ')' : name);
        var colour = pcmLabelColour(name.toLowerCase());
        if (!colour) return '<b>' + text + '</b>';
        return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-weight:700;' +
            'background-color:' + colour.bg + ';color:' + (colour.fg || '#fff') + ';">' + text + '</span>';
    }

    // fontSize: every top-level block (paragraph or list) gets the size
    // inline, so it stays in the saved note and the mail; list items and
    // priority labels take it from their block.
    function withFontSize(html, fontSize) {
        var size = Number(fontSize);
        if (!size || size < 6 || size > 72) return html;
        return html.replace(/<(p|ol|ul)>/g, '<$1 style="font-size:' + size + 'px;">');
    }

    function insertTemplate(container, templateText, fontSize) {
        var resolved = resolvePlaceholders(templateText, container);
        var html = textToHtml(resolved).replace(PRIO_MARK_RE, function (match, name) {
            return priorityLabelHtml(name);
        });
        D.editorAppendHtml(container, withFontSize(html, fontSize));
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
    function runEntry(entry, container, btn, groupFontSize) {
        if (entry.templateId) insertPcmTemplate(container, entry.templateId, btn);
        else if (entry.text) insertTemplate(container, entry.text, entry.fontSize || groupFontSize);
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

    // PCM's own colours for a priority: a hidden label with PCM's class is
    // measured once per priority and remembered, so the note always
    // matches the colours PCM shows elsewhere, whatever PCM changes them
    // to. Without a colour (class unknown to PCM) null comes back.
    var pcmLabelColours = {};

    function pcmLabelColour(name) {
        if (Object.prototype.hasOwnProperty.call(pcmLabelColours, name)) return pcmLabelColours[name];
        var probe = document.createElement('span');
        probe.className = 'label label-priority-' + name;
        probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;';
        probe.textContent = 'x';
        document.body.appendChild(probe);
        var cs = window.getComputedStyle(probe);
        var bg = cs.backgroundColor;
        var result = bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)/.test(bg) ? { bg: bg, fg: cs.color } : null;
        probe.remove();
        pcmLabelColours[name] = result;
        return result;
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
            if (item) runEntry(item, container, select, entry.fontSize);
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
        capturePriority();
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
