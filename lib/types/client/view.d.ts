/**
 * Pure derivations over the model-health status view: aggregates for the chip
 * and summary strip, per-model trend series from retained rounds, and the
 * small formatters the panel renders. Kept free of React and the store so
 * every rule is unit-testable in node.
 * @module dsh-model-health
 */
import type { ModelCheckResult, ModelHealthFilter, ModelHealthRound } from '../types.ts';
/** Probe error code the host emits when a round exceeds its deadline. */
export declare const PROBE_TIMEOUT_CODE = "PROBE_TIMEOUT";
/** Trend dots a single model row shows at most pre-expansion; older rounds elide from the left. */
export declare const TREND_DOT_CAP = 5;
/** The latest snapshot's aggregate outcome for the chip and summary strip. */
export interface Aggregate {
    readonly total: number;
    readonly ok: number;
    readonly failing: number;
    /** Mean total latency (ms) over healthy results; null when nothing healthy answered. */
    readonly avgTotalMs: number | null;
}
/** Chip/panel severity: 'done'|'warning'|'ongoing'|'error' mirrors StateDot's union. */
export type HealthTone = 'done' | 'warning' | 'ongoing' | 'error';
/** One model's outcome inside one retained round, discriminated by health. */
export interface TrendOkPoint {
    readonly checkedAt: string;
    readonly ok: true;
    readonly totalMs: number | null;
    readonly code: null;
    /** Output tokens per second over the generation window, when usage was reported. */
    readonly tps?: number;
}
/** One model's failing outcome; codeless failures carry the 'unknown' stand-in. */
export interface TrendFailPoint {
    readonly checkedAt: string;
    readonly ok: false;
    readonly totalMs: number | null;
    readonly code: string;
}
/** Round-tripped totals for one model in one retained round. */
export type TrendPoint = TrendOkPoint | TrendFailPoint;
/** Minimum output tokens before a per-round tok/s rate is worth showing. */
export declare const MIN_TPS_SAMPLE_TOKENS = 16;
/** Minimum decode window (ms) before a per-round tok/s rate is worth showing. */
export declare const MIN_TPS_WINDOW_MS = 200;
/** One model's rendered trend: a capped recent point strip plus its rates. */
export interface TrendSeries {
    readonly key: string;
    readonly provider: string;
    readonly model: string;
    readonly name: string;
    readonly points: readonly TrendPoint[];
    /** Share of healthy points as 0–100; a series exists only where points exist. */
    readonly okRate: number;
    /** Mean total latency over healthy points; null when none answered. */
    readonly avgTotalMs: number | null;
}
/** One provider's rows in the status list, preserving snapshot order. */
export interface ProviderGroup {
    readonly provider: string;
    readonly models: readonly ModelCheckResult[];
}
/**
 * Aggregate a snapshot's per-model results.
 * @param models - the snapshot's current per-model results.
 * @returns totals and the mean healthy latency; `avgTotalMs` is null when no healthy model answered.
 */
export declare function summarize(models: readonly ModelCheckResult[]): Aggregate;
/**
 * Chip severity for the current data state, before any aggregate is known.
 * @param aggregate - current snapshot aggregate, or null while nothing answered.
 * @param hasError - whether the data lane is in its failure state.
 * @returns the dot tone for the chip's aggregate state.
 */
export declare function aggregateTone(aggregate: Aggregate | null, hasError: boolean): HealthTone;
/**
 * One result's dot tone: a healthy answer shows green, a failed probe red.
 * @param result - the per-model outcome to style.
 * @returns the dot tone for that outcome.
 */
export declare function resultTone(result: ModelCheckResult): HealthTone;
/**
 * Group snapshot-ordered models under their providers for the status list.
 * @param models - per-model results in snapshot order (provider-major).
 * @returns one group per provider in encounter order.
 */
export declare function groupByProvider(models: readonly ModelCheckResult[]): ProviderGroup[];
/**
 * Build one trend series per model from retained rounds (oldest first). Each
 * series carries every retained point; the component caps the rendered strip
 * and expands on user demand. Rates cover the full retained window.
 * @param history - retained probe rounds, oldest first.
 * @returns one trend series per model in first-seen order.
 */
export declare function buildTrendSeries(history: readonly ModelHealthRound[]): TrendSeries[];
/** One retained round reduced to the aggregates the panel charts draw. */
export interface RoundPoint {
    /** ISO 8601 collection timestamp of the round. */
    readonly checkedAt: string;
    /** Models that answered healthily in the round. */
    readonly ok: number;
    /** Models that failed or timed out in the round. */
    readonly failing: number;
    /** Mean total latency over healthy models; null when none answered. */
    readonly avgLatency: number | null;
}
/**
 * Reduce retained rounds (oldest first) to per-round chart aggregates. Pure so
 * the sparkline row stays unit-testable alongside the other view derivations.
 * @param history - retained probe rounds, oldest first.
 * @returns one point per round, same order.
 */
export declare function buildRoundSeries(history: readonly ModelHealthRound[]): RoundPoint[];
/**
 * Format a latency for compact display: `312ms`, `1.2s`, or `—` when absent.
 * @param ms - latency in milliseconds, when measured.
 * @returns the compact latency string.
 */
export declare function formatLatency(ms: number | null | undefined): string;
/** The checked-at recency descriptor a panel header maps onto locale keys. */
export type Recency = {
    readonly kind: 'none';
} | {
    readonly kind: 'justNow';
} | {
    readonly kind: 'minutes';
    readonly minutes: number;
} | {
    readonly kind: 'hours';
    readonly hours: number;
};
/**
 * Bucket a snapshot timestamp for the header's "updated …" line. Anything
 * under one minute reads as just-now; days stay in hours so the vocabulary
 * never grows.
 * @param checkedAt - snapshot timestamp, or undefined before the first round.
 * @param nowMs - current epoch milliseconds.
 * @returns the recency descriptor mapped onto locale keys by the panel.
 */
export declare function recency(checkedAt: string | undefined, nowMs: number): Recency;
/** Whether a provider is enabled under a denylist filter. */
export declare function providerEnabled(filter: ModelHealthFilter, provider: string): boolean;
/** Whether a provider/model is enabled under a denylist filter. */
export declare function modelEnabled(filter: ModelHealthFilter, provider: string, model: string): boolean;
/**
 * Keep only the trend series whose provider/model currently passes the filter.
 * History rounds retain points for models that were enabled when they ran, so
 * a model hidden *now* would otherwise still surface in the trend tab.
 * @param series - the full trend series from retained rounds.
 * @param filter - the current enabled-model selection.
 * @returns the series for currently-enabled models, in input order.
 */
export declare function filterTrendSeries(series: readonly TrendSeries[], filter: ModelHealthFilter): TrendSeries[];
/** Toggle a provider in the denylist, returning a new filter. */
export declare function toggleProvider(filter: ModelHealthFilter, provider: string): ModelHealthFilter;
/**
 * Toggle an individual model in the denylist, returning a new filter.
 * The direction follows {@link modelEnabled} — the same predicate the checkbox
 * renders — so a model that merely *looks* off because its provider is switched
 * off re-enables (and restores the provider) instead of disabling itself on the
 * first click.
 */
export declare function toggleModel(filter: ModelHealthFilter, provider: string, model: string): ModelHealthFilter;
/** Format an ISO timestamp for the expanded trend list's per-check rows. */
export declare function formatTimestamp(iso: string | undefined): string;
