// The 2D view: the pattern pieces laid out on the fabric, showing exactly what will print.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { offsetPolygon } from '../geometry/pieces.js';

export class PatternView {
  constructor(element, pieces, layout, atlasTexture) {
    this.element = element;
    this.pieces = pieces;
    this.layout = layout;
    this.texture = atlasTexture;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dcd8d2');
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.camera.position.set(layout.width / 2, layout.height / 2, 5);
    this.controls = new OrbitControls(this.camera, element);
    this.controls.enableRotate = false;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.target.set(layout.width / 2, layout.height / 2, 0);
    this.controls.minZoom = 0.5;
    this.controls.maxZoom = 40;
    this.controls.update();
    this.viewHeight = layout.height * 1.08;

    const fabric = new THREE.Mesh(
      new THREE.PlaneGeometry(layout.width, layout.height),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    );
    fabric.position.set(layout.width / 2, layout.height / 2, -1);
    this.scene.add(fabric);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.labels = pieces.map((p, i) => this.makeLabel(p, i));
    this.setSeamAllowance(1.5);
  }

  makeLabel(piece, i) {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.font = '600 56px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeText(piece.name, 320, 48);
    ctx.fillStyle = '#222';
    ctx.fillText(piece.name, 320, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 4.5),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    const [ox, oy] = this.layout.offsets[i];
    mesh.position.set(piece.center[0] + ox, piece.center[1] + oy, 0.5);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    return mesh;
  }

  setLabelsVisible(v) {
    this.labels.forEach((l) => (l.visible = v));
  }

  setSeamAllowance(sa) {
    this.group.clear();
    const { layout } = this;
    this.pieces.forEach((piece, i) => {
      const [ox, oy] = layout.offsets[i];
      const cut = offsetPolygon(piece.seamLoop, sa);
      const shape = new THREE.Shape(cut.map(([x, y]) => new THREE.Vector2(x + ox, y + oy)));
      const g = new THREE.ShapeGeometry(shape);
      const pos = g.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let v = 0; v < pos.count; v++) {
        uv[2 * v] = pos.getX(v) / layout.width;
        uv[2 * v + 1] = pos.getY(v) / layout.height;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      this.group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.texture })));

      const line = (poly, material) => {
        const pts = poly.map(([x, y]) => new THREE.Vector3(x + ox, y + oy, 0.1));
        const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material);
        l.computeLineDistances();
        l.renderOrder = 2;
        return l;
      };
      this.group.add(line(cut, new THREE.LineBasicMaterial({ color: '#111111' })));
      this.group.add(
        line(
          piece.seamLoop,
          new THREE.LineDashedMaterial({ color: '#d0203a', dashSize: 0.8, gapSize: 0.5 }),
        ),
      );
      const [a, b] = piece.grain;
      const arrow = [
        [a[0], a[1]],
        [b[0], b[1]],
        [b[0] - 1, b[1] - 2],
        [b[0], b[1]],
        [b[0] + 1, b[1] - 2],
      ].map(([x, y]) => new THREE.Vector3(x + ox, y + oy, 0.1));
      const grain = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(arrow),
        new THREE.LineBasicMaterial({ color: '#111111', transparent: true, opacity: 0.55 }),
      );
      grain.renderOrder = 2;
      this.group.add(grain);
    });
  }

  render(renderer, rect) {
    this.controls.update();
    const aspect = rect.width / rect.height;
    const h = Math.max(this.viewHeight, (this.layout.width * 1.08) / aspect);
    this.camera.left = (-h * aspect) / 2;
    this.camera.right = (h * aspect) / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }
}
