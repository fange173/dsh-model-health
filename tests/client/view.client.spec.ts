import { describe, expect, it } from 'vitest'
import type { ModelCheckResult, ModelHealthFilter, ModelHealthRound } from 'dsh-model-health'
import {
  aggregateTone,
  buildTrendSeries,
  filterTrendSeries,
  formatLatency,
  groupByProvider,
  modelEnabled,
  providerEnabled,
  recency,
  resultTone,
  summarize,
  toggleModel,
  toggleProvider,
  TREND_DOT_CAP,
} from '../../src/client/view.ts'

function result(provider: string, model: string, overrides: Partial<ModelCheckResult> = {}): ModelCheckResult {
  return { provider, model, name: model, checkedAt: 't', ok: true, ...overrides }
}

function round(at: string, models: ModelCheckResult[]): ModelHealthRound {
  return { checkedAt: at, models }
}

describe('summarize', () => {
  it('counts healthy results and averages their total latency', () => {
    const summary = summarize([
      result('p', 'a', { totalMs: 100 }),
      result('p', 'b', { totalMs: 300 }),
      result('p', 'c', { ok: false, error: { code: 'AUTH', message: 'nope' } }),
    ])
    expect(summary).toEqual({ total: 3, ok: 2, failing: 1, avgTotalMs: 200 })
  })

  it('reports null average when nothing healthy answered', () => {
    expect(summarize([])).toEqual({ total: 0, ok: 0, failing: 0, avgTotalMs: null })
    expect(summarize([result('p', 'a', { ok: false })]).avgTotalMs).toBeNull()
  })
})

describe('aggregateTone', () => {
  it('maps data states onto dot severities', () => {
    expect(aggregateTone(null, false)).toBe('ongoing')
    expect(aggregateTone(null, true)).toBe('error')
    expect(aggregateTone({ total: 0, ok: 0, failing: 0, avgTotalMs: null }, false)).toBe('warning')
    expect(aggregateTone({ total: 2, ok: 2, failing: 0, avgTotalMs: null }, false)).toBe('done')
    expect(aggregateTone({ total: 2, ok: 1, failing: 1, avgTotalMs: null }, false)).toBe('warning')
    expect(aggregateTone({ total: 2, ok: 0, failing: 2, avgTotalMs: null }, false)).toBe('error')
  })
})

describe('groupByProvider', () => {
  it('groups consecutive models by provider preserving order', () => {
    const groups = groupByProvider([result('a', 'a1'), result('a', 'a2'), result('b', 'b1')])
    expect(groups.map(group => [group.provider, group.models.length])).toEqual([['a', 2], ['b', 1]])
  })

  it('answers an empty list for no models', () => {
    expect(groupByProvider([])).toEqual([])
  })
})

describe('buildTrendSeries', () => {
  it('keeps one series per model in first-seen order with rates over the full window', () => {
    const series = buildTrendSeries([
      round('t1', [result('p', 'a', { totalMs: 100 }), result('p', 'b', { totalMs: 200 })]),
      round('t2', [result('p', 'a', { ok: false, error: { code: 'PROBE_TIMEOUT', message: 'x' } }), result('p', 'b', { totalMs: 300 })]),
    ])
    expect(series.map(item => item.key)).toEqual(['p/a', 'p/b'])
    const [a, b] = series
    expect(a!.points).toHaveLength(2)
    expect(a!.okRate).toBe(50)
    expect(a!.avgTotalMs).toBe(100)
    expect(a!.points[1]).toMatchObject({ ok: false, code: 'PROBE_TIMEOUT' })
    expect(b!.okRate).toBe(100)
    expect(b!.avgTotalMs).toBe(250)
  })

  it('treats an all-failing set as error and an ok one with no latency as done', () => {
    expect(aggregateTone(summarize([
      result('p', 'a', { ok: false, error: { code: 'AUTH', message: 'x' } }),
    ]), false)).toBe('error')
    const bare = result('p', 'a', { ok: true })
    expect(aggregateTone(summarize([bare]), false)).toBe('done')
    expect(summarize([bare]).avgTotalMs).toBeNull()
  })

  it('keeps every point in the series; the component caps the strip', () => {
    const history = Array.from({ length: 5 }, (_, index) => round(`t${index}`, [result('p', 'a', { ok: true })]))
    const [item] = buildTrendSeries(history)
    expect(item!.points).toHaveLength(5)
    expect(item!.points[0]?.checkedAt).toBe('t0')
  })

  it('retains all points without touching rate math', () => {
    const count = TREND_DOT_CAP + 3
    const history = Array.from({ length: count }, (_, index) =>
      round(`t${index}`, [result('p', 'a', { ok: index % 2 === 0 })]))
    const [item] = buildTrendSeries(history)
    const okCount = Math.ceil(count / 2)
    expect(item!.points).toHaveLength(count)
    expect(item!.okRate).toBe(Math.round((okCount / count) * 100))
  })

  it('handles a model that only ever failed', () => {
    const [item] = buildTrendSeries([round('t1', [result('p', 'a', { ok: false, error: { code: 'AUTH', message: 'x' } })])])
    expect(item!.okRate).toBe(0)
    expect(item!.avgTotalMs).toBeNull()
  })

  it('answers an empty list for empty history', () => {
    expect(buildTrendSeries([])).toEqual([])
  })

  it('records a healthy point without latency as null and a failed point without an error as unknown', () => {
    const [item] = buildTrendSeries([
      round('t1', [result('p', 'a'), result('p', 'b', { ok: false })]),
    ])
    expect(item!.points[0]).toMatchObject({ ok: true, totalMs: null, code: null })
    expect(item!.avgTotalMs).toBeNull()
  })

  it('labels a failed point without error detail with the unknown code', () => {
    const [item] = buildTrendSeries([round('t1', [result('p', 'a', { ok: false })])])
    expect(item!.points[0]).toMatchObject({ ok: false, code: 'unknown' })
  })

  it('skips rounds a model did not appear in', () => {
    const [a, b] = buildTrendSeries([
      round('t1', [result('p', 'a'), result('p', 'b')]),
      round('t2', [result('p', 'a')]),
    ])
    expect(a!.points).toHaveLength(2)
    expect(b!.points).toHaveLength(1)
    expect(b!.model).toBe('b')
  })
})

describe('filterTrendSeries', () => {
  const series = buildTrendSeries([
    round('t1', [result('p', 'a'), result('q', 'b')]),
  ])

  it('drops series for models disabled individually or by provider', () => {
    const filtered = filterTrendSeries(series, { disabledModels: ['p/a'] })
    expect(filtered.map(item => item.key)).toEqual(['q/b'])

    expect(filterTrendSeries(series, { disabledProviders: ['q'] }).map(item => item.key)).toEqual(['p/a'])
  })

  it('keeps every series under the empty filter', () => {
    expect(filterTrendSeries(series, {}).map(item => item.key)).toEqual(['p/a', 'q/b'])
  })
})

describe('resultTone', () => {
  it('maps healthy to done and failed to error', () => {
    expect(resultTone(result('p', 'a'))).toBe('done')
    expect(resultTone(result('p', 'a', { ok: false }))).toBe('error')
  })
})

describe('formatLatency', () => {
  it('stays in milliseconds under a second and switches to seconds above', () => {
    expect(formatLatency(null)).toBe('—')
    expect(formatLatency(undefined)).toBe('—')
    expect(formatLatency(999)).toBe('999ms')
    expect(formatLatency(1000)).toBe('1.0s')
    expect(formatLatency(2340)).toBe('2.3s')
  })
})

describe('recency', () => {
  const now = Date.parse('2026-01-01T00:10:00.000Z')

  it('buckets absent and recent timestamps', () => {
    expect(recency(undefined, now)).toEqual({ kind: 'none' })
    expect(recency('2026-01-01T00:09:58.000Z', now)).toEqual({ kind: 'justNow' })
    expect(recency('2026-01-01T00:05:00.000Z', now)).toEqual({ kind: 'minutes', minutes: 5 })
    expect(recency('2025-12-31T22:10:00.000Z', now)).toEqual({ kind: 'hours', hours: 2 })
  })
})

describe('filter toggles', () => {
  const empty: ModelHealthFilter = {}

  it('disables and re-enables a provider', () => {
    const off = toggleProvider(empty, 'p')
    expect(providerEnabled(off, 'p')).toBe(false)
    expect(providerEnabled(toggleProvider(off, 'p'), 'p')).toBe(true)
  })

  it('disables one model without touching the provider or its siblings', () => {
    const filter = toggleModel(empty, 'p', 'a')
    expect(modelEnabled(filter, 'p', 'a')).toBe(false)
    expect(modelEnabled(filter, 'p', 'b')).toBe(true)
    expect(providerEnabled(filter, 'p')).toBe(true)
  })

  it('re-enabling a model under a disabled provider restores the provider too', () => {
    const providerOff = toggleProvider(empty, 'p')
    const reEnabled = toggleModel(providerOff, 'p', 'a')
    // One click re-enables: the checkbox renders unchecked (provider off), so the
    // toggle must go straight to enabled rather than disabling the model first.
    expect(providerEnabled(reEnabled, 'p')).toBe(true)
    expect(modelEnabled(reEnabled, 'p', 'a')).toBe(true)
  })

  it('re-enabling a model keeps an unrelated provider disabled', () => {
    const bothOff = toggleProvider(toggleProvider(empty, 'p'), 'q')
    const reEnabled = toggleModel(bothOff, 'p', 'a')
    expect(providerEnabled(reEnabled, 'p')).toBe(true)
    expect(providerEnabled(reEnabled, 'q')).toBe(false)
    expect(modelEnabled(reEnabled, 'p', 'a')).toBe(true)
  })

  it('toggling a model off and back on round-trips through a single click each', () => {
    const off = toggleModel(empty, 'p', 'a')
    expect(modelEnabled(off, 'p', 'a')).toBe(false)
    const on = toggleModel(off, 'p', 'a')
    expect(modelEnabled(on, 'p', 'a')).toBe(true)
    expect(providerEnabled(on, 'p')).toBe(true)
  })
})
