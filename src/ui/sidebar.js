import { getTypeDef, isAnimatedHarmSubType, isGearType } from '../constants.js';
import {
  emptyState,
  filterBar,
  showToast,
  spriteCount,
  spriteGrid,
  wireframeResetBtn
} from '../dom.js';
import { openEditor } from '../editor/io.js';
import { captureCurrentCharVisual, triggerBodyAnim } from '../renderer.js';
import {
  getActiveWorld,
  getSpriteById,
  pointer,
  rebuildSpriteIndex,
  startBgEffectFadeOut,
  state,
  worldFX
} from '../state.js';
import { sanitizeSprite, savePrefsNow, saveSpritesNow, saveWorldsNow } from '../storage.js';
import { setBuildTool, updateTopUI } from './topbar.js';
import { generateUniqueName } from '../utils.js';
import { deselectHeldBlock, syncRuntimeEntities } from '../world.js';

/* =========================================================================
   SAVED SPRITES SIDEBAR DOCK (FILTER, EQUIP, EDIT, DUPLICATE, DELETE)
   ========================================================================= */

export function initSidebarUI() {
  filterBar.addEventListener('click', e => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    state.sidebarFilter = btn.dataset.filter;
    filterBar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    renderSidebar();
  });

  wireframeResetBtn.addEventListener('click', () => {
    const hadBody = Boolean(state.equippedBodyId || state.activeMotionId);
    const prevVis = hadBody ? captureCurrentCharVisual() : null;
    state.equippedBodyId = null;
    state.activeMotionId = null;
    state.equippedWearableId = null;
    state.equippedHoldableId = null;
    if (hadBody) triggerBodyAnim('unequip', prevVis);
    savePrefsNow();
    updateTopUI();
    renderSidebar();
    showToast('WIREFRAME PLAYER');
  });
}

export function duplicateSprite(spriteId) {
  const src = getSpriteById(spriteId);
  if (!src) return;
  const nextName = generateUniqueName(src.name, state.sprites.map(s => s.name), 20, false);
  const copy = sanitizeSprite({
    id: 'sp_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
    name: nextName,
    type: src.type,
    subType: src.subType,
    customText: src.customText || '',
    size: src.size,
    fps: src.fps,
    stateFps: src.stateFps ? { ...src.stateFps } : undefined,
    animMode: src.animMode,
    frames: JSON.parse(JSON.stringify(src.frames)),
    states: src.type === 'BODY' && src.states ? JSON.parse(JSON.stringify(src.states)) : undefined,
    palette: Array.isArray(src.palette) ? src.palette.slice() : undefined,
    lightColor: src.type === 'LIGHT' ? src.lightColor : undefined,
    lightOpts: src.type === 'LIGHT' && src.lightOpts ? { ...src.lightOpts } : undefined,
    glowFrame: (src.type === 'LIGHT' && src.subType === 'LIGHT GLOW' && src.glowFrame)
      ? JSON.parse(JSON.stringify(src.glowFrame))
      : undefined,
    envOpts: src.type === 'ENVIRONMENT' && src.envOpts ? { ...src.envOpts } : undefined,
    liquidOpts: src.type === 'LIQUID' && src.liquidOpts ? { ...src.liquidOpts } : undefined,
    harmOpts: src.type === 'HARMFUL' && src.harmOpts ? { ...src.harmOpts } : undefined
  });
  if (!copy) return;
  state.sprites.push(copy);
  rebuildSpriteIndex();
  saveSpritesNow();
  renderSidebar();
  showToast('COPIED AS ' + copy.name);
}

export function deleteSprite(spriteId) {
  const wasEquippedBody = state.equippedBodyId === spriteId || state.activeMotionId === spriteId;
  const prevVis = wasEquippedBody ? captureCurrentCharVisual() : null;
  state.sprites = state.sprites.filter(s => s.id !== spriteId);
  rebuildSpriteIndex();
  if (state.selectedSpriteId === spriteId) state.selectedSpriteId = null;
  if (state.equippedBodyId === spriteId) state.equippedBodyId = null;
  if (state.activeMotionId === spriteId) state.activeMotionId = null;
  if (state.equippedWearableId === spriteId) state.equippedWearableId = null;
  if (state.equippedHoldableId === spriteId) state.equippedHoldableId = null;
  if (wasEquippedBody) triggerBodyAnim('unequip', prevVis);
  savePrefsNow();
  // Clean references across saved worlds
  const activeWorld = getActiveWorld();
  for (const w of state.worlds) {
    for (const layer of ['bg', 'main', 'fg']) {
      for (const k in w.layers[layer]) {
        if (w.layers[layer][k] === spriteId) {
          if (w === activeWorld && layer === 'bg') {
            const comma = k.indexOf(',');
            startBgEffectFadeOut(parseInt(k.slice(0, comma), 10), parseInt(k.slice(comma + 1), 10), spriteId);
            worldFX.bgPlaceOrder.delete(k);
          }
          delete w.layers[layer][k];
        }
      }
    }
  }
  saveSpritesNow();
  saveWorldsNow(false);
  syncRuntimeEntities(activeWorld, true);
  updateTopUI();
  renderSidebar();
}

export const animatedDockThumbs = []; // [{ canvas, ctx, spriteId, lastFrame }]

export function renderSidebar() {
  animatedDockThumbs.length = 0;
  const filtered = state.sprites.filter(sp => {
    if (state.sidebarFilter === 'TILES') return !isGearType(sp.type);
    if (state.sidebarFilter === 'BODIES') return isGearType(sp.type);
    return true;
  });

  spriteCount.textContent = String(filtered.length);
  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    spriteGrid.style.display = 'none';
    spriteGrid.innerHTML = '';
    return;
  }

  emptyState.style.display = 'none';
  spriteGrid.style.display = 'grid';
  spriteGrid.innerHTML = '';

  for (const sp of filtered) {
    const card = document.createElement('div');
    const isSelected = state.selectedSpriteId === sp.id;
    const isEquipped = (
      state.equippedBodyId === sp.id ||
      state.activeMotionId === sp.id ||
      state.equippedWearableId === sp.id ||
      state.equippedHoldableId === sp.id
    );
    card.className = 'sprite-card' + (isSelected ? ' selected' : '') + (isEquipped ? ' equipped' : '');

    const thumbBox = document.createElement('div');
    thumbBox.className = 'sprite-thumb-box';
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = sp.size;
    thumbCanvas.height = sp.size;
    thumbCanvas.dataset.spriteId = sp.id;
    const tCtx = thumbCanvas.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    if (sp._canvases && sp._canvases[0]) tCtx.drawImage(sp._canvases[0], 0, 0);
    if (sp._canvases && sp._canvases.length > 1) {
      animatedDockThumbs.push({ canvas: thumbCanvas, ctx: tCtx, spriteId: sp.id, lastFrame: 0 });
    }
    thumbBox.appendChild(thumbCanvas);

    const meta = document.createElement('div');
    meta.className = 'sprite-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'sprite-name';
    nameEl.textContent = sp.name;

    const tagsEl = document.createElement('div');
    tagsEl.className = 'sprite-tags';
    const typeTag = document.createElement('span');
    typeTag.className = 'type-tag';
    typeTag.textContent = sp.type === 'BODY' && sp.subType === 'MOTION' ? 'MOTION' : getTypeDef(sp.type).label;
    tagsEl.appendChild(typeTag);

    if (isEquipped) {
      const eq = document.createElement('span');
      eq.className = 'eq-badge';
      eq.textContent = 'ON';
      tagsEl.appendChild(eq);
    }

    meta.appendChild(nameEl);
    meta.appendChild(tagsEl);

    const acts = document.createElement('div');
    acts.className = 'card-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'mini-act';
    editBtn.title = 'Edit Sprite';
    editBtn.innerHTML = '<svg class="px-ico" style="width:11px;height:11px" viewBox="0 0 12 12"><rect x="8" y="1" width="2" height="2"/><rect x="6" y="3" width="2" height="2"/><rect x="4" y="5" width="2" height="2"/><rect x="2" y="7" width="2" height="2"/><rect x="1" y="9" width="2" height="2"/></svg>';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      openEditor(sp.id);
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'mini-act';
    dupBtn.title = 'Duplicate Sprite';
    dupBtn.innerHTML = '<svg class="px-ico" style="width:11px;height:11px" viewBox="0 0 12 12"><rect x="1" y="1" width="6" height="6"/><rect x="5" y="5" width="6" height="6"/></svg>';
    dupBtn.addEventListener('click', e => {
      e.stopPropagation();
      duplicateSprite(sp.id);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'mini-act';
    delBtn.title = 'Delete Sprite';
    delBtn.textContent = 'X';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (delBtn.dataset.armed === '1') {
        deleteSprite(sp.id);
      } else {
        delBtn.dataset.armed = '1';
        delBtn.classList.add('del-armed');
        delBtn.textContent = 'DEL?';
        card.classList.add('confirming-del');
        setTimeout(() => {
          if (delBtn.isConnected && delBtn.dataset.armed === '1') {
            delBtn.dataset.armed = '';
            delBtn.classList.remove('del-armed');
            delBtn.textContent = 'X';
            card.classList.remove('confirming-del');
          }
        }, 2200);
      }
    });

    acts.appendChild(editBtn);
    acts.appendChild(dupBtn);
    acts.appendChild(delBtn);

    card.appendChild(thumbBox);
    card.appendChild(meta);
    card.appendChild(acts);

    card.addEventListener('click', () => {
      if (sp.type === 'BODY') {
        const prevVis = captureCurrentCharVisual();
        if (sp.subType === 'MOTION') {
          const turningOn = state.activeMotionId !== sp.id;
          state.activeMotionId = turningOn ? sp.id : null;
          triggerBodyAnim(turningOn ? 'equip' : 'unequip', prevVis);
          showToast(turningOn ? 'MOTION: ' + sp.name : 'MOTION STOPPED');
        } else if (state.equippedBodyId === sp.id) {
          state.equippedBodyId = null;
          state.activeMotionId = null;
          triggerBodyAnim('unequip', prevVis);
          savePrefsNow();
          showToast('UNEQUIPPED ' + sp.name);
        } else {
          const kind = state.equippedBodyId ? 'swap' : 'equip';
          state.equippedBodyId = sp.id;
          state.activeMotionId = null;
          triggerBodyAnim(kind, prevVis);
          savePrefsNow();
          showToast('EQUIPPED ' + sp.name);
        }
        updateTopUI();
        renderSidebar();
        return;
      }

      if (sp.type === 'WEARABLE') {
        state.equippedWearableId = state.equippedWearableId === sp.id ? null : sp.id;
        savePrefsNow();
        updateTopUI();
        renderSidebar();
        showToast(state.equippedWearableId ? 'WORN: ' + sp.name : 'REMOVED ' + sp.name);
        return;
      }

      if (sp.type === 'HOLDABLE') {
        state.equippedHoldableId = state.equippedHoldableId === sp.id ? null : sp.id;
        savePrefsNow();
        updateTopUI();
        renderSidebar();
        showToast(state.equippedHoldableId ? 'HOLDING ' + sp.name : 'STOWED ' + sp.name);
        return;
      }

      // Tile brushes can only be equipped in BUILD mode
      if (state.mode !== 'BUILD') {
        showToast('SWITCH TO BUILD MODE (B)');
        return;
      }

      if (state.selectedSpriteId === sp.id) {
        deselectHeldBlock(pointer.inWorld);
      } else {
        state.selectedSpriteId = sp.id;
        if (state.buildTool === 'ERASE' || state.buildTool === 'SPAWN') {
          setBuildTool('STAMP');
        }
        renderSidebar();
      }
    });

    spriteGrid.appendChild(card);
  }
}

export function updateDockThumbAnimations() {
  if (state.menusHidden || animatedDockThumbs.length === 0) return;
  for (let i = 0; i < animatedDockThumbs.length; i++) {
    const entry = animatedDockThumbs[i];
    const sp = getSpriteById(entry.spriteId);
    if (!sp || !sp._canvases || sp._canvases.length <= 1) continue;
    if (sp.type === 'HARMFUL' && !isAnimatedHarmSubType(sp.subType)) continue;
    const idx = Math.floor(state.uiTime * (sp.fps || 6)) % sp._canvases.length;
    if (entry.lastFrame === idx) continue;
    entry.lastFrame = idx;
    entry.ctx.imageSmoothingEnabled = false;
    entry.ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    entry.ctx.drawImage(sp._canvases[idx], 0, 0);
  }
}
