// ソールの 3D 表示（home 画面の縦長の箱の中）
// 足が乗る面の素材 Sole_Graphic にグラフィックのキャンバスを貼り、向きを切り替える。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// 向き（モデルは Y が上、つま先が -Z。カメラは +Z から見ている）
// つま先を上にした縦向き
const deg = THREE.MathUtils.degToRad;
const rot = (axis, d) => new THREE.Quaternion().setFromAxisAngle(axis, deg(d));
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

const TOP = rot(X, 90);                                 // 真上から：足が乗る面が手前、つま先が上
const IDLE = rot(X, -40).multiply(TOP.clone());         // 床に置いたソールを斜め上から
const FINAL = rot(Y, -25).multiply(IDLE.clone());       // 完成：少し横に振る

const BLACK = new THREE.Color(0.016, 0.016, 0.018);
const CAMERA_DISTANCE = 0.70;   // 縦向きのソール（最大 31.5cm）が縦長の箱に収まる距離
const WHITE = new THREE.Color(1, 1, 1);

export class Viewer {
  constructor(container) {
    this.container = container;
    this.stageScale = 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);   // Figma の枠と同じ白
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(0.3, 0.6, 1);
    this.scene.add(key);

    this.camera = new THREE.PerspectiveCamera(30, 240 / 388, 0.01, 10);
    this.camera.position.set(0, 0, CAMERA_DISTANCE);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;

    this.pivot = new THREE.Group();   // 回転の中心をソールの中心にするための入れ物
    this.pivot.quaternion.copy(IDLE);
    this.scene.add(this.pivot);

    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  // 画面全体を拡大縮小しているので、その倍率ぶん解像度を上げてにじまないようにする
  setStageScale(s) {
    this.stageScale = s;
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth;   // 拡大縮小前の大きさ（900×600）
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio * this.stageScale, 3));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));   // 回転の中心をソールの中心に
    this.pivot.add(model);

    model.traverse((o) => {
      if (o.isMesh && o.material.name === 'Sole_Graphic') this.surface = o;
    });
    if (!this.surface) throw new Error('Sole_Graphic の素材が見つかりません');
    this.surface.material = new THREE.MeshStandardMaterial({
      name: 'Sole_Graphic', color: BLACK.clone(), roughness: 0.8, metalness: 0,
    });
  }

  setTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;   // glTF の UV に合わせる（キャンバスの上端 = つま先）
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.surface.material.map = tex;
    this.surface.material.needsUpdate = true;
    this.texture = tex;
  }

  refresh() {
    if (this.texture) this.texture.needsUpdate = true;
  }

  // 0 = 黒いソール、1 = グラフィックがそのまま見える
  setFade(f) {
    this.surface.material.color.copy(BLACK).lerp(WHITE, f);
  }

  // 足のサイズに合わせた大きさ（1 = モデルのまま）
  setScale(s) {
    this.pivot.scale.setScalar(s);
  }

  // ギャラリー用の画像。ドラッグで回したカメラではなく、決まった位置から撮る
  snapshot() {
    const cam = this.camera.clone();
    cam.position.set(0, 0, CAMERA_DISTANCE);
    cam.lookAt(0, 0, 0);
    this.renderer.render(this.scene, cam);   // 描いた直後なら、そのまま画像として読み出せる
    return this.renderer.domElement.toDataURL('image/png');
  }

  setToTop(f) { this.pivot.quaternion.copy(IDLE).slerp(TOP, f); }
  setToFinal(f) { this.pivot.quaternion.copy(TOP).slerp(FINAL, f); }
  showIdle() { this.pivot.quaternion.copy(IDLE); }
}
