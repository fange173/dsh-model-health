import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it } from 'vitest'
import {
  createModelHealthRouteHandler,
  registerModelHealthRoute,
  ROUTE_ERROR_CODE,
  type ModelHealthRouteDeps,
} from '../src/http.ts'
import { ModelHealthMonitor } from '../src/monitor.ts'
import { ModelHealthStore } from '../src/store.ts'
import type { ModelCheckResult, ModelHealthStatusView } from '../src/types.ts'

/** Minimal request stub matching the bits the handler reads. */
function request(method: string, url: string): IncomingMessage {
  return { method, url } as unknown as IncomingMessage
}

/** Request stub that emits a JSON body for POST handling. */
function postRequest(url: string, body: unknown): IncomingMessage {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  const listeners: Array<{ event: string; fn: (chunk?: Buffer) => void }> = []
  let req: IncomingMessage
  req = {
    method: 'POST',
    url,
    on(event: string, fn: (chunk?: Buffer) => void) { listeners.push({ event, fn }); return req },
    emit(event: string, chunk?: Buffer) {
      for (const entry of [...listeners]) { if (entry.event === event) entry.fn(chunk) }
    },
  } as unknown as IncomingMessage
  // Deliver the body and then end, as a real stream would.
  queueMicrotask(() => { req.emit('data', payload); req.emit('end') })
  return req
}

/**
 * Response stub capturing status, headers, and body; endThrows simulates a
 * client disconnect mid-body.
 */
interface CapturedAnswer {
  readonly status: number
  readonly headers: unknown
  readonly body: string | undefined
}

function response(endThrows = false): { res: ServerResponse; answer: () => CapturedAnswer } {
  const captured: { status: number; headers: unknown; body: string | undefined } = {
    status: 0, headers: undefined, body: undefined,
  }
  const res = {
    headersSent: false,
    writeHead(this: { headersSent: boolean }, status: number, headers: unknown) {
      captured.status = status
      captured.headers = headers
      this.headersSent = true
      return this
    },
    end(body?: string) {
      if (endThrows) throw new Error('socket closed')
      captured.body = body
      return res as unknown as ServerResponse
    },
  } as unknown as ServerResponse
  return { res, answer: () => captured }
}

/** Monitor double: counts forced rounds and captures filter changes instead of probing anything. */
function monitorDouble(): { monitor: ModelHealthMonitor; runs: () => number; lastFilter: () => unknown } {
  let runs = 0
  let last: unknown
  const monitor = {
    runNow: () => { runs += 1; return Promise.resolve() },
    setFilter: (filter: unknown) => { last = filter; runs += 1 },
  } as unknown as ModelHealthMonitor
  return { monitor, runs: () => runs, lastFilter: () => last }
}

function deps(store: ModelHealthStore): { deps: ModelHealthRouteDeps; runs: () => number; lastFilter: () => unknown } {
  const { monitor, runs, lastFilter } = monitorDouble()
  return {
    deps: {
      store,
      monitor,
      path: '/api/model-health',
      statusConfig: { intervalSeconds: 300, historyLimit: 40 },
    },
    runs,
    lastFilter,
  }
}

function result(model: string, overrides: Partial<ModelCheckResult> = {}): ModelCheckResult {
  return { provider: 'p', model, name: model, checkedAt: 't', ok: true, ...overrides }
}

describe('createModelHealthRouteHandler', () => {
  it('serves the snapshot and history as JSON for GET', async () => {
    const store = new ModelHealthStore(5)
    store.record(result('a'))
    store.markRound('2026-01-01T00:00:00.000Z')
    const { res, answer } = response()
    await createModelHealthRouteHandler(deps(store).deps)(request('GET', '/api/model-health'), res)
    const { status, headers, body } = answer()
    expect(status).toBe(200)
    expect(headers).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    const view = JSON.parse(body!) as ModelHealthStatusView
    expect(view.config).toEqual({ intervalSeconds: 300, historyLimit: 40 })
    expect(view.snapshot.checkedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(view.snapshot.models).toHaveLength(1)
    expect(view.history).toHaveLength(1)
    expect(view.history[0]?.checkedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('runs a fresh round when the store is still empty', async () => {
    const store = new ModelHealthStore(5)
    const { deps: routeDeps, runs } = deps(store)
    await createModelHealthRouteHandler(routeDeps)(request('GET', '/api/model-health'), response().res)
    expect(runs()).toBe(1)
  })

  it('re-probes on ?refresh=1 even when data exists', async () => {
    const store = new ModelHealthStore(5)
    store.record(result('a'))
    const { deps: routeDeps, runs } = deps(store)
    await createModelHealthRouteHandler(routeDeps)(
      request('GET', '/api/model-health?refresh=1'),
      response().res,
    )
    expect(runs()).toBe(1)
  })

  it('leaves the body empty for HEAD while mirroring Content-Length', async () => {
    const store = new ModelHealthStore(5)
    store.record(result('a'))
    const { res, answer } = response()
    await createModelHealthRouteHandler(deps(store).deps)(request('HEAD', '/api/model-health'), res)
    expect(answer().status).toBe(200)
    expect(answer().body).toBeUndefined()
    const headers = answer().headers as Record<string, string | number>
    expect(String(headers['content-type'])).toContain('application/json')
    expect(Number(headers['content-length'])).toBeGreaterThan(0)
  })

  it('rejects unsupported methods with 405 and the Allow header', async () => {
    const { res, answer } = response()
    await createModelHealthRouteHandler(deps(new ModelHealthStore()).deps)(request('DELETE', '/api/model-health'), res)
    expect(answer().status).toBe(405)
    expect(answer().headers).toMatchObject({ 'allow': 'GET, HEAD, POST' })
    expect(JSON.parse(answer().body!)).toEqual({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET, HEAD, or POST.' },
    })
  })

  it('applies a POSTed filter and answers with the accepted selection', async () => {
    const store = new ModelHealthStore(5)
    store.record(result('a'))
    const { deps: routeDeps, lastFilter } = deps(store)
    const { res, answer } = response()
    await createModelHealthRouteHandler(routeDeps)(
      postRequest('/api/model-health', { disabledProviders: ['p'], disabledModels: ['p/x'] }),
      res,
    )
    expect(answer().status).toBe(200)
    expect(JSON.parse(answer().body!)).toEqual({
      disabledProviders: ['p'],
      disabledModels: ['p/x'],
    })
    expect(lastFilter()).toEqual({ disabledProviders: ['p'], disabledModels: ['p/x'] })
  })

  it('answers 500 with a stable error code when serving throws', async () => {
    const failing = {
      runNow: () => Promise.reject(new Error('boom')),
    } as unknown as ModelHealthMonitor
    const routeDeps: ModelHealthRouteDeps = {
      store: new ModelHealthStore(),
      monitor: failing,
      path: '/api/model-health',
      statusConfig: { intervalSeconds: 300, historyLimit: 40 },
    }
    const { res, answer } = response()
    await createModelHealthRouteHandler(routeDeps)(request('GET', '/api/model-health'), res)
    expect(answer().status).toBe(500)
    const payload = JSON.parse(answer().body!) as { readonly error: { readonly code: string; readonly message: string } }
    expect(payload.error.code).toBe(ROUTE_ERROR_CODE)
    expect(payload.error.message).toBe('boom')
  })

  it('answers the 500 head-empty for HEAD when the forced round throws', async () => {
    const failing = {
      runNow: () => Promise.reject(new Error('boom')),
    } as unknown as ModelHealthMonitor
    const routeDeps: ModelHealthRouteDeps = {
      store: new ModelHealthStore(),
      monitor: failing,
      path: '/api/model-health',
      statusConfig: { intervalSeconds: 300, historyLimit: 40 },
    }
    const { res, answer } = response()
    await createModelHealthRouteHandler(routeDeps)(request('HEAD', '/api/model-health'), res)
    expect(answer().status).toBe(500)
    expect(answer().body).toBeUndefined()
  })

  it('serves GETs whose url property Node may leave undefined for malformed requests', async () => {
    const store = new ModelHealthStore()
    store.record(result('a'))
    const { res, answer } = response()
    const req = { method: 'GET', url: undefined, headers: {} } as unknown as IncomingMessage
    await createModelHealthRouteHandler(deps(store).deps)(req, res)
    expect(answer().status).toBe(200)
  })

  it('renders a non-Error route failure verbatim', async () => {
    const failing = {
      // oxlint-disable-next-line prefer-promise-reject-errors -- the test drives the non-Error verbatim-render contract.
      runNow: () => Promise.reject('store went away'),
    } as unknown as ModelHealthMonitor
    const routeDeps: ModelHealthRouteDeps = {
      store: new ModelHealthStore(),
      monitor: failing,
      path: '/api/model-health',
      statusConfig: { intervalSeconds: 300, historyLimit: 40 },
    }
    const { res, answer } = response()
    await createModelHealthRouteHandler(routeDeps)(request('GET', '/api/model-health'), res)
    const payload = JSON.parse(answer().body!) as { readonly error: { readonly message: string } }
    expect(payload.error.message).toBe('store went away')
  })

  it('stays silent when the socket dies mid-body on a successful answer', async () => {
    // writeHead(200) has already gone out when end() throws, so the 500 path
    // must not attempt a second status — there is nothing left to negotiate.
    const store = new ModelHealthStore()
    store.record(result('a'))
    const { res, answer } = response(true)
    await createModelHealthRouteHandler(deps(store).deps)(request('GET', '/api/model-health'), res)
    expect(answer().status).toBe(200)
    expect(answer().body).toBeUndefined()
  })
})

describe('registerModelHealthRoute (webServer watch)', () => {
  interface RegisteredRoute {
    readonly kind: string
    readonly path: string
    readonly handler: unknown
  }

  /** Web-server double exposing registration/unregistration counts. */
  function webServerSpy(): { server: WebServer; calls: RegisteredRoute[]; unregistered: () => number } {
    const calls: RegisteredRoute[] = []
    let unregistered = 0
    const server = {
      register(route: RegisteredRoute) {
        calls.push(route)
        return () => { unregistered += 1 }
      },
    } as unknown as WebServer
    return { server, calls, unregistered: () => unregistered }
  }

  it('registers the exact route immediately when the server already exists', () => {
    const { server, calls, unregistered } = webServerSpy()
    const ctx = new Context()
    ctx.provide('webServer', server)
    const dispose = registerModelHealthRoute(ctx, deps(new ModelHealthStore()).deps)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ kind: 'exact', path: '/api/model-health' })
    dispose()
    expect(unregistered()).toBe(1)
  })

  it('pins the provide-once rule that justifies a watch without a remount path', () => {
    // Cordis throws when a same-name service is provided on a live setup; the
    // route watch therefore never has to re-register a mounted route.
    const { server } = webServerSpy()
    const ctx = new Context()
    registerModelHealthRoute(ctx, deps(new ModelHealthStore()).deps)
    ctx.provide('webServer', server)
    expect(() => { ctx.provide('webServer', server) }).toThrow()
  })

  it('defers registration until the server is provided', () => {
    const { server, calls } = webServerSpy()
    const ctx = new Context()
    registerModelHealthRoute(ctx, deps(new ModelHealthStore()).deps)
    expect(calls).toHaveLength(0)
    // An unrelated service event must not wake the watch.
    ctx.provide('rpc' as never, {} as never)
    expect(calls).toHaveLength(0)
    ctx.provide('webServer', server)
    expect(calls).toHaveLength(1)
  })

  it('stays quiet after dispose even when the server arrives later', () => {
    const { server, calls } = webServerSpy()
    const ctx = new Context()
    const dispose = registerModelHealthRoute(ctx, deps(new ModelHealthStore()).deps)
    dispose()
    ctx.provide('webServer', server)
    expect(calls).toHaveLength(0)
  })
})
