import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Metadata, CameraMode, Driver } from "./types";
import { DepthOfField, type Focus } from "./dof";
import { RaceEffects } from "./race-fx";
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
import {
  ASPHALT_LIFT,
  buildVenue,
  EMPTY_VENUE,
  mesh,
  toWorld,
  v,
  type Ground,
  type Station,
  type Venue,
} from "./venue";

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

const BLUR_SCALE = [0.45, 0.7, 1, 1.4, 1.9];

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
  /** The soft Wii Sports background blur, when the user wants it. */
  depthOfField = true;
  private dof: DepthOfField;
  /** Battery boost and slipstream effects. */
  readonly effects: RaceEffects;
  private dofThrottled = false;
  private cameraSnap = true;
  private shadowLight: THREE.DirectionalLight;
  private observer: ResizeObserver;
  readonly ground: Ground;
  readonly spectators: number;
  private stations: Station[];
  private crowdTime: { value: number };
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
  private ringBase = new THREE.Quaternion().setFromAxisAngle(
    v(1, 0, 0),
    -Math.PI / 2,
  );
  private detailMask = -1;
  private dirty = true;
  private adaptive = true;
  private focusRing: THREE.Mesh;
  private halo: THREE.Sprite;
  onStationChange?: (name: string) => void;
  constructor(
    readonly container: HTMLElement,
    readonly meta: Metadata,
    venue: Venue = EMPTY_VENUE,
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
    // Depth of field draws in several passes; count them all.
    this.renderer.info.autoReset = false;
    this.dof = new DepthOfField(this.renderer);
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
    // Recorded positions with their recorded elevation.
    this.track = meta.track.points.map((p) => toWorld(p[0], p[1], p[2]));
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
    const built = buildVenue(this.scene, this.track, venue, this.extent * 0.85);
    this.ground = built.ground;
    this.stations = built.stations;
    this.crowdTime = built.crowdTime;
    this.spectators = built.spectators;
    this.mergeStaticWorld();
    this.buildSky();
    this.miis = meta.drivers.map(miiFor);
    this.atlas = faceAtlas(this.miis);
    this.cars = meta.drivers.map(() => {
      const car = new THREE.Object3D();
      // Heading first, then pitch with the slope.
      car.rotation.order = "YXZ";
      return car;
    });
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
    this.effects = new RaceEffects(this.scene, meta.drivers.length);
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
      if (material.map || material.transparent || material.vertexColors) return;
      const key = `${material.type}:${material.color.getHex()}:${material.side}:${material.polygonOffset}`;
      const batch = batches.get(key) ?? {
        material,
        geometries: [],
        objects: [],
      };
      const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld);
      geometry.deleteAttribute("uv");
      batch.geometries.push(geometry);
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
    // A trackside lens never sees its own camera housing, just behind it.
    this.camera.near = mode === "trackside" ? 8 : 1;
    this.camera.updateProjectionMatrix();
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
    this.dofThrottled = false;
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
    if (next < 0.6) this.dofThrottled = true;
    this.resize();
  }
  setDepthOfField(on: boolean) {
    this.depthOfField = on;
    this.dirty = true;
  }
  /** Blur strength from 1 (softest) to 5; 3 is the Wii Sports look. */
  setBlurStrength(level: number) {
    this.dof.strength = BLUR_SCALE[level - 1] ?? 1;
    this.dirty = true;
  }
  setEffects(on: boolean) {
    this.effects.setEnabled(on);
    this.dirty = true;
  }
  /** Draw again on the next frame, even when paused. */
  invalidate() {
    this.dirty = true;
  }
  get blurring() {
    return this.depthOfField && this.quality !== "low" && !this.dofThrottled;
  }
  // Where each camera focuses, and how quickly the scenery behind softens.
  private lensFocus(pos: THREE.Vector3): Focus {
    const camera = this.camera.position;
    switch (this.mode) {
      case "orbit":
        // Only the far side of the island, like a tilt-shift miniature.
        return {
          distance: camera.distanceTo(this.controls.target),
          farStart: 0.45,
          farEnd: 0.9,
          far: 0.85,
        };
      case "chase":
        return {
          distance: camera.distanceTo(pos),
          farStart: 0.35,
          farEnd: 0.85,
          far: 1,
        };
      case "onboard":
        return { distance: 45, farStart: 0.5, farEnd: 0.92, far: 0.8 };
      case "portrait":
        // A character-select shot: the Mii crisp, the circuit a soft wash.
        return {
          distance: camera.distanceTo(this.cameraTarget),
          farStart: 0.12,
          farEnd: 0.5,
          far: 1,
        };
      default:
        // A long trackside lens: shallow focus in front and behind.
        return {
          distance: camera.distanceTo(pos),
          farStart: 0.1,
          farEnd: 0.45,
          far: 1,
          nearStart: 0.2,
          nearEnd: 0.7,
          near: 0.9,
        };
    }
  }
  get stationNames() {
    return this.stations.map((s) => s.name);
  }
  /**
   * Where the race is heard from. Like a racing game, the chase view listens
   * just behind the car and the aerial view near what it looks at; like TV,
   * a trackside camera has its microphone at the edge of the track.
   */
  listener(target: THREE.Vector3) {
    const camera = this.camera.position;
    if (this.mode === "orbit")
      return target.lerpVectors(this.controls.target, camera, 0.4);
    if (this.mode === "chase")
      return target.lerpVectors(this.cars[this.focus].position, camera, 0.25);
    const s =
      this.mode === "trackside" &&
      this.stations[this.station < 0 ? this.autoStation : this.station];
    if (!s) return target.copy(camera);
    const out = v(s.position.x - s.point.x, 0, s.position.z - s.point.z),
      reach = out.length();
    return target
      .copy(s.point)
      .addScaledVector(out.normalize(), Math.min(16, reach))
      .setY(s.point.y + 2);
  }
  update(frame: Float32Array, dt: number, force = true) {
    let visibleCount = 0,
      detailMask = 0;
    for (const layer of this.carLayers) layer.count = 0;
    for (const layer of this.distantLayers) layer.count = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const k = i * 16,
        car = this.cars[i];
      car.visible = frame[k + 12] > 0;
      if (!car.visible) continue;
      // OpenF1 heading is clockwise from north; the scene's north is -z.
      const heading = Math.PI - frame[k + 3],
        x = frame[k],
        z = -frame[k + 1],
        fx = Math.sin(heading) * 4,
        fz = Math.cos(heading) * 4;
      const pitch = Math.atan2(
        this.ground.height(x - fx, z - fz) - this.ground.height(x + fx, z + fz),
        8,
      );
      car.position.set(x, this.ground.height(x, z) + ASPHALT_LIFT + 0.04, z);
      this.lastHeading[i] = heading;
      car.rotation.set(pitch, heading, 0);
      car.updateMatrix();
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
      this.blobMatrix
        .makeRotationFromEuler(car.rotation)
        .multiply(this.blobBase);
      this.blobMatrix.setPosition(
        car.position.x,
        car.position.y + 0.08,
        car.position.z,
      );
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
    this.effects.update(frame, this.cars, dt, force);
    this.blobShadows.instanceMatrix.needsUpdate = true;
    const car = this.cars[this.focus],
      pos = car.position;
    this.focusRing.position.copy(pos).add(v(0, 0.12, 0));
    this.focusRing.quaternion.copy(car.quaternion).multiply(this.ringBase);
    this.focusRing.visible = car.visible;
    this.halo.position.copy(pos).add(v(0, 13, 0));
    this.halo.visible = car.visible && this.mode === "orbit";
    if (this.mode === "orbit") {
      this.controls.update();
      // Keep the free camera over the island and above the hills.
      const target = this.controls.target,
        reach = this.ground.radius * 0.9,
        d = Math.hypot(target.x, target.z);
      if (d > reach) target.multiplyScalar(reach / d);
      const cam = this.camera.position,
        floor = this.ground.height(cam.x, cam.z) + 12;
      if (cam.y < floor) {
        cam.y = floor;
        this.camera.lookAt(target);
      }
    } else {
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
        this.cameraTarget.addScaledVector(dir, 75).setY(pos.y + 3.8);
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
        this.cameraTarget.setY(pos.y + 3);
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
      this.crowdTime.value = performance.now() / 1000;
      this.renderer.info.reset();
      if (this.blurring)
        this.dof.render(this.scene, this.camera, this.lensFocus(pos));
      else this.renderer.render(this.scene, this.camera);
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
    this.dof.dispose();
    this.effects.dispose();
    this.renderer.dispose();
  }
}
