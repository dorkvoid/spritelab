import { hideUiTooltip } from './tooltips.js';
import { clamp } from '../utils.js';

/* =========================================================================
   SPRITELAB DARK-STUDIO PIXEL DROPDOWN SYSTEM
   Progressively enhances native <select> elements inside the Create Editor
   with crisp dark-studio triggers and a floating portal listbox menu while
   preserving native .value, <option> lists, and 'change' events 100%.
   ========================================================================= */
const CARET_SVG =
  '<svg class="px-select-caret" viewBox="0 0 8 8" aria-hidden="true">' +
  '<rect x="1" y="2" width="6" height="1"/>' +
  '<rect x="2" y="3" width="4" height="1"/>' +
  '<rect x="3" y="4" width="2" height="1"/>' +
  '</svg>';

const CHECK_SVG =
  '<svg class="px-select-check" viewBox="0 0 8 8" aria-hidden="true">' +
  '<rect x="1" y="4" width="1" height="2"/>' +
  '<rect x="2" y="5" width="1" height="2"/>' +
  '<rect x="3" y="4" width="1" height="2"/>' +
  '<rect x="4" y="3" width="1" height="2"/>' +
  '<rect x="5" y="2" width="1" height="2"/>' +
  '<rect x="6" y="1" width="1" height="2"/>' +
  '</svg>';

const entriesBySelect = new WeakMap();
const allEntries = [];
const nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

let menuEl = null;
let activeEntry = null;
let highlightIdx = -1;
let globalWired = false;

function ensureMenuPortal() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.className = 'px-select-menu';
  menuEl.setAttribute('role', 'listbox');
  menuEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(menuEl);
  return menuEl;
}

function getSelectedLabel(selectEl) {
  const idx = selectEl.selectedIndex;
  if (idx >= 0 && selectEl.options[idx]) {
    return selectEl.options[idx].textContent || selectEl.options[idx].value || '';
  }
  if (selectEl.options.length > 0) {
    return selectEl.options[0].textContent || selectEl.options[0].value || '';
  }
  return selectEl.value || '';
}

export function syncCustomSelect(selectEl) {
  const entry = entriesBySelect.get(selectEl);
  if (!entry) return;
  entry.wrap.style.display = selectEl.style.display || '';
  entry.btn.disabled = Boolean(selectEl.disabled);
  entry.labelEl.textContent = getSelectedLabel(selectEl);
  entry.btn.dataset.value = selectEl.value || '';
  if (activeEntry === entry) {
    if (selectEl.style.display === 'none' || selectEl.disabled) {
      closeOpenCustomSelect(false);
    } else {
      renderMenuOptions(entry);
      positionMenu(entry);
    }
  }
}

export function syncAllCustomSelects() {
  for (let i = 0; i < allEntries.length; i++) {
    syncCustomSelect(allEntries[i].select);
  }
}

export function isCustomSelectOpen() {
  return Boolean(activeEntry);
}

export function closeOpenCustomSelect(restoreFocus = false) {
  if (!activeEntry) return false;
  const prev = activeEntry;
  activeEntry = null;
  highlightIdx = -1;
  prev.wrap.classList.remove('open');
  prev.btn.classList.remove('open');
  prev.btn.setAttribute('aria-expanded', 'false');
  if (menuEl) {
    menuEl.classList.remove('open', 'drop-up', 'compact');
    menuEl.setAttribute('aria-hidden', 'true');
    menuEl.innerHTML = '';
  }
  if (restoreFocus && prev.btn.isConnected) {
    prev.btn.focus();
  }
  return true;
}

function setHighlight(nextIdx) {
  if (!menuEl || !activeEntry) return;
  const opts = menuEl.querySelectorAll('.px-select-opt');
  if (!opts.length) {
    highlightIdx = -1;
    return;
  }
  highlightIdx = clamp(nextIdx, 0, opts.length - 1);
  for (let i = 0; i < opts.length; i++) {
    const isHi = i === highlightIdx;
    opts[i].classList.toggle('highlighted', isHi);
    if (isHi) {
      opts[i].scrollIntoView({ block: 'nearest' });
    }
  }
}

function commitOptionValue(entry, value) {
  const sel = entry.select;
  const changed = sel.value !== value;
  if (nativeValueDesc && nativeValueDesc.set) {
    nativeValueDesc.set.call(sel, value);
  } else {
    sel.value = value;
  }
  syncCustomSelect(sel);
  closeOpenCustomSelect(true);
  if (changed) {
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function renderMenuOptions(entry) {
  const portal = ensureMenuPortal();
  portal.innerHTML = '';
  portal.classList.toggle('compact', entry.isCompact);
  const sel = entry.select;
  const curVal = sel.value;
  let selectedIdx = 0;

  for (let i = 0; i < sel.options.length; i++) {
    const opt = sel.options[i];
    const isSel = opt.value === curVal;
    if (isSel) selectedIdx = i;

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'px-select-opt' + (isSel ? ' selected' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', isSel ? 'true' : 'false');
    item.dataset.value = opt.value;
    item.innerHTML =
      '<span class="px-select-opt-mark">' + (isSel ? CHECK_SVG : '') + '</span>' +
      '<span class="px-select-opt-text"></span>';
    item.querySelector('.px-select-opt-text').textContent = opt.textContent || opt.value;

    const idx = i;
    item.addEventListener('pointerenter', () => setHighlight(idx));
    item.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      commitOptionValue(entry, opt.value);
    });
    portal.appendChild(item);
  }

  highlightIdx = selectedIdx;
  setHighlight(selectedIdx);
}

function positionMenu(entry) {
  if (!menuEl || !entry) return;
  const rect = entry.btn.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    closeOpenCustomSelect(false);
    return;
  }

  const minW = Math.ceil(rect.width);
  menuEl.style.minWidth = minW + 'px';
  menuEl.style.maxWidth = Math.min(280, window.innerWidth - 16) + 'px';
  menuEl.style.left = '0px';
  menuEl.style.top = '0px';

  const menuRect = menuEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const openUp = menuRect.height > spaceBelow && spaceAbove > spaceBelow;

  menuEl.classList.toggle('drop-up', openUp);

  let top = openUp ? (rect.top - menuRect.height - 2) : (rect.bottom + 2);
  let left = rect.left;

  left = clamp(left, 8, Math.max(8, window.innerWidth - menuRect.width - 8));
  top = clamp(top, 8, Math.max(8, window.innerHeight - menuRect.height - 8));

  menuEl.style.left = Math.round(left) + 'px';
  menuEl.style.top = Math.round(top) + 'px';
}

function openCustomSelect(entry) {
  if (!entry || entry.select.disabled || entry.select.options.length === 0) return;
  if (activeEntry === entry) {
    closeOpenCustomSelect(false);
    return;
  }
  closeOpenCustomSelect(false);
  hideUiTooltip();

  activeEntry = entry;
  entry.wrap.classList.add('open');
  entry.btn.classList.add('open');
  entry.btn.setAttribute('aria-expanded', 'true');

  const portal = ensureMenuPortal();
  renderMenuOptions(entry);
  portal.classList.add('open');
  portal.setAttribute('aria-hidden', 'false');
  positionMenu(entry);
}

function wireGlobalHandlers() {
  if (globalWired) return;
  globalWired = true;

  document.addEventListener('pointerdown', e => {
    if (!activeEntry) return;
    if (menuEl && menuEl.contains(e.target)) return;
    if (activeEntry.btn.contains(e.target)) return;
    closeOpenCustomSelect(false);
  }, true);

  window.addEventListener('resize', () => {
    if (activeEntry) positionMenu(activeEntry);
  });

  window.addEventListener('scroll', e => {
    if (!activeEntry) return;
    if (menuEl && menuEl.contains(e.target)) return;
    positionMenu(activeEntry);
  }, true);

  window.addEventListener('blur', () => {
    closeOpenCustomSelect(false);
  });

  window.addEventListener('keydown', e => {
    if (!activeEntry) return;
    const opts = activeEntry.select.options;
    if (!opts.length) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeOpenCustomSelect(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setHighlight((highlightIdx + 1) % opts.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setHighlight((highlightIdx - 1 + opts.length) % opts.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      setHighlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      setHighlight(opts.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const idx = clamp(highlightIdx, 0, opts.length - 1);
      commitOptionValue(activeEntry, opts[idx].value);
    } else if (e.key === 'Tab') {
      closeOpenCustomSelect(false);
    }
  }, true);
}

export function enhanceSelect(selectEl) {
  if (!selectEl || entriesBySelect.has(selectEl)) return;
  wireGlobalHandlers();

  const isCompact = selectEl.classList.contains('light-opt-select');
  const isTop = selectEl.classList.contains('ed-subtype-select');

  const wrap = document.createElement('div');
  wrap.className = 'px-select' + (isCompact ? ' px-select-compact' : '') + (isTop ? ' px-select-top' : '');
  wrap.style.display = selectEl.style.display || '';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'px-select-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  if (selectEl.id) btn.dataset.selectFor = selectEl.id;

  const tip = selectEl.dataset.tip || selectEl.getAttribute('title');
  if (tip) {
    btn.dataset.tip = tip;
    delete selectEl.dataset.tip;
    selectEl.removeAttribute('title');
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'px-select-label';
  btn.appendChild(labelEl);
  btn.insertAdjacentHTML('beforeend', CARET_SVG);

  const parent = selectEl.parentNode;
  if (!parent) return;
  parent.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  wrap.appendChild(btn);

  selectEl.classList.add('px-select-native');
  selectEl.tabIndex = -1;
  selectEl.setAttribute('aria-hidden', 'true');

  const entry = { select: selectEl, wrap, btn, labelEl, isCompact, isTop };
  entriesBySelect.set(selectEl, entry);
  allEntries.push(entry);

  // Hook direct .value assignments so UI always stays in sync automatically
  if (nativeValueDesc && nativeValueDesc.get && nativeValueDesc.set) {
    Object.defineProperty(selectEl, 'value', {
      configurable: true,
      get() {
        return nativeValueDesc.get.call(this);
      },
      set(v) {
        nativeValueDesc.set.call(this, v);
        syncCustomSelect(this);
      }
    });
  }

  // Watch dynamic <option> list and inline display/disabled updates
  const obs = new MutationObserver(() => syncCustomSelect(selectEl));
  obs.observe(selectEl, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'disabled']
  });

  selectEl.addEventListener('change', () => syncCustomSelect(selectEl));

  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    openCustomSelect(entry);
  });

  btn.addEventListener('keydown', e => {
    if (activeEntry === entry) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      openCustomSelect(entry);
    }
  });

  syncCustomSelect(selectEl);
}

export function initCustomSelects(root = document) {
  const selects = root.querySelectorAll('select.ed-subtype-select, select.light-opt-select');
  for (let i = 0; i < selects.length; i++) {
    enhanceSelect(selects[i]);
  }
}
