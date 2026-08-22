/**
 * Local HTTP status route for the model-health plugin. Serves the current
 * snapshot, retained probe rounds, full model catalog, and the enabled filter
 * as JSON for a same-origin browser consumer; `?refresh=1` runs a full probe
 * round before answering. A `POST` to the same path updates the enabled-model
 * selection (from the browser settings panel) and returns the accepted filter.
 * @module dsh-model-health
 */
import { sanitizeFilterInput } from "./filter.js";
/** Stable machine code a consumer can match on a structured route error. */
export const ROUTE_ERROR_CODE = 'MODEL_HEALTH_ROUTE';
const JSON_HEADERS = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
};
/** Validate that an unknown value is a plausible enabled-filter body. */
function parseFilterBody(value) {
    return sanitizeFilterInput(value);
}
/** Write one JSON status/error pair onto the response; HEAD mirrors GET's Content-Length with an empty body. */
function writeJson(res, status, body, head) {
    res.writeHead(status, head ? { ...JSON_HEADERS, 'content-length': Buffer.byteLength(body) } : JSON_HEADERS);
    res.end(head ? undefined : body);
}
/** Read the request body as text (bounded), for POST filter sync. */
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 64 * 1024) {
                req.destroy();
                reject(new Error('request body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
function buildView(deps) {
    return {
        config: deps.statusConfig,
        snapshot: deps.store.snapshot(),
        history: deps.store.history(),
        catalog: deps.store.catalog(),
        filter: deps.store.filter(),
    };
}
/**
 * Build the route handler. GET/HEAD on a store with no data runs a probe round
 * so early page visits see real results; `?refresh=1` forces one. POST reads a
 * filter body, applies it, and answers with the accepted filter. A failed GET
 * round answers with the last known snapshot rather than an error — only a
 * genuinely thrown servo failure is a 500.
 * @param deps - store, round runner, and echoed config.
 * @returns the web-server route handler.
 */
export function createModelHealthRouteHandler(deps) {
    return (req, res) => {
        const head = req.method === 'HEAD';
        const method = head ? 'GET' : req.method ?? 'GET';
        if (method !== 'GET' && method !== 'POST') {
            res.writeHead(405, { ...JSON_HEADERS, 'allow': 'GET, HEAD, POST' });
            res.end(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET, HEAD, or POST.' } }));
            return;
        }
        if (method === 'POST') {
            return (async () => {
                const filter = await updatePost(deps, req);
                if (res.headersSent)
                    return;
                writeJson(res, 200, JSON.stringify(filter), head);
            })().catch((error) => {
                if (res.headersSent)
                    return;
                const message = error instanceof Error ? error.message : String(error);
                writeJson(res, 400, JSON.stringify({ error: { code: ROUTE_ERROR_CODE, message } }), head);
            });
        }
        const refresh = new URL(req.url ?? '/', 'http://model-health.invalid').searchParams.get('refresh') === '1';
        return (async () => {
            if (refresh || deps.store.isEmpty()) {
                await deps.monitor.runNow();
            }
            writeJson(res, 200, JSON.stringify(buildView(deps)), head);
        })().catch((error) => {
            if (res.headersSent)
                return;
            const message = error instanceof Error ? error.message : String(error);
            writeJson(res, 500, JSON.stringify({ error: { code: ROUTE_ERROR_CODE, message } }), head);
        });
    };
}
/** Apply a POSTed filter body and echo the accepted selection. */
async function updatePost(deps, req) {
    const raw = await readRequestBody(req);
    let parsed;
    try {
        parsed = raw.length === 0 ? {} : JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
    }
    const filter = parseFilterBody(parsed);
    deps.monitor.setFilter(filter);
    // setFilter already started a round; coalescing hands back that exact round,
    // so the response (and the client's follow-up read) carries fresh coverage.
    await deps.monitor.runNow();
    return filter;
}
/**
 * Register the status route on the host web server whenever one exists, and a
 * POST side-effect route at the same path if requested. See {@link registerModelHealthRoute}.
 */
export function registerModelHealthRoute(ctx, deps) {
    let mounted;
    let active = true;
    const mount = () => {
        if (!active)
            return;
        const webServer = ctx.get('webServer');
        if (webServer === undefined)
            return;
        mounted = webServer.register({
            kind: 'exact',
            path: deps.path,
            handler: createModelHealthRouteHandler(deps),
        });
    };
    mount();
    ctx.effect(() => ctx.on('internal/service', (name) => {
        if (name === 'webServer')
            mount();
    }), 'model-health: webServer watch');
    return () => {
        active = false;
        mounted?.();
        mounted = undefined;
    };
}
//# sourceMappingURL=http.js.map