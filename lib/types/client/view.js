/**
 * Pure derivations over the model-health status view: aggregates for the chip
 * and summary strip, per-model trend series from retained rounds, and the
 * small formatters the panel renders. Kept free of React and the store so
 * every rule is unit-testable in node.
 * @module dsh-model-health
 */
/** Probe error code the host emits when a round exceeds its deadline. */
export const PROBE_TIMEOUT_CODE = 'PROBE_TIMEOUT';
/** Trend dots a single model row shows at most pre-expansion; older rounds elide from the left. */
export const TREND_DOT_CAP = 5;
/** Minimum output tokens before a per-round tok/s rate is worth showing. */
export const MIN_TPS_SAMPLE_TOKENS = 16;
/** Minimum decode window (ms) before a per-round tok/s rate is worth showing. */
export const MIN_TPS_WINDOW_MS = 200;
/**
 * Aggregate a snapshot's per-model results.
 * @param models - the snapshot's current per-model results.
 * @returns totals and the mean healthy latency; `avgTotalMs` is null when no healthy model answered.
 */
export function summarize(models) {
    let ok = 0;
    let latencySum = 0;
    let latencyCount = 0;
    for (const model of models) {
        if (!model.ok)
            continue;
        ok += 1;
        if (model.totalMs !== undefined) {
            latencySum += model.totalMs;
            latencyCount += 1;
        }
    }
    return {
        total: models.length,
        ok,
        failing: models.length - ok,
        avgTotalMs: latencyCount > 0 ? latencySum / latencyCount : null,
    };
}
/**
 * Chip severity for the current data state, before any aggregate is known.
 * @param aggregate - current snapshot aggregate, or null while nothing answered.
 * @param hasError - whether the data lane is in its failure state.
 * @returns the dot tone for the chip's aggregate state.
 */
export function aggregateTone(aggregate, hasError) {
    if (aggregate === null)
        return hasError ? 'error' : 'ongoing';
    if (aggregate.total === 0)
        return 'warning';
    if (aggregate.failing > 0)
        return aggregate.ok > 0 ? 'warning' : 'error';
    // No failures with a non-empty set means everything healthy answered.
    return 'done';
}
/**
 * One result's dot tone: a healthy answer shows green, a failed probe red.
 * @param result - the per-model outcome to style.
 * @returns the dot tone for that outcome.
 */
export function resultTone(result) {
    return result.ok ? 'done' : 'error';
}
/**
 * Group snapshot-ordered models under their providers for the status list.
 * @param models - per-model results in snapshot order (provider-major).
 * @returns one group per provider in encounter order.
 */
export function groupByProvider(models) {
    const groups = [];
    let current;
    for (const model of models) {
        if (current?.provider !== model.provider) {
            current = { provider: model.provider, models: [] };
            groups.push(current);
        }
        current.models.push(model);
    }
    return groups;
}
/**
 * Build one trend series per model from retained rounds (oldest first). Each
 * series carries every retained point; the component caps the rendered strip
 * and expands on user demand. Rates cover the full retained window.
 * @param history - retained probe rounds, oldest first.
 * @returns one trend series per model in first-seen order.
 */
export function buildTrendSeries(history) {
    const byModel = new Map();
    for (const round of history) {
        for (const model of round.models) {
            const key = `${model.provider}/${model.model}`;
            let entry = byModel.get(key);
            if (entry === undefined) {
                entry = { meta: model, points: [] };
                byModel.set(key, entry);
            }
            entry.meta = model;
            entry.points.push(model.ok
                ? {
                    checkedAt: round.checkedAt,
                    ok: true,
                    totalMs: model.totalMs ?? null,
                    code: null,
                    // Throughput over the decode window (post first token). A probe
                    // capped at maxTokens:1 divides a single token by a millisecond
                    // jitter window, which reads far above real decode speed — so the
                    // rate only surfaces once the sample is big enough to trust
                    // (>= MIN_TPS_SAMPLE_TOKENS output tokens over >= MIN_TPS_WINDOW_MS).
                    ...model.usage !== undefined
                        && model.ttftMs !== undefined
                        && model.totalMs !== undefined
                        && model.totalMs > model.ttftMs
                        && model.totalMs - model.ttftMs >= MIN_TPS_WINDOW_MS
                        && model.usage.outputTokens >= MIN_TPS_SAMPLE_TOKENS
                        ? { tps: Math.round(model.usage.outputTokens / ((model.totalMs - model.ttftMs) / 1000)) }
                        : {},
                }
                : { checkedAt: round.checkedAt, ok: false, totalMs: model.totalMs ?? null, code: model.error?.code ?? 'unknown' });
        }
    }
    // Map insertion order is first-seen order, matching the snapshot layout.
    const series = [];
    for (const [key, { meta, points }] of byModel) {
        const healthy = points.filter(point => point.ok);
        const latencySum = healthy.reduce((sum, point) => sum + (point.totalMs ?? 0), 0);
        const latencyCount = healthy.filter(point => point.totalMs !== null).length;
        series.push({
            key,
            provider: meta.provider,
            model: meta.model,
            name: meta.name,
            points,
            okRate: Math.round((healthy.length / points.length) * 100),
            avgTotalMs: latencyCount > 0 ? latencySum / latencyCount : null,
        });
    }
    return series;
}
/**
 * Reduce retained rounds (oldest first) to per-round chart aggregates. Pure so
 * the sparkline row stays unit-testable alongside the other view derivations.
 * @param history - retained probe rounds, oldest first.
 * @returns one point per round, same order.
 */
export function buildRoundSeries(history) {
    return history.map(round => {
        const healthy = round.models.filter(model => model.ok);
        const latencies = healthy
            .map(model => model.totalMs)
            .filter((value) => typeof value === 'number');
        return {
            checkedAt: round.checkedAt,
            ok: healthy.length,
            failing: round.models.length - healthy.length,
            avgLatency: latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
        };
    });
}
/**
 * Format a latency for compact display: `312ms`, `1.2s`, or `—` when absent.
 * @param ms - latency in milliseconds, when measured.
 * @returns the compact latency string.
 */
export function formatLatency(ms) {
    if (ms === null || ms === undefined)
        return '—';
    if (ms < 1000)
        return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
/**
 * Bucket a snapshot timestamp for the header's "updated …" line. Anything
 * under one minute reads as just-now; days stay in hours so the vocabulary
 * never grows.
 * @param checkedAt - snapshot timestamp, or undefined before the first round.
 * @param nowMs - current epoch milliseconds.
 * @returns the recency descriptor mapped onto locale keys by the panel.
 */
export function recency(checkedAt, nowMs) {
    if (checkedAt === undefined)
        return { kind: 'none' };
    const elapsed = Math.max(0, nowMs - Date.parse(checkedAt));
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1)
        return { kind: 'justNow' };
    if (minutes < 60)
        return { kind: 'minutes', minutes };
    return { kind: 'hours', hours: Math.floor(minutes / 60) };
}
/** Whether a provider is enabled under a denylist filter. */
export function providerEnabled(filter, provider) {
    return !(filter.disabledProviders?.includes(provider) ?? false);
}
/** Whether a provider/model is enabled under a denylist filter. */
export function modelEnabled(filter, provider, model) {
    if (!providerEnabled(filter, provider))
        return false;
    return !(filter.disabledModels?.includes(`${provider}/${model}`) ?? false);
}
/**
 * Keep only the trend series whose provider/model currently passes the filter.
 * History rounds retain points for models that were enabled when they ran, so
 * a model hidden *now* would otherwise still surface in the trend tab.
 * @param series - the full trend series from retained rounds.
 * @param filter - the current enabled-model selection.
 * @returns the series for currently-enabled models, in input order.
 */
export function filterTrendSeries(series, filter) {
    return series.filter(item => modelEnabled(filter, item.provider, item.model));
}
/** Toggle a provider in the denylist, returning a new filter. */
export function toggleProvider(filter, provider) {
    const disabled = filter.disabledProviders ?? [];
    const isDisabled = disabled.includes(provider);
    const next = isDisabled ? disabled.filter(p => p !== provider) : [...disabled, provider];
    // Always overwrite the key: spreading a conditional that drops the key when
    // the list empties would leave the stale list behind and silently keep the
    // provider disabled.
    return { ...filter, disabledProviders: next };
}
/**
 * Toggle an individual model in the denylist, returning a new filter.
 * The direction follows {@link modelEnabled} — the same predicate the checkbox
 * renders — so a model that merely *looks* off because its provider is switched
 * off re-enables (and restores the provider) instead of disabling itself on the
 * first click.
 */
export function toggleModel(filter, provider, model) {
    const key = `${provider}/${model}`;
    if (modelEnabled(filter, provider, model)) {
        // Currently enabled: disable just this model.
        return { ...filter, disabledModels: [...(filter.disabledModels ?? []), key] };
    }
    // Currently disabled (individually or under a switched-off provider):
    // re-enable it and restore the provider, so the checkbox and the actual
    // probe coverage agree.
    const withoutModel = { ...filter, disabledModels: (filter.disabledModels ?? []).filter(m => m !== key) };
    return enableProvider(withoutModel, provider);
}
/** Remove one provider from the denylist; an empty list reads as "all enabled". */
function enableProvider(filter, provider) {
    const disabled = filter.disabledProviders ?? [];
    if (!disabled.includes(provider))
        return filter;
    return { ...filter, disabledProviders: disabled.filter(p => p !== provider) };
}
/** Format an ISO timestamp for the expanded trend list's per-check rows. */
export function formatTimestamp(iso) {
    if (iso === undefined)
        return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
//# sourceMappingURL=view.js.map