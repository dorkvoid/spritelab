import { SFX } from './audio.js';
import { FIXED_DT, isEmergingHarmSubType, isMovingHarmSubType, MAX_FRAME_DT } from './constants.js';
import {
  appRoot,
  edBrushHud,
  editorModal,
  isAnyModalOpen,
  showToast,
  worldCanvas,
  worldStage
} from './dom.js';
import { editorHasDraftableContent, flushEditorDraftNow, loadEditorDraft, renderDraftBar } from './editor/draft.js';
import { drawEditorCanvas, renderEditorPreview } from './editor/render.js';
import { editorHasSelection } from './editor/selection.js';
import { editor, getEditorActiveFps, isBodyRigMode, isLightGlowMode } from './editor/state.js';
import { initEditorStaticUI } from './editor/ui.js';
import { envSys } from './environment.js';
import { evaluateWireNetwork, loadWorldPlayerPos, stepPhysics } from './physics.js';
import { renderWorld } from './renderer.js';
import { camera, getActiveWorld, state, viewport } from './state.js';
import { loadAllFromStorageAsync, savePrefsNow, saveWorldsNow, sessionGuard } from './storage.js';
import { initGlobalInputEvents, initWorldPointerEvents } from './ui/input.js';
import { hideLoadingScreen, setLoadingProgress, yieldFrame } from './ui/loading.js';
import { initPixoUI } from './ui/pixo.js';
import { initSceneryUI, tickSceneryStudioPreview } from './ui/scenery.js';
import { initSidebarUI, renderSidebar, updateDockThumbAnimations } from './ui/sidebar.js';
import {
  initAudioUI,
  initTopbarUI,
  setBuildTool,
  setMode,
  updateAudioUI,
  updateTopUI
} from './ui/topbar.js';
import { initWorldsUI } from './ui/worlds.js';
import { initWelcomeUI, openFirstTimeStartScreen } from './ui/welcome.js';
import { clamp } from './utils.js';
import { updateCamera, updateViewableAnimation } from './world.js';

let lastFrameTime = performance.now();
let accumulator = 0;

/* =========================================================================
   CANVAS RESIZE & MAIN 60 HZ FIXED-TIMESTEP LOOP
   ========================================================================= */
function resizeWorldCanvas() {
  const rect = worldStage.getBoundingClientRect();
  viewport.width = Math.max(1, Math.floor(rect.width));
  viewport.height = Math.max(1, Math.floor(rect.height));
  viewport.dpr = Math.min(window.devicePixelRatio || 1, 2);
  worldCanvas.width = Math.floor(viewport.width * viewport.dpr);
  worldCanvas.height = Math.floor(viewport.height * viewport.dpr);
}

function mainLoop(now) {
  const rawDt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  const frameDt = clamp(rawDt, 0, MAX_FRAME_DT);

  state.uiTime += frameDt;

  // Physics & simulation ONLY advance in PLAY mode when no modal is open (supports Slow-Mo timeScale)
  if (state.mode === 'PLAY' && !isAnyModalOpen()) {
    const tScale = clamp(Number(state.timeScale) || 1.0, 0.1, 2.0);
    accumulator += frameDt * tScale;
    while (accumulator >= FIXED_DT) {
      stepPhysics(FIXED_DT);
      accumulator -= FIXED_DT;
    }
  } else {
    accumulator = 0;
    // Live Blueprint Wire schematic preview: propagate test switches, timers & logic gates without moving physics
    if (state.mode === 'BUILD' && state.buildTool === 'WIRE' && !isAnyModalOpen()) {
      evaluateWireNetwork(getActiveWorld(), frameDt, true);
    }
  }

  updateCamera(frameDt);
  if (!isAnyModalOpen()) {
    envSys.update(getActiveWorld(), frameDt);
  }
  renderWorld(state.mode === 'PLAY' ? clamp(accumulator / FIXED_DT, 0, 1) : 1);
  updateViewableAnimation();
  updateDockThumbAnimations();
  tickSceneryStudioPreview(frameDt);
  // Auto-clear brief on-canvas brush size indicator after timeout
  if (editorModal.classList.contains('open') && editor.brushPreviewUntil > 0 && state.uiTime >= editor.brushPreviewUntil) {
    editor.brushPreviewUntil = 0;
    edBrushHud.classList.remove('show');
    drawEditorCanvas();
  }

  // Animate Create Editor selection marching ants
  if (editorModal.classList.contains('open') && editorHasSelection()) {
    editor.marchingAcc += frameDt;
    if (editor.marchingAcc >= 0.08) {
      editor.marchingAcc = 0;
      drawEditorCanvas();
    }
  }

  // Animate Sprite Editor preview when playing (using per-state FPS on Body rigs & live Light/Env FX)
  if (editorModal.classList.contains('open') && editor.playing) {
    if (editor.type === 'LIGHT') {
      const liveLight = isLightGlowMode() || (editor.subType === 'LIGHT' && editor.lightOpts.pulsating);
      if (liveLight) renderEditorPreview();
    } else if (editor.type === 'ENVIRONMENT') {
      renderEditorPreview();
    } else if (editor.type === 'HARMFUL' && (isEmergingHarmSubType(editor.subType) || isMovingHarmSubType(editor.subType))) {
      renderEditorPreview();
    } else if (editor.type === 'BIG_THING') {
      const hasBigFx = editor.bigOpts && editor.bigOpts.fx && editor.bigOpts.fx !== 'NONE';
      if (editor.subType === 'TRANSFORMING' && editor.frames.length > 1) {
        editor.previewAcc += frameDt;
        const step = 1.1; // Smooth readable live preview speed for Transforming cells
        if (editor.previewAcc >= step) {
          editor.previewAcc %= step;
          editor.previewIdx = (editor.previewIdx + 1) % editor.frames.length;
          renderEditorPreview();
        } else if (hasBigFx) {
          renderEditorPreview();
        }
      } else if (hasBigFx) {
        renderEditorPreview();
      }
    } else {
      const needsAnim = editor.frames.length > 1 || isBodyRigMode();
      if (needsAnim) {
        editor.previewAcc += frameDt;
        const step = 1 / getEditorActiveFps();
        if (editor.previewAcc >= step) {
          editor.previewAcc %= step;
          editor.previewTick++;
          if (editor.frames.length > 1) {
            editor.previewIdx = (editor.previewIdx + 1) % editor.frames.length;
          }
          renderEditorPreview();
        }
      }
    }
  }

  requestAnimationFrame(mainLoop);
}

/* =========================================================================
   INITIALIZATION & SPRITELAB BRAND ASSET FALLBACKS
   ========================================================================= */
function initBrandAssets() {
  // Crisp 60x10 pixel fallback canvas matching spritelab_logo.png
  const lc = document.createElement('canvas');
  lc.width = 60;
  lc.height = 10;
  const lctx = lc.getContext('2d');
  lctx.fillStyle = '#0d0e11';
  lctx.fillRect(0, 0, 60, 10);
  lctx.font = '8px "Pixellari", monospace';
  lctx.textBaseline = 'top';
  lctx.fillStyle = '#ffffff';
  lctx.fillText('SPRITELAB', 2, 1);
  lctx.fillStyle = '#f28c38';
  lctx.fillRect(18, 1, 2, 2);
  const fallbackLogoUrl = lc.toDataURL('image/png');

  const attachFallback = (imgEl, fallbackUrl) => {
    if (!imgEl) return;
    imgEl.addEventListener('error', () => {
      if (imgEl.dataset.fallbackApplied) return;
      imgEl.dataset.fallbackApplied = '1';
      imgEl.src = fallbackUrl;
    });
  };

  attachFallback(document.getElementById('topLogoImg'), fallbackLogoUrl);
  attachFallback(document.getElementById('loadingLogoImg'), fallbackLogoUrl);
  attachFallback(document.getElementById('welcomeHeroLogo'), fallbackLogoUrl);
}

async function waitForBootAssets() {
  const tasks = [];
  if (document.fonts) {
    if (typeof document.fonts.load === 'function') {
      tasks.push(document.fonts.load('16px "Pixellari"').catch(() => {}));
    }
    if (document.fonts.ready) {
      tasks.push(document.fonts.ready.catch(() => {}));
    }
  }
  const logoImg = document.getElementById('topLogoImg');
  if (logoImg && !logoImg.complete) {
    tasks.push(new Promise(resolve => {
      logoImg.addEventListener('load', resolve, { once: true });
      logoImg.addEventListener('error', resolve, { once: true });
    }));
  }
  if (!tasks.length) return;
  await Promise.race([
    Promise.all(tasks),
    new Promise(resolve => setTimeout(resolve, 450))
  ]);
}

async function init() {
  try {
    // Disable browser context menus, middle-click tab opening, and image dragging globally
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('auxclick', e => {
      if (e.button === 1 || e.button === 2) e.preventDefault();
    });
    document.addEventListener('mousedown', e => {
      if (e.button === 1) e.preventDefault();
    });
    document.addEventListener('dragstart', e => {
      if (e.target && e.target.tagName === 'IMG') e.preventDefault();
    });

    setLoadingProgress(4, 'CHECKING SESSION GUARD...');
    initBrandAssets();
    const ownsSession = sessionGuard.init();
    if (!ownsSession) {
      hideLoadingScreen(true);
    }

    await yieldFrame();
    await loadAllFromStorageAsync((pct, label) => {
      if (ownsSession) setLoadingProgress(pct, label);
    }, yieldFrame);

    // Prepare Switch-2 UI tuck cleanly behind the first-time Start Screen before revealing
    const isFirstTimeLaunch = ownsSession && !state.welcomeDone;
    if (isFirstTimeLaunch && appRoot) {
      appRoot.classList.add('ui-building');
    }

    if (ownsSession) setLoadingProgress(76, 'INITIALIZING CONTROLS & AUDIO...');
    await yieldFrame();
    initTopbarUI();
    initSidebarUI();
    initWorldPointerEvents();
    initGlobalInputEvents();
    initAudioUI();
    if (ownsSession) {
      SFX.preloadYouTube();
      SFX.tryAutoStart();
    }
    initEditorStaticUI();
    initWorldsUI();
    initSceneryUI();
    initPixoUI(ownsSession);
    initWelcomeUI();

    const activeWorld = getActiveWorld();
    const tileCount =
      Object.keys(activeWorld.layers.bg).length +
      Object.keys(activeWorld.layers.main).length +
      Object.keys(activeWorld.layers.fg).length;
    if (ownsSession) {
      setLoadingProgress(
        84,
        tileCount > 0 ? `SYNCING ${activeWorld.name} (${tileCount} TILES)...` : `SYNCING ${activeWorld.name}...`
      );
    }
    await yieldFrame();

    loadWorldPlayerPos(activeWorld);
    setMode(state.mode, false);
    setBuildTool('STAMP');

    resizeWorldCanvas();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resizeWorldCanvas).observe(worldStage);
    }
    window.addEventListener('resize', resizeWorldCanvas);

    // Initialize visual offsets immediately without initial jump
    const sideW = window.innerWidth <= 760 ? 224 : 312;
    camera.offsetX = state.menusHidden ? 0 : sideW * 0.5;
    camera.offsetY = state.menusHidden ? 0 : 20;
    camera.gridAlpha = state.mode === 'BUILD' ? 1 : 0;

    if (ownsSession) setLoadingProgress(91, 'BUILDING SPRITE DOCK...');
    await yieldFrame();
    renderSidebar();
    renderDraftBar();
    updateTopUI();

    if (ownsSession) setLoadingProgress(96, 'LOADING FONTS & VIEWPORT...');
    await waitForBootAssets();
    renderWorld(1);

    if (ownsSession) setLoadingProgress(100, 'READY');
    await yieldFrame();

    if (!ownsSession) {
      hideLoadingScreen(true);
    } else if (isFirstTimeLaunch) {
      // Absolutely first-time visitor: hand off cleanly to the one-time 3D cube Start Screen
      openFirstTimeStartScreen();
      hideLoadingScreen(false);
    } else {
      // Returning visitor: fade loading screen directly into the live world (no Start Screen / build-out)
      hideLoadingScreen(false);
      SFX.startGameMusic();
      updateAudioUI();
      if (loadEditorDraft()) {
        setTimeout(() => showToast('UNSAVED DRAFT READY TO RESUME'), 520);
      }
    }

    lastFrameTime = performance.now();
    requestAnimationFrame(mainLoop);
  } catch (err) {
    console.error('Init failed:', err);
    hideLoadingScreen(true);
  }
}

window.addEventListener('pagehide', () => {
  if (!sessionGuard.isOwner()) return;
  flushEditorDraftNow(false);
  saveWorldsNow(false);
  savePrefsNow();
  sessionGuard.releaseOnUnload();
});

window.addEventListener('beforeunload', e => {
  if (!sessionGuard.isOwner()) return;
  const hasUnsavedDraft = editorModal.classList.contains('open') && editor.dirty && editorHasDraftableContent();
  if (hasUnsavedDraft) {
    flushEditorDraftNow(false);
    e.preventDefault();
    e.returnValue = '';
  }
  saveWorldsNow(false);
  savePrefsNow();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
