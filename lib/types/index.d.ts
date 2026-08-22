/**
 * Periodic model-health probes over `ctx.llm`. Enumerates every registered
 * provider/model route, runs one bounded minimal round-trip per model on a
 * timer, and surfaces the latest results through the global `model_status`
 * tool plus a local HTTP status JSON (snapshot and retained rounds) when a
 * host web server is mounted. Disposable projections only: the llm runtime
 * owns provider/model registration, and this plugin owns nothing durable.
 * @module dsh-model-health
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { DEFAULT_CREDENTIAL_RETRY_DELAY_MS, DEFAULT_CREDENTIAL_RETRY_LIMIT } from './monitor.ts';
export type * from './types.ts';
/** Default seconds between automatic probe rounds. */
export declare const DEFAULT_INTERVAL_SECONDS = 300;
/** Default per-probe deadline; a round over it records PROBE_TIMEOUT. Slow
 *  reasoners that already streamed count as healthy at the cutoff. */
export declare const DEFAULT_PROBE_TIMEOUT_MS = 30000;
/** Default cap on simultaneously in-flight probes. */
export declare const DEFAULT_CONCURRENCY = 2;
/** Default minimal request text every probe sends. */
export declare const DEFAULT_PROBE_PROMPT = "ping";
/** Default token ceiling every probe requests, keeping the probe at its floor. */
export declare const DEFAULT_PROBE_MAX_TOKENS = 1;
/** Default rounds retained in memory for trend rendering; 0 drops history. */
export declare const DEFAULT_HISTORY_LIMIT = 40;
/** Default absolute pathname of the status JSON route. */
export declare const DEFAULT_HTTP_PATH = "/api/model-health";
/** Cordis function-plugin name. */
export declare const name = "model-health";
/** Services required before probes or the tool can run. */
export declare const inject: string[];
/**
 * Plugin config, validated by the same-named schemastery schema and re-validated
 * by {@link resolveConfig} for programmatic construction.
 */
export interface Config {
    /** Whether the periodic loop and tool are installed; defaults to `true`. */
    enabled?: boolean;
    /** Seconds between probe rounds; defaults to 300. */
    intervalSeconds?: number;
    /** Per-probe deadline in milliseconds; defaults to 30000. */
    probeTimeoutMs?: number;
    /** Maximum concurrent probes in one round; defaults to 2. */
    concurrency?: number;
    /** Minimal request text each probe sends; defaults to `ping`. */
    probePrompt?: string;
    /** Output token cap each probe requests; defaults to 1. */
    probeMaxTokens?: number;
    /**
     * Completed rounds retained for the HTTP status view's history; 0 disables
     * retention. Defaults to 40.
     */
    historyLimit?: number;
    /** Whether to serve the local status JSON when a host web server exists; defaults to `true`. */
    httpEnabled?: boolean;
    /** Exact pathname of the status JSON; defaults to `/api/model-health`. */
    httpPath?: string;
    /** Absolute path to persist history and the enabled filter; defaults to `<dshHome>/model-health.json`. */
    persistFile?: string;
    /** Provider ids whose models are probed; unset means all providers. */
    providers?: string[];
    /** Specific `provider/model` pairs to probe; unset means all models within the provider filter. */
    models?: string[];
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
}
export declare const Config: z<Config>;
/** Validated, detached construction facts. */
export interface ResolvedConfig {
    readonly enabled: boolean;
    readonly intervalSeconds: number;
    readonly intervalMs: number;
    readonly probeTimeoutMs: number;
    readonly concurrency: number;
    readonly probePrompt: string;
    readonly probeMaxTokens: number;
    readonly historyLimit: number;
    readonly httpEnabled: boolean;
    readonly httpPath: string;
    /** Absolute persistence path; always resolved to a concrete location. */
    readonly persistFile: string;
    /** Provider whitelist; undefined means all providers. */
    readonly providers: readonly string[] | undefined;
    /** Model whitelist (`provider/model`); undefined means all models within the provider filter. */
    readonly models: readonly string[] | undefined;
    /** Delay between a deferred credential-pending round and its prompt re-probe. */
    readonly credentialRetryDelayMs: number;
    /** Deferrals a model may accumulate before a credential-pending failure is recorded. */
    readonly credentialRetryLimit: number;
}
/**
 * Resolve raw config into validated construction facts. Programmatic
 * construction may bypass Schemastery, so every bound is re-judged here and a
 * misconfiguration fails loud at load.
 * @param config - raw plugin config.
 * @returns detached, validated facts.
 */
export declare function resolveConfig(config: Config): ResolvedConfig;
/** Install the store, timer owner, and tool; re-scan when the provider topology changes. */
export declare function apply(ctx: Context, config?: Config): void;
