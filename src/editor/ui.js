import { BASE_PALETTE, BODY_STATES, getTypeDef, TYPE_DEFS } from '../constants.js';
import {
  addFrameBtn,
  addSwatchBtn,
  alphaBarWrap,
  bodyStateTabs,
  brushShapeBtn,
  brushSizeBtn,
  cancelSpriteBtn,
  clearFrameBtn,
  closeEditorX,
  closeTypePickerX,
  closeViewableBtn,
  closeViewableX,
  delFrameBtn,
  deselectBtn,
  dialogueBox,
  discardDraftBtn,
  dismissStripBtn,
  dupFrameBtn,
  edGridBtn,
  editorCustomTextInput,
  editorModal,
  editorStageScroll,
  editorSubTypeSelect,
  editorTypeBtn,
  edZoomFitBtn,
  edZoomInBtn,
  edZoomOutBtn,
  envIntensitySelect,
  envWindDirSelect,
  envWindStrengthSelect,
  exportPngBtn,
  fitPasteCheck,
  fitStripBtn,
  flipHBtn,
  flipVBtn,
  fpsDecBtn,
  fpsIncBtn,
  harmStrengthSelect,
  hexInput,
  hueBarWrap,
  lightFillModeSelect,
  lightGlowBehaviorSelect,
  lightGlowStyleSelect,
  lightPulsatingCheck,
  lightSurroundSelect,
  lightThickCheck,
  liquidBreathableCheck,
  mirrorXBtn,
  nextFrameBtn,
  onionBtn,
  openCreateBtn,
  openPngBtn,
  pasteBtn,
  playAnimBtn,
  pngFileInput,
  prevFrameBtn,
  previewTile1Btn,
  previewTile3Btn,
  redoBtn,
  resetPaletteBtn,
  resumeDraftBtn,
  rotateBtn,
  saveCopySpriteBtn,
  saveSpriteBtn,
  setFirstPaletteBtn,
  shapeFillBtn,
  showToast,
  sizeDecBtn,
  sizeDecBtn2,
  sizeIncBtn,
  sizeIncBtn2,
  sizeValInput,
  sizeValInput2,
  sliceStripBtn,
  spriteNameInput,
  stripBar,
  stripFrameWidthInput,
  stripInfo,
  svPickerWrap,
  symAxisD1Btn,
  symAxisD2Btn,
  symAxisHBtn,
  symAxisVBtn,
  symCenterBtn,
  symOffBtn,
  symXDecBtn,
  symXIncBtn,
  symYDecBtn,
  symYIncBtn,
  tpDescBar,
  tpGrid,
  tpSearchInput,
  typePickerModal,
  undoBtn,
  viewableModal
} from '../dom.js';
import { clearEditorDraft, markEditorDirty, openEditorFromDraft } from './draft.js';
import {
  closeEditor,
  extractPixelsFromImageRect,
  loadImageBlob,
  openEditor,
  pastePixelsAsFloatingSelection,
  saveCurrentSprite
} from './io.js';
import {
  ensureColorInPalette,
  promoteColorToFirstPalette,
  rebuildPaletteFromEditorArt,
  renderAlphaBar,
  renderHueBar,
  renderPaletteSwatches,
  renderSVCanvas,
  setEditorAlpha,
  setEditorColor,
  setEditorColorFromHSV,
  updateColorSwatchUI
} from './palette.js';
import {
  drawEditorCanvas,
  refreshEditorAll,
  renderEditorPreview,
  setEditorSize,
  setEditorType,
  updateEnvOptionsUI,
  updateHarmOptionsUI,
  updatePreviewHeaderUI
} from './render.js';
import {
  clearEditorSelection,
  copyEditorSelection,
  deleteSelectedPixels,
  editorHasSelection,
  getCompositeFramePixels,
  pasteEditorClipboard,
  transformSelectedPixels
} from './selection.js';
import {
  editor,
  getEditorActiveFps,
  isBodyRigMode,
  isLightGlowMode,
  resetSymmetryCenter,
  selectBodyState,
  selectLightGlowCell,
  setEditorActiveFps,
  setEditorAnimMode,
  setEditorMsg,
  setEditorPreviewTileMode,
  syncActiveFramesFromState,
  syncLightGlowBuffers,
  updateBodyStateTabDots
} from './state.js';
import {
  applyEditorPanTransform,
  doRedo,
  doUndo,
  fitEditorZoom,
  initEditorCanvasEvents,
  nudgeSymmetryAxis,
  pushUndo,
  setEditorBrushShape,
  setEditorBrushSize,
  setEditorTool,
  setEditorZoom,
  toggleSymmetryAxis,
  toggleSymmetryEnabled,
  updateShapeFillBtnUI,
  updateSymmetryUI
} from './tools.js';
import { initTooltipSystem } from '../ui/tooltips.js';
import { clamp, createEmptyPixels, normalizeHex, pixelsToCanvas } from '../utils.js';
import { closeViewable, hideDialogue } from '../world.js';

/* Manyland 2-Column Type Picker Modal */
export function renderTypePickerGrid(filterText = '') {
  const q = String(filterText || '').trim().toUpperCase();
  tpGrid.innerHTML = '';
  const list = q
    ? TYPE_DEFS.filter(t => t.label.includes(q) || t.id.includes(q) || t.desc.toUpperCase().includes(q))
    : TYPE_DEFS;

  list.forEach((def, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const rowAlt = Math.floor(idx / 2) % 2 === 1;
    btn.className = 'tp-cell' + (rowAlt ? ' alt' : '') + (def.id === editor.type ? ' active' : '');
    btn.innerHTML = `<span>${def.label}</span><svg class="px-ico" viewBox="0 0 12 12">${def.icon}</svg>`;
    btn.addEventListener('pointerenter', () => {
      tpDescBar.innerHTML = `<span><strong>${def.label}</strong> — ${def.desc}</span>`;
    });
    btn.addEventListener('click', () => {
      setEditorType(def.id, null, false);
      closeTypePicker();
    });
    tpGrid.appendChild(btn);
  });
}

export function openTypePicker() {
  tpSearchInput.value = '';
  renderTypePickerGrid('');
  const cur = getTypeDef(editor.type);
  tpDescBar.innerHTML = `<span><strong>${cur.label}</strong> — ${cur.desc}</span>`;
  typePickerModal.classList.add('open');
}

export function closeTypePicker() {
  typePickerModal.classList.remove('open');
}

export function initEditorStaticUI() {
  initTooltipSystem();
  initEditorCanvasEvents();
  initEditorClipboardEvents();
  renderHueBar();
  renderAlphaBar();
  renderSVCanvas();
  renderPaletteSwatches();

  openCreateBtn.addEventListener('click', () => openEditor(null));
  resumeDraftBtn.addEventListener('click', openEditorFromDraft);
  discardDraftBtn.addEventListener('click', () => {
    if (discardDraftBtn.dataset.armed === '1') {
      discardDraftBtn.dataset.armed = '';
      discardDraftBtn.classList.remove('danger-confirm');
      discardDraftBtn.textContent = 'X';
      clearEditorDraft();
      showToast('DRAFT DISCARDED');
    } else {
      discardDraftBtn.dataset.armed = '1';
      discardDraftBtn.classList.add('danger-confirm');
      discardDraftBtn.textContent = 'DEL?';
      setTimeout(() => {
        if (discardDraftBtn.isConnected && discardDraftBtn.dataset.armed === '1') {
          discardDraftBtn.dataset.armed = '';
          discardDraftBtn.classList.remove('danger-confirm');
          discardDraftBtn.textContent = 'X';
        }
      }, 2200);
    }
  });
  spriteNameInput.addEventListener('input', () => markEditorDirty());
  closeEditorX.addEventListener('click', () => closeEditor(false));
  cancelSpriteBtn.addEventListener('click', () => closeEditor(false));
  saveCopySpriteBtn.addEventListener('click', () => saveCurrentSprite(true));
  saveSpriteBtn.addEventListener('click', () => saveCurrentSprite(false));
  editorModal.addEventListener('click', e => {
    if (e.target === editorModal) closeEditor(false);
  });

  // Manyland 2-Column Type Picker & Subtype Selector
  editorTypeBtn.addEventListener('click', openTypePicker);
  closeTypePickerX.addEventListener('click', closeTypePicker);
  typePickerModal.addEventListener('click', e => {
    if (e.target === typePickerModal) closeTypePicker();
  });
  tpSearchInput.addEventListener('input', () => renderTypePickerGrid(tpSearchInput.value));

  editorSubTypeSelect.addEventListener('change', () => {
    const nextSub = editorSubTypeSelect.value;
    if (editor.type === 'BODY' || editor.type === 'LIGHT') {
      setEditorType(editor.type, nextSub, true);
      return;
    }
    editor.subType = nextSub;
    if (editor.type === 'ENVIRONMENT') {
      updateEnvOptionsUI();
      updatePreviewHeaderUI();
      renderEditorPreview();
    } else if (editor.type === 'CHANGING') {
      if (editor.subType === 'ON TOUCH') setEditorAnimMode('TOUCH');
      else if (editor.subType === 'PING-PONG') setEditorAnimMode('PING-PONG');
      else setEditorAnimMode('LOOP');
    } else if (editor.type === 'HARMFUL') {
      updateHarmOptionsUI();
      updatePreviewHeaderUI();
      renderEditorPreview();
    }
    markEditorDirty();
  });

  // Physics Environment Option Controls
  envIntensitySelect.addEventListener('change', () => {
    editor.envOpts.intensity = envIntensitySelect.value;
    renderEditorPreview();
    markEditorDirty();
  });
  envWindDirSelect.addEventListener('change', () => {
    editor.envOpts.windDir = envWindDirSelect.value;
    renderEditorPreview();
    markEditorDirty();
  });
  envWindStrengthSelect.addEventListener('change', () => {
    editor.envOpts.windStrength = envWindStrengthSelect.value;
    renderEditorPreview();
    markEditorDirty();
  });

  // Liquid Options (Breathable attribute)
  liquidBreathableCheck.addEventListener('change', () => {
    editor.liquidOpts.breathable = liquidBreathableCheck.checked;
    updatePreviewHeaderUI();
    markEditorDirty();
  });

  // Harmful Options (Strength: LOW 10 / NORMAL 20 / HIGH 35 HP)
  harmStrengthSelect.addEventListener('change', () => {
    editor.harmOpts.strength = harmStrengthSelect.value;
    updateHarmOptionsUI();
    updatePreviewHeaderUI();
    markEditorDirty();
  });

  // Manyland Light Subtype Option Controls
  setFirstPaletteBtn.addEventListener('click', () => {
    if (editor.transparent) return;
    promoteColorToFirstPalette(editor.color);
    setEditorMsg('LIGHT COLOR SET TO ' + editor.color.toUpperCase());
  });
  lightPulsatingCheck.addEventListener('change', () => {
    editor.lightOpts.pulsating = lightPulsatingCheck.checked;
    renderEditorPreview();
    markEditorDirty();
  });
  lightThickCheck.addEventListener('change', () => {
    editor.lightOpts.thick = lightThickCheck.checked;
    renderEditorPreview();
    markEditorDirty();
  });
  lightFillModeSelect.addEventListener('change', () => {
    editor.lightOpts.fillMode = lightFillModeSelect.value;
    renderEditorPreview();
    markEditorDirty();
  });
  lightSurroundSelect.addEventListener('change', () => {
    editor.lightOpts.surroundThick = lightSurroundSelect.value;
    renderEditorPreview();
    markEditorDirty();
  });
  lightGlowBehaviorSelect.addEventListener('change', () => {
    editor.lightOpts.glowBehavior = lightGlowBehaviorSelect.value;
    renderEditorPreview();
    markEditorDirty();
  });
  lightGlowStyleSelect.addEventListener('change', () => {
    editor.lightOpts.glowStyle = lightGlowStyleSelect.value;
    renderEditorPreview();
    markEditorDirty();
  });

  editorCustomTextInput.addEventListener('input', () => {
    editor.customText = editorCustomTextInput.value;
    markEditorDirty();
  });

  // Viewable modal & Dialogue close controls
  closeViewableX.addEventListener('click', closeViewable);
  closeViewableBtn.addEventListener('click', closeViewable);
  viewableModal.addEventListener('click', e => {
    if (e.target === viewableModal) closeViewable();
  });
  dialogueBox.addEventListener('click', hideDialogue);

  // Linked square canvas dimension steppers (8-32px; locked to 19x19 + 38x38 on LIGHT GLOW)
  const stepSize = delta => {
    if (isLightGlowMode()) {
      setEditorMsg('LIGHT GLOW USES 19x19 + 38x38 CELLS');
      return;
    }
    setEditorSize(editor.size + delta, false);
  };
  const commitSizeInput = inp => {
    if (isLightGlowMode()) {
      inp.value = String(editor.size);
      setEditorMsg('LIGHT GLOW USES 19x19 + 38x38 CELLS');
      return;
    }
    const val = parseInt(inp.value, 10);
    if (Number.isFinite(val)) setEditorSize(val, true);
    else inp.value = String(editor.size);
  };

  sizeDecBtn.addEventListener('click', () => stepSize(-1));
  sizeIncBtn.addEventListener('click', () => stepSize(1));
  sizeDecBtn2.addEventListener('click', () => stepSize(-1));
  sizeIncBtn2.addEventListener('click', () => stepSize(1));
  sizeValInput.addEventListener('change', () => commitSizeInput(sizeValInput));
  sizeValInput2.addEventListener('change', () => commitSizeInput(sizeValInput2));

  edZoomOutBtn.addEventListener('click', () => setEditorZoom(editor.zoom - (editor.zoom >= 24 ? 2 : 1)));
  edZoomInBtn.addEventListener('click', () => setEditorZoom(editor.zoom + (editor.zoom >= 24 ? 2 : 1)));
  edZoomFitBtn.addEventListener('click', fitEditorZoom);

  // Middle-click pan on editor canvas stage
  const stopEditorPan = e => {
    if (!editor.panning) return;
    editor.panning = false;
    editorStageScroll.classList.remove('panning');
    if (e) {
      try { editorStageScroll.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  };
  editorStageScroll.addEventListener('pointerdown', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    editor.panning = true;
    editor.panStartX = e.clientX;
    editor.panStartY = e.clientY;
    editor.panOriginX = editor.panX;
    editor.panOriginY = editor.panY;
    editorStageScroll.classList.add('panning');
    try { editorStageScroll.setPointerCapture(e.pointerId); } catch (_) {}
  });
  editorStageScroll.addEventListener('pointermove', e => {
    if (!editor.panning) return;
    editor.panX = editor.panOriginX + (e.clientX - editor.panStartX);
    editor.panY = editor.panOriginY + (e.clientY - editor.panStartY);
    applyEditorPanTransform();
  });
  editorStageScroll.addEventListener('pointerup', stopEditorPan);
  editorStageScroll.addEventListener('pointercancel', stopEditorPan);

  // Ctrl + Scroll anywhere inside Create Editor changes brush size (and blocks browser zoom)
  editorModal.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setEditorBrushSize(editor.brushSize + (e.deltaY < 0 ? 1 : -1), true);
    }
  }, { passive: false });

  editorStageScroll.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return;
    const step = editor.zoom >= 24 ? 2 : 1;
    setEditorZoom(editor.zoom + (e.deltaY < 0 ? step : -step), e.clientX, e.clientY);
  }, { passive: false });

  // Tool Rail
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setEditorTool(btn.dataset.tool));
  });

  deselectBtn.addEventListener('click', () => {
    clearEditorSelection(true, true);
  });

  brushSizeBtn.addEventListener('click', () => {
    const presets = [1, 2, 3, 5, 8];
    const next = presets.find(v => v > editor.brushSize) || 1;
    setEditorBrushSize(next, true);
  });

  brushShapeBtn.addEventListener('click', () => {
    setEditorBrushShape(editor.brushShape === 'square' ? 'circle' : 'square', true);
  });

  shapeFillBtn.addEventListener('click', () => {
    editor.shapeFilled = !editor.shapeFilled;
    updateShapeFillBtnUI();
  });

  mirrorXBtn.addEventListener('click', () => {
    toggleSymmetryEnabled();
  });

  symAxisHBtn.addEventListener('click', () => toggleSymmetryAxis('h'));
  symAxisVBtn.addEventListener('click', () => toggleSymmetryAxis('v'));
  symAxisD1Btn.addEventListener('click', () => toggleSymmetryAxis('d1'));
  symAxisD2Btn.addEventListener('click', () => toggleSymmetryAxis('d2'));
  symXDecBtn.addEventListener('click', () => nudgeSymmetryAxis('x', -0.5));
  symXIncBtn.addEventListener('click', () => nudgeSymmetryAxis('x', 0.5));
  symYDecBtn.addEventListener('click', () => nudgeSymmetryAxis('y', -0.5));
  symYIncBtn.addEventListener('click', () => nudgeSymmetryAxis('y', 0.5));
  symCenterBtn.addEventListener('click', () => {
    resetSymmetryCenter();
    updateSymmetryUI();
    drawEditorCanvas();
  });
  symOffBtn.addEventListener('click', () => toggleSymmetryEnabled(false));

  edGridBtn.addEventListener('click', () => {
    editor.showGrid = !editor.showGrid;
    edGridBtn.classList.toggle('active', editor.showGrid);
    drawEditorCanvas();
  });

  flipHBtn.addEventListener('click', () => {
    if (editorHasSelection()) {
      transformSelectedPixels('flipH');
      return;
    }
    pushUndo();
    const s = editor.size;
    const src = editor.frames[editor.frameIdx];
    const out = createEmptyPixels(s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        out[y * s + (s - 1 - x)] = src[y * s + x];
      }
    }
    editor.frames[editor.frameIdx] = out;
    syncLightGlowBuffers();
    refreshEditorAll();
    markEditorDirty();
  });

  flipVBtn.addEventListener('click', () => {
    if (editorHasSelection()) {
      transformSelectedPixels('flipV');
      return;
    }
    pushUndo();
    const s = editor.size;
    const src = editor.frames[editor.frameIdx];
    const out = createEmptyPixels(s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        out[(s - 1 - y) * s + x] = src[y * s + x];
      }
    }
    editor.frames[editor.frameIdx] = out;
    syncLightGlowBuffers();
    refreshEditorAll();
    markEditorDirty();
  });

  rotateBtn.addEventListener('click', () => {
    if (editorHasSelection()) {
      transformSelectedPixels('rotate');
      return;
    }
    pushUndo();
    const s = editor.size;
    const src = editor.frames[editor.frameIdx];
    const out = createEmptyPixels(s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        out[x * s + (s - 1 - y)] = src[y * s + x];
      }
    }
    editor.frames[editor.frameIdx] = out;
    syncLightGlowBuffers();
    refreshEditorAll();
    markEditorDirty();
  });

  undoBtn.addEventListener('click', doUndo);
  redoBtn.addEventListener('click', doRedo);

  clearFrameBtn.addEventListener('click', () => {
    if (editorHasSelection()) {
      deleteSelectedPixels();
      return;
    }
    pushUndo();
    editor.frames[editor.frameIdx] = createEmptyPixels(editor.size);
    syncLightGlowBuffers();
    refreshEditorAll();
    markEditorDirty();
  });

  // Interactive 2D Saturation-Value Canvas
  let draggingSV = false;
  const pickSV = e => {
    const rect = svPickerWrap.getBoundingClientRect();
    editor.hsv.s = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    editor.hsv.v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    setEditorColorFromHSV();
  };
  svPickerWrap.addEventListener('pointerdown', e => {
    e.preventDefault();
    draggingSV = true;
    pickSV(e);
    try { svPickerWrap.setPointerCapture(e.pointerId); } catch (_) {}
  });
  svPickerWrap.addEventListener('pointermove', e => {
    if (draggingSV) pickSV(e);
  });
  svPickerWrap.addEventListener('pointerup', e => {
    draggingSV = false;
    try { svPickerWrap.releasePointerCapture(e.pointerId); } catch (_) {}
  });

  // Interactive Hue Spectrum Bar
  let draggingHue = false;
  const pickHue = e => {
    const rect = hueBarWrap.getBoundingClientRect();
    editor.hsv.h = clamp(((e.clientX - rect.left) / rect.width) * 360, 0, 359.9);
    setEditorColorFromHSV();
  };
  hueBarWrap.addEventListener('pointerdown', e => {
    e.preventDefault();
    draggingHue = true;
    pickHue(e);
    try { hueBarWrap.setPointerCapture(e.pointerId); } catch (_) {}
  });
  hueBarWrap.addEventListener('pointermove', e => {
    if (draggingHue) pickHue(e);
  });
  hueBarWrap.addEventListener('pointerup', e => {
    draggingHue = false;
    try { hueBarWrap.releasePointerCapture(e.pointerId); } catch (_) {}
  });

  // Interactive Color Opacity Slider (directly under the Hue / Color Bar)
  let draggingAlpha = false;
  const pickAlpha = e => {
    const rect = alphaBarWrap.getBoundingClientRect();
    const frac = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    setEditorAlpha(frac);
  };
  alphaBarWrap.addEventListener('pointerdown', e => {
    e.preventDefault();
    draggingAlpha = true;
    pickAlpha(e);
    try { alphaBarWrap.setPointerCapture(e.pointerId); } catch (_) {}
  });
  alphaBarWrap.addEventListener('pointermove', e => {
    if (draggingAlpha) pickAlpha(e);
  });
  const stopAlphaDrag = e => {
    draggingAlpha = false;
    try { alphaBarWrap.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  alphaBarWrap.addEventListener('pointerup', stopAlphaDrag);
  alphaBarWrap.addEventListener('pointercancel', stopAlphaDrag);

  hexInput.addEventListener('change', () => {
    const norm = normalizeHex(hexInput.value);
    if (norm) setEditorColor(norm);
    else updateColorSwatchUI();
  });

  addSwatchBtn.addEventListener('click', () => {
    if (editor.transparent || editor.alpha <= 0.002) return;
    if (ensureColorInPalette(editor.color)) {
      markEditorDirty();
      setEditorMsg('ADDED SWATCH ' + editor.color.toUpperCase());
    }
  });

  resetPaletteBtn.addEventListener('click', () => {
    editor.palette = BASE_PALETTE.slice();
    renderPaletteSwatches();
    markEditorDirty();
    setEditorMsg('PALETTE RESET');
  });

  // Body States
  bodyStateTabs.addEventListener('click', e => {
    const btn = e.target.closest('button[data-bstate]');
    if (btn) selectBodyState(btn.dataset.bstate);
  });

  // Timeline Controls
  prevFrameBtn.addEventListener('click', () => {
    clearEditorSelection(true);
    if (isLightGlowMode()) {
      selectLightGlowCell(editor.lightGlowCell === 0 ? 1 : 0, true);
      return;
    }
    if (isBodyRigMode()) {
      if (editor.frameIdx > 0) {
        editor.frameIdx--;
      } else {
        const curStIdx = BODY_STATES.indexOf(editor.bodyState);
        const prevSt = BODY_STATES[(curStIdx - 1 + BODY_STATES.length) % BODY_STATES.length];
        editor.bodyState = prevSt;
        syncActiveFramesFromState();
        editor.frameIdx = editor.frames.length - 1;
      }
      updateBodyStateTabDots();
      updatePreviewHeaderUI();
      refreshEditorAll();
      return;
    }
    editor.frameIdx = (editor.frameIdx - 1 + editor.frames.length) % editor.frames.length;
    refreshEditorAll();
  });

  nextFrameBtn.addEventListener('click', () => {
    clearEditorSelection(true);
    if (isLightGlowMode()) {
      selectLightGlowCell(editor.lightGlowCell === 0 ? 1 : 0, true);
      return;
    }
    if (isBodyRigMode()) {
      if (editor.frameIdx < editor.frames.length - 1) {
        editor.frameIdx++;
      } else {
        const curStIdx = BODY_STATES.indexOf(editor.bodyState);
        const nextSt = BODY_STATES[(curStIdx + 1) % BODY_STATES.length];
        editor.bodyState = nextSt;
        syncActiveFramesFromState();
        editor.frameIdx = 0;
      }
      updateBodyStateTabDots();
      updatePreviewHeaderUI();
      refreshEditorAll();
      return;
    }
    editor.frameIdx = (editor.frameIdx + 1) % editor.frames.length;
    refreshEditorAll();
  });

  addFrameBtn.addEventListener('click', () => {
    clearEditorSelection(true);
    if (isLightGlowMode()) {
      setEditorMsg('LIGHT GLOW HAS 2 CELLS (19x19 + 38x38)');
      return;
    }
    editor.frames.splice(editor.frameIdx + 1, 0, createEmptyPixels(editor.size));
    editor.frameIdx++;
    refreshEditorAll();
    markEditorDirty();
  });

  dupFrameBtn.addEventListener('click', () => {
    clearEditorSelection(true);
    if (isLightGlowMode()) {
      setEditorMsg('LIGHT GLOW HAS 2 CELLS (19x19 + 38x38)');
      return;
    }
    const copy = editor.frames[editor.frameIdx].slice();
    editor.frames.splice(editor.frameIdx + 1, 0, copy);
    editor.frameIdx++;
    refreshEditorAll();
    markEditorDirty();
  });

  delFrameBtn.addEventListener('click', () => {
    clearEditorSelection(true);
    if (isLightGlowMode()) {
      pushUndo();
      editor.frames[0] = createEmptyPixels(editor.size);
      syncLightGlowBuffers();
      refreshEditorAll();
      markEditorDirty();
      return;
    }
    if (editor.frames.length <= 1) {
      pushUndo();
      editor.frames[0] = createEmptyPixels(editor.size);
    } else {
      editor.frames.splice(editor.frameIdx, 1);
      editor.frameIdx = clamp(editor.frameIdx, 0, editor.frames.length - 1);
    }
    refreshEditorAll();
    markEditorDirty();
  });

  onionBtn.addEventListener('click', () => {
    editor.onionSkin = !editor.onionSkin;
    onionBtn.classList.toggle('active', editor.onionSkin);
    drawEditorCanvas();
  });

  playAnimBtn.addEventListener('click', () => {
    editor.playing = !editor.playing;
    editor.previewAcc = 0;
    editor.previewIdx = editor.frameIdx;
    updatePreviewHeaderUI();
    renderEditorPreview();
  });

  fpsDecBtn.addEventListener('click', () => {
    setEditorActiveFps(getEditorActiveFps() - 1);
  });

  fpsIncBtn.addEventListener('click', () => {
    setEditorActiveFps(getEditorActiveFps() + 1);
  });

  previewTile1Btn.addEventListener('click', () => setEditorPreviewTileMode('1x1'));
  previewTile3Btn.addEventListener('click', () => setEditorPreviewTileMode('3x3'));

  // Import PNG, Export PNG & Clipboard Paste
  openPngBtn.addEventListener('click', () => {
    pngFileInput.value = '';
    pngFileInput.click();
  });

  pngFileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) loadImageBlob(file);
  });

  exportPngBtn.addEventListener('click', () => {
    const c = pixelsToCanvas(getCompositeFramePixels(), editor.size);
    const url = c.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    const safeName = (spriteNameInput.value || 'sprite').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'sprite';
    a.download = `${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setEditorMsg('EXPORTED PNG');
  });

  pasteBtn.addEventListener('click', async () => {
    if (editor.clipboard && editor.clipboardPreferInternal) {
      pasteEditorClipboard();
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            loadImageBlob(blob);
            return;
          }
        }
      }
    } catch (_) {
      // Fall through to internal clipboard or Ctrl+V prompt
    }
    if (editor.clipboard) {
      pasteEditorClipboard();
      return;
    }
    setEditorMsg('PRESS CTRL+V TO PASTE');
  });

  // Strip Slicer controls
  stripFrameWidthInput.addEventListener('input', () => {
    if (!editor.pendingStripImg) return;
    const w = editor.pendingStripImg.naturalWidth || editor.pendingStripImg.width;
    const h = editor.pendingStripImg.naturalHeight || editor.pendingStripImg.height;
    const fw = clamp(parseInt(stripFrameWidthInput.value, 10) || h, 1, w);
    const count = Math.max(1, Math.floor(w / fw));
    stripInfo.textContent = `STRIP ${w}x${h} (${count}F)`;
  });

  sliceStripBtn.addEventListener('click', () => {
    const img = editor.pendingStripImg;
    if (!img) return;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const fw = clamp(parseInt(stripFrameWidthInput.value, 10) || h, 1, w);
    const count = clamp(Math.floor(w / fw), 1, 64);
    const sliced = [];
    for (let i = 0; i < count; i++) {
      sliced.push(extractPixelsFromImageRect(img, i * fw, 0, fw, h, editor.size, fitPasteCheck.checked));
    }
    clearEditorSelection(false);
    pushUndo();
    if (isLightGlowMode()) {
      editor.frames = [sliced[0]];
      syncLightGlowBuffers();
    } else {
      editor.frames = sliced;
      if (isBodyRigMode()) editor.stateFrames[editor.bodyState] = sliced;
    }
    editor.frameIdx = 0;
    editor.previewIdx = 0;
    editor.pendingStripImg = null;
    stripBar.classList.remove('visible');
    rebuildPaletteFromEditorArt(editor.palette);
    refreshEditorAll();
    markEditorDirty();
    setEditorMsg(`SLICED ${count} FRAMES`);
  });

  fitStripBtn.addEventListener('click', () => {
    const img = editor.pendingStripImg;
    if (!img) return;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const extracted = extractPixelsFromImageRect(img, 0, 0, w, h, editor.size, fitPasteCheck.checked);
    editor.pendingStripImg = null;
    stripBar.classList.remove('visible');
    pastePixelsAsFloatingSelection(extracted, `FITTED ${w}x${h} (MOVE OR ESC)`);
  });

  dismissStripBtn.addEventListener('click', () => {
    editor.pendingStripImg = null;
    stripBar.classList.remove('visible');
  });
}

export function initEditorClipboardEvents() {
  /* Global clipboard copy/cut/paste handlers for cel-to-cel & Aseprite Ctrl+V */
  window.addEventListener('copy', e => {
    if (editor.writingClipboard) return;
    if (!editorModal.classList.contains('open')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const stamp = copyEditorSelection(false);
    if (stamp && e.clipboardData) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', stamp);
    }
  });

  window.addEventListener('cut', e => {
    if (editor.writingClipboard) return;
    if (!editorModal.classList.contains('open')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const stamp = copyEditorSelection(true);
    if (stamp && e.clipboardData) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', stamp);
    }
  });

  window.addEventListener('paste', e => {
    if (!editorModal.classList.contains('open')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    editor.pasteToken++;
    const cd = e.clipboardData;
    const plain = cd ? cd.getData('text/plain') : '';
    if (editor.clipboard && (editor.clipboardPreferInternal || (plain && plain.startsWith('SPRITELAB_CLIP:')))) {
      e.preventDefault();
      pasteEditorClipboard();
      return;
    }
    const items = cd && cd.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.startsWith('image/')) {
          e.preventDefault();
          const blob = items[i].getAsFile();
          if (blob) loadImageBlob(blob);
          return;
        }
      }
    }
    if (editor.clipboard) {
      e.preventDefault();
      pasteEditorClipboard();
    }
  });
}
