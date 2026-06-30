import { useEffect, useRef, useState } from 'react'
import { UsageSection } from '../components/UsageSection'
import { UpdateBanner } from '../components/UpdateBanner'
import { getDict } from '@app/i18n'
import type { UsageState, Settings, UpdateInfo } from '../../../main/types'

export function PopupView() {
  const [state, setState] = useState<UsageState>({ data: null, fetchedAt: null, error: null })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
    window.electronAPI.getUsage().then(setState)
    window.electronAPI.getUpdateInfo().then(setUpdate)

    const unsubUsage = window.electronAPI.onUsageUpdate((s) => setState(s))
    const unsubSettings = window.electronAPI.onSettingsUpdate((s) => setSettings(s))
    return () => { unsubUsage(); unsubSettings() }
  }, [])

  const isDark = settings?.theme !== 'light'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // Auto-resize window to content height
  useEffect(() => {
    if (rootRef.current) {
      window.electronAPI.resizeWindow(rootRef.current.scrollHeight + 2)
    }
  }, [state, settings, update])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    const s = await window.electronAPI.refresh()
    setState(s)
    setRefreshing(false)
  }

  const lang = settings?.language ?? 'ja'
  const t = getDict(lang)
  const thresholds = settings?.thresholds ?? { warning: 60, critical: 100 }
  const colorByUsage = settings?.colorByUsage ?? false
  const timezone = settings?.timezone ?? 'auto'

  const { data, fetchedAt } = state
  const lastUpdated = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString(lang === 'ja' ? 'ja-JP' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : null

  return (
    <div ref={rootRef}>
      <div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-200 dark:border-gray-700">
          <span className="text-sm font-bold">{t.appName}</span>
          <button
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 text-base leading-none p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            onClick={() => window.electronAPI.openSettings()}
            title={t.settingsTitle}
          >
            ⚙
          </button>
        </div>

        {/* 新バージョン通知（あるときだけ表示） */}
        {update?.available && update.url && update.latestVersion && (
          <UpdateBanner
            version={update.latestVersion}
            url={update.url}
            label={t.updateAvailable}
            downloadLabel={t.updateDownload}
          />
        )}

        {/* Content */}
        <div className="px-4 pt-3 pb-1">
          {state.error === 'unauthenticated' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-xs text-gray-400 dark:text-gray-400 text-center">{t.loginRequired}</p>
              <button
                onClick={() => window.electronAPI.login()}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                {t.login}
              </button>
            </div>
          ) : !data ? (
            <p className="text-xs text-gray-400 dark:text-gray-400 py-4 text-center">{t.noData}</p>
          ) : (
            <>
              <div className="space-y-2">
                <UsageSection
                  label={t.session5h}
                  item={data.five_hour}
                  thresholds={thresholds}
                  colorByUsage={colorByUsage}
                  timezone={timezone}
                  t={t}
                  language={lang}
                />

                <div>
                  <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 px-1 mt-1 mb-2">
                    {t.weeklyHeading}
                  </h3>
                  <div className="ml-3 space-y-2">
                    <UsageSection
                      label={t.weeklyAllModels}
                      item={data.seven_day}
                      thresholds={thresholds}
                      colorByUsage={colorByUsage}
                      timezone={timezone}
                      t={t}
                      language={lang}
                    />
                    {data.seven_day_sonnet && (
                      <UsageSection
                        label={t.weeklySonnet}
                        item={data.seven_day_sonnet}
                        thresholds={thresholds}
                        colorByUsage={colorByUsage}
                        timezone={timezone}
                        t={t}
                        language={lang}
                      />
                    )}
                    {data.seven_day_claude_design && (
                      <UsageSection
                        label={t.weeklyClaudeDesign}
                        item={data.seven_day_claude_design}
                        thresholds={thresholds}
                        colorByUsage={colorByUsage}
                        timezone={timezone}
                        t={t}
                        language={lang}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="mb-2 mt-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-300">{t.extraUsage}: </span>
                {data.extra_usage?.is_enabled ? (
                  <span className="text-emerald-500 dark:text-emerald-400">✓ {t.extraEnabled}</span>
                ) : (
                  <span>✗ {t.extraNotEnabled}</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
          <span>{lastUpdated ? `${t.lastUpdated}: ${lastUpdated}` : ''}</span>
          <button
            className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors italic disabled:opacity-40"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? t.refreshing : t.clickToRefresh}
          </button>
        </div>
      </div>
    </div>
  )
}
