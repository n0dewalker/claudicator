import { useState } from 'react'
import type { Dict } from '../i18n/ja'

type Props = {
  t: Dict
  onRetry: () => void
  retrying: boolean
}

export function CliSetupGuide({ t, onRetry, retrying }: Props) {
  return (
    <div className="py-2">
      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">
        {t.cliRequiredTitle}
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
        {t.cliRequiredIntro}
      </p>

      <div className="space-y-4">
        <Step n={1} title={t.cliStep1Title} body={t.cliStep1Body}>
          <button
            onClick={() => window.electronAPI.openExternal('https://nodejs.org/')}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {t.cliStep1Link}
          </button>
        </Step>

        <Step n={2} title={t.cliStep2Title} body={t.cliStep2Body}>
          <Cmd cmd="npm install -g @anthropic-ai/claude-code" t={t} />
        </Step>

        <Step n={3} title={t.cliStep3Title} body={t.cliStep3Body}>
          <Cmd cmd="claude" t={t} />
          <Cmd cmd="/login" t={t} />
        </Step>

        <Step n={4} title={t.cliStep4Title} body={t.cliStep4Body}>
          <button
            onClick={onRetry}
            disabled={retrying}
            className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40"
          >
            {retrying ? t.refreshing : t.cliRetry}
          </button>
        </Step>
      </div>
    </div>
  )
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-1">
        {n}. {title}
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 leading-relaxed">
        {body}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Cmd({ cmd, t }: { cmd: string; t: Dict }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="flex items-stretch gap-1">
      <code className="flex-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded px-2 py-1.5 font-mono break-all">
        {cmd}
      </code>
      <button
        onClick={handleCopy}
        className="text-xs px-2 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 shrink-0 min-w-[3rem]"
      >
        {copied ? t.copied : t.copy}
      </button>
    </div>
  )
}
