// 作ったソールの保存先：このページを返しているサーバー（server.mjs → works.sqlite）

// work: { name, place, shoeSize, landscape, energy, jagged, sole, picture, stroke, strokePoints }
//   sole / stroke は PNG、picture は JPEG の data URL
// 戻り値はサーバーが振った id
export async function saveWork(work) {
  const res = await fetch('/works', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(work),
  });
  if (!res.ok) throw new Error(`保存できませんでした（${res.status}）`);
  return (await res.json()).id;
}

// 新しい順。画像は URL（/works/:id/sole など）で返る
export async function listWorks() {
  const res = await fetch('/works', { cache: 'no-store' });
  if (!res.ok) throw new Error(`読み込めませんでした（${res.status}）`);
  return res.json();
}
