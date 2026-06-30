# shared/

将来の共通コード置き場。現状は空。

## 共通化候補

- `src/renderer/src/components/` — UsageBar, UsageSection, ResetTime, ThresholdZigzagBar, ErrorView
- `src/renderer/src/i18n/` — en.ts, ja.ts, index.ts
- `src/main/i18n.ts`
- `src/main/settings/SettingsStore.ts`
- `src/main/tray/` — IconGenerator.ts, TrayController.ts
- `src/main/startup/AutoLaunch.ts`

## 差分として維持する箇所

- 認証・取得層: CLI 版は `AuthManager` + `ApiClient`、Web 版は `WebAuthManager` + `WebApiClient` + `CliSetupGuide` / `WebLoginPrompt`
