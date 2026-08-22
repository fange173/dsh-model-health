/**
 * Disposable periodic probe driver. Coalesces overlapping rounds, re-arms a
 * bounded timer for the next interval, and reconciles the store to the current
 * topology after each round. A cheap enumeration-only watch sweeps the provider
 * catalog on a fast cadence so a newly registered model is probed within
 * seconds instead of waiting out the full probe interval — adding a model to an
 * existing provider publishes no `llm/adapters-updated` event, so without the
 * watch the new model would stay invisible for up to `intervalMs`.
 * @module dsh-model-health
 */

import type { Context } from '@deepseek-ai/cordis'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { filterTargets } from './filter.ts'
import { listProbeTargets, probeModel, runWithConcurrency } from './probe.ts'
import type { ProbeOptions } from './probe.ts'
import { ModelHealthStore, modelKey } from './store.ts'
import type { ModelCheckResult, ModelHealthFilter } from './types.ts'

/** Default cadence of the enumeration-only topology sweep. */
export const DEFAULT_WATCH_MS = 15_000

/** Delay between a deferred credential-pending round and its prompt re-probe. */
export const DEFAULT_CREDENTIAL_RETRY_DELAY_MS = 3_000

/** Deferrals a model may accumulate before its credential-pending failure is recorded for real. */
export const DEFAULT_CREDENTIAL_RETRY_LIMIT = 3

/**
 * Probe failure codes that read as "credentials not ready yet" rather than a
 * definitive failure. At startup the credential seam loads asynchronously, so a
 * probe that runs first can fail MISSING_CREDENTIAL and self-heal a moment
 * later; the monitor re-probes those instead of stamping a spurious error.
 */
export const CREDENTIAL_PENDING_CODES: ReadonlySet<string> = new Set(['MISSING_CREDENTIAL'])

/** Construction facts for one monitor. */
export interface ModelHealthMonitorOptions extends ProbeOptions {
  readonly ctx: Context
  readonly store: ModelHealthStore
  readonly intervalMs: number
  readonly concurrency: number
  /** Provider whitelist; empty means all providers. */
  readonly providers: readonly string[] | undefined
  /** Model whitelist (`provider/model`); empty means all models within the provider filter. */
  readonly models: readonly string[] | undefined
  /**
   * Cadence of the enumeration-only catalog sweep in milliseconds; a changed
   * model set triggers a prompt full round. `0` disables the sweep. Defaults
   * to {@link DEFAULT_WATCH_MS}.
   */
  watchMs?: number
  /** Initial enabled-model selection. */
  filter?: ModelHealthFilter
  /**
   * Delay between a deferred credential-pending round and its prompt re-probe.
   * Defaults to {@link DEFAULT_CREDENTIAL_RETRY_DELAY_MS}.
   */
  credentialRetryDelayMs?: number
  /**
   * Deferrals a model may accumulate before a credential-pending failure is
   * recorded for real; `0` disables the retry. Defaults to
   * {@link DEFAULT_CREDENTIAL_RETRY_LIMIT}.
   */
  credentialRetryLimit?: number
  /**
   * Optional side-effect after a round settles and after a filter change;
   * used to persist history and the selection. Never awaited.
   */
  onSnapshot?: (store: ModelHealthStore) => void
}

/** One process-local owner of the periodic probe loop. */
export class ModelHealthMonitor {
  private timer: ReturnType<typeof setTimeout> | undefined
  private watchTimer: ReturnType<typeof setTimeout> | undefined
  private credentialTimer: ReturnType<typeof setTimeout> | undefined
  private currentRun: Promise<void> | undefined
  /** A trigger landed while a round was in flight; one follow-up is owed. */
  private pendingRound = false
  private disposed = false
  /** Keys that have answered healthily at least once this process; missing-key failures below are transient-at-boot. */
  private succeeded = new Set<string>()
  /** Credential-pending deferrals already spent per key, bounding the retry loop. */
  private pendingCount = new Map<string, number>()

  /**
   * @param options - construction facts; the caller keeps ownership of `ctx` and `store`.
   */
  constructor(private readonly options: ModelHealthMonitorOptions) {
    this.options.store.setFilter(this.options.filter ?? {})
  }

  /**
   * Replace the enabled-model selection and start an immediate round so the UI
   * reflects the new coverage without waiting for the next timer tick.
   * @param filter - the new selection.
   */
  setFilter(filter: ModelHealthFilter): void {
    this.options.store.setFilter(filter)
    this.notify()
    this.trigger()
  }

  /** Fire the optional post-snapshot callback (history + filter persisted). */
  private notify(): void {
    this.options.onSnapshot?.(this.options.store)
  }

  /**
   * Begin the periodic loop. The first round runs immediately — waiting one
   * full interval left a fresh install (or restart) showing nothing for up to
   * `intervalMs`. A repeat start arms nothing new.
   */
  start(): void {
    if (this.disposed || this.timer !== undefined) return
    this.trigger()
    this.arm()
    this.armWatch()
  }

  /**
   * Run one complete round now, coalescing with an in-flight round so a
   * manual refresh and a timer tick never overlap. A request that lands while
   * a round runs is not dropped: it schedules exactly one follow-up round,
   * because the in-flight round enumerated before the change that caused it —
   * a provider registered mid-round would otherwise stay invisible for a full
   * interval. A fiber already torn down starts nothing: a tool execution that
   * outlives disposal must not spend real provider traffic on a dead owner.
   * @returns the round that produced (or is producing) the fresh snapshot.
   */
  runNow(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.currentRun !== undefined) {
      this.pendingRound = true
      return this.currentRun
    }
    const run = this.runRound().finally(() => {
      this.currentRun = undefined
      if (this.pendingRound && !this.disposed) {
        this.pendingRound = false
        void this.runNow()
      }
    })
    this.currentRun = run
    return run
  }

  /** Request an asynchronous round without awaiting it, for topology changes. */
  trigger(): void {
    if (this.disposed) return
    void this.runNow()
  }

  /** Stop future rounds and clear both armed timers. In-flight rounds finish on their own. */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.watchTimer !== undefined) clearTimeout(this.watchTimer)
    this.watchTimer = undefined
    if (this.credentialTimer !== undefined) clearTimeout(this.credentialTimer)
    this.credentialTimer = undefined
  }

  /**
   * Arm one bounded segment; the callback re-arms for the next interval.
   * Callers own the disposed/duplicate guards, and disposal clears the only armed timer.
   */
  private arm(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.trigger()
      this.arm()
    }, Math.min(this.options.intervalMs, MAX_TIMER_DELAY_MS))
  }

  /** Arm the enumeration-only catalog sweep; each sweep re-arms itself. */
  private armWatch(): void {
    const watchMs = this.options.watchMs ?? DEFAULT_WATCH_MS
    if (watchMs <= 0) return
    this.watchTimer = setTimeout(() => {
      this.watchTimer = undefined
      void this.watchCatalog().finally(() => {
        if (!this.disposed) this.armWatch()
      })
    }, Math.min(watchMs, MAX_TIMER_DELAY_MS))
  }

  /** Whether a result failed with a credential-not-ready code. */
  private isCredentialPending(result: ModelCheckResult): boolean {
    return result.error?.code !== undefined && CREDENTIAL_PENDING_CODES.has(result.error.code)
  }

  /** Spend one deferral for a key; false once the configured limit is exhausted or disabled. */
  private deferCredential(key: string): boolean {
    const limit = this.options.credentialRetryLimit ?? DEFAULT_CREDENTIAL_RETRY_LIMIT
    if (limit <= 0) return false
    const used = this.pendingCount.get(key) ?? 0
    if (used >= limit) return false
    this.pendingCount.set(key, used + 1)
    return true
  }

  /** Arm a single prompt re-probe; a deferred round’s next failure re-arms it. */
  private armCredentialRetry(): void {
    if (this.disposed || this.credentialTimer !== undefined) return
    this.credentialTimer = setTimeout(() => {
      this.credentialTimer = undefined
      this.trigger()
    }, Math.min(this.options.credentialRetryDelayMs ?? DEFAULT_CREDENTIAL_RETRY_DELAY_MS, MAX_TIMER_DELAY_MS))
  }

  /**
   * Enumerate the catalog without probing and compare it with what the store
   * already knows. Enumeration is a local read on every shipping adapter, so
   * the sweep is cheap enough to run far more often than a probe round. A
   * changed key set updates the stored catalog (the settings checkbox list
   * shows the new model right away) and starts a prompt full round; a sweep
   * landing mid-round funnels through the same follow-up queue as any trigger.
   */
  private async watchCatalog(): Promise<void> {
    if (this.disposed) return
    if (this.currentRun !== undefined) {
      this.trigger()
      return
    }
    try {
      const all = await listProbeTargets(this.options.ctx, this.options.providers, this.options.models)
      const known = this.options.store.catalogKeys()
      this.options.store.setCatalog(all)
      const next = new Set(all.map(target => modelKey(target.provider, target.model)))
      if (!sameKeys(next, known)) this.trigger()
    } catch {
      // Enumeration failed; the next sweep retries. The round path logs its own
      // failures with context, so stay quiet here to avoid double warnings.
    }
  }

  /** Enumerate, probe, and reconcile one round; a contained failure leaves prior results in place. */
  private async runRound(): Promise<void> {
    try {
      const all = await listProbeTargets(this.options.ctx, this.options.providers, this.options.models)
      // Keep the full catalog independently of the enabled selection so the
      // settings checkbox list can still render models currently turned off.
      this.options.store.setCatalog(all)
      const targets = filterTargets(all, this.options.store.filter())
      const results = await runWithConcurrency(targets, this.options.concurrency, target =>
        probeModel(this.options.ctx, target, this.options))
      const recordedKeys = new Set<string>()
      let deferredCredential = false
      for (const result of results) {
        const key = modelKey(result.provider, result.model)
        if (result.ok) {
          this.succeeded.add(key)
          this.options.store.record(result)
          recordedKeys.add(key)
        } else if (this.isCredentialPending(result) && !this.succeeded.has(key) && this.deferCredential(key)) {
          // Credentials resolve asynchronously at boot: a first-run
          // MISSING_CREDENTIAL usually self-heals, so leave the model without a
          // result and re-probe shortly instead of stamping a red failure.
          deferredCredential = true
        } else {
          this.options.store.record(result)
          recordedKeys.add(key)
        }
      }
      this.options.store.reconcile(recordedKeys)
      this.options.store.markRound(new Date().toISOString())
      this.notify()
      if (deferredCredential) this.armCredentialRetry()
    } catch (error: unknown) {
      this.options.ctx.logger.warn(
        `model-health: probe round failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

/** Whether two key sets hold exactly the same members. */
function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  for (const key of left) {
    if (!right.has(key)) return false
  }
  return true
}