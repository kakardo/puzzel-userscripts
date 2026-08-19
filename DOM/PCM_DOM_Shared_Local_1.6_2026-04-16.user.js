// @file_name = PCM_DOM_Shared_Local_1.5_2026-04-01.txt
// @author = Kardo Rostam
// @version = 1.5_2026-04-01
// @created = 2026-03-30 18:35 (v1.0)

/*
    PCM DOM Shared Local
    --------------------
    External DOM library for Tampermonkey scripts.

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

    function text(node) {
        return String((node && (node.textContent || node.innerText || '')) || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function visible(node) {
        return !!node &&
            window.getComputedStyle(node).display !== 'none' &&
            window.getComputedStyle(node).visibility !== 'hidden' &&
            node.getClientRects().length > 0;
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

    global.PCM_DOM = {
        DEFAULT_CONFIG: assignDefined({}, DEFAULT_CONFIG),
        mergeConfig: mergeConfig,
        clearTimer: clearTimer,
        ensureStyleTag: ensureStyleTag,
        text: text,
        visible: visible,
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
        createFieldRuntime: createFieldRuntime
    };
})(window);
