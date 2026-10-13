// Wii Menu chrome: the segmented clock digits, the curved bottom bar and the
// little hover and select sounds.

// Seven-segment digits on a 10 × 18 grid, drawn as rounded strokes like the
// Wii Menu clock.
const SEGMENTS: Record<string, string> = {
  a: "M2.6 1.3H7.4",
  b: "M8.7 2.6V7.4",
  c: "M8.7 10.6V15.4",
  d: "M2.6 16.7H7.4",
  e: "M1.3 10.6V15.4",
  f: "M1.3 2.6V7.4",
  g: "M2.6 9H7.4",
};
const GLYPHS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
  "—": "g",
  " ": "",
};

export function lcd(text: string) {
  let x = 0,
    shapes = "";
  for (const ch of text) {
    if (ch === ":") {
      shapes += `<circle cx="${x + 1.4}" cy="5.6" r="1.3"/><circle cx="${x + 1.4}" cy="12.4" r="1.3"/>`;
      x += 4.6;
      continue;
    }
    for (const s of GLYPHS[ch] ?? "")
      shapes += `<path transform="translate(${x} 0)" d="${SEGMENTS[s]}"/>`;
    x += 12.4;
  }
  return `<svg class="lcd" viewBox="-0.6 -0.6 ${Math.max(1, x - 1.2)} 19.2" aria-hidden="true"><g fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">${shapes}</g></svg>`;
}

/** Renders `text` as clock digits, only touching the DOM when it changes. */
export function setLcd(el: HTMLElement, text: string, label = text) {
  if (el.dataset.lcd === text) return;
  el.dataset.lcd = text;
  el.innerHTML = lcd(text);
  el.setAttribute("aria-label", label);
}

/**
 * Draws the Wii Menu bottom bar behind `bar`: a silver panel whose top edge
 * dips around the clock, outlined in Wii blue. The notch size comes from the
 * --notch-* custom properties so it can change at each breakpoint.
 */
export function bottomBar(bar: HTMLElement) {
  const svg = bar.querySelector<SVGSVGElement>(".bar-shape")!;
  const draw = () => {
    const { width: w, height: h } = bar.getBoundingClientRect();
    if (!w || !h) return;
    const css = getComputedStyle(bar);
    const depth = parseFloat(css.getPropertyValue("--notch-depth")) || 50,
      notch = parseFloat(css.getPropertyValue("--notch-width")) || 330,
      curve = parseFloat(css.getPropertyValue("--notch-curve")) || 90;
    const top = 2,
      a = w / 2 - notch / 2 - curve,
      b = w / 2 - notch / 2,
      k = curve * 0.55;
    const edge = `M0 ${top}H${a}C${a + k} ${top} ${b - k} ${depth} ${b} ${depth}H${w - b}C${w - b + k} ${depth} ${w - a - k} ${top} ${w - a} ${top}H${w}`;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = `<defs><linearGradient id="bar-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efefef"/><stop offset=".55" stop-color="#e0e0e0"/><stop offset="1" stop-color="#cdcdcd"/></linearGradient><pattern id="bar-lines" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#ffffff" opacity=".28"/></pattern></defs><path d="${edge}V${h}H0Z" fill="url(#bar-fill)"/><path d="${edge}V${h}H0Z" fill="url(#bar-lines)"/><path d="${edge}" transform="translate(0 3)" fill="none" stroke="#ffffff" stroke-width="3" opacity=".9"/><path d="${edge}" fill="none" stroke="#34beed" stroke-width="3"/>`;
  };
  new ResizeObserver(draw).observe(bar);
  draw();
}

// Menu sounds are synthesised so there are no audio files to load.
let audio: AudioContext | undefined;
let soundOn = true;
try {
  soundOn = localStorage.getItem("formula-mii:sounds") !== "off";
} catch {
  // Storage can be unavailable; sounds just stay on for this visit.
}
export const soundsEnabled = () => soundOn;
export function setSounds(on: boolean) {
  soundOn = on;
  try {
    localStorage.setItem("formula-mii:sounds", on ? "on" : "off");
  } catch {
    // Not remembered, but still applied.
  }
}
function context() {
  if (!soundOn) return;
  try {
    audio ??= new AudioContext();
  } catch {
    return;
  }
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  return audio.state === "running" ? audio : undefined;
}
function blip(
  from: number,
  to: number,
  duration: number,
  gain: number,
  type: OscillatorType = "sine",
  delay = 0,
) {
  const ctx = context();
  if (!ctx) return;
  const t = ctx.currentTime + delay,
    osc = ctx.createOscillator(),
    amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}
const hoverSound = () => blip(2350, 1900, 0.05, 0.03);
const selectSound = () => {
  blip(880, 1320, 0.07, 0.045, "triangle");
  blip(1320, 1760, 0.09, 0.035, "sine", 0.05);
};

const INTERACTIVE =
  "button:not(:disabled), select:not(:disabled), a[href], input:not(:disabled)";
/** The Wii's soft tick when the pointer reaches a button, and a pop on select. */
export function installMenuSounds() {
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const to = (e.target as Element).closest?.(INTERACTIVE),
      from = (e.relatedTarget as Element | null)?.closest?.(INTERACTIVE);
    if (to && to !== from) hoverSound();
  });
  document.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest?.(INTERACTIVE)) selectSound();
    else context();
  });
}
