// @file_name = PCM_Name_Field_Placeholder.user.js
// @author = Kardo Rostam
// @version = 1.8_2026-08-27
// @created = 2026-04-08 09:47

// ==UserScript==
// @name         PCM Name Field Placeholder
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      1.8_2026-08-27
// @description  Adds a purple placeholder name link above the email in Customer Intelligence only when no visible name already exists. Runs once per page load with limited retries.
// @author       Kardo Rostam
// @match        https://puzzel.cm.puzzel.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Name_Field_Placeholder.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCM_Ticket_View/PCM_Name_Field_Placeholder.user.js
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'customer-intelligence-table';
    const PLACEHOLDER_ID = 'pcm-ci-name-placeholder-link';
    const PLACEHOLDER_TEXT = 'ADD NAME HERE';
    const PLACEHOLDER_COLOR = '#7A1CAC';
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
    const RETRY_DELAYS_MS = [0, 300, 1000, 2500];

    function isVisible(el) {
        return !!el && el.offsetParent !== null;
    }

    function getCustomerIntelligencePanel() {
        return document.getElementById(PANEL_ID);
    }

    function getCustomerProfileHref() {
        const preferred = document.querySelector('#cip-customer-name a[href*="/customers/"][href$="/edit"]');
        if (preferred && preferred.getAttribute('href')) {
            return preferred.href;
        }

        const links = [...document.querySelectorAll('a[href*="/customers/"][href$="/edit"]')];
        const firstValid = links.find(link => {
            const rawHref = link.getAttribute('href') || '';
            return /\/customers\/\d+\/edit$/i.test(rawHref) || /\/customers\/\d+\/edit$/i.test(link.href || '');
        });

        return firstValid ? firstValid.href : '';
    }

    function getVisibleEmailElement(panel) {
        if (!panel) return null;

        const candidates = [...panel.querySelectorAll('*')].filter(el => {
            if (!isVisible(el) || el.id === PLACEHOLDER_ID) return false;
            const text = (el.innerText || el.textContent || '').trim();
            return EMAIL_RE.test(text);
        });

        candidates.sort((a, b) => {
            const aLen = ((a.innerText || a.textContent || '').trim()).length;
            const bLen = ((b.innerText || b.textContent || '').trim()).length;
            return aLen - bLen;
        });

        return candidates[0] || null;
    }

    function hasVisibleNameAboveEmail(panel, emailEl) {
        if (!panel || !emailEl) return false;

        const emailRect = emailEl.getBoundingClientRect();
        const candidates = [...panel.querySelectorAll('*')].filter(el => {
            if (!isVisible(el) || el.id === PLACEHOLDER_ID || el === emailEl) return false;

            const text = (el.innerText || el.textContent || '').trim();
            if (!text) return false;
            if (EMAIL_RE.test(text)) return false;
            if (text === PLACEHOLDER_TEXT) return false;

            const rect = el.getBoundingClientRect();
            if (rect.top >= emailRect.top - 2) return false;

            return true;
        });

        return candidates.some(el => {
            const text = (el.innerText || el.textContent || '').trim();
            return !!text && !EMAIL_RE.test(text) && text !== PLACEHOLDER_TEXT;
        });
    }

    function buildPlaceholderLink(href, emailText) {
        const link = document.createElement('a');
        link.id = PLACEHOLDER_ID;
        link.textContent = PLACEHOLDER_TEXT;
        link.href = href || '#';
        link.title = emailText || 'Customer profile';

        if (href) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }

        link.style.color = PLACEHOLDER_COLOR;
        link.style.fontWeight = '700';
        link.style.fontSize = '24px';
        link.style.lineHeight = '1.2';
        link.style.margin = '10px 0 8px 0';
        link.style.textAlign = 'left';
        link.style.display = 'block';
        link.style.textDecoration = 'none';
        link.style.cursor = href ? 'pointer' : 'default';

        return link;
    }

    function removePlaceholder() {
        const placeholder = document.getElementById(PLACEHOLDER_ID);
        if (placeholder) {
            placeholder.remove();
        }
    }

    function applyPlaceholder() {
        const panel = getCustomerIntelligencePanel();
        if (!panel) return false;

        const emailEl = getVisibleEmailElement(panel);
        if (!emailEl) {
            removePlaceholder();
            return false;
        }

        if (hasVisibleNameAboveEmail(panel, emailEl)) {
            removePlaceholder();
            return true;
        }

        const href = getCustomerProfileHref();
        const emailText = (emailEl.innerText || emailEl.textContent || '').trim();

        let placeholder = document.getElementById(PLACEHOLDER_ID);
        if (!placeholder) {
            placeholder = buildPlaceholderLink(href, emailText);
            emailEl.parentNode.insertBefore(placeholder, emailEl);
            return true;
        }

        if (placeholder.parentNode !== emailEl.parentNode || placeholder.nextSibling !== emailEl) {
            emailEl.parentNode.insertBefore(placeholder, emailEl);
        }

        if (href) {
            placeholder.href = href;
            placeholder.target = '_blank';
            placeholder.rel = 'noopener noreferrer';
            placeholder.style.cursor = 'pointer';
        } else {
            placeholder.href = '#';
            placeholder.removeAttribute('target');
            placeholder.removeAttribute('rel');
            placeholder.style.cursor = 'default';
        }

        placeholder.title = emailText || 'Customer profile';
        return true;
    }

    function init() {
        RETRY_DELAYS_MS.forEach(delay => {
            window.setTimeout(() => {
                applyPlaceholder();
            }, delay);
        });
    }

    init();
})();
