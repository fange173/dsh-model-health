import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { filterTargets } from "./filter.js";
import { listProbeTargets, probeModel, runWithConcurrency } from "./probe.js";
import { modelKey } from "./store.js";
const DEFAULT_WATCH_MS = 15e3;
const DEFAULT_CREDENTIAL_RETRY_DELAY_MS = 3e3;
const DEFAULT_CREDENTIAL_RETRY_LIMIT = 3;
const CREDENTIAL_PENDING_CODES = /* @__PURE__ */ new Set(["MISSING_CREDENTIAL"]);
class ModelHealthMonitor {
  /**
   * @param options - construction facts; the caller keeps ownership of `ctx` and `store`.
   */
  constructor(options) {
    this.options = options;
    this.options.store.setFilter(this.options.filter ?? {});
  }
  options;
  timer;
  watchTimer;
  credentialTimer;
  currentRun;
  /** A trigger landed while a round was in flight; one follow-up is owed. */
  pendingRound = false;
  disposed = false;
  /** Keys that have answered healthily at least once this process; missing-key failures below are transient-at-boot. */
  succeeded = /* @__PURE__ */ new Set();
  /** Credential-pending deferrals already spent per key, bounding the retry loop. */
  pendingCount = /* @__PURE__ */ new Map();
  /**
   * Replace the enabled-model selection and start an immediate round so the UI
   * reflects the new coverage without waiting for the next timer tick.
   * @param filter - the new selection.
   */
  setFilter(filter) {
    this.options.store.setFilter(filter);
    this.notify();
    this.trigger();
  }
  /** Fire the optional post-snapshot callback (history + filter persisted). */
  notify() {
    this.options.onSnapshot?.(this.options.store);
  }
  /**
   * Begin the periodic loop. The first round runs immediately — waiting one
   * full interval left a fresh install (or restart) showing nothing for up to
   * `intervalMs`. A repeat start arms nothing new.
   */
  start() {
    if (this.disposed || this.timer !== void 0) return;
    this.trigger();
    this.arm();
    this.armWatch();
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
  runNow() {
    if (this.disposed) return Promise.resolve();
    if (this.currentRun !== void 0) {
      this.pendingRound = true;
      return this.currentRun;
    }
    const run = this.runRound().finally(() => {
      this.currentRun = void 0;
      if (this.pendingRound && !this.disposed) {
        this.pendingRound = false;
        void this.runNow();
      }
    });
    this.currentRun = run;
    return run;
  }
  /** Request an asynchronous round without awaiting it, for topology changes. */
  trigger() {
    if (this.disposed) return;
    void this.runNow();
  }
  /** Stop future rounds and clear both armed timers. In-flight rounds finish on their own. */
  dispose() {
    this.disposed = true;
    if (this.timer !== void 0) clearTimeout(this.timer);
    this.timer = void 0;
    if (this.watchTimer !== void 0) clearTimeout(this.watchTimer);
    this.watchTimer = void 0;
    if (this.credentialTimer !== void 0) clearTimeout(this.credentialTimer);
    this.credentialTimer = void 0;
  }
  /**
   * Arm one bounded segment; the callback re-arms for the next interval.
   * Callers own the disposed/duplicate guards, and disposal clears the only armed timer.
   */
  arm() {
    this.timer = setTimeout(() => {
      this.timer = void 0;
      this.trigger();
      this.arm();
    }, Math.min(this.options.intervalMs, MAX_TIMER_DELAY_MS));
  }
  /** Arm the enumeration-only catalog sweep; each sweep re-arms itself. */
  armWatch() {
    const watchMs = this.options.watchMs ?? DEFAULT_WATCH_MS;
    if (watchMs <= 0) return;
    this.watchTimer = setTimeout(() => {
      this.watchTimer = void 0;
      void this.watchCatalog().finally(() => {
        if (!this.disposed) this.armWatch();
      });
    }, Math.min(watchMs, MAX_TIMER_DELAY_MS));
  }
  /** Whether a result failed with a credential-not-ready code. */
  isCredentialPending(result) {
    return result.error?.code !== void 0 && CREDENTIAL_PENDING_CODES.has(result.error.code);
  }
  /** Spend one deferral for a key; false once the configured limit is exhausted or disabled. */
  deferCredential(key) {
    const limit = this.options.credentialRetryLimit ?? DEFAULT_CREDENTIAL_RETRY_LIMIT;
    if (limit <= 0) return false;
    const used = this.pendingCount.get(key) ?? 0;
    if (used >= limit) return false;
    this.pendingCount.set(key, used + 1);
    return true;
  }
  /** Arm a single prompt re-probe; a deferred round’s next failure re-arms it. */
  armCredentialRetry() {
    if (this.disposed || this.credentialTimer !== void 0) return;
    this.credentialTimer = setTimeout(() => {
      this.credentialTimer = void 0;
      this.trigger();
    }, Math.min(this.options.credentialRetryDelayMs ?? DEFAULT_CREDENTIAL_RETRY_DELAY_MS, MAX_TIMER_DELAY_MS));
  }
  /**
   * Enumerate the catalog without probing and compare it with what the store
   * already knows. Enumeration is a local read on every shipping adapter, so
   * the sweep is cheap enough to run far more often than a probe round. A
   * changed key set updates the stored catalog (the settings checkbox list
   * shows the new model right away) and starts a prompt full round; a sweep
   * landing mid-round funnels through the same follow-up queue as any trigger.
   */
  async watchCatalog() {
    if (this.disposed) return;
    if (this.currentRun !== void 0) {
      this.trigger();
      return;
    }
    try {
      const all = await listProbeTargets(this.options.ctx, this.options.providers, this.options.models);
      const known = this.options.store.catalogKeys();
      this.options.store.setCatalog(all);
      const next = new Set(all.map((target) => modelKey(target.provider, target.model)));
      if (!sameKeys(next, known)) this.trigger();
    } catch {
    }
  }
  /** Enumerate, probe, and reconcile one round; a contained failure leaves prior results in place. */
  async runRound() {
    try {
      const all = await listProbeTargets(this.options.ctx, this.options.providers, this.options.models);
      this.options.store.setCatalog(all);
      const targets = filterTargets(all, this.options.store.filter());
      const results = await runWithConcurrency(targets, this.options.concurrency, (target) => probeModel(this.options.ctx, target, this.options));
      const recordedKeys = /* @__PURE__ */ new Set();
      let deferredCredential = false;
      for (const result of results) {
        const key = modelKey(result.provider, result.model);
        if (result.ok) {
          this.succeeded.add(key);
          this.options.store.record(result);
          recordedKeys.add(key);
        } else if (this.isCredentialPending(result) && !this.succeeded.has(key) && this.deferCredential(key)) {
          deferredCredential = true;
        } else {
          this.options.store.record(result);
          recordedKeys.add(key);
        }
      }
      this.options.store.reconcile(recordedKeys);
      this.options.store.markRound((/* @__PURE__ */ new Date()).toISOString());
      this.notify();
      if (deferredCredential) this.armCredentialRetry();
    } catch (error) {
      this.options.ctx.logger.warn(
        `model-health: probe round failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
function sameKeys(left, right) {
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}
export {
  CREDENTIAL_PENDING_CODES,
  DEFAULT_CREDENTIAL_RETRY_DELAY_MS,
  DEFAULT_CREDENTIAL_RETRY_LIMIT,
  DEFAULT_WATCH_MS,
  ModelHealthMonitor
};
