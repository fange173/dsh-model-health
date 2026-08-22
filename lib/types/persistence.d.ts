/**
 * Optional durable persistence for the model-health plugin. Keeps the probe
 * history and the enabled-model filter in one JSON document under the
 * harness home (`~/.dsH/model-health.json` by default) so a restart does not
 * wipe a user's accumulated trend or their model selection. Failure to read or
 * write is a diagnostic, never fatal: the store keeps running in memory.
 * @module dsh-model-health
 */
import type { ModelHealthFilter, ModelHealthRound } from './types.ts';
/** Default file name under the harness home. */
export declare const DEFAULT_PERSIST_FILE = "model-health.json";
/** The persisted document: retained rounds plus the enabled-model selection. */
export interface ModelHealthPersistence {
    /** Retained probe rounds, oldest first, bounded by the configured historyLimit. */
    readonly rounds: readonly ModelHealthRound[];
    /** The user's enabled selection, or undefined when they have never chosen (default all enabled). */
    readonly filter?: ModelHealthFilter;
    /** ISO timestamp of the last write; informational only. */
    readonly writtenAt?: string;
}
/** Construction facts for the persistence facade. */
export interface PersistenceOptions {
    /** Absolute file path to persist to; defaults to `<dshHome>/model-health.json`. */
    readonly filename?: string;
}
/**
 * Load the persisted document, tolerating an absent or malformed file.
 * @param opts - optional custom filename.
 * @returns the parsed document, or an empty one when nothing durable is readable.
 */
export declare function loadPersistence(opts?: PersistenceOptions): Promise<ModelHealthPersistence>;
/**
 * Write a durable snapshot under a writer lock so concurrent writers do not
 * corrupt the document.
 * @param snapshot - rounds + optional enabled selection.
 * @param opts - optional custom filename.
 */
export declare function savePersistence(snapshot: ModelHealthPersistence, opts?: PersistenceOptions): Promise<void>;
