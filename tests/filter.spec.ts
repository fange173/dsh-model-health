import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTER,
  MAX_FILTER_ENTRIES,
  filterTargets,
  isModelEnabled,
  sanitizeFilterInput,
  setModelEnabled,
  setProviderEnabled,
} from '../src/filter.ts'
import type { ProbeTarget } from '../src/probe.ts'

function target(provider: string, model: string): ProbeTarget {
  return { provider, model, name: model }
}

describe('isModelEnabled', () => {
  it('enables everything under the empty filter', () => {
    expect(isModelEnabled(EMPTY_FILTER, 'p', 'm')).toBe(true)
  })

  it('disables a whole provider', () => {
    const filter = setProviderEnabled(EMPTY_FILTER, 'p', false)
    expect(isModelEnabled(filter, 'p', 'm')).toBe(false)
    expect(isModelEnabled(filter, 'q', 'm')).toBe(true)
  })

  it('disables an individual model while the provider stays on', () => {
    const filter = setModelEnabled(EMPTY_FILTER, 'p', 'm', false)
    expect(isModelEnabled(filter, 'p', 'm')).toBe(false)
    expect(isModelEnabled(filter, 'p', 'other')).toBe(true)
  })
})

describe('setProviderEnabled / setModelEnabled', () => {
  it('re-enabling a provider keeps individual model denylists intact', () => {
    const off = setProviderEnabled(EMPTY_FILTER, 'p', false)
    const filtered = setModelEnabled(off, 'p', 'm', false)
    const on = setProviderEnabled(filtered, 'p', true)
    expect(isModelEnabled(on, 'p', 'm')).toBe(false)
    expect(isModelEnabled(on, 'p', 'other')).toBe(true)
  })

  it('toggling is idempotent and list order is stable', () => {
    const one = setModelEnabled(EMPTY_FILTER, 'p', 'a', false)
    const two = setModelEnabled(one, 'p', 'b', false)
    const restored = setModelEnabled(two, 'p', 'a', true)
    expect(restored.disabledModels).toEqual(['p/b'])
  })
})

describe('filterTargets', () => {
  it('keeps only enabled targets in input order', () => {
    const filter = setProviderEnabled(EMPTY_FILTER, 'off', false)
    const targets = [target('on', 'a'), target('off', 'b'), target('on', 'c')]
    expect(filterTargets(targets, filter).map(t => `${t.provider}/${t.model}`)).toEqual(['on/a', 'on/c'])
  })

  it('passes everything through the empty filter', () => {
    const targets = [target('p', 'a'), target('p', 'b')]
    expect(filterTargets(targets, EMPTY_FILTER)).toHaveLength(2)
  })
})
describe('sanitizeFilterInput', () => {
  it('keeps only bounded non-empty strings', () => {
    const filter = sanitizeFilterInput({
      disabledProviders: ['p', 42, '', 'x'.repeat(500)],
      disabledModels: ['a/b', null],
    })
    expect(filter).toEqual({ disabledProviders: ['p'], disabledModels: ['a/b'] })
  })

  it('caps each denylist at the entry limit', () => {
    const flood = Array.from({ length: MAX_FILTER_ENTRIES + 50 }, (_, i) => `p/model-${String(i)}`)
    const filter = sanitizeFilterInput({ disabledModels: flood })
    expect(filter.disabledModels).toHaveLength(MAX_FILTER_ENTRIES)
  })

  it('de-duplicates entries so a hostile or double-applied body cannot bloat the denylist', () => {
    const filter = sanitizeFilterInput({ disabledModels: ['p/a', 'p/a', 'p/b', 'p/a'] })
    expect(filter.disabledModels).toEqual(['p/a', 'p/b'])
    const providers = sanitizeFilterInput({ disabledProviders: ['x', 'x', 'y'] })
    expect(providers.disabledProviders).toEqual(['x', 'y'])
  })

  it('answers the empty filter for non-object input', () => {
    expect(sanitizeFilterInput(null)).toEqual({})
    expect(sanitizeFilterInput('nope')).toEqual({})
    expect(sanitizeFilterInput({ disabledProviders: 'not-a-list' })).toEqual({})
  })
})
