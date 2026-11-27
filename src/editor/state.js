import {
  BASE_PALETTE,
  BIG_THING_SIZE,
  BODY_STATES,
  defaultActOpts,
  defaultBackOpts,
  defaultBigOpts,
  defaultChangingOpts,
  defaultDynamicOpts,
  defaultEnvOpts,
  defaultFarbackOpts,
  defaultHarmOpts,
  defaultLightOpts,
  defaultLiquidOpts,
  defaultMotionOpts,
  defaultThingOpts,
  DYNAMIC_DEFAULT_SIZE,
  getCelPolicy,
  getTypeDef,
  isDynamicCompanion,
  isGearType,
  isVeryBigThingSubType,
  LIGHT_GLOW_SIZE,
  TILE,
  TILE_ANIM_MODES,
  VERY_BIG_THING_SIZE
} from '../constants.js';
import {
  blinkGuideHint,
  bodyStateTabs,
  editorCanvas,
  editorMsg,
  edPlacedBadge,
  previewTile1Btn,
  previewTile3Btn,
  saveCopySpriteBtn,
  saveSpriteBtn,
  sizeValInput,
  sizeValInput2
} from '../dom.js';
import { markEditorDirty } from './draft.js';
import { refreshEditorAll, renderEditorPreview, updatePreviewHeaderUI } from './render.js';
import { clearEditorSelection, getCompositeFramePixels } from './selection.js';
import { fitEditorZoom, updateSymmetryUI } from './tools.js';
import { getSpriteById, runtime, state } from '../state.js';
import { clamp, createEmptyPixels, hasAnyPixel, stripHexAlpha } from '../utils.js';

/* =========================================================================
   SPRITE EDITOR STATE, COLOR PICKER, TOOLS, ONION SKIN & TYPE PICKER
   ========================================================================= */
export const editor = {
  editingId: null,
  size: 19,
  type: 'SOLID',
  subType: 'SOLID',
  customText: '',
  lightOpts: defaultLightOpts(),
  envOpts: defaultEnvOpts(),
  liquidOpts: defaultLiquidOpts(),
  harmOpts: defaultHarmOpts(),
  actOpts: defaultActOpts(),
  backOpts: defaultBackOpts(),
  thingOpts: defaultThingOpts(),
  changingOpts: defaultChangingOpts(),
  farbackOpts: defaultFarbackOpts(),
  bigOpts: defaultBigOpts(),
  motionOpts: defaultMotionOpts(),
  dynamicOpts: defaultDynamicOpts(),
  dynStudioTab: 'visual',
  dynPreviewMarker: 'DEFAULT',
  dynPickingPivot: false,
  surfaceSound: 'DEFAULT',
  poseAction: 'NONE',
  soundTouched: false,
  poseTouched: false,
  lightGlowCell: 0,
  baseLightPixels: createEmptyPixels(TILE),
  glowPixels: createEmptyPixels(LIGHT_GLOW_SIZE),
  glowPreviewDirty: true,
  animMode: 'LOOP',
  fps: 6,
  stateFps: {},
  bodyState: 'STAND',
  frames: [createEmptyPixels(19)],
  stateFrames: {},
  frameIdx: 0,
  tool: 'pencil',
  activeStrokeTool: null,
  brushSize: 1,
  brushShape: 'square',
  shapeFilled: false,
  mirrorX: false,
  symmetry: {
    enabled: false,
    h: true,
    v: false,
    d1: false,
    d2: false,
    x: 9.5,
    y: 9.5
  },
  onionSkin: false,
  showGrid: true,
  color: '#ffffff',
  alpha: 1,
  transparent: false,
  hsv: { h: 0, s: 0, v: 1 },
  palette: BASE_PALETTE.slice(),
  zoom: 16,
  panX: 0,
  panY: 0,
  panning: false,
  panStartX: 0,
  panStartY: 0,
  panOriginX: 0,
  panOriginY: 0,
  drawing: false,
  drawButton: 0,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  hoverX: -1,
  hoverY: -1,
  strokeBase: null,
  fillDragTarget: undefined,
  fillDragChanged: false,
  modShift: false,
  modAlt: false,
  modCtrl: false,
  playing: true,
  previewIdx: 0,
  previewAcc: 0,
  previewTick: 0,
  previewTileMode: '1x1',
  previewHover: { active: false, nx: 0.5, ny: 0.5, vx: 0, vy: 0, energy: 0, lastT: 0 },
  brushPreviewUntil: 0,
  pendingStripImg: null,
  undoStack: [],
  redoStack: [],
  selection: null,            // Uint8Array(size * size) | null
  floating: null,             // { pixels, ox, oy, startOx, startOy, baseMask } | null
  selDragMode: 'replace',     // 'replace' | 'add' | 'sub'
  selDragPoints: [],          // [{ x, y }] for active lasso drag
  selDragEndX: 0,
  selDragEndY: 0,
  selDragMoved: false,
  clipboard: null,            // { w, h, ox, oy, pixels, stamp } | null
  clipboardPreferInternal: false,
  writingClipboard: false,
  pasteToken: 0,
  marchingAcc: 0,
  dirty: false,
  hydrating: false,
  draftTimer: null,
  draftStatusTimer: null
};

export function setEditorMsg(msg) {
  editorMsg.textContent = String(msg || '').toUpperCase();
}

export function countSpritePlacements(spriteId) {
  if (!spriteId) return { tiles: 0, worlds: 0 };
  let tiles = 0;
  let worlds = 0;
  for (let i = 0; i < state.worlds.length; i++) {
    const w = state.worlds[i];
    let inThisWorld = 0;
    for (const layer of ['bg', 'main', 'fg']) {
      const map = w.layers && w.layers[layer];
      if (!map) continue;
      for (const k in map) {
        if (map[k] === spriteId) inThisWorld++;
      }
    }
    if (inThisWorld > 0) {
      tiles += inThisWorld;
      worlds++;
    }
  }
  return { tiles, worlds };
}

export function updateEditorSaveControls() {
  const isEditing = Boolean(editor.editingId && getSpriteById(editor.editingId));
  saveCopySpriteBtn.style.display = isEditing ? '' : 'none';
  saveCopySpriteBtn.classList.remove('copy-safe');

  if (!isEditing) {
    edPlacedBadge.classList.remove('visible', 'placed', 'warn');
    edPlacedBadge.textContent = '';
    saveSpriteBtn.dataset.tip = 'Save your new creation to the sidebar';
    return;
  }

  const usage = countSpritePlacements(editor.editingId);
  const isMounted = Boolean(runtime.mount && runtime.mount.id === editor.editingId);
  const isEquipped = (
    state.equippedBodyId === editor.editingId ||
    state.activeMotionId === editor.editingId ||
    state.equippedWearableId === editor.editingId ||
    state.equippedHoldableId === editor.editingId ||
    state.equippedDynamicId === editor.editingId
  );
  const convertingToGear = isGearType(editor.type) || isDynamicCompanion({ type: editor.type, subType: editor.subType });
  const targetLabel = editor.type === 'BODY' && editor.subType === 'MOTION'
    ? 'MOTION'
    : getTypeDef(editor.type).label;

  const hammerIco = '<svg class="px-ico" style="width:10px;height:10px;flex-shrink:0" viewBox="0 0 12 12" aria-hidden="true"><rect x="5" y="1" width="3" height="1"/><rect x="4" y="2" width="5" height="1"/><rect x="3" y="3" width="7" height="1"/><rect x="4" y="4" width="7" height="1"/><rect x="8" y="5" width="3" height="1"/><rect x="9" y="6" width="1" height="1"/><rect x="5" y="5" width="2" height="1"/><rect x="4" y="6" width="2" height="1"/><rect x="3" y="7" width="2" height="1"/><rect x="2" y="8" width="2" height="1"/><rect x="1" y="9" width="2" height="2"/></svg>';
  const warnIco = '<svg class="px-ico" style="width:10px;height:10px;flex-shrink:0" viewBox="0 0 12 12" aria-hidden="true"><rect x="5" y="1" width="2" height="2"/><rect x="4" y="3" width="4" height="2"/><rect x="3" y="5" width="6" height="2"/><rect x="2" y="7" width="8" height="2"/><rect x="1" y="9" width="10" height="2"/><rect x="5" y="4" width="2" height="3" fill="#111215"/><rect x="5" y="8" width="2" height="1" fill="#111215"/></svg>';

  if (convertingToGear && (usage.tiles > 0 || isMounted)) {
    const plural = usage.tiles === 1 ? '' : 's';
    const lbl = usage.tiles > 0
      ? `${targetLabel}: REMOVES ${usage.tiles} PLACED`
      : `${targetLabel}: DISMOUNTS ACTIVE`;
    edPlacedBadge.innerHTML = `${warnIco}<span>${lbl}</span>`;
    edPlacedBadge.classList.add('visible', 'warn');
    edPlacedBadge.classList.remove('placed');
    saveCopySpriteBtn.classList.add('copy-safe');
    saveSpriteBtn.dataset.tip = usage.tiles > 0
      ? `Change to ${targetLabel} and remove ${usage.tiles} placed block${plural} from the world`
      : `Change to ${targetLabel} and hop off your current ride`;
    saveCopySpriteBtn.dataset.tip = usage.tiles > 0
      ? `Save as a separate ${targetLabel} copy while keeping all ${usage.tiles} placed block${plural}`
      : `Save as a separate ${targetLabel} copy without changing your current ride`;
  } else if (usage.tiles > 0) {
    const lbl = usage.worlds > 1
      ? `PLACED: ${usage.tiles} (${usage.worlds} WORLDS)`
      : `PLACED: ${usage.tiles} IN WORLD`;
    edPlacedBadge.innerHTML = `${hammerIco}<span>${lbl}</span>`;
    edPlacedBadge.classList.add('visible', 'placed');
    edPlacedBadge.classList.remove('warn');
    const plural = usage.tiles === 1 ? '' : 's';
    saveSpriteBtn.dataset.tip = `Save and update all ${usage.tiles} placed block${plural} in your world`;
    saveCopySpriteBtn.dataset.tip = `Save as a new copy without changing the ${usage.tiles} placed block${plural}`;
  } else if (isEquipped) {
    edPlacedBadge.innerHTML = `${hammerIco}<span>EQUIPPED</span>`;
    edPlacedBadge.classList.add('visible', 'placed');
    edPlacedBadge.classList.remove('warn');
    saveSpriteBtn.dataset.tip = 'Save and update what you are wearing right now';
    saveCopySpriteBtn.dataset.tip = 'Save as a separate new copy without changing the original';
  } else {
    edPlacedBadge.innerHTML = `${hammerIco}<span>EDITING EXISTING</span>`;
    edPlacedBadge.classList.add('visible');
    edPlacedBadge.classList.remove('placed', 'warn');
    saveSpriteBtn.dataset.tip = 'Save changes to this creation';
    saveCopySpriteBtn.dataset.tip = 'Save as a separate new copy without changing the original';
  }
}

export function defaultSizeForType(type, subType) {
  if (type === 'BODY') return 29;
  if (type === 'DYNAMIC') return DYNAMIC_DEFAULT_SIZE;
  if (type === 'BIG_THING') {
    return isVeryBigThingSubType(subType) ? VERY_BIG_THING_SIZE : BIG_THING_SIZE;
  }
  return TILE;
}

export function isBigThingMode() {
  return editor.type === 'BIG_THING';
}

export function isBigBackFrontMode() {
  return editor.type === 'BIG_THING' && editor.subType === 'BACK + FRONT';
}

export function isBigTransformingMode() {
  return editor.type === 'BIG_THING' && editor.subType === 'TRANSFORMING';
}

export function isBigSingleCellMode() {
  return editor.type === 'BIG_THING' && (editor.subType === 'BIG THING' || editor.subType === 'VERY BIG THING');
}

export function getEditorCelPolicy() {
  return getCelPolicy(editor.type, editor.subType);
}

export function isEditorSingleCelMode() {
  return getEditorCelPolicy().single;
}

export function reframePixelsCentered(src, oldSize, newSize) {
  if (!Array.isArray(src)) return createEmptyPixels(newSize);
  if (oldSize === newSize && src.length === newSize * newSize) return src.slice();
  const out = createEmptyPixels(newSize);
  const offX = Math.floor((newSize - oldSize) * 0.5);
  const offY = Math.floor((newSize - oldSize) * 0.5);
  for (let y = 0; y < oldSize; y++) {
    const ny = y + offY;
    if (ny < 0 || ny >= newSize) continue;
    const srcRow = y * oldSize;
    const dstRow = ny * newSize;
    for (let x = 0; x < oldSize; x++) {
      const nx = x + offX;
      if (nx >= 0 && nx < newSize) out[dstRow + nx] = src[srcRow + x] || null;
    }
  }
  return out;
}


export function syncActiveFramesFromState() {
  if (!isBodyRigMode()) return;
  if (!Array.isArray(editor.stateFrames[editor.bodyState]) || editor.stateFrames[editor.bodyState].length === 0) {
    editor.stateFrames[editor.bodyState] = [createEmptyPixels(editor.size)];
  }
  editor.frames = editor.stateFrames[editor.bodyState];
  editor.frameIdx = clamp(editor.frameIdx, 0, editor.frames.length - 1);
}

export function updateBodyStateTabDots() {
  if (!isBodyRigMode()) return;
  bodyStateTabs.querySelectorAll('button[data-bstate]').forEach(btn => {
    const st = btn.dataset.bstate;
    const list = editor.stateFrames[st];
    const hasArt = Array.isArray(list) && list.some(f => hasAnyPixel(f));
    btn.classList.toggle('active', st === editor.bodyState);
    btn.classList.toggle('has-art', hasArt);
  });
  blinkGuideHint.classList.toggle('visible', editor.bodyState === 'BLINK');
}

export function selectBodyState(st) {
  if (!isBodyRigMode() || !BODY_STATES.includes(st)) return;
  clearEditorSelection(true);
  editor.bodyState = st;
  syncActiveFramesFromState();
  editor.frameIdx = 0;
  editor.previewIdx = 0;
  editor.previewAcc = 0;
  editor.previewTick = 0;
  updateBodyStateTabDots();
  updatePreviewHeaderUI();
  refreshEditorAll();
}

export function getEditorActiveFps() {
  if (isBodyRigMode()) {
    return clamp(Math.round(editor.stateFps[editor.bodyState] || editor.fps || 6), 1, 24);
  }
  return clamp(Math.round(editor.fps || 6), 1, 24);
}

export function setEditorActiveFps(val) {
  const next = clamp(Math.round(val), 1, 24);
  if (isBodyRigMode()) {
    editor.stateFps[editor.bodyState] = next;
  } else {
    editor.fps = next;
  }
  updatePreviewHeaderUI();
  markEditorDirty();
}

export function setEditorAnimMode(mode) {
  editor.animMode = TILE_ANIM_MODES.includes(mode) ? mode : 'LOOP';
  updatePreviewHeaderUI();
}

export function setEditorPreviewTileMode(mode) {
  editor.previewTileMode = mode === '3x3' ? '3x3' : '1x1';
  previewTile1Btn.classList.toggle('active', editor.previewTileMode === '1x1');
  previewTile3Btn.classList.toggle('active', editor.previewTileMode === '3x3');
  renderEditorPreview();
}


export function isBodyRigMode() {
  return editor.type === 'BODY' && editor.subType !== 'MOTION';
}

export function isLightGlowMode() {
  return editor.type === 'LIGHT' && editor.subType === 'LIGHT GLOW';
}

export function getEditorLightColor() {
  if (Array.isArray(editor.palette) && editor.palette.length > 0) {
    const first = stripHexAlpha(editor.palette[0]);
    if (first) return first;
  }
  return stripHexAlpha(editor.color) || '#f28c38';
}

export const lightGlowScratchCanvas = document.createElement('canvas');
lightGlowScratchCanvas.width = LIGHT_GLOW_SIZE;
lightGlowScratchCanvas.height = LIGHT_GLOW_SIZE;
export const lightGlowScratchCtx = lightGlowScratchCanvas.getContext('2d');
let lightGlowScratchHasPixels = false;

export function getLightGlowPreviewCanvas() {
  if (editor.glowPreviewDirty) {
    editor.glowPreviewDirty = false;
    lightGlowScratchCtx.clearRect(0, 0, LIGHT_GLOW_SIZE, LIGHT_GLOW_SIZE);
    const px = editor.glowPixels;
    let hasAny = false;
    if (px) {
      for (let y = 0; y < LIGHT_GLOW_SIZE; y++) {
        const row = y * LIGHT_GLOW_SIZE;
        for (let x = 0; x < LIGHT_GLOW_SIZE; x++) {
          const hex = px[row + x];
          if (hex) {
            lightGlowScratchCtx.fillStyle = hex;
            lightGlowScratchCtx.fillRect(x, y, 1, 1);
            hasAny = true;
          }
        }
      }
    }
    lightGlowScratchHasPixels = hasAny;
  }
  return lightGlowScratchHasPixels ? lightGlowScratchCanvas : null;
}

export function syncLightGlowBuffers(markDirty = true) {
  if (!isLightGlowMode()) return;
  const cur = editor.frames && editor.frames[0];
  if (!cur) return;
  if (editor.lightGlowCell === 1 && cur.length === LIGHT_GLOW_SIZE * LIGHT_GLOW_SIZE) {
    editor.glowPixels = editor.floating ? getCompositeFramePixels(cur) : cur;
    if (markDirty) editor.glowPreviewDirty = true;
  } else if (editor.lightGlowCell === 0 && cur.length === TILE * TILE) {
    editor.baseLightPixels = editor.floating ? getCompositeFramePixels(cur) : cur;
  }
}

export function isSymmetryActive() {
  const sym = editor.symmetry;
  return Boolean(sym && sym.enabled && (sym.h || sym.v || sym.d1 || sym.d2));
}

export function resetSymmetryCenter() {
  if (!editor.symmetry) return;
  editor.symmetry.x = editor.size * 0.5;
  editor.symmetry.y = editor.size * 0.5;
}

/* Compute deduplicated mirrored coordinates for all enabled symmetry axes (H, V, \, /) */
export function getSymmetryPoints(x, y, s = editor.size) {
  const sym = editor.symmetry;
  if (!sym || !sym.enabled || (!sym.h && !sym.v && !sym.d1 && !sym.d2)) {
    return [[x, y]];
  }
  const ax = Number.isFinite(sym.x) ? sym.x : s * 0.5;
  const ay = Number.isFinite(sym.y) ? sym.y : s * 0.5;
  const hSum = Math.round(2 * ax - 1);
  const vSum = Math.round(2 * ay - 1);
  const d1Off = Math.round(ax - ay);
  const d2Sum = Math.round(ax + ay - 1);

  const pts = [[x, y]];
  const seen = new Set([`${x},${y}`]);
  const add = (px, py) => {
    const k = `${px},${py}`;
    if (!seen.has(k)) {
      seen.add(k);
      pts.push([px, py]);
    }
  };

  // Sequential reflection passes generate exact 2-way, 4-way, or 8-way dihedral symmetry without off-center drift
  const applyAxis = fn => {
    const count = pts.length;
    for (let i = 0; i < count; i++) {
      const [px, py] = pts[i];
      const [nx, ny] = fn(px, py);
      add(nx, ny);
    }
  };

  if (sym.h) applyAxis((px, py) => [hSum - px, py]);
  if (sym.v) applyAxis((px, py) => [px, vSum - py]);
  if (sym.d1) applyAxis((px, py) => [py + d1Off, px - d1Off]);
  if (sym.d2) applyAxis((px, py) => [d2Sum - py, d2Sum - px]);
  // Close H/V across newly generated diagonal reflections (e.g., H + \ or V + /)
  if ((sym.d1 || sym.d2) && (sym.h || sym.v)) {
    if (sym.h) applyAxis((px, py) => [hSum - px, py]);
    if (sym.v) applyAxis((px, py) => [px, vSum - py]);
  }
  return pts;
}

export function selectLightGlowCell(cellIdx, refit = false) {
  if (!isLightGlowMode()) return;
  clearEditorSelection(true);
  syncLightGlowBuffers();
  if (!editor.baseLightPixels || editor.baseLightPixels.length !== TILE * TILE) {
    editor.baseLightPixels = createEmptyPixels(TILE);
  }
  if (!editor.glowPixels || editor.glowPixels.length !== LIGHT_GLOW_SIZE * LIGHT_GLOW_SIZE) {
    editor.glowPixels = createEmptyPixels(LIGHT_GLOW_SIZE);
  }
  editor.glowPreviewDirty = true;
  editor.lightGlowCell = cellIdx === 1 ? 1 : 0;
  editor.size = editor.lightGlowCell === 1 ? LIGHT_GLOW_SIZE : TILE;
  resetSymmetryCenter();
  updateSymmetryUI();
  editor.frames = [editor.lightGlowCell === 1 ? editor.glowPixels : editor.baseLightPixels];
  editor.frameIdx = 0;
  sizeValInput.value = String(editor.size);
  sizeValInput2.value = String(editor.size);
  updatePreviewHeaderUI();
  if (refit) {
    fitEditorZoom();
  } else {
    editorCanvas.width = editor.size * editor.zoom;
    editorCanvas.height = editor.size * editor.zoom;
    editorCanvas.style.width = editorCanvas.width + 'px';
    editorCanvas.style.height = editorCanvas.height + 'px';
    refreshEditorAll();
  }
}

