import { getToken, tryCliRefresh, getAccountEmail, getCliCredentialsState, spawnCliRefresh } from '../auth/AuthManager'
import { getSettings } from '@shared/main/settings/SettingsStore'
import { fetchUsage, UsageApiError } from './ApiClient'
import type { UsageState, UsageError } from '@shared/main/types'

type Listener = (state: UsageState) => void

let state: UsageState = { data: null, fetchedAt: null, error: null }
let timer: ReturnType<typeof setInterval> | null = null
const listeners: Set<Listener> = new Set()

function notify(): void {
  for (const fn of listeners) fn(state)
}

function mapApiErrorCode(e: unknown): UsageError {
  if (e instanceof UsageApiError) {
    switch (e.code) {
      case 'rate_limited': return 'rate_limited'
      case 'network_error': return 'network_error'
      case 'server_error': return 'server_error'
      case 'auth_invalid': return 'session_expired'
      default: return 'unknown_error'
    }
  }
  return 'unknown_error'
}

export async function refresh(): Promise<void> {
  await tryCliRefresh()
  let token = getToken()
  // Preserve accountEmail across errors so the header badge never disappears
  const accountEmail = getAccountEmail() ?? state.accountEmail

  if (!token) {
    const credState = await getCliCredentialsState()
    if (credState === 'expired') {
      await spawnCliRefresh()
      await tryCliRefresh()
      token = getToken()
      if (!token) {
        state = { data: null, fetchedAt: null, error: 'session_expired', accountEmail }
        notify()
        return
      }
    } else {
      state = { data: null, fetchedAt: null, error: 'unauthenticated', accountEmail }
      notify()
      return
    }
  }

  // First fetch attempt
  try {
    const data = await fetchUsage(token)
    state = { data, fetchedAt: Date.now(), error: null, accountEmail: getAccountEmail() ?? accountEmail }
    notify()
    return
  } catch (e) {
    if (e instanceof UsageApiError && e.code === 'auth_invalid') {
      // 401/403 from API: token in store looked fresh but server rejected it.
      // Try CLI refresh once and retry before giving up.
      await spawnCliRefresh()
      await tryCliRefresh()
      const newToken = getToken()
      if (newToken) {
        try {
          const data = await fetchUsage(newToken)
          state = { data, fetchedAt: Date.now(), error: null, accountEmail: getAccountEmail() ?? accountEmail }
          notify()
          return
        } catch (e2) {
          const err = mapApiErrorCode(e2)
          state = { ...state, fetchedAt: Date.now(), error: err === 'rate_limited' || err === 'network_error' || err === 'server_error' ? err : 'session_expired', accountEmail }
          notify()
          return
        }
      }
      state = { ...state, fetchedAt: Date.now(), error: 'session_expired', accountEmail }
      notify()
      return
    }
    state = { ...state, fetchedAt: Date.now(), error: mapApiErrorCode(e), accountEmail }
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
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function restartPolling(): void {
  stopPolling()
  startPolling()
}

export function getState(): UsageState {
  return state
}

export function onUpdate(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
