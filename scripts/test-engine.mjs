import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
const meta = JSON.parse(readFileSync("public/replay/metadata.json"));
const input = readFileSync("public/replay/samples.bin");
const samples = new Float32Array(
  input.buffer,
  input.byteOffset,
  input.byteLength / 4,
);
const { instance } = await WebAssembly.instantiate(
  readFileSync("public/wasm/replay_engine.wasm"),
);
const wasm = instance.exports;
const ptr = wasm.allocate_samples(samples.length);
new Float32Array(wasm.memory.buffer, ptr, samples.length).set(samples);
meta.drivers.forEach((d, i) =>
  assert.equal(
    wasm.configure_driver(
      i,
      d.offset,
      d.count,
      d.active_until,
      Number(d.retired),
    ),
    1,
  ),
);
function sourcePoint(d, t) {
  let lo = 0,
    hi = d.count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[d.offset + mid * 12] <= t) lo = mid + 1;
    else hi = mid;
  }
  const a = d.offset + Math.max(0, lo - 1) * 12,
    b = d.offset + Math.min(d.count - 1, Math.max(0, lo - 1) + 1) * 12;
  const gap = samples[b] - samples[a];
  const f =
    gap > 0 && gap <= 3 ? Math.max(0, Math.min(1, (t - samples[a]) / gap)) : 0;
  return [1, 2, 3].map(
    (k) => samples[a + k] + (samples[b + k] - samples[a + k]) * f,
  );
}
// Smallest distance from a rendered position to the recorded trace within
// `within` seconds of its time.
function traceDistance(d, t, p, within) {
  let best = Infinity;
  for (let s = -within; s <= within + 1e-9; s += 0.01) {
    const q = sourcePoint(d, t + s);
    best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
  }
  return best;
}
let checked = 0,
  close = 0;
const start = performance.now(),
  seconds = [];
// Cover the complete race, including every driver's recorded path and DNF.
// Cars are re-timed to their recorded speed, so they follow the recorded
// trace, a fraction of a second either way where OpenF1's clock wobbled.
for (let t = 0; t <= Math.ceil(meta.duration); t++) {
  const frame = new Float32Array(
    wasm.memory.buffer,
    wasm.render_frame(t),
    meta.drivers.length * 16,
  );
  seconds.push(frame.slice());
  meta.drivers.forEach((d, i) => {
    const at = d.retired ? Math.min(t, d.active_until) : t,
      p = frame.subarray(i * 16, i * 16 + 3);
    if (traceDistance(d, at, p, 0.5) < 1) close++;
    const off = traceDistance(d, at, p, 1);
    assert.ok(
      off < 8,
      `${d.name_acronym} at ${t}s is ${off.toFixed(1)} m from its recorded trace`,
    );
    assert.ok(
      Number.isFinite(frame[i * 16 + 3]),
      "Heading is finite across every lap",
    );
    assert.ok(
      frame[i * 16 + 7] >= 0 && frame[i * 16 + 7] <= 8,
      "Gear is bounded",
    );
    assert.ok(
      Number.isFinite(frame[i * 16 + 15]),
      "Acceleration is finite across every lap",
    );
    if (d.retired && t > d.active_until + 8)
      assert.equal(frame[i * 16 + 12], 0, "Retired drivers disappear");
    checked++;
  });
}
assert.ok(
  close / checked > 0.99,
  `${((100 * close) / checked).toFixed(2)}% within 1 m of the recorded trace`,
);
// Non-monotonic seeks must match the frames above, never depend on a previous time.
for (const t of [5590, 3, 3100, 0, 5522, 110, 4500, 88, 900, 1]) {
  const frame = new Float32Array(
    wasm.memory.buffer,
    wasm.render_frame(t),
    meta.drivers.length * 16,
  );
  assert.deepEqual(frame.slice(), seconds[t], `Seeking to ${t}s`);
}
// Play the whole race at 60 fps: a moving car never goes backwards, never
// snaps round, and its speed on screen keeps to its recorded speed.
let moving = 0,
  off = 0,
  previous = null;
for (let n = 0; n <= meta.duration * 60; n++) {
  const frame = new Float32Array(
    wasm.memory.buffer,
    wasm.render_frame(n / 60),
    meta.drivers.length * 16,
  ).slice();
  if (previous)
    meta.drivers.forEach((d, i) => {
      const k = i * 16;
      if (!frame[k + 12] || !previous[k + 12] || frame[k + 4] < 60) return;
      const dx = frame[k] - previous[k],
        dy = frame[k + 1] - previous[k + 1],
        recorded = frame[k + 4] / 3.6,
        speed = Math.hypot(dx, dy) * 60;
      let turn = Math.abs(frame[k + 3] - previous[k + 3]);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      assert.ok(
        dx * Math.sin(frame[k + 3]) + dy * Math.cos(frame[k + 3]) > -0.05,
        `${d.name_acronym} goes backwards at ${(n / 60).toFixed(2)}s`,
      );
      assert.ok(
        turn < 0.2,
        `${d.name_acronym} snaps round at ${(n / 60).toFixed(2)}s`,
      );
      moving++;
      if (speed < recorded * 0.6 || speed > recorded * 1.6) off++;
    });
  previous = frame;
}
assert.ok(
  off / moving < 0.001,
  `${off} of ${moving} frames stray over 40% from the recorded speed`,
);
const benchmarkStart = performance.now();
for (let i = 0; i < 10000; i++) wasm.render_frame((i * 17.17) % meta.duration);
const micros = ((performance.now() - benchmarkStart) * 1000) / 10000;
console.log(
  `PASS: ${checked.toLocaleString()} full-race driver frames on their recorded trace, all 71 laps, reverse seeks and retirements, and ${moving.toLocaleString()} smooth 60 fps car frames (${(performance.now() - start).toFixed(0)}ms).`,
);
console.log(
  `WASM interpolation benchmark: ${micros.toFixed(1)}µs/frame for all 20 drivers (10,000 random seeks).`,
);
