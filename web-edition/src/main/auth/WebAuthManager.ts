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

export async function getOrgId(): Promise<string | null> {
  if (cachedOrgId) return cachedOrgId
  const ses = getWebSession()
  await ses.cookies.flushStore()
  const cookies = await ses.cookies.get({ domain: 'claude.ai', name: 'lastActiveOrg' })
  if (cookies.length > 0 && cookies[0].value) {
    cachedOrgId = cookies[0].value
    vlog('getOrgId', { orgId: cachedOrgId })
    return cachedOrgId
  }
  vlog('getOrgId', { orgId: null, hint: 'lastActiveOrg cookie not found' })
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

    loginWin.loadURL('https://claude.ai/login')

    const checkUrl = (_event: Electron.Event, url: string) => {
      try {
        const u = new URL(url)
        const isClaudeAi = u.hostname === 'claude.ai'
        const isAuthPage = u.pathname.startsWith('/login') || u.pathname.startsWith('/auth')
        vlog('loginWindow url', { url, isClaudeAi, isAuthPage })
        if (isClaudeAi && !isAuthPage) {
          vlog('loginWindow closing', { reason: 'navigated away from auth page' })
          loginWin?.close()
        }
      } catch { /* ignore invalid URLs */ }
    }

    const checkCurrentUrl = () => {
      const url = loginWin?.webContents.getURL() ?? ''
      checkUrl({} as Electron.Event, url)
    }

    loginWin.webContents.on('did-navigate', checkUrl)
    loginWin.webContents.on('did-navigate-in-page', checkUrl)
    loginWin.webContents.on('did-finish-load', checkCurrentUrl)

    loginWin.on('closed', () => {
      loginWin = null
      // Clear org cache so it's re-read from the new session cookies
      invalidateCachedOrgId()
      resolve()
    })
  })
}
