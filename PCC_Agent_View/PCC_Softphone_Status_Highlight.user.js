// @file_name = PCC_Softphone_Status_Highlight.user.js
// @author = Kardo Rostam
// @version = 2.8_2026-08-27
// @created = 2026-02-16 16:28 (v1.0)
// ==UserScript==
// @name         Softphone Status Highlight (Sibling Value Target)
// @namespace    https://example.local/
// @version      2.8_2026-08-27
// @description  Color ONLY the existing value span after the 'Softphone:' label. Online = green (normal). Offline = red (3x). Observes DOM/text changes. No pseudo-elements; no duplicate text.
// @match        https://app.puzzel.com/agent/*
// @run-at       document-idle
// @grant        none
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
    el.classList.add('kr-softphone-value');
    el.classList.remove('kr-online','kr-offline');
    const txt = (el.textContent||'').toLowerCase();
    if(/\boffline\b/.test(txt)) el.classList.add('kr-offline');
    else if(/\bonline\b/.test(txt)) el.classList.add('kr-online');
  }

  function refresh(){
    injectCssOnce();
    // Re-acquire target if missing or detached
    if(!target || !document.documentElement.contains(target)){
      target = locateTarget();
    }
    if(target){ applyState(target); }
  }

  // Throttle refreshes to animation frames
  let rafId = null;
  function schedule(){ if(rafId) return; rafId = requestAnimationFrame(()=>{ rafId=null; refresh(); }); }

  // Observe DOM updates and text changes; this covers Aurelia re-renders
  const mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, { childList:true, subtree:true, characterData:true, attributes:true });
  window.addEventListener('resize', schedule, { passive:true });
  document.addEventListener('visibilitychange', schedule);

  // Initial run
  schedule();
})();
