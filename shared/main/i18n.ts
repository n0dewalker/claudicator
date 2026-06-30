import { getSettings } from './settings/SettingsStore'
import type { UsageError } from './types'

const trayErrorMessages = {
  ja: {
    unauthenticated: 'セットアップ未完了',
    session_expired: 'セッション更新が必要',
    rate_limited: '一時的に取得制限中',
    network_error: 'ネットワーク未接続',
    server_error: 'サーバー応答なし',
    unknown_error: 'エラー発生中',
  },
  en: {
    unauthenticated: 'Setup required',
    session_expired: 'Session expired',
    rate_limited: 'Rate-limited',
    network_error: 'Offline',
    server_error: 'Server unavailable',
    unknown_error: 'Error',
  },
} as const

export function getTrayErrorMessage(error: UsageError): string {
  const lang = getSettings().language
  return trayErrorMessages[lang][error]
}
