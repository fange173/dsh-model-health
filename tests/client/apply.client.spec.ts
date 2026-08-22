import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../../src/index.ts'
import { ModelHealthFooterAction, ModelHealthHeaderAction } from '../../src/client/ModelHealthAction.tsx'
import { NS, zh } from '../../src/client/locales.ts'
import type { HealthPosition } from '../../src/client/controller.ts'

interface RegisterOptions {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly locale?: string
  readonly inject?: () => unknown
}

interface RegisterCall {
  readonly options: RegisterOptions
  readonly component: unknown
  disposed: boolean
}

/**
 * Slot registry double that resolves inject() immediately and records every
 * register/withdraw, standing in for the shell's slot declarations.
 */
function slotsDouble() {
  const registers: RegisterCall[] = []
  const listeners: Record<string, Array<() => void>> = {}
  return {
    registers,
    slots: {
      inject(_key: string, callback: () => () => void): () => void {
        const dispose = callback()
        return dispose
      },
      register(options: RegisterOptions, component: unknown): () => void {
        const call: RegisterCall = { options, component, disposed: false }
        registers.push(call)
        return () => { call.disposed = true }
      },
      onDeclared(name: string, cb: () => void) { (listeners[name] ??= []).push(cb) },
      // Real API — extra members kept inert for the double.
      declare: () => () => undefined,
      entries: () => [],
    },
  }
}

/** ClientContext double hosting locale registration, slots, and lifecycle effects. */
function ctxDouble() {
  const { slots, registers } = slotsDouble()
  const localeRegisters: Array<{ name: string; zh: unknown; en: unknown }> = []
  const effects: Array<() => void> = []
  const ctx = {
    locale: {
      register(name: string, dicts: { zh: unknown; en: unknown }): () => void {
        localeRegisters.push({ name, ...dicts })
        return () => undefined
      },
    },
    slots,
    effect(disposer: () => unknown, _label?: string): void {
      const produced = disposer()
      if (typeof produced === 'function') effects.push(produced as () => void)
    },
    scope: { run: (cb: () => void) => { cb() } },
  }
  return {
    // The double satisfies the service surface apply reads; typed off the
    // exact ctx classes via the hook imports would drag the whole registry in.
    ctx: ctx as unknown as ClientContext,
    registers,
    localeRegisters,
    disposeEffects: () => { for (const effect of effects.splice(0)) effect() },
  }
}

describe('model-health client apply', () => {
  beforeEach(() => {
    // Keep the auto-refresh loop inert: fetches hang, timers and microtasks drive time.
    vi.stubGlobal('fetch', () => new Promise(() => {}))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('declares its service requirements and registers a chip at the default header seat', () => {
    expect(inject).toEqual(['slots', 'locale'])
    const { ctx, registers, localeRegisters } = ctxDouble()
    apply(ctx)
    expect(localeRegisters).toHaveLength(1)
    expect(localeRegisters[0]?.name).toBe(NS)
    expect(localeRegisters[0]?.zh).toBe(zh)
    expect(registers).toHaveLength(1)
    expect(registers[0]?.options).toMatchObject({
      name: 'conversation.session.header.actions',
      id: 'model-health',
      order: 40,
      locale: NS,
    })
    expect(registers[0]?.component).toBe(ModelHealthHeaderAction)
  })

  it('re-mounts the chip when the user switches seats, and unwinds everything at disposal', () => {
    const { ctx, registers, disposeEffects } = ctxDouble()
    apply(ctx)
    expect(registers).toHaveLength(1)

    const face = registers[0]?.options.inject?.() as {
      setPosition: (position: HealthPosition) => void
      setRefreshSeconds: (seconds: number) => void
      refresh: () => void
    }
    face.setPosition('sidebar')
    expect(registers).toHaveLength(2)
    expect(registers[0]?.disposed).toBe(true)
    expect(registers[1]?.options.name).toBe('sidebar.footer.action')
    expect(registers[1]?.component).toBe(ModelHealthFooterAction)

    // Re-selecting the current seat unsubscribes nothing and re-registers nothing.
    face.setPosition('sidebar')
    expect(registers).toHaveLength(2)

    // The auto-refresh and refresh face callbacks both reach the same controller.
    face.setRefreshSeconds(60)
    expect(vi.getTimerCount()).toBe(1)
    face.refresh()

    face.setPosition('header')
    expect(registers).toHaveLength(3)
    expect(registers[1]?.disposed).toBe(true)

    disposeEffects()
    expect(registers[2]?.disposed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts a refresh cadence once mounted', async () => {
    const { ctx } = ctxDouble()
    apply(ctx)
    // Auto-refresh interval defaults to 300s: arming proves the loop started
    // even though every fetch stays inert behind the hanging stub.
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(300_000)
    // The tick fired into the in-flight-hanging fetch; a new arm follows only
    // after that fetch settles, so nothing lingers in the meantime.
    expect(vi.getTimerCount()).toBe(0)
  })
})
