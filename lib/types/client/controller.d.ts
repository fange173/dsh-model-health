/**
 * Controller for the model-health status entry: owns the auto-refresh timer
 * and the two snapshot stores the panel reads through inject-bound selector
 * hooks. Every tick re-probes the host (`?refresh=1`) and reloads the returned
 * status JSON; transient failures keep the last good view.
 * @module dsh-model-health
 */
import type { ModelHealthFilter, ModelHealthStatusView } from '../types.ts';
import { type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** Wire contract shared with the host plugin's default status route. */
export declare const HEALTH_API_PATH = "/api/model-health";
/** localStorage identity of the persisted display settings. */
export declare const SETTINGS_PERSIST_KEY = "dsh.model-health.web";
/** Fetch fn shape (injectable for tests). */
export type FetchImpl = (input: string, init?: {
    headers?: Record<string, string>;
    method?: string;
    body?: string;
}) => Promise<{
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
}>;
/** Data face the panel renders. */
export interface HealthData {
    /** 'booting' until the first fetch settles; 'error' reports the last fetch failed, still holding any earlier view. */
    loadState: 'booting' | 'ready' | 'error';
    /** Whether a user-pressed re-probe is in flight. */
    refreshing: boolean;
    /** The host status view, when one has arrived. */
    view: ModelHealthStatusView | null;
    /** Last fetch failure, kept until the next success. */
    errorMessage: string | null;
}
/** Where the status chip mounts. */
export type HealthPosition = 'sidebar' | 'header';
/** Persisted display settings. */
export interface HealthSettings {
    position: HealthPosition;
    /** Auto-refresh interval in seconds: each tick re-probes then reloads; 0 disables auto-refresh (manual refresh still works). */
    refreshSeconds: number;
}
/** Auto-refresh interval pressed from a deterministic point (tests drive it manually). */
export interface HealthControllerDeps {
    readonly fetchImpl?: FetchImpl;
    readonly settingsSeed?: Partial<HealthSettings>;
}
/** Upper bound (seconds) on an accepted refresh cadence, shared with the settings input. */
export declare const MAX_REFRESH_SECONDS = 86400;
/**
 * Auto-refresh driver plus data/settings stores. The apply world constructs one,
 * injects its stores into the slot, and disposes it with the plugin fiber.
 */
export declare class ModelHealthController {
    /** Refresh-driven data; transient failures keep the last good view. */
    readonly data: SnapshotStore<HealthData>;
    /** Display settings, persisted in browser storage. */
    readonly settings: SnapshotStore<HealthSettings>;
    private readonly fetchImpl;
    private timer;
    private inflight;
    private disposed;
    /**
     * @param deps - optional fetch override and settings seed (tests).
     */
    constructor(deps?: HealthControllerDeps);
    /** Begin the auto-refresh loop: one plain load, then probe+load on the cadence. */
    start(): void;
    /** Stop the timer; in-flight fetches finish but cannot reschedule. */
    dispose(): void;
    /**
     * User-pressed refresh: chain a fresh probe round behind any in-flight
     * fetch, so the press always reaches the host instead of dissolving into a
     * plain refresh. The `refreshing` flag is owned by this settle path alone:
     * a refresh finishing first must not unspin the button while the forced
     * fetch is still queued behind it.
     * @returns the settle promise (no sync throw; failures land in the store).
     */
    refresh(): Promise<void>;
    /**
     * Update the mount position; the apply world re-registers the chip.
     * @param position - seat the chip mounts at from now on.
     */
    setPosition(position: HealthPosition): void;
    /**
     * Replace the host's enabled-model selection and refetch so the panel and the
     * next probe round reflect the new coverage. POSTs the filter to the status
     * route, then re-reads the view (the host re-probes immediately).
     * @param filter - the new enabled selection.
     * @returns a settle promise; failures land in the data lane as 'error'.
     */
    syncFilter(filter: ModelHealthFilter): Promise<void>;
    /**
     * Run `work` inside the serialized fetch lane, then settle. Used for the
     * filter POST so it cannot interleave with an in-flight refresh.
     * @param work - the POST-then-refetch sequence.
     * @returns the settle promise (no sync throw).
     */
    private withInflight;
    /**
     * Update the auto-refresh (probe+load) interval (0 = off) and re-arm the timer.
     * @param refreshSeconds - seconds between refreshes; `0` disables the auto-refresh loop.
     */
    setRefreshSeconds(refreshSeconds: number): void;
    /**
     * Arm the next auto-refresh when none is armed. The single-owner rule: at no point
     * may more than one pending timer exist, or an interval change hammers a
     * dual cadence and "refresh off" leaves a straggler fetch behind.
     */
    private schedule;
    private fetch;
    /**
     * localStorage is a durable boundary: a stale shape (a renamed field, a
     * hand-edited value) is discarded in favor of the defaults instead of
     * arming `setTimeout(NaN)` or landing the chip on a seat the user never
     * chose.
     */
    private sanitizePersisted;
}
