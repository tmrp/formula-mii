import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Metadata, CameraMode, Driver } from "./types";
import {
  earGeometry,
  faceAtlas,
  faceGeometry,
  hairGeometry,
  hairKey,
  headGeometry,
  instancedFaceMaterial,
  miiFor,
  miiGlow,
  type FaceAtlas,
  type HairStyle,
  type Mii,
} from "./mii";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const mat = (color: THREE.ColorRepresentation) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
function mesh(
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
function box(
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
// Car parts are merged per role. Each role becomes one instanced layer, and
// every driver gets that layer's colour from their team or their Mii.
class Parts {
  private geometries = new Map<string, THREE.BufferGeometry[]>();
  add(role: string, g: THREE.BufferGeometry, x = 0, y = 0, z = 0) {
    g.translate(x, y, z);
    this.geometries.set(role, [...(this.geometries.get(role) ?? []), g]);
  }
  box(
    role: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) {
    this.add(role, new THREE.BoxGeometry(w, h, d), x, y, z);
  }
  sphere(
    role: string,
    x: number,
    y: number,
    z: number,
    r: number,
    sx = 1,
    sy = 1,
    sz = 1,
    segments = 12,
  ) {
    this.add(
      role,
      new THREE.SphereGeometry(r, segments, Math.round(segments * 0.8)).scale(
        sx,
        sy,
        sz,
      ),
      x,
      y,
      z,
    );
  }
  limb(role: string, from: THREE.Vector3, to: THREE.Vector3, r: number) {
    const along = to.clone().sub(from);
    const g = new THREE.CapsuleGeometry(r, along.length(), 3, 8);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        v(0, 1, 0),
        along.clone().normalize(),
      ),
    );
    const mid = from.clone().add(to).multiplyScalar(0.5);
    this.add(role, g, mid.x, mid.y, mid.z);
  }
  build() {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [role, list] of this.geometries) {
      if (role !== "face") list.forEach((g) => g.deleteAttribute("uv"));
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (merged) out.set(role, merged);
    }
    return out;
  }
}

const HEAD = v(0, 4.55, -0.55);
const HEAD_RADIUS = 1.4;

// The drivers are full Miis built from real geometry, so they stay visible in
// the onboard and driver close-up views.
function carParts(miis: Mii[]) {
  const p = new Parts();
  p.box("team", 0, 1.1, 0, 3, 1.3, 5.8);
  p.box("team", 0, 0.8, 3.4, 1.25, 0.65, 3.6);
  p.box("dark", 0, 0.55, 5.25, 5.9, 0.28, 1.1);
  p.box("team", 0, 0.85, 5.35, 5.8, 0.18, 0.6);
  p.box("dark", 0, 2, -3.5, 5.5, 0.28, 1.15);
  p.box("team", 0, 2.3, -3.45, 5.3, 0.25, 1.15);
  for (const x of [-2.3, 2.3])
    for (const z of [-2.15, 3.1]) {
      p.add(
        "tire",
        new THREE.CylinderGeometry(1.05, 1.05, 1.05, 16).rotateZ(Math.PI / 2),
        x,
        1.05,
        z,
      );
      p.add(
        "silver",
        new THREE.CylinderGeometry(0.58, 0.58, 1.08, 16).rotateZ(Math.PI / 2),
        x,
        1.05,
        z,
      );
      p.box("dark", x / 2, 0.9, z, 1.5, 0.18, 0.35);
    }
  p.box("team", -1.8, 1, 0, 0.85, 0.9, 3.2);
  p.box("team", 1.8, 1, 0, 0.85, 0.9, 3.2);
  p.box("dark", 0, 1.95, -0.45, 2, 0.25, 2.9);
  // Favourite-colour suit, arms out to the wheel and round Mii hands.
  p.sphere("suit", 0, 2.35, -0.65, 0.95, 1.12, 0.92, 0.8, 20);
  for (const side of [-1, 1]) {
    p.limb(
      "suit",
      v(side * 0.82, 2.85, -0.55),
      v(side * 0.6, 2.62, 0.62),
      0.17,
    );
    p.sphere("suit", side * 0.6, 2.62, 0.66, 0.25);
  }
  p.add(
    "dark",
    new THREE.TorusGeometry(0.55, 0.11, 8, 20).rotateX(-0.65),
    0,
    2.62,
    0.82,
  );
  p.add("skin", new THREE.CylinderGeometry(0.3, 0.34, 0.6, 12), 0, 3.15, -0.62);
  p.add("skin", headGeometry(HEAD_RADIUS), HEAD.x, HEAD.y, HEAD.z);
  p.add("skin", earGeometry(HEAD_RADIUS), HEAD.x, HEAD.y, HEAD.z);
  p.add("face", faceGeometry(HEAD_RADIUS), HEAD.x, HEAD.y, HEAD.z);
  for (const key of new Set(miis.map(hairKey))) {
    const [style, part] = key.split(":");
    p.add(
      `hair:${key}`,
      hairGeometry(style as HairStyle, Number(part), HEAD_RADIUS),
      HEAD.x,
      HEAD.y,
      HEAD.z,
    );
  }
  return p.build();
}

function distantCarParts() {
  const p = new Parts();
  p.box("team", 0, 1.1, 0, 3, 1.3, 5.8);
  p.box("team", 0, 0.8, 3.4, 1.25, 0.65, 3.6);
  p.box("team", 0, 0.8, 5.2, 5.8, 0.3, 1);
  p.box("team", 0, 2.2, -3.5, 5.5, 0.4, 1);
  for (const x of [-2.3, 2.3])
    for (const z of [-2.15, 3.1]) p.box("dark", x, 1, z, 1, 2, 2);
  p.box("suit", 0, 2.45, -0.6, 1.9, 1, 1.4);
  p.add(
    "skin",
    new THREE.SphereGeometry(HEAD_RADIUS, 8, 6),
    HEAD.x,
    HEAD.y,
    HEAD.z,
  );
  p.add(
    "hair",
    hairGeometry("short", 1, HEAD_RADIUS, 16, 5),
    HEAD.x,
    HEAD.y,
    HEAD.z,
  );
  return p.build();
}

const FIXED_COLORS: Record<string, string> = {
  dark: "#2c3134",
  tire: "#24282a",
  silver: "#c7cfd4",
  face: "#ffffff",
};
const ROUGHNESS: Record<string, number> = {
  team: 0.45,
  dark: 0.75,
  tire: 0.9,
  silver: 0.35,
  suit: 0.7,
  skin: 0.62,
};
function partColor(role: string, driver: Driver, mii: Mii) {
  if (role === "team") return `#${driver.team_colour || "ff6e19"}`;
  if (role === "suit") return mii.favorite;
  if (role === "skin") return mii.skin;
  if (role === "hair") return mii.hair;
  if (role.startsWith("hair:"))
    return role === `hair:${hairKey(mii)}` ? mii.hair : null;
  return FIXED_COLORS[role] ?? "#ffffff";
}

interface CarLayer {
  mesh: THREE.InstancedMesh;
  /** Per driver; null when the driver does not use this part (another hair style). */
  colors: (THREE.Color | null)[];
  cells?: [number, number][];
  cellAttribute?: THREE.InstancedBufferAttribute;
  count: number;
}

export class ReplayScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);
  readonly controls: OrbitControls;
  readonly cars: THREE.Object3D[] = [];
  readonly miis: Mii[];
  readonly atlas: FaceAtlas;
  readonly track: THREE.Vector3[];
  readonly center: THREE.Vector3;
  readonly extent: number;
  mode: CameraMode = "orbit";
  focus = 0;
  station = -1;
  quality = "high";
  private cameraSnap = true;
  private shadowLight: THREE.DirectionalLight;
  private observer: ResizeObserver;
  private stations: {
    position: THREE.Vector3;
    name: string;
    point: THREE.Vector3;
  }[] = [];
  private autoStation = 0;
  private cameraTarget = new THREE.Vector3();
  private desiredPosition = new THREE.Vector3();
  private lastHeading = new Array(20).fill(0);
  private carLayers: CarLayer[];
  private distantLayers: CarLayer[];
  private carMatrix = new THREE.Matrix4();
  private blobMatrix = new THREE.Matrix4();
  private blobBase = new THREE.Matrix4()
    .makeRotationX(-Math.PI / 2)
    .scale(v(1, 1.7, 1));
  private blobShadows: THREE.InstancedMesh;
  private detailMask = -1;
  private dirty = true;
  private adaptive = true;
  private focusRing: THREE.Mesh;
  private halo: THREE.Sprite;
  onStationChange?: (name: string) => void;
  constructor(
    readonly container: HTMLElement,
    readonly meta: Metadata,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor("#cdeefb");
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps the Mii palette and team colours true to their values.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D race replay. Drag to orbit and scroll to zoom in the aerial camera.",
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.12;
    this.controls.minDistance = 24;
    this.controls.maxDistance = 3600;
    this.controls.addEventListener("change", () => {
      this.dirty = true;
    });
    this.track = meta.track.points.map((p) => v(p[0], 0.7, p[1]));
    const bounds = new THREE.Box3().setFromPoints(this.track);
    this.center = bounds.getCenter(new THREE.Vector3());
    this.extent = Math.max(
      bounds.max.x - bounds.min.x,
      bounds.max.z - bounds.min.z,
    );
    this.scene.fog = new THREE.Fog(
      "#cdeefb",
      this.extent * 1.5,
      this.extent * 4,
    );
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#d9d2bc", 1.9));
    this.shadowLight = new THREE.DirectionalLight("#fff6e6", 2.4);
    this.shadowLight.position.copy(this.center).add(v(400, 750, 200));
    this.shadowLight.target.position.copy(this.center);
    this.scene.add(this.shadowLight, this.shadowLight.target);
    // A soft light from the camera, like a character-select screen, so Mii
    // faces stay bright whichever way the car is facing.
    const fill = new THREE.DirectionalLight("#ffffff", 0.75);
    fill.target.position.set(0, 0, -1);
    this.camera.add(fill, fill.target);
    this.scene.add(this.camera);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    this.shadowLight.shadow.camera.left = -this.extent;
    this.shadowLight.shadow.camera.right = this.extent;
    this.shadowLight.shadow.camera.top = this.extent;
    this.shadowLight.shadow.camera.bottom = -this.extent;
    this.shadowLight.shadow.camera.far = 3000;
    this.shadowLight.shadow.bias = -0.0005;
    this.shadowLight.shadow.autoUpdate = false;
    this.shadowLight.shadow.needsUpdate = true;
    this.buildWorld();
    this.mergeStaticWorld();
    this.buildSky();
    this.miis = meta.drivers.map(miiFor);
    this.atlas = faceAtlas(this.miis);
    this.cars = meta.drivers.map(() => new THREE.Object3D());
    this.carLayers = this.makeLayers(carParts(this.miis));
    this.distantLayers = this.makeLayers(distantCarParts());
    this.blobShadows = new THREE.InstancedMesh(
      new THREE.CircleGeometry(3.1, 12),
      new THREE.MeshBasicMaterial({
        color: "#1f3a26",
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
      meta.drivers.length,
    );
    this.blobShadows.frustumCulled = false;
    this.scene.add(this.blobShadows);
    this.focusRing = mesh(
      new THREE.RingGeometry(6.8, 7.4, 36),
      new THREE.MeshBasicMaterial({
        color: "#34beed",
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      this.scene,
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    // A Wii button: white pill, cyan outline, grey label.
    const pill = ctx.createLinearGradient(0, 6, 0, 50);
    pill.addColorStop(0, "#ffffff");
    pill.addColorStop(1, "#e4e4e4");
    ctx.fillStyle = pill;
    ctx.strokeStyle = "#34beed";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(6, 6, 116, 44, 22);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#4a4a4a";
    ctx.font = '500 25px "Zen Kaku Gothic New", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("FOLLOW", 64, 37);
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        depthTest: false,
      }),
    );
    this.halo.scale.set(20, 10, 1);
    this.scene.add(this.halo);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.overview();
  }
  // Every part is one instanced draw shared by all twenty cars.
  private makeLayers(parts: Map<string, THREE.BufferGeometry>): CarLayer[] {
    const n = this.meta.drivers.length;
    return [...parts].map(([role, geometry]) => {
      const hair = role.startsWith("hair");
      const material =
        role === "face"
          ? instancedFaceMaterial(this.atlas)
          : new THREE.MeshStandardMaterial({
              color: "#ffffff",
              roughness: ROUGHNESS[role] ?? (hair ? 0.5 : 0.85),
              metalness: role === "silver" ? 0.35 : 0,
              side: hair ? THREE.DoubleSide : THREE.FrontSide,
            });
      if (role === "skin" || role === "suit" || hair) miiGlow(material);
      const mesh = new THREE.InstancedMesh(geometry, material, n);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const colors = this.meta.drivers.map((d, i) => {
        const c = partColor(role, d, this.miis[i]);
        return c ? new THREE.Color(c) : null;
      });
      colors.forEach((c, i) => mesh.setColorAt(i, c ?? new THREE.Color()));
      const layer: CarLayer = { mesh, colors, count: 0 };
      if (role === "face") {
        layer.cellAttribute = new THREE.InstancedBufferAttribute(
          new Float32Array(n * 2),
          2,
        );
        layer.cellAttribute.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute("faceCell", layer.cellAttribute);
        layer.cells = this.miis.map((_, i) => this.atlas.offset(i));
      }
      this.scene.add(mesh);
      return layer;
    });
  }
  private mergeStaticWorld() {
    this.scene.updateMatrixWorld(true);
    const batches = new Map<
      string,
      {
        material: THREE.Material;
        geometries: THREE.BufferGeometry[];
        objects: THREE.Mesh[];
      }
    >();
    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj instanceof THREE.InstancedMesh)
        return;
      const material = obj.material as THREE.MeshStandardMaterial;
      const key = `${material.type}:${material.color.getHex()}:${material.side}`;
      const batch = batches.get(key) ?? {
        material,
        geometries: [],
        objects: [],
      };
      batch.geometries.push(obj.geometry.clone().applyMatrix4(obj.matrixWorld));
      batch.objects.push(obj);
      batches.set(key, batch);
    });
    for (const batch of batches.values()) {
      const geometry = mergeGeometries(batch.geometries, false);
      if (!geometry) continue;
      const material = batch.material.clone();
      for (const obj of batch.objects) {
        obj.parent?.remove(obj);
        obj.geometry.dispose();
      }
      const merged = mesh(geometry, material, this.scene);
      merged.matrixAutoUpdate = false;
      batch.geometries.forEach((g) => g.dispose());
    }
  }
  private buildWorld() {
    const radius = this.extent * 0.86;
    const island = mesh(
      new THREE.CylinderGeometry(radius, radius * 0.93, 55, 64),
      mat("#5b8f3d"),
      this.scene,
      this.center.x,
      -29,
      this.center.z,
    );
    island.receiveShadow = true;
    mesh(
      new THREE.CylinderGeometry(radius * 0.935, radius * 0.875, 12, 64),
      mat("#ecdcaa"),
      this.scene,
      this.center.x,
      -62,
      this.center.z,
    );
    const land = mesh(
      new THREE.CircleGeometry(radius, 64),
      mat("#6ea846"),
      this.scene,
      this.center.x,
      -0.1,
      this.center.z,
    );
    land.rotation.x = -Math.PI / 2;
    const curve = new THREE.CatmullRomCurve3(this.track, true, "centripetal");
    const points = curve.getPoints(1600);
    const ribbon = (width: number, y: number, color: string) => {
      const pos: number[] = [],
        idx: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const tangent = points[(i + 1) % points.length]
          .clone()
          .sub(points[Math.max(0, i - 1)])
          .normalize();
        const normal = v(-tangent.z, 0, tangent.x).multiplyScalar(width / 2);
        pos.push(
          p.x + normal.x,
          y,
          p.z + normal.z,
          p.x - normal.x,
          y,
          p.z - normal.z,
        );
        if (i < points.length - 1) {
          const n = i * 2;
          idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const material = mat(color);
      material.side = THREE.DoubleSide;
      mesh(g, material, this.scene);
    };
    ribbon(29, 0.05, "#84bb5c");
    ribbon(20, 0.12, "#ffffff");
    ribbon(17, 0.18, "#7c8386");
    const curbGeos: THREE.BufferGeometry[][] = [[], []];
    for (let i = 0; i < points.length - 1; i += 5) {
      const a = points[i],
        b = points[Math.min(i + 5, points.length - 1)];
      const dir = b.clone().sub(a);
      for (const sign of [-1, 1]) {
        const normal = v(-dir.z, 0, dir.x)
          .normalize()
          .multiplyScalar(sign * 9.25);
        const g = new THREE.BoxGeometry(1.4, 0.3, dir.length());
        const m = new THREE.Matrix4().compose(
          a.clone().add(b).multiplyScalar(0.5).add(normal).setY(0.22),
          new THREE.Quaternion().setFromAxisAngle(
            v(0, 1, 0),
            Math.atan2(dir.x, dir.z),
          ),
          v(1, 1, 1),
        );
        g.applyMatrix4(m);
        curbGeos[Math.floor(i / 5) % 2].push(g);
      }
    }
    curbGeos.forEach((g, i) => {
      const merged = mergeGeometries(g, false);
      if (merged) mesh(merged, mat(i ? "#ffffff" : "#e5463c"), this.scene);
      g.forEach((x) => x.dispose());
    });
    // Simple pit lane beside the real start/finish segment.
    const start = this.track[0];
    const tangent = this.track[Math.min(5, this.track.length - 1)]
      .clone()
      .sub(start)
      .normalize();
    const normal = v(-tangent.z, 0, tangent.x);
    const pit = new THREE.Group();
    pit.position.copy(start).addScaledVector(normal, 35);
    pit.rotation.y = Math.atan2(tangent.x, tangent.z);
    this.scene.add(pit);
    box(pit, mat("#7c8386"), 0, 0.15, 18, 15, 0.3, 210);
    box(pit, mat("#f5f5f5"), 15, 8, 10, 17, 16, 190);
    box(pit, mat("#34beed"), 15, 18, 10, 22, 3, 195);
    const glass = mat("#8fd6f2");
    for (let i = 0; i < 16; i++) {
      box(pit, glass, 5.9, 6, -77 + i * 11, 0.3, 7, 8);
      box(
        pit,
        mat(i % 2 ? "#ffffff" : "#e6e6e6"),
        6.5,
        15,
        -77 + i * 11,
        0.5,
        2.5,
        8,
      );
    }
    const gantry = new THREE.Group();
    gantry.position.copy(start);
    gantry.rotation.y = Math.atan2(tangent.x, tangent.z);
    this.scene.add(gantry);
    const white = mat("#ffffff");
    box(gantry, white, -13, 10, 0, 1.5, 20, 2);
    box(gantry, white, 13, 10, 0, 1.5, 20, 2);
    box(gantry, mat("#34beed"), 0, 20, 0, 28, 5, 2);
    const sign = this.textSprite("Formula Mii", "#ffffff", "#12a3dd", 24, 5);
    sign.position.set(0, 20, 1.1);
    gantry.add(sign);
    for (let x = -8; x < 8; x += 2)
      for (let z = 0; z < 3; z++) {
        box(
          gantry,
          mat((Math.floor(x / 2) + z) % 2 ? "#ffffff" : "#3a3a3a"),
          x,
          0.35,
          z * 2,
          2,
          0.03,
          2,
        );
      }
    // Instanced trees: hundreds of props in three draw calls.
    let seed = 19;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const treePoints: THREE.Vector3[] = [];
    for (let i = 0; i < 800 && treePoints.length < 200; i++) {
      const angle = random() * Math.PI * 2,
        dist = Math.sqrt(random()) * radius * 0.93;
      const p = v(
        this.center.x + Math.cos(angle) * dist,
        0,
        this.center.z + Math.sin(angle) * dist,
      );
      if (this.track.some((t) => t.distanceTo(p) < 33)) continue;
      if (p.distanceTo(pit.position) < 130) continue;
      treePoints.push(p);
    }
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
      const scale = 0.7 + random() * 0.7;
      const q = new THREE.Quaternion().setFromAxisAngle(
        v(0, 1, 0),
        random() * 6.28,
      );
      trunks.setMatrixAt(
        i,
        new THREE.Matrix4().compose(
          p.clone().setY(5 * scale),
          q,
          v(scale, scale, scale),
        ),
      );
      crowns.setMatrixAt(
        i,
        new THREE.Matrix4().compose(
          p.clone().setY(13 * scale),
          q,
          v(scale, scale, scale),
        ),
      );
      tops.setMatrixAt(
        i,
        new THREE.Matrix4().compose(
          p.clone().setY(21 * scale),
          q,
          v(scale, scale, scale),
        ),
      );
    });
    for (const obj of [trunks, crowns, tops]) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      this.scene.add(obj);
    }
    const seating = new THREE.Group();
    const seatingPoint = this.track[Math.floor(this.track.length * 0.84)];
    seating.position.copy(seatingPoint).add(v(45, 0, 0));
    this.scene.add(seating);
    const seats = [mat("#ffffff"), mat("#34beed"), mat("#ffd820")];
    for (let row = 0; row < 6; row++)
      box(seating, seats[row % 3], row * 4, 2 + row * 3, 0, 5, 3, 110);
    box(seating, mat("#ffffff"), 9, 24, 0, 38, 2, 118);
    const lake = mesh(
      new THREE.CircleGeometry(1, 48),
      mat("#5cc3ea"),
      this.scene,
      this.center.x + radius * 0.53,
      0.02,
      this.center.z + radius * 0.15,
    );
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(110, 65, 1);
    const city = new THREE.Group();
    this.scene.add(city);
    const cityMats = [mat("#f7f7f7"), mat("#e2e9ee"), mat("#cbd8e2")];
    for (let i = 0; i < 35; i++) {
      const a = Math.PI * 1.1 + i * 0.038;
      const h = 25 + random() * 80;
      box(
        city,
        cityMats[i % 3],
        this.center.x + Math.cos(a) * radius * 0.84,
        h / 2,
        this.center.z + Math.sin(a) * radius * 0.84,
        18 + random() * 22,
        h,
        18 + random() * 16,
      );
    }
    const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
    const cloudMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const cloudMesh = new THREE.InstancedMesh(cloudGeo, cloudMat, 40);
    for (let i = 0; i < 40; i++) {
      const angle = Math.floor(i / 4) * 0.628;
      const p = v(
        this.center.x + Math.cos(angle) * (radius + 150) + (i % 4) * 35,
        180 + (i % 3) * 15,
        this.center.z + Math.sin(angle) * (radius + 150),
      );
      cloudMesh.setMatrixAt(
        i,
        new THREE.Matrix4().compose(p, new THREE.Quaternion(), v(45, 22, 27)),
      );
    }
    this.scene.add(cloudMesh);
    const names = [
      "Senna S · Turn 1",
      "Curva do Sol · Turn 3",
      "Reta Oposta · Turn 4",
      "Ferradura · Turn 6",
      "Pinheirinho · Turn 8",
      "Bico de Pato · Turn 10",
      "Junção · Turn 12",
      "Finish straight",
    ];
    const fractions = [0.06, 0.14, 0.28, 0.42, 0.52, 0.64, 0.77, 0.95];
    fractions.forEach((f, i) => {
      const n = Math.floor(f * this.track.length),
        point = this.track[n];
      const t = this.track[(n + 3) % this.track.length]
        .clone()
        .sub(point)
        .normalize();
      const normal = v(-t.z, 0, t.x);
      const pos = point
        .clone()
        .addScaledVector(normal, i % 2 ? 65 : -65)
        .add(v(0, 24, 0));
      this.stations.push({ position: pos, name: names[i], point });
      const tower = new THREE.Group();
      tower.position.copy(pos).setY(0);
      box(tower, mat("#ffffff"), 0, 10, 0, 2, 20, 2);
      box(tower, mat("#34beed"), 0, 21, 0, 5, 3, 3);
      this.scene.add(tower);
    });
  }
  // A Wii Sports sky: deep blue overhead, fading to pale blue at the horizon.
  private buildSky() {
    const radius = Math.max(this.extent * 7, 8000);
    const g = new THREE.SphereGeometry(radius, 32, 16);
    const top = new THREE.Color("#4fb3ea"),
      horizon = new THREE.Color("#cdeefb"),
      colors: number[] = [],
      c = new THREE.Color();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = THREE.MathUtils.clamp(p.getY(i) / radius, 0, 1) ** 0.6;
      c.copy(horizon).lerp(top, t);
      colors.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    sky.position.copy(this.center);
    sky.renderOrder = -1;
    this.scene.add(sky);
  }
  private textSprite(
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
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }),
    );
    s.scale.set(w, h, 1);
    return s;
  }
  overview() {
    this.controls.target.copy(this.center);
    this.camera.position
      .copy(this.center)
      .add(v(this.extent * 0.6, this.extent * 0.86, this.extent * 0.8));
    this.camera.lookAt(this.center);
    this.camera.updateMatrixWorld();
    for (let attempt = 0; attempt < 5; attempt++) {
      let largest = 0;
      this.track.forEach((p) => {
        const projected = p.clone().project(this.camera);
        largest = Math.max(
          largest,
          Math.abs(projected.x),
          Math.abs(projected.y),
        );
      });
      if (largest <= 0.83) break;
      this.camera.position
        .sub(this.center)
        .multiplyScalar(largest / 0.83)
        .add(this.center);
      this.camera.lookAt(this.center);
      this.camera.updateMatrixWorld();
    }
    this.controls.update();
  }
  setMode(mode: CameraMode) {
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    this.cameraSnap = true;
    this.dirty = true;
    if (mode === "orbit") {
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
      this.overview();
    }
  }
  setFocus(index: number) {
    this.focus = index;
    this.cameraSnap = true;
    this.dirty = true;
  }
  setQuality(low: boolean) {
    this.quality = low ? "low" : "high";
    this.adaptive = !low;
    this.renderer.setPixelRatio(
      low ? Math.min(devicePixelRatio, 0.5) : Math.min(devicePixelRatio, 1.5),
    );
    this.renderer.shadowMap.enabled = !low;
    this.shadowLight.shadow.needsUpdate = true;
    this.resize();
    this.dirty = true;
  }
  adaptPerformance(fps: number) {
    if (!this.adaptive || fps <= 0 || fps >= 28) return;
    const ratio = this.renderer.getPixelRatio(),
      next = Math.max(0.4, ratio * Math.sqrt(fps / 40));
    if (next >= ratio - 0.04) return;
    this.renderer.setPixelRatio(next);
    if (next < 0.8) this.renderer.shadowMap.enabled = false;
    this.resize();
  }
  get stationNames() {
    return this.stations.map((s) => s.name);
  }
  update(frame: Float32Array, dt: number, force = true) {
    let visibleCount = 0,
      detailMask = 0;
    for (const layer of this.carLayers) layer.count = 0;
    for (const layer of this.distantLayers) layer.count = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const k = i * 16,
        car = this.cars[i];
      car.position.set(frame[k], 0.3, frame[k + 1]);
      this.lastHeading[i] = frame[k + 3];
      car.rotation.y = this.lastHeading[i];
      car.visible = frame[k + 12] > 0;
      car.updateMatrix();
      if (!car.visible) continue;
      const detailed =
        car.position.distanceToSquared(this.camera.position) < 130 * 130;
      if (detailed) detailMask |= 1 << i;
      for (const layer of detailed ? this.carLayers : this.distantLayers) {
        const color = layer.colors[i];
        if (!color) continue;
        const n = layer.count++;
        layer.mesh.setMatrixAt(n, car.matrix);
        layer.mesh.setColorAt(n, color);
        if (layer.cellAttribute)
          layer.cellAttribute.setXY(n, ...layer.cells![i]);
      }
      this.blobMatrix.makeRotationY(car.rotation.y).multiply(this.blobBase);
      this.blobMatrix.setPosition(car.position.x, 0.25, car.position.z);
      this.blobShadows.setMatrixAt(visibleCount++, this.blobMatrix);
    }
    if (detailMask !== this.detailMask) {
      this.dirty = true;
      this.detailMask = detailMask;
    }
    for (const layer of [...this.carLayers, ...this.distantLayers]) {
      const { mesh } = layer;
      mesh.count = layer.count;
      mesh.visible = layer.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (layer.cellAttribute) layer.cellAttribute.needsUpdate = true;
    }
    this.blobShadows.count = visibleCount;
    this.blobShadows.instanceMatrix.needsUpdate = true;
    const car = this.cars[this.focus],
      pos = car.position;
    this.focusRing.position.copy(pos).setY(0.4);
    this.focusRing.visible = car.visible;
    this.halo.position.copy(pos).add(v(0, 13, 0));
    this.halo.visible = car.visible && this.mode === "orbit";
    if (this.mode === "orbit") this.controls.update();
    else {
      const dir = v(Math.sin(car.rotation.y), 0, Math.cos(car.rotation.y));
      this.cameraTarget.copy(pos).add(v(0, 3, 0));
      let fov = 48;
      if (this.mode === "chase") {
        this.desiredPosition
          .copy(pos)
          .addScaledVector(dir, -42)
          .add(v(16, 22, 0));
        this.cameraTarget.addScaledVector(dir, 22);
      } else if (this.mode === "onboard") {
        this.desiredPosition
          .copy(pos)
          .addScaledVector(dir, 1.8)
          .add(v(0, 5.6, 0));
        this.cameraTarget.addScaledVector(dir, 75).setY(3.8);
        fov = 76;
      } else if (this.mode === "portrait") {
        // A three-quarter view of the Mii, like a character select screen.
        this.desiredPosition
          .copy(pos)
          .addScaledVector(dir, 13)
          .addScaledVector(v(dir.z, 0, -dir.x), 4.5)
          .add(v(0, 6, 0));
        this.cameraTarget.copy(pos).add(v(0, 4.2, 0));
        fov = 40;
      } else {
        let station = this.station;
        if (station < 0) {
          let nearest = 0,
            dist = Infinity;
          this.stations.forEach((s, i) => {
            const d = s.point.distanceTo(pos);
            if (d < dist) {
              nearest = i;
              dist = d;
            }
          });
          if (
            this.stations[this.autoStation].point.distanceTo(pos) >
            dist + 60
          ) {
            this.autoStation = nearest;
            this.cameraSnap = true;
          }
          station = this.autoStation;
        }
        const s = this.stations[station];
        this.desiredPosition.copy(s.position);
        this.cameraTarget.setY(3);
        fov = THREE.MathUtils.clamp(2400 / s.position.distanceTo(pos), 16, 58);
        this.onStationChange?.(s.name);
      }
      const alpha = this.cameraSnap ? 1 : 1 - Math.exp(-dt * 8);
      this.camera.position.lerp(this.desiredPosition, alpha);
      this.camera.lookAt(this.cameraTarget);
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.cameraSnap = false;
    }
    if (force || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
      return true;
    }
    return false;
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
  dispose() {
    this.observer.disconnect();
    this.controls.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        materials.forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
  }
}
