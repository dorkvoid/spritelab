import { SFX } from '../audio.js';
import {
  BASE_PALETTE,
  BIG_THING_MAX_HOURS,
  BIG_THING_MAX_TRANSFORM_CELLS,
  BODY_STATES,
  getTypeDef,
  inferPoseActionFromName,
  inferSurfaceSoundFromName,
  supportsPoseAction,
  supportsSurfaceSound,
  TYPE_DEFS
} from '../constants.js';
import {
  actChangeSolidSelect,
  actDelaySelect,
  actDurationSelect,
  actIntervalSelect,
  actRangeSelect,
  actSwitchModeSelect,
  addFrameBtn,
  addSwatchBtn,
  alphaBarWrap,
  backSmartFillCheck,
  bigClimbableCheck,
  bigFxSelect,
  bigGiveItemSelect,
  bigIntervalInput,
  bigIntervalUnitSelect,
  bigPlacementSelect,
  bigRepeatCheck,
  bigStartPointSelect,
  bodyStateTabs,
  brushShapeBtn,
  brushSizeBtn,
  cancelSpriteBtn,
  changingThrowIntervalSelect,
  changingThrowItemSelect,
  changingTouchSoundSelect,
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
  farbackLayerOverCheck,
  farbackMiniWrap,
  fitPasteCheck,
  fitStripBtn,
  flipHBtn,
  sceneryModal,
  flipVBtn,
  fpsDecBtn,
  fpsIncBtn,
  harmEmergeDirSelect,
  harmInFrontCheck,
  harmKnockbackCheck,
  harmMoveAxisSelect,
  harmSolidCheck,
  harmSpeedSelect,
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
  liquidHazardSelect,
  liquidThickCheck,
  mirrorXBtn,
  motionHideBodyCheck,
  motionKeywordsInput,
  motionLaunchFxCheck,
  motionParticlesSelect,
  motionPlayModeSelect,
  motionRenderModeSelect,
  nextFrameBtn,
  onionBtn,
  openCreateBtn,
  openFarbackStudioBtn,
  openPngBtn,
  pasteBtn,
  playAnimBtn,
  pngFileInput,
  poseActionSelect,
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
  surfaceSoundSelect,
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
  testChangingSoundBtn,
  testSurfaceSoundBtn,
  thingInFrontCheck,
  tpCatBar,
  tpCountBadge,
  tpDescBar,
  tpGrid,
  tpSearchClearBtn,
  tpSearchInput,
  typePickerModal,
  undoBtn,
  viewableModal
} from '../dom.js';
import { clearEditorDraft, editorHasDraftableContent, markEditorDirty, openEditorFromDraft } from './draft.js';
import { initDynamicStudioUI, updateDynamicOptionsUI } from './dynamicUI.js';
import { cancelEditorFx, initEditorFxUI, isEditorFxOpen } from './fx.js';
import {
  closeEditor,
  extractDataImageUrlFromText,
  extractPixelsFromImageRect,
  isLikelyImageFile,
  loadImageBlob,
  loadImageBlobCandidates,
  loadImageSource,
  openEditor,
  pastePixelsAsFloatingSelection,
  rankImageMime,
  readSystemClipboardIntoEditor,
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
  enforceEditorCelPolicy,
  refreshEditorAll,
  renderEditorPreview,
  setEditorSize,
  setEditorType,
  updateActOptionsUI,
  updateBackOptionsUI,
  updateBigOptionsUI,
  updateChangingOptionsUI,
  updateEnvOptionsUI,
  updateFarbackOptionsUI,
  updateHarmOptionsUI,
  updateLiquidOptionsUI,
  updateMotionOptionsUI,
  updatePreviewHeaderUI,
  updatePropOptionsUI,
  updateThingOptionsUI
} from './render.js';
import { openSceneryModal } from '../ui/scenery.js';
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
  getEditorCelPolicy,
  isBigBackFrontMode,
  isBigThingMode,
  isBodyRigMode,
  isEditorSingleCelMode,
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
  updateBodyStateTabDots,
  updateEditorSaveControls
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
import { closeOpenCustomSelect, initCustomSelects, syncCustomSelect } from '../ui/selects.js';
import { initTooltipSystem } from '../ui/tooltips.js';
import { clamp, createEmptyPixels, normalizeHex, pixelsToCanvas } from '../utils.js';
import { closeViewable, hideDialogue } from '../world.js';

const TYPE_CATEGORY_MAP = {
  SOLID: 'TERRAIN',
  SLOPE: 'TERRAIN',
  SLIDEY: 'TERRAIN',
  BOUNCY: 'TERRAIN',
  CRUMBLING: 'TERRAIN',
  MOVING: 'TERRAIN',
  CLIMBABLE: 'TERRAIN',
  PUSHING: 'TERRAIN',
  LIQUID: 'TERRAIN',
  PHYSICS: 'TERRAIN',
  ACTIVATOR: 'TERRAIN',
  TRANSPORTING: 'TERRAIN',
  BODY: 'CHARACTER',
  WEARABLE: 'CHARACTER',
  HOLDABLE: 'CHARACTER',
  MOUNTABLE: 'CHARACTER',
  HARMFUL: 'HAZARDS',
  LIGHT: 'ATMOS',
  ENVIRONMENT: 'ATMOS',
  FARBACK: 'ATMOS',
  BACK: 'PROPS',
  THING: 'PROPS',
  BIG_THING: 'PROPS',
  CHANGING: 'PROPS',
  DYNAMIC: 'PROPS',
  LIVING: 'PROPS',
  GATHERABLE: 'PROPS',
  PLACES: 'PROPS',
  VIEWABLE: 'PROPS',
  TEXTUAL: 'PROPS',
  HOLDER: 'PROPS',
  INTERACTING: 'PROPS'
};

let activeTypeCategory = 'ALL';

function setTypePickerDesc(def) {
  if (!def || !tpDescBar) return;
  const cat = TYPE_CATEGORY_MAP[def.id] || 'OBJECT';
  const subs = Array.isArray(def.subTypes) && def.subTypes.length > 0
    ? def.subTypes.join(', ')
    : def.label;
  tpDescBar.innerHTML =
    `<span class="tp-desc-ico" aria-hidden="true"><svg class="px-ico" viewBox="0 0 16 16">${def.icon}</svg></span>` +
    `<div class="tp-desc-copy">` +
    `<div class="tp-desc-head"><span class="tp-desc-title">${def.label}</span><span class="tp-desc-cat">${cat}</span><span class="tp-desc-subs">${subs}</span></div>` +
    `<div class="tp-desc-text">${def.desc}</div>` +
    `</div>`;
}

/* Spacious Categorized Creation Type Picker Modal */
export function renderTypePickerGrid(filterText = '') {
  const q = String(filterText || '').trim().toUpperCase();
  if (tpSearchClearBtn) {
    tpSearchClearBtn.classList.toggle('visible', q.length > 0);
  }
  tpGrid.innerHTML = '';

  const list = TYPE_DEFS.filter(t => {
    if (activeTypeCategory !== 'ALL' && TYPE_CATEGORY_MAP[t.id] !== activeTypeCategory) {
      return false;
    }
    if (!q) return true;
    const subs = Array.isArray(t.subTypes) ? t.subTypes.join(' ').toUpperCase() : '';
    return t.label.includes(q) || t.id.includes(q) || t.desc.toUpperCase().includes(q) || subs.includes(q);
  });

  if (tpCountBadge) {
    tpCountBadge.textContent = (q || activeTypeCategory !== 'ALL')
      ? `${list.length} / ${TYPE_DEFS.length}`
      : `${TYPE_DEFS.length} TYPES`;
  }

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tp-empty';
    empty.textContent = 'NO MATCHING CREATION TYPES';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn';
    resetBtn.textContent = 'SHOW ALL TYPES';
    resetBtn.addEventListener('click', () => {
      activeTypeCategory = 'ALL';
      tpSearchInput.value = '';
      if (tpCatBar) {
        tpCatBar.querySelectorAll('button[data-tpcat]').forEach(b => b.classList.toggle('active', b.dataset.tpcat === 'ALL'));
      }
      renderTypePickerGrid('');
    });
    empty.appendChild(resetBtn);
    tpGrid.appendChild(empty);
    return;
  }

  list.forEach(def => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const subCount = Array.isArray(def.subTypes) ? def.subTypes.length : 1;
    btn.className = 'tp-cell' + (def.id === editor.type ? ' active' : '');
    btn.innerHTML =
      `<span class="tp-cell-ico" aria-hidden="true"><svg class="px-ico" viewBox="0 0 16 16">${def.icon}</svg></span>` +
      `<span class="tp-cell-label">${def.label}</span>` +
      (subCount > 1 ? `<span class="tp-cell-subcount">${subCount}</span>` : '');
    btn.addEventListener('pointerenter', () => setTypePickerDesc(def));
    btn.addEventListener('focus', () => setTypePickerDesc(def));
    btn.addEventListener('click', () => {
      setEditorType(def.id, null, false);
      closeTypePicker();
    });
    tpGrid.appendChild(btn);
  });
}

export function openTypePicker() {
  closeOpenCustomSelect(false);
  activeTypeCategory = 'ALL';
  if (tpCatBar) {
    tpCatBar.querySelectorAll('button[data-tpcat]').forEach(b => b.classList.toggle('active', b.dataset.tpcat === 'ALL'));
  }
  tpSearchInput.value = '';
  renderTypePickerGrid('');
  setTypePickerDesc(getTypeDef(editor.type));
  typePickerModal.classList.add('open');
}

export function clearEditorCanvas() {
  if (isEditorFxOpen()) cancelEditorFx(true);
  if (editorHasSelection()) {
    deleteSelectedPixels();
    return;
  }
  const cur = editor.frames[editor.frameIdx];
  if (!cur || !cur.some(Boolean)) {
    setEditorMsg('CANVAS EMPTY');
    SFX.playError();
    return;
  }
  pushUndo();
  editor.frames[editor.frameIdx] = createEmptyPixels(editor.size);
  syncLightGlowBuffers();
  refreshEditorAll();
  markEditorDirty();
  setEditorMsg('CLEARED CANVAS');
}

export function closeTypePicker() {
  typePickerModal.classList.remove('open');
}

export function initEditorStaticUI() {
  initCustomSelects();
  initTooltipSystem();
  initEditorCanvasEvents();
  initEditorClipboardEvents();
  initDynamicStudioUI();
  tpGrid.addEventListener('pointerleave', () => {
    setTypePickerDesc(getTypeDef(editor.type));
  });
  renderHueBar();
  renderAlphaBar();
  renderSVCanvas();
  renderPaletteSwatches();

  openCreateBtn.addEventListener('click', () => openEditor(null));
  resumeDraftBtn.addEventListener('click', openEditorFromDraft);
  const draftXSvg = '<svg class="px-ico px-ico-12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="2" height="2"/><rect x="4" y="4" width="4" height="4"/><rect x="8" y="2" width="2" height="2"/><rect x="2" y="8" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/></svg>';
  discardDraftBtn.addEventListener('click', () => {
    if (discardDraftBtn.dataset.armed === '1') {
      discardDraftBtn.dataset.armed = '';
      discardDraftBtn.classList.remove('danger-confirm');
      discardDraftBtn.innerHTML = draftXSvg;
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
          discardDraftBtn.innerHTML = draftXSvg;
        }
      }, 2200);
    }
  });
  spriteNameInput.addEventListener('input', () => {
    // Smart Manyland-style auto-suggestions while typing a new sprite name (never overrides explicit user picks)
    const raw = spriteNameInput.value;
    if (!editor.soundTouched && supportsSurfaceSound(editor.type)) {
      const inferredSnd = inferSurfaceSoundFromName(raw);
      const nextSnd = inferredSnd || 'DEFAULT';
      if (editor.surfaceSound !== nextSnd) {
        editor.surfaceSound = nextSnd;
        updatePropOptionsUI();
        if (inferredSnd) setEditorMsg('AUTO SOUND: ' + inferredSnd);
      }
    }
    if (!editor.poseTouched && supportsPoseAction(editor.type)) {
      const inferredPose = inferPoseActionFromName(raw);
      const nextPose = inferredPose || 'NONE';
      if (editor.poseAction !== nextPose) {
        editor.poseAction = nextPose;
        updatePropOptionsUI();
        if (inferredPose) setEditorMsg('AUTO SEAT: ' + (inferredPose === 'LAY' ? 'LAYABLE' : 'SITTABLE'));
      }
    }
    markEditorDirty();
  });
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
  if (tpSearchClearBtn) {
    tpSearchClearBtn.addEventListener('click', () => {
      tpSearchInput.value = '';
      renderTypePickerGrid('');
      tpSearchInput.focus();
    });
  }
  if (tpCatBar) {
    tpCatBar.addEventListener('click', e => {
      const btn = e.target.closest('button[data-tpcat]');
      if (!btn) return;
      activeTypeCategory = btn.dataset.tpcat || 'ALL';
      tpCatBar.querySelectorAll('button[data-tpcat]').forEach(b => b.classList.toggle('active', b === btn));
      renderTypePickerGrid(tpSearchInput.value);
    });
  }

  editorSubTypeSelect.addEventListener('change', () => {
    const nextSub = editorSubTypeSelect.value;
    if (editor.type === 'BODY' || editor.type === 'LIGHT') {
      setEditorType(editor.type, nextSub, true);
      return;
    }
    if (editor.type === 'BIG_THING') {
      setEditorType(editor.type, nextSub, false);
      return;
    }
    editor.subType = nextSub;
    enforceEditorCelPolicy(false);
    if (editor.type === 'ENVIRONMENT') {
      updateEnvOptionsUI();
      SFX.playEnvPreview(nextSub);
    } else if (editor.type === 'CHANGING') {
      setEditorAnimMode(editor.subType === 'CHANGING ON TOUCH' ? 'TOUCH' : 'LOOP');
      updateChangingOptionsUI();
      if (editor.subType === 'SPARKLING') {
        setEditorMsg('SPARKLING: 2-CELL TWINKLE + BUILT-IN GLIMMER PARTICLES!');
      } else if (editor.subType === 'CHANGING ON TOUCH') {
        setEditorMsg('CHANGING ON TOUCH: SWITCHES TO CELL 2 WHEN TOUCHED!');
      } else if (editor.subType === 'LIVELY THING') {
        setEditorMsg('LIVELY THING: ORGANIC VARIED TIMING FOR AMBIENT SCENERY!');
      } else if (editor.subType === 'ITEM THROWER') {
        setEditorMsg('ITEM THROWER: PICKS A HOLDABLE TO THROW FOR PLAYERS TO CATCH!');
      } else {
        setEditorMsg('');
      }
    } else if (editor.type === 'HARMFUL') {
      updateHarmOptionsUI();
    } else if (editor.type === 'ACTIVATOR') {
      updateActOptionsUI();
    } else if (editor.type === 'BACK') {
      updateBackOptionsUI();
    } else if (editor.type === 'THING') {
      updateThingOptionsUI();
    } else if (editor.type === 'FARBACK') {
      updateFarbackOptionsUI();
    } else if (editor.type === 'DYNAMIC') {
      if (editor.dynamicOpts) editor.dynamicOpts.mode = nextSub;
      updateDynamicOptionsUI();
      updateEditorSaveControls();
    }
    updatePreviewHeaderUI();
    refreshEditorAll();
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

  // Liquid Options (Breathable, Thick viscous physics, Hazard damage)
  const onLiquidOptChange = () => {
    editor.liquidOpts.breathable = liquidBreathableCheck.checked;
    editor.liquidOpts.thick = liquidThickCheck.checked;
    editor.liquidOpts.hazard = liquidHazardSelect.value;
    updateLiquidOptionsUI();
    updatePreviewHeaderUI();
    markEditorDirty();
  };
  liquidBreathableCheck.addEventListener('change', onLiquidOptChange);
  liquidThickCheck.addEventListener('change', onLiquidOptChange);
  liquidHazardSelect.addEventListener('change', onLiquidOptChange);

  // Harmful Options (Strength, Emerge Dir, Patrol Axis, Speed, Solid, In Front, Knockback)
  const onHarmOptChange = () => {
    editor.harmOpts.strength = harmStrengthSelect.value;
    editor.harmOpts.emergeDir = harmEmergeDirSelect.value;
    editor.harmOpts.moveAxis = harmMoveAxisSelect.value;
    editor.harmOpts.speed = harmSpeedSelect.value;
    editor.harmOpts.solid = harmSolidCheck.checked;
    editor.harmOpts.inFront = harmInFrontCheck.checked;
    editor.harmOpts.knockback = harmKnockbackCheck.checked;
    updateHarmOptionsUI();
    updatePreviewHeaderUI();
    renderEditorPreview();
    markEditorDirty();
  };
  harmStrengthSelect.addEventListener('change', onHarmOptChange);
  harmEmergeDirSelect.addEventListener('change', onHarmOptChange);
  harmMoveAxisSelect.addEventListener('change', onHarmOptChange);
  harmSpeedSelect.addEventListener('change', onHarmOptChange);
  harmSolidCheck.addEventListener('change', onHarmOptChange);
  harmInFrontCheck.addEventListener('change', onHarmOptChange);
  harmKnockbackCheck.addEventListener('change', onHarmOptChange);

  // Back Smart-Fill Option
  if (backSmartFillCheck) {
    backSmartFillCheck.addEventListener('change', () => {
      editor.backOpts.smartFill = backSmartFillCheck.checked;
      updateBackOptionsUI();
      markEditorDirty();
    });
  }

  // Dynamic Thing Layer Placement Option (FURRY / DRIFTY / CLOTHY)
  if (thingInFrontCheck) {
    thingInFrontCheck.addEventListener('change', () => {
      editor.thingOpts.inFront = thingInFrontCheck.checked;
      updateThingOptionsUI();
      updatePreviewHeaderUI();
      markEditorDirty();
    });
  }

  // Manyland Changing Thing Option Controls (Touch Sound & Item Thrower Holdable + Interval)
  const onChangingOptChange = () => {
    if (!editor.changingOpts || typeof editor.changingOpts !== 'object') {
      editor.changingOpts = { touchSound: 'NONE', throwItemId: '', throwInterval: 2.5 };
    }
    if (changingTouchSoundSelect) editor.changingOpts.touchSound = changingTouchSoundSelect.value || 'NONE';
    if (changingThrowItemSelect) editor.changingOpts.throwItemId = changingThrowItemSelect.value || '';
    if (changingThrowIntervalSelect) {
      const iv = Number(changingThrowIntervalSelect.value);
      editor.changingOpts.throwInterval = Number.isFinite(iv) ? iv : 2.5;
    }
    updateChangingOptionsUI();
    updatePreviewHeaderUI();
    markEditorDirty();
  };
  if (changingTouchSoundSelect) {
    changingTouchSoundSelect.addEventListener('change', () => {
      onChangingOptChange();
      SFX.playChangingTouch(editor.changingOpts.touchSound);
    });
  }
  if (testChangingSoundBtn) {
    testChangingSoundBtn.addEventListener('click', () => {
      const snd = (editor.changingOpts && editor.changingOpts.touchSound) || 'NONE';
      if (snd === 'NONE') {
        SFX.playButton('soft');
        setEditorMsg('PICK A SOUND ABOVE TO PREVIEW');
      } else {
        SFX.playChangingTouch(snd);
      }
    });
  }
  if (changingThrowItemSelect) changingThrowItemSelect.addEventListener('change', onChangingOptChange);
  if (changingThrowIntervalSelect) changingThrowIntervalSelect.addEventListener('change', onChangingOptChange);

  // Manyland Big Thing Option Controls (Placement, FX, Climbable, Transforming Timer & Reward)
  const onBigOptChange = () => {
    const unit = bigIntervalUnitSelect ? bigIntervalUnitSelect.value : 'SEC';
    const maxVal = unit === 'HR'
      ? BIG_THING_MAX_HOURS
      : (unit === 'MIN' ? BIG_THING_MAX_HOURS * 60 : BIG_THING_MAX_HOURS * 3600);
    const parsedVal = bigIntervalInput ? Math.round(Number(bigIntervalInput.value)) : 3;
    const cleanVal = Number.isFinite(parsedVal) && parsedVal >= 1 ? Math.min(maxVal, parsedVal) : 1;
    editor.bigOpts.placement = bigPlacementSelect ? bigPlacementSelect.value : 'BEHIND';
    editor.bigOpts.fx = bigFxSelect ? bigFxSelect.value : 'NONE';
    editor.bigOpts.climbable = bigClimbableCheck ? bigClimbableCheck.checked : false;
    editor.bigOpts.intervalUnit = unit;
    editor.bigOpts.intervalVal = cleanVal;
    editor.bigOpts.startPoint = bigStartPointSelect ? bigStartPointSelect.value : 'CELL 1';
    editor.bigOpts.repeat = bigRepeatCheck ? bigRepeatCheck.checked : true;
    editor.bigOpts.giveItemId = bigGiveItemSelect ? bigGiveItemSelect.value : '';
    updateBigOptionsUI();
    updatePreviewHeaderUI();
    renderEditorPreview();
    markEditorDirty();
  };
  if (bigPlacementSelect) bigPlacementSelect.addEventListener('change', onBigOptChange);
  if (bigFxSelect) bigFxSelect.addEventListener('change', onBigOptChange);
  if (bigClimbableCheck) bigClimbableCheck.addEventListener('change', onBigOptChange);
  if (bigIntervalInput) bigIntervalInput.addEventListener('change', onBigOptChange);
  if (bigIntervalUnitSelect) bigIntervalUnitSelect.addEventListener('change', onBigOptChange);
  if (bigStartPointSelect) bigStartPointSelect.addEventListener('change', onBigOptChange);
  if (bigRepeatCheck) bigRepeatCheck.addEventListener('change', onBigOptChange);
  if (bigGiveItemSelect) bigGiveItemSelect.addEventListener('change', onBigOptChange);

  // Activator Machine & Logic Gate Options
  const onActOptChange = () => {
    editor.actOpts.switchMode = actSwitchModeSelect ? actSwitchModeSelect.value : 'TOGGLE';
    editor.actOpts.duration = actDurationSelect ? (Number(actDurationSelect.value) || 3) : 3;
    editor.actOpts.interval = actIntervalSelect ? (Number(actIntervalSelect.value) || 1.5) : 1.5;
    editor.actOpts.range = actRangeSelect ? (parseInt(actRangeSelect.value, 10) || 4) : 4;
    editor.actOpts.delay = actDelaySelect ? (Number(actDelaySelect.value) || 0) : 0;
    editor.actOpts.changeSolid = actChangeSolidSelect ? actChangeSolidSelect.value : 'PASSABLE';
    updateActOptionsUI();
    updatePreviewHeaderUI();
    markEditorDirty();
  };
  if (actSwitchModeSelect) actSwitchModeSelect.addEventListener('change', onActOptChange);
  if (actDurationSelect) actDurationSelect.addEventListener('change', onActOptChange);
  if (actIntervalSelect) actIntervalSelect.addEventListener('change', onActOptChange);
  if (actRangeSelect) actRangeSelect.addEventListener('change', onActOptChange);
  if (actDelaySelect) actDelaySelect.addEventListener('change', onActOptChange);
  if (actChangeSolidSelect) actChangeSolidSelect.addEventListener('change', onActOptChange);

  // Body Motion Emote & Playback Options
  const onMotionOptChange = () => {
    editor.motionOpts.renderMode = motionRenderModeSelect ? motionRenderModeSelect.value : 'REPLACE';
    editor.motionOpts.playMode = motionPlayModeSelect ? motionPlayModeSelect.value : 'HOLD';
    editor.motionOpts.keywords = motionKeywordsInput ? motionKeywordsInput.value.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    editor.motionOpts.particles = motionParticlesSelect ? motionParticlesSelect.value : 'NONE';
    editor.motionOpts.hideBody = motionHideBodyCheck ? motionHideBodyCheck.checked : false;
    editor.motionOpts.launchFx = motionLaunchFxCheck ? motionLaunchFxCheck.checked : false;
    updateMotionOptionsUI();
    renderEditorPreview();
    markEditorDirty();
  };
  if (motionRenderModeSelect) motionRenderModeSelect.addEventListener('change', onMotionOptChange);
  if (motionPlayModeSelect) motionPlayModeSelect.addEventListener('change', onMotionOptChange);
  if (motionKeywordsInput) motionKeywordsInput.addEventListener('input', onMotionOptChange);
  if (motionParticlesSelect) motionParticlesSelect.addEventListener('change', onMotionOptChange);
  if (motionHideBodyCheck) motionHideBodyCheck.addEventListener('change', onMotionOptChange);
  if (motionLaunchFxCheck) motionLaunchFxCheck.addEventListener('change', onMotionOptChange);

  // Placeable Farback Scenery Studio Launcher & Stack Toggle
  if (openFarbackStudioBtn) {
    openFarbackStudioBtn.addEventListener('click', () => openSceneryModal());
  }
  if (farbackMiniWrap) {
    farbackMiniWrap.addEventListener('click', () => openSceneryModal());
  }
  if (farbackLayerOverCheck) {
    farbackLayerOverCheck.addEventListener('change', () => {
      if (!editor.farbackOpts) editor.farbackOpts = { layers: [], layerOver: false };
      editor.farbackOpts.layerOver = farbackLayerOverCheck.checked;
      updateFarbackOptionsUI();
      markEditorDirty();
    });
  }

  // Surface Footstep Sound & Seat / Bed Posture Controls
  surfaceSoundSelect.addEventListener('change', () => {
    editor.surfaceSound = surfaceSoundSelect.value;
    editor.soundTouched = true;
    SFX.playSurfacePreview(editor.surfaceSound);
    markEditorDirty();
  });
  testSurfaceSoundBtn.addEventListener('click', () => {
    SFX.playSurfacePreview(editor.surfaceSound || 'DEFAULT');
    setEditorMsg('PREVIEW SOUND: ' + (editor.surfaceSound || 'DEFAULT'));
  });
  poseActionSelect.addEventListener('change', () => {
    editor.poseAction = poseActionSelect.value;
    editor.poseTouched = true;
    markEditorDirty();
  });

  // Manyland Light Subtype Option Controls
  setFirstPaletteBtn.addEventListener('click', () => {
    if (editor.transparent) {
      setEditorMsg('SELECT A NON-TRANSPARENT COLOR FIRST');
      SFX.playError();
      return;
    }
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

  // Linked square canvas dimension steppers (8-32px; locked on LIGHT GLOW and BIG THING)
  const stepSize = delta => {
    if (isLightGlowMode()) {
      setEditorMsg('LIGHT GLOW USES 19x19 + 38x38 CELLS');
      SFX.playError();
      return;
    }
    if (isBigThingMode()) {
      setEditorMsg('BIG THING USES 38x38 (57x57 FOR VERY BIG)');
      SFX.playError();
      return;
    }
    const prevSize = editor.size;
    setEditorSize(editor.size + delta, false);
    if (editor.size === prevSize) {
      SFX.playError();
    }
  };
  const commitSizeInput = inp => {
    if (isLightGlowMode()) {
      inp.value = String(editor.size);
      setEditorMsg('LIGHT GLOW USES 19x19 + 38x38 CELLS');
      SFX.playError();
      return;
    }
    if (isBigThingMode()) {
      inp.value = String(editor.size);
      setEditorMsg('BIG THING USES 38x38 (57x57 FOR VERY BIG)');
      SFX.playError();
      return;
    }
    const val = parseInt(inp.value, 10);
    if (Number.isFinite(val)) {
      setEditorSize(val, true);
    } else {
      inp.value = String(editor.size);
      setEditorMsg('INVALID SIZE');
      SFX.playError();
    }
  };

  sizeDecBtn.addEventListener('click', () => stepSize(-1));
  sizeIncBtn.addEventListener('click', () => stepSize(1));
  sizeDecBtn2.addEventListener('click', () => stepSize(-1));
  sizeIncBtn2.addEventListener('click', () => stepSize(1));
  sizeValInput.addEventListener('change', () => commitSizeInput(sizeValInput));
  sizeValInput2.addEventListener('change', () => commitSizeInput(sizeValInput2));

  edZoomOutBtn.addEventListener('click', () => {
    const prevZoom = editor.zoom;
    setEditorZoom(editor.zoom - (editor.zoom >= 24 ? 2 : 1));
    if (editor.zoom === prevZoom) SFX.playError();
  });
  edZoomInBtn.addEventListener('click', () => {
    const prevZoom = editor.zoom;
    setEditorZoom(editor.zoom + (editor.zoom >= 24 ? 2 : 1));
    if (editor.zoom === prevZoom) SFX.playError();
  });
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
    if (!clearEditorSelection(true, true)) {
      setEditorMsg('NO ACTIVE SELECTION');
      SFX.playError();
    }
  });

  brushSizeBtn.addEventListener('click', () => {
    const presets = [1, 2, 3, 4, 5, 6, 8];
    const next = presets.find(v => v > editor.brushSize) || 1;
    setEditorBrushSize(next, true);
  });
  brushSizeBtn.addEventListener('contextmenu', e => {
    e.preventDefault();
    setEditorBrushSize(editor.brushSize > 1 ? editor.brushSize - 1 : 8, true);
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

  clearFrameBtn.addEventListener('click', clearEditorCanvas);

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
    if (norm) {
      setEditorColor(norm);
    } else {
      updateColorSwatchUI();
      setEditorMsg('INVALID HEX COLOR');
      SFX.playError();
    }
  });

  addSwatchBtn.addEventListener('click', () => {
    if (editor.transparent || editor.alpha <= 0.002) {
      setEditorMsg('SELECT A NON-TRANSPARENT COLOR');
      SFX.playError();
      return;
    }
    if (ensureColorInPalette(editor.color)) {
      markEditorDirty();
      setEditorMsg('ADDED SWATCH ' + editor.color.toUpperCase());
    } else {
      setEditorMsg(editor.palette.length >= 64 ? 'PALETTE FULL (64 MAX)' : 'COLOR ALREADY IN PALETTE');
      SFX.playError();
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
    if (isEditorSingleCelMode()) {
      setEditorMsg(getEditorCelPolicy().reason);
      SFX.playError();
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
    if (editor.frames.length <= 1) {
      setEditorMsg('ONLY 1 CEL');
      SFX.playError();
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
    if (isEditorSingleCelMode()) {
      setEditorMsg(getEditorCelPolicy().reason);
      SFX.playError();
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
    if (editor.frames.length <= 1) {
      setEditorMsg('ONLY 1 CEL');
      SFX.playError();
      return;
    }
    editor.frameIdx = (editor.frameIdx + 1) % editor.frames.length;
    refreshEditorAll();
  });

  addFrameBtn.addEventListener('click', () => {
    clearEditorSelection(true);
    const policy = getEditorCelPolicy();
    if (policy.single || policy.mode === 'fixed' || editor.frames.length >= policy.max) {
      setEditorMsg(policy.reason || `MAX ${policy.max} CELS`);
      SFX.playError();
      return;
    }
    editor.frames.splice(editor.frameIdx + 1, 0, createEmptyPixels(editor.size));
    editor.frameIdx++;
    refreshEditorAll();
    markEditorDirty();
  });

  dupFrameBtn.addEventListener('click', () => {
    clearEditorSelection(true);
    const policy = getEditorCelPolicy();
    if (policy.single || policy.mode === 'fixed' || editor.frames.length >= policy.max) {
      setEditorMsg(policy.reason || `MAX ${policy.max} CELS`);
      SFX.playError();
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
      const cur = editor.frames[0];
      if (!cur || !cur.some(Boolean)) {
        setEditorMsg('CANVAS EMPTY');
        SFX.playError();
        return;
      }
      pushUndo();
      editor.frames[0] = createEmptyPixels(editor.size);
      syncLightGlowBuffers();
      refreshEditorAll();
      markEditorDirty();
      return;
    }
    if (isBigBackFrontMode() || editor.type === 'CHANGING') {
      const cur = editor.frames[editor.frameIdx];
      if (!cur || !cur.some(Boolean)) {
        setEditorMsg('CANVAS EMPTY');
        SFX.playError();
        return;
      }
      pushUndo();
      editor.frames[editor.frameIdx] = createEmptyPixels(editor.size);
      refreshEditorAll();
      markEditorDirty();
      setEditorMsg(
        isBigBackFrontMode()
          ? (editor.frameIdx === 1 ? 'CLEARED FRONT CELL' : 'CLEARED BACK CELL')
          : (editor.frameIdx === 1 ? 'CLEARED CELL 2' : 'CLEARED CELL 1')
      );
      return;
    }
    if (editor.frames.length <= 1) {
      const cur = editor.frames[0];
      if (!cur || !cur.some(Boolean)) {
        setEditorMsg('CANVAS EMPTY');
        SFX.playError();
        return;
      }
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

  const stepFps = delta => {
    const policy = getEditorCelPolicy();
    if (policy.single || (policy.mode === 'fixed' && !policy.animated)) {
      setEditorMsg(policy.reason || 'FPS LOCKED');
      SFX.playError();
      return;
    }
    const prevFps = getEditorActiveFps();
    setEditorActiveFps(prevFps + delta);
    if (getEditorActiveFps() === prevFps) {
      SFX.playError();
    }
  };
  fpsDecBtn.addEventListener('click', () => stepFps(-1));
  fpsIncBtn.addEventListener('click', () => stepFps(1));

  previewTile1Btn.addEventListener('click', () => setEditorPreviewTileMode('1x1'));
  previewTile3Btn.addEventListener('click', () => setEditorPreviewTileMode('3x3'));

  // Import PNG, Export PNG & Clipboard Paste
  openPngBtn.addEventListener('click', () => {
    pngFileInput.value = '';
    pngFileInput.click();
  });

  pngFileInput.addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if (file && !(await loadImageBlob(file))) {
      setEditorMsg('IMAGE LOAD FAILED');
      SFX.playError();
    }
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
    const res = await readSystemClipboardIntoEditor(true);
    if (res.handled) {
      if (res.source === 'internal') pasteEditorClipboard();
      return;
    }
    if (editor.clipboard) {
      pasteEditorClipboard();
      return;
    }
    setEditorMsg('PRESS CTRL+V OR DROP IMAGE');
    SFX.playError();
  });

  // Drag & Drop image files directly from Aseprite, Paint.NET, Desktop, or Explorer onto the Create Editor
  let dropDepth = 0;
  editorModal.addEventListener('dragenter', e => {
    if (!editorModal.classList.contains('open')) return;
    if (e.dataTransfer && (Array.from(e.dataTransfer.types || []).includes('Files') || e.dataTransfer.items?.length)) {
      e.preventDefault();
      dropDepth++;
      editorModal.classList.add('drag-over');
    }
  });
  editorModal.addEventListener('dragover', e => {
    if (!editorModal.classList.contains('open')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  editorModal.addEventListener('dragleave', () => {
    dropDepth = Math.max(0, dropDepth - 1);
    if (dropDepth === 0) editorModal.classList.remove('drag-over');
  });
  editorModal.addEventListener('drop', async e => {
    if (!editorModal.classList.contains('open')) return;
    e.preventDefault();
    dropDepth = 0;
    editorModal.classList.remove('drag-over');
    const dt = e.dataTransfer;
    if (!dt) return;

    const files = Array.from(dt.files || [])
      .filter(isLikelyImageFile)
      .sort((a, b) => rankImageMime(a.type) - rankImageMime(b.type));
    if (files.length > 0) {
      const ok = await loadImageBlobCandidates(files);
      if (!ok) {
        setEditorMsg('IMAGE LOAD FAILED');
        SFX.playError();
      }
      return;
    }
    const htmlUrl = extractDataImageUrlFromText(dt.getData('text/html') || '');
    const txtUrl = extractDataImageUrlFromText(dt.getData('text/plain') || '');
    const url = htmlUrl || txtUrl;
    if (url) {
      const ok = await loadImageSource(url);
      if (!ok) {
        setEditorMsg('IMAGE LOAD FAILED');
        SFX.playError();
      }
      return;
    }
    setEditorMsg('DROP AN IMAGE FILE');
    SFX.playError();
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
    const policy = getEditorCelPolicy();
    const maxSlice = policy.single ? 1 : policy.max;
    const count = clamp(Math.floor(w / fw), 1, maxSlice);
    const sliced = [];
    for (let i = 0; i < count; i++) {
      sliced.push(extractPixelsFromImageRect(img, i * fw, 0, fw, h, editor.size, fitPasteCheck.checked));
    }
    clearEditorSelection(false);
    pushUndo();
    if (isLightGlowMode()) {
      editor.frames = [sliced[0]];
      syncLightGlowBuffers();
    } else if (isBigBackFrontMode()) {
      while (sliced.length < 2) sliced.push(createEmptyPixels(editor.size));
      editor.frames = sliced.slice(0, 2);
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
    if (sceneryModal && sceneryModal.classList.contains('open')) return;
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
    if (sceneryModal && sceneryModal.classList.contains('open')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const stamp = copyEditorSelection(true);
    if (stamp && e.clipboardData) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', stamp);
    }
  });

  window.addEventListener('paste', async e => {
    if (!editorModal.classList.contains('open')) return;
    if (sceneryModal && sceneryModal.classList.contains('open')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const inpType = tag === 'INPUT' ? (document.activeElement.type || '').toLowerCase() : '';
    const isTextEdit = tag === 'TEXTAREA' || (tag === 'INPUT' && inpType !== 'checkbox' && inpType !== 'radio' && inpType !== 'range' && inpType !== 'button');
    if (isTextEdit) return;

    editor.pasteToken++;
    const cd = e.clipboardData;
    const plain = cd ? (cd.getData('text/plain') || '') : '';
    const html = cd ? (cd.getData('text/html') || '') : '';

    // Exact match to our own internal copy stamp -> preserve cel-to-cel alignment (ox, oy)
    if (editor.clipboard && plain && plain.trim() === editor.clipboard.stamp) {
      e.preventDefault();
      pasteEditorClipboard();
      return;
    }

    // Collect external image blobs from BOTH clipboardData.items AND clipboardData.files, prioritizing PNG/WebP (alpha-safe) over BMP!
    const candidates = [];
    if (cd && cd.items) {
      for (let i = 0; i < cd.items.length; i++) {
        const it = cd.items[i];
        if (!it) continue;
        const mime = String(it.type || '').toLowerCase();
        if (it.kind === 'file' && (mime.startsWith('image/') || !mime)) {
          const f = it.getAsFile();
          if (f && isLikelyImageFile(f)) {
            candidates.push({ file: f, rank: rankImageMime(f.type || mime) });
          }
        }
      }
    }
    if (cd && cd.files) {
      for (let i = 0; i < cd.files.length; i++) {
        const f = cd.files[i];
        if (f && isLikelyImageFile(f) && !candidates.some(c => c.file === f)) {
          candidates.push({ file: f, rank: rankImageMime(f.type) });
        }
      }
    }

    if (candidates.length > 0) {
      e.preventDefault();
      candidates.sort((a, b) => a.rank - b.rank);
      const ok = await loadImageBlobCandidates(candidates.map(c => c.file));
      if (!ok) {
        setEditorMsg('IMAGE LOAD FAILED');
        SFX.playError();
      }
      return;
    }

    // Support HTML <img> data-URI paste or base64 data:image URLs (Piskel / Pixilart / browser Copy Image)
    const dataUrl = extractDataImageUrlFromText(html) || extractDataImageUrlFromText(plain);
    if (dataUrl) {
      e.preventDefault();
      const ok = await loadImageSource(dataUrl);
      if (ok) {
        editor.clipboardPreferInternal = false;
      } else {
        setEditorMsg('IMAGE LOAD FAILED');
        SFX.playError();
      }
      return;
    }

    // Fallback to internal SPRITELAB clipboard if OS clipboard had no image
    if (editor.clipboard && (editor.clipboardPreferInternal || plain.startsWith('SPRITELAB_CLIP:'))) {
      e.preventDefault();
      pasteEditorClipboard();
      return;
    }
    if (editor.clipboard) {
      e.preventDefault();
      pasteEditorClipboard();
      return;
    }
    setEditorMsg('NOTHING TO PASTE');
    SFX.playError();
  });

  initEditorFxUI();
}
