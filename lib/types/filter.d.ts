/**
 * Runtime enabled-filter for model probes. The user's settings click default
 * to "everything enabled"; turning a provider or an individual model off here
 * both hides it from the panel and stops probing it. Semantics are denylist
 * based, so a newly registered model (absent from the denylists) is enabled
 * by default — matching the "first install probes all, new models auto-enable"
 * behaviour. Thread-safe enough for a single-threaded host: the filter is
 * immutable and replaced wholesale on toggle.
 * @module dsh-model-health
 */
import type { ProbeTarget } from './probe.ts';
import type { ModelHealthFilter } from './types.ts';
/** Probe pairs as opaque keys. */
export declare function targetKey(provider: string, model: string): string;
/** The default filter: everything enabled. Immutable shared instance. */
export declare const EMPTY_FILTER: ModelHealthFilter;
/** Hard cap on denylist entries, so a hostile or buggy writer cannot bloat the persisted document. */
export declare const MAX_FILTER_ENTRIES = 256;
/** Hard cap on one denylist key's length. */
export declare const MAX_FILTER_KEY_LENGTH = 200;
/**
 * Validate an unknown value (a POST body, a loaded JSON document) into a
 * filter: only string keys survive, empties drop, and the lists are capped so
 * the persisted document stays bounded no matter what wrote it last.
 * @param value - the untrusted value.
 * @returns a filter value safe to store and serve.
 */
export declare function sanitizeFilterInput(value: unknown): ModelHealthFilter;
/** Whether one provider/model pair passes the filter (turned on). */
export declare function isModelEnabled(filter: ModelHealthFilter, provider: string, model: string): boolean;
/**
 * Apply a filter over a set of enumerated probe targets, keeping only those the
 * user has not disabled, in input order.
 * @param targets - the full registered catalog.
 * @param filter - the user's enabled selection.
 * @returns the subset to probe.
 */
export declare function filterTargets(targets: readonly ProbeTarget[], filter: ModelHealthFilter): ProbeTarget[];
/**
 * Toggle one provider on/off. Turning a provider off hides all its models;
 * re-enabling it restores them unless an individual pair is also disabled.
 * @param filter - current filter.
 * @param provider - provider id to toggle.
 * @param enabled - desired state.
 * @returns a new filter value.
 */
export declare function setProviderEnabled(filter: ModelHealthFilter, provider: string, enabled: boolean): ModelHealthFilter;
/**
 * Toggle one provider/model pair on/off. Turning a pair off hides only that
 * model even when the provider stays on.
 * @param filter - current filter.
 * @param provider - provider id.
 * @param model - model id within the provider.
 * @param enabled - desired state.
 * @returns a new filter value.
 */
export declare function setModelEnabled(filter: ModelHealthFilter, provider: string, model: string, enabled: boolean): ModelHealthFilter;
