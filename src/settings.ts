import {
  musicEnabled,
  musicVolume,
  onMusicChange,
  setMusic,
  setMusicVolume,
} from "./music";
import { setSounds, soundsEnabled } from "./wii";

/** How the race looks; remembered between visits. */
export interface Picture {
  depthOfField: boolean;
  /** Blur strength, 1 (softest) to BLUR_LEVELS. */
  blur: number;
  performance: boolean;
}
export const BLUR_LEVELS = 5;
const PICTURE_KEY = "formula-mii:picture";
const VOLUME_STEPS = 10;

function loadPicture(): Picture {
  let saved: Partial<Picture> = {};
  try {
    saved = JSON.parse(localStorage.getItem(PICTURE_KEY) ?? "{}");
  } catch {
    // Unavailable or unreadable storage: use the defaults.
  }
  const blur = Number(saved.blur);
  return {
    depthOfField: saved.depthOfField !== false,
    blur: Number.isInteger(blur) && blur >= 1 && blur <= BLUR_LEVELS ? blur : 3,
    performance: saved.performance === true,
  };
}
let picture = loadPicture();
const pictureListeners = new Set<(picture: Picture) => void>();
export const pictureSettings = (): Readonly<Picture> => picture;
export function onPictureChange(listener: (picture: Picture) => void) {
  pictureListeners.add(listener);
}
export function setPicture(change: Partial<Picture>) {
  picture = { ...picture, ...change };
  try {
    localStorage.setItem(PICTURE_KEY, JSON.stringify(picture));
  } catch {
    // Not remembered, but still applied.
  }
  pictureListeners.forEach((l) => l(picture));
}

// An On / Off pair of Wii buttons.
const choice = (id: string, label: string, note: string) =>
  `<div class="setting-row"><span><strong id="${id}-label">${label}</strong><small id="${id}-note">${note}</small></span><div class="wii-choice" role="radiogroup" aria-labelledby="${id}-label" aria-describedby="${id}-note"><label><input type="radio" name="${id}" value="on"><span>On</span></label><label><input type="radio" name="${id}" value="off"><span>Off</span></label></div></div>`;

// A row of lights between − and +, like the Wii Remote speaker volume.
const meter = (
  id: string,
  label: string,
  min: number,
  max: number,
  less: string,
  more: string,
) =>
  `<div class="setting-row"><span><strong id="${id}-label">${label}</strong></span><div class="wii-meter" id="${id}-meter"><button type="button" class="meter-button" data-step="-1" aria-label="${less}" tabindex="-1">−</button><div class="meter-track"><input id="${id}" type="range" min="${min}" max="${max}" step="1" aria-labelledby="${id}-label"><span class="meter-bars" aria-hidden="true">${"<i></i>".repeat(max)}</span></div><button type="button" class="meter-button" data-step="1" aria-label="${more}" tabindex="-1">+</button></div></div>`;

const TABS = ["sound", "picture"] as const;
type Tab = (typeof TABS)[number];

export interface SettingsOptions {
  /** Markup for a lucide icon, and a call to draw any new ones. */
  icon: (name: string) => string;
  icons: () => void;
  /** The engine status line: frame rate and draw calls. */
  status: () => string;
  /** Ask the scene for a fresh frame, for the preview. */
  refresh: () => void;
}

/**
 * The Settings modal, in the manner of Wii Settings: a Sound page and a
 * Picture page, On / Off buttons and rows of lights. Every change applies at
 * once, and the Picture page shows a live preview of the race behind it.
 */
export function installSettings(options: SettingsOptions) {
  const dialog = document.createElement("dialog");
  dialog.id = "settings";
  dialog.className = "settings-dialog";
  dialog.setAttribute("aria-labelledby", "settings-title");
  dialog.innerHTML = `<div class="dialog-header"><h2 id="settings-title">Settings</h2><div class="settings-tabs" role="tablist" aria-label="Settings pages"><button type="button" class="settings-tab" role="tab" id="settings-tab-sound" aria-controls="settings-sound">${options.icon("volume-2")}<span>Sound</span></button><button type="button" class="settings-tab" role="tab" id="settings-tab-picture" aria-controls="settings-picture">${options.icon("tv-minimal")}<span>Picture</span></button></div></div><div class="settings-body"><section role="tabpanel" id="settings-sound" aria-labelledby="settings-tab-sound">${choice("music", "Music", "“Bossa de Interlagos”, an original bossa nova in Wii style")}${meter("music-volume", "Music volume", 0, VOLUME_STEPS, "Quieter", "Louder")}${choice("sounds", "Menu sounds", "The little tick and pop of the Wii Menu")}</section><section role="tabpanel" id="settings-picture" aria-labelledby="settings-tab-picture"><div class="settings-preview"><canvas id="settings-preview" aria-hidden="true"></canvas><span>Live preview</span></div>${choice("dof", "Depth of field", "")}${meter("blur", "Blur strength", 1, BLUR_LEVELS, "Softer", "Stronger")}${choice("performance", "Performance mode", "Lower resolution, no shadows or blur, for phones and integrated graphics")}<div class="engine-status"><span class="green-dot"></span><span id="settings-status"></span></div></section></div><div class="dialog-actions"><button class="pill-button wide" id="settings-close">OK</button></div>`;
  document.body.append(dialog);
  options.icons();
  const $ = <T extends HTMLElement>(selector: string) =>
    dialog.querySelector(selector) as T;
  const preview = $<HTMLCanvasElement>("#settings-preview");
  let tab: Tab = "sound",
    timer: number | undefined;

  const setChoice = (name: string, on: boolean) => {
    $<HTMLInputElement>(
      `input[name="${name}"][value="${on ? "on" : "off"}"]`,
    ).checked = true;
  };
  const setMeter = (id: string, value: number, disabled = false) => {
    const input = $<HTMLInputElement>(`#${id}`);
    input.value = String(value);
    input.disabled = disabled;
    input.setAttribute("aria-valuetext", `${value} of ${input.max}`);
    const box = $(`#${id}-meter`);
    box.classList.toggle("disabled", disabled);
    box
      .querySelectorAll<HTMLButtonElement>(".meter-button")
      .forEach((b) => (b.disabled = disabled));
    box
      .querySelectorAll("i")
      .forEach((bar, i) => bar.classList.toggle("on", i < value));
  };
  const sync = () => {
    setChoice("music", musicEnabled());
    setMeter("music-volume", Math.round(musicVolume() * VOLUME_STEPS));
    setChoice("sounds", soundsEnabled());
    setChoice("dof", picture.depthOfField);
    setChoice("performance", picture.performance);
    setMeter(
      "blur",
      picture.blur,
      !picture.depthOfField || picture.performance,
    );
    $("#dof-note").textContent = picture.performance
      ? "Paused while Performance mode is on"
      : "Softly blur the scenery behind the action, like Wii Sports";
  };
  const showStatus = () =>
    ($("#settings-status").textContent = options.status());

  const choose = (name: string, on: boolean) => {
    if (name === "music") setMusic(on);
    else if (name === "sounds") setSounds(on);
    else if (name === "dof") setPicture({ depthOfField: on });
    else if (name === "performance") setPicture({ performance: on });
  };
  dialog.querySelectorAll<HTMLInputElement>(".wii-choice input").forEach(
    (input) =>
      (input.onchange = () => {
        if (input.checked) choose(input.name, input.value === "on");
      }),
  );
  const adjust = (id: string, value: number) => {
    if (id === "music-volume") setMusicVolume(value / VOLUME_STEPS);
    else setPicture({ blur: value });
    sync();
  };
  dialog.querySelectorAll<HTMLElement>(".wii-meter").forEach((box) => {
    const input = box.querySelector("input")!,
      track = box.querySelector<HTMLElement>(".meter-track")!,
      min = Number(input.min),
      max = Number(input.max);
    const set = (value: number) => {
      value = Math.min(max, Math.max(min, value));
      if (input.disabled || value === Number(input.value)) return;
      adjust(input.id, value);
    };
    input.oninput = () => adjust(input.id, Number(input.value));
    box
      .querySelectorAll<HTMLButtonElement>(".meter-button")
      .forEach(
        (button) =>
          (button.onclick = () =>
            set(Number(input.value) + Number(button.dataset.step))),
      );
    // Tap or drag along the lights; each light is one step.
    const fromPointer = (e: PointerEvent) => {
      const box = track.getBoundingClientRect();
      set(Math.ceil(((e.clientX - box.left) / box.width) * max));
    };
    track.onpointerdown = (e) => {
      if (input.disabled) return;
      track.setPointerCapture(e.pointerId);
      input.focus({ preventScroll: true });
      fromPointer(e);
    };
    track.onpointermove = (e) => {
      if (track.hasPointerCapture(e.pointerId)) fromPointer(e);
    };
  });

  const showTab = (next: Tab, focus = false) => {
    tab = next;
    for (const name of TABS) {
      const button = $<HTMLButtonElement>(`#settings-tab-${name}`),
        page = $(`#settings-${name}`),
        active = name === next;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      page.hidden = !active;
      if (active && focus) button.focus();
    }
    if (next === "picture") options.refresh();
  };
  TABS.forEach((name, i) => {
    const button = $<HTMLButtonElement>(`#settings-tab-${name}`);
    button.onclick = () => showTab(name);
    button.onkeydown = (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      showTab(TABS[(i + step + TABS.length) % TABS.length], true);
    };
  });
  onMusicChange(sync);
  onPictureChange(sync);
  $("#settings-close").onclick = () => dialog.close();
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.close();
  };
  dialog.onclose = () => {
    window.clearInterval(timer);
    timer = undefined;
  };

  return {
    open() {
      sync();
      showTab(tab);
      showStatus();
      dialog.showModal();
      timer = window.setInterval(showStatus, 500);
    },
    /** Copy a just-rendered frame into the preview, while it is showing. */
    preview(source: HTMLCanvasElement) {
      if (!dialog.open || tab !== "picture" || !source.width) return;
      const { width, height } = preview.getBoundingClientRect(),
        scale = Math.min(devicePixelRatio, 2),
        w = Math.round(width * scale),
        h = Math.round(height * scale);
      if (!w || !h) return;
      if (preview.width !== w || preview.height !== h) {
        preview.width = w;
        preview.height = h;
      }
      // Fill the frame from the middle of the scene.
      const fit = Math.min(source.width / w, source.height / h),
        sw = w * fit,
        sh = h * fit;
      preview
        .getContext("2d")
        ?.drawImage(
          source,
          (source.width - sw) / 2,
          (source.height - sh) / 2,
          sw,
          sh,
          0,
          0,
          w,
          h,
        );
    },
  };
}
