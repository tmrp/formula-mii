import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import type { Driver } from "./types";

// Colour tables from Nintendo's Mii library. The Wii's six skin tones, eight
// hair colours, six eye colours and twelve favourite colours carried over
// unchanged to later systems.
export const SKIN = [
  "#ffd3ad",
  "#ffb66b",
  "#de7942",
  "#ffaa8c",
  "#ad5129",
  "#632c18",
];
export const HAIR = [
  "#1e1a18",
  "#382015",
  "#552617",
  "#704024",
  "#727278",
  "#49361a",
  "#7a5928",
  "#c19f62",
];
const EYE = ["#000000", "#6c7070", "#663c2c", "#605e30", "#4c5ea8", "#386c58"];
const FAVORITE = [
  "#d21e14",
  "#ff6e19",
  "#ffd820",
  "#78d220",
  "#007830",
  "#0a48b4",
  "#3caade",
  "#f55a7d",
  "#7328ad",
  "#483818",
  "#e0e0e0",
  "#181814",
];

export type HairStyle =
  | "short"
  | "swept"
  | "quiff"
  | "crop"
  | "curly"
  | "tousled"
  | "wavy"
  | "bob"
  | "braids";
type EyeStyle = "oval" | "round" | "almond";
type BrowStyle = "arch" | "flat" | "bold" | "soft";
type MouthStyle = "smile" | "grin" | "line" | "smirk";
type Beard = "none" | "stubble" | "full" | "mustache" | "goatee";

export interface Mii {
  skin: string;
  hair: string;
  eyeColor: string;
  hairStyle: HairStyle;
  /** Which side a fringe or parting falls to; 1 or -1. */
  part: number;
  eyes: EyeStyle;
  brows: BrowStyle;
  mouth: MouthStyle;
  beard: Beard;
  /** Shirt and racing-suit colour, as in Mario Kart Wii. */
  favorite: string;
}

interface Look {
  skin: number;
  hair: number;
  style: HairStyle;
  part?: number;
  eyes?: EyeStyle;
  eye?: number;
  brows?: BrowStyle;
  mouth?: MouthStyle;
  beard?: Beard;
}

// Each 2025 grid driver, made the way a player would build them in the Mii Channel.
const LOOKS: Record<number, Look> = {
  // Max Verstappen: light brown hair combed up, blue eyes, straight brows.
  1: {
    skin: 0,
    hair: 3,
    style: "quiff",
    eyes: "round",
    eye: 4,
    brows: "flat",
    mouth: "smirk",
  },
  // Lando Norris: fluffy dark brown top and a big grin.
  4: { skin: 0, hair: 1, style: "wavy", eyes: "oval", mouth: "grin" },
  // Gabriel Bortoleto: dark fringe falling to the side, dark brows.
  5: {
    skin: 0,
    hair: 1,
    style: "swept",
    part: -1,
    brows: "bold",
    mouth: "smile",
  },
  // Isack Hadjar: short black curls.
  6: {
    skin: 0,
    hair: 0,
    style: "curly",
    eyes: "almond",
    brows: "bold",
    mouth: "grin",
  },
  // Pierre Gasly: dark quiff and stubble.
  10: {
    skin: 0,
    hair: 1,
    style: "quiff",
    eyes: "almond",
    mouth: "smile",
    beard: "stubble",
  },
  // Kimi Antonelli: wavy dark hair, brown eyes, youthful smile.
  12: {
    skin: 0,
    hair: 1,
    style: "wavy",
    part: -1,
    eyes: "round",
    eye: 2,
    brows: "bold",
    mouth: "smile",
  },
  // Fernando Alonso: dark hair, short full beard, broad grin.
  14: {
    skin: 0,
    hair: 1,
    style: "short",
    eyes: "almond",
    brows: "bold",
    mouth: "grin",
    beard: "full",
  },
  // Charles Leclerc: wavy brown top, green eyes, light stubble.
  16: {
    skin: 0,
    hair: 1,
    style: "wavy",
    eye: 5,
    mouth: "smile",
    beard: "stubble",
  },
  // Lance Stroll: dark side-swept hair, stubble.
  18: {
    skin: 0,
    hair: 1,
    style: "swept",
    brows: "flat",
    mouth: "line",
    beard: "stubble",
  },
  // Yuki Tsunoda: black hair with a heavy fringe, big smile.
  22: { skin: 0, hair: 0, style: "tousled", brows: "soft", mouth: "grin" },
  // Alex Albon: short black hair, warm smile.
  23: {
    skin: 0,
    hair: 0,
    style: "short",
    eyes: "round",
    eye: 2,
    mouth: "grin",
  },
  // Nico Hülkenberg: blond, combed up, blue eyes.
  27: {
    skin: 0,
    hair: 7,
    style: "quiff",
    eyes: "almond",
    eye: 4,
    brows: "soft",
  },
  // Liam Lawson: messy light brown hair, blue eyes.
  30: {
    skin: 0,
    hair: 6,
    style: "tousled",
    part: -1,
    eye: 4,
    brows: "soft",
    mouth: "grin",
  },
  // Esteban Ocon: close-cropped dark hair.
  31: { skin: 0, hair: 1, style: "crop", eyes: "almond", mouth: "smile" },
  // Franco Colapinto: big brown curls.
  43: {
    skin: 0,
    hair: 3,
    style: "curly",
    eyes: "round",
    eye: 2,
    mouth: "smile",
  },
  // Lewis Hamilton: braids tied back, moustache and chin beard.
  44: {
    skin: 4,
    hair: 0,
    style: "braids",
    eyes: "almond",
    brows: "bold",
    mouth: "smirk",
    beard: "goatee",
  },
  // Carlos Sainz: dark hair swept with volume, light stubble.
  55: {
    skin: 0,
    hair: 1,
    style: "swept",
    part: -1,
    eyes: "almond",
    brows: "bold",
    beard: "stubble",
  },
  // George Russell: brown side parting, blue eyes, wide smile.
  63: { skin: 0, hair: 3, style: "swept", eye: 4, mouth: "grin" },
  // Oscar Piastri: short brown hair and his famous deadpan.
  81: { skin: 0, hair: 1, style: "short", brows: "flat", mouth: "line" },
  // Oliver Bearman: dark brown fringe, big grin.
  87: { skin: 0, hair: 1, style: "swept", eyes: "round", mouth: "grin" },
};
const STYLES: HairStyle[] = ["short", "swept", "quiff", "crop", "tousled"];
const ASYMMETRIC: HairStyle[] = ["swept", "tousled", "wavy"];

/** Miis only come in twelve favourite colours, so team colours snap to the nearest. */
const rgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
};
function favoriteColor(hex: string) {
  const [r, g, b] = rgb(hex || "ff6e19");
  let best = FAVORITE[1],
    distance = Infinity;
  for (const f of FAVORITE) {
    // "Redmean" distance in sRGB, a cheap approximation of perceived difference.
    const [fr, fg, fb] = rgb(f),
      mean = (r + fr) / 2,
      d =
        (2 + mean) * (r - fr) ** 2 +
        4 * (g - fg) ** 2 +
        (3 - mean) * (b - fb) ** 2;
    if (d < distance) {
      distance = d;
      best = f;
    }
  }
  return best;
}

export function miiFor(driver: Driver): Mii {
  const n = driver.driver_number;
  const look: Look = LOOKS[n] ?? {
    skin: n % 7 === 3 ? 1 : 0,
    hair: n % 4,
    style: STYLES[n % STYLES.length],
    part: n % 2 ? 1 : -1,
  };
  return {
    skin: SKIN[look.skin],
    hair: HAIR[look.hair],
    eyeColor: EYE[look.eye ?? 0],
    hairStyle: look.style,
    part: ASYMMETRIC.includes(look.style) ? (look.part ?? 1) : 1,
    eyes: look.eyes ?? "oval",
    brows: look.brows ?? "arch",
    mouth: look.mouth ?? "smile",
    beard: look.beard ?? "none",
    favorite: favoriteColor(driver.team_colour),
  };
}

export const hairKey = (m: Mii) => `${m.hairStyle}:${m.part}`;

/** Hairstyles a crowd is made from, in rough order of popularity. */
export const CROWD_STYLES: HairStyle[] = [
  "short",
  "bob",
  "swept",
  "wavy",
  "crop",
  "curly",
  "quiff",
  "tousled",
];
// A São Paulo crowd: the full range of Mii skin tones, and a lot of Brazil
// yellow and green among the favourite colours.
const CROWD_SKIN = [0, 0, 0, 1, 2, 2, 3, 4, 4, 5];
const CROWD_FAVORITE = [2, 2, 2, 4, 4, 4, 0, 1, 5, 6, 3, 7, 8, 9, 10, 11];

export function randomMii(random: () => number): Mii {
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(random() * list.length) % list.length];
  const hairStyle = pick(CROWD_STYLES);
  return {
    skin: SKIN[pick(CROWD_SKIN)],
    hair: HAIR[random() < 0.08 ? 4 : pick([0, 0, 1, 1, 2, 3, 5, 6, 7])],
    eyeColor: EYE[random() < 0.75 ? 0 : pick([1, 2, 3, 4, 5])],
    hairStyle,
    part: ASYMMETRIC.includes(hairStyle) && random() < 0.5 ? -1 : 1,
    eyes: pick(["oval", "oval", "round", "almond"] as const),
    brows: pick(["arch", "flat", "bold", "soft"] as const),
    mouth: pick(["smile", "smile", "grin", "grin", "line", "smirk"] as const),
    beard:
      hairStyle === "bob"
        ? "none"
        : pick([
            "none",
            "none",
            "none",
            "none",
            "stubble",
            "mustache",
            "full",
          ] as const),
    favorite: FAVORITE[pick(CROWD_FAVORITE)],
  };
}

// ---------------------------------------------------------------------------
// Head and hair geometry. Everything is in head-local units with the head
// centre at the origin, facing +z.

const dir = (theta: number, phi: number, target = new THREE.Vector3()) =>
  target.set(
    Math.sin(theta) * Math.sin(phi),
    Math.cos(theta),
    Math.sin(theta) * Math.cos(phi),
  );

/** Maps a unit direction onto the Mii faceline: a round crown and a tapered jaw. */
function headPoint(d: THREE.Vector3, target = new THREE.Vector3()) {
  let { x, y, z } = d;
  if (y < 0) {
    const t = Math.pow(-y, 1.8);
    x *= 1 - 0.26 * t;
    z *= 1 - 0.14 * t;
    y *= 1.08;
  }
  return target.set(x, y, z * 0.92);
}

export function headGeometry(radius: number, detail = 32) {
  const sphere = new THREE.SphereGeometry(1, detail, Math.round(detail * 0.75));
  sphere.deleteAttribute("uv");
  sphere.deleteAttribute("normal");
  const p = sphere.attributes.position,
    point = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    headPoint(point.fromBufferAttribute(p, i).normalize(), point);
    point.multiplyScalar(radius);
    p.setXYZ(i, point.x, point.y, point.z);
  }
  const head = mergeVertices(sphere);
  sphere.dispose();
  head.computeVertexNormals();
  return head;
}

export function earGeometry(radius: number) {
  return mergeGeometries(
    [-1, 1].map((side) => {
      const ear = new THREE.SphereGeometry(radius * 0.2, 12, 10);
      ear.scale(0.5, 1, 0.78);
      ear.rotateY(side * 0.35);
      ear.translate(side * radius * 0.97, -radius * 0.04, -radius * 0.05);
      return ear;
    }),
  )!;
}

// The face decal is a thin shell over the front of the head. Its UVs are a
// planar projection, so the face texture is drawn as if looking straight on.
const FACE_SIZE = 1.05;
const FACE_Y = -0.12;

export function faceGeometry(radius: number, detail = 28, lift = 1.012) {
  const cols = detail,
    rows = detail,
    positions: number[] = [],
    uvs: number[] = [],
    index: number[] = [];
  const point = new THREE.Vector3();
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const theta = THREE.MathUtils.lerp(
          0.2 * Math.PI,
          0.92 * Math.PI,
          j / rows,
        ),
        phi = THREE.MathUtils.lerp(-0.47 * Math.PI, 0.47 * Math.PI, i / cols);
      headPoint(dir(theta, phi, point), point).multiplyScalar(radius * lift);
      positions.push(point.x, point.y, point.z);
      uvs.push(
        0.5 + point.x / (2 * FACE_SIZE * radius),
        0.5 + (point.y - FACE_Y * radius) / (2 * FACE_SIZE * radius),
      );
      if (i < cols && j < rows) {
        const a = j * (cols + 1) + i,
          b = a + 1,
          c = a + cols + 1,
          d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Hairline, as polar angle (fraction of PI) against azimuth from the front
// (fraction of PI): forehead, temple, sideburn, over the ear, then the nape.
const HAIRLINE: [number, number][] = [
  [0, 0.31],
  [0.2, 0.34],
  [0.33, 0.42],
  [0.37, 0.55],
  [0.41, 0.55],
  [0.44, 0.43],
  [0.58, 0.43],
  [0.66, 0.6],
  [1, 0.71],
];
function baseHairline(phi: number) {
  const a = Math.abs(phi) / Math.PI;
  for (let k = 1; k < HAIRLINE.length; k++) {
    const [a0, t0] = HAIRLINE[k - 1],
      [a1, t1] = HAIRLINE[k];
    if (a <= a1) return Math.PI * (t0 + (t1 - t0) * smooth(a0, a1, a));
  }
  return Math.PI * 0.71;
}
const crown = (theta: number) =>
  theta < Math.PI / 2 ? Math.cos(theta) ** 2 : 0;

interface HairShape {
  line: (phi: number) => number;
  thick: (theta: number, phi: number, p: THREE.Vector3) => number;
}
const PI = Math.PI;
const SHAPES: Record<HairStyle, HairShape> = {
  short: {
    line: baseHairline,
    thick: (t) => 0.075 + 0.06 * crown(t),
  },
  crop: {
    line: (phi) => baseHairline(phi) - 0.01 * PI,
    thick: (t) => 0.035 + 0.012 * crown(t),
  },
  swept: {
    line: (phi) =>
      baseHairline(phi) +
      0.055 *
        PI *
        smooth(0.3 * PI, -0.22 * PI, phi) *
        (1 - smooth(0.26 * PI, 0.36 * PI, Math.abs(phi))),
    thick: (t, phi) =>
      0.09 +
      0.08 * crown(t) +
      0.07 * Math.exp(-(((phi + 0.1 * PI) / (0.3 * PI)) ** 2)) * crown(t) -
      0.05 *
        Math.exp(-(((phi - 0.2 * PI) / (0.035 * PI)) ** 2)) *
        (t < 0.36 * PI ? 1 : 0),
  },
  quiff: {
    line: (phi) => baseHairline(phi) + 0.01 * PI,
    thick: (t, phi) =>
      0.07 +
      0.05 * crown(t) +
      0.38 *
        Math.exp(
          -(((t - 0.22 * PI) / (0.1 * PI)) ** 2) - (phi / (0.3 * PI)) ** 2,
        ),
  },
  curly: {
    line: (phi) => baseHairline(phi) + 0.03 * PI * Math.sin(10 * phi) ** 2,
    thick: (t, phi) =>
      0.15 +
      0.05 * crown(t) +
      0.045 * Math.sin(11 * phi + 2 * t) * Math.sin(13 * t),
  },
  tousled: {
    line: (phi) => {
      const a = Math.abs(phi) / PI;
      return (
        baseHairline(phi) +
        (a < 0.3
          ? 0.06 * PI * Math.abs(Math.sin(8 * phi + 0.6)) * (1 - a / 0.3)
          : 0)
      );
    },
    thick: (t, phi) =>
      0.12 +
      0.07 * crown(t) +
      0.07 * Math.max(0, Math.sin(9 * phi) * Math.sin(7 * t)) ** 2,
  },
  wavy: {
    // A loose, wavy top with a fringe that falls off to one side.
    line: (phi) =>
      baseHairline(phi) +
      0.04 *
        PI *
        smooth(0.25 * PI, -0.2 * PI, phi) *
        (1 - smooth(0.24 * PI, 0.34 * PI, Math.abs(phi))) +
      0.02 * PI * Math.sin(9 * phi) ** 2 * (Math.abs(phi) < 0.3 * PI ? 1 : 0),
    thick: (t, phi) =>
      0.1 +
      0.12 * crown(t) +
      0.035 * Math.sin(7 * phi + 5 * t) * Math.sin(8 * t) * crown(t),
  },
  bob: {
    line: (phi) => {
      const a = Math.abs(phi) / PI;
      return (
        PI * (0.37 + 0.4 * smooth(0.22, 0.42, a) - 0.02 * smooth(0.6, 1, a))
      );
    },
    thick: (t) => 0.11 + 0.07 * crown(t),
  },
  braids: {
    line: (phi) => baseHairline(phi) - 0.015 * PI,
    // Cornrows run front to back, so the ridges follow the side-to-side position.
    thick: (t, _phi, p) =>
      0.035 +
      0.045 * Math.abs(Math.sin(p.x * 12)) ** 0.5 * (t < 0.62 * PI ? 1 : 0.4),
  },
};

export function hairGeometry(
  style: HairStyle,
  part: number,
  radius: number,
  cols = 96,
  rows = 22,
) {
  const shape = SHAPES[style],
    positions: number[] = [],
    index: number[] = [],
    d = new THREE.Vector3(),
    point = new THREE.Vector3();
  // Two extra rows fold the shell edge back onto the scalp so the hair reads as solid.
  const rim = [
    [0.012 * PI, 0.45],
    [0.02 * PI, -0.02],
  ];
  for (let j = 0; j <= rows + rim.length; j++)
    for (let i = 0; i < cols; i++) {
      const phi = -PI + (2 * PI * i) / cols,
        mirrored = phi * part,
        line = shape.line(mirrored);
      const theta = j <= rows ? (line * j) / rows : line + rim[j - rows - 1][0];
      dir(theta, phi, d);
      let thick = shape.thick(Math.min(theta, line), mirrored, d);
      if (j <= rows) thick *= 1 - 0.35 * smooth(0.8, 1, j / rows);
      else thick = rim[j - rows - 1][1] * thick;
      headPoint(d, point).multiplyScalar(radius * (1.02 + thick));
      positions.push(point.x, point.y, point.z);
      if (j < rows + rim.length) {
        const a = j * cols + i,
          b = j * cols + ((i + 1) % cols),
          c = a + cols,
          e = b + cols;
        index.push(a, c, b, b, c, e);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  if (style !== "braids") return g;
  // Braids gathered into a bun at the back, with a few hanging below it.
  const braids = [g];
  const bun = new THREE.SphereGeometry(radius * 0.36, 16, 12);
  bun.deleteAttribute("uv");
  headPoint(dir(0.42 * PI, PI, d), point).multiplyScalar(radius * 1.12);
  bun.translate(point.x, point.y, point.z);
  braids.push(bun);
  for (let k = -2; k <= 2; k++) {
    const braid = new THREE.CapsuleGeometry(radius * 0.06, radius * 0.75, 3, 8);
    braid.deleteAttribute("uv");
    braid.rotateX(-0.35);
    braid.translate(
      point.x + k * radius * 0.11,
      point.y - radius * 0.5,
      point.z - radius * 0.12,
    );
    braids.push(braid);
  }
  const merged = mergeGeometries(braids)!;
  braids.forEach((b) => b.dispose());
  return merged;
}

// ---------------------------------------------------------------------------
// Face texture. Mii eyes, brows, nose line, mouth and facial hair are flat
// parts composited onto the face, so they are drawn here in 2D.

export interface FaceAtlas {
  texture: THREE.CanvasTexture;
  cols: number;
  rows: number;
  /** UV offset of a driver's cell. */
  offset: (i: number) => [number, number];
}

const CELL = 256;
const INK = "#2a1a14";

function darken(hex: string, amount: number) {
  return `#${new THREE.Color(hex).multiplyScalar(1 - amount).getHexString()}`;
}

function eye(ctx: CanvasRenderingContext2D, m: Mii, x: number, side: number) {
  const iris = m.eyeColor === "#000000" ? "#161210" : m.eyeColor;
  ctx.save();
  ctx.translate(x, 0.02);
  if (m.eyes === "oval") {
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.085, 0.118, 0, 0, Math.PI * 2);
    ctx.fill();
    if (m.eyeColor !== "#000000") {
      ctx.fillStyle = "#120d0b";
      ctx.beginPath();
      ctx.ellipse(0, -0.006, 0.045, 0.065, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.026;
    ctx.beginPath();
    ctx.moveTo(-side * 0.08, 0.075);
    ctx.quadraticCurveTo(side * 0.01, 0.16, side * 0.105, 0.075);
    ctx.lineTo(side * 0.14, 0.108);
    ctx.stroke();
  } else {
    const almond = m.eyes === "almond";
    const outline = () => {
      ctx.beginPath();
      if (almond) {
        ctx.moveTo(-side * 0.125, -0.005);
        ctx.quadraticCurveTo(side * 0.0, 0.135, side * 0.135, 0.02);
        ctx.quadraticCurveTo(side * 0.01, -0.1, -side * 0.125, -0.005);
      } else ctx.ellipse(0, 0, 0.108, 0.108, 0, 0, Math.PI * 2);
    };
    outline();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.save();
    outline();
    ctx.clip();
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(-side * 0.012, almond ? 0.008 : -0.004, 0.068, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f0b0a";
    ctx.beginPath();
    ctx.arc(-side * 0.012, almond ? 0.008 : -0.004, 0.036, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    outline();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.02;
    ctx.stroke();
    // A heavier upper lid with the little outward flick Mii eyes have.
    ctx.lineWidth = 0.036;
    ctx.beginPath();
    if (almond) {
      ctx.moveTo(-side * 0.125, -0.005);
      ctx.quadraticCurveTo(side * 0.0, 0.135, side * 0.135, 0.02);
      ctx.lineTo(side * 0.165, 0.05);
    } else {
      ctx.arc(
        0,
        0,
        0.108,
        side > 0 ? Math.PI * 0.95 : Math.PI * 0.05,
        side > 0 ? Math.PI * 0.1 : Math.PI * 0.9,
        side > 0,
      );
      ctx.lineTo(side * 0.15, 0.055);
    }
    ctx.stroke();
  }
  // The glint sits up and to the left on both eyes.
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(-0.03, 0.045, 0.024, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function brow(ctx: CanvasRenderingContext2D, m: Mii, x: number, side: number) {
  const y = 0.3;
  ctx.strokeStyle = ctx.fillStyle = darken(
    m.hair,
    m.hair === HAIR[7] ? 0.25 : 0.05,
  );
  ctx.beginPath();
  if (m.brows === "bold") {
    ctx.moveTo(x - side * 0.13, y - 0.025);
    ctx.lineTo(x - side * 0.135, y + 0.035);
    ctx.quadraticCurveTo(x + side * 0.02, y + 0.08, x + side * 0.16, y + 0.015);
    ctx.quadraticCurveTo(
      x + side * 0.02,
      y + 0.025,
      x - side * 0.13,
      y - 0.025,
    );
    ctx.lineWidth = 0.018;
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (m.brows === "flat") {
    ctx.moveTo(x - side * 0.13, y + 0.01);
    ctx.quadraticCurveTo(x, y + 0.04, x + side * 0.14, y + 0.012);
    ctx.lineWidth = 0.05;
  } else {
    ctx.moveTo(x - side * 0.12, y - 0.005);
    ctx.quadraticCurveTo(x, y + 0.075, x + side * 0.14, y + 0.0);
    ctx.lineWidth = m.brows === "soft" ? 0.032 : 0.042;
  }
  ctx.stroke();
}

function mouth(ctx: CanvasRenderingContext2D, m: Mii) {
  const y = -0.56;
  ctx.strokeStyle = "#5a2118";
  ctx.lineWidth = 0.028;
  ctx.beginPath();
  if (m.mouth === "grin") {
    ctx.moveTo(-0.18, y + 0.04);
    ctx.quadraticCurveTo(0, y + 0.0, 0.18, y + 0.04);
    ctx.quadraticCurveTo(0, y - 0.19, -0.18, y + 0.04);
    ctx.fillStyle = "#9b2c22";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-0.2, y - 0.03, 0.4, 0.08);
    ctx.restore();
    ctx.stroke();
    return;
  }
  if (m.mouth === "line") {
    ctx.moveTo(-0.13, y);
    ctx.quadraticCurveTo(0, y - 0.012, 0.13, y);
  } else if (m.mouth === "smirk") {
    ctx.moveTo(-0.15, y - 0.01);
    ctx.quadraticCurveTo(0.02, y - 0.05, 0.16, y + 0.04);
  } else {
    ctx.moveTo(-0.17, y + 0.03);
    ctx.quadraticCurveTo(0, y - 0.1, 0.17, y + 0.03);
  }
  ctx.stroke();
}

// Facial hair sits on the jaw, so it is drawn in unscaled face units around
// the scaled-up mouth (y = -0.77) and nose (bottom at y = -0.44).
function beard(ctx: CanvasRenderingContext2D, m: Mii) {
  if (m.beard === "none") return;
  const random = (() => {
    let seed = 7;
    return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  })();
  ctx.save();
  ctx.beginPath();
  ctx.rect(-1.1, -1.4, 2.2, 0.94);
  ctx.clip();
  if (m.beard === "stubble") {
    // A soft shadow over the jaw and chin with a fine stipple.
    const shade = ctx.createRadialGradient(0, -0.86, 0.15, 0, -0.86, 0.82);
    shade.addColorStop(0, `${m.hair}50`);
    shade.addColorStop(0.75, `${m.hair}3a`);
    shade.addColorStop(1, `${m.hair}00`);
    ctx.fillStyle = shade;
    ctx.fillRect(-1.1, -1.4, 2.2, 1);
    ctx.fillStyle = m.hair;
    ctx.globalAlpha = 0.3;
    for (let k = 0; k < 700; k++) {
      const px = random() * 1.5 - 0.75,
        py = -0.48 - random() * 0.7;
      if ((px / 0.75) ** 2 + ((py + 0.86) / 0.42) ** 2 < 1)
        ctx.fillRect(px, py, 0.009, 0.009);
    }
    ctx.restore();
    return;
  }
  ctx.fillStyle = m.hair;
  if (m.beard === "full") {
    // Short full beard over the jaw and chin, leaving the lips clear.
    ctx.beginPath();
    ctx.ellipse(0, -0.82, 0.88, 0.5, 0, 0, Math.PI * 2);
    ctx.ellipse(0, -0.78, 0.27, 0.085, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.82;
    ctx.fill("evenodd");
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // Moustache between the nose and the mouth.
  ctx.fillStyle = m.hair;
  ctx.beginPath();
  ctx.moveTo(-0.25, -0.67);
  ctx.quadraticCurveTo(0, -0.53, 0.25, -0.67);
  ctx.quadraticCurveTo(0, -0.61, -0.25, -0.67);
  ctx.fill();
  if (m.beard === "goatee") {
    // Chin beard below the lower lip.
    ctx.beginPath();
    ctx.moveTo(-0.27, -0.93);
    ctx.quadraticCurveTo(0, -0.85, 0.27, -0.93);
    ctx.quadraticCurveTo(0.23, -1.08, 0, -1.1);
    ctx.quadraticCurveTo(-0.23, -1.08, -0.27, -0.93);
    ctx.fill();
  }
}

function nose(ctx: CanvasRenderingContext2D) {
  // The classic Mii nose: a soft shadow and a hooked line.
  const shadow = ctx.createRadialGradient(0, -0.3, 0, 0, -0.3, 0.1);
  shadow.addColorStop(0, "rgba(120,60,30,0.18)");
  shadow.addColorStop(1, "rgba(120,60,30,0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(-0.12, -0.42, 0.24, 0.24);
  ctx.strokeStyle = "rgba(48,24,16,0.85)";
  ctx.lineWidth = 0.024;
  ctx.beginPath();
  ctx.moveTo(-0.005, -0.13);
  ctx.bezierCurveTo(-0.06, -0.2, -0.075, -0.29, -0.025, -0.31);
  ctx.quadraticCurveTo(0.025, -0.325, 0.052, -0.288);
  ctx.stroke();
}

function drawFace(ctx: CanvasRenderingContext2D, m: Mii) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  beard(ctx, m);
  // Mii parts are big for the face; draw them scaled up around the nose.
  ctx.save();
  ctx.translate(0, -0.3);
  ctx.scale(1.3, 1.3);
  ctx.translate(0, 0.2);
  for (const side of [-1, 1]) {
    eye(ctx, m, side * 0.34, side);
    brow(ctx, m, side * 0.36, side);
  }
  nose(ctx);
  mouth(ctx, m);
  ctx.restore();
}

export function faceAtlas(miis: Mii[], cell = CELL): FaceAtlas {
  const cols = Math.min(5, miis.length),
    rows = Math.ceil(miis.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d")!;
  const scale = cell / 2 / FACE_SIZE;
  miis.forEach((m, i) => {
    const x = (i % cols) * cell,
      y = Math.floor(i / cols) * cell;
    // Head units, y up, centred on the decal.
    ctx.setTransform(
      scale,
      0,
      0,
      -scale,
      x + cell / 2,
      y + cell / 2 + FACE_Y * scale,
    );
    drawFace(ctx, m);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return {
    texture,
    cols,
    rows,
    offset: (i) => [(i % cols) / cols, 1 - (Math.floor(i / cols) + 1) / rows],
  };
}

/**
 * Lifts a material by a fraction of its own (instance) colour, like the flat
 * ambient Wii games light Miis with, so they stay bright in any scene.
 */
export function miiGlow<T extends THREE.Material>(
  material: T,
  amount = 0.32,
): T {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${amount.toFixed(3)};`,
    );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|mii-glow-${amount}`;
  return material;
}

/**
 * Face material for instanced heads. Each instance carries the UV offset of
 * its driver's cell in the atlas.
 */
export function instancedFaceMaterial(atlas: FaceAtlas) {
  const material = new THREE.MeshStandardMaterial({
    map: atlas.texture,
    transparent: true,
    depthWrite: false,
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 faceCell;",
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\nvMapUv = faceCell + clamp(uv, 0.01, 0.99) * vec2(${(1 / atlas.cols).toFixed(6)}, ${(1 / atlas.rows).toFixed(6)});`,
      );
  };
  material.customProgramCacheKey = () => `mii-face-${atlas.cols}x${atlas.rows}`;
  return miiGlow(material);
}

// ---------------------------------------------------------------------------
// Icons. Like the Wii's own Mii icons, these are renders of the 3D Mii.

export function miiPortraits(
  miis: Mii[],
  atlas: FaceAtlas,
  size = 160,
): string[] {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: document.createElement("canvas"),
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
  } catch {
    return miis.map(() => "");
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#d8c8b8", 2.1));
  const key = new THREE.DirectionalLight("#ffffff", 2.3);
  key.position.set(-3, 4, 8);
  const rimLight = new THREE.DirectionalLight("#ffffff", 0.8);
  rimLight.position.set(4, 2, -5);
  scene.add(key, rimLight);
  const camera = new THREE.PerspectiveCamera(21, 1, 1, 50);
  camera.position.set(0, 0.1, 10);
  camera.lookAt(0, -0.25, 0);
  const geometries = {
    head: headGeometry(1, 40),
    ears: earGeometry(1),
    face: faceGeometry(1),
    neck: new THREE.CylinderGeometry(0.3, 0.34, 0.7, 16).translate(
      0,
      -1.2,
      -0.08,
    ),
    body: new THREE.SphereGeometry(1, 32, 20)
      .scale(1.3, 0.95, 0.82)
      .translate(0, -2.05, -0.1),
  };
  const hairs = new Map<string, THREE.BufferGeometry>();
  const materials: THREE.Material[] = [];
  const urls = miis.map((m, i) => {
    const key = hairKey(m);
    if (!hairs.has(key)) hairs.set(key, hairGeometry(m.hairStyle, m.part, 1));
    const standard = (
      color: string,
      roughness: number,
      side: THREE.Side = THREE.FrontSide,
    ) => {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness,
        side,
      });
      materials.push(material);
      return material;
    };
    const skin = standard(m.skin, 0.62);
    const map = atlas.texture.clone();
    map.repeat.set(1 / atlas.cols, 1 / atlas.rows);
    map.offset.set(...atlas.offset(i));
    const face = new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthWrite: false,
      roughness: 0.62,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    materials.push(face);
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(geometries.head, skin),
      new THREE.Mesh(geometries.ears, skin),
      new THREE.Mesh(geometries.neck, skin),
      new THREE.Mesh(geometries.body, standard(m.favorite, 0.7)),
      new THREE.Mesh(hairs.get(key)!, standard(m.hair, 0.5, THREE.DoubleSide)),
      new THREE.Mesh(geometries.face, face),
    );
    scene.add(group);
    renderer.render(scene, camera);
    scene.remove(group);
    map.dispose();
    return renderer.domElement.toDataURL("image/png");
  });
  [...Object.values(geometries), ...hairs.values()].forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  renderer.dispose();
  renderer.forceContextLoss();
  return urls;
}
