import { SFX } from '../audio.js';
import { farbackHasArt, getTypeDef, isAnimatedHarmSubType, isDynamicCompanion, isGearType, isMotionBarEligible, isSingleCelType } from '../constants.js';
import { renderFarbackPreviewToCanvas } from '../farback.js';
import {
  emptyState,
  filterBar,
  showToast,
  spriteCount,
  spriteGrid,
  spriteSearchClearBtn,
  spriteSearchInput,
  wireframeResetBtn
} from '../dom.js';
import { openEditor } from '../editor/io.js';
import { emitWorldEvent } from '../events.js';
import { pruneMotionBars, renderMotionBar, stopActiveMotion, triggerPlayerMotion } from './motionBar.js';
import { captureCurrentCharVisual, triggerBodyAnim } from '../renderer.js';
import {
  getActiveWorld,
  getSpriteById,
  invalidateBgEffectIndex,
  pointer,
  rebuildSpriteIndex,
  runtime,
  startBgEffectFadeOut,
  state,
  worldFX
} from '../state.js';
import { sanitizeSprite, savePrefsNow, saveSpritesNow, saveWorldsNow } from '../storage.js';
import { setBuildTool, syncWorldToolCursorClass, updateTopUI } from './topbar.js';
import { evalSparklingFrameIndex, generateUniqueName } from '../utils.js';
import {
  cleanupRuntimeSpriteRefs,
  deselectHeldBlock,
  pruneSpriteFromWorldHistory,
  resetBrushOrient,
  syncRuntimeEntities
} from '../world.js';

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

  if (spriteSearchInput) {
    const syncSearch = () => {
      state.sidebarSearch = spriteSearchInput.value || '';
      if (spriteSearchClearBtn) {
        spriteSearchClearBtn.classList.toggle('visible', state.sidebarSearch.trim().length > 0);
      }
      renderSidebar();
    };
    spriteSearchInput.addEventListener('input', syncSearch);
    spriteSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (spriteSearchInput.value) {
          spriteSearchInput.value = '';
          syncSearch();
        }
        spriteSearchInput.blur();
      }
    });
    if (spriteSearchClearBtn) {
      spriteSearchClearBtn.addEventListener('click', () => {
        spriteSearchInput.value = '';
        syncSearch();
        spriteSearchInput.focus();
      });
    }
  }

  wireframeResetBtn.addEventListener('click', () => {
    const hadBody = Boolean(state.equippedBodyId || state.activeMotionId);
    const prevVis = hadBody ? captureCurrentCharVisual() : null;
    state.equippedBodyId = null;
    stopActiveMotion(true);
    state.equippedWearableId = null;
    state.equippedHoldableId = null;
    state.equippedDynamicId = null;
    runtime.companionDyn = null;
    if (hadBody) triggerBodyAnim('unequip', prevVis);
    savePrefsNow();
    emitWorldEvent('player:body-change', { bodyId: null });
    if (state.motionBarOpen) renderMotionBar();
    updateTopUI();
    renderSidebar();
    showToast('WIREFRAME PLAYER');
  });
}

export function duplicateSprite(spriteId) {
  const src = getSpriteById(spriteId);
  if (!src) return;
  const nextName = generateUniqueName(src.name, state.sprites.map(s => s.name), 20, false);
  let maxCreatedAt = 0;
  for (let i = 0; i < state.sprites.length; i++) {
    const t = Number(state.sprites[i].createdAt) || 0;
    if (t > maxCreatedAt) maxCreatedAt = t;
  }
  const createdAt = Math.max(Date.now(), maxCreatedAt + 1);
  const copy = sanitizeSprite({
    id: 'sp_' + createdAt + '_' + Math.floor(Math.random() * 9999),
    createdAt,
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
    harmOpts: src.type === 'HARMFUL' && src.harmOpts ? { ...src.harmOpts } : undefined,
    actOpts: src.type === 'ACTIVATOR' && src.actOpts ? { ...src.actOpts } : undefined,
    backOpts: src.type === 'BACK' && src.backOpts ? { ...src.backOpts } : undefined,
    thingOpts: src.type === 'THING' && src.thingOpts ? { ...src.thingOpts } : undefined,
    farbackOpts: src.type === 'FARBACK' && src.farbackOpts ? JSON.parse(JSON.stringify(src.farbackOpts)) : undefined,
    bigOpts: src.type === 'BIG_THING' && src.bigOpts ? { ...src.bigOpts } : undefined,
    motionOpts: (src.type === 'BODY' && src.subType === 'MOTION' && src.motionOpts) ? { ...src.motionOpts } : undefined,
    dynamicOpts: (src.type === 'DYNAMIC' && src.dynamicOpts) ? JSON.parse(JSON.stringify(src.dynamicOpts)) : undefined,
    surfaceSound: src.surfaceSound || undefined,
    poseAction: src.poseAction || undefined
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
  if (state.selectedSpriteId === spriteId) {
    state.selectedSpriteId = null;
    syncWorldToolCursorClass();
  }
  if (state.equippedBodyId === spriteId) state.equippedBodyId = null;
  if (state.activeMotionId === spriteId) stopActiveMotion(true);
  if (state.equippedWearableId === spriteId) state.equippedWearableId = null;
  if (state.equippedHoldableId === spriteId) state.equippedHoldableId = null;
  if (state.equippedDynamicId === spriteId) {
    state.equippedDynamicId = null;
    runtime.companionDyn = null;
  }
  if (wasEquippedBody) triggerBodyAnim('unequip', prevVis);
  pruneMotionBars();
  savePrefsNow();
  // Clean references across saved worlds, wires, joints, runtime & undo history
  const activeWorld = getActiveWorld();
  let removedAny = false;
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
          if (w.orient && w.orient[layer]) delete w.orient[layer][k];
          if (layer === 'main') {
            if (Array.isArray(w.wires) && w.wires.length > 0) {
              w.wires = w.wires.filter(wire => wire.from !== k && wire.to !== k);
            }
            if (Array.isArray(w.joints) && w.joints.length > 0) {
              w.joints = w.joints.filter(joint => joint.a !== k && joint.b !== k);
            }
          }
          removedAny = true;
        }
      }
    }
  }
  pruneSpriteFromWorldHistory(spriteId);
  cleanupRuntimeSpriteRefs(spriteId, null);
  if (removedAny) invalidateBgEffectIndex();
  saveSpritesNow();
  saveWorldsNow(false);
  syncRuntimeEntities(activeWorld, true);
  updateTopUI();
  renderSidebar();
}

export const animatedDockThumbs = []; // [{ canvas, ctx, spriteId, lastFrame }]

export function renderSidebar() {
  animatedDockThumbs.length = 0;
  const rawQuery = String(state.sidebarSearch || '').trim().toUpperCase();
  const tokens = rawQuery ? rawQuery.split(/\s+/).filter(Boolean) : [];

  const matched = [];
  for (let idx = 0; idx < state.sprites.length; idx++) {
    const sp = state.sprites[idx];
    const isCharItem = isGearType(sp.type) || isDynamicCompanion(sp);
    if (state.sidebarFilter === 'TILES' && isCharItem) continue;
    if (state.sidebarFilter === 'BODIES' && !isCharItem) continue;
    if (tokens.length > 0) {
      const def = getTypeDef(sp.type);
      const haystack = `${sp.name} ${sp.type} ${def.label} ${sp.subType || ''} ${sp.type === 'BODY' && sp.subType === 'MOTION' ? 'MOTION' : ''} ${sp.customText || ''}`.toUpperCase();
      let ok = true;
      for (let t = 0; t < tokens.length; t++) {
        if (!haystack.includes(tokens[t])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    matched.push({ sp, idx });
  }

  // Sort creations top-to-bottom from most recently created to oldest
  matched.sort((a, b) => {
    const ta = Number(a.sp.createdAt) || 0;
    const tb = Number(b.sp.createdAt) || 0;
    if (tb !== ta) return tb - ta;
    return b.idx - a.idx;
  });

  const filtered = matched.map(entry => entry.sp);

  spriteCount.textContent = String(filtered.length);
  if (filtered.length === 0) {
    emptyState.textContent = state.sprites.length > 0 ? 'NO MATCHING CREATIONS' : 'NO SPRITES YET';
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
      state.equippedHoldableId === sp.id ||
      state.equippedDynamicId === sp.id
    );
    card.className = 'sprite-card' + (isSelected ? ' selected' : '') + (isEquipped ? ' equipped' : '');
    if (isMotionBarEligible(sp)) {
      card.draggable = true;
      card.addEventListener('dragstart', e => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/spritelab-id', sp.id);
          e.dataTransfer.effectAllowed = 'copy';
        }
      });
    }

    const thumbBox = document.createElement('div');
    thumbBox.className = 'sprite-thumb-box';
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = sp.size;
    thumbCanvas.height = sp.size;
    thumbCanvas.dataset.spriteId = sp.id;
    const tCtx = thumbCanvas.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    if (sp.type === 'FARBACK' && farbackHasArt(sp.farbackOpts)) {
      thumbCanvas.width = 48;
      thumbCanvas.height = 24;
      renderFarbackPreviewToCanvas(tCtx, 48, 24, sp.farbackOpts.layers, getActiveWorld());
    } else if (sp.type === 'DYNAMIC' && sp._canvases && sp._canvases.length > 0) {
      for (let ci = 0; ci < sp._canvases.length; ci++) {
        if (sp._canvases[ci]) tCtx.drawImage(sp._canvases[ci], 0, 0);
      }
    } else if (sp._canvases && sp._canvases[0]) {
      tCtx.drawImage(sp._canvases[0], 0, 0);
      if (sp.type === 'BIG_THING' && sp.subType === 'BACK + FRONT' && sp._canvases[1]) {
        tCtx.drawImage(sp._canvases[1], 0, 0);
      } else if (!isSingleCelType(sp.type, sp.subType) && sp._canvases.length > 1) {
        animatedDockThumbs.push({ canvas: thumbCanvas, ctx: tCtx, spriteId: sp.id, lastFrame: 0 });
      }
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
    typeTag.textContent = sp.type === 'BODY' && sp.subType === 'MOTION'
      ? 'MOTION'
      : (isDynamicCompanion(sp)
        ? (sp.subType === 'ATTACHABLE' ? 'ATTACH' : 'FOLLOW')
        : getTypeDef(sp.type).label);
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
    editBtn.innerHTML = '<svg class="px-ico" style="width:11px;height:11px" viewBox="0 0 12 12"><rect x="5" y="1" width="3" height="1"/><rect x="4" y="2" width="5" height="1"/><rect x="3" y="3" width="7" height="1"/><rect x="4" y="4" width="7" height="1"/><rect x="8" y="5" width="3" height="1"/><rect x="9" y="6" width="1" height="1"/><rect x="5" y="5" width="2" height="1"/><rect x="4" y="6" width="2" height="1"/><rect x="3" y="7" width="2" height="1"/><rect x="2" y="8" width="2" height="1"/><rect x="1" y="9" width="2" height="2"/></svg>';
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
    const delXSvg = '<svg class="px-ico px-ico-12" style="width:11px;height:11px" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="2" height="2"/><rect x="4" y="4" width="4" height="4"/><rect x="8" y="2" width="2" height="2"/><rect x="2" y="8" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/></svg>';
    delBtn.innerHTML = delXSvg;
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
            delBtn.innerHTML = delXSvg;
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
          triggerPlayerMotion(sp.id, { toggleIfActive: true });
        } else if (state.equippedBodyId === sp.id) {
          state.equippedBodyId = null;
          stopActiveMotion(true);
          triggerBodyAnim('unequip', prevVis);
          savePrefsNow();
          emitWorldEvent('player:body-change', { bodyId: null });
          if (state.motionBarOpen) renderMotionBar();
          showToast('UNEQUIPPED ' + sp.name);
        } else {
          const kind = state.equippedBodyId ? 'swap' : 'equip';
          state.equippedBodyId = sp.id;
          stopActiveMotion(true);
          triggerBodyAnim(kind, prevVis);
          savePrefsNow();
          emitWorldEvent('player:body-change', { bodyId: sp.id });
          if (state.motionBarOpen) renderMotionBar();
          showToast('EQUIPPED ' + sp.name);
        }
        updateTopUI();
        renderSidebar();
        return;
      }

      if (sp.type === 'WEARABLE') {
        const equipping = state.equippedWearableId !== sp.id;
        state.equippedWearableId = equipping ? sp.id : null;
        triggerBodyAnim(equipping ? 'equip' : 'unequip', null, 'wear');
        savePrefsNow();
        updateTopUI();
        renderSidebar();
        showToast(state.equippedWearableId ? 'WORN: ' + sp.name : 'REMOVED ' + sp.name);
        return;
      }

      if (sp.type === 'HOLDABLE') {
        const equipping = state.equippedHoldableId !== sp.id;
        state.equippedHoldableId = equipping ? sp.id : null;
        triggerBodyAnim(equipping ? 'equip' : 'unequip', null, 'hold');
        savePrefsNow();
        updateTopUI();
        renderSidebar();
        showToast(state.equippedHoldableId ? 'HOLDING ' + sp.name : 'STOWED ' + sp.name);
        return;
      }

      if (isDynamicCompanion(sp)) {
        const equipping = state.equippedDynamicId !== sp.id;
        state.equippedDynamicId = equipping ? sp.id : null;
        runtime.companionDyn = null;
        SFX.playBodyEquip(equipping ? 'equip' : 'unequip');
        savePrefsNow();
        emitWorldEvent('player:dynamic-change', { dynamicId: state.equippedDynamicId, sprite: equipping ? sp : null });
        if (state.motionBarOpen) renderMotionBar();
        updateTopUI();
        renderSidebar();
        const verb = sp.subType === 'ATTACHABLE' ? 'ATTACHED ' : 'FOLLOWING: ';
        showToast(equipping ? (verb + sp.name) : ('REMOVED ' + sp.name));
        return;
      }

      // Tile brushes can be equipped directly in PLAY or BUILD mode for instant placement
      if (state.selectedSpriteId === sp.id) {
        deselectHeldBlock(pointer.inWorld);
      } else {
        state.selectedSpriteId = sp.id;
        resetBrushOrient(0);
        if (state.mode === 'BUILD' && (state.buildTool === 'ERASE' || state.buildTool === 'SPAWN')) {
          setBuildTool('STAMP');
        }
        syncWorldToolCursorClass();
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
    if (sp.type === 'BIG_THING' && sp.subType === 'BACK + FRONT') continue;
    const rate = (sp.type === 'BIG_THING' && sp.subType === 'TRANSFORMING') ? 0.85 : (sp.fps || 6);
    const idx = (sp.type === 'CHANGING' && sp.subType === 'SPARKLING')
      ? evalSparklingFrameIndex(sp._canvases.length, state.uiTime, rate, i * 3.7)
      : (Math.floor(state.uiTime * rate) % sp._canvases.length);
    if (entry.lastFrame === idx) continue;
    entry.lastFrame = idx;
    entry.ctx.imageSmoothingEnabled = false;
    entry.ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    entry.ctx.drawImage(sp._canvases[idx], 0, 0);
  }
}
