// @file_name = PCM_Subscription_Buttons.user.js
// @author = Kardo Rostam
// @version = 1.0_2026-09-02
// @created = 2026-09-02 14:17
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). The partner name lives in localStorage (pcm-partner-name), never in code.

// ==UserScript==
// @name         PCM Subscription Buttons
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.0_2026-09-02
// @description  One-press handling of partner telephony subscription (PSI) tickets. A separately coloured PSI button in the mail template row fills the five Change form fields (invoiceable hours, soundfiles, out of hours, to be invoiced, and Invoice Information = the ticket title) and appends the confirmation mail to the reply, with xxFIRSTxLASTxx and xxUSERxIDxx resolved from the User line in the ticket body. xxPHONExNUMBERxx stays visible for the agent to fill after configuring. The partner greeting name is read from localStorage, keeping this file free of customer details. Event-driven injection behind the shared visibility gate, no polling.
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
    var BUTTON_LABEL = 'PSI';

    // The partner's name is NEVER written in this file (public repo).
    // Set it once per browser in the console on any PCM page:
    //   localStorage.setItem('pcm-partner-name', 'TheName')
    // {partner} in the mail template then resolves to it. If unset, the
    // placeholder and the space before it are dropped ('Hello,').
    var PARTNER_NAME_KEY = 'pcm-partner-name';

    // Form fields to set when the button is pressed. Values overwrite
    // whatever is in the field (the press is an explicit action).
    // '{title}' becomes the ticket title, e.g.
    // '[2026-09-05] New Telephony Subscription for user First Last / S2'.
    var FORM_VALUES = [
        { label: 'Additional Invoiceable Hours', value: '0' },
        { label: 'Number of Soundfiles', value: '0' },
        { label: 'Extra invoicing for activation out of hours', value: '0' },
        { label: 'To be invoiced', value: 'yes' },
        { label: 'Invoice Information', value: '{title}' }
    ];

    // Mail appended to the open reply. xxFIRSTxLASTxx and xxUSERxIDxx
    // come from the ticket body's Parameters line, shaped like
    // 'User: First Last (USERID, first.last@example.com)'.
    // xxPHONExNUMBERxx is left as-is: the direct number only exists
    // after the agent configures it.
    var MAIL_TEMPLATE = 'Hello {partner},\n\nUser xxFIRSTxLASTxx (xxUSERxIDxx) has received a new telephony subscription.\nDirect number = xxPHONExNUMBERxx\n\nHave a great day!';

    /******************************************************************
     * INTERNAL SETTINGS
     ******************************************************************/
    var BUTTON_CLASS = 'pcm-psi-btn';
    var STYLE_ID = 'pcm-psi-style';
    var DONE_FLAG = 'pcmPsi';
    // Slightly later than PCM Mail Templates' 150ms so its row exists
    // first and this button lands inside it instead of a bar of its own.
    var OBSERVER_DELAY_MS = 300;

    // First 'User: Name (CAPSID, email)' line wins: that is the
    // Parameters block. 'Opened by:' and the Work notes lines do not
    // match this shape.
    var USER_LINE_RE = /User:\s*([A-Za-zÀ-ɏ' .-]+?)\s*\(([A-Z0-9]{4,}),/;

    var D = window.PCM_DOM;
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate) {
        console.error('[PCM Subscription Buttons] PCM_DOM shared library missing or stale, aborting.');
        return;
    }

    var CSS = [
        '.' + BUTTON_CLASS + ' {',
        '    font-size: 12px;',
        '    padding: 3px 10px;',
        '    background: #d7f0e2;',
        '    border-color: #7cc7a1;',
        '    color: #14523a;',
        '    font-weight: 700;',
        '}',
        '.' + BUTTON_CLASS + ':hover {',
        '    background: #c4e8d4;',
        '    border-color: #57b98a;',
        '}'
    ].join('\n');

    /******************************************************************
     * Ticket data extraction (click time only)
     ******************************************************************/
    function timelineText() {
        var root = document.querySelector('.timeline') || document.body;
        return root.innerText || '';
    }

    function ticketTitle(block) {
        // Preferred: the reply subject 'Re: Puzzel - [180543] TITLE'.
        var m = ((block && block.innerText) || '').match(/Re:\s*Puzzel\s*-\s*\[\d+\]\s*([^\n]+)/);
        if (m) return D.cleanText(m[1]);
        // Fallback: the first '[YYYY-MM-DD] ...' line in the timeline.
        m = timelineText().match(/\[\d{4}-\d{2}-\d{2}\][^\n]*/);
        return m ? D.cleanText(m[0]) : null;
    }

    function ticketUser() {
        var m = timelineText().match(USER_LINE_RE);
        return m ? { name: D.cleanText(m[1]), id: m[2] } : null;
    }

    /******************************************************************
     * Form filling
     ******************************************************************/
    function findFormField(labelText) {
        var wrapper = document.getElementById('form-fields-wrapper');
        if (!wrapper) return null;

        var wanted = D.cleanText(labelText).toLowerCase();
        var label = D.queryAll('label, legend, div, span, strong, b, p, td, th', wrapper)
            .filter(function (el) {
                var value = D.cleanText(D.text(el)).toLowerCase();
                return value === wanted || value === wanted + ':';
            })
            .find(D.visible);
        if (!label) return null;

        var scope = label;
        for (var i = 0; i < 6 && scope; i += 1) {
            scope = scope.parentElement;
            if (!scope || scope === document.body) break;
            var fields = D.queryAll('input, textarea', scope).filter(function (el) {
                return el.type !== 'hidden' && !el.disabled;
            });
            if (!fields.length) continue;
            var following = fields.find(function (el) {
                return label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
            });
            return following || fields[0];
        }
        return null;
    }

    function setFieldValue(field, value) {
        var proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
            descriptor.set.call(field, value);
        } else {
            field.value = value;
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
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
            var value = entry.value === '{title}' ? (title || '') : entry.value;
            if (entry.value === '{title}' && !title) {
                missing += 1;
                console.warn('[PCM Subscription Buttons] ticket title not found, Invoice Information left as-is.');
                return;
            }
            setFieldValue(field, value);
        });
        return missing;
    }

    /******************************************************************
     * Mail insertion (same append path as PCM Mail Templates)
     ******************************************************************/
    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function toHtml(text) {
        return text.split('\n').map(function (line) {
            return line
                ? '<p>' + escapeHtml(line) + '</p>'
                : '<p><span></span><br></p>';
        }).join('');
    }

    function editorIsEmpty(container) {
        var editable = container.querySelector('.note-editable');
        if (!editable) return true;
        return !D.cleanText(editable.textContent) && !editable.querySelector('img');
    }

    function appendToEditor(container, html) {
        var jq = window.jQuery;
        var empty = editorIsEmpty(container);
        var orig = container.previousElementSibling;
        // The template bar sits between the original element and the
        // editor container, so step past our own bar if needed.
        while (orig && (orig.classList.contains('pcm-mail-templates') || orig.classList.contains(BUTTON_CLASS + '-bar'))) {
            orig = orig.previousElementSibling;
        }
        if (jq && orig && jq(orig).data('summernote')) {
            var current = empty ? '' : jq(orig).summernote('code');
            jq(orig).summernote('code', current + html);
            return;
        }
        var editable = container.querySelector('.note-editable');
        if (!editable) return;
        if (empty) {
            editable.innerHTML = html;
        } else {
            editable.insertAdjacentHTML('beforeend', html);
        }
        editable.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function buildMail(user) {
        var text = MAIL_TEMPLATE;
        var partner = D.cleanText(localStorage.getItem(PARTNER_NAME_KEY) || '');
        text = text.replace(/[ \t]*\{partner\}/g, function (match) {
            return partner ? match.replace('{partner}', partner) : '';
        });
        if (user) {
            text = text.replace(/xxFIRSTxLASTxx/g, user.name).replace(/xxUSERxIDxx/g, user.id);
        }
        // Unresolved placeholders (including xxPHONExNUMBERxx) stay
        // visible on purpose.
        return toHtml(text);
    }

    /******************************************************************
     * Button
     ******************************************************************/
    function flashLabel(btn, message) {
        if (btn.dataset.pcmFlashing) return;
        btn.dataset.pcmFlashing = '1';
        var original = btn.textContent;
        btn.textContent = message;
        window.setTimeout(function () {
            btn.textContent = original;
            delete btn.dataset.pcmFlashing;
        }, 1500);
    }

    function onPress(container, btn) {
        var block = container.closest('form') ||
            container.closest('.timeline-item, .panel, .jarviswidget') ||
            container.parentElement || document.body;

        var title = ticketTitle(block);
        var user = ticketUser();
        if (!user) console.warn('[PCM Subscription Buttons] User line not found in the ticket body, placeholders left visible.');

        var missing = fillFormValues(title);
        appendToEditor(container, buildMail(user));

        if (missing || !user) {
            flashLabel(btn, 'Check ' + (missing ? missing + ' field(s)' : 'user'));
        } else {
            flashLabel(btn, 'Done');
        }
    }

    function buildButton(container) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-default btn-xs ' + BUTTON_CLASS;
        btn.textContent = BUTTON_LABEL;
        btn.title = 'PSI subscription ticket: fill the Change form fields and append the confirmation mail';
        btn.addEventListener('click', function () {
            onPress(container, btn);
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

            var btn = buildButton(container);
            var bar = container.previousElementSibling;
            if (bar && bar.classList.contains('pcm-mail-templates')) {
                bar.appendChild(btn);
            } else {
                var own = document.createElement('div');
                own.className = BUTTON_CLASS + '-bar';
                own.style.cssText = 'margin: 6px 0 4px 0;';
                own.appendChild(btn);
                container.parentNode.insertBefore(own, container);
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
