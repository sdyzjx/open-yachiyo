/*
 * Lipsync driver: analyser -> viseme frame -> mouth transition -> stage mouth parameters.
 * Ports the tuning constants of apps/desktop-live2d/renderer/bootstrap.js; the DSP lives in the shared
 * lipsyncViseme.js / lipsyncMouthTransition.js modules. Stepped once per frame by the app loop.
 */
(function (global) {
  'use strict';

  const C = {
    activeEnergyMin: 0.018, baselineOpenAlpha: 0.032, baselineFormAlpha: 0.02,
    openGainMin: 3.0, openGainMax: 4.0, openNegGain: 0.9, speakingOpenFloorRatio: 0.22,
    deadzoneEnter: 0.09, deadzoneExit: 0.11, formGainMin: 2.0, formGainMax: 3.0
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

  class LipsyncDriver {
    constructor({ stage }) {
      this.stage = stage;
      this.Viseme = global.Live2DVisemeLipSync;
      this.Mouth = global.Live2DMouthTransition;
      this.analyser = null;
      this.ctx = null;
      this.isSpeaking = () => false;
      this.running = false;
      this.releasing = false;
      this.state = null;
      this.data = null;
      this.cur = { mouthOpen: 0, mouthForm: 0 };
      this.target = { mouthOpen: 0, mouthForm: 0 };
      this.baseOpen = 0; this.baseForm = 0; this.deadzone = false;
    }

    start({ analyser, audioContext, isSpeaking }) {
      if (!this.Viseme || !this.Mouth) return false;
      this.analyser = analyser;
      this.ctx = audioContext;
      this.isSpeaking = isSpeaking;
      this.data = new Uint8Array(analyser.frequencyBinCount);
      this.state = this.Viseme.createRuntimeState();
      this.baseOpen = 0; this.baseForm = 0;
      this.running = true;
      this.releasing = false;
      this.stage.mouth.active = true;
      return true;
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      this.releasing = true;
      this.target = { mouthOpen: 0, mouthForm: 0 };
    }

    get active() { return this.running || this.releasing; }

    enhance(open, form, energy, speaking) {
      if (!speaking) return { open, form };
      const intensity = clamp((energy - C.activeEnergyMin) / 0.08, 0, 1);
      this.baseOpen = clamp(this.baseOpen + (open - this.baseOpen) * C.baselineOpenAlpha, 0, 1);
      this.baseForm = clamp(this.baseForm + (form - this.baseForm) * C.baselineFormAlpha, -1, 1);
      const openDelta = open - this.baseOpen;
      const formDelta = form - this.baseForm;
      const pos = Math.max(0, openDelta) * lerp(C.openGainMin, C.openGainMax, intensity);
      const neg = Math.min(0, openDelta) * C.openNegGain;
      const floor = clamp(this.baseOpen * C.speakingOpenFloorRatio, 0, 1);
      return {
        open: clamp(Math.max(floor, this.baseOpen + pos + neg), 0, 1),
        form: clamp(this.baseForm + formDelta * lerp(C.formGainMin, C.formGainMax, intensity), -1, 1)
      };
    }

    applyDeadzone(open, speaking) {
      if (this.deadzone) {
        if (open >= C.deadzoneExit) { this.deadzone = false; return open; }
        return 0;
      }
      if (open <= C.deadzoneEnter && (!speaking || open <= C.deadzoneExit)) { this.deadzone = true; return 0; }
      return open;
    }

    // Call once per frame before stage.render.
    step() {
      if (!this.running && !this.releasing) return;
      let speaking = false;
      if (this.running) {
        speaking = !!this.isSpeaking();
        this.analyser.getByteFrequencyData(this.data);
        let sum = 0;
        for (let i = 0; i < this.data.length; i += 1) sum += this.data[i];
        const energy = clamp(sum / (this.data.length * 255), 0, 1);
        const frame = this.Viseme.resolveVisemeFrame({
          frequencyBuffer: this.data, sampleRate: this.ctx.sampleRate, voiceEnergy: energy, speaking,
          fallbackOpen: 0, fallbackForm: 0, state: this.state
        }) || {};
        const e = this.enhance(clamp(Number(frame.mouthOpen) || 0, 0, 1), clamp(Number(frame.mouthForm) || 0, -1, 1), energy, speaking);
        const ov = frame.consonantOverlay || null;
        const open = clamp(e.open + (Number(ov && ov.mouthOpenDelta) || 0), 0, 1);
        this.target = {
          mouthOpen: this.applyDeadzone(open, speaking),
          mouthForm: clamp(e.form + (Number(ov && ov.mouthFormDelta) || 0), -1, 1)
        };
      }
      const next = this.Mouth.stepMouthTransition({ current: this.cur, target: this.target, speaking });
      this.cur = { mouthOpen: clamp(next.mouthOpen, 0, 1), mouthForm: clamp(next.mouthForm, -1, 1) };
      this.stage.mouth.open = this.cur.mouthOpen;
      this.stage.mouth.form = this.cur.mouthForm;
      if (this.releasing && this.Mouth.isMouthTransitionSettled({ current: this.cur, target: this.target })) {
        this.releasing = false;
        this.stage.mouth.active = false;
        this.cur = { mouthOpen: 0, mouthForm: 0 };
      }
    }
  }

  global.YachiyoLipsync = { LipsyncDriver };
})(window);
