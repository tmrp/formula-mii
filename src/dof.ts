import * as THREE from "three";

/**
 * How the blur falls off around the focus distance. Blur follows a lens's
 * circle of confusion, (d - focus) / d, so the same settings suit a portrait
 * at 14 m and an aerial view at 2 km.
 */
export interface Focus {
  /** Distance from the camera to the subject, in metres. */
  distance: number;
  /** Behind the subject: blur starts and is full at these values of (d - f) / d. */
  farStart: number;
  farEnd: number;
  /** Strength of the far blur, 0 to 1. */
  far: number;
  /** In front of the subject: the same, using (f - d) / d. */
  nearStart?: number;
  nearEnd?: number;
  near?: number;
}

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BLUR_AMOUNT = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform vec4 focus;
uniform vec3 nearFocus;
float blurAmount(vec2 uv) {
  float depth = texture2D(tDepth, uv).x;
  float d = -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  float c = (d - focus.x) / d;
  return max(
    smoothstep(focus.y, focus.z, c) * focus.w,
    smoothstep(nearFocus.x, nearFocus.y, -c) * nearFocus.z
  );
}`;

// Half resolution. Each pixel keeps only the blurry pixels under it, weighted
// by how blurry they are, so a sharp Mii never smears into the background.
const PREFILTER = /* glsl */ `
${BLUR_AMOUNT}
uniform sampler2D tColor;
uniform vec2 texel;
varying vec2 vUv;
vec4 weighted(vec2 offset) {
  vec2 uv = vUv + texel * offset;
  float w = blurAmount(uv);
  return vec4(texture2D(tColor, uv).rgb * w, w);
}
void main() {
  gl_FragColor = 0.25 * (
    weighted(vec2(-0.5, -0.5)) + weighted(vec2(0.5, -0.5)) +
    weighted(vec2(-0.5, 0.5)) + weighted(vec2(0.5, 0.5))
  );
}`;

// A separable Gaussian at quarter resolution: the Wii copied its frame at low
// resolution and blurred that, which gives the soft, dreamy background.
const BLUR = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 direction;
uniform float sigma;
varying vec2 vUv;
float gauss(float x) { return exp(-0.5 * x * x / (sigma * sigma)); }
void main() {
  vec4 sum = texture2D(tInput, vUv);
  float total = 1.0;
  // Pairs of texels share one bilinear fetch.
  for (int i = 1; i <= 9; i++) {
    float a = float(2 * i - 1), b = float(2 * i);
    float wa = gauss(a), wb = gauss(b), w = wa + wb;
    if (w < 1e-4) break;
    vec2 offset = direction * (a * wa + b * wb) / w;
    sum += (texture2D(tInput, vUv + offset) + texture2D(tInput, vUv - offset)) * w;
    total += 2.0 * w;
  }
  gl_FragColor = sum / total;
}`;

const COMPOSITE = /* glsl */ `
${BLUR_AMOUNT}
uniform sampler2D tColor;
uniform sampler2D tBlur;
varying vec2 vUv;
void main() {
  vec3 sharp = texture2D(tColor, vUv).rgb;
  vec4 blur = texture2D(tBlur, vUv);
  vec3 soft = mix(sharp, blur.rgb / max(blur.a, 1e-4), smoothstep(0.0, 0.04, blur.a));
  gl_FragColor = vec4(mix(sharp, soft, blurAmount(vUv)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * The soft depth of field of Wii Sports: the subject stays crisp and the
 * scenery behind it melts into a gentle blur. The scene renders into a
 * multisampled target, then one prefilter, two blur and one composite pass
 * run at a total cost of about one extra full-screen draw.
 */
export class DepthOfField {
  private scene: THREE.WebGLRenderTarget;
  private half: THREE.WebGLRenderTarget;
  private blurX: THREE.WebGLRenderTarget;
  private blurY: THREE.WebGLRenderTarget;
  private prefilter: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private composite: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();
  private radius = 3;
  /** Scales the blur radius: 1 is the Wii Sports default. */
  strength = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    // Half float keeps the lighting linear and unclipped until tone mapping.
    const type = renderer.extensions.has("EXT_color_buffer_float")
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;
    const target = (options?: THREE.RenderTargetOptions) =>
      new THREE.WebGLRenderTarget(1, 1, {
        type,
        depthBuffer: false,
        ...options,
      });
    this.scene = target({
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1),
      samples: 4,
    });
    this.half = target();
    this.blurX = target();
    this.blurY = target();
    const focus = () => ({
      tDepth: { value: this.scene.depthTexture },
      cameraNear: { value: 1 },
      cameraFar: { value: 1000 },
      focus: { value: new THREE.Vector4() },
      nearFocus: { value: new THREE.Vector3() },
    });
    const pass = (
      fragmentShader: string,
      uniforms: Record<string, THREE.IUniform>,
      toneMapped = false,
    ) =>
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        toneMapped,
      });
    this.prefilter = pass(PREFILTER, {
      ...focus(),
      tColor: { value: this.scene.texture },
      texel: { value: new THREE.Vector2() },
    });
    this.blur = pass(BLUR, {
      tInput: { value: null },
      direction: { value: new THREE.Vector2() },
      sigma: { value: 3 },
    });
    this.composite = pass(
      COMPOSITE,
      {
        ...focus(),
        tColor: { value: this.scene.texture },
        tBlur: { value: this.blurY.texture },
      },
      true,
    );
    // One triangle that covers the screen.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    geometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2),
    );
    this.quad = new THREE.Mesh(geometry, this.prefilter);
    this.quad.frustumCulled = false;
  }

  private setSize() {
    const { x, y } = this.renderer.getDrawingBufferSize(this.size);
    if (x === this.scene.width && y === this.scene.height) return;
    const hx = Math.max(1, Math.ceil(x / 2)),
      hy = Math.max(1, Math.ceil(y / 2)),
      qx = Math.max(1, Math.ceil(x / 4)),
      qy = Math.max(1, Math.ceil(y / 4));
    this.scene.setSize(x, y);
    this.half.setSize(hx, hy);
    this.blurX.setSize(qx, qy);
    this.blurY.setSize(qx, qy);
    this.prefilter.uniforms.texel.value.set(1 / x, 1 / y);
    // About 1% of the screen height, as soft as the Wii at 480p.
    this.radius = Math.min(5.5, Math.max(1.5, qy * 0.011));
  }

  private draw(
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null,
  ) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.camera);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, focus: Focus) {
    this.setSize();
    this.blur.uniforms.sigma.value = Math.min(9, this.radius * this.strength);
    for (const material of [this.prefilter, this.composite]) {
      const u = material.uniforms;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.focus.value.set(
        Math.max(focus.distance, camera.near),
        focus.farStart,
        focus.farEnd,
        focus.far,
      );
      u.nearFocus.value.set(
        focus.nearStart ?? 1,
        focus.nearEnd ?? 2,
        focus.near ?? 0,
      );
    }
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.scene);
    this.renderer.render(scene, camera);
    this.draw(this.prefilter, this.half);
    const blur = this.blur.uniforms;
    blur.tInput.value = this.half.texture;
    blur.direction.value.set(1 / this.blurX.width, 0);
    this.draw(this.blur, this.blurX);
    blur.tInput.value = this.blurX.texture;
    blur.direction.value.set(0, 1 / this.blurY.height);
    this.draw(this.blur, this.blurY);
    this.draw(this.composite, previous);
  }

  dispose() {
    for (const target of [this.scene, this.half, this.blurX, this.blurY]) {
      target.depthTexture?.dispose();
      target.dispose();
    }
    for (const material of [this.prefilter, this.blur, this.composite])
      material.dispose();
    this.quad.geometry.dispose();
  }
}
