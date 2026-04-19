// ==UserScript==
// @name         Autosure Probe 18789
// @namespace    autosure.openclaw.probe
// @version      1.0.2
// @description  Hard probe for OpenClaw chat injection on 127.0.0.1:18789.
// @match        http://127.0.0.1:18789/chat*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  alert('Autosure probe injected: 1.0.2');

  const id = 'autosure-probe-fixed-18789';
  if (document.getElementById(id)) return;

  const root = document.createElement('div');
  root.id = id;
  root.textContent = 'AUTOSURE PROBE OK';
  root.style.position = 'fixed';
  root.style.top = '16px';
  root.style.right = '16px';
  root.style.zIndex = '2147483647';
  root.style.padding = '12px 14px';
  root.style.background = '#d11';
  root.style.color = '#fff';
  root.style.font = '700 14px/1.2 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  root.style.borderRadius = '12px';
  root.style.boxShadow = '0 10px 30px rgba(0,0,0,.28)';
  root.style.border = '2px solid rgba(255,255,255,.35)';
  document.body.appendChild(root);

  console.log('[autosure-probe] injected on', location.href);
})();
