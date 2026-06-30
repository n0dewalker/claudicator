import { useEffect, useState, type ReactNode } from 'react'

interface TabItem {
  key: string
  label: string
  content: ReactNode
}

interface Props {
  items: TabItem[]
  // この値が変わるたびに先頭タブへ戻す。ウィンドウ再表示時のタブリセット用。
  resetSignal?: number
}

export function Tabs({ items, resetSignal }: Props) {
  const [active, setActive] = useState(items[0].key)

  useEffect(() => {
    if (resetSignal === undefined) return
    setActive(items[0].key)
    // items[0].key は安定。resetSignal の変化のみで先頭タブへ戻す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])
  const activeContent = items.find(i => i.key === active)?.content ?? items[0].content
  return (
    <div>
      <div role="tablist" className="flex border-b border-gray-200 dark:border-gray-700 mb-3">
        {items.map(item => {
          const selected = item.key === active
          return (
            <button
              key={item.key}
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(item.key)}
              className={
                'px-4 py-2 text-sm font-medium transition-colors ' +
                (selected
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200')
              }
            >
              {item.label}
            </button>
          )
        })}
      </div>
      <div role="tabpanel">{activeContent}</div>
    </div>
  )
}
