interface Props {
  utilization: number
}

export function UsageBar({ utilization }: Props) {
  const pct = Math.min(100, Math.max(0, utilization))

  return (
    <div className="h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${pct}%`, backgroundColor: '#648FFF' }}
      />
    </div>
  )
}
