// 底のグラフィック（仕様書「底のグラフィックのアルゴリズム」）
//
// 地面の写真を縦長の帯に切り抜き、少しずらして貼り戻す操作を数千回くり返す。
// 貼った結果が次の素材になる（フィードバック）ので、写真が少しずつ地層のような波の模様に溶けていく。
// ベースは『Generative Design』P.4.1.2「Feedback of image cutouts」。
//
// 入力の使い道：
//   地面の写真        … 切り抜く素材（色と質感のすべて）
//   描いた気持ちの線  … 形 → 波の形。描き方（勢い・部分ごとの勢い・揺れ・長さ）→ 崩れ方
//   名前 + 場所の名前 … 乱数の種。同じ入力なら同じ結果になる
//
// キャンバスの上端がつま先、下端がかかと（ソールを真上から見た向きのまま 3D に貼られる）。
// 画面や 3D には依存しない。createCanvas を渡せば Node でも動く。

// 初期値（仕様書「初期値（試しながら調整する）」）
export const DEFAULTS = {
  stripMin: 0.035,     // 帯の幅の下限（キャンバス幅に対する割合）
  stripMax: 0.05,      // 帯の幅の上限
  shiftX: 7,           // 横のずらし ±px
  shiftXNearLine: 7,   // 線の近くで横のずらしに足す分 ±px（線の近くではずらす幅を大きくする）
  shiftY: 5,           // 縦のずらし（乱数の分）±px
  curveMin: 5,         // 曲線に沿わせる縦のずらしの上限：線から遠いところ ±px
  curveMax: 15,        // 同：線の近く ±px
  stepsMin: 3000,      // 繰り返し回数：線がないとき
  stepsMax: 6000,      // 繰り返し回数：線が多いとき
  inkFull: 0.05,       // 描いた線がキャンバスのこの割合を占めたら、回数が最大になる
};

// 描き方から気持ちを読み取るときの対応（線の点の列を渡したときに使う）
// [ゆったり, 勢い] の2つの値の間を、勢い 0〜1 で動く
export const FEEL = {
  calmSpeed: 0.3,         // これより遅い線は「ゆったり」（描く面の px / ms）
  fastSpeed: 2.5,         // これより速い線は「勢いがある」
  calmTurn: 0.3,          // 100px あたりの向きの変化（rad）がこれ以下なら「なめらか」
  wildTurn: 2.5,          // これ以上なら「ぎざぎざ」
  fullLength: 2.0,        // 描く面の幅の何倍の長さで、回数が最大になるか
  localWeight: 0.6,       // 線の全体の勢いと、その場所の勢いの混ぜ具合（1 でその場所だけ）

  stripMin: [0.040, 0.020],   // 帯の幅の下限：ゆったりは幅がそろい、勢いがあるとばらつく
  stripMax: [0.046, 0.090],   // 帯の幅の上限
  shiftX: [3, 14],            // 横のずらし ±px
  shiftY: [2, 14],            // 縦のずらし（乱数の分）±px
  curveMin: [3, 10],          // 曲線に沿わせる縦のずらしの上限：線から遠いところ ±px
  curveMax: [8, 30],          // 同：線の近く ±px
  jaggedStrip: 0.5,           // いちばんぎざぎざな線のとき、帯の幅に掛ける倍率（細かく刻まれる）
};

// --- 乱数（名前と場所の名前から作り、以降はこれだけを使う） ---

// 文字列 → 32bit の数
export function seedFrom(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// 種から 0〜1 の乱数を順に返す
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 名前と場所の名前をつなぐ。区切りを入れないと「ab」+「c」と「a」+「bc」が同じ種になる
export const seedText = (name, place) => `${name.trim()}\u0000${place.trim()}`;

// --- 気持ちの絵からガイドを作る ---

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

// 描いた絵（透明な背景に線）をキャンバスと同じ大きさに縮小し、
// 縦の列ごとに「線が通っている高さの平均」を求めて曲線にする。線のない列は両隣から補う。
//   curve[x] … 列 x で曲線が通る高さ（px）
//   near[x]  … 列 x の線の近さ（0〜1）
//   ink      … 線の量（0〜1、inkFull で 1）
export function guideFromDrawing(drawing, W, H, createCanvas, params = DEFAULTS) {
  const curve = new Float32Array(W).fill(H / 2);
  const near = new Float32Array(W);
  if (!drawing) return { curve, near, ink: 0, inkRatio: 0 };

  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  g.drawImage(drawing, 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H).data;

  const sum = new Float64Array(W);
  const count = new Uint32Array(W);
  let inkPixels = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 64) {
        sum[x] += y;
        count[x]++;
        inkPixels++;
      }
    }
  }
  if (inkPixels === 0) return { curve, near, ink: 0, inkRatio: 0 };

  // 線の通る列の高さ。線のない列は、左右で一番近い線のある列から直線で補う
  const known = [];
  for (let x = 0; x < W; x++) if (count[x]) known.push(x);
  for (let x = 0; x < W; x++) {
    if (count[x]) { curve[x] = sum[x] / count[x]; continue; }
    let k = known.findIndex((kx) => kx > x);
    if (k === -1) curve[x] = sum[known.at(-1)] / count[known.at(-1)];
    else if (k === 0) curve[x] = sum[known[0]] / count[known[0]];
    else {
      const l = known[k - 1], r = known[k];
      curve[x] = lerp(sum[l] / count[l], sum[r] / count[r], (x - l) / (r - l));
    }
  }

  // 線の近さ：列ごとの線の量を、前後の列でならしてから 0〜1 に
  const radius = Math.max(1, Math.round(W * 0.03));
  let max = 0;
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let d = -radius; d <= radius; d++) s += count[clamp(x + d, 0, W - 1)];
    near[x] = s;
    max = Math.max(max, s);
  }
  for (let x = 0; x < W; x++) near[x] /= max;

  const inkRatio = inkPixels / (W * H);
  return { curve, near, ink: clamp(inkRatio / params.inkFull, 0, 1), inkRatio };
}

// --- 描き方を読む ---

// strokes：描いた線（1本以上）。それぞれ {x, y, t}（描く面の px、ms）の並び
// W：グラフィックのキャンバスの幅。場所ごとの勢いを、キャンバスの列ごとに並べ直す
export function strokeFeatures(strokes, padW, W, feel = FEEL) {
  const norm = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);

  let length = 0;
  let duration = 0;
  let turn = 0;
  // 列ごとに「通った長さ」と「かかった時間」をためる（速さ = 長さ ÷ 時間）。
  // 区間ごとの速さを平均すると、点の間隔がとても短いときに時間の丸めで速さがずれる
  const timeSum = new Float64Array(W);
  const lenSum = new Float64Array(W);

  for (const pts of strokes) {
    if (pts.length < 2) continue;
    duration += pts.at(-1).t - pts[0].t;

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d === 0) continue;
      length += d;
      const col = clamp(Math.floor(((a.x + b.x) / 2 / padW) * W), 0, W - 1);
      timeSum[col] += Math.max(0, b.t - a.t);
      lenSum[col] += d;
    }

    // 揺れ：手の細かな震えを拾わないよう、8px ごとに間引いてから向きの変化を足す
    const step = 8;
    const sampled = [pts[0]];
    for (const p of pts) {
      const q = sampled.at(-1);
      if (Math.hypot(p.x - q.x, p.y - q.y) >= step) sampled.push(p);
    }
    for (let i = 2; i < sampled.length; i++) {
      const a = sampled[i - 2], b = sampled[i - 1], c = sampled[i];
      let da = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
      da = Math.atan2(Math.sin(da), Math.cos(da));
      turn += Math.abs(da);
    }
  }

  if (length === 0) return null;

  const speed = length / Math.max(1, duration);
  const energy = norm(speed, feel.calmSpeed, feel.fastSpeed);
  const turnPer100 = turn / (length / 100);
  const jagged = norm(turnPer100, feel.calmTurn, feel.wildTurn);

  // 場所ごとの勢い。線が通らなかった列は両隣から補う
  const local = new Float32Array(W);
  const known = [];
  for (let x = 0; x < W; x++) if (lenSum[x] > 0) known.push(x);
  const at = (x) => norm(lenSum[x] / Math.max(1e-3, timeSum[x]), feel.calmSpeed, feel.fastSpeed);
  for (let x = 0; x < W; x++) {
    if (lenSum[x] > 0) { local[x] = at(x); continue; }
    const k = known.findIndex((kx) => kx > x);
    if (k === -1) local[x] = at(known.at(-1));
    else if (k === 0) local[x] = at(known[0]);
    else {
      const l = known[k - 1], r = known[k];
      local[x] = lerp(at(l), at(r), (x - l) / (r - l));
    }
  }

  return {
    speed,                                   // 平均の速さ（px / ms）
    energy,                                  // 勢い 0（ゆったり）〜 1（勢い）
    jagged,                                  // 揺れ 0（なめらか）〜 1（ぎざぎざ）
    lengthRatio: length / padW,              // 描く面の幅の何本分か
    amount: clamp(length / padW / feel.fullLength, 0, 1),
    local,                                   // 場所ごとの勢い 0〜1（キャンバスの列ごと）
  };
}

// --- 本体 ---

export class SoleGraphic {
  constructor(W, H, createCanvas) {
    this.W = W;
    this.H = H;
    this.createCanvas = createCanvas;
    this.canvas = createCanvas(W, H);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.done = 0;
    this.total = 0;
  }

  // 1. キャンバスを用意する  2. 乱数の種を作る  3. 気持ちの絵からガイドを作る
  // strokes（描いた線の点の列）と padW（描く面の幅）を渡すと、描き方から崩れ方を決める。
  // 渡さないときは params の固定の値を使う
  prepare({ photo, drawing, strokes, padW, name, place, params = {}, feel = FEEL }) {
    const { W, H, ctx } = this;
    this.params = { ...DEFAULTS, ...params };

    // 写真を余白なく収まるようにトリミングして置く
    const iw = photo.naturalWidth || photo.width;
    const ih = photo.naturalHeight || photo.height;
    const s = Math.max(W / iw, H / ih);
    ctx.drawImage(photo, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);

    this.seed = seedFrom(seedText(name, place));
    this.rand = mulberry32(this.seed);
    this.guide = guideFromDrawing(drawing, W, H, this.createCanvas, this.params);

    this.feelMap = feel;
    this.feel = strokes && padW ? strokeFeatures(strokes, padW, W, feel) : null;

    // 6. 回数は線の量で増やす（たくさん描いた人ほど崩れが進む）
    const amount = this.feel ? this.feel.amount : this.guide.ink;
    this.total = Math.round(lerp(this.params.stepsMin, this.params.stepsMax, amount));
    this.done = 0;
  }

  // 列 x での崩し方。描き方を読んでいるときは、全体の勢いとその場所の勢いを混ぜて決める
  paramsAt(x) {
    const p = this.params;
    if (!this.feel) return p;
    const f = this.feelMap;
    const e = lerp(this.feel.energy, this.feel.local[x], f.localWeight);
    const thin = lerp(1, f.jaggedStrip, this.feel.jagged);
    const pick = ([calm, wild]) => lerp(calm, wild, e);
    return {
      stripMin: pick(f.stripMin) * thin,
      stripMax: pick(f.stripMax) * thin,
      shiftX: pick(f.shiftX),
      shiftXNearLine: 0,
      shiftY: pick(f.shiftY),
      curveMin: pick(f.curveMin),
      curveMax: pick(f.curveMax),
    };
  }

  // 4. 1ステップを実行する  5. 貼り付ける
  // 1回に使う乱数は常に4つ。並びが変わらないので、同じ入力なら同じ結果になる
  step() {
    const { W, H, ctx, rand, guide } = this;

    // 帯の幅は切り抜く場所が決まる前に要るので、場所を先に決めてから幅を決める
    // （乱数を使う順番を固定しておけば、同じ入力で同じ結果になる）
    const r1 = rand(), r2 = rand();
    const p = this.paramsAt(clamp(Math.floor(r2 * W), 0, W - 1));
    const w = Math.max(2, Math.round(W * lerp(p.stripMin, p.stripMax, r1)));
    const x1 = Math.floor(r2 * (W - w + 1));
    const near = guide.near[clamp(x1 + (w >> 1), 0, W - 1)];

    const reach = p.shiftX + p.shiftXNearLine * near;
    const x2 = Math.round(x1 + (rand() * 2 - 1) * reach);

    // 縦のずらし = 乱数のずれ + 曲線の x1 と x2 での高さの差（線の近くほど大きく許す）
    const limit = lerp(p.curveMin, p.curveMax, near);
    const c1 = guide.curve[clamp(x1 + (w >> 1), 0, W - 1)];
    const c2 = guide.curve[clamp(x2 + (w >> 1), 0, W - 1)];
    const y2 = Math.round((rand() * 2 - 1) * p.shiftY + clamp(c2 - c1, -limit, limit));

    ctx.drawImage(this.canvas, x1, 0, w, H, x2, y2, w, H);
    this.done++;
  }

  // n 回目まで進める（アニメーションは毎フレームここを呼ぶ。総回数は変わらないので、速さを変えても完成品は同じ）
  stepTo(n) {
    const target = Math.min(this.total, Math.round(n));
    while (this.done < target) this.step();
  }

  get finished() {
    return this.done >= this.total;
  }
}
