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
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { sanitizeFilterInput } from './filter.ts'
import type { ModelHealthFilter, ModelHealthRound } from './types.ts'

/** Retry/backoff/timing matches {@linkcode withFileLock} so this writer never
 *  fights a live `@deepseek-ai/dsh-atomic-write` contender for the same file. */
const LOCK_RETRY_INITIAL_MS = 20
const LOCK_RETRY_MAX_MS = 200
const LOCK_TIMEOUT_MS = 2_000

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
  await withReapingLock(filename, async () => {
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, payload)
  })
}

/**
 * Serialize one write the same way `@deepseek-ai/dsh-atomic-write`'s
 * {@linkcode withFileLock} does — `<file>.lock` created exclusively, held for
 * the operation, removed on both outcomes — but with one difference: a lock
 * whose recorded holder PID is no longer a live process is an orphan (the
 * writer crashed, or the host was hard-killed) and is reclaimed instead of
 * derailing every later write for the full {@linkcode LOCK_TIMEOUT_MS}. This is
 * the durability counterpart to {@linkcode loadPersistence} tolerating a crash:
 * a stale sibling would otherwise silently freeze persistence — the in-memory
 * store keeps showing live toggles while the document is never updated, so on
 * restart the user's settings appear to revert.
 *
 * Reclaiming never touches a lock held by a live PID, so it cannot damage a
 * currently-writing peer. A lock file whose PID is unreadable (empty or
 * malformed) is safest to leave alone: `@deepseek-ai/dsh-atomic-write` writes a
 * bare PID, so an unparsable one belongs to a different writer convention.
 * @param filename - the document being written.
 * @param operation - the read-render-commit cycle to run under the lock.
 */
async function withReapingLock(filename: string, operation: () => Promise<void>): Promise<void> {
  const lockPath = `${filename}.lock`
  await acquireLock(lockPath)
  try {
    await operation()
  } finally {
    await rm(lockPath, { force: true })
  }
}

/** Create the lock file, reclaiming a dead holder's lock when contention shows it. */
async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let delay = LOCK_RETRY_INITIAL_MS
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
      return
    } catch (error: unknown) {
      if (!isEEXIST(error)) throw error
    }
    if (await reclaimIfStale(lockPath)) continue
    if (Date.now() >= deadline) {
      throw new Error(`model-health: timed out waiting for the writer lock at ${lockPath}`)
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS)
  }
}

/** Remove the sibling lock if its recorded PID is provably gone; returns whether it was reclaimed. */
async function reclaimIfStale(lockPath: string): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(lockPath, 'utf8')
  } catch {
    return false // lock vanished (race) or unreadable; the next loop retries the create
  }
  const pid = Number(raw.trim())
  if (!Number.isSafeInteger(pid) || pid <= 0) return false // not our lock format; leave it
  if (isPidAlive(pid)) return false
  // Lock holder is dead — reclaim and let the caller retry the exclusive create.
  await rm(lockPath, { force: true }).catch(() => undefined)
  return true
}

/** Whether a PID maps to a live process. `EPERM` means it exists but is owned by another user (alive). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Whether an error is an exclusive-create collision. */
function isEEXIST(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST'
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