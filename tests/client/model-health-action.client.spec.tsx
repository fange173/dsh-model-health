// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelCheckResult, ModelHealthRound, ModelHealthStatusView } from 'dsh-model-health'
import {
  ModelHealthFooterAction,
  ModelHealthHeaderAction,
} from '../../src/client/ModelHealthAction.tsx'
import type { HealthData, HealthSettings } from '../../src/client/controller.ts'
import { PROBE_TIMEOUT_CODE, TREND_DOT_CAP } from '../../src/client/view.ts'
import { zh } from '../../src/client/locales.ts'

const START = Date.parse('2026-08-21T03:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = makeTranslate(zh)

function result(provider: string, model: string, overrides: Partial<ModelCheckResult> = {}): ModelCheckResult {
  return { provider, model, name: model.toUpperCase(), checkedAt: '2026-08-21T03:00:00.000Z', ok: true, ...overrides }
}

function statusView(options: {
  models?: ModelCheckResult[]
  historyAt?: number
  checkedAt?: string
  history?: ModelHealthRound[]
} = {}): ModelHealthStatusView {
  const models = options.models ?? [
    result('deepseek', 'deepseek-chat', { totalMs: 320, ttftMs: 110 }),
    result('deepseek', 'deepseek-reasoner', { totalMs: 1500 }),
    result('q', 'qwen', { ok: false, error: { code: 'AUTH', message: 'denied', status: 401 } }),
  ]
  return {
    config: { intervalSeconds: 300, historyLimit: 40 },
    snapshot: {
      checkedAt: options.checkedAt ?? '2026-08-21T03:00:00.000Z',
      models,
    },
    history: options.history ?? [
      {
        checkedAt: options.checkedAt ?? '2026-08-21T03:00:00.000Z',
        models,
      },
    ],
    catalog: models.map(model => ({ provider: model.provider, model: model.model, name: model.name, enabled: true })),
    filter: {},
  }
}

interface Wiring {
  readonly data: SnapshotStore<HealthData>
  readonly settings: SnapshotStore<HealthSettings>
  readonly refresh: ReturnType<typeof vi.fn>
  readonly setPosition: ReturnType<typeof vi.fn>
  readonly setRefreshSeconds: ReturnType<typeof vi.fn>
  readonly syncFilter: ReturnType<typeof vi.fn>
}

function wiring(seedData: Partial<HealthData> = {}, seedSettings: Partial<HealthSettings> = {}): Wiring {
  const data = createSnapshotStore<HealthData>({
    loadState: 'ready', refreshing: false, view: statusView(), errorMessage: null, ...seedData,
  })
  const settings = createSnapshotStore<HealthSettings>({ position: 'header', refreshSeconds: 30, ...seedSettings })
  return {
    data,
    settings,
    refresh: vi.fn(),
    setPosition: vi.fn(),
    setRefreshSeconds: vi.fn(),
    syncFilter: vi.fn(),
  }
}

function wiredProps(state: Wiring) {
  return {
    useHealth: bindSnapshotSelector(state.data),
    useHealthSettings: bindSnapshotSelector(state.settings),
    refresh: state.refresh,
    setPosition: state.setPosition,
    setRefreshSeconds: state.setRefreshSeconds,
    syncFilter: state.syncFilter,
    t,
  } as unknown as Parameters<typeof ModelHealthHeaderAction>[0]
}

function mutate(store: SnapshotStore<HealthData>, next: Partial<HealthData>): void {
  act(() => { store.update((draft) => { Object.assign(draft, next) }) })
}

function open(): void {
  fireEvent.click(screen.getByRole('button', { name: zh['chip.label'] }))
}

describe('status chip trigger', () => {
  it('shows the three summary pills once data arrives and stays quiet before', () => {
    const state = wiring()
    const first = render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    expect(screen.getByText('正常2')).toBeTruthy()
    expect(screen.getByText('异常1')).toBeTruthy()
    expect(screen.getByText('耗时910ms')).toBeTruthy()
    first.unmount()

    const booting = wiring({ view: null, loadState: 'booting' })
    render(<ModelHealthHeaderAction {...wiredProps(booting)} />)
    expect(screen.getByText(zh['chip.label'])).toBeTruthy()
    expect(screen.queryByText(/\/3/)).toBeNull()
  })

  it('adapts to the collapsed sidebar rail when wide is false', () => {
    const footerProps = (state: Wiring, wide: boolean) => ({
      wide,
      useSessions: (() => undefined) as never,
      useWorkspaces: (() => undefined) as never,
      ...wiredProps(state),
    })

    render(<ModelHealthFooterAction {...footerProps(wiring(), false)} />)
    expect(screen.queryByText(zh['chip.label'])).toBeNull()
    expect(screen.queryByText(/\d\/3/)).toBeNull()
    // Collapsed rail: no summary pills either — there is no room.
    expect(screen.queryByText(/正常/)).toBeNull()

    cleanup()
    const wide = wiring()
    render(<ModelHealthFooterAction {...footerProps(wide, true)} />)
    // The wide row drops the recomputed label+count as redundant with the
    // pills — `正常2` already carries the healthy count.
    expect(screen.queryByText(zh['chip.label'])).toBeNull()
    expect(screen.queryByText('2/3')).toBeNull()
    // ...and instead shows just the three summary pills.
    expect(screen.getByText('正常2')).toBeTruthy()
    expect(screen.getByText('异常1')).toBeTruthy()
    expect(screen.getByText('耗时910ms')).toBeTruthy()
  })

  it('renders only the three summary pills in the wide row and opens the panel on click', () => {
    const footerProps = (state: Wiring, wide: boolean) => ({
      wide,
      useSessions: (() => undefined) as never,
      useWorkspaces: (() => undefined) as never,
      ...wiredProps(state),
    })
    const empty = wiring({ view: statusView({ models: [] }) })
    render(<ModelHealthFooterAction {...footerProps(empty, true)} />)
    // No models probed yet: still an accessible button, but no pills.
    expect(screen.getByRole('button', { name: zh['chip.label'] })).toBeTruthy()
    expect(screen.queryByText(/正常/)).toBeNull()
    cleanup()

    const populated = wiring()
    render(<ModelHealthFooterAction {...footerProps(populated, true)} />)
    expect(screen.getByText('正常2')).toBeTruthy()
    expect(screen.getByText('异常1')).toBeTruthy()
    expect(screen.getByText('耗时910ms')).toBeTruthy()
    // Single row of pills — no per-model list.
    expect(screen.queryByRole('list')).toBeNull()

    // Clicking the row (the whole pill button) opens the detail panel.
    fireEvent.click(screen.getByRole('button', { name: zh['chip.label'] }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('wraps the host footer row by climbing past the display:contents slot anchor', () => {
    // Host's footer-actions row (the flex container) and the slot outlet's
    // display:contents anchor between it and the seat's root.
    const row = document.createElement('div')
    const anchor = document.createElement('div')
    anchor.style.display = 'contents'
    row.appendChild(anchor)
    document.body.appendChild(row)

    const state = wiring()
    const { unmount } = render(
      <ModelHealthFooterAction
        wide
        useSessions={(() => undefined) as never}
        useWorkspaces={(() => undefined) as never}
        {...wiredProps(state)}
      />,
      { container: anchor },
    )
    expect(row.style.flexWrap).toBe('wrap')

    unmount()
    expect(row.style.flexWrap).toBe('')
    document.body.removeChild(row)
  })
})

describe('status panel', () => {
  it('groups models by provider with latency and failure detail', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    const panel = screen.getByRole('dialog', { name: zh['panel.aria'] })
    expect(within(panel).getByText('deepseek')).toBeTruthy()
    expect(within(panel).getByText(zhcopy('provider.count', { count: 2 }))).toBeTruthy()
    expect(within(panel).getByText('DEEPSEEK-CHAT')).toBeTruthy()
    expect(within(panel).getByText('320ms')).toBeTruthy()
    expect(within(panel).getByText('1.5s')).toBeTruthy()
    expect(within(panel).getByText('AUTH')).toBeTruthy()
  })

  it('shows the recency of the last answered round', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    expect(screen.getByText(zh['recency.justNow'])).toBeTruthy()
    mutate(state.data, { view: statusView({ checkedAt: '2026-08-21T02:48:00.000Z' }) })
    expect(screen.getByText(zhcopy('recency.minutes', { minutes: 12 }))).toBeTruthy()
    mutate(state.data, { view: null, loadState: 'error', errorMessage: 'down' })
    expect(screen.getByText(zh['recency.none'])).toBeTruthy()
  })

  it('covers loading and error containers with a retry action', () => {
    const loading = wiring({ view: null, loadState: 'booting' })
    render(<ModelHealthHeaderAction {...wiredProps(loading)} />)
    open()
    expect(screen.getByText(zh['empty.loading'])).toBeTruthy()

    cleanup()
    const failing = wiring({ view: null, loadState: 'error', errorMessage: 'no route' })
    render(<ModelHealthHeaderAction {...wiredProps(failing)} />)
    open()
    expect(screen.getByText(zhcopy('empty.error', { message: 'no route' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['action.retry'] }))
    expect(failing.refresh).toHaveBeenCalledOnce()
  })

  it('marks a stale view with the failure note and keeps the rows', () => {
    const state = wiring({ loadState: 'error', errorMessage: 'timed out' })
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    expect(screen.getByText(zhcopy('empty.error', { message: 'timed out' }))).toBeTruthy()
    expect(screen.getByText('DEEPSEEK-CHAT')).toBeTruthy()
  })

  it('closes on Escape and returns focus to the trigger', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    const trigger = screen.getByRole('button', { name: zh['chip.label'] })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes when the pointer presses outside the popover', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Pressing inside the portaled panel itself must not close it.
    open()
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).toBeTruthy()
    // Pressing inside the trigger itself must not close it either (panel still open).
    fireEvent.pointerDown(screen.getByRole('button', { name: zh['chip.label'] }))
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })

  it('mounts on the conversation-header axis when the settings pick it', () => {
    const state = wiring({}, { position: 'header' })
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    expect(screen.getByRole('dialog')).toBeTruthy()
    // The status board stays the same content regardless of axis.
    expect(screen.getByText('DEEPSEEK-CHAT')).toBeTruthy()
  })

  it('mounts on the sidebar axis and opens the panel upward', () => {
    const state = wiring({}, { position: 'sidebar' })
    const footerProps = {
      wide: true,
      useSessions: (() => undefined) as never,
      useWorkspaces: (() => undefined) as never,
      ...wiredProps(state),
    }
    render(<ModelHealthFooterAction {...footerProps} />)
    open()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes through the header X button', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: zh['action.close'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the failure note even when the fetch carried no message', () => {
    const state = wiring({ view: null, loadState: 'error', errorMessage: null })
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    expect(screen.getByText(zhcopy('empty.error', { message: '' }))).toBeTruthy()
  })

  it('renders a failing model that carries no error detail at all', () => {
    // The wire keeps rows whose round failed with no adapter facts; the row
    // must degrade to stable fallback strings rather than crash the panel.
    const bareFail: ModelCheckResult = {
      provider: 'x', model: 'x-1', name: 'X-1', checkedAt: '2026-08-21T03:00:00.000Z', ok: false,
    }
    const state = wiring({
      view: statusView({ models: [bareFail] }),
    })
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    expect(screen.getByText('unknown')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh['tab.trend'] }))
    expect(screen.getByLabelText(zhcopy('history.title', {
      checkedAt: '2026-08-21T03:00:00.000Z', status: zhcopy('history.failed', { code: 'unknown' }),
    }))).toBeTruthy()
  })
})

describe('refresh control', () => {
  it('forwards the press to the injected refresh', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: zh['action.refresh'] }))
    expect(state.refresh).toHaveBeenCalledOnce()
  })

  it('disables the press and reads as refreshing while a forced round flies', () => {
    const state = wiring({ refreshing: true })
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    const button = screen.getByRole('button', { name: zh['action.refreshing'] })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('trend tab', () => {
  const history = (points: Array<{ ok: boolean; code?: string }>, latency = 200): ModelHealthStatusView => ({
    config: { intervalSeconds: 300, historyLimit: 40 },
    snapshot: { checkedAt: '2026-08-21T03:00:00.000Z', models: [result('deepseek', 'deepseek-chat', { totalMs: latency })] },
    history: points.map((point, index) => ({
      checkedAt: `2026-08-21T02:${String(index).padStart(2, '0')}:00.000Z`,
      models: [
        point.ok
          ? result('deepseek', 'deepseek-chat', { totalMs: latency })
          : result('deepseek', 'deepseek-chat', { ok: false, error: { code: point.code ?? 'AUTH', message: 'x' } }),
      ],
    })),
    catalog: [{ provider: 'deepseek', model: 'deepseek-chat', name: 'DEEPSEEK-CHAT', enabled: true }],
    filter: {},
  })

  it('renders per-round dots with timeout tones and rate math over the full window', () => {
    const state = wiring({
      view: history([
        { ok: true },
        { ok: false, code: PROBE_TIMEOUT_CODE },
        { ok: false },
      ]),
    })
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    fireEvent.click(screen.getByRole('tab', { name: zh['tab.trend'] }))
    expect(screen.getByText(zhcopy('trend.legend', { count: 3 }))).toBeTruthy()
    expect(screen.getByLabelText(zhcopy('history.title', {
      checkedAt: '2026-08-21T02:00:00.000Z', status: `${zh['history.ok']} 200ms`,
    }))).toBeTruthy()
    expect(screen.getByLabelText(zhcopy('history.title', {
      checkedAt: '2026-08-21T02:01:00.000Z', status: zh['history.timeout'],
    }))).toBeTruthy()
    expect(screen.getByLabelText(zhcopy('history.title', {
      checkedAt: '2026-08-21T02:02:00.000Z', status: zhcopy('history.failed', { code: 'AUTH' }),
    }))).toBeTruthy()
    expect(screen.getByText(new RegExp(String.raw`${zhcopy('trend.okRate', { percent: 33 })}.*200ms`))).toBeTruthy()
  })

  it('shows a toggle when history exceeds the cap and expands on click', () => {
    const dots = Array.from({ length: TREND_DOT_CAP + 4 }, () => ({ ok: true }))
    const capped = wiring({ view: history(dots) })
    render(<ModelHealthHeaderAction {...wiredProps(capped)} />)
    open()
    fireEvent.click(screen.getByRole('tab', { name: zh['tab.trend'] }))
    // The legend describes the display cap, not the retained full window.
    expect(screen.getByText(zhcopy('trend.legend', { count: TREND_DOT_CAP }))).toBeTruthy()
    // Collapsed: the toggle offers to show more, without a total count.
    expect(screen.getByText(zh['trend.more'])).toBeTruthy()
    const toggle = screen.getByRole('button', { name: zh['trend.expand'] })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Expand: the toggle now offers to collapse, a summary line leads the detail.
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: zh['trend.collapse'] }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(zhcopy('trend.summary', {
      count: TREND_DOT_CAP + 4, avg: '200ms', percent: 100,
    }))).toBeTruthy()
    // Collapse back.
    fireEvent.click(screen.getByRole('button', { name: zh['trend.collapse'] }))
    expect(screen.getByText(zh['trend.more'])).toBeTruthy()
  })

  it('hides the toggle when history fits the cap', () => {
    const dots = Array.from({ length: TREND_DOT_CAP }, () => ({ ok: true }))
    const view = wiring({ view: history(dots) })
    render(<ModelHealthHeaderAction {...wiredProps(view)} />)
    open()
    fireEvent.click(screen.getByRole('tab', { name: zh['tab.trend'] }))
    expect(screen.queryByRole('button', { name: zh['trend.collapse'] })).toBeNull()
  })

  it('tells empty history apart from capped', () => {
    const empty = wiring({ view: statusView({ models: [], history: [] }) })
    render(<ModelHealthHeaderAction {...wiredProps(empty)} />)
    open()
    expect(screen.getByText(zh['summary.none'])).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: zh['tab.trend'] }))
    expect(screen.getByText(zh['trend.empty'])).toBeTruthy()
  })

  it('hides models disabled in the filter from the trend tab', () => {
    const models = [result('deepseek', 'deepseek-chat'), result('q', 'qwen')]
    const state = wiring({ view: { ...statusView({ models }), filter: { disabledModels: ['q/qwen'] } } })
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    fireEvent.click(screen.getByRole('tab', { name: zh['tab.trend'] }))
    expect(screen.getByText('DEEPSEEK-CHAT')).toBeTruthy()
    expect(screen.queryByText('QWEN')).toBeNull()
  })
})

describe('settings board', () => {
  it('switches seats and refresh cadence through the injected callbacks', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: zh['action.settings.show'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['settings.position.header'] }))
    expect(state.setPosition).toHaveBeenCalledWith('header')
    fireEvent.click(screen.getByRole('button', { name: zh['settings.refresh.off'] }))
    expect(state.setRefreshSeconds).toHaveBeenCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: zhcopy('settings.refresh.seconds', { seconds: 30 }) }))
    expect(state.setRefreshSeconds).toHaveBeenCalledWith(30)
  })

  it('commits a hand-typed custom refresh cadence on blur', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: zh['action.settings.show'] }))
    const input = screen.getByRole('spinbutton', { name: zh['settings.refresh.custom'] })
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.blur(input)
    expect(state.setRefreshSeconds).toHaveBeenCalledWith(90)
  })

  it('reverts an invalid custom cadence instead of committing it', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: zh['action.settings.show'] }))
    const input = screen.getByRole('spinbutton', { name: zh['settings.refresh.custom'] })
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(state.setRefreshSeconds).not.toHaveBeenCalled()
  })
})

describe('tab keyboard navigation', () => {
  it('ignores non-arrow keys on the tab strip', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    const statusTab = screen.getByRole('tab', { name: zh['tab.status'] })
    statusTab.focus()
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Enter' })
    expect(document.activeElement).toBe(statusTab)
    expect(statusTab.getAttribute('aria-selected')).toBe('true')
  })

  it('cycles tabs with the arrow keys and moves focus', () => {
    const state = wiring()
    render(<ModelHealthHeaderAction {...wiredProps(state)} />)
    open()
    const statusTab = screen.getByRole('tab', { name: zh['tab.status'] })
    statusTab.focus()
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    const trendTab = screen.getByRole('tab', { name: zh['tab.trend'] })
    expect(document.activeElement).toBe(trendTab)
    expect(trendTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(statusTab)
    expect(statusTab.getAttribute('aria-selected')).toBe('true')
  })
})

/** Render one locale template with params, matching what the shell translator would produce. */
function zhcopy(key: keyof typeof zh, params: Record<string, unknown>): string {
  return t(key, params)
}
