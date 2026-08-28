import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { ModelHealthMonitor, type ModelHealthMonitorOptions } from '../src/monitor.ts'
import { ModelHealthStore } from '../src/store.ts'

class MockAdapter extends LlmAdapter {
  listCalls = 0
  /** Mutable catalog: tests push models to simulate a mid-session addition. */
  models: LlmModelInfo[] = [{ provider: 'mock', id: 'mock-model', name: 'Mock Model' }]

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    this.listCalls += 1
    return Promise.resolve(this.models)
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Adapter whose first probes fail MISSING_CREDENTIAL until told otherwise. */
class CredentialAdapter extends LlmAdapter {
  missingCredential = true
  models: LlmModelInfo[] = [{ provider: 'mock', id: 'mock-model', name: 'Mock Model' }]

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.missingCredential) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'MISSING_CREDENTIAL', message: 'no key yet' } } }
    } else {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function harness(adapter: LlmAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function options(ctx: Context, store: ModelHealthStore, overrides: Partial<ModelHealthMonitorOptions> = {}): ModelHealthMonitorOptions {
  return {
    ctx,
    store,
    intervalMs: 1000,
    probeTimeoutMs: 60_000,
    concurrency: 2,
    probePrompt: 'ping',
    probeMaxTokens: 1,
    providers: undefined,
    models: undefined,
    ...overrides,
  }
}

afterEach(() => { vi.useRealTimers() })

describe('ModelHealthMonitor', () => {
  it('probes immediately on start and keeps the history ring moving per interval', async () => {
    vi.useFakeTimers()
    const adapter = new MockAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore(5)
    const monitor = new ModelHealthMonitor(options(ctx, store))
    monitor.start()
    // The first round starts synchronously: a fresh install must not sit empty
    // for a full interval.
    expect(adapter.listCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.snapshot().models).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(adapter.listCalls).toBe(2)
    expect(store.history()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(adapter.listCalls).toBe(3)
    expect(store.history()).toHaveLength(3)
    monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('watch sweep probes a newly added model without waiting the interval', async () => {
    vi.useFakeTimers()
    const adapter = new MockAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore(5)
    const monitor = new ModelHealthMonitor(options(ctx, store, { intervalMs: 3_600_000, watchMs: 50 }))
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.listCalls).toBe(1)
    expect(store.snapshot().models.map(m => m.model)).toEqual(['mock-model'])

    // A model added to the existing provider publishes no adapters-updated
    // event; the watch sweep is what notices it.
    adapter.models.push({ provider: 'mock', id: 'mock-model-2', name: 'Mock Model 2' })
    await vi.advanceTimersByTimeAsync(50)
    const models = store.snapshot().models.map(m => m.model)
    expect(models).toContain('mock-model-2')
    expect(models).toHaveLength(2)

    // Steady state: sweeps keep enumerating but stop starting rounds.
    const roundsAfterChange = store.history().length
    await vi.advanceTimersByTimeAsync(500)
    expect(store.history().length).toBe(roundsAfterChange)
    monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('defers a watch sweep that lands mid-round instead of dropping it', async () => {
    vi.useFakeTimers()
    const adapter = new MockAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore(5)
    const monitor = new ModelHealthMonitor(options(ctx, store, { intervalMs: 3_600_000, watchMs: 50 }))
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    // Hold a round open across the sweep: the round below enumerated the old
    // catalog, the model lands mid-round, and the sweep defers.
    const held = monitor.runNow()
    adapter.models.push({ provider: 'mock', id: 'mock-model-2', name: 'Mock Model 2' })
    await vi.advanceTimersByTimeAsync(50)
    await held
    await vi.advanceTimersByTimeAsync(0)
    expect(store.snapshot().models.map(m => m.model)).toContain('mock-model-2')
    monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('tears down an unstarted monitor without touching timers', async () => {
    const adapter = new MockAdapter()
    const ctx = await harness(adapter)
    const monitor = new ModelHealthMonitor(options(ctx, new ModelHealthStore()))
    expect(() => { monitor.dispose() }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('arms only one cadence even when start() runs twice', async () => {
    vi.useFakeTimers()
    const adapter = new MockAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore()
    const monitor = new ModelHealthMonitor(options(ctx, store))
    monitor.start()
    monitor.start()
    expect(adapter.listCalls).toBe(1) // the immediate round ran exactly once
    await vi.advanceTimersByTimeAsync(1000)
    expect(adapter.listCalls).toBe(2)
    monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('logs non-Error round failures through the same warning channel', async () => {
    const warn = vi.fn()
    const brokenCtx = {
      llm: {
        listProviders(): never { throw 'registry gone' },
      },
      logger: { warn, info: vi.fn(), error: vi.fn(), success: vi.fn(), extend: () => brokenCtx.logger },
    } as unknown as Context
    const monitor = new ModelHealthMonitor(options(brokenCtx, new ModelHealthStore()))
    await monitor.runNow()
    expect(warn.mock.calls[0]?.[0]).toContain('model-health: probe round failed: registry gone')
  })

  it('shares one in-flight round and owes exactly one follow-up to mid-round triggers', async () => {
    const adapter = new MockAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore(5)
    const monitor = new ModelHealthMonitor(options(ctx, store))
    const first = monitor.runNow()
    const second = monitor.runNow()
    monitor.trigger()
    await Promise.all([first, second])
    // The three calls share the first round, and the mid-round trigger queues
    // exactly one follow-up instead of being dropped: whatever changed while
    // the round ran must be picked up.
    await vi.waitFor(() => { expect(store.history()).toHaveLength(2) })
    expect(adapter.listCalls).toBe(2)
    await ctx.fiber.dispose()
  })

  it('starts no round after disposal, whether asked by the timer or by runNow', async () => {
    vi.useFakeTimers()
    const adapter = new MockAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore()
    const monitor = new ModelHealthMonitor(options(ctx, store))
    monitor.start()
    // The synchronous immediate round was already in flight when dispose()
    // landed; in-flight rounds finish on their own, but nothing new starts.
    monitor.dispose()
    await monitor.runNow()
    monitor.trigger()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(adapter.listCalls).toBe(1)
    expect(store.snapshot().models).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('contains a round failure: warns and leaves the store untouched', async () => {
    const warn = vi.fn()
    const brokenCtx = {
      llm: {
        listProviders() { throw new Error('registry down') },
      },
      logger: { warn, info: vi.fn(), error: vi.fn(), success: vi.fn(), extend: () => brokenCtx.logger },
    } as unknown as Context
    const store = new ModelHealthStore()
    const monitor = new ModelHealthMonitor(options(brokenCtx, store))
    await monitor.runNow()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('model-health: probe round failed: registry down')
    expect(store.snapshot().models).toHaveLength(0)
  })

  it('clamps the arm delay at the platform timer cap', async () => {
    vi.useFakeTimers()
    const adapter = new MockAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore()
    const monitor = new ModelHealthMonitor(options(ctx, store, {
      intervalMs: MAX_TIMER_DELAY_MS + 60_000,
      watchMs: 0, // keep the sweep out of this cap assertion
    }))
    monitor.start()
    expect(adapter.listCalls).toBe(1) // immediate round
    await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS - 1000)
    expect(adapter.listCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(adapter.listCalls).toBe(2)
    monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('defers a boot-time MISSING_CREDENTIAL and re-probes once the credential arrives', async () => {
    vi.useFakeTimers()
    const adapter = new CredentialAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore(5)
    const monitor = new ModelHealthMonitor(options(ctx, store, {
      intervalMs: 3_600_000,
      credentialRetryDelayMs: 500,
      credentialRetryLimit: 3,
    }))
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    // The first round defers the missing credential: no result, no red failure.
    expect(store.snapshot().models).toHaveLength(0)

    adapter.missingCredential = false
    await vi.advanceTimersByTimeAsync(500)
    expect(store.snapshot().models).toHaveLength(1)
    expect(store.snapshot().models[0]?.ok).toBe(true)
    monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('records a MISSING_CREDENTIAL failure once the retry budget is exhausted', async () => {
    vi.useFakeTimers()
    const adapter = new CredentialAdapter()
    const ctx = await harness(adapter)
    const store = new ModelHealthStore(5)
    const monitor = new ModelHealthMonitor(options(ctx, store, {
      intervalMs: 3_600_000,
      credentialRetryDelayMs: 500,
      credentialRetryLimit: 2,
    }))
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(store.snapshot().models).toHaveLength(0) // still deferring
    await vi.advanceTimersByTimeAsync(500)
    // Third round consumes the limit and records the failure for real.
    expect(store.snapshot().models[0]?.ok).toBe(false)
    expect(store.snapshot().models[0]?.error?.code).toBe('MISSING_CREDENTIAL')
    monitor.dispose()
    await ctx.fiber.dispose()
  })
})
