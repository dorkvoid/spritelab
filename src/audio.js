import { sessionGuard } from './storage.js';
import { updateAudioUI } from './ui/topbar.js';
import { clamp } from './utils.js';

/* =========================================================================
   IMMERSIVE SOUND ENGINE (LAYERED ACOUSTIC/FOLEY WEB AUDIO + YOUTUBE AMBIENT)
   Warm stereo room reverb, organic noise buffers, pitch/timbre humanization,
   and curated soft YouTube ambient music with seamless generative synth fallback.
   ========================================================================= */
export const AMBIENT_TRACKS = {
  yt_astroneer: { id: 'yt_astroneer', ytId: 'JLQsLNOHcxw', label: 'ASTRONEER AMBIENT' },
  synth: { id: 'synth', ytId: null, label: 'TOYBOX DRIFT (SYNTH)' }
};

export const SFX = (() => {
  let ctx = null;
  let masterComp = null;
  let sfxGain = null;
  let musicGain = null;
  let reverbNode = null;
  let reverbGain = null;
  let whiteBuf = null;
  let pinkBuf = null;
  let unlocked = false;

  const cfg = {
    sfxVol: 0.85,
    musicVol: 0.28,
    sfxMuted: false,
    musicMuted: false,
    musicEnabled: true,
    trackId: 'yt_astroneer'
  };

  const throttle = {
    crunch: 0,
    place: 0,
    step: 0,
    btn: 0,
    swim: 0
  };

  let stepFootToggle = 0;

  // Built-in Lush Generative Ambient Synth (warm felt Rhodes + breathing pad + toybox chimes)
  const synthState = {
    active: false,
    timer: null,
    chordIdx: 0,
    padOscs: [],
    padGain: null,
    padFilter: null
  };

  // Curated YouTube IFrame Ambient Music controller with automatic fallback
  const ytState = {
    apiLoading: false,
    apiReady: false,
    player: null,
    ready: false,
    playing: false,
    failed: false,
    fallbackTimer: null,
    currentVideoId: null
  };

  function notifyUI() {
    if (typeof updateAudioUI === 'function') updateAudioUI();
  }

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      return ctx;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();

    masterComp = ctx.createDynamicsCompressor();
    masterComp.threshold.value = -14;
    masterComp.knee.value = 18;
    masterComp.ratio.value = 4;
    masterComp.attack.value = 0.004;
    masterComp.release.value = 0.16;
    masterComp.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = cfg.sfxMuted ? 0 : cfg.sfxVol;
    sfxGain.connect(masterComp);

    musicGain = ctx.createGain();
    musicGain.gain.value = (cfg.musicMuted || !cfg.musicEnabled) ? 0 : cfg.musicVol;
    musicGain.connect(masterComp);

    // Synthesize warm 1.15s stereo studio/toybox room impulse response
    const irLen = Math.floor(ctx.sampleRate * 1.15);
    const irBuf = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = irBuf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        const env = Math.pow(1 - t, 2.8) * (i < 420 ? i / 420 : 1);
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * (0.18 + (1 - t) * 0.25);
        data[i] = lp * env * 0.6;
      }
    }
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = irBuf;
    reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.36;
    reverbNode.connect(reverbGain);
    reverbGain.connect(sfxGain);

    // Pre-build 2-second White and Pink noise buffers for organic foley
    const bufLen = ctx.sampleRate * 2;
    whiteBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    pinkBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const wd = whiteBuf.getChannelData(0);
    const pd = pinkBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufLen; i++) {
      const w = Math.random() * 2 - 1;
      wd[i] = w;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return ctx;
  }

  function sendOut(node, wet = 0.15) {
    node.connect(sfxGain);
    if (wet > 0 && reverbNode) {
      const g = ctx.createGain();
      g.gain.value = wet;
      node.connect(g);
      g.connect(reverbNode);
    }
  }

  function rand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  function makeNoise(pink = true) {
    const src = ctx.createBufferSource();
    src.buffer = pink ? pinkBuf : whiteBuf;
    src.loop = true;
    return src;
  }

  function syncGains() {
    const now = ctx ? ctx.currentTime : 0;
    if (sfxGain && ctx) {
      sfxGain.gain.setTargetAtTime(cfg.sfxMuted ? 0 : cfg.sfxVol, now, 0.02);
    }
    if (musicGain && ctx) {
      const mTarget = (cfg.musicMuted || !cfg.musicEnabled) ? 0 : cfg.musicVol;
      musicGain.gain.setTargetAtTime(mTarget, now, 0.08);
    }
    if (ytState.player && ytState.ready) {
      try {
        if (cfg.musicMuted || !cfg.musicEnabled) {
          ytState.player.mute();
        } else {
          ytState.player.unMute();
          ytState.player.setVolume(Math.round(cfg.musicVol * 100));
        }
      } catch (_) {}
    }
  }

  /* ---------------------------------------------------------------------
     BUILT-IN GENERATIVE AMBIENT SYNTH ("TOYBOX DRIFT")
     Lush dreamy Cmaj9 / Fmaj7#11 / Am9 / G6 felt-piano chords & chimes.
     --------------------------------------------------------------------- */
  const AMBIENT_CHORDS = [
    [130.81, 196.00, 246.94, 293.66, 329.63], // Cmaj9
    [174.61, 220.00, 261.63, 329.63, 392.00], // Fmaj9
    [110.00, 164.81, 196.00, 246.94, 293.66], // Am11
    [146.83, 220.00, 261.63, 329.63, 392.00], // Dm11
    [196.00, 246.94, 293.66, 329.63, 440.00]  // G6/9
  ];
  const CHIME_SCALE = [523.25, 587.33, 659.25, 783.99, 880.00, 987.77, 1046.50, 1174.66];

  function playFeltNote(freq, startT, dur, peakGain, bright = 1200) {
    if (!ctx || !musicGain) return;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, startT);
    osc2.frequency.setValueAtTime(freq * 2, startT);
    osc2.detune.setValueAtTime(rand(-4, 4), startT);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(bright, startT);
    filt.frequency.exponentialRampToValueAtTime(Math.max(260, bright * 0.32), startT + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(peakGain, startT + Math.min(0.35, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

    const sub2 = ctx.createGain();
    sub2.gain.value = 0.14;

    osc1.connect(filt);
    osc2.connect(sub2);
    sub2.connect(filt);
    filt.connect(g);
    g.connect(musicGain);
    if (reverbNode) {
      const rv = ctx.createGain();
      rv.gain.value = 0.55;
      g.connect(rv);
      rv.connect(reverbNode);
    }
    osc1.start(startT);
    osc2.start(startT);
    osc1.stop(startT + dur + 0.08);
    osc2.stop(startT + dur + 0.08);
  }

  function scheduleAmbientPhrase() {
    if (!synthState.active || !ctx) return;
    const now = ctx.currentTime + 0.05;
    const chord = AMBIENT_CHORDS[synthState.chordIdx % AMBIENT_CHORDS.length];
    synthState.chordIdx++;

    // Warm rolled felt-piano chord
    chord.forEach((f, idx) => {
      playFeltNote(f, now + idx * 0.14 + rand(0, 0.04), 6.8, 0.095 - idx * 0.008, 1050);
    });

    // 2-3 delicate pentatonic toybox celesta sparkles drifting over the bar
    const chimeCount = Math.random() > 0.4 ? 3 : 2;
    for (let i = 0; i < chimeCount; i++) {
      const note = CHIME_SCALE[Math.floor(Math.random() * CHIME_SCALE.length)];
      const offset = 1.4 + i * rand(1.15, 1.85);
      playFeltNote(note, now + offset, 3.4, 0.045, 2200);
    }

    synthState.timer = setTimeout(scheduleAmbientPhrase, rand(5800, 7400));
  }

  function startAmbientSynth() {
    if (synthState.active) return;
    if (!ensureContext()) return;
    synthState.active = true;
    const now = ctx.currentTime;

    // Soft breathing warm sub-pad bed
    const padFilt = ctx.createBiquadFilter();
    padFilt.type = 'lowpass';
    padFilt.frequency.value = 420;
    const padG = ctx.createGain();
    padG.gain.setValueAtTime(0.0001, now);
    padG.gain.linearRampToValueAtTime(0.11, now + 2.2);
    padFilt.connect(padG);
    padG.connect(musicGain);

    const freqs = [130.81, 196.00, 261.63];
    synthState.padOscs = freqs.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 5;
      o.connect(padFilt);
      o.start(now);
      return o;
    });
    synthState.padGain = padG;
    synthState.padFilter = padFilt;

    scheduleAmbientPhrase();
    notifyUI();
  }

  function stopAmbientSynth() {
    if (!synthState.active) return;
    synthState.active = false;
    clearTimeout(synthState.timer);
    synthState.timer = null;
    if (ctx && synthState.padGain) {
      const now = ctx.currentTime;
      const oldGain = synthState.padGain;
      const oldFilter = synthState.padFilter;
      const oldOscs = synthState.padOscs.slice();
      try {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setTargetAtTime(0.0001, now, 0.25);
      } catch (_) {}
      setTimeout(() => {
        oldOscs.forEach(o => { try { o.stop(); o.disconnect(); } catch (_) {} });
        if (oldFilter) { try { oldFilter.disconnect(); } catch (_) {} }
        if (oldGain) { try { oldGain.disconnect(); } catch (_) {} }
      }, 900);
    }
    synthState.padOscs = [];
    synthState.padGain = null;
    synthState.padFilter = null;
    notifyUI();
  }

  /* ---------------------------------------------------------------------
     SOFT YOUTUBE AMBIENT MUSIC PLAYER (WITH AUTOMATIC SYNTH FALLBACK)
     --------------------------------------------------------------------- */
  function loadYouTubeAPI() {
    if (ytState.apiReady || ytState.apiLoading) return;
    if (window.YT && window.YT.Player) {
      ytState.apiReady = true;
      initYouTubePlayer();
      return;
    }
    ytState.apiLoading = true;
    const prevCb = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevCb === 'function') prevCb();
      ytState.apiReady = true;
      ytState.apiLoading = false;
      initYouTubePlayer();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => {
      ytState.apiLoading = false;
      ytState.failed = true;
      if (cfg.musicEnabled) startAmbientSynth();
      notifyUI();
    };
    document.head.appendChild(tag);
  }

  function initYouTubePlayer() {
    if (ytState.player || !window.YT || !window.YT.Player) return;
    const track = AMBIENT_TRACKS[cfg.trackId] || AMBIENT_TRACKS.yt_astroneer;
    const vid = track.ytId || AMBIENT_TRACKS.yt_astroneer.ytId;
    ytState.currentVideoId = vid;
    try {
      ytState.player = new window.YT.Player('ytMusicPlayer', {
        width: '200',
        height: '200',
        videoId: vid,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          loop: 1,
          playlist: vid,
          modestbranding: 1,
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: () => {
            ytState.ready = true;
            ytState.failed = false;
            syncGains();
            if (unlocked && cfg.musicEnabled && cfg.trackId !== 'synth') {
              playCurrentYouTubeTrack();
            }
            notifyUI();
          },
          onStateChange: e => {
            const YT = window.YT;
            if (!YT) return;
            if (e.data === YT.PlayerState.PLAYING) {
              ytState.playing = true;
              ytState.failed = false;
              clearTimeout(ytState.fallbackTimer);
              stopAmbientSynth();
              syncGains();
              notifyUI();
            } else if (e.data === YT.PlayerState.ENDED) {
              try { ytState.player.playVideo(); } catch (_) {}
            } else if (e.data === YT.PlayerState.PAUSED) {
              ytState.playing = false;
              notifyUI();
            }
          },
          onError: () => {
            ytState.playing = false;
            ytState.failed = true;
            if (cfg.musicEnabled) startAmbientSynth();
            notifyUI();
          }
        }
      });
    } catch (_) {
      ytState.failed = true;
      if (cfg.musicEnabled) startAmbientSynth();
      notifyUI();
    }
  }

  function playCurrentYouTubeTrack() {
    const track = AMBIENT_TRACKS[cfg.trackId];
    if (!track || !track.ytId) return;
    clearTimeout(ytState.fallbackTimer);

    // Graceful fallback to built-in ambient synth if YouTube is blocked or offline
    ytState.fallbackTimer = setTimeout(() => {
      if (cfg.musicEnabled && cfg.trackId !== 'synth' && !ytState.playing) {
        startAmbientSynth();
        notifyUI();
      }
    }, 6500);

    if (!ytState.apiReady) {
      loadYouTubeAPI();
      return;
    }
    if (!ytState.player) {
      initYouTubePlayer();
      return;
    }
    if (!ytState.ready) return;
    try {
      if (ytState.currentVideoId !== track.ytId) {
        ytState.currentVideoId = track.ytId;
        ytState.player.loadVideoById({ videoId: track.ytId });
      } else {
        ytState.player.playVideo();
      }
      syncGains();
    } catch (_) {
      ytState.failed = true;
      startAmbientSynth();
    }
  }

  function preloadYouTube() {
    if (cfg.musicEnabled && cfg.trackId !== 'synth') {
      loadYouTubeAPI();
    }
  }

  function stopYouTube() {
    clearTimeout(ytState.fallbackTimer);
    ytState.playing = false;
    if (ytState.player && ytState.ready) {
      try { ytState.player.pauseVideo(); } catch (_) {}
    }
  }

  function startMusic() {
    if (!cfg.musicEnabled) return;
    ensureContext();
    if (cfg.trackId === 'synth') {
      stopYouTube();
      startAmbientSynth();
    } else {
      playCurrentYouTubeTrack();
    }
    notifyUI();
  }

  function unlock() {
    if (typeof sessionGuard !== 'undefined' && sessionGuard.isLocked()) return;
    if (unlocked) {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    unlocked = true;
    ensureContext();
    syncGains();
    if (cfg.musicEnabled) startMusic();
    notifyUI();
  }

  function suspendForLock() {
    stopYouTube();
    stopAmbientSynth();
    notifyUI();
  }

  function resumeFromLock() {
    if (unlocked && cfg.musicEnabled && !cfg.musicMuted) {
      startMusic();
    }
    notifyUI();
  }

  /* =====================================================================
     EXPRESSIVE FOLEY & ACOUSTIC SOUND EFFECTS
     ===================================================================== */

  // 1. Walking Footsteps (organic left/right thump + surface scuff; skate scrape on ice)
  function playStep(onSlip = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.step < 110) return;
    throttle.step = nowMs;

    const t = ctx.currentTime;
    stepFootToggle = 1 - stepFootToggle;
    const footPitch = stepFootToggle === 0 ? 1.0 : 1.11;

    if (onSlip) {
      // Icy skate glide scuff
      const n = makeNoise(true);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(rand(2900, 3900) * footPitch, t);
      bp.Q.value = 3.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
      n.connect(bp); bp.connect(g); sendOut(g, 0.22);
      n.start(t, rand(0, 1.5), 0.1);
      return;
    }

    // Soft warm heel/toe thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(rand(122, 142) * footPitch, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.048);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.14, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    osc.connect(og); sendOut(og, 0.08);
    osc.start(t); osc.stop(t + 0.06);

    // Subtle grit/shoe scuff
    const n = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(rand(1050, 1550) * footPitch, t);
    bp.Q.value = 1.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.085, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);
    n.connect(bp); bp.connect(ng); sendOut(ng, 0.12);
    n.start(t, rand(0, 1.5), 0.05);
  }

  // 1b. Climbing ladder / vine rung tap
  function playClimbStep() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    stepFootToggle = 1 - stepFootToggle;
    const base = stepFootToggle ? 310 : 375;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base * rand(0.95, 1.05), t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.62, t + 0.05);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 720;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    osc.connect(filt); filt.connect(g); sendOut(g, 0.15);
    osc.start(t); osc.stop(t + 0.06);
  }

  // 2. Jumping Sound (expressive spring lift + airy breath whoosh)
  function playJump(isWallJump = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const p = rand(0.95, 1.06) * (isWallJump ? 1.12 : 1.0);

    // Expressive tonal upward lift
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(165 * p, t);
    osc.frequency.exponentialRampToValueAtTime(385 * p, t + 0.115);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1250, t);
    filt.frequency.exponentialRampToValueAtTime(520, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.17, t + 0.012);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.145);
    osc.connect(filt); filt.connect(og); sendOut(og, 0.22);
    osc.start(t); osc.stop(t + 0.16);

    // Soft warm harmonic overtone
    const over = ctx.createOscillator();
    over.type = 'sine';
    over.frequency.setValueAtTime(330 * p, t + 0.01);
    over.frequency.exponentialRampToValueAtTime(620 * p, t + 0.12);
    const ovg = ctx.createGain();
    ovg.gain.setValueAtTime(0.0001, t + 0.01);
    ovg.gain.linearRampToValueAtTime(0.06, t + 0.025);
    ovg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    over.connect(ovg); sendOut(ovg, 0.28);
    over.start(t + 0.01); over.stop(t + 0.14);

    // Airy upward push whoosh
    const n = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(520, t);
    bp.frequency.exponentialRampToValueAtTime(2100, t + 0.11);
    bp.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.09, t + 0.015);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(bp); bp.connect(ng); sendOut(ng, 0.18);
    n.start(t, rand(0, 1.5), 0.13);
  }

  // 2b. Bouncy Spring Block launch
  function playBounce() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(480, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(360, t + 0.32);
    lfo.frequency.value = 26;
    lfoG.gain.setValueAtTime(36, t);
    lfoG.gain.exponentialRampToValueAtTime(2, t + 0.30);
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.24, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(g); sendOut(g, 0.3);
    osc.start(t); lfo.start(t);
    osc.stop(t + 0.35); lfo.stop(t + 0.35);
  }

  // 3. Fall Impact / Landing Sound (scales dynamically from soft tap to weighty thud)
  function playLand(impact = 0.5, onSlip = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const imp = clamp(impact, 0.15, 1.0);

    // Weighty floor thump
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(108 + imp * 30, t);
    sub.frequency.exponentialRampToValueAtTime(32 + (1 - imp) * 14, t + 0.09 + imp * 0.08);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.16 + imp * 0.28, t + 0.005);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.11 + imp * 0.09);
    sub.connect(sg); sendOut(sg, 0.14);
    sub.start(t); sub.stop(t + 0.22);

    // Settling grit / gravel burst
    const n = makeNoise(true);
    const lp = ctx.createBiquadFilter();
    lp.type = onSlip ? 'bandpass' : 'lowpass';
    lp.frequency.setValueAtTime(onSlip ? 3200 : (650 + imp * 950), t);
    lp.frequency.exponentialRampToValueAtTime(onSlip ? 1600 : 210, t + 0.08 + imp * 0.07);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.11 + imp * 0.16, t + 0.006);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + imp * 0.08);
    n.connect(lp); lp.connect(ng); sendOut(ng, 0.18);
    n.start(t, rand(0, 1.4), 0.19);

    // Secondary heel-settle micro-tap on heavy falls
    if (imp > 0.55) {
      const tapT = t + 0.052;
      const tap = ctx.createOscillator();
      tap.type = 'sine';
      tap.frequency.setValueAtTime(86, tapT);
      tap.frequency.exponentialRampToValueAtTime(38, tapT + 0.045);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, tapT);
      tg.gain.linearRampToValueAtTime(0.10 * imp, tapT + 0.004);
      tg.gain.exponentialRampToValueAtTime(0.0001, tapT + 0.055);
      tap.connect(tg); sendOut(tg, 0.1);
      tap.start(tapT); tap.stop(tapT + 0.06);
    }
  }

  // 4. Death Sound (dramatic tumbling toy collapse + soft pixel scatter)
  function playDeath(reason = 'deadly') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    if (reason === 'drown') {
      // Muffled underwater drowning gasp & sinking bubble cascade
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(210, t);
      sub.frequency.exponentialRampToValueAtTime(54, t + 0.42);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.26, t + 0.02);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
      sub.connect(sg); sendOut(sg, 0.42);
      sub.start(t); sub.stop(t + 0.48);

      const wash = makeNoise(true);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(760, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 0.38);
      const wg = ctx.createGain();
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.linearRampToValueAtTime(0.20, t + 0.02);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.40);
      wash.connect(lp); lp.connect(wg); sendOut(wg, 0.35);
      wash.start(t, rand(0, 1.3), 0.42);

      for (let i = 0; i < 6; i++) {
        const f0 = rand(260, 560);
        spawnBubblePop(t + 0.02 + i * 0.048, f0, f0 * 1.9, 0.085 - i * 0.008, 0.055);
      }
      return;
    }

    // Hollow descending fall / collapse voice
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    const startF = reason === 'abyss' ? 340 : 410;
    osc1.frequency.setValueAtTime(startF, t);
    osc1.frequency.exponentialRampToValueAtTime(76, t + 0.42);
    osc2.frequency.setValueAtTime(startF * 0.502, t);
    osc2.frequency.exponentialRampToValueAtTime(48, t + 0.44);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1600, t);
    filt.frequency.exponentialRampToValueAtTime(180, t + 0.44);
    filt.Q.value = 3.0;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
    osc1.connect(filt); osc2.connect(filt); filt.connect(g); sendOut(g, 0.35);
    osc1.start(t); osc2.start(t);
    osc1.stop(t + 0.48); osc2.stop(t + 0.48);

    // 4 staggered hollow wooden/toy scatter clacks
    const clackOffsets = [0.02, 0.075, 0.145, 0.23];
    clackOffsets.forEach((off, idx) => {
      const ct = t + off;
      const c = ctx.createOscillator();
      c.type = 'triangle';
      c.frequency.setValueAtTime(rand(520, 740) - idx * 85, ct);
      c.frequency.exponentialRampToValueAtTime(170, ct + 0.045);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, ct);
      cg.gain.linearRampToValueAtTime(0.11 - idx * 0.02, ct + 0.004);
      cg.gain.exponentialRampToValueAtTime(0.0001, ct + 0.055);
      c.connect(cg); sendOut(cg, 0.22);
      c.start(ct); c.stop(ct + 0.06);
    });

    // Soft low poof
    const n = makeNoise(true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.25);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.18, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    n.connect(lp); lp.connect(ng); sendOut(ng, 0.2);
    n.start(t, rand(0, 1.3), 0.28);
  }

  function playHurt() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(95, t + 0.14);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 950;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.20, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(filt); filt.connect(g); sendOut(g, 0.18);
    osc.start(t); osc.stop(t + 0.17);
  }

  function playRespawn() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    [392.0, 523.25, 659.25].forEach((f, i) => {
      const st = t + i * 0.045;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, st);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.09, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
      o.connect(g); sendOut(g, 0.35);
      o.start(st); o.stop(st + 0.24);
    });
  }

  // 5. Liquid Sounds: Splash Entry / Exit, Liquid Jump, and Underwater Swimming Strokes
  function spawnBubblePop(startT, startFreq, endFreq, vol = 0.08, dur = 0.06) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(startFreq, startT);
    o.frequency.exponentialRampToValueAtTime(endFreq, startT + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur + 0.014);
    o.connect(g); sendOut(g, 0.44);
    o.start(startT); o.stop(startT + dur + 0.022);
  }

  function spawnDropletPlink(startT, freq, vol = 0.06) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, startT);
    o.frequency.exponentialRampToValueAtTime(freq * 1.52, startT + 0.028);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + 0.036);
    o.connect(g); sendOut(g, 0.48);
    o.start(startT); o.stop(startT + 0.045);
  }

  function playSplash(exiting = false, impact = 0.65) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const imp = clamp(impact, 0.25, 1.2);

    if (exiting) {
      // Upward surface tension break glug
      const breakOsc = ctx.createOscillator();
      breakOsc.type = 'sine';
      breakOsc.frequency.setValueAtTime(175, t);
      breakOsc.frequency.exponentialRampToValueAtTime(460, t + 0.11);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.15 * imp, t + 0.012);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      breakOsc.connect(bg); sendOut(bg, 0.36);
      breakOsc.start(t); breakOsc.stop(t + 0.18);

      // Frothy water breach & shedding wash
      const wash = makeNoise(true);
      const wbp = ctx.createBiquadFilter();
      wbp.type = 'bandpass';
      wbp.Q.value = 1.05;
      wbp.frequency.setValueAtTime(680, t);
      wbp.frequency.exponentialRampToValueAtTime(2950, t + 0.09);
      wbp.frequency.exponentialRampToValueAtTime(1050, t + 0.28);
      const wg = ctx.createGain();
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.linearRampToValueAtTime(0.22 * imp, t + 0.018);
      wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
      wash.connect(wbp); wbp.connect(wg); sendOut(wg, 0.42);
      wash.start(t, rand(0, 1.2), 0.32);

      // Crisp water spray sheen
      const spray = makeNoise(false);
      const shp = ctx.createBiquadFilter();
      shp.type = 'bandpass';
      shp.frequency.setValueAtTime(3600, t);
      shp.frequency.exponentialRampToValueAtTime(1800, t + 0.16);
      shp.Q.value = 1.4;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.09 * imp, t + 0.01);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      spray.connect(shp); shp.connect(sg); sendOut(sg, 0.32);
      spray.start(t, rand(0, 1.2), 0.19);

      // Trailing droplets dripping back onto the liquid surface
      const drips = Math.round(4 + imp * 3);
      for (let i = 0; i < drips; i++) {
        spawnDropletPlink(
          t + 0.05 + i * rand(0.032, 0.058),
          rand(640, 1280),
          rand(0.035, 0.072) * Math.min(1, imp + 0.15)
        );
      }
      return;
    }

    // Entry Splash: 1. Weighty water displacement plunge thump
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(148 + imp * 46, t);
    sub.frequency.exponentialRampToValueAtTime(52, t + 0.12);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, t);
    subG.gain.linearRampToValueAtTime(0.24 * imp, t + 0.008);
    subG.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    sub.connect(subG); sendOut(subG, 0.24);
    sub.start(t); sub.stop(t + 0.17);

    // 2. Resonant hollow water-cavity "kerplunk" gulp
    const gulp = ctx.createOscillator();
    gulp.type = 'sine';
    gulp.frequency.setValueAtTime(265, t + 0.01);
    gulp.frequency.exponentialRampToValueAtTime(94, t + 0.085);
    gulp.frequency.exponentialRampToValueAtTime(235, t + 0.21);
    const gulpG = ctx.createGain();
    gulpG.gain.setValueAtTime(0.0001, t + 0.01);
    gulpG.gain.linearRampToValueAtTime(0.18 * imp, t + 0.025);
    gulpG.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    gulp.connect(gulpG); sendOut(gulpG, 0.42);
    gulp.start(t + 0.01); gulp.stop(t + 0.26);

    // 3. Full foaming water body wash
    const wash = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.0;
    bp.frequency.setValueAtTime(1150, t);
    bp.frequency.exponentialRampToValueAtTime(2650, t + 0.055);
    bp.frequency.exponentialRampToValueAtTime(480, t + 0.34);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.linearRampToValueAtTime(0.28 * imp, t + 0.016);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    wash.connect(bp); bp.connect(wg); sendOut(wg, 0.44);
    wash.start(t, rand(0, 1.3), 0.38);

    // 4. Crisp high-frequency splash crown spray
    const spray = makeNoise(false);
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.Q.value = 1.3;
    sbp.frequency.setValueAtTime(3900, t + 0.008);
    sbp.frequency.exponentialRampToValueAtTime(1650, t + 0.22);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t + 0.008);
    sg.gain.linearRampToValueAtTime(0.12 * imp, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    spray.connect(sbp); sbp.connect(sg); sendOut(sg, 0.35);
    spray.start(t + 0.008, rand(0, 1.3), 0.26);

    // 5. Cascading underwater bubbles + settling surface droplet plinks
    const bubbleCount = Math.round(4 + imp * 4);
    for (let i = 0; i < bubbleCount; i++) {
      const f0 = rand(320, 720);
      spawnBubblePop(
        t + 0.025 + i * rand(0.028, 0.052),
        f0,
        f0 * rand(1.85, 2.35),
        rand(0.045, 0.09) * Math.min(1.1, imp + 0.1),
        rand(0.048, 0.072)
      );
    }
    for (let i = 0; i < 3; i++) {
      spawnDropletPlink(t + 0.16 + i * rand(0.045, 0.075), rand(740, 1320), rand(0.032, 0.06) * imp);
    }
  }

  function playLiquidJump() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    // Energetic water-tension breach hop
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(215, t);
    o.frequency.exponentialRampToValueAtTime(590, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g); sendOut(g, 0.38);
    o.start(t); o.stop(t + 0.19);

    // Frothy upward splash burst on breach
    const n = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.15;
    bp.frequency.setValueAtTime(820, t);
    bp.frequency.exponentialRampToValueAtTime(3250, t + 0.11);
    bp.frequency.exponentialRampToValueAtTime(1250, t + 0.24);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.21, t + 0.016);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    n.connect(bp); bp.connect(ng); sendOut(ng, 0.42);
    n.start(t, rand(0, 1.3), 0.28);

    // Sparkling droplets & trailing surface drips
    spawnBubblePop(t + 0.018, 460, 1080, 0.08);
    spawnBubblePop(t + 0.06, 610, 1360, 0.065);
    spawnDropletPlink(t + 0.11, rand(820, 1180), 0.055);
    spawnDropletPlink(t + 0.165, rand(920, 1340), 0.045);
  }

  function playSwimStroke(upward = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.swim < 260) return;
    throttle.swim = nowMs;

    const t = ctx.currentTime;
    // Soft underwater water-displacement pulse
    const push = ctx.createOscillator();
    push.type = 'sine';
    push.frequency.setValueAtTime(upward ? 112 : 94, t);
    push.frequency.exponentialRampToValueAtTime(52, t + 0.11);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.0001, t);
    pg.gain.linearRampToValueAtTime(0.10, t + 0.028);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    push.connect(pg); sendOut(pg, 0.25);
    push.start(t); push.stop(t + 0.15);

    // Warm fluid paddle swoosh
    const n = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.65;
    bp.frequency.setValueAtTime(upward ? 310 : 250, t);
    bp.frequency.exponentialRampToValueAtTime(upward ? 920 : 680, t + 0.085);
    bp.frequency.exponentialRampToValueAtTime(240, t + 0.23);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.16, t + 0.045);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    n.connect(bp); bp.connect(ng); sendOut(ng, 0.38);
    n.start(t, rand(0, 1.4), 0.26);

    // 1-2 gentle rising underwater bubbles
    const b0 = rand(290, 460);
    spawnBubblePop(t + 0.03, b0, b0 * 2.0, 0.062);
    if (Math.random() > 0.35) {
      const b1 = rand(440, 680);
      spawnBubblePop(t + 0.095, b1, b1 * 1.9, 0.045);
    }
  }

  function playBreathPop(remaining = 5) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const urgent = remaining <= 2;
    const baseF = urgent ? rand(560, 720) : rand(410, 540);
    spawnBubblePop(t, baseF, baseF * (urgent ? 2.25 : 1.95), urgent ? 0.11 : 0.075, 0.048);
  }

  function playGasp() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const n = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(950, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    n.connect(bp); bp.connect(g); sendOut(g, 0.2);
    n.start(t, rand(0, 1.4), 0.19);
  }

  function playDrownHurt() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    // Muffled underwater damage throb + escaping bubble
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(lp); lp.connect(g); sendOut(g, 0.32);
    osc.start(t); osc.stop(t + 0.2);

    const f0 = rand(280, 440);
    spawnBubblePop(t + 0.02, f0, f0 * 1.9, 0.07, 0.055);
  }

  // 6. Creation Success Sound (sparkling marimba/celesta major-9th arpeggio bloom)
  function playCreateSuccess() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    // Warm bass anchor (C4)
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(261.63, t);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(0.14, t + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
    bass.connect(bg); sendOut(bg, 0.42);
    bass.start(t); bass.stop(t + 0.75);

    // Sparkling ascending Cmaj9 toybox chimes
    const notes = [523.25, 659.25, 783.99, 987.77, 1174.66];
    notes.forEach((freq, i) => {
      const st = t + i * 0.052;
      const dur = i === notes.length - 1 ? 0.78 : 0.42;

      const osc = ctx.createOscillator();
      const over = ctx.createOscillator();
      osc.type = 'sine';
      over.type = 'triangle';
      osc.frequency.setValueAtTime(freq, st);
      over.frequency.setValueAtTime(freq * 2.0, st);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(i === notes.length - 1 ? 0.16 : 0.12, st + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur);

      const ovg = ctx.createGain();
      ovg.gain.setValueAtTime(0.04, st);
      ovg.gain.exponentialRampToValueAtTime(0.0001, st + 0.09);

      osc.connect(g);
      over.connect(ovg); ovg.connect(g);
      sendOut(g, 0.48);
      osc.start(st); over.start(st);
      osc.stop(st + dur + 0.05); over.stop(st + 0.12);
    });
  }

  // 7. Cookie Crunch Sound on Block Delete (multi-fracture crispy biscuit snap & crumble)
  function playCookieCrunch() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.crunch < 46) return;
    throttle.crunch = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.90, 1.12);

    // Dry bite weight thump
    const bite = ctx.createOscillator();
    bite.type = 'triangle';
    bite.frequency.setValueAtTime(190 * p, t);
    bite.frequency.exponentialRampToValueAtTime(68, t + 0.04);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(0.15, t + 0.003);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);
    bite.connect(bg); sendOut(bg, 0.06);
    bite.start(t); bite.stop(t + 0.055);

    // 5 staggered crispy biscuit fracture bursts
    const grains = [
      { off: 0.000, freq: 2450, q: 1.8, dur: 0.024, amp: 0.28 },
      { off: 0.017, freq: 1350, q: 2.2, dur: 0.028, amp: 0.24 },
      { off: 0.036, freq: 3450, q: 2.0, dur: 0.022, amp: 0.26 },
      { off: 0.058, freq: 1750, q: 1.7, dur: 0.032, amp: 0.20 },
      { off: 0.088, freq: 2900, q: 2.4, dur: 0.026, amp: 0.14 }
    ];
    grains.forEach(gr => {
      const gt = t + gr.off + rand(0, 0.007);
      const n = makeNoise(false);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(gr.freq * p * rand(0.88, 1.14), gt);
      bp.Q.value = gr.q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, gt);
      g.gain.linearRampToValueAtTime(gr.amp, gt + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0001, gt + gr.dur);
      n.connect(bp); bp.connect(g); sendOut(g, 0.08);
      n.start(gt, rand(0, 1.5), gr.dur + 0.01);

      // Tiny resonant cracker snap ping
      if (Math.random() > 0.3) {
        const snap = ctx.createOscillator();
        snap.type = 'square';
        snap.frequency.setValueAtTime(rand(620, 1180) * p, gt);
        snap.frequency.exponentialRampToValueAtTime(260, gt + 0.014);
        const sf = ctx.createBiquadFilter();
        sf.type = 'bandpass';
        sf.frequency.value = 1800;
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.0001, gt);
        sg.gain.linearRampToValueAtTime(0.055, gt + 0.002);
        sg.gain.exponentialRampToValueAtTime(0.0001, gt + 0.016);
        snap.connect(sf); sf.connect(sg); sendOut(sg, 0.05);
        snap.start(gt); snap.stop(gt + 0.02);
      }
    });
  }

  // 7b. Place Block / Background Effect Placement (tactile wooden click or airy light swell)
  function playPlaceBlock(isBgEffect = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.place < 36) return;
    throttle.place = nowMs;

    const t = ctx.currentTime;
    if (isBgEffect) {
      // Warm translucent shimmer bloom matching the smooth fade-in
      [523.25, 783.99].forEach((f, idx) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * rand(0.98, 1.02), t + idx * 0.04);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + idx * 0.04);
        g.gain.linearRampToValueAtTime(0.075, t + idx * 0.04 + 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.04 + 0.36);
        o.connect(g); sendOut(g, 0.55);
        o.start(t + idx * 0.04); o.stop(t + idx * 0.04 + 0.38);
      });
      return;
    }

    // Crisp wooden-toy snap placement
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const p = rand(0.92, 1.10);
    o.frequency.setValueAtTime(340 * p, t);
    o.frequency.exponentialRampToValueAtTime(165 * p, t + 0.038);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.048);
    o.connect(g); sendOut(g, 0.12);
    o.start(t); o.stop(t + 0.055);
  }

  function playPickup() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(780, t + 0.065);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g); sendOut(g, 0.22);
    o.start(t); o.stop(t + 0.09);
  }

  // 8. Deselect Sound (soft downward put-away flick + delicate air release)
  function playDeselect() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    const notes = [640, 415];
    notes.forEach((f, i) => {
      const st = t + i * 0.036;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * rand(0.97, 1.03), st);
      o.frequency.exponentialRampToValueAtTime(f * 0.72, st + 0.065);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(i === 0 ? 0.11 : 0.09, st + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.085);
      o.connect(g); sendOut(g, 0.24);
      o.start(st); o.stop(st + 0.095);
    });

    const n = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1750, t);
    bp.frequency.exponentialRampToValueAtTime(520, t + 0.09);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.06, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    n.connect(bp); bp.connect(ng); sendOut(ng, 0.20);
    n.start(t, rand(0, 1.4), 0.12);
  }

  // 9. Tactile Button Sounds (clean studio micro-switch click)
  function playButton(variant = 'default') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.btn < 26) return;
    throttle.btn = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.95, 1.05);
    const baseF = variant === 'primary' ? 760 : (variant === 'soft' ? 540 : 650);

    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(baseF * p, t);
    o.frequency.exponentialRampToValueAtTime(baseF * 0.48 * p, t + 0.022);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(variant === 'soft' ? 0.055 : 0.085, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
    o.connect(og); sendOut(og, 0.06);
    o.start(t); o.stop(t + 0.032);

    // Tiny mechanical keycap tick
    const n = makeNoise(false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3200 * p;
    hp.Q.value = 2.0;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.045, t + 0.0015);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    n.connect(hp); hp.connect(ng); sendOut(ng, 0.03);
    n.start(t, rand(0, 1.5), 0.016);
  }

  // 10. Menu Swipe Away / Restore Sound (silky air swoosh + panel dock tuck)
  function playMenuSwipe(hiding = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    const n = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.3;
    if (hiding) {
      bp.frequency.setValueAtTime(1950, t);
      bp.frequency.exponentialRampToValueAtTime(320, t + 0.18);
    } else {
      bp.frequency.setValueAtTime(340, t);
      bp.frequency.exponentialRampToValueAtTime(1850, t + 0.17);
    }
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.16, t + 0.045);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    n.connect(bp); bp.connect(ng); sendOut(ng, 0.25);
    n.start(t, rand(0, 1.3), 0.21);

    // Soft panel snap/tuck tonal accent
    const o = ctx.createOscillator();
    o.type = 'sine';
    const st = hiding ? t + 0.02 : t + 0.09;
    o.frequency.setValueAtTime(hiding ? 520 : 380, st);
    o.frequency.exponentialRampToValueAtTime(hiding ? 260 : 620, st + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, st);
    og.gain.linearRampToValueAtTime(0.065, st + 0.012);
    og.gain.exponentialRampToValueAtTime(0.0001, st + 0.095);
    o.connect(og); sendOut(og, 0.22);
    o.start(st); o.stop(st + 0.11);
  }

  // Extra toybox foley for Body Equip, Gatherables, Switches, Portals, Emitters
  function playBodyEquip(equipping = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const seq = equipping ? [392.0, 523.25, 783.99] : [587.33, 392.0];
    seq.forEach((f, i) => {
      const st = t + i * 0.042;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, st);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.10, st + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
      o.connect(g); sendOut(g, 0.34);
      o.start(st); o.stop(st + 0.24);
    });
  }

  function playCollect() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    [659.25, 987.77, 1318.5].forEach((f, i) => {
      const st = t + i * 0.04;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, st);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.11, st + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.25);
      o.connect(g); sendOut(g, 0.40);
      o.start(st); o.stop(st + 0.28);
    });
  }

  function playSwitch(on = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(on ? 320 : 480, t);
    o.frequency.exponentialRampToValueAtTime(on ? 540 : 280, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g); sendOut(g, 0.18);
    o.start(t); o.stop(t + 0.09);
  }

  function playPortal() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    [330, 495, 660, 990].forEach((f, i) => {
      const st = t + i * 0.035;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * 1.45, st + 0.24);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.085, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.28);
      o.connect(g); sendOut(g, 0.55);
      o.start(st); o.stop(st + 0.30);
    });
  }

  function playEmit() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); sendOut(g, 0.16);
    o.start(t); o.stop(t + 0.10);
  }

  return {
    cfg,
    unlock,
    preloadYouTube,
    suspendForLock,
    resumeFromLock,
    getStatus() {
      if (!unlocked) return { playing: false, text: 'CLICK ANYWHERE TO START' };
      if (!cfg.musicEnabled || cfg.musicMuted) return { playing: false, text: 'AMBIENT PAUSED' };
      const tr = AMBIENT_TRACKS[cfg.trackId] || AMBIENT_TRACKS.yt_astroneer;
      if (cfg.trackId === 'synth') return { playing: synthState.active, text: 'PLAYING: TOYBOX DRIFT' };
      if (ytState.playing) return { playing: true, text: 'YT: ' + tr.label };
      if (synthState.active) return { playing: true, text: 'SYNTH FALLBACK ACTIVE' };
      return { playing: false, text: 'LOADING YT AMBIENT...' };
    },
    setSfxVol(v) {
      cfg.sfxVol = clamp(v, 0, 1);
      if (cfg.sfxVol > 0) cfg.sfxMuted = false;
      syncGains();
      notifyUI();
    },
    setMusicVol(v) {
      cfg.musicVol = clamp(v, 0, 1);
      if (cfg.musicVol > 0) cfg.musicMuted = false;
      syncGains();
      notifyUI();
    },
    toggleSfxMute() {
      cfg.sfxMuted = !cfg.sfxMuted;
      syncGains();
      notifyUI();
    },
    toggleMusicMute() {
      cfg.musicMuted = !cfg.musicMuted;
      syncGains();
      notifyUI();
    },
    toggleMusicEnabled() {
      unlock();
      cfg.musicEnabled = !cfg.musicEnabled;
      if (cfg.musicEnabled) {
        cfg.musicMuted = false;
        startMusic();
      } else {
        stopYouTube();
        stopAmbientSynth();
      }
      syncGains();
      notifyUI();
    },
    setTrack(trackId) {
      if (!AMBIENT_TRACKS[trackId]) return;
      unlock();
      cfg.trackId = trackId;
      cfg.musicEnabled = true;
      cfg.musicMuted = false;
      if (trackId === 'synth') {
        stopYouTube();
        startAmbientSynth();
      } else {
        stopAmbientSynth();
        playCurrentYouTubeTrack();
      }
      syncGains();
      notifyUI();
    },
    applySavedPrefs(p) {
      if (!p || typeof p !== 'object') return;
      if (Number.isFinite(p.sfxVol)) cfg.sfxVol = clamp(p.sfxVol, 0, 1);
      if (Number.isFinite(p.musicVol)) cfg.musicVol = clamp(p.musicVol, 0, 1);
      if (typeof p.sfxMuted === 'boolean') cfg.sfxMuted = p.sfxMuted;
      if (typeof p.musicMuted === 'boolean') cfg.musicMuted = p.musicMuted;
      if (typeof p.musicEnabled === 'boolean') cfg.musicEnabled = p.musicEnabled;
      if (p.musicTrack && AMBIENT_TRACKS[p.musicTrack]) cfg.trackId = p.musicTrack;
      syncGains();
    },
    playStep,
    playClimbStep,
    playJump,
    playBounce,
    playLand,
    playDeath,
    playHurt,
    playRespawn,
    playSplash,
    playLiquidJump,
    playSwimStroke,
    playBreathPop,
    playGasp,
    playDrownHurt,
    playCreateSuccess,
    playCookieCrunch,
    playPlaceBlock,
    playPickup,
    playDeselect,
    playButton,
    playMenuSwipe,
    playBodyEquip,
    playCollect,
    playSwitch,
    playPortal,
    playEmit
  };
})();
