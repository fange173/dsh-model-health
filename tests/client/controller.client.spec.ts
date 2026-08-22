// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelHealthStatusView } from 'dsh-model-health'
import {
  HEALTH_API_PATH,
  ModelHealthController,
  type FetchImpl,
  type HealthControllerDeps,
  type HealthSettings,
} from '../../src/client/controller.ts'

function view(modelCount = 1): ModelHealthStatusView {
  const models = Array.from({ length: modelCount }, (_, index) => ({
    provider: 'p', model: `m${index}`, name: `m${index}`, checkedAt: 't', ok: true,
  }))
  return {
    config: { intervalSeconds: 300, historyLimit: 40 },
    snapshot: {
      checkedAt: '2026-01-01T00:00:00.000Z',
      models,
    },
    history: [],
    catalog: models.map(model => ({ provider: model.provider, model: model.model, name: model.name, enabled: true })),
    filter: {},
  }
}

function fetchOk(): { impl: FetchImpl; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    impl: (url) => {
      calls.push(url)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(view()) })
    },
  }
}

let controllers: ModelHealthController[] = []

afterEach(() => {
  for (const controller of controllers) controller.dispose()
  controllers = []
  vi.useRealTimers()
})

function makeController(deps: HealthControllerDeps): ModelHealthController {
  const controller = new ModelHealthController(deps)
  controllers.push(controller)
  return controller
}

describe('ModelHealthController', () => {
  it('serves a successful fetch into a ready state', async () => {
    const { impl } = fetchOk()
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    controller.start()
    await vi.waitFor(() => { expect(controller.data.getSnapshot().loadState).toBe('ready') })
    expect(controller.data.getSnapshot().view?.snapshot.models).toHaveLength(1)
    expect(controller.data.getSnapshot().errorMessage).toBeNull()
    controller.dispose()
  })

  it('keeps the last good view and records the error on failure', async () => {
    let fail = false
    const impl: FetchImpl = () => fail
      ? Promise.reject(new Error('down'))
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(view()) })
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    await controller.refresh()
    expect(controller.data.getSnapshot().loadState).toBe('ready')

    fail = true
    await controller.refresh()
    const state = controller.data.getSnapshot()
    expect(state.loadState).toBe('error')
    expect(state.view).not.toBeNull()
    expect(state.errorMessage).toBe('down')
  })

  it('lands in an error state when the first fetch fails and no view exists', async () => {
    const impl: FetchImpl = () => Promise.reject(new Error('no route'))
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    controller.start()
    await vi.waitFor(() => { expect(controller.data.getSnapshot().loadState).toBe('error') })
    expect(controller.data.getSnapshot().view).toBeNull()
    expect(controller.data.getSnapshot().errorMessage).toBe('no route')
  })

  it('surfaces HTTP errors and malformed payloads as fetch failures', async () => {
    const badStatus: FetchImpl = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    const malformed: FetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ nope: 1 }) })
    const c1 = makeController({ fetchImpl: badStatus, settingsSeed: { refreshSeconds: 0 } })
    await c1.refresh()
    expect(c1.data.getSnapshot().errorMessage).toBe('HTTP 404')
    const c2 = makeController({ fetchImpl: malformed, settingsSeed: { refreshSeconds: 0 } })
    await c2.refresh()
    expect(c2.data.getSnapshot().errorMessage).toBe('malformed status view')
  })

  it('issues ?refresh=1 for an explicit refresh and the plain path when disabled', async () => {
    const { impl, calls } = fetchOk()
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    controller.start()
    await vi.waitFor(() => { expect(controller.data.getSnapshot().loadState).toBe('ready') })
    await controller.refresh()
    expect(calls).toEqual([HEALTH_API_PATH, `${HEALTH_API_PATH}?refresh=1`])
  })

  it('fails a stalled explicit refresh back to a clean refreshing flag', async () => {
    const impl: FetchImpl = () => Promise.reject(new Error('boom'))
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    await controller.refresh()
    expect(controller.data.getSnapshot().refreshing).toBe(false)
  })

  it('auto-refreshes on the configured interval and stops when disabled or disposed', async () => {
    const { impl, calls } = fetchOk()
    vi.useFakeTimers()
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 5 } })
    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls.length).toBeGreaterThanOrEqual(3)
    controller.setRefreshSeconds(0)
    const settled = calls.length
    await vi.advanceTimersByTimeAsync(20_000)
    expect(calls).toHaveLength(settled)
  })

  it('refetches the view after syncing the filter, so the panel updates without a reload', async () => {
    const { impl, calls } = fetchOk()
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    await controller.syncFilter({ disabledModels: ['p/m0'] })
    // POST applies the filter, then a plain GET re-reads the fresh view.
    expect(calls).toEqual([HEALTH_API_PATH, HEALTH_API_PATH])
  })

  it('re-probes on each auto-refresh tick when the interval is on', async () => {
    const { impl, calls } = fetchOk()
    vi.useFakeTimers()
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 30 } })
    controller.start()
    await vi.advanceTimersByTimeAsync(0)
    // Bootstrap is a plain read (no probe); the tick that follows probes.
    expect(calls).toEqual([HEALTH_API_PATH])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(calls).toEqual([HEALTH_API_PATH, `${HEALTH_API_PATH}?refresh=1`])
    controller.dispose()
  })

  it('persists position and refresh updates onto the settings store', async () => {
    const { impl } = fetchOk()
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    controller.setPosition('header')
    controller.setRefreshSeconds(30)
    expect(controller.settings.getSnapshot()).toMatchObject({ position: 'header', refreshSeconds: 30 })
  })

  it('keeps exactly one timer when the interval changes mid-flight', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    let hanging = true
    const impl: FetchImpl = () => hanging
      ? new Promise((resolve) => {
        release = () => { resolve({ ok: true, status: 200, json: () => Promise.resolve(view()) }) }
      })
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(view()) })
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 5 } })
    controller.start()
    await vi.advanceTimersByTimeAsync(0) // first fetch hangs
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(5000) // tick coalesces into the hanging fetch
    // No timer while the fetch hangs: the interval counts from fetch completion.
    expect(vi.getTimerCount()).toBe(0)
    controller.setRefreshSeconds(10) // mid-flight interval change arms the new cadence
    expect(vi.getTimerCount()).toBe(1)
    hanging = false
    release?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1) // the coalesced chain's re-arm sees the new timer and skips
    await vi.advanceTimersByTimeAsync(10_000)
    expect(vi.getTimerCount()).toBe(1) // still exactly one armed cadence afterward
  })

  it('keeps refreshing asserted until the queued forced fetch settles, not until the refresh', async () => {
    const gates: Array<() => void> = []
    const impl: FetchImpl = url => new Promise((resolve) => {
      gates.push(() => { resolve({ ok: true, status: 200, json: () => Promise.resolve(view()) }) })
      void url
    })
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    controller.start()
    // The first fetch from start() is in flight while the user presses refresh.
    const settle = controller.refresh()
    expect(controller.data.getSnapshot().refreshing).toBe(true)
    expect(gates).toHaveLength(1)
    // The refresh resolving first must not release the button — the forced probe is still queued.
    gates[0]?.()
    await vi.waitFor(() => { expect(gates).toHaveLength(2) }) // forced fetch started
    expect(controller.data.getSnapshot().refreshing).toBe(true)
    gates[1]?.()
    await settle
    expect(controller.data.getSnapshot().refreshing).toBe(false)
    expect(controller.data.getSnapshot().loadState).toBe('ready')
  })

  it('is a no-op when refreshed after disposal', async () => {
    const { impl, calls } = fetchOk()
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    await controller.refresh()
    controller.dispose()
    await controller.refresh()
    expect(calls).toHaveLength(1)
    expect(controller.data.getSnapshot().refreshing).toBe(false)
  })

  it.each([
    ['null', null, 'malformed status view'],
    ['a string', 'garbage', 'malformed status view'],
    ['a plain object with no snapshot', { history: [] }, 'malformed status view'],
    ['a null snapshot', { snapshot: null, history: [] }, 'malformed status view'],
    ['a non-array model list', { snapshot: { models: 'no' }, history: [] }, 'malformed status view'],
    ['a non-array history', { snapshot: { models: [] }, history: 'no' }, 'malformed status view'],
  ])('rejects %s payloads as malformed', async (_label, body, message) => {
    const impl: FetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    await controller.refresh()
    expect(controller.data.getSnapshot().errorMessage).toBe(message)
    expect(controller.data.getSnapshot().view).toBeNull()
  })

  it('resets malformed persisted settings back to defaults', () => {
    // localStorage is a durable boundary: a stale shape is discarded, as it
    // would otherwise arm setTimeout(NaN) or mount the chip on a seat the
    // user never chose. The cast models exactly that damaged payload.
    const damaged = { position: 'tray', refreshSeconds: Number.NaN } as unknown as Partial<HealthSettings>
    const controller = makeController({ settingsSeed: damaged })
    expect(controller.settings.getSnapshot()).toEqual({ position: 'header', refreshSeconds: 300 })
  })

  it('uses the platform fetch with the JSON accept header when none is injected', async () => {
    const received: string[] = []
    vi.stubGlobal('fetch', (input: string, init?: { headers?: Record<string, string> }) => {
      received.push(`${input}|${init?.headers?.accept ?? ''}`)
      return Promise.resolve(new Response(JSON.stringify(view()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    })
    const controller = makeController({ settingsSeed: { refreshSeconds: 0 } })
    await controller.refresh()
    expect(received).toEqual([`${HEALTH_API_PATH}?refresh=1|application/json`])
    expect(controller.data.getSnapshot().loadState).toBe('ready')
    vi.unstubAllGlobals()
  })

  it('does nothing when start() runs after disposal', () => {
    vi.useFakeTimers()
    const { impl, calls } = fetchOk()
    const controller = makeController({ fetchImpl: impl })
    controller.dispose()
    controller.start()
    expect(calls).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forces a fresh check even without a auto-refresh loop running first', async () => {
    const { impl, calls } = fetchOk()
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    await controller.refresh()
    expect(calls).toEqual([`${HEALTH_API_PATH}?refresh=1`])
    expect(controller.data.getSnapshot().refreshing).toBe(false)
    expect(controller.data.getSnapshot().loadState).toBe('ready')
  })

  it('ignores a refresh pressed after disposal', async () => {
    const { impl, calls } = fetchOk()
    const controller = makeController({ fetchImpl: impl })
    controller.dispose()
    await controller.refresh()
    expect(calls).toHaveLength(0)
    expect(controller.data.getSnapshot().refreshing).toBe(false)
  })

  it('chains a forced check behind an in-flight refresh without clobbering it', async () => {
    let releaseFirst!: () => void
    const calls: string[] = []
    const impl: FetchImpl = (url) => {
      calls.push(url)
      if (calls.length === 1) {
        return new Promise((_resolve, reject) => { releaseFirst = () => { reject(new Error('gone')) } })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(view()) })
    }
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    controller.start()
    // The refresh still hangs: the press chains behind it rather than replacing it.
    const pressed = controller.refresh()
    releaseFirst()
    await pressed
    expect(calls).toEqual([HEALTH_API_PATH, `${HEALTH_API_PATH}?refresh=1`])
    expect(controller.data.getSnapshot()).toMatchObject({ loadState: 'ready', refreshing: false })
    controller.dispose()
  })

  it('keeps a valid persisted refresh cadence when only the seat is damaged', () => {
    const damaged = { position: 'tray', refreshSeconds: 60 } as unknown as Partial<HealthSettings>
    const controller = makeController({ settingsSeed: damaged })
    expect(controller.settings.getSnapshot()).toEqual({ position: 'header', refreshSeconds: 60 })
  })

  it('keeps a valid persisted seat when only the cadence is damaged', () => {
    const damaged = { position: 'sidebar', refreshSeconds: -3 } as unknown as Partial<HealthSettings>
    const controller = makeController({ settingsSeed: damaged })
    expect(controller.settings.getSnapshot()).toEqual({ position: 'sidebar', refreshSeconds: 300 })
  })

  it('rejects a persisted cadence past the accepted bound', () => {
    const damaged = { position: 'header', refreshSeconds: 99_999 } as unknown as Partial<HealthSettings>
    const controller = makeController({ settingsSeed: damaged })
    expect(controller.settings.getSnapshot().refreshSeconds).toBe(300)
  })

  it('renders a non-Error fetch rejection verbatim', async () => {
    // oxlint-disable-next-line prefer-promise-reject-errors -- the test drives the verbatim non-Error message contract.
    const impl: FetchImpl = () => Promise.reject('route went away')
    const controller = makeController({ fetchImpl: impl, settingsSeed: { refreshSeconds: 0 } })
    await controller.refresh()
    expect(controller.data.getSnapshot().errorMessage).toBe('route went away')
    expect(controller.data.getSnapshot().loadState).toBe('error')
  })
})
