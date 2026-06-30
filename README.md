# Claudicator

Claude の使用量をタスクトレイ（システムトレイ）に常駐表示する Windows 向けデスクトップアプリです。5 時間枠・週次枠などの利用状況をひと目で確認でき、トレイアイコン自体にも使用量を描画します。

同じプロダクトを、使用量の取得方法が異なる 2 つの版（edition）で提供しています。

| 版 | データの取得元 | 必要なもの |
|---|---|---|
| **CLI 版**（`cli-edition/`） | Claude Code（CLI）がローカルに出力するログ（`~/.claude/projects/`） | Claude Code のインストール・ログイン |
| **Web 版**（`web-edition/`） | claude.ai の Web セッション経由で取得 | ブラウザでの claude.ai ログイン |

> CLI 版は Claude Code を普段使う人向け、Web 版は claude.ai（ウェブ）側の使用量を見たい人向けです。

## 主な機能

- **タスクトレイ常駐**: トレイアイコンに使用量を描画（棒グラフ／円グラフを選択可、グリッド線の表示も可）。
- **複数メーター表示**: 現在のセッション（5 時間）、すべてのモデル（7 日）、Sonnet のみ（7 日）、追加使用量など。
- **使用量に応じた色分け**（任意）: しきい値（中／高）で色を変える。オフのときは常に青。
- **新バージョン通知**: 起動時に GitHub の最新版を確認し、新しい版があればポップアップ上部にバナーを表示します（自動更新はせず、通知＋ダウンロードリンクのみ）。
- **ライト／ダークテーマ**、**日本語／英語**切替、**Windows 起動時の自動実行**、更新間隔・タイムゾーンの設定。

## ダウンロード / インストール

最新版は [Releases](https://github.com/n0dewalker/claudicator/releases) からダウンロードできます。

- Claudicator（claude.ai / Web セッション版・標準）: `Claudicator Setup x.y.z.exe`
- Claudicator CLI（Claude Code のローカルログ版）: `Claudicator CLI Setup x.y.z.exe`

ダウンロードしたインストーラを実行してください。

> ⚠️ 現在コード署名をしていないため、初回起動時に Windows SmartScreen の警告が出る場合があります。「詳細情報」→「実行」で起動できます。

## 開発（ソースからビルド）

必要環境: Node.js（LTS 推奨）。

```sh
# 例: Web 版（CLI 版は cli-edition/ で同じ手順）
cd web-edition
npm install
npm run dev        # 開発起動
npm run dist:win   # Windows 向けインストーラをビルド（build/ に出力）
npm test           # テスト
```

## リポジトリ構成

- `cli-edition/` — CLI 版（Electron + React + TypeScript）
- `web-edition/` — Web 版
- `shared/` — 両版で共有するコード（型・設定・トレイ描画・共通 UI・i18n など）

## 技術スタック

Electron / electron-vite / React / TypeScript / Tailwind CSS / electron-builder
