/**
 * Local HTTP status route for the model-health plugin. Serves the current
 * snapshot, retained probe rounds, full model catalog, and the enabled filter
 * as JSON for a same-origin browser consumer; `?refresh=1` runs a full probe
 * round before answering. A `POST` to the same path updates the enabled-model
 * selection (from the browser settings panel) and returns the accepted filter.
 * @module dsh-model-health
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { ModelHealthMonitor } from './monitor.ts';
import type { ModelHealthStore } from './store.ts';
import type { ModelHealthStatusConfig } from './types.ts';
/** Stable machine code a consumer can match on a structured route error. */
export declare const ROUTE_ERROR_CODE = "MODEL_HEALTH_ROUTE";
/** Construction facts for the status route. */
export interface ModelHealthRouteDeps {
    readonly store: ModelHealthStore;
    readonly monitor: ModelHealthMonitor;
    /** Exact pathname the route answers, e.g. `/api/model-health`. */
    readonly path: string;
    /** Probe configuration echoed with every served view. */
    readonly statusConfig: ModelHealthStatusConfig;
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
export declare function createModelHealthRouteHandler(deps: ModelHealthRouteDeps): WebRoute['handler'];
/**
 * Register the status route on the host web server whenever one exists, and a
 * POST side-effect route at the same path if requested. See {@link registerModelHealthRoute}.
 */
export declare function registerModelHealthRoute(ctx: Context, deps: ModelHealthRouteDeps): () => void;
