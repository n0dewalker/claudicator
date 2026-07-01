import { Tray, Menu, BrowserWindow, app, screen } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { generateTrayIcon } from '@shared/main/tray/IconGenerator'
import { getSettings } from '@shared/main/settings/SettingsStore'
import { getState } from '../usage/UsageService'
import { getTrayErrorMessage } from '@shared/main/i18n'
import type { UsageState, Settings } from '@shared/main/types'
import iconPng from '../../../assets/icon.png?asset'

// ── Dev helper ──────────────────────────────────────────────────────────────
// Set DEMO_MODE = true to preview the tray icon and window with dummy data.
// Switch back to false (or remove) before shipping.
const DEMO_MODE = false

function getDemoState(): UsageState {
  const in2h = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const in5d = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
  return {
    data: {
      five_hour: { utilization: 72, resets_at: in2h },
      seven_day: { utilization: 45, resets_at: in5d },
      seven_day_sonnet: { utilization: 88, resets_at: in5d },
      // Claude Design は 2026-05 に共有枠へ統合され、本番では API が null を返して自動で非表示になる。
      // デモも本番挙動に合わせて null にする（ダミー値を入れると本番では出ない枠が見えてしまうため）。
      seven_day_claude_design: null,
      extra_usage: { is_enabled: true, utilization: 12, used_credits: 120, monthly_limit: 1000, currency: 'USD' },
    },
    error: null,
    fetchedAt: Date.now(),
  }
}

// DEMO_MODE 判定の一元窓口。tray／popup／IPC の全経路がここを通ることで、
// 「トレイは demo なのに popup は real」のような部分デモ状態を構造的に防ぐ。
export function getEffectiveState(): UsageState {
  return DEMO_MODE ? getDemoState() : getState()
}
// ────────────────────────────────────────────────────────────────────────────

let tray: Tray | null = null
let mainWin: BrowserWindow | null = null
let lastBlurAt = 0

const WIN_W = 760
const WIN_H = 520

function calcWindowPos(): { x: number; y: number } {
  if (!tray) return { x: 100, y: 100 }
  const tb = tray.getBounds()
  const display = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y })
  const wa = display.workArea
  const sb = display.bounds
  let x = Math.round(tb.x + tb.width / 2 - WIN_W / 2)
  let y = Math.round(tb.y - WIN_H - 4)
  x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - WIN_W - 4))
  y = Math.max(sb.y + 4, y)
  return { x, y }
}

function createMainWindow(pos?: { x: number; y: number }): BrowserWindow {
  const win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: pos?.x,
    y: pos?.y,
    icon: iconPng,
    frame: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    show: false,
    // 開窓時の白フラッシュ防止（テーマに合わせた地色）。ダーク bg は BiRec と同じ #16161a
    backgroundColor: getSettings().theme === 'light' ? '#ffffff' : '#16161a',
    title: 'Claudicator CLI',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenuBarVisibility(false)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => { mainWin = null })
  win.on('blur', () => { lastBlurAt = Date.now() })
  return win
}

export function adjustWindowPosition(): void {
  if (!mainWin || !tray) return
  const tb = tray.getBounds()
  const wb = mainWin.getBounds()
  const display = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y })
  const sb = display.bounds
  const taskbarTop = tb.y
  // WIN_H を権威値として使う。getBounds().height は DPI ラウンドトリップでドリフトするため使わない。
  const winBottom = wb.y + WIN_H
  if (winBottom > taskbarTop - 4) {
    const newY = Math.max(sb.y + 4, taskbarTop - WIN_H - 4)
    mainWin.setBounds({ x: wb.x, y: newY, width: WIN_W, height: WIN_H }, false)
  }
}

function dumpVerifyDiagnostics(pos: { x: number; y: number }): void {
  if (!process.env['CLAUDICATOR_AUTO_VERIFY'] || !mainWin || !tray) return
  const tb = tray.getBounds()
  const display = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y })
  const samples: Array<{ at: number; bounds: { x: number; y: number; width: number; height: number } }> = []
  const writeDump = () => {
    const payload = {
      timestamp: new Date().toISOString(),
      uptimeSec: process.uptime(),
      edition: app.getName(),
      windowTitle: mainWin?.getTitle(),
      tray: tb,
      display: {
        id: display.id,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
      },
      calculatedPos: pos,
      windowSamples: samples,
      env: { autoVerify: true, demoMode: DEMO_MODE },
    }
    const target = join(app.getPath('temp'), 'claudicator-verify.json')
    const tmp = target + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmp, target)
  }
  const sampleAt = (delay: number) => setTimeout(() => {
    if (!mainWin) return
    samples.push({ at: delay, bounds: mainWin.getBounds() })
    if (delay === 500) writeDump()
  }, delay)
  sampleAt(0)
  sampleAt(100)
  sampleAt(500)
}

function showMainWindow(): void {
  const pos = calcWindowPos()

  if (!mainWin) {
    mainWin = createMainWindow(pos)
    mainWin.once('ready-to-show', () => {
      if (!mainWin) return
      mainWin.webContents.send('usage:update', getEffectiveState())
      mainWin.webContents.send('settings:update', getSettings())
      mainWin.setBounds({ x: pos.x, y: pos.y, width: WIN_W, height: WIN_H }, false)
      mainWin.show()
      mainWin.focus()
      dumpVerifyDiagnostics(pos)
    })
    return
  }

  mainWin.webContents.send('usage:update', DEMO_MODE ? getDemoState() : getState())
  mainWin.webContents.send('settings:update', getSettings())
  mainWin.setBounds({ x: pos.x, y: pos.y, width: WIN_W, height: WIN_H }, false)
  mainWin.show()
  mainWin.focus()
  // 再表示時は常に使用量タブへ戻す
  mainWin.webContents.send('window:shown')
  adjustWindowPosition()
  dumpVerifyDiagnostics(pos)
}

function toggleMainWindow(): void {
  if (mainWin?.isVisible()) {
    // tray click steals focus just before the click event fires on Windows,
    // so isFocused() is already false. use blur timestamp to detect this.
    const blurredByThisClick = Date.now() - lastBlurAt < 300
    if (mainWin.isFocused() || blurredByThisClick) {
      mainWin.hide()
    } else {
      mainWin.show()
      mainWin.focus()
      mainWin.webContents.send('window:shown')
    }
  } else {
    showMainWindow()
  }
}

export function initTray(): void {
  const settings = getSettings()
  tray = new Tray(generateTrayIcon([0, 0], settings.thresholds, settings.trayShape, { enabled: settings.trayGridEnabled, divisions: settings.trayGridDivisions }, false, settings.colorMode))
  tray.setToolTip('Claudicator CLI')

  tray.on('click', () => toggleMainWindow())
  tray.on('right-click', () => showContextMenu())
  rebuildMenu()
}

export function updateTrayIcon(state: UsageState): void {
  if (!tray) return
  const settings = getSettings()
  const fh = state.data?.five_hour?.utilization ?? 0
  const sd = state.data?.seven_day?.utilization ?? 0
  const sds = state.data?.seven_day_sonnet?.utilization
  const sdd = state.data?.seven_day_claude_design?.utilization
  const errorMode = state.error !== null

  // データ駆動: API がその枠を返している（non-null）ときだけバーを出す。
  // Claude Design は 2026-05 に共有枠へ統合され null になったため自動で非表示になる
  // （omelette が non-null 化すれば自動で復活）。
  const utils: number[] = [fh, sd]
  if (settings.trayShowSonnet && sds !== undefined) utils.push(sds)
  if (settings.trayShowDesign && sdd !== undefined) utils.push(sdd)

  tray.setImage(generateTrayIcon(utils, settings.thresholds, settings.trayShape, { enabled: settings.trayGridEnabled, divisions: settings.trayGridDivisions }, errorMode, settings.colorMode))

  let tooltip: string
  if (errorMode) {
    tooltip = `Claudicator CLI\n${getTrayErrorMessage(state.error!)}`
  } else {
    const lines = [`Claudicator CLI`, `5h: ${fh}%  7d: ${sd}%`]
    if (settings.trayShowSonnet && sds !== undefined) lines.push(`Sonnet: ${sds}%`)
    if (settings.trayShowDesign && sdd !== undefined) lines.push(`Design: ${sdd}%`)
    tooltip = lines.join('\n')
  }
  tray.setToolTip(tooltip)
}

export function sendToPopup(state: UsageState): void {
  mainWin?.webContents.send('usage:update', state)
}

export function sendSettingsToPopup(settings: Settings): void {
  mainWin?.webContents.send('settings:update', settings)
}

export function openSettings(): void {
  showMainWindow()
}

function showContextMenu(): void {
  rebuildMenu()
  tray?.popUpContextMenu()
}

function rebuildMenu(): void {
  if (!tray) return
  const t = getSettings().language === 'ja'
    ? { settings: '設定', quit: '終了' }
    : { settings: 'Settings', quit: 'Quit' }

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t.settings, click: openSettings },
    { type: 'separator' },
    { label: t.quit, click: () => app.quit() },
  ]))
}
