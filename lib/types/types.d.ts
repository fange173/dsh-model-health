/**
 * Pure value types for the model-health plugin: one probe's outcome and the
 * assembled snapshot a consumer renders.
 * @module dsh-model-health
 */
/** One model probe's captured failure, safe to surface to a caller. */
export interface ModelHealthError {
    /** Stable provider-neutral machine code, e.g. `AUTH`, `NO_ADAPTER`, or `PROBE_TIMEOUT`. */
    readonly code: string;
    /** Human-readable failure summary. */
    readonly message: string;
    /** HTTP status observed at the provider boundary, when available. */
    readonly status?: number;
}
/** One model's latest probe outcome. */
export interface ModelCheckResult {
    /** Registered provider route id. */
    readonly provider: string;
    /** Exact model id passed to the adapter. */
    readonly model: string;
    /** Human-readable model name. */
    readonly name: string;
    /** ISO 8601 timestamp when this probe ran. */
    readonly checkedAt: string;
    /** Whether the model answered a minimal request. */
    readonly ok: boolean;
    /** Milliseconds to the first token, when one arrived. */
    readonly ttftMs?: number;
    /** Milliseconds to the terminal finish chunk. */
    readonly totalMs?: number;
    /** Token counts reported by the adapter's usage chunk, when one arrived. */
    readonly usage?: ModelHealthUsage;
    /** Failure facts when the probe did not succeed. */
    readonly error?: ModelHealthError;
}
/** Disjoint token counters from one probe round's usage chunk. */
export interface ModelHealthUsage {
    /** Uncached prompt tokens billed as input. */
    readonly inputTokens: number;
    /** Completion tokens actually generated. */
    readonly outputTokens: number;
}
/** The latest probe outcome for every currently registered model. */
export interface ModelHealthSnapshot {
    /** ISO 8601 timestamp of the most recently completed probe round, when one has run. */
    readonly checkedAt?: string;
    /** Latest per-model results in provider-then-model order. */
    readonly models: ModelCheckResult[];
}
/** One retained probe round, kept for local trend rendering. */
export interface ModelHealthRound {
    /** ISO 8601 timestamp when this round completed. */
    readonly checkedAt: string;
    /** Every model's outcome in that round, in provider-then-model order. */
    readonly models: ModelCheckResult[];
}
/** Public probe configuration echoed with the status view so a consumer can frame the data. */
export interface ModelHealthStatusConfig {
    /** Seconds between scheduled probe rounds. */
    readonly intervalSeconds: number;
    /** Number of recent history rounds retained in {@link ModelHealthStatusView.history}. */
    readonly historyLimit: number;
}
/**
 * One provider/model pair as probed today, carrying whether the user has it
 * enabled. The client renders a checkbox per entry so it can turn probe
 * coverage on or off per model.
 */
export interface ModelHealthCatalogEntry {
    /** Registered provider route id. */
    readonly provider: string;
    /** Exact model id passed to the adapter. */
    readonly model: string;
    /** Human-readable model name. */
    readonly name: string;
    /** Whether this pair is currently enabled (probed); false means hidden AND not probed. */
    readonly enabled: boolean;
}
/** The user's selection of which providers/models stay probed. Default-all. */
export interface ModelHealthFilter {
    /** Provider ids the user turned off; unset or empty means every provider stays enabled. */
    readonly disabledProviders?: readonly string[];
    /** `provider/model` pairs the user turned off; unset or empty means no individual model is disabled. */
    readonly disabledModels?: readonly string[];
}
/** Local status payload pressed over HTTP: snapshot plus retained rounds plus the filter/catalog. */
export interface ModelHealthStatusView {
    /** Probe configuration that produced this view. */
    readonly config: ModelHealthStatusConfig;
    /** Latest per-model outcomes, only for currently-enabled models. */
    readonly snapshot: ModelHealthSnapshot;
    /** Retained completed rounds, oldest first, capped at `config.historyLimit`. */
    readonly history: readonly ModelHealthRound[];
    /** Every registered provider/model plus whether it is enabled, for the settings checkbox list. */
    readonly catalog: readonly ModelHealthCatalogEntry[];
    /** The enabled-model selection the client should persist and re-sync. */
    readonly filter: ModelHealthFilter;
}
