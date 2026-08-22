import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPersistence, savePersistence } from '../src/persistence.ts'
import type { ModelHealthFilter } from '../src/types.ts'

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-health-persist-'))
  return join(dir, 'state.json')
}

describe('persistence', () => {
  it('round-trips rounds and the enabled filter', async () => {
    const file = tempFile()
    const filter: ModelHealthFilter = { disabledProviders: ['p'], disabledModels: ['q/x'] }
    await savePersistence({
      rounds: [{ checkedAt: 't1', models: [] }],
      filter,
    }, { filename: file })

    const loaded = await loadPersistence({ filename: file })
    expect(loaded.rounds).toEqual([{ checkedAt: 't1', models: [] }])
    expect(loaded.filter).toEqual(filter)
  })

  it('returns an empty document when the file does not exist', async () => {
    const loaded = await loadPersistence({ filename: tempFile() })
    expect(loaded.rounds).toEqual([])
    expect(loaded.filter).toBeUndefined()
  })

  it('drops non-string entries from a malformed filter', async () => {
    const file = tempFile()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, JSON.stringify({
      rounds: [],
      filter: { disabledProviders: ['p', 42, ''], disabledModels: ['a/b', null] },
    }))
    const loaded = await loadPersistence({ filename: file })
    expect(loaded.filter).toEqual({ disabledProviders: ['p'], disabledModels: ['a/b'] })
  })

  it('reclaims a stale lock whose holder PID is dead, so a write still lands', async () => {
    const file = tempFile()
    const lockPath = `${file}.lock`
    // Simulate a crashed previous writer: a lock file records its holder PID
    // and the process is gone (an absurdly high, unlikely-live PID).
    writeFileSync(lockPath, `${Number.MAX_SAFE_INTEGER - 100}\n`)
    await savePersistence({ rounds: [{ checkedAt: 't2', models: [] }] }, { filename: file })

    const { readFile, access } = await import('node:fs/promises')
    const written = JSON.parse(await readFile(file, 'utf8'))
    expect(written.rounds).toEqual([{ checkedAt: 't2', models: [] }])
    // Lock removed after the write; the orphaned sibling no longer blocks.
    await expect(access(`${file}.lock`)).rejects.toThrow()
  })

  it('does not reclaim a lock held by a live process (waits then times out)', async () => {
    const file = tempFile()
    // Record our own PID (definitely live) in the lock, then the write must
    // not reclaim or succeed within the brief timeout.
    writeFileSync(`${file}.lock`, `${process.pid}\n`)
    const { access } = await import('node:fs/promises')
    await expect(
      savePersistence({ rounds: [] }, { filename: file }),
    ).rejects.toThrow(/writer lock/)
    await expect(access(`${file}.lock`)).resolves.toBeUndefined()
  }, 10_000)
})