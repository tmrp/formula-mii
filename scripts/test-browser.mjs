import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const meta = JSON.parse(readFileSync("public/replay/metadata.json"));
const url = process.env.TEST_URL || "http://127.0.0.1:4173";
const server = process.env.TEST_URL
  ? null
  : spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
      ],
      { stdio: "pipe" },
    );
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
    if (i === 59) throw Error("Preview server did not start");
  }
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__replay?.ready, undefined, {
    timeout: 60000,
  });
  assert.equal(await page.locator(".driver-row").count(), 20);
  // The OpenStreetMap venue loaded, so the grandstands are full of Miis.
  assert.ok((await page.evaluate(() => window.__replay.spectators)) > 1000);
  // The scene and the track map; the settings preview is not counted.
  assert.equal(await page.locator("canvas:not(#settings-preview)").count(), 2);
  // Wii Sports depth of field is on by default.
  assert.equal(await page.evaluate(() => window.__replay.depthOfField), true);
  const state = () => page.evaluate(() => window.__replay);
  const seek = async (t) => {
    await page.locator("#timeline").evaluate((e, value) => {
      e.value = String(value);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }, t);
    await page.waitForFunction(
      (value) => Math.abs(window.__replay.time - value) < 0.2,
      t,
    );
  };
  assert.equal((await state()).playing, false);
  await page.locator("#play").click();
  // The cars' engines can be heard while the race plays.
  await page.waitForFunction(() => window.__replay.engines > 0);
  await page.waitForTimeout(2200);
  assert.ok((await state()).time > 1);
  await page.locator("#play").click();
  const paused = (await state()).time;
  await page.waitForTimeout(500);
  assert.ok(Math.abs((await state()).time - paused) < 0.2);
  // ...and fall silent when it pauses.
  assert.equal((await state()).engines, 0);
  for (const mode of ["orbit", "chase", "onboard", "portrait", "trackside"]) {
    await page.locator(`[data-camera="${mode}"]`).click();
    assert.equal(
      await page
        .locator(`[data-camera="${mode}"]`)
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.waitForFunction((m) => window.__replay.mode === m, mode);
    assert.equal((await state()).mode, mode);
  }
  assert.equal(await page.locator("#station option").count(), 9);
  await page.locator("#station").selectOption("3");
  await seek(1400);
  assert.match(await page.locator("#station-name").innerText(), /Ferradura/);
  await page.locator("#station").selectOption("-1");
  await seek(400);
  const station1 = await page.locator("#station-name").innerText();
  await seek(440);
  const station2 = await page.locator("#station-name").innerText();
  assert.ok(station1 && station2);
  for (const d of meta.drivers) {
    await page.locator(`[data-driver="${d.driver_number}"]`).click();
    assert.equal((await state()).driver, d.name_acronym);
  }
  await page.locator('[data-driver="4"]').click();
  await page.locator('[data-camera="orbit"]').click();
  for (const lap of [1, 5, 18, 36, 54, 71]) {
    await page.locator("#lap-input").fill(String(lap));
    await page.locator("#lap-input").dispatchEvent("change");
    assert.equal((await state()).lap, lap);
  }
  await seek(3100);
  await page.locator('[data-driver="44"]').click();
  assert.match(await page.locator("#status-note").innerText(), /retired/);
  assert.match(
    await page.locator('[data-driver="44"] .driver-gap').innerText(),
    /OUT/,
  );
  await seek(100);
  assert.equal(await page.locator("#status-note").isVisible(), false);
  await page.locator('[data-driver="4"]').click();
  await seek(meta.duration - 0.6);
  await page.locator("#rate").selectOption("64");
  await page.locator("#play").click();
  await page.waitForFunction(
    () => window.__replay.time > 5591 && !window.__replay.playing,
    undefined,
    { timeout: 10000 },
  );
  assert.equal(await page.locator("#race-state").innerText(), "FINISHED");
  await page.locator("#play").click();
  await page.waitForTimeout(200);
  assert.ok((await state()).time < 100);
  await page.locator("#play").click();
  // Music toggles off and back on from the header.
  const music = page.locator("#music-button");
  assert.equal(await music.getAttribute("aria-pressed"), "true");
  await music.click();
  assert.equal(await music.getAttribute("aria-pressed"), "false");
  await music.click();
  assert.equal(await music.getAttribute("aria-pressed"), "true");
  // The Settings modal: Sound and Picture pages that apply at once.
  const settings = page.locator("#settings");
  const choose = (group, value) =>
    settings
      .getByRole("radiogroup", { name: group })
      .getByRole("radio", { name: value })
      .check();
  await page.locator("#settings-button").click();
  assert.equal(await settings.getAttribute("open"), "");
  await choose("Music", "Off");
  assert.equal(await music.getAttribute("aria-pressed"), "false");
  await choose("Music", "On");
  assert.equal(await music.getAttribute("aria-pressed"), "true");
  const volume = settings.locator("#music-volume");
  assert.equal(await volume.inputValue(), "6");
  await settings.getByRole("button", { name: "Music quieter" }).click();
  assert.equal(await volume.inputValue(), "5");
  await settings.locator("#music-volume-meter .meter-track").click({
    position: { x: 190, y: 12 },
  });
  assert.equal(await volume.inputValue(), "10");
  const engineVolume = settings.locator("#engine-volume");
  await choose("Engine sounds", "Off");
  assert.equal(await engineVolume.isDisabled(), true);
  await choose("Engine sounds", "On");
  assert.equal(await engineVolume.inputValue(), "6");
  await settings.getByRole("button", { name: "Engines louder" }).click();
  assert.equal(await engineVolume.inputValue(), "7");
  await settings.getByRole("tab", { name: "Picture" }).click();
  assert.equal(
    await settings
      .getByRole("tab", { name: "Picture" })
      .getAttribute("aria-selected"),
    "true",
  );
  await choose("Depth of field", "Off");
  assert.equal(await settings.locator("#blur").isDisabled(), true);
  await page.keyboard.press("Escape");
  await seek(20);
  assert.equal((await state()).depthOfField, false);
  await page.locator("#settings-button").click();
  await choose("Depth of field", "On");
  const blur = settings.locator("#blur");
  assert.equal(await blur.inputValue(), "3");
  await settings.getByRole("button", { name: "Stronger" }).click();
  assert.equal(await blur.inputValue(), "4");
  await blur.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await blur.inputValue(), "3");
  // The live preview copies the race into the modal.
  await page.waitForFunction(() => {
    const c = document.querySelector("#settings-preview");
    const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    return pixels.data.some((v, i) => i % 4 === 3 && v > 0);
  });
  await choose("Performance mode", "On");
  await settings.locator("#settings-close").click();
  assert.equal(await settings.getAttribute("open"), null);
  await page.locator("#help-button").click();
  assert.match(await page.locator("#dialog").innerText(), /Space/);
  await page.locator("#dialog-close").click();
  await page.locator("h1").click();
  await page.keyboard.press("2");
  await page.waitForFunction(() => window.__replay.mode === "chase");
  assert.equal((await state()).mode, "chase");
  await page.keyboard.press("ArrowRight");
  assert.ok((await state()).time >= 10);
  // Performance mode drops the blur.
  assert.equal((await state()).depthOfField, false);
  await page.keyboard.press("c");
  await page.waitForFunction(() => window.__replay.mode === "onboard");
  assert.equal((await state()).mode, "onboard");
  await page.locator("#fullscreen").click();
  assert.ok(await page.evaluate(() => !!document.fullscreenElement));
  assert.equal(await page.locator("#timeline").isVisible(), true);
  await page.evaluate(() => document.exitFullscreen());
  await page.locator('[data-camera="orbit"]').click();
  await seek(2800);
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/replay-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator('[data-camera="portrait"]').click();
  await page.screenshot({
    path: "artifacts/replay-mobile.png",
    fullPage: true,
  });
  await page.locator('[data-driver="1"]').click();
  assert.equal((await state()).driver, "VER");
  await page.locator("#play").click();
  await page.waitForTimeout(500);
  await page.locator("#play").click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Chromium desktop/mobile; venue and crowds, full race seek, all 20 drivers, all five views, eight trackside stations, play/pause, race end/restart, lap jumps, retirements, speed, shortcuts, fullscreen, music, engine sounds, depth of field and settings.",
  );
} finally {
  await browser?.close();
  server?.kill();
}
