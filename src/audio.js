import { sessionGuard } from './storage.js';
import { updateAudioUI } from './ui/topbar.js';
import { clamp } from './utils.js';

/* =========================================================================
   IMMERSIVE SOUND ENGINE (TACTILE ACOUSTIC/FOLEY WEB AUDIO + AMBIENT MUSIC)
   Dual-bus stereo studio & hall reverbs, warm tape echo, wooden-marimba &
   felt-key synthesis, expressive foley SFX, and curated YouTube ambient
   music with a lush voice-led "TOYBOX DRIFT" generative ambient soundtrack.
   ========================================================================= */
export const AMBIENT_TRACKS = {
  synth: { id: 'synth', ytId: null, label: 'TOYBOX DRIFT' },
  yt_astroneer: { id: 'yt_astroneer', ytId: 'JLQsLNOHcxw', label: 'ASTRONEER AMBIENT' }
};

export const SFX = (() => {
  let ctx = null;
  let masterComp = null;
  let masterTone = null;
  let sfxGain = null;
  let musicGain = null;
  let sfxReverb = null;
  let sfxReverbGain = null;
  let musicReverb = null;
  let musicReverbGain = null;
  let musicDelayL = null;
  let musicDelayR = null;
  let musicDelayIn = null;
  let whiteBuf = null;
  let pinkBuf = null;
  let unlocked = false;
  let musicBooted = false;
  let musicAllowed = false;
  let autoUnlockBound = false;
  let hasStereoPanner = false;

  const cfg = {
    sfxVol: 0.85,
    musicVol: 0.16,
    sfxMuted: false,
    musicMuted: false,
    musicEnabled: true,
    trackId: 'synth',
    userPickedTrack: false
  };

  const throttle = {
    crunch: 0,
    crumbleShake: 0,
    crumbleBreak: 0,
    crumbleReform: 0,
    place: 0,
    step: 0,
    btn: 0,
    err: -1000,
    swim: 0,
    splash: 0
  };

  let stepFootToggle = 0;

  // Built-in Lush Generative Ambient Soundtrack ("TOYBOX DRIFT")
  // Voice-led D-Lydian felt Rhodes + breathing analog pad + kalimba/celesta motifs
  const synthState = {
    active: false,
    timer: null,
    barIdx: 0,
    motifIdx: 0,
    padOscs: [],
    padGain: null,
    padFilter: null,
    padLfo: null,
    padLfoGain: null
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

  function buildImpulseResponse(durationSec, decayPow, darkStart, darkEnd, preDelaySec = 0) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const preSamples = Math.floor(sr * preDelaySec);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      let lp2 = 0;
      for (let i = 0; i < len; i++) {
        if (i < preSamples) {
          data[i] = 0;
          continue;
        }
        const t = (i - preSamples) / Math.max(1, len - preSamples);
        const fadeIn = i - preSamples < 320 ? (i - preSamples) / 320 : 1;
        const env = Math.pow(1 - t, decayPow) * fadeIn;
        const n = Math.random() * 2 - 1;
        const alpha = darkEnd + (1 - t) * (darkStart - darkEnd);
        lp += (n - lp) * alpha;
        lp2 += (lp - lp2) * (alpha * 0.85);
        data[i] = lp2 * env * 0.55;
      }
    }
    return buf;
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
    hasStereoPanner = typeof ctx.createStereoPanner === 'function';
    ctx.addEventListener('statechange', () => {
      if (!ctx || ctx.state !== 'running') return;
      if (typeof sessionGuard !== 'undefined' && sessionGuard.isLocked()) return;
      const wasUnlocked = unlocked;
      unlocked = true;
      detachAutoUnlockListeners();
      syncGains();
      if (musicAllowed && cfg.musicEnabled && !musicBooted) {
        musicBooted = true;
        startMusic();
      } else if (!wasUnlocked) {
        notifyUI();
      }
    });

    // Gentle warm studio high-shelf tame + transparent dynamics compressor
    masterTone = ctx.createBiquadFilter();
    masterTone.type = 'highshelf';
    masterTone.frequency.value = 5400;
    masterTone.gain.value = -2.8;

    masterComp = ctx.createDynamicsCompressor();
    masterComp.threshold.value = -15;
    masterComp.knee.value = 20;
    masterComp.ratio.value = 3.5;
    masterComp.attack.value = 0.005;
    masterComp.release.value = 0.18;

    masterTone.connect(masterComp);
    masterComp.connect(ctx.destination);

    // Separate SFX & Music buses so muting SFX never kills Music reverb/echo
    sfxGain = ctx.createGain();
    sfxGain.gain.value = cfg.sfxMuted ? 0 : cfg.sfxVol;
    sfxGain.connect(masterTone);

    musicGain = ctx.createGain();
    musicGain.gain.value = (cfg.musicMuted || !cfg.musicEnabled) ? 0 : cfg.musicVol;
    musicGain.connect(masterTone);

    // Tight warm wooden-room reverb for tactile SFX foley (0.68s)
    sfxReverb = ctx.createConvolver();
    sfxReverb.buffer = buildImpulseResponse(0.68, 2.7, 0.34, 0.12, 0.006);
    sfxReverbGain = ctx.createGain();
    sfxReverbGain.gain.value = 0.28;
    sfxReverb.connect(sfxReverbGain);
    sfxReverbGain.connect(sfxGain);

    // Lush 2.5s warm stereo hall reverb dedicated to TOYBOX DRIFT music
    musicReverb = ctx.createConvolver();
    musicReverb.buffer = buildImpulseResponse(2.5, 2.35, 0.26, 0.07, 0.018);
    musicReverbGain = ctx.createGain();
    musicReverbGain.gain.value = 0.46;
    musicReverb.connect(musicReverbGain);
    musicReverbGain.connect(musicGain);

    // Subtle stereo ping-pong tape echo for Toybox Drift celesta/Rhodes tails
    musicDelayIn = ctx.createGain();
    musicDelayIn.gain.value = 0.26;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 1850;
    musicDelayL = ctx.createDelay(1.0);
    musicDelayR = ctx.createDelay(1.0);
    musicDelayL.delayTime.value = 0.42;
    musicDelayR.delayTime.value = 0.63;
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = 0.34;
    fbR.gain.value = 0.32;
    const outL = hasStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const outR = hasStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (hasStereoPanner) {
      outL.pan.value = -0.52;
      outR.pan.value = 0.52;
    }

    musicDelayIn.connect(delayTone);
    delayTone.connect(musicDelayL);
    delayTone.connect(musicDelayR);
    musicDelayL.connect(fbL);
    fbL.connect(musicDelayR);
    musicDelayR.connect(fbR);
    fbR.connect(musicDelayL);
    musicDelayL.connect(outL);
    musicDelayR.connect(outR);
    outL.connect(musicGain);
    outR.connect(musicGain);
    outL.connect(musicReverb);
    outR.connect(musicReverb);

    // Pre-build 3-second seamless-loop White and Pink noise buffers for clickless foley & weather beds
    const bufLen = ctx.sampleRate * 3;
    whiteBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    pinkBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const wd = whiteBuf.getChannelData(0);
    const pd = pinkBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    const fadeLen = Math.min(2048, bufLen >> 3);
    const tail = new Float32Array(fadeLen);
    for (let i = 0; i < bufLen + fadeLen; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const pVal = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      if (i < bufLen) {
        wd[i] = w;
        pd[i] = pVal;
      } else {
        tail[i - bufLen] = pVal;
      }
    }
    // Crossfade tail smoothly into buffer start for clickless infinite weather looping
    for (let i = 0; i < fadeLen; i++) {
      const a = i / fadeLen;
      pd[i] = pd[i] * a + tail[i] * (1 - a);
    }
    return ctx;
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

  function routeOut(node, targetBus, wetBus, wet = 0.15, pan = 0) {
    let out = node;
    if (hasStereoPanner && Math.abs(pan) > 0.01) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -0.95, 0.95);
      node.connect(p);
      out = p;
    }
    out.connect(targetBus);
    if (wet > 0 && wetBus) {
      const g = ctx.createGain();
      g.gain.value = wet;
      out.connect(g);
      g.connect(wetBus);
    }
  }

  function sendOut(node, wet = 0.15, pan = 0) {
    routeOut(node, sfxGain, sfxReverb, wet, pan);
  }

  /* =====================================================================
     SHARED ACOUSTIC SYNTHESIS PRIMITIVES
     Physical-inspired wooden marimba, crystal bell, and shaped noise foley.
     ===================================================================== */
  function playFilteredNoise(pink, startT, dur, f0, f1, Q, vol, wet = 0.14, type = 'bandpass', pan = 0, attack = 0.008) {
    const src = makeNoise(pink);
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = Q;
    filt.frequency.setValueAtTime(Math.max(40, f0), startT);
    if (Math.abs(f1 - f0) > 1) {
      filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), startT + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + Math.min(attack, dur * 0.45));
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur);
    src.connect(filt);
    filt.connect(g);
    sendOut(g, wet, pan);
    src.start(startT, rand(0, 1.4), dur + 0.02);
  }

  /* Warm tactile wooden marimba / kalimba bar (fundamental + 2.756x woody overtone) */
  function playWoodBar(freq, startT, vol = 0.14, dur = 0.14, wet = 0.18, pan = 0, pitchDrop = 0.97) {
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, startT);
    if (pitchDrop !== 1) {
      o1.frequency.exponentialRampToValueAtTime(Math.max(40, freq * pitchDrop), startT + Math.min(0.06, dur));
    }

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, startT);
    g1.gain.linearRampToValueAtTime(vol, startT + 0.003);
    g1.gain.exponentialRampToValueAtTime(0.0001, startT + dur);
    o1.connect(g1);
    sendOut(g1, wet, pan);
    o1.start(startT);
    o1.stop(startT + dur + 0.02);

    // Classic marimba/woodblock 2.756x overtone strike (decays rapidly into warm wood body)
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(Math.min(7200, freq * 2.756), startT);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, startT);
    g2.gain.linearRampToValueAtTime(vol * 0.24, startT + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0001, startT + Math.min(0.036, dur * 0.35));
    o2.connect(g2);
    sendOut(g2, wet * 0.5, pan);
    o2.start(startT);
    o2.stop(startT + Math.min(0.045, dur * 0.4) + 0.01);
  }

  /* Soft crystalline music-box / celesta pluck with silky harmonic bloom */
  function playCrystalBell(freq, startT, vol = 0.11, dur = 0.42, wet = 0.42, pan = 0) {
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, startT);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 2.0, startT);
    o2.detune.setValueAtTime(rand(-3, 3), startT);

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, startT);
    g1.gain.linearRampToValueAtTime(vol, startT + 0.007);
    g1.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, startT);
    g2.gain.linearRampToValueAtTime(vol * 0.28, startT + 0.004);
    g2.gain.exponentialRampToValueAtTime(0.0001, startT + Math.min(0.14, dur * 0.42));

    o1.connect(g1);
    o2.connect(g2);
    g2.connect(g1);
    sendOut(g1, wet, pan);
    o1.start(startT);
    o2.start(startT);
    o1.stop(startT + dur + 0.03);
    o2.stop(startT + Math.min(0.16, dur * 0.45) + 0.02);
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

  /* =====================================================================
     BUILT-IN GENERATIVE AMBIENT SOUNDTRACK ("TOYBOX DRIFT")
     Warm D-Lydian / D-Major evolving 8-bar progression inspired by C418 &
     Astroneer: voice-led analog pad, felt Rhodes piano with gentle tine
     attack, soft round bass anchor, and drifting kalimba/celesta motifs.
     ===================================================================== */
  const TOYBOX_PROGRESSION = [
    // { bass, pad: [3 chord tones], keys: [rolled felt Rhodes voicing] }
    { bass: 73.42,  pad: [146.83, 220.00, 329.63], keys: [146.83, 220.00, 277.18, 329.63, 369.99] }, // Dmaj9
    { bass: 98.00,  pad: [196.00, 246.94, 369.99], keys: [196.00, 246.94, 293.66, 369.99, 440.00] }, // Gmaj9
    { bass: 123.47, pad: [185.00, 246.94, 329.63], keys: [123.47, 220.00, 293.66, 329.63, 369.99] }, // Bm11
    { bass: 110.00, pad: [164.81, 220.00, 329.63], keys: [110.00, 196.00, 246.94, 329.63, 369.99] }, // A13sus4
    { bass: 92.50,  pad: [185.00, 220.00, 329.63], keys: [185.00, 220.00, 277.18, 329.63, 440.00] }, // F#m11
    { bass: 98.00,  pad: [196.00, 246.94, 369.99], keys: [196.00, 246.94, 329.63, 369.99, 440.00] }, // Gmaj13
    { bass: 82.41,  pad: [164.81, 246.94, 369.99], keys: [164.81, 246.94, 293.66, 369.99, 440.00] }, // Em9
    { bass: 110.00, pad: [164.81, 220.00, 293.66], keys: [110.00, 185.00, 220.00, 293.66, 329.63] }  // A6/9sus
  ];

  // Expressive composed pentatonic / Lydian music-box motifs [beatOffsetSec, freq, dur, vol]
  const TOYBOX_MOTIFS = [
    [[0.85, 587.33, 2.6, 0.052], [1.75, 739.99, 2.4, 0.048], [2.55, 880.00, 3.2, 0.055], [4.10, 659.25, 2.8, 0.042]],
    [[1.10, 659.25, 2.4, 0.048], [2.25, 587.33, 2.5, 0.045], [3.35, 493.88, 3.0, 0.050], [4.65, 587.33, 2.6, 0.042]],
    [[0.70, 880.00, 2.8, 0.046], [1.90, 739.99, 2.2, 0.045], [2.65, 659.25, 2.6, 0.050], [3.85, 739.99, 3.2, 0.048]],
    [[1.30, 554.37, 2.4, 0.044], [2.30, 587.33, 2.6, 0.050], [3.45, 880.00, 3.0, 0.048], [4.75, 739.99, 2.9, 0.042]]
  ];

  function playRhodesKey(freq, startT, dur, peakGain, pan = 0) {
    if (!ctx || !musicGain) return;
    // Warm fundamental sine body
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(freq, startT);
    body.detune.setValueAtTime(rand(-3, 3), startT);

    // Gentle Rhodes tine bell overtone (softly decays into warm velvet sustain)
    const tine = ctx.createOscillator();
    tine.type = 'triangle';
    tine.frequency.setValueAtTime(freq * 2.0, startT);
    tine.detune.setValueAtTime(rand(-4, 4), startT);

    const tineGain = ctx.createGain();
    tineGain.gain.setValueAtTime(0.0001, startT);
    tineGain.gain.linearRampToValueAtTime(0.18, startT + 0.018);
    tineGain.gain.exponentialRampToValueAtTime(0.0001, startT + Math.min(1.1, dur * 0.35));

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1450, startT);
    filt.frequency.exponentialRampToValueAtTime(360, startT + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startT);
    env.gain.linearRampToValueAtTime(peakGain, startT + 0.055);
    env.gain.exponentialRampToValueAtTime(peakGain * 0.45, startT + dur * 0.38);
    env.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

    body.connect(filt);
    tine.connect(tineGain);
    tineGain.connect(filt);
    filt.connect(env);

    routeOut(env, musicGain, musicReverb, 0.52, pan);
    if (musicDelayIn) {
      const dSend = ctx.createGain();
      dSend.gain.value = 0.22;
      env.connect(dSend);
      dSend.connect(musicDelayIn);
    }

    body.start(startT);
    tine.start(startT);
    body.stop(startT + dur + 0.08);
    tine.stop(startT + Math.min(1.2, dur * 0.4) + 0.06);
  }

  function playToyboxKalimba(freq, startT, dur, peakGain, pan = 0) {
    if (!ctx || !musicGain) return;
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, startT);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 3.0, startT);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startT);
    env.gain.linearRampToValueAtTime(peakGain, startT + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

    const chimeG = ctx.createGain();
    chimeG.gain.setValueAtTime(0.0001, startT);
    chimeG.gain.linearRampToValueAtTime(peakGain * 0.22, startT + 0.006);
    chimeG.gain.exponentialRampToValueAtTime(0.0001, startT + 0.26);

    o1.connect(env);
    o2.connect(chimeG);
    chimeG.connect(env);

    routeOut(env, musicGain, musicReverb, 0.65, pan);
    if (musicDelayIn) {
      const dSend = ctx.createGain();
      dSend.gain.value = 0.48;
      env.connect(dSend);
      dSend.connect(musicDelayIn);
    }

    o1.start(startT);
    o2.start(startT);
    o1.stop(startT + dur + 0.06);
    o2.stop(startT + 0.30);
  }

  function playWarmBass(freq, startT, dur, peakGain) {
    if (!ctx || !musicGain) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, startT);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(freq * 2, startT);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, startT);
    const g2 = ctx.createGain();
    g2.gain.value = 0.14;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startT);
    env.gain.linearRampToValueAtTime(peakGain, startT + 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, startT + dur);
    o.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(env);
    routeOut(env, musicGain, musicReverb, 0.18, 0);
    o.start(startT);
    o2.start(startT);
    o.stop(startT + dur + 0.08);
    o2.stop(startT + dur + 0.08);
  }

  function scheduleAmbientPhrase() {
    if (!synthState.active || !ctx) return;
    const now = ctx.currentTime + 0.06;
    const step = TOYBOX_PROGRESSION[synthState.barIdx % TOYBOX_PROGRESSION.length];
    const barNum = synthState.barIdx;
    synthState.barIdx++;

    // Glide the breathing analog pad smoothly to match the current bar's chord tones
    if (synthState.padOscs.length === 3) {
      step.pad.forEach((f, idx) => {
        try {
          synthState.padOscs[idx].frequency.setTargetAtTime(f, now, 0.55);
        } catch (_) {}
      });
    }

    // Deep warm bass anchor on each chord change
    playWarmBass(step.bass, now, 5.8, 0.135);

    // Rolled felt Rhodes chord spread smoothly across stereo
    step.keys.forEach((f, idx) => {
      const pan = -0.38 + (idx / Math.max(1, step.keys.length - 1)) * 0.76;
      playRhodesKey(f, now + idx * 0.115 + rand(0, 0.025), 5.6, 0.082 - idx * 0.006, pan);
    });

    // Gentle mid-bar Rhodes echo touch on odd bars for organic human motion
    if (barNum % 2 === 1) {
      const midNote = step.keys[step.keys.length - 2];
      playRhodesKey(midNote * 2, now + 3.05, 3.2, 0.036, rand(-0.45, 0.45));
    }

    // Play a floating kalimba/music-box motif on 3 of every 4 bars (leaving calm breathing bars)
    if (barNum % 4 !== 3) {
      const motif = TOYBOX_MOTIFS[synthState.motifIdx % TOYBOX_MOTIFS.length];
      synthState.motifIdx++;
      motif.forEach(([off, freq, dur, vol], idx) => {
        const pan = (idx % 2 === 0 ? -1 : 1) * rand(0.18, 0.52);
        const octShift = (barNum >= 8 && idx === 2 && Math.random() > 0.55) ? 2 : 1;
        playToyboxKalimba(freq * octShift, now + off + rand(-0.04, 0.05), dur, vol, pan);
      });
    }

    synthState.timer = setTimeout(scheduleAmbientPhrase, 5800);
  }

  function startAmbientSynth() {
    if (synthState.active) return;
    if (!ensureContext()) return;
    synthState.active = true;
    const now = ctx.currentTime;
    const first = TOYBOX_PROGRESSION[synthState.barIdx % TOYBOX_PROGRESSION.length];

    // Breathing warm low-passed analog pad with subtle filter swell LFO
    const padFilt = ctx.createBiquadFilter();
    padFilt.type = 'lowpass';
    padFilt.frequency.value = 390;
    padFilt.Q.value = 0.8;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.095;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 145;
    lfo.connect(lfoG);
    lfoG.connect(padFilt.frequency);
    lfo.start(now);

    const padG = ctx.createGain();
    padG.gain.setValueAtTime(0.0001, now);
    padG.gain.linearRampToValueAtTime(0.095, now + 2.4);
    padFilt.connect(padG);
    padG.connect(musicGain);
    if (musicReverb) {
      const rv = ctx.createGain();
      rv.gain.value = 0.42;
      padG.connect(rv);
      rv.connect(musicReverb);
    }

    synthState.padOscs = first.pad.map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 6;
      o.connect(padFilt);
      o.start(now);
      return o;
    });
    synthState.padGain = padG;
    synthState.padFilter = padFilt;
    synthState.padLfo = lfo;
    synthState.padLfoGain = lfoG;

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
      const oldLfo = synthState.padLfo;
      const oldLfoG = synthState.padLfoGain;
      try {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setTargetAtTime(0.0001, now, 0.25);
      } catch (_) {}
      setTimeout(() => {
        oldOscs.forEach(o => { try { o.stop(); o.disconnect(); } catch (_) {} });
        if (oldLfo) { try { oldLfo.stop(); oldLfo.disconnect(); } catch (_) {} }
        if (oldLfoG) { try { oldLfoG.disconnect(); } catch (_) {} }
        if (oldFilter) { try { oldFilter.disconnect(); } catch (_) {} }
        if (oldGain) { try { oldGain.disconnect(); } catch (_) {} }
      }, 950);
    }
    synthState.padOscs = [];
    synthState.padGain = null;
    synthState.padFilter = null;
    synthState.padLfo = null;
    synthState.padLfoGain = null;
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
    if (unlocked) {
      ytState.fallbackTimer = setTimeout(() => {
        if (cfg.musicEnabled && cfg.trackId !== 'synth' && !ytState.playing) {
          startAmbientSynth();
          notifyUI();
        }
      }, 2600);
    }

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
    if (!cfg.musicEnabled || !musicAllowed) return;
    ensureContext();
    musicBooted = true;
    if (cfg.trackId === 'synth') {
      stopYouTube();
      startAmbientSynth();
    } else {
      playCurrentYouTubeTrack();
    }
    notifyUI();
  }

  function startGameMusic() {
    musicAllowed = true;
    unlock();
    if (cfg.musicEnabled && !cfg.musicMuted) {
      startMusic();
    }
    notifyUI();
  }

  const AUTO_UNLOCK_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'];

  function onFirstUserGesture() {
    unlock();
  }

  function attachAutoUnlockListeners() {
    if (autoUnlockBound) return;
    autoUnlockBound = true;
    for (let i = 0; i < AUTO_UNLOCK_EVENTS.length; i++) {
      window.addEventListener(AUTO_UNLOCK_EVENTS[i], onFirstUserGesture, { capture: true, passive: true });
    }
  }

  function detachAutoUnlockListeners() {
    if (!autoUnlockBound) return;
    autoUnlockBound = false;
    for (let i = 0; i < AUTO_UNLOCK_EVENTS.length; i++) {
      window.removeEventListener(AUTO_UNLOCK_EVENTS[i], onFirstUserGesture, { capture: true });
    }
  }

  function tryAutoStart() {
    if (typeof sessionGuard !== 'undefined' && sessionGuard.isLocked()) return;
    attachAutoUnlockListeners();
    const c = ensureContext();
    if (!c) return;
    if (c.state === 'running') {
      unlocked = true;
      detachAutoUnlockListeners();
      syncGains();
      if (musicAllowed && cfg.musicEnabled && !musicBooted) startMusic();
      notifyUI();
      return;
    }
    // Attempt immediate resume for browsers/origins where autoplay is already permitted
    try {
      const p = c.resume();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          if (!ctx || ctx.state !== 'running') return;
          if (typeof sessionGuard !== 'undefined' && sessionGuard.isLocked()) return;
          unlocked = true;
          detachAutoUnlockListeners();
          syncGains();
          if (musicAllowed && cfg.musicEnabled && !musicBooted) startMusic();
          notifyUI();
        }).catch(() => {});
      }
    } catch (_) {}
  }

  function unlock() {
    if (typeof sessionGuard !== 'undefined' && sessionGuard.isLocked()) return;
    const c = ensureContext();
    if (c && c.state === 'suspended') {
      c.resume().catch(() => {});
    }
    const alreadyRunning = Boolean(c && c.state === 'running');
    if (unlocked && alreadyRunning) {
      if (musicAllowed && cfg.musicEnabled && !musicBooted) startMusic();
      return;
    }
    unlocked = true;
    if (alreadyRunning) detachAutoUnlockListeners();
    syncGains();
    if (musicAllowed && cfg.musicEnabled) {
      if (!musicBooted) {
        startMusic();
      } else if (cfg.trackId !== 'synth' && ytState.ready && !ytState.playing) {
        // Trigger YouTube playback directly inside the user gesture stack
        try { ytState.player.playVideo(); } catch (_) {}
        playCurrentYouTubeTrack();
      }
    }
    notifyUI();
  }

  function suspendForLock() {
    stopYouTube();
    stopAmbientSynth();
    stopEnvironmentAudio();
    notifyUI();
  }

  function resumeFromLock() {
    if (unlocked && cfg.musicEnabled && !cfg.musicMuted) {
      startMusic();
    }
    notifyUI();
  }

  /* =====================================================================
     EXPRESSIVE TACTILE FOLEY & ACOUSTIC SOUND EFFECTS
     Warm wooden toybox impacts, realistic water foley, crystalline chimes,
     and silky studio UI clicks with subtle stereo spread.
     ===================================================================== */

  function normalizeMaterial(matOrSlip) {
    if (typeof matOrSlip === 'boolean') return matOrSlip ? 'ICE' : 'DEFAULT';
    return typeof matOrSlip === 'string' && matOrSlip ? matOrSlip.toUpperCase() : 'DEFAULT';
  }

  function playMetalRing(freq, startT, vol, dur, pan = 0) {
    const partials = [
      [1.0, 1.0, dur],
      [1.87, 0.55, dur * 0.72],
      [2.93, 0.28, dur * 0.45]
    ];
    for (let i = 0; i < partials.length; i++) {
      const [mult, amp, pDur] = partials[i];
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(freq * mult, startT);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, startT);
      g.gain.linearRampToValueAtTime(vol * amp, startT + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, startT + pDur);
      o.connect(g);
      sendOut(g, 0.24, pan);
      o.start(startT);
      o.stop(startT + pDur + 0.015);
    }
  }

  function playSurfaceFoley(material, intensity, isLand, pan = 0, pitchMult = 1.0, startOffset = 0) {
    const t = ctx.currentTime + startOffset;
    const imp = clamp(intensity, 0.2, 1.15);
    const p = pitchMult * rand(0.95, 1.05);
    const mat = normalizeMaterial(material);

    if (mat === 'ICE') {
      playFilteredNoise(true, t, isLand ? (0.095 + imp * 0.05) : 0.088, 2800 * p, 4200 * p, 3.4, (isLand ? 0.11 : 0.068) * imp, 0.22, 'bandpass', pan, 0.012);
      playCrystalBell(1860 * p, t, (isLand ? 0.052 : 0.026) * imp, isLand ? 0.11 : 0.065, 0.24, pan);
      return;
    }

    if (mat === 'GRASS') {
      // Soft leafy rustle + muted springy earth pat
      playFilteredNoise(true, t, isLand ? (0.11 + imp * 0.05) : 0.072, 1950 * p, 3300 * p, 1.6, (isLand ? 0.15 : 0.082) * imp, 0.16, 'bandpass', pan, 0.008);
      if (isLand) {
        playFilteredNoise(true, t + 0.02, 0.09, 980 * p, 420, 1.1, 0.095 * imp, 0.12, 'bandpass', pan, 0.01);
      }
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime((isLand ? 96 : 108) * p, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + (isLand ? 0.085 : 0.045));
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime((isLand ? 0.14 : 0.065) * imp, t + 0.006);
      og.gain.exponentialRampToValueAtTime(0.0001, t + (isLand ? 0.095 : 0.052));
      osc.connect(og);
      sendOut(og, 0.08, pan);
      osc.start(t);
      osc.stop(t + 0.11);
      return;
    }

    if (mat === 'METAL') {
      playMetalRing((isLand ? 315 : 540) * p, t, (isLand ? 0.14 : 0.085) * imp, isLand ? 0.24 : 0.13, pan);
      playFilteredNoise(false, t, 0.022, 3400 * p, 2200, 2.2, (isLand ? 0.09 : 0.055) * imp, 0.12, 'bandpass', pan, 0.001);
      if (isLand) {
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(140 * p, t);
        sub.frequency.exponentialRampToValueAtTime(58, t + 0.11);
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.0001, t);
        sg.gain.linearRampToValueAtTime(0.16 * imp, t + 0.004);
        sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        sub.connect(sg);
        sendOut(sg, 0.18, pan);
        sub.start(t);
        sub.stop(t + 0.15);
      }
      return;
    }

    if (mat === 'GLASS') {
      playCrystalBell((isLand ? 1620 : 2240) * p, t, (isLand ? 0.105 : 0.068) * imp, isLand ? 0.18 : 0.10, 0.34, pan);
      playCrystalBell((isLand ? 2760 : 3480) * p, t + 0.004, (isLand ? 0.065 : 0.042) * imp, isLand ? 0.13 : 0.075, 0.30, pan * 0.5);
      playFilteredNoise(false, t, 0.015, 5200 * p, 3400, 2.8, (isLand ? 0.065 : 0.038) * imp, 0.14, 'bandpass', pan, 0.001);
      return;
    }

    if (mat === 'MUD') {
      // Wet thick squelchy suction plop
      playFilteredNoise(true, t, isLand ? (0.14 + imp * 0.06) : 0.085, 360 * p, 980 * p, 2.2, (isLand ? 0.17 : 0.105) * imp, 0.18, 'bandpass', pan, 0.008);
      spawnBubblePop(t + 0.016, 170 * p, 420 * p, (isLand ? 0.085 : 0.052) * imp, 0.065, pan);
      if (isLand) {
        spawnBubblePop(t + 0.052, 140 * p, 320 * p, 0.068 * imp, 0.072, -pan * 0.6);
      }
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(92 * p, t);
      sub.frequency.exponentialRampToValueAtTime(36, t + (isLand ? 0.12 : 0.065));
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime((isLand ? 0.18 : 0.095) * imp, t + 0.006);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + (isLand ? 0.13 : 0.075));
      sub.connect(sg);
      sendOut(sg, 0.14, pan);
      sub.start(t);
      sub.stop(t + 0.15);
      return;
    }

    if (mat === 'SNOW') {
      // Crisp wintry compressed snowpack crunch (dual staggered crystal crunch)
      playFilteredNoise(true, t, isLand ? 0.085 : 0.052, 2400 * p, 1150 * p, 1.9, (isLand ? 0.14 : 0.088) * imp, 0.14, 'bandpass', pan, 0.006);
      playFilteredNoise(true, t + 0.026, isLand ? 0.095 : 0.048, 3600 * p, 1850 * p, 2.4, (isLand ? 0.11 : 0.068) * imp, 0.14, 'bandpass', pan, 0.005);
      const pad = ctx.createOscillator();
      pad.type = 'sine';
      pad.frequency.setValueAtTime(78 * p, t);
      pad.frequency.exponentialRampToValueAtTime(34, t + 0.08);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0.0001, t);
      pg.gain.linearRampToValueAtTime((isLand ? 0.12 : 0.052) * imp, t + 0.008);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      pad.connect(pg);
      sendOut(pg, 0.08, pan);
      pad.start(t);
      pad.stop(t + 0.10);
      return;
    }

    if (mat === 'SAND') {
      // Granular dry shifting sand shhh-crunch
      playFilteredNoise(true, t, isLand ? (0.14 + imp * 0.05) : 0.082, 3200 * p, 1750 * p, 1.15, (isLand ? 0.15 : 0.092) * imp, 0.14, 'bandpass', pan, 0.01);
      playFilteredNoise(true, t + 0.015, isLand ? 0.10 : 0.055, 1150 * p, 520, 0.9, (isLand ? 0.10 : 0.055) * imp, 0.10, 'lowpass', pan, 0.008);
      return;
    }

    if (mat === 'WOOD') {
      // Warm hollow wooden plank / floorboard knock
      playWoodBar((isLand ? 196 : 246) * p, t, (isLand ? 0.16 : 0.11) * imp, isLand ? 0.11 : 0.065, 0.18, pan, 0.86);
      if (isLand) {
        playWoodBar(146 * p, t + 0.022, 0.13 * imp, 0.09, 0.16, -pan * 0.5, 0.75);
      }
      playFilteredNoise(true, t, 0.032, 1100 * p, 480, 1.4, (isLand ? 0.075 : 0.04) * imp, 0.08, 'bandpass', pan, 0.003);
      return;
    }

    if (mat === 'STONE') {
      // Hard resonant cobblestone tap + dry grit
      playWoodBar((isLand ? 380 : 560) * p, t, (isLand ? 0.12 : 0.075) * imp, isLand ? 0.062 : 0.036, 0.22, pan, 1.18);
      playFilteredNoise(false, t, isLand ? 0.048 : 0.024, 2100 * p, 840, 1.5, (isLand ? 0.105 : 0.062) * imp, 0.16, 'bandpass', pan, 0.002);
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime((isLand ? 114 : 132) * p, t);
      sub.frequency.exponentialRampToValueAtTime(42, t + (isLand ? 0.09 : 0.045));
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime((isLand ? 0.21 : 0.10) * imp, t + 0.004);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + (isLand ? 0.10 : 0.05));
      sub.connect(sg);
      sendOut(sg, 0.14, pan);
      sub.start(t);
      sub.stop(t + 0.12);
      return;
    }

    if (mat === 'DIRT') {
      // Dry gritty earth crunch + low ground pat
      playFilteredNoise(true, t, isLand ? (0.10 + imp * 0.05) : 0.055, 1080 * p, 390, 1.25, (isLand ? 0.16 : 0.085) * imp, 0.12, 'bandpass', pan, 0.005);
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(98 * p, t);
      sub.frequency.exponentialRampToValueAtTime(38, t + (isLand ? 0.095 : 0.048));
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime((isLand ? 0.18 : 0.09) * imp, t + 0.005);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + (isLand ? 0.11 : 0.056));
      sub.connect(sg);
      sendOut(sg, 0.10, pan);
      sub.start(t);
      sub.stop(t + 0.13);
      return;
    }

    if (mat === 'CARPET') {
      // Soft plush deadened wooly step
      playFilteredNoise(true, t, isLand ? 0.085 : 0.048, 520 * p, 190, 0.85, (isLand ? 0.11 : 0.055) * imp, 0.06, 'lowpass', pan, 0.008);
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(76 * p, t);
      sub.frequency.exponentialRampToValueAtTime(32, t + (isLand ? 0.08 : 0.045));
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime((isLand ? 0.11 : 0.055) * imp, t + 0.007);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + (isLand ? 0.09 : 0.05));
      sub.connect(sg);
      sendOut(sg, 0.05, pan);
      sub.start(t);
      sub.stop(t + 0.10);
      return;
    }

    if (mat === 'SLIME') {
      // Wet elastic gelatinous bloop-squish
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(165 * p, t);
      osc.frequency.exponentialRampToValueAtTime((isLand ? 310 : 255) * p, t + 0.045);
      osc.frequency.exponentialRampToValueAtTime(118 * p, t + (isLand ? 0.13 : 0.085));
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime((isLand ? 0.15 : 0.09) * imp, t + 0.008);
      og.gain.exponentialRampToValueAtTime(0.0001, t + (isLand ? 0.145 : 0.095));
      osc.connect(og);
      sendOut(og, 0.24, pan);
      osc.start(t);
      osc.stop(t + 0.16);
      spawnBubblePop(t + 0.022, 240 * p, 520 * p, (isLand ? 0.075 : 0.045) * imp, 0.058, pan);
      return;
    }

    // DEFAULT studio slate / classic shoe tap
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime((isLand ? (98 + imp * 26) : rand(112, 128)) * p, t);
    osc.frequency.exponentialRampToValueAtTime(isLand ? (34 + (1 - imp) * 12) : 44, t + (isLand ? (0.085 + imp * 0.07) : 0.045));
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(isLand ? (0.14 + imp * 0.24) : 0.115, t + (isLand ? 0.005 : 0.004));
    og.gain.exponentialRampToValueAtTime(0.0001, t + (isLand ? (0.10 + imp * 0.085) : 0.052));
    osc.connect(og);
    sendOut(og, isLand ? 0.14 : 0.08, pan);
    osc.start(t);
    osc.stop(t + (isLand ? 0.21 : 0.058));

    playFilteredNoise(
      true,
      t,
      isLand ? (0.085 + imp * 0.065) : 0.036,
      isLand ? (580 + imp * 750) : (rand(920, 1280) * p),
      isLand ? 190 : 620,
      isLand ? 0.9 : 1.5,
      isLand ? (0.085 + imp * 0.13) : 0.055,
      isLand ? 0.16 : 0.1,
      isLand ? 'lowpass' : 'bandpass',
      pan,
      isLand ? 0.005 : 0.004
    );
    if (isLand && imp > 0.52) {
      playWoodBar(138, t + 0.048, 0.065 * imp, 0.055, 0.1, rand(-0.15, 0.15), 0.72);
    }
  }

  // 1. Walking Footsteps (material-aware acoustic foley with stereo spread)
  function playStep(material = 'DEFAULT') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.step < 115) return;
    throttle.step = nowMs;

    stepFootToggle = 1 - stepFootToggle;
    const footPitch = stepFootToggle === 0 ? 1.0 : 1.09;
    const pan = stepFootToggle === 0 ? -0.14 : 0.14;
    playSurfaceFoley(material, 0.85, false, pan, footPitch, 0);
  }

  // 1b. Climbing ladder / vine rung tap (crisp hollow wooden rung knock)
  function playClimbStep() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    stepFootToggle = 1 - stepFootToggle;
    const base = stepFootToggle ? 330 : 392;
    const pan = stepFootToggle ? -0.15 : 0.15;
    playWoodBar(base * rand(0.96, 1.04), t, 0.11, 0.075, 0.16, pan, 0.88);
    playFilteredNoise(true, t, 0.025, 1400, 900, 1.8, 0.03, 0.06, 'bandpass', pan, 0.003);
  }

  // 2. Jumping Sound (tactile organic spring-pop + material takeoff accent)
  function playJump(isWallJump = false, material = 'DEFAULT') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const p = rand(0.96, 1.05) * (isWallJump ? 1.14 : 1.0);
    const mat = normalizeMaterial(material);

    // Warm resonant upward wooden-pop lift
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(148 * p, t);
    osc.frequency.exponentialRampToValueAtTime(340 * p, t + 0.095);
    osc.frequency.exponentialRampToValueAtTime(295 * p, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.155, t + 0.009);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.145);
    osc.connect(og);
    sendOut(og, 0.22);
    osc.start(t);
    osc.stop(t + 0.16);

    // Subtle crisp takeoff material push-off
    if (mat !== 'DEFAULT') {
      playSurfaceFoley(mat, 0.55, false, 0, 1.12, 0);
    } else {
      playWoodBar((isWallJump ? 440 : 293.66) * p, t, isWallJump ? 0.085 : 0.055, 0.055, 0.14, 0, 1.12);
    }

    // Silky cloth & air whoosh
    playFilteredNoise(true, t, 0.115, 480, 1750, 1.35, 0.075, 0.18, 'bandpass', 0, 0.014);
  }

  // 2b. Bouncy Spring Block launch (juicy elastic rubber-drum boing + harmonic chime)
  function playBounce(boosted = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const pitch = boosted ? 1.16 : 1.0;

    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(128 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(430 * pitch, t + 0.16);
    osc.frequency.exponentialRampToValueAtTime(329.63 * pitch, t + 0.30);
    lfo.frequency.value = boosted ? 25 : 22;
    lfoG.gain.setValueAtTime(boosted ? 32 : 28, t);
    lfoG.gain.exponentialRampToValueAtTime(1.5, t + 0.28);
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(boosted ? 0.23 : 0.21, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(g);
    sendOut(g, 0.32);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.36);
    lfo.stop(t + 0.36);

    playWoodBar(587.33 * pitch, t + 0.018, boosted ? 0.085 : 0.075, 0.15, 0.28, 0, 1.04);
    if (boosted) {
      playWoodBar(783.99, t + 0.048, 0.065, 0.14, 0.26, 0, 1.06);
    }
  }

  // Light upward harmonic ping when the player holds Up during the 90ms post-bounce grace window
  function playBounceLift() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playWoodBar(783.99, t, 0.068, 0.14, 0.24, 0, 1.06);
    playFilteredNoise(true, t, 0.09, 680, 2100, 1.4, 0.055, 0.15, 'bandpass', 0, 0.01);
  }

  // 3. Fall Impact / Landing Sound (material-aware acoustic impact)
  function playLand(impact = 0.5, material = 'DEFAULT') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const imp = clamp(impact, 0.15, 1.0);
    playSurfaceFoley(material, imp, true, 0, 1.0, 0);
  }

  // 3b. Editor live audition: crisp step-step-land sample for chosen solid surface sound
  function playSurfacePreview(material = 'DEFAULT') {
    unlock();
    if (cfg.sfxMuted || !ensureContext()) return;
    playSurfaceFoley(material, 0.88, false, -0.14, 1.0, 0);
    playSurfaceFoley(material, 0.92, false, 0.14, 1.09, 0.16);
    playSurfaceFoley(material, 0.72, true, 0, 0.98, 0.34);
  }

  // 3c. Cozy sit / lay settle cushion foley
  function playSit(isLay = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(true, t, isLay ? 0.14 : 0.095, isLay ? 620 : 820, 220, 0.9, 0.09, 0.14, 'lowpass', 0, 0.012);
    playWoodBar(isLay ? 220 : 285, t, 0.065, 0.07, 0.14, 0, 0.85);
  }

  // 4. Death Sound (expressive wooden-marionette collapse or deep underwater drown)
  function playDeath(reason = 'deadly') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    if (reason === 'drown') {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(185, t);
      sub.frequency.exponentialRampToValueAtTime(48, t + 0.42);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.22, t + 0.02);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      sub.connect(sg);
      sendOut(sg, 0.42);
      sub.start(t);
      sub.stop(t + 0.48);

      playFilteredNoise(true, t, 0.38, 680, 140, 0.9, 0.17, 0.35, 'lowpass', 0, 0.02);
      for (let i = 0; i < 4; i++) {
        const f0 = rand(250, 480) - i * 25;
        spawnBubblePop(t + 0.03 + i * 0.065, f0, f0 * 1.85, 0.075 - i * 0.01, 0.055, (i % 2 === 0 ? -0.25 : 0.25));
      }
      return;
    }

    // Warm hollow descending wood-flute / toy tumble (no harsh buzzy sawtooth)
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    const startF = reason === 'abyss' ? 293.66 : 349.23;
    osc1.frequency.setValueAtTime(startF, t);
    osc1.frequency.exponentialRampToValueAtTime(73.42, t + 0.38);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1050, t);
    filt.frequency.exponentialRampToValueAtTime(160, t + 0.40);
    filt.Q.value = 1.6;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.20, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc1.connect(filt);
    filt.connect(g);
    sendOut(g, 0.32);
    osc1.start(t);
    osc1.stop(t + 0.44);

    // 4 stereo-scattered hollow wooden toy clacks
    const clacks = [
      [0.02, 523.25, -0.35],
      [0.085, 440.00, 0.30],
      [0.16, 349.23, -0.20],
      [0.245, 261.63, 0.18]
    ];
    clacks.forEach(([off, freq, pan], idx) => {
      playWoodBar(freq * rand(0.95, 1.05), t + off, 0.105 - idx * 0.016, 0.085, 0.22, pan, 0.82);
    });

    // Soft dusty poof
    playFilteredNoise(true, t, 0.22, 760, 140, 0.85, 0.14, 0.2, 'lowpass', 0, 0.01);
  }

  function playHurt() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    // Punchy muted wooden knock + warm low impact thump
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(215, t);
    osc.frequency.exponentialRampToValueAtTime(78, t + 0.13);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(760, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.21, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(lp);
    lp.connect(g);
    sendOut(g, 0.2);
    osc.start(t);
    osc.stop(t + 0.18);

    playWoodBar(310 * rand(0.94, 1.06), t, 0.09, 0.06, 0.14, 0, 0.78);
    playFilteredNoise(true, t, 0.075, 1100, 320, 1.2, 0.095, 0.12, 'bandpass', 0, 0.004);
  }

  function playRespawn() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    // Warm comforting D-major ascending revival bloom
    const notes = [293.66, 440.00, 587.33, 739.99];
    notes.forEach((f, i) => {
      const pan = -0.24 + i * 0.16;
      playCrystalBell(f, t + i * 0.055, 0.085, 0.34, 0.44, pan);
    });
    playFilteredNoise(true, t, 0.24, 420, 1650, 1.2, 0.05, 0.28, 'bandpass', 0, 0.04);
  }

  // 5. Liquid Sounds: Splash Entry / Exit, Liquid Jump, Swim Strokes, Breath & Gasp
  function spawnBubblePop(startT, startFreq, endFreq, vol = 0.075, dur = 0.058, pan = 0) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(startFreq, startT);
    o.frequency.exponentialRampToValueAtTime(endFreq, startT + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur + 0.014);
    o.connect(g);
    sendOut(g, 0.36, pan);
    o.start(startT);
    o.stop(startT + dur + 0.022);
  }

  function spawnDropletPlink(startT, freq, vol = 0.055, pan = 0) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, startT);
    o.frequency.exponentialRampToValueAtTime(freq * 1.56, startT + 0.026);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + 0.036);
    o.connect(g);
    sendOut(g, 0.40, pan);
    o.start(startT);
    o.stop(startT + 0.044);
  }

  function playSplash(exiting = false, impact = 0.65, thick = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.splash < 140) return;
    throttle.splash = nowMs;

    const t = ctx.currentTime;
    const imp = clamp(impact, 0.25, 1.2);
    const pMult = thick ? 0.62 : 1.0;

    if (exiting) {
      // Smooth upward surface-tension glug
      const breakOsc = ctx.createOscillator();
      breakOsc.type = 'sine';
      breakOsc.frequency.setValueAtTime(165 * pMult, t);
      breakOsc.frequency.exponentialRampToValueAtTime(420 * pMult, t + (thick ? 0.14 : 0.10));
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.13 * imp, t + 0.012);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + (thick ? 0.20 : 0.15));
      breakOsc.connect(bg);
      sendOut(bg, 0.26);
      breakOsc.start(t);
      breakOsc.stop(t + 0.22);

      // Lightweight frothy shedding wash
      playFilteredNoise(true, t, 0.25, 680 * pMult, 2100 * pMult, 1.0, 0.18 * imp, 0.30, 'bandpass', 0, 0.018);

      // 2 stereo settling drips
      spawnDropletPlink(t + 0.065, rand(720, 1080) * pMult, 0.05 * imp, -0.25);
      spawnDropletPlink(t + 0.125, rand(900, 1340) * pMult, 0.04 * imp, 0.25);
      return;
    }

    // Entry Splash: 1. Warm water-cavity plunge bloop
    const gulp = ctx.createOscillator();
    gulp.type = 'sine';
    gulp.frequency.setValueAtTime((178 + imp * 48) * pMult, t);
    gulp.frequency.exponentialRampToValueAtTime(58 * pMult, t + 0.085);
    gulp.frequency.exponentialRampToValueAtTime(172 * pMult, t + 0.19);
    const gulpG = ctx.createGain();
    gulpG.gain.setValueAtTime(0.0001, t);
    gulpG.gain.linearRampToValueAtTime(0.22 * imp, t + 0.01);
    gulpG.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    gulp.connect(gulpG);
    sendOut(gulpG, 0.28);
    gulp.start(t);
    gulp.stop(t + 0.24);

    // 2. Velvety water-curtain wash (single lightweight bandpass graph)
    playFilteredNoise(true, t, 0.30, 1180 * pMult, 460 * pMult, 0.95, 0.24 * imp, 0.32, 'bandpass', 0, 0.016);

    // 3. 2-3 stereo underwater bubbles + 1 crisp droplet plink
    const bubbleCount = imp > 0.75 ? 3 : 2;
    for (let i = 0; i < bubbleCount; i++) {
      const f0 = rand(320, 620);
      spawnBubblePop(
        t + 0.03 + i * rand(0.042, 0.064),
        f0,
        f0 * rand(1.85, 2.2),
        rand(0.045, 0.078) * Math.min(1.05, imp + 0.1),
        rand(0.048, 0.068),
        (i % 2 === 0 ? -0.28 : 0.28)
      );
    }
    spawnDropletPlink(t + 0.15, rand(820, 1220), 0.042 * imp, rand(-0.2, 0.2));
  }

  function playLiquidJump() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(195, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g);
    sendOut(g, 0.32);
    o.start(t);
    o.stop(t + 0.18);

    playFilteredNoise(true, t, 0.24, 780, 2600, 1.1, 0.18, 0.34, 'bandpass', 0, 0.016);
    spawnBubblePop(t + 0.02, 440, 980, 0.07, 0.055, -0.2);
    spawnDropletPlink(t + 0.10, rand(860, 1220), 0.05, 0.24);
  }

  function playSwimStroke(upward = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.swim < 270) return;
    throttle.swim = nowMs;

    const t = ctx.currentTime;
    const pan = rand(-0.22, 0.22);
    // Soft cupped-hand underwater displacement pulse
    const push = ctx.createOscillator();
    push.type = 'sine';
    push.frequency.setValueAtTime(upward ? 108 : 90, t);
    push.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.0001, t);
    pg.gain.linearRampToValueAtTime(0.09, t + 0.026);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    push.connect(pg);
    sendOut(pg, 0.24, pan);
    push.start(t);
    push.stop(t + 0.15);

    playFilteredNoise(true, t, 0.22, upward ? 320 : 250, upward ? 840 : 620, 1.6, 0.135, 0.34, 'bandpass', pan, 0.04);
    const b0 = rand(280, 440);
    spawnBubblePop(t + 0.035, b0, b0 * 1.95, 0.052, 0.055, -pan);
  }

  function playBreathPop(remaining = 5) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const urgent = remaining <= 2;
    const baseF = urgent ? rand(540, 680) : rand(390, 510);
    spawnBubblePop(t, baseF, baseF * (urgent ? 2.2 : 1.92), urgent ? 0.095 : 0.068, 0.048, rand(-0.15, 0.15));
  }

  function playGasp() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(true, t, 0.17, 780, 2150, 1.4, 0.095, 0.22, 'bandpass', 0, 0.035);
    playCrystalBell(587.33, t + 0.02, 0.032, 0.18, 0.32, 0);
  }

  function playDrownHurt() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(132, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.17, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(lp);
    lp.connect(g);
    sendOut(g, 0.30);
    osc.start(t);
    osc.stop(t + 0.20);

    const f0 = rand(270, 410);
    spawnBubblePop(t + 0.02, f0, f0 * 1.88, 0.065, 0.055, rand(-0.2, 0.2));
  }

  // 6. Creation Success Sound (warm wooden anchor + sparkling Dmaj9 celesta bloom)
  function playCreateSuccess() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;

    // Warm marimba root anchor (D4)
    playWoodBar(293.66, t, 0.14, 0.45, 0.34, -0.15, 1.0);

    // Sparkling ascending Dmaj9 music-box cascade spread across stereo
    const notes = [587.33, 739.99, 880.00, 1108.73, 1318.51];
    notes.forEach((freq, i) => {
      const st = t + i * 0.048;
      const pan = -0.36 + (i / (notes.length - 1)) * 0.72;
      const dur = i === notes.length - 1 ? 0.75 : 0.40;
      playCrystalBell(freq, st, i === notes.length - 1 ? 0.135 : 0.10, dur, 0.48, pan);
    });
  }

  // 7. Cookie Crunch Sound on Block Delete (crisp, organic dry biscuit snap & wooden crumble)
  function playCookieCrunch() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.crunch < 48) return;
    throttle.crunch = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.91, 1.11);

    // Warm dry wooden bite weight
    playWoodBar(195 * p, t, 0.115, 0.045, 0.08, rand(-0.15, 0.15), 0.58);

    // 3 tight stereo-spread crispy biscuit fracture grains (organic & ultra-lightweight)
    const grains = [
      { off: 0.000, freq: 2350, q: 1.7, dur: 0.026, amp: 0.24, pan: -0.22 },
      { off: 0.022, freq: 1480, q: 2.0, dur: 0.030, amp: 0.21, pan: 0.24 },
      { off: 0.048, freq: 3150, q: 1.9, dur: 0.024, amp: 0.18, pan: -0.10 }
    ];
    for (let i = 0; i < grains.length; i++) {
      const gr = grains[i];
      const gt = t + gr.off + rand(0, 0.006);
      playFilteredNoise(false, gt, gr.dur, gr.freq * p, gr.freq * p * 0.78, gr.q, gr.amp, 0.08, 'bandpass', gr.pan, 0.0025);
    }
  }

  // 7a. Crumbling Block Foley (initial creak/rattle, crisp rock/wood shatter, soft fade-in reform)
  function playCrumbleShake() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.crumbleShake < 75) return;
    throttle.crumbleShake = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.92, 1.12);
    // Dry gritty creak + two small pebble rattles
    playWoodBar(168 * p, t, 0.085, 0.042, 0.06, rand(-0.18, 0.18), 0.52);
    playFilteredNoise(false, t, 0.032, 1850 * p, 1250 * p, 2.2, 0.14, 0.06, 'bandpass', -0.14, 0.003);
    playFilteredNoise(false, t + 0.038, 0.028, 2450 * p, 1650 * p, 2.1, 0.10, 0.05, 'bandpass', 0.16, 0.003);
  }

  function playCrumbleBreak() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.crumbleBreak < 55) return;
    throttle.crumbleBreak = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.88, 1.08);
    // Low hollow drop + cascading dry fracture pebbles
    playWoodBar(138 * p, t, 0.14, 0.072, 0.12, rand(-0.14, 0.14), 0.48);
    playWoodBar(225 * p, t + 0.018, 0.09, 0.048, 0.09, rand(-0.22, 0.22), 0.62);
    const grains = [
      { off: 0.000, freq: 1950, q: 1.5, dur: 0.036, amp: 0.24, pan: -0.24 },
      { off: 0.024, freq: 1220, q: 1.8, dur: 0.044, amp: 0.22, pan: 0.22 },
      { off: 0.056, freq: 2780, q: 2.0, dur: 0.032, amp: 0.16, pan: -0.12 },
      { off: 0.092, freq: 1580, q: 2.2, dur: 0.034, amp: 0.11, pan: 0.18 }
    ];
    for (let i = 0; i < grains.length; i++) {
      const gr = grains[i];
      const gt = t + gr.off + rand(0, 0.007);
      playFilteredNoise(false, gt, gr.dur, gr.freq * p, gr.freq * p * 0.72, gr.q, gr.amp, 0.10, 'bandpass', gr.pan, 0.002);
    }
  }

  function playCrumbleReform() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.crumbleReform < 95) return;
    throttle.crumbleReform = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.96, 1.06);
    // Gentle soft airy pop as block finishes fading back in
    playCrystalBell(523.25 * p, t, 0.038, 0.22, 0.34, rand(-0.18, 0.18));
    playWoodBar(330 * p, t + 0.012, 0.065, 0.04, 0.08, rand(-0.12, 0.12), 0.72);
  }

  // 7b. Place Block / Background Effect Placement (addictive tactile woodblock snap or airy shimmer)
  function playPlaceBlock(isBgEffect = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.place < 36) return;
    throttle.place = nowMs;

    const t = ctx.currentTime;
    if (isBgEffect) {
      // Soft atmospheric shimmer bloom (D5 + A5)
      playCrystalBell(587.33 * rand(0.99, 1.01), t, 0.068, 0.42, 0.52, -0.2);
      playCrystalBell(880.00 * rand(0.99, 1.01), t + 0.045, 0.056, 0.46, 0.55, 0.2);
      playFilteredNoise(true, t, 0.22, 900, 1800, 1.2, 0.03, 0.35, 'bandpass', 0, 0.05);
      return;
    }

    // Tactile Nintendo/wooden-toy block snap
    const p = rand(0.93, 1.09);
    playWoodBar(355 * p, t, 0.135, 0.058, 0.14, rand(-0.12, 0.12), 0.76);
    playFilteredNoise(false, t, 0.014, 2400 * p, 1400 * p, 1.8, 0.042, 0.05, 'bandpass', 0, 0.002);
  }

  // 7c. Block Pickup / Redo (crisp bouncy two-note wooden pop)
  function playPickup() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const p = rand(0.97, 1.03);
    playWoodBar(440 * p, t, 0.105, 0.065, 0.18, -0.1, 1.15);
    playWoodBar(659.25 * p, t + 0.028, 0.095, 0.09, 0.24, 0.12, 1.04);
  }

  // 8. Deselect / Undo Sound (soft downward wooden tuck + velvety air flick)
  function playDeselect() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const p = rand(0.97, 1.03);
    playWoodBar(587.33 * p, t, 0.095, 0.075, 0.20, 0.1, 0.9);
    playWoodBar(392.00 * p, t + 0.034, 0.088, 0.095, 0.22, -0.12, 0.86);
    playFilteredNoise(true, t, 0.085, 1650, 520, 1.25, 0.048, 0.18, 'bandpass', 0, 0.01);
  }

  // 8b. Held Block Rotate / Flip Click (crisp tactile wooden tick + airy card-flip snap on mirror)
  function playRotate(isFlip = false) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const p = rand(0.97, 1.04);
    if (isFlip) {
      playWoodBar(520 * p, t, 0.088, 0.042, 0.12, -0.14, 1.08);
      playWoodBar(780 * p, t + 0.026, 0.082, 0.056, 0.16, 0.14, 1.04);
      playFilteredNoise(true, t, 0.068, 1200, 2800, 1.6, 0.044, 0.10, 'bandpass', 0, 0.008);
    } else {
      playWoodBar(620 * p, t, 0.082, 0.036, 0.10, rand(-0.08, 0.08), 0.92);
      playFilteredNoise(false, t, 0.015, 2900 * p, 1900 * p, 2.0, 0.032, 0.05, 'bandpass', 0, 0.002);
    }
  }

  // 8c. Pixo Mascot Soft Voice Bloops & Step-Complete Cheer (respects SFX volume & mute)
  let lastPixoVoiceMs = 0;
  const PIXO_VOICE_NOTES = [587.33, 659.25, 739.99, 880.00, 739.99, 659.25, 987.77, 880.00];
  function playPixoVoice(charIdx = 0) {
    if (!unlocked || cfg.sfxMuted || cfg.sfxVol <= 0.001 || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - lastPixoVoiceMs < 54) return;
    lastPixoVoiceMs = nowMs;

    const t = ctx.currentTime;
    const baseFreq = PIXO_VOICE_NOTES[Math.abs(charIdx | 0) % PIXO_VOICE_NOTES.length] * rand(0.985, 1.02);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 0.96, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.05, t + 0.034);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(baseFreq * 0.5, t);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1850, t);

    const subGain = ctx.createGain();
    subGain.gain.value = 0.28;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.072, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.044);

    osc.connect(lp);
    sub.connect(subGain);
    subGain.connect(lp);
    lp.connect(env);
    routeOut(env, sfxGain, sfxReverb, 0.14, -0.24);

    osc.start(t);
    sub.start(t);
    osc.stop(t + 0.05);
    sub.stop(t + 0.05);
  }

  function playPixoCheer() {
    if (!unlocked || cfg.sfxMuted || cfg.sfxVol <= 0.001 || !ensureContext()) return;
    const t = ctx.currentTime;
    const notes = [587.33, 739.99, 880.00, 1174.66];
    for (let i = 0; i < notes.length; i++) {
      const st = t + i * 0.044;
      playCrystalBell(notes[i], st, i === notes.length - 1 ? 0.11 : 0.082, i === notes.length - 1 ? 0.34 : 0.18, 0.28, -0.22 + i * 0.06);
    }
  }

  // 9. Tactile Button Sounds (precision dark-studio mechanical switch click)
  function playButton(variant = 'default') {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.btn < 28 || nowMs - throttle.err < 95) return;
    throttle.btn = nowMs;

    const t = ctx.currentTime;
    const p = rand(0.96, 1.05);
    const baseF = variant === 'primary' ? 680 : (variant === 'soft' ? 490 : 580);
    const amp = variant === 'soft' ? 0.055 : 0.082;

    playWoodBar(baseF * p, t, amp, 0.032, 0.07, 0, 0.62);
    playFilteredNoise(false, t, 0.011, 3100 * p, 2200 * p, 2.2, 0.036, 0.04, 'bandpass', 0, 0.0015);
  }

  // 9b. Soft Acoustic Error / Blocked Action Cue (warm muted low descending double wood-tap)
  function playError() {
    if (!unlocked || cfg.sfxMuted || cfg.sfxVol <= 0.001 || !ensureContext()) return;
    const nowMs = performance.now();
    if (nowMs - throttle.err < 115) return;
    throttle.err = nowMs;

    const t = ctx.currentTime;
    const notes = [261.63, 196.00];
    for (let i = 0; i < notes.length; i++) {
      const st = t + i * 0.062;
      const freq = notes[i];

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, st);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.94, st + 0.072);

      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(freq * 0.5, st);

      const subG = ctx.createGain();
      subG.gain.value = 0.34;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(i === 0 ? 780 : 620, st);
      lp.frequency.exponentialRampToValueAtTime(340, st + 0.085);
      lp.Q.value = 0.7;

      const env = ctx.createGain();
      const peak = i === 0 ? 0.092 : 0.082;
      const dur = i === 0 ? 0.072 : 0.095;
      env.gain.setValueAtTime(0.0001, st);
      env.gain.linearRampToValueAtTime(peak, st + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, st + dur);

      osc.connect(lp);
      sub.connect(subG);
      subG.connect(lp);
      lp.connect(env);
      routeOut(env, sfxGain, sfxReverb, 0.09, i === 0 ? -0.06 : 0.06);

      osc.start(st);
      sub.start(st);
      osc.stop(st + dur + 0.02);
      sub.stop(st + dur + 0.02);
    }
  }

  // 10. Menu Swipe Away / Restore Sound (velvety air swoosh + subtle wooden dock snap)
  function playMenuSwipe(hiding = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(
      true,
      t,
      0.18,
      hiding ? 1850 : 360,
      hiding ? 320 : 1750,
      1.25,
      0.125,
      0.22,
      'bandpass',
      hiding ? 0.2 : -0.2,
      0.04
    );
    const st = hiding ? t + 0.025 : t + 0.085;
    playWoodBar(hiding ? 440 : 523.25, st, 0.062, 0.075, 0.18, 0, hiding ? 0.72 : 1.18);
  }

  // Extra tactile toybox foley for Body Equip, Gatherables, Switches, Portals, Emitters
  function playBodyEquip(equipping = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(true, t, 0.09, 800, equipping ? 1900 : 550, 1.2, 0.055, 0.16, 'bandpass', 0, 0.015);
    const seq = equipping ? [392.00, 587.33, 739.99] : [587.33, 392.00];
    seq.forEach((f, i) => {
      playWoodBar(f, t + i * 0.042, 0.095, 0.17, 0.28, (i - 1) * 0.18, 1.0);
    });
  }

  function playCollect() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const seq = [739.99, 1108.73, 1479.98];
    seq.forEach((f, i) => {
      playCrystalBell(f, t + i * 0.038, 0.095, 0.28, 0.42, (i - 1) * 0.25);
    });
  }

  function playSwitch(on = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    // Two-stage tactile lever click
    playFilteredNoise(false, t, 0.014, 2800, 1800, 2.0, 0.06, 0.06, 'bandpass', 0, 0.002);
    playWoodBar(on ? 392.00 : 523.25, t, 0.11, 0.048, 0.14, 0, on ? 1.24 : 0.74);
    playWoodBar(on ? 587.33 : 349.23, t + 0.026, 0.095, 0.075, 0.18, 0, 1.0);
  }

  function playPortal() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playFilteredNoise(true, t, 0.28, 420, 2200, 1.4, 0.085, 0.42, 'bandpass', 0, 0.04);
    const freqs = [293.66, 440.00, 587.33, 880.00];
    freqs.forEach((f, i) => {
      const st = t + i * 0.036;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * 1.38, st + 0.24);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.078, st + 0.022);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.28);
      o.connect(g);
      sendOut(g, 0.48, -0.35 + i * 0.23);
      o.start(st);
      o.stop(st + 0.30);
    });
  }

  function playEmit() {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playWoodBar(520 * rand(0.95, 1.05), t, 0.105, 0.07, 0.16, 0, 0.56);
    playFilteredNoise(true, t, 0.065, 1800, 620, 1.5, 0.055, 0.14, 'bandpass', 0, 0.004);
  }

  // Iconic Switch 2-inspired magnetic slide + tactile snap click + chime
  function playSwitchSnap() {
    if (!unlocked || cfg.sfxMuted || cfg.sfxVol <= 0.001 || !ensureContext()) return;
    const t = ctx.currentTime;
    // Soft magnetic rail glide into crisp mechanical latch click
    playFilteredNoise(true, t, 0.065, 580, 2400, 1.8, 0.048, 0.12, 'bandpass', 0, 0.012);
    const snapT = t + 0.048;
    // Crisp high transient snap
    playFilteredNoise(false, snapT, 0.014, 3800, 1600, 2.4, 0.115, 0.06, 'bandpass', 0, 0.001);
    // Low tactile magnetic thud
    const thud = ctx.createOscillator();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(195, snapT);
    thud.frequency.exponentialRampToValueAtTime(76, snapT + 0.055);
    const thudG = ctx.createGain();
    thudG.gain.setValueAtTime(0.0001, snapT);
    thudG.gain.linearRampToValueAtTime(0.14, snapT + 0.003);
    thudG.gain.exponentialRampToValueAtTime(0.0001, snapT + 0.062);
    thud.connect(thudG);
    routeOut(thudG, sfxGain, sfxReverb, 0.06, 0);
    thud.start(snapT);
    thud.stop(snapT + 0.07);
    // Bright dual-harmonic confirmation snap (wooden click + crystal harmonic)
    playWoodBar(784.0, snapT, 0.125, 0.052, 0.14, -0.08, 1.18);
    playCrystalBell(1174.66, snapT + 0.014, 0.092, 0.24, 0.24, 0.08);
  }

  // Deep tactile TNT / physics explosion (sub punch + mid crackle + debris wash)
  function playExplosion(intensity = 1.0) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const imp = clamp(intensity, 0.4, 1.3);
    // Deep sub-bass punch
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(118 * imp, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.34);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.0001, t);
    subG.gain.linearRampToValueAtTime(0.32 * imp, t + 0.008);
    subG.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    sub.connect(subG);
    sendOut(subG, 0.22, 0);
    sub.start(t);
    sub.stop(t + 0.42);
    // Sharp mid-band crack + rolling low-passed roar
    playFilteredNoise(false, t, 0.085, 2200, 480, 1.2, 0.22 * imp, 0.24, 'bandpass', rand(-0.15, 0.15), 0.002);
    playFilteredNoise(true, t + 0.012, 0.44, 620, 140, 0.75, 0.26 * imp, 0.36, 'lowpass', 0, 0.01);
  }

  // Crisp pneumatic / mechanical piston thump + hiss
  function playPiston(extending = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playWoodBar(extending ? 240 : 185, t, 0.11, 0.06, 0.12, 0, extending ? 1.28 : 0.78);
    playFilteredNoise(false, t, 0.075, extending ? 2100 : 1400, extending ? 900 : 620, 1.8, 0.072, 0.12, 'bandpass', 0, 0.004);
  }

  // Precision wire / mechanical joint latch click
  function playWire(connect = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playCrystalBell(connect ? 880 : 523.25, t, 0.07, 0.11, 0.18, connect ? 0.12 : -0.12);
    playWoodBar(connect ? 640 : 420, t + 0.018, 0.06, 0.04, 0.08, 0, 1.0);
  }

  // People Playground-style physics freeze / unfreeze lock chime
  function playFreeze(frozen = true) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    playCrystalBell(frozen ? 1318.5 : 784, t, 0.075, 0.16, 0.22, 0);
    playCrystalBell(frozen ? 1760 : 587.3, t + 0.032, 0.06, 0.14, 0.20, 0.08);
  }

  // Playful hollow glass-pixel cube poke / bounce pop for the 3D start screen cube
  function playCubePoke(pitchMult = 1) {
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime;
    const base = 360 * clamp(pitchMult, 0.75, 1.55);
    playWoodBar(base, t, 0.11, 0.085, 0.24, rand(-0.14, 0.14), 1.24);
    playCrystalBell(base * 2.5, t + 0.012, 0.045, 0.13, 0.28, rand(-0.18, 0.18));
  }

  /* =====================================================================
     11. PROCEDURAL ENVIRONMENTAL SOUNDSCAPE ENGINE (ALL 9 ENVIRONMENTALS)
     Continuous warm stereo beds (RAIN, WIND air, STEAM, RISING HEAT, MIST)
     paired with organic periodic sound events (swelling WIND gusts, rain
     patter & distant heavy-rain thunder, snowy crystal flurries, ember
     crackles, steam puffs, meadow dust rustles, cloud swells, star glints).
     Routes through sfxGain & sfxReverb; automatically ducks in BUILD/modals.
     ===================================================================== */
  const envAudio = {
    ready: false,
    bus: null,
    beds: null, // { rainBody, rainAir, windAir, steam, heat, mist }
    lfoPhase: 0,
    timers: {
      windGust: 0.7,
      rainDrop: 0.18,
      thunder: 14.0,
      snow: 2.2,
      steamPuff: 1.4,
      heatCrackle: 0.55,
      mist: 3.4,
      dust: 2.8,
      cloud: 3.6,
      star: 2.4
    },
    lastTargets: { rain: 0, wind: 0, steam: 0, heat: 0, mist: 0, scale: 0 },
    eventCounts: {
      windGust: 0,
      rainDrop: 0,
      thunder: 0,
      snow: 0,
      steamPuff: 0,
      heatCrackle: 0,
      mist: 0,
      dust: 0,
      cloud: 0,
      star: 0
    }
  };

  function makeEnvBed(pink, filterType, freq, Q, pan, wet = 0.22) {
    const src = makeNoise(pink);
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    filt.Q.value = Q;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filt);
    filt.connect(gain);
    let out = gain;
    if (hasStereoPanner && Math.abs(pan) > 0.01) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -0.9, 0.9);
      gain.connect(p);
      out = p;
    }
    out.connect(envAudio.bus);
    if (wet > 0 && sfxReverb) {
      const wG = ctx.createGain();
      wG.gain.value = wet;
      out.connect(wG);
      wG.connect(sfxReverb);
    }
    src.start(ctx.currentTime, rand(0, 1.5));
    return { src, filt, gain };
  }

  function ensureEnvBeds() {
    if (envAudio.ready && envAudio.bus && envAudio.beds) return true;
    if (!ctx || !sfxGain || !pinkBuf || !whiteBuf) return false;
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(sfxGain);
    envAudio.bus = bus;
    envAudio.beds = {
      rainBody: makeEnvBed(true, 'bandpass', 780, 0.68, -0.18, 0.26),
      rainAir: makeEnvBed(false, 'bandpass', 2650, 0.95, 0.22, 0.22),
      windAir: makeEnvBed(true, 'bandpass', 290, 1.85, 0, 0.34),
      steam: makeEnvBed(false, 'bandpass', 2750, 1.35, 0.08, 0.22),
      heat: makeEnvBed(true, 'lowpass', 145, 0.75, 0, 0.14),
      mist: makeEnvBed(true, 'bandpass', 210, 1.15, -0.1, 0.44)
    };
    envAudio.ready = true;
    return true;
  }

  function stopEnvironmentAudio() {
    envAudio.lastTargets.rain = 0;
    envAudio.lastTargets.wind = 0;
    envAudio.lastTargets.steam = 0;
    envAudio.lastTargets.heat = 0;
    envAudio.lastTargets.mist = 0;
    envAudio.lastTargets.scale = 0;
    if (!envAudio.ready || !ctx || !envAudio.beds) return;
    const now = ctx.currentTime;
    for (const k in envAudio.beds) {
      const b = envAudio.beds[k];
      if (!b || !b.gain) continue;
      try {
        b.gain.gain.cancelScheduledValues(now);
        b.gain.gain.setTargetAtTime(0.0001, now, 0.12);
      } catch (_) {}
    }
  }

  // Periodic swelling wind gust (bandpass whoosh + subtle resonant wind whistle panning with wind direction)
  function playEnvWindGust(strengthNorm, windDirSign, scale) {
    const t = ctx.currentTime;
    const dur = rand(1.75, 3.35) * (0.9 + strengthNorm * 0.22);
    const peakT = t + dur * rand(0.32, 0.44);
    const vol = clamp((0.048 + strengthNorm * 0.072) * scale, 0.008, 0.145);

    // Main velvety pink-noise whoosh
    const src = makeNoise(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = rand(2.4, 3.8);
    const fLow = rand(165, 240);
    const fPeak = rand(460, 720) + strengthNorm * 240;
    bp.frequency.setValueAtTime(fLow, t);
    bp.frequency.exponentialRampToValueAtTime(fPeak, peakT);
    bp.frequency.exponentialRampToValueAtTime(fLow * 0.88, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, peakT);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp);
    bp.connect(g);
    if (hasStereoPanner) {
      const panner = ctx.createStereoPanner();
      const dir = windDirSign || (Math.random() < 0.5 ? 1 : -1);
      panner.pan.setValueAtTime(-dir * 0.45, t);
      panner.pan.linearRampToValueAtTime(dir * 0.45, t + dur);
      g.connect(panner);
      panner.connect(sfxGain);
      if (sfxReverb) {
        const wG = ctx.createGain();
        wG.gain.value = 0.36;
        panner.connect(wG);
        wG.connect(sfxReverb);
      }
    } else {
      sendOut(g, 0.36, 0);
    }
    src.start(t, rand(0, 1.3), dur + 0.06);

    // Subtle airy wind whistle overtone on stronger breezes/gales
    if (strengthNorm > 0.25) {
      const wSrc = makeNoise(true);
      const wBp = ctx.createBiquadFilter();
      wBp.type = 'bandpass';
      wBp.Q.value = rand(9.5, 13.5);
      const wfLow = rand(480, 620);
      const wfPeak = wfLow * rand(1.42, 1.72);
      wBp.frequency.setValueAtTime(wfLow, t);
      wBp.frequency.exponentialRampToValueAtTime(wfPeak, peakT);
      wBp.frequency.exponentialRampToValueAtTime(wfLow * 0.9, t + dur * 0.96);

      const wGain = ctx.createGain();
      wGain.gain.setValueAtTime(0.0001, t);
      wGain.gain.linearRampToValueAtTime(vol * 0.32, peakT);
      wGain.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.96);
      wSrc.connect(wBp);
      wBp.connect(wGain);
      sendOut(wGain, 0.48, rand(-0.3, 0.3));
      wSrc.start(t, rand(0, 1.3), dur + 0.04);
    }
    envAudio.eventCounts.windGust++;
  }

  // Crisp stereo raindrop patter ticks (water-droplet plink + soft splash burst)
  function playEnvRainDrop(rainLevel, scale) {
    const t = ctx.currentTime;
    const pan = rand(-0.78, 0.78);
    const amp = clamp((0.014 + Math.min(1.4, rainLevel) * 0.015) * scale, 0.003, 0.042);
    playFilteredNoise(false, t, rand(0.014, 0.032), rand(2200, 4200), rand(1100, 2100), 2.4, amp, 0.18, 'bandpass', pan, 0.002);
    if (Math.random() < 0.45) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = rand(1250, 2600);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * rand(1.18, 1.38), t + 0.024);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp * 0.52, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
      o.connect(g);
      sendOut(g, 0.24, pan);
      o.start(t);
      o.stop(t + 0.035);
    }
    envAudio.eventCounts.rainDrop++;
  }

  // Distant rolling heavy-rain thunder (deep warm lowpass rumble, never startling)
  function playEnvThunder(scale) {
    const t = ctx.currentTime;
    const dur = rand(2.2, 3.6);
    const vol = clamp(0.085 * scale, 0.015, 0.11);
    playFilteredNoise(true, t, dur, 130, 48, 0.85, vol, 0.52, 'lowpass', rand(-0.35, 0.35), 0.28);
    playFilteredNoise(true, t + rand(0.28, 0.62), dur * 0.72, 95, 42, 0.9, vol * 0.72, 0.55, 'lowpass', rand(-0.4, 0.4), 0.22);
    envAudio.eventCounts.thunder++;
  }

  // Hushed snowy crystal flurry + delicate frost chime shimmer
  function playEnvSnowFlurry(snowLevel, scale) {
    const t = ctx.currentTime;
    const pan = rand(-0.62, 0.62);
    const vol = clamp((0.016 + Math.min(1.4, snowLevel) * 0.014) * scale, 0.004, 0.038);
    playFilteredNoise(true, t, rand(0.95, 1.85), rand(1800, 2500), rand(1100, 1600), 1.6, vol, 0.46, 'bandpass', pan, 0.32);
    if (Math.random() < 0.65) {
      const frostNotes = [1760, 2093, 2349.32, 2637.02, 3135.96];
      const f = frostNotes[Math.floor(Math.random() * frostNotes.length)];
      playCrystalBell(f, t + rand(0.08, 0.35), clamp(0.014 * scale, 0.003, 0.022), rand(0.45, 0.85), 0.62, pan);
    }
    envAudio.eventCounts.snow++;
  }

  // Periodic pressurized steam vent puff
  function playEnvSteamPuff(steamLevel, scale) {
    const t = ctx.currentTime;
    const dur = rand(0.42, 0.88);
    const vol = clamp((0.026 + Math.min(1.4, steamLevel) * 0.022) * scale, 0.006, 0.064);
    const pan = rand(-0.42, 0.42);
    playFilteredNoise(false, t, dur, rand(3400, 4400), rand(1450, 2100), 1.6, vol, 0.26, 'bandpass', pan, 0.045);
    playFilteredNoise(true, t, dur * 0.7, 520, 220, 1.1, vol * 0.45, 0.18, 'lowpass', pan, 0.03);
    envAudio.eventCounts.steamPuff++;
  }

  // Organic ember pop / rising heat fire crackle
  function playEnvHeatCrackle(heatLevel, scale) {
    const t = ctx.currentTime;
    const pan = rand(-0.65, 0.65);
    const vol = clamp((0.022 + Math.min(1.4, heatLevel) * 0.024) * scale, 0.005, 0.062);
    playFilteredNoise(false, t, rand(0.009, 0.024), rand(1800, 3900), rand(700, 1500), 2.1, vol, 0.14, 'bandpass', pan, 0.0015);
    if (Math.random() < 0.38) {
      playWoodBar(rand(220, 420), t + 0.006, vol * 0.42, 0.032, 0.14, pan, 0.58);
    }
    envAudio.eventCounts.heatCrackle++;
  }

  // Slow dewy mist drift + occasional soft condensation drip
  function playEnvMistSwell(mistLevel, scale) {
    const t = ctx.currentTime;
    const pan = rand(-0.55, 0.55);
    const vol = clamp((0.018 + Math.min(1.4, mistLevel) * 0.014) * scale, 0.004, 0.04);
    playFilteredNoise(true, t, rand(1.6, 2.8), rand(220, 340), rand(140, 220), 1.5, vol, 0.56, 'bandpass', pan, 0.55);
    if (Math.random() < 0.48) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = rand(740, 1180);
      const st = t + rand(0.25, 0.8);
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * 1.42, st + 0.048);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(vol * 0.55, st + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.062);
      o.connect(g);
      sendOut(g, 0.62, pan);
      o.start(st);
      o.stop(st + 0.07);
    }
    envAudio.eventCounts.mist++;
  }

  // Warm sunlit village dust leaf-rustle & faint meadow chime
  function playEnvDustRustle(dustLevel, scale) {
    const t = ctx.currentTime;
    const pan = rand(-0.58, 0.58);
    const vol = clamp((0.015 + Math.min(1.4, dustLevel) * 0.012) * scale, 0.004, 0.034);
    playFilteredNoise(true, t, rand(0.55, 1.15), rand(900, 1450), rand(580, 950), 1.7, vol, 0.34, 'bandpass', pan, 0.16);
    if (Math.random() < 0.35) {
      const warmNotes = [587.33, 739.99, 880, 1174.66];
      const f = warmNotes[Math.floor(Math.random() * warmNotes.length)];
      playWoodBar(f, t + rand(0.08, 0.25), vol * 0.45, 0.24, 0.44, pan, 1.0);
    }
    envAudio.eventCounts.dust++;
  }

  // Open high-altitude cloud breeze swell
  function playEnvCloudDrift(cloudLevel, scale) {
    const t = ctx.currentTime;
    const pan = rand(-0.48, 0.48);
    const vol = clamp((0.018 + Math.min(1.4, cloudLevel) * 0.014) * scale, 0.004, 0.038);
    playFilteredNoise(true, t, rand(1.8, 3.1), rand(310, 490), rand(520, 740), 1.2, vol, 0.52, 'bandpass', pan, 0.65);
    envAudio.eventCounts.cloud++;
  }

  // Delicate starlight night-sky twinkle glint
  function playEnvStarTwinkle(starLevel, scale) {
    const t = ctx.currentTime;
    const pan = rand(-0.74, 0.74);
    const starNotes = [1479.98, 1760.0, 1975.53, 2349.32, 2637.02, 2959.96, 3520.0];
    const f = starNotes[Math.floor(Math.random() * starNotes.length)];
    const vol = clamp((0.012 + Math.min(1.4, starLevel) * 0.010) * scale, 0.003, 0.026);
    playCrystalBell(f, t, vol, rand(0.55, 1.05), 0.68, pan);
    if (Math.random() < 0.32) {
      playCrystalBell(f * 1.25, t + rand(0.09, 0.19), vol * 0.65, rand(0.45, 0.85), 0.72, clamp(pan + rand(-0.2, 0.2), -0.85, 0.85));
    }
    envAudio.eventCounts.star++;
  }

  function updateEnvironmentAudio(levels, windX = 0, dt = 0.016, activeScale = 1) {
    if (!levels || dt <= 0) return;
    const effScale = (!unlocked || cfg.sfxMuted || cfg.sfxVol <= 0.001 || !ctx || ctx.state !== 'running')
      ? 0
      : clamp(Number(activeScale) || 0, 0, 1);

    const rainLvl = clamp(Number(levels.RAIN) || 0, 0, 1.6);
    const snowLvl = clamp(Number(levels.SNOW) || 0, 0, 1.6);
    const dustLvl = clamp(Number(levels['VILLAGE DUST']) || 0, 0, 1.6);
    const heatLvl = clamp(Number(levels['RISING HEAT']) || 0, 0, 1.6);
    const mistLvl = clamp(Number(levels.MIST) || 0, 0, 1.6);
    const steamLvl = clamp(Number(levels.STEAM) || 0, 0, 1.6);
    const cloudLvl = clamp(Number(levels.CLOUDS) || 0, 0, 1.6);
    const starLvl = clamp(Number(levels.STARS) || 0, 0, 1.6);
    const windLvl = clamp(Number(levels.WIND) || 0, 0, 1.6);
    const windMag = clamp(Math.abs(Number(windX) || 0) / 105, 0, 1.4);
    const effWind = Math.max(windLvl * 0.55, windMag);

    const anyActive = (rainLvl + snowLvl + dustLvl + heatLvl + mistLvl + steamLvl + cloudLvl + starLvl + effWind) > 0.01;
    envAudio.lastTargets.scale = effScale;

    if (effScale <= 0.005 || !anyActive) {
      stopEnvironmentAudio();
      return;
    }

    if (!ensureEnvBeds()) return;

    envAudio.lfoPhase += dt;
    const breathA = 0.90 + 0.10 * Math.sin(envAudio.lfoPhase * 0.65);
    const breathB = 0.88 + 0.12 * Math.sin(envAudio.lfoPhase * 0.42 + 1.7);
    const now = ctx.currentTime;
    const beds = envAudio.beds;

    // 1. Continuous Stereo Beds (softly modulated so they feel alive, never static hiss)
    const rainTarget = rainLvl > 0.01 ? clamp((0.022 + rainLvl * 0.056) * breathA * effScale, 0.0001, 0.13) : 0.0001;
    const rainAirTarget = rainLvl > 0.01 ? clamp((0.012 + rainLvl * 0.032) * breathB * effScale, 0.0001, 0.075) : 0.0001;
    const windBedTarget = effWind > 0.02 ? clamp((0.012 + effWind * 0.034) * breathB * effScale, 0.0001, 0.072) : 0.0001;
    const steamTarget = steamLvl > 0.01 ? clamp((0.014 + steamLvl * 0.032) * breathA * effScale, 0.0001, 0.074) : 0.0001;
    const heatTarget = heatLvl > 0.01 ? clamp((0.016 + heatLvl * 0.036) * breathB * effScale, 0.0001, 0.082) : 0.0001;
    const mistTarget = (mistLvl > 0.01 || snowLvl > 0.01)
      ? clamp((mistLvl * 0.024 + snowLvl * 0.014) * breathA * effScale, 0.0001, 0.052)
      : 0.0001;

    envAudio.lastTargets.rain = rainTarget > 0.001 ? rainTarget : 0;
    envAudio.lastTargets.wind = windBedTarget > 0.001 ? windBedTarget : 0;
    envAudio.lastTargets.steam = steamTarget > 0.001 ? steamTarget : 0;
    envAudio.lastTargets.heat = heatTarget > 0.001 ? heatTarget : 0;
    envAudio.lastTargets.mist = mistTarget > 0.001 ? mistTarget : 0;

    try {
      beds.rainBody.gain.gain.setTargetAtTime(rainTarget, now, 0.24);
      beds.rainBody.filt.frequency.setTargetAtTime(680 + Math.min(1.4, rainLvl) * 260 + Math.sin(envAudio.lfoPhase * 0.5) * 65, now, 0.35);
      beds.rainAir.gain.gain.setTargetAtTime(rainAirTarget, now, 0.24);
      beds.windAir.gain.gain.setTargetAtTime(windBedTarget, now, 0.28);
      beds.windAir.filt.frequency.setTargetAtTime(210 + effWind * 210 + Math.sin(envAudio.lfoPhase * 0.85) * 55, now, 0.35);
      beds.steam.gain.gain.setTargetAtTime(steamTarget, now, 0.22);
      beds.heat.gain.gain.setTargetAtTime(heatTarget, now, 0.25);
      beds.mist.gain.gain.setTargetAtTime(mistTarget, now, 0.32);
    } catch (_) {}

    // 2. Periodic Organic Weather Events
    const tm = envAudio.timers;

    if (effWind > 0.04) {
      tm.windGust -= dt;
      if (tm.windGust <= 0) {
        playEnvWindGust(clamp(effWind, 0.15, 1.3), Math.sign(windX), effScale);
        const speedMult = clamp(1.25 - effWind * 0.38, 0.55, 1.25);
        tm.windGust = rand(3.1, 6.4) * speedMult;
      }
    } else {
      tm.windGust = Math.min(tm.windGust, 0.85);
    }

    if (rainLvl > 0.04) {
      tm.rainDrop -= dt;
      if (tm.rainDrop <= 0) {
        playEnvRainDrop(rainLvl, effScale);
        tm.rainDrop = rand(0.09, 0.28) / clamp(0.65 + rainLvl * 0.75, 0.65, 2.0);
      }
      if (rainLvl > 1.12) {
        tm.thunder -= dt;
        if (tm.thunder <= 0) {
          playEnvThunder(effScale);
          tm.thunder = rand(14.0, 25.0);
        }
      }
    } else {
      tm.rainDrop = Math.min(tm.rainDrop, 0.25);
    }

    if (snowLvl > 0.04) {
      tm.snow -= dt;
      if (tm.snow <= 0) {
        playEnvSnowFlurry(snowLvl, effScale);
        tm.snow = rand(3.8, 7.6) / clamp(0.75 + snowLvl * 0.45, 0.75, 1.5);
      }
    } else {
      tm.snow = Math.min(tm.snow, 1.8);
    }

    if (steamLvl > 0.04) {
      tm.steamPuff -= dt;
      if (tm.steamPuff <= 0) {
        playEnvSteamPuff(steamLvl, effScale);
        tm.steamPuff = rand(2.1, 4.6) / clamp(0.75 + steamLvl * 0.5, 0.75, 1.6);
      }
    } else {
      tm.steamPuff = Math.min(tm.steamPuff, 1.1);
    }

    if (heatLvl > 0.04) {
      tm.heatCrackle -= dt;
      if (tm.heatCrackle <= 0) {
        playEnvHeatCrackle(heatLvl, effScale);
        tm.heatCrackle = rand(0.32, 1.25) / clamp(0.7 + heatLvl * 0.65, 0.7, 1.9);
      }
    } else {
      tm.heatCrackle = Math.min(tm.heatCrackle, 0.45);
    }

    if (mistLvl > 0.04) {
      tm.mist -= dt;
      if (tm.mist <= 0) {
        playEnvMistSwell(mistLvl, effScale);
        tm.mist = rand(4.8, 9.2);
      }
    } else {
      tm.mist = Math.min(tm.mist, 2.2);
    }

    if (dustLvl > 0.04) {
      tm.dust -= dt;
      if (tm.dust <= 0) {
        playEnvDustRustle(dustLvl, effScale);
        tm.dust = rand(3.8, 7.8);
      }
    } else {
      tm.dust = Math.min(tm.dust, 2.0);
    }

    if (cloudLvl > 0.04) {
      tm.cloud -= dt;
      if (tm.cloud <= 0) {
        playEnvCloudDrift(cloudLvl, effScale);
        tm.cloud = rand(4.6, 8.8);
      }
    } else {
      tm.cloud = Math.min(tm.cloud, 2.4);
    }

    if (starLvl > 0.04) {
      tm.star -= dt;
      if (tm.star <= 0) {
        playEnvStarTwinkle(starLvl, effScale);
        tm.star = rand(3.2, 6.8);
      }
    } else {
      tm.star = Math.min(tm.star, 1.8);
    }
  }

  function playEnvPreview(subType) {
    if (!unlocked || cfg.sfxMuted || cfg.sfxVol <= 0.001 || !ensureContext()) return;
    const sub = String(subType || 'RAIN').toUpperCase();
    if (sub === 'WIND') {
      playEnvWindGust(0.75, 1, 0.9);
    } else if (sub === 'RAIN') {
      const t = ctx.currentTime;
      playFilteredNoise(true, t, 0.95, 820, 760, 0.72, 0.072, 0.28, 'bandpass', -0.15, 0.12);
      playFilteredNoise(false, t, 0.85, 2600, 2300, 0.95, 0.032, 0.24, 'bandpass', 0.18, 0.12);
      playEnvRainDrop(1.0, 1.0);
    } else if (sub === 'SNOW') {
      playEnvSnowFlurry(1.0, 1.0);
    } else if (sub === 'STEAM') {
      playEnvSteamPuff(1.0, 1.0);
    } else if (sub === 'RISING HEAT') {
      const t = ctx.currentTime;
      playFilteredNoise(true, t, 0.65, 145, 110, 0.8, 0.055, 0.16, 'lowpass', 0, 0.08);
      playEnvHeatCrackle(1.1, 1.0);
    } else if (sub === 'MIST') {
      playEnvMistSwell(1.0, 1.0);
    } else if (sub === 'VILLAGE DUST') {
      playEnvDustRustle(1.0, 1.0);
    } else if (sub === 'CLOUDS') {
      playEnvCloudDrift(1.0, 1.0);
    } else if (sub === 'STARS') {
      playEnvStarTwinkle(1.0, 1.0);
    }
  }

  function getEnvAudioDebugState() {
    return {
      ready: envAudio.ready,
      targets: { ...envAudio.lastTargets },
      events: { ...envAudio.eventCounts }
    };
  }

  function playChangingTouch(soundKind = 'NONE') {
    const kind = String(soundKind || 'NONE').toUpperCase();
    if (kind === 'NONE') return;
    if (!unlocked || cfg.sfxMuted || !ensureContext()) return;
    const t = ctx.currentTime + 0.004;
    if (kind === 'CHIME') {
      playCrystalBell(880, t, 0.095, 0.36, 0.42, 0);
      playCrystalBell(1318.5, t + 0.04, 0.072, 0.32, 0.38, 0.14);
    } else if (kind === 'POP') {
      playWoodBar(520, t, 0.12, 0.06, 0.16, 0, 1.42);
      playFilteredNoise(false, t, 0.018, 2200, 1400, 2.2, 0.055, 0.10, 'bandpass', 0, 0.002);
    } else if (kind === 'CLICK') {
      playWoodBar(760, t, 0.11, 0.04, 0.12, 0, 1.18);
      playFilteredNoise(false, t, 0.014, 3400, 1800, 2.5, 0.065, 0.08, 'bandpass', 0, 0.001);
    } else if (kind === 'WOOD') {
      playSurfaceFoley('WOOD', 0.95, true, 0, 1.08, 0);
    } else if (kind === 'GLASS') {
      playSurfaceFoley('GLASS', 0.95, true, 0, 1.12, 0);
    } else if (kind === 'METAL') {
      playSurfaceFoley('METAL', 0.9, true, 0, 1.05, 0);
    } else if (kind === 'SPARKLE') {
      playCrystalBell(1396.9, t, 0.07, 0.24, 0.46, -0.14);
      playCrystalBell(1760.0, t + 0.035, 0.065, 0.28, 0.48, 0.14);
      playCrystalBell(2093.0, t + 0.075, 0.05, 0.26, 0.46, 0);
    } else if (kind === 'WHOOSH') {
      playFilteredNoise(true, t, 0.22, 420, 1650, 1.6, 0.11, 0.24, 'bandpass', 0, 0.035);
    }
  }

  return {
    cfg,
    unlock,
    tryAutoStart,
    startGameMusic,
    preloadYouTube,
    suspendForLock,
    resumeFromLock,
    getStatus() {
      const active = unlocked || Boolean(ctx && ctx.state === 'running');
      if (!musicAllowed) return { playing: false, text: 'STARTS ON PLAY' };
      if (!active) return { playing: false, text: 'AUTO-STARTS ON FIRST INPUT' };
      if (!cfg.musicEnabled || cfg.musicMuted) return { playing: false, text: 'AMBIENT PAUSED' };
      const tr = AMBIENT_TRACKS[cfg.trackId] || AMBIENT_TRACKS.synth;
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
      musicAllowed = true;
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
      musicAllowed = true;
      unlock();
      cfg.trackId = trackId;
      cfg.userPickedTrack = true;
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
      if (p.userPickedTrack && p.musicTrack && AMBIENT_TRACKS[p.musicTrack]) {
        cfg.trackId = p.musicTrack;
        cfg.userPickedTrack = true;
      } else {
        // Default gently to quiet Toybox Drift unless user explicitly chose a track
        cfg.trackId = 'synth';
        if (!p.userPickedTrack && Number.isFinite(p.musicVol) && Math.abs(p.musicVol - 0.28) < 0.005) {
          cfg.musicVol = 0.16;
        }
      }
      syncGains();
    },
    playStep,
    playClimbStep,
    playJump,
    playChangingTouch,
    playBounce,
    playBounceLift,
    playLand,
    playSurfacePreview,
    playSit,
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
    playCrumbleShake,
    playCrumbleBreak,
    playCrumbleReform,
    playPlaceBlock,
    playPickup,
    playDeselect,
    playRotate,
    playSwitchSnap,
    playCubePoke,
    playExplosion,
    playPiston,
    playWire,
    playFreeze,
    playPixoVoice,
    playPixoCheer,
    playButton,
    playError,
    playMenuSwipe,
    playBodyEquip,
    playCollect,
    playSwitch,
    playPortal,
    playEmit,
    playEnvPreview,
    updateEnvironmentAudio,
    stopEnvironmentAudio,
    getEnvAudioDebugState
  };
})();
