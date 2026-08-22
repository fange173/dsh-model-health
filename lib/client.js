window.__ModuleLoader__.load({
	id: "dsh-model-health",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/types/client/controller.js
		/**
		* Controller for the model-health status entry: owns the auto-refresh timer
		* and the two snapshot stores the panel reads through inject-bound selector
		* hooks. Every tick re-probes the host (`?refresh=1`) and reloads the returned
		* status JSON; transient failures keep the last good view.
		* @module dsh-model-health
		*/
		/** Wire contract shared with the host plugin's default status route. */
		const HEALTH_API_PATH = "/api/model-health";
		/** localStorage identity of the persisted display settings. */
		const SETTINGS_PERSIST_KEY = "dsh.model-health.web";
		const DEFAULT_SETTINGS = {
			position: "header",
			refreshSeconds: 300
		};
		/** Upper bound (seconds) on an accepted refresh cadence, shared with the settings input. */
		const MAX_REFRESH_SECONDS = 86400;
		/** Validate the payload fields just enough to fail a foreign body's JSON loudly. */
		function parseStatusView(value) {
			if (value === null || typeof value !== "object") throw new Error("malformed status view");
			const body = value;
			if (body.snapshot === null || typeof body.snapshot !== "object") throw new Error("malformed status view");
			if (!Array.isArray(body.snapshot.models)) throw new Error("malformed status view");
			if (!Array.isArray(body.history)) throw new Error("malformed status view");
			return value;
		}
		/** Built-in fetch against the host status route, tagged for JSON. */
		function defaultFetchView(fetchImpl, refresh) {
			return fetchImpl(refresh ? `${HEALTH_API_PATH}?refresh=1` : HEALTH_API_PATH, { headers: { accept: "application/json" } }).then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return parseStatusView(await response.json());
			});
		}
		/** Built-in POST of an enabled-filter to the host status route. */
		function fetchFilter(fetchImpl, filter) {
			return fetchImpl(HEALTH_API_PATH, {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json"
				},
				body: JSON.stringify({
					...filter.disabledProviders && filter.disabledProviders.length > 0 ? { disabledProviders: filter.disabledProviders } : {},
					...filter.disabledModels && filter.disabledModels.length > 0 ? { disabledModels: filter.disabledModels } : {}
				})
			}).then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				await response.json();
			});
		}
		/**
		* Auto-refresh driver plus data/settings stores. The apply world constructs one,
		* injects its stores into the slot, and disposes it with the plugin fiber.
		*/
		var ModelHealthController = class {
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
				this.data = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
					loadState: "booting",
					refreshing: false,
					view: null,
					errorMessage: null
				});
				this.settings = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
					...DEFAULT_SETTINGS,
					...deps.settingsSeed
				}, { persist: { name: SETTINGS_PERSIST_KEY } });
				this.sanitizePersisted();
			}
			/** Begin the auto-refresh loop: one plain load, then probe+load on the cadence. */
			start() {
				if (this.disposed) return;
				this.fetch(false);
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
				return (this.inflight ?? Promise.resolve()).then(() => this.fetch(true)).finally(() => {
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
					this.fetch(true).finally(() => {
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
				const positionValid = ["sidebar", "header"].includes(snapshot.position);
				const refreshValid = Number.isInteger(snapshot.refreshSeconds) && snapshot.refreshSeconds >= 0 && snapshot.refreshSeconds <= 86400;
				if (positionValid && refreshValid) return;
				this.settings.update((draft) => {
					if (!positionValid) draft.position = DEFAULT_SETTINGS.position;
					if (!refreshValid) draft.refreshSeconds = DEFAULT_SETTINGS.refreshSeconds;
				});
			}
		};
		/**
		* Aggregate a snapshot's per-model results.
		* @param models - the snapshot's current per-model results.
		* @returns totals and the mean healthy latency; `avgTotalMs` is null when no healthy model answered.
		*/
		function summarize(models) {
			let ok = 0;
			let latencySum = 0;
			let latencyCount = 0;
			for (const model of models) {
				if (!model.ok) continue;
				ok += 1;
				if (model.totalMs !== void 0) {
					latencySum += model.totalMs;
					latencyCount += 1;
				}
			}
			return {
				total: models.length,
				ok,
				failing: models.length - ok,
				avgTotalMs: latencyCount > 0 ? latencySum / latencyCount : null
			};
		}
		/**
		* Chip severity for the current data state, before any aggregate is known.
		* @param aggregate - current snapshot aggregate, or null while nothing answered.
		* @param hasError - whether the data lane is in its failure state.
		* @returns the dot tone for the chip's aggregate state.
		*/
		function aggregateTone(aggregate, hasError) {
			if (aggregate === null) return hasError ? "error" : "ongoing";
			if (aggregate.total === 0) return "warning";
			if (aggregate.failing > 0) return aggregate.ok > 0 ? "warning" : "error";
			return "done";
		}
		/**
		* One result's dot tone: a healthy answer shows green, a failed probe red.
		* @param result - the per-model outcome to style.
		* @returns the dot tone for that outcome.
		*/
		function resultTone(result) {
			return result.ok ? "done" : "error";
		}
		/**
		* Group snapshot-ordered models under their providers for the status list.
		* @param models - per-model results in snapshot order (provider-major).
		* @returns one group per provider in encounter order.
		*/
		function groupByProvider(models) {
			const groups = [];
			let current;
			for (const model of models) {
				if (current?.provider !== model.provider) {
					current = {
						provider: model.provider,
						models: []
					};
					groups.push(current);
				}
				current.models.push(model);
			}
			return groups;
		}
		/**
		* Build one trend series per model from retained rounds (oldest first). Each
		* series carries every retained point; the component caps the rendered strip
		* and expands on user demand. Rates cover the full retained window.
		* @param history - retained probe rounds, oldest first.
		* @returns one trend series per model in first-seen order.
		*/
		function buildTrendSeries(history) {
			const byModel = /* @__PURE__ */ new Map();
			for (const round of history) for (const model of round.models) {
				const key = `${model.provider}/${model.model}`;
				let entry = byModel.get(key);
				if (entry === void 0) {
					entry = {
						meta: model,
						points: []
					};
					byModel.set(key, entry);
				}
				entry.meta = model;
				entry.points.push(model.ok ? {
					checkedAt: round.checkedAt,
					ok: true,
					totalMs: model.totalMs ?? null,
					code: null,
					...model.usage !== void 0 && model.ttftMs !== void 0 && model.totalMs !== void 0 && model.totalMs > model.ttftMs && model.totalMs - model.ttftMs >= 200 && model.usage.outputTokens >= 16 ? { tps: Math.round(model.usage.outputTokens / ((model.totalMs - model.ttftMs) / 1e3)) } : {}
				} : {
					checkedAt: round.checkedAt,
					ok: false,
					totalMs: model.totalMs ?? null,
					code: model.error?.code ?? "unknown"
				});
			}
			const series = [];
			for (const [key, { meta, points }] of byModel) {
				const healthy = points.filter((point) => point.ok);
				const latencySum = healthy.reduce((sum, point) => sum + (point.totalMs ?? 0), 0);
				const latencyCount = healthy.filter((point) => point.totalMs !== null).length;
				series.push({
					key,
					provider: meta.provider,
					model: meta.model,
					name: meta.name,
					points,
					okRate: Math.round(healthy.length / points.length * 100),
					avgTotalMs: latencyCount > 0 ? latencySum / latencyCount : null
				});
			}
			return series;
		}
		/**
		* Reduce retained rounds (oldest first) to per-round chart aggregates. Pure so
		* the sparkline row stays unit-testable alongside the other view derivations.
		* @param history - retained probe rounds, oldest first.
		* @returns one point per round, same order.
		*/
		function buildRoundSeries(history) {
			return history.map((round) => {
				const healthy = round.models.filter((model) => model.ok);
				const latencies = healthy.map((model) => model.totalMs).filter((value) => typeof value === "number");
				return {
					checkedAt: round.checkedAt,
					ok: healthy.length,
					failing: round.models.length - healthy.length,
					avgLatency: latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null
				};
			});
		}
		/**
		* Format a latency for compact display: `312ms`, `1.2s`, or `—` when absent.
		* @param ms - latency in milliseconds, when measured.
		* @returns the compact latency string.
		*/
		function formatLatency(ms) {
			if (ms === null || ms === void 0) return "—";
			if (ms < 1e3) return `${Math.round(ms)}ms`;
			return `${(ms / 1e3).toFixed(1)}s`;
		}
		/**
		* Bucket a snapshot timestamp for the header's "updated …" line. Anything
		* under one minute reads as just-now; days stay in hours so the vocabulary
		* never grows.
		* @param checkedAt - snapshot timestamp, or undefined before the first round.
		* @param nowMs - current epoch milliseconds.
		* @returns the recency descriptor mapped onto locale keys by the panel.
		*/
		function recency(checkedAt, nowMs) {
			if (checkedAt === void 0) return { kind: "none" };
			const elapsed = Math.max(0, nowMs - Date.parse(checkedAt));
			const minutes = Math.floor(elapsed / 6e4);
			if (minutes < 1) return { kind: "justNow" };
			if (minutes < 60) return {
				kind: "minutes",
				minutes
			};
			return {
				kind: "hours",
				hours: Math.floor(minutes / 60)
			};
		}
		/** Whether a provider is enabled under a denylist filter. */
		function providerEnabled(filter, provider) {
			return !(filter.disabledProviders?.includes(provider) ?? false);
		}
		/** Whether a provider/model is enabled under a denylist filter. */
		function modelEnabled(filter, provider, model) {
			if (!providerEnabled(filter, provider)) return false;
			return !(filter.disabledModels?.includes(`${provider}/${model}`) ?? false);
		}
		/**
		* Keep only the trend series whose provider/model currently passes the filter.
		* History rounds retain points for models that were enabled when they ran, so
		* a model hidden *now* would otherwise still surface in the trend tab.
		* @param series - the full trend series from retained rounds.
		* @param filter - the current enabled-model selection.
		* @returns the series for currently-enabled models, in input order.
		*/
		function filterTrendSeries(series, filter) {
			return series.filter((item) => modelEnabled(filter, item.provider, item.model));
		}
		/** Toggle a provider in the denylist, returning a new filter. */
		function toggleProvider(filter, provider) {
			const disabled = filter.disabledProviders ?? [];
			const next = disabled.includes(provider) ? disabled.filter((p) => p !== provider) : [...disabled, provider];
			return {
				...filter,
				disabledProviders: next
			};
		}
		/**
		* Toggle an individual model in the denylist, returning a new filter.
		* The direction follows {@link modelEnabled} — the same predicate the checkbox
		* renders — so a model that merely *looks* off because its provider is switched
		* off re-enables (and restores the provider) instead of disabling itself on the
		* first click.
		*/
		function toggleModel(filter, provider, model) {
			const key = `${provider}/${model}`;
			if (modelEnabled(filter, provider, model)) return {
				...filter,
				disabledModels: [...filter.disabledModels ?? [], key]
			};
			return enableProvider({
				...filter,
				disabledModels: (filter.disabledModels ?? []).filter((m) => m !== key)
			}, provider);
		}
		/** Remove one provider from the denylist; an empty list reads as "all enabled". */
		function enableProvider(filter, provider) {
			const disabled = filter.disabledProviders ?? [];
			if (!disabled.includes(provider)) return filter;
			return {
				...filter,
				disabledProviders: disabled.filter((p) => p !== provider)
			};
		}
		/** Format an ISO timestamp for the expanded trend list's per-check rows. */
		function formatTimestamp(iso) {
			if (iso === void 0) return "—";
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return iso;
			const pad = (n) => String(n).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
		}
		//#endregion
		//#region \0dsh-css:src/client/ModelHealthAction.module.css.mjs
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify("dsh-model-health/src/client/ModelHealthAction.module.css") + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-model-health";
			tag.dataset.pluginCss = "dsh-model-health/src/client/ModelHealthAction.module.css";
			tag.textContent = ".fTTWGa_root{display:inline-flex;position:relative}.fTTWGa_footerRow{flex:auto;min-width:0}.fTTWGa_footerRowWide,.fTTWGa_rootFull{flex:100%;min-width:100%}.fTTWGa_triggerWide{flex-wrap:wrap;flex:100%;justify-content:flex-start;gap:6px;width:100%}.fTTWGa_trigger{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:4px;padding:3px 6px 3px 4px;font-size:12px;line-height:18px;display:inline-flex}.fTTWGa_trigger:hover,.fTTWGa_trigger:focus-visible{color:var(--dsw-alias-label-secondary)}.fTTWGa_trigger svg{transition:transform .12s}.fTTWGa_triggerOpen{transform:rotate(180deg)}.fTTWGa_triggerDot{flex:none}.fTTWGa_triggerLabel{white-space:nowrap;margin-left:2px}.fTTWGa_count{font-variant-numeric:tabular-nums}.fTTWGa_panel{z-index:1000;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);width:368px;max-width:min(420px,100vw - 32px);max-height:min(520px,100vh - 120px);box-shadow:var(--dsw-shadow-lv3);border-radius:12px;flex-direction:column;display:flex;position:fixed}.fTTWGa_panelHead{border-bottom:1px solid var(--dsw-alias-border-l3);align-items:center;gap:6px;padding:10px 12px 8px;display:flex}.fTTWGa_panelTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px}.fTTWGa_recency{min-width:0;color:var(--dsw-alias-label-tertiary);text-align:right;white-space:nowrap;text-overflow:ellipsis;flex:1;font-size:11px;line-height:18px;overflow:hidden}.fTTWGa_iconButton{width:22px;height:22px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.fTTWGa_iconButton:hover,.fTTWGa_iconButton:focus-visible{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}.fTTWGa_iconButtonActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}.fTTWGa_iconButton:disabled{cursor:default;opacity:.6}.fTTWGa_spin{animation:.9s linear infinite fTTWGa_model-health-spin}@keyframes fTTWGa_model-health-spin{0%{transform:rotate(0)}to{transform:rotate(360deg)}}.fTTWGa_summary{flex-wrap:wrap;gap:6px;padding:8px 12px 0;display:flex}.fTTWGa_summaryChip{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;border-radius:999px;padding:1px 8px;font-size:11px;line-height:18px}.fTTWGa_summaryChipFailing{background:var(--dsw-alias-state-error-secondary);color:#fff}.fTTWGa_tabs{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);border-radius:10px;gap:3px;margin:10px 12px 0;padding:3px;display:flex}.fTTWGa_tab{height:26px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:8px;flex:1;font-size:12px;line-height:18px;transition:background .12s,color .12s}.fTTWGa_tab:hover{color:var(--dsw-alias-label-primary)}.fTTWGa_tabActive{background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1);font-weight:500}.fTTWGa_charts{gap:8px;padding:10px 12px 0;display:flex}.fTTWGa_chartCard{background:var(--dsw-alias-bg-layer-2);min-width:0;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);border-radius:10px;flex:1;padding:6px 8px 7px;position:relative}.fTTWGa_chartTooltip{z-index:1;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv1);color:var(--dsw-alias-label-secondary);white-space:nowrap;pointer-events:none;border-radius:6px;padding:3px 8px;font-size:11px;line-height:16px;position:absolute;top:22px;transform:translate(-50%)}.fTTWGa_chartTitle{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;display:block}.fTTWGa_chartPlot{position:relative}.fTTWGa_chartSvg{width:100%;height:40px;margin-top:3px;display:block}.fTTWGa_chartHoverDot{background:var(--dsw-alias-state-warn-primary);width:7px;height:7px;box-shadow:0 0 0 2px var(--dsw-specific-menu);pointer-events:none;border-radius:50%;position:absolute;transform:translate(-50%,-50%)}.fTTWGa_trendDetailTps{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:auto;font-size:11px}.fTTWGa_board{padding:6px 8px 8px;overflow:auto}.fTTWGa_providerGroup+.fTTWGa_providerGroup{margin-top:2px}.fTTWGa_providerHead{justify-content:space-between;align-items:center;padding:6px 6px 2px;display:flex}.fTTWGa_providerName{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:18px}.fTTWGa_providerCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px;line-height:18px}.fTTWGa_providerRows{margin:0;padding:0;list-style:none}.fTTWGa_row{box-sizing:border-box;width:100%;min-height:30px;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:8px;padding:5px 6px;font-size:12px;line-height:18px;display:flex}.fTTWGa_rowDot{flex:none}.fTTWGa_name{white-space:nowrap;text-overflow:ellipsis;flex:none;max-width:45%;overflow:hidden}.fTTWGa_modelId{min-width:0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;flex:1;font-size:11px;overflow:hidden}.fTTWGa_latency{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:none;font-size:11px}.fTTWGa_rowFailing .fTTWGa_name{color:var(--dsw-alias-state-error-primary)}.fTTWGa_errorText{max-width:40%;color:var(--dsw-alias-state-error-primary);white-space:nowrap;text-overflow:ellipsis;flex:none;font-size:11px;overflow:hidden}.fTTWGa_emptyNote{color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:8px;margin:10px 12px;font-size:12px;line-height:18px;display:flex}.fTTWGa_staleNote{background:var(--dsw-alias-state-warn-secondary);color:var(--dsw-alias-state-warn-label);border-radius:6px;margin:8px 12px 0;padding:4px 8px;font-size:11px;line-height:18px}.fTTWGa_retry{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:6px;flex:none;padding:1px 10px;font-size:11px;line-height:18px}.fTTWGa_retry:hover{color:var(--dsw-alias-label-primary)}.fTTWGa_trendLegend{color:var(--dsw-alias-label-tertiary);margin:2px 6px 0;font-size:11px;line-height:18px}.fTTWGa_trendList{margin:0;padding:2px 0;list-style:none}.fTTWGa_trendRow{border-radius:8px;align-items:center;gap:8px;min-height:28px;padding:4px 6px;font-size:12px;line-height:18px;display:flex}.fTTWGa_trendName{max-width:34%;color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;flex:none;overflow:hidden}.fTTWGa_dotStrip{flex:1;align-items:center;gap:3px;min-width:0;display:flex;overflow:hidden}.fTTWGa_dotStrip span{border-radius:2px;flex:none;width:8px;height:8px}.fTTWGa_pointOk{background:var(--dsw-alias-state-success-primary)}.fTTWGa_pointWarn{background:var(--dsw-alias-state-warn-primary)}.fTTWGa_pointErr{background:var(--dsw-alias-state-error-primary)}.fTTWGa_trendMeta{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;font-size:11px}.fTTWGa_trendToggle{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);cursor:pointer;border:0;border-radius:999px;flex:none;padding:1px 10px;font-size:11px;line-height:18px}.fTTWGa_trendToggle:hover,.fTTWGa_trendToggle:focus-visible{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.fTTWGa_settings{border-bottom:1px solid var(--dsw-alias-border-l3);flex-direction:column;gap:8px;padding:8px 12px 10px;display:flex}.fTTWGa_settingRow{align-items:center;gap:10px;display:flex}.fTTWGa_settingLabel{width:52px;color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:18px}.fTTWGa_pills{flex-wrap:wrap;gap:4px;display:flex}.fTTWGa_pill{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border-radius:999px;padding:1px 8px;font-size:11px;line-height:18px}.fTTWGa_pill:hover{color:var(--dsw-alias-label-secondary)}.fTTWGa_pillActive{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.fTTWGa_customRefresh{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;align-items:center;gap:4px;padding:1px 8px;display:inline-flex}.fTTWGa_customRefreshLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}.fTTWGa_customRefreshInput{width:44px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right;background:0 0;border:0;padding:0 2px;font-size:11px;line-height:18px}.fTTWGa_customRefreshInput::-webkit-outer-spin-button,.fTTWGa_customRefreshInput::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}.fTTWGa_customRefreshInput:focus{outline:none}.fTTWGa_customRefreshUnit{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}.fTTWGa_checkRow{cursor:pointer;align-items:center;gap:8px;min-width:0;display:inline-flex}.fTTWGa_checkRow input[type=checkbox]{cursor:pointer;flex:none;width:14px;height:14px;margin:0}.fTTWGa_catalogRow{box-sizing:border-box;min-height:30px;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;padding:5px 6px 5px 28px;font-size:12px;line-height:18px;display:flex}.fTTWGa_editFooter{justify-content:flex-end;align-items:center;gap:8px;padding:4px 12px 10px;display:flex}.fTTWGa_editDone{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.fTTWGa_trendRow{flex-direction:column;align-items:stretch}.fTTWGa_trendRowMain{align-items:center;gap:8px;min-height:28px;display:flex}.fTTWGa_trendDetail{background:var(--dsw-alias-interactive-bg-hover);border-radius:8px;margin:2px 0 4px;padding:2px 4px 2px 12px}.fTTWGa_trendSummary{color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l3);padding:2px 0 4px;font-size:11px;line-height:18px}.fTTWGa_trendDetailList{max-height:168px;margin:0;padding:2px 0;list-style:none;overflow-y:auto}.fTTWGa_trendDetailRow{align-items:center;gap:8px;min-height:22px;font-size:11px;line-height:18px;display:flex}.fTTWGa_trendDetailTime{min-width:118px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none}.fTTWGa_trendDetailOk{color:var(--dsw-alias-state-success-primary)}.fTTWGa_trendDetailFail{color:var(--dsw-alias-state-error-primary)}";
			document.head.appendChild(tag);
		}
		var ModelHealthAction_module_css_default = {
			"board": "fTTWGa_board",
			"catalogRow": "fTTWGa_catalogRow",
			"chartCard": "fTTWGa_chartCard",
			"chartHoverDot": "fTTWGa_chartHoverDot",
			"chartPlot": "fTTWGa_chartPlot",
			"chartSvg": "fTTWGa_chartSvg",
			"chartTitle": "fTTWGa_chartTitle",
			"chartTooltip": "fTTWGa_chartTooltip",
			"charts": "fTTWGa_charts",
			"checkRow": "fTTWGa_checkRow",
			"count": "fTTWGa_count",
			"customRefresh": "fTTWGa_customRefresh",
			"customRefreshInput": "fTTWGa_customRefreshInput",
			"customRefreshLabel": "fTTWGa_customRefreshLabel",
			"customRefreshUnit": "fTTWGa_customRefreshUnit",
			"dotStrip": "fTTWGa_dotStrip",
			"editDone": "fTTWGa_editDone",
			"editFooter": "fTTWGa_editFooter",
			"emptyNote": "fTTWGa_emptyNote",
			"errorText": "fTTWGa_errorText",
			"footerRow": "fTTWGa_footerRow",
			"footerRowWide": "fTTWGa_footerRowWide",
			"iconButton": "fTTWGa_iconButton",
			"iconButtonActive": "fTTWGa_iconButtonActive",
			"latency": "fTTWGa_latency",
			"model-health-spin": "fTTWGa_model-health-spin",
			"modelId": "fTTWGa_modelId",
			"name": "fTTWGa_name",
			"panel": "fTTWGa_panel",
			"panelHead": "fTTWGa_panelHead",
			"panelTitle": "fTTWGa_panelTitle",
			"pill": "fTTWGa_pill",
			"pillActive": "fTTWGa_pillActive",
			"pills": "fTTWGa_pills",
			"pointErr": "fTTWGa_pointErr",
			"pointOk": "fTTWGa_pointOk",
			"pointWarn": "fTTWGa_pointWarn",
			"providerCount": "fTTWGa_providerCount",
			"providerGroup": "fTTWGa_providerGroup",
			"providerHead": "fTTWGa_providerHead",
			"providerName": "fTTWGa_providerName",
			"providerRows": "fTTWGa_providerRows",
			"recency": "fTTWGa_recency",
			"retry": "fTTWGa_retry",
			"root": "fTTWGa_root",
			"rootFull": "fTTWGa_rootFull",
			"row": "fTTWGa_row",
			"rowDot": "fTTWGa_rowDot",
			"rowFailing": "fTTWGa_rowFailing",
			"settingLabel": "fTTWGa_settingLabel",
			"settingRow": "fTTWGa_settingRow",
			"settings": "fTTWGa_settings",
			"spin": "fTTWGa_spin",
			"staleNote": "fTTWGa_staleNote",
			"summary": "fTTWGa_summary",
			"summaryChip": "fTTWGa_summaryChip",
			"summaryChipFailing": "fTTWGa_summaryChipFailing",
			"tab": "fTTWGa_tab",
			"tabActive": "fTTWGa_tabActive",
			"tabs": "fTTWGa_tabs",
			"trendDetail": "fTTWGa_trendDetail",
			"trendDetailFail": "fTTWGa_trendDetailFail",
			"trendDetailList": "fTTWGa_trendDetailList",
			"trendDetailOk": "fTTWGa_trendDetailOk",
			"trendDetailRow": "fTTWGa_trendDetailRow",
			"trendDetailTime": "fTTWGa_trendDetailTime",
			"trendDetailTps": "fTTWGa_trendDetailTps",
			"trendLegend": "fTTWGa_trendLegend",
			"trendList": "fTTWGa_trendList",
			"trendMeta": "fTTWGa_trendMeta",
			"trendName": "fTTWGa_trendName",
			"trendRow": "fTTWGa_trendRow",
			"trendRowMain": "fTTWGa_trendRowMain",
			"trendSummary": "fTTWGa_trendSummary",
			"trendToggle": "fTTWGa_trendToggle",
			"trigger": "fTTWGa_trigger",
			"triggerDot": "fTTWGa_triggerDot",
			"triggerLabel": "fTTWGa_triggerLabel",
			"triggerOpen": "fTTWGa_triggerOpen",
			"triggerWide": "fTTWGa_triggerWide"
		};
		//#endregion
		//#region lib/types/client/ModelHealthAction.js
		/**
		* Status-entry component: a compact chip (state dot + label + healthy/total
		* count) whose popover presents the live per-model status list, retained-round
		* trend strips, and a small display-settings section. All data arrives through
		* inject-bound selector hooks and plain callbacks; derivation lives in
		* `view.ts`.
		*/
		const REFRESH_CHOICES = [
			0,
			30,
			60,
			120,
			300
		];
		function recencyLabel(health, t) {
			switch (health.kind) {
				case "none": return t("recency.none");
				case "justNow": return t("recency.justNow");
				case "minutes": return t("recency.minutes", { minutes: health.minutes });
				/* v8 ignore next -- hours-only branch reached by long-idle views */
				case "hours": return t("recency.hours", { hours: health.hours });
			}
		}
		function pointTitle(point, t, checkedLabel) {
			return t("history.title", {
				checkedAt: checkedLabel,
				status: point.ok ? `${t("history.ok")} ${formatLatency(point.totalMs)}` : point.code === "PROBE_TIMEOUT" ? t("history.timeout") : t("history.failed", { code: point.code })
			});
		}
		function ModelRow({ model, t }) {
			const latency = formatLatency(model.ok ? model.totalMs : null);
			const detail = model.ok ? t("latency.title", {
				ttft: formatLatency(model.ttftMs),
				total: formatLatency(model.totalMs)
			}) : `${model.error?.code ?? "unknown"}${model.error?.status !== void 0 ? ` (${model.error.status})` : ""}`;
			return (0, react_jsx_runtime.jsxs)("li", {
				className: model.ok ? ModelHealthAction_module_css_default.row : `${ModelHealthAction_module_css_default.row} ${ModelHealthAction_module_css_default.rowFailing}`,
				children: [
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: resultTone(model),
						className: ModelHealthAction_module_css_default.rowDot
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: ModelHealthAction_module_css_default.name,
						title: model.model,
						children: model.name
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: ModelHealthAction_module_css_default.modelId,
						title: model.model,
						children: model.model
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: model.ok ? ModelHealthAction_module_css_default.latency : ModelHealthAction_module_css_default.errorText,
						title: model.ok ? detail : model.error?.message ?? detail,
						children: model.ok ? latency : model.error?.code ?? "unknown"
					})
				]
			});
		}
		function StatusBoard({ models, t }) {
			const groups = (0, react.useMemo)(() => groupByProvider(models), [models]);
			return (0, react_jsx_runtime.jsx)("div", {
				className: ModelHealthAction_module_css_default.list,
				children: groups.map((group) => (0, react_jsx_runtime.jsxs)("section", {
					className: ModelHealthAction_module_css_default.providerGroup,
					children: [(0, react_jsx_runtime.jsxs)("header", {
						className: ModelHealthAction_module_css_default.providerHead,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ModelHealthAction_module_css_default.providerName,
							children: group.provider
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ModelHealthAction_module_css_default.providerCount,
							children: t("provider.count", { count: group.models.length })
						})]
					}), (0, react_jsx_runtime.jsx)("ul", {
						className: ModelHealthAction_module_css_default.providerRows,
						children: group.models.map((model) => (0, react_jsx_runtime.jsx)(ModelRow, {
							model,
							t
						}, `${model.provider}/${model.model}`))
					})]
				}, group.provider))
			});
		}
		/**
		* The model checkbox list shown while the settings gear is on. Every registered
		* provider and model (from the host catalog) renders a checkbox reflecting the
		* draft selection; unchecking hides the model and stops probing it after "done".
		*/
		function EditableStatusBoard({ catalog, filter, onChange, t }) {
			const groups = (0, react.useMemo)(() => groupByProviderList(catalog), [catalog]);
			if (catalog.length === 0) return (0, react_jsx_runtime.jsx)("p", {
				className: ModelHealthAction_module_css_default.emptyNote,
				children: t("summary.none")
			});
			return (0, react_jsx_runtime.jsx)("div", {
				className: ModelHealthAction_module_css_default.list,
				children: groups.map((group) => (0, react_jsx_runtime.jsxs)("section", {
					className: ModelHealthAction_module_css_default.providerGroup,
					children: [(0, react_jsx_runtime.jsxs)("header", {
						className: ModelHealthAction_module_css_default.providerHead,
						children: [(0, react_jsx_runtime.jsxs)("label", {
							className: ModelHealthAction_module_css_default.checkRow,
							children: [(0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: providerEnabled(filter, group.provider),
								onChange: () => {
									onChange(toggleProvider(filter, group.provider));
								}
							}), (0, react_jsx_runtime.jsx)("span", {
								className: ModelHealthAction_module_css_default.providerName,
								children: group.provider
							})]
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ModelHealthAction_module_css_default.providerCount,
							children: t("provider.count", { count: group.entries.length })
						})]
					}), (0, react_jsx_runtime.jsx)("ul", {
						className: ModelHealthAction_module_css_default.providerRows,
						children: group.entries.map((entry) => (0, react_jsx_runtime.jsx)("li", {
							className: ModelHealthAction_module_css_default.catalogRow,
							children: (0, react_jsx_runtime.jsxs)("label", {
								className: ModelHealthAction_module_css_default.checkRow,
								children: [
									(0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: modelEnabled(filter, entry.provider, entry.model),
										onChange: () => {
											onChange(toggleModel(filter, entry.provider, entry.model));
										}
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: ModelHealthAction_module_css_default.name,
										title: entry.model,
										children: entry.name
									}),
									(0, react_jsx_runtime.jsx)("span", {
										className: ModelHealthAction_module_css_default.modelId,
										title: entry.model,
										children: entry.model
									})
								]
							})
						}, `${entry.provider}/${entry.model}`))
					})]
				}, group.provider))
			});
		}
		/** Group the catalog entries under their providers, preserving order. */
		function groupByProviderList(catalog) {
			const groups = [];
			let current;
			for (const entry of catalog) {
				if (current?.provider !== entry.provider) {
					current = {
						provider: entry.provider,
						entries: []
					};
					groups.push(current);
				}
				current.entries.push(entry);
			}
			return groups;
		}
		function TrendRow({ item, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const allPoints = item.points;
			const recent = allPoints.slice(-5);
			const canExpand = allPoints.length > 5;
			const expandedPoints = expanded ? [...allPoints].reverse() : [];
			return (0, react_jsx_runtime.jsxs)("li", {
				className: expanded ? `${ModelHealthAction_module_css_default.trendRow} ${ModelHealthAction_module_css_default.trendRowExpanded}` : ModelHealthAction_module_css_default.trendRow,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: ModelHealthAction_module_css_default.trendRowMain,
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: ModelHealthAction_module_css_default.trendName,
							title: item.key,
							children: item.name
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: ModelHealthAction_module_css_default.dotStrip,
							children: recent.map((point, index) => {
								const label = pointTitle(point, t, formatTimestamp(point.checkedAt));
								return (0, react_jsx_runtime.jsx)("span", {
									className: point.ok ? ModelHealthAction_module_css_default.pointOk : point.code === "PROBE_TIMEOUT" ? ModelHealthAction_module_css_default.pointWarn : ModelHealthAction_module_css_default.pointErr,
									title: label,
									role: "img",
									"aria-label": label
								}, index);
							})
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: ModelHealthAction_module_css_default.trendMeta,
							children: [
								t("trend.okRate", { percent: item.okRate }),
								" · ",
								formatLatency(item.avgTotalMs)
							]
						}),
						canExpand ? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ModelHealthAction_module_css_default.trendToggle,
							"aria-expanded": expanded,
							"aria-label": expanded ? t("trend.collapse") : t("trend.expand"),
							onClick: () => {
								setExpanded((current) => !current);
							},
							children: expanded ? t("trend.collapse") : t("trend.more")
						}) : null
					]
				}), expanded ? (0, react_jsx_runtime.jsxs)("div", {
					className: ModelHealthAction_module_css_default.trendDetail,
					children: [(0, react_jsx_runtime.jsx)("div", {
						className: ModelHealthAction_module_css_default.trendSummary,
						children: t("trend.summary", {
							count: allPoints.length,
							avg: formatLatency(item.avgTotalMs),
							percent: item.okRate
						})
					}), (0, react_jsx_runtime.jsx)("ul", {
						className: ModelHealthAction_module_css_default.trendDetailList,
						children: expandedPoints.map((point, index) => (0, react_jsx_runtime.jsxs)("li", {
							className: ModelHealthAction_module_css_default.trendDetailRow,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: ModelHealthAction_module_css_default.trendDetailTime,
									children: formatTimestamp(point.checkedAt)
								}),
								(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
									state: point.ok ? "done" : point.code === "PROBE_TIMEOUT" ? "warning" : "error",
									className: ModelHealthAction_module_css_default.rowDot
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: point.ok ? ModelHealthAction_module_css_default.trendDetailOk : ModelHealthAction_module_css_default.trendDetailFail,
									children: point.ok ? `${t("history.ok")} ${formatLatency(point.totalMs)}` : point.code === "PROBE_TIMEOUT" ? t("history.timeout") : t("history.failed", { code: point.code })
								}),
								point.ok && point.tps !== void 0 ? (0, react_jsx_runtime.jsx)("span", {
									className: ModelHealthAction_module_css_default.trendDetailTps,
									children: t("trend.throughput", { value: point.tps })
								}) : null
							]
						}, index))
					})]
				}) : null]
			});
		}
		function TrendBoard({ series, t }) {
			if (series.length === 0) return (0, react_jsx_runtime.jsx)("p", {
				className: ModelHealthAction_module_css_default.emptyNote,
				children: t("trend.empty")
			});
			const pointCount = Math.min(5, Math.max(...series.map((item) => item.points.length)));
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("p", {
				className: ModelHealthAction_module_css_default.trendLegend,
				children: t("trend.legend", { count: pointCount })
			}), (0, react_jsx_runtime.jsx)("ul", {
				className: ModelHealthAction_module_css_default.trendList,
				children: series.map((item) => (0, react_jsx_runtime.jsx)(TrendRow, {
					item,
					t
				}, item.key))
			})] });
		}
		/** Hand-typed refresh cadence: commits a valid integer, otherwise reverts the draft. */
		function CustomRefreshInput({ refreshSeconds, setRefreshSeconds, t }) {
			const isCustom = refreshSeconds > 0 && !REFRESH_CHOICES.includes(refreshSeconds);
			const [draft, setDraft] = (0, react.useState)(isCustom ? String(refreshSeconds) : "");
			(0, react.useEffect)(() => {
				setDraft(isCustom ? String(refreshSeconds) : "");
			}, [refreshSeconds, isCustom]);
			const commit = () => {
				const parsed = Number(draft.trim());
				if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 86400) setRefreshSeconds(parsed);
				else setDraft(isCustom ? String(refreshSeconds) : "");
			};
			return (0, react_jsx_runtime.jsxs)("label", {
				className: ModelHealthAction_module_css_default.customRefresh,
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: ModelHealthAction_module_css_default.customRefreshLabel,
						children: t("settings.refresh.custom")
					}),
					(0, react_jsx_runtime.jsx)("input", {
						type: "number",
						className: ModelHealthAction_module_css_default.customRefreshInput,
						value: draft,
						min: 1,
						max: MAX_REFRESH_SECONDS,
						step: 1,
						placeholder: t("settings.refresh.custom"),
						"aria-label": t("settings.refresh.custom"),
						onChange: (event) => {
							setDraft(event.target.value);
						},
						onBlur: commit,
						onKeyDown: (event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commit();
							}
						}
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: ModelHealthAction_module_css_default.customRefreshUnit,
						children: t("settings.refresh.customUnit")
					})
				]
			});
		}
		function SettingsBoard({ settings, setPosition, setRefreshSeconds, t }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ModelHealthAction_module_css_default.settings,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: ModelHealthAction_module_css_default.settingRow,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: ModelHealthAction_module_css_default.settingLabel,
						children: t("settings.position.label")
					}), (0, react_jsx_runtime.jsx)("div", {
						className: ModelHealthAction_module_css_default.pills,
						children: ["sidebar", "header"].map((option) => (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: settings.position === option ? `${ModelHealthAction_module_css_default.pill} ${ModelHealthAction_module_css_default.pillActive}` : ModelHealthAction_module_css_default.pill,
							"aria-pressed": settings.position === option,
							onClick: () => {
								setPosition(option);
							},
							children: t(option === "sidebar" ? "settings.position.sidebar" : "settings.position.header")
						}, option))
					})]
				}), (0, react_jsx_runtime.jsxs)("div", {
					className: ModelHealthAction_module_css_default.settingRow,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: ModelHealthAction_module_css_default.settingLabel,
						children: t("settings.refresh.label")
					}), (0, react_jsx_runtime.jsxs)("div", {
						className: ModelHealthAction_module_css_default.pills,
						children: [REFRESH_CHOICES.map((seconds) => (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: settings.refreshSeconds === seconds ? `${ModelHealthAction_module_css_default.pill} ${ModelHealthAction_module_css_default.pillActive}` : ModelHealthAction_module_css_default.pill,
							"aria-pressed": settings.refreshSeconds === seconds,
							onClick: () => {
								setRefreshSeconds(seconds);
							},
							children: seconds === 0 ? t("settings.refresh.off") : t("settings.refresh.seconds", { seconds })
						}, seconds)), (0, react_jsx_runtime.jsx)(CustomRefreshInput, {
							refreshSeconds: settings.refreshSeconds,
							setRefreshSeconds,
							t
						})]
					})]
				})]
			});
		}
		/**
		* The three aggregate pill chips (`N 正常 · M 异常 · 平均耗时 …`), shared by
		* the panel's first line and the wide sidebar footer row so both read the
		* same summary and stay in lockstep. Returns `null` while nothing has probed.
		*/
		function AggregateChips({ aggregate, t }) {
			if (aggregate === null || aggregate.total === 0) return null;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsx)("span", {
					className: ModelHealthAction_module_css_default.summaryChip,
					children: t("summary.online", { count: aggregate.ok })
				}),
				aggregate.failing > 0 ? (0, react_jsx_runtime.jsx)("span", {
					className: `${ModelHealthAction_module_css_default.summaryChip} ${ModelHealthAction_module_css_default.summaryChipFailing}`,
					children: t("summary.failing", { count: aggregate.failing })
				}) : null,
				aggregate.avgTotalMs !== null ? (0, react_jsx_runtime.jsx)("span", {
					className: ModelHealthAction_module_css_default.summaryChip,
					children: t("summary.avgLatency", { value: formatLatency(aggregate.avgTotalMs) })
				}) : null
			] });
		}
		/**
		* Two side-by-side sparkline cards over retained rounds: per-round
		* ok/failing columns and the mean healthy latency line. Pure inline SVG — no
		* chart dependency, theme colors via CSS variables.
		*/
		function ChartsRow({ rounds, t }) {
			const [hover, setHover] = (0, react.useState)(null);
			if (rounds.length === 0) return (0, react_jsx_runtime.jsx)("p", {
				className: ModelHealthAction_module_css_default.emptyNote,
				children: t("summary.none")
			});
			const clear = () => {
				setHover(null);
			};
			const hoverIndex = hover?.index ?? null;
			const tooltipLeft = hoverIndex === null ? 0 : Math.max(8, Math.min(92, (hoverIndex + .5) / rounds.length * 100));
			const hovered = hoverIndex === null ? null : rounds[hoverIndex] ?? null;
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ModelHealthAction_module_css_default.charts,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: ModelHealthAction_module_css_default.chartCard,
					onMouseLeave: clear,
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: ModelHealthAction_module_css_default.chartTitle,
							children: t("chart.status")
						}),
						(0, react_jsx_runtime.jsx)(StatusSparkline, {
							rounds,
							hover: hoverIndex,
							onHover: (index) => {
								setHover({
									index,
									source: "status"
								});
							}
						}),
						hover !== null && hover.source === "status" && hovered !== null ? (0, react_jsx_runtime.jsx)(ChartTooltip, {
							leftPct: tooltipLeft,
							text: `${t("summary.online", { count: hovered.ok })} · ${t("summary.failing", { count: hovered.failing })} · ${formatTimestamp(hovered.checkedAt)}`
						}) : null
					]
				}), (0, react_jsx_runtime.jsxs)("div", {
					className: ModelHealthAction_module_css_default.chartCard,
					onMouseLeave: clear,
					children: [
						(0, react_jsx_runtime.jsx)("span", {
							className: ModelHealthAction_module_css_default.chartTitle,
							children: t("chart.latency")
						}),
						(0, react_jsx_runtime.jsx)(LatencySparkline, {
							rounds,
							hover: hoverIndex,
							onHover: (index) => {
								setHover({
									index,
									source: "latency"
								});
							}
						}),
						hover !== null && hover.source === "latency" && hovered !== null ? (0, react_jsx_runtime.jsx)(ChartTooltip, {
							leftPct: tooltipLeft,
							text: `${t("summary.avgLatency", { value: formatLatency(hovered.avgLatency) })} · ${formatTimestamp(hovered.checkedAt)}`
						}) : null
					]
				})]
			});
		}
		function ChartTooltip({ leftPct, text }) {
			return (0, react_jsx_runtime.jsx)("div", {
				className: ModelHealthAction_module_css_default.chartTooltip,
				style: { left: `${leftPct}%` },
				children: text
			});
		}
		/** Per-round stacked columns: healthy (success) below failing (error). */
		function StatusSparkline({ rounds, hover, onHover }) {
			const max = Math.max(1, ...rounds.map((round) => round.ok + round.failing));
			const slot = 4;
			const height = 40;
			return (0, react_jsx_runtime.jsx)("svg", {
				className: ModelHealthAction_module_css_default.chartSvg,
				viewBox: `0 0 ${Math.max(rounds.length * slot, 1)} ${height}`,
				preserveAspectRatio: "none",
				role: "img",
				children: rounds.map((round, index) => {
					const x = index * slot;
					const okHeight = Math.round(round.ok / max * (height - 2));
					const failHeight = Math.round(round.failing / max * (height - 2));
					return (0, react_jsx_runtime.jsxs)("g", { children: [
						hover === index ? (0, react_jsx_runtime.jsx)("rect", {
							x,
							y: 0,
							width: slot - 1,
							height,
							fill: "var(--dsw-alias-interactive-bg-hover)"
						}) : null,
						failHeight > 0 ? (0, react_jsx_runtime.jsx)("rect", {
							x,
							y: height - 1 - failHeight,
							width: slot - 1,
							height: failHeight,
							fill: "var(--dsw-alias-state-error-primary)"
						}) : null,
						okHeight > 0 ? (0, react_jsx_runtime.jsx)("rect", {
							x,
							y: height - 1 - okHeight - failHeight,
							width: slot - 1,
							height: okHeight,
							fill: "var(--dsw-alias-state-success-primary)"
						}) : null,
						(0, react_jsx_runtime.jsx)("rect", {
							x,
							y: 0,
							width: slot,
							height,
							fill: "transparent",
							onMouseEnter: () => {
								onHover(index);
							},
							onClick: () => {
								onHover(index);
							}
						})
					] }, round.checkedAt);
				})
			});
		}
		/** Mean healthy latency line across rounds; gaps where a round had none. */
		function LatencySparkline({ rounds, hover, onHover }) {
			const height = 40;
			const points = rounds.flatMap((round, index) => round.avgLatency === null ? [] : [{
				index,
				value: round.avgLatency
			}]);
			const min = points.length > 0 ? Math.min(...points.map((point) => point.value)) : 0;
			const max = points.length > 0 ? Math.max(...points.map((point) => point.value)) : 1;
			const span = Math.max(1, max - min);
			const xOf = (index) => rounds.length <= 1 ? 50 : index / (rounds.length - 1) * 100;
			const yOf = (value) => height - 4 - (value - min) / span * (height - 8);
			let path = "";
			let previousIndex = -1;
			for (const point of points) {
				const gap = previousIndex >= 0 && point.index !== previousIndex + 1;
				path += `${path === "" || gap ? "M" : "L"}${xOf(point.index).toFixed(1)},${yOf(point.value).toFixed(1)}`;
				previousIndex = point.index;
			}
			const hoverPoint = hover === null ? void 0 : points.find((point) => point.index === hover);
			const columnWidth = 100 / rounds.length;
			return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: (0, react_jsx_runtime.jsxs)("div", {
				className: ModelHealthAction_module_css_default.chartPlot,
				children: [(0, react_jsx_runtime.jsxs)("svg", {
					className: ModelHealthAction_module_css_default.chartSvg,
					viewBox: `0 0 100 ${height}`,
					preserveAspectRatio: "none",
					role: "img",
					children: [points.length >= 2 ? (0, react_jsx_runtime.jsx)("path", {
						d: path,
						fill: "none",
						stroke: "var(--dsw-alias-state-warn-primary)",
						strokeWidth: 1.5,
						vectorEffect: "non-scaling-stroke",
						strokeLinejoin: "round",
						strokeLinecap: "round"
					}) : null, rounds.map((round, index) => (0, react_jsx_runtime.jsx)("rect", {
						x: index / rounds.length * 100,
						y: 0,
						width: columnWidth,
						height,
						fill: "transparent",
						onMouseEnter: () => {
							onHover(index);
						},
						onClick: () => {
							onHover(index);
						}
					}, round.checkedAt))]
				}), hoverPoint !== void 0 ? (0, react_jsx_runtime.jsx)("span", {
					className: ModelHealthAction_module_css_default.chartHoverDot,
					style: {
						left: `${xOf(hoverPoint.index).toFixed(2)}%`,
						top: `${(yOf(hoverPoint.value) / height * 100).toFixed(2)}%`
					}
				}) : null]
			}) });
		}
		/**
		* The chip and its popover panel. Renders the trigger even before data arrives
		* so the entry is stable; the panel body covers loading, empty, and error
		* containers.
		* @param props - inject-bound hooks, callbacks, the namespace translator, and
		* the narrow-rail form flag the seat supplies.
		*/
		function HealthView({ useHealth, useHealthSettings, refresh, setPosition, setRefreshSeconds, syncFilter, narrowLabel = false, fullWidth = false, t }) {
			const data = useHealth((value) => value);
			const settings = useHealthSettings((value) => value);
			const [open, setOpen] = (0, react.useState)(false);
			const [tab, setTab] = (0, react.useState)("status");
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(false);
			const [filterDraft, setFilterDraft] = (0, react.useState)({});
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const panelRef = (0, react.useRef)(null);
			const [fixedPos, setFixedPos] = (0, react.useState)(null);
			const tabsBaseId = (0, react.useId)();
			(0, react.useEffect)(() => {
				if (!open) return;
				const checkedAt = data.view?.snapshot.checkedAt;
				if (checkedAt === void 0 || Date.now() - Date.parse(checkedAt) > 9e4) refresh();
			}, [open]);
			(0, react.useEffect)(() => {
				if (settingsOpen) setFilterDraft(data.view?.filter ?? {});
			}, [settingsOpen]);
			(0, react.useLayoutEffect)(() => {
				if (!open) {
					setFixedPos(null);
					return;
				}
				const place = () => {
					const trigger = triggerRef.current;
					const panel = panelRef.current;
					/* v8 ignore next -- refs are attached before the layout effect runs and the listeners die with it. */
					if (trigger === null || panel === null) return;
					const r = trigger.getBoundingClientRect();
					const MARGIN = 12;
					const vw = window.innerWidth;
					const vh = window.innerHeight;
					const lw = panel.offsetWidth;
					const lh = panel.offsetHeight;
					const popUpward = settings.position === "sidebar";
					let x = r.left;
					let y = popUpward ? r.top - lh - 6 : r.bottom + 6;
					/* v8 ignore next -- jsdom reports offsetWidth as 0; the clamp fires in a real browser. */
					if (lw > 0) x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN);
					/* v8 ignore next -- jsdom reports offsetHeight as 0; the clamp fires in a real browser. */
					if (lh > 0) y = Math.min(Math.max(y, MARGIN), vh - lh - MARGIN);
					setFixedPos({
						left: x,
						top: y
					});
				};
				place();
				const panel = panelRef.current;
				const observer = panel !== null && typeof ResizeObserver === "function" ? new ResizeObserver(place) : void 0;
				/* v8 ignore next -- same null-panel case the guard above already covers. */
				observer?.observe(panel);
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				return () => {
					observer?.disconnect();
					window.removeEventListener("scroll", place, true);
					window.removeEventListener("resize", place);
				};
			}, [open, settings.position]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					/* v8 ignore next -- pointerdown targets are always Nodes in practice. */
					if (!(event.target instanceof Node)) return;
					if (rootRef.current?.contains(event.target) === true) return;
					if (panelRef.current?.contains(event.target) === true) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					setOpen(false);
					triggerRef.current?.focus();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open, setOpen]);
			const aggregate = (0, react.useMemo)(() => data.view === null ? null : summarize(data.view.snapshot.models), [data.view]);
			const chartRounds = (0, react.useMemo)(() => data.view === null ? [] : buildRoundSeries(data.view.history), [data.view]);
			const trend = (0, react.useMemo)(() => data.view === null ? [] : filterTrendSeries(buildTrendSeries(data.view.history), data.view.filter), [data.view]);
			const tone = aggregateTone(aggregate, data.loadState === "error");
			const checkedLabel = t("panel.aria");
			const pillsVisible = !narrowLabel && aggregate !== null && aggregate.total > 0;
			const showDot = narrowLabel || !pillsVisible || data.loadState === "error";
			const trigger = (0, react_jsx_runtime.jsxs)("button", {
				ref: triggerRef,
				type: "button",
				className: fullWidth ? `${ModelHealthAction_module_css_default.trigger} ${ModelHealthAction_module_css_default.triggerWide}` : ModelHealthAction_module_css_default.trigger,
				"aria-expanded": open,
				"aria-label": t("chip.label"),
				title: t("panel.title"),
				onClick: () => {
					setOpen((current) => !current);
				},
				children: [
					showDot ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: tone,
						className: ModelHealthAction_module_css_default.triggerDot
					}) : null,
					pillsVisible ? (0, react_jsx_runtime.jsx)(AggregateChips, {
						aggregate,
						t
					}) : null,
					!pillsVisible && !narrowLabel ? (0, react_jsx_runtime.jsx)("span", {
						className: ModelHealthAction_module_css_default.triggerLabel,
						children: t("chip.label")
					}) : null,
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: open ? ModelHealthAction_module_css_default.triggerOpen : void 0 })
				]
			});
			/** Arrow-key navigation between the two tabs, with automatic activation on move. */
			const onTablistKeyDown = (event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				const next = tab === "status" ? "trend" : "status";
				setTab(next);
				panelRef.current?.querySelector(`[data-tab-id="${tabsBaseId}-${next}"]`)?.focus();
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				ref: rootRef,
				className: fullWidth ? `${ModelHealthAction_module_css_default.root} ${ModelHealthAction_module_css_default.rootFull}` : ModelHealthAction_module_css_default.root,
				children: [trigger, open ? (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {
					ref: panelRef,
					className: ModelHealthAction_module_css_default.panel,
					style: fixedPos ?? {
						visibility: "hidden",
						left: 0,
						top: 0
					},
					role: "dialog",
					"aria-label": checkedLabel,
					children: [
						(0, react_jsx_runtime.jsxs)("header", {
							className: ModelHealthAction_module_css_default.panelHead,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: ModelHealthAction_module_css_default.panelTitle,
									children: t("panel.title")
								}),
								(0, react_jsx_runtime.jsx)("span", {
									className: ModelHealthAction_module_css_default.recency,
									title: data.view?.snapshot.checkedAt === void 0 ? void 0 : formatTimestamp(data.view.snapshot.checkedAt),
									children: recencyLabel(recency(data.view?.snapshot.checkedAt, Date.now()), t)
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelHealthAction_module_css_default.iconButton,
									"aria-label": data.refreshing ? t("action.refreshing") : t("action.refresh"),
									title: data.refreshing ? t("action.refreshing") : t("action.refresh"),
									disabled: data.refreshing,
									onClick: refresh,
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14, { className: data.refreshing ? ModelHealthAction_module_css_default.spin : void 0 })
								}),
								settingsOpen ? (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${ModelHealthAction_module_css_default.iconButton} ${ModelHealthAction_module_css_default.iconButtonActive}`,
									"aria-label": t("edit.done"),
									"aria-pressed": true,
									title: t("edit.done"),
									onClick: () => {
										syncFilter(filterDraft);
										setSettingsOpen(false);
									},
									children: (0, react_jsx_runtime.jsx)("svg", {
										viewBox: "0 0 14 14",
										width: 14,
										height: 14,
										"aria-hidden": "true",
										children: (0, react_jsx_runtime.jsx)("path", {
											d: "M2.5 7.5 5.5 10.5 11.5 3.5",
											fill: "none",
											stroke: "currentColor",
											strokeWidth: "1.6",
											strokeLinecap: "round",
											strokeLinejoin: "round"
										})
									})
								}) : (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelHealthAction_module_css_default.iconButton,
									"aria-label": t("action.settings.show"),
									"aria-pressed": false,
									title: t("action.settings.show"),
									onClick: () => {
										setSettingsOpen((current) => !current);
									},
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutline14, {})
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelHealthAction_module_css_default.iconButton,
									"aria-label": t("action.close"),
									title: t("action.close"),
									onClick: () => {
										setOpen(false);
									},
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
								})
							]
						}),
						settingsOpen ? (0, react_jsx_runtime.jsx)(SettingsBoard, {
							settings,
							setPosition,
							setRefreshSeconds,
							t
						}) : null,
						data.view === null && data.loadState === "booting" ? (0, react_jsx_runtime.jsx)("p", {
							className: ModelHealthAction_module_css_default.emptyNote,
							children: t("empty.loading")
						}) : null,
						data.view === null && data.loadState === "error" ? (0, react_jsx_runtime.jsxs)("div", {
							className: ModelHealthAction_module_css_default.emptyNote,
							children: [(0, react_jsx_runtime.jsx)("span", { children: t("empty.error", { message: data.errorMessage ?? "" }) }), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ModelHealthAction_module_css_default.retry,
								onClick: refresh,
								children: t("action.retry")
							})]
						}) : null,
						data.view !== null ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							data.loadState === "error" && data.errorMessage !== null ? (0, react_jsx_runtime.jsx)("p", {
								className: ModelHealthAction_module_css_default.staleNote,
								children: t("empty.error", { message: data.errorMessage })
							}) : null,
							(0, react_jsx_runtime.jsx)(ChartsRow, {
								rounds: chartRounds,
								t
							}),
							(0, react_jsx_runtime.jsx)("div", {
								className: ModelHealthAction_module_css_default.tabs,
								role: "tablist",
								onKeyDown: onTablistKeyDown,
								children: ["status", "trend"].map((option) => (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "tab",
									id: `${tabsBaseId}-${option}-tab`,
									"aria-selected": tab === option,
									"aria-controls": `${tabsBaseId}-panel`,
									"data-tab-id": `${tabsBaseId}-${option}`,
									tabIndex: tab === option ? 0 : -1,
									className: tab === option ? `${ModelHealthAction_module_css_default.tab} ${ModelHealthAction_module_css_default.tabActive}` : ModelHealthAction_module_css_default.tab,
									onClick: () => {
										setTab(option);
									},
									children: t(option === "status" ? "tab.status" : "tab.trend")
								}, option))
							}),
							(0, react_jsx_runtime.jsx)("div", {
								className: ModelHealthAction_module_css_default.board,
								role: "tabpanel",
								id: `${tabsBaseId}-panel`,
								"aria-labelledby": `${tabsBaseId}-${tab}-tab`,
								children: tab === "status" ? settingsOpen ? (0, react_jsx_runtime.jsx)(EditableStatusBoard, {
									catalog: data.view.catalog ?? [],
									filter: filterDraft,
									onChange: setFilterDraft,
									t
								}) : (0, react_jsx_runtime.jsx)(StatusBoard, {
									models: data.view.snapshot.models,
									t
								}) : (0, react_jsx_runtime.jsx)(TrendBoard, {
									series: trend,
									t
								})
							}),
							settingsOpen && tab === "status" ? (0, react_jsx_runtime.jsxs)("div", {
								className: ModelHealthAction_module_css_default.editFooter,
								children: [(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ModelHealthAction_module_css_default.retry,
									onClick: () => {
										setSettingsOpen(false);
									},
									children: t("edit.cancel")
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${ModelHealthAction_module_css_default.retry} ${ModelHealthAction_module_css_default.editDone}`,
									onClick: () => {
										syncFilter(filterDraft);
										setSettingsOpen(false);
									},
									children: t("edit.done")
								})]
							}) : null
						] }) : null
					]
				}), document.body) : null]
			});
		}
		/**
		* Sidebar-footer registration seat: reads the column's `wide` flag and keeps
		* the rail form icon-only when it collapses.
		*
		* The host renders footer actions on one non-wrapping flex row, so a chip that
		* wants its own line cannot get one from CSS alone. Rather than patching the
		* host stylesheet, the seat asks its runtime flex container to wrap while
		* mounted — an inline style on the host's footer-actions row — and restores
		* whatever was there when it unmounts. The slot outlet wraps every occupant in
		* a `display: contents` anchor, so the seat's DOM parent is out of layout and
		* must be climbed past to reach the row that actually lays the occupants out.
		* @param props - sidebar seat props, injected face, and locale.
		*/
		function ModelHealthFooterAction({ wide, useHealth, useHealthSettings, refresh, setPosition, setRefreshSeconds, syncFilter, t }) {
			const rowRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!wide) return;
				const container = flexRowOf(rowRef.current);
				/* v8 ignore next -- the slot container always exists around a mounted seat. */
				if (container === null) return;
				const previous = container.style.flexWrap;
				container.style.flexWrap = "wrap";
				return () => {
					container.style.flexWrap = previous;
				};
			}, [wide]);
			return (0, react_jsx_runtime.jsx)("div", {
				ref: rowRef,
				className: wide ? `${ModelHealthAction_module_css_default.footerRow} ${ModelHealthAction_module_css_default.footerRowWide}` : ModelHealthAction_module_css_default.footerRow,
				children: (0, react_jsx_runtime.jsx)(HealthView, {
					narrowLabel: !wide,
					fullWidth: wide,
					showStrip: wide,
					useHealth,
					useHealthSettings,
					refresh,
					setPosition,
					setRefreshSeconds,
					syncFilter,
					t
				})
			});
		}
		/**
		* The nearest ancestor that generates the footer seat's flex context. The slot
		* outlet anchors every occupant in a `display: contents` element (so the host
		* flex row sees the occupants directly), which has no box of its own — setting
		* `flex-wrap` there would be a silent no-op. Climb past contents-only ancestors
		* to the host's footer-actions row that actually participates in layout.
		* @param root - the seat's root element.
		* @returns the flex row, or `null` before mount.
		*/
		function flexRowOf(root) {
			let node = root?.parentElement ?? null;
			while (node !== null && getComputedStyle(node).display === "contents") node = node.parentElement;
			return node;
		}
		/**
		* Conversation-header registration seat: always roomy enough for the full
		* chip, so it renders the default form.
		* @param props - injected face and locale (the header's own props are unused).
		*/
		function ModelHealthHeaderAction(props) {
			return (0, react_jsx_runtime.jsx)(HealthView, { ...props });
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** `modelHealth` namespace dictionaries. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "modelHealth";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"chip.label": "模型健康",
			"panel.title": "模型状态",
			"panel.aria": "模型状态",
			"recency.justNow": "刚刚更新",
			"recency.minutes": "{minutes} 分钟前更新",
			"recency.hours": "{hours} 小时前更新",
			"recency.none": "尚未检查",
			"action.refresh": "立即检查",
			"action.refreshing": "检查中…",
			"action.close": "关闭面板",
			"action.settings.show": "显示设置",
			"action.settings.hide": "收起设置",
			"summary.online": "正常{count}",
			"summary.failing": "异常{count}",
			"summary.none": "暂无已注册模型",
			"summary.avgLatency": "耗时{value}",
			"tab.status": "实时状态",
			"tab.trend": "历史趋势",
			"chart.status": "状态趋势",
			"chart.latency": "耗时趋势",
			"provider.count": "{count} 个模型",
			"trend.legend": "最近 {count} 次检查",
			"trend.okRate": "{percent}%",
			"trend.empty": "完成至少一轮检查后展示趋势",
			"empty.loading": "正在获取模型状态…",
			"empty.error": "获取失败：{message}",
			"action.retry": "重试",
			"settings.position.label": "显示位置",
			"settings.position.sidebar": "侧边栏",
			"settings.position.header": "会话顶栏",
			"settings.refresh.label": "自动刷新",
			"settings.refresh.off": "关闭",
			"settings.refresh.seconds": "{seconds} 秒",
			"settings.refresh.custom": "自定义",
			"settings.refresh.customUnit": "秒",
			"latency.title": "首字 {ttft} · 总耗时 {total}",
			"history.title": "{checkedAt} · {status}",
			"history.ok": "正常",
			"history.timeout": "超时",
			"history.failed": "{code}",
			"trend.expand": "展开全部",
			"trend.collapse": "收起",
			"trend.more": "更多",
			"trend.summary": "全部 {count} 次 · 均值 {avg} · 成功率 {percent}%",
			"trend.throughput": "吞吐 {value} tok/s",
			"edit.done": "完成设置",
			"edit.cancel": "取消"
		};
		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			"chip.label": "Model health",
			"panel.title": "Model status",
			"panel.aria": "Model status",
			"recency.justNow": "Updated just now",
			"recency.minutes": "Updated {minutes}m ago",
			"recency.hours": "Updated {hours}h ago",
			"recency.none": "Not checked yet",
			"action.refresh": "Check now",
			"action.refreshing": "Checking…",
			"action.close": "Close panel",
			"action.settings.show": "Display settings",
			"action.settings.hide": "Hide settings",
			"summary.online": "{count} online",
			"summary.failing": "{count} failing",
			"summary.none": "No registered models",
			"summary.avgLatency": "Avg latency {value}",
			"tab.status": "Status",
			"tab.trend": "Trend",
			"chart.status": "Status trend",
			"chart.latency": "Latency trend",
			"provider.count": "{count} models",
			"trend.legend": "Last {count} checks",
			"trend.okRate": "{percent}%",
			"trend.empty": "Trend appears after the first completed check round",
			"empty.loading": "Fetching model status…",
			"empty.error": "Failed to fetch: {message}",
			"action.retry": "Retry",
			"settings.position.label": "Show in",
			"settings.position.sidebar": "Sidebar",
			"settings.position.header": "Conversation header",
			"settings.refresh.label": "Auto refresh",
			"settings.refresh.off": "Off",
			"settings.refresh.seconds": "{seconds}s",
			"settings.refresh.custom": "Custom",
			"settings.refresh.customUnit": "s",
			"latency.title": "{ttft} to first token · {total} total",
			"history.title": "{checkedAt} · {status}",
			"history.ok": "OK",
			"history.timeout": "timeout",
			"history.failed": "{code}",
			"trend.expand": "Show all",
			"trend.collapse": "Collapse",
			"trend.more": "More",
			"trend.summary": "All {count} checks · mean {avg} · {percent}% success",
			"trend.throughput": "{value} tok/s",
			"edit.done": "Done",
			"edit.cancel": "Cancel"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Required services for locale registration and slot contribution. */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body: register the dictionaries, start the auto-refresh controller,
		* and keep one chip mounted at the currently chosen position.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "model-health: dictionaries");
			const controller = new ModelHealthController();
			const injectFace = () => ({
				hooks: {
					health: controller.data,
					healthSettings: controller.settings
				},
				refresh: () => {
					controller.refresh();
				},
				setPosition: (position) => {
					controller.setPosition(position);
				},
				setRefreshSeconds: (seconds) => {
					controller.setRefreshSeconds(seconds);
				},
				syncFilter: (filter) => {
					controller.syncFilter(filter);
				}
			});
			const mount = (position) => position === "sidebar" ? ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "model-health",
				order: 40,
				locale: NS,
				inject: injectFace
			}, ModelHealthFooterAction)) : ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "model-health",
				order: 40,
				locale: NS,
				inject: injectFace
			}, ModelHealthHeaderAction));
			controller.start();
			let position = controller.settings.getSnapshot().position;
			let disposeMount = mount(position);
			const unsubscribe = controller.settings.subscribe(() => {
				const next = controller.settings.getSnapshot().position;
				if (next === position) return;
				position = next;
				disposeMount();
				disposeMount = mount(next);
			});
			ctx.effect(() => () => {
				unsubscribe();
				disposeMount();
				controller.dispose();
			}, "model-health.lifecycle()");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map