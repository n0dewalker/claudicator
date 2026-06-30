interface Props {
  utilization: number
  thresholds: { medium: number; high: number }
  colorByUsage?: boolean
}

function accentColor(util: number, thresholds: { medium: number; high: number }, colorByUsage: boolean): string {
  if (!colorByUsage)             return '#648FFF'  // 常に青（使用量で色分けしない）
  if (util >= 100)               return '#CC0000'
  if (util >= thresholds.high)   return '#FF7C80'
  if (util >= thresholds.medium) return '#F4E04D'
  return '#648FFF'
}

export function UsageBar({ utilization, thresholds, colorByUsage = false }: Props) {
  const pct = Math.min(100, Math.max(0, utilization))
  const color = accentColor(pct, thresholds, colorByUsage)

  return (
    <div className="h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  )
}
