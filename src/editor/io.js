import { SFX } from '../audio.js';
import {
  BODY_STATES,
  defaultEnvOpts,
  defaultHarmOpts,
  defaultLightOpts,
  defaultLiquidOpts,
  getTypeDef,
  isGearType,
  LIGHT_GLOW_SIZE,
  sanitizeEnvOpts,
  sanitizeHarmOpts,
  sanitizeLightOpts,
  sanitizeLiquidOpts,
  TILE
} from '../constants.js';
import {
  edBrushHud,
  edDraftStatus,
  editorCustomTextInput,
  editorModal,
  editorStageScroll,
  fitPasteCheck,
  onionBtn,
  showToast,
  spriteNameInput,
  stripBar,
  stripFrameWidthInput,
  stripInfo,
  uiTooltip
} from '../dom.js';
import {
  clearEditorDraft,
  editorHasDraftableContent,
  flushEditorDraftNow,
  markEditorDirty,
  renderDraftBar
} from './draft.js';
import { rebuildPaletteFromEditorArt, renderPaletteSwatches, setEditorColor } from './palette.js';
import {
  refreshEditorAll,
  setEditorSize,
  setEditorType,
  updateLightOptionsUI,
  updatePreviewHeaderUI
} from './render.js';
import { commitFloatingSelection, updateSelectionUI } from './selection.js';
import {
  editor,
  getEditorLightColor,
  isBodyRigMode,
  isLightGlowMode,
  selectLightGlowCell,
  setEditorAnimMode,
  setEditorMsg,
  setEditorPreviewTileMode,
  syncLightGlowBuffers,
  updateEditorSaveControls
} from './state.js';
import { pushUndo, setEditorTool, updateBrushUI, updateShapeFillBtnUI } from './tools.js';
import { closeTypePicker } from './ui.js';
import {
  getActiveWorld,
  getSpriteById,
  invalidateBgEffectIndex,
  rebuildSpriteIndex,
  runtime,
  state,
  worldFX
} from '../state.js';
import {
  decodeFrame,
  encodeFrame,
  rebuildSpriteCanvases,
  sanitizeSprite,
  savePrefsNow,
  saveSpritesNow,
  saveWorldsNow
} from '../storage.js';
import { renderSidebar } from '../ui/sidebar.js';
import { updateTopUI } from '../ui/topbar.js';
import {
  clamp,
  createEmptyPixels,
  generateUniqueName,
  getSpriteStateFps,
  hasAnyPixel,
  layerForType,
  rgbToHex
} from '../utils.js';
import { clearWorldHistory, syncRuntimeEntities } from '../world.js';

/* =========================================================================
   ASEPRITE IMAGE IMPORT / CLIPBOARD PASTE + HORIZONTAL STRIP SLICER
   ========================================================================= */
export function extractPixelsFromImageRect(img, sx, sy, sw, sh, targetSize, fitScale = true) {
  const tmp = document.createElement('canvas');
  tmp.width = targetSize;
  tmp.height = targetSize;
  const tCtx = tmp.getContext('2d');
  tCtx.imageSmoothingEnabled = false;
  tCtx.clearRect(0, 0, targetSize, targetSize);

  if (fitScale) {
    const scale = Math.min(targetSize / sw, targetSize / sh);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const dx = Math.floor((targetSize - dw) * 0.5);
    const dy = Math.floor((targetSize - dh) * 0.5);
    tCtx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    // Exact 1:1 pixel placement centered on canvas (no resampling)
    const dx = Math.floor((targetSize - sw) * 0.5);
    const dy = Math.floor((targetSize - sh) * 0.5);
    tCtx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
  }

  const imgData = tCtx.getImageData(0, 0, targetSize, targetSize).data;
  const out = createEmptyPixels(targetSize);
  for (let i = 0; i < targetSize * targetSize; i++) {
    const a = imgData[i * 4 + 3];
    if (a >= 128) {
      out[i] = rgbToHex(imgData[i * 4], imgData[i * 4 + 1], imgData[i * 4 + 2]);
    }
  }
  return out;
}

export function pastePixelsAsFloatingSelection(extracted, successMsg) {
  commitFloatingSelection(true);
  const s = editor.size;
  const total = s * s;
  const floated = createEmptyPixels(s);
  const mask = new Uint8Array(total);
  let count = 0;
  let paletteChanged = false;

  for (let i = 0; i < total; i++) {
    const hex = extracted[i];
    if (!hex) continue; // Never copy or overwrite with transparent space
    floated[i] = hex;
    mask[i] = 1;
    count++;
    if (editor.palette.length < 64 && !editor.palette.includes(hex)) {
      editor.palette.push(hex);
      paletteChanged = true;
    }
  }

  if (count === 0) {
    setEditorMsg('EMPTY IMAGE');
    return false;
  }

  pushUndo();
  editor.floating = {
    pixels: floated,
    ox: 0,
    oy: 0,
    startOx: 0,
    startOy: 0,
    baseMask: mask.slice()
  };
  editor.selection = mask;
  if (paletteChanged) {
    renderPaletteSwatches();
    updateLightOptionsUI();
  }
  syncLightGlowBuffers();
  updateSelectionUI();
  refreshEditorAll();
  markEditorDirty();
  setEditorMsg(successMsg);
  return true;
}

export function importImageIntoEditor(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return;

  // Detect horizontal spritesheet strip (e.g. copied from Aseprite strip export)
  if (w >= h * 2) {
    editor.pendingStripImg = img;
    const guessW = h;
    stripFrameWidthInput.value = String(clamp(guessW, 1, w));
    const count = Math.max(1, Math.floor(w / guessW));
    stripInfo.textContent = `STRIP ${w}x${h} (${count}F)`;
    stripBar.classList.add('visible');
    setEditorMsg('HORIZONTAL STRIP DETECTED');
    return;
  }

  stripBar.classList.remove('visible');
  editor.pendingStripImg = null;
  const extracted = extractPixelsFromImageRect(img, 0, 0, w, h, editor.size, fitPasteCheck.checked);
  pastePixelsAsFloatingSelection(extracted, `PASTED ${w}x${h} (MOVE OR ESC)`);
}

export function loadImageBlob(blob) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    importImageIntoEditor(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    setEditorMsg('IMAGE LOAD FAILED');
  };
  img.src = url;
}

export function openEditor(spriteId = null) {
  editor.hydrating = true;
  stripBar.classList.remove('visible');
  editor.pendingStripImg = null;
  editor.undoStack.length = 0;
  editor.redoStack.length = 0;
  editor.panX = 0;
  editor.panY = 0;
  editor.panning = false;
  editor.modShift = false;
  editor.modAlt = false;
  editor.modCtrl = false;
  editor.activeStrokeTool = null;
  editor.selection = null;
  editor.floating = null;
  editor.selDragPoints = [];
  editor.brushPreviewUntil = 0;
  edBrushHud.classList.remove('show');
  edDraftStatus.classList.remove('show');
  editorStageScroll.classList.remove('panning');
  editor.playing = true;
  editor.previewAcc = 0;
  editor.dirty = false;
  setEditorMsg('');

  const existing = spriteId ? getSpriteById(spriteId) : null;
  if (existing) {
    editor.editingId = existing.id;
    editor.size = existing.size;
    editor.type = existing.type;
    editor.subType = existing.subType || getTypeDef(existing.type).subTypes[0];
    editor.customText = existing.customText || '';
    editor.lightOpts = sanitizeLightOpts(existing.lightOpts);
    editor.envOpts = sanitizeEnvOpts(existing.envOpts);
    editor.liquidOpts = sanitizeLiquidOpts(existing.liquidOpts);
    editor.harmOpts = sanitizeHarmOpts(existing.harmOpts);
    editor.lightGlowCell = 0;
    editor.baseLightPixels = (existing.type === 'LIGHT' && existing.subType === 'LIGHT GLOW')
      ? decodeFrame(existing.frames[0], TILE)
      : createEmptyPixels(TILE);
    editor.glowPixels = (existing.type === 'LIGHT' && existing.subType === 'LIGHT GLOW' && existing.glowFrame)
      ? decodeFrame(existing.glowFrame, LIGHT_GLOW_SIZE)
      : createEmptyPixels(LIGHT_GLOW_SIZE);
    editor.animMode = existing.animMode || 'LOOP';
    editor.fps = existing.fps || 6;
    spriteNameInput.value = existing.name;

    if (existing.type === 'BODY' && existing.subType !== 'MOTION') {
      editor.stateFrames = {};
      editor.stateFps = {};
      for (const st of BODY_STATES) {
        const src = existing.states && existing.states[st];
        if (Array.isArray(src) && src.length > 0) {
          editor.stateFrames[st] = src.map(f => decodeFrame(f, existing.size));
        } else if (st === 'STAND') {
          editor.stateFrames.STAND = existing.frames.map(f => decodeFrame(f, existing.size));
        } else {
          editor.stateFrames[st] = [createEmptyPixels(existing.size)];
        }
        editor.stateFps[st] = getSpriteStateFps(existing, st);
      }
      editor.bodyState = 'STAND';
      editor.frames = editor.stateFrames.STAND;
    } else if (existing.type === 'LIGHT' && existing.subType === 'LIGHT GLOW') {
      editor.size = TILE;
      editor.frames = [editor.baseLightPixels];
      editor.stateFps = {};
    } else {
      editor.frames = existing.frames.map(f => decodeFrame(f, existing.size));
      editor.stateFps = {};
    }
  } else {
    editor.editingId = null;
    editor.size = 19;
    editor.type = 'SOLID';
    editor.subType = 'SOLID';
    editor.customText = '';
    editor.lightOpts = defaultLightOpts();
    editor.envOpts = defaultEnvOpts();
    editor.liquidOpts = defaultLiquidOpts();
    editor.harmOpts = defaultHarmOpts();
    editor.lightGlowCell = 0;
    editor.baseLightPixels = createEmptyPixels(TILE);
    editor.glowPixels = createEmptyPixels(LIGHT_GLOW_SIZE);
    editor.animMode = 'LOOP';
    editor.fps = 6;
    editor.bodyState = 'STAND';
    editor.frames = [createEmptyPixels(19)];
    editor.stateFrames = {};
    editor.stateFps = {};
    spriteNameInput.value = generateUniqueName('SPRITE', state.sprites.map(s => s.name), 20, true);
  }

  editor.frameIdx = 0;
  editor.previewIdx = 0;
  editor.previewTick = 0;
  editor.transparent = false;
  editor.color = '#ffffff';
  setEditorType(editor.type, editor.subType, true);
  const savedPal = existing
    ? (Array.isArray(existing.palette) && existing.palette.length
        ? existing.palette
        : (existing.type === 'LIGHT' && existing.lightColor ? [existing.lightColor, ...BASE_PALETTE] : null))
    : null;
  rebuildPaletteFromEditorArt(savedPal);
  setEditorColor(editor.color);
  setEditorAnimMode(editor.animMode);
  setEditorTool('pencil');
  updateSelectionUI();
  updateBrushUI();
  updateShapeFillBtnUI();
  onionBtn.classList.toggle('active', editor.onionSkin);
  setEditorPreviewTileMode('1x1');
  updatePreviewHeaderUI();
  updateEditorSaveControls();
  editor.hydrating = false;
  editorModal.classList.add('open');
  // Compute best integer zoom after modal is visible
  requestAnimationFrame(() => {
    if (isLightGlowMode()) selectLightGlowCell(editor.lightGlowCell, true);
    else setEditorSize(editor.size, true);
  });
}

export function migrateSpritePlacementsAcrossWorlds(spriteId, newType, newSubType) {
  if (!spriteId) return 0;
  const isNonPlaceableGear = newType === 'WEARABLE' || newType === 'HOLDABLE';
  const targetLayer = isNonPlaceableGear ? null : layerForType(newType, newSubType);
  const activeWorld = getActiveWorld();
  let migratedTotal = 0;
  let migratedActive = false;

  for (let i = 0; i < state.worlds.length; i++) {
    const w = state.worlds[i];
    if (!w || !w.layers) continue;
    const isAct = w === activeWorld;

    for (const layer of ['bg', 'main', 'fg']) {
      if (layer === targetLayer) continue;
      const map = w.layers[layer];
      if (!map) continue;
      const keysToMove = [];
      for (const k in map) {
        if (map[k] === spriteId) keysToMove.push(k);
      }
      for (let j = 0; j < keysToMove.length; j++) {
        const k = keysToMove[j];
        delete map[k];
        if (targetLayer && w.layers[targetLayer]) {
          delete w.layers[targetLayer][k];
          w.layers[targetLayer][k] = spriteId;
        }
        migratedTotal++;
        if (isAct) {
          migratedActive = true;
          runtime.crumbling.delete(k);
          runtime.activators.delete(k);
          runtime.doorsOpen.delete(k);
          runtime.collected.delete(k);
          runtime.interactFrames.delete(k);
          if (layer === 'bg') {
            worldFX.bgPlaceOrder.delete(k);
            worldFX.bgFadeIns.delete(k);
            for (let f = worldFX.bgFadeOuts.length - 1; f >= 0; f--) {
              if (worldFX.bgFadeOuts[f].key === k && worldFX.bgFadeOuts[f].id === spriteId) {
                worldFX.bgFadeOuts.splice(f, 1);
              }
            }
          }
          if (targetLayer === 'bg') {
            worldFX.bgPlaceOrder.set(k, ++worldFX.bgOrderCounter);
          }
        }
      }
    }
  }

  if (migratedActive) {
    clearWorldHistory();
  }
  if (migratedTotal > 0) {
    invalidateBgEffectIndex();
  }
  return migratedTotal;
}

export function saveCurrentSprite(asCopy = false) {
  commitFloatingSelection(false);
  syncLightGlowBuffers();
  const existingOriginal = editor.editingId ? getSpriteById(editor.editingId) : null;
  const rawName = (spriteNameInput.value || '').trim().toUpperCase();
  let name;
  if (asCopy) {
    const baseForCopy = rawName || (existingOriginal ? existingOriginal.name : 'SPRITE');
    const nameTaken = state.sprites.some(s => s.name === baseForCopy);
    name = nameTaken
      ? generateUniqueName(baseForCopy, state.sprites.map(s => s.name), 20, false)
      : baseForCopy.slice(0, 20);
  } else {
    const fallbackName = generateUniqueName('SPRITE', state.sprites.map(s => s.name), 20, true);
    name = (rawName || fallbackName).slice(0, 20);
  }
  const customText = (editorCustomTextInput.value || '').trim().slice(0, 120);

  let encodedFrames;
  let encodedStates;
  let savedStateFps;
  let savedSize = editor.size;
  let savedLightColor;
  let savedLightOpts;
  let savedGlowFrame;

  if (isBodyRigMode()) {
    encodedStates = {};
    savedStateFps = {};
    for (const st of BODY_STATES) {
      const list = editor.stateFrames[st];
      if (st === 'STAND') {
        const standList = (Array.isArray(list) && list.length > 0) ? list : [createEmptyPixels(editor.size)];
        encodedStates.STAND = standList.map(encodeFrame);
      } else if (Array.isArray(list) && list.some(f => hasAnyPixel(f))) {
        encodedStates[st] = list.map(encodeFrame);
      }
      savedStateFps[st] = clamp(Math.round(editor.stateFps[st] || editor.fps || 6), 1, 24);
    }
    encodedFrames = encodedStates.STAND;
  } else if (isLightGlowMode()) {
    savedSize = TILE;
    encodedFrames = [encodeFrame(editor.baseLightPixels)];
    savedGlowFrame = encodeFrame(editor.glowPixels);
    savedLightColor = getEditorLightColor();
    savedLightOpts = sanitizeLightOpts(editor.lightOpts);
  } else {
    encodedFrames = editor.frames.map(encodeFrame);
    if (editor.type === 'LIGHT') {
      savedLightColor = getEditorLightColor();
      savedLightOpts = sanitizeLightOpts(editor.lightOpts);
    }
  }

  const baseFps = isBodyRigMode() ? (savedStateFps.STAND || editor.fps || 6) : editor.fps;
  const savedPalette = editor.palette.slice(0, 64);

  if (editor.editingId && !asCopy) {
    const target = getSpriteById(editor.editingId);
    if (target) {
      target.name = name;
      target.type = editor.type;
      target.subType = editor.subType;
      target.customText = customText;
      target.size = savedSize;
      target.fps = baseFps;
      target.stateFps = isBodyRigMode() ? savedStateFps : undefined;
      target.animMode = editor.animMode;
      target.frames = encodedFrames;
      target.states = isBodyRigMode() ? encodedStates : undefined;
      target.palette = savedPalette;
      target.lightColor = editor.type === 'LIGHT' ? savedLightColor : undefined;
      target.lightOpts = editor.type === 'LIGHT' ? savedLightOpts : undefined;
      target.glowFrame = isLightGlowMode() ? savedGlowFrame : undefined;
      target.envOpts = editor.type === 'ENVIRONMENT' ? sanitizeEnvOpts(editor.envOpts) : undefined;
      target.liquidOpts = editor.type === 'LIQUID' ? sanitizeLiquidOpts(editor.liquidOpts) : undefined;
      target.harmOpts = editor.type === 'HARMFUL' ? sanitizeHarmOpts(editor.harmOpts) : undefined;
      rebuildSpriteCanvases(target);
      const migratedCount = migrateSpritePlacementsAcrossWorlds(target.id, target.type, target.subType);
      if ((target.type !== 'BODY' || target.subType === 'MOTION') && state.equippedBodyId === target.id) {
        state.equippedBodyId = null;
        savePrefsNow();
      }
      if ((target.type !== 'BODY' || target.subType !== 'MOTION') && state.activeMotionId === target.id) {
        state.activeMotionId = null;
      }
      if (target.type !== 'WEARABLE' && state.equippedWearableId === target.id) {
        state.equippedWearableId = null;
        savePrefsNow();
      }
      if (target.type !== 'HOLDABLE' && state.equippedHoldableId === target.id) {
        state.equippedHoldableId = null;
        savePrefsNow();
      }
      if ((target.type === 'WEARABLE' || target.type === 'HOLDABLE') && state.selectedSpriteId === target.id) {
        state.selectedSpriteId = null;
      }
      if (migratedCount > 0) {
        saveWorldsNow(false);
      }
      rebuildSpriteIndex();
      syncRuntimeEntities(getActiveWorld(), true);
    }
  } else {
    const created = sanitizeSprite({
      id: 'sp_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
      name,
      type: editor.type,
      subType: editor.subType,
      customText,
      size: savedSize,
      fps: baseFps,
      stateFps: isBodyRigMode() ? savedStateFps : undefined,
      animMode: editor.animMode,
      frames: encodedFrames,
      states: isBodyRigMode() ? encodedStates : undefined,
      palette: savedPalette,
      lightColor: editor.type === 'LIGHT' ? savedLightColor : undefined,
      lightOpts: editor.type === 'LIGHT' ? savedLightOpts : undefined,
      glowFrame: isLightGlowMode() ? savedGlowFrame : undefined,
      envOpts: editor.type === 'ENVIRONMENT' ? sanitizeEnvOpts(editor.envOpts) : undefined,
      liquidOpts: editor.type === 'LIQUID' ? sanitizeLiquidOpts(editor.liquidOpts) : undefined,
      harmOpts: editor.type === 'HARMFUL' ? sanitizeHarmOpts(editor.harmOpts) : undefined
    });
    if (created) {
      state.sprites.push(created);
      rebuildSpriteIndex();
      // Do NOT auto-equip BODY, WEARABLE, or HOLDABLE, and only equip tile brushes in BUILD mode
      if (!isGearType(created.type) && state.mode === 'BUILD') {
        state.selectedSpriteId = created.id;
      }
    }
  }

  saveSpritesNow();
  clearEditorDraft();
  updateTopUI();
  renderSidebar();
  closeEditor(true);
  SFX.playCreateSuccess();
  showToast((asCopy ? 'SAVED COPY ' : 'SAVED ') + name);
}

export function closeEditor(fromSave = false) {
  if (!fromSave && editor.dirty && editorHasDraftableContent()) {
    if (flushEditorDraftNow(false)) {
      showToast('DRAFT SAVED');
    }
  }
  clearTimeout(editor.draftTimer);
  editor.draftTimer = null;
  editor.dirty = false;
  editor.selection = null;
  editor.floating = null;
  editor.selDragPoints = [];
  updateSelectionUI();
  closeTypePicker();
  editor.playing = false;
  editor.pendingStripImg = null;
  stripBar.classList.remove('visible');
  uiTooltip.classList.remove('show');
  edDraftStatus.classList.remove('show');
  editorModal.classList.remove('open');
  renderDraftBar();
}
