/**
 * Model-facing `model_status` tool over the in-memory probe store.
 * @module dsh-model-health
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ModelHealthStore } from './store.ts';
/** Dependencies the tool reads. */
export interface ModelHealthToolDeps {
    readonly store: ModelHealthStore;
    readonly runNow: () => Promise<void>;
}
/**
 * Register the global `model_status` tool. Disposing the returned disposer
 * (or the plugin fiber) unregisters it.
 * @param ctx - context owning the tool runtime.
 * @param deps - store and round runner the tool reads.
 * @returns the registration disposer.
 */
export declare function registerModelHealthTool(ctx: Context, deps: ModelHealthToolDeps): () => void;
