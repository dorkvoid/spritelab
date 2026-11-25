import { SFX } from '../audio.js';
import {
  audioPopover,
  pixoAvatarBtn,
  pixoBubbleTipsBtn,
  pixoBuddy,
  pixoDots,
  pixoMenuBtn,
  pixoNextBtn,
  pixoPopover,
  pixoReplayBtn,
  pixoSkipBtn,
  pixoSparks,
  pixoSpriteImg,
  pixoStepBadge,
  pixoTasks,
  pixoText,
  pixoTooltipsToggleBtn,
  showToast
} from '../dom.js';
import { state } from '../state.js';
import { savePrefsNow } from '../storage.js';
import { setMode } from './topbar.js';
import { hideUiTooltip } from './tooltips.js';

const PIXO_IDLE_SRC = 'assets/pixo_idle.png';
const PIXO_TALK_SRC = 'assets/pixo_talk.png';

/* =========================================================================
   PIXO INTERACTIVE FIRST-TIME TOUR & HELPER BUDDY
   Nintendo 3DS Settings Helper-inspired dark-studio pixel mascot.
   ========================================================================= */
const TOUR_STEPS = [
  {
    id: 'walk_jump',
    text: "HI! I'M PIXO! WALK WITH A/D AND JUMP WITH W TO TRY PLAY MODE.",
    tasks: [
      { id: 'walk', label: 'WALK (A/D)' },
      { id: 'jump', label: 'JUMP (W)' }
    ]
  },
  {
    id: 'zoom_tab',
    text: 'SCROLL TO ZOOM 1X-5X, OR PRESS TAB TO HIDE MENUS FOR A CLEAN VIEW!',
    tasks: [
      { id: 'view', label: 'ZOOM OR TAB' }
    ]
  },
  {
    id: 'build_mode',
    text: 'PRESS B OR CLICK BUILD UP TOP TO PAUSE AND ENTER BUILD MODE.',
    tasks: [
      { id: 'build', label: 'ENTER BUILD (B)' }
    ]
  },
  {
    id: 'create_sprite',
    text: 'CLICK + CREATE ON THE RIGHT, PAINT A FEW PIXELS, THEN HIT SAVE!',
    tasks: [
      { id: 'editorOpen', label: 'OPEN + CREATE' },
      { id: 'editorSave', label: 'SAVE SPRITE' }
    ]
  },
  {
    id: 'place_tile',
    text: 'STAMP YOUR SPRITE INTO THE WORLD! RIGHT-CLICK ROTATES, CTRL+CLICK ERASES.',
    tasks: [
      { id: 'placeTile', label: 'PLACE A TILE' }
    ]
  },
  {
    id: 'wrap_up',
    text: 'ALL SET! I ALSO POWER HOVER TOOLTIPS. CLICK ? UP TOP ANYTIME FOR ME OR TO TOGGLE TIPS!',
    tasks: []
  }
];

const pixoState = {
  open: false,
  stepIdx: 0,
  completedTasks: new Set(),
  stepCleared: false,
  fullText: '',
  typedCount: 0,
  typing: false,
  mouthOpen: false,
  mouthTick: 0,
  typeTimer: null,
  autoAdvanceTimer: null,
  cheerTimer: null,
  pokeTimer: null
};

function preloadPixoSprites() {
  const imgIdle = new Image();
  imgIdle.src = PIXO_IDLE_SRC;
  const imgTalk = new Image();
  imgTalk.src = PIXO_TALK_SRC;
}

function setAvatarSprite(talkingMouth) {
  if (!pixoSpriteImg) return;
  const target = talkingMouth ? PIXO_TALK_SRC : PIXO_IDLE_SRC;
  if (pixoSpriteImg.dataset.frame !== (talkingMouth ? 'talk' : 'idle')) {
    pixoSpriteImg.dataset.frame = talkingMouth ? 'talk' : 'idle';
    pixoSpriteImg.src = target;
  }
}

function setAvatarPose(pose) {
  if (!pixoAvatarBtn) return;
  pixoAvatarBtn.classList.remove('idle', 'talking', 'cheering', 'poked');
  // Force reflow when re-triggering one-shot animation classes
  if (pose === 'cheering' || pose === 'poked') {
    void pixoAvatarBtn.offsetWidth;
  }
  pixoAvatarBtn.classList.add(pose);
}

function clearTimers() {
  clearTimeout(pixoState.typeTimer);
  pixoState.typeTimer = null;
  clearTimeout(pixoState.autoAdvanceTimer);
  pixoState.autoAdvanceTimer = null;
}

function spawnCheerSparkles() {
  if (!pixoSparks) return;
  pixoSparks.innerHTML = '';
  const count = 10;
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.32;
    const dist = 24 + Math.random() * 18;
    const sx = Math.round(Math.cos(ang) * dist);
    const sy = Math.round(Math.sin(ang) * dist - 8);
    const sp = document.createElement('span');
    sp.className = 'pixo-spark' + (i % 3 === 1 ? ' gold' : (i % 3 === 2 ? ' white' : ''));
    sp.style.setProperty('--sx', `${sx}px`);
    sp.style.setProperty('--sy', `${sy}px`);
    sp.style.animationDelay = `${(i % 3) * 24}ms`;
    pixoSparks.appendChild(sp);
  }
  setTimeout(() => {
    if (pixoSparks) pixoSparks.innerHTML = '';
  }, 660);
}

export function triggerPixoCheer(withSound = true) {
  clearTimeout(pixoState.cheerTimer);
  setAvatarSprite(false);
  setAvatarPose('cheering');
  spawnCheerSparkles();
  if (withSound) SFX.playPixoCheer();
  pixoState.cheerTimer = setTimeout(() => {
    pixoState.cheerTimer = null;
    if (pixoState.open) {
      setAvatarPose(pixoState.typing ? 'talking' : 'idle');
    }
  }, 560);
}

function finishTypingNow() {
  clearTimeout(pixoState.typeTimer);
  pixoState.typeTimer = null;
  pixoState.typing = false;
  pixoState.typedCount = pixoState.fullText.length;
  pixoState.mouthOpen = false;
  if (pixoText) pixoText.textContent = pixoState.fullText;
  setAvatarSprite(false);
  if (!pixoState.cheerTimer) setAvatarPose('idle');
}

function startTypewriter(text) {
  clearTimeout(pixoState.typeTimer);
  pixoState.fullText = String(text || '');
  pixoState.typedCount = 0;
  pixoState.typing = true;
  pixoState.mouthOpen = false;
  pixoState.mouthTick = 0;
  if (pixoText) pixoText.textContent = '';
  if (!pixoState.cheerTimer) setAvatarPose('talking');

  const tick = () => {
    if (!pixoState.open || !pixoState.typing) return;
    if (pixoState.typedCount >= pixoState.fullText.length) {
      finishTypingNow();
      return;
    }

    const ch = pixoState.fullText[pixoState.typedCount];
    pixoState.typedCount++;
    if (pixoText) pixoText.textContent = pixoState.fullText.slice(0, pixoState.typedCount);

    const isWordChar = /[A-Z0-9]/i.test(ch);
    if (isWordChar) {
      pixoState.mouthTick++;
      // Swap between pixo_talk.png and pixo_idle.png cleanly every 2 characters while typing
      if (pixoState.mouthTick % 2 === 1) {
        pixoState.mouthOpen = !pixoState.mouthOpen;
        setAvatarSprite(pixoState.mouthOpen);
      }
      if (pixoState.typedCount % 2 === 1) {
        SFX.playPixoVoice(pixoState.typedCount);
      }
    } else {
      // Rest briefly with mouth closed on spaces & punctuation
      pixoState.mouthOpen = false;
      setAvatarSprite(false);
    }

    const delay = (ch === '!' || ch === '.' || ch === '?') ? 105 : (ch === ',' ? 68 : 26);
    pixoState.typeTimer = setTimeout(tick, delay);
  };

  pixoState.typeTimer = setTimeout(tick, 45);
}

function renderStepChrome() {
  const step = TOUR_STEPS[pixoState.stepIdx] || TOUR_STEPS[0];
  if (pixoStepBadge) {
    pixoStepBadge.textContent = `${pixoState.stepIdx + 1}/${TOUR_STEPS.length}`;
  }

  if (pixoTasks) {
    pixoTasks.innerHTML = '';
    for (let i = 0; i < step.tasks.length; i++) {
      const task = step.tasks[i];
      const done = pixoState.completedTasks.has(task.id);
      const chip = document.createElement('span');
      chip.className = 'pixo-task-chip' + (done ? ' done' : '');
      const box = document.createElement('span');
      box.className = 'pixo-task-box';
      const lbl = document.createElement('span');
      lbl.textContent = task.label;
      chip.appendChild(box);
      chip.appendChild(lbl);
      pixoTasks.appendChild(chip);
    }
  }

  if (pixoDots) {
    pixoDots.innerHTML = '';
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const dot = document.createElement('span');
      dot.className = 'pixo-dot' + (i < pixoState.stepIdx ? ' done' : (i === pixoState.stepIdx ? ' active' : ''));
      pixoDots.appendChild(dot);
    }
  }

  if (pixoNextBtn) {
    const isLast = pixoState.stepIdx >= TOUR_STEPS.length - 1;
    pixoNextBtn.textContent = isLast ? 'DONE!' : 'NEXT';
  }
}

function goToStep(idx) {
  clearTimers();
  if (idx >= TOUR_STEPS.length) {
    completeTour(true);
    return;
  }
  pixoState.stepIdx = Math.max(0, idx);
  pixoState.completedTasks.clear();
  pixoState.stepCleared = false;

  const step = TOUR_STEPS[pixoState.stepIdx];
  renderStepChrome();
  startTypewriter(step.text);

  // If user is already in BUILD mode when arriving at the BUILD step, let it complete cleanly
  if (step.id === 'build_mode' && state.mode === 'BUILD') {
    markStepTaskDone('build');
  }
}

function markStepTaskDone(taskId) {
  if (!pixoState.open || pixoState.stepCleared) return;
  const step = TOUR_STEPS[pixoState.stepIdx];
  if (!step || step.tasks.length === 0) return;
  if (!step.tasks.some(t => t.id === taskId)) return;
  if (pixoState.completedTasks.has(taskId)) return;

  pixoState.completedTasks.add(taskId);
  renderStepChrome();

  const allDone = step.tasks.every(t => pixoState.completedTasks.has(t.id));
  if (allDone) {
    pixoState.stepCleared = true;
    finishTypingNow();
    triggerPixoCheer(true);
    clearTimeout(pixoState.autoAdvanceTimer);
    pixoState.autoAdvanceTimer = setTimeout(() => {
      pixoState.autoAdvanceTimer = null;
      if (pixoState.open && pixoState.stepCleared) {
        goToStep(pixoState.stepIdx + 1);
      }
    }, 1050);
  }
}

export function updatePixoUI() {
  const tipsOn = Boolean(state.pixoTooltips);
  if (pixoMenuBtn) {
    pixoMenuBtn.classList.toggle('tips-off', !tipsOn);
    pixoMenuBtn.classList.toggle('active', Boolean(pixoPopover && pixoPopover.classList.contains('open')));
  }
  if (pixoTooltipsToggleBtn) {
    pixoTooltipsToggleBtn.textContent = tipsOn ? 'ON' : 'OFF';
    pixoTooltipsToggleBtn.classList.toggle('active', tipsOn);
  }
  if (pixoBubbleTipsBtn) {
    pixoBubbleTipsBtn.textContent = tipsOn ? 'TIPS: ON' : 'TIPS: OFF';
    pixoBubbleTipsBtn.classList.toggle('off', !tipsOn);
  }
  if (pixoReplayBtn) {
    if (pixoState.open) {
      pixoReplayBtn.textContent = 'HIDE PIXO';
    } else {
      pixoReplayBtn.textContent = state.tutorialDone ? 'REPLAY TOUR' : 'SUMMON PIXO';
    }
  }
}

export function setPixoTooltipsEnabled(enabled, persist = true, toast = true) {
  state.pixoTooltips = Boolean(enabled);
  if (!state.pixoTooltips) {
    hideUiTooltip();
  }
  updatePixoUI();
  if (persist) savePrefsNow();
  if (toast) {
    showToast(state.pixoTooltips ? 'PIXO TOOLTIPS ON' : 'PIXO TOOLTIPS OFF');
  }
}

export function startPixoTour(fromReplay = false) {
  if (!pixoBuddy) return;
  if (pixoPopover) pixoPopover.classList.remove('open');
  if (fromReplay && state.mode === 'BUILD') {
    setMode('PLAY', false);
  }
  pixoState.open = true;
  pixoBuddy.classList.add('open');
  document.body.classList.add('pixo-open');
  setAvatarSprite(false);
  updatePixoUI();
  goToStep(0);
}

export function closePixoTour(markDone = true, showHint = false) {
  clearTimers();
  pixoState.open = false;
  pixoState.typing = false;
  setAvatarSprite(false);
  setAvatarPose('idle');
  if (pixoBuddy) pixoBuddy.classList.remove('open');
  document.body.classList.remove('pixo-open');
  if (markDone && !state.tutorialDone) {
    state.tutorialDone = true;
    savePrefsNow();
  }
  updatePixoUI();
  if (showHint) {
    showToast('SUMMON PIXO ANYTIME WITH ?');
  }
}

function completeTour(withCheer = true) {
  state.tutorialDone = true;
  savePrefsNow();
  if (withCheer && pixoState.open) {
    finishTypingNow();
    triggerPixoCheer(true);
    clearTimeout(pixoState.autoAdvanceTimer);
    pixoState.autoAdvanceTimer = setTimeout(() => {
      closePixoTour(true, false);
      showToast('TOUR COMPLETE! CLICK ? ANYTIME');
    }, 640);
  } else {
    closePixoTour(true, false);
  }
}

export function notifyPixoEvent(eventName) {
  if (!pixoState.open) return;
  const step = TOUR_STEPS[pixoState.stepIdx];
  if (!step) return;

  if (step.id === 'walk_jump') {
    if (eventName === 'walk') markStepTaskDone('walk');
    else if (eventName === 'jump') markStepTaskDone('jump');
  } else if (step.id === 'zoom_tab') {
    if (eventName === 'zoom' || eventName === 'tab') markStepTaskDone('view');
  } else if (step.id === 'build_mode') {
    if (eventName === 'build') markStepTaskDone('build');
  } else if (step.id === 'create_sprite') {
    if (eventName === 'editorOpen') markStepTaskDone('editorOpen');
    else if (eventName === 'editorSave') {
      // Saving implies the editor was opened too
      pixoState.completedTasks.add('editorOpen');
      markStepTaskDone('editorSave');
    }
  } else if (step.id === 'place_tile') {
    if (eventName === 'placeTile') markStepTaskDone('placeTile');
  }
}

export function initPixoUI(ownsSession = true) {
  preloadPixoSprites();
  updatePixoUI();

  if (pixoMenuBtn && pixoPopover) {
    pixoMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      SFX.unlock();
      hideUiTooltip();
      if (audioPopover) audioPopover.classList.remove('open');
      pixoPopover.classList.toggle('open');
      updatePixoUI();
    });

    document.addEventListener('pointerdown', e => {
      if (
        pixoPopover.classList.contains('open') &&
        !pixoPopover.contains(e.target) &&
        !pixoMenuBtn.contains(e.target)
      ) {
        pixoPopover.classList.remove('open');
        updatePixoUI();
      }
    });
  }

  if (pixoTooltipsToggleBtn) {
    pixoTooltipsToggleBtn.addEventListener('click', () => {
      setPixoTooltipsEnabled(!state.pixoTooltips, true, true);
    });
  }

  if (pixoBubbleTipsBtn) {
    pixoBubbleTipsBtn.addEventListener('click', () => {
      setPixoTooltipsEnabled(!state.pixoTooltips, true, true);
    });
  }

  if (pixoReplayBtn) {
    pixoReplayBtn.addEventListener('click', () => {
      if (pixoState.open) {
        closePixoTour(true, false);
        if (pixoPopover) pixoPopover.classList.remove('open');
        updatePixoUI();
      } else {
        startPixoTour(true);
      }
    });
  }

  if (pixoSkipBtn) {
    pixoSkipBtn.addEventListener('click', () => {
      closePixoTour(true, true);
    });
  }

  if (pixoNextBtn) {
    pixoNextBtn.addEventListener('click', () => {
      if (pixoState.typing) {
        finishTypingNow();
        return;
      }
      goToStep(pixoState.stepIdx + 1);
    });
  }

  if (pixoAvatarBtn) {
    pixoAvatarBtn.addEventListener('click', () => {
      SFX.unlock();
      clearTimeout(pixoState.pokeTimer);
      setAvatarSprite(true);
      setAvatarPose('poked');
      SFX.playPixoVoice(Math.floor(Math.random() * 8));
      pixoState.pokeTimer = setTimeout(() => {
        pixoState.pokeTimer = null;
        if (pixoState.open) {
          setAvatarSprite(pixoState.typing ? pixoState.mouthOpen : false);
          if (!pixoState.cheerTimer) setAvatarPose(pixoState.typing ? 'talking' : 'idle');
        }
      }, 320);
    });
  }

  // First-time visitors meet Pixo after the Switch 2-style Welcome opening (or right after boot if welcome was already completed)
  if (ownsSession && !state.tutorialDone && state.welcomeDone) {
    setTimeout(() => {
      if (!state.tutorialDone && !pixoState.open) {
        startPixoTour(false);
      }
    }, 720);
  }
}
