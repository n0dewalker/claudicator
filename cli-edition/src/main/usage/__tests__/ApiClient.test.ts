import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchUsage, UsageApiError } from '../ApiClient'

const MOCK_TOKEN = 'test-token'
const MOCK_DATA = { five_hour: { utilization: 50, resets_at: '' }, seven_day: null, seven_day_sonnet: null, seven_day_claude_design: null, extra_usage: null }

function makeFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('ApiClient.fetchUsage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('200 OK → returns UsageData', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeFetchResponse(200, MOCK_DATA))
    const result = await fetchUsage(MOCK_TOKEN)
    expect(result).toEqual(MOCK_DATA)
  })

  it('401 → throws UsageApiError with code auth_invalid', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeFetchResponse(401, 'unauthorized'))
    await expect(fetchUsage(MOCK_TOKEN)).rejects.toSatisfy(
      (e) => e instanceof UsageApiError && e.code === 'auth_invalid' && e.httpStatus === 401
    )
  })

  it('403 → throws UsageApiError with code auth_invalid', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeFetchResponse(403, 'forbidden'))
    await expect(fetchUsage(MOCK_TOKEN)).rejects.toSatisfy(
      (e) => e instanceof UsageApiError && e.code === 'auth_invalid' && e.httpStatus === 403
    )
  })

  it('429 → throws UsageApiError with code rate_limited', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeFetchResponse(429, 'too many requests'))
    await expect(fetchUsage(MOCK_TOKEN)).rejects.toSatisfy(
      (e) => e instanceof UsageApiError && e.code === 'rate_limited' && e.httpStatus === 429
    )
  })

  it('500 → throws UsageApiError with code server_error', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeFetchResponse(500, 'internal server error'))
    await expect(fetchUsage(MOCK_TOKEN)).rejects.toSatisfy(
      (e) => e instanceof UsageApiError && e.code === 'server_error' && e.httpStatus === 500
    )
  })

  it('502 → throws UsageApiError with code server_error', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeFetchResponse(502, 'bad gateway'))
    await expect(fetchUsage(MOCK_TOKEN)).rejects.toSatisfy(
      (e) => e instanceof UsageApiError && e.code === 'server_error' && e.httpStatus === 502
    )
  })

  it('418 (other 4xx) → throws UsageApiError with code unknown_error', async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeFetchResponse(418, "I'm a teapot"))
    await expect(fetchUsage(MOCK_TOKEN)).rejects.toSatisfy(
      (e) => e instanceof UsageApiError && e.code === 'unknown_error' && e.httpStatus === 418
    )
  })

  it('network failure (fetch throws) → throws UsageApiError with code network_error', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchUsage(MOCK_TOKEN)).rejects.toSatisfy(
      (e) => e instanceof UsageApiError && e.code === 'network_error'
    )
  })

  it('JSON parse failure → throws UsageApiError with code unknown_error', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON')),
    } as unknown as Response)
    await expect(fetchUsage(MOCK_TOKEN)).rejects.toSatisfy(
      (e) => e instanceof UsageApiError && e.code === 'unknown_error'
    )
  })
})
