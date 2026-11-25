import { uiTooltip } from '../dom.js';
import { state } from '../state.js';
import { clamp } from '../utils.js';

const PIXO_TIP_ICON = 'assets/pixo_idle.png';

/* =========================================================================
   PIXO-POWERED INSTANT HOVER TOOLTIPS (data-tip="..." & title="...")
   Pixo powers all UI tool/button tooltips; toggling state.pixoTooltips off
   silences both custom and native browser tooltips cleanly.
   ========================================================================= */
function promoteNativeTitle(el) {
  if (!el || !el.getAttribute) return;
  const rawTitle = el.getAttribute('title');
  if (rawTitle && rawTitle.trim()) {
    if (!el.dataset.tip) {
      el.dataset.tip = rawTitle.trim();
    }
    el.removeAttribute('title');
  }
}

export function promoteAllNativeTitles(root = document) {
  if (!root || !root.querySelectorAll) return;
  const nodes = root.querySelectorAll('[title]');
  for (let i = 0; i < nodes.length; i++) {
    promoteNativeTitle(nodes[i]);
  }
}

export function hideUiTooltip() {
  if (uiTooltip) uiTooltip.classList.remove('show');
}

export function initTooltipSystem() {
  let activeTarget = null;
  let tipIconEl = null;
  let tipTextEl = null;

  if (uiTooltip) {
    uiTooltip.innerHTML = '';
    tipIconEl = document.createElement('img');
    tipIconEl.className = 'ui-tooltip-pixo';
    tipIconEl.src = PIXO_TIP_ICON;
    tipIconEl.alt = '';
    tipIconEl.width = 16;
    tipIconEl.height = 16;
    tipTextEl = document.createElement('span');
    uiTooltip.appendChild(tipIconEl);
    uiTooltip.appendChild(tipTextEl);
  }

  // Convert static title attributes into Pixo-controlled data-tip on startup
  promoteAllNativeTitles(document);

  function findTipOwner(node) {
    if (!node || !node.closest) return null;
    const titled = node.closest('[title]');
    if (titled) promoteNativeTitle(titled);
    return node.closest('[data-tip]');
  }

  function positionTooltip(el) {
    const rect = el.getBoundingClientRect();
    // Reset to origin before measuring so tooltips near the right viewport edge measure natural unconstrained width
    uiTooltip.style.left = '0px';
    uiTooltip.style.top = '0px';
    const tipRect = uiTooltip.getBoundingClientRect();
    let left = rect.left + rect.width * 0.5 - tipRect.width * 0.5;
    let top = rect.bottom + 8;
    if (top + tipRect.height > window.innerHeight - 6) {
      top = rect.top - tipRect.height - 8;
    }
    left = clamp(left, 8, Math.max(8, window.innerWidth - tipRect.width - 8));
    top = clamp(top, 8, Math.max(8, window.innerHeight - tipRect.height - 8));
    uiTooltip.style.left = Math.round(left) + 'px';
    uiTooltip.style.top = Math.round(top) + 'px';
  }

  document.addEventListener('pointerover', e => {
    const el = findTipOwner(e.target);
    if (!el || !el.dataset.tip) return;
    if (!state.pixoTooltips) {
      activeTarget = null;
      hideUiTooltip();
      return;
    }
    // Suppress trigger button tooltip while its own popover is open
    if (el.id === 'pixoMenuBtn' && document.getElementById('pixoPopover')?.classList.contains('open')) return;
    if (el.id === 'audioMenuBtn' && document.getElementById('audioPopover')?.classList.contains('open')) return;
    activeTarget = el;
    if (tipTextEl) tipTextEl.textContent = el.dataset.tip;
    else uiTooltip.textContent = el.dataset.tip;
    uiTooltip.classList.add('show');
    positionTooltip(el);
  });

  document.addEventListener('pointerout', e => {
    if (!activeTarget) return;
    const to = findTipOwner(e.relatedTarget);
    if (to === activeTarget) return;
    activeTarget = null;
    hideUiTooltip();
  });

  document.addEventListener('pointerdown', () => {
    activeTarget = null;
    hideUiTooltip();
  });

  window.addEventListener('blur', () => {
    activeTarget = null;
    hideUiTooltip();
  });
}
