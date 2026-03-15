# CLAUDE.md — OBJ Polygon Clipper

## プロジェクト概要
MinewaysでエクスポートしたOBJファイルから、任意の多角形範囲だけを切り出すElectronデスクトップアプリ。
Minewaysは矩形選択のみだが、このツールで自由な多角形選択＋高さ制限付きでOBJを再エクスポートできる。

## ワークフロー
1. `.mcworld`（Bedrock）→ Chunkerで Java Edition 1.21.x に変換
2. Minewaysで全体をOBJエクスポート（MTL＋texフォルダ付き）
3. **このツール**でOBJを読み込み → 3Dビューで多角形選択 → 選択範囲だけを新OBJとしてエクスポート

## アーキテクチャ
- **フレームワーク:** Electron + Three.js
- **Node.js:** v25, npm v11
- **Electron:** v41
- **Three.js:** v0.183

### ファイル構成
```
├── main.js          # Electronメインプロセス（ウィンドウ管理、IPCハンドラ）
├── preload.js       # contextBridge（IPC公開）
├── app.html         # レンダラー（Three.js 3Dビュー、UI、ポリゴン描画）
├── obj-parser.js    # OBJパーサー（ストリーム処理、マテリアル別グループ化、MTL/テクスチャ対応）
├── obj-clipper.js   # OBJクリッパー（ポリゴン内外判定＋高さフィルタ、MTL/texコピー）
├── package.json
├── clip_obj.py      # 旧Pythonツール（未使用、削除可）
├── index.html       # 旧Webツール（未使用、削除可）
└── dataset/
    ├── testobj.obj   # Minewaysエクスポート（279MB, 437万頂点）
    ├── testobj.mtl   # マテリアル定義（162マテリアル）
    └── tex/          # テクスチャPNG（162枚）
```

### IPC通信
- `open-file-dialog` → ファイル選択ダイアログ
- `load-obj` → OBJパース（マテリアル別、プログレス通知）
- `export-clipped-obj` → ポリゴン＋高さ範囲でクリップしてOBJ出力（MTL/texコピー付き）
- `load-progress` / `export-progress` → プログレス通知（メイン→レンダラー）

### 3Dビュー仕様
- PerspectiveCamera + OrbitControls（回転・パン・ズーム）
- マテリアル別メッシュ＋テクスチャ表示（NearestFilter）
- ポリゴン描画: レイキャストでメッシュ表面のXZ座標を取得
- 確定後: 2Dオーバーレイ消去 → 3D ExtrudeGeometry（半透明赤）で選択ボリューム表示
- 高さ: 底面Y=0固定、上面のみスライダーで調整（マイナス不可）

### クリッピング仕様
- Pass 1: 全頂点のXZ内外判定（ray-casting）＋Y範囲フィルタ
- Pass 2: 全頂点がinside な面だけを出力（vt/vnはそのまま全出力）
- `mtllib`行は出力ファイル名に合わせて書き換え
- MTLファイルとtexフォルダを出力先にコピー

## 開発ルール
- 日本語でコミュニケーションする
- ツール実行時に許可を求めず自動的に進める
- CesiumJS / 3D Tiles は使わない

## 既知の課題・TODO
- ExtrudeGeometryのZ反転対応済み（Shapeに-zを渡す）
- webSecurity: false でローカルテクスチャ読み込み許可中
- DevToolsは本番では非表示に設定済み

## 環境
- macOS (Darwin 24.6.0, ARM)
- Cursor (IDE) で開発中
- Python 3.14（clip_obj.py用、現在未使用）
