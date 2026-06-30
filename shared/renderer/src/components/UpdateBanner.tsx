interface Props {
  version: string
  url: string
  label: string // "新しいバージョン {v} があります" のテンプレート（{v} を版番号に置換）
  downloadLabel: string
}

// 新バージョン通知バナー。ヘッダ直下に表示し、クリックでブラウザの Release ページを開く。
// 配色は design-system のアクセント（blue-600 / hover blue-500）に準拠。ライト/ダーク両対応。
export function UpdateBanner({ version, url, label, downloadLabel }: Props) {
  const text = label.replace('{v}', version)
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-xs">
      <span className="text-blue-800 dark:text-blue-200">{text}</span>
      <button
        onClick={() => window.electronAPI.openExternal(url)}
        className="shrink-0 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
      >
        {downloadLabel}
      </button>
    </div>
  )
}
