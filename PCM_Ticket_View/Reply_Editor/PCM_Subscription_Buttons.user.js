// @file_name = PCM_Subscription_Buttons.user.js
// @author = Kardo Rostam
// @version = 1.4_2026-09-04
// @created = 2026-09-02 14:17
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). The partner name lives in localStorage (pcm-partner-name), never in code.

// ==UserScript==
// @name         PCM Subscription Buttons
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.4_2026-09-04
// @description  One-press handling of partner telephony subscription tickets, one button per product (PSI and PCC), each with its own colour and mail template. Both fill the five Change form fields (invoiceable hours, soundfiles, out of hours, to be invoiced, and Invoice Information = the ticket title) and append their confirmation mail to the reply, with the user's name, id, email, user group, and profile team resolved from the first mail in the ticket (iframes included). Values that only exist after configuration stay visible as placeholders. Partner details are read from localStorage, keeping this file free of customer information. Event-driven injection behind the shared visibility gate, no polling.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/tickets/*
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Shared_Library/PCM_Shared_Library.user.js
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Subscription_Buttons.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/Reply_Editor/PCM_Subscription_Buttons.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * USER SETTINGS
     ******************************************************************/
    // The partner greeting name is set once per browser in the console:
    //   localStorage.setItem('pcm-partner-name', 'TheName')
    // {partner} resolves to it, dropped with its leading space if unset.
    var PARTNER_NAME_KEY = 'pcm-partner-name';

    // One button per product. Both fill FORM_VALUES below; each has its
    // own colour and mail template.
    //
    // Placeholders resolved from the ticket's first mail (iframes
    // included), which contains lines shaped like:
    //   User: First Last (USERID, first.last@example.com)
    //   Puzzel User Group: GROUP_NAME
    //   Divert Unanswered Calls to Queue: TEAM_NAME
    //   xxNAMExx / xxFIRSTxLASTxx -> the user's full name
    //   xxUSERxx / xxUSERxIDxx    -> the short id in the parentheses
    //   xxEMAILxx                 -> the user's email address
    //   xxUSER_GROUPxx            -> the Puzzel User Group value
    //   xxPROFILE_TEAMxx          -> the Divert Unanswered Calls value
    // Deliberately left visible for the agent (values that only exist
    // after configuration): xxUSER_IDxx, xxPHONE_NUMBERxx, xxPHONExNUMBERxx.
    var BUTTONS = [
        {
            label: 'PSI',
            className: 'pcm-psi-btn',
            template: 'Hello {partner},\n\nUser xxFIRSTxLASTxx (xxUSERxIDxx) has received a new telephony subscription.\nDirect number = xxPHONExNUMBERxx\n\nHave a great day!'
        },
        {
            label: 'PCC',
            className: 'pcm-pcc-btn',
            template: 'Hello,\n\nUser xxNAMExx (xxUSERxx) with User ID xxUSER_IDxx has been created according to the parameters requested.\nDirect number = xxPHONE_NUMBERxx\n\nHave a great day!\nxxEMAILxx\nADN xxUSER_GROUPxx xxUSERxx\nxxUSERxx:xxPROFILE_TEAMxx\nxxPHONE_NUMBERxx|Direktenummer;21492400|IF Hovednummer\n- Users → Users (+ Integration?)\n- Services → Services (ledig or available)\n- Services → Lists\n- Users → Products -> Call (filter: "Outgoing")\n\t>> 1 1 0\n\t>> 0 1 0'
        }
    ];

    // Form fields to set when the button is pressed. Values overwrite
    // whatever is in the field (the press is an explicit action).
    // '{title}' becomes the ticket title, e.g.
    // '[2026-09-05] New Telephony Subscription for user First Last / S2'.
    // type declares what element the value belongs in. A found field of
    // the wrong type is NEVER written to, only reported: this is what
    // guarantees fields outside this list (like Change Completed, a text
    // box that must never be touched by this script) cannot receive a
    // stray value through a lookup mismatch.
    var FORM_VALUES = [
        { label: 'Additional Invoiceable Hours', value: '0', type: 'select' },
        { label: 'Number of Soundfiles', value: '0', type: 'select' },
        { label: 'Extra invoicing for activation out of hours', value: '0', type: 'select' },
        { label: 'To be invoiced', value: 'yes', type: 'select' },
        { label: 'Invoice Information', value: '{title}', type: 'text' }
    ];

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var BAR_CLASS = 'pcm-sub-bar';
    var STYLE_ID = 'pcm-sub-buttons-style';
    var DONE_FLAG = 'pcmSubButtons';
    // Slightly later than PCM Mail Templates' 150ms so its row exists
    // first and this button lands inside it instead of a bar of its own.
    var OBSERVER_DELAY_MS = 300;

    // First 'User: Name (CAPSID, email)' line wins: that is the
    // Parameters block. 'Opened by:' and the Work notes lines do not
    // match this shape.
    var USER_LINE_RE = /User:\s*([A-Za-zÀ-ɏ' .-]+?)\s*\(([A-Z0-9]{2,}),\s*([^)\s]+)\s*\)/;
    var USER_GROUP_RE = /Puzzel User Group:\s*([^\n]+)/;
    var PROFILE_TEAM_RE = /Divert Unanswered Calls to Queue:\s*([^\n]+)/;

    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate ||
        !D.createFieldFinder || !D.setNativeFieldValue || !D.editorAppendHtml || !D.flashLabel) {
        console.error('[PCM Subscription Buttons] PCM_DOM shared library missing or stale (lib 2.0 or newer required), aborting.');
        return;
    }

    var CSS = [
        '.pcm-psi-btn, .pcm-pcc-btn {',
        '    font-size: 12px;',
        '    padding: 3px 10px;',
        '    font-weight: 700;',
        '}',
        '.pcm-psi-btn {',
        '    background: #d7f0e2;',
        '    border-color: #7cc7a1;',
        '    color: #14523a;',
        '}',
        '.pcm-psi-btn:hover {',
        '    background: #c4e8d4;',
        '    border-color: #57b98a;',
        '}',
        '.pcm-pcc-btn {',
        '    background: #e3e0f7;',
        '    border-color: #a29add;',
        '    color: #35306b;',
        '}',
        '.pcm-pcc-btn:hover {',
        '    background: #d6d1f2;',
        '    border-color: #8a80d4;',
        '}'
    ].join('\n');

    /******************************************************************
     * Ticket data extraction (click time only)
     ******************************************************************/
    function ticketTitle(block) {
        // Preferred: the reply subject 'Re: Puzzel - [180543] TITLE'.
        var m = ((block && block.innerText) || '').match(/Re:\s*Puzzel\s*-\s*\[\d+\]\s*([^\n]+)/);
        if (m) return D.cleanText(m[1]);
        // Fallback: the first '[YYYY-MM-DD] ...' line on the page.
        m = (document.body.innerText || '').match(/\[\d{4}-\d{2}-\d{2}\][^\n]*/);
        return m ? D.cleanText(m[0]) : null;
    }

    // Line breaks rebuilt from the mail's HTML structure (a newline
    // after every <br> and block close). Rendering-based innerText is
    // unreliable here: an iframe without layout degrades it to glued
    // textContent, which once made xxUSER_GROUPxx swallow half the mail.
    // DOMParser keeps the untrusted mail HTML inert (no scripts, no
    // resource loads, no event handlers).
    function frameText(frameDoc) {
        var body = frameDoc && frameDoc.body;
        if (!body) return '';
        var html = body.innerHTML.replace(/<br[^>]*>|<\/(p|div|li|td|tr|h[1-6])>/gi, '$&\n');
        try {
            return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
        } catch (_) {
            return body.textContent || '';
        }
    }

    // The data lines live in the received-mail iframes ONLY. The main
    // document must NEVER be searched: its text includes the reply
    // editor's own HTML source, so after one press a second press would
    // match inside the previously inserted mail and explode the reply
    // with the editor's entire UI text. All values come from the first
    // iframe that contains the User line, so they belong to the same
    // mail.
    function ticketData() {
        var frames = document.querySelectorAll('iframe');
        for (var i = 0; i < frames.length; i++) {
            var doc;
            try { doc = frames[i].contentDocument; } catch (_) { continue; }
            var text = frameText(doc);
            if (!text) continue;
            var m = text.match(USER_LINE_RE);
            if (!m) continue;
            var group = text.match(USER_GROUP_RE);
            var team = text.match(PROFILE_TEAM_RE);
            return {
                name: D.cleanText(m[1]),
                id: m[2],
                email: D.cleanText(m[3]),
                group: group ? D.cleanText(group[1]) : null,
                team: team ? D.cleanText(team[1]) : null
            };
        }
        return null;
    }

    /******************************************************************
     * Form filling (lib 2.0: cached label lookup, select-aware setter)
     ******************************************************************/
    var fieldFinder = D.createFieldFinder();

    function findFormField(labelText) {
        return fieldFinder.field(labelText);
    }

    function setFieldValue(field, value) {
        return D.setNativeFieldValue(field, value);
    }

    // Returns the number of fields that could not be found.
    function fillFormValues(title) {
        var missing = 0;
        FORM_VALUES.forEach(function (entry) {
            var field = findFormField(entry.label);
            if (!field) {
                missing += 1;
                console.warn('[PCM Subscription Buttons] form field not found:', entry.label);
                return;
            }
            var isSelect = field.tagName === 'SELECT';
            if ((entry.type === 'select') !== isSelect) {
                missing += 1;
                console.warn('[PCM Subscription Buttons] wrong field type found for %o, not touching it.', entry.label);
                return;
            }
            var value = entry.value === '{title}' ? (title || '') : entry.value;
            if (entry.value === '{title}' && !title) {
                missing += 1;
                console.warn('[PCM Subscription Buttons] ticket title not found, Invoice Information left as-is.');
                return;
            }
            if (!setFieldValue(field, value)) {
                missing += 1;
                console.warn('[PCM Subscription Buttons] no option %o in the %o dropdown.', value, entry.label);
            }
        });
        return missing;
    }

    /******************************************************************
     * Mail insertion (lib 2.0: text-to-HTML with indent preservation,
     * Summernote append walking past injected bars)
     ******************************************************************/
    function toHtml(text) {
        return D.editorTextToHtml(text);
    }

    function appendToEditor(container, html) {
        D.editorAppendHtml(container, html);
    }

    // Placeholders that SHOULD have resolved; whatever survives is
    // counted and reported. xxUSER_IDxx and the phone placeholders are
    // not in this list because they are meant to stay visible.
    var RESOLVABLE_RE = /xxNAMExx|xxFIRSTxLASTxx|xxUSERxx|xxUSERxIDxx|xxEMAILxx|xxUSER_GROUPxx|xxPROFILE_TEAMxx/g;

    function buildMail(template) {
        var text = template;
        var partner = D.cleanText(localStorage.getItem(PARTNER_NAME_KEY) || '');
        text = text.replace(/[ \t]*\{partner\}/g, function (match) {
            return partner ? match.replace('{partner}', partner) : '';
        });

        var data = ticketData();
        if (data) {
            text = text
                .replace(/xxNAMExx|xxFIRSTxLASTxx/g, data.name)
                .replace(/xxUSERxx|xxUSERxIDxx/g, data.id)
                .replace(/xxEMAILxx/g, data.email);
            if (data.group) text = text.replace(/xxUSER_GROUPxx/g, data.group);
            if (data.team) text = text.replace(/xxPROFILE_TEAMxx/g, data.team);
        }

        var unresolved = (text.match(RESOLVABLE_RE) || []).length;
        if (unresolved) {
            console.warn('[PCM Subscription Buttons] %d mail placeholder(s) could not be resolved from the ticket.', unresolved);
        }
        return { html: toHtml(text), unresolved: unresolved };
    }

    /******************************************************************
     * Button (flashLabel lives in the shared library since lib 2.0)
     ******************************************************************/
    function flashLabel(btn, message) {
        D.flashLabel(btn, message);
    }

    function onPress(container, btn, entry) {
        var block = container.closest('form') ||
            container.closest('.timeline-item, .panel, .jarviswidget') ||
            container.parentElement || document.body;

        var title = ticketTitle(block);
        var missing = fillFormValues(title);
        var mail = buildMail(entry.template);
        appendToEditor(container, mail.html);

        if (missing || mail.unresolved) {
            flashLabel(btn, 'Check ' + (missing ? missing + ' field(s)' : mail.unresolved + ' mail var(s)'));
        } else {
            flashLabel(btn, 'Done');
        }
    }

    function buildButton(container, entry) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-default btn-xs ' + entry.className;
        btn.textContent = entry.label;
        btn.title = entry.label + ' subscription ticket: fill the Change form fields and append the confirmation mail';
        btn.addEventListener('click', function () {
            onPress(container, btn, entry);
        });
        return btn;
    }

    // Joins the PCM Mail Templates row when it exists (soft dependency),
    // otherwise gets a small bar of its own above the editor.
    function ensureButtons() {
        var editors = document.querySelectorAll('.note-editor');
        for (var i = 0; i < editors.length; i++) {
            var container = editors[i];
            if (container.dataset[DONE_FLAG]) continue;
            container.dataset[DONE_FLAG] = '1';

            var bar = container.previousElementSibling;
            if (!bar || !bar.classList.contains('pcm-mail-templates')) {
                var own = document.createElement('div');
                own.className = BAR_CLASS;
                own.style.cssText = 'margin: 6px 0 4px 0; display: flex; gap: 4px;';
                container.parentNode.insertBefore(own, container);
                bar = own;
            }
            for (var b = 0; b < BUTTONS.length; b++) {
                bar.appendChild(buildButton(container, BUTTONS[b]));
            }
        }
    }

    var gate = D.createVisibilityGate(ensureButtons, OBSERVER_DELAY_MS);

    function start() {
        D.ensureStyleTag(STYLE_ID, CSS);
        ensureButtons();

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
