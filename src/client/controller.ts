/**
 * Controller for the model-health status entry: owns the auto-refresh timer
 * and the two snapshot stores the panel reads through inject-bound selector
 * hooks. Every tick re-probes the host (`?refresh=1`) and reloads the returned
 * status JSON; transient failures keep the last good view.
 * @module dsh-model-health
 */

import type { ModelHealthFilter, ModelHealthStatusView } from '../types.ts'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Wire contract shared with the host plugin's default status route. */
export const HEALTH_API_PATH = '/api/model-health'

/** localStorage identity of the persisted display settings. */
export const SETTINGS_PERSIST_KEY = 'dsh.model-health.web'

/** Fetch fn shape (injectable for tests). */
export type FetchImpl = (input: string, init?: {
  headers?: Record<string, string>
  method?: string
  body?: string
}) => Promise<{
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}>

/** Data face the panel renders. */
export interface HealthData {
  /** 'booting' until the first fetch settles; 'error' reports the last fetch failed, still holding any earlier view. */
  loadState: 'booting' | 'ready' | 'error'
  /** Whether a user-pressed re-probe is in flight. */
  refreshing: boolean
  /** The host status view, when one has arrived. */
  view: ModelHealthStatusView | null
  /** Last fetch failure, kept until the next success. */
  errorMessage: string | null
}

/** Where the status chip mounts. */
export type HealthPosition = 'sidebar' | 'header'

/** Persisted display settings. */
export interface HealthSettings {
  position: HealthPosition
  /** Auto-refresh interval in seconds: each tick re-probes then reloads; 0 disables auto-refresh (manual refresh still works). */
  refreshSeconds: number
}

/** Auto-refresh interval pressed from a deterministic point (tests drive it manually). */
export interface HealthControllerDeps {
  readonly fetchImpl?: FetchImpl
  readonly settingsSeed?: Partial<HealthSettings>
}

const DEFAULT_SETTINGS: HealthSettings = { position: 'header', refreshSeconds: 300 }

/** Upper bound (seconds) on an accepted refresh cadence, shared with the settings input. */
export const MAX_REFRESH_SECONDS = 86_400

/** Validate the payload fields just enough to fail a foreign body's JSON loudly. */
function parseStatusView(value: unknown): ModelHealthStatusView {
  if (value === null || typeof value !== 'object') throw new Error('malformed status view')
  const body = value as { snapshot?: unknown; history?: unknown }
  if (body.snapshot === null || typeof body.snapshot !== 'object') throw new Error('malformed status view')
  if (!Array.isArray((body.snapshot as { models?: unknown }).models)) throw new Error('malformed status view')
  if (!Array.isArray(body.history)) throw new Error('malformed status view')
  return value as ModelHealthStatusView
}

/** Built-in fetch against the host status route, tagged for JSON. */
function defaultFetchView(fetchImpl: FetchImpl, refresh: boolean): Promise<ModelHealthStatusView> {
  const url = refresh ? `${HEALTH_API_PATH}?refresh=1` : HEALTH_API_PATH
  return fetchImpl(url, { headers: { accept: 'application/json' } }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return parseStatusView(await response.json())
  })
}

/** Built-in POST of an enabled-filter to the host status route. */
function fetchFilter(fetchImpl: FetchImpl, filter: ModelHealthFilter): Promise<void> {
  return fetchImpl(HEALTH_API_PATH, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      ...filter.disabledProviders && filter.disabledProviders.length > 0
        ? { disabledProviders: filter.disabledProviders }
        : {},
      ...filter.disabledModels && filter.disabledModels.length > 0
        ? { disabledModels: filter.disabledModels }
        : {},
    }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await response.json()
  })
}

/**
 * Auto-refresh driver plus data/settings stores. The apply world constructs one,
 * injects its stores into the slot, and disposes it with the plugin fiber.
 */
export class ModelHealthController {
  /** Refresh-driven data; transient failures keep the last good view. */
  readonly data: SnapshotStore<HealthData>
  /** Display settings, persisted in browser storage. */
  readonly settings: SnapshotStore<HealthSettings>
  private readonly fetchImpl: FetchImpl
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> | undefined
  private disposed = false

  /**
   * @param deps - optional fetch override and settings seed (tests).
   */
  constructor(deps: HealthControllerDeps = {}) {
    // The browser fetch accepts a wider input than FetchImpl requires, so the
    // plain arrow keeps the narrow wire-facing signature.
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.data = createSnapshotStore<HealthData>({
      loadState: 'booting', refreshing: false, view: null, errorMessage: null,
    })
    this.settings = createSnapshotStore<HealthSettings>(
      { ...DEFAULT_SETTINGS, ...deps.settingsSeed },
      { persist: { name: SETTINGS_PERSIST_KEY } },
    )
    this.sanitizePersisted()
  }

  /** Begin the auto-refresh loop: one plain load, then probe+load on the cadence. */
  start(): void {
    if (this.disposed) return
    // The initial read only loads existing data (the host probes once if its
    // own store is still empty), so a page reload does not spend an extra
    // probe round; the periodic ticks below do the collect + load.
    void this.fetch(false)
    this.schedule()
  }

  /** Stop the timer; in-flight fetches finish but cannot reschedule. */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * User-pressed refresh: chain a fresh probe round behind any in-flight
   * fetch, so the press always reaches the host instead of dissolving into a
   * plain refresh. The `refreshing` flag is owned by this settle path alone:
   * a refresh finishing first must not unspin the button while the forced
   * fetch is still queued behind it.
   * @returns the settle promise (no sync throw; failures land in the store).
   */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.data.update((draft) => { draft.refreshing = true })
    const forced = (this.inflight ?? Promise.resolve()).then(() => this.fetch(true))
    // The refreshing flag is owned by this method alone: set at press time and
    // released at settle, so a disposal mid-flight simply witnesses one more
    // write to an already-inert store instead of leaving the flag stuck.
    return forced.finally(() => {
      this.data.update((draft) => { draft.refreshing = false })
    })
  }

  /**
   * Update the mount position; the apply world re-registers the chip.
   * @param position - seat the chip mounts at from now on.
   */
  setPosition(position: HealthPosition): void {
    this.settings.update((draft) => { draft.position = position })
  }

  /**
   * Replace the host's enabled-model selection and refetch so the panel and the
   * next probe round reflect the new coverage. POSTs the filter to the status
   * route, then re-reads the view (the host re-probes immediately).
   * @param filter - the new enabled selection.
   * @returns a settle promise; failures land in the data lane as 'error'.
   */
  syncFilter(filter: ModelHealthFilter): Promise<void> {
    if (this.disposed) return Promise.resolve()
    // POST inside the serialized lane; the follow-up read runs after the lane
    // settles (withInflight clears the inflight handle first), so fetch(false)
    // is a real GET instead of being short-circuited by the still-set handle.
    return this.withInflight(() => fetchFilter(this.fetchImpl, filter))
      .then(() => this.fetch(false))
  }

  /**
   * Run `work` inside the serialized fetch lane, then settle. Used for the
   * filter POST so it cannot interleave with an in-flight refresh.
   * @param work - the POST-then-refetch sequence.
   * @returns the settle promise (no sync throw).
   */
  private withInflight(work: () => Promise<void>): Promise<void> {
    this.data.update((draft) => { draft.refreshing = true })
    const run = (this.inflight ?? Promise.resolve()).then(work).finally(() => {
      this.inflight = undefined
      this.data.update((draft) => { draft.refreshing = false })
    })
    this.inflight = run
    return run
  }

  /**
   * Update the auto-refresh (probe+load) interval (0 = off) and re-arm the timer.
   * @param refreshSeconds - seconds between refreshes; `0` disables the auto-refresh loop.
   */
  setRefreshSeconds(refreshSeconds: number): void {
    this.settings.update((draft) => { draft.refreshSeconds = refreshSeconds })
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    // An in-flight fetch's settle calls schedule() too; the idempotent arm
    // there turns that call into a no-op, so the new interval wins exactly.
    this.schedule()
  }

  /**
   * Arm the next auto-refresh when none is armed. The single-owner rule: at no point
   * may more than one pending timer exist, or an interval change hammers a
   * dual cadence and "refresh off" leaves a straggler fetch behind.
   */
  private schedule(): void {
    if (this.disposed || this.timer !== undefined) return
    const refreshSeconds = this.settings.getSnapshot().refreshSeconds
    if (refreshSeconds <= 0) return
    this.timer = setTimeout(() => {
      // This handle is spent as soon as the callback runs; clear the slot
      // before the fetch so its settle is the sole re-armer.
      this.timer = undefined
      // Auto-refresh = collect + load: each tick forces a fresh probe round
      // (`?refresh=1`) instead of re-reading the last snapshot.
      void this.fetch(true).finally(() => { this.schedule() })
    }, refreshSeconds * 1000)
  }

  private fetch(refresh: boolean): Promise<void> {
    if (this.inflight !== undefined) return this.inflight
    const run = defaultFetchView(this.fetchImpl, refresh)
      .then((view) => {
        // A user press in the meantime keeps its flag: refreshing belongs to
        // refresh(), so a plain refresh settling writes the view, not the spin.
        this.data.set({
          loadState: 'ready',
          refreshing: this.data.getSnapshot().refreshing,
          view,
          errorMessage: null,
        })
      })
      .catch((error: unknown) => {
        // A failed fetch flips the lane to 'error' either way: with no view it
        // renders the retry note; with one it keeps the rows and marks them
        // stale, so a transient failure is never invisible.
        this.data.update((draft) => {
          draft.loadState = 'error'
          draft.errorMessage = error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        // Runs are strictly serial: a new fetch starts only after the previous
        // settle cleared the slot (the disconnected-chained refresh attaches
        // below), so the plain clear can not sever a later run.
        this.inflight = undefined
      })
    this.inflight = run
    return run
  }

  /**
   * localStorage is a durable boundary: a stale shape (a renamed field, a
   * hand-edited value) is discarded in favor of the defaults instead of
   * arming `setTimeout(NaN)` or landing the chip on a seat the user never
   * chose.
   */
  private sanitizePersisted(): void {
    const snapshot = this.settings.getSnapshot()
    const seats: readonly string[] = ['sidebar', 'header']
    const positionValid = seats.includes(snapshot.position)
    const refreshValid = Number.isInteger(snapshot.refreshSeconds)
      && snapshot.refreshSeconds >= 0
      && snapshot.refreshSeconds <= MAX_REFRESH_SECONDS
    if (positionValid && refreshValid) return
    this.settings.update((draft) => {
      if (!positionValid) draft.position = DEFAULT_SETTINGS.position
      if (!refreshValid) draft.refreshSeconds = DEFAULT_SETTINGS.refreshSeconds
    })
  }
}
