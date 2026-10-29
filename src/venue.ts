import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  CROWD_STYLES,
  faceAtlas,
  faceGeometry,
  hairGeometry,
  headGeometry,
  instancedFaceMaterial,
  miiGlow,
  randomMii,
} from "./mii";

type XY = [number, number];
/** Interlagos from OpenStreetMap, already fitted to the replay's track (see scripts/venue_ingest.py). */
export interface Venue {
  source: string;
  fit_rms_m: number;
  track_length_m: number;
  corners: { name: string; from: number; to: number; at: number }[];
  pit_lane: XY[];
  venue: XY[];
  /** Oriented rectangles: centre x, centre y, width, depth, angle. */
  grandstands: [number, number, number, number, number][];
  /** As grandstands, plus 1 inside the circuit grounds or 0 in the city. */
  buildings: [number, number, number, number, number, number][];
  water: XY[][];
  forest: XY[][];
  grass: XY[][];
  paved: XY[][];
  /** Width in metres, then the street's points. */
  roads: [number, ...XY[]][];
  karting: XY[][];
  trees: XY[];
}
export const EMPTY_VENUE: Venue = {
  source: "",
  fit_rms_m: 0,
  track_length_m: 0,
  corners: [],
  pit_lane: [],
  venue: [],
  grandstands: [],
  buildings: [],
  water: [],
  forest: [],
  grass: [],
  paved: [],
  roads: [],
  karting: [],
  trees: [],
};

// Replay coordinates are OpenF1's metres east (x) and north (y). The scene is
// y-up and right-handed, so north runs along -z; north along +z would mirror
// the circuit.
export const toWorld = (x: number, y: number, h = 0) =>
  new THREE.Vector3(x, h, -y);
export const v = (x: number, y: number, z: number) =>
  new THREE.Vector3(x, y, z);
export const mat = (color: THREE.ColorRepresentation) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
export function mesh(
  g: THREE.BufferGeometry,
  m: THREE.Material,
  parent: THREE.Object3D,
  x = 0,
  y = 0,
  z = 0,
) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
export function box(
  parent: THREE.Object3D,
  m: THREE.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  return mesh(new THREE.BoxGeometry(w, h, d), m, parent, x, y, z);
}
function textPanel(
  text: string,
  bg: string,
  fg: string,
  w: number,
  h: number,
) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.font = '500 56px "Zen Kaku Gothic New", sans-serif';
  ctx.fillText(text, 256, 83);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Usually seen at a slant, from down the straight.
  texture.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
}
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function inside(x: number, y: number, ring: XY[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i],
      [x2, y2] = ring[j];
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1)
      hit = !hit;
  }
  return hit;
}
function insideRect(x: number, y: number, r: readonly number[], margin = 0) {
  const c = Math.cos(r[4]),
    s = Math.sin(r[4]),
    dx = x - r[0],
    dy = y - r[1];
  return (
    Math.abs(dx * c + dy * s) < r[2] / 2 + margin &&
    Math.abs(-dx * s + dy * c) < r[3] / 2 + margin
  );
}
function distanceToLine(x: number, y: number, line: XY[]) {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i],
      [bx, by] = line[i + 1],
      dx = bx - ax,
      dy = by - ay,
      t = THREE.MathUtils.clamp(
        ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1),
        0,
        1,
      );
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return best;
}

// ---------------------------------------------------------------------------
// The ground: a heightfield that holds the racing line at its recorded
// elevation and settles into a smooth bowl away from it.

const BUCKET = 40;
const REACH = 60;
export class Ground {
  readonly n: number;
  readonly heights: Float32Array;
  min = Infinity;
  max = -Infinity;
  readonly lakes: { ring: XY[]; level: number }[] = [];
  private segments: Float32Array;
  private trackSegments: number;
  private buckets = new Map<number, number[]>();
  constructor(
    readonly radius: number,
    track: THREE.Vector3[],
    pit: THREE.Vector3[],
    lakes: XY[][],
    readonly step = 6,
  ) {
    const segs: number[] = [];
    const add = (a: THREE.Vector3, b: THREE.Vector3) =>
      segs.push(a.x, a.z, a.y, b.x, b.z, b.y);
    track.forEach((p, i) => add(p, track[(i + 1) % track.length]));
    this.trackSegments = track.length;
    for (let i = 0; i + 1 < pit.length; i++) add(pit[i], pit[i + 1]);
    this.segments = new Float32Array(segs);
    for (let s = 0; s < segs.length / 6; s++) {
      const o = s * 6,
        x0 = Math.floor((Math.min(segs[o], segs[o + 3]) - REACH) / BUCKET),
        x1 = Math.floor((Math.max(segs[o], segs[o + 3]) + REACH) / BUCKET),
        z0 = Math.floor((Math.min(segs[o + 1], segs[o + 4]) - REACH) / BUCKET),
        z1 = Math.floor((Math.max(segs[o + 1], segs[o + 4]) + REACH) / BUCKET);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const key = x * 4096 + z;
          const list = this.buckets.get(key) ?? [];
          list.push(s);
          this.buckets.set(key, list);
        }
    }
    // Far from the track, an inverse-distance blend of the whole lap's
    // elevation, on a coarse grid.
    const coarse = 30,
      cn = Math.ceil((2 * radius) / coarse) + 1,
      far = new Float32Array(cn * cn);
    for (let j = 0; j < cn; j++)
      for (let i = 0; i < cn; i++) {
        const x = -radius + i * coarse,
          z = -radius + j * coarse;
        let sum = 0,
          weight = 0;
        for (const p of track) {
          const w = 1 / ((p.x - x) ** 2 + (p.z - z) ** 2 + 900);
          sum += p.y * w;
          weight += w;
        }
        far[j * cn + i] = sum / weight;
      }
    const sampleFar = (x: number, z: number) => {
      const fx = THREE.MathUtils.clamp((x + radius) / coarse, 0, cn - 1.001),
        fz = THREE.MathUtils.clamp((z + radius) / coarse, 0, cn - 1.001),
        i = Math.floor(fx),
        j = Math.floor(fz),
        tx = fx - i,
        tz = fz - j;
      const a = far[j * cn + i],
        b = far[j * cn + i + 1],
        c = far[(j + 1) * cn + i],
        d = far[(j + 1) * cn + i + 1];
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    };
    this.n = Math.ceil((2 * radius) / step) + 1;
    this.heights = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++) {
        const x = -radius + i * step,
          z = -radius + j * step;
        const near = this.nearest(x, z);
        const t = smoothstep(16, REACH, near.distance);
        this.heights[j * this.n + i] =
          near.height * (1 - t) + sampleFar(x, z) * t;
      }
    // Lakes sit a little below their lowest shore, on a carved bed.
    for (const ring of lakes) {
      const level = Math.min(...ring.map(([x, y]) => this.height(x, -y))) - 0.6;
      this.lakes.push({ ring, level });
      this.forEachNodeIn(ring, (k) => (this.heights[k] = level - 2.5));
    }
    this.updateRange();
  }
  private updateRange() {
    this.min = Infinity;
    this.max = -Infinity;
    for (const h of this.heights) {
      this.min = Math.min(this.min, h);
      this.max = Math.max(this.max, h);
    }
  }
  /** Calls `fn` with the index of every node inside `ring` (replay x/y). */
  forEachNodeIn(ring: XY[], fn: (index: number) => void) {
    const xs = ring.map((p) => p[0]),
      zs = ring.map((p) => -p[1]);
    const i0 = Math.max(
        0,
        Math.floor((Math.min(...xs) + this.radius) / this.step),
      ),
      i1 = Math.min(
        this.n - 1,
        Math.ceil((Math.max(...xs) + this.radius) / this.step),
      ),
      j0 = Math.max(0, Math.floor((Math.min(...zs) + this.radius) / this.step)),
      j1 = Math.min(
        this.n - 1,
        Math.ceil((Math.max(...zs) + this.radius) / this.step),
      );
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = -this.radius + i * this.step,
          z = -this.radius + j * this.step;
        if (inside(x, -z, ring)) fn(j * this.n + i);
      }
  }
  /** Levels the ground under a footprint, for a grandstand to stand on. */
  flatten(ring: XY[], height: number) {
    this.forEachNodeIn(ring, (k) => (this.heights[k] = height));
    this.updateRange();
  }
  /** Nearest track (or pit lane) segment within reach, and its elevation there. */
  nearest(x: number, z: number, trackOnly = false) {
    const list = this.buckets.get(
      Math.floor(x / BUCKET) * 4096 + Math.floor(z / BUCKET),
    );
    let distance = Infinity,
      height = 0;
    if (list)
      for (const s of list) {
        if (trackOnly && s >= this.trackSegments) continue;
        const o = s * 6,
          ax = this.segments[o],
          az = this.segments[o + 1],
          dx = this.segments[o + 3] - ax,
          dz = this.segments[o + 4] - az;
        const t = THREE.MathUtils.clamp(
          ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1),
          0,
          1,
        );
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < distance) {
          distance = d;
          height =
            this.segments[o + 2] +
            (this.segments[o + 5] - this.segments[o + 2]) * t;
        }
      }
    return { distance, height };
  }
  height(x: number, z: number) {
    const fx = THREE.MathUtils.clamp(
        (x + this.radius) / this.step,
        0,
        this.n - 1.001,
      ),
      fz = THREE.MathUtils.clamp(
        (z + this.radius) / this.step,
        0,
        this.n - 1.001,
      ),
      i = Math.floor(fx),
      j = Math.floor(fz),
      tx = fx - i,
      tz = fz - j,
      n = this.n,
      h = this.heights;
    return (
      (h[j * n + i] * (1 - tx) + h[j * n + i + 1] * tx) * (1 - tz) +
      (h[(j + 1) * n + i] * (1 - tx) + h[(j + 1) * n + i + 1] * tx) * tz
    );
  }
}

// ---------------------------------------------------------------------------
// Ground texture, painted from the map like a Wii Sports course.

function groundTexture(venue: Venue, radius: number) {
  const size = 2048,
    k = size / (2 * radius),
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Replay x/y to canvas pixels, north up.
  ctx.setTransform(k, 0, 0, -k, radius * k, radius * k);
  const shape = (ring: XY[]) => {
    ctx.beginPath();
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  const line = (points: XY[]) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  };
  ctx.fillStyle = "#d5d0c3";
  ctx.fillRect(-radius, -radius, 2 * radius, 2 * radius);
  ctx.fillStyle = "#78b34c";
  if (venue.venue.length) {
    shape(venue.venue);
    ctx.fill();
    // Mowing stripes across the grounds.
    ctx.save();
    shape(venue.venue);
    ctx.clip();
    ctx.fillStyle = "#80bb53";
    for (let x = -radius; x < radius; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, -radius);
      ctx.lineTo(x + 12, -radius);
      ctx.lineTo(x + 12 + radius, radius);
      ctx.lineTo(x + radius, radius);
      ctx.fill();
    }
    ctx.restore();
  } else ctx.fillRect(-radius, -radius, 2 * radius, 2 * radius);
  ctx.fillStyle = "#8ac65c";
  venue.grass.forEach((r) => (shape(r), ctx.fill()));
  ctx.fillStyle = "#4e973b";
  venue.forest.forEach((r) => (shape(r), ctx.fill()));
  ctx.fillStyle = "#c4c4c4";
  venue.paved.forEach((r) => (shape(r), ctx.fill()));
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.strokeStyle = "#bdb8ad";
  for (const [width, ...points] of venue.roads) {
    ctx.lineWidth = width + 2;
    line(points);
    ctx.stroke();
  }
  ctx.strokeStyle = "#f2f0ea";
  for (const [width, ...points] of venue.roads) {
    ctx.lineWidth = width;
    line(points);
    ctx.stroke();
  }
  for (const [width, color] of [
    [9, "#ffffff"],
    [7, "#868b8e"],
  ] as const) {
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    venue.karting.forEach((p) => (line(p), ctx.stroke()));
  }
  ctx.fillStyle = "#2f7eab";
  venue.water.forEach((r) => (shape(r), ctx.fill()));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function terrainMesh(ground: Ground, texture: THREE.Texture) {
  const { n, radius: r, step } = ground,
    positions = new Float32Array(n * n * 3),
    uvs = new Float32Array(n * n * 2),
    out = new Uint8Array(n * n),
    index: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let x = -r + i * step,
        z = -r + j * step;
      const d = Math.hypot(x, z),
        k = j * n + i;
      // Pull the corners of the grid onto the island's round rim.
      if (d > r) {
        out[k] = d > r + step * 1.5 ? 1 : 0;
        x *= r / d;
        z *= r / d;
      }
      positions.set([x, ground.height(x, z), z], k * 3);
      uvs.set([(x + r) / (2 * r), 1 - (z + r) / (2 * r)], k * 2);
    }
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i,
        b = a + 1,
        c = a + n,
        d = c + 1;
      if (out[a] && out[b] && out[c] && out[d]) continue;
      index.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  const terrain = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }),
  );
  terrain.receiveShadow = true;
  return terrain;
}

// The island's earthy sides and sandy underside, as in Wii Sports Resort.
function islandSides(ground: Ground, parent: THREE.Object3D) {
  const segments = 192,
    bottom = ground.min - 45,
    positions: number[] = [],
    index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2,
      x = Math.cos(a) * ground.radius,
      z = Math.sin(a) * ground.radius;
    positions.push(x, ground.height(x, z) - 0.2, z, x * 0.94, bottom, z * 0.94);
    if (i < segments)
      index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const sideMaterial = mat("#a37a4c");
  sideMaterial.side = THREE.DoubleSide;
  mesh(g, sideMaterial, parent);
  const base = mesh(
    new THREE.CircleGeometry(ground.radius * 0.94, 96),
    mat("#ecdcaa"),
    parent,
    0,
    bottom,
    0,
  );
  base.rotation.x = Math.PI / 2;
}

// ---------------------------------------------------------------------------
// Track surface: verge, white edge lines, asphalt and corner kerbs, all
// following the recorded elevation.

function ribbon(
  points: THREE.Vector3[],
  width: number,
  lift: number,
  color: string,
  parent: THREE.Object3D,
  closed: boolean,
) {
  const pos: number[] = [],
    idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next =
        points[
          closed ? (i + 1) % points.length : Math.min(i + 1, points.length - 1)
        ],
      prev =
        points[
          closed ? (i - 1 + points.length) % points.length : Math.max(i - 1, 0)
        ];
    const t = next.clone().sub(prev).setY(0).normalize();
    const n = v(-t.z, 0, t.x).multiplyScalar(width / 2);
    pos.push(
      p.x + n.x,
      p.y + lift,
      p.z + n.z,
      p.x - n.x,
      p.y + lift,
      p.z - n.z,
    );
    if (i < points.length - 1 || closed) {
      const a = i * 2,
        b = ((i + 1) % points.length) * 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const material = mat(color);
  material.side = THREE.DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  const m = mesh(g, material, parent);
  m.castShadow = false;
  return m;
}

export const ASPHALT_LIFT = 0.36;
function trackSurface(points: THREE.Vector3[], parent: THREE.Object3D) {
  ribbon(points, 29, 0.2, "#86bb5d", parent, true);
  ribbon(points, 20, 0.28, "#ffffff", parent, true);
  ribbon(points, 17, ASPHALT_LIFT, "#7c8386", parent, true);
  // Kerbs only where the track turns, like the real circuit's painted kerbs.
  const n = points.length,
    turning = new Uint8Array(n),
    heading = (i: number) => {
      const a = points[(i - 3 + n) % n],
        b = points[(i + 3) % n];
      return Math.atan2(b.x - a.x, b.z - a.z);
    };
  for (let i = 0; i < n; i++) {
    let d = heading((i + 4) % n) - heading((i - 4 + n) % n);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const span = points[(i + 4) % n].distanceTo(points[(i - 4 + n) % n]);
    if (Math.abs(d) / span > 1 / 260)
      for (let k = -6; k <= 6; k++) turning[(i + k + n) % n] = 1;
  }
  const kerbs: THREE.BufferGeometry[][] = [[], []];
  const up = v(0, 0, 1);
  for (let i = 0; i < n; i += 4) {
    if (!turning[i]) continue;
    const a = points[i],
      b = points[(i + 4) % n],
      dir = b.clone().sub(a);
    const length = dir.length(),
      flat = dir.clone().setY(0).normalize();
    for (const sign of [-1, 1]) {
      const normal = v(-flat.z, 0, flat.x).multiplyScalar(sign * 9.1);
      const g = new THREE.BoxGeometry(1.6, 0.3, length + 0.05);
      g.applyMatrix4(
        new THREE.Matrix4().compose(
          a
            .clone()
            .add(b)
            .multiplyScalar(0.5)
            .add(normal)
            .add(v(0, ASPHALT_LIFT + 0.05, 0)),
          new THREE.Quaternion().setFromUnitVectors(up, dir.normalize()),
          v(1, 1, 1),
        ),
      );
      kerbs[Math.floor(i / 4) % 2].push(g);
    }
  }
  kerbs.forEach((list, i) => {
    const material = mat(i ? "#ffffff" : "#e5463c");
    list.forEach((g) => mesh(g, material, parent));
  });
}

// ---------------------------------------------------------------------------
// Grandstands, and the Miis in them.

const ROW = 2.4;
const RISE = 1.05;
interface Seat {
  matrix: THREE.Matrix4;
}
interface StandPlan {
  front: THREE.Vector3[];
  normal: THREE.Vector3[];
  /** Ground level at each front point, so stands step down a hillside. */
  base: number[];
  rows: number;
  roof: boolean;
}
// Where the crowds sit at Interlagos: the main straight (from the map), and
// the outside of the Senna S, Curva do Sol, Descida do Lago, Junção and the
// climb to the pits. Offsets are from the racing line, in metres.
const STANDS = [
  {
    corner: "S do Senna",
    from: -30,
    length: 170,
    offset: 46,
    rows: 13,
    roof: false,
  },
  {
    corner: "Curva do Sol",
    from: 10,
    length: 150,
    offset: 34,
    rows: 10,
    roof: false,
  },
  {
    corner: "Descida do Lago",
    from: 0,
    length: 150,
    offset: 30,
    rows: 9,
    roof: false,
  },
  {
    corner: "Junção",
    from: -20,
    length: 170,
    offset: 34,
    rows: 12,
    roof: true,
  },
  {
    corner: "Subida dos Boxes",
    from: 0,
    length: 170,
    offset: 28,
    rows: 9,
    roof: false,
  },
  {
    corner: "Arquibancadas",
    from: 20,
    length: 150,
    offset: 26,
    rows: 10,
    roof: true,
  },
];

function standGeometry(
  plan: StandPlan,
  parent: THREE.Object3D,
  seats: Seat[],
  random: () => number,
) {
  const { front, normal, rows } = plan;
  const concrete = mat("#ececec"),
    seatColors = [
      mat("#34beed"),
      mat("#ffffff"),
      mat("#34beed"),
      mat("#ffd820"),
    ],
    trim = mat("#34beed"),
    roof = mat("#fbfbfb");
  const up = v(0, 1, 0);
  for (let i = 0; i + 1 < front.length; i++) {
    const base = (plan.base[i] + plan.base[i + 1]) / 2,
      top = base + 1.2 + rows * RISE;
    const a = front[i],
      b = front[i + 1],
      n = normal[i]
        .clone()
        .add(normal[i + 1])
        .normalize(),
      along = b.clone().sub(a).setY(0),
      length = along.length() + 0.3,
      angle = Math.atan2(along.x, along.z),
      mid = a.clone().add(b).multiplyScalar(0.5).setY(0);
    const q = new THREE.Quaternion().setFromAxisAngle(up, angle);
    // A box running along this stretch of the stand, `out` metres back from its front.
    const place = (
      m: THREE.Material,
      out: number,
      y0: number,
      y1: number,
      depth: number,
    ) => {
      const g = new THREE.BoxGeometry(depth, y1 - y0, length);
      const centre = mid
        .clone()
        .addScaledVector(n, out)
        .setY((y0 + y1) / 2);
      g.applyMatrix4(new THREE.Matrix4().compose(centre, q, v(1, 1, 1)));
      mesh(g, m, parent);
    };
    // Front wall with a Wii-blue band, then one stepped tier per row.
    place(concrete, -0.4, base - 4, base + 1.2, 0.8);
    place(trim, -0.85, base + 0.6, base + 1.15, 0.12);
    for (let r = 0; r < rows; r++) {
      const step = base + 1.2 + r * RISE;
      place(concrete, r * ROW + ROW / 2, base - 4, step, ROW + 0.02);
      place(
        seatColors[r % seatColors.length],
        r * ROW + ROW * 0.62,
        step,
        step + 0.45,
        0.9,
      );
      // A Mii on most seats, facing the track.
      const seatsHere = Math.max(1, Math.round(length / 1.9));
      for (let k = 0; k < seatsHere; k++) {
        if (random() < 0.1) continue;
        const t = (k + 0.5) / seatsHere;
        const p = a
          .clone()
          .lerp(b, t)
          .setY(0)
          .addScaledVector(n, r * ROW + ROW * 0.6);
        p.y = step + 0.45;
        const scale = 0.9 + random() * 0.22;
        seats.push({
          matrix: new THREE.Matrix4().compose(
            p,
            new THREE.Quaternion().setFromAxisAngle(
              up,
              Math.atan2(-n.x, -n.z) + (random() - 0.5) * 0.5,
            ),
            v(scale, scale, scale),
          ),
        });
      }
    }
    place(concrete, rows * ROW + 0.5, base - 4, top + 3, 1);
    if (plan.roof) {
      place(roof, rows * ROW * 0.45, top + 7, top + 7.6, rows * ROW + 4);
      place(trim, -1.6, top + 6.6, top + 7.6, 0.4);
      if (i % 4 === 0) place(concrete, rows * ROW + 0.5, top + 3, top + 7, 0.8);
    }
  }
}

function crowd(seats: Seat[], parent: THREE.Object3D, time: { value: number }) {
  const random = seeded(4242),
    count = seats.length;
  const faces = Array.from({ length: 20 }, () => randomMii(random));
  const atlas = faceAtlas(faces, 128);
  const people = seats.map(() => randomMii(random));
  const cheering = seats.map(() => random() < 0.3);
  const head = 0.6;
  const parts: [
    string,
    THREE.BufferGeometry,
    (i: number) => string | null,
    THREE.Material?,
  ][] = [
    [
      "body",
      new THREE.CylinderGeometry(0.36, 0.5, 1.05, 8).translate(0, 0.52, 0),
      (i) => people[i].favorite,
    ],
    [
      "legs",
      new THREE.BoxGeometry(0.82, 0.34, 0.95).translate(0, 0.17, 0.36),
      (i) => ["#555c66", "#3b4a6b", "#6b6b6b", "#2f3a52"][i % 4],
    ],
    [
      "head",
      headGeometry(head, 12).translate(0, 1.05 + head, 0),
      (i) => people[i].skin,
    ],
    [
      "face",
      faceGeometry(head, 10, 1.035).translate(0, 1.05 + head, 0),
      () => "#ffffff",
      instancedFaceMaterial(atlas),
    ],
    [
      "arms",
      (() => {
        const arms: THREE.BufferGeometry[] = [];
        for (const side of [-1, 1]) {
          const arm = new THREE.CapsuleGeometry(0.11, 0.85, 3, 6);
          arm.deleteAttribute("uv");
          arm.rotateZ(side * -0.45).translate(side * 0.5, 1.45, 0.05);
          const hand = new THREE.SphereGeometry(0.17, 8, 6);
          hand.deleteAttribute("uv");
          arms.push(arm, hand.translate(side * 0.72, 1.92, 0.05));
        }
        const merged = mergeGeometries(arms)!;
        arms.forEach((g) => g.dispose());
        return merged;
      })(),
      (i) => (cheering[i] ? people[i].favorite : null),
    ],
    ...CROWD_STYLES.map(
      (style) =>
        [
          `hair:${style}`,
          hairGeometry(style, 1, head, 24, 6).translate(0, 1.05 + head, 0),
          (i: number) =>
            people[i].hairStyle === style ? people[i].hair : null,
        ] as [string, THREE.BufferGeometry, (i: number) => string | null],
    ),
  ];
  const faceCells = seats.map(() => Math.floor(random() * faces.length));
  for (const [role, geometry, color, special] of parts) {
    const indices = seats.map((_, i) => i).filter((i) => color(i));
    if (!indices.length) continue;
    const material =
      special ??
      miiGlow(
        new THREE.MeshStandardMaterial({
          color: "#ffffff",
          roughness: role.startsWith("hair") ? 0.5 : 0.7,
          side: role.startsWith("hair") ? THREE.DoubleSide : THREE.FrontSide,
        }),
      );
    crowdMotion(material, time);
    const instances = new THREE.InstancedMesh(
      geometry,
      material,
      indices.length,
    );
    const c = new THREE.Color();
    let cells: THREE.InstancedBufferAttribute | undefined;
    if (role === "face") {
      cells = new THREE.InstancedBufferAttribute(
        new Float32Array(indices.length * 2),
        2,
      );
      geometry.setAttribute("faceCell", cells);
    }
    indices.forEach((seat, k) => {
      instances.setMatrixAt(k, seats[seat].matrix);
      instances.setColorAt(k, c.set(color(seat)!));
      if (cells) cells.setXY(k, ...atlas.offset(faceCells[seat]));
    });
    instances.castShadow = false;
    instances.receiveShadow = true;
    instances.computeBoundingSphere();
    parent.add(instances);
  }
  return count;
}
/** Each spectator bobs on their seat, out of step with their neighbours. */
function crowdMotion(material: THREE.Material, time: { value: number }) {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.crowdTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float crowdTime;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float crowdPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.53;
float crowdHop = max(0.0, sin(crowdTime * (4.0 + mod(crowdPhase, 3.0)) + crowdPhase));
transformed.y += crowdHop * crowdHop * 0.32;`,
      );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|crowd`;
}

// ---------------------------------------------------------------------------

export interface Station {
  position: THREE.Vector3;
  name: string;
  point: THREE.Vector3;
}
// Trackside cameras at the real corners, named with their F1 turn numbers.
const STATIONS: [string, string, number][] = [
  ["S do Senna", "Senna S · Turns 1–2", 0.06],
  ["Curva do Sol", "Curva do Sol · Turn 3", 0.14],
  ["Descida do Lago", "Descida do Lago · Turn 4", 0.33],
  ["Ferradura", "Ferradura · Turn 6", 0.46],
  ["Pinherinho", "Pinheirinho · Turn 9", 0.57],
  ["Bico de Pato", "Bico de Pato · Turn 10", 0.62],
  ["Junção", "Junção · Turn 12", 0.73],
  ["Arquibancadas", "Finish straight", 0.95],
];

export interface BuiltVenue {
  ground: Ground;
  stations: Station[];
  crowdTime: { value: number };
  spectators: number;
}

export function buildVenue(
  scene: THREE.Scene,
  track: THREE.Vector3[],
  venue: Venue,
  radius: number,
): BuiltVenue {
  const random = seeded(19);
  const curve = new THREE.CatmullRomCurve3(track, true, "centripetal");
  const points = curve.getPoints(1600);
  const length = venue.track_length_m || curve.getLength();
  const at = (s: number) => {
    const u = (((s % length) + length) % length) / length;
    return {
      point: curve.getPointAt(u),
      tangent: curve.getTangentAt(u).setY(0).normalize(),
    };
  };
  const right = (t: THREE.Vector3) => v(-t.z, 0, t.x);
  // Pit lane elevations follow the main straight beside them.
  const nearestTrack = (x: number, z: number) =>
    track.reduce((best, p) =>
      (p.x - x) ** 2 + (p.z - z) ** 2 < (best.x - x) ** 2 + (best.z - z) ** 2
        ? p
        : best,
    );
  const pit = venue.pit_lane.map(([x, y]) =>
    toWorld(x, y, nearestTrack(x, -y).y),
  );
  for (let pass = 0; pass < 3; pass++)
    for (let i = 1; i + 1 < pit.length; i++)
      pit[i].y = (pit[i - 1].y + pit[i].y + pit[i + 1].y) / 3;
  const ground = new Ground(radius, track, pit, venue.water);

  // Anything that would overlap the circuit, the pit lane, the lake or a building.
  const venueBuildings = venue.buildings.filter((b) => b[5] === 1);
  const blocked = (x: number, y: number, clearance: number) =>
    ground.nearest(x, -y).distance < clearance ||
    venue.water.some((r) => inside(x, y, r)) ||
    venueBuildings.some((b) => insideRect(x, y, b, 4)) ||
    venue.grandstands.some((b) => insideRect(x, y, b, 4)) ||
    venue.karting.some((k) => distanceToLine(x, y, k) < 10) ||
    (venue.venue.length > 0 && !inside(x, y, venue.venue));

  const world = new THREE.Group();
  scene.add(world);
  trackSurface(points, world);

  // Start/finish: chequered line and the gantry above it.
  {
    const start = at(0);
    const gantry = new THREE.Group();
    gantry.position.copy(start.point);
    gantry.rotation.y = Math.atan2(start.tangent.x, start.tangent.z);
    world.add(gantry);
    const white = mat("#ffffff");
    box(gantry, white, -13, 10, 0, 1.5, 20, 2);
    box(gantry, white, 13, 10, 0, 1.5, 20, 2);
    box(gantry, mat("#34beed"), 0, 20, 0, 28, 5, 2);
    // A panel on each face of the beam; a sprite would turn to the camera and
    // cut through it.
    const sign = textPanel("Formula Mii", "#ffffff", "#12a3dd", 24, 5);
    sign.position.set(0, 20, 1.02);
    const back = sign.clone();
    back.position.z = -1.02;
    back.rotation.y = Math.PI;
    gantry.add(sign, back);
    for (let x = -8; x < 8; x += 2)
      for (let z = 0; z < 3; z++)
        box(
          gantry,
          mat((Math.floor(x / 2) + z) % 2 ? "#ffffff" : "#3a3a3a"),
          x + 1,
          ASPHALT_LIFT + 0.02,
          z * 2,
          2,
          0.03,
          2,
        );
  }

  // Pit lane, on its real line inside the main straight.
  if (pit.length > 1) {
    const lane = new THREE.CatmullRomCurve3(
      pit,
      false,
      "centripetal",
    ).getPoints(300);
    ribbon(lane, 13, 0.22, "#ffffff", world, false);
    ribbon(lane, 11, 0.3, "#7c8386", world, false);
  }

  // Grandstands: the mapped ones on the main straight first, then the corners.
  const seats: Seat[] = [];
  const plans: StandPlan[] = [];
  for (const g of venue.grandstands) {
    const [cx, cy, w, d, angle] = g;
    const long = w >= d,
      a = long ? angle : angle + Math.PI / 2,
      span = long ? w : d,
      depth = long ? d : w;
    const ax = Math.cos(a),
      ay = Math.sin(a),
      bx = -ay,
      by = ax;
    const sides = [1, -1].map((s) => ({
      s,
      d: ground.nearest(
        cx + (bx * s * depth) / 2,
        -(cy + (by * s * depth) / 2),
        true,
      ).distance,
    }));
    const s = sides[0].d < sides[1].d ? 1 : -1;
    const fx = cx + (bx * s * depth) / 2,
      fy = cy + (by * s * depth) / 2;
    const steps = Math.max(2, Math.round(span / 6));
    const front: THREE.Vector3[] = [],
      normal: THREE.Vector3[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps - 0.5;
      front.push(toWorld(fx + ax * span * t, fy + ay * span * t));
      normal.push(toWorld(-bx * s, -by * s).normalize());
    }
    const base = front.map((p) => ground.nearest(p.x, p.z, true).height);
    plans.push({
      front,
      normal,
      base,
      rows: THREE.MathUtils.clamp(Math.floor(depth / ROW), 5, 14),
      roof: true,
    });
  }
  const corners = new Map(venue.corners.map((c) => [c.name, c]));
  for (const spec of STANDS) {
    const corner = corners.get(spec.corner);
    if (!corner) continue;
    const depth = spec.rows * ROW + 2;
    let run: {
        front: THREE.Vector3[];
        normal: THREE.Vector3[];
        base: number[];
      } = { front: [], normal: [], base: [] },
      best = run;
    for (
      let s = corner.from + spec.from;
      s <= corner.from + spec.from + spec.length;
      s += 6
    ) {
      const { point, tangent } = at(s);
      const n = right(tangent);
      const front = point.clone().addScaledVector(n, spec.offset);
      const back = front.clone().addScaledVector(n, depth);
      const ok = [
        front,
        front.clone().addScaledVector(n, depth / 2),
        back,
      ].every(
        (p, k) =>
          !blocked(p.x, -p.z, k ? spec.offset - 3 : 18) &&
          !plans.some((plan) =>
            plan.front.some((f) => f.distanceTo(p.clone().setY(f.y)) < 10),
          ),
      );
      if (ok) {
        run.front.push(front);
        run.normal.push(n);
        run.base.push(point.y);
        if (run.front.length > best.front.length) best = run;
      } else run = { front: [], normal: [], base: [] };
    }
    if (best.front.length >= 4)
      plans.push({
        front: best.front,
        normal: best.normal,
        base: best.base,
        rows: spec.rows,
        roof: spec.roof,
      });
  }
  for (const plan of plans) {
    // Level a pad under each stretch so the tiers stand clear of the hillside.
    const f = plan.front,
      n = plan.normal,
      depth = plan.rows * ROW + 2;
    for (let i = 0; i + 1 < f.length; i++) {
      const corner = (k: number, out: number): XY => [
        f[k].x + n[k].x * out,
        -(f[k].z + n[k].z * out),
      ];
      ground.flatten(
        [
          corner(i, -2),
          corner(i + 1, -2),
          corner(i + 1, depth),
          corner(i, depth),
        ],
        (plan.base[i] + plan.base[i + 1]) / 2 - 0.4,
      );
    }
    standGeometry(plan, world, seats, random);
  }

  const texture = groundTexture(venue, radius);
  world.add(terrainMesh(ground, texture));
  islandSides(ground, world);

  for (const { ring, level } of ground.lakes) {
    const shape = new THREE.Shape(
      ring.map(([x, y]) => new THREE.Vector2(x, y)),
    );
    const g = new THREE.ShapeGeometry(shape, 4).rotateX(-Math.PI / 2);
    const water = mesh(
      g,
      new THREE.MeshStandardMaterial({
        color: "#46b8e8",
        roughness: 0.2,
        metalness: 0.05,
      }),
      world,
      0,
      level,
      0,
    );
    water.castShadow = false;
  }

  // Circuit buildings: the pit garages, paddock and media buildings.
  const largest = venueBuildings.reduce<
    (typeof venueBuildings)[number] | undefined
  >((a, b) => (!a || b[2] * b[3] > a[2] * a[3] ? b : a), undefined);
  for (const b of venueBuildings) {
    const [cx, cy, w, d, angle] = b;
    const areaM2 = w * d,
      height = b === largest ? 15 : areaM2 > 3000 ? 11 : areaM2 > 600 ? 8 : 5;
    const base = ground.height(cx, -cy);
    const group = new THREE.Group();
    group.position.copy(toWorld(cx, cy, base));
    group.rotation.y = angle;
    world.add(group);
    box(group, mat("#f4f4f4"), 0, height / 2 - 2, 0, w, height + 4, d);
    box(
      group,
      mat(b === largest ? "#f7f9fa" : "#d9dde0"),
      0,
      height + 2.3,
      0,
      w + 1,
      0.6,
      d + 1,
    );
    if (b === largest)
      box(group, mat("#34beed"), 0, height + 1.4, 0, w + 1.2, 1.2, d + 1.2);
    if (b === largest) {
      // Garage doors along the side that faces the pit lane.
      const side =
        [1, -1].find(
          (s) =>
            ground.nearest(
              cx - Math.sin(angle) * s * d * 0.6,
              -(cy + Math.cos(angle) * s * d * 0.6),
            ).distance < 40,
        ) ?? 1;
      const garages = Math.floor(w / 9),
        garageDoor = mat("#3d4a55");
      for (let k = 0; k < garages; k++)
        box(
          group,
          garageDoor,
          -w / 2 + 4.5 + k * 9,
          2.6,
          -side * (d / 2 + 0.05),
          7,
          5.2,
          0.2,
        );
      box(
        group,
        mat("#8fd6f2"),
        0,
        height - 3.5,
        -side * (d / 2 + 0.06),
        w - 4,
        3,
        0.2,
      );
    }
  }

  // The neighbourhoods around the circuit, from the map's footprints.
  const city = venue.buildings.filter(
    (b) => b[5] === 0 && Math.hypot(b[0], b[1]) < radius - 8,
  );
  if (city.length) {
    const walls = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      mat("#ffffff"),
      city.length,
    );
    const roofs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      mat("#ffffff"),
      city.length,
    );
    const wallColors = [
      "#fbfaf6",
      "#f4ead8",
      "#f7e3d6",
      "#e5eef2",
      "#ecf2e4",
      "#f2f2f2",
    ];
    const roofColors = ["#c96f4e", "#b85f45", "#d9d9d9", "#c9c9c9", "#a8b4bc"];
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      c = new THREE.Color(),
      up = v(0, 1, 0);
    city.forEach(([cx, cy, w, d, angle], i) => {
      const r = random(),
        tall = w * d > 600 && r > 0.9;
      const height = tall
        ? 18 + random() * 26
        : r > 0.7
          ? 8 + random() * 5
          : 3.5 + random() * 3;
      const base = ground.height(cx, -cy) - 2;
      q.setFromAxisAngle(up, angle);
      m.compose(
        toWorld(cx, cy, base + (height + 2) / 2),
        q,
        v(w, height + 2, d),
      );
      walls.setMatrixAt(i, m);
      walls.setColorAt(
        i,
        c.set(wallColors[Math.floor(random() * wallColors.length)]),
      );
      m.compose(
        toWorld(cx, cy, base + height + 2.2),
        q,
        v(w + 0.4, 0.5, d + 0.4),
      );
      roofs.setMatrixAt(i, m);
      roofs.setColorAt(
        i,
        c.set(
          roofColors[
            tall
              ? 2 + Math.floor(random() * 3)
              : Math.floor(random() * roofColors.length)
          ],
        ),
      );
    });
    for (const layer of [walls, roofs]) {
      layer.castShadow = true;
      layer.receiveShadow = true;
      layer.computeBoundingSphere();
      world.add(layer);
    }
  }

  // Trackside camera towers stand across from each corner, looking over the
  // track at the grandstands, never over the lake or from inside a stand.
  // Each is placed and raised to see the whole stretch it covers (see below).
  const buildingTop = (x: number, y: number) =>
    Math.max(
      0,
      ...venueBuildings
        .filter((b) => insideRect(x, y, b, 4))
        .map(
          (b) =>
            ground.height(b[0], -b[1]) +
            (b === largest ? 15 : b[2] * b[3] > 3000 ? 11 : 8),
        ),
    );
  const standNear = (p: THREE.Vector3) =>
    plans.some((plan) =>
      plan.front.some(
        (f) => Math.hypot(f.x - p.x, f.z - p.z) < plan.rows * ROW + 12,
      ),
    );
  // Where trees can grow: the mapped ones, the infield woods and a few
  // across the grass, clear of the circuit, its buildings and the stands.
  // The trackside cameras are placed around them below.
  const treeSpots: THREE.Vector3[] = [];
  const spot = (x: number, y: number) => {
    if (Math.hypot(x, y) > radius - 10 || blocked(x, y, 22)) return;
    if (
      plans.some((p) =>
        p.front.some((f) => Math.hypot(f.x - x, -f.z - y) < p.rows * ROW + 8),
      )
    )
      return;
    treeSpots.push(toWorld(x, y, ground.height(x, -y)));
  };
  venue.trees.forEach(([x, y]) => spot(x, y));
  const scatter = (rings: XY[][], spacing: number) => {
    for (const ring of rings) {
      const xs = ring.map((p) => p[0]),
        ys = ring.map((p) => p[1]);
      for (let x = Math.min(...xs); x < Math.max(...xs); x += spacing)
        for (let y = Math.min(...ys); y < Math.max(...ys); y += spacing) {
          const px = x + (random() - 0.5) * spacing,
            py = y + (random() - 0.5) * spacing;
          if (inside(px, py, ring)) spot(px, py);
        }
    }
  };
  scatter(venue.forest, 15);
  scatter(venue.grass, 55);
  if (!venue.venue.length)
    for (let i = 0; i < 900 && treeSpots.length < 200; i++) {
      const a = random() * Math.PI * 2,
        d = Math.sqrt(random()) * radius * 0.93;
      spot(Math.cos(a) * d, Math.sin(a) * d);
    }
  // The tallest a tree can grow (27 m, 9 m in radius) over a point, from the
  // spots in 20 m cells around it.
  const cell = (x: number, z: number) =>
    Math.floor(x / 20) * 4096 + Math.floor(z / 20);
  const treeCells = new Map<number, THREE.Vector3[]>();
  for (const t of treeSpots) {
    const key = cell(t.x, t.z);
    if (!treeCells.has(key)) treeCells.set(key, []);
    treeCells.get(key)!.push(t);
  }
  const treeTop = (x: number, z: number) => {
    let top = -Infinity;
    for (let i = -20; i <= 20; i += 20)
      for (let j = -20; j <= 20; j += 20)
        for (const t of treeCells.get(cell(x + i, z + j)) ?? [])
          if (Math.hypot(t.x - x, t.z - z) < 9.5) top = Math.max(top, t.y + 27);
    return top;
  };

  // Each camera covers more than its corner: the director cuts to the
  // nearest corner's camera and holds it until another is 60 m nearer, so
  // a tower must see that whole stretch of track, over the buildings and the
  // crests (the main straight climbs about 20 m).
  const stationCorners = STATIONS.map(([corner, name, fallback]) => {
    const c = corners.get(corner);
    const s = c
      ? corner === "Arquibancadas"
        ? c.to - 60
        : c.at
      : fallback * length;
    return { name, s, point: at(s).point };
  });
  const views = points
    .filter((_, i) => i % 6 === 0)
    .map((p) => p.clone().setY(p.y + 3));
  const covered = stationCorners.map(() => [] as THREE.Vector3[]);
  for (const view of views) {
    const d = stationCorners.map((c) => c.point.distanceTo(view)),
      nearest = Math.min(...d);
    d.forEach((di, k) => di <= nearest + 60 && covered[k].push(view));
  }
  // How high a lens at `foot` must be to see `view` over the ground and
  // buildings in between, and how high to see over the trees as well.
  const lensFor = (foot: THREE.Vector3, view: THREE.Vector3) => {
    let overBuildings = -Infinity,
      overTrees = -Infinity;
    for (let t = 0.05; t < 0.96; t += 0.05) {
      const x = foot.x + (view.x - foot.x) * t,
        z = foot.z + (view.z - foot.z) * t,
        roof = buildingTop(x, -z),
        top = Math.max(
          ground.height(x, z) + 2,
          roof > 0 ? roof + 4 : -Infinity,
        ),
        need = (h: number) => (h - view.y * t) / (1 - t);
      overBuildings = Math.max(overBuildings, need(top));
      overTrees = Math.max(overTrees, need(Math.max(top, treeTop(x, z) + 1)));
    }
    return [overBuildings, overTrees];
  };
  // The tree spots a camera at `lens` clears: those right around its tower,
  // and any whose crown (at most 9 m in radius and 27 m tall) cuts a
  // sightline to the track it covers.
  const clears = (lens: THREE.Vector3, views: THREE.Vector3[]) => {
    const out = new Set(
      treeSpots.filter(({ x, z }) => Math.hypot(x - lens.x, z - lens.z) < 35),
    );
    for (const view of views) {
      const dx = view.x - lens.x,
        dz = view.z - lens.z,
        span = Math.hypot(dx, dz);
      for (let d = 0; d < span + 15; d += 15) {
        const f = Math.min(d / span, 1);
        for (let i = -20; i <= 20; i += 20)
          for (let j = -20; j <= 20; j += 20)
            for (const tree of treeCells.get(
              cell(lens.x + dx * f + i, lens.z + dz * f + j),
            ) ?? []) {
              if (out.has(tree)) continue;
              const u = THREE.MathUtils.clamp(
                ((tree.x - lens.x) * dx + (tree.z - lens.z) * dz) /
                  (span * span),
                0,
                1,
              );
              if (
                Math.hypot(tree.x - lens.x - dx * u, tree.z - lens.z - dz * u) <
                  9.5 &&
                lens.y + (view.y - lens.y) * u < tree.y + 27
              )
                out.add(tree);
            }
      }
    }
    return out;
  };
  const TALLEST = 60;
  const cleared = new Set<THREE.Vector3>();
  const stations = stationCorners.map(({ name, s, point }, k) => {
    const before = at(s - 25).tangent,
      after = at(s + 25).tangent;
    const turn = after.clone().sub(before).dot(right(before));
    const inward = right(at(s).tangent).multiplyScalar(turn > 0.05 ? 1 : -1);
    const along = at(s).tangent;
    // Spots across from the corner, further back and along it, each with a
    // tower just tall enough to see over the buildings (clearing the trees in
    // its way) or over the trees as well. The best sees all of its stretch
    // while losing the fewest trees for the least extra height, with a
    // little preference for the original spots straight across.
    const candidates = [55, 75, -55, -75, 95, -95].flatMap((d) =>
      [0, -40, 40].map((a) =>
        Object.assign(
          point.clone().addScaledVector(inward, d).addScaledVector(along, a),
          { penalty: a === 0 && Math.abs(d) < 90 ? 0 : 6 },
        ),
      ),
    );
    const usable = candidates.filter((p) => {
      if (standNear(p) || ground.nearest(p.x, p.z, true).distance < 30)
        return false;
      for (let t = 0; t <= 1; t += 0.1)
        if (
          venue.water.some((r) =>
            inside(p.x + (point.x - p.x) * t, -(p.z + (point.z - p.z) * t), r),
          )
        )
          return false;
      return true;
    });
    let best = {
      foot: candidates[0].clone(),
      lens: candidates[0].clone(),
      clears: new Set<THREE.Vector3>(),
      score: Infinity,
    };
    for (const foot of usable.length ? usable : [candidates[0]]) {
      foot.y = ground.height(foot.x, foot.z);
      const toward = point.clone().sub(foot).setY(0).normalize();
      const needs = covered[k].map((view) => lensFor(foot, view)),
        overBuildings = needs.map(([b]) => b);
      for (const option of [overBuildings, needs.map(([, t]) => t)]) {
        const height = Math.min(
          foot.y + TALLEST,
          Math.max(foot.y + 24, ...option.filter((n) => n < foot.y + TALLEST)),
        );
        const lens = foot.clone().addScaledVector(toward, 3.5).setY(height);
        const lost = clears(lens, covered[k]);
        const score =
          overBuildings.filter((n) => n > height).length * 100 +
          lost.size * 1.5 +
          (height - foot.y - 24) +
          foot.penalty;
        if (score < best.score)
          best = { foot: foot.clone(), lens, clears: lost, score };
      }
    }
    const { foot, lens } = best;
    best.clears.forEach((tree) => cleared.add(tree));
    const tower = new THREE.Group();
    tower.position.copy(foot);
    const pole = lens.y - foot.y - 3;
    box(tower, mat("#ffffff"), 0, pole / 2, 0, 2, pole, 2);
    box(tower, mat("#34beed"), 0, pole + 0.5, 0, 5, 3, 3);
    world.add(tower);
    // The lens sits just ahead of the camera housing, facing the track.
    return { position: lens, name, point };
  });

  // Trees: every spot that is not in a trackside camera's way.
  const treePoints = treeSpots
    .filter((tree) => !cleared.has(tree))
    .slice(0, 900);
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1.3, 1.9, 10, 6),
    mat("#9a6a3c"),
    treePoints.length,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(9, 1),
    mat("#3c9a38"),
    treePoints.length,
  );
  const tops = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(6.5, 1),
    mat("#68bd42"),
    treePoints.length,
  );
  treePoints.forEach((p, i) => {
    const scale = 0.5 + random() * 0.5,
      q = new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), random() * 6.28),
      s = v(scale, scale, scale);
    trunks.setMatrixAt(
      i,
      new THREE.Matrix4().compose(p.clone().setY(p.y + 4 * scale), q, s),
    );
    crowns.setMatrixAt(
      i,
      new THREE.Matrix4().compose(p.clone().setY(p.y + 12 * scale), q, s),
    );
    tops.setMatrixAt(
      i,
      new THREE.Matrix4().compose(p.clone().setY(p.y + 20 * scale), q, s),
    );
  });
  for (const obj of [trunks, crowns, tops]) {
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.computeBoundingSphere();
    world.add(obj);
  }

  const cloudMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
    40,
  );
  for (let i = 0; i < 40; i++) {
    const angle = Math.floor(i / 4) * 0.628;
    cloudMesh.setMatrixAt(
      i,
      new THREE.Matrix4().compose(
        v(
          Math.cos(angle) * (radius + 150) + (i % 4) * 35,
          180 + ground.max + (i % 3) * 15,
          Math.sin(angle) * (radius + 150),
        ),
        new THREE.Quaternion(),
        v(45, 22, 27),
      ),
    );
  }
  world.add(cloudMesh);

  const crowdTime = { value: 0 };
  const spectators = crowd(seats, scene, crowdTime);
  return { ground, stations, crowdTime, spectators };
}
