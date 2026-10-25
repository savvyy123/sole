# memorial sole

名前・靴のサイズ・好きな場所の地面の写真・場所の名前・その時の気持ちを描いた一本の線から、
自分だけのソールを作る Web サービス（授業・ポートフォリオ用のプロトタイプ）。

地面の写真を細い帯に切り抜いてずらして貼り戻す操作を数千回くり返し、ソールのグラフィックにする
（『Generative Design』P.4.1.2 がベース）。線の描き方（勢い・場所ごとの勢い・揺れ・長さ）が崩れ方を決め、
名前と場所の名前が乱数の種になる。

## 動かし方

```
npm ci
npm start
```

`http://localhost:3000` を開く。同じネットワークの端末からは `http://<この PC の IP>:3000`。

## 構成

```
server.mjs        ページを返し、作ったソールを記録する（Express）
db.mjs            works テーブル（SQLite。画像も同じファイルに入る）
public/
  index.html      6つの画面（Figma 1920×1080 をそのまま組み、ウィンドウに合わせて拡大縮小）
  app.js          画面の流れと、完成までのアニメーション
  graphic.js      ソールのグラフィックの処理
  viewer.js       3D 表示（three.js）
  store.js        記録の保存と一覧
  3ddata/         ソールのモデル（.glb）と展開の情報
```

## リポジトリに含めていないもの

- `works.sqlite` … 記録。参加者の名前と写真が入るため
- `public/fonts/` … Neue Haas Grotesk Display Round（Commercial Type）の Trial 版。
  規約で再配布と Web 埋め込みが許可されていないため。インストールされている端末では `local()` で使われ、
  なければ代わりの書体で表示される
