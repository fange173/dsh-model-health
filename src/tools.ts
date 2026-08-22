/**
 * Model-facing `model_status` tool over the in-memory probe store.
 * @module dsh-model-health
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { ModelHealthStore } from './store.ts'

const MODEL_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    name: { type: 'string', required: true },
    checkedAt: { type: 'string', required: true },
    ok: { type: 'boolean', required: true },
    ttftMs: { type: 'number' },
    totalMs: { type: 'number' },
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
        status: { type: 'integer' },
      },
    },
  },
} as const

const SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    checkedAt: { type: 'string' },
    models: { type: 'array', required: true, items: MODEL_RESULT_SCHEMA },
  },
} as const

const DESCRIPTION =
  'Report the latest connectivity and latency check for every model currently registered with a provider. '
  + 'Each result carries ok, time-to-first-token and total round-trip latency in milliseconds, the check '
  + 'timestamp, and the error code/status when the check failed. Set refresh true to run a fresh check of '
  + 'every model now instead of returning the latest results.'

/** Dependencies the tool reads. */
export interface ModelHealthToolDeps {
  readonly store: ModelHealthStore
  readonly runNow: () => Promise<void>
}

/**
 * Register the global `model_status` tool. Disposing the returned disposer
 * (or the plugin fiber) unregisters it.
 * @param ctx - context owning the tool runtime.
 * @param deps - store and round runner the tool reads.
 * @returns the registration disposer.
 */
export function registerModelHealthTool(ctx: Context, deps: ModelHealthToolDeps): () => void {
  return ctx.tools.register(defineTool({
    name: 'model_status',
    description: DESCRIPTION,
    parameters: {
      refresh: {
        type: 'boolean',
        description: 'When true, probe every registered model now and return those results; may take several seconds per model.',
      },
    },
    output: jsonOutput(SNAPSHOT_SCHEMA),
    async execute(args, _exec): Promise<InferValue<typeof SNAPSHOT_SCHEMA>> {
      if (args.refresh === true || deps.store.isEmpty()) {
        await deps.runNow()
      }
      return deps.store.snapshot()
    },
    presentCall: args => ({
      card: 'generic',
      title: args.refresh === true ? 'Check model status' : 'Model status',
      kind: 'read',
    }),
  }))
}

/** Declare one canonical output schema with compact model-facing JSON. */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}
