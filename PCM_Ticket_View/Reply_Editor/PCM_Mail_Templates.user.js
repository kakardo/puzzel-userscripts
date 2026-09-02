// @file_name = PCM_Mail_Templates.user.js
// @author = Kardo Rostam
// @version = 1.4_2026-09-02
// @created = 2026-09-01 10:04
// @note = WARNING: no company or customer identifying details are allowed anywhere in this file (names, domains, emails, ids, real examples). See LLM_prompt_instructions Section 2.8.

// ==UserScript==
// @name         PCM Mail Templates
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.4_2026-09-02
// @description  Adds a row of template buttons and small dropdown menus above the Summernote reply editor. Pressing one appends the template to the end of the mail body. Templates live in the TEMPLATES array at the top and support {name} (customer name from the ticket, via the PCM Ticket Info Extractor outputs when present) and {ticket} (ticket number) placeholders; unresolved placeholders stay visible so they are easy to spot. PCM_TEMPLATE_BUTTONS adds one-press shortcuts to PCM's own Insert Template entries: fetched by template id from the same /templates/{id}/use endpoint the modal calls, so variables are filled server-side and the text stays maintained in PCM. Event-driven via a scoped MutationObserver behind the shared visibility gate, no polling.
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
     * TEMPLATES is a flat list. An entry with `text` becomes a button.
     * An entry with `items` becomes a small dropdown menu whose first
     * option is the group label.
     *
     * Placeholders inside `text`:
     *   {name}   the customer name from the ticket, read from the
     *            PCM Ticket Info Extractor outputs (window.PCM_TICKET_INFO
     *            or its published DOM element). Falls back to a name
     *            derived from the To address if the Extractor is not
     *            running.
     *   {ticket} the ticket number, taken from the page URL or the
     *            [123456] tag in the reply subject.
     * If {name} cannot be resolved, the placeholder AND any spaces just
     * before it are removed, so 'Hello {name},' cleanly becomes
     * 'Hello,'. An unresolved {ticket} stays visible so you notice it.
     *
     * Every newline in `text` is a new line in the mail; empty lines
     * become empty paragraphs (same as pressing Enter in the editor).
     * End a template with \n to leave a blank line to write on.
     ******************************************************************/
    var TEMPLATES = [
        {
            label: 'Hello (EN)',
            text: 'Hello {name},\n\nThank you for contacting Puzzel support.\n\n'
        },
        {
            label: 'Hej (SE)',
            text: 'Hej {name},\n\nTack för att du kontaktar Puzzel support.\n\n'
        },
        {
            label: 'IF',
            text: 'Hello,\n\nThank you for contacting Puzzel Customer Care.\n\nI have reviewed your ticket and identified that this incident will require further investigation by our second line engineers.\n\nWe will contact you as soon as we have an update.'
        },
        {
            label: 'Sub(PSI)',
            text: 'Hello,\n\nUser xxFIRSTxLASTxx (xxUSERxIDxx) has received a new telephony subscription.\nDirect number = xxPHONExNUMBERxx\n\nHave a great day!'
        }
    ];

    /******************************************************************
     * Shortcuts to PCM's own "Insert Template" entries.
     * templateId is the option value in the Insert Template modal's
     * dropdown (probe it once via the modal's select). The button
     * fetches the rendered body from the same endpoint the modal uses,
     * so PCM fills its own variables (ticket number, assignee, ...)
     * server-side and the template text stays maintained in PCM.
     ******************************************************************/
    var PCM_TEMPLATE_BUTTONS = [
        { label: 'Assign (Triage ENG)', templateId: 37718 },
        { label: 'Partner (ENG)', templateId: 8584 }
    ];

    // {name}: use only the first word of the ticket's customer name
    // (greeting style). Set to false to insert the full name.
    var NAME_FIRST_WORD_ONLY = true;

    // Email domains that are never the customer (skipped when the
    // fallback resolves {name} from the reply block, so the From line
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
    if (!D || !D.bootUntil || !D.ensureStyleTag || !D.createVisibilityGate) {
        console.error('[PCM Mail Templates] PCM_DOM shared library missing or stale, aborting.');
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

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // One <p> per line, exactly like pressing Enter in Summernote.
    // Empty lines use PCM's own empty-paragraph markup, probed from a
    // fresh editor (<p><span></span><br></p>), so they render as blank
    // lines identically to manually typed ones.
    function toHtml(text) {
        return text.split('\n').map(function (line) {
            return line
                ? '<p>' + escapeHtml(line) + '</p>'
                : '<p><span></span><br></p>';
        }).join('');
    }

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

    function nameFromEmail(email) {
        var local = email.split('@')[0];
        var first = local.split(/[._-]/)[0].replace(/\d+/g, '');
        if (!first) return null;
        return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }

    // Customer name as shown in the ticket. Soft dependency on the
    // PCM Ticket Info Extractor: reads its published outputs when they
    // exist, never requires them.
    function ticketCustomerName() {
        var info = window.PCM_TICKET_INFO || {};
        var name = D.cleanText(info.customerName || '');
        if (!name) {
            var el = document.getElementById('pcm-ticket-customer-name');
            name = el ? D.cleanText(el.textContent) : '';
        }
        if (!name) {
            var root = document.getElementById('pcm-ticket-info');
            name = root ? D.cleanText(root.dataset.customerName || '') : '';
        }
        if (!name) return null;
        return NAME_FIRST_WORD_ONLY ? name.split(' ')[0] : name;
    }

    function resolvePlaceholders(text, container) {
        var block = replyBlock(container);
        var editable = container.querySelector('.note-editable');

        var resolvedName = ticketCustomerName();
        if (!resolvedName) {
            var email = recipientEmail(block, editable);
            resolvedName = email ? nameFromEmail(email) : null;
        }

        // No name found: drop the placeholder and the spaces before it,
        // so 'Hello {name},' becomes 'Hello,' with no gap.
        return text
            .replace(/[ \t]*\{name\}/g, function (match) {
                return resolvedName
                    ? match.replace('{name}', resolvedName)
                    : '';
            })
            .replace(/\{ticket\}/g, function (tag) {
                return ticketNumber(block) || tag;
            });
    }

    // Visually empty: no text and no image. Summernote's own isEmpty is
    // useless here because PCM's fresh editor holds
    // <p><span></span><br></p>, which isEmpty does not recognise, so the
    // stale empty paragraph survived as a blank first line.
    function editorIsEmpty(container) {
        var editable = container.querySelector('.note-editable');
        if (!editable) return true;
        return !D.cleanText(editable.textContent) && !editable.querySelector('img');
    }

    // Append via the Summernote API when the original element is
    // reachable (keeps Summernote's internal state and the underlying
    // field in sync); fall back to direct DOM insertion plus an input
    // event otherwise.
    function appendToEditor(container, html) {
        var jq = window.jQuery;
        var empty = editorIsEmpty(container);
        var orig = container.previousElementSibling;
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

    function insertTemplate(container, templateText) {
        appendToEditor(container, toHtml(resolvePlaceholders(templateText, container)));
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
            flashLabel(btn, 'No draft ids');
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
            appendToEditor(container, body);
        }).catch(function (err) {
            console.error('[PCM Mail Templates] PCM template fetch failed:', err);
            flashLabel(btn, 'Failed');
        }).finally(function () {
            btn.disabled = false;
        });
    }

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

    function makeButton(entry, container) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-default btn-xs pcm-tpl-btn';
        btn.textContent = entry.label;
        btn.title = 'Append the "' + entry.label + '" template to the mail body';
        btn.addEventListener('click', function () {
            insertTemplate(container, entry.text);
        });
        return btn;
    }

    function makeDropdown(entry, container) {
        var select = document.createElement('select');
        select.className = 'pcm-tpl-select';
        select.title = 'Append a "' + entry.label + '" template to the mail body';

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
            if (item) insertTemplate(container, item.text);
        });
        return select;
    }

    function makePcmButton(entry, container) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-default btn-xs pcm-tpl-btn';
        btn.textContent = entry.label;
        btn.title = 'Append the PCM template "' + entry.label + '" to the mail body';
        btn.addEventListener('click', function () {
            insertPcmTemplate(container, entry.templateId, btn);
        });
        return btn;
    }

    function buildBar(container) {
        var bar = document.createElement('div');
        bar.className = BAR_CLASS;
        TEMPLATES.forEach(function (entry) {
            if (Array.isArray(entry.items) && entry.items.length) {
                bar.appendChild(makeDropdown(entry, container));
            } else if (entry.text) {
                bar.appendChild(makeButton(entry, container));
            }
        });
        PCM_TEMPLATE_BUTTONS.forEach(function (entry) {
            if (entry.templateId) bar.appendChild(makePcmButton(entry, container));
        });
        container.parentNode.insertBefore(bar, container);
    }

    // Idempotent: flags each editor container so re-renders that keep
    // the node are free, and containers replaced by PCM get a new bar.
    function scan() {
        var editors = document.querySelectorAll('.note-editor');
        for (var i = 0; i < editors.length; i++) {
            var container = editors[i];
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
