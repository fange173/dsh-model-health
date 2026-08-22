import { isModelEnabled } from "./filter.js";
function modelKey(provider, model) {
  return `${provider}\0${model}`;
}
class ModelHealthStore {
  /**
   * @param historyLimit - rounds to retain for trend rendering; `0` retains
   * nothing, so the store stays exactly the latest-results map it was before
   * history existed.
   */
  constructor(historyLimit = 0) {
    this.historyLimit = historyLimit;
  }
  historyLimit;
  results = /* @__PURE__ */ new Map();
  rounds = [];
  lastProbeAt;
  /** Every registered provider/model observed in the most recent round. */
  catalogTargets = [];
  /** The current enabled-model selection; empty means everything on. */
  enabledFilter = {};
  /**
   * Refresh the full registered catalog observed this round. It is the same
   * first-probe-target enumeration the monitor probes, kept unfiltered so the
   * settings checkbox list can render every model with its enabled state.
   * @param targets - every registered provider/model, in provider-then-catalog order.
   */
  setCatalog(targets) {
    this.catalogTargets = [...targets];
  }
  /**
   * Replace the user's enabled-model selection. Disabled models are filtered
   * out of the rendered snapshot on the next `snapshot()`/`catalog()` call.
   * @param filter - the new selection, or the empty filter to enable all.
   */
  setFilter(filter) {
    this.enabledFilter = filter;
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
  seedHistory(rounds) {
    const limit = Math.max(0, this.historyLimit);
    const seen = /* @__PURE__ */ new Set();
    const merged = [...this.rounds, ...rounds ?? []].filter((round) => {
      if (seen.has(round.checkedAt)) return false;
      seen.add(round.checkedAt);
      return true;
    }).sort((left, right) => left.checkedAt.localeCompare(right.checkedAt));
    this.rounds.length = 0;
    this.rounds.push(...limit > 0 ? merged.slice(-limit) : []);
    if (this.lastProbeAt === void 0 && this.rounds.length > 0) {
      this.lastProbeAt = this.rounds[this.rounds.length - 1].checkedAt;
    }
  }
  /**
   * The currently active enabled-model filter, as last set.
   * @returns the live selection value.
   */
  filter() {
    return this.enabledFilter;
  }
  /**
   * Every registered provider/model with its current enabled state, in the
   * order the last round observed them.
   * @returns one entry per registered pair.
   */
  catalog() {
    return this.catalogTargets.map((target) => ({
      provider: target.provider,
      model: target.model,
      name: target.name,
      enabled: isModelEnabled(this.enabledFilter, target.provider, target.model)
    }));
  }
  /**
   * Keys of every model the most recent enumeration observed, enabled or not.
   * The topology watch compares this against a fresh enumeration: comparing
   * the full catalog (not just probed results) keeps disabled models from
   * looking like perpetual additions.
   * @returns a detached key set.
   */
  catalogKeys() {
    return new Set(this.catalogTargets.map((target) => modelKey(target.provider, target.model)));
  }
  /**
   * Record the latest outcome for one model, keyed by provider/model.
   * @param result - the probe outcome that becomes the model's current result.
   */
  record(result) {
    this.results.set(modelKey(result.provider, result.model), result);
  }
  /**
   * Drop every held result whose key is absent from `keys`, after a probe
   * round discovered the current provider/model set. Entries for models that
   * disappeared leave with their provider.
   * @param keys - the complete key set this round observed.
   */
  reconcile(keys) {
    for (const key of this.results.keys()) {
      if (!keys.has(key)) this.results.delete(key);
    }
  }
  /**
   * Stamp the wall-clock time one full probe round completed and retain the
   * round for history, dropping the oldest entries past the configured limit.
   * @param at - ISO timestamp at which the round's last probe settled.
   */
  markRound(at) {
    this.lastProbeAt = at;
    if (this.historyLimit <= 0) return;
    const { models } = this.snapshot();
    this.rounds.push({ checkedAt: at, models });
    if (this.rounds.length > this.historyLimit) {
      this.rounds.splice(0, this.rounds.length - this.historyLimit);
    }
  }
  /**
   * Retained completed rounds, oldest first.
   * @returns the live history array; treated as read-only by all consumers.
   */
  history() {
    return this.rounds;
  }
  /**
   * Whether no probe has produced a result yet.
   * @returns true while the store holds no model results.
   */
  isEmpty() {
    return this.results.size === 0;
  }
  /**
   * Derive a fresh snapshot ordered by provider, then model id, limited to
   * currently-enabled models.
   * @returns one detached snapshot value safe to serialize and hold.
   */
  snapshot() {
    const filter = this.enabledFilter;
    const models = [...this.results.values()].filter((model) => isModelEnabled(filter, model.provider, model.model)).sort(
      (left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)
    );
    return {
      ...this.lastProbeAt === void 0 ? {} : { checkedAt: this.lastProbeAt },
      models
    };
  }
}
export {
  ModelHealthStore,
  modelKey
};
