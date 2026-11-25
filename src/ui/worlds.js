import {
  closeWorldsBtn,
  closeWorldsX,
  exportDataBtn,
  importDataBtn,
  importFileInput,
  newWorldBtn,
  openWorldsBtn,
  showToast,
  worldsList,
  worldsModal
} from '../dom.js';
import { loadWorldPlayerPos } from '../physics.js';
import { getActiveWorld, rebuildSpriteIndex, state, worldFX } from '../state.js';
import {
  createStarterWorld,
  sanitizeSprite,
  sanitizeWorld,
  savePrefsNow,
  saveSpritesNow,
  saveWorldsNow,
  serializeSprites
} from '../storage.js';
import { renderSidebar } from './sidebar.js';
import { updateTopUI } from './topbar.js';
import { generateUniqueName } from '../utils.js';
import { clearWorldHistory } from '../world.js';

/* =========================================================================
   SAVED WORLDS MODAL (SWITCH, CREATE, RENAME, DUPLICATE, DELETE, EXPORT/IMPORT)
   ========================================================================= */
export function countWorldTiles(w) {
  return (
    Object.keys(w.layers.bg || {}).length +
    Object.keys(w.layers.main || {}).length +
    Object.keys(w.layers.fg || {}).length
  );
}

export function switchWorld(worldId) {
  if (worldId === state.activeWorldId) {
    closeWorldsModal();
    return;
  }
  const target = state.worlds.find(w => w.id === worldId);
  if (!target) return;
  saveWorldsNow(false);
  state.activeWorldId = target.id;
  clearWorldHistory();
  worldFX.tileTriggers.clear();
  worldFX.bounceTimers.clear();
  worldFX.buildPops.clear();
  worldFX.particles.length = 0;
  loadWorldPlayerPos(target);
  savePrefsNow();
  updateTopUI();
  renderWorldsModal();
  closeWorldsModal();
  showToast('LOADED ' + target.name);
}

export function renderWorldsModal() {
  worldsList.innerHTML = '';
  for (const w of state.worlds) {
    const row = document.createElement('div');
    row.className = 'world-row' + (w.id === state.activeWorldId ? ' active' : '');

    const info = document.createElement('div');
    info.className = 'world-row-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'world-row-name';
    nameEl.textContent = w.name;

    const metaEl = document.createElement('div');
    metaEl.className = 'world-row-meta';
    const dt = new Date(w.updatedAt || Date.now());
    const timeStr = dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    metaEl.innerHTML = `<span>${countWorldTiles(w)} TILES</span><span>${timeStr.toUpperCase()}</span>`;

    info.appendChild(nameEl);
    info.appendChild(metaEl);

    const acts = document.createElement('div');
    acts.className = 'world-row-actions';

    const renBtn = document.createElement('button');
    renBtn.type = 'button';
    renBtn.className = 'btn';
    renBtn.textContent = 'REN';
    renBtn.addEventListener('click', e => {
      e.stopPropagation();
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'inline-rename-input';
      inp.maxLength = 24;
      inp.value = w.name;
      nameEl.replaceWith(inp);
      inp.focus();
      inp.select();
      const commit = () => {
        const val = (inp.value || '').trim().toUpperCase().slice(0, 24);
        if (val) w.name = val;
        saveWorldsNow(true);
        updateTopUI();
        renderWorldsModal();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
        if (ev.key === 'Escape') { ev.stopPropagation(); renderWorldsModal(); }
      });
      inp.addEventListener('click', ev => ev.stopPropagation());
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'btn';
    dupBtn.textContent = 'DUP';
    dupBtn.addEventListener('click', e => {
      e.stopPropagation();
      const copyName = generateUniqueName(w.name, state.worlds.map(item => item.name), 24, false);
      const copy = sanitizeWorld({
        ...JSON.parse(JSON.stringify(w)),
        id: 'w_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
        name: copyName,
        updatedAt: Date.now()
      }, state.worlds.length + 1);
      state.worlds.push(copy);
      saveWorldsNow(true);
      renderWorldsModal();
      showToast('COPIED ' + copy.name);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn';
    delBtn.textContent = 'DEL';
    if (state.worlds.length <= 1) {
      delBtn.style.opacity = '0.4';
      delBtn.style.pointerEvents = 'none';
    }
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (state.worlds.length <= 1) return;
      if (delBtn.dataset.armed === '1') {
        const wasActive = w.id === state.activeWorldId;
        state.worlds = state.worlds.filter(item => item.id !== w.id);
        if (wasActive) {
          state.activeWorldId = state.worlds[0].id;
          clearWorldHistory();
          loadWorldPlayerPos(getActiveWorld());
        }
        saveWorldsNow(true);
        savePrefsNow();
        updateTopUI();
        renderWorldsModal();
        showToast('DELETED WORLD');
      } else {
        delBtn.dataset.armed = '1';
        delBtn.classList.add('danger-confirm');
        delBtn.textContent = 'SURE?';
        setTimeout(() => {
          if (delBtn.isConnected && delBtn.dataset.armed === '1') {
            delBtn.dataset.armed = '';
            delBtn.classList.remove('danger-confirm');
            delBtn.textContent = 'DEL';
          }
        }, 2200);
      }
    });

    acts.appendChild(renBtn);
    acts.appendChild(dupBtn);
    acts.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(acts);
    row.addEventListener('click', () => switchWorld(w.id));
    worldsList.appendChild(row);
  }
}

export function openWorldsModal() {
  saveWorldsNow(false);
  renderWorldsModal();
  worldsModal.classList.add('open');
}

export function closeWorldsModal() {
  worldsModal.classList.remove('open');
}

export function initWorldsUI() {
  openWorldsBtn.addEventListener('click', openWorldsModal);
  closeWorldsX.addEventListener('click', closeWorldsModal);
  closeWorldsBtn.addEventListener('click', closeWorldsModal);
  worldsModal.addEventListener('click', e => {
    if (e.target === worldsModal) closeWorldsModal();
  });

  newWorldBtn.addEventListener('click', () => {
    saveWorldsNow(false);
    const nextName = generateUniqueName('WORLD', state.worlds.map(w => w.name), 24, true);
    const created = createStarterWorld(nextName);
    state.worlds.push(created);
    state.activeWorldId = created.id;
    clearWorldHistory();
    loadWorldPlayerPos(created);
    saveWorldsNow(true);
    savePrefsNow();
    updateTopUI();
    renderWorldsModal();
    showToast('CREATED ' + created.name);
  });

  exportDataBtn.addEventListener('click', () => {
    saveWorldsNow(false);
    const payload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      sprites: serializeSprites(),
      worlds: state.worlds
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spritelab_backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('EXPORTED JSON');
  });

  importDataBtn.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || '{}'));
        if (Array.isArray(data.sprites)) {
          state.sprites = data.sprites.map(sanitizeSprite).filter(Boolean);
          rebuildSpriteIndex();
        }
        if (Array.isArray(data.worlds) && data.worlds.length > 0) {
          state.worlds = data.worlds.map((w, i) => sanitizeWorld(w, i + 1));
          state.activeWorldId = state.worlds[0].id;
        }
        clearWorldHistory();
        loadWorldPlayerPos(getActiveWorld());
        saveSpritesNow();
        saveWorldsNow(true);
        savePrefsNow();
        updateTopUI();
        renderSidebar();
        renderWorldsModal();
        showToast('IMPORTED DATA');
      } catch (_) {
        showToast('INVALID JSON FILE');
      }
    };
    reader.readAsText(file);
  });
}
