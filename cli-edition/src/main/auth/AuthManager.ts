import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'
import { getAuth, setAuth } from '@shared/main/settings/SettingsStore'

const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json')
const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json')
const TOKEN_BUFFER_MS = 5 * 60 * 1000  // refresh 5 minutes before expiry
const CLI_REFRESH_TIMEOUT_MS = 12000    // hard ceiling (claude doctor の auth check 完了に最大10秒程度かかる)
const CLI_REFRESH_POLL_MS = 200         // poll interval for early-exit

async function readAccountEmail(): Promise<string | undefined> {
  try {
    const raw = await readFile(CLAUDE_CONFIG_PATH, 'utf-8')
    const cfg = JSON.parse(raw)
    const email = cfg?.oauthAccount?.emailAddress
    return typeof email === 'string' ? email : undefined
  } catch {
    return undefined
  }
}

export async function tryCliRefresh(): Promise<boolean> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf-8')
    const creds = JSON.parse(raw)
    const oauth = creds?.claudeAiOauth
    if (!oauth?.accessToken) return false
    const rawExpiry: number | undefined = oauth.expiresAt
    const expiresAt = rawExpiry
      ? rawExpiry < 1e12 ? rawExpiry * 1000 : rawExpiry
      : Date.now() + 3600 * 1000
    if (expiresAt <= Date.now() + TOKEN_BUFFER_MS) return false

    // ~/.claude.json を読むのは「token 変化時」または「キャッシュに email 無し（初回 or upgrade 直後）」のみ
    const existing = getAuth()
    const tokenChanged = !existing || existing.accessToken !== oauth.accessToken
    const needsEmailRead = tokenChanged || !existing?.email
    const email = needsEmailRead ? await readAccountEmail() : existing?.email

    setAuth({ accessToken: oauth.accessToken, refreshToken: oauth.refreshToken, expiresAt, email })
    return true
  } catch {
    return false
  }
}

export async function initialize(): Promise<boolean> {
  // 1. CLI credentials を最優先（CLI が自動更新するため常に最新）
  if (await tryCliRefresh()) return true

  // 2. electron-store の既存トークン（以前の OAuth で取得済みの場合）
  const stored = getAuth()
  if (stored && stored.expiresAt > Date.now() + TOKEN_BUFFER_MS) return true

  return false
}

export function getToken(): string | null {
  const auth = getAuth()
  if (!auth) return null
  if (auth.expiresAt <= Date.now() + TOKEN_BUFFER_MS) return null
  return auth.accessToken
}

export function getAccountEmail(): string | undefined {
  return getAuth()?.email
}

export type CliCredentialsState = 'fresh' | 'expired' | 'missing'

export async function getCliCredentialsState(): Promise<CliCredentialsState> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf-8')
    const creds = JSON.parse(raw)
    const oauth = creds?.claudeAiOauth
    if (!oauth?.accessToken) return 'missing'
    const rawExpiry: number | undefined = oauth.expiresAt
    if (!rawExpiry) return 'expired'
    const expiresAt = rawExpiry < 1e12 ? rawExpiry * 1000 : rawExpiry
    return expiresAt > Date.now() + TOKEN_BUFFER_MS ? 'fresh' : 'expired'
  } catch {
    return 'missing'
  }
}

async function isCredentialFresh(): Promise<boolean> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf-8')
    const oauth = JSON.parse(raw)?.claudeAiOauth
    if (!oauth?.accessToken) return false
    const e = oauth.expiresAt
    if (!e) return false
    const ms = e < 1e12 ? e * 1000 : e
    return ms > Date.now() + TOKEN_BUFFER_MS
  } catch {
    return false
  }
}

// 期限切れ検知時に CLI サブプロセスを起動して CLI 自身に refresh を肩代わりさせる。
// `claude doctor` は起動時に auth チェックを行い、期限切れなら refreshToken で更新する。
// ただし doctor は途中で credentials.json を一度 touch するため、mtime 変化だけ見ると
// refresh 完了前に false-positive で kill してしまう。よって「expiresAt が未来か」を
// 直接確認する isCredentialFresh() で成功判定する。
// 200ms 毎に確認、refresh 確認次第 kill して resolve。最大 8秒で諦める。
// Windows では claude が npm shim の .cmd なので shell:true で起動。
export async function spawnCliRefresh(): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false
    let proc: ReturnType<typeof spawn> | null = null
    const finish = (ok: boolean) => {
      if (resolved) return
      resolved = true
      try { proc?.kill() } catch { /* noop */ }
      clearInterval(poller)
      clearTimeout(timer)
      resolve(ok)
    }

    const poller = setInterval(async () => {
      if (await isCredentialFresh()) finish(true)
    }, CLI_REFRESH_POLL_MS)

    const timer = setTimeout(async () => {
      finish(await isCredentialFresh())
    }, CLI_REFRESH_TIMEOUT_MS)

    try {
      proc = spawn('claude', ['doctor'], { shell: true, stdio: 'ignore' })
      proc.on('exit', () => {
        setTimeout(async () => finish(await isCredentialFresh()), 300)
      })
      proc.on('error', () => finish(false))
    } catch {
      finish(false)
    }
  })
}
