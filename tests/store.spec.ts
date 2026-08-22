import { describe, expect, it } from 'vitest'
import { ModelHealthStore, modelKey } from '../src/store.ts'
import type { ModelCheckResult } from '../src/types.ts'

function result(provider: string, model: string, overrides: Partial<ModelCheckResult> = {}): ModelCheckResult {
  return {
    provider,
    model,
    name: model,
    checkedAt: '2026-01-01T00:00:00.000Z',
    ok: true,
    ...overrides,
  }
}

describe('ModelHealthStore', () => {
  it('records and snapshots results in provider-then-model order', () => {
    const store = new ModelHealthStore()
    store.record(result('z', 'z2'))
    store.record(result('a', 'a1'))
    store.record(result('a', 'a2'))
    expect(store.snapshot().models.map(m => `${m.provider}/${m.model}`)).toEqual(['a/a1', 'a/a2', 'z/z2'])
  })

  it('omits checkedAt until a round is marked', () => {
    const store = new ModelHealthStore()
    expect(store.isEmpty()).toBe(true)
    expect(store.snapshot()).toEqual({ models: [] })
    store.record(result('a', 'a1'))
    expect(store.isEmpty()).toBe(false)
    store.markRound('2026-01-01T00:00:05.000Z')
    expect(store.snapshot()).toEqual({ checkedAt: '2026-01-01T00:00:05.000Z', models: [expect.objectContaining({ provider: 'a' })] })
  })

  it('reconcile drops results whose key the round no longer observed', () => {
    const store = new ModelHealthStore()
    store.record(result('a', 'a1'))
    store.record(result('b', 'b1'))
    store.reconcile(new Set([modelKey('b', 'b1')]))
    expect(store.snapshot().models.map(m => `${m.provider}/${m.model}`)).toEqual(['b/b1'])
  })

  it('retains one history round per markRound, oldest first', () => {
    const store = new ModelHealthStore(10)
    store.record(result('a', 'a1'))
    store.markRound('2026-01-01T00:00:01.000Z')
    store.record(result('b', 'b1'))
    store.markRound('2026-01-01T00:00:02.000Z')
    const history = store.history()
    expect(history.map(round => round.checkedAt)).toEqual([
      '2026-01-01T00:00:01.000Z',
      '2026-01-01T00:00:02.000Z',
    ])
    expect(history[0]!.models.map(m => m.model)).toEqual(['a1'])
    expect(history[1]!.models.map(m => m.model)).toEqual(['a1', 'b1'])
  })

  it('drops the oldest rounds past the history limit', () => {
    const store = new ModelHealthStore(2)
    store.markRound('t1')
    store.markRound('t2')
    store.markRound('t3')
    expect(store.history().map(round => round.checkedAt)).toEqual(['t2', 't3'])
  })

  it('retains no history when the limit is zero', () => {
    const store = new ModelHealthStore(0)
    store.markRound('t1')
    expect(store.history()).toEqual([])
    expect(store.snapshot().checkedAt).toBe('t1')
  })

  it('tracks the full catalog with enabled flags against the filter', () => {
    const store = new ModelHealthStore()
    store.setCatalog([{ provider: 'p', model: 'a', name: 'a' }, { provider: 'p', model: 'b', name: 'b' }])
    expect(store.catalog()).toEqual([
      { provider: 'p', model: 'a', name: 'a', enabled: true },
      { provider: 'p', model: 'b', name: 'b', enabled: true },
    ])
    store.setFilter({ disabledModels: ['p/a'] })
    expect(store.catalog()).toEqual([
      { provider: 'p', model: 'a', name: 'a', enabled: false },
      { provider: 'p', model: 'b', name: 'b', enabled: true },
    ])
  })

  it('filters disabled models out of the snapshot', () => {
    const store = new ModelHealthStore()
    store.record(result('p', 'a'))
    store.record(result('p', 'b'))
    store.setFilter({ disabledModels: ['p/a'] })
    expect(store.snapshot().models.map(m => m.model)).toEqual(['b'])
  })

  it('seeds retained history and derives the latest timestamp', () => {
    const store = new ModelHealthStore(10)
    store.seedHistory([
      { checkedAt: 't1', models: [result('a', 'a1')] },
      { checkedAt: 't2', models: [result('a', 'a1')] },
    ])
    expect(store.history().map(round => round.checkedAt)).toEqual(['t1', 't2'])
    expect(store.snapshot().checkedAt).toBe('t2')
  })

  it('seeds nothing when history is disabled', () => {
    const store = new ModelHealthStore(0)
    store.seedHistory([
      { checkedAt: 't1', models: [result('a', 'a1')] },
      { checkedAt: 't2', models: [result('a', 'a1')] },
    ])
    expect(store.history()).toEqual([])
    expect(store.snapshot().checkedAt).toBeUndefined()
  })
})
