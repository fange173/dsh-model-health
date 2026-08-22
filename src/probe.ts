/**
 * Probe execution: enumerate the currently registered provider/model routes,
 * run one bounded minimal round-trip per model, and classify the outcome.
 * @module dsh-model-health
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmFailure, LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ModelCheckResult, ModelHealthError, ModelHealthUsage } from './types.ts'

/** Whether a stream chunk carries generated content (text, reasoning, or tool args). */
function isTokenChunk(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/** Capability-owned timeout code stamped on each probe's deadline (distinct from the 'PROBE_TIMEOUT' wire result code it causes). */
export const PROBE_DEADLINE_CODE = 'MODEL_HEALTH_PROBE'

/** One provider/model route to probe. */
export interface ProbeTarget {
  readonly provider: string
  readonly model: string
  readonly name: string
}

/** Per-probe timing and request facts. */
export interface ProbeOptions {
  readonly probeTimeoutMs: number
  readonly probePrompt: string
  readonly probeMaxTokens: number
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
export async function listProbeTargets(
  ctx: Context,
  providers: readonly string[] | undefined = undefined,
  models: readonly string[] | undefined = undefined,
): Promise<ProbeTarget[]> {
  const providerSet = providers !== undefined && providers.length > 0 ? new Set(providers) : undefined
  const modelSet = models !== undefined && models.length > 0 ? new Set(models) : undefined
  const targets: ProbeTarget[] = []
  for (const provider of ctx.llm.listProviders()) {
    if (providerSet !== undefined && !providerSet.has(provider.id)) continue
    let modelsInfo: LlmModelInfo[]
    try {
      modelsInfo = await ctx.llm.listModels(provider.id)
    } catch (error: unknown) {
      ctx.logger.warn(`model-health: could not list models for provider "${provider.id}": ${renderThrown(error)}`)
      continue
    }
    for (const model of modelsInfo) {
      if (modelSet !== undefined && !modelSet.has(`${provider.id}/${model.id}`)) continue
      targets.push({ provider: provider.id, model: model.id, name: model.name })
    }
  }
  return targets
}

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
export async function probeModel(ctx: Context, target: ProbeTarget, options: ProbeOptions): Promise<ModelCheckResult> {
  const startedAt = Date.now()
  const checkedAt = new Date(startedAt).toISOString()
  let ttftMs: number | undefined
  let totalMs: number | undefined
  let usage: ModelHealthUsage | undefined
  let error: ModelHealthError | undefined
  let ok = false
  let sawDelta = false
  using probeDeadline = deadline(undefined, options.probeTimeoutMs, PROBE_DEADLINE_CODE)
  const signal = probeDeadline.signal

  try {
    const request: GenerateOptions = {
      provider: target.provider,
      model: target.model,
      messages: [createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text: options.probePrompt }],
      })],
      maxTokens: options.probeMaxTokens,
      signal,
    }
    for await (const chunk of ctx.llm.stream(request)) {
      if (isTokenChunk(chunk)) sawDelta = true
      if (ttftMs === undefined && isTokenChunk(chunk)) ttftMs = Date.now() - startedAt
      if (chunk.type === 'usage') {
        usage = {
          inputTokens: chunk.usage.inputTokens,
          outputTokens: chunk.usage.outputTokens,
        }
        continue
      }
      if (chunk.type !== 'finish') continue
      totalMs = Date.now() - startedAt
      switch (chunk.reason.kind) {
        case 'error':
        case 'aborted':
          error = probeFailure(chunk.reason.failure, signal, options.probeTimeoutMs)
          break
        default:
          // stop, max-tokens, tool-calls, and any finish kind a plugin adds:
          // a terminal response that is not a known failure counts as connected.
          ok = true
      }
      break
    }
    if (totalMs === undefined) {
      totalMs = Date.now() - startedAt
      error = probeFailure(undefined, signal, options.probeTimeoutMs)
        ?? { code: 'INCOMPLETE_STREAM', message: 'the provider stream ended without a finish chunk' }
    }
  } catch (caught: unknown) {
    totalMs = Date.now() - startedAt
    error = probeFailure(undefined, signal, options.probeTimeoutMs)
      ?? { code: 'PROBE_EXCEPTION', message: renderThrown(caught) }
  }

  // A slow reasoner can stream well past the deadline. Once any token delta
  // arrived the endpoint is demonstrably alive and answering, so a deadline
  // cutoff counts as healthy — latency reflects time-to-cutoff — instead of
  // stamping a timeout that real chat usage would never hit.
  if (!ok && sawDelta && error?.code === 'PROBE_TIMEOUT') {
    ok = true
    error = undefined
  }

  return {
    provider: target.provider,
    model: target.model,
    name: target.name,
    checkedAt,
    ok,
    ...ttftMs === undefined ? {} : { ttftMs },
    // totalMs is assigned on every path above — stream finish, end-without-finish, and thrown error.
    totalMs,
    ...usage === undefined ? {} : { usage },
    ...error === undefined ? {} : { error },
  }
}

/**
 * Translate a probe's terminal failure, preferring the local timeout when its
 * deadline fired over whatever the adapter reported.
 * @param failure - normalized adapter failure, when one was emitted.
 * @param signal - the probe's deadline-fused signal.
 * @param timeoutMs - the deadline that may have elapsed.
 * @returns a stable failure, or `undefined` when neither applies.
 */
function probeFailure(
  failure: LlmFailure | undefined,
  signal: AbortSignal,
  timeoutMs: number,
): ModelHealthError | undefined {
  if (timeoutOf(signal, PROBE_DEADLINE_CODE) !== undefined) {
    return { code: 'PROBE_TIMEOUT', message: `the model probe exceeded ${timeoutMs} ms` }
  }
  if (failure === undefined) return undefined
  return {
    code: failure.code,
    message: failure.message,
    ...failure.status === undefined ? {} : { status: failure.status },
  }
}

/** Render an unknown throw for process-local diagnostics. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Run `run` over every item with at most `limit` concurrent executions,
 * preserving input order in the returned results.
 * @param items - inputs to process.
 * @param limit - positive concurrency cap.
 * @param run - one item's asynchronous work.
 * @returns one result per item, in input order.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: Array<R | undefined> = new Array<R | undefined>(items.length)
  const slots = items.entries()
  const take = (): { readonly item: T; readonly index: number } | undefined => {
    const next = slots.next()
    return next.done === true ? undefined : { index: next.value[0], item: next.value[1] }
  }
  const worker = async (): Promise<void> => {
    while (true) {
      const slot = take()
      if (slot === undefined) return
      results[slot.index] = await run(slot.item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results.map((value, index) => {
    /* v8 ignore next 2 -- every slot resolves before Promise.all returns, so an empty slot means the loop above was bypassed. */
    if (value === undefined) throw new Error(`model-health: probe ${index} produced no result`)
    return value
  })
}
