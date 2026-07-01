import { useEffect, useState } from 'react'
import { UsageSection } from '@shared/renderer/src/components/UsageSection'
import { Tabs } from '@shared/renderer/src/components/Tabs'
import { UpdateBanner } from '@shared/renderer/src/components/UpdateBanner'
import { WebLoginPrompt } from '../components/WebLoginPrompt'
import { ErrorView } from '@shared/renderer/src/components/ErrorView'
import { ThresholdZigzagBar } from '@shared/renderer/src/components/ThresholdZigzagBar'
import { getDict } from '@shared/renderer/src/i18n'
import type { UsageState, Settings, UpdateInfo, OrgInfo } from '@shared/main/types'

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
  const [colorSamples, setColorSamples] =
    useState<Record<'none' | 'item' | 'usage', { donut: string; bar: string }> | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [orgs, setOrgs] = useState<OrgInfo[]>([])
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion)
    window.electronAPI.getUpdateInfo().then(setUpdateInfo)
    window.electronAPI.getSettings().then((s) => {
      setSettings(s)
      setIntervalStr(String(s.refreshInterval))
    })
    window.electronAPI.getUsage().then(setState)
    window.electronAPI.listOrganizations().then(setOrgs).catch(() => setOrgs([]))

    const unsubUsage = window.electronAPI.onUsageUpdate((s) => setState(s))
    const unsubSettings = window.electronAPI.onSettingsUpdate((s) => {
      setSettings(s)
      setIntervalStr(String(s.refreshInterval))
    })
    // ウィンドウ再表示のたびに使用量タブへ戻す + 組織リスト再取得
    const unsubShown = window.electronAPI.onWindowShown(() => {
      setTabResetSignal((n) => n + 1)
      window.electronAPI.listOrganizations().then(setOrgs).catch(() => setOrgs([]))
    })
    return () => { unsubUsage(); unsubSettings(); unsubShown() }
  }, [])

  // 色モードのサンプルは「表示中のメーター本数」に合わせて生成し直す。
  // Sonnet も Claude Design も無い時は 2 本、どちらか有れば 3 本（3〜4 本を代表）。
  const hasOptionalForSamples = !!(state.data?.seven_day_sonnet || state.data?.seven_day_claude_design)
  useEffect(() => {
    window.electronAPI.getColorSamples(hasOptionalForSamples ? 3 : 2).then(setColorSamples)
  }, [hasOptionalForSamples])

  const isDark = settings?.theme !== 'light'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // 組織選択メニューの外側クリック・Escape で閉じる
  useEffect(() => {
    if (!orgMenuOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('[data-org-menu]')) setOrgMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOrgMenuOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [orgMenuOpen])

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
  // 切り替え可能な週間メーター（Sonnet / Claude Design）が API から来ているか。
  // どちらも無ければ「表示メーター」設定は不要なので隠し、色サンプルも 2 本表示にする。
  const hasSonnet = !!data?.seven_day_sonnet
  const hasDesign = !!data?.seven_day_claude_design
  const hasOptionalMeter = hasSonnet || hasDesign
  const lastUpdated = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString(lang === 'ja' ? 'ja-JP' : 'en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    : null

  const label = 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1'
  const inputCls = 'w-full bg-gray-100 dark:bg-[#23232a] border border-gray-300 dark:border-white/10 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-gray-500 dark:focus:border-gray-400'
  const selectCls = `${inputCls} cursor-pointer`

  const usageContent = (
    <>
      {(state.error === 'unauthenticated' || state.error === 'session_expired') ? (
        <WebLoginPrompt t={t} />
      ) : state.error ? (
        <ErrorView error={state.error} t={t} onRetry={handleRefresh} retrying={refreshing} />
      ) : !data ? (
        <p className="text-xs text-gray-400 dark:text-gray-400 py-6 text-center">{t.noData}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {/* 2 カラム単一グリッド。5h は 2 カラム占有、以降（全モデル→Sonnet→Design→追加使用量）は
              1 カラムずつ流す。Sonnet / Claude Design が null の時はトルツメで繰り上がるため、
              「両方なし／片方復活／両方復活」のいずれでもレイアウトが破綻しない。 */}
          <div className="col-span-2">
            <UsageSection
              label={t.session5h}
              item={data.five_hour}
              timezone={settings.timezone}
              t={t}
              language={lang}
            />
          </div>
          <UsageSection
            label={t.weeklyAllModels}
            item={data.seven_day}
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
              timezone={settings.timezone}
              t={t}
              language={lang}
            />
          )}
          {data.seven_day_claude_design && (
            <UsageSection
              label={t.weeklyClaudeDesign}
              item={data.seven_day_claude_design}
              timezone={settings.timezone}
              t={t}
              language={lang}
            />
          )}
          <div className="h-full rounded-lg border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{t.extraUsage}</span>
              <span className="text-sm font-mono font-bold text-gray-400">—</span>
            </div>
            {data.extra_usage?.is_enabled
              ? <span className="text-xs text-emerald-500 dark:text-emerald-400">✓ {t.extraEnabled}</span>
              : <span className="text-xs text-gray-500 dark:text-gray-400">✗ {t.extraNotEnabled}</span>}
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

  const resetBtn = (
    <div className="flex justify-end mb-3">
      <button
        className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        onClick={() => setConfirmingReset(true)}
      >
        {t.resetSettings}
      </button>
    </div>
  )

  const resetModal = confirmingReset && (
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50 px-6"
      onClick={() => setConfirmingReset(false)}
    >
      <div
        className="w-full max-w-xs rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#23232a] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">{t.resetSettings}</p>
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed mb-1">{t.resetConfirm}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed mb-4">{t.resetConfirmNote}</p>
        <div className="flex justify-end gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400 transition-colors"
            onClick={() => setConfirmingReset(false)}
          >
            {t.resetCancel}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            onClick={() => { window.electronAPI.resetSettings(); setConfirmingReset(false) }}
          >
            {t.resetConfirmYes}
          </button>
        </div>
      </div>
    </div>
  )

  const trayContent = (
    <>
      {resetBtn}
      <div className="space-y-3">
        <div>
          <div className="flex gap-3 items-start">
            <div className="shrink-0 w-36">
              <label className={label}>{t.trayShape}</label>
              <div className="flex gap-1">
                {(['donut', 'bar'] as const).map((shape) => (
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

        {/* 切り替え可能なメーター（Sonnet / Claude Design）が1つも無いときは、
            「表示メーター」設定自体が無意味なのでセクションごとトルツメで隠す。 */}
        {hasOptionalMeter && (
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
            {/* Sonnet / Claude Design とも API がその枠を返している時だけトグルを出す（データ駆動）。
                統合・廃止で null の枠は非表示。復活すれば自動で再表示される。 */}
            {hasSonnet && (
              <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={settings.trayShowSonnet}
                  onChange={(e) => apply({ trayShowSonnet: e.target.checked })} className="accent-blue-600" />
                {t.weeklySonnet}
              </label>
            )}
            {hasDesign && (
              <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={settings.trayShowDesign}
                  onChange={(e) => apply({ trayShowDesign: e.target.checked })} className="accent-blue-600" />
                {t.weeklyClaudeDesign}
              </label>
            )}
          </div>
        </div>
        )}

        <div>
          <label className={label}>{t.colorMode}</label>
          <div className="flex gap-1 mb-2">
            {([
              ['none', t.colorModeNone, t.colorModeNoneHelp],
              ['item', t.colorModeItem, hasOptionalMeter ? t.colorModeItemHelp : t.colorModeItemHelp2],
              ['usage', t.colorModeUsage, t.colorModeUsageHelp],
            ] as const).map(([mode, lbl, help]) => (
              <div key={mode} className="relative group flex-1">
                <button
                  className={`w-full text-xs py-1 rounded border transition-colors ${
                    settings.colorMode === mode
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-[#23232a] border-gray-300 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400'
                  }`}
                  onClick={() => apply({ colorMode: mode })}>
                  {lbl}
                </button>
                <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-60 p-3 rounded bg-white dark:bg-[#23232a] border border-gray-200 dark:border-white/10 shadow-lg z-50 pointer-events-none">
                  {colorSamples && (
                    <div className="flex items-end justify-center gap-5 mb-2">
                      {(['donut', 'bar'] as const).map((shape) => (
                        <div key={shape} className="flex flex-col items-center gap-1">
                          <img src={colorSamples[mode][shape]} alt="" className="w-12 h-12"
                            style={{ imageRendering: shape === 'bar' ? 'pixelated' : 'auto' }} />
                          <span className="text-[10px] text-gray-500 dark:text-gray-400">
                            {shape === 'donut' ? t.trayDonut : t.trayBar}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{help}</p>
                </div>
              </div>
            ))}
          </div>
          {/* しきい値の設定は「使用量に応じて色を変える」のときだけ効く */}
          <div className={settings.colorMode === 'usage' ? '' : 'opacity-40 pointer-events-none'}>
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
      </div>
    </>
  )

  const generalContent = (
    <>
      {resetBtn}
      <div className="space-y-3">
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

        {/* 更新間隔と自動起動。更新間隔は 3 未満（レート制限リスクが上がるゾーン）で、
            キャプションと ⓘ アイコンが status.high (#FF7C80) に変色して控えめに警告する。
            アラート・モーダルは出さない（自分の設定なので過剰な干渉を避ける）。 */}
        {(() => {
          const parsedInterval = parseInt(intervalStr, 10)
          const isRefreshIntervalTooShort = Number.isFinite(parsedInterval) && parsedInterval < 3
          return (
            <div className="grid grid-cols-2 gap-2 items-start">
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <span className={label.replace('mb-1', '')}>{t.refreshInterval}</span>
                  <div className="relative group">
                    <span className={`cursor-help transition-colors text-xs ${
                      isRefreshIntervalTooShort
                        ? 'text-[#FF7C80]'
                        : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}>ⓘ</span>
                    <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-0 bottom-full mb-1 w-72 p-3 rounded bg-white dark:bg-[#23232a] border border-gray-200 dark:border-white/10 text-xs text-gray-600 dark:text-gray-300 leading-relaxed shadow-lg z-50 pointer-events-none">
                      {t.refreshIntervalHelp}
                    </div>
                  </div>
                </div>
                <input type="number" min="1" max="10" step="1" className={inputCls}
                  value={intervalStr}
                  onChange={(e) => setIntervalStr(e.target.value)}
                  onBlur={handleIntervalBlur} />
                <p className={`text-[10px] mt-1 leading-relaxed ${
                  isRefreshIntervalTooShort ? 'text-[#FF7C80]' : 'text-gray-500 dark:text-gray-500'
                }`}>
                  {isRefreshIntervalTooShort ? t.refreshIntervalTooShort : t.refreshIntervalRecommended}
                </p>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input type="checkbox" id="autostart" checked={settings.autoStart}
                  onChange={(e) => apply({ autoStart: e.target.checked })}
                  className="accent-blue-600 cursor-pointer" />
                <label htmlFor="autostart" className="text-xs text-gray-700 dark:text-gray-300 cursor-pointer">{t.autoStart}</label>
              </div>
            </div>
          )
        })()}
      </div>
    </>
  )

  const aboutContent = (
    <div>
      <label className={label}>{t.version}</label>
      <div className="text-xs text-gray-900 dark:text-gray-100">v{appVersion}</div>
    </div>
  )

  return (
    <div className="relative bg-white dark:bg-[#16161a] text-gray-900 dark:text-gray-100">
      {resetModal}
      {updateInfo?.available && updateInfo.latestVersion && updateInfo.url && (
        <UpdateBanner
          version={updateInfo.latestVersion}
          url={updateInfo.url}
          label={t.updateAvailable}
          downloadLabel={t.updateDownload}
        />
      )}
      <div className="px-4 py-3">

        {/* ── Account info (top) ── アカウント（＝メール）情報の表示と、組織（org）の切替。
            SaaS 慣習に沿ってチップ自体をクリックするとドロップダウンで org を選べる。 */}
        {(() => {
          const hasMultipleOrgs = orgs.length > 1
          // チップに [Team] などのバッジを付けるため、現時点で実際に表示されている org を割り出す。
          // 選択済み ID があればそれ、無ければ Team > Pro > Free の順で最優先。
          const scoreOrg = (o: OrgInfo): number => (o.plan === 'team' ? 3 : o.plan === 'pro' ? 2 : 1)
          const effectiveOrg: OrgInfo | null =
            (settings.selectedOrgId && orgs.find((o) => o.uuid === settings.selectedOrgId))
            || (orgs.length ? orgs.slice().sort((a, b) => scoreOrg(b) - scoreOrg(a))[0] : null)
          const planLabel = (plan: OrgInfo['plan']): string =>
            plan === 'team' ? 'Team' : plan === 'pro' ? 'Pro' : 'Free'
          const planBadgeCls = (plan: OrgInfo['plan']): string =>
            plan === 'team' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
            : plan === 'pro' ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300'
            : 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
          const renderPlanBadge = (plan: OrgInfo['plan']) => (
            <span className={`inline-block px-1.5 rounded text-[10px] font-semibold leading-relaxed ${planBadgeCls(plan)}`}>
              {planLabel(plan)}
            </span>
          )
          return (
            <div className="mb-2 flex items-center justify-between gap-2" data-org-menu>
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => hasMultipleOrgs && setOrgMenuOpen((v) => !v)}
                    disabled={!hasMultipleOrgs}
                    aria-expanded={orgMenuOpen}
                    className={`inline-flex items-center gap-2 rounded-full bg-gray-100 dark:bg-[#23232a] px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 transition-colors ${
                      hasMultipleOrgs ? 'hover:bg-gray-200 dark:hover:bg-[#2a2a33] cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                    {state.accountEmail && (
                      <span className="truncate max-w-[160px]">{state.accountEmail}</span>
                    )}
                    {hasMultipleOrgs && effectiveOrg && renderPlanBadge(effectiveOrg.plan)}
                    {hasMultipleOrgs && (
                      <span className="text-gray-400 dark:text-gray-500 leading-none text-[10px]">▾</span>
                    )}
                  </button>

                  {orgMenuOpen && hasMultipleOrgs && (
                    <div className="absolute top-full left-0 mt-1 min-w-[260px] max-w-[340px] rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#23232a] shadow-lg z-50 py-1">
                      <button
                        type="button"
                        onClick={() => { apply({ selectedOrgId: null }); setOrgMenuOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#2a2a33] transition-colors"
                      >
                        <span className="w-4 shrink-0 text-center text-blue-500 dark:text-blue-400">
                          {settings.selectedOrgId === null ? '✓' : ''}
                        </span>
                        <span>{t.orgAuto}</span>
                      </button>
                      <div className="border-t border-gray-200 dark:border-white/10 my-1" />
                      {orgs.map((o) => (
                        <button
                          key={o.uuid}
                          type="button"
                          onClick={() => { apply({ selectedOrgId: o.uuid }); setOrgMenuOpen(false) }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#2a2a33] transition-colors"
                        >
                          <span className="w-4 shrink-0 text-center text-blue-500 dark:text-blue-400">
                            {settings.selectedOrgId === o.uuid ? '✓' : ''}
                          </span>
                          {renderPlanBadge(o.plan)}
                          <span className="truncate">{o.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* ⓘ アカウントについて はアカウント（＝メール）単位の切替方法を説明するため残す。
                    org 切替はチップから、別メアドへの切替はログアウト → 再ログインで、と役割が分かれている。 */}
                <div className="relative group shrink-0">
                  <span className="cursor-help text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors text-xs">
                    ⓘ {t.accountAbout}
                  </span>
                  <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-0 top-full mt-1 w-80 p-3 rounded bg-white dark:bg-[#23232a] border border-gray-200 dark:border-white/10 text-xs text-gray-600 dark:text-gray-300 leading-relaxed shadow-lg z-50 pointer-events-none">
                    {t.accountAboutHelp}
                  </div>
                </div>
              </div>

              <button
                onClick={() => window.electronAPI.logout()}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0"
              >
                {t.logout}
              </button>
            </div>
          )
        })()}

        <Tabs resetSignal={tabResetSignal} items={[
          { key: 'usage', label: t.tabUsage, content: usageContent },
          { key: 'tray', label: t.tabTrayIcon, content: trayContent },
          { key: 'general', label: t.tabGeneral, content: generalContent },
          { key: 'about', label: t.tabAbout, content: aboutContent },
        ]} />

      </div>
    </div>
  )
}
