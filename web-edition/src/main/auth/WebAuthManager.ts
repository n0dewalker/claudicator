import { BrowserWindow, session } from 'electron'
import { VERBOSE } from '../index'

const PARTITION = 'persist:claudicator-web'

let loginWin: BrowserWindow | null = null
let cachedOrgId: string | null = null
let cachedEmail: string | null | undefined = undefined // undefined = not yet fetched

function vlog(msg: string, data?: unknown) {
  if (VERBOSE) console.log('[verbose][WebAuth]', msg, data ?? '')
}

export function getWebSession() {
  return session.fromPartition(PARTITION)
}

export async function isLoggedIn(): Promise<boolean> {
  const ses = getWebSession()
  await ses.cookies.flushStore()
  const cookies = await ses.cookies.get({ domain: 'claude.ai' })
  vlog('isLoggedIn', { cookie_count: cookies.length, names: cookies.map(c => c.name) })
  return cookies.length > 0
}

// Debug helper: log all claude.ai cookies to main process console
export async function debugCookies(): Promise<void> {
  const ses = getWebSession()
  await ses.cookies.flushStore()
  const cookies = await ses.cookies.get({ domain: 'claude.ai' })
  console.log('[WebAuth] claude.ai cookies:', cookies.map(c => `${c.name}=${c.httpOnly ? '[httpOnly]' : c.value.slice(0, 20)}`))
}

interface OrgLite {
  uuid: string
  name: string
  raven_type: string | null   // "team" 等が入る（有料組織）
  billing_type: string | null // "stripe_subscription" 等が入る（有料）
}

async function fetchOrganizations(): Promise<OrgLite[]> {
  const bodyText = await fetchViaWindow('https://claude.ai/api/organizations')
  const parsed = JSON.parse(bodyText)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((o): o is Record<string, unknown> => o !== null && typeof o === 'object' && typeof (o as Record<string, unknown>).uuid === 'string')
    .map((o) => ({
      uuid: o.uuid as string,
      name: typeof o.name === 'string' ? o.name : '',
      raven_type: typeof o.raven_type === 'string' ? o.raven_type : null,
      billing_type: typeof o.billing_type === 'string' ? o.billing_type : null,
    }))
}

// 同一メアドで Team / Pro / Free を複数持てるため、`lastActiveOrg` クッキーに頼ると
// Anthropic 側のデフォルトで個人 Free workspace が拾われ、実際の Team org の使用量が
// 見えないケースが発生する（Entra SSO 経由で観測、2026-07-01）。
// 対策として全 org を列挙し、raven_type（"team" 等）> billing_type（有料 Pro 等）> Free
// の順で優先選択する。
function pickOrg(orgs: OrgLite[]): OrgLite | null {
  if (!orgs.length) return null
  const score = (o: OrgLite): number => (o.raven_type ? 3 : o.billing_type ? 2 : 1)
  return orgs.slice().sort((a, b) => score(b) - score(a))[0]
}

export async function getOrgId(): Promise<string | null> {
  if (cachedOrgId) return cachedOrgId
  try {
    const orgs = await fetchOrganizations()
    const picked = pickOrg(orgs)
    if (picked) {
      cachedOrgId = picked.uuid
      vlog('getOrgId picked', {
        uuid: picked.uuid,
        name: picked.name,
        raven_type: picked.raven_type,
        billing_type: picked.billing_type,
        total_orgs: orgs.length,
      })
      return cachedOrgId
    }
    vlog('getOrgId', { orgId: null, hint: '/api/organizations returned no usable orgs' })
  } catch (e) {
    // API 呼び出しが失敗（ネットワーク等）した時のみ、旧 cookie 方式にフォールバック。
    vlog('getOrgId fetchOrganizations failed, falling back to cookie', { err: String(e) })
    const ses = getWebSession()
    await ses.cookies.flushStore()
    const cookies = await ses.cookies.get({ domain: 'claude.ai', name: 'lastActiveOrg' })
    if (cookies.length > 0 && cookies[0].value) {
      cachedOrgId = cookies[0].value
      vlog('getOrgId cookie fallback', { orgId: cachedOrgId })
      return cachedOrgId
    }
  }
  return null
}

export function invalidateCachedOrgId(): void {
  cachedOrgId = null
}

export async function logout(): Promise<void> {
  const ses = getWebSession()
  await ses.clearStorageData({ storages: ['cookies'] })
  cachedOrgId = null
  cachedEmail = undefined
  vlog('logout', { cookies_cleared: true })
}

export async function fetchAccountEmail(): Promise<string | null> {
  if (cachedEmail !== undefined) return cachedEmail

  // Decode routingHint JWT: email (rare) → display name → null
  // claude.ai does not expose email via any accessible API endpoint
  const ses = getWebSession()
  await ses.cookies.flushStore()
  const routingCookies = await ses.cookies.get({ domain: 'claude.ai', name: 'routingHint' })
  if (routingCookies.length > 0 && routingCookies[0].value) {
    try {
      const parts = routingCookies[0].value.split('.')
      if (parts.length === 3) {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
        vlog('fetchAccountEmail JWT', { email: payload.email ?? null, name: payload.name ?? null })
        if (typeof payload.email === 'string') { cachedEmail = payload.email; return cachedEmail }
        if (typeof payload.name === 'string' && payload.name.trim()) {
          cachedEmail = payload.name; return cachedEmail
        }
      }
    } catch { /* ignore */ }
  }

  // NOTE: null はキャッシュしない。routingHint の読み取りが一過性に失敗しても
  // （cookie ストアが別ウィンドウのナビゲーション中で読めない等）、次回ポーリングで
  // 再取得できるようにするため。成功時（上の name/email 取得時）のみキャッシュする。
  vlog('fetchAccountEmail', { result: null })
  return null
}

// Fetch a URL by navigating a hidden BrowserWindow to it.
// The browser sends cookies automatically so auth headers are correct.
// Returns the raw body text (usually JSON for API endpoints).
export async function fetchViaWindow(url: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
    })

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      if (!win.isDestroyed()) win.destroy()
      reject(new Error('timeout'))
    }, timeoutMs)

    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
      if (!win.isDestroyed()) win.destroy()
    }

    win.webContents.on('did-finish-load', async () => {
      try {
        const body = await win.webContents.executeJavaScript('document.documentElement.innerText')
        vlog('fetchViaWindow done', { url, body_size: (body as string).length })
        done(() => resolve(body as string))
      } catch (e) {
        done(() => reject(e))
      }
    })

    win.webContents.on('did-fail-load', (_event, errCode, errDesc) => {
      done(() => reject(new Error(`${errCode}: ${errDesc}`)))
    })

    win.on('closed', () => done(() => reject(new Error('window closed unexpectedly'))))

    win.loadURL(url)
  })
}

export async function openLoginWindow(): Promise<void> {
  return new Promise((resolve) => {
    if (loginWin) {
      loginWin.show()
      loginWin.focus()
      loginWin.once('closed', () => resolve())
      return
    }

    loginWin = new BrowserWindow({
      width: 520,
      height: 720,
      autoHideMenuBar: true,
      title: 'Claude にログイン',
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const ses = getWebSession()

    // Close trigger: lastActiveOrg cookie set for claude.ai.
    // Rationale: the full login flow ends when the browser reaches /chats and the
    // client JS sets lastActiveOrg (the last cookie to appear). Triggering on
    // sessionKey alone fires too early on the SSO path — /sso-callback sets
    // sessionKey but the app hasn't yet redirected to /chats, so lastActiveOrg
    // never gets a chance to be set, and getOrgId() returns null downstream.
    // If Anthropic ever changes the org-selection flow so that lastActiveOrg is
    // no longer set, this watcher won't fire; the user can close the window
    // manually and the app will retry.
    const onCookieChanged = (
      _e: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ) => {
      if (removed) return
      if (cookie.name !== 'lastActiveOrg') return
      const d = cookie.domain ?? ''
      if (d !== 'claude.ai' && d !== '.claude.ai') return
      vlog('loginWindow closing', { reason: 'lastActiveOrg cookie set', domain: d })
      loginWin?.close()
    }
    ses.cookies.on('changed', onCookieChanged)

    // Diagnostic-only URL log. Not used to trigger close.
    const logUrl = (_event: Electron.Event, url: string) => {
      vlog('loginWindow url', { url })
    }
    loginWin.webContents.on('did-navigate', logUrl)
    loginWin.webContents.on('did-navigate-in-page', logUrl)

    loginWin.on('closed', () => {
      ses.cookies.off('changed', onCookieChanged)
      loginWin = null
      // Clear org cache so it's re-read from the new session cookies
      invalidateCachedOrgId()
      resolve()
    })

    loginWin.loadURL('https://claude.ai/login')
  })
}
