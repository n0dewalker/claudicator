import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UsageData } from '@shared/main/types'

// ─── Declare mocks before vi.mock hoisting (via vi.hoisted) ──────────────────

const {
  mockGetToken,
  mockGetAccountEmail,
  mockTryCliRefresh,
  mockGetCliCredentialsState,
  mockSpawnCliRefresh,
  mockFetchUsage,
  LocalApiError,
} = vi.hoisted(() => {
  class LocalApiError extends Error {
    code: string
    httpStatus?: number
    constructor(code: string, httpStatus?: number) {
      super(code)
      this.code = code
      this.httpStatus = httpStatus
    }
  }
  return {
    mockGetToken: vi.fn<[], string | null>(),
    mockGetAccountEmail: vi.fn<[], string | undefined>(),
    mockTryCliRefresh: vi.fn<[], Promise<boolean>>(),
    mockGetCliCredentialsState: vi.fn<[], Promise<'fresh' | 'expired' | 'missing'>>(),
    mockSpawnCliRefresh: vi.fn<[], Promise<boolean>>(),
    mockFetchUsage: vi.fn<[string], Promise<UsageData>>(),
    LocalApiError,
  }
})

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../auth/AuthManager', () => ({
  getToken: mockGetToken,
  getAccountEmail: mockGetAccountEmail,
  tryCliRefresh: mockTryCliRefresh,
  getCliCredentialsState: mockGetCliCredentialsState,
  spawnCliRefresh: mockSpawnCliRefresh,
}))

vi.mock('../ApiClient', () => ({
  fetchUsage: mockFetchUsage,
  UsageApiError: LocalApiError,
}))

vi.mock('../../settings/SettingsStore', () => ({
  getSettings: vi.fn(() => ({
    refreshInterval: 120,
    language: 'ja',
    theme: 'dark',
    trayShape: 'bar',
    trayGridEnabled: false,
    trayGridDivisions: 4,
    trayShowSonnet: false,
    trayShowDesign: false,
    thresholds: { medium: 50, high: 75 },
    autoStart: false,
    timezone: 'auto',
  })),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { refresh, getState } from '../UsageService'

const TEST_EMAIL = 'test@example.com'
const MOCK_DATA: UsageData = {
  five_hour: { utilization: 50, resets_at: '2024-01-01T00:00:00Z' },
  seven_day: { utilization: 30, resets_at: '2024-01-07T00:00:00Z' },
  extra_usage: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAccountEmail.mockReturnValue(TEST_EMAIL)
  mockTryCliRefresh.mockResolvedValue(false)
  mockGetCliCredentialsState.mockResolvedValue('missing')
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsageService.refresh', () => {

  describe('credentials missing', () => {
    it('sets error=unauthenticated when CLI credentials absent', async () => {
      mockGetToken.mockReturnValue(null)
      mockGetCliCredentialsState.mockResolvedValue('missing')

      await refresh()

      expect(getState().error).toBe('unauthenticated')
      expect(getState().data).toBeNull()
    })

    it('preserves accountEmail on unauthenticated error', async () => {
      mockGetToken.mockReturnValue(null)
      mockGetCliCredentialsState.mockResolvedValue('missing')

      await refresh()

      expect(getState().accountEmail).toBe(TEST_EMAIL)
    })
  })

  describe('credentials expired', () => {
    it('sets error=session_expired when spawnCliRefresh cannot get a new token', async () => {
      mockGetToken.mockReturnValue(null)
      mockGetCliCredentialsState.mockResolvedValue('expired')
      mockSpawnCliRefresh.mockResolvedValue(false)

      await refresh()

      expect(getState().error).toBe('session_expired')
    })

    it('succeeds when spawnCliRefresh recovers a token', async () => {
      let tokenCallCount = 0
      mockGetToken.mockImplementation(() => (++tokenCallCount === 1 ? null : 'recovered-token'))
      mockGetCliCredentialsState.mockResolvedValue('expired')
      mockSpawnCliRefresh.mockResolvedValue(true)
      mockTryCliRefresh.mockResolvedValue(true)
      mockFetchUsage.mockResolvedValue(MOCK_DATA)

      await refresh()

      expect(getState().error).toBeNull()
      expect(getState().data).toEqual(MOCK_DATA)
    })
  })

  describe('fetch with valid token', () => {
    beforeEach(() => {
      mockGetToken.mockReturnValue('valid-token')
    })

    it('sets data and error=null on 200 OK', async () => {
      mockFetchUsage.mockResolvedValue(MOCK_DATA)

      await refresh()

      expect(getState().error).toBeNull()
      expect(getState().data).toEqual(MOCK_DATA)
      expect(getState().fetchedAt).toBeGreaterThan(0)
    })

    it('sets error=rate_limited on 429', async () => {
      mockFetchUsage.mockRejectedValue(new LocalApiError('rate_limited', 429))
      await refresh()
      expect(getState().error).toBe('rate_limited')
    })

    it('sets error=server_error on 5xx', async () => {
      mockFetchUsage.mockRejectedValue(new LocalApiError('server_error', 503))
      await refresh()
      expect(getState().error).toBe('server_error')
    })

    it('sets error=network_error on fetch failure', async () => {
      mockFetchUsage.mockRejectedValue(new LocalApiError('network_error'))
      await refresh()
      expect(getState().error).toBe('network_error')
    })

    it('sets error=unknown_error on unexpected errors', async () => {
      mockFetchUsage.mockRejectedValue(new LocalApiError('unknown_error'))
      await refresh()
      expect(getState().error).toBe('unknown_error')
    })
  })

  describe('401 auto-recovery', () => {
    it('recovers on 401 ↁEspawnCliRefresh ↁEretry success', async () => {
      let tokenCallCount = 0
      mockGetToken.mockImplementation(() => (++tokenCallCount === 1 ? 'stale-token' : 'fresh-token'))
      let fetchCallCount = 0
      mockFetchUsage.mockImplementation(async () => {
        if (++fetchCallCount === 1) throw new LocalApiError('auth_invalid', 401)
        return MOCK_DATA
      })
      mockSpawnCliRefresh.mockResolvedValue(true)
      mockTryCliRefresh.mockResolvedValue(true)

      await refresh()

      expect(getState().error).toBeNull()
      expect(getState().data).toEqual(MOCK_DATA)
    })

    it('sets error=session_expired when spawnCliRefresh cannot recover token on 401', async () => {
      let tokenCallCount = 0
      mockGetToken.mockImplementation(() => (++tokenCallCount === 1 ? 'stale-token' : null))
      mockFetchUsage.mockRejectedValue(new LocalApiError('auth_invalid', 401))
      mockSpawnCliRefresh.mockResolvedValue(false)

      await refresh()

      expect(getState().error).toBe('session_expired')
    })

    it('sets error=session_expired when retry after recovery still returns 401', async () => {
      mockGetToken.mockReturnValue('any-token')
      mockFetchUsage.mockRejectedValue(new LocalApiError('auth_invalid', 401))
      mockSpawnCliRefresh.mockResolvedValue(true)
      mockTryCliRefresh.mockResolvedValue(true)

      await refresh()

      expect(getState().error).toBe('session_expired')
    })

    it('calls spawnCliRefresh at most once per refresh() call (loop guard)', async () => {
      mockGetToken.mockReturnValue('stale-token')
      mockFetchUsage.mockRejectedValue(new LocalApiError('auth_invalid', 401))
      mockSpawnCliRefresh.mockResolvedValue(true)
      mockTryCliRefresh.mockResolvedValue(true)

      await refresh()

      expect(mockSpawnCliRefresh).toHaveBeenCalledTimes(1)
    })
  })

  describe('accountEmail preservation across errors', () => {
    const errorScenarios: Array<{ name: string; setup: () => void }> = [
      {
        name: 'unauthenticated',
        setup: () => {
          mockGetToken.mockReturnValue(null)
          mockGetCliCredentialsState.mockResolvedValue('missing')
        },
      },
      {
        name: 'rate_limited',
        setup: () => {
          mockGetToken.mockReturnValue('t')
          mockFetchUsage.mockRejectedValue(new LocalApiError('rate_limited', 429))
        },
      },
      {
        name: 'server_error',
        setup: () => {
          mockGetToken.mockReturnValue('t')
          mockFetchUsage.mockRejectedValue(new LocalApiError('server_error', 500))
        },
      },
      {
        name: 'network_error',
        setup: () => {
          mockGetToken.mockReturnValue('t')
          mockFetchUsage.mockRejectedValue(new LocalApiError('network_error'))
        },
      },
    ]

    for (const { name, setup } of errorScenarios) {
      it(`preserves accountEmail on error=${name}`, async () => {
        vi.clearAllMocks()
        mockGetAccountEmail.mockReturnValue(TEST_EMAIL)
        mockTryCliRefresh.mockResolvedValue(false)
        mockGetCliCredentialsState.mockResolvedValue('missing')
        setup()

        await refresh()

        expect(getState().accountEmail).toBe(TEST_EMAIL)
      })
    }
  })
})
