import z from "@deepseek-ai/schemastery";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { registerModelHealthRoute } from "./http.js";
import {
  DEFAULT_CREDENTIAL_RETRY_DELAY_MS,
  DEFAULT_CREDENTIAL_RETRY_LIMIT,
  ModelHealthMonitor
} from "./monitor.js";
import { DEFAULT_CREDENTIAL_RETRY_DELAY_MS as DEFAULT_CREDENTIAL_RETRY_DELAY_MS2, DEFAULT_CREDENTIAL_RETRY_LIMIT as DEFAULT_CREDENTIAL_RETRY_LIMIT2 } from "./monitor.js";
import { DEFAULT_PERSIST_FILE, loadPersistence, savePersistence } from "./persistence.js";
import { ModelHealthStore } from "./store.js";
import { registerModelHealthTool } from "./tools.js";
const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_PROBE_TIMEOUT_MS = 3e4;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_PROBE_PROMPT = "ping";
const DEFAULT_PROBE_MAX_TOKENS = 1;
const DEFAULT_HISTORY_LIMIT = 40;
const DEFAULT_HTTP_PATH = "/api/model-health";
const MAX_INTERVAL_SECONDS = Math.floor(MAX_TIMER_DELAY_MS / 1e3);
const MAX_CONCURRENCY = 32;
const MAX_HISTORY_LIMIT = 200;
const name = "model-health";
const inject = ["llm", "tools"];
const Config = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().step(1).min(1).max(MAX_INTERVAL_SECONDS).default(DEFAULT_INTERVAL_SECONDS),
  probeTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_PROBE_TIMEOUT_MS),
  concurrency: z.number().step(1).min(1).max(MAX_CONCURRENCY).default(DEFAULT_CONCURRENCY),
  probePrompt: z.string().default(DEFAULT_PROBE_PROMPT),
  probeMaxTokens: z.number().step(1).min(1).default(DEFAULT_PROBE_MAX_TOKENS),
  historyLimit: z.number().step(1).min(0).max(MAX_HISTORY_LIMIT).default(DEFAULT_HISTORY_LIMIT),
  httpEnabled: z.boolean().default(true),
  httpPath: z.string().default(DEFAULT_HTTP_PATH),
  persistFile: z.string(),
  providers: z.array(z.string()).default(void 0),
  models: z.array(z.string()).default(void 0),
  credentialRetryDelayMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CREDENTIAL_RETRY_DELAY_MS),
  credentialRetryLimit: z.number().step(1).min(0).default(DEFAULT_CREDENTIAL_RETRY_LIMIT)
});
function resolveConfig(config) {
  const intervalSeconds = config.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > MAX_INTERVAL_SECONDS) {
    throw new Error(`model-health: intervalSeconds must be an integer from 1 through ${MAX_INTERVAL_SECONDS}`);
  }
  const probeTimeoutMs = config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  if (!Number.isFinite(probeTimeoutMs) || probeTimeoutMs <= 0 || probeTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`model-health: probeTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`model-health: concurrency must be an integer from 1 through ${MAX_CONCURRENCY}`);
  }
  const probePrompt = (config.probePrompt ?? DEFAULT_PROBE_PROMPT).trim();
  if (probePrompt.length === 0) {
    throw new Error("model-health: probePrompt must be non-empty after trimming");
  }
  const probeMaxTokens = config.probeMaxTokens ?? DEFAULT_PROBE_MAX_TOKENS;
  if (!Number.isSafeInteger(probeMaxTokens) || probeMaxTokens < 1) {
    throw new Error("model-health: probeMaxTokens must be a positive safe integer");
  }
  const historyLimit = config.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > MAX_HISTORY_LIMIT) {
    throw new Error(`model-health: historyLimit must be an integer from 0 through ${MAX_HISTORY_LIMIT}`);
  }
  const httpPath = config.httpPath ?? DEFAULT_HTTP_PATH;
  if (!httpPath.startsWith("/") || httpPath.length < 2 || httpPath.endsWith("/") || httpPath.includes("//") || /[\s?#]/.test(httpPath)) {
    throw new Error(
      "model-health: httpPath must be an absolute pathname without a trailing slash, empty segments, query, fragment, or whitespace"
    );
  }
  const providers = normalizeFilter(config.providers, "providers");
  const models = normalizeFilter(config.models, "models");
  for (const entry of models ?? []) {
    if (!entry.includes("/")) {
      throw new Error("model-health: each models entry must be `provider/model`");
    }
  }
  const credentialRetryDelayMs = config.credentialRetryDelayMs ?? DEFAULT_CREDENTIAL_RETRY_DELAY_MS;
  if (!Number.isSafeInteger(credentialRetryDelayMs) || credentialRetryDelayMs < 1 || credentialRetryDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`model-health: credentialRetryDelayMs must be an integer from 1 through ${MAX_TIMER_DELAY_MS}`);
  }
  const credentialRetryLimit = config.credentialRetryLimit ?? DEFAULT_CREDENTIAL_RETRY_LIMIT;
  if (!Number.isSafeInteger(credentialRetryLimit) || credentialRetryLimit < 0) {
    throw new Error("model-health: credentialRetryLimit must be a non-negative integer");
  }
  return {
    enabled: config.enabled ?? true,
    intervalSeconds,
    intervalMs: intervalSeconds * 1e3,
    probeTimeoutMs,
    concurrency,
    probePrompt,
    probeMaxTokens,
    historyLimit,
    httpEnabled: config.httpEnabled ?? true,
    httpPath,
    persistFile: config.persistFile !== void 0 && config.persistFile.length > 0 ? config.persistFile : dshHomePath(DEFAULT_PERSIST_FILE),
    providers,
    models,
    credentialRetryDelayMs,
    credentialRetryLimit
  };
}
function normalizeFilter(list, field) {
  if (list === void 0) return void 0;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const entry of list) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`model-health: ${field} entries must be non-empty strings`);
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out.length > 0 ? out : void 0;
}
function apply(ctx, config = {}) {
  const resolved = resolveConfig(config);
  if (!resolved.enabled) return;
  const store = new ModelHealthStore(resolved.historyLimit);
  const persistenceOpts = { filename: resolved.persistFile };
  let ready = false;
  const persist = () => {
    if (!ready) return;
    const snapshot = {
      rounds: store.history(),
      filter: store.filter()
    };
    void savePersistence(snapshot, persistenceOpts).catch((error) => {
      ctx.logger.warn(`model-health: persist failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  const monitor = new ModelHealthMonitor({
    ctx,
    store,
    intervalMs: resolved.intervalMs,
    probeTimeoutMs: resolved.probeTimeoutMs,
    concurrency: resolved.concurrency,
    probePrompt: resolved.probePrompt,
    probeMaxTokens: resolved.probeMaxTokens,
    providers: resolved.providers,
    models: resolved.models,
    credentialRetryDelayMs: resolved.credentialRetryDelayMs,
    credentialRetryLimit: resolved.credentialRetryLimit,
    onSnapshot: () => {
      persist();
    }
  });
  const disposeTool = registerModelHealthTool(ctx, {
    store,
    runNow: () => monitor.runNow()
  });
  const stopUpdated = ctx.on("llm/adapters-updated", () => {
    monitor.trigger();
  });
  const disposeRoute = resolved.httpEnabled ? registerModelHealthRoute(ctx, {
    store,
    monitor,
    path: resolved.httpPath,
    statusConfig: {
      intervalSeconds: resolved.intervalSeconds,
      historyLimit: resolved.historyLimit
    }
  }) : void 0;
  let disposed = false;
  void loadPersistence(persistenceOpts).then((persisted) => {
    if (disposed) return;
    store.seedHistory(persisted.rounds);
    const filter = persisted.filter;
    const hasSelection = (filter?.disabledProviders?.length ?? 0) > 0 || (filter?.disabledModels?.length ?? 0) > 0;
    if (filter !== void 0 && hasSelection) monitor.setFilter(filter);
  }).catch((error) => {
    ctx.logger.warn(`model-health: could not load persistence: ${error instanceof Error ? error.message : String(error)}`);
  }).finally(() => {
    if (disposed) return;
    ready = true;
    monitor.start();
  });
  ctx.effect(() => () => {
    disposed = true;
    disposeRoute?.();
    stopUpdated();
    disposeTool();
    monitor.dispose();
  }, "model-health.lifecycle()");
}
export {
  Config,
  DEFAULT_CONCURRENCY,
  DEFAULT_CREDENTIAL_RETRY_DELAY_MS2 as DEFAULT_CREDENTIAL_RETRY_DELAY_MS,
  DEFAULT_CREDENTIAL_RETRY_LIMIT2 as DEFAULT_CREDENTIAL_RETRY_LIMIT,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_HTTP_PATH,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_PROBE_MAX_TOKENS,
  DEFAULT_PROBE_PROMPT,
  DEFAULT_PROBE_TIMEOUT_MS,
  apply,
  inject,
  name,
  resolveConfig
};
