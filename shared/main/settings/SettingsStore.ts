import Store from 'electron-store'
import type { Settings, AuthData } from '../types'

type StoreSchema = Settings & { auth?: AuthData }

const DEFAULTS: Settings = {
  trayShape: 'donut',
  trayGridEnabled: false,
  trayGridDivisions: 4,
  trayShowSonnet: true,
  trayShowDesign: false,
  thresholds: { medium: 50, high: 75 },
  colorByUsage: false,
  refreshInterval: 3,
  language: 'ja',
  theme: 'dark',
  autoStart: true,
  timezone: 'auto',
}

let store: Store<StoreSchema> | null = null

function getStore(): Store<StoreSchema> {
  if (!store) {
    store = new Store<StoreSchema>({ defaults: DEFAULTS as StoreSchema })
  }
  return store
}

export function getSettings(): Settings {
  const s = getStore()
  return {
    trayShape: s.get('trayShape') ?? 'bar',
    trayGridEnabled: s.get('trayGridEnabled') ?? false,
    trayGridDivisions: (() => {
      const raw = s.get('trayGridDivisions')
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return 4
      return Math.max(2, Math.min(20, Math.round(raw)))
    })(),
    trayShowSonnet: s.get('trayShowSonnet') ?? false,
    trayShowDesign: s.get('trayShowDesign') ?? false,
    thresholds: (() => {
      const t = s.get('thresholds') as unknown as Record<string, unknown>
      const medium = typeof t?.medium === 'number' ? t.medium : 50
      const high   = typeof t?.high   === 'number' ? t.high   : 75
      return { medium, high }
    })(),
    colorByUsage: s.get('colorByUsage') ?? false,
    refreshInterval: (() => {
      const raw = s.get('refreshInterval')
      if (typeof raw !== 'number') return 3
      // 旧仕様（秒: 30〜3600）→ 分に変換して書き戻し
      if (raw >= 30) {
        const minutes = Math.max(1, Math.min(10, Math.round(raw / 60)))
        s.set('refreshInterval', minutes)
        return minutes
      }
      return Math.max(1, Math.min(10, raw))
    })(),
    language: s.get('language'),
    theme: s.get('theme'),
    autoStart: s.get('autoStart'),
    timezone: s.get('timezone'),
  }
}

export function resetSettings(): void {
  const s = getStore()
  for (const [key, value] of Object.entries(DEFAULTS)) {
    s.set(key as keyof Settings, value as never)
  }
}

export function updateSettings(partial: Partial<Settings>): void {
  const s = getStore()
  for (const [key, value] of Object.entries(partial)) {
    s.set(key as keyof Settings, value as never)
  }
}

export function getAuth(): AuthData | undefined {
  return getStore().get('auth') as AuthData | undefined
}

export function setAuth(data: AuthData): void {
  getStore().set('auth', data)
}
