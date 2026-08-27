// @file_name = PCC_Softphone_Status_Highlight.user.js
// @author = Kardo Rostam
// @version = 3.0_2026-08-27
// @created = 2026-02-16 16:28 (v1.0)

// ==UserScript==
// @name         PCC Softphone Status Highlight
// @namespace    https://github.com/kakardo/puzzel-userscripts
// @version      3.0_2026-08-27
// @description  Color ONLY the existing value span after the 'Softphone:' label. Online = green (normal). Offline = red (3x). Event-driven and battery friendly: header-scoped observer, no attribute observation, class writes only on state change.
// @author       Kardo Rostam
// @match        https://app.puzzel.com/agent/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Agent_View/PCC_Softphone_Status_Highlight.user.js
// @updateURL    https://raw.githubusercontent.com/kakardo/puzzel-userscripts/main/PCC_Agent_View/PCC_Softphone_Status_Highlight.user.js
// ==/UserScript==
(function(){
  'use strict';

  const STYLE_ID = 'kr-softphone-style';

  function injectCssOnce(){
    if(document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* Style only the real value span (Online/Offline) */
      .kr-softphone-value { font-weight: 600; }
      .kr-softphone-value.kr-online  { color: #00b050 !important; font-size: inherit !important; }
      .kr-softphone-value.kr-offline { color: #ff3b30 !important; font-size: 300% !important; }
    `;
    document.head.appendChild(s);
  }

  function isSoftphoneLabelEl(el){
    if(!el || el.nodeType !== 1) return false;
    // Prefer spans whose *own* text contains 'Softphone:' (case-insensitive)
    let own = '';
    for(const n of el.childNodes){ if(n.nodeType===Node.TEXT_NODE) own += n.textContent; }
    return /\bsoftphone\s*:\s*$/i.test((own||'').trim());
  }

  function pickValueSibling(labelEl){
    if(!labelEl) return null;
    let sib = labelEl.nextElementSibling;
    // Walk over empty nodes to the next element
    while(sib && sib.nodeType===1 && (sib.textContent||'').trim()==='') sib = sib.nextElementSibling;
    if(!sib) return null;
    const txt = (sib.textContent||'').toLowerCase();
    // Only accept siblings that actually contain Online/Offline
    if(/\bonline\b/.test(txt) || /\boffline\b/.test(txt)) return sib;
    return null;
  }

  let target = null; // the value span we style

  function locateTarget(){
    const header = document.querySelector('section.header');
    if(!header) return null;
    // Search for the label span by own text
    const candidates = header.querySelectorAll('span');
    for(const el of candidates){
      if(isSoftphoneLabelEl(el)){
        const val = pickValueSibling(el);
        if(val) return val;
      }
    }
    return null;
  }

  function applyState(el){
    if(!el) return;
    const txt = (el.textContent||'').toLowerCase();
    const desired = /\boffline\b/.test(txt) ? 'kr-offline'
                  : (/\bonline\b/.test(txt) ? 'kr-online' : '');
    // Only write classes when the state actually changed. Class writes are
    // attribute mutations; unconditional writes fed the observer a mutation on
    // every refresh, which kept the script looping at animation-frame rate.
    if(!el.classList.contains('kr-softphone-value')) el.classList.add('kr-softphone-value');
    if(desired !== 'kr-online'  && el.classList.contains('kr-online'))  el.classList.remove('kr-online');
    if(desired !== 'kr-offline' && el.classList.contains('kr-offline')) el.classList.remove('kr-offline');
    if(desired && !el.classList.contains(desired)) el.classList.add(desired);
  }

  function refresh(){
    injectCssOnce();
    // Re-acquire target if missing or detached
    if(!target || !document.documentElement.contains(target)){
      target = locateTarget();
    }
    if(target){ applyState(target); }
    rescope();
  }

  // Throttle refreshes to animation frames. rAF does not fire in hidden tabs,
  // so background mutations coalesce into a single refresh when the tab
  // becomes visible again (visibilitychange below guarantees that refresh).
  let rafId = null;
  function schedule(){ if(rafId) return; rafId = requestAnimationFrame(()=>{ rafId=null; refresh(); }); }

  // Value observer: scoped to section.header once it exists. No attribute
  // observation, so our own class writes can never re-trigger a refresh.
  const valueObserver = new MutationObserver(schedule);
  let valueRoot = null;
  function rescope(){
    const header = document.querySelector('section.header');
    const root = (header && document.documentElement.contains(header)) ? header : null;
    if(root === valueRoot) return;
    valueObserver.disconnect();
    valueRoot = root;
    if(valueRoot) valueObserver.observe(valueRoot, { childList:true, subtree:true, characterData:true });
  }

  // Structure watcher: cheap detachment guard for SPA re-renders. Its callback
  // is two isConnected checks; it only schedules work when the header or the
  // value span was actually replaced (or the header has not been found yet).
  const structureObserver = new MutationObserver(() => {
    if(!valueRoot || !valueRoot.isConnected || (target && !target.isConnected)){
      schedule();
    }
  });
  structureObserver.observe(document.documentElement, { childList:true, subtree:true });

  document.addEventListener('visibilitychange', schedule);

  // Initial run
  schedule();
})();
