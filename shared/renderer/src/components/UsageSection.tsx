import { UsageBar } from './UsageBar'
import { ResetTime } from './ResetTime'
import type { UsageItem } from '../../../main/types'
import type { Dict } from '@app/i18n'

interface Props {
  label: string
  item: UsageItem | null
  thresholds: { medium: number; high: number }
  colorByUsage?: boolean
  timezone: string
  t: Dict
  language: string
}

export function UsageSection({ label, item, thresholds, colorByUsage, timezone, t, language }: Props) {
  const pct = item ? Math.min(100, Math.max(0, item.utilization)) : null

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{label}</span>
        <span className="text-sm font-mono font-bold text-gray-900 dark:text-gray-100">
          {pct !== null ? `${pct.toFixed(1)}%` : '—'}
        </span>
      </div>
      {item ? (
        <>
          <UsageBar utilization={item.utilization} thresholds={thresholds} colorByUsage={colorByUsage} />
          <div className="mt-2">
            <ResetTime resetsAt={item.resets_at} timezone={timezone} t={t} language={language} />
          </div>
        </>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500">{t.noData}</p>
      )}
    </div>
  )
}
