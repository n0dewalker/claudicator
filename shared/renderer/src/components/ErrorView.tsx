import type { Dict } from '@app/i18n/ja'
import type { UsageError } from '../../../main/types'

// Errors handled directly by dedicated components; ErrorView handles only these
type ErrorViewError = Exclude<UsageError, 'unauthenticated' | 'session_expired'>

type ErrorConfig = {
  title: string
  body: string
  showRetry: boolean
}

function getConfig(error: ErrorViewError, t: Dict): ErrorConfig {
  switch (error) {
    case 'rate_limited':
      return { title: t.errorRateLimitedTitle, body: t.rateLimited, showRetry: false }
    case 'network_error':
      return { title: t.errorNetworkTitle, body: t.errorNetworkBody, showRetry: true }
    case 'server_error':
      return { title: t.errorServerTitle, body: t.errorServerBody, showRetry: true }
    case 'unknown_error':
      return { title: t.errorUnknownTitle, body: t.errorUnknownBody, showRetry: true }
    default: {
      const _exhaustive: never = error
      return { title: t.errorUnknownTitle, body: t.errorUnknownBody, showRetry: true }
    }
  }
}

type Props = {
  error: ErrorViewError
  t: Dict
  onRetry: () => void
  retrying: boolean
}

export function ErrorView({ error, t, onRetry, retrying }: Props) {
  const { title, body, showRetry } = getConfig(error, t)
  return (
    <div className="py-2">
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{title}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">{body}</p>
      {showRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="text-xs px-3 py-1.5 rounded bg-gray-500 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-600 text-white transition-colors disabled:opacity-40"
        >
          {retrying ? t.refreshing : t.manualRetry}
        </button>
      )}
    </div>
  )
}
