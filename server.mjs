import express from "express";
import { fileURLToPath } from "node:url";
import { db } from "./db.mjs";
import { parseWork, IMAGE_TYPES } from "./lib/validate.mjs";

const app = express();
const publicDir = fileURLToPath(new URL("./public/", import.meta.url));

// 画像を data URL のまま受け取るので、大きめに受け付ける（1人あたり 1MB 前後）
app.use(express.json({ limit: "8mb" }));

app.get("/", (req, res) => {
  res.sendFile(`${publicDir}/index.html`);
});

app.use(express.static(publicDir));

// --- 保存 ---

const insertWork = db.prepare(`
  INSERT INTO works (name, place, shoe_size, landscape, energy, jagged, sole, picture, stroke, stroke_points)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

app.post("/works", (req, res) => {
  const w = parseWork(req.body);   // 確かめ方は Netlify 版と共通（lib/validate.mjs）
  if (!w) return res.status(400).json({ error: "invalid" });

  const { lastInsertRowid } = insertWork.run(
    w.name, w.place, w.shoeSize, w.landscape ? 1 : 0, w.energy, w.jagged,
    w.images.sole, w.images.picture, w.images.stroke, w.points,
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

const selectImage = Object.fromEntries(
  Object.keys(IMAGE_TYPES).map((k) => [k, db.prepare(`SELECT ${k} AS data FROM works WHERE id = ?`)]),
);

app.get("/works/:id/:kind", (req, res) => {
  const type = IMAGE_TYPES[req.params.kind];
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
