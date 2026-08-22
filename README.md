# dsh-model-health

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that periodically probes every registered model for connectivity and latency, and surfaces the results through a Web UI status chip, an HTTP route, and a `model_status` tool.

## Install

In DSH settings → Plugin Management, paste this repository's Git URL and click Install. After DSH restarts, the model-health chip appears in the conversation header by default.

Alternatively, via CLI:

```sh
dsh plugin --profile web add <git-url>
```

## Features

- **Periodic probes**: every registered provider/model pair gets one minimal request (`maxTokens: 1`) per round. The default interval is 300 seconds on the host side; the Web panel auto-refreshes by re-probing and reloading on its own cadence (also defaulting to 300 seconds — see the settings cadence below). The first round runs immediately on startup, and a cheap enumeration-only sweep every 15 seconds notices newly registered models and probes them within seconds — adding a model to an existing provider publishes no `llm/adapters-updated` event, so without the sweep it would stay invisible for up to a full interval.
- **Status chip**: a status dot plus a live readout in the conversation header or sidebar footer (the sidebar occupies its own row). Once any model has probed, both seats show three summary pills — 正常N 异常M 耗时X — instead of a label plus a healthy/total count; before the first round they show the plain 模型健康 label. Dot tones: green (all ok), amber (some failing or timeout), red (all failing or error).
- **Detail panel**: two sparkline cards over the retained rounds — per-round ok/failing columns and a mean-latency line, with hover tooltips showing each round's collection time and numbers — above per-model rows grouped by provider with latency (TTFT + total), failure codes, and a trend strip per model with success rate and average latency.
- **Model filter (settings mode)**: with the settings gear on, the status tab shows a checkbox per provider and per model. Unchecking a provider or model hides it from the panel AND stops probing it. The selection is synced to the host over the status route and persisted host-side (`persistFile`), so it survives both a browser reload and a DSH restart. Saving applies immediately — the host re-probes and the panel reloads without a page refresh. First install defaults to everything enabled; newly registered models auto-enable.
- **Trend**: each model row shows its last 5 check points plus success rate and average latency by default; the far-right pill button (更多/收起) expands a list of every retained check with its exact time, result, and output tokens/s when the adapter reported usage and the sample is big enough to trust (a 1-token probe hides the rate; raise `probeMaxTokens` for a real number). Hidden (disabled) models are also dropped from the trend tab.
- **Auto-refresh cadence**: the settings popover offers fixed cadences (off / 30s / 60s / 120s / 300s) plus a custom field for any whole number of seconds. Auto-refresh means collect + load: every tick runs a full probe round, so this cadence directly sets how often models are re-checked (and how much provider quota the panel spends).
- **Stale-panel refresh**: opening the panel forces a fresh round whenever the last probe is older than 90 seconds (or has never run), so the "updated …" line reflects reality instead of the slow host cadence.
- **Persistence**: probe history and the enabled-model selection are saved to `<dshHome>/model-health.json` by default, so accumulated trends survive a DSH restart.
- **Provider/model static filter**: configure `providers` and `models` in cordis.yml to probe only a subset.
- **`model_status` tool**: the agent can check model health on demand.
- **HTTP route**: `GET /api/model-health` serves the snapshot + history + catalog + filter as JSON; `?refresh=1` forces a fresh round; `POST /api/model-health` applies a new enabled-model filter.

## Config

```yaml
- id: model-health
  name: 'dsh-model-health'
  config:
    enabled: true
    intervalSeconds: 300
    probeTimeoutMs: 30000
    concurrency: 2
    probePrompt: ping
    probeMaxTokens: 1
    historyLimit: 40
    httpEnabled: true
    httpPath: /api/model-health
    providers:        # optional: only probe these providers
      - deepseek
    models:           # optional: only probe these provider/model pairs
      - deepseek/deepseek-chat
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Install the timer loop and tool; `false` mounts nothing. |
| `intervalSeconds` | `300` | Seconds between probe rounds. |
| `probeTimeoutMs` | `30000` | Per-probe deadline in milliseconds. |
| `concurrency` | `2` | Maximum simultaneous probes in one round. |
| `probePrompt` | `ping` | Minimal request text each probe sends. |
| `probeMaxTokens` | `1` | Output token cap each probe requests. Raise it (e.g. `128`) if you want the trend rows' throughput number — a 1-token probe has no statistically meaningful rate, so throughput stays hidden until the sample is big enough. |
| `historyLimit` | `40` | Retained probe rounds for trend rendering; 0 disables history. |
| `httpEnabled` | `true` | Register the status HTTP route when a WebServer service is mounted. |
| `httpPath` | `/api/model-health` | Absolute pathname of the status route. |
| `persistFile` | `<dshHome>/model-health.json` | Absolute JSON path where history and the enabled-model filter are persisted across restarts. |
| `providers` | unset | Provider ids whose models are probed; unset or empty probes all. |
| `models` | unset | Specific `provider/model` pairs to probe; unset or empty probes all. |
| `credentialRetryDelayMs` | `3000` | Delay between a deferred credential-pending round and its prompt re-probe. |
| `credentialRetryLimit` | `3` | How many times a model may stay credential-pending (e.g. `MISSING_CREDENTIAL` at startup, before the credential seam finishes loading) before the failure is recorded for real; `0` disables the retry. |

## Known Limitations

- **Probes run through the public stream path** — the provider's retry policy applies.
- **The deadline only notifies** — a third-party adapter that ignores `options.signal` can hold a probe past `probeTimeoutMs`.
- **The status route is unauthenticated** — the plugin inherits the host WebServer's listener (loopback in the shipping web profile) and authenticates nothing itself. `?refresh=1` triggers a full probe round that spends provider quota; `POST` applies a filter and re-probes.
- **Persistence is best-effort** — the history/filter file is written under a lock and read on start, but a crash between rounds can lose the latest round.
- **History cost scales with the catalog** — each retained round stores one record per registered model.
- **Cadence is a floor, not a hard deadline** — one round is bounded by (models ÷ `concurrency`) × `probeTimeoutMs`; a cadence shorter than that makes rounds run back-to-back (continuous probing) rather than exactly on the interval.

## License

MIT
