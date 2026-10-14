import {
  createIcons,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Maximize2,
  ArrowUpRight,
  Settings2,
  Info,
  Camera,
  Flag,
  MapPin,
  Gauge,
  Keyboard,
  Scan,
  Video,
  UserRound,
  Navigation,
  ChevronLeft,
  ChevronRight,
  Mail,
  Music,
  Volume2,
  TvMinimal,
} from "lucide";
import { Vector3 } from "three";
import { ReplayEngine } from "./engine";
import { EngineSounds } from "./engine-sound";
import { ReplayScene } from "./scene";
import { miiPortraits } from "./mii";
import { installMusic, musicEnabled, onMusicChange, setMusic } from "./music";
import { EMPTY_VENUE, type Venue } from "./venue";
import {
  installSettings,
  onPictureChange,
  pictureSettings,
  type Picture,
} from "./settings";
import { bottomBar, installMenuSounds, setLcd } from "./wii";
import {
  latest,
  clock,
  type Metadata,
  type CameraMode,
  type Driver,
} from "./types";
import "./style.css";
import "./fonts.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
const icon = (name: string, cls = "") =>
  `<i data-lucide="${name}" ${cls ? `class="${cls}"` : ""}></i>`;
const icons = () =>
  createIcons({
    icons: {
      Play,
      Pause,
      SkipBack,
      SkipForward,
      RotateCcw,
      Maximize2,
      ArrowUpRight,
      Settings2,
      Info,
      Camera,
      Flag,
      MapPin,
      Gauge,
      Keyboard,
      Scan,
      Video,
      UserRound,
      Navigation,
      ChevronLeft,
      ChevronRight,
      Mail,
      Music,
      Volume2,
      TvMinimal,
    },
  });
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const brandMii = `<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M17 33c0-11 7-18 15-18s15 7 15 18c0 9-7 17-15 17s-15-8-15-17z" fill="#ffd3ad"/><path d="M15.6 31c-.6-11 6.4-19 16.4-19s17 8 16.4 19c-3-5-7-8-12-8.6-5 4-13 5.6-20.8 8.6z" fill="#382015"/><ellipse cx="26" cy="34" rx="2.2" ry="3" fill="#161210"/><ellipse cx="38" cy="34" rx="2.2" ry="3" fill="#161210"/><path d="M27 43q5 3.4 10 0" fill="none" stroke="#5a2118" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const warning = `<svg class="hs-icon" viewBox="0 0 48 42" aria-hidden="true"><path d="M24 3 45 39H3z" fill="#fff" stroke="#111" stroke-width="4" stroke-linejoin="round"/><path d="M24 15v12" stroke="#111" stroke-width="4.4" stroke-linecap="round"/><circle cx="24" cy="33" r="2.6" fill="#111"/></svg>`;
app.innerHTML = `
 <header class="header">
  <a class="brand" href="/" aria-label="Formula Mii home"><span class="brand-badge">${brandMii}</span><span class="brand-name">Formula Mii</span></a>
  <div class="header-center">A little world. A real race.</div>
  <div class="header-actions"><button class="pill-button" id="about-button">${icon("info")}<span>About this replay</span></button><button class="round-button small" id="music-button" aria-label="Music" aria-pressed="true">${icon("music")}</button><button class="round-button small" id="settings-button" aria-label="Replay settings">${icon("settings-2")}</button></div>
 </header>
 <main>
  <div class="page">
   <section class="race-heading">
    <div><div class="eyebrow"><svg class="flag-brazil" aria-label="Brazil" viewBox="0 0 28 19"><rect width="28" height="19" rx="2" fill="#2f9e58"/><path d="M14 3 24 9.5 14 16 4 9.5z" fill="#f4d430"/><circle cx="14" cy="9.5" r="3.8" fill="#2c5fa8"/><path d="M10.5 8.5q4-.5 7 2" fill="none" stroke="#fff" stroke-width=".8"/></svg> 2025 SEASON <span class="eyebrow-dot">·</span> ROUND 21</div><h1>São Paulo Grand Prix</h1><p>Interlagos, reimagined. Every lap. Every little driver.</p></div>
    <div class="race-stats"><div><strong>09 Nov 2025</strong><span class="stat-label">Race day</span></div><div><strong>4.309 <small>km</small></strong><span class="stat-label">The circuit</span></div><div><strong>71 <small>laps</small></strong><span class="stat-label">The distance</span></div><span class="poc-badge">PLAYABLE REPLAY</span></div>
   </section>
   <div class="replay-shell">
    <aside class="standings tile">
     <div class="panel-title"><h2>Race order</h2><span class="live-tag">REPLAY</span></div>
     <div class="standings-sub"><span id="lap-display">LAP 1 <em>/ 71</em></span><span id="race-state">ON TRACK</span></div>
     <div class="standing-columns"><span>POS</span><span>DRIVER</span><span>GAP</span></div>
     <div id="driver-list" class="driver-list" aria-label="Drivers. Select a driver to follow."></div>
     <div class="standing-footer">${icon("navigation")}<span>Pick a Mii to follow their race</span></div>
    </aside>
    <section class="stage tile" aria-label="3D race player">
     <div id="scene" class="scene"></div>
     <div class="scene-vignette"></div>
     <div class="stage-top"><div class="location-chip">${icon("map-pin")}<span>AUTÓDROMO JOSÉ CARLOS PACE</span></div><button class="round-button small" id="fullscreen" aria-label="Enter fullscreen">${icon("maximize-2")}</button></div>
     <div class="camera-panel">
      <div class="camera-header"><span>${icon("camera")} Camera</span><span class="key-hint">C</span></div>
      <div class="camera-options" role="group" aria-label="Camera perspective">
       <button class="camera-option selected" data-camera="orbit">${icon("scan")}<span>Aerial</span><span class="camera-num">1</span></button>
       <button class="camera-option" data-camera="chase">${icon("navigation")}<span>Chase</span><span class="camera-num">2</span></button>
       <button class="camera-option" data-camera="onboard">${icon("gauge")}<span>Onboard</span><span class="camera-num">3</span></button>
       <button class="camera-option" data-camera="portrait">${icon("user-round")}<span>Driver</span><span class="camera-num">4</span></button>
       <button class="camera-option" data-camera="trackside">${icon("video")}<span>Trackside</span><span class="camera-num">5</span></button>
      </div>
      <div class="station-wrap" hidden><label for="station">Trackside camera</label><select id="station"><option value="-1">Auto director</option></select><span id="station-name"></span></div>
     </div>
     <div class="scene-instruction" id="camera-instruction">${icon("scan")} Drag to explore <span>·</span> <em>Scroll to zoom</em></div>
     <div class="track-sign"><span>Interlagos</span><strong>São Paulo, Brasil</strong></div>
     <div class="focus-card" id="focus-card"><div class="avatar" id="avatar"></div><div class="focus-identity"><span class="focus-label">FOLLOWING <span id="focus-number">#4</span></span><strong id="focus-name">Lando Norris</strong><span id="focus-team">McLaren</span></div><div class="focus-divider"></div><div class="speed"><strong id="speed" class="lcd-value"></strong><span>KM/H</span></div><div class="gear"><span>GEAR</span><strong id="gear">N</strong></div><div class="telemetry-bars"><span>THR <i><b id="throttle"></b></i></span><span>BRK <i><b id="brake"></b></i></span></div><span class="tire-chip" id="tire">M</span></div>
     <div class="minimap-wrap"><canvas id="minimap" width="360" height="240" aria-label="Track map with live driver positions"></canvas><span>TRACK MAP</span></div>
     <div id="status-note" class="status-note" hidden></div>
     <div class="loading" id="loading"><div class="hs"><h2>${warning}<span>WARNING - REAL TELEMETRY</span></h2><p>BEFORE RACING, READ <em>ABOUT THIS REPLAY</em> FOR IMPORTANT INFORMATION ABOUT DATA ACCURACY AND STYLISED SCENERY.</p><p class="hs-small">Every position, speed, gear and pit stint comes from OpenF1.</p><div class="load-track"><span id="load-progress"></span></div><p id="load-label">Loading the São Paulo replay…</p><span class="loading-note">REAL TELEMETRY · 20 DRIVERS · 71 LAPS</span></div></div>
    </section>
   </div>
  </div>
  <section class="transport" aria-label="Replay playback controls">
   <div class="timeline-area">
    <div class="timeline-top"><span class="replay-caption">${icon("flag")} THE FULL RACE <span id="event-caption">Lights out in São Paulo</span></span></div>
    <div class="timeline-wrap"><div class="timeline-events" id="timeline-events"></div><input id="timeline" class="timeline" type="range" min="0" max="5591" value="0" step="0.1" aria-label="Race timeline in seconds" disabled></div>
    <div class="timeline-labels"><span>START</span><span>LAP 18</span><span>HALFWAY</span><span>LAP 54</span><span>FINISH</span></div>
   </div>
   <div class="wii-bar" id="wii-bar">
    <svg class="bar-shape" aria-hidden="true"></svg>
    <button class="round-button big" id="play" aria-label="Play replay" disabled>${icon("play")}</button>
    <div class="bar-tools"><button class="square-button" id="restart" aria-label="Restart replay" disabled>${icon("rotate-ccw")}</button><button class="square-button" id="previous-lap" aria-label="Previous lap" disabled>${icon("skip-back")}</button><button class="square-button" id="next-lap" aria-label="Next lap" disabled>${icon("skip-forward")}</button><select id="rate" class="speed-select" aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1× speed</option><option value="2">2× speed</option><option value="4">4× speed</option><option value="8">8× speed</option><option value="16">16× speed</option><option value="32">32× speed</option><option value="64">64× speed</option></select></div>
    <div class="bar-center"><div class="clock"><span id="current-time" class="lcd-value" role="timer"></span><span class="clock-suffix">of <span id="duration">1:33:11</span></span></div><div class="bar-date" id="race-date">Sun 11/9</div></div>
    <div class="lap-jump"><label for="lap-input">JUMP TO LAP</label><button id="lap-minus" class="wii-arrow left" aria-label="Jump to previous lap"></button><input id="lap-input" type="number" min="1" max="71" value="1" aria-label="Jump to lap number"><button id="lap-plus" class="wii-arrow right" aria-label="Jump to next lap"></button><span>/ 71</span></div>
    <button class="keyboard-help" id="help-button">${icon("keyboard")}<span>Shortcuts</span></button>
    <button class="round-button big" id="messages-button" aria-label="Race control messages">${icon("mail")}<span class="message-count" id="message-count">0</span></button>
   </div>
   <footer><span><span class="footer-dot"></span>Powered by real OpenF1 telemetry <a href="https://github.com/br-g/openf1" target="_blank" rel="noreferrer" aria-label="OpenF1 on GitHub">${icon("arrow-up-right")}</a></span><span>Made small. Played big.<span class="footer-engine">RUST + WASM</span></span></footer>
  </section>
 </main>
 <dialog id="dialog"><div class="dialog-header"><h2 id="dialog-title"></h2></div><div id="dialog-content"></div><div class="dialog-actions"><button class="pill-button wide" id="dialog-close" aria-label="Close dialog">OK</button></div></dialog>
`;
icons();
installMenuSounds();
installMusic();
bottomBar(document.getElementById("wii-bar")!);
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
setLcd(el("current-time"), "00:00", "Elapsed 00:00");
setLcd(el("speed"), "0", "0 km/h");
let meta: Metadata,
  engine: ReplayEngine,
  engineSounds: EngineSounds,
  scene: ReplayScene,
  frame: Float32Array,
  portraits: string[] = [];
let time = 0,
  playing = false,
  rate = 1,
  focus = 0,
  lastTick = performance.now(),
  lastUI = 0,
  mode: CameraMode = "orbit",
  ready = false,
  messagesRead = 0;
const cameraModes: CameraMode[] = [
  "orbit",
  "chase",
  "onboard",
  "portrait",
  "trackside",
];
const rows = new Map<number, HTMLButtonElement>();
let fps = 0,
  frames = 0,
  fpsStart = performance.now();
let dataGap = false;

function showDialog(title: string, html: string, action = "OK") {
  el("dialog-title").textContent = title;
  el("dialog-content").innerHTML = html;
  el("dialog-close").textContent = action;
  el<HTMLDialogElement>("dialog").showModal();
  icons();
}
el("dialog-close").onclick = () => el<HTMLDialogElement>("dialog").close();
el("dialog").onclick = (e) => {
  if (e.target === el("dialog")) el<HTMLDialogElement>("dialog").close();
};
el("about-button").onclick = () =>
  showDialog(
    "A real race in a little world.",
    `<p>Replay the entire <strong>2025 São Paulo Grand Prix</strong> with all 20 drivers. Their paths, speed, gears, laps, positions, and pit stints come from <a href="https://github.com/br-g/openf1" target="_blank" rel="noreferrer">OpenF1</a>.</p><p>Every driver is a Mii built from the Wii's own palettes and face parts, made to look like the real driver, in a racing suit of their team's nearest Mii favourite colour. The track climbs and falls with its recorded elevation. The pit lane, lake, buildings, streets and grandstand sites come from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>, fitted to the telemetry, and the stands are full of Mii fans. Scenery is still stylized; this is a telemetry reconstruction, rather than broadcast footage or a physics simulation.</p><div class="about-grid"><div><strong>20</strong><span>little drivers</span></div><div><strong>71</strong><span>real laps</span></div><div><strong>5</strong><span>camera views</span></div></div><p>OpenF1 locations are sampled at approximately 3.7 Hz. Rust WebAssembly interpolates their positions; longer data gaps are held and then hidden until samples resume. Classification and final crossing times are derived from OpenF1 timing.</p><p>Raw data and the exported replay are archived in a local <strong>Turso</strong> database. The browser loads an immutable bundle, so no database credentials or live API calls are needed.</p><p>The music, “Bossa de Interlagos”, is an original bossa nova written for this replay in the style of the Wii's channel music, and played live in your browser, as are the little engines, which follow each car's real revs and throttle.</p><p class="muted">Map data © OpenStreetMap contributors, available under the ODbL. Independent fan project. Not affiliated with Formula 1 or Nintendo. Latest completed Brazilian race available when acquired on 13 October 2026.</p>`,
  );
el("help-button").onclick = () =>
  showDialog(
    "Take the controls.",
    `<div class="shortcut"><span>Play / pause</span><kbd>Space</kbd></div><div class="shortcut"><span>Seek 10 seconds</span><span><kbd>←</kbd> <kbd>→</kbd></span></div><div class="shortcut"><span>Previous / next lap</span><span><kbd>[</kbd> <kbd>]</kbd></span></div><div class="shortcut"><span>Switch camera</span><kbd>C</kbd></div><div class="shortcut"><span>Choose camera</span><kbd>1 — 5</kbd></div><div class="shortcut"><span>Fullscreen</span><kbd>F</kbd></div><p class="muted">In aerial view, drag to orbit, scroll to zoom, and right-drag to pan. Select any Mii in the race order to follow them.</p>`,
  );
const settings = installSettings({
  icon,
  icons,
  status: () => {
    if (!ready) return "Preparing replay…";
    const picture = pictureSettings(),
      paused = picture.depthOfField && !picture.performance && !scene.blurring;
    return [
      "Rust/WASM ready",
      playing ? `${fps} FPS` : "Paused",
      `${scene.renderer.info.render.calls} draw calls`,
      paused ? "blur paused to keep frames smooth" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  },
  refresh: () => scene?.invalidate(),
});
el("settings-button").onclick = () => settings.open();
function applyPicture(picture: Picture) {
  if (!scene) return;
  scene.setDepthOfField(picture.depthOfField);
  scene.setBlurStrength(picture.blur);
  if ((scene.quality === "low") !== picture.performance)
    scene.setQuality(picture.performance);
}
onPictureChange(applyPicture);
function showMusicState(on: boolean) {
  el("music-button").setAttribute("aria-pressed", String(on));
  el("music-button").setAttribute(
    "aria-label",
    on ? "Turn music off" : "Turn music on",
  );
}
showMusicState(musicEnabled());
onMusicChange(showMusicState);
el("music-button").onclick = () => setMusic(!musicEnabled());
// The Wii Message Board, as race control: every message issued so far.
function raceMessages() {
  return meta.events.filter((e) => e.time >= 0 && e.time <= time);
}
el("messages-button").onclick = () => {
  if (!ready) return;
  const messages = raceMessages();
  messagesRead = messages.length;
  showDialog(
    "Race control",
    messages.length
      ? `<div class="messages">${messages
          .slice()
          .reverse()
          .map(
            (m) =>
              `<div class="message"><span class="message-time">${clock(m.time)}</span><span>${esc(m.message)}</span></div>`,
          )
          .join("")}</div>`
      : `<p>No messages yet. Race control will post here once the lights go out.</p>`,
  );
  updateUI();
};
function togglePlay() {
  if (!ready) return;
  if (time >= meta.duration) seek(0);
  playing = !playing;
  el("play").innerHTML = icon(playing ? "pause" : "play");
  el("play").setAttribute(
    "aria-label",
    playing ? "Pause replay" : "Play replay",
  );
  icons();
}
function seek(t: number) {
  if (!ready) return;
  time = Math.max(0, Math.min(meta.duration, t));
  scene.setFocus(focus);
  frame = engine.frame(time);
  updateUI();
  scene.update(frame, 0);
}
function lapAt(t: number, driver = meta.drivers[focus]) {
  const lap = latest(driver.lap_events, t);
  return lap?.lap_number ?? 1;
}
function jumpLap(lap: number) {
  if (!ready) return;
  const l = Math.max(1, Math.min(meta.total_laps, lap));
  const event =
    meta.drivers[focus].lap_events.find((e) => e.lap_number === l) ??
    meta.drivers
      .find((d) => d.driver_number === 4)
      ?.lap_events.find((e) => e.lap_number === l);
  if (event) seek(event.time);
}
function nextLap() {
  jumpLap(lapAt(time) + 1);
}
function previousLap() {
  const current = latest(meta.drivers[focus].lap_events, time);
  jumpLap(lapAt(time) - (current && time - current.time < 3 ? 1 : 0));
}
el("play").onclick = togglePlay;
el("restart").onclick = () => seek(0);
el("next-lap").onclick = nextLap;
el("previous-lap").onclick = () => {
  if (ready) previousLap();
};
el<HTMLInputElement>("timeline").oninput = (e) =>
  seek(Number((e.target as HTMLInputElement).value));
el<HTMLSelectElement>("rate").onchange = (e) => {
  rate = Number((e.target as HTMLSelectElement).value);
};
el<HTMLInputElement>("lap-input").onchange = (e) =>
  jumpLap(Number((e.target as HTMLInputElement).value));
el("lap-minus").onclick = () => {
  if (ready) jumpLap(lapAt(time) - 1);
};
el("lap-plus").onclick = () => {
  if (ready) nextLap();
};
function setCamera(m: CameraMode) {
  mode = m;
  if (scene && scene.mode !== m) scene.setMode(m);
  document.querySelectorAll<HTMLElement>("[data-camera]").forEach((b) => {
    const selected = b.dataset.camera === m;
    b.classList.toggle("selected", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
  el("camera-instruction").innerHTML =
    m === "orbit"
      ? `${icon("scan")} Drag to explore <span>·</span> <em>Scroll to zoom</em>`
      : m === "trackside"
        ? `${icon("video")} Trackside cameras follow your selected driver`
        : m === "portrait"
          ? `${icon("user-round")} Say hello to your Mii`
          : `${icon("navigation")} Following ${esc(meta?.drivers[focus].name_acronym ?? "driver")} <span>·</span> <em>Pick another Mii in the race order</em>`;
  document.querySelector<HTMLElement>(".station-wrap")!.hidden =
    m !== "trackside";
  icons();
}
document
  .querySelectorAll<HTMLButtonElement>("[data-camera]")
  .forEach(
    (b) => (b.onclick = () => setCamera(b.dataset.camera as CameraMode)),
  );
el<HTMLSelectElement>("station").onchange = (e) => {
  scene.station = Number((e.target as HTMLSelectElement).value);
  scene.setMode("trackside");
};
async function fullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.querySelector("main")?.requestFullscreen();
}
el("fullscreen").onclick = () =>
  void fullscreen().catch(() =>
    showDialog(
      "Fullscreen unavailable",
      "<p>Your browser does not allow fullscreen here. You can still use every replay control in this window.</p>",
    ),
  );
window.addEventListener("keydown", (e) => {
  if (
    !ready ||
    document.querySelector("dialog[open]") ||
    ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
      (e.target as HTMLElement).tagName,
    ) ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey
  )
    return;
  const key = e.key.toLowerCase();
  if (
    [
      " ",
      "arrowleft",
      "arrowright",
      "[",
      "]",
      "c",
      "f",
      "1",
      "2",
      "3",
      "4",
      "5",
    ].includes(key)
  )
    e.preventDefault();
  if (key === " ") togglePlay();
  else if (key === "arrowleft") seek(time - 10);
  else if (key === "arrowright") seek(time + 10);
  else if (key === "[") jumpLap(lapAt(time) - 1);
  else if (key === "]") nextLap();
  else if (key === "c")
    setCamera(
      cameraModes[(cameraModes.indexOf(mode) + 1) % cameraModes.length],
    );
  else if (key === "f") void fullscreen().catch(() => {});
  else if (/^[1-5]$/.test(key)) setCamera(cameraModes[Number(key) - 1]);
});

function selectDriver(index: number) {
  focus = index;
  scene.setFocus(index);
  const d = meta.drivers[index];
  el("focus-name").textContent = `${d.first_name} ${d.last_name}`;
  el("focus-team").textContent = d.team_name;
  el("focus-number").textContent = `#${d.driver_number}`;
  el("avatar").innerHTML = portraits[index]
    ? `<img src="${portraits[index]}" alt="${esc(d.full_name)}'s Mii">`
    : "";
  el("focus-card").style.setProperty("--team", `#${d.team_colour}`);
  rows.forEach((row, i) => {
    row.classList.toggle("following", i === index);
    row.setAttribute("aria-pressed", String(i === index));
  });
  setCamera(mode);
  updateUI();
}
function gapLabel(d: Driver, position: number) {
  if (d.retired && time > d.active_until) return "OUT";
  if (position === 1) return "LEADER";
  const gap = latest(d.intervals ?? [], time)?.gap_to_leader;
  if (typeof gap === "number") return `+${gap.toFixed(1)}`;
  if (typeof gap === "string") return gap.replace(" LAP", "L");
  return "—";
}
function updateUI() {
  if (!ready) return;
  const t = el<HTMLInputElement>("timeline");
  t.value = String(time);
  t.style.setProperty("--progress", `${(time / meta.duration) * 100}%`);
  const elapsed = clock(time);
  setLcd(el("current-time"), elapsed, `Elapsed ${elapsed}`);
  const lead =
    meta.drivers.find((d) => latest(d.position_events, time)?.position === 1) ??
    meta.drivers[0];
  const leaderLap = lapAt(time, lead);
  el("lap-display").innerHTML = `LAP ${Math.min(leaderLap, 71)} <em>/ 71</em>`;
  if (document.activeElement !== el("lap-input"))
    el<HTMLInputElement>("lap-input").value = String(lapAt(time));
  const ranking = meta.drivers
    .map((d, i) => ({
      d,
      i,
      p: latest(d.position_events, time)?.position ?? i + 1,
    }))
    .sort((a, b) => a.p - b.p || a.i - b.i);
  ranking.forEach(({ d, i, p }, order) => {
    const row = rows.get(i)!;
    row.style.order = String(order);
    row.querySelector(".driver-pos")!.textContent = String(p).padStart(2, "0");
    row.querySelector(".driver-gap")!.textContent = gapLabel(d, p);
    row.classList.toggle("retired", d.retired && time > d.active_until);
  });
  frame = engine.frame(time);
  const k = focus * 16;
  const speed = frame[k + 13] > 3 ? "—" : String(Math.round(frame[k + 4]));
  setLcd(el("speed"), speed, speed === "—" ? "No speed data" : `${speed} km/h`);
  el("gear").textContent =
    frame[k + 7] > 0 ? String(Math.round(frame[k + 7])) : "N";
  el("throttle").style.width = `${frame[k + 5]}%`;
  el("brake").style.width = `${frame[k + 6] ? 100 : 0}%`;
  const d = meta.drivers[focus],
    lap = lapAt(time, d);
  const stint = d.stints?.find((s) => s.lap_start <= lap && s.lap_end >= lap);
  const compound = stint?.compound ?? "";
  const tire = el("tire");
  tire.textContent = compound[0] ?? "—";
  tire.setAttribute("title", compound || "No tyre data");
  tire.style.color =
    compound === "SOFT"
      ? "#e2382c"
      : compound === "HARD"
        ? "#8b8b8b"
        : "#e0ac10";
  const events = raceMessages();
  const event = events[events.length - 1];
  el("event-caption").textContent = event
    ? event.message
    : time < 3
      ? "Lights out in São Paulo"
      : "Racing at Interlagos";
  messagesRead = Math.min(messagesRead, events.length);
  const unread = events.length - messagesRead;
  el("message-count").textContent = String(unread);
  el("message-count").hidden = unread === 0;
  el("messages-button").setAttribute(
    "aria-label",
    unread ? `Race control messages, ${unread} new` : "Race control messages",
  );
  const lastSafety = events
    .filter(
      (e) => e.category === "SafetyCar" || /SAFETY CAR|VSC/.test(e.message),
    )
    .at(-1);
  const safety =
    lastSafety &&
    !/IN THIS LAP|ENDING|ENDED|WITHDRAWN/.test(lastSafety.message) &&
    /DEPLOYED/.test(lastSafety.message);
  el("race-state").textContent =
    time >= meta.duration ? "FINISHED" : safety ? "SAFETY CAR" : "ON TRACK";
  el("race-state").classList.toggle("yellow", !!safety);
  const out = d.retired && time > d.active_until;
  dataGap = frame[k + 13] > 3;
  const note = el("status-note");
  note.hidden = !(out || dataGap);
  note.textContent = out
    ? `${d.name_acronym} retired · select another Mii to follow`
    : dataGap
      ? `${d.name_acronym} · telemetry gap (${Math.round(frame[k + 13])}s)`
      : "";
  drawMap(ranking);
  (window as unknown as { __replay: unknown }).__replay = {
    time,
    playing,
    focus,
    mode,
    driver: d.name_acronym,
    lap,
    ready,
    fps,
    wasm: true,
    speed: frame[k + 4],
    carPosition: [frame[k], frame[k + 1]],
    visible: scene.cars.filter((c) => c.visible).length,
    portraits: portraits.filter(Boolean).length,
    spectators: scene.spectators,
    depthOfField: scene.blurring,
    engines: engineSounds.heard,
  };
}

let mapPoints: { x: number; y: number }[] = [],
  mapScale = 1,
  mapMinX = 0,
  mapMaxY = 0,
  mapOffsetX = 0,
  mapOffsetY = 0;
function prepareMap() {
  const points = meta.track.points;
  mapMinX = Math.min(...points.map((p) => p[0]));
  mapMaxY = Math.max(...points.map((p) => p[1]));
  const w = Math.max(...points.map((p) => p[0])) - mapMinX,
    h = mapMaxY - Math.min(...points.map((p) => p[1]));
  mapScale = Math.min(310 / w, 175 / h);
  mapOffsetX = (360 - w * mapScale) / 2;
  mapOffsetY = (220 - h * mapScale) / 2;
  mapPoints = points.map((p) => ({
    x: mapOffsetX + (p[0] - mapMinX) * mapScale,
    y: mapOffsetY + (mapMaxY - p[1]) * mapScale,
  }));
}
function drawMap(ranking: { d: Driver; i: number; p: number }[]) {
  const ctx = el<HTMLCanvasElement>("minimap").getContext("2d")!;
  ctx.clearRect(0, 0, 360, 240);
  ctx.beginPath();
  mapPoints.forEach((p, i) =>
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
  );
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#b9b9b9";
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.stroke();
  ranking.forEach(({ d, i }) => {
    const k = i * 16;
    if (!frame[k + 12]) return;
    const x = mapOffsetX + (frame[k] - mapMinX) * mapScale,
      y = mapOffsetY + (mapMaxY - frame[k + 1]) * mapScale;
    ctx.beginPath();
    ctx.arc(x, y, i === focus ? 8 : 5, 0, Math.PI * 2);
    ctx.fillStyle = `#${d.team_colour}`;
    ctx.fill();
    ctx.lineWidth = i === focus ? 3.5 : 1.5;
    ctx.strokeStyle = i === focus ? "#34beed" : "#ffffff";
    ctx.stroke();
  });
}

/** Fetches a replay JSON asset, preferring its gzip twin when the browser can inflate it. */
async function loadJson<T>(name: string): Promise<T> {
  const compressed = "DecompressionStream" in window;
  const response = await fetch(`/replay/${name}${compressed ? ".gz" : ""}`);
  if (!response.ok)
    throw new Error(`The race bundle is not available (${name}).`);
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (compressed && bytes[0] === 0x1f && bytes[1] === 0x8b)
    bytes = new Uint8Array(
      await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function init() {
  try {
    // The circuit's surroundings are a nice-to-have: replay without them if missing.
    const venue = loadJson<Venue>("venue.json").catch((error) => {
      console.warn("Venue unavailable", error);
      return EMPTY_VENUE;
    });
    meta = await loadJson<Metadata>("metadata.json");
    el("duration").textContent = clock(meta.duration);
    // The Wii Menu shows the date as "Fri 6/7"; this is race day.
    const raceDay = new Date(meta.session.date_start);
    el("race-date").textContent =
      `${raceDay.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${raceDay.getUTCMonth() + 1}/${raceDay.getUTCDate()}`;
    document.querySelectorAll(".timeline-labels span").forEach((label, i) => {
      if (i > 0 && i < 4) label.textContent = clock((meta.duration * i) / 4);
    });
    el<HTMLInputElement>("timeline").max = String(meta.duration);
    engine = await ReplayEngine.load(meta, (f) => {
      el("load-progress").style.width = `${f * 100}%`;
      el("load-label").textContent =
        `Loading real race telemetry · ${Math.round(f * 100)}%`;
    });
    el("load-label").textContent = "Building your little Interlagos…";
    await document.fonts
      .load('500 25px "Zen Kaku Gothic New"')
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30));
    scene = new ReplayScene(el("scene"), meta, await venue);
    applyPicture(pictureSettings());
    portraits = miiPortraits(scene.miis, scene.atlas);
    engineSounds = new EngineSounds(meta.drivers.length);
    scene.onStationChange = (name) => {
      el("station-name").textContent = name;
    };
    scene.stationNames.forEach((name, i) =>
      el<HTMLSelectElement>("station").add(new Option(name, String(i))),
    );
    meta.drivers.forEach((d, i) => {
      const row = document.createElement("button");
      row.className = "driver-row";
      row.dataset.driver = String(d.driver_number);
      row.setAttribute("aria-label", `Follow ${d.full_name}`);
      row.innerHTML = `<span class="driver-pos">${String(i + 1).padStart(2, "0")}</span><span class="team-line" style="background:#${d.team_colour}"></span>${portraits[i] ? `<img class="driver-mii" src="${portraits[i]}" alt="" width="40" height="40">` : ""}<span class="driver-info"><strong>${esc(d.name_acronym)}</strong><small>${esc(d.team_name)}</small></span><span class="driver-gap">—</span>`;
      row.onclick = () => selectDriver(i);
      rows.set(i, row);
      el("driver-list").append(row);
    });
    const keyEvents = meta.events.filter(
      (e) =>
        e.time >= 0 &&
        e.time <= meta.duration &&
        /SAFETY CAR DEPLOYED|VIRTUAL SAFETY CAR DEPLOYED|CHEQUERED|RED FLAG/.test(
          e.message,
        ),
    );
    keyEvents.forEach((e) => {
      const b = document.createElement("button");
      b.className = "event-marker";
      b.style.left = `${(e.time / meta.duration) * 100}%`;
      b.title = `${clock(e.time)} · ${e.message}`;
      b.setAttribute("aria-label", `Jump to ${e.message} at ${clock(e.time)}`);
      b.onclick = () => seek(e.time);
      el("timeline-events").append(b);
    });
    prepareMap();
    ready = true;
    el("loading").classList.add("loaded");
    setTimeout(() => el("loading").remove(), 600);
    document
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        ".transport [disabled]",
      )
      .forEach((b) => (b.disabled = false));
    focus = Math.max(
      0,
      meta.drivers.findIndex((d) => d.driver_number === 4),
    );
    selectDriver(focus);
    setCamera("orbit");
    frame = engine.frame(0);
    scene.update(frame, 0);
    icons();
    let renderedTime = -1;
    const listener = new Vector3();
    const render = (now: number) => {
      const delta = Math.min((now - lastTick) / 1000, 1);
      lastTick = now;
      const before = time;
      if (playing) {
        time = Math.min(meta.duration, time + delta * rate);
        if (time >= meta.duration) {
          playing = false;
          el("play").innerHTML = icon("play");
          el("play").setAttribute("aria-label", "Play replay");
          icons();
        }
      }
      frame = engine.frame(time);
      if (scene.update(frame, delta, time !== renderedTime)) {
        frames++;
        settings.preview(scene.renderer.domElement);
      }
      renderedTime = time;
      engineSounds.update(
        frame,
        scene.cars,
        scene.camera,
        scene.listener(listener),
        playing ? time - before : 0,
        rate,
      );
      if (now - fpsStart > 1000) {
        fps = Math.round((frames * 1000) / (now - fpsStart));
        if (playing) scene.adaptPerformance(fps);
        frames = 0;
        fpsStart = now;
      }
      if (now - lastUI > 100) {
        updateUI();
        lastUI = now;
      }
      requestAnimationFrame(render);
    };
    lastTick = performance.now();
    requestAnimationFrame(render);
    document.addEventListener("visibilitychange", () => {
      lastTick = performance.now();
    });
  } catch (error) {
    el("load-label").textContent =
      error instanceof Error
        ? error.message
        : "The replay could not be loaded.";
    el("loading")
      .querySelector(".hs")
      ?.insertAdjacentHTML(
        "beforeend",
        `<button class="pill-button retry-button" onclick="location.reload()">Try again</button>`,
      );
    console.error(error);
  }
}
void init();
