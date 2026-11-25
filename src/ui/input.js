import { SFX } from '../audio.js';
import { KEY_EDITOR_DRAFT, PHYS, TILE } from '../constants.js';
import {
  dialogueBox,
  editorModal,
  editorStageScroll,
  isAnyModalOpen,
  sessionLockOverlay,
  showToast,
  tpSearchInput,
  typePickerModal,
  viewableModal,
  worldCanvas,
  worldsModal,
  worldStage
} from '../dom.js';
import { flushEditorDraftNow, renderDraftBar } from '../editor/draft.js';
import { closeEditor } from '../editor/io.js';
import { drawEditorCanvas } from '../editor/render.js';
import {
  clearEditorSelection,
  copyEditorSelection,
  deleteSelectedPixels,
  editorHasSelection,
  pasteEditorClipboard,
  selectAllEditorPixels,
  writeStampToSystemClipboard
} from '../editor/selection.js';
import { editor } from '../editor/state.js';
import {
  doRedo,
  doUndo,
  nudgeEditorFrame,
  setEditorTool,
  syncEditorModifierUI,
  toggleSymmetryEnabled
} from '../editor/tools.js';
import { closeTypePicker } from '../editor/ui.js';
import { interactNearby } from '../fx.js';
import { respawnPlayer } from '../physics.js';
import {
  camera,
  getActiveWorld,
  invalidateBgEffectIndex,
  keys,
  player,
  pointer,
  state,
  worldFX,
  worldHistory
} from '../state.js';
import { savePrefsNow, scheduleWorldAutoSave, sessionGuard } from '../storage.js';
import { setBuildTool, setMode, toggleMenusHidden } from './topbar.js';
import { closeWorldsModal } from './worlds.js';
import { clamp } from '../utils.js';
import {
  beginWorldBatch,
  closeViewable,
  commitWorldBatch,
  deselectHeldBlock,
  eraseTileAt,
  getTileOrient,
  getWorldLineTiles,
  getWorldRectTiles,
  hideDialogue,
  pickupTileAt,
  placeTileAt,
  redoWorldEdit,
  rotateHeldBrush,
  screenToWorld,
  setTileOrient,
  tileKey,
  undoWorldEdit,
  updateCoordReadout
} from '../world.js';

export function updatePointerCoords(e) {
  const rect = worldCanvas.getBoundingClientRect();
  pointer.screenX = e.clientX - rect.left;
  pointer.screenY = e.clientY - rect.top;
  const w = screenToWorld(pointer.screenX, pointer.screenY);
  pointer.tileX = Math.floor(w.wx / TILE);
  pointer.tileY = Math.floor(w.wy / TILE);
  updateCoordReadout();
}

export function finishWorldPointer(e) {
  if (!pointer.action) return;
  const act = pointer.action;
  pointer.action = null;
  worldStage.classList.remove('panning', 'erasing');
  if (e) {
    try { worldCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  if (act === 'midPending') {
    // Single middle mouse click without drag -> deselect held block with animation
    if (state.selectedSpriteId) {
      deselectHeldBlock(true);
    }
    return;
  }

  if (act === 'rect' && state.selectedSpriteId) {
    beginWorldBatch();
    const pts = getWorldRectTiles(pointer.dragStartTx, pointer.dragStartTy, pointer.tileX, pointer.tileY, pointer.shiftKey);
    let changed = false;
    for (const [tx, ty] of pts) {
      if (placeTileAt(tx, ty, state.selectedSpriteId, true)) changed = true;
    }
    commitWorldBatch();
    if (changed) scheduleWorldAutoSave();
  } else if (act === 'line' && state.selectedSpriteId) {
    beginWorldBatch();
    const pts = getWorldLineTiles(pointer.dragStartTx, pointer.dragStartTy, pointer.tileX, pointer.tileY);
    let changed = false;
    for (const [tx, ty] of pts) {
      if (placeTileAt(tx, ty, state.selectedSpriteId, true)) changed = true;
    }
    commitWorldBatch();
    if (changed) scheduleWorldAutoSave();
  } else if (act === 'eraseBox') {
    beginWorldBatch();
    const pts = getWorldRectTiles(pointer.dragStartTx, pointer.dragStartTy, pointer.tileX, pointer.tileY, false);
    let changed = false;
    for (const [tx, ty] of pts) {
      if (eraseTileAt(tx, ty, true)) changed = true;
    }
    commitWorldBatch();
    if (changed) scheduleWorldAutoSave();
  } else if (act === 'stamp' || act === 'erase') {
    commitWorldBatch();
  }

  updateCoordReadout();
}

export function initWorldPointerEvents() {
  // Prevent browser middle-click auto-scroll on world canvas
  worldCanvas.addEventListener('mousedown', e => {
    if (e.button === 1) e.preventDefault();
  });
  worldCanvas.addEventListener('contextmenu', e => e.preventDefault());

  worldCanvas.addEventListener('wheel', e => {
    if (isAnyModalOpen()) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    camera.targetZoom = clamp(camera.targetZoom * factor, 1.0, 5.0);
    savePrefsNow();
  }, { passive: false });

  worldCanvas.addEventListener('pointerdown', e => {
    if (isAnyModalOpen()) return;
    if (state.mode !== 'BUILD') return;
    pointer.inWorld = true;
    pointer.shiftKey = e.shiftKey;
    pointer.ctrlKey = Boolean(e.ctrlKey || e.metaKey);
    updatePointerCoords(e);

    // Middle mouse button: BUILD mode single-click deselects, drag (> 4px) pans camera
    if (e.button === 1) {
      e.preventDefault();
      pointer.action = 'midPending';
      pointer.panStartScreenX = pointer.screenX;
      pointer.panStartScreenY = pointer.screenY;
      pointer.panStartCamX = camera.x;
      pointer.panStartCamY = camera.y;
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // Space + Left drag pans camera in BUILD mode
    if (e.button === 0 && keys.space) {
      e.preventDefault();
      pointer.action = 'pan';
      pointer.panStartScreenX = pointer.screenX;
      pointer.panStartScreenY = pointer.screenY;
      pointer.panStartCamX = camera.x;
      pointer.panStartCamY = camera.y;
      camera.buildRecenter = false;
      worldStage.classList.add('panning');
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // Right click: cancels active drag, rotates held block (90 deg x4 -> flip -> -90 deg x4), or erases when empty-handed
    if (e.button === 2) {
      if (pointer.action === 'rect' || pointer.action === 'line' || pointer.action === 'eraseBox') {
        worldHistory.activeBatch = null;
        pointer.action = null;
        updateCoordReadout();
        return;
      }
      if (state.selectedSpriteId && state.buildTool !== 'ERASE' && state.buildTool !== 'SPAWN') {
        rotateHeldBrush();
        return;
      }
      pointer.action = 'erase';
      worldStage.classList.add('erasing');
      pointer.lastTx = pointer.tileX;
      pointer.lastTy = pointer.tileY;
      beginWorldBatch();
      if (eraseTileAt(pointer.tileX, pointer.tileY)) scheduleWorldAutoSave();
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    if (e.button !== 0) return;

    // Ctrl + Left click (and drag): deletes tiles even while an object is held on the mouse
    if (e.ctrlKey || e.metaKey) {
      pointer.action = 'erase';
      worldStage.classList.add('erasing');
      pointer.lastTx = pointer.tileX;
      pointer.lastTy = pointer.tileY;
      pointer.lastLeftClick = null;
      beginWorldBatch();
      if (eraseTileAt(pointer.tileX, pointer.tileY)) scheduleWorldAutoSave();
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // Alt + Left click eyedrops tile (with its orientation)
    if (e.altKey) {
      pickupTileAt(pointer.tileX, pointer.tileY);
      return;
    }

    const tx = pointer.tileX;
    const ty = pointer.tileY;
    const world = getActiveWorld();

    // BUILD mode double-click pickup: cleanly restores first-click mutation (including orient) and picks up block
    const now = performance.now();
    const prev = pointer.lastLeftClick;
    if (prev && !prev.dragged && prev.tx === tx && prev.ty === ty && (now - prev.time) < 340) {
      const key = tileKey(tx, ty);
      for (const layer of ['bg', 'main', 'fg']) {
        if (prev.layers[layer]) world.layers[layer][key] = prev.layers[layer];
        else delete world.layers[layer][key];
        setTileOrient(world, layer, key, prev.orient ? prev.orient[layer] : 0);
      }
      invalidateBgEffectIndex();
      worldFX.bgFadeIns.delete(key);
      for (let i = worldFX.bgFadeOuts.length - 1; i >= 0; i--) {
        if (worldFX.bgFadeOuts[i].key === key) worldFX.bgFadeOuts.splice(i, 1);
      }
      // Discard the 1st-click undo entry so double-click pickup doesn't pollute history
      if (worldHistory.undo.length > 0) {
        const top = worldHistory.undo[worldHistory.undo.length - 1];
        if (top.length === 1 && top[0].key === key) {
          worldHistory.undo.pop();
        }
      }
      worldHistory.activeBatch = null;
      pointer.lastLeftClick = null;
      pointer.action = null;
      if (pickupTileAt(tx, ty)) {
        scheduleWorldAutoSave(false);
        return;
      }
    }

    // Snapshot cell state before applying first click so a quick 2nd click can undo it cleanly
    const key = tileKey(tx, ty);
    pointer.lastLeftClick = {
      tx,
      ty,
      time: now,
      dragged: false,
      layers: {
        bg: world.layers.bg[key] || null,
        main: world.layers.main[key] || null,
        fg: world.layers.fg[key] || null
      },
      orient: {
        bg: getTileOrient(world, 'bg', key),
        main: getTileOrient(world, 'main', key),
        fg: getTileOrient(world, 'fg', key)
      }
    };

    if (state.buildTool === 'SPAWN') {
      world.spawn = { x: tx, y: ty };
      scheduleWorldAutoSave();
      showToast(`SPAWN SET ${tx}, ${ty}`);
      return;
    }

    if (state.buildTool === 'ERASE') {
      pointer.action = 'eraseBox';
      worldStage.classList.add('erasing');
      pointer.dragStartTx = tx;
      pointer.dragStartTy = ty;
      updateCoordReadout();
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    if (state.buildTool === 'RECT') {
      if (!state.selectedSpriteId) return;
      pointer.action = 'rect';
      pointer.dragStartTx = tx;
      pointer.dragStartTy = ty;
      updateCoordReadout();
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    if (state.buildTool === 'LINE') {
      if (!state.selectedSpriteId) return;
      pointer.action = 'line';
      pointer.dragStartTx = tx;
      pointer.dragStartTy = ty;
      updateCoordReadout();
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // STAMP brush
    if (!state.selectedSpriteId) return;
    pointer.action = 'stamp';
    pointer.lastTx = tx;
    pointer.lastTy = ty;
    beginWorldBatch();
    if (placeTileAt(tx, ty, state.selectedSpriteId, true)) scheduleWorldAutoSave();
    try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
  });

  worldCanvas.addEventListener('pointermove', e => {
    pointer.inWorld = true;
    pointer.shiftKey = e.shiftKey;
    pointer.ctrlKey = Boolean(e.ctrlKey || e.metaKey);
    worldStage.classList.toggle('eyedrop-ready', Boolean(e.altKey && state.mode === 'BUILD' && !pointer.action));
    worldStage.classList.toggle('ctrl-erase-ready', Boolean(pointer.ctrlKey && state.mode === 'BUILD' && !pointer.action));
    const prevTx = pointer.tileX;
    const prevTy = pointer.tileY;
    updatePointerCoords(e);

    if (pointer.action === 'midPending') {
      const dist = Math.hypot(pointer.screenX - pointer.panStartScreenX, pointer.screenY - pointer.panStartScreenY);
      if (dist > 4) {
        pointer.action = 'pan';
        camera.buildRecenter = false;
        worldStage.classList.add('panning');
      } else {
        return;
      }
    }

    if (pointer.action === 'pan') {
      camera.x = pointer.panStartCamX - (pointer.screenX - pointer.panStartScreenX) / camera.zoom;
      camera.y = pointer.panStartCamY - (pointer.screenY - pointer.panStartScreenY) / camera.zoom;
      return;
    }

    if (pointer.tileX !== prevTx || pointer.tileY !== prevTy) {
      if (pointer.lastLeftClick) pointer.lastLeftClick.dragged = true;
    }

    if (pointer.action === 'stamp' && state.selectedSpriteId) {
      const pts = getWorldLineTiles(pointer.lastTx, pointer.lastTy, pointer.tileX, pointer.tileY);
      let changed = false;
      for (const [tx, ty] of pts) {
        if (placeTileAt(tx, ty, state.selectedSpriteId, true)) changed = true;
      }
      pointer.lastTx = pointer.tileX;
      pointer.lastTy = pointer.tileY;
      if (changed) scheduleWorldAutoSave();
    } else if (pointer.action === 'erase') {
      const pts = getWorldLineTiles(pointer.lastTx, pointer.lastTy, pointer.tileX, pointer.tileY);
      let changed = false;
      for (const [tx, ty] of pts) {
        if (eraseTileAt(tx, ty, true)) changed = true;
      }
      pointer.lastTx = pointer.tileX;
      pointer.lastTy = pointer.tileY;
      if (changed) scheduleWorldAutoSave();
    }
  });
  worldCanvas.addEventListener('pointerup', finishWorldPointer);
  worldCanvas.addEventListener('pointercancel', finishWorldPointer);
  worldCanvas.addEventListener('pointerleave', () => {
    pointer.inWorld = false;
  });
}

export function initGlobalInputEvents() {
  /* =========================================================================
     GLOBAL KEYBOARD CONTROLS
     ========================================================================= */
  window.addEventListener('keydown', e => {
    if (sessionLockOverlay.classList.contains('open')) return;
    SFX.unlock();
    pointer.shiftKey = Boolean(e.shiftKey);
    pointer.ctrlKey = Boolean(e.ctrlKey || e.metaKey);

    const tag = document.activeElement && document.activeElement.tagName;
    const inTextField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // Handle Viewable Inspection modal first
    if (viewableModal.classList.contains('open')) {
      if (e.key === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        closeViewable();
      }
      return;
    }

    // Handle Manyland Type Picker modal before Editor shortcuts
    if (typePickerModal.classList.contains('open')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeTypePicker();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        tpSearchInput.focus();
        tpSearchInput.select();
        return;
      }
      return;
    }

    // Handle Sprite Editor shortcuts
    if (editorModal.classList.contains('open')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (editorHasSelection()) {
          clearEditorSelection(true, true);
        } else {
          closeEditor(false);
        }
        return;
      }
      if (!inTextField) {
        if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
          if (e.key === 'Alt') e.preventDefault();
          editor.modShift = e.shiftKey;
          editor.modAlt = e.altKey;
          editor.modCtrl = e.ctrlKey || e.metaKey;
          syncEditorModifierUI();
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && editorHasSelection()) {
          e.preventDefault();
          deleteSelectedPixels();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          if (e.code === 'KeyC') {
            e.preventDefault();
            const stamp = copyEditorSelection(false);
            if (stamp) writeStampToSystemClipboard(stamp);
            return;
          }
          if (e.code === 'KeyX') {
            e.preventDefault();
            const stamp = copyEditorSelection(true);
            if (stamp) writeStampToSystemClipboard(stamp);
            return;
          }
          if (e.code === 'KeyV') {
            if (editor.clipboard && editor.clipboardPreferInternal) {
              e.preventDefault();
              pasteEditorClipboard();
              return;
            }
            // Allow native paste event for external images; fall back if browser suppresses paste under user-select:none
            const tokenBefore = editor.pasteToken;
            setTimeout(() => {
              if (editorModal.classList.contains('open') && editor.pasteToken === tokenBefore && editor.clipboard) {
                pasteEditorClipboard();
              }
            }, 60);
            return;
          }
          if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeEditorFrame(-1, 0); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); nudgeEditorFrame(1, 0); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); nudgeEditorFrame(0, -1); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); nudgeEditorFrame(0, 1); return; }
          if (e.code === 'KeyD') { e.preventDefault(); clearEditorSelection(true, true); return; }
          if (e.code === 'KeyA') { e.preventDefault(); selectAllEditorPixels(); return; }
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
          e.preventDefault();
          if (e.shiftKey) doRedo(); else doUndo();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
          e.preventDefault();
          doRedo();
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.code === 'KeyS') setEditorTool('marquee');
          else if (e.code === 'KeyQ') setEditorTool('lasso');
          else if (e.code === 'KeyW') setEditorTool('wand');
          else if (e.code === 'KeyV') setEditorTool('move');
          else if (e.code === 'KeyB') setEditorTool('pencil');
          else if (e.code === 'KeyE') setEditorTool('eraser');
          else if (e.code === 'KeyG') setEditorTool('fill');
          else if (e.code === 'KeyI') setEditorTool('eyedropper');
          else if (e.code === 'KeyL') setEditorTool('line');
          else if (e.code === 'KeyR') setEditorTool('rect');
          else if (e.code === 'KeyO') setEditorTool('circle');
          else if (e.code === 'KeyM') {
            toggleSymmetryEnabled();
          }
        }
      }
      return;
    }

    if (worldsModal.classList.contains('open')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeWorldsModal();
      }
      return;
    }

    if (inTextField) return;

    // Live Alt-eyedropper & Ctrl-erase cursor feedback in BUILD viewport
    if (e.key === 'Alt' && state.mode === 'BUILD' && !pointer.action) {
      e.preventDefault();
      worldStage.classList.add('eyedrop-ready');
      return;
    }
    if ((e.key === 'Control' || e.key === 'Meta') && state.mode === 'BUILD' && !pointer.action) {
      worldStage.classList.add('ctrl-erase-ready');
    }

    // World Build Undo / Redo (Ctrl+Z / Ctrl+Y) — BUILD mode only
    if (state.mode === 'BUILD' && (e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redoWorldEdit(); else undoWorldEdit();
        return;
      }
      if (e.code === 'KeyY') {
        e.preventDefault();
        redoWorldEdit();
        return;
      }
    }

    // TAB toggles full-screen UI hide/show (ignore key auto-repeat while held)
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.repeat) toggleMenusHidden();
      return;
    }

    // Escape cancels an active BUILD brush drag, closes dialogue, or deselects the held block with an animation
    if (e.key === 'Escape') {
      if (e.repeat) return;
      if (dialogueBox.classList.contains('show')) {
        e.preventDefault();
        hideDialogue();
        return;
      }
      if (pointer.action === 'rect' || pointer.action === 'line' || pointer.action === 'eraseBox') {
        e.preventDefault();
        worldHistory.activeBatch = null;
        pointer.action = null;
        updateCoordReadout();
        return;
      }
      if (state.mode === 'BUILD' && state.selectedSpriteId) {
        e.preventDefault();
        deselectHeldBlock(true);
        return;
      }
    }

    // Mode toggle (B)
    if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!e.repeat) setMode(state.mode === 'PLAY' ? 'BUILD' : 'PLAY');
      return;
    }

    // Quick respawn (R) in PLAY mode
    if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && state.mode === 'PLAY') {
      e.preventDefault();
      respawnPlayer(true, true);
      return;
    }

    // Quick BUILD brush shortcuts (1-5, active only in BUILD mode)
    if (state.mode === 'BUILD') {
      if (e.key === '1') { setBuildTool('STAMP'); return; }
      if (e.key === '2') { setBuildTool('RECT'); return; }
      if (e.key === '3') { setBuildTool('LINE'); return; }
      if (e.key === '4') { setBuildTool('ERASE'); return; }
      if (e.key === '5') { setBuildTool('SPAWN'); return; }
    }

    // Movement & Interact controls (PLAY character / BUILD camera)
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        if (e.code === 'ArrowLeft') e.preventDefault();
        keys.left = true;
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        if (e.code === 'ArrowRight') e.preventDefault();
        keys.right = true;
      } else if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (!keys.up && state.mode === 'PLAY') {
          player.jumpBufTimer = PHYS.jumpBufMax;
        }
        keys.up = true;
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        e.preventDefault();
        keys.down = true;
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (!keys.space) {
          keys.space = true;
          if (state.mode === 'PLAY') {
            if (!player.dead) interactNearby();
          } else {
            worldStage.classList.add('pan-ready');
          }
        }
      }
    }
  });

  window.addEventListener('keyup', e => {
    pointer.shiftKey = Boolean(e.shiftKey);
    pointer.ctrlKey = Boolean(e.ctrlKey || e.metaKey);
    if (editorModal.classList.contains('open')) {
      if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
        editor.modShift = e.shiftKey;
        editor.modAlt = e.altKey;
        editor.modCtrl = e.ctrlKey || e.metaKey;
        syncEditorModifierUI();
      }
    }
    if (e.key === 'Alt') {
      worldStage.classList.remove('eyedrop-ready');
    }
    if (e.key === 'Control' || e.key === 'Meta' || !pointer.ctrlKey) {
      worldStage.classList.remove('ctrl-erase-ready');
    }
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = false;
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
    else if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = false;
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = false;
    else if (e.code === 'Space') {
      keys.space = false;
      worldStage.classList.remove('pan-ready');
    }
  });

  window.addEventListener('focus', () => {
    state.windowUnfocused = false;
  });

  document.addEventListener('visibilitychange', () => {
    state.windowUnfocused = document.hidden;
    if (document.hidden) {
      if (sessionGuard.isOwner()) {
        flushEditorDraftNow(false);
        sessionGuard.touchHeartbeat();
      }
    } else {
      sessionGuard.onVisibilityResume();
    }
  });

  window.addEventListener('storage', e => {
    sessionGuard.handleStorageEvent(e);
    if (e.key === KEY_EDITOR_DRAFT) renderDraftBar();
  });

  window.addEventListener('blur', () => {
    state.windowUnfocused = true;
    editor.clipboardPreferInternal = false;
    keys.left = keys.right = keys.up = keys.down = keys.space = false;
    pointer.shiftKey = false;
    pointer.ctrlKey = false;
    worldStage.classList.remove('pan-ready', 'panning', 'eyedrop-ready', 'ctrl-erase-ready', 'erasing');
    pointer.action = null;
    if (editorModal.classList.contains('open')) {
      editor.modShift = false;
      editor.modAlt = false;
      editor.modCtrl = false;
      editor.panning = false;
      editorStageScroll.classList.remove('panning');
      syncEditorModifierUI();
    }
  });

  // Touch controls for coarse pointer devices
  document.querySelectorAll('.touch-btn').forEach(btn => {
    const k = btn.dataset.key;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (k === 'interact') {
        interactNearby();
      } else {
        if (k === 'up' && state.mode === 'PLAY') player.jumpBufTimer = PHYS.jumpBufMax;
        keys[k] = true;
      }
    });
    const release = () => {
      if (k !== 'interact') keys[k] = false;
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });
}
