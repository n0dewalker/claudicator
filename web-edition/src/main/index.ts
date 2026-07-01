import { app, Menu, powerMonitor, nativeTheme } from 'electron'
import { startPolling, onUpdate, refresh } from './usage/UsageService'
import { initTray, updateTrayIcon, sendToPopup, openSettings, getEffectiveState } from './tray/TrayController'
import { getSettings } from '@shared/main/settings/SettingsStore'
import { applyAutoLaunch } from '@shared/main/startup/AutoLaunch'
import { checkForUpdate } from '@shared/main/update/UpdateChecker'
import { registerIpcHandlers } from './ipc/handlers'

export const VERBOSE = !app.isPackaged || process.env.CLAUDICATOR_VERBOSE === '1'

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  app.setAppUserModelId('com.yozak.claudicator-web')

  registerIpcHandlers()

  const settings = getSettings()
  applyAutoLaunch(settings.autoStart)
  // ダーク時に Windows の OS タイトルバーも黒くする（BiRec と同じ挙動）
  nativeTheme.themeSource = settings.theme ?? 'dark'

  initTray()

  if (process.env['CLAUDICATOR_AUTO_VERIFY']) {
    setTimeout(() => openSettings(), 2000)
  }

  startPolling()
  powerMonitor.on('resume', () => refresh())

  // 起動時に1回だけ新バージョンを確認（通知のみ・自動更新なし）。失敗は無視される。
  void checkForUpdate({
    owner: 'n0dewalker',
    repo: 'claudicator',
    channelPrefix: 'web',
    currentVersion: app.getVersion(),
  })

  onUpdate(() => {
    const state = getEffectiveState()
    updateTrayIcon(state)
    sendToPopup(state)
  })
})

app.on('window-all-closed', () => {
  // Tray app: keep running
})
