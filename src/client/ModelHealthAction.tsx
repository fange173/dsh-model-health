/**
 * Status-entry component: a compact chip (state dot + label + healthy/total
 * count) whose popover presents the live per-model status list, retained-round
 * trend strips, and a small display-settings section. All data arrives through
 * inject-bound selector hooks and plain callbacks; derivation lives in
 * `view.ts`.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useState, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ModelHealthCatalogEntry, ModelCheckResult, ModelHealthFilter } from '../types.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconRefreshOutline14,
  IconSettingsOutline14,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import {
  aggregateTone,
  buildRoundSeries,
  buildTrendSeries,
  filterTrendSeries,
  formatLatency,
  formatTimestamp,
  groupByProvider,
  modelEnabled,
  providerEnabled,
  PROBE_TIMEOUT_CODE,
  recency,
  resultTone,
  summarize,
  toggleModel,
  toggleProvider,
  TREND_DOT_CAP,
  type Aggregate,
  type RoundPoint,
  type Recency,
  type TrendSeries,
} from './view.ts'
import type { HealthData, HealthPosition, HealthSettings } from './controller.ts'
import { MAX_REFRESH_SECONDS } from './controller.ts'
import css from './ModelHealthAction.module.css'

/** Business face the apply world injects into the chip registration. */
export interface ModelHealthInjected {
  hooks: {
    health: SnapshotStore<HealthData>
    healthSettings: SnapshotStore<HealthSettings>
  }
  refresh: () => void
  setPosition: (position: HealthPosition) => void
  setRefreshSeconds: (seconds: number) => void
  syncFilter: (filter: ModelHealthFilter) => void
}

/** Shared props for the composed chip view: the injected face plus locale and the rail form. */
export type HealthViewProps =
  InjectFace<ModelHealthInjected> & PropsLocale<typeof NS> & {
    readonly narrowLabel?: boolean
    readonly fullWidth?: boolean
    /** Render a per-model live chip strip beside the chip (the wide sidebar footer seat). */
    readonly showStrip?: boolean
  }

/** Sidebar-footer seat: consumes the column's `wide` owner flag to adapt the chip. */
export type ModelHealthFooterActionProps = PropsRuntime<'sidebar.footer.action'> & HealthViewProps

const REFRESH_CHOICES = [0, 30, 60, 120, 300]

function recencyLabel(health: Recency, t: TranslateNS<typeof NS>): string {
  switch (health.kind) {
    case 'none': return t('recency.none')
    case 'justNow': return t('recency.justNow')
    case 'minutes': return t('recency.minutes', { minutes: health.minutes })
    /* v8 ignore next -- hours-only branch reached by long-idle views */
    case 'hours': return t('recency.hours', { hours: health.hours })
  }
}

function pointTitle(point: TrendSeries['points'][number], t: TranslateNS<typeof NS>, checkedLabel: string): string {
  const status = point.ok
    ? `${t('history.ok')} ${formatLatency(point.totalMs)}`
    : point.code === PROBE_TIMEOUT_CODE ? t('history.timeout') : t('history.failed', { code: point.code })
  return t('history.title', { checkedAt: checkedLabel, status })
}

function ModelRow({ model, t }: { model: ModelCheckResult; t: TranslateNS<typeof NS> }) {
  const latency = formatLatency(model.ok ? model.totalMs : null)
  const detail = model.ok
    ? t('latency.title', { ttft: formatLatency(model.ttftMs), total: formatLatency(model.totalMs) })
    : `${model.error?.code ?? 'unknown'}${model.error?.status !== undefined ? ` (${model.error.status})` : ''}`
  return (
    <li className={model.ok ? css.row : `${css.row} ${css.rowFailing}`}>
      <StateDot state={resultTone(model)} className={css.rowDot} />
      <span className={css.name} title={model.model}>{model.name}</span>
      <span className={css.modelId} title={model.model}>{model.model}</span>
      <span className={model.ok ? css.latency : css.errorText} title={model.ok ? detail : (model.error?.message ?? detail)}>
        {model.ok ? latency : (model.error?.code ?? 'unknown')}
      </span>
    </li>
  )
}

function StatusBoard({ models, t }: { models: readonly ModelCheckResult[]; t: TranslateNS<typeof NS> }) {
  const groups = useMemo(() => groupByProvider(models), [models])
  return (
    <div className={css.list}>
      {groups.map(group => (
        <section key={group.provider} className={css.providerGroup}>
          <header className={css.providerHead}>
            <span className={css.providerName}>{group.provider}</span>
            <span className={css.providerCount}>{t('provider.count', { count: group.models.length })}</span>
          </header>
          <ul className={css.providerRows}>
            {group.models.map(model => <ModelRow key={`${model.provider}/${model.model}`} model={model} t={t} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * The model checkbox list shown while the settings gear is on. Every registered
 * provider and model (from the host catalog) renders a checkbox reflecting the
 * draft selection; unchecking hides the model and stops probing it after "done".
 */
function EditableStatusBoard({
  catalog, filter, onChange, t,
}: {
  catalog: readonly ModelHealthCatalogEntry[]
  filter: ModelHealthFilter
  onChange: (filter: ModelHealthFilter) => void
  t: TranslateNS<typeof NS>
}) {
  const groups = useMemo(() => groupByProviderList(catalog), [catalog])
  if (catalog.length === 0) {
    return <p className={css.emptyNote}>{t('summary.none')}</p>
  }
  return (
    <div className={css.list}>
      {groups.map(group => (
        <section key={group.provider} className={css.providerGroup}>
          <header className={css.providerHead}>
            <label className={css.checkRow}>
              <input
                type="checkbox"
                checked={providerEnabled(filter, group.provider)}
                onChange={() => { onChange(toggleProvider(filter, group.provider)) }}
              />
              <span className={css.providerName}>{group.provider}</span>
            </label>
            <span className={css.providerCount}>{t('provider.count', { count: group.entries.length })}</span>
          </header>
          <ul className={css.providerRows}>
            {group.entries.map(entry => (
              <li key={`${entry.provider}/${entry.model}`} className={css.catalogRow}>
                <label className={css.checkRow}>
                  <input
                    type="checkbox"
                    checked={modelEnabled(filter, entry.provider, entry.model)}
                    onChange={() => { onChange(toggleModel(filter, entry.provider, entry.model)) }}
                  />
                  <span className={css.name} title={entry.model}>{entry.name}</span>
                  <span className={css.modelId} title={entry.model}>{entry.model}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** Group the catalog entries under their providers, preserving order. */
function groupByProviderList(catalog: readonly ModelHealthCatalogEntry[]): Array<{ provider: string; entries: ModelHealthCatalogEntry[] }> {
  const groups: Array<{ provider: string; entries: ModelHealthCatalogEntry[] }> = []
  let current: { provider: string; entries: ModelHealthCatalogEntry[] } | undefined
  for (const entry of catalog) {
    if (current?.provider !== entry.provider) {
      current = { provider: entry.provider, entries: [] }
      groups.push(current)
    }
    current.entries.push(entry)
  }
  return groups
}

function TrendRow({ item, t }: { item: TrendSeries; t: TranslateNS<typeof NS> }) {
  const [expanded, setExpanded] = useState(false)
  const allPoints = item.points
  const recent = allPoints.slice(-TREND_DOT_CAP)
  const canExpand = allPoints.length > TREND_DOT_CAP
  const expandedPoints = expanded ? [...allPoints].reverse() : []
  return (
    <li className={expanded ? `${css.trendRow} ${css.trendRowExpanded}` : css.trendRow}>
      <div className={css.trendRowMain}>
        <span className={css.trendName} title={item.key}>{item.name}</span>
        <span className={css.dotStrip}>
          {recent.map((point, index) => {
            const label = pointTitle(point, t, formatTimestamp(point.checkedAt))
            return (
              <span
                key={index}
                className={
                  point.ok ? css.pointOk
                    : point.code === PROBE_TIMEOUT_CODE ? css.pointWarn
                      : css.pointErr
                }
                title={label}
                role="img"
                aria-label={label}
              />
            )
          })}
        </span>
        <span className={css.trendMeta}>
          {t('trend.okRate', { percent: item.okRate })}
          {' · '}
          {formatLatency(item.avgTotalMs)}
        </span>
        {canExpand
          ? (
            <button
              type="button"
              className={css.trendToggle}
              aria-expanded={expanded}
              aria-label={expanded ? t('trend.collapse') : t('trend.expand')}
              onClick={() => { setExpanded(current => !current) }}
            >
              {expanded
                ? t('trend.collapse')
                : t('trend.more')}
            </button>
          )
          : null}
      </div>
      {expanded
        ? (
          <div className={css.trendDetail}>
            <div className={css.trendSummary}>
              {t('trend.summary', {
                count: allPoints.length,
                avg: formatLatency(item.avgTotalMs),
                percent: item.okRate,
              })}
            </div>
            <ul className={css.trendDetailList}>
              {expandedPoints.map((point, index) => (
                <li key={index} className={css.trendDetailRow}>
                  <span className={css.trendDetailTime}>{formatTimestamp(point.checkedAt)}</span>
                  <StateDot
                    state={point.ok ? 'done' : point.code === PROBE_TIMEOUT_CODE ? 'warning' : 'error'}
                    className={css.rowDot}
                  />
                  <span className={point.ok ? css.trendDetailOk : css.trendDetailFail}>
                    {point.ok
                      ? `${t('history.ok')} ${formatLatency(point.totalMs)}`
                      : point.code === PROBE_TIMEOUT_CODE ? t('history.timeout') : t('history.failed', { code: point.code })}
                  </span>
                  {point.ok && point.tps !== undefined
                    ? <span className={css.trendDetailTps}>{t('trend.throughput', { value: point.tps })}</span>
                    : null}
                </li>
              ))}
            </ul>
          </div>
        )
        : null}
    </li>
  )
}

function TrendBoard({ series, t }: { series: readonly TrendSeries[]; t: TranslateNS<typeof NS> }) {
  if (series.length === 0) {
    return <p className={css.emptyNote}>{t('trend.empty')}</p>
  }
  // The dot strip renders at most TREND_DOT_CAP points, so the legend must
  // describe that display window (the retained "all" count moves to the
  // expanded summary instead of implying every check is shown up front).
  const pointCount = Math.min(TREND_DOT_CAP, Math.max(...series.map(item => item.points.length)))
  return (
    <>
      <p className={css.trendLegend}>{t('trend.legend', { count: pointCount })}</p>
      <ul className={css.trendList}>
        {series.map(item => <TrendRow key={item.key} item={item} t={t} />)}
      </ul>
    </>
  )
}

/** Hand-typed refresh cadence: commits a valid integer, otherwise reverts the draft. */
function CustomRefreshInput({
  refreshSeconds, setRefreshSeconds, t,
}: {
  refreshSeconds: number
  setRefreshSeconds: (seconds: number) => void
  t: TranslateNS<typeof NS>
}) {
  const isCustom = refreshSeconds > 0 && !REFRESH_CHOICES.includes(refreshSeconds)
  const [draft, setDraft] = useState(isCustom ? String(refreshSeconds) : '')
  useEffect(() => {
    setDraft(isCustom ? String(refreshSeconds) : '')
  }, [refreshSeconds, isCustom])
  const commit = (): void => {
    const parsed = Number(draft.trim())
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_REFRESH_SECONDS) {
      setRefreshSeconds(parsed)
    } else {
      setDraft(isCustom ? String(refreshSeconds) : '')
    }
  }
  return (
    <label className={css.customRefresh}>
      <span className={css.customRefreshLabel}>{t('settings.refresh.custom')}</span>
      <input
        type="number"
        className={css.customRefreshInput}
        value={draft}
        min={1}
        max={MAX_REFRESH_SECONDS}
        step={1}
        placeholder={t('settings.refresh.custom')}
        aria-label={t('settings.refresh.custom')}
        onChange={(event) => { setDraft(event.target.value) }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit() }
        }}
      />
      <span className={css.customRefreshUnit}>{t('settings.refresh.customUnit')}</span>
    </label>
  )
}

function SettingsBoard({
  settings, setPosition, setRefreshSeconds, t,
}: {
  settings: HealthSettings
  setPosition: (position: HealthPosition) => void
  setRefreshSeconds: (seconds: number) => void
  t: TranslateNS<typeof NS>
}) {
  return (
    <div className={css.settings}>
      <div className={css.settingRow}>
        <span className={css.settingLabel}>{t('settings.position.label')}</span>
        <div className={css.pills}>
          {(['sidebar', 'header'] as const).map(option => (
            <button
              key={option}
              type="button"
              className={settings.position === option ? `${css.pill} ${css.pillActive}` : css.pill}
              aria-pressed={settings.position === option}
              onClick={() => { setPosition(option) }}
            >
              {t(option === 'sidebar' ? 'settings.position.sidebar' : 'settings.position.header')}
            </button>
          ))}
        </div>
      </div>
      <div className={css.settingRow}>
        <span className={css.settingLabel}>{t('settings.refresh.label')}</span>
        <div className={css.pills}>
          {REFRESH_CHOICES.map(seconds => (
            <button
              key={seconds}
              type="button"
              className={settings.refreshSeconds === seconds ? `${css.pill} ${css.pillActive}` : css.pill}
              aria-pressed={settings.refreshSeconds === seconds}
              onClick={() => { setRefreshSeconds(seconds) }}
            >
              {seconds === 0 ? t('settings.refresh.off') : t('settings.refresh.seconds', { seconds })}
            </button>
          ))}
          <CustomRefreshInput refreshSeconds={settings.refreshSeconds} setRefreshSeconds={setRefreshSeconds} t={t} />
        </div>
      </div>
    </div>
  )
}

/**
 * The three aggregate pill chips (`N 正常 · M 异常 · 平均耗时 …`), shared by
 * the panel's first line and the wide sidebar footer row so both read the
 * same summary and stay in lockstep. Returns `null` while nothing has probed.
 */
function AggregateChips({ aggregate, t }: { aggregate: Aggregate | null; t: TranslateNS<typeof NS> }) {
  if (aggregate === null || aggregate.total === 0) return null
  return (
    <>
      <span className={css.summaryChip}>{t('summary.online', { count: aggregate.ok })}</span>
      {aggregate.failing > 0
        ? <span className={`${css.summaryChip} ${css.summaryChipFailing}`}>{t('summary.failing', { count: aggregate.failing })}</span>
        : null}
      {aggregate.avgTotalMs !== null
        ? <span className={css.summaryChip}>{t('summary.avgLatency', { value: formatLatency(aggregate.avgTotalMs) })}</span>
        : null}
    </>
  )
}

/**
 * Two side-by-side sparkline cards over retained rounds: per-round
 * ok/failing columns and the mean healthy latency line. Pure inline SVG — no
 * chart dependency, theme colors via CSS variables.
 */
function ChartsRow({ rounds, t }: { rounds: readonly RoundPoint[]; t: TranslateNS<typeof NS> }) {
  // One shared hover cursor, tagged with the card it came from so only the
  // hovered chart shows its tooltip (two side-by-side tooltips would overlap).
  const [hover, setHover] = useState<{ index: number; source: 'status' | 'latency' } | null>(null)
  if (rounds.length === 0) {
    return <p className={css.emptyNote}>{t('summary.none')}</p>
  }
  const clear = (): void => { setHover(null) }
  const hoverIndex = hover?.index ?? null
  const tooltipLeft = hoverIndex === null ? 0 : Math.max(8, Math.min(92, ((hoverIndex + 0.5) / rounds.length) * 100))
  const hovered = hoverIndex === null ? null : rounds[hoverIndex] ?? null
  return (
    <div className={css.charts}>
      <div className={css.chartCard} onMouseLeave={clear}>
        <span className={css.chartTitle}>{t('chart.status')}</span>
        <StatusSparkline
          rounds={rounds}
          hover={hoverIndex}
          onHover={(index) => { setHover({ index, source: 'status' }) }}
        />
        {hover !== null && hover.source === 'status' && hovered !== null
          ? (
            <ChartTooltip
              leftPct={tooltipLeft}
              text={`${t('summary.online', { count: hovered.ok })} · ${t('summary.failing', { count: hovered.failing })} · ${formatTimestamp(hovered.checkedAt)}`}
            />
          )
          : null}
      </div>
      <div className={css.chartCard} onMouseLeave={clear}>
        <span className={css.chartTitle}>{t('chart.latency')}</span>
        <LatencySparkline
          rounds={rounds}
          hover={hoverIndex}
          onHover={(index) => { setHover({ index, source: 'latency' }) }}
        />
        {hover !== null && hover.source === 'latency' && hovered !== null
          ? (
            <ChartTooltip
              leftPct={tooltipLeft}
              text={`${t('summary.avgLatency', { value: formatLatency(hovered.avgLatency) })} · ${formatTimestamp(hovered.checkedAt)}`}
            />
          )
          : null}
      </div>
    </div>
  )
}

function ChartTooltip({ leftPct, text }: { leftPct: number; text: string }) {
  return <div className={css.chartTooltip} style={{ left: `${leftPct}%` }}>{text}</div>
}

/** Per-round stacked columns: healthy (success) below failing (error). */
function StatusSparkline({ rounds, hover, onHover }: {
  rounds: readonly RoundPoint[]
  hover: number | null
  onHover: (index: number) => void
}) {
  const max = Math.max(1, ...rounds.map(round => round.ok + round.failing))
  const slot = 4
  const height = 40
  return (
    <svg
      className={css.chartSvg}
      viewBox={`0 0 ${Math.max(rounds.length * slot, 1)} ${height}`}
      preserveAspectRatio="none"
      role="img"
    >
      {rounds.map((round, index) => {
        const x = index * slot
        const okHeight = Math.round((round.ok / max) * (height - 2))
        const failHeight = Math.round((round.failing / max) * (height - 2))
        return (
          <g key={round.checkedAt}>
            {hover === index
              ? <rect x={x} y={0} width={slot - 1} height={height} fill="var(--dsw-alias-interactive-bg-hover)" />
              : null}
            {failHeight > 0
              ? (
                <rect
                  x={x}
                  y={height - 1 - failHeight}
                  width={slot - 1}
                  height={failHeight}
                  fill="var(--dsw-alias-state-error-primary)"
                />
              )
              : null}
            {okHeight > 0
              ? (
                <rect
                  x={x}
                  y={height - 1 - okHeight - failHeight}
                  width={slot - 1}
                  height={okHeight}
                  fill="var(--dsw-alias-state-success-primary)"
                />
              )
              : null}
            <rect
              x={x}
              y={0}
              width={slot}
              height={height}
              fill="transparent"
              onMouseEnter={() => { onHover(index) }}
              onClick={() => { onHover(index) }}
            />
          </g>
        )
      })}
    </svg>
  )
}

/** Mean healthy latency line across rounds; gaps where a round had none. */
function LatencySparkline({ rounds, hover, onHover }: {
  rounds: readonly RoundPoint[]
  hover: number | null
  onHover: (index: number) => void
}) {
  const height = 40
  const points = rounds.flatMap((round, index) => round.avgLatency === null ? [] : [{ index, value: round.avgLatency }])
  const min = points.length > 0 ? Math.min(...points.map(point => point.value)) : 0
  const max = points.length > 0 ? Math.max(...points.map(point => point.value)) : 1
  const span = Math.max(1, max - min)
  const xOf = (index: number): number => rounds.length <= 1 ? 50 : (index / (rounds.length - 1)) * 100
  const yOf = (value: number): number => height - 4 - ((value - min) / span) * (height - 8)
  let path = ''
  let previousIndex = -1
  for (const point of points) {
    const gap = previousIndex >= 0 && point.index !== previousIndex + 1
    path += `${path === '' || gap ? 'M' : 'L'}${xOf(point.index).toFixed(1)},${yOf(point.value).toFixed(1)}`
    previousIndex = point.index
  }
  const hoverPoint = hover === null ? undefined : points.find(point => point.index === hover)
  const columnWidth = 100 / rounds.length
  // The svg stretches non-uniformly (preserveAspectRatio none), so the hover
  // marker is an HTML dot in a matching overlay box — a circle inside the svg
  // would render as a flattened ellipse.
  return (
    <>
      <div className={css.chartPlot}>
        <svg
          className={css.chartSvg}
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          role="img"
        >
          {points.length >= 2
            ? (
              <path
                d={path}
                fill="none"
                stroke="var(--dsw-alias-state-warn-primary)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )
            : null}
          {rounds.map((round, index) => (
            <rect
              key={round.checkedAt}
              x={(index / rounds.length) * 100}
              y={0}
              width={columnWidth}
              height={height}
              fill="transparent"
              onMouseEnter={() => { onHover(index) }}
              onClick={() => { onHover(index) }}
            />
          ))}
        </svg>
        {hoverPoint !== undefined
          ? (
            <span
              className={css.chartHoverDot}
              style={{
                left: `${xOf(hoverPoint.index).toFixed(2)}%`,
                top: `${((yOf(hoverPoint.value) / height) * 100).toFixed(2)}%`,
              }}
            />
          )
          : null}
      </div>
    </>
  )
}

/**
 * The chip and its popover panel. Renders the trigger even before data arrives
 * so the entry is stable; the panel body covers loading, empty, and error
 * containers.
 * @param props - inject-bound hooks, callbacks, the namespace translator, and
 * the narrow-rail form flag the seat supplies.
 */
function HealthView({
  useHealth, useHealthSettings, refresh, setPosition, setRefreshSeconds, syncFilter, narrowLabel = false, fullWidth = false, t,
}: HealthViewProps) {
  const data = useHealth(value => value)
  const settings = useHealthSettings(value => value)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'status' | 'trend'>('status')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [filterDraft, setFilterDraft] = useState<ModelHealthFilter>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [fixedPos, setFixedPos] = useState<CSSProperties | null>(null)
  const tabsBaseId = useId()

  // Opening the panel checks staleness every time — including the first open.
  // The host probes on a slow cadence (default 300s) and a newly added model
  // only becomes visible after a fresh round, so a view older than 90s (or
  // one that never probed) forces one immediately.
  useEffect(() => {
    if (!open) return
    const checkedAt = data.view?.snapshot.checkedAt
    if (checkedAt === undefined || Date.now() - Date.parse(checkedAt) > 90_000) {
      refresh()
    }
  }, [open])

  // Enter editing: snapshot the host's current selection into the draft so the
  // checkboxes start from the truth, not a leftover.
  useEffect(() => {
    if (settingsOpen) setFilterDraft(data.view?.filter ?? {})
  }, [settingsOpen])

  // Portal the panel into document.body so the sidebar's overflow:hidden never
  // crops it. Position from the trigger rect: pop upward from the sidebar seat,
  // downward from the header seat, clamped to the viewport with 12px margins.
  useLayoutEffect(() => {
    if (!open) { setFixedPos(null); return }
    const place = (): void => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      /* v8 ignore next -- refs are attached before the layout effect runs and the listeners die with it. */
      if (trigger === null || panel === null) return
      const r = trigger.getBoundingClientRect()
      const MARGIN = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      const lw = panel.offsetWidth
      const lh = panel.offsetHeight
      const popUpward = settings.position === 'sidebar'
      let x = r.left
      let y = popUpward ? r.top - lh - 6 : r.bottom + 6
      /* v8 ignore next -- jsdom reports offsetWidth as 0; the clamp fires in a real browser. */
      if (lw > 0) x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN)
      /* v8 ignore next -- jsdom reports offsetHeight as 0; the clamp fires in a real browser. */
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), vh - lh - MARGIN)
      setFixedPos({ left: x, top: y })
    }
    place()
    // The panel height tracks its content, which changes on tab switch, a trend
    // expansion, a settings toggle, or a later data arrival. Each such resize
    // must re-clamp the fixed origin, or a taller tab overflows the bottom while
    // a shorter one leaves the panel floating above its anchor.
    const panel = panelRef.current
    const observer = panel !== null && typeof ResizeObserver === 'function'
      ? new ResizeObserver(place)
      : undefined
    /* v8 ignore next -- same null-panel case the guard above already covers. */
    observer?.observe(panel as Element)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, settings.position])

  // Outside-pointer and Escape dismissal. The portaled panel lives outside the
  // trigger subtree in the DOM, so the check spans both refs.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      /* v8 ignore next -- pointerdown targets are always Nodes in practice. */
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target) === true) return
      if (panelRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])

  const aggregate = useMemo(
    () => data.view === null ? null : summarize(data.view.snapshot.models),
    [data.view],
  )
  const chartRounds = useMemo(
    () => data.view === null ? [] : buildRoundSeries(data.view.history),
    [data.view],
  )
  const trend = useMemo(
    () => data.view === null ? [] : filterTrendSeries(buildTrendSeries(data.view.history), data.view.filter),
    [data.view],
  )
  const tone = aggregateTone(aggregate, data.loadState === 'error')
  const checkedLabel = t('panel.aria')
  const pillsVisible = !narrowLabel && aggregate !== null && aggregate.total > 0

  // One trigger for every seat: the three summary pills once any model has
  // probed (`正常2 异常1 耗时910ms`). The status dot only leads when it has
  // something to say on its own — booting, fetch error, no models, or the
  // collapsed rail where there is no room for pills. The plain 模型健康 label
  // is the pre-data fallback and always stays the accessible name.
  const showDot = narrowLabel || !pillsVisible || data.loadState === 'error'
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={fullWidth ? `${css.trigger} ${css.triggerWide}` : css.trigger}
      aria-expanded={open}
      aria-label={t('chip.label')}
      title={t('panel.title')}
      onClick={() => { setOpen(current => !current) }}
    >
      {showDot ? <StateDot state={tone} className={css.triggerDot} /> : null}
      {pillsVisible ? <AggregateChips aggregate={aggregate} t={t} /> : null}
      {!pillsVisible && !narrowLabel ? <span className={css.triggerLabel}>{t('chip.label')}</span> : null}
      <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
    </button>
  )

  /** Arrow-key navigation between the two tabs, with automatic activation on move. */
  const onTablistKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = tab === 'status' ? 'trend' : 'status'
    setTab(next)
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${tabsBaseId}-${next}"]`)?.focus()
  }

  return (
    <div ref={rootRef} className={fullWidth ? `${css.root} ${css.rootFull}` : css.root}>
      {trigger}
      {open
        ? createPortal(
          <div
            ref={panelRef}
            className={css.panel}
            style={fixedPos ?? { visibility: 'hidden', left: 0, top: 0 }}
            role="dialog"
            aria-label={checkedLabel}
          >
            <header className={css.panelHead}>
              <span className={css.panelTitle}>{t('panel.title')}</span>
              <span
              className={css.recency}
              title={data.view?.snapshot.checkedAt === undefined
                ? undefined
                : formatTimestamp(data.view.snapshot.checkedAt)}
            >{recencyLabel(recency(data.view?.snapshot.checkedAt, Date.now()), t)}</span>
              <button
                type="button"
                className={css.iconButton}
                aria-label={data.refreshing ? t('action.refreshing') : t('action.refresh')}
                title={data.refreshing ? t('action.refreshing') : t('action.refresh')}
                disabled={data.refreshing}
                onClick={refresh}
              >
                <IconRefreshOutline14 className={data.refreshing ? css.spin : undefined} />
              </button>
              {settingsOpen
                ? (
                  <button
                    type="button"
                    className={`${css.iconButton} ${css.iconButtonActive}`}
                    aria-label={t('edit.done')}
                    aria-pressed
                    title={t('edit.done')}
                    onClick={() => {
                      syncFilter(filterDraft)
                      setSettingsOpen(false)
                    }}
                  >
                    <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
                      <path
                        d="M2.5 7.5 5.5 10.5 11.5 3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )
                : (
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('action.settings.show')}
                    aria-pressed={false}
                    title={t('action.settings.show')}
                    onClick={() => { setSettingsOpen(current => !current) }}
                  >
                    <IconSettingsOutline14 />
                  </button>
                )}
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('action.close')}
                title={t('action.close')}
                onClick={() => { setOpen(false) }}
              >
                <IconCloseOutline16 size={14} />
              </button>
            </header>
            {settingsOpen
              ? (
                <SettingsBoard
                  settings={settings}
                  setPosition={setPosition}
                  setRefreshSeconds={setRefreshSeconds}
                  t={t}
                />
              )
              : null}
            {data.view === null && data.loadState === 'booting'
              ? <p className={css.emptyNote}>{t('empty.loading')}</p>
              : null}
            {data.view === null && data.loadState === 'error'
              ? (
                <div className={css.emptyNote}>
                  <span>{t('empty.error', { message: data.errorMessage ?? '' })}</span>
                  <button type="button" className={css.retry} onClick={refresh}>{t('action.retry')}</button>
                </div>
              )
              : null}
            {data.view !== null
              ? (
                <>
                  {data.loadState === 'error' && data.errorMessage !== null
                    ? <p className={css.staleNote}>{t('empty.error', { message: data.errorMessage })}</p>
                    : null}
                  <ChartsRow rounds={chartRounds} t={t} />
                  <div className={css.tabs} role="tablist" onKeyDown={onTablistKeyDown}>
                    {(['status', 'trend'] as const).map(option => (
                      <button
                        key={option}
                        type="button"
                        role="tab"
                        id={`${tabsBaseId}-${option}-tab`}
                        aria-selected={tab === option}
                        aria-controls={`${tabsBaseId}-panel`}
                        data-tab-id={`${tabsBaseId}-${option}`}
                        tabIndex={tab === option ? 0 : -1}
                        className={tab === option ? `${css.tab} ${css.tabActive}` : css.tab}
                        onClick={() => { setTab(option) }}
                      >
                        {t(option === 'status' ? 'tab.status' : 'tab.trend')}
                      </button>
                    ))}
                  </div>
                  <div
                    className={css.board}
                    role="tabpanel"
                    id={`${tabsBaseId}-panel`}
                    aria-labelledby={`${tabsBaseId}-${tab}-tab`}
                  >
                    {tab === 'status'
                      ? (
                        settingsOpen
                          ? (
                            <EditableStatusBoard
                              catalog={data.view.catalog ?? []}
                              filter={filterDraft}
                              onChange={setFilterDraft}
                              t={t}
                            />
                          )
                          : <StatusBoard models={data.view.snapshot.models} t={t} />
                      )
                      : <TrendBoard series={trend} t={t} />}
                  </div>
                  {settingsOpen && tab === 'status'
                    ? (
                      <div className={css.editFooter}>
                        <button
                          type="button"
                          className={css.retry}
                          onClick={() => { setSettingsOpen(false) }}
                        >
                          {t('edit.cancel')}
                        </button>
                        <button
                          type="button"
                          className={`${css.retry} ${css.editDone}`}
                          onClick={() => {
                            syncFilter(filterDraft)
                            setSettingsOpen(false)
                          }}
                        >
                          {t('edit.done')}
                        </button>
                      </div>
                    )
                    : null}
                </>
              )
              : null}
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}

/**
 * Sidebar-footer registration seat: reads the column's `wide` flag and keeps
 * the rail form icon-only when it collapses.
 *
 * The host renders footer actions on one non-wrapping flex row, so a chip that
 * wants its own line cannot get one from CSS alone. Rather than patching the
 * host stylesheet, the seat asks its runtime flex container to wrap while
 * mounted — an inline style on the host's footer-actions row — and restores
 * whatever was there when it unmounts. The slot outlet wraps every occupant in
 * a `display: contents` anchor, so the seat's DOM parent is out of layout and
 * must be climbed past to reach the row that actually lays the occupants out.
 * @param props - sidebar seat props, injected face, and locale.
 */
export function ModelHealthFooterAction({
  wide, useHealth, useHealthSettings, refresh, setPosition, setRefreshSeconds, syncFilter, t,
}: ModelHealthFooterActionProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!wide) return
    const container = flexRowOf(rowRef.current)
    /* v8 ignore next -- the slot container always exists around a mounted seat. */
    if (container === null) return
    const previous = container.style.flexWrap
    container.style.flexWrap = 'wrap'
    return () => {
      container.style.flexWrap = previous
    }
  }, [wide])
  return (
    <div ref={rowRef} className={wide ? `${css.footerRow} ${css.footerRowWide}` : css.footerRow}>
      <HealthView
        narrowLabel={!wide}
        fullWidth={wide}
        showStrip={wide}
        useHealth={useHealth}
        useHealthSettings={useHealthSettings}
        refresh={refresh}
        setPosition={setPosition}
        setRefreshSeconds={setRefreshSeconds}
        syncFilter={syncFilter}
        t={t}
      />
    </div>
  )
}

/**
 * The nearest ancestor that generates the footer seat's flex context. The slot
 * outlet anchors every occupant in a `display: contents` element (so the host
 * flex row sees the occupants directly), which has no box of its own — setting
 * `flex-wrap` there would be a silent no-op. Climb past contents-only ancestors
 * to the host's footer-actions row that actually participates in layout.
 * @param root - the seat's root element.
 * @returns the flex row, or `null` before mount.
 */
function flexRowOf(root: HTMLElement | null): HTMLElement | null {
  let node = root?.parentElement ?? null
  while (node !== null && getComputedStyle(node).display === 'contents') {
    node = node.parentElement
  }
  return node
}

/**
 * Conversation-header registration seat: always roomy enough for the full
 * chip, so it renders the default form.
 * @param props - injected face and locale (the header's own props are unused).
 */
export function ModelHealthHeaderAction(props: HealthViewProps) {
  return <HealthView {...props} />
}
