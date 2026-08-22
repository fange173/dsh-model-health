import { sanitizeFilterInput } from "./filter.js";
const ROUTE_ERROR_CODE = "MODEL_HEALTH_ROUTE";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
function parseFilterBody(value) {
  return sanitizeFilterInput(value);
}
function writeJson(res, status, body, head) {
  res.writeHead(status, head ? { ...JSON_HEADERS, "content-length": Buffer.byteLength(body) } : JSON_HEADERS);
  res.end(head ? void 0 : body);
}
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function buildView(deps) {
  return {
    config: deps.statusConfig,
    snapshot: deps.store.snapshot(),
    history: deps.store.history(),
    catalog: deps.store.catalog(),
    filter: deps.store.filter()
  };
}
function createModelHealthRouteHandler(deps) {
  return (req, res) => {
    const head = req.method === "HEAD";
    const method = head ? "GET" : req.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      res.writeHead(405, { ...JSON_HEADERS, "allow": "GET, HEAD, POST" });
      res.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET, HEAD, or POST." } }));
      return;
    }
    if (method === "POST") {
      return (async () => {
        const filter = await updatePost(deps, req);
        if (res.headersSent) return;
        writeJson(res, 200, JSON.stringify(filter), head);
      })().catch((error) => {
        if (res.headersSent) return;
        const message = error instanceof Error ? error.message : String(error);
        writeJson(res, 400, JSON.stringify({ error: { code: ROUTE_ERROR_CODE, message } }), head);
      });
    }
    const refresh = new URL(req.url ?? "/", "http://model-health.invalid").searchParams.get("refresh") === "1";
    return (async () => {
      if (refresh || deps.store.isEmpty()) {
        await deps.monitor.runNow();
      }
      writeJson(res, 200, JSON.stringify(buildView(deps)), head);
    })().catch((error) => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, 500, JSON.stringify({ error: { code: ROUTE_ERROR_CODE, message } }), head);
    });
  };
}
async function updatePost(deps, req) {
  const raw = await readRequestBody(req);
  let parsed;
  try {
    parsed = raw.length === 0 ? {} : JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
  }
  const filter = parseFilterBody(parsed);
  deps.monitor.setFilter(filter);
  await deps.monitor.runNow();
  return filter;
}
function registerModelHealthRoute(ctx, deps) {
  let mounted;
  let active = true;
  const mount = () => {
    if (!active) return;
    const webServer = ctx.get("webServer");
    if (webServer === void 0) return;
    mounted = webServer.register({
      kind: "exact",
      path: deps.path,
      handler: createModelHealthRouteHandler(deps)
    });
  };
  mount();
  ctx.effect(
    () => ctx.on("internal/service", (name) => {
      if (name === "webServer") mount();
    }),
    "model-health: webServer watch"
  );
  return () => {
    active = false;
    mounted?.();
    mounted = void 0;
  };
}
export {
  ROUTE_ERROR_CODE,
  createModelHealthRouteHandler,
  registerModelHealthRoute
};
