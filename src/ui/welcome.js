import { SFX } from '../audio.js';
import {
  importFileInput,
  pixoPopover,
  pixoReplayWelcomeBtn,
  showToast,
  topBrandBtn,
  welcomeAudioToggleBtn,
  welcomeMenuList,
  welcomeNewWorldCancelBtn,
  welcomeNewWorldConfirmBtn,
  welcomeNewWorldInput,
  welcomeNewWorldRow,
  welcomeNextWorldBtn,
  welcomeOverlay,
  welcomePlayMeta,
  welcomePreviewName,
  welcomePreviewTiles,
  welcomePrevWorldBtn,
  welcomeRenameRow,
  welcomeSnapStage,
  welcomeStatsPill,
  welcomeWorldIdx,
  welcomeWorldNameInput,
  welcomeWorldPager,
  welcomeWorldPreview
} from '../dom.js';
import { openEditor } from '../editor/io.js';
import { loadWorldPlayerPos } from '../physics.js';
import { getActiveWorld, state } from '../state.js';
import { createStarterWorld, savePrefsNow, saveWorldsNow } from '../storage.js';
import { generateUniqueName } from '../utils.js';
import { clearWorldHistory } from '../world.js';
import { startPixoTour } from './pixo.js';
import { setMode, updateTopUI } from './topbar.js';
import { countWorldTiles, renderWorldPreviewCanvas } from './worlds.js';

/* =========================================================================
   SPRITELAB START MENU (FIRST-LAUNCH & TITLE SCREEN)
   Clean workstation launcher with live active-world preview & direct actions.
   ========================================================================= */
const MENU_ACTIONS = ['play', 'build', 'create', 'new_world', 'import'];

let selectedIdx = 0;
let isLaunching = false;
let creatingWorld = false;

function getMenuButtons() {
  if (!welcomeMenuList) return [];
  return Array.from(welcomeMenuList.querySelectorAll('.welcome-menu-item[data-wact]'));
}

function setSelectedMenuIndex(idx, playTick = false) {
  const btns = getMenuButtons();
  if (!btns.length) return;
  const wrapped = ((idx % btns.length) + btns.length) % btns.length;
  if (wrapped === selectedIdx && playTick) return;
  selectedIdx = wrapped;
  for (let i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', i === selectedIdx);
  }
  if (playTick) {
    SFX.unlock();
    SFX.playButton('soft');
  }
}

function triggerLatchAnim() {
  if (!welcomeSnapStage) return;
  welcomeSnapStage.classList.remove('snapped');
  void welcomeSnapStage.offsetWidth;
  welcomeSnapStage.classList.add('snapped');
}

function syncAudioBtnUI() {
  if (!welcomeAudioToggleBtn) return;
  const muted = Boolean(SFX.cfg.sfxMuted && SFX.cfg.musicMuted);
  welcomeAudioToggleBtn.classList.toggle('active', !muted);
  welcomeAudioToggleBtn.textContent = muted ? 'AUDIO: OFF' : 'AUDIO: ON';
}

function setNewWorldInlineOpen(open) {
  creatingWorld = Boolean(open);
  if (welcomeRenameRow) welcomeRenameRow.hidden = creatingWorld;
  if (welcomeNewWorldRow) welcomeNewWorldRow.hidden = !creatingWorld;
  if (creatingWorld && welcomeNewWorldInput) {
    const nextName = generateUniqueName('WORLD', state.worlds.map(w => w.name), 24, true);
    welcomeNewWorldInput.value = nextName;
    requestAnimationFrame(() => {
      welcomeNewWorldInput.focus();
      welcomeNewWorldInput.select();
    });
  }
}

export function refreshStartMenuUI() {
  const world = getActiveWorld();
  const worldCount = state.worlds.length;
  const spriteCount = state.sprites.length;
  const activeIdx = Math.max(0, state.worlds.findIndex(w => w.id === state.activeWorldId));

  if (welcomeStatsPill) {
    const wLbl = worldCount === 1 ? '1 WORLD' : `${worldCount} WORLDS`;
    const sLbl = spriteCount === 1 ? '1 SPRITE' : `${spriteCount} SPRITES`;
    welcomeStatsPill.textContent = `${wLbl} | ${sLbl}`;
  }

  if (world) {
    if (welcomePlayMeta) welcomePlayMeta.textContent = world.name;
    if (welcomePreviewName) welcomePreviewName.textContent = world.name;
    if (welcomePreviewTiles) {
      const tiles = countWorldTiles(world);
      welcomePreviewTiles.textContent = tiles === 1 ? '1 TILE' : `${tiles} TILES`;
    }
    if (welcomeWorldNameInput && document.activeElement !== welcomeWorldNameInput) {
      welcomeWorldNameInput.value = world.name;
    }
    if (welcomeWorldPreview) {
      renderWorldPreviewCanvas(world, welcomeWorldPreview);
    }
  }

  if (welcomeWorldIdx) {
    welcomeWorldIdx.textContent = `${activeIdx + 1} / ${Math.max(1, worldCount)}`;
  }
  if (welcomeWorldPager) {
    const hasMulti = worldCount > 1;
    if (welcomePrevWorldBtn) welcomePrevWorldBtn.disabled = !hasMulti;
    if (welcomeNextWorldBtn) welcomeNextWorldBtn.disabled = !hasMulti;
  }
  syncAudioBtnUI();
}

function cycleActiveWorld(delta) {
  if (state.worlds.length <= 1) return;
  saveWorldsNow(false);
  const curIdx = Math.max(0, state.worlds.findIndex(w => w.id === state.activeWorldId));
  const nextIdx = ((curIdx + delta) % state.worlds.length + state.worlds.length) % state.worlds.length;
  const target = state.worlds[nextIdx];
  if (!target) return;
  state.activeWorldId = target.id;
  clearWorldHistory();
  loadWorldPlayerPos(target);
  savePrefsNow();
  updateTopUI();
  refreshStartMenuUI();
}

function applyWorldNameChange() {
  const world = getActiveWorld();
  if (!world || !welcomeWorldNameInput) return;
  const typed = welcomeWorldNameInput.value.trim().toUpperCase().slice(0, 24);
  if (!typed || typed === world.name) return;
  world.name = typed;
  saveWorldsNow(false);
  updateTopUI();
  if (welcomePlayMeta) welcomePlayMeta.textContent = world.name;
  if (welcomePreviewName) welcomePreviewName.textContent = world.name;
}

export function openStartMenu(playSnapSfx = false) {
  if (!welcomeOverlay) return;
  isLaunching = false;
  if (pixoPopover) pixoPopover.classList.remove('open');
  setNewWorldInlineOpen(false);
  refreshStartMenuUI();
  setSelectedMenuIndex(0, false);

  welcomeOverlay.classList.remove('launching');
  welcomeOverlay.classList.add('open');
  triggerLatchAnim();
  if (playSnapSfx) {
    SFX.unlock();
    setTimeout(() => SFX.playSwitchSnap(), 160);
  }
}

function dismissStartMenu(targetMode = 'PLAY', opts = {}) {
  if (!welcomeOverlay || !welcomeOverlay.classList.contains('open') || isLaunching) return;
  isLaunching = true;
  applyWorldNameChange();

  setMode(targetMode, false);
  SFX.unlock();
  SFX.playSwitchSnap();

  state.welcomeDone = true;
  savePrefsNow();
  updateTopUI();

  welcomeOverlay.classList.add('launching');
  setTimeout(() => {
    welcomeOverlay.classList.remove('open', 'launching');
    isLaunching = false;
    if (opts.openSpriteEditor) {
      openEditor(null);
      return;
    }
    if (!state.tutorialDone && !opts.skipTour) {
      setTimeout(() => {
        if (!state.tutorialDone) startPixoTour(false);
      }, 360);
    }
  }, 220);
}

function createAndEnterNewWorld() {
  saveWorldsNow(false);
  const raw = welcomeNewWorldInput ? welcomeNewWorldInput.value.trim().toUpperCase().slice(0, 24) : '';
  const name = raw || generateUniqueName('WORLD', state.worlds.map(w => w.name), 24, true);
  const created = createStarterWorld(name);
  state.worlds.push(created);
  state.activeWorldId = created.id;
  clearWorldHistory();
  loadWorldPlayerPos(created);
  saveWorldsNow(true);
  savePrefsNow();
  updateTopUI();
  setNewWorldInlineOpen(false);
  showToast('CREATED ' + created.name);
  dismissStartMenu('PLAY');
}

function runMenuAction(action) {
  if (action === 'play') {
    dismissStartMenu('PLAY');
  } else if (action === 'build') {
    dismissStartMenu('BUILD');
  } else if (action === 'create') {
    dismissStartMenu('BUILD', { openSpriteEditor: true, skipTour: true });
  } else if (action === 'new_world') {
    setNewWorldInlineOpen(!creatingWorld);
  } else if (action === 'import') {
    if (importFileInput) {
      importFileInput.value = '';
      importFileInput.click();
    }
  }
}

export function initWelcomeUI(ownsSession = true) {
  if (!welcomeOverlay) return;

  if (pixoReplayWelcomeBtn) {
    pixoReplayWelcomeBtn.addEventListener('click', () => openStartMenu(true));
  }

  if (topBrandBtn) {
    topBrandBtn.addEventListener('click', () => openStartMenu(true));
    topBrandBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openStartMenu(true);
      }
    });
  }

  const btns = getMenuButtons();
  btns.forEach((btn, idx) => {
    btn.addEventListener('pointerenter', () => setSelectedMenuIndex(idx, false));
    btn.addEventListener('click', () => {
      setSelectedMenuIndex(idx, false);
      runMenuAction(btn.dataset.wact);
    });
  });

  if (welcomePrevWorldBtn) {
    welcomePrevWorldBtn.addEventListener('click', () => cycleActiveWorld(-1));
  }
  if (welcomeNextWorldBtn) {
    welcomeNextWorldBtn.addEventListener('click', () => cycleActiveWorld(1));
  }

  if (welcomeWorldNameInput) {
    welcomeWorldNameInput.addEventListener('input', applyWorldNameChange);
    welcomeWorldNameInput.addEventListener('blur', () => {
      const world = getActiveWorld();
      if (world && !welcomeWorldNameInput.value.trim()) {
        welcomeWorldNameInput.value = world.name;
      }
    });
    welcomeWorldNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyWorldNameChange();
        welcomeWorldNameInput.blur();
      }
    });
  }

  if (welcomeNewWorldConfirmBtn) {
    welcomeNewWorldConfirmBtn.addEventListener('click', createAndEnterNewWorld);
  }
  if (welcomeNewWorldCancelBtn) {
    welcomeNewWorldCancelBtn.addEventListener('click', () => setNewWorldInlineOpen(false));
  }
  if (welcomeNewWorldInput) {
    welcomeNewWorldInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createAndEnterNewWorld();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setNewWorldInlineOpen(false);
      }
    });
  }

  if (welcomeAudioToggleBtn) {
    welcomeAudioToggleBtn.addEventListener('click', () => {
      SFX.unlock();
      const currentlyMuted = Boolean(SFX.cfg.sfxMuted && SFX.cfg.musicMuted);
      if (currentlyMuted) {
        if (SFX.cfg.sfxMuted) SFX.toggleSfxMute();
        if (SFX.cfg.musicMuted) SFX.toggleMusicMute();
        SFX.playSwitchSnap();
      } else {
        if (!SFX.cfg.sfxMuted) SFX.toggleSfxMute();
        if (!SFX.cfg.musicMuted) SFX.toggleMusicMute();
      }
      savePrefsNow();
      syncAudioBtnUI();
    });
  }

  window.addEventListener('spritelab:workspace-updated', () => {
    if (welcomeOverlay.classList.contains('open')) {
      refreshStartMenuUI();
    }
  });

  // Tactile keyboard navigation while Start Menu is open
  window.addEventListener('keydown', e => {
    if (!welcomeOverlay.classList.contains('open') || isLaunching) return;
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (creatingWorld) {
        setNewWorldInlineOpen(false);
      } else {
        dismissStartMenu('PLAY');
      }
      return;
    }
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      e.preventDefault();
      setSelectedMenuIndex(selectedIdx + 1, true);
    } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      setSelectedMenuIndex(selectedIdx - 1, true);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      runMenuAction(MENU_ACTIONS[selectedIdx] || 'play');
    }
  });

  // First-time players start cleanly at the Start Menu right after boot
  if (ownsSession && !state.welcomeDone) {
    setTimeout(() => {
      if (!state.welcomeDone) {
        openStartMenu(false);
      }
    }, 520);
  }
}
