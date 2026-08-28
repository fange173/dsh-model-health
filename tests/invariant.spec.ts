import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/invariant.ts'

describe('model-health-invariant companion', () => {
  it('registers the package as an invariant owner and resolves the disposer', async () => {
    const register = vi.fn().mockReturnValue(() => undefined)
    const ctx = { invariants: { register: register } } as any
    const dispose = await apply(ctx)
    expect(register).toHaveBeenCalledTimes(1)
    const firstCall = register.mock.calls[0]
    expect(firstCall?.[0]).toBe('dsh-model-health')
    expect(typeof firstCall?.[1]).toBe('function')
    expect(dispose).toBeTypeOf('function')
  })
})