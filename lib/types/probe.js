/**
 * Probe execution: enumerate the currently registered provider/model routes,
 * run one bounded minimal round-trip per model, and classify the outcome.
 * @module dsh-model-health
 */
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';
/** Whether a stream chunk carries generated content (text, reasoning, or tool args). */
function isTokenChunk(chunk) {
    switch (chunk.type) {
        case 'text-delta':
        case 'reasoning-delta':
            return chunk.text !== '';
        case 'tool-call-delta':
            return chunk.argumentsDelta !== '' || chunk.name !== undefined;
        default:
            return false;
    }
}
/** Capability-owned timeout code stamped on each probe's deadline (distinct from the 'PROBE_TIMEOUT' wire result code it causes). */
export const PROBE_DEADLINE_CODE = 'MODEL_HEALTH_PROBE';
/**
 * Enumerate every model the runtime currently advertises, from the registered
 * provider routes and each adapter's advisory catalog. A provider whose
 * catalog cannot be listed is skipped with a diagnostic, never fatal. When
 * `providers` or `models` is set, targets outside those whitelists are dropped.
 * @param ctx - global context owning the llm runtime.
 * @param providers - provider ids to keep; undefined keeps all.
 * @param models - `provider/model` pairs to keep; undefined keeps all within the provider filter.
 * @returns probe targets in provider-then-catalog order.
 */
export async function listProbeTargets(ctx, providers = undefined, models = undefined) {
    const providerSet = providers !== undefined && providers.length > 0 ? new Set(providers) : undefined;
    const modelSet = models !== undefined && models.length > 0 ? new Set(models) : undefined;
    const targets = [];
    for (const provider of ctx.llm.listProviders()) {
        if (providerSet !== undefined && !providerSet.has(provider.id))
            continue;
        let modelsInfo;
        try {
            modelsInfo = await ctx.llm.listModels(provider.id);
        }
        catch (error) {
            ctx.logger.warn(`model-health: could not list models for provider "${provider.id}": ${renderThrown(error)}`);
            continue;
        }
        for (const model of modelsInfo) {
            if (modelSet !== undefined && !modelSet.has(`${provider.id}/${model.id}`))
                continue;
            targets.push({ provider: provider.id, model: model.id, name: model.name });
        }
    }
    return targets;
}
/**
 * Run one bounded minimal round-trip against a model and classify it into an
 * `ok` result with latency, or a failure with provider facts. The deadline
 * only notifies through the request signal; the adapter owns closing the
 * stream when it aborts.
 * @param ctx - global context owning the llm runtime.
 * @param target - provider/model route to probe.
 * @param options - timing and request facts.
 * @returns the detached, single-probe outcome.
 */
export async function probeModel(ctx, target, options) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const startedAt = Date.now();
        const checkedAt = new Date(startedAt).toISOString();
        let ttftMs;
        let totalMs;
        let usage;
        let error;
        let ok = false;
        let sawDelta = false;
        const probeDeadline = __addDisposableResource(env_1, deadline(undefined, options.probeTimeoutMs, PROBE_DEADLINE_CODE), false);
        const signal = probeDeadline.signal;
        try {
            const request = {
                provider: target.provider,
                model: target.model,
                messages: [createUserMessage({
                        source: { kind: 'user' },
                        content: [{ type: 'text', text: options.probePrompt }],
                    })],
                maxTokens: options.probeMaxTokens,
                signal,
            };
            for await (const chunk of ctx.llm.stream(request)) {
                if (isTokenChunk(chunk))
                    sawDelta = true;
                if (ttftMs === undefined && isTokenChunk(chunk))
                    ttftMs = Date.now() - startedAt;
                if (chunk.type === 'usage') {
                    usage = {
                        inputTokens: chunk.usage.inputTokens,
                        outputTokens: chunk.usage.outputTokens,
                    };
                    continue;
                }
                if (chunk.type !== 'finish')
                    continue;
                totalMs = Date.now() - startedAt;
                switch (chunk.reason.kind) {
                    case 'error':
                    case 'aborted':
                        error = probeFailure(chunk.reason.failure, signal, options.probeTimeoutMs);
                        break;
                    default:
                        // stop, max-tokens, tool-calls, and any finish kind a plugin adds:
                        // a terminal response that is not a known failure counts as connected.
                        ok = true;
                }
                break;
            }
            if (totalMs === undefined) {
                totalMs = Date.now() - startedAt;
                error = probeFailure(undefined, signal, options.probeTimeoutMs)
                    ?? { code: 'INCOMPLETE_STREAM', message: 'the provider stream ended without a finish chunk' };
            }
        }
        catch (caught) {
            totalMs = Date.now() - startedAt;
            error = probeFailure(undefined, signal, options.probeTimeoutMs)
                ?? { code: 'PROBE_EXCEPTION', message: renderThrown(caught) };
        }
        // A slow reasoner can stream well past the deadline. Once any token delta
        // arrived the endpoint is demonstrably alive and answering, so a deadline
        // cutoff counts as healthy — latency reflects time-to-cutoff — instead of
        // stamping a timeout that real chat usage would never hit.
        if (!ok && sawDelta && error?.code === 'PROBE_TIMEOUT') {
            ok = true;
            error = undefined;
        }
        return {
            provider: target.provider,
            model: target.model,
            name: target.name,
            checkedAt,
            ok,
            ...ttftMs === undefined ? {} : { ttftMs },
            // totalMs is assigned on every path above — stream finish, end-without-finish, and thrown error.
            totalMs,
            ...usage === undefined ? {} : { usage },
            ...error === undefined ? {} : { error },
        };
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
/**
 * Translate a probe's terminal failure, preferring the local timeout when its
 * deadline fired over whatever the adapter reported.
 * @param failure - normalized adapter failure, when one was emitted.
 * @param signal - the probe's deadline-fused signal.
 * @param timeoutMs - the deadline that may have elapsed.
 * @returns a stable failure, or `undefined` when neither applies.
 */
function probeFailure(failure, signal, timeoutMs) {
    if (timeoutOf(signal, PROBE_DEADLINE_CODE) !== undefined) {
        return { code: 'PROBE_TIMEOUT', message: `the model probe exceeded ${timeoutMs} ms` };
    }
    if (failure === undefined)
        return undefined;
    return {
        code: failure.code,
        message: failure.message,
        ...failure.status === undefined ? {} : { status: failure.status },
    };
}
/** Render an unknown throw for process-local diagnostics. */
function renderThrown(value) {
    return value instanceof Error ? value.message : String(value);
}
/**
 * Run `run` over every item with at most `limit` concurrent executions,
 * preserving input order in the returned results.
 * @param items - inputs to process.
 * @param limit - positive concurrency cap.
 * @param run - one item's asynchronous work.
 * @returns one result per item, in input order.
 */
export async function runWithConcurrency(items, limit, run) {
    const results = new Array(items.length);
    const slots = items.entries();
    const take = () => {
        const next = slots.next();
        return next.done === true ? undefined : { index: next.value[0], item: next.value[1] };
    };
    const worker = async () => {
        while (true) {
            const slot = take();
            if (slot === undefined)
                return;
            results[slot.index] = await run(slot.item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results.map((value, index) => {
        /* v8 ignore next 2 -- every slot resolves before Promise.all returns, so an empty slot means the loop above was bypassed. */
        if (value === undefined)
            throw new Error(`model-health: probe ${index} produced no result`);
        return value;
    });
}
//# sourceMappingURL=probe.js.map