import { useEffect, useState } from 'react'
import { UsageSection } from '@shared/renderer/src/components/UsageSection'
import { Tabs } from '@shared/renderer/src/components/Tabs'
import { WebLoginPrompt } from '../components/WebLoginPrompt'
import { ErrorView } from '@shared/renderer/src/components/ErrorView'
import { ThresholdZigzagBar } from '@shared/renderer/src/components/ThresholdZigzagBar'
import { getDict } from '@shared/renderer/src/i18n'
import type { UsageState, Settings } from '@shared/main/types'

const TIMEZONES = [
  'auto',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Australia/Sydney',
]

export function MainView() {
  const [state, setState] = useState<UsageState>({ data: null, fetchedAt: null, error: null })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [intervalStr, setIntervalStr] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [tabResetSignal, setTabResetSignal] = useState(0)

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion)
    window.electronAPI.getSettings().then((s) => {
      setSettings(s)
      setIntervalStr(String(s.refreshInterval))
    })
    window.electronAPI.getUsage().then(setState)

    const unsubUsage = window.electronAPI.onUsageUpdate((s) => setState(s))
    const unsubSettings = window.electronAPI.onSettingsUpdate((s) => {
      setSettings(s)
      setIntervalStr(String(s.refreshInterval))
    })
    // ウィンドウ再表示のたびに使用量タブへ戻す
    const unsubShown = window.electronAPI.onWindowShown(() => setTabResetSignal((n) => n + 1))
    return () => { unsubUsage(); unsubSettings(); unsubShown() }
  }, [])

  const isDark = settings?.theme !== 'light'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  if (!settings) return null

  const lang = settings.language
  const t = getDict(lang)

  const apply = (partial: Partial<Settings>) => {
    setSettings((prev) => prev ? { ...prev, ...partial } : prev)
    window.electronAPI.setSettings(partial)
  }

  const setMedium = (raw: number) => {
    const safe = Number.isFinite(raw) ? raw : settings.thresholds.medium
    const v = Math.max(1, Math.min(98, safe))
    const high = Math.max(v + 1, settings.thresholds.high)
    apply({ thresholds: { medium: v, high } })
  }

  const setHigh = (raw: number) => {
    const safe = Number.isFinite(raw) ? raw : settings.thresholds.high
    const v = Math.max(2, Math.min(99, safe))
    const medium = Math.min(v - 1, settings.thresholds.medium)
    apply({ thresholds: { medium, high: v } })
  }

  const handleIntervalBlur = () => {
    const v = Math.max(1, Math.min(10, parseInt(intervalStr, 10) || settings.refreshInterval))
    setIntervalStr(String(v))
    apply({ refreshInterval: v })
  }

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    const s = await window.electronAPI.refresh()
    setState(s)
    setRefreshing(false)
  }

  const { data, fetchedAt } = state
  const lastUpdated = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString(lang === 'ja' ? 'ja-JP' : 'en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    : null

  const label = 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1'
  const inputCls = 'w-full bg-gray-100 dark:bg-[#23232a] border border-gray-300 dark:border-white/10 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-gray-500 dark:focus:border-gray-400'
  const selectCls = `${inputCls} cursor-pointer`
  const section = 'text-[11px] font-bold tracking-wide text-gray-500 dark:text-gray-400 mb-2 pb-1 border-b border-gray-200 dark:border-white/10'

  const usageContent = (
    <>
      {(state.error === 'unauthenticated' || state.error === 'session_expired') ? (
        <WebLoginPrompt t={t} />
      ) : state.error ? (
        <ErrorView error={state.error} t={t} onRetry={handleRefresh} retrying={refreshing} />
      ) : !data ? (
        <p className="text-xs text-gray-400 dark:text-gray-400 py-6 text-center">{t.noData}</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <UsageSection
                label={t.session5h}
                item={data.five_hour}
                thresholds={settings.thresholds}
                colorByUsage={settings.colorByUsage}
                timezone={settings.timezone}
                t={t}
                language={lang}
              />
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{t.extraUsage}</span>
                <span className="text-sm font-mono font-bold text-gray-400">—</span>
              </div>
              {data.extra_usage?.is_enabled
                ? <span className="text-xs text-emerald-500 dark:text-emerald-400">✓ {t.extraEnabled}</span>
                : <span className="text-xs text-gray-500 dark:text-gray-400">✗ {t.extraNotEnabled}</span>}
            </div>
          </div>
          <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
            <div className="grid grid-cols-3 gap-2">
              <UsageSection
                label={t.weeklyAllModels}
                item={data.seven_day}
                thresholds={settings.thresholds}
                colorByUsage={settings.colorByUsage}
                timezone={settings.timezone}
                t={t}
                language={lang}
              />
              {/* データ駆動: API がその週間枠を返している（non-null）ときだけメーターを出す。
                  Claude Design は 2026-05 に共有枠へ統合され null になったため自動で非表示になる。
                  Anthropic が枠を復活させれば（omelette が non-null 化すれば）自動で再表示される。 */}
              {data.seven_day_sonnet && (
                <UsageSection
                  label={t.weeklySonnet}
                  item={data.seven_day_sonnet}
                  thresholds={settings.thresholds}
                  colorByUsage={settings.colorByUsage}
                  timezone={settings.timezone}
                  t={t}
                  language={lang}
                />
              )}
              {data.seven_day_claude_design && (
                <UsageSection
                  label={t.weeklyClaudeDesign}
                  item={data.seven_day_claude_design}
                  thresholds={settings.thresholds}
                  colorByUsage={settings.colorByUsage}
                  timezone={settings.timezone}
                  t={t}
                  language={lang}
                />
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mt-2 mb-2 text-xs text-gray-400 dark:text-gray-500">
        <span>{lastUpdated ? `${t.lastUpdated}: ${lastUpdated}` : ''}</span>
        <button
          className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors italic disabled:opacity-40"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? t.refreshing : t.clickToRefresh}
        </button>
      </div>
    </>
  )

  const settingsContent = (
    <>
      <div className="flex justify-end mb-3">
        <button
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          onClick={() => window.electronAPI.resetSettings()}
        >
          {t.resetSettings}
        </button>
      </div>
      <div className="space-y-4">
        <section className="space-y-3">
          <h3 className={section}>{t.secTrayIcon}</h3>
        <div>
          <div className="flex gap-3 items-start">
            <div className="shrink-0 w-36">
              <label className={label}>{t.trayShape}</label>
              <div className="flex gap-1">
                {(['bar', 'donut'] as const).map((shape) => (
                  <button key={shape}
                    className={`flex-1 text-xs py-1 rounded border transition-colors ${
                      settings.trayShape === shape
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-[#23232a] border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400'
                    }`}
                    onClick={() => apply({ trayShape: shape })}>
                    {shape === 'bar' ? t.trayBar : t.trayDonut}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className={label}>{t.trayGrid}</label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={settings.trayGridEnabled}
                    onChange={(e) => apply({ trayGridEnabled: e.target.checked })}
                    className="accent-blue-600"
                  />
                  {t.trayGridEnable}
                </label>
                <input
                  type="number"
                  min={2}
                  max={20}
                  step={1}
                  disabled={!settings.trayGridEnabled}
                  value={settings.trayGridDivisions}
                  onChange={(e) => {
                    const v = Math.max(2, Math.min(20, Math.round(Number(e.target.value) || 4)))
                    apply({ trayGridDivisions: v })
                  }}
                  className={`w-16 text-xs px-1 py-0.5 rounded border bg-gray-100 dark:bg-[#23232a] border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-300 ${
                    !settings.trayGridEnabled ? 'opacity-40 cursor-not-allowed' : ''
                  }`}
                />
                <span className={`text-xs text-gray-500 dark:text-gray-400 ${
                  !settings.trayGridEnabled ? 'opacity-40' : ''
                }`}>{t.trayGridDivisionsUnit}</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className={label}>{t.trayMeters}</label>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 opacity-70">
              <input type="checkbox" checked readOnly disabled className="accent-blue-600" />
              {t.session5h} {t.trayMeterAlwaysShown}
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 opacity-70">
              <input type="checkbox" checked readOnly disabled className="accent-blue-600" />
              {t.weeklyAllModels} {t.trayMeterAlwaysShown}
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={settings.trayShowSonnet}
                onChange={(e) => apply({ trayShowSonnet: e.target.checked })} className="accent-blue-600" />
              {t.weeklySonnet}
            </label>
            {/* Claude Design 枠が API から提供されている時だけトグルを出す（データ駆動）。
                統合で null の現状は非表示。復活すれば自動で再表示される。 */}
            {(!data || data.seven_day_claude_design) && (
              <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={settings.trayShowDesign}
                  onChange={(e) => apply({ trayShowDesign: e.target.checked })} className="accent-blue-600" />
                {t.weeklyClaudeDesign}
              </label>
            )}
          </div>
        </div>
        </section>

        <section className="space-y-3">
          <h3 className={section}>{t.secDisplay}</h3>
        <div>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={settings.colorByUsage}
              onChange={(e) => apply({ colorByUsage: e.target.checked })}
              className="accent-blue-600"
            />
            {t.colorByUsage}
          </label>
          {/* 閾値の設定は「使用量に応じて色を変える」がオンのときだけ効く。
              オフ時は淡色＋操作不可にして従属関係を示す。 */}
          <div className={settings.colorByUsage ? '' : 'opacity-40 pointer-events-none'}>
            <label className={label}>{t.colorThresholds}</label>
            <ThresholdZigzagBar
              medium={settings.thresholds.medium}
              high={settings.thresholds.high}
              capLabel={t.limitReached}
              onChangeMedium={setMedium}
              onChangeHigh={setHigh}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={label}>{t.language}</label>
            <select className={selectCls} value={settings.language}
              onChange={(e) => apply({ language: e.target.value as Settings['language'] })}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className={label}>{t.theme}</label>
            <select className={selectCls} value={settings.theme}
              onChange={(e) => apply({ theme: e.target.value as Settings['theme'] })}>
              <option value="dark">{t.dark}</option>
              <option value="light">{t.light}</option>
            </select>
          </div>
          <div>
            <label className={label}>{t.timezone}</label>
            <select className={selectCls} value={settings.timezone}
              onChange={(e) => apply({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz === 'auto' ? t.timezoneAuto : tz}</option>
              ))}
            </select>
          </div>
        </div>
        </section>

        <section>
          <h3 className={section}>{t.secBehavior}</h3>
        <div className="grid grid-cols-2 gap-2 items-end">
          <div>
            <div className="flex items-center gap-1 mb-1">
              <span className={label.replace('mb-1', '')}>{t.refreshInterval}</span>
              <div className="relative group">
                <span className="cursor-help text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-xs">ⓘ</span>
                <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-0 bottom-full mb-1 w-72 p-3 rounded bg-white dark:bg-[#23232a] border border-gray-200 dark:border-white/10 text-xs text-gray-600 dark:text-gray-300 leading-relaxed shadow-lg z-50 pointer-events-none">
                  {t.refreshIntervalHelp}
                </div>
              </div>
            </div>
            <input type="number" min="1" max="10" step="1" className={inputCls}
              value={intervalStr}
              onChange={(e) => setIntervalStr(e.target.value)}
              onBlur={handleIntervalBlur} />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <input type="checkbox" id="autostart" checked={settings.autoStart}
              onChange={(e) => apply({ autoStart: e.target.checked })}
              className="accent-blue-600 cursor-pointer" />
            <label htmlFor="autostart" className="text-xs text-gray-700 dark:text-gray-300 cursor-pointer">{t.autoStart}</label>
          </div>
        </div>
        </section>
      </div>
      {appVersion && (
        <p className="mt-3 text-right text-xs text-gray-400 dark:text-gray-600">v{appVersion}</p>
      )}
    </>
  )

  return (
    <div className="bg-white dark:bg-[#16161a] text-gray-900 dark:text-gray-100">
      <div className="px-4 py-3">

        {/* ── Account info (top) ── */}
        <div className="mb-2 flex items-center justify-between">
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 dark:bg-[#23232a] px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden />
            {state.accountEmail && (
              <span className="truncate max-w-[220px]">{state.accountEmail}</span>
            )}
            <div className="relative group shrink-0 ml-1">
              <span className="cursor-help text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                ⓘ {t.accountAbout}
              </span>
              <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-0 top-full mt-1 w-80 p-3 rounded bg-white dark:bg-[#23232a] border border-gray-200 dark:border-white/10 text-xs text-gray-600 dark:text-gray-300 leading-relaxed shadow-lg z-50 pointer-events-none">
                {t.accountAboutHelp}
              </div>
            </div>
          </div>
          <button
            onClick={() => window.electronAPI.logout()}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            {t.logout}
          </button>
        </div>

        <Tabs resetSignal={tabResetSignal} items={[
          { key: 'usage', label: t.tabUsage, content: usageContent },
          { key: 'settings', label: t.tabSettings, content: settingsContent },
        ]} />

      </div>
    </div>
  )
}
