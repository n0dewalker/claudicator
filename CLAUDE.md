# Claudicator

Claude Code の使用量を可視化する Electron アプリ。同一プロダクトを 2 つの形態で提供している：

- `cli-edition/` — Claude CLI が出力するローカルログ (`~/.claude/projects/`) を読み取って表示する版
- `web-edition/` — Claude.ai の Web セッション経由で API を叩いて表示する版（ブラウザログイン必要）

## 改修依頼の解釈ルール

ユーザーが「Claudicator の◯◯を直して」「Claudicator に◯◯機能を追加して」のように
**版を指定せずに依頼した場合は、cli-edition と web-edition の両方が改修対象**。

「Web 版の◯◯」「CLI 版の◯◯」のように版を明示した場合のみ、その版のみが対象。

両版で構造が違う箇所（認証・データ取得層）に関わる改修では、各版の差を踏まえて
個別に実装する。共通レイヤ（UI / i18n / Tray / Settings）は両版で同じ変更を入れる。

## shared/

将来的に共通コード（i18n, components, tray, SettingsStore 等）を `shared/` に切り出す予定の
箱として `claude-usage-visualizer/shared/` を用意してある。**今は空（README のみ）**。
共通化は別タスクで順次実施する。
