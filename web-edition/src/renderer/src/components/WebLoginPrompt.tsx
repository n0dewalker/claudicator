import type { Dict } from '../i18n/ja'

type Props = { t: Dict }

export function WebLoginPrompt({ t }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t.loginRequired}</p>
      <button
        onClick={() => window.electronAPI.login()}
        className="text-sm px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
      >
        {t.login}
      </button>
    </div>
  )
}
