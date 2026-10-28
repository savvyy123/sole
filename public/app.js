// memorial sole
// 名前 → 靴のサイズ → 地面の写真 → 場所の名前 → 気持ち（一本の線）→ home（完成までのアニメーション）

import { SoleGraphic } from './graphic.js';   // solegraphic/graphic.js の写し（調整したらここにもコピーする）
import { Viewer } from './viewer.js';
import { saveWork, listWorks } from './store.js';

const MODEL = '3ddata/sole.glb';   // サーバーの public/ の中
const UV = '3ddata/sole_uv.json';
const CANVAS_H = 2048;            // グラフィックのキャンバスの高さ。幅はソールの比率から決める

const SHOE = { min: 22, max: 30 };   // 受け付ける靴のサイズ（cm）
const TOE_ROOM_CM = 1.5;              // ソールの長さ = 靴のサイズ + 余裕

// 印刷：Figma の Print-tate / Print-Yoko（595 幅）を A3（297mm 幅）に広げて刷る
const SHEET_UNITS_PER_MM = 595 / 297;

// 画面の組み方。縦長の画面（スマホ）では Figma の iPhone 用を使う
//   gallery … ほかの人のソールの並べ方（left の数が列の数）
//   pad     … 描く面のキャンバス。unit は「線の点の1単位」に当たるキャンバスの px
//             （勢いや揺れの基準を PC とそろえるため、スマホでは点を 1/2 にして記録する）
const LAYOUTS = {
  pc: {
    w: 1920, h: 1080,
    // Figma の展開したページ：2列、左 120px / 右 1020px、1行目 1084px、行の間隔 660px
    gallery: { top: 1084, row: 660, left: [120, 1020], cardHeight: 541, bottom: 120 },
    pad: { w: 1727, h: 837, unit: 1 },
  },
  mobile: {
    w: 393, h: 852,
    // スマホ用の Figma がまだないので仮：home と同じ枠を1列に
    gallery: { top: 900, row: 680, left: [0], cardHeight: 621, bottom: 60 },
    pad: { w: 840, h: 1600, unit: 2 },
  },
};

// 画面の切り替え：前の画面が消えるのにこの時間、そのあと次の画面が現れるのにこの時間
const FADE_MS = 400;
document.documentElement.style.setProperty('--fade', `${FADE_MS}ms`);

const MIN_STROKE = 120;           // これより短い線は、うっかり触れたものとして描き直しにする（px）
const AFTER_STROKE_MS = 600;      // 描き終えてから home へ進むまで

// 仕様書「完成までのアニメーション」の時間（ミリ秒）
const TIMING = {
  gather: 2000,       // 1. 入力の振り返り
  attach: 2000,       // 2. 写真がソールに貼りつく（最初の turn で真上からの向きへ）
  turn: 800,
  dissolve: 12000,    // 3. 崩れていく
  finishTurn: 1500,   // 4. 完成：斜めの角度へ回る
};

const $ = (id) => document.getElementById(id);

// FONTPLUS はページにある文字だけを届けるので、あとから文字を入れたら読み込み直す
const refreshFonts = () => window.FONTPLUS?.reload(false);
const pad = $('pad');

let viewer = null;
let graphic = null;
let modelLengthCm = 28.5;
let soleAspect = 2.7565;   // ソールの長さ ÷ 幅
let soleOutline = [];      // 真上から見たソールの輪郭（UV。v はかかと 0 → つま先 1）
let finished = false;      // 完成までのアニメーションが終わったか（終わるまでは印刷しない）
let photo = null;
let strokes = [];
let myWorkId = null;      // 今作ったソール（ほかの人の一覧からは外す）

// ---------------------------------------------------------------------------
// 1920×1080 の画面をウィンドウに合わせて拡大縮小する
// ほかの人のソールを開くと、画面の高さ（stageH）が伸びて下へスクロールできる
// ---------------------------------------------------------------------------
let layout = null;        // LAYOUTS の pc か mobile
let stageH = 1080;
let scale = 1;
let offsetY = 0;

function fit() {
  const vw = document.documentElement.clientWidth;    // スクロールバーの幅を除く
  const vh = document.documentElement.clientHeight;

  const next = vw < vh ? LAYOUTS.mobile : LAYOUTS.pc;
  if (next !== layout) {
    layout = next;
    document.documentElement.classList.toggle('mobile', layout === LAYOUTS.mobile);
    stageH = layout.h;
    setupPad();
    if (galleryWorks.length) layoutGallery();
  }

  // 画面全体が収まるように（スクロールするのは、ほかの人のソールを開いたときだけ）
  scale = Math.min(vw / layout.w, vh / layout.h);
  offsetY = Math.max(0, (vh - layout.h * scale) / 2);
  const root = document.documentElement.style;
  root.setProperty('--s', scale);
  root.setProperty('--w', `${layout.w}px`);
  root.setProperty('--x', `${(vw - layout.w * scale) / 2}px`);
  root.setProperty('--y', `${offsetY}px`);
  root.setProperty('--h', `${stageH}px`);
  $('sizer').style.height = `${offsetY * 2 + stageH * scale}px`;
  viewer?.setStageScale(scale);
}
addEventListener('resize', fit);

// ---------------------------------------------------------------------------
// 画面の切り替え
// ---------------------------------------------------------------------------
function go(name) {
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.toggle('active', el.dataset.screen === name);
  }
  // 次の画面は前の画面が消えるまで隠れていて、その間は入力欄にカーソルを置けないので待つ
  const input = document.querySelector(`[data-screen="${name}"] input.front`);
  if (input) setTimeout(() => input.focus(), FADE_MS + 20);
  if (name === 'home') generate();
}

// Enter で次へ。日本語入力の変換を確定する Enter では進まない
function onEnter(input, fn) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    fn();
  });
}

// --- 1. 名前 ---
onEnter($('name'), () => {
  if ($('name').value.trim()) go('size');
});

// --- 2. 靴のサイズ（cm）。数字と小数点だけ。全角で打っても半角にそろえる ---
function shoeSize() {
  const v = Number($('size').value);
  return v >= SHOE.min && v <= SHOE.max ? v : null;
}

function cleanSize() {
  const raw = $('size').value;
  let v = raw.normalize('NFKC').replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  if (v !== raw) $('size').value = v;
}
$('size').addEventListener('input', (e) => { if (!e.isComposing) cleanSize(); });
$('size').addEventListener('compositionend', cleanSize);
onEnter($('size'), () => {
  if (shoeSize()) go('photo');
});

// --- 3. 地面の写真：選んだら次へ ---
$('pick').addEventListener('click', () => $('photo').click());
$('photo').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    photo = img;
    go('place');
  };
  img.src = URL.createObjectURL(file);
});

// --- 4. 場所の名前 ---
const toFeeling = () => {
  if ($('place').value.trim()) go('feeling');
};
onEnter($('place'), toFeeling);

// --- 5. 気持ち：一本の線。離した時点で描き終わり ---
// 線は絵としてだけでなく、時刻つきの点の列として残す（描き方から気持ちを読むため）
const padG = pad.getContext('2d');
let padUnit = 1;          // 線の点の1単位に当たるキャンバスの px
let drawing = null;       // 描いている途中の点の列

// 描く前なら、キャンバスを今の画面の組み方の大きさにする（大きさを変えると描いたものは消える）
function setupPad() {
  if (drawing || strokes.length) return;
  const { w, h, unit } = layout.pad;
  pad.width = w;
  pad.height = h;
  padUnit = unit;
  padG.lineWidth = 3 * unit;
  padG.lineCap = padG.lineJoin = 'round';
  padG.strokeStyle = '#000';
}

{
  const g = padG;
  let done = false;

  // 記録する点は padUnit で割った単位。描くときはキャンバスの px に戻す
  const point = (e) => {
    const r = pad.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (pad.width / r.width) / padUnit,
      y: (e.clientY - r.top) * (pad.height / r.height) / padUnit,
      t: e.timeStamp,
    };
  };

  pad.addEventListener('pointerdown', (e) => {
    if (done) return;
    pad.setPointerCapture(e.pointerId);
    drawing = [point(e)];
  });

  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    // 速く動かしたときの途中の点も拾う
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = point(ev);
      const last = drawing.at(-1);
      g.beginPath();
      g.moveTo(last.x * padUnit, last.y * padUnit);
      g.lineTo(p.x * padUnit, p.y * padUnit);
      g.stroke();
      drawing.push(p);
    }
  });

  const end = () => {
    if (!drawing) return;
    const pts = drawing;
    drawing = null;
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (length < MIN_STROKE) {
      g.clearRect(0, 0, pad.width, pad.height);   // 短すぎる線は消して、もう一度
      return;
    }
    done = true;
    strokes = [pts];
    setTimeout(() => go('home'), AFTER_STROKE_MS);
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// 6. home：完成までのアニメーション
// ---------------------------------------------------------------------------
function frames(ms, fn) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

let ready = null;   // モデルの読み込みが終わったら解決する

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generate() {
  finished = false;
  await ready;
  await wait(FADE_MS);   // 前の画面が消えるのを待ってから始める（最初の「名前」が見えるように）

  viewer.setScale((shoeSize() + TOE_ROOM_CM) / modelLengthCm);
  graphic.prepare({
    photo,
    drawing: pad,
    strokes,
    padW: pad.width / padUnit,
    name: $('name').value,
    place: $('place').value,
  });
  viewer.refresh();
  viewer.setFade(0);
  viewer.showIdle();

  // 1. 入力の振り返り：名前、場所の名前、地面の写真、描いた線が、上から順にそれぞれの欄に現れる
  $('out-name').textContent = $('name').value.trim();
  $('out-place').textContent = $('place').value.trim();
  refreshFonts();
  $('out-picture').src = photo.src;
  // 写真が横長なら、Picture の箱を横長にする（正方形は縦長の箱）
  $('result').classList.toggle('landscape', isLandscape(photo));
  $('out-stroke').src = pad.toDataURL();
  const items = [...document.querySelectorAll('[data-screen="home"] .reveal')];
  await frames(TIMING.gather, (t) => {
    items.forEach((el, i) => el.classList.toggle('in', t >= i / items.length));
  });

  // 2. 写真がソールに貼りつく：真上から見たソールに、まだ崩れていない写真が浮かぶ
  await frames(TIMING.turn, (t) => viewer.setToTop(easeOut(t)));
  await frames(TIMING.attach - TIMING.turn, (t) => viewer.setFade(easeOut(t)));

  // 3. 崩れていく：最初はゆっくり、途中から速く、最後はゆっくり着地
  await frames(TIMING.dissolve, (t) => {
    graphic.stepTo(graphic.total * easeInOut(t));
    viewer.refresh();
  });

  // 4. 完成：斜めの角度へ回って全体が見える
  await frames(TIMING.finishTurn, (t) => viewer.setToFinal(easeInOut(t)));

  finished = true;
  await saveCurrent();
}

// ---------------------------------------------------------------------------
// 印刷：print your memory.
// ---------------------------------------------------------------------------

// 真上から見たソール：グラフィックをソールの輪郭で切り抜く
// グラフィックのキャンバスはソールの外接矩形そのもの（上がつま先、左右は真上から見たまま）
function drawFlatSole(canvas) {
  const k = 2;   // 輪郭の縁がなめらかに刷れるよう、倍の細かさで描く
  const src = graphic.canvas;
  canvas.width = src.width * k;
  canvas.height = src.height * k;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.save();
  g.beginPath();
  soleOutline.forEach(([u, v], i) => g[i ? 'lineTo' : 'moveTo'](u * canvas.width, (1 - v) * canvas.height));
  g.closePath();
  g.clip();
  g.drawImage(src, 0, 0, canvas.width, canvas.height);
  g.restore();
}

async function printSheet() {
  if (!finished) return;

  const lengthMm = (shoeSize() + TOE_ROOM_CM) * 10;
  const sole = $('sheet-sole');
  drawFlatSole(sole);
  sole.style.height = `${lengthMm * SHEET_UNITS_PER_MM}px`;
  sole.style.width = `${(lengthMm / soleAspect) * SHEET_UNITS_PER_MM}px`;

  $('sheet').classList.toggle('landscape', isLandscape(photo));
  $('sheet-name').textContent = $('name').value.trim();
  $('sheet-place').textContent = $('place').value.trim();
  $('sheet-picture').src = photo.src;
  $('sheet-stroke').src = pad.toDataURL();
  await Promise.all([$('sheet-picture').decode(), $('sheet-stroke').decode()]);

  print();
}

$('print').addEventListener('click', printSheet);

// ---------------------------------------------------------------------------
// 保存と、ほかの人のソール
// ---------------------------------------------------------------------------
const isLandscape = (img) => img.naturalWidth > img.naturalHeight;

// 写真は一覧で使う大きさに縮めて保存する
function thumbnail(img, max = 720) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = Object.assign(document.createElement('canvas'), {
    width: Math.round(img.naturalWidth * k),
    height: Math.round(img.naturalHeight * k),
  });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

// 描いた線の点の列を、小さく丸めて保存用にする（[x, y, 書き始めからの ms]）
const packStroke = (pts) => pts.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.t - pts[0].t)]);

async function saveCurrent() {
  const work = {
    name: $('name').value.trim(),
    place: $('place').value.trim(),
    shoeSize: shoeSize(),
    landscape: isLandscape(photo),
    energy: graphic.feel?.energy ?? null,
    jagged: graphic.feel?.jagged ?? null,
    sole: viewer.snapshot(),
    picture: thumbnail(photo, 1600),   // 縮めて描き直すので、写真の位置情報（GPS）は残らない
    stroke: pad.toDataURL(),
    strokePoints: strokes.map(packStroke),
  };
  try {
    myWorkId = await saveWork(work);
  } catch (e) {
    console.warn(e);   // サーバーが止まっているときなど。画面はそのまま
  }
}

// Other's sole.：home の下にほかの人のソールを並べ、そこまでスクロールする
let galleryWorks = [];

// カードの位置とページの長さ（画面の組み方が変わったときも並べ直す）
function layoutGallery() {
  const G = layout.gallery;
  const cols = G.left.length;
  [...$('gallery').children].forEach((card, i) => {
    card.style.left = `${G.left[i % cols]}px`;
    card.style.top = `${G.top + Math.floor(i / cols) * G.row}px`;
  });
  const rows = Math.ceil(galleryWorks.length / cols);
  stageH = G.top + (rows - 1) * G.row + G.cardHeight + G.bottom;
}

async function openGallery() {
  let works = [];
  try {
    works = (await listWorks()).filter((w) => w.id !== myWorkId);
  } catch (e) {
    console.warn('読み込めませんでした', e);
  }

  const gallery = $('gallery');
  gallery.replaceChildren();
  works.forEach((w) => {
    const card = $('card').content.firstElementChild.cloneNode(true);
    card.querySelector('.panel').classList.toggle('landscape', w.landscape);
    card.querySelector('.sole-image').src = w.sole;
    card.querySelector('.v-name').textContent = w.name;
    card.querySelector('.v-place').textContent = w.place;
    card.querySelector('.v-picture').src = w.picture;
    card.querySelector('.v-stroke').src = w.stroke;
    gallery.append(card);
  });
  refreshFonts();
  galleryWorks = works;
  if (!works.length) return;

  layoutGallery();
  document.documentElement.classList.add('scrollable');
  fit();
  window.scrollTo({ top: offsetY + (layout.gallery.top - 80) * scale, behavior: 'smooth' });
}

$('others').addEventListener('click', openGallery);

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
fit();
go('name');

ready = (async () => {
  const uv = await (await fetch(UV)).json();
  modelLengthCm = uv.sole_length_m * 100;
  soleAspect = uv.aspect_length_per_width;
  soleOutline = uv.outline_uv;
  const W = Math.round(CANVAS_H / uv.aspect_length_per_width);
  graphic = new SoleGraphic(W, CANVAS_H, (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }));

  viewer = new Viewer($('view'));
  fit();
  await viewer.load(MODEL);
  viewer.setTexture(graphic.canvas);
})();

ready.catch((e) => {
  console.error(e);
  $('message').textContent =
    `読み込めませんでした（${e.message}）。memorialsole-server で node server.mjs を実行して開いてください。`;
});
