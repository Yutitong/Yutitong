// Bakes projected collage images ("decals") directly into pattern space.
// Every pattern piece is drawn with its flat pattern coordinates as the output
// position, while the fragment shader knows the matching 3D surface point and
// projects each decal onto it. The result is a texture laid out like the fabric.
import * as THREE from 'three';
import { decalFrame, wrapFrame } from '../app/decalMath.js';

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
  uniform float uMode; // 0 = project, 1 = wrap around an axis
  uniform vec3 uCenter;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uNormal;
  uniform vec2 uSize;
  uniform float uDepth;
  uniform float uOpacity;
  uniform float uFlip;
  uniform float uHighlight;
  // wrap mode
  uniform vec3 uAxisOrigin;
  uniform vec3 uAxisDir;
  uniform vec3 uAxisA;     // radial direction of the image centre
  uniform vec3 uAxisRight; // tangential direction at the image centre
  uniform float uRadius;
  uniform float uCenterT;
  uniform vec2 uRot;       // cos, sin of the rotation
  uniform vec2 uRadial;    // distance range from the axis (faded softly at both ends)
  uniform float uSide;     // +1 / -1: keep to that half of the body (leg bands), 0: all
  varying vec3 vPos;
  varying vec3 vNormal;
  // Distance (cm) from a local image coordinate to the nearest image edge.
  float edgeWeight(vec2 l) {
    vec2 d = min(l, 1.0 - l) * uSize;
    return clamp(min(d.x, d.y), 0.0, 1e4);
  }

  void main() {
    vec2 local;
    vec2 gx;
    vec2 gy;
    float fade;
    vec4 c;
    if (uMode < 0.5) {
      vec3 d = vPos - uCenter;
      local = vec2(dot(d, uRight) / uSize.x, dot(d, uUp) / uSize.y) + 0.5;
      float lz = abs(dot(d, uNormal));
      if (lz > uDepth) discard;
      fade = smoothstep(0.02, 0.3, dot(normalize(vNormal), uNormal)) * (1.0 - smoothstep(0.75 * uDepth, uDepth, lz));
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) discard;
      vec2 uv = vec2(uFlip > 0.5 ? 1.0 - local.x : local.x, local.y);
      c = texture2D(uMap, uv);
    } else {
      vec3 q = vPos - uAxisOrigin;
      float t = dot(q, uAxisDir);
      vec3 radial = q - t * uAxisDir;
      float r = length(radial);
      // Soft limits (never hard cuts, so the print is continuous across every seam):
      // distance from the axis, facing away from it, and staying on one half for leg bands.
      fade = smoothstep(uRadial.x, uRadial.x * 1.8, r) * (1.0 - smoothstep(uRadial.y * 0.7, uRadial.y, r));
      fade *= smoothstep(-0.15, 0.15, dot(normalize(vNormal), radial / max(r, 1e-4)));
      if (uSide != 0.0) fade *= smoothstep(-0.5, 2.5, vPos.x * uSide);
      if (fade <= 0.0) discard;
      float phi = atan(dot(radial, uAxisRight), dot(radial, uAxisA));
      mat2 rot = mat2(uRot.x, -uRot.y, uRot.y, uRot.x);
      local = (rot * vec2(phi * uRadius, t - uCenterT)) / uSize + 0.5;
      // Derivatives that ignore the jump of atan() behind the body (avoids a mip seam).
      float dpx = dFdx(phi);
      float dpy = dFdy(phi);
      dpx -= 6.2831853 * floor(dpx / 6.2831853 + 0.5);
      dpy -= 6.2831853 * floor(dpy / 6.2831853 + 0.5);
      gx = (rot * vec2(dpx * uRadius, dFdx(t))) / uSize;
      gy = (rot * vec2(dpy * uRadius, dFdy(t))) / uSize;
      if (uFlip > 0.5) {
        gx.x = -gx.x;
        gy.x = -gy.x;
      }
      // One full turn in image coordinates. Where a long image overlaps itself behind the
      // body, both ends are blended by distance to their edges, so the join is invisible.
      vec2 turn = (rot * vec2(6.2831853 * uRadius, 0.0)) / uSize;
      vec2 base = local;
      vec4 acc = vec4(0.0);
      float wsum = 0.0;
      float wbest = 0.0;
      for (int k = -1; k <= 1; k++) {
        vec2 l = base + float(k) * turn;
        if (l.x < 0.0 || l.x > 1.0 || l.y < 0.0 || l.y > 1.0) continue;
        float w = max(edgeWeight(l), 1e-4);
        vec2 uv = vec2(uFlip > 0.5 ? 1.0 - l.x : l.x, l.y);
        acc += w * textureGrad(uMap, uv, gx, gy);
        wsum += w;
        if (w > wbest) {
          wbest = w;
          local = l; // for the selection outline
        }
      }
      if (wsum <= 0.0) discard;
      c = acc / wsum;
    }
    c.a *= uOpacity * fade;
    if (uHighlight > 0.5 && fade > 0.5) {
      // Dashed outline marking the selected image (display only, never exported).
      vec2 cm = local * uSize;
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
        uMode: { value: 0 },
        uAxisOrigin: { value: new THREE.Vector3() },
        uAxisDir: { value: new THREE.Vector3() },
        uAxisA: { value: new THREE.Vector3() },
        uAxisRight: { value: new THREE.Vector3() },
        uRadius: { value: 1 },
        uCenterT: { value: 0 },
        uRot: { value: new THREE.Vector2(1, 0) },
        uRadial: { value: new THREE.Vector2() },
        uSide: { value: 0 },
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
      const wrap = d.mode === 'wrap';
      u.uMode.value = wrap ? 1 : 0;
      if (wrap) {
        const w = wrapFrame(d, asset.aspect);
        u.uAxisOrigin.value.fromArray(w.origin);
        u.uAxisDir.value.fromArray(w.dir);
        u.uAxisA.value.fromArray(w.A);
        u.uAxisRight.value.fromArray(w.right);
        u.uRadius.value = w.radius;
        u.uCenterT.value = w.tc;
        u.uRot.value.set(w.cos, w.sin);
        u.uRadial.value.fromArray(w.radialRange);
        u.uSide.value = w.side;
      }
      r.render(this.scene, this.camera);
    });
    target.texture.generateMipmaps = wantsMips;
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
  }
}
