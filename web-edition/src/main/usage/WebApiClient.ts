import { getOrgId, fetchViaWindow, invalidateCachedOrgId } from '../auth/WebAuthManager'
import { VERBOSE } from '../index'
import type { UsageData, ExtraUsage, UsageItem } from '@shared/main/types'

function vlog(msg: string, data?: unknown) {
  if (VERBOSE) console.log('[verbose][WebApi]', msg, data ?? '')
}

export class UsageApiError extends Error {
  constructor(public code: string, public httpStatus?: number) { super(code) }
}

export async function fetchUsage(): Promise<UsageData> {
  const orgId = await getOrgId()
  vlog('getOrgId result', { orgId })
  if (!orgId) throw new UsageApiError('auth_invalid')

  const url = `https://claude.ai/api/organizations/${orgId}/usage`

  let bodyText: string
  try {
    bodyText = await fetchViaWindow(url)
  } catch (e) {
    vlog('fetchViaWindow threw', { err: String(e) })
    if (String(e).includes('timeout')) throw new UsageApiError('network_error')
    throw new UsageApiError('network_error')
  }

  let json: unknown
  try {
    json = JSON.parse(bodyText)
  } catch {
    vlog('JSON parse failed', { preview: bodyText.slice(0, 200) })
    throw new UsageApiError('unknown_error')
  }

  // Detect API-level error responses (e.g. auth errors, rate limits)
  const j = json as Record<string, unknown>
  if (j['type'] === 'error') {
    const err = j['error'] as Record<string, unknown> | undefined
    const details = err?.['details'] as Record<string, unknown> | undefined
    vlog('API error response', { error_type: err?.['type'], error_code: details?.['error_code'] })

    const errType = err?.['type'] as string | undefined
    if (errType === 'authentication_error' || details?.['error_code'] === 'account_session_invalid') {
      invalidateCachedOrgId()
      throw new UsageApiError('auth_invalid')
    }
    if (errType === 'rate_limit_error') throw new UsageApiError('rate_limited')
    throw new UsageApiError('server_error')
  }

  vlog('response parsed', { top_keys: Object.keys(j).slice(0, 20) })
  // 全 per-bucket キーの実値ダンプ。Claude Design を実際に使用している最中に非null化する
  // キーが本来の Design バケット。'seven_day_omelette' は Design 多用時も null を返すことを
  // 2026-05-31 に確認済みのため、正しいコードネーム特定の手掛かりとして全値を出す。
  vlog('all bucket values', Object.fromEntries(Object.keys(j).map((k) => {
    const v = j[k] as Record<string, unknown> | null
    return [k, v && typeof v === 'object' && 'utilization' in v ? v['utilization'] : v]
  })))
  return mapToUsageData(json)
}

function mapToUsageData(json: unknown): UsageData {
  const j = json as Record<string, unknown>
  return {
    five_hour: extractItem(j['five_hour']),
    seven_day: extractItem(j['seven_day']),
    seven_day_sonnet: extractItem(j['seven_day_sonnet']),
    // NOTE(2026-05-31): 'seven_day_omelette' を Claude Design と仮定しているが、Design を多用しても
    // 実 API は omelette=null を返すことを確認済み。omelette が Design の正しいキーでない可能性あり。
    // 正しいキーは上の 'all bucket values' ログで Design 使用時に非null化するキーで特定すること。
    seven_day_claude_design: extractItem(j['seven_day_omelette']),
    extra_usage: extractExtraUsage(j['extra_usage']),
  }
}

function extractItem(item: unknown): UsageItem | null {
  if (!item || typeof item !== 'object') return null
  const i = item as Record<string, unknown>
  return {
    utilization: typeof i['utilization'] === 'number' ? i['utilization'] : 0,
    resets_at: typeof i['resets_at'] === 'string' ? i['resets_at'] : '',
  }
}

function extractExtraUsage(item: unknown): ExtraUsage | null {
  if (!item || typeof item !== 'object') return null
  const i = item as Record<string, unknown>
  return {
    is_enabled: typeof i['is_enabled'] === 'boolean' ? i['is_enabled'] : false,
    utilization: typeof i['utilization'] === 'number' ? i['utilization'] : null,
    used_credits: typeof i['used_credits'] === 'number' ? i['used_credits'] : null,
    monthly_limit: typeof i['monthly_limit'] === 'number' ? i['monthly_limit'] : null,
    currency: typeof i['currency'] === 'string' ? i['currency'] : null,
  }
}
