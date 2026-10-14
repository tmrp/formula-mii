import * as THREE from "three";

// Race effects in the manner of a Wii racer: a car using its battery gets a
// Wii-blue electric trail and twinkling sparks, a car in another's tow gets
// the white wind lines of a kart slipstreaming, the rear wheels burst into
// cartoon fire flat out, and the front tyres smoke under hard braking.
// OpenF1 has no energy data, so the boost is estimated from the throttle and
// acceleration; the slipstream comes from where the cars are.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const usable = (frame: Float32Array, k: number) =>
  frame[k + 12] > 0 && frame[k + 13] <= 3;

/**
 * How hard a car is deploying its battery, 0 to 1. A car at full throttle
 * that is still pulling hard is deploying; as it tops out at the end of a
 * straight, the boost fades, as real cars run out of deployment.
 */
export function boostLevel(frame: Float32Array, i: number) {
  const k = i * 16;
  if (!usable(frame, k) || frame[k + 5] < 95) return 0;
  if (frame[k + 4] < 90 || frame[k + 7] < 2) return 0;
  return smooth(2.5, 7, frame[k + 15]);
}

/** Fire from the rear wheels, with the throttle flat out. */
export function throttleFlameLevel(frame: Float32Array, i: number) {
  const k = i * 16;
  return usable(frame, k) ? smooth(97, 100, frame[k + 5]) : 0;
}

/**
 * Smoke from the front tyres, braking from speed. OpenF1 reports the brake
 * as on or off, so on is full braking; below about 80 km/h (the grid, the
 * pit lane) the tyres stay clean.
 */
export function tyreSmokeLevel(frame: Float32Array, i: number) {
  const k = i * 16;
  if (!usable(frame, k) || frame[k + 6] < 99) return 0;
  return smooth(80, 160, frame[k + 4]);
}

/**
 * How strongly each car is in another's slipstream, 0 to 1: close behind
 * a car going the same way, nearly in line, at speed and on the throttle.
 */
export function slipstreamLevels(
  frame: Float32Array,
  count: number,
  out: Float32Array,
) {
  for (let i = 0; i < count; i++) {
    out[i] = 0;
    const k = i * 16,
      speed = frame[k + 4];
    if (!usable(frame, k) || speed < 150 || frame[k + 5] < 60) continue;
    const h = frame[k + 3],
      fx = Math.sin(h),
      fy = Math.cos(h);
    for (let j = 0; j < count; j++) {
      const o = j * 16;
      if (j === i || !usable(frame, o)) continue;
      const dx = frame[o] - frame[k],
        dy = frame[o + 1] - frame[k + 1],
        along = dx * fx + dy * fy;
      if (along < 3 || along > 60) continue;
      const side = Math.abs(dx * fy - dy * fx);
      if (side > 5 || Math.cos(frame[o + 3] - h) < 0.94) continue;
      out[i] = Math.max(
        out[i],
        (1 - smooth(18, 60, along)) *
          (1 - smooth(2.5, 5, side)) *
          smooth(150, 230, speed),
      );
    }
  }
}

const HEADER = /* glsl */ `
uniform float time;
attribute vec2 aU;
attribute vec2 aFx;
attribute float aStrength;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vStrength;
varying float vFade;
varying float vClear;
// Far away, effects widen so they still read from the aerial view.
float reach(mat4 m) {
  return clamp(-(m * vec4(0.0, 1.5, 0.0, 1.0)).z / 140.0, 1.0, 3.5);
}
// Effects melt away right in front of the camera, so a close-up stays clear.
float clearOfCamera(vec4 p) {
  return smoothstep(4.0, 11.0, -p.z);
}
// Turns a line through a and b into a ribbon facing the camera.
vec4 ribbon(mat4 m, vec3 a, vec3 b, float width) {
  vec4 p = m * vec4(a, 1.0);
  vec3 t = (m * vec4(b, 1.0)).xyz - p.xyz;
  p.xyz += normalize(cross(t, p.xyz) + 1e-6) * aU.y * width;
  return p;
}`;

const FOOTER = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

// Wind lines flow from just ahead of the nose, around the body and past
// the tail, swirling a little, like the air a kart drafts in.
const WIND_VERTEX = /* glsl */ `
${HEADER}
vec3 windPoint(float u) {
  float r = mix(1.4, 3.3, smoothstep(0.0, 0.4, u)) * (0.85 + 0.3 * fract(aFx.y * 3.7)) + 0.9 * u;
  float a = aFx.x + 0.35 * u;
  return vec3(cos(a) * r * 1.3, 2.6 + sin(a) * r * 1.25, 7.0 - u * 16.0);
}
void main() {
  mat4 m = modelViewMatrix * instanceMatrix;
  vec3 c = windPoint(aU.x);
  vec4 p = ribbon(m, c, windPoint(aU.x + 0.02), 0.13 * reach(m));
  // Lines part around the Mii's head rather than crossing its face.
  vClear = smoothstep(1.9, 3.4, distance(c, vec3(0.0, 4.55, -0.55))) * clearOfCamera(p);
  vUv = aU;
  vSeed = aFx.y;
  vStrength = aStrength;
  gl_Position = projectionMatrix * p;
}`;

const WIND_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
varying float vStrength;
varying float vClear;
uniform float time;
uniform vec3 white;
void main() {
  // Streaks about 6 m long, streaming back at 40 m/s.
  float s = fract(vUv.x * 1.6 - time * (2.6 + vSeed) + vSeed * 5.0);
  float dash = smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.35, 0.6, s));
  float a = vStrength * vClear * dash * sin(3.14159 * vUv.x) * (1.0 - vUv.y * vUv.y);
  if (a < 0.004) discard;
  gl_FragColor = vec4(white, a);
  ${FOOTER}
}`;

// The battery boost: a soft glow and a bright crackling core trailing from
// the back of the car, sparks that twinkle out behind it, and a pool of blue
// light on the road beneath.
const BOOST_VERTEX = /* glsl */ `
${HEADER}
vec3 trailPoint(float u, float crackle) {
  float wobble = crackle * u * 0.55 *
    (0.6 * sin(u * 23.0 - time * 31.0) + 0.4 * sin(u * 41.0 + time * 17.0));
  return vec3(wobble, 1.4 - 0.5 * u, -4.2 - u * 14.0);
}
void main() {
  mat4 m = modelViewMatrix * instanceMatrix;
  float kind = aFx.x, seed = aFx.y, scale = reach(m);
  vec4 p;
  vFade = 1.0;
  if (kind < 1.5) {
    float u = aU.x;
    p = ribbon(m, trailPoint(u, kind), trailPoint(u + 0.02, kind),
      mix(kind > 0.5 ? 0.6 : 2.1, 0.08, u) * scale);
  } else if (kind < 2.5) {
    // A spark is born at the back of the car and drifts back and up.
    float life = fract(time * (0.9 + 0.8 * fract(seed * 7.3)) + seed);
    vec3 c = vec3(
      (fract(seed * 13.7) - 0.5) * 3.6 + sign(fract(seed * 3.1) - 0.5) * life * 1.4,
      1.2 + 1.6 * fract(seed * 5.9) + 1.3 * life,
      -3.8 - 8.0 * life);
    p = m * vec4(c, 1.0);
    p.xy += aU * (0.55 + 0.45 * fract(seed * 9.1)) * sin(3.14159 * life) * scale;
    vFade = 1.0 - life;
  } else {
    p = m * vec4(aU.x * 4.8 * scale, 0.25, aU.y * 7.5 * scale - 1.2, 1.0);
  }
  vClear = clearOfCamera(p);
  vUv = aU;
  vKind = kind;
  vSeed = seed;
  vStrength = aStrength;
  gl_Position = projectionMatrix * p;
}`;

const BOOST_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vStrength;
varying float vFade;
varying float vClear;
uniform float time;
uniform vec3 blue;
uniform vec3 white;
uniform vec3 yellow;
void main() {
  vec3 color;
  float a;
  if (vKind < 0.5) {
    float pulse = 0.75 + 0.25 * sin(vUv.x * 30.0 - time * 25.0);
    a = pow(max(1.0 - vUv.x, 0.0), 1.2) * smoothstep(0.0, 0.05, vUv.x) * (1.0 - vUv.y * vUv.y) * pulse * 0.8;
    color = blue;
  } else if (vKind < 1.5) {
    a = pow(max(1.0 - vUv.x, 0.0), 1.4) * (1.0 - smoothstep(0.3, 1.0, abs(vUv.y)));
    color = mix(white, blue, smoothstep(0.15, 0.7, vUv.x));
  } else if (vKind < 2.5) {
    // A four-point twinkle, like the Wii's sparkles.
    vec2 q = abs(vUv);
    float star = 1.0 - smoothstep(0.55, 1.0, sqrt(q.x) + sqrt(q.y));
    a = star * vFade;
    color = mix(white, fract(vSeed * 4.3) > 0.5 ? yellow : blue, 0.35 + 0.4 * length(vUv));
  } else {
    float d = length(vUv);
    a = (1.0 - smoothstep(0.2, 1.0, d)) * 0.6;
    color = blue;
  }
  a *= vStrength * vClear;
  if (a < 0.004) discard;
  gl_FragColor = vec4(color, a);
  ${FOOTER}
}`;

// Cartoon fire at the rear wheels: tongues of flame licking back and up from
// the tyres, and puffs that break off them and rise away, cooling from
// yellow to red as they go, all in crisp bands like a Nintendo fire. aFx.x
// is 0–1 for a tongue at the left or right wheel, 2–3 for a puff.
const FLAME_VERTEX = /* glsl */ `
${HEADER}
vec3 tongue(vec3 base, vec3 span, float lift, float sway, float u) {
  return base + span * u + vec3(sway * u, lift * u * u, 0.0);
}
void main() {
  mat4 m = modelViewMatrix * instanceMatrix;
  float w = aFx.x, seed = aFx.y, scale = reach(m);
  float side = mod(w, 2.0) < 0.5 ? -1.0 : 1.0;
  vec3 base = vec3(side * 2.75, 0.6, -2.95);
  vec3 span = vec3(side * 0.4, 1.7, -3.6) * 1.35;
  vec4 p;
  vFade = 0.0;
  if (w < 1.5) {
    float big = 0.7 + 0.6 * fract(seed * 5.3);
    float flicker = 0.85 + 0.15 * sin(time * 23.0 + seed * 40.0)
      + 0.08 * sin(time * 37.0 + seed * 13.0);
    vec3 reachOut = span * big * flicker;
    float sway = 0.25 * side * sin(time * 13.0 + seed * 20.0);
    float lift = 0.68 * big;
    p = ribbon(m, tongue(base, reachOut, lift, sway, aU.x),
      tongue(base, reachOut, lift, sway, aU.x + 0.05), 1.2 * big * scale);
  } else {
    float life = fract(time * (1.6 + 0.9 * fract(seed * 7.7)) + seed);
    vec3 c = base + span * (0.35 + 0.8 * life)
      + vec3(side * (fract(seed * 3.3) - 0.5) * 0.9, 1.3 * life, 0.0);
    p = m * vec4(c, 1.0);
    p.xy += aU * (0.85 - 0.6 * life) * scale;
    vFade = life;
  }
  // Close to the camera (the onboard view) the fire fades rather than
  // filling the screen.
  vClear = smoothstep(2.0, 5.0, -p.z);
  vUv = aU;
  vKind = w;
  vSeed = seed;
  vStrength = aStrength;
  gl_Position = projectionMatrix * p;
}`;

const FLAME_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vStrength;
varying float vFade;
varying float vClear;
uniform float time;
uniform vec3 flameRed;
uniform vec3 flameOrange;
uniform vec3 flameYellow;
uniform vec3 flameCore;
vec3 bands(float h) {
  vec3 color = mix(flameRed, flameOrange, smoothstep(0.12, 0.16, h));
  color = mix(color, flameYellow, smoothstep(0.34, 0.38, h));
  return mix(color, flameCore, smoothstep(0.58, 0.62, h));
}
void main() {
  vec3 color;
  float a;
  if (vKind < 1.5) {
    // A teardrop: round at the tyre, widest a quarter of the way, pointed
    // at the tip, its edge rippling.
    float u = vUv.x;
    float profile = u < 0.25
      ? sqrt(max(u, 0.0) / 0.25)
      : pow(max((1.0 - u) / 0.75, 0.0), 1.3);
    profile *= 0.85 + 0.15 * sin(u * 9.0 - time * 18.0 + vSeed * 30.0);
    float edge = abs(vUv.y) / max(profile, 1e-3);
    color = bands((1.0 - min(edge, 1.0)) * (1.0 - 0.65 * u));
    a = (1.0 - smoothstep(0.88, 1.0, edge)) * (1.0 - smoothstep(0.8, 1.0, u));
  } else {
    // A puff of flame: hot in the middle and cooling as it rises.
    float d = length(vUv);
    color = bands((1.0 - min(d, 1.0)) * (1.0 - 0.8 * vFade));
    a = (1.0 - smoothstep(0.8, 1.0, d)) * (1.0 - smoothstep(0.55, 1.0, vFade));
  }
  a *= vStrength * vClear;
  if (a < 0.004) discard;
  gl_FragColor = vec4(color, a);
  ${FOOTER}
}`;

// Tyre smoke: soft cartoon puffs, like cotton wool, that billow from the
// front tyres, swell, rise and drift back behind the car. aFx.x is 0 for
// the left tyre and 1 for the right.
const SMOKE_VERTEX = /* glsl */ `
${HEADER}
void main() {
  mat4 m = modelViewMatrix * instanceMatrix;
  float seed = aFx.y, scale = reach(m);
  float side = aFx.x < 0.5 ? -1.0 : 1.0;
  float life = fract(time * (1.3 + 0.6 * fract(seed * 7.3)) + seed);
  float size = mix(0.8, 2.8, sqrt(life)) * (0.8 + 0.4 * fract(seed * 5.7));
  vec3 c = vec3(
    side * (2.4 + 1.0 * life) + (fract(seed * 13.1) - 0.5) * 0.8,
    0.2 + 0.55 * size + 1.2 * life,
    2.6 - 12.0 * life);
  vec4 p = m * vec4(c, 1.0);
  p.xy += aU * size * scale;
  vClear = smoothstep(2.0, 6.0, -p.z);
  vFade = life;
  vUv = aU;
  vSeed = seed;
  vStrength = aStrength;
  gl_Position = projectionMatrix * p;
}`;

const SMOKE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
varying float vStrength;
varying float vFade;
varying float vClear;
uniform vec3 smokeLight;
uniform vec3 smokeShade;
void main() {
  float d = length(vUv);
  // A lumpy cloud outline, lit from the upper left so it looks round.
  float angle = d > 1e-3 ? atan(vUv.y, vUv.x) : 0.0;
  float edge = 0.82 + 0.1 * sin(angle * 5.0 + vSeed * 40.0)
    + 0.05 * sin(angle * 9.0 - vSeed * 17.0);
  vec2 q = vUv / edge;
  vec3 n = vec3(q, sqrt(max(1.0 - dot(q, q), 0.0)));
  float light = clamp(0.55 + 0.45 * dot(n, vec3(-0.37, 0.6, 0.71)), 0.0, 1.0);
  vec3 color = mix(smokeShade, smokeLight, light);
  float a = (1.0 - smoothstep(edge - 0.1, edge, d)) * 0.75
    * pow(max(1.0 - vFade, 0.0), 1.3) * smoothstep(0.0, 0.08, vFade);
  a *= vStrength * vClear;
  if (a < 0.004) discard;
  gl_FragColor = vec4(color, a);
  ${FOOTER}
}`;

// Geometry builders: a ribbon of `segments` steps, a quad of four corners.
function ribbonVertices(
  segments: number,
  fx: [number, number],
  u: number[],
  ids: number[],
  index: number[],
) {
  const base = u.length / 2;
  for (let s = 0; s <= segments; s++) {
    for (const side of [-1, 1]) {
      u.push(s / segments, side);
      ids.push(...fx);
    }
    if (s < segments) {
      const a = base + s * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
}
function quadVertices(
  fx: [number, number],
  u: number[],
  ids: number[],
  index: number[],
) {
  const a = u.length / 2;
  u.push(-1, -1, 1, -1, -1, 1, 1, 1);
  for (let c = 0; c < 4; c++) ids.push(...fx);
  index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
}
function effectGeometry(
  build: (u: number[], ids: number[], index: number[]) => void,
  count: number,
) {
  const u: number[] = [],
    ids: number[] = [],
    index: number[] = [];
  build(u, ids, index);
  const g = new THREE.BufferGeometry();
  // Positions come from the shaders; three still expects the attribute.
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array((u.length / 2) * 3), 3),
  );
  g.setAttribute("aU", new THREE.Float32BufferAttribute(u, 2));
  g.setAttribute("aFx", new THREE.Float32BufferAttribute(ids, 2));
  g.setIndex(index);
  const strength = new THREE.InstancedBufferAttribute(
    new Float32Array(count),
    1,
  );
  strength.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("aStrength", strength);
  return { geometry: g, strength };
}

interface Effect {
  mesh: THREE.InstancedMesh;
  strength: THREE.InstancedBufferAttribute;
  /** Smoothed level for each car. */
  levels: Float32Array;
  /** How quickly it flares up and dies away, in seconds. */
  rise: number;
  fall: number;
}

export class RaceEffects {
  private boost: Effect;
  private wind: Effect;
  private throttleFlames: Effect;
  private tyreSmoke: Effect;
  private targets: Float32Array;
  private time = { value: 0 };
  private enabled = true;
  constructor(
    scene: THREE.Scene,
    private count: number,
  ) {
    this.targets = new Float32Array(count);
    const colors = {
      blue: { value: new THREE.Color("#34beed") },
      white: { value: new THREE.Color("#f4fbff") },
      yellow: { value: new THREE.Color("#ffe66b") },
      flameRed: { value: new THREE.Color("#ff4b2b") },
      flameOrange: { value: new THREE.Color("#ff8c1a") },
      flameYellow: { value: new THREE.Color("#ffd43b") },
      flameCore: { value: new THREE.Color("#fff4c4") },
      smokeLight: { value: new THREE.Color("#ffffff") },
      smokeShade: { value: new THREE.Color("#c3cad1") },
    };
    const effect = (
      build: (u: number[], ids: number[], index: number[]) => void,
      vertexShader: string,
      fragmentShader: string,
      { rise = 0.12, fall = 0.4, uniforms = {} } = {},
    ): Effect => {
      const { geometry, strength } = effectGeometry(build, count);
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { time: this.time, ...colors, ...uniforms },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, strength, levels: new Float32Array(count), rise, fall };
    };
    this.boost = effect(
      (u, ids, index) => {
        quadVertices([3, 0], u, ids, index);
        ribbonVertices(24, [0, 0], u, ids, index);
        ribbonVertices(36, [1, 0], u, ids, index);
        for (let s = 0; s < 18; s++)
          quadVertices([2, (s + 0.5) / 18], u, ids, index);
      },
      BOOST_VERTEX,
      BOOST_FRAGMENT,
    );
    // Seven lines around the sides and over the top, never under the road.
    const angles = [-0.2, 0.35, 0.95, 1.57, 2.2, 2.8, 3.34];
    this.wind = effect(
      (u, ids, index) =>
        angles.forEach((angle, i) =>
          ribbonVertices(20, [angle, (i + 0.5) / angles.length], u, ids, index),
        ),
      WIND_VERTEX,
      WIND_FRAGMENT,
    );
    // Each rear wheel: three tongues, each its own size and flicker, and six
    // puffs breaking away.
    this.throttleFlames = effect(
      (u, ids, index) => {
        for (const w of [0, 1]) {
          for (let t = 0; t < 3; t++)
            ribbonVertices(8, [w, (w * 3 + t + 0.5) / 6], u, ids, index);
          for (let f = 0; f < 6; f++)
            quadVertices([w + 2, (w * 6 + f + 0.5) / 12], u, ids, index);
        }
      },
      FLAME_VERTEX,
      FLAME_FRAGMENT,
      { rise: 0.05, fall: 0.18 },
    );
    // Eight puffs from each front tyre, lingering a little as the brake
    // comes off.
    this.tyreSmoke = effect(
      (u, ids, index) => {
        for (const w of [0, 1])
          for (let f = 0; f < 8; f++)
            quadVertices([w, (w * 8 + f + 0.5) / 16], u, ids, index);
      },
      SMOKE_VERTEX,
      SMOKE_FRAGMENT,
      { rise: 0.08, fall: 0.5 },
    );
  }
  private get all() {
    return [this.boost, this.wind, this.throttleFlames, this.tyreSmoke];
  }
  /** Off clears the cars at once, even while the replay is paused. */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) return;
    for (const { mesh, levels } of this.all) {
      levels.fill(0);
      mesh.count = 0;
      mesh.visible = false;
    }
  }
  /** Cars showing each effect right now, for the browser checks. */
  get active() {
    const count = (levels: Float32Array) =>
      levels.reduce((n, l) => n + (l > 0.3 ? 1 : 0), 0);
    return {
      boosting: count(this.boost.levels),
      slipstreaming: count(this.wind.levels),
      throttleFlames: count(this.throttleFlames.levels),
      tyreSmoke: count(this.tyreSmoke.levels),
    };
  }
  /**
   * Follow the race. `dt` is the real time since the last frame and is 0
   * after a seek, when the effects jump straight to the new moment; while
   * the replay is paused (`advance` false) they hold still.
   */
  update(
    frame: Float32Array,
    cars: readonly THREE.Object3D[],
    dt: number,
    advance: boolean,
  ) {
    if (!advance) return;
    this.time.value += dt;
    const each = (level: (frame: Float32Array, i: number) => number) => {
      for (let i = 0; i < this.count; i++)
        this.targets[i] = this.enabled ? level(frame, i) : 0;
    };
    each(boostLevel);
    this.follow(this.boost, cars, dt);
    each(throttleFlameLevel);
    this.follow(this.throttleFlames, cars, dt);
    each(tyreSmokeLevel);
    this.follow(this.tyreSmoke, cars, dt);
    if (this.enabled) slipstreamLevels(frame, this.count, this.targets);
    else this.targets.fill(0);
    this.follow(this.wind, cars, dt);
  }
  // Ease each car's level toward its target (quick in, gentle out) and draw
  // the cars that show the effect.
  private follow(effect: Effect, cars: readonly THREE.Object3D[], dt: number) {
    const { mesh, strength, levels, rise, fall } = effect;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const target = cars[i].visible ? this.targets[i] : 0,
        tau = target > levels[i] ? rise : fall;
      levels[i] =
        dt > 0
          ? levels[i] + (target - levels[i]) * (1 - Math.exp(-dt / tau))
          : target;
      if (levels[i] < 0.01 || !cars[i].visible) continue;
      mesh.setMatrixAt(n, cars[i].matrix);
      strength.setX(n, levels[i]);
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    strength.needsUpdate = true;
  }
  dispose() {
    for (const { mesh } of this.all) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.removeFromParent();
    }
  }
}
