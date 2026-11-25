import { SFX } from './audio.js';
import { getTypeDef, STARTER_TILE_ID, TILE } from './constants.js';
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
import { flashBuildTransportIcon, setBuildTool } from './ui/topbar.js';
import {
  clamp,
  layerForType,
  nextBrushOrient,
  normalizeOrient,
  orientLabel,
  orientToAnimAngle,
  orientToTransform,
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
  const next = nextBrushOrient(state.brushOrient);
  const isFlip = next === 4 || next === 0;
  state.brushOrient = next;
  state.brushAnim.targetAngle = orientToAnimAngle(next);
  state.brushAnim.targetScaleX = next >= 4 ? -1 : 1;
  state.brushAnim.popStart = state.uiTime;
  state.brushAnim.labelText = orientLabel(next);
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

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const snap = useAfter ? c.after : c.before;
    const prevBgId = world.layers.bg[c.key] || null;
    const nextBgId = snap.bg || null;

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
        if (nextSp && isBgEffectType(nextSp.type)) {
          startBgEffectFadeIn(c.key, nextBgId);
        }
      }
    }

    for (const layer of ['bg', 'main', 'fg']) {
      const oldId = world.layers[layer][c.key] || null;
      const newId = snap[layer] || null;
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
          if (!(layer === 'bg' && oldMeta && isBgEffectType(oldMeta.type))) {
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
          if (!(layer === 'bg' && newMeta && isBgEffectType(newMeta.type))) {
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
    runtime.activators.delete(c.key);
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
  if (worldHistory.undo.length === 0) return false;
  const changes = worldHistory.undo.pop();
  worldHistory.redo.push(changes);
  applyWorldChanges(changes, false);
  flashBuildTransportIcon('undo');
  return true;
}

export function redoWorldEdit() {
  if (worldHistory.redo.length === 0) return false;
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
      color: '#4e5668'
    };
  }
  const sp = getSpriteById(id);
  if (!sp) return null;
  if (sp.type === 'WEARABLE' || sp.type === 'HOLDABLE') return null;
  return {
    id: sp.id,
    name: sp.name,
    type: sp.type,
    subType: sp.subType,
    layer: layerForType(sp.type, sp.subType),
    canvas: sp._canvases[0] || null,
    sprite: sp,
    color: '#f28c38'
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
  if (!sp) return null;
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
  if (info.type === 'CRUMBLING') {
    const c = runtime.crumbling.get(info.key);
    return !(c && c.state === 'gone');
  }
  if (info.type === 'ACTIVATOR' && info.subType === 'DOOR') {
    return !runtime.doorsOpen.has(info.key);
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

export function isLadderTopAt(world, tx, ty) {
  return isClimbableAt(world, tx, ty) && !isClimbableAt(world, tx, ty - 1);
}

export function isOneWaySupportAt(world, tx, ty) {
  return isOneWayAt(world, tx, ty) || isLadderTopAt(world, tx, ty);
}

/* Sync runtime pools (MOVING, LIVING, DYNAMIC, SPARKLING) cleanly with placed world tiles */
export function resetRuntimeWorld(world) {
  runtime.crumbling.clear();
  runtime.moving.clear();
  runtime.living.clear();
  runtime.dynamics.clear();
  runtime.activators.clear();
  runtime.doorsOpen.clear();
  runtime.doorAnim.clear();
  runtime.collected.clear();
  runtime.interactFrames.clear();
  runtime.sparkling.length = 0;
  runtime.projectiles.length = 0;
  runtime.mount = null;
  runtime.teleportCd = 0;
  runtime.hurtCd = 0;
  runtime.hurtFlash = 0;
  runtime.holdSwingTimer = 0;
  runtime.dropThruTimer = 0;
  hideDialogue();
  syncRuntimeEntities(world, true);
}

export function syncRuntimeEntities(world, resetExisting = false) {
  const seenMov = new Set();
  const seenLiv = new Set();
  const seenDyn = new Set();
  runtime.sparkling.length = 0;

  for (const key in world.layers.main) {
    const id = world.layers.main[key];
    if (!id || id === STARTER_TILE_ID) continue;
    const sp = getSpriteById(id);
    if (!sp) continue;
    const comma = key.indexOf(',');
    const tx = parseInt(key.slice(0, comma), 10);
    const ty = parseInt(key.slice(comma + 1), 10);

    const orient = getTileOrient(world, 'main', key);

    if (sp.type === 'CHANGING' && sp.subType === 'SPARKLING') {
      runtime.sparkling.push({ tx, ty });
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
          hopPhase: (tx * 0.9 + ty * 0.5)
        });
      } else if (existing.orient !== orient) {
        existing.orient = orient;
        const flipped = orientToTransform(orient).flip;
        existing.facing = flipped ? -1 : 1;
        existing.dir = existing.facing;
      }
    } else if (sp.type === 'DYNAMIC') {
      seenDyn.add(key);
      const existing = runtime.dynamics.get(key);
      if (resetExisting || !existing) {
        runtime.dynamics.set(key, {
          key, tx, ty, id, subType: sp.subType || 'CRATE', orient,
          x: tx * TILE, y: ty * TILE, prevX: tx * TILE, prevY: ty * TILE,
          vx: 0, vy: 0, rot: 0, prevRot: 0, scaleX: 1, scaleY: 1, grounded: false
        });
      } else {
        existing.orient = orient;
      }
    }
  }

  for (const k of runtime.moving.keys()) if (!seenMov.has(k)) runtime.moving.delete(k);
  for (const k of runtime.living.keys()) if (!seenLiv.has(k)) runtime.living.delete(k);
  for (const k of runtime.dynamics.keys()) if (!seenDyn.has(k)) runtime.dynamics.delete(k);
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
  viewableTitle.textContent = sp.name || 'VIEWABLE';
  viewableCaption.textContent = sp.customText || '';
  viewableCanvas.width = sp.size;
  viewableCanvas.height = sp.size;
  vCtx.imageSmoothingEnabled = false;
  vCtx.clearRect(0, 0, sp.size, sp.size);
  if (sp._canvases[0]) vCtx.drawImage(sp._canvases[0], 0, 0);
  viewableModal.classList.add('open');
}

export function closeViewable() {
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
  let maxTy = world.spawn ? world.spawn.y : 0;
  for (const k in world.layers.main) {
    const comma = k.indexOf(',');
    if (comma !== -1) {
      const ty = parseInt(k.slice(comma + 1), 10);
      if (ty > maxTy) maxTy = ty;
    }
  }
  return (maxTy + 16) * TILE;
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

  const targetGrid = state.mode === 'BUILD' ? 1 : 0;
  camera.gridAlpha += (targetGrid - camera.gridAlpha) * (1 - Math.exp(-10 * dt));
  const targetCursorGrid = (state.mode === 'BUILD' && pointer.inWorld && !isAnyModalOpen()) ? 1 : 0;
  camera.gridCursorAlpha += (targetCursorGrid - camera.gridCursorAlpha) * (1 - Math.exp(-14 * dt));

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
  const nextOrient = normalizeOrient(orient);
  if (prevId === spriteId && prevOrient === nextOrient) return false;

  recordWorldCellBefore(world, tx, ty);
  if (meta.layer === 'bg' && prevId && prevId !== spriteId) {
    startBgEffectFadeOut(tx, ty, prevId);
  }

  world.layers[meta.layer][key] = spriteId;
  setTileOrient(world, meta.layer, key, nextOrient);

  if (meta.layer === 'bg') {
    worldFX.bgPlaceOrder.set(key, ++worldFX.bgOrderCounter);
    if (isBgEffectType(meta.type) && prevId !== spriteId) {
      startBgEffectFadeIn(key, spriteId);
    }
    invalidateBgEffectIndex();
  } else if (meta.layer === 'main') {
    runtime.crumbling.delete(key);
    runtime.activators.delete(key);
    runtime.doorsOpen.delete(key);
    runtime.collected.delete(key);
    runtime.interactFrames.delete(key);
    syncRuntimeEntities(world, false);
  }

  if (withFx) {
    worldFX.buildPops.set(`${meta.layer}:${key}`, state.uiTime);
    SFX.playPlaceBlock(meta.layer === 'bg' && isBgEffectType(meta.type));
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
  } else if (targetLayer === 'main') {
    runtime.crumbling.delete(key);
    runtime.activators.delete(key);
    runtime.doorsOpen.delete(key);
    runtime.collected.delete(key);
    runtime.interactFrames.delete(key);
    syncRuntimeEntities(world, false);
  }

  if (withFx) {
    const pal = (meta && meta.sprite && Array.isArray(meta.sprite.palette))
      ? meta.sprite.palette.filter(c => typeof c === 'string' && c.toLowerCase() !== '#000000' && c.toLowerCase() !== '#0d0e11')
      : [];
    worldFX.buildDissolves.push({
      tx,
      ty,
      startUiTime: state.uiTime,
      duration: 0.21,
      canvas: meta ? meta.canvas : null,
      orient: prevOrient,
      color: pal[0] || (meta && meta.color) || '#d8a557',
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
  if (!id || id === STARTER_TILE_ID) return false;
  const sp = getSpriteById(id);
  if (!sp || sp.type === 'WEARABLE' || sp.type === 'HOLDABLE') return false;

  const pickedOrient = getTileOrient(world, pickedLayer, key);
  state.selectedSpriteId = sp.id;
  resetBrushOrient(pickedOrient, pickedOrient !== 0);
  if (state.buildTool === 'ERASE' || state.buildTool === 'SPAWN') {
    setBuildTool('STAMP');
  }
  worldFX.cursorPickup = { startUiTime: state.uiTime, tx, ty, color: '#f28c38' };
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
  if (withFx && meta && meta.canvas) {
    const pal = (meta.sprite && Array.isArray(meta.sprite.palette))
      ? meta.sprite.palette.filter(c => typeof c === 'string' && c.toLowerCase() !== '#000000' && c.toLowerCase() !== '#0d0e11')
      : [];
    const accentCols = pal.length > 0
      ? [pal[0], pal[Math.min(1, pal.length - 1)], '#ffd48c']
      : ['#f28c38', '#ffd48c', '#fff2de'];
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
      color: accentCols[0] || meta.color || '#f28c38',
      sparks
    });
  }
  SFX.playDeselect();
  renderSidebar();
  return true;
}
