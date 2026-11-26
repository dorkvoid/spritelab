import { SFX } from '../audio.js';
import { getWireNodeMeta, JOINT_KINDS, KEY_EDITOR_DRAFT, PHYS, TILE } from '../constants.js';
import {
  dialogueBox,
  editorModal,
  editorStageScroll,
  isAnyModalOpen,
  loadingScreen,
  sceneryModal,
  sessionLockOverlay,
  showToast,
  tpSearchInput,
  typePickerModal,
  viewableModal,
  welcomeOverlay,
  worldCanvas,
  worldSearchInput,
  worldsModal,
  worldStage
} from '../dom.js';
import { flushEditorDraftNow, renderDraftBar } from '../editor/draft.js';
import { applyEditorFx, cancelEditorFx, isEditorFxOpen, openEditorFx } from '../editor/fx.js';
import { closeEditor, readSystemClipboardIntoEditor } from '../editor/io.js';
import {
  clearEditorSelection,
  copyEditorSelection,
  deleteSelectedPixels,
  editorHasSelection,
  pasteEditorClipboard,
  selectAllEditorPixels,
  writeStampToSystemClipboard
} from '../editor/selection.js';
import { editor, setEditorMsg } from '../editor/state.js';
import {
  doRedo,
  doUndo,
  nudgeEditorFrame,
  setEditorTool,
  syncEditorModifierUI,
  toggleSymmetryEnabled
} from '../editor/tools.js';
import { clearEditorCanvas, closeTypePicker } from '../editor/ui.js';
import { closeOpenCustomSelect, isCustomSelectOpen } from './selects.js';
import { interactNearby, toggleActivatorSwitch, unequipHeldItem } from '../fx.js';
import { respawnPlayer } from '../physics.js';
import {
  camera,
  getActiveWorld,
  invalidateBgEffectIndex,
  keys,
  player,
  pointer,
  runtime,
  state,
  worldFX,
  worldHistory
} from '../state.js';
import { savePrefsNow, scheduleWorldAutoSave, sessionGuard } from '../storage.js';
import { closeChatBar, openChatBar } from './chat.js';
import { closeMotionBar, navigateMotionBar, openMotionBar, triggerSelectedMotionSlot } from './motionBar.js';
import { notifyPixoEvent } from './pixo.js';
import { handleSceneryKeydown } from './scenery.js';
import { closeTopbarPopovers, setBuildTool, setMode, toggleMenusHidden, updateBlueprintUI } from './topbar.js';
import { closeWorldsModal } from './worlds.js';
import { clamp } from '../utils.js';
import {
  beginWorldBatch,
  clearTileJoints,
  clearTileWires,
  closeViewable,
  commitWorldBatch,
  deselectHeldBlock,
  eraseTileAt,
  findNearbySeat,
  findWireNearWorldPos,
  getMainTileInfo,
  getTileOrient,
  getWorldLineTiles,
  getWorldRectTiles,
  hideDialogue,
  isFullSolidAt,
  isOneWaySupportAt,
  pickupTileAt,
  placeTileAt,
  redoWorldEdit,
  removeWireAt,
  rotateHeldBrush,
  screenToWorld,
  setTileOrient,
  tileKey,
  toggleWireInvert,
  toggleWorldJoint,
  toggleWorldWire,
  undoWorldEdit,
  updateCoordReadout
} from '../world.js';

let lastManualRespawnUiTime = -10;

function findDynamicAtWorld(wx, wy) {
  let best = null;
  let bestDist = Infinity;
  for (const dyn of runtime.dynamics.values()) {
    if (dyn.exploded) continue;
    if (wx >= dyn.x - 3 && wx <= dyn.x + TILE + 3 && wy >= dyn.y - 3 && wy <= dyn.y + TILE + 3) {
      const d = Math.hypot((dyn.x + TILE * 0.5) - wx, (dyn.y + TILE * 0.5) - wy);
      if (d < bestDist) {
        bestDist = d;
        best = dyn;
      }
    }
  }
  return best;
}

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
  worldStage.classList.remove('panning', 'erasing', 'play-grabbing');
  if (e) {
    try { worldCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  if (act === 'grabDyn') {
    const g = runtime.grabbedDyn;
    runtime.grabbedDyn = null;
    if (g) {
      const dyn = runtime.dynamics.get(g.key);
      if (dyn && !dyn.exploded && !dyn.frozen) {
        dyn.vx = clamp(g.vx, -360, 360);
        dyn.vy = clamp(g.vy, -360, 360);
      }
    }
    return;
  }

  if (act === 'wire') {
    const fromKey = pointer.wireStartKey;
    pointer.wireStartKey = null;
    const toKey = tileKey(pointer.tileX, pointer.tileY);
    const world = getActiveWorld();
    if (fromKey && fromKey !== toKey) {
      pointer.wirePickKey = null;
      toggleWorldWire(world, fromKey, toKey);
    } else if (fromKey && fromKey === toKey) {
      const info = getMainTileInfo(world, pointer.tileX, pointer.tileY);
      if (pointer.wirePickKey && pointer.wirePickKey !== toKey) {
        toggleWorldWire(world, pointer.wirePickKey, toKey);
        pointer.wirePickKey = null;
      } else if (info && info.type === 'ACTIVATOR' && info.subType === 'SWITCH') {
        toggleActivatorSwitch(world, pointer.tileX, pointer.tileY);
        showToast('TEST SWITCH: ' + (runtime.activators.get(toKey) ? 'ON' : 'OFF'));
      } else if (getWireNodeMeta(info)) {
        pointer.wirePickKey = pointer.wirePickKey === toKey ? null : toKey;
        if (pointer.wirePickKey) showToast('CLICK TARGET NODE TO CONNECT');
      }
    }
    updateBlueprintUI();
    return;
  }

  if (act === 'joint') {
    const aKey = pointer.jointStartKey;
    pointer.jointStartKey = null;
    if (aKey) {
      toggleWorldJoint(getActiveWorld(), aKey, tileKey(pointer.tileX, pointer.tileY), state.jointKind);
    }
    return;
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
    notifyPixoEvent('zoom');
    savePrefsNow();
  }, { passive: false });

  worldCanvas.addEventListener('pointerdown', e => {
    if (isAnyModalOpen()) return;
    pointer.inWorld = true;
    pointer.shiftKey = e.shiftKey;
    pointer.ctrlKey = Boolean(e.ctrlKey || e.metaKey);
    updatePointerCoords(e);

    // Live quick-place / rotate / erase / eyedrop / physics grab-hand right inside PLAY mode
    if (state.mode !== 'BUILD') {
      if (e.button === 1) {
        e.preventDefault();
        if (state.selectedSpriteId) deselectHeldBlock(true);
        else pickupTileAt(pointer.tileX, pointer.tileY);
        return;
      }
      if (e.button === 2) {
        // Right-click while dragging a physics body toggles People Playground mid-air FREEZE!
        if (pointer.action === 'grabDyn' && runtime.grabbedDyn) {
          const dyn = runtime.dynamics.get(runtime.grabbedDyn.key);
          if (dyn && !dyn.exploded) {
            dyn.frozen = !dyn.frozen;
            if (dyn.frozen) { dyn.vx = 0; dyn.vy = 0; dyn.omega = 0; }
            SFX.playFreeze(dyn.frozen);
            showToast(dyn.frozen ? 'FROZEN IN AIR' : 'UNFROZEN');
          }
          return;
        }
        if (state.selectedSpriteId) {
          rotateHeldBrush();
        }
        return;
      }
      if (e.button !== 0) return;

      // Ctrl + Left click/drag erases live in PLAY mode
      if (e.ctrlKey || e.metaKey) {
        pointer.action = 'erase';
        worldStage.classList.add('erasing');
        pointer.lastTx = pointer.tileX;
        pointer.lastTy = pointer.tileY;
        beginWorldBatch();
        if (eraseTileAt(pointer.tileX, pointer.tileY)) scheduleWorldAutoSave();
        try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      // Alt + Left click eyedrops any tile into cursor in PLAY mode
      if (e.altKey) {
        pickupTileAt(pointer.tileX, pointer.tileY);
        return;
      }

      // Empty-handed Left-Click over any DYNAMIC physics body -> GRAB, LIFT & FLING!
      if (!state.selectedSpriteId) {
        const wPos = screenToWorld(pointer.screenX, pointer.screenY);
        const hitDyn = findDynamicAtWorld(wPos.wx, wPos.wy);
        if (hitDyn) {
          pointer.action = 'grabDyn';
          runtime.grabbedDyn = {
            key: hitDyn.key,
            offX: clamp(wPos.wx - hitDyn.x, 2, TILE - 2),
            offY: clamp(wPos.wy - hitDyn.y, 2, TILE - 2),
            wx: wPos.wx,
            wy: wPos.wy,
            vx: 0,
            vy: 0
          };
          runtime.hoverDynKey = hitDyn.key;
          worldStage.classList.add('play-grabbing');
          SFX.playPickup();
          try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        }
        return;
      }

      // Left click/drag stamps held creation directly into the live world
      pointer.action = 'stamp';
      pointer.lastTx = pointer.tileX;
      pointer.lastTy = pointer.tileY;
      beginWorldBatch();
      if (placeTileAt(pointer.tileX, pointer.tileY, state.selectedSpriteId, true)) scheduleWorldAutoSave();
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

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

    // Right click: cancels active drag, handles WIRE/LINK tools, rotates held block, or erases when empty-handed
    if (e.button === 2) {
      if (pointer.action === 'rect' || pointer.action === 'line' || pointer.action === 'eraseBox' || pointer.action === 'wire' || pointer.action === 'joint') {
        worldHistory.activeBatch = null;
        pointer.action = null;
        pointer.wireStartKey = null;
        pointer.jointStartKey = null;
        updateCoordReadout();
        return;
      }
      if (state.buildTool === 'WIRE') {
        const w = getActiveWorld();
        const wPos = screenToWorld(pointer.screenX, pointer.screenY);
        const hIdx = findWireNearWorldPos(w, wPos.wx, wPos.wy, 7 / Math.max(0.75, camera.zoom * 0.45));
        if (hIdx >= 0) {
          removeWireAt(w, hIdx);
        } else {
          clearTileWires(w, tileKey(pointer.tileX, pointer.tileY));
        }
        pointer.wirePickKey = null;
        updateBlueprintUI();
        return;
      }
      if (state.buildTool === 'LINK') {
        const curIdx = JOINT_KINDS.indexOf(state.jointKind);
        state.jointKind = JOINT_KINDS[(curIdx + 1) % JOINT_KINDS.length];
        SFX.playRotate(false);
        showToast('JOINT: ' + state.jointKind);
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

    // Ctrl + Left click: clears joints in LINK mode, clears wires in WIRE mode, or erases tiles
    if (e.ctrlKey || e.metaKey) {
      if (state.buildTool === 'LINK') {
        clearTileJoints(getActiveWorld(), tileKey(pointer.tileX, pointer.tileY));
        return;
      }
      if (state.buildTool === 'WIRE') {
        const w = getActiveWorld();
        const wPos = screenToWorld(pointer.screenX, pointer.screenY);
        const hIdx = findWireNearWorldPos(w, wPos.wx, wPos.wy, 7 / Math.max(0.75, camera.zoom * 0.45));
        if (hIdx >= 0) {
          removeWireAt(w, hIdx);
        } else {
          clearTileWires(w, tileKey(pointer.tileX, pointer.tileY));
        }
        pointer.wirePickKey = null;
        updateBlueprintUI();
        return;
      }
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

    // BUILD mode double-click pickup (disabled while in Blueprint WIRE mode so testing switches never picks up blocks)
    const now = performance.now();
    const prev = pointer.lastLeftClick;
    if (state.buildTool !== 'WIRE' && prev && !prev.dragged && prev.tx === tx && prev.ty === ty && (now - prev.time) < 340) {
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

    if (state.buildTool === 'WIRE') {
      const nodeInfo = getMainTileInfo(world, tx, ty);
      if (getWireNodeMeta(nodeInfo)) {
        pointer.action = 'wire';
        pointer.wireStartKey = tileKey(tx, ty);
        try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }
      const wPos = screenToWorld(pointer.screenX, pointer.screenY);
      const hIdx = findWireNearWorldPos(world, wPos.wx, wPos.wy, 7 / Math.max(0.75, camera.zoom * 0.45));
      if (hIdx >= 0) {
        toggleWireInvert(world, hIdx);
        updateBlueprintUI();
        return;
      }
      if (pointer.wirePickKey) {
        pointer.wirePickKey = null;
        return;
      }
      if (nodeInfo) {
        SFX.playError();
        showToast('NOT A WIREABLE NODE');
      }
      return;
    }

    if (state.buildTool === 'LINK') {
      pointer.action = 'joint';
      pointer.jointStartKey = tileKey(tx, ty);
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
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
      if (!state.selectedSpriteId) {
        SFX.playError();
        showToast('SELECT A SPRITE FIRST');
        return;
      }
      pointer.action = 'rect';
      pointer.dragStartTx = tx;
      pointer.dragStartTy = ty;
      updateCoordReadout();
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    if (state.buildTool === 'LINE') {
      if (!state.selectedSpriteId) {
        SFX.playError();
        showToast('SELECT A SPRITE FIRST');
        return;
      }
      pointer.action = 'line';
      pointer.dragStartTx = tx;
      pointer.dragStartTy = ty;
      updateCoordReadout();
      try { worldCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // STAMP brush
    if (!state.selectedSpriteId) {
      const hasTile = Boolean(world.layers.main[key] || world.layers.bg[key] || world.layers.fg[key]);
      if (!hasTile) {
        SFX.playError();
        showToast('SELECT A SPRITE FIRST');
      }
      return;
    }
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
    worldStage.classList.toggle('eyedrop-ready', Boolean(e.altKey && !pointer.action));
    worldStage.classList.toggle('ctrl-erase-ready', Boolean(pointer.ctrlKey && !pointer.action));
    const prevTx = pointer.tileX;
    const prevTy = pointer.tileY;
    updatePointerCoords(e);

    if (pointer.action === 'grabDyn' && runtime.grabbedDyn) {
      const wPos = screenToWorld(pointer.screenX, pointer.screenY);
      runtime.grabbedDyn.wx = wPos.wx;
      runtime.grabbedDyn.wy = wPos.wy;
      return;
    }

    // Highlight hovered DYNAMIC physics body in PLAY mode when empty-handed
    if (state.mode === 'PLAY' && !pointer.action && !state.selectedSpriteId && !pointer.ctrlKey && !e.altKey) {
      const wPos = screenToWorld(pointer.screenX, pointer.screenY);
      const hDyn = findDynamicAtWorld(wPos.wx, wPos.wy);
      runtime.hoverDynKey = hDyn ? hDyn.key : null;
      worldStage.classList.toggle('play-grab-ready', Boolean(hDyn));
    } else if (pointer.action !== 'grabDyn') {
      runtime.hoverDynKey = null;
      worldStage.classList.remove('play-grab-ready');
    }

    // Track hovered wire in Blueprint WIRE mode for click-to-invert & RMB single-wire cut
    if (state.mode === 'BUILD' && state.buildTool === 'WIRE' && !pointer.action) {
      const wPos = screenToWorld(pointer.screenX, pointer.screenY);
      pointer.hoverWireIdx = findWireNearWorldPos(getActiveWorld(), wPos.wx, wPos.wy, 7 / Math.max(0.75, camera.zoom * 0.45));
    } else {
      pointer.hoverWireIdx = -1;
    }

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
    if (loadingScreen && loadingScreen.classList.contains('open')) return;
    if (welcomeOverlay && welcomeOverlay.classList.contains('open')) return;
    SFX.unlock();
    pointer.shiftKey = Boolean(e.shiftKey);
    pointer.ctrlKey = Boolean(e.ctrlKey || e.metaKey);

    const tag = document.activeElement && document.activeElement.tagName;
    const inpType = tag === 'INPUT' ? (document.activeElement.type || '').toLowerCase() : '';
    const isTextEdit = tag === 'TEXTAREA' || (tag === 'INPUT' && inpType !== 'checkbox' && inpType !== 'radio' && inpType !== 'range' && inpType !== 'button');
    const inTextField = isTextEdit || tag === 'SELECT';

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
      if (isCustomSelectOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (closeOpenCustomSelect(true)) return;
        if (isEditorFxOpen()) {
          cancelEditorFx(false);
        } else if (editorHasSelection()) {
          clearEditorSelection(true, true);
        } else {
          closeEditor(false);
        }
        return;
      }
      if (!inTextField && e.key === 'Enter' && isEditorFxOpen()) {
        e.preventDefault();
        applyEditorFx();
        return;
      }
      // Allow Ctrl+V even when a select/checkbox/button inside the editor has focus
      if (!isTextEdit && (e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyV') {
        const tokenBefore = editor.pasteToken;
        setTimeout(async () => {
          if (!editorModal.classList.contains('open') || editor.pasteToken !== tokenBefore) return;
          const res = await readSystemClipboardIntoEditor(true);
          if (res.handled) {
            if (res.source === 'internal') pasteEditorClipboard();
          } else if (editor.clipboard) {
            pasteEditorClipboard();
          } else {
            setEditorMsg('NOTHING TO PASTE');
            SFX.playError();
          }
        }, 55);
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
        if (e.key === 'Delete' || (e.key === 'Backspace' && editorHasSelection())) {
          e.preventDefault();
          if (!e.repeat) {
            if (editorHasSelection()) {
              if (isEditorFxOpen()) cancelEditorFx(true);
              deleteSelectedPixels();
            } else {
              clearEditorCanvas();
            }
          }
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
          if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeEditorFrame(-1, 0); return; }
          if (e.key === 'ArrowRight') { e.preventDefault(); nudgeEditorFrame(1, 0); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); nudgeEditorFrame(0, -1); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); nudgeEditorFrame(0, 1); return; }
          if (e.code === 'KeyD') { e.preventDefault(); clearEditorSelection(true, true); return; }
          if (e.code === 'KeyA') { e.preventDefault(); selectAllEditorPixels(); return; }
          if (e.code === 'KeyU') { e.preventDefault(); openEditorFx('hsl'); return; }
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey) {
          if (e.code === 'KeyO') { e.preventDefault(); openEditorFx('outline'); return; }
          if (e.code === 'KeyR') { e.preventDefault(); openEditorFx('replace'); return; }
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

    if (sceneryModal && sceneryModal.classList.contains('open')) {
      handleSceneryKeydown(e, inTextField);
      return;
    }

    if (worldsModal.classList.contains('open')) {
      if (isCustomSelectOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (closeOpenCustomSelect(true)) return;
        closeWorldsModal();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF' && worldSearchInput) {
        e.preventDefault();
        worldSearchInput.focus();
        worldSearchInput.select();
        return;
      }
      return;
    }

    if (inTextField) return;

    // Live Alt-eyedropper & Ctrl-erase cursor feedback in PLAY and BUILD viewports
    if (e.key === 'Alt' && !pointer.action) {
      e.preventDefault();
      worldStage.classList.add('eyedrop-ready');
      return;
    }
    if ((e.key === 'Control' || e.key === 'Meta') && !pointer.action) {
      worldStage.classList.add('ctrl-erase-ready');
    }

    // World Undo / Redo (Ctrl+Z / Ctrl+Y) — works for both BUILD & live PLAY placements
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
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

    // Escape closes chat, motion bar, topbar popovers, cancels an active BUILD brush drag, closes dialogue, or deselects the held block
    if (e.key === 'Escape') {
      if (e.repeat) return;
      if (closeChatBar(true)) {
        e.preventDefault();
        return;
      }
      if (closeMotionBar()) {
        e.preventDefault();
        return;
      }
      if (closeTopbarPopovers()) {
        e.preventDefault();
        return;
      }
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
      if (state.mode === 'BUILD' && state.buildTool === 'WIRE') {
        e.preventDefault();
        if (pointer.wireStartKey || pointer.wirePickKey) {
          pointer.wireStartKey = null;
          pointer.wirePickKey = null;
          pointer.action = null;
        } else {
          setBuildTool('STAMP');
        }
        return;
      }
      if (state.selectedSpriteId) {
        e.preventDefault();
        deselectHeldBlock(true);
        return;
      }
      if (state.mode === 'PLAY' && state.equippedHoldableId) {
        e.preventDefault();
        unequipHeldItem();
        return;
      }
    }

    // Mode toggle (B)
    if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (!e.repeat) setMode(state.mode === 'PLAY' ? 'BUILD' : 'PLAY');
      return;
    }

    // Quick respawn (R) in PLAY mode (single press + cooldown so holding never spams or glitches the world)
    if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.altKey && state.mode === 'PLAY') {
      e.preventDefault();
      if (!e.repeat && (state.uiTime - lastManualRespawnUiTime) >= 1.0) {
        lastManualRespawnUiTime = state.uiTime;
        respawnPlayer(true, true);
      }
      return;
    }

    // Quick BUILD brush shortcuts (1-7, active only in BUILD mode)
    if (state.mode === 'BUILD') {
      if (e.key === '1') { setBuildTool('STAMP'); return; }
      if (e.key === '2') { setBuildTool('RECT'); return; }
      if (e.key === '3') { setBuildTool('LINE'); return; }
      if (e.key === '4') { setBuildTool('ERASE'); return; }
      if (e.key === '5') { setBuildTool('SPAWN'); return; }
      if (e.key === '6') { setBuildTool(state.buildTool === 'WIRE' ? 'STAMP' : 'WIRE'); return; }
      if (e.key === '7') { setBuildTool('LINK'); return; }
    }

    // Freeze / unfreeze grabbed or hovered PHYSICS block with F in PLAY mode (People Playground style!)
    if (e.code === 'KeyF' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && state.mode === 'PLAY') {
      const targetKey = (runtime.grabbedDyn && runtime.grabbedDyn.key) || runtime.hoverDynKey;
      if (targetKey) {
        const dyn = runtime.dynamics.get(targetKey);
        if (dyn && !dyn.exploded) {
          e.preventDefault();
          dyn.frozen = !dyn.frozen;
          if (dyn.frozen) { dyn.vx = 0; dyn.vy = 0; dyn.omega = 0; }
          SFX.playFreeze(dyn.frozen);
          showToast(dyn.frozen ? 'FROZEN IN AIR' : 'UNFROZEN');
          return;
        }
      }
    }

    // In-World Speech Bar (Enter or T in PLAY mode) & Holdable Stow (Q)
    if (state.mode === 'PLAY' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (state.motionBarOpen) {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
          e.preventDefault();
          navigateMotionBar(-1);
          return;
        }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') {
          e.preventDefault();
          navigateMotionBar(1);
          return;
        }
        if (e.code === 'ArrowUp' || e.code === 'KeyW') {
          e.preventDefault();
          closeMotionBar();
          return;
        }
        if (e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          if (!e.repeat) triggerSelectedMotionSlot();
          return;
        }
        if (e.key >= '1' && e.key <= '8') {
          e.preventDefault();
          if (!e.repeat) triggerSelectedMotionSlot(parseInt(e.key, 10) - 1);
          return;
        }
        if (e.code === 'KeyS' || e.code === 'ArrowDown') {
          e.preventDefault();
          return;
        }
      }

      if ((e.key === 'Enter' || e.code === 'KeyT') && !e.repeat && !player.dead) {
        e.preventDefault();
        closeMotionBar(true);
        openChatBar();
        return;
      }

      if (e.code === 'KeyQ' && !e.repeat && !player.dead && state.equippedHoldableId) {
        e.preventDefault();
        unequipHeldItem();
        return;
      }
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
        // Press Down/S on solid ground in PLAY mode to open the per-Body Motion Bar
        // (unless diving, climbing, flying, swinging, dropping through a one-way ledge, or sitting on furniture)
        if (state.mode === 'PLAY' && !e.repeat && !keys.down && !player.dead && player.grounded) {
          if (!player.inLiquid && !player.climbing && !(runtime.mount && runtime.mount.subType === 'FLYING') && !runtime.swingLine && !runtime.seated) {
            const world = getActiveWorld();
            const pLeft = Math.floor((player.x + 2) / TILE);
            const pRight = Math.floor((player.x + player.w - 3) / TILE);
            const footTy = Math.floor((player.y + player.h + 1) / TILE);
            const standingOneWay = isOneWaySupportAt(world, pLeft, footTy) || isOneWaySupportAt(world, pRight, footTy);
            const standingSolid = isFullSolidAt(world, pLeft, footTy) || isFullSolidAt(world, pRight, footTy);
            const onOneWayOnly = standingOneWay && !standingSolid;
            if (!onOneWayOnly && !findNearbySeat(world)) {
              openMotionBar();
              return;
            }
          }
        }
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
