var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};
import { createUserMessage, isTokenDelta } from "@deepseek-ai/dsh-llm";
import { deadline, timeoutOf } from "@deepseek-ai/dsh-timeout";
const PROBE_DEADLINE_CODE = "MODEL_HEALTH_PROBE";
async function listProbeTargets(ctx, providers = void 0, models = void 0) {
  const providerSet = providers !== void 0 && providers.length > 0 ? new Set(providers) : void 0;
  const modelSet = models !== void 0 && models.length > 0 ? new Set(models) : void 0;
  const targets = [];
  for (const provider of ctx.llm.listProviders()) {
    if (providerSet !== void 0 && !providerSet.has(provider.id)) continue;
    let modelsInfo;
    try {
      modelsInfo = await ctx.llm.listModels(provider.id);
    } catch (error) {
      ctx.logger.warn(`model-health: could not list models for provider "${provider.id}": ${renderThrown(error)}`);
      continue;
    }
    for (const model of modelsInfo) {
      if (modelSet !== void 0 && !modelSet.has(`${provider.id}/${model.id}`)) continue;
      targets.push({ provider: provider.id, model: model.id, name: model.name });
    }
  }
  return targets;
}
async function probeModel(ctx, target, options) {
  var _stack = [];
  try {
    const startedAt = Date.now();
    const checkedAt = new Date(startedAt).toISOString();
    let ttftMs;
    let totalMs;
    let usage;
    let error;
    let ok = false;
    let sawDelta = false;
    const probeDeadline = __using(_stack, deadline(void 0, options.probeTimeoutMs, PROBE_DEADLINE_CODE));
    const signal = probeDeadline.signal;
    try {
      const request = {
        provider: target.provider,
        model: target.model,
        messages: [createUserMessage({
          source: { kind: "user" },
          content: [{ type: "text", text: options.probePrompt }]
        })],
        maxTokens: options.probeMaxTokens,
        signal
      };
      for await (const chunk of ctx.llm.stream(request)) {
        if (isTokenDelta(chunk)) sawDelta = true;
        if (ttftMs === void 0 && isTokenDelta(chunk)) ttftMs = Date.now() - startedAt;
        if (chunk.type === "usage") {
          usage = {
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens
          };
          continue;
        }
        if (chunk.type !== "finish") continue;
        totalMs = Date.now() - startedAt;
        switch (chunk.reason.kind) {
          case "error":
          case "aborted":
            error = probeFailure(chunk.reason.failure, signal, options.probeTimeoutMs);
            break;
          default:
            ok = true;
        }
        break;
      }
      if (totalMs === void 0) {
        totalMs = Date.now() - startedAt;
        error = probeFailure(void 0, signal, options.probeTimeoutMs) ?? { code: "INCOMPLETE_STREAM", message: "the provider stream ended without a finish chunk" };
      }
    } catch (caught) {
      totalMs = Date.now() - startedAt;
      error = probeFailure(void 0, signal, options.probeTimeoutMs) ?? { code: "PROBE_EXCEPTION", message: renderThrown(caught) };
    }
    if (!ok && sawDelta && error?.code === "PROBE_TIMEOUT") {
      ok = true;
      error = void 0;
    }
    return {
      provider: target.provider,
      model: target.model,
      name: target.name,
      checkedAt,
      ok,
      ...ttftMs === void 0 ? {} : { ttftMs },
      // totalMs is assigned on every path above — stream finish, end-without-finish, and thrown error.
      totalMs,
      ...usage === void 0 ? {} : { usage },
      ...error === void 0 ? {} : { error }
    };
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}
function probeFailure(failure, signal, timeoutMs) {
  if (timeoutOf(signal, PROBE_DEADLINE_CODE) !== void 0) {
    return { code: "PROBE_TIMEOUT", message: `the model probe exceeded ${timeoutMs} ms` };
  }
  if (failure === void 0) return void 0;
  return {
    code: failure.code,
    message: failure.message,
    ...failure.status === void 0 ? {} : { status: failure.status }
  };
}
function renderThrown(value) {
  return value instanceof Error ? value.message : String(value);
}
async function runWithConcurrency(items, limit, run) {
  const results = new Array(items.length);
  const slots = items.entries();
  const take = () => {
    const next = slots.next();
    return next.done === true ? void 0 : { index: next.value[0], item: next.value[1] };
  };
  const worker = async () => {
    while (true) {
      const slot = take();
      if (slot === void 0) return;
      results[slot.index] = await run(slot.item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results.map((value, index) => {
    if (value === void 0) throw new Error(`model-health: probe ${index} produced no result`);
    return value;
  });
}
export {
  PROBE_DEADLINE_CODE,
  listProbeTargets,
  probeModel,
  runWithConcurrency
};
