import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ModelCheckResult } from '../src/types.ts'
import { ModelHealthStore } from '../src/store.ts'
import { registerModelHealthTool } from '../src/tools.ts'

function seed(store: ModelHealthStore): ModelCheckResult {
  const result: ModelCheckResult = {
    provider: 'p', model: 'm', name: 'M', checkedAt: '2026-01-01T00:00:00.000Z', ok: true, totalMs: 42,
  }
  store.record(result)
  return result
}

async function call(ctx: Context, args: Record<string, unknown>): Promise<unknown> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('model-status-call'),
    name: 'model_status',
    arguments: args,
  })
  if (result.isError) throw new Error(`model_status failed: ${String(result.value)}`)
  return result.value
}

describe('model_status tool', () => {
  it('answers the cached snapshot without probing when data exists', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const store = new ModelHealthStore()
    const seeded = seed(store)
    const runNow = vi.fn(() => Promise.resolve())
    const dispose = registerModelHealthTool(ctx, { store, runNow })
    expect(await call(ctx, {})).toMatchObject({ models: [seeded] })
    expect(runNow).not.toHaveBeenCalled()
    dispose()
    expect(ctx.tools.get('model_status')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('probes on refresh: true even when cached data exists', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const store = new ModelHealthStore()
    seed(store)
    const runNow = vi.fn(() => Promise.resolve())
    registerModelHealthTool(ctx, { store, runNow })
    await call(ctx, { refresh: true })
    expect(runNow).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('probes on an empty store even without the refresh flag', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const store = new ModelHealthStore()
    const runNow = vi.fn(() => Promise.resolve())
    registerModelHealthTool(ctx, { store, runNow })
    await call(ctx, {})
    expect(runNow).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('presents a check call differently from a read call', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const store = new ModelHealthStore()
    registerModelHealthTool(ctx, { store, runNow: () => Promise.resolve() })
    const tool = ctx.tools.get('model_status')
    expect(tool?.presentCall?.({ refresh: true })).toMatchObject({ card: 'generic', title: 'Check model status', kind: 'read' })
    expect(tool?.presentCall?.({})).toMatchObject({ title: 'Model status' })
    await ctx.fiber.dispose()
  })
})
