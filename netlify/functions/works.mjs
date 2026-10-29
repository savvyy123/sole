// memorial sole の記録（Netlify Functions 版。手元では server.mjs が同じことをする）
//   POST /works            … 1足ぶん保存する → { id }
//   GET  /works            … 新しい順の一覧（画像は URL だけ）
//   GET  /works/:id/:kind  … 画像（sole / picture / stroke / flat）
//
// 保存先は Netlify Blobs。1足を1件として、別々のキーに保存する
// （1つにまとめると、同時に保存した人どうしの書き込みがぶつかるため。numberspace と同じ）。
//   work/<id>           … 名前・場所・サイズなど（JSON）
//   image/<id>/<kind>   … 画像そのもの

import { getStore } from "@netlify/blobs";
import { parseWork, IMAGE_TYPES } from "../../lib/validate.mjs";

const WORK = "work/";
const image = (id, kind) => `image/${id}/${kind}`;
const ID = /^\d{15}-[0-9a-f]{8}$/;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const withUrls = (w) => ({
  ...w,
  sole: `/works/${w.id}/sole`,
  picture: `/works/${w.id}/picture`,
  stroke: `/works/${w.id}/stroke`,
  flat: w.flat ? `/works/${w.id}/flat` : null,   // 真上から見たソール。足す前の記録にはない
});

// store を外から渡せるようにしておく（Netlify の外でも動作を確かめられるように）
export async function handle(req, store, params = {}) {
  // --- 画像 ---
  if (params.kind) {
    const type = IMAGE_TYPES[params.kind];
    if (req.method !== "GET" || !type || !ID.test(params.id)) return new Response(null, { status: 404 });
    const data = await store.get(image(params.id, params.kind), { type: "arrayBuffer" });
    if (!data) return new Response(null, { status: 404 });
    return new Response(data, {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  // --- 一覧（新しい順） ---
  if (req.method === "GET") {
    const { blobs } = await store.list({ prefix: WORK });
    const works = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }))))
      .filter(Boolean)
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .map(withUrls);
    return json(works, 200, { "Cache-Control": "no-store" });
  }

  // --- 保存 ---
  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid" }, 400);
    }
    const w = parseWork(body);
    if (!w) return json({ error: "invalid" }, 400);

    // キーは保存した時刻＋乱数。時刻順に並び、同じミリ秒に2人来ても重ならない
    const now = Date.now();
    const id = `${String(now).padStart(15, "0")}-${crypto.randomUUID().slice(0, 8)}`;

    // 画像を先に置き、最後に一覧に載る情報を置く（途中で失敗しても、画像のない記録は一覧に出ない）
    await Promise.all(Object.entries(w.images).map(([kind, buf]) =>
      store.set(image(id, kind), new Blob([buf], { type: IMAGE_TYPES[kind] }))));
    await store.setJSON(WORK + id, {
      id,
      name: w.name,
      place: w.place,
      shoeSize: w.shoeSize,
      landscape: w.landscape,
      energy: w.energy,
      jagged: w.jagged,
      strokePoints: w.points,
      flat: "flat" in w.images,
      createdAt: new Date(now).toISOString(),
    }, { onlyIfNew: true });

    return json({ id }, 201);
  }

  return json({ error: "method not allowed" }, 405, { Allow: "GET, POST" });
}

// 保存した直後に一覧へ出るよう、読み書きとも strong にする
export default (req, context) =>
  handle(req, getStore({ name: "memorialsole", consistency: "strong" }), context.params);

export const config = { path: ["/works", "/works/:id/:kind"] };
