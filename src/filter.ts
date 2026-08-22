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

import type { ProbeTarget } from './probe.ts'
import type { ModelHealthFilter } from './types.ts'

/** Probe pairs as opaque keys. */
export function targetKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/** The default filter: everything enabled. Immutable shared instance. */
export const EMPTY_FILTER: ModelHealthFilter = {}

/** Hard cap on denylist entries, so a hostile or buggy writer cannot bloat the persisted document. */
export const MAX_FILTER_ENTRIES = 256

/** Hard cap on one denylist key's length. */
export const MAX_FILTER_KEY_LENGTH = 200

/**
 * Validate an unknown value (a POST body, a loaded JSON document) into a
 * filter: only string keys survive, empties drop, and the lists are capped so
 * the persisted document stays bounded no matter what wrote it last.
 * @param value - the untrusted value.
 * @returns a filter value safe to store and serve.
 */
export function sanitizeFilterInput(value: unknown): ModelHealthFilter {
  if (value === null || typeof value !== 'object') return {}
  const raw = value as { disabledProviders?: unknown; disabledModels?: unknown }
  const providers = sanitizeList(raw.disabledProviders)
  const models = sanitizeList(raw.disabledModels)
  return {
    ...(providers.length > 0 ? { disabledProviders: providers } : {}),
    ...(models.length > 0 ? { disabledModels: models } : {}),
  }
}

/** Keep only bounded, non-empty strings from an unknown list. */
function sanitizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (out.length >= MAX_FILTER_ENTRIES) break
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_FILTER_KEY_LENGTH) continue
    out.push(entry)
  }
  return out
}

/** Whether one provider/model pair passes the filter (turned on). */
export function isModelEnabled(filter: ModelHealthFilter, provider: string, model: string): boolean {
  if (filter.disabledProviders?.includes(provider)) return false
  return !(filter.disabledModels?.includes(targetKey(provider, model)))
}

/**
 * Apply a filter over a set of enumerated probe targets, keeping only those the
 * user has not disabled, in input order.
 * @param targets - the full registered catalog.
 * @param filter - the user's enabled selection.
 * @returns the subset to probe.
 */
export function filterTargets(targets: readonly ProbeTarget[], filter: ModelHealthFilter): ProbeTarget[] {
  return targets.filter(target => isModelEnabled(filter, target.provider, target.model))
}

/**
 * Toggle one provider on/off. Turning a provider off hides all its models;
 * re-enabling it restores them unless an individual pair is also disabled.
 * @param filter - current filter.
 * @param provider - provider id to toggle.
 * @param enabled - desired state.
 * @returns a new filter value.
 */
export function setProviderEnabled(filter: ModelHealthFilter, provider: string, enabled: boolean): ModelHealthFilter {
  return enabled
    ? remove(filter, 'disabledProviders', provider)
    : add(filter, 'disabledProviders', provider)
}

/**
 * Toggle one provider/model pair on/off. Turning a pair off hides only that
 * model even when the provider stays on.
 * @param filter - current filter.
 * @param provider - provider id.
 * @param model - model id within the provider.
 * @param enabled - desired state.
 * @returns a new filter value.
 */
export function setModelEnabled(filter: ModelHealthFilter, provider: string, model: string, enabled: boolean): ModelHealthFilter {
  const key = targetKey(provider, model)
  return enabled
    ? remove(filter, 'disabledModels', key)
    : add(filter, 'disabledModels', key)
}

/** Add an entry to a disabled list in a new immutable filter. */
function add(filter: ModelHealthFilter, field: 'disabledProviders' | 'disabledModels', value: string): ModelHealthFilter {
  const prev = filter[field]
  if (prev?.includes(value)) return filter
  return { ...filter, [field]: [...(prev ?? []), value] }
}

/** Remove an entry from a disabled list in a new immutable filter. */
function remove(filter: ModelHealthFilter, field: 'disabledProviders' | 'disabledModels', value: string): ModelHealthFilter {
  const prev = filter[field]
  if (prev === undefined) return filter
  const next = prev.filter(entry => entry !== value)
  return next.length === prev.length ? filter : { ...filter, [field]: next }
}