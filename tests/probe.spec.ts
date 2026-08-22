import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { listProbeTargets, probeModel, runWithConcurrency } from '../src/probe.ts'

const OPTIONS = { probeTimeoutMs: 1_000, probePrompt: 'ping', probeMaxTokens: 1 }

const OK_CHUNKS: readonly StreamChunk[] = [
  { type: 'text-delta', index: 0, text: 'ok' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
  { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
  { type: 'finish', reason: { kind: 'stop' } },
]

const ERROR_CHUNKS: readonly StreamChunk[] = [
  {
    type: 'finish',
    reason: { kind: 'error', failure: { code: 'AUTH', message: 'bad key', status: 401 } },
  },
]

/** Adapter whose catalog and stream are test-controlled. */
class MockAdapter extends LlmAdapter {
  constructor(
    private readonly models: readonly LlmModelInfo[] = [{ provider: 'mock', id: 'mock-model', name: 'Mock Model' }],
    private readonly chunks: readonly StreamChunk[] = OK_CHUNKS,
  ) {
    super()
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models.map(model => ({ ...model, provider })))
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* this.chunks
  }
}

/** Adapter whose stream hangs until the probe deadline aborts its signal. */
class HangingAdapter extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'mock-model', name: 'Mock Model' }])
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await new Promise<never>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
  }
}

/** Adapter that streams one token then stalls until the deadline aborts. */
class SlowReasonerAdapter extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'mock-model', name: 'Mock Model' }])
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'text-delta', index: 0, text: '…' }
    await new Promise<never>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
  }
}

/** Adapter whose catalog listing throws. */
class BrokenCatalogAdapter extends LlmAdapter {
  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.reject(new Error('catalog down'))
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function llmContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  return ctx
}

describe('listProbeTargets', () => {
  it('enumerates every registered provider and advertised model', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      { provider: 'mock', id: 'mock-model', name: 'Mock Model' },
      { provider: 'mock', id: 'mock-other', name: 'Mock Other' },
    ]))
    await expect(listProbeTargets(ctx)).resolves.toEqual([
      { provider: 'mock', model: 'mock-model', name: 'Mock Model' },
      { provider: 'mock', model: 'mock-other', name: 'Mock Other' },
    ])
    await ctx.fiber.dispose()
  })

  it('skips a provider whose catalog cannot be listed', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter())
    ctx.llm.registerAdapter(['broken'], new BrokenCatalogAdapter())
    await expect(listProbeTargets(ctx)).resolves.toEqual([
      { provider: 'mock', model: 'mock-model', name: 'Mock Model' },
    ])
    await ctx.fiber.dispose()
  })

  it('keeps only models from the providers whitelist', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      { provider: 'mock', id: 'mock-model', name: 'Mock Model' },
    ]))
    ctx.llm.registerAdapter(['other'], new MockAdapter([
      { provider: 'other', id: 'other-model', name: 'Other Model' },
    ]))
    await expect(listProbeTargets(ctx, ['mock'])).resolves.toEqual([
      { provider: 'mock', model: 'mock-model', name: 'Mock Model' },
    ])
    await ctx.fiber.dispose()
  })

  it('keeps only models from the models whitelist', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      { provider: 'mock', id: 'mock-a', name: 'A' },
      { provider: 'mock', id: 'mock-b', name: 'B' },
    ]))
    await expect(listProbeTargets(ctx, undefined, ['mock/mock-b'])).resolves.toEqual([
      { provider: 'mock', model: 'mock-b', name: 'B' },
    ])
    await ctx.fiber.dispose()
  })

  it('intersects providers and models whitelists', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['a'], new MockAdapter([
      { provider: 'a', id: 'a1', name: 'A1' },
      { provider: 'a', id: 'a2', name: 'A2' },
    ]))
    ctx.llm.registerAdapter(['b'], new MockAdapter([
      { provider: 'b', id: 'b1', name: 'B1' },
    ]))
    await expect(listProbeTargets(ctx, ['a', 'b'], ['a/a1', 'b/b1'])).resolves.toEqual([
      { provider: 'a', model: 'a1', name: 'A1' },
      { provider: 'b', model: 'b1', name: 'B1' },
    ])
    await ctx.fiber.dispose()
  })

  it('treats empty whitelists as no filter', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      { provider: 'mock', id: 'mock-model', name: 'Mock Model' },
    ]))
    await expect(listProbeTargets(ctx, [], [])).resolves.toEqual([
      { provider: 'mock', model: 'mock-model', name: 'Mock Model' },
    ])
    await ctx.fiber.dispose()
  })
})

describe('probeModel', () => {
  it('records ok with latency for a healthy model', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter())
    const result = await probeModel(ctx, { provider: 'mock', model: 'mock-model', name: 'Mock Model' }, OPTIONS)
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
    expect(typeof result.ttftMs).toBe('number')
    expect(typeof result.totalMs).toBe('number')
    expect(result.totalMs).toBeGreaterThanOrEqual(result.ttftMs ?? 0)
    await ctx.fiber.dispose()
  })

  it('reports provider failure facts', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter(undefined, ERROR_CHUNKS))
    const result = await probeModel(ctx, { provider: 'mock', model: 'mock-model', name: 'Mock Model' }, OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toEqual({ code: 'AUTH', message: 'bad key', status: 401 })
    await ctx.fiber.dispose()
  })

  it('classifies a probe that outlives its deadline as PROBE_TIMEOUT', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new HangingAdapter())
    const result = await probeModel(ctx, { provider: 'mock', model: 'mock-model', name: 'Mock Model' }, { ...OPTIONS, probeTimeoutMs: 10 })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('PROBE_TIMEOUT')
    await ctx.fiber.dispose()
  })

  it('counts a slow reasoner cut off by the deadline as healthy once it streamed', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new SlowReasonerAdapter())
    const result = await probeModel(ctx, { provider: 'mock', model: 'mock-model', name: 'Mock Model' }, { ...OPTIONS, probeTimeoutMs: 10 })
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.ttftMs).toBeDefined()
    expect(result.totalMs).toBeDefined()
    await ctx.fiber.dispose()
  })

  it('records an aborted finish with the failure facts the adapter gave', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter(undefined, [
      { type: 'finish', reason: { kind: 'aborted', failure: { code: 'UPSTREAM', message: 'mid-stream reset' } } },
    ]))
    const result = await probeModel(ctx, { provider: 'mock', model: 'mock-model', name: 'Mock Model' }, OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toEqual({ code: 'UPSTREAM', message: 'mid-stream reset' })
    await ctx.fiber.dispose()
  })

  it('omits the status field when the provider failure does not carry one', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter(undefined, [
      { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } },
    ]))
    const result = await probeModel(ctx, { provider: 'mock', model: 'mock-model', name: 'Mock Model' }, OPTIONS)
    expect(result.error).toEqual({ code: 'RATE_LIMIT', message: 'slow down' })
    expect('status' in (result.error ?? {})).toBe(false)
    await ctx.fiber.dispose()
  })

  it('records a stream that ends without a finish chunk as INCOMPLETE_STREAM', async () => {
    const ctx = await llmContext()
    ctx.llm.registerAdapter(['mock'], new MockAdapter(undefined, [
      { type: 'text-delta', index: 0, text: 'partial' },
    ]))
    const result = await probeModel(ctx, { provider: 'mock', model: 'mock-model', name: 'Mock Model' }, OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.error).toMatchObject({ code: 'INCOMPLETE_STREAM' })
    await ctx.fiber.dispose()
  })

  it('renders a thrown non-Error verbatim instead of drowning it in a type name', async () => {
    // The llm runtime normalizes adapter-side throws into finish chunks, so
    // this drive uses a bare stream double to exercise probeModel's own
    // catch contract (typed throws are `unknown` by nature).
    const bare = {
      llm: {
        stream(): AsyncIterable<StreamChunk> { throw 'adapter died' },
      },
    } as unknown as Context
    const result = await probeModel(bare, { provider: 'mock', model: 'mock-model', name: 'Mock Model' }, OPTIONS)
    expect(result.error).toEqual({ code: 'PROBE_EXCEPTION', message: 'adapter died' })
  })
})

describe('runWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    const ran = await runWithConcurrency([40, 1, 20], 2, delay => new Promise<number>((resolve) => {
      setTimeout(() => { resolve(delay * 10) }, delay)
    }))
    expect(ran).toEqual([400, 10, 200])
  })
})
