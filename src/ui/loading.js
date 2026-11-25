import {
  loadingBarFill,
  loadingPct,
  loadingScreen,
  loadingStatus
} from '../dom.js';

/* =========================================================================
   REAL PROGRESS-TRACKING LOADING SCREEN CONTROLLER
   Used for returning page loads and switching/loading worlds.
   Driven strictly by real initialization & world-sync milestones (0..100%).
   ========================================================================= */
let hideTimer = null;
let currentPct = 0;

export function yieldFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export function showLoadingScreen(statusText = 'LOADING...', initialPct = 0) {
  if (!loadingScreen) return;
  clearTimeout(hideTimer);
  hideTimer = null;
  currentPct = Math.max(0, Math.min(100, Number(initialPct) || 0));
  if (loadingBarFill) loadingBarFill.style.width = `${currentPct}%`;
  if (loadingPct) loadingPct.textContent = `${Math.round(currentPct)}%`;
  if (loadingStatus) loadingStatus.textContent = String(statusText || 'LOADING...').toUpperCase();
  loadingScreen.classList.remove('fading');
  loadingScreen.classList.add('open');
}

export function setLoadingProgress(pct, statusText) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  currentPct = clamped;
  if (loadingBarFill) loadingBarFill.style.width = `${clamped}%`;
  if (loadingPct) loadingPct.textContent = `${Math.round(clamped)}%`;
  if (statusText !== undefined && loadingStatus) {
    loadingStatus.textContent = String(statusText).toUpperCase();
  }
}

export function hideLoadingScreen(immediate = false) {
  if (!loadingScreen) return;
  clearTimeout(hideTimer);
  hideTimer = null;
  if (immediate) {
    loadingScreen.classList.remove('open', 'fading');
    return;
  }
  if (!loadingScreen.classList.contains('open')) return;
  loadingScreen.classList.add('fading');
  hideTimer = setTimeout(() => {
    hideTimer = null;
    loadingScreen.classList.remove('open', 'fading');
  }, 200);
}
