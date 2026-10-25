import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const dbPath = fileURLToPath(new URL("./works.sqlite", import.meta.url));

export const db = new DatabaseSync(dbPath);

// 1人のソール = 1行。
// 画像（sole / picture / stroke）もこのファイルの中に入れるので、works.sqlite 1つで記録がすべて揃う。
// energy / jagged は描き方から読み取った値（集計用）。stroke_points があれば崩れ方を作り直せる。
db.exec(`
  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    place TEXT NOT NULL,
    shoe_size REAL NOT NULL,
    landscape INTEGER NOT NULL,
    energy REAL,
    jagged REAL,
    sole BLOB NOT NULL,
    picture BLOB NOT NULL,
    stroke BLOB NOT NULL,
    stroke_points TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
