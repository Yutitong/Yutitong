// The 3D view: the jumpsuit (textured with the baked collage) on a simple mannequin.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARM_DIR, WRIST_CENTER, legCenterX } from '../geometry/body.js';

export class GarmentView {
  constructor(renderer, element, pieces, layout, atlasTexture) {
    this.element = element;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eceae6');
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
    this.camera.position.set(0, 80, 330);
    this.needsFit = true;
    this.controls = new OrbitControls(this.camera, element);
    this.controls.target.set(0, 78, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 700;
    this.controls.update();

    const key = new THREE.DirectionalLight('#ffffff', 1.25);
    key.position.set(120, 260, 200);
    const rim = new THREE.DirectionalLight('#ffffff', 0.5);
    rim.position.set(-200, 120, -180);
    this.scene.add(key, rim, new THREE.HemisphereLight('#ffffff', '#b8b0a4', 0.35));

    this.garment = new THREE.Group();
    this.scene.add(this.garment);
    const outer = new THREE.MeshStandardMaterial({ map: atlasTexture, roughness: 0.82, metalness: 0 });
    const inner = new THREE.MeshStandardMaterial({ color: '#8d8a86', roughness: 0.9, side: THREE.BackSide });
    this.pickables = [];
    const seamPositions = [];
    pieces.forEach((piece, i) => {
      const [ox, oy] = layout.offsets[i];
      const g = new THREE.BufferGeometry();
      const n = piece.gridVertexCount;
      g.setAttribute('position', new THREE.BufferAttribute(piece.positions.slice(0, n * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(piece.normals.slice(0, n * 3), 3));
      const uv = new Float32Array(n * 2);
      for (let v = 0; v < n; v++) {
        uv[2 * v] = (piece.pattern[2 * v] + ox) / layout.width;
        uv[2 * v + 1] = (piece.pattern[2 * v + 1] + oy) / layout.height;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(piece.displayIndex, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, outer);
      mesh.userData.pieceIndex = i;
      this.pickables.push(mesh);
      this.garment.add(mesh, new THREE.Mesh(g, inner));
      seamPositions.push(...seamLoop3D(piece));
    });
    const seamGeom = new THREE.BufferGeometry();
    seamGeom.setAttribute('position', new THREE.Float32BufferAttribute(seamPositions, 3));
    this.seams = new THREE.LineSegments(
      seamGeom,
      new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28 }),
    );
    this.garment.add(this.seams);

    this.mannequin = buildMannequin();
    this.scene.add(this.mannequin, buildFloor());
    this.raycaster = new THREE.Raycaster();
  }

  setSeamsVisible(v) {
    this.seams.visible = v;
  }

  // Raycast the garment at client coordinates. Returns the surface point and the
  // direction an image placed there should be projected along (world space).
  pick(clientX, clientY) {
    const rect = this.element.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    if (!hits.length) return null;
    const h = hits[0];
    const g = h.object.geometry;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const { a, b, c } = h.face;
    const tri = new THREE.Triangle(
      new THREE.Vector3().fromBufferAttribute(pos, a),
      new THREE.Vector3().fromBufferAttribute(pos, b),
      new THREE.Vector3().fromBufferAttribute(pos, c),
    );
    const bary = tri.getBarycoord(h.point, new THREE.Vector3());
    const normal = new THREE.Vector3()
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, a), bary.x)
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, b), bary.y)
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(nrm, c), bary.z)
      .normalize();
    // Project mostly along the view direction so images land the way they look on
    // screen, tilted slightly toward the surface so they wrap naturally on curves.
    const toCamera = this.camera.position.clone().sub(h.point).normalize();
    const projection = toCamera.multiplyScalar(0.7).addScaledVector(normal, 0.3).normalize();
    return { point: h.point.toArray(), normal: projection.toArray() };
  }

  project(p) {
    const v = new THREE.Vector3(...p).project(this.camera);
    const rect = this.element.getBoundingClientRect();
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
  }

  // Move the camera back far enough that the whole figure fits the current view.
  fit(aspect) {
    const halfH = 98; // figure spans roughly y = -20 .. 176
    const halfW = 62;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hfov = Math.atan(Math.tan(vfov) * aspect);
    const dist = Math.max(halfH / Math.tan(vfov), halfW / Math.tan(hfov)) * 1.05 + 25;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  render(renderer, rect) {
    this.camera.aspect = rect.width / rect.height;
    if (this.needsFit) {
      this.fit(this.camera.aspect);
      this.needsFit = false;
    }
    this.controls.update();
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }
}

function seamLoop3D(piece) {
  // Boundary of the grid, in 3D, as line segments (matches the pattern's seam line).
  const { nu, nv } = piece.grid;
  const idx = [];
  for (let i = 0; i < nu; i++) idx.push(i);
  for (let j = 1; j < nv; j++) idx.push(j * nu + nu - 1);
  for (let i = nu - 2; i >= 0; i--) idx.push((nv - 1) * nu + i);
  for (let j = nv - 2; j >= 0; j--) idx.push(j * nu);
  const out = [];
  const p = piece.positions;
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k];
    const b = idx[k + 1];
    out.push(p[3 * a], p[3 * a + 1], p[3 * a + 2], p[3 * b], p[3 * b + 1], p[3 * b + 2]);
  }
  return out;
}

function buildMannequin() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#d8d2c8', roughness: 0.55 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), mat);
  head.scale.set(0.82, 1.08, 0.95);
  head.position.set(0, 159, 0.5);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.8, 26, 32), mat);
  neck.position.set(0, 142, -1);
  group.add(head, neck);
  for (const side of [1, -1]) {
    const hand = new THREE.Mesh(new THREE.CapsuleGeometry(3.6, 9, 8, 24), mat);
    const dir = new THREE.Vector3(ARM_DIR[0] * side, ARM_DIR[1], 0);
    hand.position.set(WRIST_CENTER[0] * side, WRIST_CENTER[1], 0).addScaledVector(dir, 5);
    hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    hand.scale.set(1, 1, 0.65);
    const x = legCenterX(0) * side;
    const ankle = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 16, 24), mat);
    ankle.position.set(x, 1, -1);
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(4.2, 15, 8, 24), mat);
    foot.rotation.x = Math.PI / 2;
    foot.scale.set(1, 1, 0.75);
    foot.position.set(x, -8, 3);
    group.add(hand, ankle, foot);
  }
  return group;
}

function buildFloor() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 60),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -12;
  return floor;
}
