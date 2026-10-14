import * as THREE from "three";
import { audioContext } from "./wii";

// Engine sounds in the manner of a Wii racer: every Mii's car is a soft toy
// kart motor, synthesised live from its real revs, throttle and gears. Cars
// are heard from where the camera listens, with distance, stereo and
// Doppler, so a trackside pass goes "neeeoowm" and the aerial view is a
// faint, distant hum.

const STORE = "formula-mii:engines";
let enabled = true,
  volume = 0.6;
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
  if (typeof saved.on === "boolean") enabled = saved.on;
  if (typeof saved.volume === "number")
    volume = Math.min(1, Math.max(0, saved.volume));
} catch {
  // No saved preference; keep the defaults.
}
const listeners = new Set<() => void>();
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ on: enabled, volume }));
  } catch {
    // Not remembered, but still applied.
  }
  listeners.forEach((l) => l());
}
export const engineSoundEnabled = () => enabled;
export const engineSoundVolume = () => volume;
export function onEngineSoundChange(listener: () => void) {
  listeners.add(listener);
}
export function setEngineSound(on: boolean) {
  enabled = on;
  save();
}
export function setEngineSoundVolume(value: number) {
  volume = Math.min(1, Math.max(0, value));
  save();
}

/** The most cars heard at once: the nearest ones. */
const MAX_VOICES = 8;
/** Full volume within this distance of the listener, in metres. */
const NEAR = 14;
const SPEED_OF_SOUND = 343;
/** Playback faster than this is too quick to follow by ear. */
const FASTEST_RATE = 8;
// A whisper under the music, never a roar over it.
const LEVEL = 0.025;

/** What one car is doing, in real units. */
export interface Revs {
  rpm: number;
  /** 0 to 1. */
  throttle: number;
  gear: number;
}

/**
 * A toy kart motor: half the real firing rate of a V6 (about 90 to 310 Hz),
 * a hollow, rounded waveform with no harsh top, a putt-putt flutter at a
 * tenth of its pitch and a little hybrid "wheee" on throttle.
 */
export const motorPitch = (rpm: number) => rpm / 40;

let wave: { ctx: BaseAudioContext; wave: PeriodicWave } | undefined;
function motorWave(ctx: BaseAudioContext) {
  if (wave?.ctx !== ctx) {
    const n = 18,
      real = new Float32Array(n),
      imag = new Float32Array(n);
    // Odd harmonics like a square for the toy buzz, softened evens for body,
    // falling faster than a sawtooth so it never rasps.
    for (let h = 1; h < n; h++) imag[h] = (h % 2 ? 1 : 0.55) / h ** 1.2;
    wave = { ctx, wave: ctx.createPeriodicWave(real, imag) };
  }
  return wave.wave;
}

// The flutter's shape: a soft pulse, so the putt-putt has a gentle edge.
let flutter: { ctx: BaseAudioContext; wave: PeriodicWave } | undefined;
function flutterWave(ctx: BaseAudioContext) {
  if (flutter?.ctx !== ctx)
    flutter = {
      ctx,
      wave: ctx.createPeriodicWave(
        new Float32Array([0, 0, 0, 0]),
        new Float32Array([0, 1, 0.5, 0.25]),
      ),
    };
  return flutter.wave;
}

let noise: { ctx: BaseAudioContext; buffer: AudioBuffer } | undefined;
function noiseBuffer(ctx: BaseAudioContext) {
  if (noise?.ctx !== ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise = { ctx, buffer };
  }
  return noise.buffer;
}

/** One car's motor. Its nodes exist only while it can be heard. */
export class Motor {
  readonly output: StereoPannerNode;
  private nodes?: {
    sources: AudioScheduledSourceNode[];
    /** The motor's pitch in Hz, which every oscillator follows. */
    pitch: ConstantSourceNode;
    puttDepth: GainNode;
    whineLevel: GainNode;
    tone: BiquadFilterNode;
    amp: GainNode;
  };
  private stopTimer: number | undefined;
  constructor(
    private ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    this.output = ctx.createStereoPanner();
    this.output.connect(destination);
  }
  get running() {
    return !!this.nodes;
  }
  private start() {
    window.clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    if (this.nodes) return this.nodes;
    const ctx = this.ctx,
      t = ctx.currentTime;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    // Throttle opens the filter a little: a muffled "mmm" off it, a soft
    // "vrrm" on it.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.Q.value = 0.7;
    tone.frequency.value = 400;
    tone.connect(amp).connect(this.output);
    // The putt-putt: the motor's level flutters, about 9 times a second at
    // idle and a buzzing 30 at full revs.
    const chug = ctx.createGain();
    chug.gain.value = 0.75;
    const puttDepth = ctx.createGain();
    puttDepth.gain.value = 0.3;
    chug.connect(tone);
    const body = ctx.createOscillator();
    body.setPeriodicWave(motorWave(ctx));
    body.connect(chug);
    const putt = ctx.createOscillator();
    putt.setPeriodicWave(flutterWave(ctx));
    putt.connect(puttDepth).connect(chug.gain);
    // A sine on the fundamental makes it round and friendly, like an ocarina.
    const round = ctx.createOscillator(),
      roundLevel = ctx.createGain();
    roundLevel.gain.value = 0.5;
    round.connect(roundLevel).connect(chug);
    // The hybrid whistle, after the filter so it stays a pure little "wheee".
    const whine = ctx.createOscillator(),
      whineLevel = ctx.createGain();
    whineLevel.gain.value = 0;
    whine.connect(whineLevel).connect(amp);
    // One pitch drives every oscillator, each at its own ratio.
    const pitch = ctx.createConstantSource();
    pitch.offset.value = 100;
    for (const [osc, ratio] of [
      [body, 1],
      [putt, 0.1],
      [round, 1],
      [whine, 4.02],
    ] as const) {
      const link = ctx.createGain();
      link.gain.value = ratio;
      osc.frequency.value = 0;
      pitch.connect(link).connect(osc.frequency);
    }
    const sources = [pitch, body, putt, round, whine];
    sources.forEach((s) => s.start(t));
    this.nodes = { sources, pitch, puttDepth, whineLevel, tone, amp };
    return this.nodes;
  }
  /** Fade out, then let the nodes go. */
  silence() {
    const nodes = this.nodes;
    if (!nodes || this.stopTimer !== undefined) return;
    const t = this.ctx.currentTime;
    nodes.amp.gain.cancelScheduledValues(t);
    nodes.amp.gain.setTargetAtTime(0, t, 0.06);
    this.stopTimer = window.setTimeout(() => {
      this.stopTimer = undefined;
      if (this.nodes !== nodes) return;
      this.nodes = undefined;
      nodes.sources.forEach((s) => s.stop());
      nodes.amp.disconnect();
    }, 500);
  }
  /**
   * Set the motor from telemetry. `shift` makes the pitch drop quickly, as
   * when the gearbox changes up; `doppler` scales the pitch.
   */
  set(
    revs: Revs,
    level: number,
    pan: number,
    doppler: number,
    distance: number,
    shift: boolean,
    at = this.ctx.currentTime,
  ) {
    const n = this.start(),
      t = at,
      thr = Math.min(1, Math.max(0, revs.throttle)),
      // A floor, so a car crawling in the pits still hums.
      f = motorPitch(Math.max(revs.rpm, 2400)) * doppler;
    n.pitch.offset.setTargetAtTime(f, t, shift ? 0.025 : 0.07);
    // Far cars are muffled by the air, like the Wii's soft, hazy horizon.
    const air = 1 / (1 + distance / 260);
    n.tone.frequency.setTargetAtTime(
      Math.min(9000, f * (1.3 + 3 * thr) * (0.35 + 0.65 * air)),
      t,
      0.05,
    );
    n.puttDepth.gain.setTargetAtTime(0.08 + 0.15 * (1 - thr), t, 0.08);
    n.whineLevel.gain.setTargetAtTime(
      0.02 * thr * Math.min(1, revs.rpm / 11000) * air,
      t,
      0.08,
    );
    n.amp.gain.setTargetAtTime(level * (0.5 + 0.5 * thr), t, 0.05);
    this.output.pan.setTargetAtTime(pan, t, 0.05);
  }
  /** A soft cork "pop" from the exhaust, as the throttle lifts or it changes down. */
  pop(level: number, delay = 0) {
    const ctx = this.ctx,
      t = ctx.currentTime + delay,
      amp = ctx.createGain(),
      body = ctx.createOscillator();
    const pitch = 420 + Math.random() * 160;
    body.type = "triangle";
    body.frequency.setValueAtTime(pitch, t);
    body.frequency.exponentialRampToValueAtTime(pitch * 0.35, t + 0.05);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(level, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    body.connect(amp).connect(this.output);
    body.start(t);
    body.stop(t + 0.09);
    // A puff of air on the front of it.
    const puff = ctx.createBufferSource(),
      band = ctx.createBiquadFilter(),
      puffLevel = ctx.createGain();
    puff.buffer = noiseBuffer(ctx);
    band.type = "bandpass";
    band.frequency.value = 1400;
    band.Q.value = 1.2;
    puffLevel.gain.setValueAtTime(level * 0.5, t);
    puffLevel.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    puff.connect(band).connect(puffLevel).connect(this.output);
    puff.start(t, Math.random() * 0.15);
    puff.stop(t + 0.04);
  }
}

interface Car {
  motor?: Motor;
  distance: number;
  /** Rate the car closes on (-) or leaves (+) the listener, metres a second. */
  closing: number;
  doppler: number;
  throttle: number;
  gear: number;
  rpm: number;
}

const right = new THREE.Vector3(),
  toCar = new THREE.Vector3(),
  ear = new THREE.Vector3();

/**
 * Every car's engine. The nearest few cars to the listener get a motor
 * each; the rest are too far away to hear.
 */
export class EngineSounds {
  private ctx?: AudioContext;
  private bus?: GainNode;
  private cars: Car[];
  private lastUpdate = 0;
  /** Race seconds since the motors were last set. */
  private elapsed = 0;
  private idle = true;
  /** Cars with a running motor, for the browser checks. */
  heard = 0;
  constructor(count: number) {
    this.cars = Array.from({ length: count }, () => ({
      distance: Infinity,
      closing: 0,
      doppler: 1,
      throttle: 0,
      gear: 0,
      rpm: 0,
    }));
  }
  private output() {
    const ctx = audioContext();
    if (!ctx || ctx.state !== "running") return;
    if (!this.bus) {
      this.ctx = ctx;
      this.bus = ctx.createGain();
      this.bus.gain.value = 0;
      // Gentle glue, so a pack of cars never drowns out the music.
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -20;
      glue.knee.value = 12;
      glue.ratio.value = 4;
      glue.attack.value = 0.01;
      glue.release.value = 0.25;
      this.bus.connect(glue).connect(ctx.destination);
    }
    return ctx;
  }
  /**
   * Call once a frame after the cars move. The race is heard from `listener`,
   * facing the way the camera does. `replayDelta` is how far the replay
   * advanced, in race seconds, and is 0 while paused.
   */
  update(
    frame: Float32Array,
    cars: readonly THREE.Object3D[],
    camera: THREE.Camera,
    listener: THREE.Vector3,
    replayDelta: number,
    rate: number,
  ) {
    const wanted =
      enabled && volume > 0 && replayDelta > 0 && rate <= FASTEST_RATE;
    if (!wanted) {
      this.elapsed = 0;
      if (this.idle) return;
      // Paused, muted or too fast to follow: fade everything out.
      this.idle = true;
      this.heard = 0;
      if (this.ctx && this.bus) {
        const now = this.ctx.currentTime;
        this.bus.gain.cancelScheduledValues(now);
        this.bus.gain.setTargetAtTime(0, now, 0.08);
      }
      this.cars.forEach((c) => {
        c.motor?.silence();
        c.distance = Infinity;
      });
      return;
    }
    const ctx = this.output();
    if (!ctx || !this.bus) return;
    this.elapsed += replayDelta;
    const now = ctx.currentTime;
    // The motors only need setting about 40 times a second.
    if (!this.idle && now - this.lastUpdate < 0.025) return;
    this.idle = false;
    this.lastUpdate = now;
    const elapsed = this.elapsed;
    this.elapsed = 0;
    // If frames stop coming (a hidden tab, a long stall), the engines fade
    // out by themselves rather than droning on.
    const bus = this.bus.gain;
    bus.cancelScheduledValues(now);
    bus.setTargetAtTime(LEVEL * volume, now, 0.08);
    bus.setTargetAtTime(0, now + 0.35, 0.1);

    ear.copy(listener);
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const heard: { i: number; loudness: number }[] = [];
    this.cars.forEach((car, i) => {
      const k = i * 16;
      toCar.subVectors(cars[i].position, ear);
      const distance = toCar.length();
      // How fast the gap is changing in race time, ignoring the jumps from
      // seeks and camera cuts.
      const closing = (distance - car.distance) / elapsed;
      car.closing =
        Number.isFinite(closing) && Math.abs(closing) < 140
          ? car.closing + (closing - car.closing) * 0.4
          : 0;
      car.distance = distance;
      car.doppler = Math.min(
        1.35,
        Math.max(0.75, SPEED_OF_SOUND / (SPEED_OF_SOUND + car.closing)),
      );
      if (!cars[i].visible || frame[k + 13] > 3 || frame[k + 8] < 1000) return;
      // A motor already running is favoured, so voices don't flicker.
      const loudness = NEAR / Math.max(NEAR, distance);
      heard.push({ i, loudness: loudness * (car.motor?.running ? 1.4 : 1) });
    });
    heard.sort((a, b) => b.loudness - a.loudness);
    const chosen = new Set(
      heard
        .slice(0, MAX_VOICES)
        .filter((h) => h.loudness > 0.004)
        .map((h) => h.i),
    );
    this.heard = chosen.size;
    this.cars.forEach((car, i) => {
      const k = i * 16,
        revs: Revs = {
          rpm: frame[k + 8],
          throttle: frame[k + 5] / 100,
          gear: frame[k + 7],
        };
      if (chosen.has(i)) {
        car.motor ??= new Motor(ctx, this.bus!);
        const level = NEAR / Math.max(NEAR, car.distance);
        toCar.subVectors(cars[i].position, ear);
        // Close by, a car fills both ears rather than sitting to one side.
        const pan =
          car.distance > 1
            ? toCar.normalize().dot(right) *
              Math.min(0.9, car.distance / (NEAR * 2))
            : 0;
        car.motor.set(
          revs,
          level,
          pan,
          car.doppler,
          car.distance,
          revs.gear > car.gear,
        );
        // Pops on a sharp lift from high revs, and on each downshift off
        // the throttle.
        const lift =
            car.throttle > 0.5 && revs.throttle < 0.1 && car.rpm > 8500,
          down = revs.gear < car.gear && revs.gear > 0 && revs.throttle < 0.1;
        if (level > 0.05 && (lift || down))
          for (let p = 0; p < (lift ? 3 : 1); p++)
            car.motor.pop(0.2 * level, p * (0.06 + Math.random() * 0.07));
      } else car.motor?.silence();
      car.throttle = revs.throttle;
      car.gear = revs.gear;
      car.rpm = revs.rpm;
    });
  }
}
