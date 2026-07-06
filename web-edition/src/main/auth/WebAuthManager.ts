import { BrowserWindow, session } from 'electron'
import { VERBOSE } from '../index'
import { getSettings } from '@shared/main/settings/SettingsStore'
import type { OrgInfo } from '@shared/main/types'

const PARTITION = 'persist:claudicator-web'

let loginWin: BrowserWindow | null = null
let cachedOrgId: string | null = null
let cachedOrgList: OrgLite[] | null = null
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
  const { body: bodyText, status } = await fetchViaWindow('https://claude.ai/api/organizations')
  // 障害時は 503 + プレーンテキストが返る。JSON.parse に進むと SyntaxError になり
  // 下流で「org が無い＝認証切れ」と誤分類されるため、HTTP エラーはここで明示的に投げる。
  if (status >= 400) {
    vlog('fetchOrganizations http error', { status, preview: bodyText.slice(0, 120) })
    throw new Error(`http_${status}`)
  }
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

function classifyPlan(o: OrgLite): OrgInfo['plan'] {
  if (o.raven_type) return 'team'
  if (o.billing_type) return 'pro'
  return 'free'
}

// 同一メアドで Team / Pro / Free を複数持てるため、`lastActiveOrg` クッキーに頼ると
// Anthropic 側のデフォルトで個人 Free workspace が拾われ、実際の Team org の使用量が
// 見えないケースが発生する（Entra SSO 経由で観測、2026-07-01）。
// 対策として全 org を列挙し、raven_type（"team" 等）> billing_type（有料 Pro 等）> Free
// の順で優先選択する。ユーザーが settings.selectedOrgId で明示指定した場合はそれを尊重。
function pickOrg(orgs: OrgLite[]): OrgLite | null {
  if (!orgs.length) return null
  const score = (o: OrgLite): number => (o.raven_type ? 3 : o.billing_type ? 2 : 1)
  return orgs.slice().sort((a, b) => score(b) - score(a))[0]
}

// キャッシュ付きの org list 取得。
// 注意: 失敗時はエラーを投げる。ここで空配列に握りつぶすと、getOrgId が
// 「org が無い＝認証切れ」と誤分類し、サーバー障害中にユーザーへ不要な
// 再ログインを促してしまう（2026-07-07 の claude.ai 障害で発生）。
async function getOrgList(): Promise<OrgLite[]> {
  if (cachedOrgList) return cachedOrgList
  cachedOrgList = await fetchOrganizations()
  return cachedOrgList
}

// UI（アカウントチップのプルダウン）用。こちらだけ graceful に空配列を返し、
// 一過性エラーで UI がクラッシュしないようにする。
export async function listOrganizations(): Promise<OrgInfo[]> {
  try {
    const orgs = await getOrgList()
    return orgs.map((o) => ({ uuid: o.uuid, name: o.name, plan: classifyPlan(o) }))
  } catch (e) {
    vlog('listOrganizations failed', { err: String(e) })
    return []
  }
}

export async function getOrgId(): Promise<string | null> {
  if (cachedOrgId) return cachedOrgId
  const selected = getSettings().selectedOrgId
  try {
    const orgs = await getOrgList()
    // ユーザーが明示的に選択した org が現行の org list に含まれていればそれを使う。
    // list に含まれていない（削除された・別アカウントに移った）場合は auto-pick に落とす。
    if (selected) {
      const hit = orgs.find((o) => o.uuid === selected)
      if (hit) {
        cachedOrgId = hit.uuid
        vlog('getOrgId user-selected', { uuid: hit.uuid, name: hit.name, plan: classifyPlan(hit) })
        return cachedOrgId
      }
      vlog('getOrgId selected org not found in list, falling back to auto', { selected })
    }
    const picked = pickOrg(orgs)
    if (picked) {
      cachedOrgId = picked.uuid
      vlog('getOrgId auto-picked', {
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

// org list そのものが変わりうるタイミング（ログアウト、ログインウィンドウ close 直後）に呼ぶ。
export function invalidateCachedOrgList(): void {
  cachedOrgList = null
}

export async function logout(): Promise<void> {
  const ses = getWebSession()
  await ses.clearStorageData({ storages: ['cookies'] })
  cachedOrgId = null
  cachedOrgList = null
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

export interface FetchedResponse {
  body: string
  // HTTP ステータスコード。did-navigate が発火しなかった場合は 0（不明）。
  status: number
}

// Fetch a URL by navigating a hidden BrowserWindow to it.
// The browser sends cookies automatically so auth headers are correct.
// Returns the raw body text (usually JSON for API endpoints) and the HTTP status.
// ステータスを返すのは、障害時に API が 503 のプレーンテキスト
// （"upstream connect error..."）を返し、JSON 解析失敗だけでは
// 「認証切れ」と「サーバー障害」を区別できないため（2026-07-07 の claude.ai 障害で観測）。
export async function fetchViaWindow(url: string, timeoutMs = 15_000): Promise<FetchedResponse> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
    })

    let httpStatus = 0
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

    win.webContents.on('did-navigate', (_e, _url, httpResponseCode) => {
      httpStatus = httpResponseCode
    })

    win.webContents.on('did-finish-load', async () => {
      try {
        const body = await win.webContents.executeJavaScript('document.documentElement.innerText')
        vlog('fetchViaWindow done', { url, status: httpStatus, body_size: (body as string).length })
        done(() => resolve({ body: body as string, status: httpStatus }))
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
  if (loginWin) {
    const existing = loginWin
    existing.show()
    existing.focus()
    return new Promise((resolve) => existing.once('closed', () => resolve()))
  }

  // 期限切れセッションの残存クッキーがある状態で /login を開くと、claude.ai が
  // ロード時に lastActiveOrg を再セット（上書き）し、下の完了監視が即発火して
  // ウィンドウが一瞬で閉じてしまう（2026-07-07 観測）。ログイン開始＝常に
  // クリーンなセッションから始めるため、先にクッキーを消す（明示ログアウトと同等。
  // このウィンドウはログインボタン押下時＝未認証状態でしか開かれないので安全）。
  await logout()

  return new Promise((resolve) => {
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
      // Clear org caches so they're re-read from the new session cookies
      invalidateCachedOrgId()
      invalidateCachedOrgList()
      resolve()
    })

    loginWin.loadURL('https://claude.ai/login')
  })
}
