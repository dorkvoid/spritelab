import { STARTER_TILE_ID, TILE } from './constants.js';
import { createStarterWorld } from './storage.js';
import { clamp } from './utils.js';
import { tileKey } from './world.js';

export const viewport = {
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: Math.min(window.devicePixelRatio || 1, 2)
};

/* =========================================================================
   APPLICATION STATE
   Saved sprites library starts completely empty.
   ========================================================================= */
export const state = {
  sprites: [],                // [{ id, name, type, subType, customText, size, fps, stateFps, animMode, frames, states, _canvases, _stateCanvases }]
  worlds: [],                 // [{ id, name, updatedAt, spawn:{x,y}, playerPos:{x,y}, layers:{bg,main,fg} }]
  activeWorldId: null,
  mode: 'PLAY',               // 'PLAY' | 'BUILD'
  buildTool: 'STAMP',         // 'STAMP' | 'RECT' | 'LINE' | 'ERASE' | 'SPAWN'
  sidebarFilter: 'ALL',       // 'ALL' | 'TILES' | 'BODIES'
  sidebarSearch: '',          // Live search query across sprite name & creation type/subtype
  selectedSpriteId: null,
  brushOrient: 0,             // 0..7 (0/90/180/270 CW, then horizontal flip + CCW 0/-90/-180/-270)
  brushAnim: {
    angle: 0,
    targetAngle: 0,
    scaleX: 1,
    targetScaleX: 1,
    popStart: -10,
    labelUntil: -10,
    labelText: '',
    lastUiTime: 0,
    sparks: []
  },
  equippedBodyId: null,
  activeMotionId: null,
  equippedWearableId: null,
  equippedHoldableId: null,
  windowUnfocused: false,
  menusHidden: false,
  tutorialDone: false,        // Persisted in sprite_engine_prefs_v3 so Pixo auto-starts only on first visit
  pixoTooltips: true,         // Pixo powers hover tooltips across SPRITELAB (toggleable anytime via ?)
  simTime: 0,                 // Pauses completely in BUILD mode
  uiTime: 0                   // Always runs (for UI & BUILD feedback animations)
};

/* World Build Undo/Redo History (per-world command stack for Ctrl+Z / Ctrl+Y) */
export const worldHistory = {
  undo: [],
  redo: [],
  activeBatch: null
};


/* Runtime interactive & dynamic object simulation state (resets cleanly on respawn / world switch) */
export const runtime = {
  crumbling: new Map(),       // 'tx,ty' -> { state: 'shake'|'gone', timer }
  moving: new Map(),          // 'tx,ty' -> { tx, ty, id, x, y, prevX, prevY, dx, dy, phase }
  living: new Map(),          // 'tx,ty' -> { tx, ty, id, x, y, vx, vy, facing, timer }
  dynamics: new Map(),        // 'tx,ty' -> { tx, ty, id, x, y, vx, vy, grounded }
  activators: new Map(),      // 'tx,ty' -> boolean (switch active)
  doorsOpen: new Set(),       // 'tx,ty' -> open state
  doorAnim: new Map(),        // 'tx,ty' -> smooth open progress (0..1)
  collected: new Set(),       // 'tx,ty' -> gathered
  interactFrames: new Map(),  // 'tx,ty' -> frame index
  sparkling: [],              // [{ tx, ty }] cached CHANGING (SPARKLING) tile coords
  projectiles: [],            // [{ x, y, vx, vy, life, color, bounces }]
  mount: null,                // { tx, ty, id, subType } | null
  teleportCd: 0,
  hurtCd: 0,
  hurtFlash: 0,
  holdSwingTimer: 0,
  dropThruTimer: 0,
  dialogueSource: null        // { tx, ty } | null
};

/* Player kinematic body (19x19 hitbox aligned with tile grid) */
export const player = {
  x: 0,
  y: 0,
  prevX: 0,
  prevY: 0,
  vx: 0,
  vy: 0,
  w: TILE,
  h: TILE,
  facing: 1,
  grounded: false,
  onSlip: false,
  climbing: false,
  inLiquid: false,
  swimming: false,
  swimCycle: 0,
  swimTilt: 0,
  swimBubbleTimer: 0,
  diveBubbleTimer: 0,
  liquidExitCd: 0,
  skipExitSplashTimer: 0,
  splashCd: 0,
  lastLiquidSurfaceY: 0,
  coyoteTimer: 0,
  jumpBufTimer: 0,
  jumpCutDone: false,
  landTimer: 0,
  jumpTimer: 0,
  actTimer: 0,
  respawnTimer: 0,
  runDustTimer: 0,
  stepTimer: 0,
  climbSoundTimer: 0,
  swimSoundTimer: 0,
  sitting: false,
  blinkTimer: 3.2,
  blinkDur: 0,
  climbAnimAcc: 0,
  scaleX: 1,
  scaleY: 1,
  maxBreath: 10,
  breath: 10,
  maxHealth: 100,
  health: 100,
  healthTrail: 100,
  submerged: false,
  inBreathableLiquid: false,
  breathHudAlpha: 0,
  breathFullDelay: 0,
  breathPopFx: [],            // [{ slot, timer, maxTimer }]
  healthHudAlpha: 0,
  healthFullDelay: 0,
  healthRegenDelay: 0,
  drownTickTimer: 0,
  damageFlashTimer: 0,
  damageFlashKind: 'hurt',    // 'hurt' | 'drown'
  hurtAngle: 0,
  hurtAngVel: 0,
  fallTimer: 0,
  dead: false,
  deathTimer: 0,
  deathMaxTimer: 3.0,
  deathCause: null,           // 'drown' | 'deadly' | 'harmful' | 'fall' | 'abyss'
  deathX: 0,
  deathY: 0,
  deathAngle: 0,
  deathAngVel: 0,
  deathFallRagdoll: false,
  lastSafePos: { x: 0, y: 0, valid: false }
};

/* Smooth camera with damped 1x-5x zoom, PLAY recentering, BUILD panning */
export const camera = {
  x: 9.5,
  y: -8,
  zoom: 3.0,
  targetZoom: 3.0,
  lastZoomText: '',
  lookAheadX: 0,
  initialized: false,
  gridAlpha: 0,               // Smoothly crossfades 0 (PLAY) <-> 1 (BUILD)
  gridCursorAlpha: 0,         // Fades localized radial mouse grid smoothly
  offsetX: 0,                 // Smoothly compensates for sliding sidebar
  offsetY: 0,                 // Smoothly compensates for sliding topbar
  buildRecenter: false,       // Triggered by CENTER button in BUILD mode
  panVx: 0,                   // Keyboard pan velocity X in BUILD mode
  panVy: 0                    // Keyboard pan velocity Y in BUILD mode
};

/* Input state */
export const keys = {
  left: false,
  right: false,
  up: false,
  down: false,
  space: false
};

export const pointer = {
  inWorld: false,
  screenX: 0,
  screenY: 0,
  tileX: 0,
  tileY: 0,
  action: null,               // 'stamp' | 'rect' | 'line' | 'eraseBox' | 'erase' | 'pan' | 'midPending' | null
  dragStartTx: 0,
  dragStartTy: 0,
  lastTx: 0,
  lastTy: 0,
  shiftKey: false,
  ctrlKey: false,
  lastLeftClick: null,        // { tx, ty, time, layers: { bg, main, fg }, orient: { bg, main, fg }, dragged }
  panStartScreenX: 0,
  panStartScreenY: 0,
  panStartCamX: 0,
  panStartCamY: 0
};

/* World & tile micro-animations / particle effects */
export const worldFX = {
  tileTriggers: new Map(),    // 'layer:tx,ty' -> { startTime }
  bounceTimers: new Map(),    // 'tx,ty' -> remainingSeconds (0..0.24)
  buildPops: new Map(),       // 'layer:tx,ty' -> startUiTime
  buildDissolves: [],         // [{ tx, ty, startUiTime, color }]
  bgFadeIns: new Map(),       // 'tx,ty' -> { startUiTime, duration, startAlpha }
  bgFadeOuts: [],             // [{ key, tx, ty, id, sp, startUiTime, duration, startAlpha, order }]
  bgPlaceOrder: new Map(),    // 'tx,ty' -> monotonically increasing placement order
  bgOrderCounter: 0,
  particles: [],              // [{ x, y, vx, vy, life, maxLife, color, size, gravity }]
  waterRipples: [],           // [{ x, y, timer, maxTimer, maxRx, crownH, color }]
  interactRings: [],          // [{ x, y, timer, maxTimer }]
  cursorPickup: null,         // { startUiTime, tx, ty, color }
  cursorDeselects: [],        // [{ startUiTime, wx, wy, canvas, color, sparks }]
  bodyAnim: null              // { kind: 'equip'|'swap'|'unequip', startUiTime, duration, prev, sparks }
};

export const BG_FADE_IN_DUR = 0.42;
export const BG_FADE_OUT_DUR = 0.46;

export function isBgEffectType(type) {
  return type === 'LIGHT' || type === 'ENVIRONMENT' || type === 'PLACES';
}

export function seedBgPlaceOrder(world) {
  worldFX.bgPlaceOrder.clear();
  worldFX.bgOrderCounter = 0;
  invalidateBgEffectIndex();
  if (!world || !world.layers || !world.layers.bg) return;
  for (const k in world.layers.bg) {
    worldFX.bgPlaceOrder.set(k, ++worldFX.bgOrderCounter);
  }
}

export function getBgEffectFadeIn(key) {
  const entry = worldFX.bgFadeIns.get(key);
  if (!entry) return 1;
  const p = clamp((state.uiTime - entry.startUiTime) / entry.duration, 0, 1);
  if (p >= 1) return 1;
  const ease = 1 - Math.pow(1 - p, 3);
  return entry.startAlpha + (1 - entry.startAlpha) * ease;
}

export function getBgEffectFadeOut(entry) {
  const p = clamp((state.uiTime - entry.startUiTime) / entry.duration, 0, 1);
  if (p >= 1) return 0;
  const rem = 1 - p;
  return entry.startAlpha * rem * rem;
}

export function startBgEffectFadeIn(key, spriteId) {
  let startAlpha = 0;
  for (let i = worldFX.bgFadeOuts.length - 1; i >= 0; i--) {
    const e = worldFX.bgFadeOuts[i];
    if (e.key === key && e.id === spriteId) {
      startAlpha = Math.max(startAlpha, getBgEffectFadeOut(e));
      worldFX.bgFadeOuts.splice(i, 1);
    }
  }
  worldFX.bgFadeIns.set(key, {
    startUiTime: state.uiTime,
    duration: BG_FADE_IN_DUR,
    startAlpha
  });
}

export function startBgEffectFadeOut(tx, ty, spriteId) {
  const sp = getSpriteById(spriteId);
  if (!sp || !isBgEffectType(sp.type)) return false;
  const key = tileKey(tx, ty);
  let startAlpha = getBgEffectFadeIn(key);
  worldFX.bgFadeIns.delete(key);
  const order = worldFX.bgPlaceOrder.get(key) || 0;
  for (let i = worldFX.bgFadeOuts.length - 1; i >= 0; i--) {
    const e = worldFX.bgFadeOuts[i];
    if (e.key === key && e.id === spriteId) {
      startAlpha = Math.max(startAlpha, getBgEffectFadeOut(e));
      worldFX.bgFadeOuts.splice(i, 1);
    }
  }
  if (startAlpha <= 0.002) return true;
  worldFX.bgFadeOuts.push({
    key,
    tx,
    ty,
    id: spriteId,
    sp,
    startUiTime: state.uiTime,
    duration: BG_FADE_OUT_DUR,
    startAlpha,
    order
  });
  return true;
}

export function pruneBgEffectFades() {
  for (const [key, entry] of worldFX.bgFadeIns.entries()) {
    if (state.uiTime - entry.startUiTime >= entry.duration) {
      worldFX.bgFadeIns.delete(key);
    }
  }
  for (let i = worldFX.bgFadeOuts.length - 1; i >= 0; i--) {
    const e = worldFX.bgFadeOuts[i];
    if (state.uiTime - e.startUiTime >= e.duration) {
      worldFX.bgFadeOuts.splice(i, 1);
    }
  }
}

export const spriteByIdMap = new Map();
let spriteMapSyncedLen = -1;

export const bgEffectCache = {
  world: null,
  dirty: true,
  bgLights: [],        // LIGHT (LIGHT, TOP LIGHT, FILL LIGHT) in placement order
  surroundLights: [],  // LIGHT (SURROUND LIGHT)
  lightGlows: [],      // LIGHT (LIGHT GLOW)
  envs: [],            // ENVIRONMENT
  places: []           // PLACES
};

export function invalidateBgEffectIndex() {
  bgEffectCache.dirty = true;
}

export function rebuildSpriteIndex() {
  spriteByIdMap.clear();
  for (let i = 0; i < state.sprites.length; i++) {
    const sp = state.sprites[i];
    if (sp && sp.id) spriteByIdMap.set(sp.id, sp);
  }
  spriteMapSyncedLen = state.sprites.length;
  invalidateBgEffectIndex();
}

export function getSpriteById(id) {
  if (!id) return null;
  if (spriteMapSyncedLen !== state.sprites.length) {
    rebuildSpriteIndex();
  }
  return spriteByIdMap.get(id) || null;
}

export function getBgEffectIndex(world) {
  if (!world || !world.layers || !world.layers.bg) {
    bgEffectCache.bgLights.length = 0;
    bgEffectCache.surroundLights.length = 0;
    bgEffectCache.lightGlows.length = 0;
    bgEffectCache.envs.length = 0;
    bgEffectCache.places.length = 0;
    bgEffectCache.world = null;
    bgEffectCache.dirty = true;
    return bgEffectCache;
  }
  if (!bgEffectCache.dirty && bgEffectCache.world === world) {
    return bgEffectCache;
  }

  const bgLights = bgEffectCache.bgLights;
  const surroundLights = bgEffectCache.surroundLights;
  const lightGlows = bgEffectCache.lightGlows;
  const envs = bgEffectCache.envs;
  const places = bgEffectCache.places;
  bgLights.length = 0;
  surroundLights.length = 0;
  lightGlows.length = 0;
  envs.length = 0;
  places.length = 0;

  const bg = world.layers.bg;
  for (const key in bg) {
    const id = bg[key];
    if (!id || id === STARTER_TILE_ID) continue;
    const sp = getSpriteById(id);
    if (!sp) continue;

    const type = sp.type;
    if (type !== 'LIGHT' && type !== 'ENVIRONMENT' && type !== 'PLACES') continue;

    const comma = key.indexOf(',');
    if (comma === -1) continue;
    const tx = parseInt(key.slice(0, comma), 10);
    const ty = parseInt(key.slice(comma + 1), 10);
    const entry = { key, tx, ty, id, sp, order: worldFX.bgPlaceOrder.get(key) || 0 };

    if (type === 'LIGHT') {
      if (sp.subType === 'LIGHT GLOW') lightGlows.push(entry);
      else if (sp.subType === 'SURROUND LIGHT') surroundLights.push(entry);
      else bgLights.push(entry);
    } else if (type === 'ENVIRONMENT') {
      envs.push(entry);
    } else if (type === 'PLACES') {
      places.push(entry);
    }
  }

  bgEffectCache.world = world;
  bgEffectCache.dirty = false;
  return bgEffectCache;
}

export function getActiveWorld() {
  let w = state.worlds.find(item => item.id === state.activeWorldId);
  if (!w) {
    if (state.worlds.length === 0) {
      w = createStarterWorld('WORLD 1');
      state.worlds.push(w);
    } else {
      w = state.worlds[0];
    }
    state.activeWorldId = w.id;
  }
  return w;
}
