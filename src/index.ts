/**
 * Periodic model-health probes over `ctx.llm`. Enumerates every registered
 * provider/model route, runs one bounded minimal round-trip per model on a
 * timer, and surfaces the latest results through the global `model_status`
 * tool plus a local HTTP status JSON (snapshot and retained rounds) when a
 * host web server is mounted. Disposable projections only: the llm runtime
 * owns provider/model registration, and this plugin owns nothing durable.
 * @module dsh-model-health
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { registerModelHealthRoute } from './http.ts'
import {
  DEFAULT_CREDENTIAL_RETRY_DELAY_MS,
  DEFAULT_CREDENTIAL_RETRY_LIMIT,
  ModelHealthMonitor,
} from './monitor.ts'

export { DEFAULT_CREDENTIAL_RETRY_DELAY_MS, DEFAULT_CREDENTIAL_RETRY_LIMIT } from './monitor.ts'
import { DEFAULT_PERSIST_FILE, loadPersistence, savePersistence, type ModelHealthPersistence } from './persistence.ts'
import { ModelHealthStore } from './store.ts'
import { registerModelHealthTool } from './tools.ts'

// The wire types the browser client and the tool's JSON both speak. Everything
// else (store, monitor, route handler) is package-internal; tests import the
// src subpaths directly.
export type * from './types.ts'

/** Default seconds between automatic probe rounds. */
export const DEFAULT_INTERVAL_SECONDS = 300
/** Default per-probe deadline; a round over it records PROBE_TIMEOUT. Slow
 *  reasoners that already streamed count as healthy at the cutoff. */
export const DEFAULT_PROBE_TIMEOUT_MS = 30_000
/** Default cap on simultaneously in-flight probes. */
export const DEFAULT_CONCURRENCY = 2
/** Default minimal request text every probe sends. */
export const DEFAULT_PROBE_PROMPT = 'ping'
/** Default token ceiling every probe requests, keeping the probe at its floor. */
export const DEFAULT_PROBE_MAX_TOKENS = 1
/** Default rounds retained in memory for trend rendering; 0 drops history. */
export const DEFAULT_HISTORY_LIMIT = 40
/** Default absolute pathname of the status JSON route. */
export const DEFAULT_HTTP_PATH = '/api/model-health'

/** Largest interval the timer arm can represent; larger values clamp in `arm`. */
const MAX_INTERVAL_SECONDS = Math.floor(MAX_TIMER_DELAY_MS / 1000)
const MAX_CONCURRENCY = 32
/** Retained rounds comfortable for local JSON payloads (40 rounds × models stays small). */
const MAX_HISTORY_LIMIT = 200

/** Cordis function-plugin name. */
export const name = 'model-health'
/** Services required before probes or the tool can run. */
export const inject = ['llm', 'tools']

/**
 * Plugin config, validated by the same-named schemastery schema and re-validated
 * by {@link resolveConfig} for programmatic construction.
 */
export interface Config {
  /** Whether the periodic loop and tool are installed; defaults to `true`. */
  enabled?: boolean
  /** Seconds between probe rounds; defaults to 300. */
  intervalSeconds?: number
  /** Per-probe deadline in milliseconds; defaults to 30000. */
  probeTimeoutMs?: number
  /** Maximum concurrent probes in one round; defaults to 2. */
  concurrency?: number
  /** Minimal request text each probe sends; defaults to `ping`. */
  probePrompt?: string
  /** Output token cap each probe requests; defaults to 1. */
  probeMaxTokens?: number
  /**
   * Completed rounds retained for the HTTP status view's history; 0 disables
   * retention. Defaults to 40.
   */
  historyLimit?: number
  /** Whether to serve the local status JSON when a host web server exists; defaults to `true`. */
  httpEnabled?: boolean
  /** Exact pathname of the status JSON; defaults to `/api/model-health`. */
  httpPath?: string
  /** Absolute path to persist history and the enabled filter; defaults to `<dshHome>/model-health.json`. */
  persistFile?: string
  /** Provider ids whose models are probed; unset means all providers. */
  providers?: string[]
  /** Specific `provider/model` pairs to probe; unset means all models within the provider filter. */
  models?: string[]
  /**
   * Delay between a deferred credential-pending round and its prompt re-probe.
   * Defaults to {@link DEFAULT_CREDENTIAL_RETRY_DELAY_MS}.
   */
  credentialRetryDelayMs?: number
  /**
   * Deferrals a model may accumulate before a credential-pending failure is
   * recorded for real; `0` disables the retry. Defaults to
   * {@link DEFAULT_CREDENTIAL_RETRY_LIMIT}.
   */
  credentialRetryLimit?: number
}

export const Config: z<Config> = z.object({
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
  providers: z.array(z.string()).default(undefined as unknown as string[]),
  models: z.array(z.string()).default(undefined as unknown as string[]),
  credentialRetryDelayMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CREDENTIAL_RETRY_DELAY_MS),
  credentialRetryLimit: z.number().step(1).min(0).default(DEFAULT_CREDENTIAL_RETRY_LIMIT),
})

/** Validated, detached construction facts. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly intervalSeconds: number
  readonly intervalMs: number
  readonly probeTimeoutMs: number
  readonly concurrency: number
  readonly probePrompt: string
  readonly probeMaxTokens: number
  readonly historyLimit: number
  readonly httpEnabled: boolean
  readonly httpPath: string
  /** Absolute persistence path; always resolved to a concrete location. */
  readonly persistFile: string
  /** Provider whitelist; undefined means all providers. */
  readonly providers: readonly string[] | undefined
  /** Model whitelist (`provider/model`); undefined means all models within the provider filter. */
  readonly models: readonly string[] | undefined
  /** Delay between a deferred credential-pending round and its prompt re-probe. */
  readonly credentialRetryDelayMs: number
  /** Deferrals a model may accumulate before a credential-pending failure is recorded. */
  readonly credentialRetryLimit: number
}

/**
 * Resolve raw config into validated construction facts. Programmatic
 * construction may bypass Schemastery, so every bound is re-judged here and a
 * misconfiguration fails loud at load.
 * @param config - raw plugin config.
 * @returns detached, validated facts.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const intervalSeconds = config.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > MAX_INTERVAL_SECONDS) {
    throw new Error(`model-health: intervalSeconds must be an integer from 1 through ${MAX_INTERVAL_SECONDS}`)
  }
  const probeTimeoutMs = config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  if (!Number.isFinite(probeTimeoutMs) || probeTimeoutMs <= 0 || probeTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`model-health: probeTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`model-health: concurrency must be an integer from 1 through ${MAX_CONCURRENCY}`)
  }
  const probePrompt = (config.probePrompt ?? DEFAULT_PROBE_PROMPT).trim()
  if (probePrompt.length === 0) {
    throw new Error('model-health: probePrompt must be non-empty after trimming')
  }
  const probeMaxTokens = config.probeMaxTokens ?? DEFAULT_PROBE_MAX_TOKENS
  if (!Number.isSafeInteger(probeMaxTokens) || probeMaxTokens < 1) {
    throw new Error('model-health: probeMaxTokens must be a positive safe integer')
  }
  const historyLimit = config.historyLimit ?? DEFAULT_HISTORY_LIMIT
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > MAX_HISTORY_LIMIT) {
    throw new Error(`model-health: historyLimit must be an integer from 0 through ${MAX_HISTORY_LIMIT}`)
  }
  const httpPath = config.httpPath ?? DEFAULT_HTTP_PATH
  if (
    !httpPath.startsWith('/')
    || httpPath.length < 2
    || httpPath.endsWith('/')
    || httpPath.includes('//')
    || /[\s?#]/.test(httpPath)
  ) {
    throw new Error(
      'model-health: httpPath must be an absolute pathname without a trailing slash, empty segments, query, fragment, or whitespace',
    )
  }
  const providers = normalizeFilter(config.providers, 'providers')
  const models = normalizeFilter(config.models, 'models')
  for (const entry of models ?? []) {
    if (!entry.includes('/')) {
      throw new Error('model-health: each models entry must be `provider/model`')
    }
  }
  const credentialRetryDelayMs = config.credentialRetryDelayMs ?? DEFAULT_CREDENTIAL_RETRY_DELAY_MS
  if (!Number.isSafeInteger(credentialRetryDelayMs) || credentialRetryDelayMs < 1 || credentialRetryDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`model-health: credentialRetryDelayMs must be an integer from 1 through ${MAX_TIMER_DELAY_MS}`)
  }
  const credentialRetryLimit = config.credentialRetryLimit ?? DEFAULT_CREDENTIAL_RETRY_LIMIT
  if (!Number.isSafeInteger(credentialRetryLimit) || credentialRetryLimit < 0) {
    throw new Error('model-health: credentialRetryLimit must be a non-negative integer')
  }
  return {
    enabled: config.enabled ?? true,
    intervalSeconds,
    intervalMs: intervalSeconds * 1000,
    probeTimeoutMs,
    concurrency,
    probePrompt,
    probeMaxTokens,
    historyLimit,
    httpEnabled: config.httpEnabled ?? true,
    httpPath,
    persistFile: config.persistFile !== undefined && config.persistFile.length > 0
      ? config.persistFile
      : dshHomePath(DEFAULT_PERSIST_FILE),
    providers,
    models,
    credentialRetryDelayMs,
    credentialRetryLimit,
  }
}

/** Deduplicate and validate a string filter list; empty array becomes undefined (no filter). */
function normalizeFilter(list: readonly string[] | undefined, field: string): readonly string[] | undefined {
  if (list === undefined) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of list) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`model-health: ${field} entries must be non-empty strings`)
    }
    if (!seen.has(entry)) { seen.add(entry); out.push(entry) }
  }
  return out.length > 0 ? out : undefined
}

/** Install the store, timer owner, and tool; re-scan when the provider topology changes. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return

  const store = new ModelHealthStore(resolved.historyLimit)
  const persistenceOpts = { filename: resolved.persistFile }

  // Until the durable document has been read, persisting is suppressed: the
  // first round (which starts within microseconds on a provider-less boot)
  // would otherwise overwrite the saved history with an empty snapshot before
  // the read landed.
  let ready = false
  const persist = (): void => {
    if (!ready) return
    const snapshot: ModelHealthPersistence = {
      rounds: store.history(),
      filter: store.filter(),
    }
    void savePersistence(snapshot, persistenceOpts).catch((error: unknown) => {
      ctx.logger.warn(`model-health: persist failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

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
    onSnapshot: () => { persist() },
  })
  const disposeTool = registerModelHealthTool(ctx, {
    store,
    runNow: () => monitor.runNow(),
  })
  const stopUpdated = ctx.on('llm/adapters-updated', () => {
    monitor.trigger()
  })
  // The route keeps its own service watch, so no strict startup ordering is
  // needed between this row and the web server entry.
  const disposeRoute = resolved.httpEnabled
    ? registerModelHealthRoute(ctx, {
      store,
      monitor,
      path: resolved.httpPath,
      statusConfig: {
        intervalSeconds: resolved.intervalSeconds,
        historyLimit: resolved.historyLimit,
      },
    })
    : undefined

  // Load any durable history + selection captured on a previous run, carry it
  // into the fresh store, and only then start the loop. Starting earlier would
  // race the read; a GET that lands mid-load still probes (the store is empty),
  // and seedHistory merges that round instead of dropping it.
  let disposed = false
  void loadPersistence(persistenceOpts)
    .then((persisted) => {
      if (disposed) return
      store.seedHistory(persisted.rounds)
      const filter = persisted.filter
      const hasSelection = (filter?.disabledProviders?.length ?? 0) > 0 || (filter?.disabledModels?.length ?? 0) > 0
      if (filter !== undefined && hasSelection) monitor.setFilter(filter)
    })
    .catch((error: unknown) => {
      ctx.logger.warn(`model-health: could not load persistence: ${error instanceof Error ? error.message : String(error)}`)
    })
    .finally(() => {
      if (disposed) return
      ready = true
      monitor.start()
    })

  ctx.effect(() => () => {
    disposed = true
    disposeRoute?.()
    stopUpdated()
    disposeTool()
    monitor.dispose()
  }, 'model-health.lifecycle()')
}
