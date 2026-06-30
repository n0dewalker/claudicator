import { isLoggedIn, fetchAccountEmail } from '../auth/WebAuthManager'
import { getSettings } from '@shared/main/settings/SettingsStore'
import { fetchUsage, UsageApiError } from './WebApiClient'
import { VERBOSE } from '../index'
import type { UsageState, UsageError } from '@shared/main/types'

function vlog(msg: string, data?: unknown) {
  if (VERBOSE) console.log('[verbose][UsageSvc]', msg, data ?? '')
}

type Listener = (state: UsageState) => void

let state: UsageState = { data: null, fetchedAt: null, error: null }
let timer: ReturnType<typeof setInterval> | null = null
const listeners: Set<Listener> = new Set()

function notify(): void {
  for (const fn of listeners) fn(state)
}

function mapApiError(e: unknown): UsageError {
  if (e instanceof UsageApiError) {
    switch (e.code) {
      case 'rate_limited': return 'rate_limited'
      case 'network_error': return 'network_error'
      case 'server_error': return 'server_error'
      case 'auth_invalid': return 'unauthenticated'
      default: return 'unknown_error'
    }
  }
  return 'unknown_error'
}

export async function refresh(): Promise<void> {
  const loggedIn = await isLoggedIn()
  vlog('isLoggedIn', { loggedIn })
  if (!loggedIn) {
    state = { data: null, fetchedAt: null, error: 'unauthenticated', accountEmail: undefined }
    vlog('state -> unauthenticated (no cookies)')
    notify()
    return
  }

  // Start email fetch concurrently (cached after first successful call)
  const emailP = fetchAccountEmail()
  // 直近に取得できた表示名を保持しておく。今回の取得が一過性に失敗しても
  // ヘッダーの名前が消えないよう、last-known-good にフォールバックする。
  const prevEmail = state.accountEmail

  try {
    const data = await fetchUsage()
    const email = await emailP
    state = { data, fetchedAt: Date.now(), error: null, accountEmail: email ?? prevEmail }
    vlog('state -> ok', { five_hour: data?.five_hour, seven_day: data?.seven_day, email })
  } catch (e) {
    await emailP.catch(() => { /* ignore email errors */ })
    const err = mapApiError(e)
    vlog('fetchUsage threw', { raw: String(e), mapped: err })
    state = {
      data: state.data,
      fetchedAt: Date.now(),
      error: err === 'unauthenticated' ? 'unauthenticated' : err,
      accountEmail: prevEmail,
    }
  }
  notify()
}

export function startPolling(): void {
  if (timer) clearInterval(timer)
  const interval = Math.max(1, Math.min(10, getSettings().refreshInterval)) * 60_000
  timer = setInterval(() => refresh(), interval)
  refresh()
}

export function stopPolling(): void {
  if (timer) { clearInterval(timer); timer = null }
}

export function restartPolling(): void {
  stopPolling()
  startPolling()
}

export function getState(): UsageState { return state }

export function onUpdate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
