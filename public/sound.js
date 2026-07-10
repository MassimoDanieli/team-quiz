'use strict';
// Tiny synthesized sound effects for reveal moments — WebAudio only, no
// audio assets to ship. Exposed as window.quizSound.
//
// Browsers block audio until the user interacts with the page, so the
// AudioContext is created lazily on the first gesture (quizSound.arm()
// wires that up). A page can also offer a mute toggle via .enabled.
/* eslint-disable no-unused-vars */
const quizSound = (() => {
  let ctx = null;
  let enabled = true;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One-shot tone: freq in Hz, start offset + duration in seconds.
  function tone(freq, at, dur, gainPeak) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainPeak || 0.18, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  return {
    get enabled() {
      return enabled;
    },
    set enabled(v) {
      enabled = !!v;
      if (enabled) ensureCtx();
    },
    // Call once at page setup: unlocks audio on the first user gesture.
    arm() {
      const unlock = () => ensureCtx();
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    },
    // ok === true  → your team scored (bright ascending chime)
    // ok === false → your team missed (soft descending tone)
    // ok === null  → neutral reveal (single ping — spectator/big screen)
    reveal(ok) {
      if (!enabled) return;
      if (ok === true) {
        tone(660, 0, 0.18);
        tone(880, 0.12, 0.28);
      } else if (ok === false) {
        tone(330, 0, 0.2);
        tone(247, 0.14, 0.32, 0.14);
      } else {
        tone(740, 0, 0.25);
      }
    },
    // Game over fanfare (winner announced).
    fanfare() {
      if (!enabled) return;
      tone(523, 0, 0.16);
      tone(659, 0.12, 0.16);
      tone(784, 0.24, 0.34);
    }
  };
})();
