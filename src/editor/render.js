import {
  BIG_THING_MAX_HOURS,
  BIG_THING_MAX_TRANSFORM_CELLS,
  BIG_THING_SIZE,
  BODY_STATE_COLORS,
  BODY_STATES,
  defaultActOpts,
  defaultBackOpts,
  defaultBigOpts,
  defaultDynamicOpts,
  defaultEnvOpts,
  defaultFarbackOpts,
  defaultHarmOpts,
  defaultLightOpts,
  defaultLiquidOpts,
  defaultMotionOpts,
  ENV_ATTR_DESC,
  getTypeDef,
  HARM_DAMAGE_MAP,
  isAnimatedHarmSubType,
  isDeadlyHarmSubType,
  isDynamicCompanion,
  isEmergingHarmSubType,
  isMovingHarmSubType,
  isVeryBigThingSubType,
  LIGHT_GLOW_SIZE,
  maxSizeForType,
  supportsPoseAction,
  supportsSurfaceSound,
  TILE,
  VERY_BIG_THING_SIZE
} from '../constants.js';
import {
  actAttrNote,
  actChangeSolidRow,
  actChangeSolidSelect,
  actDelayRow,
  actDelaySelect,
  actDurationRow,
  actDurationSelect,
  actIntervalRow,
  actIntervalSelect,
  actRangeRow,
  actRangeSelect,
  actSwitchModeRow,
  actSwitchModeSelect,
  addFrameBtn,
  backAttrNote,
  backSmartFillCheck,
  backSmartFillRow,
  bigAttrNote,
  bigClimbableCheck,
  bigClimbRow,
  bigFxRow,
  bigFxSelect,
  bigGiveItemSelect,
  bigIntervalInput,
  bigIntervalUnitSelect,
  bigPlacementRow,
  bigPlacementSelect,
  bigRepeatCheck,
  bigStartPointSelect,
  bigTransformWrap,
  bodyStateTabsWrap,
  celsStrip,
  delFrameBtn,
  dupFrameBtn,
  eCtx,
  edFrameCounter,
  editorActOptsWrap,
  editorBackOptsWrap,
  editorBigOptsWrap,
  editorCanvas,
  editorCustomTextInput,
  editorCustomTextLbl,
  editorCustomTextWrap,
  editorEnvOptsWrap,
  editorFarbackOptsWrap,
  editorHarmOptsWrap,
  editorLightOptsWrap,
  editorLiquidOptsWrap,
  editorMotionOptsWrap,
  editorPropOptsWrap,
  editorSubTypeSelect,
  editorTypeBtnIcon,
  editorTypeBtnLabel,
  edSizeGroup,
  envAttrNote,
  envIntensityRow,
  envIntensitySelect,
  envWindDirSelect,
  envWindOptsWrap,
  envWindStrengthSelect,
  farbackAttrNote,
  farbackLayerOverCheck,
  farbackLayerOverRow,
  farbackMiniCtx,
  farbackMiniPreview,
  farbackSummaryNote,
  fpsStepper,
  fpsValEl,
  harmAttrNote,
  harmEmergeDirRow,
  harmEmergeDirSelect,
  harmInFrontCheck,
  harmKnockbackCheck,
  harmKnockbackWrap,
  harmMoveAxisRow,
  harmMoveAxisSelect,
  harmSolidCheck,
  harmSpeedRow,
  harmSpeedSelect,
  harmStrengthRow,
  harmStrengthSelect,
  lightColorChip,
  lightColorInfoRow,
  motionAttrNote,
  motionHideBodyCheck,
  motionKeywordsInput,
  motionKeywordsRow,
  motionLaunchFxCheck,
  motionParticlesSelect,
  motionPlayModeSelect,
  motionRenderModeSelect,
  lightColorLabel,
  lightFillModeRow,
  lightFillModeSelect,
  lightGlowBehaviorSelect,
  lightGlowOptsWrap,
  lightGlowStyleSelect,
  lightPulsatingCheck,
  lightStdOptsRow,
  lightSurroundRow,
  lightSurroundSelect,
  lightThickCheck,
  lightTopNoteRow,
  liquidAttrNote,
  liquidBreathableCheck,
  liquidHazardSelect,
  liquidThickCheck,
  nextFrameBtn,
  pCtx,
  playAnimBtn,
  playAnimIco,
  poseActionRow,
  poseActionSelect,
  prevFrameBtn,
  previewCanvas,
  previewStateLabel,
  previewTypeBadge,
  sizeValInput,
  sizeValInput2,
  stripBar,
  surfaceSoundRow,
  surfaceSoundSelect
} from '../dom.js';
import { markEditorDirty } from './draft.js';
import { updateDynamicOptionsUI } from './dynamicUI.js';
import { renderPaletteSwatches } from './palette.js';
import { clearEditorSelection, getCompositeFramePixels } from './selection.js';
import { compileDynamicProgram, evaluateDynamicFrame } from '../dynamicEngine.js';
import {
  defaultSizeForType,
  editor,
  getEditorActiveFps,
  getEditorCelPolicy,
  getEditorLightColor,
  getLightGlowPreviewCanvas,
  getSymmetryPoints,
  isBigBackFrontMode,
  isBigSingleCellMode,
  isBigThingMode,
  isBigTransformingMode,
  isBodyRigMode,
  isEditorSingleCelMode,
  isLightGlowMode,
  isSymmetryActive,
  reframePixelsCentered,
  resetSymmetryCenter,
  selectLightGlowCell,
  setEditorMsg,
  syncActiveFramesFromState,
  syncLightGlowBuffers,
  updateBodyStateTabDots,
  updateEditorSaveControls
} from './state.js';
import { fitEditorZoom, getBrushOffsets, getEffectiveEditorTool, updateSymmetryUI } from './tools.js';
import { envSys } from '../environment.js';
import { drawScenerySkyBackdrop, renderFarbackPreviewToCanvas, renderSceneryComposite } from '../farback.js';
import { drawDefaultWireframe, drawLightGlowOverlay } from '../renderer.js';
import { getActiveWorld, state } from '../state.js';
import { syncCustomSelect } from '../ui/selects.js';
import { clamp, createEmptyPixels, evalEmergingHazard, getDeadlyMovingParams, hasAnyPixel, hexToRgb, pixelsToCanvas, stripHexAlpha } from '../utils.js';

export function updateLightOptionsUI() {
  const isLight = editor.type === 'LIGHT';
  editorLightOptsWrap.classList.toggle('visible', isLight);
  if (!isLight) return;

  const isGlow = isLightGlowMode();
  const lc = getEditorLightColor();
  lightColorInfoRow.style.display = isGlow ? 'none' : 'flex';
  lightColorChip.style.background = lc;
  lightColorLabel.textContent = `1ST PALETTE (${lc.toUpperCase()})`;

  lightStdOptsRow.style.display = editor.subType === 'LIGHT' ? 'flex' : 'none';
  lightTopNoteRow.style.display = editor.subType === 'TOP LIGHT' ? 'block' : 'none';
  lightFillModeRow.style.display = editor.subType === 'FILL LIGHT' ? 'flex' : 'none';
  lightSurroundRow.style.display = editor.subType === 'SURROUND LIGHT' ? 'flex' : 'none';
  lightGlowOptsWrap.style.display = isGlow ? 'flex' : 'none';

  const opts = editor.lightOpts || defaultLightOpts();
  lightPulsatingCheck.checked = Boolean(opts.pulsating);
  lightThickCheck.checked = Boolean(opts.thick);
  lightFillModeSelect.value = opts.fillMode || 'FULL SCREEN';
  lightSurroundSelect.value = opts.surroundThick || 'NORMAL';
  lightGlowBehaviorSelect.value = opts.glowBehavior || 'PULSATING';
  lightGlowStyleSelect.value = opts.glowStyle || 'TRANSLUCENT';
}

export function updateEnvOptionsUI() {
  const isEnv = editor.type === 'ENVIRONMENT';
  editorEnvOptsWrap.classList.toggle('visible', isEnv);
  if (!isEnv) return;

  const sub = editor.subType || 'RAIN';
  const isWind = sub === 'WIND';
  envAttrNote.textContent = ENV_ATTR_DESC[sub] || 'Adds weather & ambient sound to the nearby area.';
  envIntensityRow.style.display = isWind ? 'none' : 'flex';
  envWindOptsWrap.style.display = isWind ? 'flex' : 'none';

  const opts = editor.envOpts || defaultEnvOpts();
  envIntensitySelect.value = opts.intensity || 'NORMAL';
  envWindDirSelect.value = opts.windDir || 'RIGHT';
  envWindStrengthSelect.value = opts.windStrength || 'STRONG';
}

export function updateLiquidOptionsUI() {
  const isLiquid = editor.type === 'LIQUID';
  editorLiquidOptsWrap.classList.toggle('visible', isLiquid);
  if (!isLiquid) return;
  const opts = editor.liquidOpts || defaultLiquidOpts();
  liquidBreathableCheck.checked = Boolean(opts.breathable);
  liquidThickCheck.checked = Boolean(opts.thick);
  liquidHazardSelect.value = opts.hazard || 'NONE';
  if (liquidAttrNote) {
    const parts = [];
    parts.push(opts.breathable ? 'Breathable' : 'Uses air');
    if (opts.thick) parts.push('Thick');
    if (opts.hazard === 'EXTRA HARMFUL') parts.push('Lava');
    else if (opts.hazard === 'HARMFUL') parts.push('Acid');
    liquidAttrNote.textContent = parts.join(' - ');
  }
}

export function updateBigOptionsUI() {
  const isBig = editor.type === 'BIG_THING';
  if (editorBigOptsWrap) editorBigOptsWrap.classList.toggle('visible', isBig);
  if (!isBig) return;

  const sub = editor.subType || 'BIG THING';
  const isBF = sub === 'BACK + FRONT';
  const isTr = sub === 'TRANSFORMING';
  const isVery = isVeryBigThingSubType(sub);
  const opts = editor.bigOpts || defaultBigOpts();

  if (bigAttrNote) {
    if (isBF) {
      bigAttrNote.textContent = '2 cells: behind you + in front of you.';
    } else if (isTr) {
      bigAttrNote.textContent = 'Changes frames automatically on a timer.';
    } else if (isVery) {
      bigAttrNote.textContent = 'Giant 3x3 prop. Right-click to flip.';
    } else {
      bigAttrNote.textContent = 'Large 2x2 prop. Right-click to flip.';
    }
  }

  if (bigPlacementRow) bigPlacementRow.style.display = isBF ? 'none' : 'flex';
  if (bigFxRow) bigFxRow.style.display = 'flex';
  if (bigClimbRow) bigClimbRow.style.display = isBF ? 'flex' : 'none';
  if (bigTransformWrap) bigTransformWrap.style.display = isTr ? 'flex' : 'none';

  if (bigPlacementSelect) {
    bigPlacementSelect.value = opts.placement || 'BEHIND';
    syncCustomSelect(bigPlacementSelect);
  }
  if (bigFxSelect) {
    bigFxSelect.value = opts.fx || 'NONE';
    syncCustomSelect(bigFxSelect);
  }
  if (bigClimbableCheck) {
    bigClimbableCheck.checked = Boolean(opts.climbable);
  }

  if (isTr) {
    const unit = opts.intervalUnit || 'SEC';
    const maxVal = unit === 'HR'
      ? BIG_THING_MAX_HOURS
      : (unit === 'MIN' ? BIG_THING_MAX_HOURS * 60 : BIG_THING_MAX_HOURS * 3600);
    if (bigIntervalInput) {
      bigIntervalInput.max = String(maxVal);
      bigIntervalInput.value = String(opts.intervalVal || 3);
    }
    if (bigIntervalUnitSelect) {
      bigIntervalUnitSelect.value = unit;
      syncCustomSelect(bigIntervalUnitSelect);
    }
    if (bigStartPointSelect) {
      bigStartPointSelect.value = opts.startPoint || 'CELL 1';
      syncCustomSelect(bigStartPointSelect);
    }
    if (bigRepeatCheck) {
      bigRepeatCheck.checked = opts.repeat !== false;
    }
    if (bigGiveItemSelect) {
      const curGive = opts.giveItemId || '';
      bigGiveItemSelect.innerHTML = '';
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'NONE';
      bigGiveItemSelect.appendChild(noneOpt);
      const gearItems = state.sprites.filter(s => s && (s.type === 'HOLDABLE' || s.type === 'WEARABLE'));
      for (let i = 0; i < gearItems.length; i++) {
        const g = gearItems[i];
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.name} (${g.type === 'HOLDABLE' ? 'HOLD' : 'WEAR'})`;
        bigGiveItemSelect.appendChild(opt);
      }
      bigGiveItemSelect.value = gearItems.some(g => g.id === curGive) ? curGive : '';
      syncCustomSelect(bigGiveItemSelect);
    }
  }
}

export function updateBackOptionsUI() {
  const isBack = editor.type === 'BACK';
  if (editorBackOptsWrap) editorBackOptsWrap.classList.toggle('visible', isBack);
  if (!isBack) return;

  const isWalk = editor.subType === 'WALKABLE';
  const opts = editor.backOpts || defaultBackOpts();

  if (backSmartFillRow) backSmartFillRow.style.display = 'flex';
  if (backSmartFillCheck) backSmartFillCheck.checked = opts.smartFill !== false;

  if (backAttrNote) {
    backAttrNote.textContent = isWalk
      ? 'Climbable background wall (W / S).'
      : 'Background wall that smart-fills behind objects.';
  }
}

export function updateFarbackOptionsUI() {
  const isFb = editor.type === 'FARBACK';
  if (editorFarbackOptsWrap) editorFarbackOptsWrap.classList.toggle('visible', isFb);
  if (!isFb) return;

  if (!editor.farbackOpts || typeof editor.farbackOpts !== 'object') {
    editor.farbackOpts = defaultFarbackOpts();
  }
  const layers = Array.isArray(editor.farbackOpts.layers) ? editor.farbackOpts.layers : [];
  const sub = editor.subType || 'LOCAL ZONE';
  if (farbackAttrNote) {
    if (sub === 'WORLD-WIDE') {
      farbackAttrNote.textContent = 'Shows across the whole world (fades gently inside local areas).';
    } else if (sub === 'WIDE ZONE') {
      farbackAttrNote.textContent = 'Wide area backdrop - blends smoothly across a big region.';
    } else {
      farbackAttrNote.textContent = 'Local area backdrop - place a city here and a forest over there!';
    }
  }
  if (farbackLayerOverRow) {
    farbackLayerOverRow.style.display = sub === 'WORLD-WIDE' ? 'none' : 'flex';
  }
  if (farbackLayerOverCheck) {
    farbackLayerOverCheck.checked = Boolean(editor.farbackOpts.layerOver);
  }
  const paintedCount = layers.filter(l => l && l.pixels && Array.isArray(l.pixels.p) && l.pixels.p.length > 0).length;
  if (farbackSummaryNote) {
    farbackSummaryNote.textContent = paintedCount > 0
      ? `${layers.length} LAYER${layers.length === 1 ? '' : 'S'} (${paintedCount} PAINTED) | ${sub}`
      : 'NO LAYERS YET - CLICK BELOW TO PAINT';
  }
  if (farbackMiniCtx && farbackMiniPreview) {
    renderFarbackPreviewToCanvas(
      farbackMiniCtx,
      farbackMiniPreview.width,
      farbackMiniPreview.height,
      layers,
      getActiveWorld()
    );
  }
}

export function updateActOptionsUI() {
  const isAct = editor.type === 'ACTIVATOR';
  if (editorActOptsWrap) editorActOptsWrap.classList.toggle('visible', isAct);
  if (!isAct) return;

  const sub = editor.subType || 'SWITCH';
  const opts = editor.actOpts || defaultActOpts();
  const notes = {
    SWITCH: 'Click or press Space to toggle wires.',
    'PRESSURE PLATE': 'Triggers when stepped on.',
    TIMER: 'Pulses on and off automatically.',
    PROXIMITY: 'Detects nearby player or crates.',
    'NOT GATE': 'Flips a wire signal (ON / OFF).',
    'AND GATE': 'Turns ON when all inputs are ON.',
    'OR / RELAY': 'Forwards any ON wire (optional delay).',
    DOOR: 'Opens when powered by a switch.',
    PISTON: 'Pushes blocks when powered.',
    CHANGE: 'Switches frame when powered.'
  };
  if (actAttrNote) actAttrNote.textContent = notes[sub] || notes.SWITCH;

  const isSw = sub === 'SWITCH';
  const isTimedSw = isSw && opts.switchMode === 'TIMED';
  if (actSwitchModeRow) actSwitchModeRow.style.display = isSw ? 'flex' : 'none';
  if (actDurationRow) actDurationRow.style.display = isTimedSw ? 'flex' : 'none';
  if (actIntervalRow) actIntervalRow.style.display = sub === 'TIMER' ? 'flex' : 'none';
  if (actRangeRow) actRangeRow.style.display = sub === 'PROXIMITY' ? 'flex' : 'none';
  if (actDelayRow) actDelayRow.style.display = sub === 'OR / RELAY' ? 'flex' : 'none';
  if (actChangeSolidRow) actChangeSolidRow.style.display = sub === 'CHANGE' ? 'flex' : 'none';

  if (actSwitchModeSelect) {
    actSwitchModeSelect.value = opts.switchMode || 'TOGGLE';
    syncCustomSelect(actSwitchModeSelect);
  }
  if (actDurationSelect) {
    actDurationSelect.value = String(opts.duration || 3);
    syncCustomSelect(actDurationSelect);
  }
  if (actIntervalSelect) {
    actIntervalSelect.value = String(opts.interval || 1.5);
    syncCustomSelect(actIntervalSelect);
  }
  if (actRangeSelect) {
    actRangeSelect.value = String(opts.range || 4);
    syncCustomSelect(actRangeSelect);
  }
  if (actDelaySelect) {
    actDelaySelect.value = String(opts.delay || 0);
    syncCustomSelect(actDelaySelect);
  }
  if (actChangeSolidSelect) {
    actChangeSolidSelect.value = opts.changeSolid || 'PASSABLE';
    syncCustomSelect(actChangeSolidSelect);
  }
}

export function updateMotionOptionsUI() {
  const isMotion = editor.type === 'BODY' && editor.subType === 'MOTION';
  if (editorMotionOptsWrap) editorMotionOptsWrap.classList.toggle('visible', isMotion);
  if (!isMotion) return;

  const opts = editor.motionOpts || defaultMotionOpts();
  if (motionRenderModeSelect) {
    motionRenderModeSelect.value = opts.renderMode || 'REPLACE';
    syncCustomSelect(motionRenderModeSelect);
  }
  if (motionPlayModeSelect) {
    motionPlayModeSelect.value = opts.playMode || 'HOLD';
    syncCustomSelect(motionPlayModeSelect);
  }
  if (motionKeywordsRow) {
    motionKeywordsRow.style.display = opts.playMode === 'SPOKEN' ? 'flex' : 'none';
  }
  if (motionKeywordsInput && document.activeElement !== motionKeywordsInput) {
    motionKeywordsInput.value = opts.keywords || '';
  }
  if (motionParticlesSelect) {
    motionParticlesSelect.value = opts.particles || 'NONE';
    syncCustomSelect(motionParticlesSelect);
  }
  if (motionHideBodyCheck) motionHideBodyCheck.checked = Boolean(opts.hideBody);
  if (motionLaunchFxCheck) motionLaunchFxCheck.checked = Boolean(opts.launchFx);
  if (motionAttrNote) {
    if (opts.playMode === 'SPOKEN') {
      motionAttrNote.textContent = 'Plays automatically when you chat a keyword!';
    } else if (opts.renderMode === 'OVERLAY') {
      motionAttrNote.textContent = 'Draws on top of your equipped Body.';
    } else {
      motionAttrNote.textContent = 'Plays on your Body. Open Motion Bar with Down/S!';
    }
  }
}

export function updatePropOptionsUI() {
  const showSound = supportsSurfaceSound(editor.type);
  const showPose = supportsPoseAction(editor.type);
  const anyVisible = showSound || showPose;
  if (editorPropOptsWrap) editorPropOptsWrap.classList.toggle('visible', anyVisible);
  if (!anyVisible) return;
  if (surfaceSoundRow) surfaceSoundRow.style.display = showSound ? 'flex' : 'none';
  if (poseActionRow) poseActionRow.style.display = showPose ? 'flex' : 'none';
  if (showSound && surfaceSoundSelect) {
    surfaceSoundSelect.value = editor.surfaceSound || 'DEFAULT';
  }
  if (showPose && poseActionSelect) {
    poseActionSelect.value = editor.poseAction || 'NONE';
  }
}

export function updateHarmOptionsUI() {
  const isHarm = editor.type === 'HARMFUL';
  editorHarmOptsWrap.classList.toggle('visible', isHarm);
  if (!isHarm) return;
  const sub = editor.subType || 'HARMFUL';
  const isDeadly = isDeadlyHarmSubType(sub);
  const isAnim = isAnimatedHarmSubType(sub);
  const isEmerging = isEmergingHarmSubType(sub);
  const isMoving = isMovingHarmSubType(sub);
  const opts = editor.harmOpts || defaultHarmOpts();

  harmStrengthSelect.value = opts.strength || 'NORMAL';
  harmEmergeDirSelect.value = opts.emergeDir || 'UP';
  harmMoveAxisSelect.value = opts.moveAxis || 'HORIZ';
  harmSpeedSelect.value = opts.speed || 'NORMAL';
  harmSolidCheck.checked = Boolean(opts.solid);
  harmInFrontCheck.checked = Boolean(opts.inFront);
  harmKnockbackCheck.checked = opts.knockback !== false;

  harmStrengthRow.style.display = isDeadly ? 'none' : 'flex';
  harmKnockbackWrap.style.display = isDeadly ? 'none' : 'inline-flex';
  harmEmergeDirRow.style.display = isEmerging ? 'flex' : 'none';
  harmMoveAxisRow.style.display = isMoving ? 'flex' : 'none';
  harmSpeedRow.style.display = (isEmerging || isMoving) ? 'flex' : 'none';

  if (isEmerging) {
    harmAttrNote.textContent = 'Shakes, pops out, then hides again.';
  } else if (isMoving) {
    harmAttrNote.textContent = 'Patrols back and forth. Instant KO.';
  } else if (isDeadly) {
    harmAttrNote.textContent = 'Instant KO on touch.';
  } else {
    const dmg = HARM_DAMAGE_MAP[opts.strength] || 20;
    harmAttrNote.textContent = `Deals ${dmg} HP on touch.`;
  }
}

export function updatePreviewHeaderUI() {
  playAnimBtn.classList.toggle('active', editor.playing);
  playAnimIco.innerHTML = editor.playing
    ? '<rect x="3" y="2" width="2" height="8"/><rect x="7" y="2" width="2" height="8"/>'
    : '<rect x="3" y="2" width="2" height="8"/><rect x="5" y="3" width="2" height="6"/><rect x="7" y="4" width="2" height="4"/><rect x="9" y="5" width="1" height="2"/>';

  fpsValEl.textContent = String(getEditorActiveFps());
  previewTypeBadge.textContent = getTypeDef(editor.type).label;

  if (isLightGlowMode()) {
    previewStateLabel.textContent = editor.lightGlowCell === 1 ? 'CELL 2 GLOW' : 'CELL 1 BASE';
  } else if (isBodyRigMode()) {
    previewStateLabel.textContent = editor.bodyState;
  } else if (editor.type === 'LIQUID') {
    const lo = editor.liquidOpts || defaultLiquidOpts();
    const tags = [];
    if (lo.thick) tags.push('THICK');
    if (lo.hazard === 'EXTRA HARMFUL') tags.push('LAVA');
    else if (lo.hazard === 'HARMFUL') tags.push('ACID');
    else if (lo.breathable) tags.push('AIR');
    previewStateLabel.textContent = tags.length ? tags.join(' | ') : 'WATER';
  } else if (editor.type === 'HARMFUL') {
    const sub = editor.subType || 'HARMFUL';
    const opts = editor.harmOpts || defaultHarmOpts();
    const isDeadly = isDeadlyHarmSubType(sub);
    const isAnim = isAnimatedHarmSubType(sub);
    if (isEmergingHarmSubType(sub)) {
      previewStateLabel.textContent = `EMERGE ${opts.emergeDir || 'UP'} | ${opts.speed || 'NORMAL'}`;
    } else if (isMovingHarmSubType(sub)) {
      previewStateLabel.textContent = `PATROL ${opts.moveAxis || 'HORIZ'} | ${opts.speed || 'NORMAL'}`;
    } else if (isDeadly) {
      previewStateLabel.textContent = `${isAnim ? 'ANIM' : 'STATIC'} | INSTANT`;
    } else {
      const dmg = HARM_DAMAGE_MAP[opts.strength || 'NORMAL'] || 20;
      previewStateLabel.textContent = `${isAnim ? 'ANIM' : 'STATIC'} | ${dmg}HP`;
    }
  } else if (editor.type === 'BIG_THING') {
    const bo = editor.bigOpts || defaultBigOpts();
    if (isBigBackFrontMode()) {
      previewStateLabel.textContent = (editor.frameIdx === 1 ? 'CELL 2 FRONT' : 'CELL 1 BACK') + (bo.climbable ? ' | CLIMB' : '');
    } else if (isBigTransformingMode()) {
      previewStateLabel.textContent = `${bo.intervalVal || 3} ${bo.intervalUnit || 'SEC'}${bo.repeat === false ? ' ONCE' : ''}`;
    } else {
      previewStateLabel.textContent = `${editor.size}x${editor.size} | ${bo.placement === 'IN FRONT' ? 'FRONT' : 'BACK'}`;
    }
  } else if (editor.type === 'ACTIVATOR') {
    const ao = editor.actOpts || defaultActOpts();
    if (editor.subType === 'SWITCH') {
      previewStateLabel.textContent = ao.switchMode === 'TIMED' ? `TIMED ${ao.duration}S` : ao.switchMode;
    } else if (editor.subType === 'TIMER') {
      previewStateLabel.textContent = `CLOCK ${ao.interval}S`;
    } else if (editor.subType === 'PROXIMITY') {
      previewStateLabel.textContent = `SENSOR ${ao.range}T`;
    } else if (editor.subType === 'OR / RELAY') {
      previewStateLabel.textContent = ao.delay > 0 ? `DELAY ${ao.delay}S` : 'OR GATE';
    } else {
      previewStateLabel.textContent = editor.subType;
    }
  } else if (editor.type === 'LIGHT' || editor.type === 'ENVIRONMENT') {
    previewStateLabel.textContent = editor.subType;
  } else if (editor.type === 'DYNAMIC') {
    previewStateLabel.textContent = (editor.dynPreviewMarker && editor.dynPreviewMarker !== 'DEFAULT')
      ? editor.dynPreviewMarker
      : (editor.subType || 'WORLD');
  } else if (isEditorSingleCelMode()) {
    previewStateLabel.textContent = '1 CEL';
  } else {
    previewStateLabel.textContent = editor.animMode || 'LOOP';
  }

  const celPolicy = getEditorCelPolicy();
  if (fpsStepper) {
    fpsStepper.classList.toggle('locked', celPolicy.single || celPolicy.mode === 'fixed');
  }
}

export function enforceEditorCelPolicy(autoAddSecondForTransform = false) {
  const policy = getEditorCelPolicy();
  if (isLightGlowMode() || isBodyRigMode()) return;

  if (policy.single) {
    if (editor.frames.length > 1) editor.frames = [editor.frames[0]];
    if (editor.frames.length === 0) editor.frames = [createEmptyPixels(editor.size)];
    editor.frameIdx = 0;
    editor.previewIdx = 0;
    if (editor.pendingStripImg) {
      editor.pendingStripImg = null;
      if (stripBar) stripBar.classList.remove('visible');
    }
    return;
  }

  if (isBigBackFrontMode()) {
    while (editor.frames.length < 2) editor.frames.push(createEmptyPixels(editor.size));
    if (editor.frames.length > 2) editor.frames = editor.frames.slice(0, 2);
    editor.frameIdx = clamp(editor.frameIdx, 0, 1);
    return;
  }

  if (policy.mode === 'capped') {
    if (editor.frames.length > policy.max) {
      editor.frames = editor.frames.slice(0, policy.max);
    }
    if (autoAddSecondForTransform && editor.frames.length < 2) {
      editor.frames.push(createEmptyPixels(editor.size));
    }
    editor.frameIdx = clamp(editor.frameIdx, 0, Math.max(0, editor.frames.length - 1));
  }
}

function updateTimelineCelControlsUI() {
  const policy = getEditorCelPolicy();
  const addLocked = policy.single || policy.mode === 'fixed' || editor.frames.length >= policy.max;
  const navLocked = policy.single;

  if (prevFrameBtn) {
    prevFrameBtn.classList.toggle('cel-locked', navLocked);
    prevFrameBtn.dataset.tip = navLocked ? policy.reason : 'Previous frame';
  }
  if (nextFrameBtn) {
    nextFrameBtn.classList.toggle('cel-locked', navLocked);
    nextFrameBtn.dataset.tip = navLocked ? policy.reason : 'Next frame';
  }
  if (addFrameBtn) {
    addFrameBtn.classList.toggle('cel-locked', addLocked);
    addFrameBtn.dataset.tip = addLocked ? policy.reason : 'Add a new blank frame';
  }
  if (dupFrameBtn) {
    dupFrameBtn.classList.toggle('cel-locked', addLocked);
    dupFrameBtn.dataset.tip = addLocked ? policy.reason : 'Copy this frame into a new one';
  }
  if (delFrameBtn) {
    delFrameBtn.dataset.tip = (policy.single || policy.mode === 'fixed' || editor.frames.length <= 1)
      ? 'Clear this frame'
      : 'Delete this frame';
  }
}

export function setEditorSize(nextSize, refit = false) {
  if (isLightGlowMode()) {
    sizeValInput.value = String(editor.size);
    sizeValInput2.value = String(editor.size);
    if (refit) fitEditorZoom();
    else refreshEditorAll();
    return;
  }
  const maxSz = maxSizeForType(editor.type, editor.subType);
  const clamped = clamp(Math.round(Number(nextSize)) || TILE, 8, maxSz);
  const oldSize = editor.size;
  if (clamped !== oldSize) {
    clearEditorSelection(true);
    if (isBodyRigMode()) {
      for (const st of BODY_STATES) {
        const list = editor.stateFrames[st];
        if (Array.isArray(list) && list.length > 0) {
          editor.stateFrames[st] = list.map(f => reframePixelsCentered(f, oldSize, clamped));
        } else {
          editor.stateFrames[st] = [createEmptyPixels(clamped)];
        }
      }
      editor.frames = editor.stateFrames[editor.bodyState];
    } else {
      editor.frames = editor.frames.map(f => reframePixelsCentered(f, oldSize, clamped));
    }
    editor.size = clamped;
    resetSymmetryCenter();
    updateSymmetryUI();
    editor.undoStack.length = 0;
    editor.redoStack.length = 0;
    markEditorDirty();
  }
  sizeValInput.value = String(editor.size);
  sizeValInput2.value = String(editor.size);
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

export function setEditorType(typeId, subType = null, preserveSize = false) {
  clearEditorSelection(true);
  const prevType = editor.type;
  const prevSub = editor.subType;
  const wasBodyRig = prevType === 'BODY' && prevSub !== 'MOTION';
  const wasLightGlow = prevType === 'LIGHT' && prevSub === 'LIGHT GLOW';
  if (wasLightGlow) syncLightGlowBuffers();

  const def = getTypeDef(typeId);
  const nextSub = (subType && def.subTypes.includes(subType)) ? subType : def.subTypes[0];
  editor.type = def.id;
  editor.subType = nextSub;

  editorTypeBtnIcon.innerHTML = `<svg class="px-ico" viewBox="0 0 16 16">${def.icon}</svg>`;
  editorTypeBtnLabel.textContent = def.label;

  editorSubTypeSelect.innerHTML = '';
  for (const st of def.subTypes) {
    const opt = document.createElement('option');
    opt.value = st;
    opt.textContent = st;
    editorSubTypeSelect.appendChild(opt);
  }
  editorSubTypeSelect.value = nextSub;
  editorSubTypeSelect.style.display = def.subTypes.length > 1 ? '' : 'none';
  syncCustomSelect(editorSubTypeSelect);

  const nowBodyRig = isBodyRigMode();
  const nowLightGlow = isLightGlowMode();

  // Handle transitions into / out of LIGHT GLOW
  if (wasLightGlow && !nowLightGlow) {
    editor.size = TILE;
    editor.frames = [editor.baseLightPixels.slice()];
    editor.frameIdx = 0;
  } else if (!wasLightGlow && nowLightGlow) {
    const baseSrc = editor.frames[0] || createEmptyPixels(editor.size);
    editor.baseLightPixels = reframePixelsCentered(baseSrc, editor.size, TILE);
    if (!editor.glowPixels || editor.glowPixels.length !== LIGHT_GLOW_SIZE * LIGHT_GLOW_SIZE) {
      editor.glowPixels = createEmptyPixels(LIGHT_GLOW_SIZE);
    }
    editor.lightGlowCell = 0;
    editor.size = TILE;
    editor.frames = [editor.baseLightPixels];
    editor.frameIdx = 0;
  }

  // Handle transitions into / out of BODY 7-cel rig
  if (nowBodyRig && !wasBodyRig) {
    const curList = editor.frames.map(f => f.slice());
    editor.stateFrames = {};
    editor.stateFps = {};
    for (const st of BODY_STATES) {
      editor.stateFrames[st] = st === 'STAND' ? curList : [createEmptyPixels(editor.size)];
      editor.stateFps[st] = editor.fps || 6;
    }
    editor.bodyState = 'STAND';
    editor.frames = editor.stateFrames.STAND;
    editor.frameIdx = 0;
  } else if (!nowBodyRig && wasBodyRig) {
    const stand = (editor.stateFrames.STAND && editor.stateFrames.STAND.length)
      ? editor.stateFrames.STAND.map(f => f.slice())
      : [createEmptyPixels(editor.size)];
    editor.frames = stand;
    editor.frameIdx = 0;
  }

  // Always resize canvas when switching between types with different default canvas sizes
  let didRefit = false;
  if (!preserveSize && !nowLightGlow) {
    const prevDefSize = defaultSizeForType(prevType, prevSub);
    const nextDefSize = defaultSizeForType(editor.type, editor.subType);
    if (prevDefSize !== nextDefSize && editor.size !== nextDefSize) {
      setEditorSize(nextDefSize, true);
      didRefit = true;
    }
  }

  // Enforce single-cel vs multi-cel policy across all 30 creation types
  const nowBigThing = isBigThingMode();
  enforceEditorCelPolicy(!preserveSize && !editor.hydrating);

  bodyStateTabsWrap.style.display = nowBodyRig ? 'flex' : 'none';
  if (edSizeGroup) edSizeGroup.classList.toggle('locked', nowLightGlow || nowBigThing);
  editorCustomTextWrap.style.display = def.hasText ? 'block' : 'none';
  if (def.hasText) {
    editorCustomTextLbl.textContent = def.textLabel || 'TEXT';
    editorCustomTextInput.value = (editor.customText || '').replace(/\r?\n/g, ' / ');
  }
  if (!editor.hydrating && prevType !== def.id) {
    setEditorMsg('');
  }

  if (nowBodyRig) updateBodyStateTabDots();
  updateLightOptionsUI();
  updateEnvOptionsUI();
  updateLiquidOptionsUI();
  updateHarmOptionsUI();
  updateActOptionsUI();
  updateBackOptionsUI();
  updateFarbackOptionsUI();
  updateBigOptionsUI();
  updateMotionOptionsUI();
  updateDynamicOptionsUI();
  updatePropOptionsUI();
  renderPaletteSwatches();
  updatePreviewHeaderUI();
  updateEditorSaveControls();

  if (nowLightGlow) {
    selectLightGlowCell(editor.lightGlowCell, !editor.hydrating);
  } else if (wasLightGlow) {
    sizeValInput.value = String(editor.size);
    sizeValInput2.value = String(editor.size);
    if (!didRefit && !editor.hydrating) fitEditorZoom();
    else refreshEditorAll();
  } else {
    refreshEditorAll();
  }
  markEditorDirty();
}

export function drawEditorGhostPixels(pixels, alpha) {
  if (!pixels) return;
  const s = editor.size;
  const z = editor.zoom;
  eCtx.save();
  eCtx.globalAlpha = alpha;
  for (let y = 0; y < s; y++) {
    const row = y * s;
    for (let x = 0; x < s; x++) {
      const hex = pixels[row + x];
      if (hex) {
        eCtx.fillStyle = hex;
        eCtx.fillRect(x * z, y * z, z, z);
      }
    }
  }
  eCtx.restore();
}

export function drawEditorCanvas() {
  const s = editor.size;
  const z = editor.zoom;
  const w = s * z;
  const h = s * z;

  if (editorCanvas.width !== w || editorCanvas.height !== h) {
    editorCanvas.width = w;
    editorCanvas.height = h;
    editorCanvas.style.width = w + 'px';
    editorCanvas.style.height = h + 'px';
  }

  eCtx.clearRect(0, 0, w, h);

  // LIGHT GLOW Cell 2 (38x38): faint centered 19x19 base fixture guide
  if (isLightGlowMode() && editor.lightGlowCell === 1) {
    const off = Math.floor((LIGHT_GLOW_SIZE - TILE) * 0.5);
    eCtx.save();
    eCtx.globalAlpha = 0.35;
    for (let y = 0; y < TILE; y++) {
      const row = y * TILE;
      for (let x = 0; x < TILE; x++) {
        const hex = editor.baseLightPixels[row + x];
        if (hex) {
          eCtx.fillStyle = hex;
          eCtx.fillRect((x + off) * z, (y + off) * z, z, z);
        }
      }
    }
    eCtx.globalAlpha = 0.55;
    eCtx.strokeStyle = '#f28c38';
    eCtx.lineWidth = 1;
    eCtx.setLineDash([3, 3]);
    eCtx.strokeRect(off * z + 0.5, off * z + 0.5, TILE * z - 1, TILE * z - 1);
    eCtx.restore();
  }

  // BACK + FRONT Cell 2 (FRONT): always show faint Cell 1 (BACK) underlay so foreground aligns cleanly
  if (isBigBackFrontMode() && editor.frameIdx === 1 && editor.frames[0]) {
    drawEditorGhostPixels(editor.frames[0], 0.34);
  }

  // DYNAMIC layered mode: softly ghost all other cels behind active cel so multi-part contraptions & mechs align cleanly
  if (editor.type === 'DYNAMIC' && editor.frames.length > 1) {
    for (let i = 0; i < editor.frames.length; i++) {
      if (i === editor.frameIdx) continue;
      drawEditorGhostPixels(editor.frames[i], 0.24);
    }
  }

  // BLINK state always shows faint STAND underlay so user only draws changes
  if (isBodyRigMode() && editor.bodyState === 'BLINK') {
    const standBase = editor.stateFrames.STAND && editor.stateFrames.STAND[0];
    if (standBase) drawEditorGhostPixels(standBase, 0.34);
  } else if (editor.onionSkin && !isLightGlowMode() && editor.type !== 'DYNAMIC') {
    if (isBodyRigMode()) {
      if (editor.frames.length > 1) {
        const prevIdx = (editor.frameIdx - 1 + editor.frames.length) % editor.frames.length;
        drawEditorGhostPixels(editor.frames[prevIdx], 0.34);
        if (editor.frames.length >= 3) {
          const nextIdx = (editor.frameIdx + 1) % editor.frames.length;
          if (nextIdx !== prevIdx) drawEditorGhostPixels(editor.frames[nextIdx], 0.16);
        }
      } else if (editor.bodyState !== 'CLIMB' && editor.bodyState !== 'STAND') {
        const prevStateMap = { WALK: 'STAND', JUMP: 'WALK', FALL: 'JUMP', SIT: 'CLIMB' };
        const prevSt = prevStateMap[editor.bodyState];
        const prevList = prevSt && editor.stateFrames[prevSt];
        if (Array.isArray(prevList) && prevList.length > 0) {
          drawEditorGhostPixels(prevList[prevList.length - 1], 0.34);
        }
      }
    } else if (editor.frames.length > 1) {
      const prevIdx = (editor.frameIdx - 1 + editor.frames.length) % editor.frames.length;
      drawEditorGhostPixels(editor.frames[prevIdx], 0.34);
      if (editor.frames.length >= 3) {
        const nextIdx = (editor.frameIdx + 1) % editor.frames.length;
        if (nextIdx !== prevIdx) drawEditorGhostPixels(editor.frames[nextIdx], 0.16);
      }
    }
  }

  // Subtle 19px tile-grid subdivisions for 38x38 (2x2) and 57x57 (3x3) Big Thing canvases
  if (isBigThingMode() && (s === BIG_THING_SIZE || s === VERY_BIG_THING_SIZE) && z >= 4) {
    eCtx.save();
    eCtx.strokeStyle = 'rgba(242, 140, 56, 0.34)';
    eCtx.lineWidth = 1;
    eCtx.setLineDash([4, 3]);
    for (let g = TILE; g < s; g += TILE) {
      const pos = g * z + 0.5;
      eCtx.beginPath();
      eCtx.moveTo(pos, 0);
      eCtx.lineTo(pos, h);
      eCtx.moveTo(0, pos);
      eCtx.lineTo(w, pos);
      eCtx.stroke();
    }
    eCtx.restore();
  }

  // Active frame pixels (including live floating selection if present)
  const curPx = getCompositeFramePixels();
  if (curPx) {
    for (let y = 0; y < s; y++) {
      const row = y * s;
      for (let x = 0; x < s; x++) {
        const hex = curPx[row + x];
        if (hex) {
          eCtx.fillStyle = hex;
          eCtx.fillRect(x * z, y * z, z, z);
        }
      }
    }
  }

  // Pixel Grid overlay
  if (editor.showGrid && z >= 5) {
    eCtx.save();
    eCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    eCtx.lineWidth = 1;
    eCtx.beginPath();
    for (let i = 1; i < s; i++) {
      const pos = i * z + 0.5;
      eCtx.moveTo(pos, 0);
      eCtx.lineTo(pos, h);
      eCtx.moveTo(0, pos);
      eCtx.lineTo(w, pos);
    }
    eCtx.stroke();
    eCtx.restore();
  }

  // Multi-axis symmetry center guides (Horizontal, Vertical, Diagonal \, Diagonal /)
  if (isSymmetryActive()) {
    const sym = editor.symmetry;
    const ax = sym.x * z;
    const ay = sym.y * z;
    const diagSpan = Math.max(w, h) * 1.5;
    let activeCount = 0;

    eCtx.save();
    eCtx.beginPath();
    eCtx.rect(0, 0, w, h);
    eCtx.clip();
    eCtx.lineWidth = 1;
    eCtx.setLineDash([4, 3]);

    if (sym.h) {
      activeCount++;
      const gx = Math.round(ax) + 0.5;
      eCtx.strokeStyle = 'rgba(242, 140, 56, 0.82)';
      eCtx.beginPath();
      eCtx.moveTo(gx, 0);
      eCtx.lineTo(gx, h);
      eCtx.stroke();
    }
    if (sym.v) {
      activeCount++;
      const gy = Math.round(ay) + 0.5;
      eCtx.strokeStyle = 'rgba(242, 140, 56, 0.82)';
      eCtx.beginPath();
      eCtx.moveTo(0, gy);
      eCtx.lineTo(w, gy);
      eCtx.stroke();
    }
    if (sym.d1) {
      activeCount++;
      eCtx.strokeStyle = 'rgba(116, 198, 255, 0.78)';
      eCtx.beginPath();
      eCtx.moveTo(ax - diagSpan, ay - diagSpan);
      eCtx.lineTo(ax + diagSpan, ay + diagSpan);
      eCtx.stroke();
    }
    if (sym.d2) {
      activeCount++;
      eCtx.strokeStyle = 'rgba(116, 198, 255, 0.78)';
      eCtx.beginPath();
      eCtx.moveTo(ax - diagSpan, ay + diagSpan);
      eCtx.lineTo(ax + diagSpan, ay - diagSpan);
      eCtx.stroke();
    }
    if (activeCount >= 2) {
      eCtx.setLineDash([]);
      eCtx.fillStyle = '#0d0e11';
      eCtx.fillRect(Math.round(ax) - 3, Math.round(ay) - 3, 7, 7);
      eCtx.fillStyle = '#f28c38';
      eCtx.fillRect(Math.round(ax) - 2, Math.round(ay) - 2, 5, 5);
    }
    eCtx.restore();
  }

  // Dynamic Studio Pivot crosshair for active cel (shown when picking pivot or when custom pivot is set)
  if (editor.type === 'DYNAMIC' && editor.dynamicOpts) {
    const celKey = String(editor.frameIdx + 1);
    const customPv = editor.dynamicOpts.pivots && editor.dynamicOpts.pivots[celKey];
    if (editor.dynPickingPivot || customPv) {
      const pvX = (customPv ? customPv.x : s * 0.5) * z;
      const pvY = (customPv ? customPv.y : s * 0.5) * z;
      const rx = Math.round(pvX);
      const ry = Math.round(pvY);
      eCtx.save();
      eCtx.lineWidth = 1;
      eCtx.strokeStyle = '#0d0e11';
      eCtx.beginPath();
      eCtx.moveTo(rx - 7, ry + 0.5); eCtx.lineTo(rx + 8, ry + 0.5);
      eCtx.moveTo(rx + 0.5, ry - 7); eCtx.lineTo(rx + 0.5, ry + 8);
      eCtx.stroke();
      eCtx.strokeStyle = editor.dynPickingPivot ? '#ffd48c' : '#f28c38';
      eCtx.beginPath();
      eCtx.moveTo(rx - 6, ry + 0.5); eCtx.lineTo(rx + 7, ry + 0.5);
      eCtx.moveTo(rx + 0.5, ry - 6); eCtx.lineTo(rx + 0.5, ry + 7);
      eCtx.stroke();
      eCtx.fillStyle = '#0d0e11';
      eCtx.fillRect(rx - 2, ry - 2, 5, 5);
      eCtx.fillStyle = editor.dynPickingPivot ? '#ffd48c' : '#f28c38';
      eCtx.fillRect(rx - 1, ry - 1, 3, 3);
      eCtx.restore();
    }
  }

  // Active Selection Marching Ants (exact pixel perimeter)
  if (editor.selection && editor.selection.length === s * s) {
    const mask = editor.selection;
    const dashOff = -Math.floor(state.uiTime * 14) % 8;
    eCtx.save();
    eCtx.beginPath();
    for (let y = 0; y < s; y++) {
      const row = y * s;
      for (let x = 0; x < s; x++) {
        if (!mask[row + x]) continue;
        const x0 = x * z + 0.5;
        const y0 = y * z + 0.5;
        const x1 = (x + 1) * z - 0.5;
        const y1 = (y + 1) * z - 0.5;
        if (y === 0 || !mask[(y - 1) * s + x]) { eCtx.moveTo(x0, y0); eCtx.lineTo(x1, y0); }
        if (y === s - 1 || !mask[(y + 1) * s + x]) { eCtx.moveTo(x0, y1); eCtx.lineTo(x1, y1); }
        if (x === 0 || !mask[row + x - 1]) { eCtx.moveTo(x0, y0); eCtx.lineTo(x0, y1); }
        if (x === s - 1 || !mask[row + x + 1]) { eCtx.moveTo(x1, y0); eCtx.lineTo(x1, y1); }
      }
    }
    eCtx.lineWidth = 1.5;
    eCtx.strokeStyle = '#0d0e11';
    eCtx.setLineDash([]);
    eCtx.stroke();
    eCtx.strokeStyle = editor.floating ? '#f28c38' : '#ffffff';
    eCtx.setLineDash([4, 4]);
    eCtx.lineDashOffset = dashOff;
    eCtx.stroke();
    eCtx.restore();
  }

  // Live Marquee / Lasso drag preview
  if (editor.drawing && editor.activeStrokeTool === 'marquee') {
    const minX = Math.min(editor.startX, editor.selDragEndX);
    const maxX = Math.max(editor.startX, editor.selDragEndX);
    const minY = Math.min(editor.startY, editor.selDragEndY);
    const maxY = Math.max(editor.startY, editor.selDragEndY);
    const rx = minX * z;
    const ry = minY * z;
    const rw = (maxX - minX + 1) * z;
    const rh = (maxY - minY + 1) * z;
    const isSub = editor.selDragMode === 'sub';
    eCtx.save();
    eCtx.fillStyle = isSub ? 'rgba(207, 89, 89, 0.22)' : 'rgba(242, 140, 56, 0.16)';
    eCtx.fillRect(rx, ry, rw, rh);
    eCtx.strokeStyle = '#0d0e11';
    eCtx.lineWidth = 1.5;
    eCtx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
    eCtx.strokeStyle = isSub ? '#cf5959' : '#f28c38';
    eCtx.setLineDash([4, 3]);
    eCtx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
    eCtx.restore();
  } else if (editor.drawing && editor.activeStrokeTool === 'lasso' && editor.selDragPoints.length > 0) {
    const pts = editor.selDragPoints;
    const isSub = editor.selDragMode === 'sub';
    eCtx.save();
    eCtx.beginPath();
    eCtx.moveTo((pts[0].x + 0.5) * z, (pts[0].y + 0.5) * z);
    for (let i = 1; i < pts.length; i++) {
      eCtx.lineTo((pts[i].x + 0.5) * z, (pts[i].y + 0.5) * z);
    }
    if (pts.length > 2) {
      eCtx.closePath();
      eCtx.fillStyle = isSub ? 'rgba(207, 89, 89, 0.20)' : 'rgba(242, 140, 56, 0.15)';
      eCtx.fill();
    }
    eCtx.lineWidth = 1.5;
    eCtx.strokeStyle = '#0d0e11';
    eCtx.stroke();
    eCtx.strokeStyle = isSub ? '#cf5959' : '#f28c38';
    eCtx.setLineDash([4, 3]);
    eCtx.stroke();
    eCtx.restore();
  }

  // Brush footprint outline on hover or during live Ctrl+Scroll resize
  const effTool = getEffectiveEditorTool();
  const showBrushResize = editor.brushPreviewUntil > state.uiTime;
  const hasHover = editor.hoverX >= 0 && editor.hoverX < s && editor.hoverY >= 0 && editor.hoverY < s;
  const usesBrush = effTool === 'pencil' || effTool === 'eraser' || effTool === 'line';

  if ((hasHover && effTool !== 'move' && !editor.drawing) || showBrushResize) {
    const cx = hasHover ? editor.hoverX : Math.floor(s * 0.5);
    const cy = hasHover ? editor.hoverY : Math.floor(s * 0.5);
    const offsets = (usesBrush || showBrushResize)
      ? getBrushOffsets(editor.brushSize, editor.brushShape)
      : [[0, 0]];

    const cellSet = new Set();
    const cells = [];
    for (let i = 0; i < offsets.length; i++) {
      const px = cx + offsets[i][0];
      const py = cy + offsets[i][1];
      if (px >= 0 && px < s && py >= 0 && py < s) {
        cellSet.add(`${px},${py}`);
        cells.push([px, py]);
      }
    }

    if (cells.length > 0) {
      eCtx.save();
      if (showBrushResize) {
        eCtx.fillStyle = 'rgba(242, 140, 56, 0.20)';
        for (const [px, py] of cells) {
          eCtx.fillRect(px * z, py * z, z, z);
        }
      }
      eCtx.strokeStyle = effTool === 'eraser' ? '#cf5959' : '#f28c38';
      eCtx.lineWidth = 1.5;
      eCtx.beginPath();
      for (const [px, py] of cells) {
        const x0 = px * z + 0.5;
        const y0 = py * z + 0.5;
        const x1 = (px + 1) * z - 0.5;
        const y1 = (py + 1) * z - 0.5;
        if (!cellSet.has(`${px},${py - 1}`)) { eCtx.moveTo(x0, y0); eCtx.lineTo(x1, y0); }
        if (!cellSet.has(`${px},${py + 1}`)) { eCtx.moveTo(x0, y1); eCtx.lineTo(x1, y1); }
        if (!cellSet.has(`${px - 1},${py}`)) { eCtx.moveTo(x0, y0); eCtx.lineTo(x0, y1); }
        if (!cellSet.has(`${px + 1},${py}`)) { eCtx.moveTo(x1, y0); eCtx.lineTo(x1, y1); }
      }
      eCtx.stroke();
      eCtx.restore();
    }

    // Mirrored brush footprint ghosts for all active symmetry axes
    const symTool = effTool === 'pencil' || effTool === 'eraser' || effTool === 'line' || effTool === 'rect' || effTool === 'circle' || effTool === 'fill';
    if (hasHover && isSymmetryActive() && symTool && !showBrushResize) {
      const mirroredSet = new Set();
      const mirroredCells = [];
      for (let i = 0; i < offsets.length; i++) {
        const bx = cx + offsets[i][0];
        const by = cy + offsets[i][1];
        const symPts = getSymmetryPoints(bx, by, s);
        for (let j = 1; j < symPts.length; j++) {
          const mx = symPts[j][0];
          const my = symPts[j][1];
          if (mx >= 0 && mx < s && my >= 0 && my < s) {
            const mk = `${mx},${my}`;
            if (!cellSet.has(mk) && !mirroredSet.has(mk)) {
              mirroredSet.add(mk);
              mirroredCells.push([mx, my]);
            }
          }
        }
      }
      if (mirroredCells.length > 0) {
        eCtx.save();
        eCtx.strokeStyle = effTool === 'eraser' ? 'rgba(207, 89, 89, 0.58)' : 'rgba(242, 140, 56, 0.58)';
        eCtx.lineWidth = 1;
        eCtx.beginPath();
        for (const [px, py] of mirroredCells) {
          const x0 = px * z + 0.5;
          const y0 = py * z + 0.5;
          const x1 = (px + 1) * z - 0.5;
          const y1 = (py + 1) * z - 0.5;
          if (!mirroredSet.has(`${px},${py - 1}`)) { eCtx.moveTo(x0, y0); eCtx.lineTo(x1, y0); }
          if (!mirroredSet.has(`${px},${py + 1}`)) { eCtx.moveTo(x0, y1); eCtx.lineTo(x1, y1); }
          if (!mirroredSet.has(`${px - 1},${py}`)) { eCtx.moveTo(x0, y0); eCtx.lineTo(x0, y1); }
          if (!mirroredSet.has(`${px + 1},${py}`)) { eCtx.moveTo(x1, y0); eCtx.lineTo(x1, y1); }
        }
        eCtx.stroke();
        eCtx.restore();
      }
    }
  }
}

export function drawPixelsToPreview(pixels, size, dx, dy, scale, flipX = false) {
  if (!pixels) return;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const hex = pixels[row + x];
      if (!hex) continue;
      const rx = flipX ? (size - 1 - x) : x;
      pCtx.fillStyle = hex;
      pCtx.fillRect(dx + rx * scale, dy + y * scale, scale, scale);
    }
  }
}

export function renderEditorPreview() {
  // Dedicated live preview for all 5 Manyland LIGHT subtypes
  if (editor.type === 'LIGHT') {
    syncLightGlowBuffers(false);
    const outDim = 114;
    if (previewCanvas.width !== outDim || previewCanvas.height !== outDim) {
      previewCanvas.width = outDim;
      previewCanvas.height = outDim;
    }
    pCtx.imageSmoothingEnabled = false;
    pCtx.clearRect(0, 0, outDim, outDim);

    // Dark abyss backdrop inside preview
    pCtx.fillStyle = '#0d0e11';
    pCtx.fillRect(0, 0, outDim, outDim);

    const tNow = editor.playing ? state.uiTime : 0;
    const opts = editor.lightOpts || defaultLightOpts();

    if (isLightGlowMode()) {
      const scale = 3; // 38 * 3 = 114px exact integer fit
      const baseOff = Math.floor((outDim - TILE * scale) * 0.5);
      drawPixelsToPreview(editor.baseLightPixels, TILE, baseOff, baseOff, scale, false);
      const gc = getLightGlowPreviewCanvas();
      if (gc) {
        let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
        const gpx = editor.glowPixels;
        if (Array.isArray(gpx)) {
          for (let i = 0; i < gpx.length; i++) {
            if (!gpx[i]) continue;
            const c = hexToRgb(gpx[i]);
            const w = Math.max(0.05, c.a) * (0.35 + ((c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255) * 0.9);
            rSum += c.r * w; gSum += c.g * w; bSum += c.b * w; wSum += w;
          }
        }
        const haloRgb = wSum > 0.01
          ? { r: Math.round(rSum / wSum), g: Math.round(gSum / wSum), b: Math.round(bSum / wSum) }
          : hexToRgb(getEditorLightColor());
        drawLightGlowOverlay(pCtx, gc, outDim * 0.5, outDim * 0.5, LIGHT_GLOW_SIZE * scale, opts, tNow, 0, haloRgb);
      }
      return;
    }

    const rgb = hexToRgb(getEditorLightColor());
    if (editor.subType === 'LIGHT') {
      const pulse = opts.pulsating ? (0.60 + 0.40 * (0.5 + 0.5 * Math.sin(tNow * 2.1))) : 1;
      const peakA = clamp((opts.thick ? 0.72 : 0.44) * pulse, 0, 0.85);
      const ambA = clamp(peakA * 0.52, 0, 0.52);
      const grad = pCtx.createRadialGradient(outDim * 0.5, outDim * 0.5, 4, outDim * 0.5, outDim * 0.5, outDim * 0.72);
      grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${peakA})`);
      grad.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${ambA * 1.1})`);
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${ambA * 0.45})`);
      pCtx.fillStyle = grad;
      pCtx.fillRect(0, 0, outDim, outDim);
    } else if (editor.subType === 'TOP LIGHT') {
      const mixL = c => Math.min(255, Math.round(c + (255 - c) * 0.22));
      const grad = pCtx.createLinearGradient(0, 0, 0, outDim * 0.84);
      grad.addColorStop(0, `rgba(${mixL(rgb.r)}, ${mixL(rgb.g)}, ${mixL(rgb.b)}, 0.82)`);
      grad.addColorStop(0.35, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.50)`);
      grad.addColorStop(0.72, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`);
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
      pCtx.fillStyle = grad;
      pCtx.fillRect(0, 0, outDim, outDim);
    } else if (editor.subType === 'FILL LIGHT') {
      const m = opts.fillMode || 'FULL SCREEN';
      if (m === 'TOP HALF') {
        const g = pCtx.createLinearGradient(0, 0, 0, outDim * 0.62);
        g.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.86)`);
        g.addColorStop(0.75, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.78)`);
        g.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        pCtx.fillStyle = g;
        pCtx.fillRect(0, 0, outDim, Math.ceil(outDim * 0.64));
      } else if (m === 'BOTTOM HALF') {
        const g = pCtx.createLinearGradient(0, outDim * 0.38, 0, outDim);
        g.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        g.addColorStop(0.25, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.78)`);
        g.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.86)`);
        pCtx.fillStyle = g;
        pCtx.fillRect(0, Math.floor(outDim * 0.38), outDim, Math.ceil(outDim * 0.64));
      } else if (m === 'LEFT HALF') {
        const g = pCtx.createLinearGradient(0, 0, outDim * 0.62, 0);
        g.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.86)`);
        g.addColorStop(0.75, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.78)`);
        g.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        pCtx.fillStyle = g;
        pCtx.fillRect(0, 0, Math.ceil(outDim * 0.64), outDim);
      } else if (m === 'RIGHT HALF') {
        const g = pCtx.createLinearGradient(outDim * 0.38, 0, outDim, 0);
        g.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        g.addColorStop(0.25, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.78)`);
        g.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.86)`);
        pCtx.fillStyle = g;
        pCtx.fillRect(Math.floor(outDim * 0.38), 0, Math.ceil(outDim * 0.64), outDim);
      } else if (m === 'CENTER BAND') {
        const g = pCtx.createLinearGradient(0, outDim * 0.16, 0, outDim * 0.84);
        g.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        g.addColorStop(0.2, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.84)`);
        g.addColorStop(0.8, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.84)`);
        g.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        pCtx.fillStyle = g;
        pCtx.fillRect(0, Math.floor(outDim * 0.16), outDim, Math.ceil(outDim * 0.68));
      } else {
        pCtx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.84)`;
        pCtx.fillRect(0, 0, outDim, outDim);
      }
    }

    // Draw translucent placed light object centered
    const s = editor.size;
    const scale = Math.max(1, Math.floor(72 / s));
    const off = Math.floor((outDim - s * scale) * 0.5);
    pCtx.save();
    pCtx.globalAlpha = 0.52;
    drawPixelsToPreview(getCompositeFramePixels(), s, off, off, scale, false);
    pCtx.restore();

    // Surround Light vignette draws on top of the preview stage border
    if (editor.subType === 'SURROUND LIGHT') {
      const thick = opts.surroundThick || 'NORMAL';
      const innerFrac = thick === 'VERY THICK' ? 0.14 : (thick === 'THICK' ? 0.28 : 0.44);
      const edgeA = thick === 'VERY THICK' ? 0.88 : (thick === 'THICK' ? 0.78 : 0.68);
      const outerR = Math.hypot(outDim * 0.5, outDim * 0.5);
      const grad = pCtx.createRadialGradient(outDim * 0.5, outDim * 0.5, outerR * innerFrac, outDim * 0.5, outDim * 0.5, outerR);
      grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
      grad.addColorStop(0.6, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${edgeA * 0.45})`);
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${edgeA})`);
      pCtx.fillStyle = grad;
      pCtx.fillRect(0, 0, outDim, outDim);
    }
    return;
  }

  // Dedicated live parallax preview for FARBACK biome backdrop objects
  if (editor.type === 'FARBACK') {
    const outDim = 114;
    if (previewCanvas.width !== outDim || previewCanvas.height !== outDim) {
      previewCanvas.width = outDim;
      previewCanvas.height = outDim;
    }
    pCtx.imageSmoothingEnabled = false;
    const world = getActiveWorld();
    const sky = drawScenerySkyBackdrop(pCtx, outDim, outDim, world);
    const layers = (editor.farbackOpts && Array.isArray(editor.farbackOpts.layers)) ? editor.farbackOpts.layers : [];
    if (layers.length > 0) {
      renderSceneryComposite(pCtx, outDim, outDim, layers, {
        camX: state.uiTime * 44,
        camY: 0,
        zoom: 2.0,
        cx: outDim * 0.5,
        cy: outDim * 0.5,
        timeSec: state.uiTime,
        skyRgb: sky.tint,
        baseUnit: 0.62
      });
    }
    const compPx = getCompositeFramePixels();
    if (hasAnyPixel(compPx)) {
      const s = editor.size;
      const scale = Math.max(1, Math.floor(42 / s));
      const off = Math.floor((outDim - s * scale) * 0.5);
      pCtx.save();
      pCtx.globalAlpha = 0.72;
      drawPixelsToPreview(compPx, s, off, off, scale, false);
      pCtx.restore();
    }
    return;
  }

  // Dedicated live preview for all 9 Physics ENVIRONMENT attributes
  if (editor.type === 'ENVIRONMENT') {
    const outDim = 114;
    if (previewCanvas.width !== outDim || previewCanvas.height !== outDim) {
      previewCanvas.width = outDim;
      previewCanvas.height = outDim;
    }
    pCtx.imageSmoothingEnabled = false;
    pCtx.clearRect(0, 0, outDim, outDim);
    pCtx.fillStyle = '#0d0e11';
    pCtx.fillRect(0, 0, outDim, outDim);

    const tNow = editor.playing ? state.uiTime : 0;
    const sub = editor.subType || 'RAIN';
    const opts = editor.envOpts || defaultEnvOpts();

    // Backdrop attributes render behind sprite art; weather/particles render over it
    if (sub === 'STARS' || sub === 'CLOUDS') {
      envSys.drawEditorPreview(pCtx, outDim, sub, opts, tNow);
    }

    const s = editor.size;
    const scale = Math.max(1, Math.floor(64 / s));
    const off = Math.floor((outDim - s * scale) * 0.5);
    pCtx.save();
    pCtx.globalAlpha = 0.85;
    drawPixelsToPreview(getCompositeFramePixels(), s, off, off, scale, false);
    pCtx.restore();

    if (sub !== 'STARS' && sub !== 'CLOUDS') {
      envSys.drawEditorPreview(pCtx, outDim, sub, opts, tNow);
    }
    return;
  }

  // Dedicated live preview for DEADLY EMERGING (rhythm hide -> shake -> pop-out -> retract) & DEADLY MOVING (patrol glide)
  if (editor.type === 'HARMFUL' && (isEmergingHarmSubType(editor.subType) || isMovingHarmSubType(editor.subType))) {
    const outDim = 114;
    if (previewCanvas.width !== outDim || previewCanvas.height !== outDim) {
      previewCanvas.width = outDim;
      previewCanvas.height = outDim;
    }
    pCtx.imageSmoothingEnabled = false;
    pCtx.clearRect(0, 0, outDim, outDim);
    pCtx.fillStyle = '#0d0e11';
    pCtx.fillRect(0, 0, outDim, outDim);

    const s = editor.size;
    const opts = editor.harmOpts || defaultHarmOpts();
    const tNow = editor.playing ? state.uiTime : 1.5;
    const activeComposite = getCompositeFramePixels();

    if (isEmergingHarmSubType(editor.subType)) {
      const em = evalEmergingHazard(0, 0, opts, 0, tNow, false);
      const scale = Math.max(1, Math.floor(56 / s));
      const drawW = s * scale;
      const baseX = Math.floor((outDim - drawW) * 0.5);
      const baseY = Math.floor((outDim - drawW) * 0.5);

      // Subtle anchor wall strip showing where the trap emerges from
      pCtx.fillStyle = '#22262f';
      pCtx.strokeStyle = '#3a404f';
      pCtx.lineWidth = 1;
      if (em.dirY < 0) {
        pCtx.fillRect(baseX - 10, baseY + drawW, drawW + 20, 10);
        pCtx.strokeRect(baseX - 9.5, baseY + drawW + 0.5, drawW + 19, 9);
      } else if (em.dirY > 0) {
        pCtx.fillRect(baseX - 10, baseY - 10, drawW + 20, 10);
        pCtx.strokeRect(baseX - 9.5, baseY - 9.5, drawW + 19, 9);
      } else if (em.dirX < 0) {
        pCtx.fillRect(baseX + drawW, baseY - 10, 10, drawW + 20);
        pCtx.strokeRect(baseX + drawW + 0.5, baseY - 9.5, 9, drawW + 19);
      } else {
        pCtx.fillRect(baseX - 10, baseY - 10, 10, drawW + 20);
        pCtx.strokeRect(baseX - 9.5, baseY - 9.5, 9, drawW + 19);
      }

      if (editor.frames.length > 1) {
        // Multi-frame retracted -> emerged cels
        const maxIdx = editor.frames.length - 1;
        const fIdx = em.phase === 'hidden' || em.phase === 'shake'
          ? 0
          : clamp(Math.round(em.amount * maxIdx), 0, maxIdx);
        const px = fIdx === editor.frameIdx ? activeComposite : editor.frames[fIdx];
        drawPixelsToPreview(px, s, baseX + Math.round(em.shakeX * 1.5), baseY + Math.round(em.shakeY * 1.5), scale, false);
      } else if (em.amount > 0.01) {
        // Single-frame clipped sliding emerge along emergeDir
        pCtx.save();
        pCtx.beginPath();
        pCtx.rect(baseX, baseY, drawW, drawW);
        pCtx.clip();
        const slideOff = (1 - em.amount) * drawW;
        const dx = baseX - em.dirX * slideOff + Math.round(em.shakeX * 1.5);
        const dy = baseY - em.dirY * slideOff + Math.round(em.shakeY * 1.5);
        drawPixelsToPreview(activeComposite, s, dx, dy, scale, false);
        pCtx.restore();
      }

      // Phase status pill at top-left of preview
      pCtx.fillStyle = em.active ? '#cf5959' : (em.phase === 'shake' ? '#f28c38' : '#737c90');
      pCtx.fillRect(6, 6, 5, 5);
      return;
    }

    // DEADLY MOVING live horizontal/vertical patrol preview
    const mp = getDeadlyMovingParams(opts);
    const scale = Math.max(1, Math.floor(38 / s));
    const drawW = s * scale;
    const travel = Math.floor((outDim - drawW - 14) * 0.5);
    const wave = Math.sin(tNow * mp.freq);
    const isVert = opts.moveAxis === 'VERT';
    const cx = Math.floor((outDim - drawW) * 0.5) + (isVert ? 0 : Math.round(wave * travel));
    const cy = Math.floor((outDim - drawW) * 0.5) + (isVert ? Math.round(wave * travel) : 0);

    // Subtle patrol rail guide
    pCtx.strokeStyle = 'rgba(207, 89, 89, 0.28)';
    pCtx.lineWidth = 1;
    pCtx.beginPath();
    if (isVert) {
      pCtx.moveTo(outDim * 0.5, 10);
      pCtx.lineTo(outDim * 0.5, outDim - 10);
    } else {
      pCtx.moveTo(10, outDim * 0.5);
      pCtx.lineTo(outDim - 10, outDim * 0.5);
    }
    pCtx.stroke();

    let px = activeComposite;
    if (editor.frames.length > 1 && editor.playing) {
      const idx = Math.floor(tNow * getEditorActiveFps()) % editor.frames.length;
      px = idx === editor.frameIdx ? activeComposite : editor.frames[idx];
    }
    drawPixelsToPreview(px, s, cx, cy, scale, false);
    return;
  }

  if (isBigThingMode()) {
    const bo = editor.bigOpts || defaultBigOpts();
    const s = editor.size;
    const scale = Math.max(1, Math.floor(114 / s));
    const outDim = s * scale;
    if (previewCanvas.width !== outDim || previewCanvas.height !== outDim) {
      previewCanvas.width = outDim;
      previewCanvas.height = outDim;
    }
    pCtx.imageSmoothingEnabled = false;
    pCtx.clearRect(0, 0, outDim, outDim);

    const activeComposite = getCompositeFramePixels();
    const tNow = state.uiTime;
    const swayOff = bo.fx === 'SWAY' ? Math.round(Math.sin(tNow * 2.4) * Math.max(1, scale * 0.6)) : 0;
    const fadeAlpha = bo.fx === 'FADE' ? (0.68 + Math.sin(tNow * 2.2) * 0.28) : 1;

    if (bo.fx === 'GLOW') {
      const glowHex = (editor.palette && editor.palette[0]) || '#f28c38';
      const rgb = hexToRgb(glowHex);
      const pulse = 0.22 + Math.sin(tNow * 2.8) * 0.08;
      const gr = pCtx.createRadialGradient(outDim * 0.5, outDim * 0.5, 2, outDim * 0.5, outDim * 0.5, outDim * 0.52);
      gr.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${pulse})`);
      gr.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      pCtx.fillStyle = gr;
      pCtx.fillRect(0, 0, outDim, outDim);
    }

    pCtx.save();
    pCtx.globalAlpha = fadeAlpha;
    if (isBigBackFrontMode()) {
      const backPx = editor.frameIdx === 0 ? activeComposite : (editor.frames[0] || createEmptyPixels(s));
      const frontPx = editor.frameIdx === 1 ? activeComposite : (editor.frames[1] || createEmptyPixels(s));
      drawPixelsToPreview(backPx, s, swayOff, 0, scale, false);
      // Crisp mini wireframe avatar sandwiched between BACK and FRONT cells
      const pDim = Math.max(12, Math.round(TILE * scale));
      const px = Math.round((outDim - pDim) * 0.5);
      const py = Math.round(outDim - pDim);
      pCtx.save();
      pCtx.globalAlpha = 0.82;
      pCtx.translate(px, py);
      drawDefaultWireframe(pCtx, pDim, pDim, 1, false, null, false);
      pCtx.restore();
      drawPixelsToPreview(frontPx, s, swayOff, 0, scale, false);
    } else {
      let framePx = activeComposite;
      if (isBigTransformingMode() && editor.frames.length > 1 && editor.playing) {
        const idx = editor.previewIdx % editor.frames.length;
        framePx = idx === editor.frameIdx ? activeComposite : editor.frames[idx];
      }
      drawPixelsToPreview(framePx, s, swayOff, 0, scale, false);
    }
    pCtx.restore();

    if (bo.fx === 'SPARKLE') {
      pCtx.save();
      for (let i = 0; i < 4; i++) {
        const ph = (tNow * 1.6 + i * 0.43) % 1;
        const sa = Math.sin(ph * Math.PI);
        if (sa <= 0.05) continue;
        const sx = Math.round((0.18 + ((i * 0.27 + Math.floor(tNow * 1.6 + i * 0.43) * 0.19) % 0.64)) * outDim);
        const sy = Math.round((0.18 + ((i * 0.37 + Math.floor(tNow * 1.6 + i * 0.43) * 0.29) % 0.64)) * outDim);
        pCtx.globalAlpha = sa * 0.9;
        pCtx.fillStyle = i % 2 === 0 ? '#ffffff' : '#ffe39f';
        pCtx.fillRect(sx, sy, Math.max(2, scale), Math.max(2, scale));
      }
      pCtx.restore();
    }
    return;
  }

  if (editor.type === 'DYNAMIC') {
    const outDim = 114;
    if (previewCanvas.width !== outDim || previewCanvas.height !== outDim) {
      previewCanvas.width = outDim;
      previewCanvas.height = outDim;
    }
    pCtx.imageSmoothingEnabled = false;
    pCtx.clearRect(0, 0, outDim, outDim);
    pCtx.fillStyle = '#0d0e11';
    pCtx.fillRect(0, 0, outDim, outDim);

    // Subtle floor guide line
    pCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    pCtx.fillRect(8, outDim - 14, outDim - 16, 1);

    const s = editor.size;
    const opts = editor.dynamicOpts || defaultDynamicOpts(editor.subType);
    const prog = compileDynamicProgram(opts.script || '');
    const marker = editor.dynPreviewMarker || 'DEFAULT';
    const tNow = editor.playing ? state.uiTime : 0;
    const evalRes = evaluateDynamicFrame(prog, marker, tNow, editor.frames.length, s, opts.pivots, {
      name: 'Player',
      area: 'Preview'
    });

    const fitScale = Math.min(3, Math.max(1, Math.floor(84 / Math.max(19, s))));
    const drawDim = s * fitScale;
    const footCx = outDim * 0.5;
    const footY = outDim - 14;
    const activeComposite = getCompositeFramePixels();

    // Optional ghost of equipped Body for ATTACHABLE companion alignment
    const showBodyGhost = editor.subType === 'ATTACHABLE';
    const eqBody = showBodyGhost && state.equippedBodyId
      ? state.sprites.find(sp => sp.id === state.equippedBodyId)
      : null;
    const drawBodyGhost = () => {
      if (!showBodyGhost) return;
      pCtx.save();
      pCtx.globalAlpha = 0.34;
      if (eqBody && eqBody._canvases && eqBody._canvases[0]) {
        const bDim = eqBody.size * fitScale;
        pCtx.drawImage(eqBody._canvases[0], Math.round(footCx - bDim * 0.5), Math.round(footY - bDim), bDim, bDim);
      } else {
        const wDim = TILE * fitScale;
        pCtx.translate(Math.round(footCx - wDim * 0.5), Math.round(footY - wDim));
        drawDefaultWireframe(pCtx, wDim, wDim, 1, false, null, false);
      }
      pCtx.restore();
    };

    if (showBodyGhost && !opts.behind) drawBodyGhost();

    for (let i = 0; i < evalRes.cels.length; i++) {
      const cState = evalRes.cels[i];
      if (!cState || (cState.opacity <= 0.004 && !cState.text && !cState.light)) continue;
      const pxArr = cState.idx === editor.frameIdx ? activeComposite : editor.frames[cState.idx];
      const hasArt = cState.opacity > 0.004 && pxArr && hasAnyPixel(pxArr);
      if (!hasArt && !cState.text && !cState.light) continue;

      const pvX = cState.pivotX * fitScale;
      const pvY = cState.pivotY * fitScale;
      const baseLeft = footCx - drawDim * 0.5;
      const baseTop = footY - drawDim;

      pCtx.save();
      pCtx.imageSmoothingEnabled = false;
      pCtx.globalAlpha = clamp(cState.opacity > 0.004 ? cState.opacity : 1, 0, 1);
      if (cState.bright) pCtx.globalCompositeOperation = 'lighter';
      pCtx.translate(baseLeft + pvX + cState.x * fitScale, baseTop + pvY + cState.y * fitScale);
      if (Math.abs(cState.rot) > 0.01) pCtx.rotate((cState.rot * Math.PI) / 180);
      const sx = (cState.flipH ? -1 : 1) * cState.scale;
      const sy = (cState.flipV ? -1 : 1) * cState.scale;
      if (Math.abs(sx - 1) > 0.002 || Math.abs(sy - 1) > 0.002) pCtx.scale(sx, sy);

      if (cState.light) {
        const lr = Array.isArray(cState.light) ? cState.light[0] : (cState.light.r ?? 255);
        const lg = Array.isArray(cState.light) ? cState.light[1] : (cState.light.g ?? 226);
        const lb = Array.isArray(cState.light) ? cState.light[2] : (cState.light.b ?? 160);
        const glowRad = Math.max(12, drawDim * 0.58);
        const g = pCtx.createRadialGradient(0, 0, 1, 0, 0, glowRad);
        g.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0.45)`);
        g.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0)`);
        pCtx.fillStyle = g;
        pCtx.fillRect(-glowRad, -glowRad, glowRad * 2, glowRad * 2);
      }

      if (hasArt) {
        const cCanvas = pixelsToCanvas(pxArr, s);
        pCtx.drawImage(cCanvas, -pvX, -pvY, drawDim, drawDim);
      }

      if (cState.text) {
        const fnt = String(cState.font || 'white').toLowerCase();
        const isBlack = fnt.includes('black');
        pCtx.font = '16px "Pixellari", monospace';
        pCtx.textAlign = cState.align === 'left' ? 'left' : (cState.align === 'right' ? 'right' : 'center');
        pCtx.textBaseline = 'middle';
        pCtx.fillStyle = isBlack ? '#0d0e11' : '#f4eee6';
        pCtx.fillText(cState.text, 0, 0);
      }
      pCtx.restore();
    }

    if (showBodyGhost && opts.behind) drawBodyGhost();

    if (evalRes.activeSay && evalRes.activeSay.text) {
      pCtx.save();
      pCtx.font = '16px "Pixellari", monospace';
      pCtx.textAlign = 'center';
      pCtx.textBaseline = 'top';
      pCtx.fillStyle = 'rgba(13, 14, 17, 0.88)';
      pCtx.fillRect(4, 3, outDim - 8, 19);
      pCtx.strokeStyle = '#e8dfd4';
      pCtx.strokeRect(4.5, 3.5, outDim - 9, 18);
      pCtx.fillStyle = '#ffd48c';
      pCtx.fillText(evalRes.activeSay.text.slice(0, 12), outDim * 0.5, 4);
      pCtx.restore();
    }
    return;
  }

  const s = editor.size;
  const tileCount = editor.previewTileMode === '3x3' ? 3 : 1;
  const rawSpan = s * tileCount;
  const scale = Math.max(1, Math.floor(114 / rawSpan));
  const outDim = rawSpan * scale;
  if (previewCanvas.width !== outDim || previewCanvas.height !== outDim) {
    previewCanvas.width = outDim;
    previewCanvas.height = outDim;
  }
  pCtx.imageSmoothingEnabled = false;
  pCtx.clearRect(0, 0, outDim, outDim);

  const activeComposite = getCompositeFramePixels();
  let basePixels = activeComposite;
  let overlayPixels = null;
  let flipX = false;

  if (isBodyRigMode()) {
    const list = editor.frames;
    const standList = editor.stateFrames.STAND || [createEmptyPixels(s)];
    const standPx = (editor.bodyState === 'STAND' && editor.frameIdx === 0) ? activeComposite : standList[0];

    if (editor.bodyState === 'BLINK') {
      basePixels = standPx;
      const bIdx = editor.playing ? (editor.previewIdx % list.length) : editor.frameIdx;
      const blinkPx = bIdx === editor.frameIdx ? activeComposite : list[bIdx];
      const showBlink = !editor.playing || (editor.previewTick % 4 === 0);
      overlayPixels = showBlink ? blinkPx : null;
    } else if (editor.bodyState === 'WALK' && list.length === 1 && editor.playing) {
      basePixels = (editor.previewTick % 2 === 0) ? activeComposite : standPx;
    } else if (editor.bodyState === 'CLIMB' && list.length === 1 && editor.playing) {
      basePixels = activeComposite;
      flipX = (editor.previewTick % 2 === 1);
    } else if (list.length > 1 && editor.playing) {
      const idx = editor.previewIdx % list.length;
      basePixels = idx === editor.frameIdx ? activeComposite : list[idx];
    }
  } else if (!isEditorSingleCelMode() && editor.frames.length > 1 && editor.playing) {
    let idx = editor.previewIdx % editor.frames.length;
    if (editor.animMode === 'PING-PONG') {
      const span = editor.frames.length * 2 - 2;
      const step = editor.previewTick % span;
      idx = step < editor.frames.length ? step : span - step;
    }
    basePixels = idx === editor.frameIdx ? activeComposite : editor.frames[idx];
  }

  // When authoring an OVERLAY Motion, draw the user's equipped Body STAND cel behind it for crisp alignment
  if (editor.type === 'BODY' && editor.subType === 'MOTION' && editor.motionOpts && editor.motionOpts.renderMode === 'OVERLAY' && tileCount === 1) {
    const eqBody = state.equippedBodyId ? state.sprites.find(sp => sp.id === state.equippedBodyId) : null;
    if (eqBody && eqBody._canvases && eqBody._canvases[0] && !editor.motionOpts.hideBody) {
      pCtx.save();
      pCtx.globalAlpha = 0.55;
      pCtx.drawImage(eqBody._canvases[0], 0, 0, outDim, outDim);
      pCtx.restore();
    }
  }

  for (let ty = 0; ty < tileCount; ty++) {
    for (let tx = 0; tx < tileCount; tx++) {
      drawPixelsToPreview(basePixels, s, tx * s * scale, ty * s * scale, scale, flipX);
      if (overlayPixels) {
        drawPixelsToPreview(overlayPixels, s, tx * s * scale, ty * s * scale, scale, flipX);
      }
    }
  }
}

export function renderCelsStrip() {
  celsStrip.innerHTML = '';
  const s = editor.size;

  updateTimelineCelControlsUI();

  if (edFrameCounter) {
    if (isLightGlowMode()) {
      edFrameCounter.textContent = editor.lightGlowCell === 1 ? 'GLOW 2/2' : 'BASE 1/2';
    } else if (isBigBackFrontMode()) {
      edFrameCounter.textContent = editor.frameIdx === 1 ? 'FRONT 2/2' : 'BACK 1/2';
    } else if (isBigTransformingMode()) {
      edFrameCounter.textContent = `CELL ${editor.frameIdx + 1}/${editor.frames.length} (MAX ${BIG_THING_MAX_TRANSFORM_CELLS})`;
    } else if (isBigSingleCellMode()) {
      edFrameCounter.textContent = `${editor.size}x${editor.size} | 1 CEL`;
    } else if (isBodyRigMode()) {
      edFrameCounter.textContent = `${editor.bodyState} ${editor.frameIdx + 1}/${editor.frames.length}`;
    } else if (editor.type === 'DYNAMIC') {
      edFrameCounter.textContent = `CEL ${editor.frameIdx + 1}/${editor.frames.length}`;
    } else if (isEditorSingleCelMode()) {
      edFrameCounter.textContent = '1 CEL';
    } else {
      edFrameCounter.textContent = `F ${editor.frameIdx + 1}/${editor.frames.length}`;
    }
  }

  if (isLightGlowMode()) {
    syncLightGlowBuffers();
    const glowCells = [
      { idx: 0, label: '19x19', barColor: '#3e6fc9', pixels: editor.baseLightPixels, dim: TILE },
      { idx: 1, label: '38x38', barColor: '#d4822e', pixels: editor.glowPixels, dim: LIGHT_GLOW_SIZE }
    ];
    for (const gc of glowCells) {
      const item = document.createElement('div');
      item.className = 'cel-item' + (editor.lightGlowCell === gc.idx ? ' active' : '');

      const head = document.createElement('div');
      head.className = 'cel-head';
      head.innerHTML = `<span>${gc.idx + 1}</span><span>${gc.idx === 0 ? 'BASE' : 'GLOW'}</span>`;

      const bar = document.createElement('div');
      bar.className = 'cel-state-bar';
      bar.style.background = gc.barColor;
      bar.textContent = gc.label;

      const art = document.createElement('div');
      art.className = 'cel-art';
      art.appendChild(pixelsToCanvas(gc.pixels, gc.dim));

      item.appendChild(head);
      item.appendChild(bar);
      item.appendChild(art);
      item.addEventListener('click', () => selectLightGlowCell(gc.idx, true));
      celsStrip.appendChild(item);
    }
    return;
  }

  if (isBigBackFrontMode()) {
    const bfCells = [
      { idx: 0, title: 'BACK', label: 'BEHIND', barColor: '#3e6fc9' },
      { idx: 1, title: 'FRONT', label: 'IN FRONT', barColor: '#d4822e' }
    ];
    for (const bc of bfCells) {
      const item = document.createElement('div');
      item.className = 'cel-item' + (editor.frameIdx === bc.idx ? ' active' : '');

      const head = document.createElement('div');
      head.className = 'cel-head';
      head.innerHTML = `<span>${bc.idx + 1}</span><span>${bc.title}</span>`;

      const bar = document.createElement('div');
      bar.className = 'cel-state-bar';
      bar.style.background = bc.barColor;
      bar.textContent = bc.label;

      const art = document.createElement('div');
      art.className = 'cel-art';
      const celPx = editor.frameIdx === bc.idx
        ? getCompositeFramePixels(editor.frames[bc.idx] || createEmptyPixels(s))
        : (editor.frames[bc.idx] || createEmptyPixels(s));
      art.appendChild(pixelsToCanvas(celPx, s));

      item.appendChild(head);
      item.appendChild(bar);
      item.appendChild(art);
      item.addEventListener('click', () => {
        clearEditorSelection(true);
        editor.frameIdx = bc.idx;
        editor.previewIdx = bc.idx;
        updatePreviewHeaderUI();
        refreshEditorAll();
      });
      celsStrip.appendChild(item);
    }
    return;
  }

  if (isBodyRigMode()) {
    let slotNum = 1;
    for (const st of BODY_STATES) {
      const list = editor.stateFrames[st] && editor.stateFrames[st].length
        ? editor.stateFrames[st]
        : [createEmptyPixels(s)];
      for (let fi = 0; fi < list.length; fi++) {
        const isAct = st === editor.bodyState && fi === editor.frameIdx;
        const item = document.createElement('div');
        item.className = 'cel-item' + (isAct ? ' active' : '');

        const head = document.createElement('div');
        head.className = 'cel-head';
        head.innerHTML = `<span>${slotNum++}</span><span>${list.length > 1 ? (fi + 1) : ''}</span>`;

        const bar = document.createElement('div');
        bar.className = 'cel-state-bar';
        bar.style.background = BODY_STATE_COLORS[st] || '#3e6fc9';
        bar.textContent = st;

        const art = document.createElement('div');
        art.className = 'cel-art';
        const celPx = isAct ? getCompositeFramePixels(list[fi]) : list[fi];
        const c = pixelsToCanvas(celPx, s);
        art.appendChild(c);

        item.appendChild(head);
        item.appendChild(bar);
        item.appendChild(art);

        item.addEventListener('click', () => {
          clearEditorSelection(true);
          editor.bodyState = st;
          syncActiveFramesFromState();
          editor.frameIdx = fi;
          editor.previewIdx = fi;
          editor.previewAcc = 0;
          editor.previewTick = 0;
          updateBodyStateTabDots();
          updatePreviewHeaderUI();
          refreshEditorAll();
        });
        celsStrip.appendChild(item);
      }
    }
    return;
  }

  for (let i = 0; i < editor.frames.length; i++) {
    const item = document.createElement('div');
    item.className = 'cel-item' + (i === editor.frameIdx ? ' active' : '');

    const head = document.createElement('div');
    head.className = 'cel-head';
    head.textContent = String(i + 1);

    const art = document.createElement('div');
    art.className = 'cel-art';
    const celPx = i === editor.frameIdx ? getCompositeFramePixels(editor.frames[i]) : editor.frames[i];
    const c = pixelsToCanvas(celPx, s);
    art.appendChild(c);

    item.appendChild(head);
    item.appendChild(art);

    item.addEventListener('click', () => {
      clearEditorSelection(true);
      editor.frameIdx = i;
      editor.previewIdx = i;
      refreshEditorAll();
    });
    celsStrip.appendChild(item);
  }
  if (editor.type === 'DYNAMIC') {
    updateDynamicOptionsUI();
  }
}

export function refreshEditorAll() {
  if (isLightGlowMode()) editor.glowPreviewDirty = true;
  if (isBodyRigMode()) updateBodyStateTabDots();
  drawEditorCanvas();
  renderEditorPreview();
  renderCelsStrip();
}
