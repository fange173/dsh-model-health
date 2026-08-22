import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as modelHealth from '../src/index.ts'

class MockAdapter extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: 'mock-model', name: 'Mock Model' }])
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot a test-only cordis.yml through the real Loader, with the module map
 * answering for the two packages instead of node_modules.
 * @param intervalSeconds - refresh cadence kept large so the test owns all rounds.
 * @returns the booted context.
 */
async function loadComposition(intervalSeconds: number): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-model-health-composition-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: 'dsh-model-health'",
    '  config:',
    `    intervalSeconds: ${String(intervalSeconds)}`,
    // Persistence must stay inside the throwaway root, never the real home.
    `    persistFile: '${join(root, 'state.json')}'`,
    '',
  ].join('\n'))

  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['dsh-model-health', modelHealth],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  context = ctx
  return ctx
}

describe('model-health real composition', () => {
  it('serves the wire contract over a real HTTP server, starting after its services arrive', async () => {
    const ctx = await loadComposition(3600)
    // The plugin's apply waits for llm and tools; only after the runtime
    // harness lands does the status surface come alive.
    await mountAgentLoopTestDependencies(ctx)
    ctx.llm.registerAdapter(['mock'], new MockAdapter())

    const statusUrl = `http://127.0.0.1:${String(ctx.webServer.port)}/api/model-health`
    let response = await fetch(`${statusUrl}?refresh=1`, { method: 'GET', headers: { accept: 'application/json' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const first = await response.json() as { snapshot?: { models?: unknown[] } }
    expect(first.snapshot?.models?.length).toBe(1)

    // Method guard over the wire: DELETE is not part of the surface.
    response = await fetch(statusUrl, { method: 'DELETE' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD, POST')

    // POST applies an enabled-filter over the wire: the accepted selection comes
    // back, and because the route awaits the fresh round the very next plain GET
    // already reflects the new coverage.
    response = await fetch(statusUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disabledModels: ['mock/mock-model'] }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ disabledModels: ['mock/mock-model'] })

    response = await fetch(statusUrl, { headers: { accept: 'application/json' } })
    const after = await response.json() as {
      snapshot?: { models?: unknown[] }
      catalog?: Array<{ model: string; enabled: boolean }>
    }
    expect(after.snapshot?.models).toHaveLength(0)
    expect(after.catalog?.[0]).toMatchObject({ model: 'mock-model', enabled: false })

    expect(ctx.tools.get('model_status')).toBeDefined()
  })

  it('closes its listener and tool with the composition fiber', async () => {
    const ctx = await loadComposition(3600)
    await mountAgentLoopTestDependencies(ctx)
    const statusUrl = `http://127.0.0.1:${String(ctx.webServer.port)}/api/model-health`
    await ctx.fiber.dispose()
    context = undefined
    await expect(fetch(statusUrl)).rejects.toThrow()
  })
})
