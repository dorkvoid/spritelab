import { SFX } from './audio.js';
import {
  getBigThingIntervalSec,
  getBigThingTileMult,
  getDynamicSpec,
  getTypeDef,
  getWireNodeMeta,
  isEmergingHarmSubType,
  isGearType,
  isMovingHarmSubType,
  isWireSourceInfo,
  isWireTargetInfo,
  STARTER_TILE_ID,
  TILE
} from './constants.js';
import {
  coordPill,
  dialogueBox,
  dialogueText,
  dialogueTitle,
  isAnyModalOpen,
  showToast,
  vCtx,
  viewableCanvas,
  viewableCaption,
  viewableModal,
  viewableTitle
} from './dom.js';
import {
  camera,
  getActiveWorld,
  getSpriteById,
  invalidateBgEffectIndex,
  isBgEffectType,
  keys,
  player,
  pointer,
  runtime,
  startBgEffectFadeIn,
  startBgEffectFadeOut,
  state,
  viewport,
  worldFX,
  worldHistory
} from './state.js';
import { scheduleWorldAutoSave } from './storage.js';
import { renderSidebar } from './ui/sidebar.js';
import { notifyPixoEvent } from './ui/pixo.js';
import { flashBuildTransportIcon, setBuildTool, syncWorldToolCursorClass } from './ui/topbar.js';
import {
  clamp,
  evalEmergingHazard,
  getTileFxColors,
  layerForType,
  nextBrushOrient,
  normalizeOrient,
  orientLabel,
  orientToAnimAngle,
  orientToTransform,
  parseTileKey,
  STARTER_FX_COLORS,
  starterTileCanvas,
  transformOrientVec
} from './utils.js';

export function ensureWorldOrient(world) {
  if (!world) return null;
  if (!world.orient || typeof world.orient !== 'object') {
    world.orient = { bg: {}, main: {}, fg: {} };
  } else {
    if (!world.orient.bg) world.orient.bg = {};
    if (!world.orient.main) world.orient.main = {};
    if (!world.orient.fg) world.orient.fg = {};
  }
  return world.orient;
}

export function getTileOrient(world, layer, key) {
  if (!world || !world.orient || !world.orient[layer]) return 0;
  return normalizeOrient(world.orient[layer][key] || 0);
}

export function setTileOrient(world, layer, key, orient) {
  const oMap = ensureWorldOrient(world);
  if (!oMap || !oMap[layer]) return;
  const norm = normalizeOrient(orient);
  if (norm !== 0) oMap[layer][key] = norm;
  else delete oMap[layer][key];
}

export function resetBrushOrient(orient = 0, showBadge = false) {
  const norm = normalizeOrient(orient);
  state.brushOrient = norm;
  const ang = orientToAnimAngle(norm);
  const sx = norm >= 4 ? -1 : 1;
  state.brushAnim.angle = ang;
  state.brushAnim.targetAngle = ang;
  state.brushAnim.scaleX = sx;
  state.brushAnim.targetScaleX = sx;
  state.brushAnim.lastUiTime = state.uiTime;
  state.brushAnim.sparks = [];
  if (showBadge && norm !== 0) {
    state.brushAnim.labelText = orientLabel(norm);
    state.brushAnim.labelUntil = state.uiTime + 0.85;
  } else {
    state.brushAnim.labelUntil = -10;
    state.brushAnim.labelText = '';
  }
}

export function rotateHeldBrush() {
  if (!state.selectedSpriteId) return false;
  const heldSp = getSpriteById(state.selectedSpriteId);
  const flipOnly = Boolean(heldSp && heldSp.type === 'BIG_THING');
  const next = flipOnly ? (state.brushOrient >= 4 ? 0 : 4) : nextBrushOrient(state.brushOrient);
  const isFlip = flipOnly || next === 4 || next === 0;
  state.brushOrient = next;
  state.brushAnim.targetAngle = flipOnly ? 0 : orientToAnimAngle(next);
  state.brushAnim.targetScaleX = next >= 4 ? -1 : 1;
  state.brushAnim.popStart = state.uiTime;
  state.brushAnim.labelText = flipOnly ? (next >= 4 ? 'FLIPPED' : 'NORMAL') : orientLabel(next);
  state.brushAnim.labelUntil = state.uiTime + 0.9;
  state.brushAnim.sparks = [];
  const sparkColor = isFlip ? '#7fd3fc' : '#f28c38';
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI * 2 * i) / 6 + (isFlip ? 0 : 0.25);
    state.brushAnim.sparks.push({
      ang,
      dist: 9 + (i % 2) * 3.5,
      startUiTime: state.uiTime,
      color: sparkColor
    });
  }
  SFX.playRotate(isFlip);
  return true;
}

export function clearWorldHistory() {
  worldHistory.undo.length = 0;
  worldHistory.redo.length = 0;
  worldHistory.activeBatch = null;
}

/* Surgically remove a sprite ID from undo/redo history so deleted or converted gear (BODY/WEARABLE/HOLDABLE) can never be resurrected by Ctrl+Z */
export function pruneSpriteFromWorldHistory(spriteId) {
  if (!spriteId) return;
  const scrubStack = stack => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const batch = stack[i];
      for (let j = batch.length - 1; j >= 0; j--) {
        const ch = batch[j];
        for (const layer of ['bg', 'main', 'fg']) {
          const ok = layer + 'Orient';
          if (ch.before[layer] === spriteId) {
            ch.before[layer] = null;
            ch.before[ok] = 0;
          }
          if (ch.after[layer] === spriteId) {
            ch.after[layer] = null;
            ch.after[ok] = 0;
          }
        }
        const unchanged =
          ch.before.bg === ch.after.bg &&
          ch.before.main === ch.after.main &&
          ch.before.fg === ch.after.fg &&
          ch.before.bgOrient === ch.after.bgOrient &&
          ch.before.mainOrient === ch.after.mainOrient &&
          ch.before.fgOrient === ch.after.fgOrient;
        if (unchanged) batch.splice(j, 1);
      }
      if (batch.length === 0) stack.splice(i, 1);
    }
  };
  scrubStack(worldHistory.undo);
  scrubStack(worldHistory.redo);

  if (worldHistory.activeBatch) {
    for (const entry of worldHistory.activeBatch.values()) {
      for (const layer of ['bg', 'main', 'fg']) {
        if (entry.before[layer] === spriteId) {
          entry.before[layer] = null;
          entry.before[layer + 'Orient'] = 0;
        }
      }
    }
  }
}

/* Clean all active runtime, mount, seat, dialogue, grab, pointer & fade references when a sprite is deleted or changes type */
export function cleanupRuntimeSpriteRefs(spriteId, spriteAfter = null) {
  const result = { dismounted: false, unseated: false };
  if (!spriteId) return result;
  const isGear = Boolean(spriteAfter && isGearType(spriteAfter.type));

  // Dismount player if riding a MOUNTABLE that was deleted or converted (e.g. to BODY)
  if (runtime.mount && runtime.mount.id === spriteId) {
    if (!spriteAfter || spriteAfter.type !== 'MOUNTABLE') {
      runtime.mount = null;
      result.dismounted = true;
    } else {
      runtime.mount.subType = spriteAfter.subType || 'GROUND';
    }
  }

  // Stand player up if seated/laying on an object that was deleted, converted to gear, or lost SIT/LAY
  if (runtime.seated && runtime.seated.id === spriteId) {
    const stillSeat = Boolean(
      spriteAfter &&
      !isGear &&
      (spriteAfter.poseAction === 'SIT' || spriteAfter.poseAction === 'LAY')
    );
    if (!stillSeat) {
      runtime.seated = null;
      player.sitting = false;
      player.laying = false;
      result.unseated = true;
    } else {
      runtime.seated.mode = spriteAfter.poseAction;
      player.sitting = spriteAfter.poseAction === 'SIT';
      player.laying = spriteAfter.poseAction === 'LAY';
    }
  }

  // Release PLAY-mode grab/hover if a DYNAMIC sprite was deleted or converted
  if (!spriteAfter || spriteAfter.type !== 'DYNAMIC') {
    if (runtime.grabbedDyn) {
      const gDyn = runtime.dynamics.get(runtime.grabbedDyn.key);
      if (!gDyn || gDyn.id === spriteId) runtime.grabbedDyn = null;
    }
    if (runtime.hoverDynKey) {
      const hDyn = runtime.dynamics.get(runtime.hoverDynKey);
      if (!hDyn || hDyn.id === spriteId) runtime.hoverDynKey = null;
    }
  }

  // Close open Viewable inspection modal or Textual dialogue if source sprite changed type or was deleted
  if (runtime.activeViewableId === spriteId && (!spriteAfter || spriteAfter.type !== 'VIEWABLE')) {
    closeViewable();
  }
  if (runtime.dialogueSource) {
    const world = getActiveWorld();
    const dKey = tileKey(runtime.dialogueSource.tx, runtime.dialogueSource.ty);
    const dId = world && world.layers && world.layers.main ? world.layers.main[dKey] : null;
    const dSp = dId && dId !== STARTER_TILE_ID ? getSpriteById(dId) : null;
    if (!dSp || dSp.type !== 'TEXTUAL') {
      hideDialogue();
    }
  }

  // Scrub cached double-click snapshot so a quick double-click can't resurrect a converted gear sprite
  if (pointer.lastLeftClick && pointer.lastLeftClick.layers && (!spriteAfter || isGear)) {
    const l = pointer.lastLeftClick.layers;
    if (l.bg === spriteId || l.main === spriteId || l.fg === spriteId) {
      pointer.lastLeftClick = null;
    }
  }

  // Scrub lingering BG effect fade-outs if sprite was deleted or is no longer a BG effect
  if (!spriteAfter || isGear || !isBgEffectType(spriteAfter.type)) {
    for (let i = worldFX.bgFadeOuts.length - 1; i >= 0; i--) {
      if (worldFX.bgFadeOuts[i].id === spriteId) {
        worldFX.bgFadeOuts.splice(i, 1);
      }
    }
  }

  return result;
}

export function beginWorldBatch() {
  if (!worldHistory.activeBatch) {
    worldHistory.activeBatch = new Map();
  }
}

export function recordWorldCellBefore(world, tx, ty) {
  if (!worldHistory.activeBatch) return;
  const key = tileKey(tx, ty);
  if (worldHistory.activeBatch.has(key)) return;
  worldHistory.activeBatch.set(key, {
    tx,
    ty,
    before: {
      bg: world.layers.bg[key] || null,
      main: world.layers.main[key] || null,
      fg: world.layers.fg[key] || null,
      bgOrient: getTileOrient(world, 'bg', key),
      mainOrient: getTileOrient(world, 'main', key),
      fgOrient: getTileOrient(world, 'fg', key)
    }
  });
}

export function commitWorldBatch() {
  const batch = worldHistory.activeBatch;
  worldHistory.activeBatch = null;
  if (!batch || batch.size === 0) return;

  const world = getActiveWorld();
  const changes = [];
  for (const [key, entry] of batch.entries()) {
    const after = {
      bg: world.layers.bg[key] || null,
      main: world.layers.main[key] || null,
      fg: world.layers.fg[key] || null,
      bgOrient: getTileOrient(world, 'bg', key),
      mainOrient: getTileOrient(world, 'main', key),
      fgOrient: getTileOrient(world, 'fg', key)
    };
    if (
      entry.before.bg !== after.bg ||
      entry.before.main !== after.main ||
      entry.before.fg !== after.fg ||
      entry.before.bgOrient !== after.bgOrient ||
      entry.before.mainOrient !== after.mainOrient ||
      entry.before.fgOrient !== after.fgOrient
    ) {
      changes.push({ tx: entry.tx, ty: entry.ty, key, before: entry.before, after });
    }
  }

  if (changes.length > 0) {
    worldHistory.undo.push(changes);
    if (worldHistory.undo.length > 80) worldHistory.undo.shift();
    worldHistory.redo.length = 0;
  }
}

export function applyWorldChanges(changes, useAfter) {
  const world = getActiveWorld();
  const isRedo = Boolean(useAfter);
  const animColor = isRedo ? '#f28c38' : '#8ec8f6';
  const baseTime = state.uiTime;
  const maxAnimated = 160;
  const canAnimate = changes.length <= maxAnimated;

  // Compute spatial bounds so multi-tile undo/redo ripples smoothly across the edited region
  let minTx = Infinity;
  let maxTx = -Infinity;
  let minTy = Infinity;
  let maxTy = -Infinity;
  if (canAnimate && changes.length > 1) {
    for (let i = 0; i < changes.length; i++) {
      const ch = changes[i];
      if (ch.tx < minTx) minTx = ch.tx;
      if (ch.tx > maxTx) maxTx = ch.tx;
      if (ch.ty < minTy) minTy = ch.ty;
      if (ch.ty > maxTy) maxTy = ch.ty;
    }
  }
  const spanX = Math.max(1, maxTx - minTx);
  const spanY = Math.max(1, maxTy - minTy);
  const maxWaveDelay = Math.min(0.09, Math.max(0, (changes.length - 1) * 0.012));

  let bgChanged = false;
  let hadRestored = false;
  let hadRemoved = false;

  const resolveRestorableId = rawId => {
    if (!rawId) return null;
    if (rawId === STARTER_TILE_ID) return STARTER_TILE_ID;
    const sp = getSpriteById(rawId);
    if (!sp || isGearType(sp.type)) return null;
    return rawId;
  };

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const snap = useAfter ? c.after : c.before;
    const prevBgId = world.layers.bg[c.key] || null;
    const nextBgId = resolveRestorableId(snap.bg);

    // Directional ripple stagger: left-to-right on Redo, right-to-left on Undo
    let stagger = 0;
    if (canAnimate && changes.length > 1 && maxWaveDelay > 0) {
      const nx = (c.tx - minTx) / spanX;
      const ny = (c.ty - minTy) / spanY;
      const norm = isRedo ? (nx * 0.72 + ny * 0.28) : ((1 - nx) * 0.72 + (1 - ny) * 0.28);
      stagger = norm * maxWaveDelay;
    }
    const startUiTime = baseTime + stagger;

    if (prevBgId !== nextBgId) {
      bgChanged = true;
      if (prevBgId) {
        startBgEffectFadeOut(c.tx, c.ty, prevBgId);
        worldFX.bgPlaceOrder.delete(c.key);
      }
      if (nextBgId) {
        const nextSp = getSpriteById(nextBgId);
        worldFX.bgPlaceOrder.set(c.key, ++worldFX.bgOrderCounter);
        if (nextSp && isBgEffectType(nextSp.type, nextSp.subType)) {
          startBgEffectFadeIn(c.key, nextBgId);
        }
      }
    }

    for (const layer of ['bg', 'main', 'fg']) {
      const oldId = world.layers[layer][c.key] || null;
      const newId = resolveRestorableId(snap[layer]);
      const orientKey = layer + 'Orient';
      const oldOrient = getTileOrient(world, layer, c.key);
      const newOrient = newId ? normalizeOrient(snap[orientKey] || 0) : 0;
      if (oldId === newId && oldOrient === newOrient) continue;

      if (newId) world.layers[layer][c.key] = newId;
      else delete world.layers[layer][c.key];
      setTileOrient(world, layer, c.key, newOrient);

      if (canAnimate) {
        // Animate removed/replaced tiles smoothly shrinking & fading out with their actual sprite art
        if (oldId && oldId !== newId) {
          hadRemoved = true;
          const oldMeta = getTileMeta(oldId);
          if (!(layer === 'bg' && oldMeta && isBgEffectType(oldMeta.type, oldMeta.subType))) {
            worldFX.buildDissolves.push({
              tx: c.tx,
              ty: c.ty,
              startUiTime,
              duration: 0.22,
              canvas: oldMeta ? oldMeta.canvas : null,
              orient: oldOrient,
              color: animColor,
              kind: isRedo ? 'redo' : 'undo'
            });
          }
        }
        // Animate restored/placed/re-oriented tiles smoothly scaling & fading in with a crisp elastic settle
        if (newId) {
          hadRestored = true;
          const newMeta = getTileMeta(newId);
          if (!(layer === 'bg' && newMeta && isBgEffectType(newMeta.type, newMeta.subType))) {
            worldFX.buildPops.set(`${layer}:${c.key}`, {
              startUiTime,
              duration: 0.23,
              color: animColor,
              kind: isRedo ? 'redo' : 'undo'
            });
          }
        }
      }
    }

    runtime.crumbling.delete(c.key);
    runtime.flexOffsets.delete(c.key);
    runtime.activators.delete(c.key);
    runtime.activatedTiles.delete(c.key);
    runtime.switchOverlap.delete(c.key);
    runtime.doorsOpen.delete(c.key);
    runtime.collected.delete(c.key);
    runtime.interactFrames.delete(c.key);
  }

  if (worldFX.buildDissolves.length > 220) {
    worldFX.buildDissolves.splice(0, worldFX.buildDissolves.length - 220);
  }
  if (bgChanged) invalidateBgEffectIndex();
  syncRuntimeEntities(world, false);
  scheduleWorldAutoSave();

  if (hadRestored && !hadRemoved) SFX.playPickup();
  else if (hadRemoved && !hadRestored) SFX.playDeselect();
  else if (hadRestored || hadRemoved) SFX.playButton();
}

export function undoWorldEdit() {
  if (worldHistory.undo.length === 0) {
    SFX.playError();
    showToast('NOTHING TO UNDO');
    return false;
  }
  const changes = worldHistory.undo.pop();
  worldHistory.redo.push(changes);
  applyWorldChanges(changes, false);
  flashBuildTransportIcon('undo');
  return true;
}

export function redoWorldEdit() {
  if (worldHistory.redo.length === 0) {
    SFX.playError();
    showToast('NOTHING TO REDO');
    return false;
  }
  const changes = worldHistory.redo.pop();
  worldHistory.undo.push(changes);
  applyWorldChanges(changes, true);
  flashBuildTransportIcon('redo');
  return true;
}

/* =========================================================================
   WORLD TILE HELPERS, GEOMETRY & SPAWN MANAGEMENT
   ========================================================================= */
export function tileKey(tx, ty) {
  return `${tx},${ty}`;
}

export function getTileMeta(id) {
  if (!id) return null;
  if (id === STARTER_TILE_ID) {
    return {
      id: STARTER_TILE_ID,
      name: 'STARTER',
      type: 'SOLID',
      subType: 'SOLID',
      layer: 'main',
      canvas: starterTileCanvas,
      color: STARTER_FX_COLORS.main,
      fxColors: STARTER_FX_COLORS
    };
  }
  const sp = getSpriteById(id);
  if (!sp) return null;
  if (isGearType(sp.type)) return null;
  const fxColors = getTileFxColors(sp, '#f28c38');
  return {
    id: sp.id,
    name: sp.name,
    type: sp.type,
    subType: sp.subType,
    layer: layerForType(sp.type, sp.subType, sp.bigOpts),
    canvas: sp._canvases[0] || null,
    sprite: sp,
    color: fxColors.main,
    fxColors
  };
}

export function getMainTileInfo(world, tx, ty) {
  const key = tileKey(tx, ty);
  const id = world.layers.main[key];
  if (!id) return null;
  const orient = getTileOrient(world, 'main', key);
  if (id === STARTER_TILE_ID) {
    return { id, type: 'SOLID', subType: 'SOLID', key, sp: null, orient };
  }
  const sp = getSpriteById(id);
  if (!sp || isGearType(sp.type)) return null;
  return { id, type: sp.type, subType: sp.subType || getTypeDef(sp.type).subTypes[0], key, sp, orient };
}

export function getMainTileType(world, tx, ty) {
  const info = getMainTileInfo(world, tx, ty);
  return info ? info.type : null;
}

export function isFullSolidAt(world, tx, ty) {
  const info = getMainTileInfo(world, tx, ty);
  if (!info) return false;
  if (info.type === 'SOLID') return info.subType !== 'ONE-WAY';
  if (info.type === 'BOUNCY' || info.type === 'SLIDEY') return true;
  if (info.type === 'PUSHING' && info.subType === 'CONVEYOR') return true;
  if (info.type === 'CRUMBLING') {
    if (info.subType === 'FLEXIBLE') return true;
    const c = runtime.crumbling.get(info.key);
    return !(c && c.state === 'gone');
  }
  if (info.type === 'ACTIVATOR') {
    if (info.subType === 'DOOR') {
      return !(runtime.doorsOpen.has(info.key) || runtime.poweredTargets.has(info.key));
    }
    if (info.subType === 'PISTON') return true;
    if (info.subType === 'CHANGE') {
      const solidMode = info.sp && info.sp.actOpts && info.sp.actOpts.changeSolid;
      const isOn = runtime.activatedTiles.has(info.key) || runtime.poweredTargets.has(info.key);
      if (solidMode === 'SOLID WHEN ON') return isOn;
      if (solidMode === 'SOLID WHEN OFF') return !isOn;
    }
  }
  if (info.type === 'HARMFUL') {
    if (isMovingHarmSubType(info.subType)) return false;
    if (!(info.sp && info.sp.harmOpts && info.sp.harmOpts.solid)) return false;
    if (isEmergingHarmSubType(info.subType)) {
      return evalEmergingHazard(tx, ty, info.sp.harmOpts, info.orient, state.simTime).solidActive;
    }
    return true;
  }
  return false;
}

export function getOneWayNormalAt(world, tx, ty) {
  const info = getMainTileInfo(world, tx, ty);
  if (!info || info.type !== 'SOLID' || info.subType !== 'ONE-WAY') return null;
  return transformOrientVec(0, -1, info.orient);
}

export function isOneWayAt(world, tx, ty) {
  const n = getOneWayNormalAt(world, tx, ty);
  return Boolean(n && n.y < 0);
}

export function isOneWayCeilingAt(world, tx, ty) {
  const n = getOneWayNormalAt(world, tx, ty);
  return Boolean(n && n.y > 0);
}

export function isOneWayWallLeftAt(world, tx, ty) {
  const n = getOneWayNormalAt(world, tx, ty);
  return Boolean(n && n.x < 0);
}

export function isOneWayWallRightAt(world, tx, ty) {
  const n = getOneWayNormalAt(world, tx, ty);
  return Boolean(n && n.x > 0);
}

export function isClimbableAt(world, tx, ty) {
  const info = getMainTileInfo(world, tx, ty);
  return Boolean(info && info.type === 'CLIMBABLE');
}

export function isWalkableBackAt(world, tx, ty) {
  const bgId = world.layers.bg[tileKey(tx, ty)];
  if (!bgId || bgId === STARTER_TILE_ID) return false;
  const bgSp = getSpriteById(bgId);
  return Boolean(bgSp && bgSp.type === 'BACK' && bgSp.subType === 'WALKABLE');
}

/* Check if player AABB overlaps any climbable BACK + FRONT Big Thing (38x38 2x2 footprint) */
export function isClimbableBigThingAt(world, px, py, pw, ph) {
  if (!world || !world.layers || !world.layers.bg) return false;
  const bgMap = world.layers.bg;
  const minTx = Math.floor((px - TILE) / TILE);
  const maxTx = Math.floor((px + pw + TILE) / TILE);
  const minTy = Math.floor(py / TILE);
  const maxTy = Math.floor((py + ph) / TILE) + 1;
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const id = bgMap[tileKey(tx, ty)];
      if (!id || id === STARTER_TILE_ID) continue;
      const sp = getSpriteById(id);
      if (!sp || sp.type !== 'BIG_THING' || sp.subType !== 'BACK + FRONT') continue;
      if (!(sp.bigOpts && sp.bigOpts.climbable)) continue;
      const dw = TILE * 2;
      const dh = TILE * 2;
      const bx = tx * TILE - (dw - TILE) * 0.5;
      const by = ty * TILE - (dh - TILE);
      if (px + pw > bx + 2 && px < bx + dw - 2 && py + ph > by + 2 && py < by + dh - 2) {
        return true;
      }
    }
  }
  return false;
}

/* Resolve live cell index, cycle number & transition fade progress for a Transforming Big Thing */
export function resolveTransformingBigCell(sp, layer, key) {
  const len = (sp && sp._canvases) ? sp._canvases.length : 1;
  if (len <= 1) return { cellIdx: 0, cycleNum: 0, fadeAlpha: 1, tKey: `${layer}:${key}` };
  const opts = (sp && sp.bigOpts) || {};
  const intervalSec = getBigThingIntervalSec(opts);
  const tKey = `${layer}:${key}`;
  const tClock = state.mode === 'PLAY' ? state.simTime : state.uiTime;

  let entry = runtime.transforming.get(tKey);
  if (!entry) {
    const startPoint = opts.startPoint || 'CELL 1';
    let startCell = 0;
    let startSimTime = tClock;
    if (startPoint === 'RANDOM') {
      startCell = Math.floor(Math.random() * len);
    } else if (startPoint === 'SYNCED') {
      startSimTime = 0;
    }
    entry = {
      startSimTime,
      startCell,
      lastCell: startCell,
      transitionAt: -10,
      grantedCycle: -1
    };
    runtime.transforming.set(tKey, entry);
  }

  const elapsed = Math.max(0, tClock - entry.startSimTime);
  const steps = Math.floor(elapsed / intervalSec);
  let cellIdx;
  let cycleNum;
  if (opts.repeat !== false) {
    cellIdx = (entry.startCell + steps) % len;
    cycleNum = Math.floor((entry.startCell + steps) / len);
  } else {
    cellIdx = Math.min(len - 1, entry.startCell + steps);
    cycleNum = 0;
  }

  if (cellIdx !== entry.lastCell) {
    entry.lastCell = cellIdx;
    entry.transitionAt = state.uiTime;
  }

  let fadeAlpha = 1;
  if (opts.fx === 'FADE' && entry.transitionAt > 0) {
    const p = clamp((state.uiTime - entry.transitionAt) / 0.45, 0, 1);
    fadeAlpha = 0.25 + p * 0.75;
  }
  return { cellIdx, cycleNum, fadeAlpha, tKey, entry };
}

export function isOneWaySupportAt(world, tx, ty) {
  return isOneWayAt(world, tx, ty);
}

/* Find the closest SITTABLE or LAYABLE object overlapping or directly under the player */
export function findNearbySeat(world) {
  if (!world || !world.layers) return null;
  const cx = player.x + player.w * 0.5;
  const cy = player.y + player.h * 0.5;
  const ptx = Math.floor(cx / TILE);
  const pty = Math.floor(cy / TILE);
  const footTy = Math.floor((player.y + player.h + 1) / TILE);
  let best = null;
  let bestDist = Infinity;

  const layers = ['main', 'bg', 'fg'];
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const map = world.layers[layer];
    if (!map) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = ptx + dx;
        const ty = pty + dy;
        const key = tileKey(tx, ty);
        const id = map[key];
        if (!id || id === STARTER_TILE_ID) continue;
        const sp = getSpriteById(id);
        if (!sp || (sp.poseAction !== 'SIT' && sp.poseAction !== 'LAY')) continue;

        const isSolidSeat = layer === 'main' && isFullSolidAt(world, tx, ty);
        // Solid seats can be sat/laid on when standing right on top of them (or directly beside them)
        if (isSolidSeat) {
          if (isFullSolidAt(world, tx, ty - 1)) continue;
          const dist = Math.hypot((tx + 0.5) * TILE - cx, (ty - 0.5) * TILE - cy);
          if (dist > TILE * 1.45 && !(ty === footTy && Math.abs((tx + 0.5) * TILE - cx) <= TILE * 0.9)) continue;
          if (dist < bestDist) {
            bestDist = dist;
            best = {
              tx,
              ty,
              layer,
              key,
              id,
              sp,
              mode: sp.poseAction,
              orient: getTileOrient(world, layer, key),
              solidTop: true,
              seatX: tx * TILE,
              seatY: (ty - 1) * TILE
            };
          }
        } else {
          const dist = Math.hypot((tx + 0.5) * TILE - cx, (ty + 0.5) * TILE - cy);
          if (dist > TILE * 1.35) continue;
          if (dist < bestDist) {
            bestDist = dist;
            best = {
              tx,
              ty,
              layer,
              key,
              id,
              sp,
              mode: sp.poseAction,
              orient: getTileOrient(world, layer, key),
              solidTop: false,
              seatX: tx * TILE,
              seatY: ty * TILE
            };
          }
        }
      }
    }
  }
  return best;
}

/* Sync runtime pools (MOVING, LIVING, DYNAMIC, SPARKLING) cleanly with placed world tiles */
export function resetRuntimeWorld(world) {
  runtime.crumbling.clear();
  runtime.moving.clear();
  runtime.deadlyMoving.clear();
  runtime.living.clear();
  runtime.dynamics.clear();
  runtime.activators.clear();
  runtime.activatedTiles.clear();
  runtime.switchOverlap.clear();
  runtime.doorsOpen.clear();
  runtime.doorAnim.clear();
  runtime.pistons.clear();
  runtime.platePressed.clear();
  runtime.timerOn.clear();
  runtime.poweredTargets.clear();
  runtime.prevPoweredTargets.clear();
  runtime.exploded.clear();
  runtime.explosiveFuses.clear();
  runtime.grabbedDyn = null;
  runtime.hoverDynKey = null;
  runtime.shockwaves.length = 0;
  runtime.screenShake = 0;
  runtime.flexOffsets.clear();
  runtime.collected.clear();
  runtime.interactFrames.clear();
  runtime.sparkling.length = 0;
  runtime.bigSparklers.length = 0;
  runtime.itemThrowers.length = 0;
  runtime.projectiles.length = 0;
  runtime.mount = null;
  runtime.seated = null;
  runtime.seatCd = 0;
  runtime.seatNeedsDownRelease = false;
  runtime.swingLine = null;
  runtime.consumeCd = 0;
  runtime.activeViewableId = null;
  runtime.teleportCd = 0;
  runtime.hurtCd = 0;
  runtime.hurtFlash = 0;
  runtime.holdSwingTimer = 0;
  runtime.dropThruTimer = 0;
  runtime.proxActive.clear();
  runtime.switchTimers.clear();
  runtime.gateOutputs.clear();
  runtime.relayTimers.clear();
  runtime.poweredWires.clear();
  runtime.transforming.clear();
  hideDialogue();
  syncRuntimeEntities(world, true);
}

export function syncRuntimeEntities(world, resetExisting = false) {
  const seenMov = new Set();
  const seenDeadlyMov = new Set();
  const seenLiv = new Set();
  const seenDyn = new Set();
  const prevThrowers = new Map();
  if (!resetExisting) {
    for (let i = 0; i < runtime.itemThrowers.length; i++) {
      prevThrowers.set(runtime.itemThrowers[i].key, runtime.itemThrowers[i]);
    }
  }
  runtime.sparkling.length = 0;
  runtime.bigSparklers.length = 0;
  runtime.itemThrowers.length = 0;
  runtime.actSources.length = 0;
  runtime.actLogic.length = 0;
  runtime.actPistons.length = 0;
  runtime.actProxTargets.length = 0;
  runtime.machineOverlays.length = 0;
  let maxMainTy = (world && world.spawn && Number.isFinite(world.spawn.y)) ? world.spawn.y : 0;

  for (const key in world.layers.main) {
    const id = world.layers.main[key];
    if (!id) continue;
    const pt = parseTileKey(key);
    if (!pt) continue;
    const tx = pt.tx;
    const ty = pt.ty;
    if (ty > maxMainTy) maxMainTy = ty;
    if (id === STARTER_TILE_ID) continue;
    const sp = getSpriteById(id);
    if (!sp || isGearType(sp.type)) continue;

    const orient = getTileOrient(world, 'main', key);

    if (sp.type === 'PUSHING' && sp.subType === 'CONVEYOR') {
      runtime.machineOverlays.push({ key, tx, ty, id, type: 'PUSHING', subType: 'CONVEYOR', orient });
    } else if (sp.type === 'ACTIVATOR') {
      const sub = sp.subType || 'SWITCH';
      if (sub === 'SWITCH' || sub === 'PRESSURE PLATE' || sub === 'TIMER' || sub === 'PROXIMITY') {
        runtime.actSources.push({ key, tx, ty, id, subType: sub });
        runtime.machineOverlays.push({ key, tx, ty, id, type: 'ACTIVATOR', subType: sub, orient });
      } else if (sub === 'NOT GATE' || sub === 'AND GATE' || sub === 'OR / RELAY') {
        runtime.actLogic.push({ key, tx, ty, id, subType: sub });
        runtime.machineOverlays.push({ key, tx, ty, id, type: 'ACTIVATOR', subType: sub, orient });
      } else if (sub === 'PISTON') {
        runtime.actPistons.push({ key, tx, ty, id, orient });
        runtime.actProxTargets.push({ key, tx, ty, id, type: 'ACTIVATOR', subType: sub });
        runtime.machineOverlays.push({ key, tx, ty, id, type: 'ACTIVATOR', subType: 'PISTON', orient });
      } else if (sub === 'DOOR' || sub === 'CHANGE') {
        runtime.actProxTargets.push({ key, tx, ty, id, type: 'ACTIVATOR', subType: sub });
      }
    }

    if (sp.type === 'CHANGING' && sp.subType === 'SPARKLING') {
      runtime.sparkling.push({ tx, ty });
    } else if (sp.type === 'CHANGING' && sp.subType === 'ITEM THROWER') {
      const oldTh = prevThrowers.get(key);
      runtime.itemThrowers.push({
        key,
        tx,
        ty,
        id,
        orient,
        timer: oldTh ? oldTh.timer : (0.6 + (Math.abs(tx * 7 + ty * 11) % 7) * 0.22)
      });
    } else if (sp.type === 'MOVING') {
      seenMov.add(key);
      const existing = runtime.moving.get(key);
      if (resetExisting || !existing) {
        runtime.moving.set(key, {
          key, tx, ty, id, subType: sp.subType || 'HORIZ', orient,
          x: tx * TILE, y: ty * TILE, prevX: tx * TILE, prevY: ty * TILE, dx: 0, dy: 0
        });
      } else {
        existing.orient = orient;
      }
    } else if (sp.type === 'HARMFUL' && isMovingHarmSubType(sp.subType)) {
      seenDeadlyMov.add(key);
      const existing = runtime.deadlyMoving.get(key);
      if (resetExisting || !existing) {
        runtime.deadlyMoving.set(key, {
          key, tx, ty, id, orient,
          x: tx * TILE, y: ty * TILE, prevX: tx * TILE, prevY: ty * TILE, dx: 0, dy: 0
        });
      } else {
        existing.orient = orient;
      }
    } else if (sp.type === 'LIVING') {
      seenLiv.add(key);
      const existing = runtime.living.get(key);
      if (resetExisting || !existing) {
        const flipped = orientToTransform(orient).flip;
        const initDir = orient !== 0 ? (flipped ? -1 : 1) : ((tx + ty) % 2 === 0 ? 1 : -1);
        runtime.living.set(key, {
          key, tx, ty, id, subType: sp.subType || 'WANDER', orient,
          x: tx * TILE, y: ty * TILE, prevX: tx * TILE, prevY: ty * TILE, vx: 0, vy: 0,
          facing: initDir,
          dir: initDir,
          turnCd: 0,
          hopPhase: (tx * 0.9 + ty * 0.5),
          flipTimer: 1.4 + (Math.abs(tx * 7 + ty * 13) % 7) * 0.35,
          changeTimer: 0.9 + (Math.abs(tx * 11 + ty * 5) % 5) * 0.28,
          frameIdx: 0
        });
      } else {
        existing.subType = sp.subType || 'WANDER';
        if (existing.orient !== orient) {
          existing.orient = orient;
          const flipped = orientToTransform(orient).flip;
          existing.facing = flipped ? -1 : 1;
          existing.dir = existing.facing;
        }
      }
    } else if (sp.type === 'DYNAMIC') {
      seenDyn.add(key);
      if (sp.subType === 'EXPLOSIVE') {
        runtime.actProxTargets.push({ key, tx, ty, id, type: 'DYNAMIC', subType: 'EXPLOSIVE' });
      }
      const existing = runtime.dynamics.get(key);
      const spec = getDynamicSpec(sp.subType || 'CRATE');
      if (resetExisting || !existing) {
        runtime.dynamics.set(key, {
          key, tx, ty, id, subType: sp.subType || 'CRATE', orient,
          x: tx * TILE, y: ty * TILE, prevX: tx * TILE, prevY: ty * TILE,
          vx: 0, vy: 0, rot: 0, prevRot: 0, omega: 0,
          scaleX: 1, scaleY: 1, grounded: false, inLiquid: false,
          mass: spec.mass, frozen: false, exploded: false, powered: false,
          flameTimer: 0
        });
      } else {
        existing.orient = orient;
        existing.subType = sp.subType || 'CRATE';
        existing.mass = spec.mass;
      }
    }
  }

  runtime.abyssKillY = (maxMainTy + 16) * TILE;

  for (const k of runtime.moving.keys()) if (!seenMov.has(k)) runtime.moving.delete(k);
  for (const k of runtime.deadlyMoving.keys()) if (!seenDeadlyMov.has(k)) runtime.deadlyMoving.delete(k);
  for (const k of runtime.living.keys()) if (!seenLiv.has(k)) runtime.living.delete(k);
  for (const k of runtime.dynamics.keys()) if (!seenDyn.has(k)) runtime.dynamics.delete(k);
  if (runtime.grabbedDyn && !runtime.dynamics.has(runtime.grabbedDyn.key)) runtime.grabbedDyn = null;
  if (runtime.hoverDynKey && !runtime.dynamics.has(runtime.hoverDynKey)) runtime.hoverDynKey = null;
  for (const k of runtime.flexOffsets.keys()) if (!world.layers.main[k]) runtime.flexOffsets.delete(k);
  for (const k of runtime.pistons.keys()) if (!world.layers.main[k]) runtime.pistons.delete(k);

  // Cache BIG_THING sparkle emitters & prune stale Transforming timers across bg/fg
  const seenTr = new Set();
  for (const layer of ['bg', 'fg']) {
    const map = world.layers[layer];
    if (!map) continue;
    for (const key in map) {
      const id = map[key];
      if (!id || id === STARTER_TILE_ID) continue;
      const sp = getSpriteById(id);
      if (!sp || sp.type !== 'BIG_THING') continue;
      if (sp.subType === 'TRANSFORMING') seenTr.add(`${layer}:${key}`);
      if (sp.bigOpts && sp.bigOpts.fx === 'SPARKLE') {
        const comma = key.indexOf(',');
        runtime.bigSparklers.push({
          layer,
          key,
          tx: parseInt(key.slice(0, comma), 10),
          ty: parseInt(key.slice(comma + 1), 10),
          id,
          mult: getBigThingTileMult(sp)
        });
      }
    }
  }
  if (resetExisting) {
    runtime.transforming.clear();
  } else {
    for (const tk of runtime.transforming.keys()) {
      if (!seenTr.has(tk)) runtime.transforming.delete(tk);
    }
  }
}

/* Soft-reset all live physics bodies, TNT, pistons, and crumbling blocks back to their placed blueprint */
export function resetPhysicsRuntime(world = getActiveWorld()) {
  if (!world) return;
  runtime.crumbling.clear();
  runtime.flexOffsets.clear();
  runtime.pistons.clear();
  runtime.proxActive.clear();
  runtime.switchTimers.clear();
  runtime.gateOutputs.clear();
  runtime.relayTimers.clear();
  runtime.poweredWires.clear();
  runtime.exploded.clear();
  runtime.explosiveFuses.clear();
  runtime.projectiles.length = 0;
  runtime.shockwaves.length = 0;
  runtime.grabbedDyn = null;
  runtime.hoverDynKey = null;
  runtime.screenShake = 0;
  syncRuntimeEntities(world, true);
  SFX.playRespawn();
  showToast('PHYSICS RESET');
}

/* Shared Blueprint wire endpoint & quadratic Bezier curve geometry */
export function getWireEndpointWorldCenter(world, key, alpha = 1) {
  const dyn = runtime.dynamics.get(key);
  if (dyn && !dyn.exploded) {
    const px = dyn.prevX !== undefined ? dyn.prevX : dyn.x;
    const py = dyn.prevY !== undefined ? dyn.prevY : dyn.y;
    return { x: px + (dyn.x - px) * alpha + TILE * 0.5, y: py + (dyn.y - py) * alpha + TILE * 0.5 };
  }
  const pt = parseTileKey(key);
  if (!pt) return null;
  return { x: pt.tx * TILE + TILE * 0.5, y: pt.ty * TILE + TILE * 0.5 };
}

export function getWireCurvePoints(pa, pb) {
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = Math.min(22, Math.max(4, dist * 0.14));
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const cx = (pa.x + pb.x) * 0.5 + (horizontal ? 0 : (dy >= 0 ? bow * 0.72 : -bow * 0.72));
  const cy = (pa.y + pb.y) * 0.5 + (horizontal ? (dx >= 0 ? bow * 0.72 : -bow * 0.72) : 0);
  const mx = 0.25 * pa.x + 0.5 * cx + 0.25 * pb.x;
  const my = 0.25 * pa.y + 0.5 * cy + 0.25 * pb.y;
  return { cx, cy, mx, my };
}

export function countWireableNodes(world) {
  if (!world || !world.layers || !world.layers.main) return 0;
  let count = 0;
  const map = world.layers.main;
  for (const key in map) {
    const id = map[key];
    if (!id || id === STARTER_TILE_ID) continue;
    const sep = key.indexOf(',');
    if (sep <= 0) continue;
    const info = getMainTileInfo(world, parseInt(key.slice(0, sep), 10), parseInt(key.slice(sep + 1), 10));
    if (getWireNodeMeta(info)) count++;
  }
  return count;
}

export function findWireNearWorldPos(world, wx, wy, maxDist = 6) {
  if (!world || !Array.isArray(world.wires) || world.wires.length === 0) return -1;
  let bestIdx = -1;
  let bestDist = maxDist;
  for (let i = 0; i < world.wires.length; i++) {
    const w = world.wires[i];
    const pa = getWireEndpointWorldCenter(world, w.from, 1);
    const pb = getWireEndpointWorldCenter(world, w.to, 1);
    if (!pa || !pb) continue;
    const curve = getWireCurvePoints(pa, pb);
    // Prioritize midpoint chip slightly for easy clicking
    const md = Math.hypot(wx - curve.mx, wy - curve.my);
    if (md < bestDist + 2) {
      bestDist = Math.max(0, md - 2);
      bestIdx = i;
      continue;
    }
    const steps = 12;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const omt = 1 - t;
      const qx = omt * omt * pa.x + 2 * omt * t * curve.cx + t * t * pb.x;
      const qy = omt * omt * pa.y + 2 * omt * t * curve.cy + t * t * pb.y;
      const d = Math.hypot(wx - qx, wy - qy);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

/* Wire & Physics Joint Management (persisted in world.wires & world.joints) */
export function toggleWorldWire(world, fromKey, toKey, invert = Boolean(state.wireInvertMode)) {
  if (!world || !fromKey || !toKey || fromKey === toKey) return false;
  if (!Array.isArray(world.wires)) world.wires = [];
  const sepA = fromKey.indexOf(',');
  const sepB = toKey.indexOf(',');
  const infoA = getMainTileInfo(world, parseInt(fromKey.slice(0, sepA), 10), parseInt(fromKey.slice(sepA + 1), 10));
  const infoB = getMainTileInfo(world, parseInt(toKey.slice(0, sepB), 10), parseInt(toKey.slice(sepB + 1), 10));
  let src = fromKey;
  let dst = toKey;
  const aCanOut = isWireSourceInfo(infoA);
  const aCanIn = isWireTargetInfo(infoA);
  const bCanOut = isWireSourceInfo(infoB);
  const bCanIn = isWireTargetInfo(infoB);
  if (aCanOut && bCanIn) {
    // Respect exact drag direction (supports SRC->DST, SRC->GATE, GATE->GATE, GATE->DST)
    src = fromKey;
    dst = toKey;
  } else if (bCanOut && aCanIn) {
    src = toKey;
    dst = fromKey;
  } else {
    SFX.playError();
    showToast('WIRE A SOURCE/GATE (OUT) TO A MACHINE/GATE (IN)');
    return false;
  }
  const idx = world.wires.findIndex(w => w.from === src && w.to === dst);
  if (idx >= 0) {
    world.wires.splice(idx, 1);
    SFX.playWire(false);
    scheduleWorldAutoSave();
    showToast('WIRE REMOVED');
    return true;
  }
  const entry = { from: src, to: dst };
  if (invert) entry.invert = true;
  world.wires.push(entry);
  SFX.playWire(true);
  scheduleWorldAutoSave();
  showToast(invert ? 'WIRED (INVERTED !)' : 'WIRED CONNECTION');
  return true;
}

export function toggleWireInvert(world, idx) {
  if (!world || !Array.isArray(world.wires) || idx < 0 || idx >= world.wires.length) return false;
  const w = world.wires[idx];
  if (w.invert) delete w.invert;
  else w.invert = true;
  SFX.playWire(true);
  scheduleWorldAutoSave();
  showToast(w.invert ? 'WIRE INVERTED (!)' : 'WIRE NORMAL');
  return true;
}

export function removeWireAt(world, idx) {
  if (!world || !Array.isArray(world.wires) || idx < 0 || idx >= world.wires.length) return false;
  world.wires.splice(idx, 1);
  SFX.playWire(false);
  scheduleWorldAutoSave();
  showToast('WIRE CUT');
  return true;
}

export function clearAllWorldWires(world) {
  if (!world || !Array.isArray(world.wires) || world.wires.length === 0) return 0;
  const count = world.wires.length;
  world.wires = [];
  SFX.playWire(false);
  scheduleWorldAutoSave();
  showToast(`CLEARED ${count} WIRE${count === 1 ? '' : 'S'}`);
  return count;
}

export function clearTileWires(world, key) {
  if (!world || !Array.isArray(world.wires) || !key) return 0;
  const before = world.wires.length;
  world.wires = world.wires.filter(w => w.from !== key && w.to !== key);
  const removed = before - world.wires.length;
  if (removed > 0) {
    SFX.playWire(false);
    scheduleWorldAutoSave();
    showToast(`CLEARED ${removed} WIRE${removed === 1 ? '' : 'S'}`);
  }
  return removed;
}

export function toggleWorldJoint(world, keyA, keyB, kind = state.jointKind) {
  if (!world || !keyA || !keyB || keyA === keyB) return false;
  if (!Array.isArray(world.joints)) world.joints = [];
  const sepA = keyA.indexOf(',');
  const sepB = keyB.indexOf(',');
  const txA = parseInt(keyA.slice(0, sepA), 10);
  const tyA = parseInt(keyA.slice(sepA + 1), 10);
  const txB = parseInt(keyB.slice(0, sepB), 10);
  const tyB = parseInt(keyB.slice(sepB + 1), 10);
  const infoA = getMainTileInfo(world, txA, tyA);
  const infoB = getMainTileInfo(world, txB, tyB);
  const isDynA = Boolean(infoA && infoA.type === 'DYNAMIC');
  const isDynB = Boolean(infoB && infoB.type === 'DYNAMIC');
  if (!isDynA && !isDynB) {
    SFX.playError();
    showToast('LINK AT LEAST ONE DYNAMIC PHYSICS BLOCK');
    return false;
  }
  if (!infoA || !infoB) {
    SFX.playError();
    showToast('LINK TWO PLACED BLOCKS');
    return false;
  }
  const idx = world.joints.findIndex(j => (j.a === keyA && j.b === keyB) || (j.a === keyB && j.b === keyA));
  if (idx >= 0) {
    world.joints.splice(idx, 1);
    SFX.playWire(false);
    scheduleWorldAutoSave();
    showToast('JOINT REMOVED');
    return true;
  }
  const distPx = clamp(Math.hypot((txB - txA) * TILE, (tyB - tyA) * TILE), TILE * 0.6, TILE * 20);
  const cleanKind = (kind === 'ROD' || kind === 'SPRING') ? kind : 'ROPE';
  world.joints.push({ a: keyA, b: keyB, kind: cleanKind, len: Math.round(distPx * 10) / 10 });
  SFX.playWire(true);
  scheduleWorldAutoSave();
  showToast(`LINKED (${cleanKind})`);
  return true;
}

export function clearTileJoints(world, key) {
  if (!world || !Array.isArray(world.joints) || !key) return 0;
  const before = world.joints.length;
  world.joints = world.joints.filter(j => j.a !== key && j.b !== key);
  const removed = before - world.joints.length;
  if (removed > 0) {
    SFX.playWire(false);
    scheduleWorldAutoSave();
    showToast(`CLEARED ${removed} JOINT${removed === 1 ? '' : 'S'}`);
  }
  return removed;
}

export function showDialogue(title, text, srcTx, srcTy) {
  dialogueTitle.textContent = (title || 'TEXT').toUpperCase();
  dialogueText.textContent = text || '(EMPTY)';
  dialogueBox.classList.add('show');
  runtime.dialogueSource = { tx: srcTx, ty: srcTy };
}

export function hideDialogue() {
  dialogueBox.classList.remove('show');
  runtime.dialogueSource = null;
}

export function openViewable(sp) {
  runtime.activeViewableId = sp.id;
  viewableTitle.textContent = sp.name || 'VIEWABLE';
  viewableCaption.textContent = sp.customText || '';
  viewableCanvas.width = sp.size;
  viewableCanvas.height = sp.size;
  vCtx.imageSmoothingEnabled = false;
  vCtx.clearRect(0, 0, sp.size, sp.size);
  if (sp._canvases[0]) vCtx.drawImage(sp._canvases[0], 0, 0);
  viewableModal.classList.add('open');
}

export function updateViewableAnimation() {
  if (!runtime.activeViewableId || !viewableModal.classList.contains('open')) return;
  const sp = getSpriteById(runtime.activeViewableId);
  if (!sp || !sp._canvases || sp._canvases.length <= 1) return;
  const fps = sp.fps || 6;
  const idx = Math.floor(state.uiTime * fps) % sp._canvases.length;
  vCtx.imageSmoothingEnabled = false;
  vCtx.clearRect(0, 0, viewableCanvas.width, viewableCanvas.height);
  if (sp._canvases[idx]) vCtx.drawImage(sp._canvases[idx], 0, 0);
}

export function closeViewable() {
  runtime.activeViewableId = null;
  viewableModal.classList.remove('open');
}

export function getWorldLineTiles(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;
  let guard = 0;
  while (guard++ < 4096) {
    pts.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
  return pts;
}

export function getWorldRectTiles(x0, y0, x1, y1, hollow = false) {
  const pts = [];
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!hollow || x === minX || x === maxX || y === minY || y === maxY) {
        pts.push([x, y]);
      }
    }
  }
  return pts;
}

export function getAbyssKillY(world) {
  if (Number.isFinite(runtime.abyssKillY)) return runtime.abyssKillY;
  const spawnY = (world && world.spawn && Number.isFinite(world.spawn.y)) ? world.spawn.y : 0;
  return (spawnY + 16) * TILE;
}

/* =========================================================================
   CAMERA, WORLD/SCREEN TRANSFORMS & WORLD BUILD EDITING
   ========================================================================= */
export function screenToWorld(sx, sy) {
  const cx = viewport.width * 0.5 - camera.offsetX;
  const cy = viewport.height * 0.5 + camera.offsetY;
  return {
    wx: (sx - cx) / camera.zoom + camera.x,
    wy: (sy - cy) / camera.zoom + camera.y
  };
}

export function worldToScreen(wx, wy) {
  const cx = viewport.width * 0.5 - camera.offsetX;
  const cy = viewport.height * 0.5 + camera.offsetY;
  return {
    sx: (wx - camera.x) * camera.zoom + cx,
    sy: (wy - camera.y) * camera.zoom + cy
  };
}

export function updateCamera(dt) {
  const zoomK = 1 - Math.exp(-12 * dt);
  camera.zoom += (camera.targetZoom - camera.zoom) * zoomK;
  if (Math.abs(camera.targetZoom - camera.zoom) < 0.001) {
    camera.zoom = camera.targetZoom;
  }

  const sideW = window.innerWidth <= 760 ? 206 : 264;
  const targetOffX = state.menusHidden ? 0 : sideW * 0.5;
  const targetOffY = state.menusHidden ? 0 : 20;
  const uiK = 1 - Math.exp(-14 * dt);
  camera.offsetX += (targetOffX - camera.offsetX) * uiK;
  camera.offsetY += (targetOffY - camera.offsetY) * uiK;

  const playQuickEdit = state.mode === 'PLAY' && (Boolean(state.selectedSpriteId) || pointer.ctrlKey);
  const targetGrid = state.mode === 'BUILD' ? 1 : (playQuickEdit ? 0.65 : 0);
  camera.gridAlpha += (targetGrid - camera.gridAlpha) * (1 - Math.exp(-10 * dt));
  const targetCursorGrid = ((state.mode === 'BUILD' || playQuickEdit) && pointer.inWorld && !isAnyModalOpen()) ? 1 : 0;
  camera.gridCursorAlpha += (targetCursorGrid - camera.gridCursorAlpha) * (1 - Math.exp(-14 * dt));
  const targetBlueprint = (state.mode === 'BUILD' && state.buildTool === 'WIRE') ? 1 : 0;
  camera.blueprintAlpha += (targetBlueprint - camera.blueprintAlpha) * (1 - Math.exp(-14 * dt));
  if (Math.abs(targetBlueprint - camera.blueprintAlpha) < 0.004) camera.blueprintAlpha = targetBlueprint;

  const targetPlayerX = player.x + player.w * 0.5;
  const targetPlayerY = player.y + player.h * 0.5 - 6;

  if (state.mode === 'PLAY') {
    camera.buildRecenter = false;
    camera.panVx = 0;
    camera.panVy = 0;
    const desiredLook = clamp(player.vx * 0.16, -24, 24);
    camera.lookAheadX += (desiredLook - camera.lookAheadX) * (1 - Math.exp(-4.5 * dt));
    const followK = 1 - Math.exp(-7.5 * dt);
    camera.x += (targetPlayerX + camera.lookAheadX - camera.x) * followK;
    camera.y += (targetPlayerY - camera.y) * followK;
  } else {
    let moveX = 0;
    let moveY = 0;
    if (!isAnyModalOpen() && pointer.action !== 'pan') {
      moveX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      moveY = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    }

    if (moveX !== 0 || moveY !== 0) {
      camera.buildRecenter = false;
      if (moveX !== 0 && moveY !== 0) {
        moveX *= Math.SQRT1_2;
        moveY *= Math.SQRT1_2;
      }
    }

    if (camera.buildRecenter) {
      camera.panVx = 0;
      camera.panVy = 0;
      const recK = 1 - Math.exp(-9 * dt);
      camera.x += (targetPlayerX - camera.x) * recK;
      camera.y += (targetPlayerY - camera.y) * recK;
      if (Math.hypot(targetPlayerX - camera.x, targetPlayerY - camera.y) < 0.5) {
        camera.x = targetPlayerX;
        camera.y = targetPlayerY;
        camera.buildRecenter = false;
      }
    } else if (pointer.action === 'pan') {
      camera.panVx = 0;
      camera.panVy = 0;
    } else {
      // Zoom-aware keyboard panning in BUILD mode (Shift boosts speed)
      const baseScreenSpeed = 480;
      const speedMult = pointer.shiftKey ? 2.4 : 1.0;
      const worldSpeed = (baseScreenSpeed * speedMult) / Math.max(0.5, camera.zoom);
      const targetVx = moveX * worldSpeed;
      const targetVy = moveY * worldSpeed;
      const panK = 1 - Math.exp(-18 * dt);
      camera.panVx += (targetVx - camera.panVx) * panK;
      camera.panVy += (targetVy - camera.panVy) * panK;
      if (moveX === 0 && Math.abs(camera.panVx) < 0.5) camera.panVx = 0;
      if (moveY === 0 && Math.abs(camera.panVy) < 0.5) camera.panVy = 0;

      if (camera.panVx !== 0 || camera.panVy !== 0) {
        camera.x += camera.panVx * dt;
        camera.y += camera.panVy * dt;
        if (pointer.inWorld) {
          const w = screenToWorld(pointer.screenX, pointer.screenY);
          pointer.tileX = Math.floor(w.wx / TILE);
          pointer.tileY = Math.floor(w.wy / TILE);
          updateCoordReadout();
        }
      }
    }
  }
}

export function updateCoordReadout() {
  if (!coordPill) return;
  if (pointer.action === 'rect' || pointer.action === 'eraseBox') {
    const w = Math.abs(pointer.tileX - pointer.dragStartTx) + 1;
    const h = Math.abs(pointer.tileY - pointer.dragStartTy) + 1;
    coordPill.textContent = `${w}x${h}`;
  } else if (pointer.action === 'line') {
    const len = Math.max(Math.abs(pointer.tileX - pointer.dragStartTx), Math.abs(pointer.tileY - pointer.dragStartTy)) + 1;
    coordPill.textContent = `L:${len}`;
  } else {
    coordPill.textContent = `${pointer.tileX}, ${pointer.tileY}`;
  }
}

export function placeTileAt(tx, ty, spriteId, withFx = true, orient = state.brushOrient) {
  const meta = getTileMeta(spriteId);
  if (!meta || !meta.layer) return false;
  const world = getActiveWorld();
  const key = tileKey(tx, ty);
  const prevId = world.layers[meta.layer][key] || null;
  const prevOrient = getTileOrient(world, meta.layer, key);
  const rawNorm = normalizeOrient(orient);
  const nextOrient = meta.type === 'BIG_THING' ? (rawNorm >= 4 ? 4 : 0) : rawNorm;
  if (prevId === spriteId && prevOrient === nextOrient) return false;

  recordWorldCellBefore(world, tx, ty);
  if (meta.layer === 'bg' && prevId && prevId !== spriteId) {
    startBgEffectFadeOut(tx, ty, prevId);
  }

  world.layers[meta.layer][key] = spriteId;
  setTileOrient(world, meta.layer, key, nextOrient);

  if (meta.layer === 'bg') {
    worldFX.bgPlaceOrder.set(key, ++worldFX.bgOrderCounter);
    if (isBgEffectType(meta.type, meta.subType) && prevId !== spriteId) {
      startBgEffectFadeIn(key, spriteId);
    }
    invalidateBgEffectIndex();
    runtime.transforming.delete(`bg:${key}`);
    if (meta.type === 'BIG_THING') syncRuntimeEntities(world, false);
  } else if (meta.layer === 'fg') {
    runtime.transforming.delete(`fg:${key}`);
    if (meta.type === 'BIG_THING') syncRuntimeEntities(world, false);
  } else if (meta.layer === 'main') {
    runtime.crumbling.delete(key);
    runtime.flexOffsets.delete(key);
    runtime.activators.delete(key);
    runtime.activatedTiles.delete(key);
    runtime.switchOverlap.delete(key);
    runtime.doorsOpen.delete(key);
    runtime.collected.delete(key);
    runtime.interactFrames.delete(key);
    syncRuntimeEntities(world, false);
    // Live PLAY placement safety: if a solid block is placed overlapping the player, lift them smoothly onto it
    if (state.mode === 'PLAY' && !player.dead && isFullSolidAt(world, tx, ty)) {
      const tileL = tx * TILE;
      const tileR = tileL + TILE;
      const tileT = ty * TILE;
      const tileB = tileT + TILE;
      if (player.x + player.w > tileL + 1 && player.x < tileR - 1 && player.y + player.h > tileT + 1 && player.y < tileB - 1) {
        if (!isFullSolidAt(world, tx, ty - 1)) {
          player.y = tileT - player.h;
          player.prevY = player.y;
          player.vy = Math.min(0, player.vy);
          player.grounded = true;
        }
      }
    }
  }

  if (withFx) {
    worldFX.buildPops.set(`${meta.layer}:${key}`, state.uiTime);
    SFX.playPlaceBlock(meta.layer === 'bg' && isBgEffectType(meta.type, meta.subType));
  }
  notifyPixoEvent('placeTile');
  return true;
}

export function eraseTileAt(tx, ty, withFx = true) {
  const world = getActiveWorld();
  const key = tileKey(tx, ty);
  let targetLayer = null;
  if (world.layers.fg[key]) targetLayer = 'fg';
  else if (world.layers.main[key]) targetLayer = 'main';
  else if (world.layers.bg[key]) targetLayer = 'bg';
  if (!targetLayer) return false;

  const prevId = world.layers[targetLayer][key];
  const prevOrient = getTileOrient(world, targetLayer, key);
  const meta = getTileMeta(prevId);
  recordWorldCellBefore(world, tx, ty);
  delete world.layers[targetLayer][key];
  setTileOrient(world, targetLayer, key, 0);

  if (targetLayer === 'bg') {
    startBgEffectFadeOut(tx, ty, prevId);
    worldFX.bgPlaceOrder.delete(key);
    invalidateBgEffectIndex();
    runtime.transforming.delete(`bg:${key}`);
    if (meta && meta.type === 'BIG_THING') syncRuntimeEntities(world, false);
  } else if (targetLayer === 'fg') {
    runtime.transforming.delete(`fg:${key}`);
    if (meta && meta.type === 'BIG_THING') syncRuntimeEntities(world, false);
  } else if (targetLayer === 'main') {
    runtime.crumbling.delete(key);
    runtime.activators.delete(key);
    runtime.doorsOpen.delete(key);
    runtime.pistons.delete(key);
    runtime.platePressed.delete(key);
    runtime.timerOn.delete(key);
    runtime.exploded.delete(key);
    runtime.explosiveFuses.delete(key);
    if (runtime.grabbedDyn && runtime.grabbedDyn.key === key) runtime.grabbedDyn = null;
    runtime.collected.delete(key);
    runtime.interactFrames.delete(key);
    if (Array.isArray(world.wires)) {
      world.wires = world.wires.filter(w => w.from !== key && w.to !== key);
    }
    if (Array.isArray(world.joints)) {
      world.joints = world.joints.filter(j => j.a !== key && j.b !== key);
    }
    syncRuntimeEntities(world, false);
  }

  if (withFx) {
    const fxCols = (meta && meta.fxColors) || getTileFxColors(prevId, '#d8a557');
    worldFX.buildDissolves.push({
      tx,
      ty,
      startUiTime: state.uiTime,
      duration: 0.21,
      canvas: meta ? meta.canvas : null,
      orient: prevOrient,
      color: fxCols.main,
      secondaryColor: fxCols.secondary,
      kind: 'erase'
    });
    SFX.playCookieCrunch();
  }
  return true;
}

export function pickupTileAt(tx, ty) {
  const world = getActiveWorld();
  const key = tileKey(tx, ty);
  let pickedLayer = null;
  if (world.layers.fg[key]) pickedLayer = 'fg';
  else if (world.layers.main[key]) pickedLayer = 'main';
  else if (world.layers.bg[key]) pickedLayer = 'bg';
  if (!pickedLayer) return false;

  const id = world.layers[pickedLayer][key];
  if (!id) return false;
  if (id === STARTER_TILE_ID) {
    SFX.playError();
    showToast('CANNOT PICK UP STARTER TILE');
    return false;
  }
  const sp = getSpriteById(id);
  if (!sp || isGearType(sp.type)) return false;

  const pickedOrient = getTileOrient(world, pickedLayer, key);
  state.selectedSpriteId = sp.id;
  resetBrushOrient(pickedOrient, pickedOrient !== 0);
  if (state.mode === 'BUILD' && (state.buildTool === 'ERASE' || state.buildTool === 'SPAWN')) {
    setBuildTool('STAMP');
  }
  syncWorldToolCursorClass();
  const spFx = getTileFxColors(sp, '#f28c38');
  worldFX.cursorPickup = { startUiTime: state.uiTime, tx, ty, color: spFx.main };
  SFX.playPickup();
  renderSidebar();
  showToast('PICKED ' + sp.name + (pickedOrient !== 0 ? ' (' + orientLabel(pickedOrient) + ')' : ''));
  return true;
}

export function deselectHeldBlock(withFx = false) {
  if (!state.selectedSpriteId) return false;
  const meta = getTileMeta(state.selectedSpriteId);
  const heldOrient = state.brushOrient;
  const heldAngle = state.brushAnim.angle;
  const heldScaleX = state.brushAnim.scaleX;
  state.selectedSpriteId = null;
  resetBrushOrient(0);
  syncWorldToolCursorClass();
  if (withFx && meta && meta.canvas) {
    const fxCols = meta.fxColors || getTileFxColors(meta.sprite || meta.id, '#f28c38');
    const accentCols = [fxCols.main, fxCols.secondary, fxCols.light];
    const sparks = [];
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.32;
      sparks.push({
        ang,
        dist: 10 + Math.random() * 8,
        rise: -(2 + Math.random() * 4),
        size: i % 2 === 0 ? 1.7 : 1.3,
        delay: (i % 3) * 0.04,
        color: accentCols[i % accentCols.length]
      });
    }
    worldFX.cursorDeselects.push({
      startUiTime: state.uiTime,
      duration: 0.28,
      wx: pointer.tileX * TILE + TILE * 0.5,
      wy: pointer.tileY * TILE + TILE * 0.5,
      canvas: meta.canvas,
      orient: heldOrient,
      angle: heldAngle,
      scaleX: heldScaleX,
      color: fxCols.main,
      sparks
    });
  }
  SFX.playDeselect();
  renderSidebar();
  return true;
}
