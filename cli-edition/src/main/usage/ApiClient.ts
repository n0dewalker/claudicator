import type { UsageData, UsageItem, ExtraUsage } from '@shared/main/types'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const BETA_HEADER = 'oauth-2025-04-20'

export class UsageApiError extends Error {
  constructor(
    public code: 'rate_limited' | 'auth_invalid' | 'server_error' | 'unknown_error' | 'network_error',
    public httpStatus?: number,
  ) { super(code) }
}

export async function fetchUsage(token: string): Promise<UsageData> {
  let res: Response
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': BETA_HEADER,
      },
    })
  } catch {
    throw new UsageApiError('network_error')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[ApiClient] HTTP', res.status, body.substring(0, 200))
    if (res.status === 429) throw new UsageApiError('rate_limited', res.status)
    if (res.status === 401 || res.status === 403) throw new UsageApiError('auth_invalid', res.status)
    if (res.status >= 500) throw new UsageApiError('server_error', res.status)
    throw new UsageApiError('unknown_error', res.status)
  }

  try {
    const json = await res.json()
    console.log('[ApiClient] response:', JSON.stringify(json))
    return mapToUsageData(json)
  } catch {
    throw new UsageApiError('unknown_error')
  }
}

function mapToUsageData(json: unknown): UsageData {
  const j = json as Record<string, unknown>
  return {
    five_hour: extractItem(j['five_hour']),
    seven_day: extractItem(j['seven_day']),
    seven_day_sonnet: extractItem(j['seven_day_sonnet']),
    // NOTE(2026-05-31): 'seven_day_omelette' を Claude Design と仮定しているが、Design を多用しても
    // 実 API は omelette=null を返すことを確認済み。omelette が Design の正しいキーでない可能性あり。
    // 上の console.log('[ApiClient] response:'…) の全文ダンプで Design 使用時に非null化するキーを確認すること。
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
