// @file_name = PCM_Shared_Library.user.js
// @author = Kardo Rostam
// @version = 2.1_2026-09-04
// @created = 2026-03-30 18:35 (v1.0)

/*
    PCM Shared Library
    -----------
    Shared DOM AND runtime helpers for the PCM Tampermonkey scripts:
    anything several feature scripts would otherwise duplicate lives here.
    (Named PCM_DOM_Shared_Local until v1.9; the global stays PCM_DOM.)

    Goal:
    - Keep DOM/runtime behavior here
    - Keep feature scripts focused on state and styling only

    Included:
    - boot/retry logic
    - style-tag injection
    - common text / visibility helpers
    - widget lookup by title
    - widget body lookup
    - query / query-all text helpers
    - accordion pane / toggle resolution
    - safe click-and-wait helper
    - temporary hide / restore helper
    - temporary accordion open / restore helper
    - generic table row reading helper
    - query / bind / rebind
    - common observer root selection
    - mutation observer lifecycle
    - pause when hidden / resume refresh
    - field update runtime for existing form controls
    - string cleaning / promise wait / regexp escaping (v1.8)
    - text and element deduping (v1.8)
    - localStorage JSON read/write (v1.8)
    - visibility gate: skip work while the tab is hidden, catch up on return (v1.8)
    - SPA navigation hooks: one shared history wrap, per-script callbacks (v1.9)
    - label-based form field finder with a connected-node cache (v2.0)
    - select-aware native field value setter firing input/change (v2.0)
    - Summernote editor helpers: text to HTML, emptiness, append (v2.0)
    - transient button label flash (v2.0)
    - unsaved-change watcher engine: snapshot baseline, label keying,
      re-render handling, per-zone save clearing (v2.0)

    Backward compatibility:
    - Existing exports are kept unchanged
    - New helpers are additive only
*/

(function(global) {
    'use strict';

    const DEFAULT_CONFIG = {
        REFRESH_DEBOUNCE_MS: 120,
        PAUSE_WHEN_HIDDEN: true,
        RESUME_REFRESH_DELAY_MS: 160,
        OBSERVE_SUBTREE: true,
        OBSERVER_APPLY_DELAY_MS: 120,
        BOOT_MAX_TRIES: 30,
        BOOT_INTERVAL_MS: 250
    };

    function assignDefined(target, source) {
        if (!source) return target;
        Object.keys(source).forEach((key) => {
            if (source[key] !== undefined) {
                target[key] = source[key];
            }
        });
        return target;
    }

    function mergeConfig(overrides) {
        return assignDefined(assignDefined({}, DEFAULT_CONFIG), overrides || {});
    }

    function clearTimer(timerId) {
        if (timerId) {
            clearTimeout(timerId);
        }
        return 0;
    }

    function ensureStyleTag(styleId, cssText) {
        if (!styleId || !cssText) return null;

        let style = document.getElementById(styleId);
        if (style) return style;

        style = document.createElement('style');
        style.id = styleId;
        style.textContent = cssText;
        document.head.appendChild(style);
        return style;
    }

    function cleanText(value) {
        return String(value == null ? '' : value)
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function text(node) {
        return cleanText(node && (node.textContent || node.innerText || ''));
    }

    function visible(node) {
        if (!node) return false;
        // Single computed-style read: getComputedStyle forces style
        // recalculation, so reading it twice per element doubled the cost
        // in per-row loops.
        const style = window.getComputedStyle(node);
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            node.getClientRects().length > 0;
    }

    function wait(ms) {
        return new Promise(function(resolve) {
            window.setTimeout(resolve, typeof ms === 'number' ? ms : 0);
        });
    }

    function escapeRegExp(value) {
        return String(value == null ? '' : value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function uniqueTexts(values) {
        return [...new Map((values || []).map(function(value) {
            const cleaned = cleanText(value);
            return [cleaned.toLowerCase(), cleaned];
        })).values()].filter(Boolean);
    }

    function uniqueElements(elements) {
        const seen = new Set();
        const result = [];

        (elements || []).forEach(function(element) {
            if (!element || seen.has(element)) return;
            seen.add(element);
            result.push(element);
        });

        return result;
    }

    function readJson(key, fallbackValue) {
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return fallbackValue;
            return JSON.parse(raw);
        } catch (_) {
            return fallbackValue;
        }
    }

    function writeJson(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            console.warn('PCM_DOM.writeJson: could not write key ' + key, err);
            return false;
        }
    }

    // Battery pattern shared by feature scripts: debounced work that is
    // skipped entirely while the tab is hidden, with one catch-up run when
    // the tab becomes visible again.
    function createVisibilityGate(runFn, defaultDelayMs) {
        const run = typeof runFn === 'function' ? runFn : function() {};
        const baseDelay = typeof defaultDelayMs === 'number' ? defaultDelayMs : 80;
        let timerId = 0;
        let pending = false;

        function schedule(delayMs) {
            if (document.hidden) {
                pending = true;
                return;
            }
            timerId = clearTimer(timerId);
            timerId = window.setTimeout(function() {
                timerId = 0;
                run();
            }, typeof delayMs === 'number' ? delayMs : baseDelay);
        }

        function cancel() {
            pending = false;
            timerId = clearTimer(timerId);
        }

        function onVisibilityChange() {
            if (!document.hidden && pending) {
                pending = false;
                schedule();
            }
        }

        function destroy() {
            cancel();
            document.removeEventListener('visibilitychange', onVisibilityChange, false);
        }

        document.addEventListener('visibilitychange', onVisibilityChange, false);

        return { schedule: schedule, cancel: cancel, destroy: destroy };
    }

    function query(selector, root) {
        return (root || document).querySelector(selector);
    }

    function queryAll(selector, root) {
        return Array.from((root || document).querySelectorAll(selector));
    }

    function queryText(selector, root) {
        return text(query(selector, root));
    }

    function queryAllText(selector, root) {
        return queryAll(selector, root).map(text).filter(Boolean);
    }

    function findWidgetByTitle(title, root) {
        const wanted = text(title).toLowerCase();
        if (!wanted) return null;

        for (const el of queryAll('.jarviswidget header strong, header h2 strong, h2 strong', root)) {
            if (text(el).toLowerCase() !== wanted) continue;
            return el.closest('.jarviswidget') || el.closest('section') || el.closest('div') || null;
        }

        return null;
    }

    function findWidgetBody(root) {
        return query('.jarviswidget-editbox, .widget-body, .panel-body', root) || root || null;
    }

    function findElementsByExactText(selector, expectedText, root) {
        const wanted = text(expectedText);
        if (!wanted) return [];

        return queryAll(selector || '*', root).filter(function(node) {
            return text(node) === wanted;
        });
    }

    function findFirstByExactText(selector, expectedText, root) {
        return findElementsByExactText(selector, expectedText, root)[0] || null;
    }

    function findAccordionParts(root, targetSelector) {
        const target = String(targetSelector || '').trim();
        if (!root || !target) {
            return { accordion: null, toggle: null, pane: null, href: '' };
        }

        const href = target.charAt(0) === '#' ? target : ('#' + target);
        const targetId = href.slice(1);
        const accordion = targetId ? (root.querySelector('#' + targetId + '-accordion') || null) : null;
        const toggle = accordion
            ? (accordion.querySelector('.panel-title a[href="' + href + '"]') || accordion.querySelector('a[href="' + href + '"]') || null)
            : (root.querySelector('.panel-title a[href="' + href + '"]') || root.querySelector('a[href="' + href + '"]') || null);
        const pane = (href && root.querySelector(href)) ||
            (accordion && (accordion.querySelector('.panel-collapse, .collapse') || null)) ||
            (targetId ? (root.querySelector('#' + targetId) || null) : null);

        return { accordion, toggle, pane, href };
    }

    function clickAndWait(element, delayMs) {
        return new Promise(function(resolve) {
            if (!element) {
                resolve(false);
                return;
            }

            element.click();
            window.setTimeout(function() {
                resolve(true);
            }, typeof delayMs === 'number' ? delayMs : 0);
        });
    }

    function withTemporarilyHidden(element, workFn) {
        const target = element || null;
        const fn = typeof workFn === 'function' ? workFn : function() {};

        if (!target) {
            return Promise.resolve().then(fn);
        }

        const previousDisplay = target.style.display;
        const previousVisibility = target.style.visibility;
        const previousPointerEvents = target.style.pointerEvents;

        target.style.visibility = 'hidden';
        target.style.pointerEvents = 'none';

        return Promise.resolve()
            .then(fn)
            .finally(function() {
                target.style.display = previousDisplay;
                target.style.visibility = previousVisibility;
                target.style.pointerEvents = previousPointerEvents;
            });
    }

    function withAccordionTemporarilyOpen(root, targetSelector, options, workFn) {
        let opts = options;
        let fn = workFn;

        if (typeof opts === 'function') {
            fn = opts;
            opts = {};
        }

        const config = opts || {};
        const worker = typeof fn === 'function' ? fn : function() {};
        const parts = findAccordionParts(root, targetSelector);
        const wasOpen = visible(parts.pane);
        const hideTarget = config.hideElement || null;
        const openDelayMs = typeof config.openDelayMs === 'number' ? config.openDelayMs : 500;
        const closeDelayMs = typeof config.closeDelayMs === 'number' ? config.closeDelayMs : 120;

        function runWork(openedByHelper) {
            return Promise.resolve(worker({
                accordion: parts.accordion,
                toggle: parts.toggle,
                pane: parts.pane,
                href: parts.href,
                wasOpen: wasOpen,
                openedByHelper: openedByHelper
            })).finally(function() {
                if (openedByHelper && parts.toggle && visible(parts.pane)) {
                    return clickAndWait(parts.toggle, closeDelayMs);
                }
                return null;
            });
        }

        return withTemporarilyHidden(hideTarget, function() {
            if (!parts.pane || wasOpen || !parts.toggle) {
                return runWork(false);
            }

            return clickAndWait(parts.toggle, openDelayMs).then(function() {
                return runWork(true);
            });
        });
    }

    function readTableRows(root, rowSelector) {
        const rows = [];

        queryAll(rowSelector || 'tr', root).forEach(function(row, index) {
            const cells = queryAll('td, th', row).map(text).filter(Boolean);
            if (!cells.length) return;

            rows.push({
                index: index,
                element: row,
                visible: visible(row),
                cells: cells
            });
        });

        return rows;
    }

    function getAncestorChain(node) {
        const chain = [];
        let current = node;

        while (current && current.nodeType === 1) {
            chain.push(current);
            current = current.parentElement;
        }

        return chain;
    }

    function findCommonAncestor(nodes) {
        const valid = (nodes || []).filter(Boolean);
        if (valid.length === 0) return null;
        if (valid.length === 1) return valid[0];

        let current = valid[0];
        const otherChains = valid.slice(1).map(function(node) {
            return new Set(getAncestorChain(node));
        });

        while (current && current.nodeType === 1) {
            let isCommon = true;
            for (const chain of otherChains) {
                if (!chain.has(current)) {
                    isCommon = false;
                    break;
                }
            }

            if (isCommon) return current;
            current = current.parentElement;
        }

        return null;
    }

    function findObserverRoot(elements) {
        const present = (elements || []).filter(Boolean);
        const common = findCommonAncestor(present);

        if (common) return common;

        const first = present[0];
        if (!first) return document.body || document.documentElement || null;

        return first.closest('form') || first.parentElement || document.body || document.documentElement || null;
    }

    // One shared answer to "the SPA navigated": wraps history.pushState and
    // history.replaceState ONCE per page (even when several scripts load
    // their own copy of this library, thanks to the marker on the wrapped
    // function) and dispatches a single shared event. Each caller's
    // callback also hears popstate and hashchange.
    const NAVIGATION_EVENT = 'pcm-dom-navigation';

    function installNavigationHooks(onNavigate) {
        if (typeof onNavigate === 'function') {
            window.addEventListener(NAVIGATION_EVENT, onNavigate, true);
            window.addEventListener('popstate', onNavigate, true);
            window.addEventListener('hashchange', onNavigate, true);
        }

        const fire = function() {
            try { window.dispatchEvent(new Event(NAVIGATION_EVENT)); } catch (_) { /* ignore */ }
        };

        const wrap = function(methodName) {
            const original = history[methodName];
            if (typeof original !== 'function' || original.__pcmDomNavWrapped) return;

            const wrapped = function() {
                const result = original.apply(this, arguments);
                fire();
                return result;
            };
            wrapped.__pcmDomNavWrapped = true;
            history[methodName] = wrapped;
        };

        wrap('pushState');
        wrap('replaceState');
    }

    function bootUntil(testFn, onReady, config) {
        let tries = 0;
        let timerId = 0;
        let stopped = false;
        const mergedConfig = mergeConfig(config);

        function stop() {
            stopped = true;
            timerId = clearTimer(timerId);
        }

        function tick() {
            if (stopped) return;

            if (testFn()) {
                onReady();
                return;
            }

            tries += 1;
            if (tries >= mergedConfig.BOOT_MAX_TRIES) return;

            timerId = window.setTimeout(tick, mergedConfig.BOOT_INTERVAL_MS);
        }

        tick();

        return { stop: stop };
    }

    function createFieldRuntime(options) {
        if (!options || !Array.isArray(options.fields) || options.fields.length === 0) {
            throw new Error('PCM_DOM.createFieldRuntime requires a non-empty fields array.');
        }

        if (typeof options.getState !== 'function') {
            throw new Error('PCM_DOM.createFieldRuntime requires a getState function.');
        }

        if (typeof options.applyState !== 'function') {
            throw new Error('PCM_DOM.createFieldRuntime requires an applyState function.');
        }

        if (typeof options.resetState !== 'function') {
            throw new Error('PCM_DOM.createFieldRuntime requires a resetState function.');
        }

        const config = mergeConfig(options.config);
        const eventType = options.eventType || 'change';
        const fields = options.fields.map(function(field, index) {
            return {
                key: field.key || ('field_' + index),
                selector: field.selector,
                eventType: field.eventType || eventType,
                elements: [],
                handlers: new Map()
            };
        });

        let observer = null;
        let observerRoot = null;
        let refreshTimer = 0;
        let resumeTimer = 0;
        let bootHandle = null;
        let started = false;
        let destroyed = false;

        function getElements() {
            return fields.flatMap(function(field) {
                return field.elements;
            }).filter(Boolean);
        }

        function queryFieldElements(field) {
            return field.selector ? queryAll(field.selector) : [];
        }

        function updateField(field, element) {
            const state = options.getState(field.key, element);

            if (state) {
                options.applyState(field.key, element, state);
            } else {
                options.resetState(field.key, element);
            }
        }

        function unbindFieldElement(field, element) {
            if (!element) return;

            const handler = field.handlers.get(element);
            if (handler) {
                element.removeEventListener(field.eventType, handler);
                field.handlers.delete(element);
            }
        }

        function bindFieldElement(field, element) {
            if (!element) return;

            let handler = field.handlers.get(element);
            if (!handler) {
                handler = function(event) {
                    updateField(field, event.currentTarget);
                };

                field.handlers.set(element, handler);
                element.addEventListener(field.eventType, handler, { passive: true });
            }

            updateField(field, element);
        }

        function refreshBindings() {
            refreshTimer = 0;

            fields.forEach(function(field) {
                const elements = queryFieldElements(field);
                const nextElements = new Set(elements);

                field.elements.forEach(function(element) {
                    if (!nextElements.has(element)) {
                        unbindFieldElement(field, element);
                    }
                });

                elements.forEach(function(element) {
                    bindFieldElement(field, element);
                });

                field.elements = elements;
            });

            startObserver();
        }

        function stopObserver() {
            if (observer) {
                observer.disconnect();
            }
            observerRoot = null;
        }

        function startObserver() {
            if (destroyed) return;
            if (config.PAUSE_WHEN_HIDDEN && document.hidden) return;

            const nextRoot = findObserverRoot(getElements());
            if (!nextRoot) return;

            if (!observer) {
                observer = new MutationObserver(function() {
                    if (config.PAUSE_WHEN_HIDDEN && document.hidden) return;
                    queueRefresh(config.OBSERVER_APPLY_DELAY_MS);
                });
            }

            if (observerRoot === nextRoot) return;

            stopObserver();
            observer.observe(nextRoot, {
                childList: true,
                subtree: !!config.OBSERVE_SUBTREE
            });
            observerRoot = nextRoot;
        }

        function queueRefresh(delay) {
            refreshTimer = clearTimer(refreshTimer);
            refreshTimer = window.setTimeout(
                refreshBindings,
                typeof delay === 'number' ? Math.max(0, delay | 0) : config.REFRESH_DEBOUNCE_MS
            );
        }

        function clearAllTimers() {
            refreshTimer = clearTimer(refreshTimer);
            resumeTimer = clearTimer(resumeTimer);
        }

        function onVisibilityChange() {
            if (!config.PAUSE_WHEN_HIDDEN || destroyed) return;

            clearAllTimers();

            if (document.hidden) {
                stopObserver();
                return;
            }

            resumeTimer = window.setTimeout(function() {
                resumeTimer = 0;
                refreshBindings();
            }, config.RESUME_REFRESH_DELAY_MS);
        }

        function readyTest() {
            if (!document.body) return false;
            return fields.some(function(field) {
                return queryFieldElements(field).length > 0;
            });
        }

        function start() {
            if (started || destroyed) return api;
            started = true;

            ensureStyleTag(options.styleId, options.cssText);

            function readyStart() {
                refreshBindings();

                if (config.PAUSE_WHEN_HIDDEN) {
                    document.addEventListener('visibilitychange', onVisibilityChange, false);
                }
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    if (destroyed) return;
                    bootHandle = bootUntil(readyTest, readyStart, config);
                }, { once: true });
            } else {
                bootHandle = bootUntil(readyTest, readyStart, config);
            }

            return api;
        }

        function destroy() {
            destroyed = true;
            clearAllTimers();
            stopObserver();

            fields.forEach(function(field) {
                field.elements.forEach(function(element) {
                    unbindFieldElement(field, element);
                });
                field.elements = [];
                field.handlers.clear();
            });

            if (bootHandle && typeof bootHandle.stop === 'function') {
                bootHandle.stop();
            }

            if (config.PAUSE_WHEN_HIDDEN) {
                document.removeEventListener('visibilitychange', onVisibilityChange, false);
            }
        }

        const api = {
            start: start,
            destroy: destroy,
            queueRefresh: queueRefresh,
            refreshBindings: refreshBindings,
            getConfig: function() {
                return assignDefined({}, config);
            }
        };

        return api;
    }

    // ---- v2.0 helpers: shared by the Forms and Reply_Editor scripts ----

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // One <p> per line, like pressing Enter in Summernote. Empty lines
    // use PCM's own empty-paragraph markup so they render as blank
    // lines. Leading tabs and spaces become non-breaking spaces so
    // indented lines keep their indentation.
    function editorTextToHtml(textValue) {
        return String(textValue).split('\n').map(function(line) {
            if (!line) return '<p><span></span><br></p>';
            const indented = line.replace(/^[ \t]+/, function(ws) {
                return ws.replace(/\t/g, '    ').replace(/ /g, ' ');
            });
            return '<p>' + escapeHtml(indented) + '</p>';
        }).join('');
    }

    // Visually empty: no text and no image. Summernote's own isEmpty is
    // unusable because PCM's fresh editor holds <p><span></span><br></p>.
    function editorIsEmpty(container) {
        const editable = container.querySelector('.note-editable');
        if (!editable) return true;
        return !cleanText(editable.textContent) && !editable.querySelector('img');
    }

    // Append via the Summernote API when the original element is
    // reachable (walks back over injected bars between the original and
    // the editor container); falls back to direct DOM insertion plus an
    // input event.
    function editorAppendHtml(container, html) {
        const jq = window.jQuery;
        let orig = container.previousElementSibling;
        while (orig && !(jq && jq(orig).data && jq(orig).data('summernote'))) {
            orig = orig.previousElementSibling;
        }
        const empty = editorIsEmpty(container);
        if (jq && orig) {
            const current = empty ? '' : jq(orig).summernote('code');
            jq(orig).summernote('code', current + html);
            return true;
        }
        const editable = container.querySelector('.note-editable');
        if (!editable) return false;
        if (empty) {
            editable.innerHTML = html;
        } else {
            editable.insertAdjacentHTML('beforeend', html);
        }
        editable.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    // Select-aware value setter. Selects pick the option matching value
    // or visible text (false when none matches, so callers can report
    // instead of silently keeping the default). Inputs and textareas go
    // through the native setter so framework bindings register the
    // change; input and change events fire either way.
    function setNativeFieldValue(field, value) {
        if (field.tagName === 'SELECT') {
            const wanted = cleanText(value).toLowerCase();
            const option = Array.prototype.find.call(field.options, function(opt) {
                return cleanText(opt.textContent).toLowerCase() === wanted ||
                    cleanText(opt.value).toLowerCase() === wanted;
            });
            if (!option) return false;
            field.value = option.value;
            field.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
            descriptor.set.call(field, value);
        } else {
            field.value = value;
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    // Briefly swaps an element's text (e.g. a button label) and restores
    // it. Re-entrant safe via a dataset guard.
    function flashLabel(element, message, holdMs) {
        if (!element || element.dataset.pcmDomFlashing) return;
        element.dataset.pcmDomFlashing = '1';
        const original = element.textContent;
        element.textContent = message;
        window.setTimeout(function() {
            element.textContent = original;
            delete element.dataset.pcmDomFlashing;
        }, typeof holdMs === 'number' ? holdMs : 1500);
    }

    // Label-based form field lookup with a connected-node cache.
    // Re-renders replace the nodes, so a cached field is valid exactly
    // as long as it is still connected. Text is matched BEFORE the
    // visibility check: visible() forces a style read and must only run
    // on the handful of text matches.
    function createFieldFinder(options) {
        const config = options || {};
        const rootSelector = config.rootSelector || '#form-fields-wrapper';
        const fieldSelector = config.fieldSelector || 'input, textarea, select';
        const excludeSelector = config.excludeSelector || null;
        const cache = new Map();

        function parts(labelText) {
            const wanted = cleanText(labelText).toLowerCase();
            const searchRoot = query(rootSelector) || document;
            const label = queryAll('label, legend, div, span, strong, b, p, h1, h2, h3, h4, h5, h6, td, th', searchRoot)
                .filter(function(el) {
                    const value = cleanText(text(el)).toLowerCase();
                    return value === wanted || value === wanted + ':';
                })
                .filter(function(el) {
                    return !excludeSelector || !el.closest(excludeSelector);
                })
                .find(visible);
            if (!label) return null;

            const forId = label.getAttribute ? label.getAttribute('for') : '';
            if (forId) {
                const direct = document.getElementById(forId);
                if (direct) return { label: label, field: direct };
            }

            // Walk up from the label and prefer the first field that
            // FOLLOWS it in document order: in a vertical form that is
            // the box under the label.
            const isCandidate = function(el) {
                return el.type !== 'hidden' && !el.disabled &&
                    (!excludeSelector || !el.closest(excludeSelector));
            };
            let scope = label;
            for (let i = 0; i < 6 && scope; i += 1) {
                scope = scope.parentElement;
                if (!scope || scope === document.body) break;
                const fields = queryAll(fieldSelector, scope).filter(isCandidate);
                if (!fields.length) continue;
                const following = fields.find(function(el) {
                    return label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
                });
                return { label: label, field: following || fields[0] };
            }
            return null;
        }

        function field(labelText) {
            const cached = cache.get(labelText);
            if (cached && cached.isConnected) return cached;
            cache.delete(labelText);
            const found = parts(labelText);
            if (found && found.field) {
                cache.set(labelText, found.field);
                return found.field;
            }
            return null;
        }

        return { field: field, parts: parts };
    }

    // Unsaved-change watcher engine, extracted from PCM Unsaved Form
    // Warning so every widget zone (Forms, Attributes, ...) runs the
    // same proven machinery with its own baseline, warning element, and
    // save clearing. The feature script owns the CSS for fieldClass,
    // fieldClass-wrap, and warningId; the engine only toggles classes.
    function createUnsavedWatcher(options) {
        const config = options || {};
        if (typeof config.findRoot !== 'function') {
            throw new Error('PCM_DOM.createUnsavedWatcher requires a findRoot function.');
        }

        const warningId = config.warningId || 'pcm-unsaved-warning';
        const fieldClass = config.fieldClass || 'pcm-unsaved-field';
        const warningText = config.warningText || 'Unsaved values exist';
        const fieldSelector = config.fieldSelector || 'input:not([type="hidden"]), textarea, select';
        const useWrapRing = config.useWrapRing !== false;
        const warnOnLeave = !!config.warnOnLeave;
        const evaluateDebounceMs = typeof config.evaluateDebounceMs === 'number' ? config.evaluateDebounceMs : 100;
        const rebaseDebounceMs = typeof config.rebaseDebounceMs === 'number' ? config.rebaseDebounceMs : 60;
        const userRerenderWindowMs = typeof config.userRerenderWindowMs === 'number' ? config.userRerenderWindowMs : 4000;

        const findActions = config.findActions || function(root) {
            return (root && query('.form-actions', root)) || null;
        };
        const getWrapper = config.getWrapper || function(fieldEl) {
            return fieldEl.closest('label.select, label.input, label.textarea');
        };
        const excludeField = config.excludeField || function(fieldEl) {
            return !!fieldEl.closest('.form-actions');
        };
        const saveInScope = config.saveInScope || function(btn, root) {
            if (!root) return false;
            if (root.contains(btn)) return true;
            const widget = root.closest('.jarviswidget, section');
            return !!(widget && widget.contains(btn));
        };

        let baseline = new Map();
        let dirty = false;
        let fieldsObserver = null;
        let fieldsObserverRoot = null;
        let lastFieldChangeAt = 0;

        function getFields(root) {
            return queryAll(fieldSelector, root).filter(function(el) { return !excludeField(el); });
        }

        function fieldValue(fieldEl) {
            if (fieldEl.type === 'checkbox' || fieldEl.type === 'radio') {
                return (fieldEl.checked ? '1:' : '0:') + String(fieldEl.value);
            }
            return String(fieldEl.value);
        }

        function hasMeaningfulValue(fieldEl) {
            if (fieldEl.type === 'checkbox' || fieldEl.type === 'radio') return fieldEl.checked;
            return cleanText(fieldEl.value) !== '';
        }

        function fieldLabel(fieldEl) {
            const section = fieldEl.closest('section, .form-group, .col-md-5, [class*="col"]');
            const label = section ? query('label.label, label', section) : null;
            return cleanText(label ? label.textContent : '') || fieldEl.name || fieldEl.id || 'field';
        }

        // Keyed by visible LABEL, not DOM node, so the baseline survives
        // re-renders that rebuild the inputs. Duplicates get a suffix.
        function keyedFields(root) {
            const counts = new Map();
            return getFields(root).map(function(fieldEl) {
                const base = cleanText(fieldLabel(fieldEl)).toLowerCase().replace(/:$/, '');
                const occurrence = counts.get(base) || 0;
                counts.set(base, occurrence + 1);
                return { field: fieldEl, key: base + '#' + occurrence };
            });
        }

        function captureBaseline() {
            const root = config.findRoot();
            baseline = new Map();
            if (!root) return;
            keyedFields(root).forEach(function(entry) {
                baseline.set(entry.key, fieldValue(entry.field));
            });
        }

        function ensureWarningElement() {
            let el = query('#' + warningId);
            if (el && el.isConnected) return el;

            const root = config.findRoot();
            const actions = findActions(root);
            if (!actions) return null;

            const saveButton = query('button[type="submit"], input[type="submit"], button, a.btn', actions);
            el = document.createElement('span');
            el.id = warningId;
            el.textContent = warningText;
            if (saveButton) {
                actions.insertBefore(el, saveButton);
            } else {
                actions.appendChild(el);
            }
            return el;
        }

        function evaluate() {
            const root = config.findRoot();
            if (!root) return;

            const changed = [];
            keyedFields(root).forEach(function(entry) {
                const isChanged = baseline.has(entry.key)
                    ? baseline.get(entry.key) !== fieldValue(entry.field)
                    : hasMeaningfulValue(entry.field);

                entry.field.classList.toggle(fieldClass, isChanged);
                const wrap = getWrapper(entry.field);
                if (wrap) wrap.classList.toggle(fieldClass + '-wrap', isChanged && useWrapRing);
                if (isChanged) changed.push(entry.field);
            });

            dirty = changed.length > 0;
            const warning = ensureWarningElement();
            if (warning) {
                warning.classList.toggle('pcm-visible', dirty);
                warning.title = dirty ? 'Changed: ' + changed.map(fieldLabel).join(', ') : '';
            }
        }

        const evaluateGate = createVisibilityGate(evaluate, evaluateDebounceMs);

        function rebase() {
            captureBaseline();
            evaluate();
            ensureFieldsObserver();
        }

        const rebaseGate = createVisibilityGate(rebase, rebaseDebounceMs);

        function mutationTouchesFields(mutations) {
            for (const mutation of mutations) {
                const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
                for (const node of nodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches('input, textarea, select')) return true;
                    if (node.querySelector && node.querySelector('input, textarea, select')) return true;
                }
            }
            return false;
        }

        function ensureFieldsObserver() {
            if (fieldsObserverRoot && !fieldsObserverRoot.isConnected) fieldsObserverRoot = null;
            const root = config.findRoot();
            if (!root || !root.isConnected || fieldsObserverRoot === root) return;

            if (!fieldsObserver) {
                fieldsObserver = new MutationObserver(function(mutations) {
                    if (!mutationTouchesFields(mutations)) return;
                    // Swap caused by a recent change: keep the baseline,
                    // re-evaluate. Swap with no recent change: app
                    // refresh, rebase.
                    if (Date.now() - lastFieldChangeAt < userRerenderWindowMs) {
                        evaluateGate.schedule();
                    } else {
                        rebaseGate.schedule();
                    }
                });
            }

            fieldsObserver.disconnect();
            fieldsObserver.observe(root, { childList: true, subtree: true });
            fieldsObserverRoot = root;
        }

        function isSaveClick(event) {
            if (!event.isTrusted) return false;
            const btn = event.target && event.target.closest
                ? event.target.closest('button, input[type="submit"], a.btn')
                : null;
            if (!btn) return false;
            if (!/\bsave\b/i.test(cleanText(btn.textContent || btn.value || ''))) return false;
            return saveInScope(btn, config.findRoot());
        }

        function installListeners() {
            const onFieldEvent = function(event) {
                const root = config.findRoot();
                if (!root || !root.contains(event.target)) return;
                lastFieldChangeAt = Date.now();
                ensureFieldsObserver();
                evaluateGate.schedule();
            };
            document.addEventListener('input', onFieldEvent, true);
            document.addEventListener('change', onFieldEvent, true);

            // Chosen-style widgets announce changes with jQuery's
            // synthetic .trigger('change'), which native listeners never
            // receive. A jQuery-level binding catches those too; real
            // events arrive twice, which the debounced gate absorbs.
            const jq = window.jQuery;
            if (jq) jq(document).on('input change', onFieldEvent);

            document.addEventListener('click', function(event) {
                if (!isSaveClick(event)) return;
                // Saving stores the current values: new baseline for
                // THIS zone only.
                rebaseGate.cancel();
                rebase();
            }, true);

            if (warnOnLeave) {
                window.addEventListener('beforeunload', function(event) {
                    if (!dirty) return;
                    event.preventDefault();
                    event.returnValue = '';
                });
            }
        }

        function onRouteChange() {
            dirty = false;
            bootUntil(function() { return !!config.findRoot(); }, rebase, {
                BOOT_MAX_TRIES: 40,
                BOOT_INTERVAL_MS: 250
            });
        }

        function start() {
            bootUntil(function() { return !!(document.body && config.findRoot()); }, function() {
                installListeners();
                installNavigationHooks(onRouteChange);
                rebase();
            }, {
                BOOT_MAX_TRIES: config.bootMaxTries || 60,
                BOOT_INTERVAL_MS: config.bootIntervalMs || 250
            });
        }

        return {
            start: start,
            rebase: rebase,
            evaluate: evaluate,
            isDirty: function() { return dirty; }
        };
    }

    global.PCM_DOM = {
        LIB_VERSION: '2.1_2026-09-04',
        DEFAULT_CONFIG: assignDefined({}, DEFAULT_CONFIG),
        mergeConfig: mergeConfig,
        clearTimer: clearTimer,
        ensureStyleTag: ensureStyleTag,
        cleanText: cleanText,
        text: text,
        visible: visible,
        wait: wait,
        escapeRegExp: escapeRegExp,
        uniqueTexts: uniqueTexts,
        uniqueElements: uniqueElements,
        readJson: readJson,
        writeJson: writeJson,
        createVisibilityGate: createVisibilityGate,
        installNavigationHooks: installNavigationHooks,
        query: query,
        queryAll: queryAll,
        queryText: queryText,
        queryAllText: queryAllText,
        findWidgetByTitle: findWidgetByTitle,
        findWidgetBody: findWidgetBody,
        findElementsByExactText: findElementsByExactText,
        findFirstByExactText: findFirstByExactText,
        findAccordionParts: findAccordionParts,
        clickAndWait: clickAndWait,
        withTemporarilyHidden: withTemporarilyHidden,
        withAccordionTemporarilyOpen: withAccordionTemporarilyOpen,
        readTableRows: readTableRows,
        getAncestorChain: getAncestorChain,
        findCommonAncestor: findCommonAncestor,
        findObserverRoot: findObserverRoot,
        bootUntil: bootUntil,
        createFieldRuntime: createFieldRuntime,
        escapeHtml: escapeHtml,
        editorTextToHtml: editorTextToHtml,
        editorIsEmpty: editorIsEmpty,
        editorAppendHtml: editorAppendHtml,
        setNativeFieldValue: setNativeFieldValue,
        flashLabel: flashLabel,
        createFieldFinder: createFieldFinder,
        createUnsavedWatcher: createUnsavedWatcher
    };
})(window);
