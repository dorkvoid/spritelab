import {
  BODY_STATES,
  getTypeDef,
  KEY_EDITOR_DRAFT,
  LIGHT_GLOW_SIZE,
  migrateLegacyType,
  sanitizeEnvOpts,
  sanitizeHarmOpts,
  sanitizeLightOpts,
  sanitizeLiquidOpts,
  TILE,
  TILE_ANIM_MODES
} from '../constants.js';
import {
  draftBar,
  draftNameEl,
  draftThumbCanvas,
  edBrushHud,
  edDraftStatus,
  editorCustomTextInput,
  editorModal,
  editorStageScroll,
  onionBtn,
  spriteNameInput,
  stripBar
} from '../dom.js';
import { rebuildPaletteFromEditorArt, setEditorColor } from './palette.js';
import { setEditorSize, setEditorType, updatePreviewHeaderUI } from './render.js';
import { commitFloatingSelection, updateSelectionUI } from './selection.js';
import {
  defaultSizeForType,
  editor,
  isBodyRigMode,
  isLightGlowMode,
  resetSymmetryCenter,
  selectLightGlowCell,
  setEditorAnimMode,
  setEditorMsg,
  setEditorPreviewTileMode,
  syncLightGlowBuffers,
  updateEditorSaveControls
} from './state.js';
import { setEditorTool, updateBrushUI, updateShapeFillBtnUI, updateSymmetryUI } from './tools.js';
import { getSpriteById, state } from '../state.js';
import { decodeFrame, encodeFrame, sessionGuard } from '../storage.js';
import {
  clamp,
  createEmptyPixels,
  generateUniqueName,
  hasAnyPixel,
  normalizeHex,
  pixelsToCanvas
} from '../utils.js';

/* =========================================================================
   CREATION EDITOR AUTO-DRAFT & ACCIDENTAL-EXIT RECOVERY
   Continuously saves unfinished work locally and flushes on tab exit/hide.
   ========================================================================= */
export function editorHasDraftableContent() {
  if (isLightGlowMode()) {
    syncLightGlowBuffers();
    if (hasAnyPixel(editor.baseLightPixels) || hasAnyPixel(editor.glowPixels)) return true;
  } else if (isBodyRigMode()) {
    for (const st of BODY_STATES) {
      const list = editor.stateFrames[st];
      if (Array.isArray(list) && list.some(fr => hasAnyPixel(fr))) return true;
    }
  } else if (Array.isArray(editor.frames) && editor.frames.some(fr => hasAnyPixel(fr))) {
    return true;
  }
  // Also preserve drafts when editing an existing sprite or typing custom sign/place text
  if (editor.editingId) return true;
  if ((editorCustomTextInput.value || '').trim().length > 0) return true;
  return false;
}

export function buildEditorDraftPayload() {
  commitFloatingSelection(false);
  syncLightGlowBuffers(false);
  const rawName = (spriteNameInput.value || '').trim().toUpperCase().slice(0, 20);
  const customText = (editorCustomTextInput.value || '').slice(0, 120);
  let encodedFrames;
  let encodedStates;
  let savedStateFps;
  let savedSize = editor.size;
  let savedGlowFrame;

  if (isBodyRigMode()) {
    encodedStates = {};
    savedStateFps = {};
    for (const st of BODY_STATES) {
      const list = editor.stateFrames[st];
      const safeList = (Array.isArray(list) && list.length > 0) ? list : [createEmptyPixels(editor.size)];
      encodedStates[st] = safeList.map(encodeFrame);
      savedStateFps[st] = clamp(Math.round(editor.stateFps[st] || editor.fps || 6), 1, 24);
    }
    encodedFrames = encodedStates.STAND;
  } else if (isLightGlowMode()) {
    savedSize = TILE;
    encodedFrames = [encodeFrame(editor.baseLightPixels)];
    savedGlowFrame = encodeFrame(editor.glowPixels);
  } else {
    encodedFrames = editor.frames.map(encodeFrame);
  }

  return {
    version: 3,
    savedAt: Date.now(),
    editingId: editor.editingId || null,
    name: rawName || 'UNTITLED',
    type: editor.type,
    subType: editor.subType,
    customText,
    size: savedSize,
    fps: editor.fps || 6,
    stateFps: isBodyRigMode() ? savedStateFps : undefined,
    bodyState: isBodyRigMode() ? editor.bodyState : 'STAND',
    animMode: editor.animMode,
    frameIdx: editor.frameIdx,
    lightGlowCell: isLightGlowMode() ? editor.lightGlowCell : 0,
    lightOpts: editor.type === 'LIGHT' ? sanitizeLightOpts(editor.lightOpts) : undefined,
    envOpts: editor.type === 'ENVIRONMENT' ? sanitizeEnvOpts(editor.envOpts) : undefined,
    liquidOpts: editor.type === 'LIQUID' ? sanitizeLiquidOpts(editor.liquidOpts) : undefined,
    harmOpts: editor.type === 'HARMFUL' ? sanitizeHarmOpts(editor.harmOpts) : undefined,
    palette: editor.palette.slice(0, 64),
    frames: encodedFrames,
    states: isBodyRigMode() ? encodedStates : undefined,
    glowFrame: isLightGlowMode() ? savedGlowFrame : undefined
  };
}

export function loadEditorDraft() {
  try {
    const raw = localStorage.getItem(KEY_EDITOR_DRAFT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.frames) || parsed.frames.length === 0) {
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

export function flashEditorDraftStatus() {
  if (!edDraftStatus) return;
  edDraftStatus.classList.add('show');
  clearTimeout(editor.draftStatusTimer);
  editor.draftStatusTimer = setTimeout(() => edDraftStatus.classList.remove('show'), 1400);
}

export function flushEditorDraftNow(showStatus = false) {
  clearTimeout(editor.draftTimer);
  editor.draftTimer = null;
  if (!sessionGuard.isOwner()) return false;
  if (!editorModal.classList.contains('open')) return false;
  if (!editor.dirty || !editorHasDraftableContent()) return false;
  try {
    const payload = buildEditorDraftPayload();
    localStorage.setItem(KEY_EDITOR_DRAFT, JSON.stringify(payload));
    if (showStatus) flashEditorDraftStatus();
    renderDraftBar();
    return true;
  } catch (_) {
    return false;
  }
}

export function scheduleEditorDraftSave() {
  if (!sessionGuard.isOwner()) return;
  if (editor.hydrating || !editorModal.classList.contains('open')) return;
  clearTimeout(editor.draftTimer);
  editor.draftTimer = setTimeout(() => {
    flushEditorDraftNow(true);
  }, 360);
}

export function markEditorDirty(immediate = false) {
  if (!sessionGuard.isOwner()) return;
  if (editor.hydrating || !editorModal.classList.contains('open')) return;
  editor.dirty = true;
  if (immediate) flushEditorDraftNow(true);
  else scheduleEditorDraftSave();
}

export function clearEditorDraft() {
  clearTimeout(editor.draftTimer);
  editor.draftTimer = null;
  if (!sessionGuard.isOwner()) return;
  try {
    localStorage.removeItem(KEY_EDITOR_DRAFT);
  } catch (_) {}
  renderDraftBar();
}

export function renderDraftBar() {
  if (!draftBar) return;
  const draft = loadEditorDraft();
  if (!draft) {
    draftBar.classList.remove('visible');
    return;
  }
  const size = clamp(Math.round(Number(draft.size)) || 19, 8, 32);
  const firstFrame = decodeFrame(draft.frames[0], size);
  draftThumbCanvas.width = size;
  draftThumbCanvas.height = size;
  const dtCtx = draftThumbCanvas.getContext('2d');
  dtCtx.imageSmoothingEnabled = false;
  dtCtx.clearRect(0, 0, size, size);
  const previewC = pixelsToCanvas(firstFrame, size);
  dtCtx.drawImage(previewC, 0, 0);

  const def = getTypeDef(draft.type);
  draftNameEl.textContent = `${(draft.name || 'UNTITLED').toUpperCase()} · ${def.label}`;
  draftBar.classList.add('visible');
}

export function openEditorFromDraft() {
  const draft = loadEditorDraft();
  if (!draft) {
    renderDraftBar();
    return;
  }

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

  // Safely detach editingId if the original sprite was deleted since drafting
  const sourceStillExists = Boolean(draft.editingId && getSpriteById(draft.editingId));
  editor.editingId = sourceStillExists ? draft.editingId : null;

  const migrated = migrateLegacyType(draft.type, draft.subType);
  editor.type = migrated.type;
  editor.subType = migrated.subType;

  const draftSize = clamp(
    Math.round(Number(draft.size)) || defaultSizeForType(editor.type, editor.subType),
    8,
    32
  );
  editor.size = draftSize;
  editor.customText = typeof draft.customText === 'string' ? draft.customText.slice(0, 120) : '';
  editor.lightOpts = sanitizeLightOpts(draft.lightOpts);
  editor.envOpts = sanitizeEnvOpts(draft.envOpts);
  editor.liquidOpts = sanitizeLiquidOpts(draft.liquidOpts);
  editor.harmOpts = sanitizeHarmOpts(draft.harmOpts);
  editor.animMode = TILE_ANIM_MODES.includes(draft.animMode) ? draft.animMode : 'LOOP';
  editor.fps = clamp(parseInt(draft.fps, 10) || 6, 1, 24);
  spriteNameInput.value = (typeof draft.name === 'string' && draft.name.trim()
    ? draft.name.trim()
    : generateUniqueName('SPRITE', state.sprites.map(s => s.name), 20, true)
  ).toUpperCase().slice(0, 20);

  if (isLightGlowMode()) {
    editor.baseLightPixels = decodeFrame(draft.frames[0], TILE);
    editor.glowPixels = draft.glowFrame
      ? decodeFrame(draft.glowFrame, LIGHT_GLOW_SIZE)
      : createEmptyPixels(LIGHT_GLOW_SIZE);
    editor.lightGlowCell = draft.lightGlowCell === 1 ? 1 : 0;
    editor.size = editor.lightGlowCell === 1 ? LIGHT_GLOW_SIZE : TILE;
    editor.frames = [editor.lightGlowCell === 1 ? editor.glowPixels : editor.baseLightPixels];
    editor.frameIdx = 0;
    editor.stateFrames = {};
    editor.stateFps = {};
    editor.bodyState = 'STAND';
  } else if (isBodyRigMode()) {
    editor.baseLightPixels = createEmptyPixels(TILE);
    editor.glowPixels = createEmptyPixels(LIGHT_GLOW_SIZE);
    editor.lightGlowCell = 0;
    editor.stateFrames = {};
    editor.stateFps = {};
    const srcStates = (draft.states && typeof draft.states === 'object') ? draft.states : {};
    const srcStateFps = (draft.stateFps && typeof draft.stateFps === 'object') ? draft.stateFps : {};
    for (const st of BODY_STATES) {
      const list = srcStates[st];
      if (Array.isArray(list) && list.length > 0) {
        editor.stateFrames[st] = list.map(f => decodeFrame(f, draftSize));
      } else if (st === 'STAND') {
        editor.stateFrames.STAND = draft.frames.map(f => decodeFrame(f, draftSize));
      } else {
        editor.stateFrames[st] = [createEmptyPixels(draftSize)];
      }
      editor.stateFps[st] = clamp(parseInt(srcStateFps[st], 10) || editor.fps, 1, 24);
    }
    editor.bodyState = BODY_STATES.includes(draft.bodyState) ? draft.bodyState : 'STAND';
    editor.frames = editor.stateFrames[editor.bodyState];
    editor.frameIdx = clamp(parseInt(draft.frameIdx, 10) || 0, 0, editor.frames.length - 1);
  } else {
    editor.baseLightPixels = createEmptyPixels(TILE);
    editor.glowPixels = createEmptyPixels(LIGHT_GLOW_SIZE);
    editor.lightGlowCell = 0;
    editor.stateFrames = {};
    editor.stateFps = {};
    editor.bodyState = 'STAND';
    editor.frames = draft.frames.map(f => decodeFrame(f, draftSize));
    if (editor.frames.length === 0) editor.frames = [createEmptyPixels(draftSize)];
    editor.frameIdx = clamp(parseInt(draft.frameIdx, 10) || 0, 0, editor.frames.length - 1);
  }

  editor.previewIdx = editor.frameIdx;
  editor.previewTick = 0;
  editor.transparent = false;
  editor.color = '#ffffff';

  setEditorType(editor.type, editor.subType, true);
  const savedPal = Array.isArray(draft.palette) && draft.palette.length
    ? draft.palette.map(normalizeHex).filter(Boolean)
    : null;
  rebuildPaletteFromEditorArt(savedPal);
  setEditorColor(editor.color);
  setEditorAnimMode(editor.animMode);
  setEditorTool('pencil');
  updateSelectionUI();
  updateBrushUI();
  updateShapeFillBtnUI();
  resetSymmetryCenter();
  updateSymmetryUI();
  onionBtn.classList.toggle('active', editor.onionSkin);
  setEditorPreviewTileMode('1x1');
  updatePreviewHeaderUI();
  updateEditorSaveControls();

  // Keep draft marked dirty so closing again without saving preserves the resumed work
  editor.dirty = true;
  editor.hydrating = false;
  setEditorMsg(draft.editingId && !sourceStillExists ? 'RESUMED DRAFT (NEW COPY)' : 'RESUMED DRAFT');
  editorModal.classList.add('open');

  requestAnimationFrame(() => {
    if (isLightGlowMode()) {
      selectLightGlowCell(editor.lightGlowCell, true);
    } else {
      setEditorSize(editor.size, true);
    }
  });
}
