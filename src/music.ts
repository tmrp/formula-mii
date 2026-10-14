// "Bossa de Interlagos": an original bossa nova in the spirit of the Wii's
// channel music (and of the race's home city). It is played live with Web
// Audio: a vibraphone melody, electric-piano chords, bass and light
// percussion. There are no audio files and no Nintendo music.
import { audioContext } from "./wii";

const BPM = 116;
const EIGHTH = 60 / BPM / 2;
const LOOKAHEAD = 0.15;

// Rootless jazz voicings for the electric piano, with the bass root (MIDI).
const CHORDS: Record<string, [root: number, voicing: number[]]> = {
  Fmaj7: [41, [57, 60, 64, 67]],
  F7: [41, [57, 60, 63, 67]],
  Gm7: [43, [58, 62, 65, 69]],
  C7: [36, [58, 62, 64, 69]],
  C7b9: [36, [58, 61, 64, 67]],
  Am7: [45, [60, 64, 67, 71]],
  D7: [38, [60, 64, 66, 71]],
  Bbmaj7: [46, [57, 60, 62, 65]],
  Bbm6: [46, [61, 65, 67, 70]],
  Eb7: [39, [61, 65, 67, 72]],
  Cm7: [36, [58, 62, 63, 67]],
  Ebm7: [39, [54, 58, 61, 65]],
  Ab7: [44, [54, 58, 60, 65]],
  Dbmaj7: [37, [53, 56, 60, 63]],
};
// 32 bars, AABA: one or two chords per bar.
const CHART = [
  ["Fmaj7"],
  ["Fmaj7"],
  ["Gm7"],
  ["C7"],
  ["Am7"],
  ["D7"],
  ["Gm7"],
  ["C7b9"],
  ["Fmaj7"],
  ["F7"],
  ["Bbmaj7"],
  ["Bbm6", "Eb7"],
  ["Am7"],
  ["D7"],
  ["Gm7", "C7"],
  ["Fmaj7"],
  ["Cm7"],
  ["F7"],
  ["Bbmaj7"],
  ["Bbmaj7"],
  ["Ebm7"],
  ["Ab7"],
  ["Dbmaj7"],
  ["Gm7", "C7"],
  ["Fmaj7"],
  ["D7"],
  ["Gm7"],
  ["C7"],
  ["Am7", "D7"],
  ["Gm7", "C7"],
  ["Fmaj7"],
  ["Gm7", "C7"],
];
// The melody, bar by bar: [beat in bar, length in beats, MIDI note].
type Note = [number, number, number];
const MELODY: Note[][] = [
  [
    [0.5, 0.5, 69],
    [1, 0.5, 72],
    [1.5, 2, 76],
    [3.5, 0.5, 74],
  ],
  [
    [0, 1.5, 72],
    [1.5, 0.5, 69],
    [2, 1, 67],
    [3, 1, 69],
  ],
  [
    [0.5, 0.5, 70],
    [1, 0.5, 74],
    [1.5, 1.5, 77],
    [3, 0.5, 76],
    [3.5, 0.5, 74],
  ],
  [
    [0, 1, 76],
    [1, 0.5, 72],
    [1.5, 1.5, 70],
    [3, 1, 67],
  ],
  [
    [0.5, 0.5, 72],
    [1, 0.5, 76],
    [1.5, 2, 79],
    [3.5, 0.5, 81],
  ],
  [
    [0, 1.5, 78],
    [1.5, 0.5, 76],
    [2, 1, 74],
    [3, 1, 72],
  ],
  [
    [0, 1.5, 70],
    [1.5, 0.5, 74],
    [2, 1.5, 72],
    [3.5, 0.5, 70],
  ],
  [
    [0, 1.5, 76],
    [1.5, 0.5, 73],
    [2, 1, 70],
    [3, 1, 67],
  ],
  [
    [0, 1.5, 72],
    [1.5, 0.5, 69],
    [2, 0.5, 72],
    [2.5, 1.5, 76],
  ],
  [
    [0, 1, 75],
    [1, 0.5, 74],
    [1.5, 1.5, 72],
    [3, 1, 69],
  ],
  [
    [0.5, 0.5, 74],
    [1, 0.5, 77],
    [1.5, 2, 81],
    [3.5, 0.5, 79],
  ],
  [
    [0, 1.5, 77],
    [1.5, 0.5, 73],
    [2, 1.5, 79],
    [3.5, 0.5, 77],
  ],
  [
    [0, 1.5, 76],
    [1.5, 0.5, 72],
    [2, 1, 79],
    [3, 1, 76],
  ],
  [
    [0, 1, 78],
    [1, 0.5, 74],
    [1.5, 1.5, 72],
    [3, 1, 69],
  ],
  [
    [0, 1, 70],
    [1, 1, 74],
    [2, 1, 76],
    [3, 1, 70],
  ],
  [
    [0, 3, 69],
    [3, 0.5, 72],
    [3.5, 0.5, 74],
  ],
  [
    [0, 1.5, 75],
    [1.5, 0.5, 74],
    [2, 1, 70],
    [3, 1, 67],
  ],
  [
    [0, 1.5, 69],
    [1.5, 0.5, 72],
    [2, 2, 75],
  ],
  [
    [0, 1.5, 74],
    [1.5, 0.5, 77],
    [2, 1, 81],
    [3, 1, 77],
  ],
  [
    [0, 3, 74],
    [3, 0.5, 72],
    [3.5, 0.5, 70],
  ],
  [
    [0, 1.5, 70],
    [1.5, 0.5, 73],
    [2, 1.5, 77],
    [3.5, 0.5, 78],
  ],
  [
    [0, 1, 77],
    [1, 0.5, 75],
    [1.5, 1.5, 72],
    [3, 1, 70],
  ],
  [
    [0, 1.5, 72],
    [1.5, 0.5, 75],
    [2, 2, 77],
  ],
  [
    [0, 1, 74],
    [1, 1, 70],
    [2, 1, 76],
    [3, 1, 79],
  ],
  [
    [0, 1.5, 81],
    [1.5, 0.5, 79],
    [2, 1, 76],
    [3, 1, 72],
  ],
  [
    [0, 1.5, 78],
    [1.5, 0.5, 74],
    [2, 1.5, 72],
    [3.5, 0.5, 69],
  ],
  [
    [0.5, 0.5, 70],
    [1, 0.5, 74],
    [1.5, 1.5, 77],
    [3, 1, 81],
  ],
  [
    [0, 1.5, 79],
    [1.5, 0.5, 76],
    [2, 2, 70],
  ],
  [
    [0, 1, 72],
    [1, 1, 76],
    [2, 1, 78],
    [3, 1, 74],
  ],
  [
    [0, 1, 70],
    [1, 1, 69],
    [2, 1, 67],
    [3, 1, 70],
  ],
  [[0, 3.5, 69]],
  [
    [2, 0.5, 70],
    [2.5, 0.5, 74],
    [3, 0.5, 76],
    [3.5, 0.5, 79],
  ],
];
// Bossa clave over two bars, in eighths: the rim click and the piano's chord hits.
const CLAVE = [0, 3, 6, 10, 13];

type Event =
  | { kind: "melody"; midi: number; length: number; bright: boolean }
  | { kind: "piano"; voicing: number[]; length: number }
  | { kind: "bass"; midi: number; length: number }
  | { kind: "rim" | "shaker" | "kick"; accent: number };

// The whole loop as eighth-note steps, worked out once.
const STEPS: Event[][] = (() => {
  const steps: Event[][] = Array.from({ length: CHART.length * 8 }, () => []);
  CHART.forEach((chords, bar) => {
    const at = (eighth: number) => steps[bar * 8 + eighth];
    const chordAt = (eighth: number) =>
      CHORDS[chords[eighth < 4 ? 0 : chords.length - 1]];
    for (const [beat, length, midi] of MELODY[bar])
      at(beat * 2).push({
        kind: "melody",
        midi,
        length,
        bright: bar >= 16 && bar < 24,
      });
    for (const hit of CLAVE)
      if (Math.floor(hit / 8) === bar % 2)
        at(hit % 8).push({
          kind: "piano",
          voicing: chordAt(hit % 8)[1],
          length: 0.75,
        });
    // Bass: root then fifth, as a bossa guitarist's thumb plays it.
    const fifth = (root: number) => (root + 7 <= 50 ? root + 7 : root - 5);
    const [first] = CHORDS[chords[0]],
      [second] = CHORDS[chords[chords.length - 1]];
    at(0).push({ kind: "bass", midi: first, length: 1.5 });
    at(3).push({ kind: "bass", midi: fifth(first), length: 0.5 });
    at(4).push({
      kind: "bass",
      midi: chords.length > 1 ? second : fifth(first),
      length: 1.5,
    });
    at(7).push({
      kind: "bass",
      midi: chords.length > 1 ? fifth(second) : first,
      length: 0.5,
    });
    for (let e = 0; e < 8; e++)
      at(e).push({ kind: "shaker", accent: e % 2 ? 1 : 0.6 });
    for (const hit of CLAVE)
      if (Math.floor(hit / 8) === bar % 2)
        at(hit % 8).push({ kind: "rim", accent: 1 });
    at(0).push({ kind: "kick", accent: 1 });
    at(3).push({ kind: "kick", accent: 0.45 });
    at(4).push({ kind: "kick", accent: 0.8 });
    // A little rim fill into the top of the loop.
    if (bar === CHART.length - 1)
      for (const e of [5, 6, 7]) at(e).push({ kind: "rim", accent: 0.8 });
  });
  return steps;
})();

const mtof = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

class Band {
  readonly output: GainNode;
  private reverb: ConvolverNode;
  private noise: AudioBuffer;
  constructor(private ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.ratio.value = 3;
    this.output.connect(glue).connect(ctx.destination);
    // A small room: decaying stereo noise as the impulse response.
    const length = Math.floor(ctx.sampleRate * 1.8),
      impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < length; i++)
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet).connect(this.output);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  private voice(pan: number, send: number) {
    const amp = this.ctx.createGain(),
      panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    amp.connect(panner).connect(this.output);
    if (send) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      panner.connect(s).connect(this.reverb);
    }
    return amp;
  }
  private osc(type: OscillatorType, frequency: number, t: number, end: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    o.start(t);
    o.stop(end);
    return o;
  }
  /** Vibraphone: a sine with a bell partial on the strike and a slow tremolo. */
  vibes(
    t: number,
    midi: number,
    length: number,
    velocity: number,
    glock = false,
  ) {
    const f = mtof(midi),
      ring = Math.max(length + 0.35, 1.1),
      end = t + ring + 0.05,
      amp = this.voice(glock ? 0.35 : 0.18, 0.5);
    const peak = (glock ? 0.07 : 0.24) * velocity;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0008, t + ring);
    // Tremolo as its own gain stage, so it shapes the note rather than adding to it.
    const tremolo = this.ctx.createGain(),
      depth = this.ctx.createGain();
    tremolo.gain.value = 1;
    depth.gain.value = 0.18;
    this.osc("sine", 5.3, t, end).connect(depth).connect(tremolo.gain);
    tremolo.connect(amp);
    this.osc("sine", f, t, end).connect(tremolo);
    const bell = this.ctx.createGain();
    bell.gain.setValueAtTime(glock ? 0.5 : 0.22, t);
    bell.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    this.osc("sine", f * 4, t, end)
      .connect(bell)
      .connect(tremolo);
  }
  /** Electric piano: two-operator FM, bright on the attack, mellow as it holds. */
  piano(t: number, voicing: number[], length: number, velocity: number) {
    const hold = length * EIGHTH * 2,
      end = t + hold + 0.5;
    for (const midi of voicing) {
      const f = mtof(midi),
        amp = this.voice(-0.25, 0.35);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.045 * velocity, t + 0.005);
      amp.gain.setTargetAtTime(0.022 * velocity, t + 0.01, 0.3);
      amp.gain.setTargetAtTime(0, t + hold, 0.07);
      const carrier = this.osc("sine", f, t, end);
      const index = this.ctx.createGain();
      index.gain.setValueAtTime(f * 1.4, t);
      index.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.4);
      this.osc("sine", f, t, end).connect(index).connect(carrier.frequency);
      carrier.connect(amp);
    }
  }
  bass(t: number, midi: number, length: number, velocity: number) {
    const f = mtof(midi),
      hold = length * EIGHTH * 2,
      end = t + hold + 0.3,
      amp = this.voice(0, 0.05);
    const tone = this.ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 850;
    tone.connect(amp);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.24 * velocity, t + 0.008);
    amp.gain.setTargetAtTime(0.14 * velocity, t + 0.02, 0.25);
    amp.gain.setTargetAtTime(0, t + hold * 0.92, 0.04);
    this.osc("triangle", f, t, end).connect(tone);
    const body = this.ctx.createGain();
    body.gain.value = 0.6;
    this.osc("sine", f, t, end).connect(body).connect(tone);
  }
  private hit(
    t: number,
    decay: number,
    peak: number,
    filter: BiquadFilterType,
    frequency: number,
    q: number,
    pan: number,
  ) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const shape = this.ctx.createBiquadFilter();
    shape.type = filter;
    shape.frequency.value = frequency;
    shape.Q.value = q;
    const amp = this.voice(pan, 0.15);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0005, t + decay);
    src.connect(shape).connect(amp);
    src.start(t, Math.random() * 0.8);
    src.stop(t + decay + 0.02);
  }
  rim(t: number, velocity: number) {
    this.hit(t, 0.05, 0.16 * velocity, "bandpass", 1800, 5, -0.1);
  }
  shaker(t: number, velocity: number) {
    this.hit(t, 0.045, 0.04 * velocity, "highpass", 6500, 0.7, 0.3);
  }
  kick(t: number, velocity: number) {
    const amp = this.voice(0, 0);
    amp.gain.setValueAtTime(0.4 * velocity, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    const o = this.osc("sine", 95, t, t + 0.3);
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(amp);
  }
}

// ---------------------------------------------------------------------------

const STORE = "formula-mii:music";
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
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ on: enabled, volume }));
  } catch {
    // Not remembered, but still applied.
  }
}

let band: Band | undefined,
  timer: number | undefined,
  step = 0,
  nextTime = 0;
const level = () => 0.46 * volume;
const listeners = new Set<(on: boolean) => void>();

function schedule() {
  const ctx = band && audioContext(false);
  if (!ctx || !band) return;
  // After a long stall (a hidden tab), pick the groove up from now.
  if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    for (const e of STEPS[step]) {
      // A little human looseness in time and touch.
      const t = nextTime + (Math.random() - 0.5) * 0.008,
        velocity = 0.9 + Math.random() * 0.2;
      if (e.kind === "melody") {
        band.vibes(t, e.midi, e.length * EIGHTH * 2, velocity);
        if (e.bright)
          band.vibes(t, e.midi + 12, e.length * EIGHTH * 2, velocity, true);
      } else if (e.kind === "piano")
        band.piano(t, e.voicing, e.length, velocity);
      else if (e.kind === "bass") band.bass(t, e.midi, e.length, velocity);
      else band[e.kind](t, e.accent * velocity);
    }
    step = (step + 1) % STEPS.length;
    nextTime += EIGHTH;
  }
}

function start() {
  const ctx = audioContext();
  if (!ctx || timer !== undefined) return;
  band ??= new Band(ctx);
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  band.output.gain.cancelScheduledValues(ctx.currentTime);
  band.output.gain.setValueAtTime(band.output.gain.value, ctx.currentTime);
  band.output.gain.linearRampToValueAtTime(level(), ctx.currentTime + 1.5);
  timer = window.setInterval(schedule, 25);
  schedule();
}

function stop() {
  if (timer === undefined) return;
  window.clearInterval(timer);
  timer = undefined;
  const ctx = audioContext();
  if (ctx && band) {
    band.output.gain.cancelScheduledValues(ctx.currentTime);
    band.output.gain.setValueAtTime(band.output.gain.value, ctx.currentTime);
    band.output.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
  }
}

export const musicEnabled = () => enabled;
export const musicVolume = () => volume;
export function onMusicChange(listener: (on: boolean) => void) {
  listeners.add(listener);
}
export function setMusic(on: boolean) {
  enabled = on;
  save();
  if (on) start();
  else stop();
  listeners.forEach((l) => l(on));
}
export function setMusicVolume(value: number) {
  volume = Math.min(1, Math.max(0, value));
  save();
  const ctx = audioContext();
  if (ctx && band && timer !== undefined)
    band.output.gain.setTargetAtTime(level(), ctx.currentTime, 0.1);
}

/**
 * Browsers only allow sound after the visitor interacts, so the music starts
 * on the first click or key press, and rests while the tab is hidden.
 */
export function installMusic() {
  const first = () => {
    window.removeEventListener("pointerdown", first, true);
    window.removeEventListener("keydown", first, true);
    if (enabled) start();
  };
  window.addEventListener("pointerdown", first, true);
  window.addEventListener("keydown", first, true);
  document.addEventListener("visibilitychange", () => {
    if (timer === undefined) return;
    // Resuming happens through audioContext() when the tab returns.
    const ctx = audioContext(!document.hidden);
    if (document.hidden) void ctx?.suspend().catch(() => {});
  });
}
