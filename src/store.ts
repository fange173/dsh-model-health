/**
 * In-memory latest-results store for model probes. Holds one result per
 * registered provider/model pair, reconciled whenever the provider topology
 * changes, and derives snapshots in a stable order.
 * @module dsh-model-health
 */

import { isModelEnabled } from './filter.ts'
import type { ProbeTarget } from './probe.ts'
import type { ModelHealthFilter, ModelHealthCatalogEntry, ModelCheckResult, ModelHealthRound, ModelHealthSnapshot } from './types.ts'

/**
 * Join a provider/model pair into one opaque store key.
 * @param provider - provider id.
 * @param model - model id within that provider.
 * @returns one string key unique across the runtime's registered routes.
 */
export function modelKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/** Process-local holder of the latest per-model probe results and retained rounds. */
export class ModelHealthStore {
  private readonly results = new Map<string, ModelCheckResult>()
  private readonly rounds: ModelHealthRound[] = []
  private lastProbeAt: string | undefined
  /** Every registered provider/model observed in the most recent round. */
  private catalogTargets: ProbeTarget[] = []
  /** The current enabled-model selection; empty means everything on. */
  private enabledFilter: ModelHealthFilter = {}

  /**
   * @param historyLimit - rounds to retain for trend rendering; `0` retains
   * nothing, so the store stays exactly the latest-results map it was before
   * history existed.
   */
  constructor(private readonly historyLimit = 0) {}

  /**
   * Refresh the full registered catalog observed this round. It is the same
   * first-probe-target enumeration the monitor probes, kept unfiltered so the
   * settings checkbox list can render every model with its enabled state.
   * @param targets - every registered provider/model, in provider-then-catalog order.
   */
  setCatalog(targets: readonly ProbeTarget[]): void {
    this.catalogTargets = [...targets]
  }

  /**
   * Replace the user's enabled-model selection. Disabled models are filtered
   * out of the rendered snapshot on the next `snapshot()`/`catalog()` call.
   * @param filter - the new selection, or the empty filter to enable all.
   */
  setFilter(filter: ModelHealthFilter): void {
    this.enabledFilter = filter
  }

  /**
   * Merge retained rounds from a durable source (a file loaded at plugin
   * start) into the live history. Merging — not replacing — keeps any round
   * that already ran while the async load was in flight, and re-sorting by
   * timestamp restores oldest-first order no matter which side produced a
   * given round. Duplicate timestamps collapse (two rounds inside one
   * millisecond cannot happen: every round waits on real network probes).
   * @param rounds - retained rounds from storage, oldest first.
   */
  seedHistory(rounds: readonly ModelHealthRound[]): void {
    const limit = Math.max(0, this.historyLimit)
    const seen = new Set<string>()
    const merged = [...this.rounds, ...(rounds ?? [])]
      .filter((round) => {
        if (seen.has(round.checkedAt)) return false
        seen.add(round.checkedAt)
        return true
      })
      .sort((left, right) => left.checkedAt.localeCompare(right.checkedAt))
    this.rounds.length = 0
    // `slice(-0)` collapses to `slice(0)` and would re-admit every merged
    // round, so a zero limit must keep nothing rather than everything.
    this.rounds.push(...(limit > 0 ? merged.slice(-limit) : []))
    if (this.lastProbeAt === undefined && this.rounds.length > 0) {
      this.lastProbeAt = this.rounds[this.rounds.length - 1]!.checkedAt
    }
  }

  /**
   * The currently active enabled-model filter, as last set.
   * @returns the live selection value.
   */
  filter(): ModelHealthFilter {
    return this.enabledFilter
  }

  /**
   * Every registered provider/model with its current enabled state, in the
   * order the last round observed them.
   * @returns one entry per registered pair.
   */
  catalog(): ModelHealthCatalogEntry[] {
    return this.catalogTargets.map(target => ({
      provider: target.provider,
      model: target.model,
      name: target.name,
      enabled: isModelEnabled(this.enabledFilter, target.provider, target.model),
    }))
  }

  /**
   * Keys of every model the most recent enumeration observed, enabled or not.
   * The topology watch compares this against a fresh enumeration: comparing
   * the full catalog (not just probed results) keeps disabled models from
   * looking like perpetual additions.
   * @returns a detached key set.
   */
  catalogKeys(): Set<string> {
    return new Set(this.catalogTargets.map(target => modelKey(target.provider, target.model)))
  }

  /**
   * Record the latest outcome for one model, keyed by provider/model.
   * @param result - the probe outcome that becomes the model's current result.
   */
  record(result: ModelCheckResult): void {
    this.results.set(modelKey(result.provider, result.model), result)
  }

  /**
   * Drop every held result whose key is absent from `keys`, after a probe
   * round discovered the current provider/model set. Entries for models that
   * disappeared leave with their provider.
   * @param keys - the complete key set this round observed.
   */
  reconcile(keys: ReadonlySet<string>): void {
    for (const key of this.results.keys()) {
      if (!keys.has(key)) this.results.delete(key)
    }
  }

  /**
   * Stamp the wall-clock time one full probe round completed and retain the
   * round for history, dropping the oldest entries past the configured limit.
   * @param at - ISO timestamp at which the round's last probe settled.
   */
  markRound(at: string): void {
    this.lastProbeAt = at
    if (this.historyLimit <= 0) return
    const { models } = this.snapshot()
    this.rounds.push({ checkedAt: at, models })
    if (this.rounds.length > this.historyLimit) {
      this.rounds.splice(0, this.rounds.length - this.historyLimit)
    }
  }

  /**
   * Retained completed rounds, oldest first.
   * @returns the live history array; treated as read-only by all consumers.
   */
  history(): readonly ModelHealthRound[] {
    return this.rounds
  }

  /**
   * Whether no probe has produced a result yet.
   * @returns true while the store holds no model results.
   */
  isEmpty(): boolean {
    return this.results.size === 0
  }

  /**
   * Derive a fresh snapshot ordered by provider, then model id, limited to
   * currently-enabled models.
   * @returns one detached snapshot value safe to serialize and hold.
   */
  snapshot(): ModelHealthSnapshot {
    const filter = this.enabledFilter
    const models = [...this.results.values()]
      .filter(model => isModelEnabled(filter, model.provider, model.model))
      .sort(
        (left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model),
      )
    return {
      ...this.lastProbeAt === undefined ? {} : { checkedAt: this.lastProbeAt },
      models,
    }
  }
}
