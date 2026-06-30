import type { Dict } from '@app/i18n'

interface Props {
  resetsAt: string
  timezone: string
  t: Dict
  language: string
}

export function ResetTime({ resetsAt, timezone, t, language }: Props) {
  const date = new Date(resetsAt)
  if (!resetsAt || isNaN(date.getTime())) {
    return <p className="text-xs text-gray-500 dark:text-gray-400">{t.notStarted}</p>
  }
  const now = Date.now()
  const diffMs = date.getTime() - now

  let timeStr: string
  if (diffMs <= 0) {
    timeStr = '—'
  } else {
    const totalMins = Math.floor(diffMs / 60000)
    const totalH = Math.floor(totalMins / 60)
    const d = Math.floor(totalH / 24)
    const h = totalH % 24
    const m = totalMins % 60
    if (language === 'ja') {
      if (d > 0 && h > 0) timeStr = `${d}${t.days}${h}${t.hours}${m}${t.minutes}`
      else if (d > 0) timeStr = `${d}${t.days}${m}${t.minutes}`
      else if (h > 0) timeStr = `${h}${t.hours}${m}${t.minutes}`
      else timeStr = `${m}${t.minutes}`
    } else {
      if (d > 0 && h > 0) timeStr = `${d}${t.days} ${h}${t.hours} ${m}${t.minutes}`
      else if (d > 0) timeStr = `${d}${t.days} ${m}${t.minutes}`
      else if (h > 0) timeStr = `${h}${t.hours} ${m}${t.minutes}`
      else timeStr = `${m}${t.minutes}`
    }
  }

  const tz = timezone === 'auto' ? undefined : timezone
  const localDate = date.toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: tz,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {t.resetsIn} {timeStr} ({localDate})
    </p>
  )
}
