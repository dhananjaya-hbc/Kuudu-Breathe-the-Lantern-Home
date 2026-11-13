// Soft ambient sound, generated entirely in code with the Web Audio API
// (no audio files, nothing to license).
//
// - Breath drone: a warm chord whose brightness opens as the lantern rises
//   (breathing in) and mellows as it sinks; a shimmer layer grows with glow.
// - River: quiet filtered noise with a slow swell.
// - Gate chime: a soft bell on a pentatonic scale, one step higher for each
//   gate in the streak; a quiet low tone for a miss.
// - Release: a gentle rising arpeggio when the lantern floats away.
//
// Mute is per session only and is never saved.

/** A major pentatonic scale from A3, in Hz: calm and never clashing. */
const PENTATONIC = [220, 246.94, 277.18, 329.63, 369.99, 440, 493.88, 554.37, 659.25, 739.99, 880];
const DRONE_NOTES = [110, 164.81, 220]; // A2, E3, A3
const MASTER_VOLUME = 0.55;
/** Smoothing for continuous changes, seconds. */
const GLIDE = 0.25;

export class AmbientAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private shimmerGain: GainNode | null = null;
  private riverGain: GainNode | null = null;
  private mutedValue = false;
  private playing = false;

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(value: boolean) {
    this.mutedValue = value;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(value ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.1);
    }
  }

  /** Starts the ambience. Call from a user action (click/key) so the browser allows audio. */
  async start(): Promise<void> {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    if (ctx.state === 'suspended') await ctx.resume();
    if (this.playing) return;
    this.playing = true;
    const now = ctx.currentTime;
    this.droneGain!.gain.setTargetAtTime(0.16, now, 1.2);
    this.riverGain!.gain.setTargetAtTime(0.05, now, 1.5);
  }

  /** Fades the ambience out (the context stays ready for the next run). */
  stop(): void {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    const now = this.ctx.currentTime;
    this.droneGain!.gain.setTargetAtTime(0, now, 0.6);
    this.shimmerGain!.gain.setTargetAtTime(0, now, 0.6);
    this.riverGain!.gain.setTargetAtTime(0.02, now, 0.8);
  }

  /** Call every frame with the lantern height (0–1) and glow (0–1). */
  update(height: number, glow: number): void {
    if (!this.ctx || !this.playing) return;
    const now = this.ctx.currentTime;
    const h = clamp01(height);
    this.droneFilter!.frequency.setTargetAtTime(280 + 1100 * h * h, now, GLIDE);
    this.droneGain!.gain.setTargetAtTime(0.11 + 0.07 * h, now, GLIDE);
    this.shimmerGain!.gain.setTargetAtTime(0.035 * clamp01(glow), now, 0.6);
  }

  /** Soft bell for a passed gate; higher for longer streaks. */
  chime(streak: number): void {
    if (!this.ctx || this.mutedValue) return;
    const index = Math.min(PENTATONIC.length - 1, 3 + Math.max(0, streak - 1));
    const freq = PENTATONIC[index]!;
    this.bell(freq, this.ctx.currentTime, 0.16, 1.8);
    this.bell(freq * 2, this.ctx.currentTime + 0.01, 0.04, 1.2);
  }

  /** Quiet low tone for a missed gate: noticeable, never harsh. */
  miss(): void {
    if (!this.ctx || this.mutedValue) return;
    this.bell(110, this.ctx.currentTime, 0.07, 0.9, 'triangle');
  }

  /** Rising arpeggio as the lantern is released at the end of a run. */
  release(): void {
    if (!this.ctx || this.mutedValue) return;
    const start = this.ctx.currentTime + 0.1;
    [0, 2, 3, 5, 7, 8].forEach((step, i) => {
      this.bell(PENTATONIC[step]!, start + i * 0.32, 0.12, 2.6);
    });
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.mutedValue ? 0 : MASTER_VOLUME;
    this.master.connect(ctx.destination);

    // Breath drone: detuned oscillators through a low-pass filter.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 400;
    this.droneFilter.Q.value = 0.7;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain).connect(this.master);
    for (const [i, freq] of DRONE_NOTES.entries()) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(this.droneFilter);
        osc.start();
      }
    }

    // Shimmer: a high, quiet fifth that grows with glow.
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    this.shimmerGain.connect(this.master);
    for (const freq of [659.25, 987.77]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const tremolo = ctx.createGain();
      tremolo.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.3 + freq / 5000;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.5;
      lfo.connect(lfoDepth).connect(tremolo.gain);
      osc.connect(tremolo).connect(this.shimmerGain);
      osc.start();
      lfo.start();
    }

    // River: looping brown noise, band-passed, with a slow swell.
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 520;
    band.Q.value = 0.6;
    this.riverGain = ctx.createGain();
    this.riverGain.gain.value = 0;
    const swell = ctx.createGain();
    swell.gain.value = 0.75;
    const swellLfo = ctx.createOscillator();
    swellLfo.frequency.value = 0.08;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.25;
    swellLfo.connect(swellDepth).connect(swell.gain);
    noise.connect(band).connect(swell).connect(this.riverGain).connect(this.master);
    noise.start();
    swellLfo.start();
  }

  /** A soft bell: quick attack, long gentle decay. */
  private bell(
    freq: number,
    at: number,
    peak: number,
    decay: number,
    type: OscillatorType = 'sine',
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
