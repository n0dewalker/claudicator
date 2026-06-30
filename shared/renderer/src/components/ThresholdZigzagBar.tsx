import { useEffect, useRef, useState } from 'react'

const LOW = '#648FFF'
const MID = '#F4E04D'
const HIGH = '#FF7C80'
const CAP = '#CC0000'
const CLOSE_GAP = 19

interface Props {
  medium: number
  high: number
  capLabel: string
  onChangeMedium: (v: number) => void
  onChangeHigh: (v: number) => void
}

export function ThresholdZigzagBar({
  medium, high, capLabel, onChangeMedium, onChangeHigh,
}: Props) {
  const close = high - medium < CLOSE_GAP
  const barRef = useRef<HTMLDivElement>(null)
  return (
    <div className="pt-7 pb-10 px-1">
      <div className="flex items-center gap-2">
        <div
          ref={barRef}
          className="flex-1 h-3.5 rounded-full relative"
          style={{
            background:
              `linear-gradient(to right,` +
              ` ${LOW} 0%, ${LOW} ${medium}%,` +
              ` ${MID} ${medium}%, ${MID} ${high}%,` +
              ` ${HIGH} ${high}%, ${HIGH} 100%)`,
          }}
        >
          <DragHandle pct={medium} barRef={barRef} onChange={onChangeMedium} />
          <DragHandle pct={high} barRef={barRef} onChange={onChangeHigh} />
          <ZigLabel
            pct={medium}
            value={medium}
            color={MID}
            position="top"
            onCommit={onChangeMedium}
          />
          <ZigLabel
            pct={high}
            value={high}
            color={HIGH}
            position={close ? 'bottom' : 'top'}
            onCommit={onChangeHigh}
          />
        </div>
        <div
          title={capLabel}
          className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/40"
          style={{ backgroundColor: CAP }}
        />
        <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{capLabel}</span>
      </div>
    </div>
  )
}

function DragHandle({ pct, barRef, onChange }: {
  pct: number
  barRef: React.RefObject<HTMLDivElement | null>
  onChange: (v: number) => void
}) {
  const draggingRef = useRef(false)

  const computePct = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return pct
    const raw = ((clientX - rect.left) / rect.width) * 100
    return Math.max(0, Math.min(100, Math.round(raw)))
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    onChange(computePct(e.clientX))
  }
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    draggingRef.current = false
  }

  return (
    <div
      className="absolute -top-1 -bottom-1 w-3 cursor-ew-resize touch-none"
      style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="absolute top-0.5 bottom-0.5 w-1 bg-white border border-black/40 rounded pointer-events-none"
        style={{ left: '50%', transform: 'translateX(-50%)' }}
      />
    </div>
  )
}

interface ZigLabelProps {
  pct: number
  value: number
  color: string
  position: 'top' | 'bottom'
  onCommit: (v: number) => void
}

function ZigLabel({ pct, value, color, position, onCommit }: ZigLabelProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const above = position === 'top'
  const commit = () => {
    const n = parseInt(draft, 10)
    if (!Number.isNaN(n)) onCommit(n)
    setEditing(false)
  }

  return (
    <div
      className="absolute flex items-center"
      style={{
        left: `${pct}%`,
        transform: 'translateX(-50%)',
        flexDirection: above ? 'column' : 'column-reverse',
        top: above ? 'auto' : 18,
        bottom: above ? 18 : 'auto',
        transition: 'top .18s ease, bottom .18s ease',
      }}
    >
      {editing ? (
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') { setDraft(String(value)); setEditing(false) }
          }}
          className="w-12 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-bold text-center rounded outline-none font-mono py-0.5"
          style={{ borderColor: color, borderWidth: 1, borderStyle: 'solid' }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="cursor-pointer flex items-baseline text-gray-900 dark:text-gray-100 leading-none rounded px-1.5 py-0.5 bg-white/5 hover:bg-white/15 transition-colors"
          style={{ borderWidth: 1, borderStyle: 'solid', borderColor: `${color}66` }}
        >
          <span className="font-mono text-sm font-bold tabular-nums">{value}</span>
        </button>
      )}
      <div className="w-px h-1 bg-gray-400 dark:bg-gray-500 my-0.5" />
    </div>
  )
}
