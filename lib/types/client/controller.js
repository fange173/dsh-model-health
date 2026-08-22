import { createSnapshotStore } from "@deepseek-ai/dsh-client-runtime/client";
const HEALTH_API_PATH = "/api/model-health";
const SETTINGS_PERSIST_KEY = "dsh.model-health.web";
const DEFAULT_SETTINGS = { position: "header", refreshSeconds: 300 };
const MAX_REFRESH_SECONDS = 86400;
function parseStatusView(value) {
  if (value === null || typeof value !== "object") throw new Error("malformed status view");
  const body = value;
  if (body.snapshot === null || typeof body.snapshot !== "object") throw new Error("malformed status view");
  if (!Array.isArray(body.snapshot.models)) throw new Error("malformed status view");
  if (!Array.isArray(body.history)) throw new Error("malformed status view");
  return value;
}
function defaultFetchView(fetchImpl, refresh) {
  const url = refresh ? `${HEALTH_API_PATH}?refresh=1` : HEALTH_API_PATH;
  return fetchImpl(url, { headers: { accept: "application/json" } }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseStatusView(await response.json());
  });
}
function fetchFilter(fetchImpl, filter) {
  return fetchImpl(HEALTH_API_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      ...filter.disabledProviders && filter.disabledProviders.length > 0 ? { disabledProviders: filter.disabledProviders } : {},
      ...filter.disabledModels && filter.disabledModels.length > 0 ? { disabledModels: filter.disabledModels } : {}
    })
  }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.json();
  });
}
class ModelHealthController {
  /** Refresh-driven data; transient failures keep the last good view. */
  data;
  /** Display settings, persisted in browser storage. */
  settings;
  fetchImpl;
  timer;
  inflight;
  disposed = false;
  /**
   * @param deps - optional fetch override and settings seed (tests).
   */
  constructor(deps = {}) {
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.data = createSnapshotStore({
      loadState: "booting",
      refreshing: false,
      view: null,
      errorMessage: null
    });
    this.settings = createSnapshotStore(
      { ...DEFAULT_SETTINGS, ...deps.settingsSeed },
      { persist: { name: SETTINGS_PERSIST_KEY } }
    );
    this.sanitizePersisted();
  }
  /** Begin the auto-refresh loop: one plain load, then probe+load on the cadence. */
  start() {
    if (this.disposed) return;
    void this.fetch(false);
    this.schedule();
  }
  /** Stop the timer; in-flight fetches finish but cannot reschedule. */
  dispose() {
    this.disposed = true;
    if (this.timer !== void 0) clearTimeout(this.timer);
    this.timer = void 0;
  }
  /**
   * User-pressed refresh: chain a fresh probe round behind any in-flight
   * fetch, so the press always reaches the host instead of dissolving into a
   * plain refresh. The `refreshing` flag is owned by this settle path alone:
   * a refresh finishing first must not unspin the button while the forced
   * fetch is still queued behind it.
   * @returns the settle promise (no sync throw; failures land in the store).
   */
  refresh() {
    if (this.disposed) return Promise.resolve();
    this.data.update((draft) => {
      draft.refreshing = true;
    });
    const forced = (this.inflight ?? Promise.resolve()).then(() => this.fetch(true));
    return forced.finally(() => {
      this.data.update((draft) => {
        draft.refreshing = false;
      });
    });
  }
  /**
   * Update the mount position; the apply world re-registers the chip.
   * @param position - seat the chip mounts at from now on.
   */
  setPosition(position) {
    this.settings.update((draft) => {
      draft.position = position;
    });
  }
  /**
   * Replace the host's enabled-model selection and refetch so the panel and the
   * next probe round reflect the new coverage. POSTs the filter to the status
   * route, then re-reads the view (the host re-probes immediately).
   * @param filter - the new enabled selection.
   * @returns a settle promise; failures land in the data lane as 'error'.
   */
  syncFilter(filter) {
    if (this.disposed) return Promise.resolve();
    return this.withInflight(() => fetchFilter(this.fetchImpl, filter)).then(() => this.fetch(false));
  }
  /**
   * Run `work` inside the serialized fetch lane, then settle. Used for the
   * filter POST so it cannot interleave with an in-flight refresh.
   * @param work - the POST-then-refetch sequence.
   * @returns the settle promise (no sync throw).
   */
  withInflight(work) {
    this.data.update((draft) => {
      draft.refreshing = true;
    });
    const run = (this.inflight ?? Promise.resolve()).then(work).finally(() => {
      this.inflight = void 0;
      this.data.update((draft) => {
        draft.refreshing = false;
      });
    });
    this.inflight = run;
    return run;
  }
  /**
   * Update the auto-refresh (probe+load) interval (0 = off) and re-arm the timer.
   * @param refreshSeconds - seconds between refreshes; `0` disables the auto-refresh loop.
   */
  setRefreshSeconds(refreshSeconds) {
    this.settings.update((draft) => {
      draft.refreshSeconds = refreshSeconds;
    });
    if (this.timer !== void 0) clearTimeout(this.timer);
    this.timer = void 0;
    this.schedule();
  }
  /**
   * Arm the next auto-refresh when none is armed. The single-owner rule: at no point
   * may more than one pending timer exist, or an interval change hammers a
   * dual cadence and "refresh off" leaves a straggler fetch behind.
   */
  schedule() {
    if (this.disposed || this.timer !== void 0) return;
    const refreshSeconds = this.settings.getSnapshot().refreshSeconds;
    if (refreshSeconds <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = void 0;
      void this.fetch(true).finally(() => {
        this.schedule();
      });
    }, refreshSeconds * 1e3);
  }
  fetch(refresh) {
    if (this.inflight !== void 0) return this.inflight;
    const run = defaultFetchView(this.fetchImpl, refresh).then((view) => {
      this.data.set({
        loadState: "ready",
        refreshing: this.data.getSnapshot().refreshing,
        view,
        errorMessage: null
      });
    }).catch((error) => {
      this.data.update((draft) => {
        draft.loadState = "error";
        draft.errorMessage = error instanceof Error ? error.message : String(error);
      });
    }).finally(() => {
      this.inflight = void 0;
    });
    this.inflight = run;
    return run;
  }
  /**
   * localStorage is a durable boundary: a stale shape (a renamed field, a
   * hand-edited value) is discarded in favor of the defaults instead of
   * arming `setTimeout(NaN)` or landing the chip on a seat the user never
   * chose.
   */
  sanitizePersisted() {
    const snapshot = this.settings.getSnapshot();
    const seats = ["sidebar", "header"];
    const positionValid = seats.includes(snapshot.position);
    const refreshValid = Number.isInteger(snapshot.refreshSeconds) && snapshot.refreshSeconds >= 0 && snapshot.refreshSeconds <= MAX_REFRESH_SECONDS;
    if (positionValid && refreshValid) return;
    this.settings.update((draft) => {
      if (!positionValid) draft.position = DEFAULT_SETTINGS.position;
      if (!refreshValid) draft.refreshSeconds = DEFAULT_SETTINGS.refreshSeconds;
    });
  }
}
export {
  HEALTH_API_PATH,
  MAX_REFRESH_SECONDS,
  ModelHealthController,
  SETTINGS_PERSIST_KEY
};
