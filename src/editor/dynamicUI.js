import { SFX } from '../audio.js';
import { defaultDynamicOpts, DYNAMIC_MAX_CELS, isDynamicCompanion, TILE } from '../constants.js';
import {
  closeDynStudioBtn,
  closeDynStudioX,
  closeTextStudioBtn,
  closeTextStudioX,
  dynActCelSelect,
  dynActionableCheck,
  dynActionWrap,
  dynActEndInput,
  dynActKindSelect,
  dynActStartInput,
  dynActValField,
  dynActValInput,
  dynActValLbl,
  dynAddActionBtn,
  dynAttrNote,
  dynBehindCheck,
  dynCodeChips,
  dynCodePane,
  dynInspectorPivotBtn,
  dynInspectorPivotReadout,
  dynInspectorSummary,
  dynLoopSecInput,
  dynMarkerPills,
  dynMarkerRow,
  dynMarkerSelect,
  dynPickPivotBtn,
  dynPivotBotBtn,
  dynPivotCtrBtn,
  dynPivotReadout,
  dynPivotTopBtn,
  dynRecipeGrid,
  dynReplacesCheck,
  dynScriptInput,
  dynScriptStatus,
  dynSizePresetGroup,
  dynStartsOnTouchCheck,
  dynStepsHeaderLbl,
  dynStepsList,
  dynStudioCelStrip,
  dynStudioCelsPill,
  dynStudioModal,
  dynStudioModePill,
  dynStudioNamePill,
  dynStudioPlayBtn,
  dynStudioPreviewCanvas,
  dynStudioRestartBtn,
  dynStudioTimeEl,
  dynTabCodeBtn,
  dynTabVisualBtn,
  dynTouchWrap,
  dynVisualPane,
  dynVisualStatusBadge,
  editorCustomTextInput,
  editorCustomTextLbl,
  editorDynOptsWrap,
  openDynStudioBtn,
  openTextStudioBtn,
  spriteNameInput,
  textStudioCount,
  textStudioInput,
  textStudioModal,
  textStudioPrevText,
  textStudioPrevTitle,
  textStudioTitle
} from '../dom.js';
import {
  appendActionToMarkerScript,
  compileDynamicProgram,
  deleteScriptLine,
  DYNAMIC_RECIPES,
  evaluateDynamicFrame,
  extractMarkerTimelineItems,
  formatVisualActionLine,
  setMarkerRestartTime
} from '../dynamicEngine.js';
import { drawDefaultWireframe } from '../renderer.js';
import { state } from '../state.js';
import { closeOpenCustomSelect, syncCustomSelect } from '../ui/selects.js';
import { clamp, hasAnyPixel, pixelsToCanvas } from '../utils.js';
import { markEditorDirty } from './draft.js';
import { drawEditorCanvas, refreshEditorAll, renderEditorPreview, setEditorSize, setEditorType } from './render.js';
import { getCompositeFramePixels } from './selection.js';
import { editor, setEditorMsg } from './state.js';

/* =========================================================================
   SPACIOUS POP-OUT DYNAMIC STUDIO & TEXT / SIGN WRITER
   Keeps the Sprite Editor inspector calm & uncluttered while giving
   layered animations, recipes, pivots, code & signs a full roomy workspace.
   ========================================================================= */

const MARKER_PILL_DEFS = [
  { id: 'DEFAULT', label: 'IDLE' },
  { id: 'MOVE', label: 'MOVE' },
  { id: 'RISE', label: 'RISE' },
  { id: 'FALL', label: 'FALL' },
  { id: 'ACTION', label: 'ACTION' },
  { id: 'SIT', label: 'SIT' },
  { id: 'LIE', label: 'LIE' },
  { id: 'CLIMB', label: 'CLIMB' },
  { id: 'SWIM', label: 'SWIM' },
  { id: 'START', label: 'START' }
];

let studioPlaying = true;
let studioStartUiTime = 0;
let studioPausedAt = 0;
let returnToDynStudioAfterPivot = false;

export function isDynamicStudioOpen() {
  return Boolean(dynStudioModal && dynStudioModal.classList.contains('open'));
}

export function isTextStudioOpen() {
  return Boolean(textStudioModal && textStudioModal.classList.contains('open'));
}

function getStudioEvalTime() {
  if (!studioPlaying) return studioPausedAt;
  return Math.max(0, state.uiTime - studioStartUiTime);
}

function resetStudioClock() {
  studioStartUiTime = state.uiTime;
  studioPausedAt = 0;
  renderDynamicStudioPreview();
}

export function openDynamicStudio(tab = null) {
  if (!dynStudioModal || editor.type !== 'DYNAMIC') return;
  closeOpenCustomSelect(false);
  returnToDynStudioAfterPivot = false;
  editor.dynPickingPivot = false;
  studioPlaying = true;
  studioStartUiTime = state.uiTime;
  studioPausedAt = 0;
  if (tab) editor.dynStudioTab = tab === 'code' ? 'code' : 'visual';
  dynStudioModal.classList.add('open');
  updateDynamicOptionsUI();
  renderDynamicStudioPreview();
  SFX.playMenuSwipe(false);
}

export function closeDynamicStudio(silent = false) {
  if (!dynStudioModal) return false;
  const wasOpen = dynStudioModal.classList.contains('open');
  if (!wasOpen) return false;
  closeOpenCustomSelect(false);
  dynStudioModal.classList.remove('open');
  updateDynamicOptionsUI();
  drawEditorCanvas();
  renderEditorPreview();
  if (!silent) SFX.playMenuSwipe(true);
  return true;
}

export function openTextStudio() {
  if (!textStudioModal) return;
  closeOpenCustomSelect(false);
  const lbl = (editorCustomTextLbl && editorCustomTextLbl.textContent) || 'TEXT';
  if (textStudioTitle) textStudioTitle.textContent = lbl;
  if (textStudioInput) {
    textStudioInput.value = editor.customText || '';
  }
  syncTextStudioPreview();
  textStudioModal.classList.add('open');
  SFX.playMenuSwipe(false);
  if (textStudioInput) {
    textStudioInput.focus();
    textStudioInput.setSelectionRange(textStudioInput.value.length, textStudioInput.value.length);
  }
}

export function closeTextStudio(silent = false) {
  if (!textStudioModal) return false;
  const wasOpen = textStudioModal.classList.contains('open');
  if (!wasOpen) return false;
  textStudioModal.classList.remove('open');
  if (!silent) SFX.playMenuSwipe(true);
  return true;
}

function syncTextStudioPreview() {
  const raw = editor.customText || '';
  if (textStudioCount) textStudioCount.textContent = `${raw.length} / 240`;
  if (textStudioPrevTitle) {
    const nm = (spriteNameInput && spriteNameInput.value.trim()) || 'SIGN';
    textStudioPrevTitle.textContent = nm.toUpperCase();
  }
  if (textStudioPrevText) {
    textStudioPrevText.textContent = raw.trim() ? raw : '(EMPTY)';
  }
}

function syncDynScriptStatus(scriptStr) {
  const prog = compileDynamicProgram(scriptStr);
  const markerCount = Object.keys(prog.markers).length;
  const isErr = prog.errors.length > 0;
  const mNote = markerCount > 1 ? ` | ${markerCount} STATES` : '';
  const okTxt = `OK - ${prog.stepCount} STEP${prog.stepCount === 1 ? '' : 'S'}${mNote}`;
  const msg = isErr ? prog.errors[0] : okTxt;
  const cls = isErr ? 'err' : 'ok';

  if (dynScriptStatus) {
    dynScriptStatus.textContent = msg;
    dynScriptStatus.className = 'dyn-script-status ' + cls;
  }
  if (dynVisualStatusBadge) {
    dynVisualStatusBadge.textContent = isErr ? 'CHECK CODE' : `${prog.stepCount} STEP${prog.stepCount === 1 ? '' : 'S'}`;
    dynVisualStatusBadge.className = 'dyn-script-status-mini ' + cls;
  }
  if (dynInspectorSummary) {
    if (isErr) {
      dynInspectorSummary.textContent = 'SCRIPT ISSUE - OPEN STUDIO';
    } else if (prog.stepCount === 0) {
      dynInspectorSummary.textContent = 'STILL - OPEN STUDIO TO ANIMATE';
    } else {
      const loopVal = (editor.dynamicOpts && editor.dynamicOpts.loopSec) || 3;
      dynInspectorSummary.textContent = markerCount > 1
        ? `${prog.stepCount} STEPS - ${markerCount} STATES`
        : `${prog.stepCount} STEP${prog.stepCount === 1 ? '' : 'S'} - LOOP ${loopVal}S`;
    }
  }
  return prog;
}

export function setDynamicStudioTab(tab) {
  const mode = tab === 'code' ? 'code' : 'visual';
  editor.dynStudioTab = mode;
  if (dynTabVisualBtn) dynTabVisualBtn.classList.toggle('active', mode === 'visual');
  if (dynTabCodeBtn) dynTabCodeBtn.classList.toggle('active', mode === 'code');
  if (dynVisualPane) dynVisualPane.classList.toggle('active', mode === 'visual');
  if (dynCodePane) dynCodePane.classList.toggle('active', mode === 'code');
  if (mode === 'code' && dynScriptInput) {
    dynScriptInput.value = (editor.dynamicOpts && editor.dynamicOpts.script) || '';
    syncDynScriptStatus(dynScriptInput.value);
  }
}

function renderDynamicCelStrip() {
  if (!dynStudioCelStrip || !isDynamicStudioOpen()) return;
  dynStudioCelStrip.innerHTML = '';
  const s = editor.size;
  for (let i = 0; i < editor.frames.length; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dyn-cel-chip' + (i === editor.frameIdx ? ' active' : '');
    const px = i === editor.frameIdx ? getCompositeFramePixels(editor.frames[i]) : editor.frames[i];
    const c = pixelsToCanvas(px, s);
    const lbl = document.createElement('span');
    lbl.textContent = `C${i + 1}`;
    btn.appendChild(c);
    btn.appendChild(lbl);
    btn.addEventListener('click', () => {
      editor.frameIdx = i;
      editor.previewIdx = i;
      if (dynActCelSelect) {
        dynActCelSelect.value = String(i + 1);
        syncCustomSelect(dynActCelSelect);
      }
      refreshEditorAll();
      renderDynamicStudioPreview();
    });
    dynStudioCelStrip.appendChild(btn);
  }
}

function renderDynamicMarkerPills(prog) {
  if (!dynMarkerPills) return;
  const active = editor.dynPreviewMarker || 'DEFAULT';
  dynMarkerPills.innerHTML = '';
  for (const m of MARKER_PILL_DEFS) {
    const sec = prog && prog.markers && prog.markers[m.id];
    const hasSteps = Boolean(sec && Array.isArray(sec.commands) && sec.commands.length > 0);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn dyn-marker-pill' + (active === m.id ? ' active' : '') + (hasSteps ? ' has-steps' : '');
    btn.textContent = m.label;
    btn.addEventListener('click', () => {
      editor.dynPreviewMarker = m.id;
      if (dynMarkerSelect) {
        dynMarkerSelect.value = m.id;
        syncCustomSelect(dynMarkerSelect);
      }
      resetStudioClock();
      updateDynamicOptionsUI();
      renderEditorPreview();
    });
    dynMarkerPills.appendChild(btn);
  }
}

function renderDynamicRecipeGrid() {
  if (!dynRecipeGrid) return;
  dynRecipeGrid.innerHTML = '';
  const curScript = (editor.dynamicOpts && editor.dynamicOpts.script || '').trim();
  for (const rec of DYNAMIC_RECIPES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn dyn-recipe-btn' + (curScript === rec.script.trim() ? ' active' : '');
    btn.textContent = rec.label;
    btn.title = `Apply starter recipe: ${rec.label}`;
    btn.addEventListener('click', () => {
      if (!editor.dynamicOpts) editor.dynamicOpts = defaultDynamicOpts(editor.subType);
      editor.dynamicOpts.script = rec.script;
      editor.dynamicOpts.loopSec = rec.loopSec || 3;
      if (rec.actionable) editor.dynamicOpts.actionable = true;
      if (rec.mode && rec.mode !== editor.subType) {
        setEditorType('DYNAMIC', rec.mode, true);
      } else {
        updateDynamicOptionsUI();
        renderEditorPreview();
      }
      resetStudioClock();
      SFX.playPickup();
      setEditorMsg('APPLIED RECIPE: ' + rec.label);
      markEditorDirty();
    });
    dynRecipeGrid.appendChild(btn);
  }
}

export function renderDynamicStudioPreview() {
  if (!dynStudioPreviewCanvas || !isDynamicStudioOpen() || editor.type !== 'DYNAMIC') return;
  const outDim = 228;
  if (dynStudioPreviewCanvas.width !== outDim || dynStudioPreviewCanvas.height !== outDim) {
    dynStudioPreviewCanvas.width = outDim;
    dynStudioPreviewCanvas.height = outDim;
  }
  const ctx = dynStudioPreviewCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, outDim, outDim);
  ctx.fillStyle = '#0d0e11';
  ctx.fillRect(0, 0, outDim, outDim);

  // Subtle floor guide & center plumb line
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(Math.floor(outDim * 0.5), 10, 1, outDim - 36);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(14, outDim - 26, outDim - 28, 1);

  const s = editor.size;
  const opts = editor.dynamicOpts || defaultDynamicOpts(editor.subType);
  const prog = compileDynamicProgram(opts.script || '');
  const marker = editor.dynPreviewMarker || 'DEFAULT';
  const rawT = getStudioEvalTime();
  const evalRes = evaluateDynamicFrame(prog, marker, rawT, editor.frames.length, s, opts.pivots, {
    playerName: 'Player',
    worldName: 'Preview'
  });

  if (dynStudioTimeEl) {
    const tStr = (evalRes.t || 0).toFixed(1);
    dynStudioTimeEl.textContent = evalRes.loopLen
      ? `${tStr}S / ${evalRes.loopLen.toFixed(1)}S`
      : `${tStr}S`;
  }

  const fitScale = Math.min(6, Math.max(2, Math.floor(168 / Math.max(19, s))));
  const drawDim = s * fitScale;
  const footCx = outDim * 0.5;
  const footY = outDim - 26;
  const activeComposite = getCompositeFramePixels();

  const showBodyGhost = editor.subType === 'ATTACHABLE';
  const eqBody = showBodyGhost && state.equippedBodyId
    ? state.sprites.find(sp => sp.id === state.equippedBodyId)
    : null;
  const drawBodyGhost = () => {
    if (!showBodyGhost) return;
    ctx.save();
    ctx.globalAlpha = 0.34;
    if (eqBody && eqBody._canvases && eqBody._canvases[0]) {
      const bDim = eqBody.size * fitScale;
      ctx.drawImage(eqBody._canvases[0], Math.round(footCx - bDim * 0.5), Math.round(footY - bDim), bDim, bDim);
    } else {
      const wDim = TILE * fitScale;
      ctx.translate(Math.round(footCx - wDim * 0.5), Math.round(footY - wDim));
      drawDefaultWireframe(ctx, wDim, wDim, 1, false, null, false);
    }
    ctx.restore();
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

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = clamp(cState.opacity > 0.004 ? cState.opacity : 1, 0, 1);
    if (cState.bright) ctx.globalCompositeOperation = 'lighter';
    ctx.translate(baseLeft + pvX + cState.x * fitScale, baseTop + pvY + cState.y * fitScale);
    if (Math.abs(cState.rot) > 0.01) ctx.rotate((cState.rot * Math.PI) / 180);
    const sx = (cState.flipH ? -1 : 1) * cState.scale;
    const sy = (cState.flipV ? -1 : 1) * cState.scale;
    if (Math.abs(sx - 1) > 0.002 || Math.abs(sy - 1) > 0.002) ctx.scale(sx, sy);

    if (cState.light) {
      const lr = Array.isArray(cState.light) ? cState.light[0] : (cState.light.r ?? 255);
      const lg = Array.isArray(cState.light) ? cState.light[1] : (cState.light.g ?? 226);
      const lb = Array.isArray(cState.light) ? cState.light[2] : (cState.light.b ?? 160);
      const glowRad = Math.max(18, drawDim * 0.58);
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, glowRad);
      g.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0.45)`);
      g.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(-glowRad, -glowRad, glowRad * 2, glowRad * 2);
    }

    if (hasArt) {
      const cCanvas = pixelsToCanvas(pxArr, s);
      ctx.drawImage(cCanvas, -pvX, -pvY, drawDim, drawDim);
    }

    if (cState.text) {
      const fnt = String(cState.font || 'white').toLowerCase();
      const isBlack = fnt.includes('black');
      ctx.font = '16px "Pixellari", monospace';
      ctx.textAlign = cState.align === 'left' ? 'left' : (cState.align === 'right' ? 'right' : 'center');
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isBlack ? '#0d0e11' : '#f4eee6';
      ctx.fillText(cState.text, 0, 0);
    }
    ctx.restore();
  }

  if (showBodyGhost && opts.behind) drawBodyGhost();

  if (evalRes.activeSay && evalRes.activeSay.text) {
    ctx.save();
    ctx.font = '16px "Pixellari", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const txt = evalRes.activeSay.text.slice(0, 22);
    const bw = clamp(Math.ceil(ctx.measureText(txt).width) + 18, 44, outDim - 16);
    const bx = Math.round((outDim - bw) * 0.5);
    ctx.fillStyle = 'rgba(13, 14, 17, 0.92)';
    ctx.fillRect(bx, 8, bw, 22);
    ctx.strokeStyle = '#e8dfd4';
    ctx.strokeRect(bx + 0.5, 8.5, bw - 1, 21);
    ctx.fillStyle = '#ffd48c';
    ctx.fillText(txt, outDim * 0.5, 11);
    ctx.restore();
  }
}

export function updateDynamicOptionsUI() {
  const isDyn = editor.type === 'DYNAMIC';
  if (editorDynOptsWrap) editorDynOptsWrap.classList.toggle('visible', isDyn);
  if (!isDyn) {
    editor.dynPickingPivot = false;
    closeDynamicStudio(true);
    return;
  }

  if (!editor.dynamicOpts) editor.dynamicOpts = defaultDynamicOpts(editor.subType);
  const opts = editor.dynamicOpts;
  opts.mode = editor.subType || 'WORLD';
  const isComp = isDynamicCompanion({ type: 'DYNAMIC', subType: opts.mode });

  if (dynAttrNote) {
    if (opts.mode === 'ATTACHABLE') {
      dynAttrNote.textContent = 'Wears on your Body! Add to Motion Bar with Down/S.';
    } else if (opts.mode === 'FOLLOWS') {
      dynAttrNote.textContent = 'Floating fairy/drone companion that glides behind you.';
    } else if (opts.mode === 'CLOSELY FOLLOWS') {
      dynAttrNote.textContent = 'Pet or buddy that follows right beside your feet.';
    } else {
      dynAttrNote.textContent = 'Up to 9 layered cels that move, spin & react!';
    }
  }

  if (dynSizePresetGroup) {
    dynSizePresetGroup.querySelectorAll('button[data-dynsize]').forEach(btn => {
      const sz = parseInt(btn.dataset.dynsize, 10);
      btn.classList.toggle('active', editor.size === sz);
    });
  }

  if (dynStudioNamePill) {
    dynStudioNamePill.textContent = ((spriteNameInput && spriteNameInput.value.trim()) || 'DYNAMIC').toUpperCase();
  }
  if (dynStudioModePill) dynStudioModePill.textContent = opts.mode;
  if (dynStudioCelsPill) {
    const cnt = editor.frames.length || 1;
    dynStudioCelsPill.textContent = `${cnt} CEL${cnt === 1 ? '' : 'S'}`;
  }

  if (dynTouchWrap) dynTouchWrap.style.display = isComp ? 'none' : 'inline-flex';
  if (dynActionWrap) dynActionWrap.style.display = isComp ? 'inline-flex' : 'none';
  if (dynMarkerRow) dynMarkerRow.style.display = isComp ? 'flex' : 'none';

  if (dynStartsOnTouchCheck) dynStartsOnTouchCheck.checked = Boolean(opts.startsOnTouch);
  if (dynBehindCheck) dynBehindCheck.checked = Boolean(opts.behind);
  if (dynActionableCheck) dynActionableCheck.checked = Boolean(opts.actionable);
  if (dynReplacesCheck) dynReplacesCheck.checked = Boolean(opts.replaces);

  if (dynLoopSecInput && document.activeElement !== dynLoopSecInput) {
    dynLoopSecInput.value = String(opts.loopSec || 3);
  }
  if (dynMarkerSelect) {
    if (!isComp) editor.dynPreviewMarker = 'DEFAULT';
    dynMarkerSelect.value = editor.dynPreviewMarker || 'DEFAULT';
    syncCustomSelect(dynMarkerSelect);
  }
  if (dynStepsHeaderLbl) {
    const mk = editor.dynPreviewMarker || 'DEFAULT';
    dynStepsHeaderLbl.textContent = mk === 'DEFAULT' ? 'TIMELINE STEPS (IDLE)' : `TIMELINE STEPS (${mk})`;
  }
  if (dynInspectorPivotBtn) {
    dynInspectorPivotBtn.classList.toggle('active', Boolean(editor.dynPickingPivot));
  }
  if (dynStudioPlayBtn) {
    dynStudioPlayBtn.textContent = studioPlaying ? 'PAUSE' : 'PLAY';
    dynStudioPlayBtn.classList.toggle('active', studioPlaying);
  }

  // Update active cel pivot readout (both inspector & pop-out studio)
  const celNum = clamp(editor.frameIdx + 1, 1, DYNAMIC_MAX_CELS);
  const pv = opts.pivots && opts.pivots[String(celNum)];
  const px = pv ? pv.x : (editor.size * 0.5);
  const py = pv ? pv.y : (editor.size * 0.5);
  const pvText = editor.dynPickingPivot
    ? `CLICK CANVAS: CEL ${celNum}`
    : `CEL ${celNum} PIVOT: ${px}, ${py}`;
  if (dynPivotReadout) dynPivotReadout.textContent = pvText;
  if (dynInspectorPivotReadout) {
    dynInspectorPivotReadout.textContent = editor.dynPickingPivot
      ? `CLICK CANVAS FOR CEL ${celNum}`
      : `CEL ${celNum} PIVOT: ${px}, ${py}`;
  }

  // Populate cel selector matching current cel count (1..9) + ALL
  if (dynActCelSelect) {
    const prevVal = dynActCelSelect.value || String(celNum);
    const totalCels = clamp(editor.frames.length || 1, 1, DYNAMIC_MAX_CELS);
    dynActCelSelect.innerHTML = '';
    for (let i = 1; i <= totalCels; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `CEL ${i}`;
      dynActCelSelect.appendChild(opt);
    }
    const allOpt = document.createElement('option');
    allOpt.value = 'ALL';
    allOpt.textContent = 'ALL';
    dynActCelSelect.appendChild(allOpt);
    dynActCelSelect.value = (prevVal === 'ALL' || parseInt(prevVal, 10) <= totalCels) ? prevVal : String(celNum);
    syncCustomSelect(dynActCelSelect);
  }

  // Keep script box synced when not actively typing inside it
  if (dynScriptInput && document.activeElement !== dynScriptInput) {
    dynScriptInput.value = opts.script || '';
  }
  const prog = syncDynScriptStatus(opts.script || '');
  renderDynamicStepsList();
  renderDynamicRecipeGrid();
  if (isComp) renderDynamicMarkerPills(prog);
  renderDynamicCelStrip();
  setDynamicStudioTab(editor.dynStudioTab || 'visual');
}

export function renderDynamicStepsList() {
  if (!dynStepsList || editor.type !== 'DYNAMIC' || !editor.dynamicOpts) return;
  const marker = editor.dynPreviewMarker || 'DEFAULT';
  const items = extractMarkerTimelineItems(editor.dynamicOpts.script || '', marker);
  dynStepsList.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dyn-steps-empty';
    empty.textContent = marker === 'DEFAULT'
      ? 'No steps yet - click a Starter Recipe or + ADD STEP above!'
      : `No ${marker} steps yet - click + ADD STEP above!`;
    dynStepsList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'dyn-step-card';

    const colonIdx = item.text.indexOf(':');
    if (colonIdx > 0 && colonIdx < 16) {
      const timeBadge = document.createElement('span');
      timeBadge.className = 'dyn-step-time';
      timeBadge.textContent = item.text.slice(0, colonIdx).trim().toUpperCase();
      row.appendChild(timeBadge);

      const txt = document.createElement('span');
      txt.className = 'dyn-step-text';
      txt.textContent = item.text.slice(colonIdx + 1).trim();
      row.appendChild(txt);
    } else {
      const txt = document.createElement('span');
      txt.className = 'dyn-step-text';
      txt.textContent = item.text;
      row.appendChild(txt);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn dyn-step-del';
    del.setAttribute('aria-label', 'Remove step');
    del.innerHTML = '<svg class="px-ico px-ico-12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="2" height="2"/><rect x="4" y="4" width="4" height="4"/><rect x="8" y="2" width="2" height="2"/><rect x="2" y="8" width="2" height="2"/><rect x="8" y="8" width="2" height="2"/></svg>';
    del.title = 'Remove step';
    del.addEventListener('click', () => {
      editor.dynamicOpts.script = deleteScriptLine(editor.dynamicOpts.script || '', item.lineIdx);
      updateDynamicOptionsUI();
      renderEditorPreview();
      renderDynamicStudioPreview();
      markEditorDirty();
    });

    row.appendChild(del);
    dynStepsList.appendChild(row);
  }
}

function setExactPivotForActiveCel(px, py, reopenIfQueued = false) {
  if (editor.type !== 'DYNAMIC' || !editor.dynamicOpts) return;
  const celKey = String(clamp(editor.frameIdx + 1, 1, DYNAMIC_MAX_CELS));
  if (!editor.dynamicOpts.pivots) editor.dynamicOpts.pivots = {};
  editor.dynamicOpts.pivots[celKey] = {
    x: Math.round(clamp(px, 0, editor.size) * 2) / 2,
    y: Math.round(clamp(py, 0, editor.size) * 2) / 2
  };
  editor.dynPickingPivot = false;
  SFX.playPickup();
  setEditorMsg(`CEL ${celKey} PIVOT: ${editor.dynamicOpts.pivots[celKey].x}, ${editor.dynamicOpts.pivots[celKey].y}`);
  updateDynamicOptionsUI();
  drawEditorCanvas();
  renderEditorPreview();
  if (reopenIfQueued && returnToDynStudioAfterPivot) {
    returnToDynStudioAfterPivot = false;
    openDynamicStudio();
  } else {
    renderDynamicStudioPreview();
  }
  markEditorDirty();
}

export function setDynamicPivotAt(x, y) {
  if (editor.type !== 'DYNAMIC' || !editor.dynamicOpts) return;
  const px = Math.round((clamp(x, 0, editor.size - 1) + 0.5) * 2) / 2;
  const py = Math.round((clamp(y, 0, editor.size - 1) + 0.5) * 2) / 2;
  setExactPivotForActiveCel(px, py, true);
}

function updateActionValueInputHint() {
  if (!dynActKindSelect || !dynActValInput) return;
  const k = dynActKindSelect.value;
  const noVal = k === 'show' || k === 'hide' || k === 'flipH' || k === 'bright' || k === 'clockSec' || k === 'clockMin' || k === 'clockHr' || k === 'sound';
  if (dynActValField) dynActValField.style.display = noVal ? 'none' : 'flex';
  else dynActValInput.style.display = noVal ? 'none' : '';

  if (k === 'rotate') {
    if (dynActValLbl) dynActValLbl.textContent = 'DEGREES';
    dynActValInput.placeholder = '90';
    if (!dynActValInput.value || isNaN(Number(dynActValInput.value))) dynActValInput.value = '90';
  } else if (k === 'scale') {
    if (dynActValLbl) dynActValLbl.textContent = 'SCALE';
    dynActValInput.placeholder = '1.25';
    dynActValInput.value = '1.25';
  } else if (k === 'opacity') {
    if (dynActValLbl) dynActValLbl.textContent = 'OPACITY';
    dynActValInput.placeholder = '0-1';
    dynActValInput.value = '0.4';
  } else if (k === 'text') {
    if (dynActValLbl) dynActValLbl.textContent = 'TEXT';
    dynActValInput.placeholder = '[time]';
    dynActValInput.value = '[time]';
  } else if (k === 'say') {
    if (dynActValLbl) dynActValLbl.textContent = 'SPEECH';
    dynActValInput.placeholder = 'HI!';
    dynActValInput.value = 'HI!';
  } else if (!noVal) {
    if (dynActValLbl) dynActValLbl.textContent = 'PIXELS';
    dynActValInput.placeholder = '8';
    if (!dynActValInput.value || isNaN(Number(dynActValInput.value))) dynActValInput.value = '8';
  }
}

export function initDynamicStudioUI() {
  if (openDynStudioBtn) {
    openDynStudioBtn.addEventListener('click', () => openDynamicStudio());
  }
  if (closeDynStudioX) closeDynStudioX.addEventListener('click', () => closeDynamicStudio());
  if (closeDynStudioBtn) closeDynStudioBtn.addEventListener('click', () => closeDynamicStudio());
  if (dynStudioModal) {
    dynStudioModal.addEventListener('click', e => {
      if (e.target === dynStudioModal) closeDynamicStudio();
    });
  }

  if (dynStudioPlayBtn) {
    dynStudioPlayBtn.addEventListener('click', () => {
      if (studioPlaying) {
        studioPausedAt = getStudioEvalTime();
        studioPlaying = false;
      } else {
        studioStartUiTime = state.uiTime - studioPausedAt;
        studioPlaying = true;
      }
      updateDynamicOptionsUI();
      renderDynamicStudioPreview();
    });
  }
  if (dynStudioRestartBtn) {
    dynStudioRestartBtn.addEventListener('click', () => {
      studioPlaying = true;
      resetStudioClock();
      updateDynamicOptionsUI();
    });
  }

  if (dynSizePresetGroup) {
    dynSizePresetGroup.addEventListener('click', e => {
      const btn = e.target.closest('button[data-dynsize]');
      if (!btn || editor.type !== 'DYNAMIC') return;
      const nextSz = parseInt(btn.dataset.dynsize, 10);
      if (Number.isFinite(nextSz)) {
        setEditorSize(nextSz, true);
        updateDynamicOptionsUI();
      }
    });
  }

  if (dynInspectorPivotBtn) {
    dynInspectorPivotBtn.addEventListener('click', () => {
      returnToDynStudioAfterPivot = false;
      editor.dynPickingPivot = !editor.dynPickingPivot;
      updateDynamicOptionsUI();
      drawEditorCanvas();
    });
  }

  if (dynPickPivotBtn) {
    dynPickPivotBtn.addEventListener('click', () => {
      returnToDynStudioAfterPivot = true;
      closeDynamicStudio(true);
      editor.dynPickingPivot = true;
      updateDynamicOptionsUI();
      drawEditorCanvas();
      setEditorMsg(`CLICK CANVAS TO SET CEL ${editor.frameIdx + 1} PIVOT`);
    });
  }
  if (dynPivotCtrBtn) {
    dynPivotCtrBtn.addEventListener('click', () => setExactPivotForActiveCel(editor.size * 0.5, editor.size * 0.5, false));
  }
  if (dynPivotBotBtn) {
    dynPivotBotBtn.addEventListener('click', () => setExactPivotForActiveCel(editor.size * 0.5, editor.size - 0.5, false));
  }
  if (dynPivotTopBtn) {
    dynPivotTopBtn.addEventListener('click', () => setExactPivotForActiveCel(editor.size * 0.5, 0.5, false));
  }

  const syncFlags = () => {
    if (!editor.dynamicOpts) editor.dynamicOpts = defaultDynamicOpts(editor.subType);
    editor.dynamicOpts.startsOnTouch = Boolean(dynStartsOnTouchCheck && dynStartsOnTouchCheck.checked);
    editor.dynamicOpts.behind = Boolean(dynBehindCheck && dynBehindCheck.checked);
    editor.dynamicOpts.actionable = Boolean(dynActionableCheck && dynActionableCheck.checked);
    editor.dynamicOpts.replaces = Boolean(dynReplacesCheck && dynReplacesCheck.checked);
    renderEditorPreview();
    renderDynamicStudioPreview();
    markEditorDirty();
  };
  if (dynStartsOnTouchCheck) dynStartsOnTouchCheck.addEventListener('change', syncFlags);
  if (dynBehindCheck) dynBehindCheck.addEventListener('change', syncFlags);
  if (dynActionableCheck) dynActionableCheck.addEventListener('change', syncFlags);
  if (dynReplacesCheck) dynReplacesCheck.addEventListener('change', syncFlags);

  if (dynTabVisualBtn) dynTabVisualBtn.addEventListener('click', () => setDynamicStudioTab('visual'));
  if (dynTabCodeBtn) dynTabCodeBtn.addEventListener('click', () => setDynamicStudioTab('code'));

  if (dynMarkerSelect) {
    dynMarkerSelect.addEventListener('change', () => {
      editor.dynPreviewMarker = dynMarkerSelect.value || 'DEFAULT';
      resetStudioClock();
      updateDynamicOptionsUI();
      renderEditorPreview();
    });
  }

  if (dynLoopSecInput) {
    dynLoopSecInput.addEventListener('change', () => {
      if (!editor.dynamicOpts) return;
      const v = clamp(Number(dynLoopSecInput.value) || 3, 0.2, 15);
      editor.dynamicOpts.loopSec = Math.round(v * 10) / 10;
      editor.dynamicOpts.script = setMarkerRestartTime(
        editor.dynamicOpts.script || '',
        editor.dynPreviewMarker || 'DEFAULT',
        editor.dynamicOpts.loopSec
      );
      updateDynamicOptionsUI();
      renderEditorPreview();
      renderDynamicStudioPreview();
      markEditorDirty();
    });
  }

  if (dynActKindSelect) {
    dynActKindSelect.addEventListener('change', updateActionValueInputHint);
    updateActionValueInputHint();
  }

  if (dynAddActionBtn) {
    dynAddActionBtn.addEventListener('click', () => {
      if (!editor.dynamicOpts) editor.dynamicOpts = defaultDynamicOpts(editor.subType);
      const kind = dynActKindSelect ? dynActKindSelect.value : 'show';
      const cel = dynActCelSelect ? dynActCelSelect.value : '1';
      const start = Math.max(0, Number(dynActStartInput ? dynActStartInput.value : 0) || 0);
      const end = Math.max(start, Number(dynActEndInput ? dynActEndInput.value : start) || start);
      const rawVal = dynActValInput ? dynActValInput.value : '';
      const line = formatVisualActionLine({
        cel,
        kind,
        start,
        end,
        val: parseFloat(rawVal),
        text: rawVal
      });
      const marker = editor.dynPreviewMarker || 'DEFAULT';
      editor.dynamicOpts.script = appendActionToMarkerScript(
        editor.dynamicOpts.script || '',
        marker,
        line,
        editor.dynamicOpts.loopSec || 3
      );
      SFX.playPickup();
      updateDynamicOptionsUI();
      renderEditorPreview();
      renderDynamicStudioPreview();
      markEditorDirty();
    });
  }

  if (dynScriptInput) {
    dynScriptInput.addEventListener('input', () => {
      if (!editor.dynamicOpts) editor.dynamicOpts = defaultDynamicOpts(editor.subType);
      editor.dynamicOpts.script = dynScriptInput.value.slice(0, 4000);
      const prog = syncDynScriptStatus(editor.dynamicOpts.script);
      renderDynamicStepsList();
      if (isDynamicCompanion({ type: 'DYNAMIC', subType: editor.subType })) {
        renderDynamicMarkerPills(prog);
      }
      renderEditorPreview();
      renderDynamicStudioPreview();
      markEditorDirty();
    });
  }

  if (dynCodeChips) {
    dynCodeChips.addEventListener('click', e => {
      const btn = e.target.closest('button[data-snippet]');
      if (!btn || !dynScriptInput) return;
      const snip = btn.dataset.snippet || '';
      const cur = (dynScriptInput.value || '').trimEnd();
      dynScriptInput.value = cur ? `${cur}\n${snip}` : snip;
      dynScriptInput.dispatchEvent(new Event('input'));
      dynScriptInput.focus();
    });
  }

  // Pop-Out Text & Sign Writer bindings
  if (openTextStudioBtn) {
    openTextStudioBtn.addEventListener('click', openTextStudio);
  }
  if (closeTextStudioX) closeTextStudioX.addEventListener('click', () => closeTextStudio());
  if (closeTextStudioBtn) closeTextStudioBtn.addEventListener('click', () => closeTextStudio());
  if (textStudioModal) {
    textStudioModal.addEventListener('click', e => {
      if (e.target === textStudioModal) closeTextStudio();
    });
  }
  if (textStudioInput) {
    textStudioInput.addEventListener('input', () => {
      editor.customText = textStudioInput.value.replace(/\r\n/g, '\n').slice(0, 240);
      if (editorCustomTextInput) {
        editorCustomTextInput.value = editor.customText.replace(/\r?\n/g, ' / ');
      }
      syncTextStudioPreview();
      markEditorDirty();
    });
  }
}
