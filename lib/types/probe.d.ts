/**
 * Probe execution: enumerate the currently registered provider/model routes,
 * run one bounded minimal round-trip per model, and classify the outcome.
 * @module dsh-model-health
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ModelCheckResult } from './types.ts';
/** Capability-owned timeout code stamped on each probe's deadline (distinct from the 'PROBE_TIMEOUT' wire result code it causes). */
export declare const PROBE_DEADLINE_CODE = "MODEL_HEALTH_PROBE";
/** One provider/model route to probe. */
export interface ProbeTarget {
    readonly provider: string;
    readonly model: string;
    readonly name: string;
}
/** Per-probe timing and request facts. */
export interface ProbeOptions {
    readonly probeTimeoutMs: number;
    readonly probePrompt: string;
    readonly probeMaxTokens: number;
}
/**
 * Enumerate every model the runtime currently advertises, from the registered
 * provider routes and each adapter's advisory catalog. A provider whose
 * catalog cannot be listed is skipped with a diagnostic, never fatal. When
 * `providers` or `models` is set, targets outside those whitelists are dropped.
 * @param ctx - global context owning the llm runtime.
 * @param providers - provider ids to keep; undefined keeps all.
 * @param models - `provider/model` pairs to keep; undefined keeps all within the provider filter.
 * @returns probe targets in provider-then-catalog order.
 */
export declare function listProbeTargets(ctx: Context, providers?: readonly string[] | undefined, models?: readonly string[] | undefined): Promise<ProbeTarget[]>;
/**
 * Run one bounded minimal round-trip against a model and classify it into an
 * `ok` result with latency, or a failure with provider facts. The deadline
 * only notifies through the request signal; the adapter owns closing the
 * stream when it aborts.
 * @param ctx - global context owning the llm runtime.
 * @param target - provider/model route to probe.
 * @param options - timing and request facts.
 * @returns the detached, single-probe outcome.
 */
export declare function probeModel(ctx: Context, target: ProbeTarget, options: ProbeOptions): Promise<ModelCheckResult>;
/**
 * Run `run` over every item with at most `limit` concurrent executions,
 * preserving input order in the returned results.
 * @param items - inputs to process.
 * @param limit - positive concurrency cap.
 * @param run - one item's asynchronous work.
 * @returns one result per item, in input order.
 */
export declare function runWithConcurrency<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]>;
