/**
 * Optional durable persistence for the model-health plugin. Keeps the probe
 * history and the enabled-model filter in one JSON document under the
 * harness home (`~/.dsH/model-health.json` by default) so a restart does not
 * wipe a user's accumulated trend or their model selection. Failure to read or
 * write is a diagnostic, never fatal: the store keeps running in memory.
 * @module dsh-model-health
 */

import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { sanitizeFilterInput } from './filter.ts'
import type { ModelHealthFilter, ModelHealthRound } from './types.ts'

/** Default file name under the harness home. */
export const DEFAULT_PERSIST_FILE = 'model-health.json'

/** The persisted document: retained rounds plus the enabled-model selection. */
export interface ModelHealthPersistence {
  /** Retained probe rounds, oldest first, bounded by the configured historyLimit. */
  readonly rounds: readonly ModelHealthRound[]
  /** The user's enabled selection, or undefined when they have never chosen (default all enabled). */
  readonly filter?: ModelHealthFilter
  /** ISO timestamp of the last write; informational only. */
  readonly writtenAt?: string
}

/** Construction facts for the persistence facade. */
export interface PersistenceOptions {
  /** Absolute file path to persist to; defaults to `<dshHome>/model-health.json`. */
  readonly filename?: string
}

/**
 * Load the persisted document, tolerating an absent or malformed file.
 * @param opts - optional custom filename.
 * @returns the parsed document, or an empty one when nothing durable is readable.
 */
export async function loadPersistence(opts: PersistenceOptions = {}): Promise<ModelHealthPersistence> {
  const filename = resolveFilename(opts)
  try {
    const raw = await readFile(filename, 'utf8')
    const parsed = JSON.parse(raw) as Partial<ModelHealthPersistence>
    return {
      rounds: Array.isArray(parsed.rounds) ? (parsed.rounds as ModelHealthRound[]) : [],
      ...isFilter(parsed.filter) ? { filter: sanitizeFilterInput(parsed.filter) } : {},
      ...typeof parsed.writtenAt === 'string' ? { writtenAt: parsed.writtenAt } : {},
    }
  } catch (error: unknown) {
    if (isMissing(error)) return { rounds: [] }
    throw error
  }
}

/**
 * Write a durable snapshot under a writer lock so concurrent writers do not
 * corrupt the document.
 * @param snapshot - rounds + optional enabled selection.
 * @param opts - optional custom filename.
 */
export async function savePersistence(snapshot: ModelHealthPersistence, opts: PersistenceOptions = {}): Promise<void> {
  const filename = resolveFilename(opts)
  const payload = JSON.stringify({
    ...snapshot,
    writtenAt: new Date().toISOString(),
  } satisfies ModelHealthPersistence, null, 2)
  await withFileLock(filename, async () => {
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, payload)
  })
}

/** Resolve the persistence path, honouring an override. */
function resolveFilename(opts: PersistenceOptions): string {
  return opts.filename ?? dshHomePath(DEFAULT_PERSIST_FILE)
}

/** Whether an unknown value looks like a filter object (no throw). */
function isFilter(value: unknown): value is ModelHealthFilter {
  return typeof value === 'object' && value !== null
}

/** Whether an fs error means the file does not exist (a normal first run). */
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
}