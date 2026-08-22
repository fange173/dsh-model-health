import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CREDENTIAL_RETRY_DELAY_MS,
  DEFAULT_CREDENTIAL_RETRY_LIMIT,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_HTTP_PATH,
  resolveConfig,
} from '../src/index.ts'

describe('resolveConfig', () => {
  it('defaults the status surface to retained rounds and the /api/model-health path', () => {
    const resolved = resolveConfig({})
    expect(resolved.historyLimit).toBe(DEFAULT_HISTORY_LIMIT)
    expect(resolved.httpEnabled).toBe(true)
    expect(resolved.httpPath).toBe(DEFAULT_HTTP_PATH)
    expect(resolved.intervalSeconds).toBe(300)
    expect(resolved.intervalMs).toBe(300_000)
  })

  it('defaults the startup credential retry to a short delay and a small retry budget', () => {
    const resolved = resolveConfig({})
    expect(resolved.credentialRetryDelayMs).toBe(DEFAULT_CREDENTIAL_RETRY_DELAY_MS)
    expect(resolved.credentialRetryLimit).toBe(DEFAULT_CREDENTIAL_RETRY_LIMIT)
  })

  it('accepts explicit credential-retry values and a disabled retry', () => {
    expect(resolveConfig({ credentialRetryDelayMs: 1000, credentialRetryLimit: 5 }))
      .toMatchObject({ credentialRetryDelayMs: 1000, credentialRetryLimit: 5 })
    expect(resolveConfig({ credentialRetryLimit: 0 }).credentialRetryLimit).toBe(0)
  })

  it('rejects credential-retry values outside their bounds', () => {
    expect(() => resolveConfig({ credentialRetryDelayMs: 0 })).toThrow(/credentialRetryDelayMs/)
    expect(() => resolveConfig({ credentialRetryDelayMs: 2.5 })).toThrow(/credentialRetryDelayMs/)
    expect(() => resolveConfig({ credentialRetryLimit: -1 })).toThrow(/credentialRetryLimit/)
    expect(() => resolveConfig({ credentialRetryLimit: 1.5 })).toThrow(/credentialRetryLimit/)
  })

  it('accepts disabling history retention and the HTTP route independently', () => {
    const resolved = resolveConfig({ historyLimit: 0, httpEnabled: false, httpPath: '/status' })
    expect(resolved.historyLimit).toBe(0)
    expect(resolved.httpEnabled).toBe(false)
    expect(resolved.httpPath).toBe('/status')
  })

  it('rejects a historyLimit outside the retention bounds', () => {
    expect(() => resolveConfig({ historyLimit: -1 })).toThrow(/historyLimit/)
    expect(() => resolveConfig({ historyLimit: 201 })).toThrow(/historyLimit/)
    expect(() => resolveConfig({ historyLimit: 2.5 })).toThrow(/historyLimit/)
  })

  it('rejects an httpPath that is not a clean absolute pathname', () => {
    expect(() => resolveConfig({ httpPath: 'status' })).toThrow(/httpPath/)
    expect(() => resolveConfig({ httpPath: '/' })).toThrow(/httpPath/)
    expect(() => resolveConfig({ httpPath: '/a b' })).toThrow(/httpPath/)
    expect(() => resolveConfig({ httpPath: '/a?refresh=1' })).toThrow(/httpPath/)
    expect(() => resolveConfig({ httpPath: '/a/' })).toThrow(/httpPath/)
    expect(() => resolveConfig({ httpPath: '//a' })).toThrow(/httpPath/)
  })

  it('rejects an intervalSeconds outside its timer bounds', () => {
    expect(() => resolveConfig({ intervalSeconds: 0 })).toThrow(/intervalSeconds/)
    expect(() => resolveConfig({ intervalSeconds: 2147484 })).toThrow(/intervalSeconds/)
    expect(() => resolveConfig({ intervalSeconds: 1.5 })).toThrow(/intervalSeconds/)
    expect(resolveConfig({ intervalSeconds: 2147483 }).intervalMs).toBe(2147483000)
  })

  it('rejects a probeTimeoutMs outside the positive timer range', () => {
    expect(() => resolveConfig({ probeTimeoutMs: 0 })).toThrow(/probeTimeoutMs/)
    expect(() => resolveConfig({ probeTimeoutMs: -10 })).toThrow(/probeTimeoutMs/)
    expect(() => resolveConfig({ probeTimeoutMs: 2147483648 })).toThrow(/probeTimeoutMs/)
  })

  it('rejects a concurrency outside the worker bounds', () => {
    expect(() => resolveConfig({ concurrency: 0 })).toThrow(/concurrency/)
    expect(() => resolveConfig({ concurrency: 33 })).toThrow(/concurrency/)
    expect(() => resolveConfig({ concurrency: 1.5 })).toThrow(/concurrency/)
  })

  it('rejects an empty probePrompt and a non-positive token cap', () => {
    expect(() => resolveConfig({ probePrompt: '  ' })).toThrow(/probePrompt/)
    expect(() => resolveConfig({ probeMaxTokens: 0 })).toThrow(/probeMaxTokens/)
    expect(() => resolveConfig({ probeMaxTokens: 0.5 })).toThrow(/probeMaxTokens/)
  })

  it('deduplicates providers and models filters, treating empty arrays as unset', () => {
    expect(resolveConfig({ providers: ['a', 'a', 'b'] }).providers).toEqual(['a', 'b'])
    expect(resolveConfig({ providers: [] }).providers).toBeUndefined()
    expect(resolveConfig({ models: ['a/x', 'a/x'] }).models).toEqual(['a/x'])
    expect(resolveConfig({ models: [] }).models).toBeUndefined()
  })

  it('rejects empty or non-string filter entries', () => {
    expect(() => resolveConfig({ providers: [''] })).toThrow(/providers/)
    expect(() => resolveConfig({ models: ['no-slash'] })).toThrow(/models entry/)
  })
})
