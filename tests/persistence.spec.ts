import { mkdtempSync } from 'node:fs'
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
})