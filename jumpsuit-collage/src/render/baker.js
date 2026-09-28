// Bakes projected collage images ("decals") directly into pattern space.
// Every pattern piece is drawn with its flat pattern coordinates as the output
// position, while the fragment shader knows the matching 3D surface point and
// projects each decal onto it. The result is a texture laid out like the fabric.
import * as THREE from 'three';
import { decalFrame } from '../app/decalMath.js';

const vertexShader = /* glsl */ `
  attribute vec2 layoutPos;
  uniform vec4 uRect; // x0, y0, width, height in cm (pattern layout space)
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vPos = position;
    vNormal = normal;
    vec2 p = (layoutPos - uRect.xy) / uRect.zw;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const decalFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uCenter;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uNormal;
  uniform vec2 uSize;
  uniform float uDepth;
  uniform float uOpacity;
  uniform float uFlip;
  uniform float uHighlight;
  varying vec3 vPos;
  varying vec3 vNormal;
  void main() {
    vec3 d = vPos - uCenter;
    float lx = dot(d, uRight) / uSize.x + 0.5;
    float ly = dot(d, uUp) / uSize.y + 0.5;
    float lz = dot(d, uNormal);
    if (lx < 0.0 || lx > 1.0 || ly < 0.0 || ly > 1.0 || abs(lz) > uDepth) discard;
    float facing = dot(normalize(vNormal), uNormal);
    float fade = smoothstep(0.02, 0.3, facing);
    vec2 uv = vec2(uFlip > 0.5 ? 1.0 - lx : lx, ly);
    vec4 c = texture2D(uMap, uv);
    c.a *= uOpacity * fade;
    if (uHighlight > 0.5 && fade > 0.5) {
      // Dashed outline marking the selected image (display only, never exported).
      vec2 cm = vec2(lx, ly) * uSize;
      float edge = min(min(cm.x, uSize.x - cm.x), min(cm.y, uSize.y - cm.y));
      if (edge < 0.35) {
        float dash = step(0.5, fract((cm.x + cm.y) / 2.0));
        c = vec4(mix(vec3(1.0), vec3(0.05, 0.45, 1.0), dash), 1.0);
      }
    }
    if (c.a < 0.002) discard;
    gl_FragColor = c;
  }
`;

const fillFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() { gl_FragColor = vec4(uColor, 1.0); }
`;

export class Baker {
  constructor(renderer, pieces, layout) {
    this.renderer = renderer;
    this.pieces = pieces;
    this.layout = layout;
    this.camera = new THREE.OrthographicCamera();
    this.scene = new THREE.Scene();

    this.decalMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: decalFragment,
      uniforms: {
        uRect: { value: new THREE.Vector4() },
        uMap: { value: null },
        uCenter: { value: new THREE.Vector3() },
        uRight: { value: new THREE.Vector3() },
        uUp: { value: new THREE.Vector3() },
        uNormal: { value: new THREE.Vector3() },
        uSize: { value: new THREE.Vector2() },
        uDepth: { value: 10 },
        uOpacity: { value: 1 },
        uFlip: { value: 0 },
        uHighlight: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fillMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: fillFragment,
      uniforms: { uRect: this.decalMaterial.uniforms.uRect, uColor: { value: new THREE.Color() } },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.meshes = pieces.map((piece, i) => {
      const [ox, oy] = layout.offsets[i];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(piece.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(piece.normals, 3));
      const lp = new Float32Array(piece.vertexCount * 2);
      for (let v = 0; v < piece.vertexCount; v++) {
        lp[2 * v] = piece.pattern[2 * v] + ox;
        lp[2 * v + 1] = piece.pattern[2 * v + 1] + oy;
      }
      g.setAttribute('layoutPos', new THREE.BufferAttribute(lp, 2));
      g.setIndex(new THREE.BufferAttribute(piece.bakeIndex, 1));
      const mesh = new THREE.Mesh(g, this.decalMaterial);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    });

    // A full-screen triangle used to flood the target with the fabric colour.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    tri.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    tri.setAttribute('layoutPos', new THREE.BufferAttribute(new Float32Array(6), 2));
    this.fillMesh = new THREE.Mesh(tri, this.fillMaterial);
    this.fillMesh.frustumCulled = false;
    this.fillScene = new THREE.Scene();
    this.fillScene.add(this.fillMesh);

    const maxTex = Math.min(renderer.capabilities.maxTextureSize, 4096);
    this.pxPerCm = Math.min(16, maxTex / Math.max(layout.width, layout.height));
    this.atlas = new THREE.WebGLRenderTarget(
      Math.round(layout.width * this.pxPerCm),
      Math.round(layout.height * this.pxPerCm),
      {
        colorSpace: THREE.SRGBColorSpace,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      },
    );
    this.atlas.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  get texture() {
    return this.atlas.texture;
  }

  // Render the collage into `target`, mapping the layout rectangle `rect` (cm) onto it.
  // `onlyPiece` restricts drawing to one piece (used for high-resolution export tiles).
  render({ decals, assets, baseColor, highlightId = null }, target = this.atlas, rect = null, onlyPiece = -1) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const u = this.decalMaterial.uniforms;
    u.uRect.value.set(...(rect ?? [0, 0, this.layout.width, this.layout.height]));
    this.fillMesh.geometry.attributes.layoutPos.array.set([
      u.uRect.value.x - u.uRect.value.z,
      u.uRect.value.y - u.uRect.value.w,
      u.uRect.value.x + 3 * u.uRect.value.z,
      u.uRect.value.y - u.uRect.value.w,
      u.uRect.value.x - u.uRect.value.z,
      u.uRect.value.y + 3 * u.uRect.value.w,
    ]);
    this.fillMesh.geometry.attributes.layoutPos.needsUpdate = true;
    this.fillMaterial.uniforms.uColor.value.set(baseColor);
    this.meshes.forEach((m, i) => (m.visible = onlyPiece < 0 || onlyPiece === i));

    r.setRenderTarget(target);
    r.autoClear = false;
    // Only regenerate mipmaps after the final pass.
    const wantsMips = target.texture.generateMipmaps;
    const visible = decals.filter((d) => assets.has(d.assetId));
    target.texture.generateMipmaps = wantsMips && visible.length === 0;
    r.render(this.fillScene, this.camera);
    visible.forEach((d, k) => {
      const asset = assets.get(d.assetId);
      target.texture.generateMipmaps = wantsMips && k === visible.length - 1;
      const f = decalFrame(d, asset.aspect);
      u.uMap.value = asset.texture;
      u.uCenter.value.fromArray(f.center);
      u.uRight.value.fromArray(f.right);
      u.uUp.value.fromArray(f.up);
      u.uNormal.value.fromArray(f.normal);
      u.uSize.value.set(f.width, f.height);
      u.uDepth.value = f.depth;
      u.uOpacity.value = d.opacity;
      u.uFlip.value = d.flipX ? 1 : 0;
      u.uHighlight.value = d.id === highlightId ? 1 : 0;
      r.render(this.scene, this.camera);
    });
    target.texture.generateMipmaps = wantsMips;
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
  }
}
