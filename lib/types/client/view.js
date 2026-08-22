const PROBE_TIMEOUT_CODE = "PROBE_TIMEOUT";
const TREND_DOT_CAP = 5;
const MIN_TPS_SAMPLE_TOKENS = 16;
const MIN_TPS_WINDOW_MS = 200;
function summarize(models) {
  let ok = 0;
  let latencySum = 0;
  let latencyCount = 0;
  for (const model of models) {
    if (!model.ok) continue;
    ok += 1;
    if (model.totalMs !== void 0) {
      latencySum += model.totalMs;
      latencyCount += 1;
    }
  }
  return {
    total: models.length,
    ok,
    failing: models.length - ok,
    avgTotalMs: latencyCount > 0 ? latencySum / latencyCount : null
  };
}
function aggregateTone(aggregate, hasError) {
  if (aggregate === null) return hasError ? "error" : "ongoing";
  if (aggregate.total === 0) return "warning";
  if (aggregate.failing > 0) return aggregate.ok > 0 ? "warning" : "error";
  return "done";
}
function resultTone(result) {
  return result.ok ? "done" : "error";
}
function groupByProvider(models) {
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
function buildTrendSeries(history) {
  const byModel = /* @__PURE__ */ new Map();
  for (const round of history) {
    for (const model of round.models) {
      const key = `${model.provider}/${model.model}`;
      let entry = byModel.get(key);
      if (entry === void 0) {
        entry = { meta: model, points: [] };
        byModel.set(key, entry);
      }
      entry.meta = model;
      entry.points.push(model.ok ? {
        checkedAt: round.checkedAt,
        ok: true,
        totalMs: model.totalMs ?? null,
        code: null,
        // Throughput over the decode window (post first token). A probe
        // capped at maxTokens:1 divides a single token by a millisecond
        // jitter window, which reads far above real decode speed — so the
        // rate only surfaces once the sample is big enough to trust
        // (>= MIN_TPS_SAMPLE_TOKENS output tokens over >= MIN_TPS_WINDOW_MS).
        ...model.usage !== void 0 && model.ttftMs !== void 0 && model.totalMs !== void 0 && model.totalMs > model.ttftMs && model.totalMs - model.ttftMs >= MIN_TPS_WINDOW_MS && model.usage.outputTokens >= MIN_TPS_SAMPLE_TOKENS ? { tps: Math.round(model.usage.outputTokens / ((model.totalMs - model.ttftMs) / 1e3)) } : {}
      } : { checkedAt: round.checkedAt, ok: false, totalMs: model.totalMs ?? null, code: model.error?.code ?? "unknown" });
    }
  }
  const series = [];
  for (const [key, { meta, points }] of byModel) {
    const healthy = points.filter((point) => point.ok);
    const latencySum = healthy.reduce((sum, point) => sum + (point.totalMs ?? 0), 0);
    const latencyCount = healthy.filter((point) => point.totalMs !== null).length;
    series.push({
      key,
      provider: meta.provider,
      model: meta.model,
      name: meta.name,
      points,
      okRate: Math.round(healthy.length / points.length * 100),
      avgTotalMs: latencyCount > 0 ? latencySum / latencyCount : null
    });
  }
  return series;
}
function buildRoundSeries(history) {
  return history.map((round) => {
    const healthy = round.models.filter((model) => model.ok);
    const latencies = healthy.map((model) => model.totalMs).filter((value) => typeof value === "number");
    return {
      checkedAt: round.checkedAt,
      ok: healthy.length,
      failing: round.models.length - healthy.length,
      avgLatency: latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null
    };
  });
}
function formatLatency(ms) {
  if (ms === null || ms === void 0) return "\u2014";
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  return `${(ms / 1e3).toFixed(1)}s`;
}
function recency(checkedAt, nowMs) {
  if (checkedAt === void 0) return { kind: "none" };
  const elapsed = Math.max(0, nowMs - Date.parse(checkedAt));
  const minutes = Math.floor(elapsed / 6e4);
  if (minutes < 1) return { kind: "justNow" };
  if (minutes < 60) return { kind: "minutes", minutes };
  return { kind: "hours", hours: Math.floor(minutes / 60) };
}
function providerEnabled(filter, provider) {
  return !(filter.disabledProviders?.includes(provider) ?? false);
}
function modelEnabled(filter, provider, model) {
  if (!providerEnabled(filter, provider)) return false;
  return !(filter.disabledModels?.includes(`${provider}/${model}`) ?? false);
}
function filterTrendSeries(series, filter) {
  return series.filter((item) => modelEnabled(filter, item.provider, item.model));
}
function toggleProvider(filter, provider) {
  const disabled = filter.disabledProviders ?? [];
  const isDisabled = disabled.includes(provider);
  const next = isDisabled ? disabled.filter((p) => p !== provider) : [...disabled, provider];
  return { ...filter, disabledProviders: next };
}
function toggleModel(filter, provider, model) {
  const key = `${provider}/${model}`;
  if (modelEnabled(filter, provider, model)) {
    return { ...filter, disabledModels: [...filter.disabledModels ?? [], key] };
  }
  const withoutModel = { ...filter, disabledModels: (filter.disabledModels ?? []).filter((m) => m !== key) };
  return enableProvider(withoutModel, provider);
}
function enableProvider(filter, provider) {
  const disabled = filter.disabledProviders ?? [];
  if (!disabled.includes(provider)) return filter;
  return { ...filter, disabledProviders: disabled.filter((p) => p !== provider) };
}
function formatTimestamp(iso) {
  if (iso === void 0) return "\u2014";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export {
  MIN_TPS_SAMPLE_TOKENS,
  MIN_TPS_WINDOW_MS,
  PROBE_TIMEOUT_CODE,
  TREND_DOT_CAP,
  aggregateTone,
  buildRoundSeries,
  buildTrendSeries,
  filterTrendSeries,
  formatLatency,
  formatTimestamp,
  groupByProvider,
  modelEnabled,
  providerEnabled,
  recency,
  resultTone,
  summarize,
  toggleModel,
  toggleProvider
};
