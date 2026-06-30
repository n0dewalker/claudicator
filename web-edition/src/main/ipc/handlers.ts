import { ipcMain, BrowserWindow, shell, app, nativeTheme } from 'electron'
import { getSettings, updateSettings, resetSettings } from '@shared/main/settings/SettingsStore'
import { refresh, getState, restartPolling } from '../usage/UsageService'
import { openSettings, updateTrayIcon, sendToPopup, sendSettingsToPopup, adjustWindowPosition } from '../tray/TrayController'
import { applyAutoLaunch } from '@shared/main/startup/AutoLaunch'
import { getCachedUpdateInfo } from '@shared/main/update/UpdateChecker'
import { openLoginWindow, logout } from '../auth/WebAuthManager'
import type { Settings } from '@shared/main/types'

export function registerIpcHandlers(): void {
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('update:get', () => getCachedUpdateInfo())

  ipcMain.handle('usage:get', () => getState())

  ipcMain.handle('usage:refresh', async () => {
    await refresh()
    return getState()
  })

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:set', (_e, partial: Partial<Settings>) => {
    updateSettings(partial)
    if (partial.autoStart !== undefined) applyAutoLaunch(partial.autoStart)
    if (partial.refreshInterval !== undefined) restartPolling()
    if (partial.theme !== undefined) nativeTheme.themeSource = partial.theme
    const state = getState()
    updateTrayIcon(state)
    sendToPopup(state)
    sendSettingsToPopup(getSettings())
  })

  ipcMain.handle('settings:reset', () => {
    resetSettings()
    const settings = getSettings()
    applyAutoLaunch(settings.autoStart)
    restartPolling()
    nativeTheme.themeSource = settings.theme ?? 'dark'
    const state = getState()
    updateTrayIcon(state)
    sendToPopup(state)
    sendSettingsToPopup(settings)
  })

  ipcMain.on('auth:login', async () => {
    await openLoginWindow()
    await refresh()
    const s = getState()
    updateTrayIcon(s)
    sendToPopup(s)
  })

  ipcMain.on('auth:logout', async () => {
    await logout()
    await refresh()
    const s = getState()
    updateTrayIcon(s)
    sendToPopup(s)
  })

  ipcMain.on('shell:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  ipcMain.on('window:openSettings', () => openSettings())

  // ── 現在の利用状況（2026-05-14）──
  // 自動リサイズを切断し固定 WIN_H 運用に切り替えたため、現在 renderer 側からこのハンドラは
  // 発火されない。コードは将来の再配線用に残してある。再有効化する場合は、ダミーアプリで
  // DPI ドリフト防止策（setContentSize + Math.round、rAF コアレッシング、lastSent ガード、
  // getContentSize 読み戻しによる幅軸ドリフト回避）を検証した上で行うこと。
  // 安易な再配線は hide/show・タブ切替での寸法ドリフトを再発させる。
  ipcMain.on('window:resize', (e, height: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const [contentW, currentContentH] = win.getContentSize()
    const target = Math.max(100, Math.min(900, Math.round(height)))
    if (target === currentContentH) return
    win.setContentSize(contentW, target)
    adjustWindowPosition()
  })
}
