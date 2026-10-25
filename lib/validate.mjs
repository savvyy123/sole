// 送られてきたソールの記録を確かめる（ブラウザー側の入力制限だけに頼らない）
// 手元のサーバー（server.mjs）と Netlify（netlify/functions/works.mjs）の両方で使う

const NAME_MAX = 24;
const PLACE_MAX = 40;
const SHOE = { min: 22, max: 30 };
const IMAGE_MAX = 4 * 1024 * 1024;        // 画像1枚あたり
const POINTS_MAX = 2 * 1024 * 1024;       // 描いた線の点の列（JSON）

export const IMAGE_TYPES = { sole: "image/png", picture: "image/jpeg", stroke: "image/png" };

// "data:image/png;base64,..." → Buffer。種類が違うものや大きすぎるものは null
function decodeImage(dataUrl, type) {
  const prefix = `data:${type};base64,`;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) return null;
  const buf = Buffer.from(dataUrl.slice(prefix.length), "base64");
  return buf.length > 0 && buf.length <= IMAGE_MAX ? buf : null;
}

const text = (v, max) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const unit = (v) => (typeof v === "number" && v >= 0 && v <= 1 ? v : null);

// 正しければ { name, place, shoeSize, landscape, energy, jagged, images: { sole, picture, stroke }, points }
// 正しくなければ null
export function parseWork(b) {
  if (!b || typeof b !== "object") return null;

  const name = text(b.name, NAME_MAX);
  const place = text(b.place, PLACE_MAX);
  const shoeSize = Number(b.shoeSize);
  const images = {};
  for (const [kind, type] of Object.entries(IMAGE_TYPES)) images[kind] = decodeImage(b[kind], type);
  const points = Array.isArray(b.strokePoints) ? JSON.stringify(b.strokePoints) : null;

  if (
    !name || !place || !(shoeSize >= SHOE.min && shoeSize <= SHOE.max) ||
    typeof b.landscape !== "boolean" ||
    Object.values(images).some((img) => !img) ||
    (points && points.length > POINTS_MAX)
  ) {
    return null;
  }

  return {
    name, place, shoeSize,
    landscape: b.landscape,
    energy: unit(b.energy),
    jagged: unit(b.jagged),
    images,
    points,
  };
}
