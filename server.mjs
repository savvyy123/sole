import express from "express";
import { fileURLToPath } from "node:url";
import { db } from "./db.mjs";

const app = express();
const publicDir = fileURLToPath(new URL("./public/", import.meta.url));

// 画像を data URL のまま受け取るので、大きめに受け付ける（1人あたり 1MB 前後）
app.use(express.json({ limit: "8mb" }));

app.get("/", (req, res) => {
  res.sendFile(`${publicDir}/index.html`);
});

app.use(express.static(publicDir));

// --- 受け取った値を確かめる（ブラウザー側の入力制限だけに頼らない） ---

const NAME_MAX = 24;
const PLACE_MAX = 40;
const SHOE = { min: 22, max: 30 };
const IMAGE_MAX = 4 * 1024 * 1024;   // 画像1枚あたり

// "data:image/png;base64,..." → Buffer。種類が違うものや大きすぎるものは null
function decodeImage(dataUrl, type) {
  const prefix = `data:${type};base64,`;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) return null;
  const buf = Buffer.from(dataUrl.slice(prefix.length), "base64");
  return buf.length > 0 && buf.length <= IMAGE_MAX ? buf : null;
}

const text = (v, max) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const unit = (v) => (typeof v === "number" && v >= 0 && v <= 1 ? v : null);

// --- 保存 ---

const insertWork = db.prepare(`
  INSERT INTO works (name, place, shoe_size, landscape, energy, jagged, sole, picture, stroke, stroke_points)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

app.post("/works", (req, res) => {
  const b = req.body ?? {};
  const name = text(b.name, NAME_MAX);
  const place = text(b.place, PLACE_MAX);
  const shoeSize = Number(b.shoeSize);
  const sole = decodeImage(b.sole, "image/png");
  const picture = decodeImage(b.picture, "image/jpeg");
  const stroke = decodeImage(b.stroke, "image/png");
  const points = Array.isArray(b.strokePoints) ? JSON.stringify(b.strokePoints) : null;

  if (
    !name || !place || !(shoeSize >= SHOE.min && shoeSize <= SHOE.max) ||
    typeof b.landscape !== "boolean" || !sole || !picture || !stroke ||
    (points && points.length > 2 * 1024 * 1024)
  ) {
    return res.status(400).json({ error: "invalid" });
  }

  const { lastInsertRowid } = insertWork.run(
    name, place, shoeSize, b.landscape ? 1 : 0,
    unit(b.energy), unit(b.jagged),
    sole, picture, stroke, points,
  );
  res.status(201).json({ id: Number(lastInsertRowid) });
});

// --- 一覧（新しい順）。画像は URL だけ返し、カードがそれぞれ読み込む ---

const listWorks = db.prepare(`
  SELECT id, name, place, shoe_size, landscape, created_at FROM works ORDER BY id DESC
`);

app.get("/works", (req, res) => {
  res.json(listWorks.all().map((w) => ({
    id: w.id,
    name: w.name,
    place: w.place,
    shoeSize: w.shoe_size,
    landscape: w.landscape === 1,
    createdAt: w.created_at,
    sole: `/works/${w.id}/sole`,
    picture: `/works/${w.id}/picture`,
    stroke: `/works/${w.id}/stroke`,
  })));
});

// --- 画像 ---

const IMAGES = { sole: "image/png", picture: "image/jpeg", stroke: "image/png" };
const selectImage = Object.fromEntries(
  Object.keys(IMAGES).map((k) => [k, db.prepare(`SELECT ${k} AS data FROM works WHERE id = ?`)]),
);

app.get("/works/:id/:kind", (req, res) => {
  const type = IMAGES[req.params.kind];
  const id = Number.parseInt(req.params.id, 10);
  if (!type || !Number.isInteger(id)) return res.sendStatus(404);
  const row = selectImage[req.params.kind].get(id);
  if (!row) return res.sendStatus(404);
  res.type(type).set("Cache-Control", "public, max-age=31536000, immutable").send(Buffer.from(row.data));
});

// 0.0.0.0 は、PC のネットワーク接続を通じてリクエストを受け付ける指定。
// 同じ Wi-Fi の端末からも、トンネル経由でも、ここで受ける。
app.listen(3000, "0.0.0.0", () => {
  console.log("http://localhost:3000 で起動しました");
});
