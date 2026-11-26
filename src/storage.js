import { SFX } from './audio.js';
import {
  BODY_STATES,
  isGearType,
  KEY_PREFS,
  KEY_SESSION_HANDOFF,
  KEY_SESSION_LOCK,
  KEY_SPRITES,
  KEY_WORLDS,
  LIGHT_GLOW_SIZE,
  maxSizeForType,
  migrateLegacyType,
  MOTION_BAR_SLOTS,
  sanitizeActOpts,
  sanitizeBackOpts,
  sanitizeBigOpts,
  sanitizeEnvOpts,
  sanitizeHarmOpts,
  sanitizeLightOpts,
  sanitizeLiquidOpts,
  sanitizeMotionOpts,
  sanitizePoseAction,
  sanitizeSceneryLayer,
  sanitizeSurfaceSound,
  SCENERY_MAX_LAYERS,
  supportsPoseAction,
  supportsSurfaceSound,
  STARTER_TILE_ID,
  TILE,
  TILE_ANIM_MODES
} from './constants.js';
import {
  appRoot,
  audioPopover,
  editorModal,
  flashSavedDot,
  sceneryModal,
  sessionLockCloseBtn,
  sessionLockCloseNote,
  sessionLockMsg,
  sessionLockOverlay,
  sessionLockPixoBtn,
  sessionLockPixoImg,
  sessionLockStatus,
  sessionLockTakeoverBtn,
  sessionLockTitle,
  showToast,
  stripBar
} from './dom.js';
import { flushEditorDraftNow, renderDraftBar } from './editor/draft.js';
import { editor } from './editor/state.js';
import { closeTypePicker } from './editor/ui.js';
import { loadWorldPlayerPos } from './physics.js';
import {
  camera,
  getActiveWorld,
  getSpriteById,
  keys,
  player,
  pointer,
  rebuildSpriteIndex,
  state,
  worldFX
} from './state.js';
import { renderSidebar } from './ui/sidebar.js';
import { setBuildTool, setMode, updateAudioUI, updateTopUI } from './ui/topbar.js';
import { closeWorldsModal } from './ui/worlds.js';
import {
  clamp,
  computePixelsDominantColors,
  createEmptyPixels,
  hasAnyPixel,
  hexToRgb,
  normalizeHex,
  pixelsToCanvas,
  stripHexAlpha
} from './utils.js';
import { clearWorldHistory, closeViewable, tileKey } from './world.js';

/* Compact synchronous RLE encoding for crisp lossless localStorage persistence */
export function encodeFrame(pixels) {
  const pal = [];
  const map = new Map();
  const d = [];
  let runVal = -1;
  let runLen = 0;

  for (let i = 0; i < pixels.length; i++) {
    const hex = pixels[i];
    let idx = 0;
    if (hex) {
      let m = map.get(hex);
      if (m === undefined) {
        pal.push(hex);
        m = pal.length;
        map.set(hex, m);
      }
      idx = m;
    }
    if (idx === runVal) {
      runLen++;
    } else {
      if (runLen > 0) d.push(runVal, runLen);
      runVal = idx;
      runLen = 1;
    }
  }
  if (runLen > 0) d.push(runVal, runLen);
  return { p: pal, d };
}

export function decodeFrame(encoded, width, height = width) {
  const total = width * height;
  const out = new Array(total).fill(null);
  if (!encoded) return out;

  if (Array.isArray(encoded)) {
    for (let i = 0; i < Math.min(total, encoded.length); i++) {
      out[i] = encoded[i] ? normalizeHex(encoded[i]) : null;
    }
    return out;
  }

  if (Array.isArray(encoded.p) && Array.isArray(encoded.d)) {
    let pos = 0;
    for (let i = 0; i < encoded.d.length - 1 && pos < total; i += 2) {
      const idx = encoded.d[i];
      const count = encoded.d[i + 1];
      const hex = idx > 0 ? (encoded.p[idx - 1] || null) : null;
      const end = Math.min(total, pos + count);
      for (; pos < end; pos++) out[pos] = hex;
    }
  }
  return out;
}

let autoSaveTimer = null;

/* =========================================================================
   SINGLE-SESSION LOCK & MULTI-TAB OVERWRITE GUARD
   Ensures only one active SPRITELAB session can write to localStorage at a
   time, preventing duplicate tabs from overwriting worlds, sprites, or drafts.
   ========================================================================= */
export const sessionGuard = (() => {
  const TAB_ID = 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  const STARTED_AT = Date.now();
  const HEARTBEAT_MS = 2500;
  const LOCK_TTL_MS = 12000;

  let owner = false;
  let locked = false;
  let takingOver = false;
  let otherClosed = false;
  let heartbeatTimer = null;
  let watchTimer = null;
  let takeoverTimer = null;
  let channel = null;

  function readLock() {
    try {
      const raw = localStorage.getItem(KEY_SESSION_LOCK);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.tabId !== 'string' || !Number.isFinite(parsed.ts)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeLock(forceTakeover = false) {
    try {
      localStorage.setItem(KEY_SESSION_LOCK, JSON.stringify({
        tabId: TAB_ID,
        startedAt: STARTED_AT,
        ts: Date.now(),
        forceTakeover: Boolean(forceTakeover)
      }));
    } catch (_) {}
  }

  function clearOwnLock() {
    try {
      const cur = readLock();
      if (cur && cur.tabId === TAB_ID) {
        localStorage.removeItem(KEY_SESSION_LOCK);
      }
    } catch (_) {}
  }

  function postMsg(msg) {
    if (channel) {
      try { channel.postMessage(msg); } catch (_) {}
    }
  }

  function writeHandoffSignal(payload) {
    try {
      localStorage.setItem(KEY_SESSION_HANDOFF, JSON.stringify({ ...payload, nonce: Math.random() }));
    } catch (_) {}
  }

  let lockReason = '';
  let lockSpeechTimer = null;
  let lockPokeTimer = null;
  let lockFullSpeech = '';
  let lockMouthOpen = false;
  let lockMouthTick = 0;

  function setLockPixoPose(pose, mouthOpen = false) {
    if (sessionLockPixoBtn) {
      sessionLockPixoBtn.classList.remove('idle', 'talking', 'poked');
      if (pose === 'poked') void sessionLockPixoBtn.offsetWidth;
      sessionLockPixoBtn.classList.add(pose);
    }
    if (sessionLockPixoImg) {
      const want = mouthOpen ? 'talk' : 'idle';
      if (sessionLockPixoImg.dataset.frame !== want) {
        sessionLockPixoImg.dataset.frame = want;
        sessionLockPixoImg.src = mouthOpen ? 'assets/pixo_talk.png' : 'assets/pixo_idle.png';
      }
    }
  }

  function stopLockPixoSpeech(showFull = false) {
    clearTimeout(lockSpeechTimer);
    lockSpeechTimer = null;
    if (showFull && sessionLockMsg && lockFullSpeech) {
      sessionLockMsg.textContent = lockFullSpeech;
    }
    if (!lockPokeTimer) {
      setLockPixoPose('idle', false);
    }
  }

  function speakLockPixoMessage(text) {
    clearTimeout(lockSpeechTimer);
    lockSpeechTimer = null;
    lockFullSpeech = String(text || '');
    if (!sessionLockMsg) return;
    if (!lockFullSpeech) {
      sessionLockMsg.textContent = '';
      setLockPixoPose('idle', false);
      return;
    }
    let idx = 0;
    lockMouthOpen = true;
    lockMouthTick = 0;
    sessionLockMsg.textContent = '';
    setLockPixoPose('talking', true);

    const step = () => {
      if (!locked || !sessionLockOverlay || !sessionLockOverlay.classList.contains('open')) {
        stopLockPixoSpeech(false);
        return;
      }
      idx = Math.min(lockFullSpeech.length, idx + 2);
      sessionLockMsg.textContent = lockFullSpeech.slice(0, idx);
      lockMouthTick++;
      if (lockMouthTick % 2 === 0) {
        lockMouthOpen = !lockMouthOpen;
        if (!lockPokeTimer) setLockPixoPose('talking', lockMouthOpen);
      }
      if (idx < lockFullSpeech.length) {
        lockSpeechTimer = setTimeout(step, 22);
      } else {
        lockSpeechTimer = null;
        if (!lockPokeTimer) setLockPixoPose('idle', false);
      }
    };
    lockSpeechTimer = setTimeout(step, 40);
  }

  function updateLockOverlayUI(reason) {
    if (!sessionLockOverlay) return;
    const prevReason = lockReason;
    lockReason = reason || 'ALREADY_OPEN';
    let msgText = '';
    if (lockReason === 'TAKEN_OVER') {
      sessionLockTitle.textContent = 'HEADS UP! YOU MOVED TO ANOTHER TAB!';
      msgText = 'I SAVED AND HANDED OFF YOUR WORLDS, SPRITES, AND DRAFTS TO THE OTHER TAB SO NOTHING GETS OVERWRITTEN. CLICK BELOW IF YOU WANT TO SWITCH BACK HERE!';
      sessionLockStatus.textContent = 'SAFE STANDBY';
      sessionLockTakeoverBtn.textContent = 'SWITCH BACK TO THIS TAB';
    } else if (lockReason === 'OTHER_CLOSED') {
      sessionLockTitle.textContent = 'THE OTHER TAB JUST CLOSED!';
      msgText = 'ALL CLEAR! YOUR LATEST WORLDS AND SPRITES ARE READY TO SYNC. WANT ME TO LOAD EVERYTHING UP IN THIS TAB?';
      sessionLockStatus.textContent = 'READY TO RESUME';
      sessionLockTakeoverBtn.textContent = 'LOAD LATEST & RESUME';
    } else {
      sessionLockTitle.textContent = 'HEY! SPRITELAB IS ALREADY OPEN!';
      msgText = 'ONLY ONE SESSION IS ALLOWED AT A TIME SO OTHER TABS NEVER OVERWRITE YOUR WORLDS, SPRITES, OR DRAFTS. WANT TO PLAY IN THIS TAB INSTEAD?';
      sessionLockStatus.textContent = 'ACTIVE IN ANOTHER TAB';
      sessionLockTakeoverBtn.textContent = 'USE THIS TAB INSTEAD';
    }
    sessionLockCloseNote.textContent = '';
    if (prevReason !== lockReason || lockFullSpeech !== msgText) {
      speakLockPixoMessage(msgText);
    }
  }

  function checkLockExpiryWhileLocked() {
    if (!locked || owner || takingOver || otherClosed) return;
    const cur = readLock();
    if (!cur || cur.tabId === TAB_ID || (Date.now() - cur.ts) >= LOCK_TTL_MS) {
      otherClosed = true;
      updateLockOverlayUI('OTHER_CLOSED');
    }
  }

  function enterLockedMode(reason = 'ALREADY_OPEN') {
    owner = false;
    locked = true;
    takingOver = false;
    otherClosed = (reason === 'OTHER_CLOSED');

    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    clearTimeout(takeoverTimer);
    takeoverTimer = null;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    if (typeof editor !== 'undefined') {
      clearTimeout(editor.draftTimer);
      editor.draftTimer = null;
    }

    SFX.suspendForLock();
    keys.left = keys.right = keys.up = keys.down = keys.space = false;
    pointer.action = null;
    audioPopover.classList.remove('open');

    sessionLockOverlay.classList.add('open');
    updateLockOverlayUI(reason);

    const loadEl = document.getElementById('loadingScreen');
    if (loadEl) loadEl.classList.remove('open', 'fading');
    const startEl = document.getElementById('welcomeOverlay');
    if (startEl) startEl.classList.remove('open');

    clearInterval(watchTimer);
    watchTimer = setInterval(checkLockExpiryWhileLocked, HEARTBEAT_MS);
  }

  function reloadLatestFromStorage() {
    closeTypePicker();
    closeViewable();
    closeWorldsModal();
    if (sceneryModal && sceneryModal.classList.contains('open')) {
      sceneryModal.classList.remove('open');
    }
    if (editorModal.classList.contains('open')) {
      clearTimeout(editor.draftTimer);
      editor.draftTimer = null;
      editor.dirty = false;
      editor.playing = false;
      editor.pendingStripImg = null;
      stripBar.classList.remove('visible');
      editorModal.classList.remove('open');
    }

    state.selectedSpriteId = null;
    clearWorldHistory();
    worldFX.tileTriggers.clear();
    worldFX.bounceTimers.clear();
    worldFX.buildPops.clear();
    worldFX.particles.length = 0;

    loadAllFromStorage();
    loadWorldPlayerPos(getActiveWorld());
    setMode(state.mode, false);
    setBuildTool('STAMP');
    renderSidebar();
    renderDraftBar();
    updateTopUI();
    updateAudioUI();
  }

  function startHeartbeat(forceTakeover = false) {
    clearInterval(watchTimer);
    watchTimer = null;
    clearInterval(heartbeatTimer);
    writeLock(forceTakeover);
    heartbeatTimer = setInterval(() => {
      if (!owner) return;
      const cur = readLock();
      if (cur && cur.tabId !== TAB_ID && (Date.now() - cur.ts) < LOCK_TTL_MS) {
        if (cur.forceTakeover || cur.startedAt < STARTED_AT || (cur.startedAt === STARTED_AT && cur.tabId < TAB_ID)) {
          enterLockedMode('TAKEN_OVER');
          return;
        }
      }
      writeLock(false);
    }, HEARTBEAT_MS);
  }

  function completeTakeover(syncFromStorage = true) {
    clearTimeout(takeoverTimer);
    takeoverTimer = null;
    clearInterval(watchTimer);
    watchTimer = null;
    takingOver = false;
    locked = false;
    otherClosed = false;
    owner = true;
    startHeartbeat(true);
    postMsg({ type: 'CLAIMED', tabId: TAB_ID, startedAt: STARTED_AT, forceTakeover: true });
    clearTimeout(lockPokeTimer);
    lockPokeTimer = null;
    lockReason = '';
    lockFullSpeech = '';
    stopLockPixoSpeech(false);
    sessionLockOverlay.classList.remove('open');

    if (syncFromStorage) {
      reloadLatestFromStorage();
      showToast('SESSION ACTIVE - SYNCED LATEST DATA');
    }
    SFX.preloadYouTube();
    SFX.resumeFromLock();
  }

  function requestTakeover() {
    if (owner || takingOver) return;
    takingOver = true;
    sessionLockStatus.textContent = 'SYNCING FROM ACTIVE TAB...';

    const cur = readLock();
    const hasLiveOwner = Boolean(cur && cur.tabId !== TAB_ID && (Date.now() - cur.ts) < LOCK_TTL_MS);

    if (!hasLiveOwner || otherClosed) {
      completeTakeover(true);
      return;
    }

    // Ask the live tab to flush all state & yield cleanly before we load from storage
    const req = { type: 'TAKEOVER_REQ', from: TAB_ID, target: cur.tabId };
    postMsg(req);
    writeHandoffSignal(req);

    // Fallback timeout if the other tab is heavily background-throttled or crashed
    clearTimeout(takeoverTimer);
    takeoverTimer = setTimeout(() => {
      if (takingOver) completeTakeover(true);
    }, 320);
  }

  function handleIncoming(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.tabId === TAB_ID || msg.from === TAB_ID) return;

    if (msg.type === 'PING') {
      if (owner) {
        writeLock(false);
        postMsg({ type: 'ALIVE', tabId: TAB_ID, startedAt: STARTED_AT });
      }
      return;
    }

    if (msg.type === 'ALIVE') {
      if (!takingOver) {
        if (!owner) {
          otherClosed = false;
          enterLockedMode('ALREADY_OPEN');
        } else {
          const otherIsOlder = (msg.startedAt < STARTED_AT) || (msg.startedAt === STARTED_AT && msg.tabId < TAB_ID);
          if (otherIsOlder) {
            enterLockedMode('ALREADY_OPEN');
          }
        }
      }
      return;
    }

    if (msg.type === 'CLAIMED') {
      if (owner) {
        const otherIsOlder = (msg.startedAt < STARTED_AT) || (msg.startedAt === STARTED_AT && msg.tabId < TAB_ID);
        if (msg.forceTakeover || otherIsOlder) {
          enterLockedMode(msg.forceTakeover ? 'TAKEN_OVER' : 'ALREADY_OPEN');
        }
      } else if (locked && !takingOver) {
        const wasOtherClosed = otherClosed;
        otherClosed = false;
        if (wasOtherClosed) {
          updateLockOverlayUI('ALREADY_OPEN');
        } else if (lockReason !== 'TAKEN_OVER') {
          updateLockOverlayUI('ALREADY_OPEN');
        }
      }
      return;
    }

    if (msg.type === 'TAKEOVER_REQ') {
      if (owner) {
        // Flush all latest data while still owner, then step down cleanly
        flushEditorDraftNow(false);
        saveWorldsNow(false);
        savePrefsNow();
        clearOwnLock();
        enterLockedMode('TAKEN_OVER');
        const ack = { type: 'TAKEOVER_ACK', from: TAB_ID, to: msg.from };
        postMsg(ack);
        writeHandoffSignal(ack);
      }
      return;
    }

    if (msg.type === 'TAKEOVER_ACK') {
      if (takingOver && msg.to === TAB_ID) {
        completeTakeover(true);
      }
      return;
    }

    if (msg.type === 'RELEASED') {
      if (locked && !owner && !takingOver) {
        otherClosed = true;
        updateLockOverlayUI('OTHER_CLOSED');
      }
    }
  }

  function handleStorageEvent(e) {
    if (e.key === KEY_SESSION_HANDOFF && e.newValue) {
      try {
        handleIncoming(JSON.parse(e.newValue));
      } catch (_) {}
      return;
    }

    if (e.key === KEY_SESSION_LOCK) {
      if (!e.newValue) {
        if (locked && !owner && !takingOver) {
          otherClosed = true;
          updateLockOverlayUI('OTHER_CLOSED');
        }
        return;
      }
      try {
        const lock = JSON.parse(e.newValue);
        if (lock && lock.tabId && lock.tabId !== TAB_ID) {
          if (owner) {
            const otherIsOlder = (lock.startedAt < STARTED_AT) || (lock.startedAt === STARTED_AT && lock.tabId < TAB_ID);
            if (lock.forceTakeover || otherIsOlder) {
              enterLockedMode(lock.forceTakeover ? 'TAKEN_OVER' : 'ALREADY_OPEN');
            } else {
              // Re-assert ownership if a newer tab opened while this tab was background-throttled
              writeLock(false);
              postMsg({ type: 'ALIVE', tabId: TAB_ID, startedAt: STARTED_AT });
            }
          } else if (locked && otherClosed) {
            otherClosed = false;
            updateLockOverlayUI('ALREADY_OPEN');
          }
        }
      } catch (_) {}
    }
  }

  function touchHeartbeat() {
    if (owner) writeLock(false);
  }

  function onVisibilityResume() {
    if (owner) {
      const cur = readLock();
      if (cur && cur.tabId !== TAB_ID && (Date.now() - cur.ts) < LOCK_TTL_MS && cur.forceTakeover) {
        enterLockedMode('TAKEN_OVER');
      } else {
        writeLock(false);
      }
    } else if (locked) {
      checkLockExpiryWhileLocked();
    }
  }

  function releaseOnUnload() {
    if (!owner) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    clearOwnLock();
    postMsg({ type: 'RELEASED', from: TAB_ID });
    owner = false;
  }

  function init() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('spritelab_session_v3');
        channel.onmessage = ev => handleIncoming(ev.data);
      } catch (_) {
        channel = null;
      }
    }

    sessionLockTakeoverBtn.addEventListener('click', requestTakeover);
    sessionLockCloseBtn.addEventListener('click', () => {
      window.close();
      sessionLockCloseNote.textContent = "YOUR BROWSER WON'T LET ME CLOSE THIS TAB AUTOMATICALLY - YOU CAN SAFELY CLOSE IT OR SWITCH BACK TO THE ACTIVE ONE!";
    });
    if (sessionLockMsg) {
      sessionLockMsg.addEventListener('click', () => {
        if (lockSpeechTimer) stopLockPixoSpeech(true);
      });
    }
    if (sessionLockPixoBtn) {
      sessionLockPixoBtn.addEventListener('click', () => {
        clearTimeout(lockPokeTimer);
        setLockPixoPose('poked', true);
        lockPokeTimer = setTimeout(() => {
          lockPokeTimer = null;
          setLockPixoPose(lockSpeechTimer ? 'talking' : 'idle', Boolean(lockSpeechTimer && lockMouthOpen));
        }, 320);
      });
    }

    const existing = readLock();
    const isFreshOther = Boolean(existing && existing.tabId !== TAB_ID && (Date.now() - existing.ts) < LOCK_TTL_MS);

    if (isFreshOther) {
      enterLockedMode('ALREADY_OPEN');
      postMsg({ type: 'PING', from: TAB_ID });
      return false;
    }

    owner = true;
    locked = false;
    startHeartbeat(false);
    postMsg({ type: 'PING', from: TAB_ID });
    return true;
  }

  return {
    init,
    isOwner: () => owner && !locked,
    isLocked: () => locked,
    handleStorageEvent,
    touchHeartbeat,
    onVisibilityResume,
    releaseOnUnload
  };
})();

export function createStarterWorld(name) {
  const main = {};
  for (let tx = -5; tx <= 5; tx++) {
    main[tileKey(tx, 2)] = STARTER_TILE_ID;
  }
  return {
    id: 'w_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
    name: (name || 'WORLD 1').toUpperCase().slice(0, 24),
    updatedAt: Date.now(),
    spawn: { x: 0, y: 0 },
    playerPos: { x: 0, y: 0 },
    layers: { bg: {}, main, fg: {} },
    orient: { bg: {}, main: {}, fg: {} },
    wires: [],
    joints: [],
    scenery: { layers: [] }
  };
}

export function computeLiquidSurfaceColors(sp) {
  let r = 79;
  let g = 164;
  let b = 216;
  if (sp && sp._fxColors && sp._fxColors.rgb) {
    r = sp._fxColors.rgb.r;
    g = sp._fxColors.rgb.g;
    b = sp._fxColors.rgb.b;
  } else {
    const s = (sp && sp.size) || 19;
    const pixels = (sp && Array.isArray(sp.frames) && sp.frames[0]) ? decodeFrame(sp.frames[0], s) : null;
    const dom = computePixelsDominantColors(pixels, null);
    if (dom && dom.rgb) {
      r = dom.rgb.r;
      g = dom.rgb.g;
      b = dom.rgb.b;
    }
  }
  const mix = (c, amt) => Math.round(c + (255 - c) * amt);
  return {
    crest: `rgba(${mix(r, 0.36)}, ${mix(g, 0.36)}, ${mix(b, 0.36)}, 0.44)`,
    edge: `rgba(${mix(r, 0.20)}, ${mix(g, 0.20)}, ${mix(b, 0.20)}, 0.24)`,
    veil: `rgba(${mix(r, 0.26)}, ${mix(g, 0.26)}, ${mix(b, 0.26)}, 0.16)`,
    sub: `rgba(${mix(r, 0.12)}, ${mix(g, 0.12)}, ${mix(b, 0.12)}, 0.15)`,
    glint: `rgba(${mix(r, 0.62)}, ${mix(g, 0.62)}, ${mix(b, 0.62)}, 0.52)`
  };
}

export function computeGlowHaloRgb(pixels, fallbackHex = '#f28c38') {
  let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
  if (Array.isArray(pixels)) {
    for (let i = 0; i < pixels.length; i++) {
      const hex = pixels[i];
      if (!hex) continue;
      const rgb = hexToRgb(hex);
      const lum = (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) / 255;
      const w = Math.max(0.05, rgb.a) * (0.35 + lum * 0.9);
      rSum += rgb.r * w;
      gSum += rgb.g * w;
      bSum += rgb.b * w;
      wSum += w;
    }
  }
  if (wSum > 0.01) {
    return {
      r: clamp(Math.round(rSum / wSum), 0, 255),
      g: clamp(Math.round(gSum / wSum), 0, 255),
      b: clamp(Math.round(bSum / wSum), 0, 255)
    };
  }
  const fb = hexToRgb(fallbackHex);
  return { r: fb.r, g: fb.g, b: fb.b };
}

export function rebuildSpriteCanvases(sp) {
  const s = sp.size || 19;
  const decodedFirst = (Array.isArray(sp.frames) && sp.frames[0]) ? decodeFrame(sp.frames[0], s) : null;
  sp._canvases = (Array.isArray(sp.frames) ? sp.frames : []).map((f, idx) =>
    pixelsToCanvas(idx === 0 && decodedFirst ? decodedFirst : decodeFrame(f, s), s)
  );
  if (sp._canvases.length === 0) {
    sp._canvases = [pixelsToCanvas(createEmptyPixels(s), s)];
  }

  if (sp.type === 'BODY' && sp.subType !== 'MOTION' && sp.states) {
    sp._stateCanvases = {};
    for (const st of BODY_STATES) {
      if (Array.isArray(sp.states[st]) && sp.states[st].length > 0) {
        sp._stateCanvases[st] = sp.states[st].map(f => pixelsToCanvas(decodeFrame(f, s), s));
      }
    }
    if (!sp._stateCanvases.STAND || sp._stateCanvases.STAND.length === 0) {
      sp._stateCanvases.STAND = sp._canvases;
    }
  } else {
    sp._stateCanvases = null;
  }

  if (sp.type === 'LIGHT' && sp.subType === 'LIGHT GLOW') {
    const glowPx = decodeFrame(sp.glowFrame, LIGHT_GLOW_SIZE);
    sp._glowCanvas = hasAnyPixel(glowPx) ? pixelsToCanvas(glowPx, LIGHT_GLOW_SIZE) : null;
    sp._glowHaloRgb = sp._glowCanvas
      ? computeGlowHaloRgb(glowPx, sp.lightColor || (sp.palette && sp.palette[0]) || '#f28c38')
      : null;
  } else if (sp.type === 'HOLDABLE' && sp.subType === 'LIGHT') {
    sp._glowCanvas = null;
    sp._glowHaloRgb = computeGlowHaloRgb(decodedFirst, (sp.palette && sp.palette[0]) || '#ffe0a0');
  } else {
    sp._glowCanvas = null;
    sp._glowHaloRgb = null;
  }

  let fxCols = computePixelsDominantColors(decodedFirst, null);
  if (!fxCols && Array.isArray(sp.frames)) {
    for (let i = 1; i < sp.frames.length && !fxCols; i++) {
      fxCols = computePixelsDominantColors(decodeFrame(sp.frames[i], s), null);
    }
  }
  if (!fxCols && sp.type === 'LIGHT' && sp.subType === 'LIGHT GLOW' && sp.glowFrame) {
    fxCols = computePixelsDominantColors(decodeFrame(sp.glowFrame, LIGHT_GLOW_SIZE), null);
  }
  if (!fxCols) {
    const fb = sp.type === 'LIGHT'
      ? (sp.lightColor || (sp.palette && sp.palette[0]) || '#f28c38')
      : (sp.type === 'LIQUID' ? '#4fa4d8' : '#8a94a8');
    fxCols = computePixelsDominantColors(null, fb);
  }
  sp._fxColors = fxCols;
  sp._liquidColors = sp.type === 'LIQUID' ? computeLiquidSurfaceColors(sp) : null;
}

export function inferSpriteCreatedAt(raw, fallbackTs) {
  if (raw && Number.isFinite(Number(raw.createdAt)) && Number(raw.createdAt) > 0) {
    return Number(raw.createdAt);
  }
  if (raw && typeof raw.id === 'string') {
    const m = raw.id.match(/^sp_(\d{10,})_/);
    if (m) {
      const parsed = parseInt(m[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return fallbackTs;
}

export function sanitizeSprite(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nowTs = Date.now();
  const migrated = migrateLegacyType(raw.type, raw.subType);
  const type = migrated.type;
  const subType = migrated.subType;
  const maxSz = maxSizeForType(type, subType);
  const size = clamp(Math.round(Number(raw.size)) || (type === 'BIG_THING' ? maxSz : 19), 8, maxSz);
  const customText = typeof raw.customText === 'string' ? raw.customText.slice(0, 120) : '';
  const fps = clamp(parseInt(raw.fps, 10) || 6, 1, 24);
  const animMode = TILE_ANIM_MODES.includes(raw.animMode) ? raw.animMode : 'LOOP';
  const frames = Array.isArray(raw.frames) && raw.frames.length > 0
    ? raw.frames
    : [encodeFrame(createEmptyPixels(size))];

  const palette = Array.isArray(raw.palette)
    ? raw.palette.map(normalizeHex).filter(Boolean).slice(0, 64)
    : undefined;

  let lightColor;
  let lightOpts;
  let glowFrame;
  if (type === 'LIGHT') {
    lightColor = stripHexAlpha(raw.lightColor) || (palette && stripHexAlpha(palette[0])) || '#f28c38';
    lightOpts = sanitizeLightOpts(raw.lightOpts);
    if (subType === 'LIGHT GLOW') {
      glowFrame = raw.glowFrame || encodeFrame(createEmptyPixels(LIGHT_GLOW_SIZE));
    }
  }

  const envOpts = type === 'ENVIRONMENT' ? sanitizeEnvOpts(raw.envOpts) : undefined;
  const liquidOpts = type === 'LIQUID' ? sanitizeLiquidOpts(raw.liquidOpts) : undefined;
  const harmOpts = type === 'HARMFUL' ? sanitizeHarmOpts(raw.harmOpts) : undefined;
  const actOpts = type === 'ACTIVATOR' ? sanitizeActOpts(raw.actOpts) : undefined;
  const backOpts = type === 'BACK' ? sanitizeBackOpts(raw.backOpts) : undefined;
  const motionOpts = (type === 'BODY' && subType === 'MOTION') ? sanitizeMotionOpts(raw.motionOpts) : undefined;
  let bigOpts;
  if (type === 'BIG_THING') {
    bigOpts = sanitizeBigOpts(raw.bigOpts);
    if (raw.subType === 'FRONT 2X2' && !raw.bigOpts) {
      bigOpts.placement = 'IN FRONT';
    }
  }
  const rawSound = supportsSurfaceSound(type) ? sanitizeSurfaceSound(raw.surfaceSound) : 'DEFAULT';
  const surfaceSound = rawSound !== 'DEFAULT' ? rawSound : undefined;
  const rawPose = supportsPoseAction(type) ? sanitizePoseAction(raw.poseAction) : 'NONE';
  const poseAction = rawPose !== 'NONE' ? rawPose : undefined;

  let states;
  let stateFps;
  if (type === 'BODY' && subType !== 'MOTION') {
    states = {};
    stateFps = {};
    const srcStates = (raw.states && typeof raw.states === 'object') ? raw.states : {};
    const srcStateFps = (raw.stateFps && typeof raw.stateFps === 'object') ? raw.stateFps : {};
    for (const st of BODY_STATES) {
      if (Array.isArray(srcStates[st]) && srcStates[st].length > 0) {
        states[st] = srcStates[st];
      } else if (st === 'STAND') {
        states.STAND = frames;
      }
      stateFps[st] = clamp(parseInt(srcStateFps[st], 10) || fps, 1, 24);
    }
  }

  const id = (typeof raw.id === 'string' && raw.id.trim())
    ? raw.id.trim()
    : ('sp_' + nowTs + '_' + Math.floor(Math.random() * 9999));

  const sp = {
    id,
    createdAt: inferSpriteCreatedAt({ id, createdAt: raw.createdAt }, nowTs),
    name: (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'SPRITE').toUpperCase().slice(0, 20),
    type,
    subType,
    customText,
    size,
    fps,
    stateFps,
    animMode,
    frames,
    states,
    palette,
    lightColor,
    lightOpts,
    glowFrame,
    envOpts,
    liquidOpts,
    harmOpts,
    actOpts,
    backOpts,
    bigOpts,
    motionOpts,
    surfaceSound,
    poseAction
  };
  rebuildSpriteCanvases(sp);
  return sp;
}

export function sanitizeWorld(raw, fallbackIdx = 1) {
  if (!raw || typeof raw !== 'object') {
    return createStarterWorld('WORLD ' + fallbackIdx);
  }
  const spawnX = raw.spawn && Number.isFinite(Number(raw.spawn.x)) ? Math.round(Number(raw.spawn.x)) : 0;
  const spawnY = raw.spawn && Number.isFinite(Number(raw.spawn.y)) ? Math.round(Number(raw.spawn.y)) : 0;
  const playerX = raw.playerPos && Number.isFinite(Number(raw.playerPos.x)) ? Number(raw.playerPos.x) : spawnX * TILE;
  const playerY = raw.playerPos && Number.isFinite(Number(raw.playerPos.y)) ? Number(raw.playerPos.y) : spawnY * TILE;

  const cleanLayer = src => {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const k in src) {
      const id = src[k];
      if (typeof id !== 'string' || !id) continue;
      const sp = getSpriteById(id);
      if (sp && isGearType(sp.type)) continue;
      out[k] = id;
    }
    return out;
  };

  const cleanOrient = (src, layerMap) => {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const k in src) {
      if (!layerMap[k]) continue;
      const v = Number(src[k]);
      if (Number.isFinite(v)) {
        const norm = Math.round(v) & 7;
        if (norm !== 0) out[k] = norm;
      }
    }
    return out;
  };

  const rawLayers = (raw.layers && typeof raw.layers === 'object') ? raw.layers : {};
  const rawOrient = (raw.orient && typeof raw.orient === 'object') ? raw.orient : {};
  const bg = cleanLayer(rawLayers.bg);
  const main = cleanLayer(rawLayers.main);
  const fg = cleanLayer(rawLayers.fg);
  const hasAnyTile = k => Boolean(main[k] || bg[k] || fg[k]);

  const wires = [];
  if (Array.isArray(raw.wires)) {
    const seenW = new Set();
    for (let i = 0; i < raw.wires.length; i++) {
      const w = raw.wires[i];
      if (!w || typeof w.from !== 'string' || typeof w.to !== 'string') continue;
      if (w.from === w.to || !hasAnyTile(w.from) || !hasAnyTile(w.to)) continue;
      const sig = `${w.from}->${w.to}`;
      if (seenW.has(sig)) continue;
      seenW.add(sig);
      const cleanWire = { from: w.from, to: w.to };
      if (w.invert) cleanWire.invert = true;
      wires.push(cleanWire);
    }
  }

  const joints = [];
  if (Array.isArray(raw.joints)) {
    const seenJ = new Set();
    for (let i = 0; i < raw.joints.length; i++) {
      const j = raw.joints[i];
      if (!j || typeof j.a !== 'string' || typeof j.b !== 'string') continue;
      if (j.a === j.b || !hasAnyTile(j.a) || !hasAnyTile(j.b)) continue;
      const sig = j.a < j.b ? `${j.a}<->${j.b}` : `${j.b}<->${j.a}`;
      if (seenJ.has(sig)) continue;
      seenJ.add(sig);
      const kind = (j.kind === 'ROD' || j.kind === 'SPRING') ? j.kind : 'ROPE';
      const len = Number.isFinite(Number(j.len)) ? clamp(Number(j.len), TILE * 0.5, TILE * 20) : TILE * 2;
      joints.push({ a: j.a, b: j.b, kind, len });
    }
  }

  const sceneryLayers = [];
  if (raw.scenery && typeof raw.scenery === 'object' && Array.isArray(raw.scenery.layers)) {
    const cap = Math.min(SCENERY_MAX_LAYERS, raw.scenery.layers.length);
    for (let i = 0; i < cap; i++) {
      sceneryLayers.push(sanitizeSceneryLayer(raw.scenery.layers[i], i + 1));
    }
  }

  return {
    id: (typeof raw.id === 'string' && raw.id.trim())
      ? raw.id.trim()
      : ('w_' + Date.now() + '_' + Math.floor(Math.random() * 9999)),
    name: (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ('WORLD ' + fallbackIdx)).toUpperCase().slice(0, 24),
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
    spawn: { x: spawnX, y: spawnY },
    playerPos: { x: playerX, y: playerY },
    layers: { bg, main, fg },
    orient: {
      bg: cleanOrient(rawOrient.bg, bg),
      main: cleanOrient(rawOrient.main, main),
      fg: cleanOrient(rawOrient.fg, fg)
    },
    wires,
    joints,
    scenery: { layers: sceneryLayers }
  };
}

export function serializeSprites() {
  return state.sprites.map(sp => ({
    id: sp.id,
    createdAt: sp.createdAt,
    name: sp.name,
    type: sp.type,
    subType: sp.subType,
    customText: sp.customText || '',
    size: sp.size,
    fps: sp.fps,
    stateFps: (sp.type === 'BODY' && sp.subType !== 'MOTION') ? sp.stateFps : undefined,
    animMode: sp.animMode,
    frames: sp.frames,
    states: (sp.type === 'BODY' && sp.subType !== 'MOTION') ? sp.states : undefined,
    palette: Array.isArray(sp.palette) ? sp.palette : undefined,
    lightColor: sp.type === 'LIGHT' ? sp.lightColor : undefined,
    lightOpts: sp.type === 'LIGHT' ? sp.lightOpts : undefined,
    glowFrame: (sp.type === 'LIGHT' && sp.subType === 'LIGHT GLOW') ? sp.glowFrame : undefined,
    envOpts: sp.type === 'ENVIRONMENT' ? sp.envOpts : undefined,
    liquidOpts: sp.type === 'LIQUID' ? sp.liquidOpts : undefined,
    harmOpts: sp.type === 'HARMFUL' ? sp.harmOpts : undefined,
    actOpts: sp.type === 'ACTIVATOR' ? sp.actOpts : undefined,
    backOpts: sp.type === 'BACK' ? sp.backOpts : undefined,
    bigOpts: sp.type === 'BIG_THING' ? sp.bigOpts : undefined,
    motionOpts: (sp.type === 'BODY' && sp.subType === 'MOTION') ? sp.motionOpts : undefined,
    surfaceSound: (supportsSurfaceSound(sp.type) && sp.surfaceSound && sp.surfaceSound !== 'DEFAULT') ? sp.surfaceSound : undefined,
    poseAction: (supportsPoseAction(sp.type) && sp.poseAction && sp.poseAction !== 'NONE') ? sp.poseAction : undefined
  }));
}

export function saveSpritesNow() {
  if (!sessionGuard.isOwner()) return;
  try {
    localStorage.setItem(KEY_SPRITES, JSON.stringify(serializeSprites()));
    flashSavedDot();
  } catch (err) {
    SFX.playError();
    showToast('STORAGE FULL');
  }
}

export function saveWorldsNow(flash = true) {
  if (!sessionGuard.isOwner()) return;
  try {
    const active = getActiveWorld();
    active.playerPos = { x: Math.round(player.x * 10) / 10, y: Math.round(player.y * 10) / 10 };
    active.updatedAt = Date.now();
    localStorage.setItem(KEY_WORLDS, JSON.stringify(state.worlds));
    if (flash) flashSavedDot();
  } catch (err) {
    SFX.playError();
    showToast('STORAGE FULL');
  }
}

export function scheduleWorldAutoSave(flash = true) {
  if (!sessionGuard.isOwner()) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveWorldsNow(flash), 320);
}

export function savePrefsNow() {
  if (!sessionGuard.isOwner()) return;
  try {
    localStorage.setItem(KEY_PREFS, JSON.stringify({
      activeWorldId: state.activeWorldId,
      mode: state.mode,
      equippedBodyId: state.equippedBodyId,
      equippedWearableId: state.equippedWearableId,
      equippedHoldableId: state.equippedHoldableId,
      bodyMotionBars: state.bodyMotionBars || {},
      targetZoom: camera.targetZoom,
      menusHidden: state.menusHidden,
      welcomeDone: Boolean(state.welcomeDone),
      tutorialDone: Boolean(state.tutorialDone),
      pixoTooltips: Boolean(state.pixoTooltips),
      showWiresInPlay: Boolean(state.showWiresInPlay),
      sfxVol: SFX.cfg.sfxVol,
      musicVol: SFX.cfg.musicVol,
      sfxMuted: SFX.cfg.sfxMuted,
      musicMuted: SFX.cfg.musicMuted,
      musicEnabled: SFX.cfg.musicEnabled,
      musicTrack: SFX.cfg.trackId,
      userPickedTrack: Boolean(SFX.cfg.userPickedTrack)
    }));
  } catch (_) {
    // Ignore storage quota issues for minor prefs
  }
}

function applyLoadedPrefs(rawPrefs, hasExistingSavedData) {
  let explicitWelcomeDone = false;
  try {
    if (rawPrefs) {
      const p = JSON.parse(rawPrefs);
      if (p && typeof p === 'object') {
        if (p.activeWorldId && state.worlds.some(w => w.id === p.activeWorldId)) {
          state.activeWorldId = p.activeWorldId;
        }
        if (p.mode === 'BUILD' || p.mode === 'PLAY') {
          state.mode = p.mode;
        }
        if (p.equippedBodyId) {
          const bSp = getSpriteById(p.equippedBodyId);
          if (bSp && bSp.type === 'BODY' && bSp.subType !== 'MOTION') state.equippedBodyId = p.equippedBodyId;
        }
        if (p.equippedWearableId) {
          const wSp = getSpriteById(p.equippedWearableId);
          if (wSp && wSp.type === 'WEARABLE') state.equippedWearableId = p.equippedWearableId;
        }
        if (p.equippedHoldableId) {
          const hSp = getSpriteById(p.equippedHoldableId);
          if (hSp && hSp.type === 'HOLDABLE') state.equippedHoldableId = p.equippedHoldableId;
        }
        if (p.bodyMotionBars && typeof p.bodyMotionBars === 'object') {
          const cleanBars = {};
          for (const [bKey, arr] of Object.entries(p.bodyMotionBars)) {
            if (!Array.isArray(arr)) continue;
            const slots = new Array(MOTION_BAR_SLOTS).fill(null);
            for (let i = 0; i < Math.min(MOTION_BAR_SLOTS, arr.length); i++) {
              const sid = arr[i];
              if (typeof sid === 'string' && getSpriteById(sid)) {
                slots[i] = sid;
              }
            }
            if (slots.some(Boolean)) cleanBars[bKey] = slots;
          }
          state.bodyMotionBars = cleanBars;
        }
        if (Number.isFinite(p.targetZoom)) {
          camera.targetZoom = clamp(p.targetZoom, 1.0, 5.0);
          camera.zoom = camera.targetZoom;
        }
        if (typeof p.menusHidden === 'boolean') {
          state.menusHidden = p.menusHidden;
          appRoot.classList.toggle('menus-hidden', state.menusHidden);
        }
        if (typeof p.welcomeDone === 'boolean') {
          state.welcomeDone = p.welcomeDone;
          explicitWelcomeDone = true;
        } else if (p.tutorialDone || state.sprites.length > 0 || state.worlds.length > 1) {
          state.welcomeDone = true;
          explicitWelcomeDone = true;
        }
        if (typeof p.tutorialDone === 'boolean') {
          state.tutorialDone = p.tutorialDone;
        }
        if (typeof p.pixoTooltips === 'boolean') {
          state.pixoTooltips = p.pixoTooltips;
        }
        if (typeof p.showWiresInPlay === 'boolean') {
          state.showWiresInPlay = p.showWiresInPlay;
        }
        SFX.applySavedPrefs(p);
      }
    }
  } catch (_) {
    // Use defaults
  }

  // Only absolutely first-time visitors (no prior saved data at all) see the first-launch Start Screen
  if (!explicitWelcomeDone) {
    state.welcomeDone = Boolean(hasExistingSavedData);
  }

  if (!state.activeWorldId) {
    state.activeWorldId = state.worlds[0].id;
  }
}

export function loadAllFromStorage() {
  let rawSprites = null;
  let rawWorlds = null;
  let rawPrefs = null;
  try {
    rawSprites = localStorage.getItem(KEY_SPRITES);
    if (rawSprites) {
      const parsed = JSON.parse(rawSprites);
      if (Array.isArray(parsed)) {
        state.sprites = parsed.map(sanitizeSprite).filter(Boolean);
      }
    }
  } catch (_) {
    state.sprites = [];
  }
  rebuildSpriteIndex();

  try {
    rawWorlds = localStorage.getItem(KEY_WORLDS);
    if (rawWorlds) {
      const parsed = JSON.parse(rawWorlds);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.worlds = parsed.map((w, i) => sanitizeWorld(w, i + 1));
      }
    }
  } catch (_) {
    state.worlds = [];
  }

  if (state.worlds.length === 0) {
    state.worlds.push(createStarterWorld('WORLD 1'));
  }

  try {
    rawPrefs = localStorage.getItem(KEY_PREFS);
  } catch (_) {}

  const hasExistingSavedData = Boolean(rawSprites || rawWorlds || rawPrefs);
  applyLoadedPrefs(rawPrefs, hasExistingSavedData);
}

export async function loadAllFromStorageAsync(onProgress, yieldFn) {
  const report = typeof onProgress === 'function' ? onProgress : () => {};
  const stepYield = typeof yieldFn === 'function' ? yieldFn : () => Promise.resolve();

  let rawSprites = null;
  let rawWorlds = null;
  let rawPrefs = null;

  report(10, 'READING SAVED SPRITES...');
  try {
    rawSprites = localStorage.getItem(KEY_SPRITES);
    if (rawSprites) {
      const parsed = JSON.parse(rawSprites);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const total = parsed.length;
        const loaded = [];
        const chunk = Math.max(8, Math.ceil(total / 5));
        for (let i = 0; i < total; i++) {
          const sp = sanitizeSprite(parsed[i]);
          if (sp) loaded.push(sp);
          if ((i + 1) % chunk === 0 || i === total - 1) {
            const pct = 12 + Math.round(((i + 1) / total) * 38);
            report(pct, `DECODING SPRITES (${i + 1}/${total})...`);
            await stepYield();
          }
        }
        state.sprites = loaded;
      } else {
        state.sprites = [];
      }
    } else {
      state.sprites = [];
    }
  } catch (_) {
    state.sprites = [];
  }
  rebuildSpriteIndex();

  report(52, 'LOADING SAVED WORLDS...');
  try {
    rawWorlds = localStorage.getItem(KEY_WORLDS);
    if (rawWorlds) {
      const parsed = JSON.parse(rawWorlds);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const total = parsed.length;
        const worlds = [];
        for (let i = 0; i < total; i++) {
          worlds.push(sanitizeWorld(parsed[i], i + 1));
          const pct = 54 + Math.round(((i + 1) / total) * 14);
          report(pct, `LOADING WORLDS (${i + 1}/${total})...`);
          if (total > 1) await stepYield();
        }
        state.worlds = worlds;
      } else {
        state.worlds = [];
      }
    } else {
      state.worlds = [];
    }
  } catch (_) {
    state.worlds = [];
  }

  if (state.worlds.length === 0) {
    state.worlds.push(createStarterWorld('WORLD 1'));
  }

  report(70, 'APPLYING PREFERENCES...');
  try {
    rawPrefs = localStorage.getItem(KEY_PREFS);
  } catch (_) {}

  const hasExistingSavedData = Boolean(rawSprites || rawWorlds || rawPrefs);
  applyLoadedPrefs(rawPrefs, hasExistingSavedData);
}
