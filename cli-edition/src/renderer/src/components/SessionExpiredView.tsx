import type { Dict } from '../i18n/ja'

type Props = {
  t: Dict
  onRetry: () => void
  retrying: boolean
}

export function SessionExpiredView({ t, onRetry, retrying }: Props) {
  return (
    <div className="py-2">
      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
        {t.sessionExpiredTitle}
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
        {t.sessionExpiredBody}
      </p>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40"
      >
        {retrying ? t.refreshing : t.cliRetry}
      </button>
    </div>
  )
}
