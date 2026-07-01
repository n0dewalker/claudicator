export interface UsageItem {
  utilization: number
  resets_at: string
}

export interface ExtraUsage {
  is_enabled: boolean
  utilization: number | null
  used_credits: number | null
  monthly_limit: number | null
  currency: string | null
}

export interface UsageData {
  five_hour: UsageItem | null
  seven_day: UsageItem | null
  seven_day_sonnet: UsageItem | null
  seven_day_claude_design: UsageItem | null
  extra_usage: ExtraUsage | null
}

export type UsageError =
  | 'unauthenticated'
  | 'session_expired'
  | 'rate_limited'
  | 'network_error'
  | 'server_error'
  | 'unknown_error'

export interface UsageState {
  data: UsageData | null
  fetchedAt: number | null
  error: UsageError | null
  accountEmail?: string
}

export interface Settings {
  trayShape: 'bar' | 'donut'
  trayGridEnabled: boolean
  trayGridDivisions: number  // 2–20
  trayShowSonnet: boolean
  trayShowDesign: boolean
  thresholds: { medium: number; high: number }
  colorMode: 'none' | 'item' | 'usage'
  refreshInterval: number
  language: 'ja' | 'en'
  theme: 'dark' | 'light'
  autoStart: boolean
  timezone: string
  // 表示対象の org UUID。null = 自動選択（Team > Pro > Free）。Web 版のみ使用。
  selectedOrgId: string | null
}

// Renderer 表示用の org 情報。listOrganizations が返す最小限のセット。
export interface OrgInfo {
  uuid: string
  name: string
  plan: 'team' | 'pro' | 'free'
}

export interface AuthData {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  email?: string
}

export interface UpdateInfo {
  available: boolean
  latestVersion?: string
  url?: string
}
