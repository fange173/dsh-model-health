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
import type { Context } from '@deepseek-ai/cordis';
import type { ProbeOptions } from './probe.ts';
import { ModelHealthStore } from './store.ts';
import type { ModelHealthFilter } from './types.ts';
/** Default cadence of the enumeration-only topology sweep. */
export declare const DEFAULT_WATCH_MS = 15000;
/** Delay between a deferred credential-pending round and its prompt re-probe. */
export declare const DEFAULT_CREDENTIAL_RETRY_DELAY_MS = 3000;
/** Deferrals a model may accumulate before its credential-pending failure is recorded for real. */
export declare const DEFAULT_CREDENTIAL_RETRY_LIMIT = 3;
/**
 * Probe failure codes that read as "credentials not ready yet" rather than a
 * definitive failure. At startup the credential seam loads asynchronously, so a
 * probe that runs first can fail MISSING_CREDENTIAL and self-heal a moment
 * later; the monitor re-probes those instead of stamping a spurious error.
 */
export declare const CREDENTIAL_PENDING_CODES: ReadonlySet<string>;
/** Construction facts for one monitor. */
export interface ModelHealthMonitorOptions extends ProbeOptions {
    readonly ctx: Context;
    readonly store: ModelHealthStore;
    readonly intervalMs: number;
    readonly concurrency: number;
    /** Provider whitelist; empty means all providers. */
    readonly providers: readonly string[] | undefined;
    /** Model whitelist (`provider/model`); empty means all models within the provider filter. */
    readonly models: readonly string[] | undefined;
    /**
     * Cadence of the enumeration-only catalog sweep in milliseconds; a changed
     * model set triggers a prompt full round. `0` disables the sweep. Defaults
     * to {@link DEFAULT_WATCH_MS}.
     */
    watchMs?: number;
    /** Initial enabled-model selection. */
    filter?: ModelHealthFilter;
    /**
     * Delay between a deferred credential-pending round and its prompt re-probe.
     * Defaults to {@link DEFAULT_CREDENTIAL_RETRY_DELAY_MS}.
     */
    credentialRetryDelayMs?: number;
    /**
     * Deferrals a model may accumulate before a credential-pending failure is
     * recorded for real; `0` disables the retry. Defaults to
     * {@link DEFAULT_CREDENTIAL_RETRY_LIMIT}.
     */
    credentialRetryLimit?: number;
    /**
     * Optional side-effect after a round settles and after a filter change;
     * used to persist history and the selection. Never awaited.
     */
    onSnapshot?: (store: ModelHealthStore) => void;
}
/** One process-local owner of the periodic probe loop. */
export declare class ModelHealthMonitor {
    private readonly options;
    private timer;
    private watchTimer;
    private credentialTimer;
    private currentRun;
    /** A trigger landed while a round was in flight; one follow-up is owed. */
    private pendingRound;
    private disposed;
    /** Keys that have answered healthily at least once this process; missing-key failures below are transient-at-boot. */
    private succeeded;
    /** Credential-pending deferrals already spent per key, bounding the retry loop. */
    private pendingCount;
    /**
     * @param options - construction facts; the caller keeps ownership of `ctx` and `store`.
     */
    constructor(options: ModelHealthMonitorOptions);
    /**
     * Replace the enabled-model selection and start an immediate round so the UI
     * reflects the new coverage without waiting for the next timer tick.
     * @param filter - the new selection.
     */
    setFilter(filter: ModelHealthFilter): void;
    /** Fire the optional post-snapshot callback (history + filter persisted). */
    private notify;
    /**
     * Begin the periodic loop. The first round runs immediately — waiting one
     * full interval left a fresh install (or restart) showing nothing for up to
     * `intervalMs`. A repeat start arms nothing new.
     */
    start(): void;
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
    runNow(): Promise<void>;
    /** Request an asynchronous round without awaiting it, for topology changes. */
    trigger(): void;
    /** Stop future rounds and clear both armed timers. In-flight rounds finish on their own. */
    dispose(): void;
    /**
     * Arm one bounded segment; the callback re-arms for the next interval.
     * Callers own the disposed/duplicate guards, and disposal clears the only armed timer.
     */
    private arm;
    /** Arm the enumeration-only catalog sweep; each sweep re-arms itself. */
    private armWatch;
    /** Whether a result failed with a credential-not-ready code. */
    private isCredentialPending;
    /** Spend one deferral for a key; false once the configured limit is exhausted or disabled. */
    private deferCredential;
    /** Arm a single prompt re-probe; a deferred round’s next failure re-arms it. */
    private armCredentialRetry;
    /**
     * Enumerate the catalog without probing and compare it with what the store
     * already knows. Enumeration is a local read on every shipping adapter, so
     * the sweep is cheap enough to run far more often than a probe round. A
     * changed key set updates the stored catalog (the settings checkbox list
     * shows the new model right away) and starts a prompt full round; a sweep
     * landing mid-round funnels through the same follow-up queue as any trigger.
     */
    private watchCatalog;
    /** Enumerate, probe, and reconcile one round; a contained failure leaves prior results in place. */
    private runRound;
}
