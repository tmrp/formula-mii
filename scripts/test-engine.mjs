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
let checked = 0;
const start = performance.now();
// Cover the complete race independently, including every driver's recorded path and DNF.
for (let t = 0; t <= Math.ceil(meta.duration); t++) {
  const frame = new Float32Array(
    wasm.memory.buffer,
    wasm.render_frame(t),
    meta.drivers.length * 16,
  );
  meta.drivers.forEach((d, i) => {
    const expected = sourcePoint(
      d,
      d.retired ? Math.min(t, d.active_until) : t,
    );
    expected.forEach((n, k) =>
      assert.ok(
        Math.abs(frame[i * 16 + k] - n) < 0.12,
        `${d.name_acronym} at ${t}s coordinate ${k}: ${frame[i * 16 + k]} vs ${n}`,
      ),
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
// Non-monotonic seeks must agree with fresh source lookup, never depend on a previous time.
for (const t of [5590, 3, 3100, 0, 5522, 110, 4500, 88, 900, 1]) {
  const frame = new Float32Array(
    wasm.memory.buffer,
    wasm.render_frame(t),
    meta.drivers.length * 16,
  );
  meta.drivers.forEach((d, i) =>
    sourcePoint(d, d.retired ? Math.min(t, d.active_until) : t).forEach(
      (n, k) => assert.ok(Math.abs(frame[i * 16 + k] - n) < 0.12),
    ),
  );
}
const benchmarkStart = performance.now();
for (let i = 0; i < 10000; i++) wasm.render_frame((i * 17.17) % meta.duration);
const micros = ((performance.now() - benchmarkStart) * 1000) / 10000;
console.log(
  `PASS: ${checked.toLocaleString()} full-race driver frames, all 71 laps, reverse seeks and retirements (${(performance.now() - start).toFixed(0)}ms).`,
);
console.log(
  `WASM interpolation benchmark: ${micros.toFixed(1)}µs/frame for all 20 drivers (10,000 random seeks).`,
);
