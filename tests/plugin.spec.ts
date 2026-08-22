import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as modelHealth from '../src/index.ts'

class MockAdapter extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'mock-model', name: 'Mock Model' }])
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

// Persistence must never reach the real harness home from a test run: every
// mounted plugin gets a throwaway document that dies with the test.
const tempDirs: string[] = []
function persistFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-health-plugin-'))
  tempDirs.push(dir)
  return join(dir, 'state.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function harness(): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['mock'], new MockAdapter())
  return ctx
}

describe('model-health plugin composition', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in modelHealth).toBe(false)
    expect(modelHealth.name).toBe('model-health')
    expect(modelHealth.inject).toEqual(['llm', 'tools'])
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(modelHealth)).toBe(modelHealth)
  })

  it('registers the global tool, probes on refresh, and unwinds on disposal', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(modelHealth, { intervalSeconds: 3600, probeTimeoutMs: 1000, persistFile: persistFile() })
    expect(ctx.tools.get('model_status')?.name).toBe('model_status')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('model-status-probe'),
      name: 'model_status',
      arguments: { refresh: true },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected a model_status snapshot')
    expect(result.value).toMatchObject({
      models: [{ provider: 'mock', model: 'mock-model', ok: true }],
    })

    await plugin.dispose()
    expect(ctx.tools.get('model_status')).toBeUndefined()

    await ctx.fiber.dispose()
  })

  it('serves the status route on a mounted web server and unwinds it on disposal', async () => {
    const ctx = await harness()
    const registered: { path?: string } = {}
    let disposed = false
    ctx.provide('webServer' as never, {
      register(route: { kind: string; path: string }) {
        registered.path = route.path
        return () => { disposed = true }
      },
    } as never)
    const plugin = await ctx.plugin(modelHealth, { intervalSeconds: 3600, probeTimeoutMs: 1000, persistFile: persistFile() })
    expect(registered.path).toBe('/api/model-health')

    await plugin.dispose()
    expect(disposed).toBe(true)

    await ctx.fiber.dispose()
  })

  it('skips the status route when httpEnabled is false or the path is overridden', async () => {
    const ctx = await harness()
    const paths: string[] = []
    ctx.provide('webServer' as never, {
      register(route: { kind: string; path: string }) {
        paths.push(route.path)
        return () => {}
      },
    } as never)
    const disabledPlugin = await ctx.plugin(modelHealth, { intervalSeconds: 3600, probeTimeoutMs: 1000, httpEnabled: false, persistFile: persistFile() })
    expect(paths).toEqual([])
    await disabledPlugin.dispose()

    const customPlugin = await ctx.plugin(modelHealth, { intervalSeconds: 3600, probeTimeoutMs: 1000, httpPath: '/status', persistFile: persistFile() })
    expect(paths).toEqual(['/status'])
    await customPlugin.dispose()

    await ctx.fiber.dispose()
  })

  it('installs nothing when disabled', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(modelHealth, { enabled: false })
    expect(ctx.tools.get('model_status')).toBeUndefined()
    await plugin.dispose()
    await ctx.fiber.dispose()
  })

  it('runs on defaults when no config is passed', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(modelHealth, { persistFile: persistFile() })
    expect(ctx.tools.get('model_status')).toBeDefined()
    await plugin.dispose()
    await ctx.fiber.dispose()
  })

  it('re-probes as soon as a new provider registers', async () => {
    const ctx = await harness()
    const plugin = await ctx.plugin(modelHealth, { persistFile: persistFile() })
    let lateListCalls = 0
    class LateAdapter extends MockAdapter {
      override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
        lateListCalls += 1
        return Promise.resolve([{ provider, id: 'late-model', name: 'Late Model' }])
      }
    }
    ctx.llm.registerAdapter(['late'], new LateAdapter())
    await vi.waitFor(() => { expect(lateListCalls).toBeGreaterThanOrEqual(1) })
    await plugin.dispose()
    await ctx.fiber.dispose()
  })
})
