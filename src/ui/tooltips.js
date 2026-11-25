import { uiTooltip } from '../dom.js';
import { clamp } from '../utils.js';

/* =========================================================================
   INSTANT CUSTOM HOVER TOOLTIPS (data-tip="...")
   ========================================================================= */
export function initTooltipSystem() {
  let activeTarget = null;

  function positionTooltip(el) {
    const rect = el.getBoundingClientRect();
    const tipRect = uiTooltip.getBoundingClientRect();
    let left = rect.left + rect.width * 0.5 - tipRect.width * 0.5;
    let top = rect.bottom + 8;
    if (top + tipRect.height > window.innerHeight - 6) {
      top = rect.top - tipRect.height - 8;
    }
    left = clamp(left, 6, Math.max(6, window.innerWidth - tipRect.width - 6));
    top = clamp(top, 6, Math.max(6, window.innerHeight - tipRect.height - 6));
    uiTooltip.style.left = Math.round(left) + 'px';
    uiTooltip.style.top = Math.round(top) + 'px';
  }

  document.addEventListener('pointerover', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!el) return;
    activeTarget = el;
    uiTooltip.textContent = el.dataset.tip;
    uiTooltip.classList.add('show');
    positionTooltip(el);
  });

  document.addEventListener('pointerout', e => {
    if (!activeTarget) return;
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-tip]') : null;
    if (to === activeTarget) return;
    activeTarget = null;
    uiTooltip.classList.remove('show');
  });

  document.addEventListener('pointerdown', () => {
    activeTarget = null;
    uiTooltip.classList.remove('show');
  });
}
